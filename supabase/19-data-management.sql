-- ============================================================================
-- Codirector Hub - one Tour Guide identity, many spreadsheets
--
-- Run ONCE in the Supabase SQL editor, AFTER 18-admin-operations.sql. Safe to
-- run again; nothing here deletes or rewrites existing data.
--
-- The idea
--   Every Tour Guide is ONE row in `guides` (that already existed, and is what
--   evaluations, attendance and training point at). Every spreadsheet - the
--   Tour Guides by Major list, the tour schedule, a master roster - is read
--   into `source_records`, and each record is tied to that same guide through
--   `external_identity_mappings`. A match an administrator confirms is
--   remembered, across sources and across semesters, so nobody is asked twice.
--
-- What this adds
--   external_sources            which sheet feeds what (and which one is active)
--   column_templates            remembered column mappings, recognised by header
--   source_records              the normalised rows of every source (no duplicates:
--                               one row per source + external key, upserted)
--   external_identity_mappings  "this spelling / email / id  ==  this guide"
--   sync_runs, sync_issues      what each sync did, and what needs a human
--   field_ownership             which source is trusted for which field
--   guide_overrides             a value an administrator set by hand, visibly
--   major_mappings              CS / Comp Sci / Computer Science -> one name
--   guide_terms                 a person exists; are they active THIS semester?
--   new guide columns           major, linked account, leadership, evaluator and
--                               tour eligibility, notes
--   admin_* functions           every write, with checks, audit and no SQL
--
-- Rules the functions enforce whatever the front end sends
--   * administrators only
--   * nobody is deleted - guides are archived or made inactive for a semester
--   * a fuzzy name match is NEVER accepted without a person confirming it
--   * repeating a sync never creates duplicates
--   * a source never overwrites a value an administrator set by hand, or a field
--     the Hub owns; conflicts become reviewable issues instead
--   * the sync preview is the real sync with the result rolled back
-- ============================================================================
begin;

-- --------------------------------------------------------------------------
-- 1. The canonical Tour Guide record gains the fields every screen needs.
-- --------------------------------------------------------------------------
alter table guides add column if not exists major              text;
alter table guides add column if not exists member_id          uuid references members(id) on delete set null;
alter table guides add column if not exists is_leadership      boolean not null default false;
alter table guides add column if not exists evaluator_eligible boolean not null default true;
alter table guides add column if not exists tour_eligible      boolean not null default true;
alter table guides add column if not exists notes              text;
create unique index if not exists guides_one_per_member on guides (member_id) where member_id is not null;

-- A committee member can be paused as an evaluator (away this semester)
-- without changing their role.
alter table members add column if not exists evaluator_available boolean not null default true;

-- --------------------------------------------------------------------------
-- 2. Person-exists vs active-this-semester.
-- --------------------------------------------------------------------------
create table if not exists guide_terms (
  guide_id uuid not null references guides(id) on delete cascade,
  term_id  text not null references terms(id)  on delete cascade,
  active   boolean not null default true,
  note     text,
  primary key (guide_id, term_id)
);

-- Anyone with a place on a term's evaluation roster takes part in that term.
insert into guide_terms (guide_id, term_id, active)
select distinct e.guide_id, e.term_id, true from evals e on conflict do nothing;

create or replace function hub_guide_term_from_eval() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into guide_terms (guide_id, term_id, active) values (new.guide_id, new.term_id, true) on conflict do nothing;
  return new;
end $$;
drop trigger if exists evals_guide_term on evals;
create trigger evals_guide_term after insert on evals for each row execute function hub_guide_term_from_eval();

-- The tracker view now also hides a guide who is inactive for that semester.
do $view$
begin
  execute $sql$
create or replace view eval_roster with (security_invoker = true) as
select
  e.id, e.term_id, e.guide_id, g.first_name, g.last_name, g.full_name, e.priority,
  p.sort_order as priority_rank, p.needs_eval, e.evaluator_id,
  m.full_name as evaluator_name, e.tour_date, e.tour_time, e.scheduling_notes,
  e.claimed_at, e.submitted_at, e.reviewed_at,
  case
    when not p.needs_eval           then 'skip'
    when e.reviewed_at  is not null then 'reviewed'
    when e.submitted_at is not null then 'submitted'
    when e.evaluator_id is not null then 'claimed'
    else                                 'open'
  end as status,
  (g.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = e.term_id), true)) as guide_active
from evals e
join guides     g on g.id = e.guide_id
join priorities p on p.name = e.priority
left join members m on m.id = e.evaluator_id
  $sql$;
exception when others then
  raise notice 'eval_roster was not changed: %', sqlerrm;
end
$view$;

-- --------------------------------------------------------------------------
-- 3. Sources, templates, normalised records, identity mappings.
-- --------------------------------------------------------------------------
create table if not exists external_sources (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('majors', 'tour_schedule', 'roster')),
  name            text not null,
  sheet_id        text not null check (sheet_id ~ '^[A-Za-z0-9_-]{20,}$'),
  sheet_title     text,
  tab             text,
  gid             text,
  adapter         text not null default 'table' check (adapter in ('table', 'grid')),
  column_map      jsonb not null default '{}'::jsonb,
  options         jsonb not null default '{}'::jsonb,
  active          boolean not null default false,
  status          text not null default 'new',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error      text,
  row_count       int,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  activated_at    timestamptz
);
create unique index if not exists one_active_source_per_kind on external_sources (kind) where active;

create table if not exists column_templates (
  kind       text not null,
  signature  text not null,                 -- the sorted, normalised header names
  adapter    text not null default 'table',
  column_map jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, signature)
);

create table if not exists source_records (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references external_sources(id) on delete cascade,
  source_kind    text not null,
  external_key   text not null,             -- unique per row within the source (a schedule row: date|slot|name)
  identity_key   text,                      -- who it is: the key identity mappings and issues use (a name or email)
  external_name  text,
  external_email text,
  payload        jsonb not null default '{}'::jsonb,
  occurred_on    date,                      -- schedule rows: the tour date
  slot           text,
  start_time     text,
  guide_id       uuid references guides(id) on delete set null,
  match_basis    text,                      -- id | email | saved | exact | alias | confirmed
  active         boolean not null default true,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (source_id, external_key)
);
create index if not exists source_records_guide on source_records (guide_id);
create index if not exists source_records_identity on source_records (source_kind, identity_key);
create index if not exists source_records_when  on source_records (source_kind, occurred_on) where active;

create table if not exists external_identity_mappings (
  id             bigserial primary key,
  source_kind    text not null,
  external_key   text not null,
  external_name  text,
  external_email text,
  guide_id       uuid references guides(id) on delete cascade,
  ignored        boolean not null default false,   -- "this is not one of our guides"
  confidence     numeric,
  confirmed      boolean not null default false,
  confirmed_by   uuid,
  confirmed_at   timestamptz,
  last_seen_at   timestamptz default now(),
  active         boolean not null default true,
  unique (source_kind, external_key),
  check (ignored or guide_id is not null)
);
create index if not exists identity_mappings_guide on external_identity_mappings (guide_id);

create table if not exists sync_runs (
  id           bigserial primary key,
  source_id    uuid references external_sources(id) on delete set null,
  source_kind  text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',
  rows_total   int,
  summary      jsonb,
  run_by       uuid
);

create table if not exists sync_issues (
  id            bigserial primary key,
  kind          text not null,
  source_kind   text,
  source_id     uuid,
  record_id     uuid,
  external_key  text,
  external_name text,
  guide_id      uuid references guides(id) on delete cascade,
  term_id       text,
  detail        jsonb,
  suggested     jsonb,
  status        text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid,
  resolution    text
);
-- one issue per thing per semester: a decision already made is never asked again
create unique index if not exists sync_issues_once on sync_issues
  (kind, coalesce(source_kind, ''), coalesce(external_key, ''), coalesce(guide_id::text, ''), coalesce(term_id, ''));

-- --------------------------------------------------------------------------
-- 4. Which source is trusted for which field, hand-set values, major names.
-- --------------------------------------------------------------------------
create table if not exists field_ownership (
  field text primary key,
  owner text not null check (owner in ('hub', 'majors', 'roster', 'tour_schedule'))
);
insert into field_ownership (field, owner) values
  ('major', 'majors'), ('email', 'hub'), ('eval_priority', 'hub'), ('tour_assignment', 'tour_schedule')
on conflict do nothing;

create table if not exists guide_overrides (
  guide_id     uuid not null references guides(id) on delete cascade,
  field        text not null check (field in ('major', 'email')),
  value        text,
  source_value text,                       -- what the spreadsheet said when the override was made / last seen
  set_by       uuid,
  set_at       timestamptz not null default now(),
  primary key (guide_id, field)
);

create table if not exists major_mappings (
  raw       text primary key,              -- lower-cased, trimmed
  canonical text not null
);

-- --------------------------------------------------------------------------
-- 5. Row-level security. Reads are narrow; every write is a function below.
-- --------------------------------------------------------------------------
alter table guide_terms                enable row level security;
alter table external_sources           enable row level security;
alter table column_templates           enable row level security;
alter table source_records             enable row level security;
alter table external_identity_mappings enable row level security;
alter table sync_runs                  enable row level security;
alter table sync_issues                enable row level security;
alter table field_ownership            enable row level security;
alter table guide_overrides            enable row level security;
alter table major_mappings             enable row level security;

drop policy if exists read_guide_terms on guide_terms;
create policy read_guide_terms on guide_terms for select using (is_member());
drop policy if exists read_sources on external_sources;
create policy read_sources on external_sources for select using (is_member());     -- the sheet id is not a secret
drop policy if exists read_records on source_records;
create policy read_records on source_records for select using (source_kind = 'tour_schedule' and is_member() or hub_is_admin());
drop policy if exists read_templates on column_templates;
create policy read_templates on column_templates for select using (hub_is_admin());
drop policy if exists read_mappings on external_identity_mappings;
create policy read_mappings on external_identity_mappings for select using (hub_is_admin());
drop policy if exists read_runs on sync_runs;
create policy read_runs on sync_runs for select using (hub_is_admin());
drop policy if exists read_issues on sync_issues;
create policy read_issues on sync_issues for select using (hub_is_admin());
drop policy if exists read_ownership on field_ownership;
create policy read_ownership on field_ownership for select using (is_member());
drop policy if exists read_overrides on guide_overrides;
create policy read_overrides on guide_overrides for select using (hub_is_admin());
drop policy if exists read_major_mappings on major_mappings;
create policy read_major_mappings on major_mappings for select using (is_member());

-- --------------------------------------------------------------------------
-- 6. Small helpers.
-- --------------------------------------------------------------------------
create or replace function hub_current_term() returns text
  language sql stable security definer set search_path = public as $$ select id from terms where is_current $$;

-- "Computer Science, Data Science (Honors)" -> two majors, each mapped to its
-- canonical name when the administrator has set one; anything unknown is kept
-- exactly as written rather than guessed at.
create or replace function hub_normalize_majors(p_raw text) returns text
  language sql stable security definer set search_path = public as $$
  select nullif(string_agg(coalesce(m.canonical, x.item), '; ' order by x.ord), '')
  from (
    select trim(item) as item, ord
    from regexp_split_to_table(coalesce(p_raw, ''), ',\s*(?![^()]*\))') with ordinality as t(item, ord)
    where trim(item) <> ''
  ) x left join major_mappings m on m.raw = lower(x.item)
$$;

create or replace function hub_field_owner(p_field text) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select owner from field_ownership where field = p_field), 'hub') $$;

-- --------------------------------------------------------------------------
-- 7. SOURCES: connect, template, activate.
-- --------------------------------------------------------------------------
create or replace function admin_save_source(
  p_id uuid, p_kind text, p_name text, p_sheet_id text, p_sheet_title text, p_tab text, p_gid text,
  p_adapter text, p_column_map jsonb, p_options jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform hub_require_admin();
  if p_kind not in ('majors', 'tour_schedule', 'roster') then raise exception 'Unknown kind of source.'; end if;
  if p_sheet_id !~ '^[A-Za-z0-9_-]{20,}$' then raise exception 'That does not look like a Google Sheets link or id.'; end if;
  if p_adapter not in ('table', 'grid') then raise exception 'Unknown layout.'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Give the source a name.'; end if;
  if p_adapter = 'table' and not (p_column_map ? 'name' or (p_column_map ? 'first' and p_column_map ? 'last') or p_column_map ? 'email') then
    raise exception 'Choose which column holds the person (a name, first and last name, or an email).';
  end if;
  if p_kind = 'tour_schedule' and p_adapter = 'table' and not (p_column_map ? 'date') then raise exception 'Choose which column holds the tour date.'; end if;

  if v_id is null then
    insert into external_sources (kind, name, sheet_id, sheet_title, tab, gid, adapter, column_map, options, created_by)
    values (p_kind, trim(p_name), p_sheet_id, p_sheet_title, nullif(p_tab, ''), nullif(p_gid, ''), p_adapter, coalesce(p_column_map, '{}'), coalesce(p_options, '{}'), auth.uid())
    returning id into v_id;
  else
    update external_sources set name = trim(p_name), sheet_id = p_sheet_id, sheet_title = p_sheet_title, tab = nullif(p_tab, ''), gid = nullif(p_gid, ''),
           adapter = p_adapter, column_map = coalesce(p_column_map, '{}'), options = coalesce(p_options, '{}')
     where id = v_id;
    if not found then raise exception 'That source no longer exists.'; end if;
  end if;
  perform hub_audit('source.saved', 'source', p_name, null, jsonb_build_object('kind', p_kind, 'adapter', p_adapter));
  return v_id;
end $$;

create or replace function admin_save_template(p_kind text, p_signature text, p_adapter text, p_column_map jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  if length(coalesce(p_signature, '')) = 0 or length(p_signature) > 600 then raise exception 'Bad template signature.'; end if;
  insert into column_templates (kind, signature, adapter, column_map) values (p_kind, p_signature, p_adapter, p_column_map)
  on conflict (kind, signature) do update set adapter = excluded.adapter, column_map = excluded.column_map, updated_at = now();
end $$;

create or replace function admin_activate_source(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s external_sources%rowtype; prev external_sources%rowtype;
begin
  perform hub_require_admin();
  select * into s from external_sources where id = p_id;
  if not found then raise exception 'That source no longer exists.'; end if;
  select * into prev from external_sources where kind = s.kind and active and id <> p_id;
  update external_sources set active = false where kind = s.kind and active and id <> p_id;
  update external_sources set active = true, activated_at = now() where id = p_id;
  -- The previous sheet's rows stay as history but stop counting as current.
  if prev.id is not null then update source_records set active = false where source_id = prev.id; end if;
  perform hub_audit('source.activated', 'source', s.name, jsonb_build_object('was', prev.name), jsonb_build_object('kind', s.kind, 'now', s.name));
  return jsonb_build_object('result', 'activated');
end $$;

-- --------------------------------------------------------------------------
-- 8. IDENTITY: confirm, and remember.
-- --------------------------------------------------------------------------
create or replace function hub_remember_match(p_kind text, p_key text, p_name text, p_email text, p_guide uuid, p_ignored boolean, p_confidence numeric default 1)
  returns void language plpgsql security definer set search_path = public as $$
begin
  insert into external_identity_mappings (source_kind, external_key, external_name, external_email, guide_id, ignored, confidence, confirmed, confirmed_by, confirmed_at)
  values (p_kind, p_key, p_name, p_email, p_guide, coalesce(p_ignored, false), p_confidence, true, auth.uid(), now())
  on conflict (source_kind, external_key) do update set guide_id = excluded.guide_id, ignored = excluded.ignored,
    external_name = coalesce(excluded.external_name, external_identity_mappings.external_name),
    external_email = coalesce(excluded.external_email, external_identity_mappings.external_email),
    confidence = 1, confirmed = true, confirmed_by = auth.uid(), confirmed_at = now(), active = true;
end $$;

-- Tie every record of this person (in this source) to the guide, and close the question.
create or replace function hub_apply_match(p_kind text, p_key text, p_guide uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update source_records set guide_id = p_guide, match_basis = 'confirmed' where source_kind = p_kind and identity_key = p_key;
  get diagnostics n = row_count;
  update sync_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = 'matched', guide_id = coalesce(guide_id, p_guide)
   where status = 'open' and source_kind = p_kind and external_key = p_key and kind in ('unmatched_person', 'schedule_unmatched');
  return n;
end $$;

create or replace function admin_confirm_match(p_kind text, p_key text, p_guide uuid, p_name text default null, p_email text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare g guides%rowtype; n int;
begin
  perform hub_require_admin();
  select * into g from guides where id = p_guide;
  if not found then raise exception 'Choose a Tour Guide to match to.'; end if;
  if coalesce(p_key, '') = '' then raise exception 'Nothing to match.'; end if;
  perform hub_remember_match(p_kind, p_key, p_name, p_email, p_guide, false);
  if nullif(trim(coalesce(p_email, '')), '') is not null then perform hub_remember_match(p_kind, 'email:' || lower(trim(p_email)), p_name, p_email, p_guide, false); end if;
  n := hub_apply_match(p_kind, p_key, p_guide);
  perform hub_audit('identity.confirmed', 'guide', g.full_name, null, jsonb_build_object('source', p_kind, 'as', coalesce(p_name, p_key)));
  return jsonb_build_object('linked', n);
end $$;

create or replace function admin_forget_match(p_id bigint) returns void
  language plpgsql security definer set search_path = public as $$
declare m external_identity_mappings%rowtype;
begin
  perform hub_require_admin();
  select * into m from external_identity_mappings where id = p_id;
  if not found then return; end if;
  delete from external_identity_mappings where id = p_id;
  update source_records set guide_id = null, match_basis = null where source_kind = m.source_kind and identity_key = m.external_key and match_basis in ('confirmed', 'saved');
  perform hub_audit('identity.forgotten', 'guide', coalesce(m.external_name, m.external_key), null, jsonb_build_object('source', m.source_kind));
end $$;

-- --------------------------------------------------------------------------
-- 9. THE SYNC. Rows arrive already read and matched by the browser (matching is
--    a suggestion); everything is re-checked here, and a fuzzy match is never
--    stored as a link.
-- --------------------------------------------------------------------------
create or replace function hub_sync_source(p_source uuid, p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  s external_sources%rowtype; r jsonb; v_term text := hub_current_term(); g guides%rowtype; old source_records%rowtype;
  v_guide uuid; v_basis text; v_key text; v_ident text; v_rec uuid; v_run bigint; v_now timestamptz := clock_timestamp();
  n_total int := 0; n_auto int := 0; n_saved int := 0; n_review int := 0; n_new int := 0; n_major int := 0; n_conflict int := 0; n_missing int := 0;
  v_major text; v_owner text; v_ov guide_overrides%rowtype; v_issue_kind text; m external_identity_mappings%rowtype; seen text[] := '{}';
begin
  select * into s from external_sources where id = p_source;
  if not found then raise exception 'That source no longer exists.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows were not in the expected shape.'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'That source has more than 5,000 rows; check that it is the right tab.'; end if;

  insert into sync_runs (source_id, source_kind, run_by) values (s.id, s.kind, auth.uid()) returning id into v_run;
  v_issue_kind := case when s.kind = 'tour_schedule' then 'schedule_unmatched' else 'unmatched_person' end;

  for r in select * from jsonb_array_elements(p_rows) loop
    n_total := n_total + 1;
    v_key := lower(trim(coalesce(r->>'key', '')));
    if v_key = '' then continue; end if;
    seen := seen || v_key;
    v_ident := lower(trim(coalesce(nullif(r->>'identity', ''), r->>'key')));
    v_guide := nullif(r->>'guide_id', '')::uuid; v_basis := nullif(r->>'basis', '');

    -- A link is only ever stored for an evidence-backed basis, and the guide must exist.
    if v_basis is null or v_basis not in ('id', 'email', 'saved', 'exact', 'alias', 'confirmed') then v_guide := null; v_basis := null; end if;
    if v_guide is not null and not exists (select 1 from guides where id = v_guide) then v_guide := null; v_basis := null; end if;

    -- a saved decision always wins over what the browser inferred
    select * into m from external_identity_mappings where source_kind = s.kind and external_key = v_ident;
    if found then
      if m.ignored then v_guide := null; v_basis := 'ignored';
      elsif m.guide_id is not null then v_guide := m.guide_id; v_basis := 'saved'; end if;
    end if;

    select * into old from source_records where source_id = s.id and external_key = v_key;
    -- never lose a confirmed link because this run was less sure
    if v_guide is null and old.id is not null and old.match_basis in ('confirmed', 'saved') and old.guide_id is not null then v_guide := old.guide_id; v_basis := old.match_basis; end if;

    insert into source_records (source_id, source_kind, external_key, identity_key, external_name, external_email, payload, occurred_on, slot, start_time, guide_id, match_basis, active, last_seen_at)
    values (s.id, s.kind, v_key, v_ident, r->>'name', nullif(lower(trim(coalesce(r->>'email', ''))), ''), coalesce(r->'payload', '{}'::jsonb),
            nullif(r->>'occurred_on', '')::date, r->>'slot', r->>'start_time', v_guide, v_basis, true, v_now)
    on conflict (source_id, external_key) do update set
      identity_key = excluded.identity_key, external_name = excluded.external_name, external_email = excluded.external_email, payload = excluded.payload,
      occurred_on = excluded.occurred_on, slot = excluded.slot, start_time = excluded.start_time,
      guide_id = excluded.guide_id, match_basis = excluded.match_basis, active = true, last_seen_at = v_now
    returning id into v_rec;

    if v_guide is not null then
      if v_basis = 'saved' then n_saved := n_saved + 1; else n_auto := n_auto + 1; end if;
      update sync_issues set status = 'resolved', resolved_at = now(), resolution = 'matched', resolved_by = null
       where status = 'open' and source_kind = s.kind and external_key = v_ident and kind in ('unmatched_person', 'schedule_unmatched');
      update external_identity_mappings set last_seen_at = now() where source_kind = s.kind and external_key = v_ident;

      -- fields this source may carry
      if s.kind in ('majors', 'roster') then
        select * into g from guides where id = v_guide;
        v_major := hub_normalize_majors(coalesce(r->'payload'->>'major', ''));
        if v_major is not null then
          v_owner := hub_field_owner('major');
          select * into v_ov from guide_overrides where guide_id = v_guide and field = 'major';
          if v_ov.guide_id is not null then
            update guide_overrides set source_value = v_major where guide_id = v_guide and field = 'major';
          elsif coalesce(g.major, '') <> v_major then
            if v_owner = s.kind or coalesce(g.major, '') = '' then
              update guides set major = v_major where id = v_guide; n_major := n_major + 1;
            else
              insert into sync_issues (kind, source_kind, source_id, record_id, external_key, external_name, guide_id, term_id, detail)
              values ('conflicting_major', s.kind, s.id, v_rec, v_ident, r->>'name', v_guide, v_term, jsonb_build_object('hub', g.major, 'source', v_major))
              on conflict do nothing; n_conflict := n_conflict + 1;
            end if;
          end if;
        end if;
        if nullif(lower(trim(coalesce(r->>'email', ''))), '') is not null then
          if coalesce(g.email, '') = '' then
            update guides set email = lower(trim(r->>'email')) where id = v_guide;
          elsif lower(g.email) <> lower(trim(r->>'email')) then
            if hub_field_owner('email') = s.kind and not exists (select 1 from guide_overrides where guide_id = v_guide and field = 'email') then
              update guides set email = lower(trim(r->>'email')) where id = v_guide;
            else
              insert into sync_issues (kind, source_kind, source_id, record_id, external_key, external_name, guide_id, term_id, detail)
              values ('conflicting_email', s.kind, s.id, v_rec, v_ident, r->>'name', v_guide, v_term, jsonb_build_object('hub', g.email, 'source', lower(trim(r->>'email'))))
              on conflict do nothing; n_conflict := n_conflict + 1;
            end if;
          end if;
        end if;
      end if;
    else
      n_review := n_review + 1;
      if v_basis is distinct from 'ignored' then
        n_new := n_new + 1;
        insert into sync_issues (kind, source_kind, source_id, record_id, external_key, external_name, term_id, detail, suggested)
        values (v_issue_kind, s.kind, s.id, v_rec, v_ident, r->>'name', case when s.kind = 'tour_schedule' then null else v_term end,
                jsonb_build_object('email', r->>'email', 'major', r->'payload'->>'major'), r->'candidates')
        on conflict (kind, coalesce(source_kind, ''), coalesce(external_key, ''), coalesce(guide_id::text, ''), coalesce(term_id, ''))
        do update set suggested = excluded.suggested, record_id = excluded.record_id, detail = excluded.detail
           where sync_issues.status = 'open';
      end if;
    end if;
  end loop;

  -- rows that were in an earlier sync of this source but not this one: kept as history, no longer current
  update source_records set active = false where source_id = s.id and active and not (external_key = any (seen));

  -- roster-like sources: who is on our list but not on theirs?
  if s.kind in ('majors', 'roster') then
    for g in select gg.* from guides gg
              where gg.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = gg.id and gt.term_id = v_term), true)
                and not exists (select 1 from source_records sr where sr.source_id = s.id and sr.active and sr.guide_id = gg.id) loop
      insert into sync_issues (kind, source_kind, source_id, external_name, guide_id, term_id, detail)
      values ('roster_missing_in_source', s.kind, s.id, g.full_name, g.id, v_term, jsonb_build_object('source', s.name))
      on conflict do nothing;
      n_missing := n_missing + 1;
    end loop;
    -- the ones that have since appeared no longer need asking about
    update sync_issues set status = 'resolved', resolved_at = now(), resolution = 'found'
     where status = 'open' and kind = 'roster_missing_in_source' and source_id = s.id
       and exists (select 1 from source_records sr where sr.source_id = s.id and sr.active and sr.guide_id = sync_issues.guide_id);
  end if;

  update external_sources set last_attempt_at = now(), last_success_at = now(), last_error = null, status = 'ok', row_count = n_total where id = s.id;
  update sync_runs set finished_at = now(), status = 'ok', rows_total = n_total,
         summary = jsonb_build_object('matched_auto', n_auto, 'matched_saved', n_saved, 'needs_review', n_review) where id = v_run;
  perform hub_audit('source.synced', 'source', s.name, null, jsonb_build_object('rows', n_total, 'needs_review', n_review, 'major_updates', n_major));

  return jsonb_build_object('rows', n_total, 'matched_auto', n_auto, 'matched_saved', n_saved, 'needs_review', n_review,
    'new_people', n_new, 'major_updates', n_major, 'conflicts', n_conflict, 'possible_inactive', n_missing);
end $$;

-- Preview = the same sync, then rolled back.
create or replace function admin_sync_source(p_source uuid, p_rows jsonb, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v jsonb; v_detail text;
begin
  perform hub_require_admin();
  if p_apply then return hub_sync_source(p_source, p_rows) || jsonb_build_object('dry_run', false); end if;
  begin
    v := hub_sync_source(p_source, p_rows);
    raise exception using errcode = 'D0002', message = 'dry run', detail = v::text;
  exception when sqlstate 'D0002' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb || jsonb_build_object('dry_run', true);
  end;
end $$;

-- A failed read is worth remembering too, so Status can say so plainly.
create or replace function admin_source_failed(p_source uuid, p_message text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  update external_sources set last_attempt_at = now(), last_error = left(p_message, 300), status = 'error' where id = p_source;
end $$;

-- --------------------------------------------------------------------------
-- 10. Resolving issues.
-- --------------------------------------------------------------------------
create or replace function admin_resolve_issue(p_issue bigint, p_action text, p_guide uuid default null,
                                               p_first text default null, p_last text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare i sync_issues%rowtype; g guides%rowtype; rec source_records%rowtype; v_term text := hub_current_term();
        v_id uuid; v_first text; v_last text; v_res text := p_action; v_val text; v_field text;
begin
  perform hub_require_admin();
  select * into i from sync_issues where id = p_issue;
  if not found then raise exception 'That item no longer exists.'; end if;
  if i.status <> 'open' then return jsonb_build_object('result', 'already ' || i.status); end if;
  select * into rec from source_records where id = i.record_id;

  if p_action in ('confirm_match', 'choose_person') then
    if i.kind not in ('unmatched_person', 'schedule_unmatched') then raise exception 'That action does not apply here.'; end if;
    if p_guide is null then raise exception 'Choose a Tour Guide.'; end if;
    perform admin_confirm_match(i.source_kind, i.external_key, p_guide, i.external_name, rec.external_email);
    return jsonb_build_object('result', 'matched');

  elsif p_action = 'create_guide' then
    if i.kind <> 'unmatched_person' and i.kind <> 'schedule_unmatched' then raise exception 'That action does not apply here.'; end if;
    v_first := nullif(trim(coalesce(p_first, '')), ''); v_last := nullif(trim(coalesce(p_last, '')), '');
    if v_first is null or v_last is null then
      v_first := coalesce(rec.payload->>'first', split_part(i.external_name, ' ', 1));
      v_last := coalesce(rec.payload->>'last', nullif(trim(substr(i.external_name, length(split_part(i.external_name, ' ', 1)) + 1)), ''));
    end if;
    if coalesce(v_last, '') = '' then raise exception 'Enter the first and last name for the new Tour Guide.'; end if;
    perform hub_save_guide(null, v_first, v_last, rec.external_email, null);
    select id into v_id from guides where lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last) order by created_at desc limit 1;
    v_val := hub_normalize_majors(rec.payload->>'major');
    if v_val is not null then update guides set major = v_val where id = v_id; end if;
    perform hub_remember_match(i.source_kind, i.external_key, i.external_name, rec.external_email, v_id, false);
    perform hub_apply_match(i.source_kind, i.external_key, v_id);
    return jsonb_build_object('result', 'created', 'guide_id', v_id);

  elsif p_action = 'ignore' then
    if i.source_kind is not null and i.external_key is not null and i.kind in ('unmatched_person', 'schedule_unmatched') then
      perform hub_remember_match(i.source_kind, i.external_key, i.external_name, rec.external_email, null, true);
    end if;
    update sync_issues set status = 'ignored', resolved_at = now(), resolved_by = auth.uid(), resolution = 'ignored' where id = i.id;
    perform hub_audit('issue.ignored', 'issue', coalesce(i.external_name, i.kind));
    return jsonb_build_object('result', 'ignored');

  elsif p_action = 'keep_active' then
    update sync_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = 'kept' where id = i.id;
    return jsonb_build_object('result', 'kept');

  elsif p_action = 'mark_inactive' then
    if i.guide_id is null then raise exception 'There is no Tour Guide on this item.'; end if;
    insert into guide_terms (guide_id, term_id, active) values (i.guide_id, v_term, false)
    on conflict (guide_id, term_id) do update set active = false;
    select * into g from guides where id = i.guide_id;
    perform hub_audit('guide.inactive_this_term', 'guide', g.full_name, null, jsonb_build_object('term', v_term));
    update sync_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = 'inactive' where id = i.id;
    return jsonb_build_object('result', 'inactive');

  elsif p_action in ('use_source', 'use_codirector') then
    if i.kind not in ('conflicting_major', 'conflicting_email') or i.guide_id is null then raise exception 'That action does not apply here.'; end if;
    v_field := case when i.kind = 'conflicting_major' then 'major' else 'email' end;
    if p_action = 'use_source' then
      v_val := i.detail->>'source';
      if v_field = 'major' then update guides set major = v_val where id = i.guide_id; else update guides set email = v_val where id = i.guide_id; end if;
      delete from guide_overrides where guide_id = i.guide_id and field = v_field;
    else
      insert into guide_overrides (guide_id, field, value, source_value, set_by) values (i.guide_id, v_field, i.detail->>'hub', i.detail->>'source', auth.uid())
      on conflict (guide_id, field) do update set value = excluded.value, source_value = excluded.source_value, set_by = excluded.set_by, set_at = now();
    end if;
    select * into g from guides where id = i.guide_id;
    perform hub_audit('guide.' || v_field || '_resolved', 'guide', g.full_name, jsonb_build_object('hub', i.detail->>'hub'), jsonb_build_object('chose', p_action, 'source', i.detail->>'source'));
    update sync_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution = p_action where id = i.id;
    return jsonb_build_object('result', p_action);
  end if;
  raise exception 'Unknown action.';
end $$;

-- --------------------------------------------------------------------------
-- 11. THE TOUR GUIDE RECORD: edit, overrides, ownership, majors, participation.
-- --------------------------------------------------------------------------
create or replace function admin_update_guide(p_id uuid, p_fields jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare g guides%rowtype; k text; v text; v_major text; v_src text; changed text[] := '{}';
begin
  perform hub_require_admin();
  select * into g from guides where id = p_id;
  if not found then raise exception 'That Tour Guide no longer exists.'; end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('first_name', 'last_name', 'email', 'major', 'is_leadership', 'evaluator_eligible', 'tour_eligible', 'notes', 'member_id') then
      raise exception '"%" cannot be changed here.', k;
    end if;
  end loop;

  if p_fields ? 'first_name' or p_fields ? 'last_name' then
    if exists (select 1 from guides x where x.id <> p_id and x.active
               and lower(x.first_name) = lower(coalesce(trim(p_fields->>'first_name'), g.first_name))
               and lower(x.last_name)  = lower(coalesce(trim(p_fields->>'last_name'), g.last_name))) then
      raise exception 'Another Tour Guide already has that name.';
    end if;
    update guides set first_name = coalesce(nullif(trim(p_fields->>'first_name'), ''), first_name), last_name = coalesce(nullif(trim(p_fields->>'last_name'), ''), last_name) where id = p_id;
    changed := array_append(changed, 'name');
  end if;

  if p_fields ? 'email' then
    v := nullif(lower(trim(coalesce(p_fields->>'email', ''))), '');
    if v is not null and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% is not an email address.', v; end if;
    if coalesce(v, '') <> coalesce(g.email, '') then
      select source_value into v_src from guide_overrides where guide_id = p_id and field = 'email';
      update guides set email = v where id = p_id; changed := array_append(changed, 'email');
      if hub_field_owner('email') <> 'hub' then
        insert into guide_overrides (guide_id, field, value, source_value, set_by) values (p_id, 'email', v, g.email, auth.uid())
        on conflict (guide_id, field) do update set value = excluded.value, set_by = excluded.set_by, set_at = now();
      end if;
    end if;
  end if;

  if p_fields ? 'major' then
    v_major := hub_normalize_majors(p_fields->>'major');
    if coalesce(v_major, '') <> coalesce(g.major, '') then
      update guides set major = v_major where id = p_id; changed := array_append(changed, 'major');
      if hub_field_owner('major') <> 'hub' then
        insert into guide_overrides (guide_id, field, value, source_value, set_by) values (p_id, 'major', v_major, g.major, auth.uid())
        on conflict (guide_id, field) do update set value = excluded.value, set_by = excluded.set_by, set_at = now();
      end if;
    end if;
  end if;

  if p_fields ? 'is_leadership'      then update guides set is_leadership = (p_fields->>'is_leadership')::boolean where id = p_id; changed := array_append(changed, 'leadership'); end if;
  if p_fields ? 'evaluator_eligible' then update guides set evaluator_eligible = (p_fields->>'evaluator_eligible')::boolean where id = p_id; changed := array_append(changed, 'evaluator'); end if;
  if p_fields ? 'tour_eligible'      then update guides set tour_eligible = (p_fields->>'tour_eligible')::boolean where id = p_id; changed := array_append(changed, 'tours'); end if;
  if p_fields ? 'notes'              then update guides set notes = nullif(left(trim(p_fields->>'notes'), 1000), '') where id = p_id; changed := array_append(changed, 'notes'); end if;
  if p_fields ? 'member_id' then
    if nullif(p_fields->>'member_id', '') is not null and not exists (select 1 from members where id = (p_fields->>'member_id')::uuid) then raise exception 'That account does not exist.'; end if;
    if nullif(p_fields->>'member_id', '') is not null and exists (select 1 from guides x where x.id <> p_id and x.member_id = (p_fields->>'member_id')::uuid) then
      raise exception 'That account is already linked to another Tour Guide.';
    end if;
    update guides set member_id = nullif(p_fields->>'member_id', '')::uuid where id = p_id; changed := array_append(changed, 'account');
  end if;

  if cardinality(changed) > 0 then
    perform hub_audit('guide.edited', 'guide', g.full_name, to_jsonb(changed), p_fields - 'notes');
  end if;
  return jsonb_build_object('changed', changed);
end $$;

create or replace function admin_clear_override(p_guide uuid, p_field text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare o guide_overrides%rowtype; g guides%rowtype;
begin
  perform hub_require_admin();
  select * into o from guide_overrides where guide_id = p_guide and field = p_field;
  if not found then return jsonb_build_object('result', 'nothing to clear'); end if;
  select * into g from guides where id = p_guide;
  if p_field = 'major' then update guides set major = o.source_value where id = p_guide; else update guides set email = o.source_value where id = p_guide; end if;
  delete from guide_overrides where guide_id = p_guide and field = p_field;
  perform hub_audit('guide.override_cleared', 'guide', g.full_name, jsonb_build_object(p_field, o.value), jsonb_build_object(p_field, o.source_value));
  return jsonb_build_object('result', 'returned to source value');
end $$;

create or replace function admin_set_field_owner(p_field text, p_owner text) returns void
  language plpgsql security definer set search_path = public as $$
declare old text;
begin
  perform hub_require_admin();
  if p_field not in ('major', 'email', 'eval_priority', 'tour_assignment') then raise exception 'Unknown field.'; end if;
  if p_owner not in ('hub', 'majors', 'roster', 'tour_schedule') then raise exception 'Unknown source.'; end if;
  if p_field = 'eval_priority' and p_owner <> 'hub' then raise exception 'Evaluation priority is always set in the Hub.'; end if;
  if p_field = 'tour_assignment' and p_owner not in ('tour_schedule', 'hub') then raise exception 'Tour assignments come from the tour schedule.'; end if;
  select owner into old from field_ownership where field = p_field;
  insert into field_ownership (field, owner) values (p_field, p_owner) on conflict (field) do update set owner = excluded.owner;
  perform hub_audit('ownership.changed', 'setting', p_field, to_jsonb(old), to_jsonb(p_owner));
end $$;

create or replace function admin_save_major_mapping(p_raw text, p_canonical text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  if trim(coalesce(p_raw, '')) = '' or trim(coalesce(p_canonical, '')) = '' then raise exception 'Both names are required.'; end if;
  insert into major_mappings (raw, canonical) values (lower(trim(p_raw)), trim(p_canonical))
  on conflict (raw) do update set canonical = excluded.canonical;
  perform hub_audit('major.mapped', 'setting', trim(p_raw), null, to_jsonb(trim(p_canonical)));
end $$;

create or replace function admin_delete_major_mapping(p_raw text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  delete from major_mappings where raw = lower(trim(p_raw));
end $$;

-- Re-apply the major names to everyone after the mapping list changes.
create or replace function admin_renormalize_majors() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int := 0; g guides%rowtype; v text;
begin
  perform hub_require_admin();
  for g in select * from guides where major is not null loop
    v := hub_normalize_majors(g.major);
    if v is distinct from g.major then update guides set major = v where id = g.id; n := n + 1; end if;
  end loop;
  return jsonb_build_object('updated', n);
end $$;

create or replace function admin_set_guide_term(p_ids uuid[], p_term text, p_active boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare i uuid; n int := 0; g guides%rowtype;
begin
  perform hub_require_admin();
  if not exists (select 1 from terms where id = p_term) then raise exception 'There is no such semester.'; end if;
  foreach i in array p_ids loop
    select * into g from guides where id = i;
    if not found then continue; end if;
    insert into guide_terms (guide_id, term_id, active) values (i, p_term, p_active)
    on conflict (guide_id, term_id) do update set active = excluded.active;
    perform hub_audit(case when p_active then 'guide.active_this_term' else 'guide.inactive_this_term' end, 'guide', g.full_name, null, jsonb_build_object('term', p_term));
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $$;

-- --------------------------------------------------------------------------
-- 12. EVALUATION ROSTER: priority, need, assignment.
-- --------------------------------------------------------------------------
create or replace function admin_add_to_eval_roster(p_guide_ids uuid[], p_priority text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := hub_current_term(); i uuid; n int := 0; v_prio text; g guides%rowtype;
begin
  perform hub_require_admin();
  if v_term is null then raise exception 'There is no current semester.'; end if;
  v_prio := coalesce(nullif(p_priority, ''), hub_first_priority());
  if not exists (select 1 from priorities where name = v_prio) then raise exception 'There is no priority called "%".', v_prio; end if;
  foreach i in array p_guide_ids loop
    select * into g from guides where id = i and active;
    if not found then continue; end if;
    insert into evals (term_id, guide_id, priority) values (v_term, i, v_prio) on conflict (term_id, guide_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  perform hub_audit('evalroster.added', 'evaluation roster', n || ' guides', null, jsonb_build_object('priority', v_prio));
  return jsonb_build_object('added', n);
end $$;

create or replace function admin_set_eval_priority(p_guide_ids uuid[], p_priority text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := hub_current_term(); n int := 0; i uuid; e evals%rowtype; g guides%rowtype;
begin
  perform hub_require_admin();
  if not exists (select 1 from priorities where name = p_priority) then raise exception 'There is no priority called "%".', p_priority; end if;
  foreach i in array p_guide_ids loop
    select * into g from guides where id = i; if not found then continue; end if;
    select * into e from evals where term_id = v_term and guide_id = i;
    if not found then
      insert into evals (term_id, guide_id, priority) values (v_term, i, p_priority);
    elsif e.priority <> p_priority then
      update evals set priority = p_priority where id = e.id;
    else continue; end if;
    perform hub_audit('evalpriority.changed', 'guide', g.full_name, to_jsonb(e.priority), to_jsonb(p_priority));
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $$;

create or replace function admin_set_eval_need(p_guide_ids uuid[], p_needs boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := hub_current_term(); n int := 0; i uuid; e evals%rowtype; v_to text; g guides%rowtype; v_mid text;
begin
  perform hub_require_admin();
  select name into v_mid from priorities where needs_eval order by sort_order offset (select (count(*) / 2)::int from priorities where needs_eval) limit 1;
  foreach i in array p_guide_ids loop
    select * into g from guides where id = i; if not found then continue; end if;
    select * into e from evals where term_id = v_term and guide_id = i;
    if p_needs then
      v_to := coalesce(v_mid, hub_first_priority());
      if not found then insert into evals (term_id, guide_id, priority) values (v_term, i, v_to);
      elsif (select needs_eval from priorities where name = e.priority) then continue;
      else update evals set priority = v_to where id = e.id; end if;
    else
      v_to := (select name from priorities where not needs_eval order by sort_order limit 1);
      if v_to is null then raise exception 'There is no "no need to evaluate" priority set up.'; end if;
      if not found then continue;
      elsif not (select needs_eval from priorities where name = e.priority) then continue;
      else update evals set priority = v_to where id = e.id; end if;
    end if;
    perform hub_audit('evalneed.changed', 'guide', g.full_name, to_jsonb(e.priority), to_jsonb(v_to));
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $$;

create or replace function admin_set_evaluator_available(p_member uuid, p_available boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare m members%rowtype;
begin
  perform hub_require_admin();
  select * into m from members where id = p_member;
  if not found then raise exception 'That person no longer exists.'; end if;
  update members set evaluator_available = p_available where id = p_member;
  perform hub_audit('evaluator.availability', 'person', m.full_name, to_jsonb(m.evaluator_available), to_jsonb(p_available));
end $$;

-- Assign evaluators to evaluations, each one checked on its own. Valid ones are
-- saved even if another is refused, and the answer says which and why.
create or replace function admin_assign_evaluations(p_assignments jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a jsonb; e evals%rowtype; m members%rowtype; g guides%rowtype; done int := 0; failed jsonb := '[]'::jsonb;
        v_date date; v_time time; v_term text := hub_current_term();
begin
  perform hub_require_admin();
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) = 0 then raise exception 'There is nothing to assign.'; end if;
  if jsonb_array_length(p_assignments) > 300 then raise exception 'Assign at most 300 at a time.'; end if;
  for a in select * from jsonb_array_elements(p_assignments) loop
    begin
      select * into e from evals where id = (a->>'eval_id')::uuid;
      if not found then raise exception 'That evaluation no longer exists.'; end if;
      if e.term_id <> v_term then raise exception 'That evaluation belongs to an earlier semester.'; end if;
      if e.submitted_at is not null then raise exception 'Already submitted.'; end if;
      if e.evaluator_id is not null then raise exception 'Already claimed by someone.'; end if;
      select * into g from guides where id = e.guide_id;
      if not g.active or not coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = e.term_id), true) then raise exception '% is not active this semester.', g.full_name; end if;
      if not exists (select 1 from priorities where name = e.priority and needs_eval) then raise exception '% does not need an evaluation.', g.full_name; end if;
      select * into m from members where id = (a->>'evaluator_id')::uuid and active;
      if not found then raise exception 'That evaluator is not an active member.'; end if;
      if not exists (select 1 from roles r where r.name = m.role and (r.in_training or r.is_admin)) then raise exception '% is not on the evaluation team.', m.full_name; end if;
      v_date := nullif(a->>'date', '')::date; v_time := nullif(a->>'time', '')::time;
      if v_date is not null and v_date < current_date then raise exception 'That tour date has already passed.'; end if;
      if v_date is not null and v_time is not null and exists (
           select 1 from evals x where x.evaluator_id = m.id and x.term_id = v_term and x.tour_date = v_date and x.tour_time = v_time and x.submitted_at is null) then
        raise exception '% already has an evaluation at that time.', m.full_name;
      end if;
      update evals set evaluator_id = m.id, claimed_at = now(), tour_date = v_date, tour_time = v_time where id = e.id;
      perform hub_audit('evaluation.assigned', 'guide', g.full_name, null, jsonb_build_object('evaluator', m.full_name, 'date', v_date, 'time', v_time));
      done := done + 1;
    exception when others then
      failed := failed || jsonb_build_object('eval_id', a->>'eval_id', 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('assigned', done, 'failed', failed);
end $$;

-- --------------------------------------------------------------------------
-- 13. STATUS: one call that summarises the whole data picture.
-- --------------------------------------------------------------------------
create or replace function admin_data_status() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := hub_current_term(); v jsonb;
begin
  perform hub_require_admin();
  v := jsonb_build_object(
    'term', (select to_jsonb(t) from (select id, label from terms where id = v_term) t),
    'active_guides', (select count(*) from guides g where g.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = v_term), true)),
    'archived_guides', (select count(*) from guides where not active),
    'needing_eval', (select count(*) from evals e join priorities p on p.name = e.priority join guides g on g.id = e.guide_id
                      where e.term_id = v_term and p.needs_eval and g.active),
    'awaiting_assignment', (select count(*) from evals e join priorities p on p.name = e.priority join guides g on g.id = e.guide_id
                             where e.term_id = v_term and p.needs_eval and g.active and e.evaluator_id is null and e.submitted_at is null),
    'not_on_eval_roster', (select count(*) from guides g where g.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = v_term), true)
                             and not exists (select 1 from evals e where e.guide_id = g.id and e.term_id = v_term)),
    'issues', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from sync_issues where status = 'open' group by kind) x), '{}'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'sheet_title', sheet_title, 'tab', tab, 'gid', gid, 'adapter', adapter,
                         'status', status, 'last_success_at', last_success_at, 'last_attempt_at', last_attempt_at, 'last_error', last_error, 'row_count', row_count, 'sheet_id', sheet_id))
                         from external_sources where active), '[]'::jsonb),
    'schedule_records', (select count(*) from source_records where source_kind = 'tour_schedule' and active),
    'schedule_unmatched', (select count(*) from source_records where source_kind = 'tour_schedule' and active and guide_id is null and coalesce(match_basis, '') <> 'ignored'),
    'overrides', (select count(*) from guide_overrides));
  return v;
end $$;

-- admin_health (from file 18) learns about open data issues too.
create or replace function admin_health() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t terms%rowtype; v jsonb;
begin
  perform hub_require_admin();
  select * into t from terms where is_current;
  v := jsonb_build_object(
    'current_term',     case when t.id is null then null else jsonb_build_object('id', t.id, 'label', t.label, 'starts_on', t.starts_on, 'ends_on', t.ends_on) end,
    'current_terms',    (select count(*) from terms where is_current),
    'admins',           hub_admins_excluding('{}'),
    'active_people',    (select count(*) from members where active),
    'roles_without_people', (select count(*) from roles r where not exists (select 1 from members m where m.role = r.name and m.active)),
    'people_bad_role',  (select count(*) from members m where m.active and not exists (select 1 from roles r where r.name = m.role)),
    'active_guides',    (select count(*) from guides where active),
    'guides_missing_eval', case when t.id is null then 0 else
        (select count(*) from guides g where g.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = t.id), true)
           and not exists (select 1 from evals e where e.guide_id = g.id and e.term_id = t.id)) end,
    'evals_for_archived_guides', case when t.id is null then 0 else
        (select count(*) from evals e join guides g on g.id = e.guide_id where e.term_id = t.id and not g.active and e.submitted_at is null and e.evaluator_id is not null) end,
    'training_sessions', case when t.id is null then 0 else (select count(*) from training_sessions where term_id = t.id) end,
    'pending_signups',  (select count(*) from members m where not m.active and m.archived_at is null
                          and m.created_at > now() - interval '30 days'
                          and not exists (select 1 from member_roster x where lower(x.email) = lower(m.email))),
    'open_issues',      (select count(*) from sync_issues where status = 'open'),
    'sources_connected', (select count(*) from external_sources where active),
    'sources_failing',  (select count(*) from external_sources where active and status = 'error'));
  begin
    v := v || jsonb_build_object('reminders_enabled', (select enabled from tour_reminder_settings where singleton));
  exception when undefined_table then null; end;
  return v;
end $$;

-- --------------------------------------------------------------------------
-- 14. Who may call what.
-- --------------------------------------------------------------------------
revoke all on function hub_remember_match(text, text, text, text, uuid, boolean, numeric), hub_apply_match(text, text, uuid),
              hub_sync_source(uuid, jsonb) from public, anon, authenticated;
grant execute on function
  admin_save_source(uuid, text, text, text, text, text, text, text, jsonb, jsonb), admin_save_template(text, text, text, jsonb),
  admin_activate_source(uuid), admin_confirm_match(text, text, uuid, text, text), admin_forget_match(bigint),
  admin_sync_source(uuid, jsonb, boolean), admin_source_failed(uuid, text), admin_resolve_issue(bigint, text, uuid, text, text),
  admin_update_guide(uuid, jsonb), admin_clear_override(uuid, text), admin_set_field_owner(text, text),
  admin_save_major_mapping(text, text), admin_delete_major_mapping(text), admin_renormalize_majors(),
  admin_set_guide_term(uuid[], text, boolean), admin_add_to_eval_roster(uuid[], text), admin_set_eval_priority(uuid[], text),
  admin_set_eval_need(uuid[], boolean), admin_set_evaluator_available(uuid, boolean), admin_assign_evaluations(jsonb),
  admin_data_status(), admin_health()
  to authenticated;

commit;

-- Afterwards this should list the new admin_* functions (about 20 more rows).
select proname from pg_proc where proname like 'admin\_%' order by 1;
