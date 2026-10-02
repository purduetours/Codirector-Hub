-- ============================================================================
-- Codirector Hub - training management
--
-- Run ONCE in the Supabase SQL editor, AFTER 18 and 19. Safe to run again;
-- nothing here deletes or rewrites existing data.
--
-- What already existed, and is kept exactly as it is
--   training_sessions     one row per training date (label, date, term)
--   training_attendance   one row per person per session, with the status text
--   training_history      every change to attendance, written by a trigger
-- Existing attendance is NOT converted or touched. Its vocabulary
-- ("Attended", "Makeup Completed", "Absent, Need Makeup") is understood as is.
--
-- What this adds
--   A session becomes a real event: type, description, times, location,
--   required or optional, capacity, status (draft / scheduled / completed /
--   cancelled), notes, and - for a makeup - which session it makes up.
--
--   A REQUIREMENT is separate from a session: "New Guide Orientation" with
--   several approved sessions, any of which completes it (or all of them, by
--   rule). Who it applies to is an audience: everyone, new guides, leadership,
--   evaluators, named cohorts (groups), or hand-picked people - always the same
--   canonical Tour Guides used everywhere else.
--
--   COMPLETION IS COMPUTED, not typed in twice. Attending an approved session
--   completes the requirement; a person who misses it shows as needing a
--   makeup; being on the roster of a future session shows as scheduled. An
--   administrator can override any of it (complete, waived, excused,
--   incomplete) with a reason, visibly, and return to automatic.
--
--   Speakers (people who need not have accounts), materials (friendly link
--   cards), templates (a training you run every semester), and one-step
--   copying of a semester's setup - never its attendance or history.
--
-- Rules enforced here whatever the front end sends
--   * administrators only for every change; every change is audited
--   * nothing is deleted: sessions are cancelled, requirements archived, and a
--     session that has attendance can never be removed
--   * a makeup session satisfies the same requirement as the original
--   * a Tour Guide can read only their OWN attendance and status
--   * the committee can see sessions and counts, never who missed what
-- ============================================================================
begin;

-- --------------------------------------------------------------------------
-- 1. Sessions become events.
-- --------------------------------------------------------------------------
alter table training_sessions add column if not exists description         text;
alter table training_sessions add column if not exists training_type       text not null default 'General';
alter table training_sessions add column if not exists start_time          time;
alter table training_sessions add column if not exists end_time            time;
alter table training_sessions add column if not exists location            text;
alter table training_sessions add column if not exists required            boolean not null default true;
alter table training_sessions add column if not exists capacity            int check (capacity is null or capacity >= 0);
alter table training_sessions add column if not exists status              text not null default 'scheduled';
alter table training_sessions add column if not exists notes               text;
alter table training_sessions add column if not exists makeup_eligible     boolean not null default true;
alter table training_sessions add column if not exists makeup_for          uuid references training_sessions(id) on delete set null;
alter table training_sessions add column if not exists attendance_submitted_at timestamptz;
do $$ begin
  alter table training_sessions add constraint training_sessions_status_ok check (status in ('draft', 'scheduled', 'completed', 'cancelled'));
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- 2. Requirements, their approved sessions, and cohorts.
-- --------------------------------------------------------------------------
create table if not exists training_requirements (
  id          uuid primary key default gen_random_uuid(),
  term_id     text not null references terms(id) on delete cascade,
  name        text not null,
  description text,
  deadline    date,
  rule        text not null default 'any' check (rule in ('any', 'all')),   -- any approved session, or every one
  audience    jsonb not null default '{"all": true}'::jsonb,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (term_id, name)
);

create table if not exists requirement_sessions (
  requirement_id uuid not null references training_requirements(id) on delete cascade,
  session_id     uuid not null references training_sessions(id) on delete cascade,
  primary key (requirement_id, session_id)
);

create table if not exists training_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
create table if not exists training_group_members (
  group_id uuid not null references training_groups(id) on delete cascade,
  guide_id uuid not null references guides(id) on delete cascade,
  primary key (group_id, guide_id)
);

-- A hand-set outcome for one person on one requirement. Absent = automatic.
create table if not exists training_overrides (
  requirement_id uuid not null references training_requirements(id) on delete cascade,
  guide_id       uuid not null references guides(id) on delete cascade,
  status         text not null check (status in ('complete', 'waived', 'excused', 'incomplete')),
  reason         text,
  set_by         uuid,
  set_at         timestamptz not null default now(),
  primary key (requirement_id, guide_id)
);

-- --------------------------------------------------------------------------
-- 3. Speakers, materials, templates.
-- --------------------------------------------------------------------------
create table if not exists training_speakers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  affiliation text,
  member_id  uuid references members(id) on delete set null,   -- only if they also sign in
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists session_speakers (
  session_id   uuid not null references training_sessions(id) on delete cascade,
  speaker_id   uuid not null references training_speakers(id) on delete cascade,
  speaker_name text not null,                 -- copied so guides can see who without seeing contact details
  role         text not null default 'Speaker',
  primary key (session_id, speaker_id)
);

create table if not exists training_materials (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  kind           text not null default 'webpage' check (kind in ('doc', 'slides', 'pdf', 'video', 'webpage', 'internal', 'other')),
  url            text not null check (url ~ '^https://[^[:space:]]+$' and length(url) <= 1000),
  description    text,
  session_id     uuid references training_sessions(id) on delete cascade,
  requirement_id uuid references training_requirements(id) on delete cascade,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists training_materials_session on training_materials (session_id);
create index if not exists training_materials_req on training_materials (requirement_id);

create table if not exists training_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  description      text,
  training_type    text not null default 'General',
  duration_minutes int check (duration_minutes is null or duration_minutes between 5 and 600),
  default_location text,
  required         boolean not null default true,
  audience         jsonb not null default '{"all": true}'::jsonb,
  materials        jsonb not null default '[]'::jsonb,          -- [{title, kind, url, description}]
  speaker_role     text,
  completion_rule  text not null default 'any' check (completion_rule in ('any', 'all')),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 4. Who may read what.
-- --------------------------------------------------------------------------
alter table training_requirements  enable row level security;
alter table requirement_sessions   enable row level security;
alter table training_groups        enable row level security;
alter table training_group_members enable row level security;
alter table training_overrides     enable row level security;
alter table training_speakers      enable row level security;
alter table session_speakers       enable row level security;
alter table training_materials     enable row level security;
alter table training_templates     enable row level security;

drop policy if exists read_requirements on training_requirements;
create policy read_requirements on training_requirements for select using (is_member());
drop policy if exists read_req_sessions on requirement_sessions;
create policy read_req_sessions on requirement_sessions for select using (is_member());
drop policy if exists read_groups on training_groups;
create policy read_groups on training_groups for select using (hub_is_admin());
drop policy if exists read_group_members on training_group_members;
create policy read_group_members on training_group_members for select using (hub_is_admin());
drop policy if exists read_overrides_t on training_overrides;
create policy read_overrides_t on training_overrides for select using (
  hub_is_admin() or exists (select 1 from guides g where g.id = guide_id and g.member_id = auth.uid()));
drop policy if exists read_speakers on training_speakers;
create policy read_speakers on training_speakers for select using (hub_is_admin());           -- contact details: administrators only
drop policy if exists read_session_speakers on session_speakers;
create policy read_session_speakers on session_speakers for select using (is_member());       -- names only
drop policy if exists read_materials on training_materials;
create policy read_materials on training_materials for select using (is_member());
drop policy if exists read_templates on training_templates;
create policy read_templates on training_templates for select using (hub_is_admin());

-- Sessions (dates, places) are not private; attendance still is. A signed-in
-- member can read sessions that are not drafts, and a Tour Guide linked to a
-- member account can read their own attendance rows - nobody else's.
drop policy if exists read_training_sessions_members on training_sessions;
create policy read_training_sessions_members on training_sessions for select using (is_member() and status <> 'draft');
drop policy if exists read_own_attendance on training_attendance;
create policy read_own_attendance on training_attendance for select using (
  exists (select 1 from guides g where g.id = training_attendance.guide_id and g.member_id = auth.uid()));

-- --------------------------------------------------------------------------
-- 5. Reading attendance statuses, and working out completion.
-- --------------------------------------------------------------------------
-- The existing vocabulary plus the new ones, reduced to four meanings.
create or replace function hub_att_class(p_actual text) returns text
  language sql immutable as $$
  select case
    when p_actual is null or trim(p_actual) = '' then 'pending'
    when p_actual ~* '^(attended|present|late|makeup complete)' then 'present'
    when p_actual ~* '^excused' then 'excused'
    when p_actual ~* '(absent|missed|no.?show|makeup needed)' then 'absent'
    else 'pending' end
$$;

-- Everyone a requirement applies to: the audience resolved to real guides.
create or replace function hub_training_audience(p_req uuid) returns setof uuid
  language plpgsql stable security definer set search_path = public as $$
declare r training_requirements%rowtype; a jsonb;
begin
  select * into r from training_requirements where id = p_req;
  if not found then return; end if;
  a := coalesce(r.audience, '{}'::jsonb);
  return query
    select g.id from guides g
     where g.active
       and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = r.term_id), true)
       and ( coalesce((a->>'all')::boolean, false)
          or (coalesce((a->>'new')::boolean, false) and not exists (select 1 from guide_terms gt where gt.guide_id = g.id and gt.term_id <> r.term_id))
          or (coalesce((a->>'leadership')::boolean, false) and g.is_leadership)
          or (coalesce((a->>'evaluators')::boolean, false) and g.evaluator_eligible)
          or exists (select 1 from jsonb_array_elements_text(coalesce(a->'guide_ids', '[]'::jsonb)) x where x::uuid = g.id)
          or exists (select 1 from training_group_members m join jsonb_array_elements_text(coalesce(a->'group_ids', '[]'::jsonb)) x on x::uuid = m.group_id where m.guide_id = g.id));
end $$;

-- One requirement, every person it applies to, and where each stands.
--   complete / waived / excused   done (waived and excused only by hand)
--   scheduled                     on the roster of a coming approved session
--   makeup_needed                 missed an approved session, nothing coming
--   incomplete                    not done yet, nothing missed
create or replace function hub_requirement_rows(p_req uuid)
  returns table (guide_id uuid, state text, via text, session_id uuid, done_on date, next_session uuid, next_on date, missed_session uuid, reason text)
  language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare r training_requirements%rowtype; g uuid; o training_overrides%rowtype; v_total int; v_done int;
        v_sess uuid; v_on date; v_next uuid; v_next_on date; v_missed uuid; v_state text; v_via text;
begin
  select * into r from training_requirements where id = p_req;
  if not found then return; end if;
  select count(*) into v_total from requirement_sessions rs join training_sessions s on s.id = rs.session_id
   where rs.requirement_id = p_req and s.status in ('scheduled', 'completed');
  for g in select x from hub_training_audience(p_req) x loop
    select * into o from training_overrides where requirement_id = p_req and guide_id = g;
    v_sess := null; v_on := null; v_next := null; v_next_on := null; v_missed := null; v_via := 'automatic';

    -- the best present attendance (earliest), and how many sessions they attended
    select a.session_id, s.held_on into v_sess, v_on
      from training_attendance a join training_sessions s on s.id = a.session_id join requirement_sessions rs on rs.session_id = s.id and rs.requirement_id = p_req
     where a.guide_id = g and s.status in ('scheduled', 'completed') and hub_att_class(a.actual) = 'present'
     order by s.held_on nulls last limit 1;
    select count(distinct a.session_id) into v_done
      from training_attendance a join training_sessions s on s.id = a.session_id join requirement_sessions rs on rs.session_id = s.id and rs.requirement_id = p_req
     where a.guide_id = g and s.status in ('scheduled', 'completed') and hub_att_class(a.actual) = 'present';

    select a.session_id, s.held_on into v_next, v_next_on
      from training_attendance a join training_sessions s on s.id = a.session_id join requirement_sessions rs on rs.session_id = s.id and rs.requirement_id = p_req
     where a.guide_id = g and s.status = 'scheduled' and s.held_on >= current_date and hub_att_class(a.actual) = 'pending'
     order by s.held_on limit 1;
    select a.session_id into v_missed
      from training_attendance a join training_sessions s on s.id = a.session_id join requirement_sessions rs on rs.session_id = s.id and rs.requirement_id = p_req
     where a.guide_id = g and s.status in ('scheduled', 'completed') and hub_att_class(a.actual) in ('absent', 'excused')
     order by s.held_on desc nulls last limit 1;

    if o.status in ('complete', 'waived', 'excused') then v_state := o.status; v_via := 'manual';
    elsif o.status = 'incomplete' then v_state := 'incomplete'; v_via := 'manual';
    elsif (r.rule = 'any' and v_done >= 1) or (r.rule = 'all' and v_total > 0 and v_done >= v_total) then v_state := 'complete';
    elsif v_next is not null then v_state := 'scheduled';
    elsif v_missed is not null then v_state := 'makeup_needed';
    else v_state := 'incomplete'; end if;

    return query select g, v_state, v_via, v_sess, v_on, v_next, v_next_on, v_missed, o.reason;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 6. Helpers shared by the admin functions.
-- --------------------------------------------------------------------------
create or replace function hub_session_title(p_id uuid) returns text
  language sql stable security definer set search_path = public as $$ select label from training_sessions where id = p_id $$;

-- Give every expected person a (blank) attendance row for a session, so the
-- room can simply be marked. Expected = the audiences of the requirements the
-- session counts toward; a session that counts toward none expects everyone.
create or replace function hub_seed_attendance(p_session uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; n int := 0; v_linked boolean;
begin
  select * into s from training_sessions where id = p_session;
  if not found then return 0; end if;
  select exists (select 1 from requirement_sessions where session_id = p_session) into v_linked;
  if s.makeup_for is not null and v_linked then return 0; end if;    -- a makeup is seeded with exactly who owes it
  insert into training_attendance (session_id, guide_id, person_name, expectation)
  select s.id, g.id, g.full_name, 'Attendance Expected'
    from guides g
   where g.active and coalesce((select gt.active from guide_terms gt where gt.guide_id = g.id and gt.term_id = s.term_id), true)
     and (not v_linked or g.id in (select hub_training_audience(rs.requirement_id) from requirement_sessions rs where rs.session_id = p_session))
  on conflict (session_id, person_name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- --------------------------------------------------------------------------
-- 7. SESSIONS: create, edit, status, duplicate, makeup.
-- --------------------------------------------------------------------------
create or replace function admin_save_training_session(p_id uuid, p_f jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; v_id uuid := p_id; k text; v_title text; v_term text; v_new boolean := p_id is null;
        v_start time; v_end time; v_status text; v_cap int; v_date date;
begin
  perform hub_require_admin();
  for k in select jsonb_object_keys(p_f) loop
    if k not in ('title', 'description', 'training_type', 'term_id', 'held_on', 'start_time', 'end_time', 'location', 'required', 'capacity', 'status', 'notes', 'makeup_eligible') then
      raise exception '"%" cannot be set here.', k;
    end if;
  end loop;
  if not v_new then select * into s from training_sessions where id = p_id; if not found then raise exception 'That session no longer exists.'; end if; end if;

  v_title := trim(coalesce(p_f->>'title', s.label, ''));
  if v_title = '' then raise exception 'A training session needs a title.'; end if;
  v_term := coalesce(nullif(p_f->>'term_id', ''), s.term_id, hub_current_term());
  if v_term is null or not exists (select 1 from terms where id = v_term) then raise exception 'Choose a semester for this session.'; end if;
  v_date := case when p_f ? 'held_on' then nullif(p_f->>'held_on', '')::date else s.held_on end;
  v_start := case when p_f ? 'start_time' then nullif(p_f->>'start_time', '')::time else s.start_time end;
  v_end   := case when p_f ? 'end_time' then nullif(p_f->>'end_time', '')::time else s.end_time end;
  if v_start is not null and v_end is not null and v_end <= v_start then raise exception 'The end time must be after the start time.'; end if;
  v_status := coalesce(nullif(p_f->>'status', ''), s.status, 'scheduled');
  if v_status not in ('draft', 'scheduled', 'completed', 'cancelled') then raise exception 'Unknown status "%".', v_status; end if;
  v_cap := case when p_f ? 'capacity' then nullif(p_f->>'capacity', '')::int else s.capacity end;
  if v_cap is not null and v_cap < 0 then raise exception 'Capacity cannot be negative.'; end if;
  if exists (select 1 from training_sessions x where x.term_id = v_term and lower(x.label) = lower(v_title) and x.id is distinct from v_id) then
    raise exception 'This semester already has a session called "%".', v_title;
  end if;

  if v_new then
    insert into training_sessions (term_id, label, held_on, sort_order, description, training_type, start_time, end_time, location, required, capacity, status, notes, makeup_eligible)
    values (v_term, v_title, v_date, (select coalesce(max(sort_order), -1) + 1 from training_sessions where term_id = v_term),
            nullif(trim(coalesce(p_f->>'description', '')), ''), coalesce(nullif(trim(coalesce(p_f->>'training_type', '')), ''), 'General'), v_start, v_end,
            nullif(trim(coalesce(p_f->>'location', '')), ''), coalesce((p_f->>'required')::boolean, true), v_cap, v_status,
            nullif(trim(coalesce(p_f->>'notes', '')), ''), coalesce((p_f->>'makeup_eligible')::boolean, true))
    returning id into v_id;
    perform hub_audit('training.session_created', 'training session', v_title, null, jsonb_build_object('date', v_date, 'term', v_term, 'status', v_status));
  else
    update training_sessions set term_id = v_term, label = v_title, held_on = v_date, start_time = v_start, end_time = v_end, capacity = v_cap, status = v_status,
      description = case when p_f ? 'description' then nullif(trim(coalesce(p_f->>'description', '')), '') else description end,
      training_type = case when p_f ? 'training_type' then coalesce(nullif(trim(coalesce(p_f->>'training_type', '')), ''), 'General') else training_type end,
      location = case when p_f ? 'location' then nullif(trim(coalesce(p_f->>'location', '')), '') else location end,
      required = case when p_f ? 'required' then (p_f->>'required')::boolean else required end,
      notes = case when p_f ? 'notes' then nullif(trim(coalesce(p_f->>'notes', '')), '') else notes end,
      makeup_eligible = case when p_f ? 'makeup_eligible' then (p_f->>'makeup_eligible')::boolean else makeup_eligible end
     where id = v_id;
    perform hub_audit('training.session_changed', 'training session', v_title,
      jsonb_build_object('title', s.label, 'date', s.held_on, 'location', s.location, 'status', s.status),
      jsonb_build_object('title', v_title, 'date', v_date, 'location', nullif(trim(coalesce(p_f->>'location', s.location, '')), ''), 'status', v_status));
  end if;
  return jsonb_build_object('id', v_id, 'created', v_new);
end $$;

create or replace function admin_set_session_status(p_id uuid, p_status text, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype;
begin
  perform hub_require_admin();
  if p_status not in ('draft', 'scheduled', 'completed', 'cancelled') then raise exception 'Unknown status.'; end if;
  select * into s from training_sessions where id = p_id;
  if not found then raise exception 'That session no longer exists.'; end if;
  update training_sessions set status = p_status where id = p_id;
  perform hub_audit('training.session_' || p_status, 'training session', s.label, jsonb_build_object('status', s.status), jsonb_build_object('status', p_status), p_reason);
  return jsonb_build_object('status', p_status);
end $$;

-- A session with no attendance recorded can be removed outright; one with any
-- cannot (cancel it instead).
create or replace function admin_delete_empty_session(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype;
begin
  perform hub_require_admin();
  select * into s from training_sessions where id = p_id;
  if not found then return jsonb_build_object('deleted', false); end if;
  if exists (select 1 from training_attendance a where a.session_id = p_id and hub_att_class(a.actual) <> 'pending') then
    raise exception 'This session has attendance recorded, so it cannot be deleted. Cancel it instead; its history is kept.';
  end if;
  delete from training_sessions where id = p_id;
  perform hub_audit('training.session_deleted', 'training session', s.label);
  return jsonb_build_object('deleted', true);
end $$;

create or replace function admin_duplicate_session(p_id uuid, p_date date default null, p_title text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; v_new uuid; v_title text; n int := 0;
begin
  perform hub_require_admin();
  select * into s from training_sessions where id = p_id;
  if not found then raise exception 'That session no longer exists.'; end if;
  v_title := coalesce(nullif(trim(coalesce(p_title, '')), ''), s.label || ' (copy)');
  if exists (select 1 from training_sessions x where x.term_id = s.term_id and lower(x.label) = lower(v_title)) then
    v_title := v_title || ' ' || to_char(now(), 'HH24MISS');
  end if;
  insert into training_sessions (term_id, label, held_on, sort_order, description, training_type, start_time, end_time, location, required, capacity, status, notes, makeup_eligible)
  values (s.term_id, v_title, coalesce(p_date, s.held_on), (select coalesce(max(sort_order), -1) + 1 from training_sessions where term_id = s.term_id),
          s.description, s.training_type, s.start_time, s.end_time, s.location, s.required, s.capacity, 'draft', s.notes, s.makeup_eligible)
  returning id into v_new;
  insert into session_speakers (session_id, speaker_id, speaker_name, role) select v_new, speaker_id, speaker_name, role from session_speakers where session_id = p_id;
  insert into training_materials (title, kind, url, description, session_id, sort_order) select title, kind, url, description, v_new, sort_order from training_materials where session_id = p_id;
  insert into requirement_sessions (requirement_id, session_id) select requirement_id, v_new from requirement_sessions where session_id = p_id;
  perform hub_audit('training.session_duplicated', 'training session', v_title, null, jsonb_build_object('from', s.label));
  return jsonb_build_object('id', v_new, 'title', v_title);
end $$;

-- A makeup counts toward the SAME requirements as the original, and starts with
-- exactly the people who still owe it (or the ones you name).
create or replace function admin_make_makeup(p_original uuid, p_date date, p_start time default null, p_end time default null,
                                             p_location text default null, p_guides uuid[] default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; v_new uuid; v_title text; v_guides uuid[]; n int := 0; q record;
begin
  perform hub_require_admin();
  select * into s from training_sessions where id = p_original;
  if not found then raise exception 'That session no longer exists.'; end if;
  if not s.makeup_eligible then raise exception 'This session is marked as not eligible for makeups.'; end if;
  if p_date is null then raise exception 'Choose a date for the makeup.'; end if;
  if p_start is not null and p_end is not null and p_end <= p_start then raise exception 'The end time must be after the start time.'; end if;

  if p_guides is null then
    select coalesce(array_agg(distinct a.guide_id), '{}') into v_guides
      from training_attendance a
     where a.session_id = p_original and a.guide_id is not null and hub_att_class(a.actual) in ('absent', 'excused')
       and not exists (select 1 from requirement_sessions rs where rs.session_id = p_original
                         and exists (select 1 from hub_requirement_rows(rs.requirement_id) r where r.guide_id = a.guide_id and r.state in ('complete', 'waived', 'excused', 'scheduled')));
  else v_guides := p_guides; end if;

  v_title := 'Makeup: ' || s.label || ' · ' || to_char(p_date, 'Mon FMDD');
  if exists (select 1 from training_sessions x where x.term_id = s.term_id and lower(x.label) = lower(v_title)) then v_title := v_title || ' (2)'; end if;
  insert into training_sessions (term_id, label, held_on, sort_order, description, training_type, start_time, end_time, location, required, status, makeup_for, makeup_eligible)
  values (s.term_id, v_title, p_date, (select coalesce(max(sort_order), -1) + 1 from training_sessions where term_id = s.term_id),
          s.description, s.training_type, coalesce(p_start, s.start_time), coalesce(p_end, s.end_time), coalesce(nullif(trim(coalesce(p_location, '')), ''), s.location), s.required, 'scheduled', p_original, false)
  returning id into v_new;
  insert into requirement_sessions (requirement_id, session_id) select requirement_id, v_new from requirement_sessions where session_id = p_original;
  insert into session_speakers (session_id, speaker_id, speaker_name, role) select v_new, speaker_id, speaker_name, role from session_speakers where session_id = p_original;
  insert into training_materials (title, kind, url, description, session_id, sort_order) select title, kind, url, description, v_new, sort_order from training_materials where session_id = p_original;
  insert into training_attendance (session_id, guide_id, person_name, expectation)
  select v_new, g.id, g.full_name, 'Makeup' from guides g where g.id = any (v_guides) on conflict (session_id, person_name) do nothing;
  get diagnostics n = row_count;
  perform hub_audit('training.makeup_created', 'training session', v_title, null, jsonb_build_object('for', s.label, 'people', n, 'date', p_date));
  return jsonb_build_object('id', v_new, 'title', v_title, 'assigned', n);
end $$;

-- --------------------------------------------------------------------------
-- 8. ATTENDANCE: fast, bulk, and automatically reflected in completion.
-- --------------------------------------------------------------------------
create or replace function admin_seed_attendance(p_session uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  if not exists (select 1 from training_sessions where id = p_session) then raise exception 'That session no longer exists.'; end if;
  return jsonb_build_object('added', hub_seed_attendance(p_session));
end $$;

-- Entries: [{guide_id, status}] where status is Attended, Late, Excused,
-- Absent, "Absent, Need Makeup", Makeup Completed, or null to clear.
create or replace function admin_set_attendance(p_session uuid, p_entries jsonb, p_submit boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; e jsonb; g guides%rowtype; v_status text; n int := 0; c jsonb := '{}'::jsonb; cls text;
begin
  perform hub_require_admin();
  select * into s from training_sessions where id = p_session;
  if not found then raise exception 'That session no longer exists.'; end if;
  if s.status = 'cancelled' then raise exception 'This session is cancelled. Re-open it before taking attendance.'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 600 then raise exception 'Send at most 600 attendance entries at a time.'; end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    select * into g from guides where id = (e->>'guide_id')::uuid;
    if not found then raise exception 'One of those people is not on the Tour Guide list.'; end if;
    v_status := nullif(trim(coalesce(e->>'status', '')), '');
    if v_status is not null and v_status not in ('Attended', 'Late', 'Excused', 'Absent', 'Absent, Need Makeup', 'Makeup Completed') then
      raise exception '"%" is not an attendance status.', v_status;
    end if;
    insert into training_attendance (session_id, guide_id, person_name, expectation, actual)
    values (p_session, g.id, g.full_name, 'Attendance Expected', v_status)
    on conflict (session_id, person_name) do update set actual = excluded.actual, guide_id = coalesce(training_attendance.guide_id, excluded.guide_id);
    n := n + 1;
    cls := hub_att_class(v_status); c := jsonb_set(c, array[cls], to_jsonb(coalesce((c->>cls)::int, 0) + 1));
  end loop;
  if p_submit then
    update training_sessions set attendance_submitted_at = now(), status = case when status in ('draft', 'scheduled') and held_on <= current_date then 'completed' else status end where id = p_session;
  end if;
  perform hub_audit(case when p_submit then 'training.attendance_submitted' else 'training.attendance_edited' end, 'training session', s.label, null, c);
  return jsonb_build_object('saved', n, 'counts', c, 'submitted', p_submit);
end $$;

create or replace function admin_mark_all(p_session uuid, p_status text default 'Attended', p_only_unmarked boolean default true) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; n int;
begin
  perform hub_require_admin();
  if p_status not in ('Attended', 'Late', 'Excused', 'Absent', 'Absent, Need Makeup') then raise exception 'Choose a valid status.'; end if;
  select * into s from training_sessions where id = p_session;
  if not found then raise exception 'That session no longer exists.'; end if;
  if s.status = 'cancelled' then raise exception 'This session is cancelled.'; end if;
  perform hub_seed_attendance(p_session);
  update training_attendance set actual = p_status
   where session_id = p_session and (not p_only_unmarked or hub_att_class(actual) = 'pending');
  get diagnostics n = row_count;
  perform hub_audit('training.attendance_bulk', 'training session', s.label, null, jsonb_build_object('status', p_status, 'people', n));
  return jsonb_build_object('marked', n);
end $$;

-- --------------------------------------------------------------------------
-- 9. REQUIREMENTS and COMPLETION.
-- --------------------------------------------------------------------------
create or replace function admin_save_requirement(p_id uuid, p_f jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype; v_id uuid := p_id; k text; v_name text; v_term text; v_aud jsonb; v_rule text;
begin
  perform hub_require_admin();
  for k in select jsonb_object_keys(p_f) loop
    if k not in ('name', 'description', 'term_id', 'deadline', 'rule', 'audience', 'active') then raise exception '"%" cannot be set here.', k; end if;
  end loop;
  if p_id is not null then select * into r from training_requirements where id = p_id; if not found then raise exception 'That requirement no longer exists.'; end if; end if;
  v_name := trim(coalesce(p_f->>'name', r.name, ''));
  if v_name = '' then raise exception 'A requirement needs a name.'; end if;
  v_term := coalesce(nullif(p_f->>'term_id', ''), r.term_id, hub_current_term());
  if v_term is null or not exists (select 1 from terms where id = v_term) then raise exception 'Choose a semester.'; end if;
  v_rule := coalesce(nullif(p_f->>'rule', ''), r.rule, 'any');
  if v_rule not in ('any', 'all') then raise exception 'Unknown completion rule.'; end if;
  v_aud := coalesce(p_f->'audience', r.audience, '{"all": true}'::jsonb);
  for k in select jsonb_object_keys(v_aud) loop
    if k not in ('all', 'new', 'leadership', 'evaluators', 'group_ids', 'guide_ids') then raise exception 'Unknown audience setting "%".', k; end if;
  end loop;
  if exists (select 1 from training_requirements x where x.term_id = v_term and lower(x.name) = lower(v_name) and x.id is distinct from p_id) then
    raise exception 'This semester already has a requirement called "%".', v_name;
  end if;
  if p_id is null then
    insert into training_requirements (term_id, name, description, deadline, rule, audience, sort_order)
    values (v_term, v_name, nullif(trim(coalesce(p_f->>'description', '')), ''), nullif(p_f->>'deadline', '')::date, v_rule, v_aud,
            (select coalesce(max(sort_order), -1) + 1 from training_requirements where term_id = v_term)) returning id into v_id;
    perform hub_audit('training.requirement_created', 'requirement', v_name, null, jsonb_build_object('term', v_term, 'audience', v_aud));
  else
    update training_requirements set name = v_name, term_id = v_term, rule = v_rule, audience = v_aud,
      description = case when p_f ? 'description' then nullif(trim(coalesce(p_f->>'description', '')), '') else description end,
      deadline = case when p_f ? 'deadline' then nullif(p_f->>'deadline', '')::date else deadline end,
      active = case when p_f ? 'active' then (p_f->>'active')::boolean else active end
     where id = p_id;
    perform hub_audit('training.requirement_changed', 'requirement', v_name, jsonb_build_object('name', r.name, 'deadline', r.deadline, 'audience', r.audience),
                      jsonb_build_object('name', v_name, 'deadline', coalesce(nullif(p_f->>'deadline', '')::date, r.deadline), 'audience', v_aud));
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_set_requirement_sessions(p_req uuid, p_sessions uuid[]) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype; i uuid; n int := 0;
begin
  perform hub_require_admin();
  select * into r from training_requirements where id = p_req;
  if not found then raise exception 'That requirement no longer exists.'; end if;
  if exists (select 1 from unnest(coalesce(p_sessions, '{}')) x where not exists (select 1 from training_sessions s where s.id = x and s.term_id = r.term_id)) then
    raise exception 'Every approved session must belong to the same semester as the requirement.';
  end if;
  delete from requirement_sessions where requirement_id = p_req and session_id <> all (coalesce(p_sessions, '{}'));
  foreach i in array coalesce(p_sessions, '{}') loop
    insert into requirement_sessions (requirement_id, session_id) values (p_req, i) on conflict do nothing;
    n := n + hub_seed_attendance(i);
  end loop;
  perform hub_audit('training.requirement_sessions', 'requirement', r.name, null, jsonb_build_object('sessions', coalesce(array_length(p_sessions, 1), 0)));
  return jsonb_build_object('sessions', coalesce(array_length(p_sessions, 1), 0), 'people_added', n);
end $$;

create or replace function admin_archive_requirement(p_id uuid, p_archived boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype;
begin
  perform hub_require_admin();
  select * into r from training_requirements where id = p_id;
  if not found then raise exception 'That requirement no longer exists.'; end if;
  update training_requirements set active = not p_archived where id = p_id;
  perform hub_audit(case when p_archived then 'training.requirement_archived' else 'training.requirement_restored' end, 'requirement', r.name);
end $$;

-- Existing semesters have sessions but no requirements. This gives each one its
-- own requirement ("attend this session"), which matches how they were run.
create or replace function admin_requirements_from_sessions(p_term text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s record; v_id uuid; n int := 0;
begin
  perform hub_require_admin();
  if not exists (select 1 from terms where id = p_term) then raise exception 'There is no such semester.'; end if;
  for s in select * from training_sessions t where t.term_id = p_term and t.status in ('scheduled', 'completed') and t.makeup_for is null
             and not exists (select 1 from requirement_sessions rs where rs.session_id = t.id) order by t.held_on nulls last, t.sort_order loop
    select id into v_id from training_requirements where term_id = p_term and lower(name) = lower(s.label);
    if v_id is null then
      insert into training_requirements (term_id, name, deadline, rule, audience, sort_order)
      values (p_term, s.label, s.held_on, 'any', '{"all": true}', (select coalesce(max(sort_order), -1) + 1 from training_requirements where term_id = p_term)) returning id into v_id;
    end if;
    insert into requirement_sessions (requirement_id, session_id) values (v_id, s.id) on conflict do nothing;
    n := n + 1;
  end loop;
  perform hub_audit('training.requirements_from_sessions', 'semester', p_term, null, jsonb_build_object('created', n));
  return jsonb_build_object('created', n);
end $$;

create or replace function admin_add_requirement_people(p_req uuid, p_guides uuid[], p_remove boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype; cur jsonb; v_ids uuid[];
begin
  perform hub_require_admin();
  select * into r from training_requirements where id = p_req;
  if not found then raise exception 'That requirement no longer exists.'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(r.audience->'guide_ids', '[]')) x;
  v_ids := case when p_remove then array(select u from unnest(v_ids) u where u <> all (p_guides)) else array(select distinct u from unnest(v_ids || p_guides) u) end;
  update training_requirements set audience = jsonb_set(audience, '{guide_ids}', to_jsonb(v_ids)) where id = p_req;
  perform hub_audit('training.requirement_assigned', 'requirement', r.name, null, jsonb_build_object(case when p_remove then 'removed' else 'added' end, coalesce(array_length(p_guides, 1), 0)));
  return jsonb_build_object('people', coalesce(array_length(v_ids, 1), 0));
end $$;

-- Complete / waived / excused / incomplete by hand, with a reason; null returns
-- to automatic. Only people the requirement actually applies to.
create or replace function admin_set_completion(p_req uuid, p_guides uuid[], p_status text, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype; n int := 0; i uuid; g guides%rowtype;
begin
  perform hub_require_admin();
  select * into r from training_requirements where id = p_req;
  if not found then raise exception 'That requirement no longer exists.'; end if;
  if p_status is not null and p_status not in ('complete', 'waived', 'excused', 'incomplete') then raise exception 'Choose complete, waived, excused or incomplete.'; end if;
  foreach i in array p_guides loop
    if i not in (select hub_training_audience(p_req)) then raise exception 'That person is not covered by "%".', r.name; end if;
    select * into g from guides where id = i;
    if p_status is null then delete from training_overrides where requirement_id = p_req and guide_id = i;
    else insert into training_overrides (requirement_id, guide_id, status, reason, set_by) values (p_req, i, p_status, nullif(left(trim(coalesce(p_reason, '')), 300), ''), auth.uid())
         on conflict (requirement_id, guide_id) do update set status = excluded.status, reason = excluded.reason, set_by = auth.uid(), set_at = now(); end if;
    perform hub_audit(case when p_status is null then 'training.completion_auto' else 'training.completion_' || p_status end, 'guide', g.full_name,
                      null, jsonb_build_object('requirement', r.name, 'status', coalesce(p_status, 'automatic')), p_reason);
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $$;

-- --------------------------------------------------------------------------
-- 10. Groups, speakers, materials, templates.
-- --------------------------------------------------------------------------
create or replace function admin_save_training_group(p_id uuid, p_name text, p_description text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v uuid := p_id;
begin
  perform hub_require_admin();
  if trim(coalesce(p_name, '')) = '' then raise exception 'A group needs a name.'; end if;
  if exists (select 1 from training_groups where lower(name) = lower(trim(p_name)) and id is distinct from p_id) then raise exception 'There is already a group with that name.'; end if;
  if v is null then insert into training_groups (name, description) values (trim(p_name), nullif(trim(coalesce(p_description, '')), '')) returning id into v;
  else update training_groups set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), '') where id = v; end if;
  perform hub_audit('training.group_saved', 'group', trim(p_name));
  return v;
end $$;

create or replace function admin_set_group_members(p_group uuid, p_guides uuid[], p_mode text default 'set') returns jsonb
  language plpgsql security definer set search_path = public as $$
declare gr training_groups%rowtype;
begin
  perform hub_require_admin();
  select * into gr from training_groups where id = p_group;
  if not found then raise exception 'That group no longer exists.'; end if;
  if p_mode not in ('set', 'add', 'remove') then raise exception 'Unknown mode.'; end if;
  if p_mode = 'set' then delete from training_group_members where group_id = p_group and guide_id <> all (coalesce(p_guides, '{}')); end if;
  if p_mode = 'remove' then delete from training_group_members where group_id = p_group and guide_id = any (coalesce(p_guides, '{}'));
  else insert into training_group_members (group_id, guide_id) select p_group, g.id from guides g where g.id = any (coalesce(p_guides, '{}')) on conflict do nothing; end if;
  perform hub_audit('training.group_members', 'group', gr.name, null, jsonb_build_object('mode', p_mode, 'people', coalesce(array_length(p_guides, 1), 0)));
  return jsonb_build_object('members', (select count(*) from training_group_members where group_id = p_group));
end $$;

create or replace function admin_save_speaker(p_id uuid, p_name text, p_email text, p_phone text, p_affiliation text, p_notes text default null, p_member uuid default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v uuid := p_id;
begin
  perform hub_require_admin();
  if trim(coalesce(p_name, '')) = '' then raise exception 'A speaker needs a name.'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% is not an email address.', p_email; end if;
  if v is null then insert into training_speakers (name, email, phone, affiliation, notes, member_id) values (trim(p_name), nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_affiliation, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), p_member) returning id into v;
  else update training_speakers set name = trim(p_name), email = nullif(lower(trim(coalesce(p_email, ''))), ''), phone = nullif(trim(coalesce(p_phone, '')), ''), affiliation = nullif(trim(coalesce(p_affiliation, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''), member_id = p_member where id = v;
       update session_speakers set speaker_name = trim(p_name) where speaker_id = v; end if;
  perform hub_audit('training.speaker_saved', 'speaker', trim(p_name));
  return v;
end $$;

create or replace function admin_set_session_speakers(p_session uuid, p_speakers jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare s training_sessions%rowtype; e jsonb; sp training_speakers%rowtype;
begin
  perform hub_require_admin();
  select * into s from training_sessions where id = p_session;
  if not found then raise exception 'That session no longer exists.'; end if;
  delete from session_speakers where session_id = p_session;
  for e in select * from jsonb_array_elements(coalesce(p_speakers, '[]')) loop
    select * into sp from training_speakers where id = (e->>'speaker_id')::uuid;
    if not found then raise exception 'One of those speakers no longer exists.'; end if;
    insert into session_speakers (session_id, speaker_id, speaker_name, role) values (p_session, sp.id, sp.name, coalesce(nullif(trim(coalesce(e->>'role', '')), ''), 'Speaker'));
  end loop;
  perform hub_audit('training.speaker_changed', 'training session', s.label, null, jsonb_build_object('speakers', jsonb_array_length(coalesce(p_speakers, '[]'))));
  return jsonb_build_object('speakers', jsonb_array_length(coalesce(p_speakers, '[]')));
end $$;

create or replace function admin_save_material(p_id uuid, p_title text, p_kind text, p_url text, p_description text, p_session uuid default null, p_requirement uuid default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v uuid := p_id;
begin
  perform hub_require_admin();
  if trim(coalesce(p_title, '')) = '' then raise exception 'A resource needs a title.'; end if;
  if trim(coalesce(p_url, '')) !~ '^https://[^[:space:]]+$' then raise exception 'The link must start with https:// and contain no spaces.'; end if;
  if p_session is null and p_requirement is null and p_id is null then raise exception 'Attach the resource to a session or a requirement.'; end if;
  if v is null then insert into training_materials (title, kind, url, description, session_id, requirement_id) values (trim(p_title), coalesce(nullif(p_kind, ''), 'webpage'), trim(p_url), nullif(trim(coalesce(p_description, '')), ''), p_session, p_requirement) returning id into v;
  else update training_materials set title = trim(p_title), kind = coalesce(nullif(p_kind, ''), kind), url = trim(p_url), description = nullif(trim(coalesce(p_description, '')), '') where id = v; end if;
  perform hub_audit('training.material_saved', 'material', trim(p_title));
  return v;
end $$;

create or replace function admin_delete_material(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare m training_materials%rowtype;
begin
  perform hub_require_admin();
  select * into m from training_materials where id = p_id;
  if found then delete from training_materials where id = p_id; perform hub_audit('training.material_removed', 'material', m.title); end if;
end $$;

create or replace function admin_save_training_template(p_id uuid, p_f jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v uuid := p_id; k text; m jsonb;
begin
  perform hub_require_admin();
  for k in select jsonb_object_keys(p_f) loop
    if k not in ('name', 'description', 'training_type', 'duration_minutes', 'default_location', 'required', 'audience', 'materials', 'speaker_role', 'completion_rule', 'active') then raise exception '"%" cannot be set here.', k; end if;
  end loop;
  if trim(coalesce(p_f->>'name', '')) = '' then raise exception 'A template needs a name.'; end if;
  if jsonb_typeof(coalesce(p_f->'materials', '[]')) <> 'array' then raise exception 'Materials must be a list.'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_f->'materials', '[]')) loop
    if coalesce(m->>'url', '') !~ '^https://[^[:space:]]+$' or trim(coalesce(m->>'title', '')) = '' then raise exception 'Every resource needs a title and an https:// link.'; end if;
  end loop;
  if exists (select 1 from training_templates where lower(name) = lower(trim(p_f->>'name')) and id is distinct from p_id) then raise exception 'There is already a template with that name.'; end if;
  if v is null then
    insert into training_templates (name, description, training_type, duration_minutes, default_location, required, audience, materials, speaker_role, completion_rule)
    values (trim(p_f->>'name'), nullif(trim(coalesce(p_f->>'description', '')), ''), coalesce(nullif(p_f->>'training_type', ''), 'General'), nullif(p_f->>'duration_minutes', '')::int,
            nullif(trim(coalesce(p_f->>'default_location', '')), ''), coalesce((p_f->>'required')::boolean, true), coalesce(p_f->'audience', '{"all": true}'), coalesce(p_f->'materials', '[]'),
            nullif(trim(coalesce(p_f->>'speaker_role', '')), ''), coalesce(nullif(p_f->>'completion_rule', ''), 'any')) returning id into v;
  else
    update training_templates set name = trim(p_f->>'name'), description = nullif(trim(coalesce(p_f->>'description', '')), ''), training_type = coalesce(nullif(p_f->>'training_type', ''), training_type),
      duration_minutes = nullif(p_f->>'duration_minutes', '')::int, default_location = nullif(trim(coalesce(p_f->>'default_location', '')), ''),
      required = coalesce((p_f->>'required')::boolean, required), audience = coalesce(p_f->'audience', audience), materials = coalesce(p_f->'materials', materials),
      speaker_role = nullif(trim(coalesce(p_f->>'speaker_role', '')), ''), completion_rule = coalesce(nullif(p_f->>'completion_rule', ''), completion_rule), active = coalesce((p_f->>'active')::boolean, active) where id = v;
  end if;
  perform hub_audit('training.template_saved', 'template', trim(p_f->>'name'));
  return v;
end $$;

-- A session (and optionally a requirement) from a template, in one step.
create or replace function admin_create_from_template(p_template uuid, p_term text, p_date date, p_start time default null, p_location text default null,
                                                       p_requirement uuid default null, p_deadline date default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare t training_templates%rowtype; v_sess uuid; v_req uuid := p_requirement; m jsonb; v_end time; v_res jsonb;
begin
  perform hub_require_admin();
  select * into t from training_templates where id = p_template;
  if not found then raise exception 'That template no longer exists.'; end if;
  if v_req is null and p_deadline is not null then
    v_res := admin_save_requirement(null, jsonb_build_object('name', t.name, 'term_id', p_term, 'description', t.description, 'deadline', p_deadline, 'rule', t.completion_rule, 'audience', t.audience));
    v_req := (v_res->>'id')::uuid;
  end if;
  v_end := case when p_start is not null and t.duration_minutes is not null then p_start + make_interval(mins => t.duration_minutes) else null end;
  v_res := admin_save_training_session(null, jsonb_strip_nulls(jsonb_build_object('title', t.name || case when p_date is not null then ' · ' || to_char(p_date, 'Mon FMDD') else '' end,
             'term_id', p_term, 'held_on', p_date, 'start_time', p_start, 'end_time', v_end, 'location', coalesce(p_location, t.default_location),
             'description', t.description, 'training_type', t.training_type, 'required', t.required)));
  v_sess := (v_res->>'id')::uuid;
  for m in select * from jsonb_array_elements(t.materials) loop
    insert into training_materials (title, kind, url, description, session_id) values (m->>'title', coalesce(nullif(m->>'kind', ''), 'webpage'), m->>'url', nullif(m->>'description', ''), v_sess);
  end loop;
  if v_req is not null then perform admin_set_requirement_sessions(v_req, array(select session_id from requirement_sessions where requirement_id = v_req) || v_sess); end if;
  return jsonb_build_object('session_id', v_sess, 'requirement_id', v_req);
end $$;

-- --------------------------------------------------------------------------
-- 11. COPY a semester's training setup forward (never attendance or history).
-- --------------------------------------------------------------------------
create or replace function hub_copy_training(p_from text, p_to text, p_opts jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r training_requirements%rowtype; v_new uuid; v_shift int := coalesce((p_opts->>'shift_days')::int, 0); n_req int := 0; n_ses int := 0; n_mat int := 0;
        ids uuid[]; s training_sessions%rowtype; v_s uuid; v_map jsonb := '{}'::jsonb; v_aud jsonb; v_title text;
begin
  if p_from = p_to then raise exception 'Choose two different semesters.'; end if;
  if not exists (select 1 from terms where id = p_from) or not exists (select 1 from terms where id = p_to) then raise exception 'Both semesters must exist.'; end if;
  ids := array(select x::uuid from jsonb_array_elements_text(coalesce(p_opts->'requirement_ids', '[]')) x);
  for r in select * from training_requirements where term_id = p_from and active and (cardinality(ids) = 0 or id = any (ids)) order by sort_order loop
    if exists (select 1 from training_requirements where term_id = p_to and lower(name) = lower(r.name)) then continue; end if;
    v_aud := r.audience - 'guide_ids';                                 -- rules carry forward; hand-picked people do not
    insert into training_requirements (term_id, name, description, deadline, rule, audience, sort_order)
    values (p_to, r.name, r.description, r.deadline + v_shift, r.rule, v_aud, (select coalesce(max(sort_order), -1) + 1 from training_requirements where term_id = p_to)) returning id into v_new;
    n_req := n_req + 1;
    if coalesce((p_opts->>'materials')::boolean, true) then
      insert into training_materials (title, kind, url, description, requirement_id, sort_order) select title, kind, url, description, v_new, sort_order from training_materials where requirement_id = r.id;
      n_mat := n_mat + (select count(*) from training_materials where requirement_id = r.id);
    end if;
    if coalesce((p_opts->>'sessions')::boolean, false) then
      for s in select ts.* from training_sessions ts join requirement_sessions rs on rs.session_id = ts.id where rs.requirement_id = r.id and ts.makeup_for is null and ts.status <> 'cancelled' loop
        v_title := s.label;
        if exists (select 1 from training_sessions where term_id = p_to and lower(label) = lower(v_title)) then v_title := v_title || ' (' || p_to || ')'; end if;
        if v_map ? s.id::text then v_s := (v_map->>s.id::text)::uuid;
        else
          insert into training_sessions (term_id, label, held_on, sort_order, description, training_type, start_time, end_time, location, required, capacity, status, notes, makeup_eligible)
          values (p_to, v_title, s.held_on + v_shift, (select coalesce(max(sort_order), -1) + 1 from training_sessions where term_id = p_to), s.description, s.training_type, s.start_time, s.end_time, s.location, s.required, s.capacity, 'draft', s.notes, s.makeup_eligible)
          returning id into v_s;
          v_map := v_map || jsonb_build_object(s.id::text, v_s); n_ses := n_ses + 1;
          insert into session_speakers (session_id, speaker_id, speaker_name, role) select v_s, speaker_id, speaker_name, role from session_speakers where session_id = s.id;
          if coalesce((p_opts->>'materials')::boolean, true) then
            insert into training_materials (title, kind, url, description, session_id, sort_order) select title, kind, url, description, v_s, sort_order from training_materials where session_id = s.id;
          end if;
        end if;
        insert into requirement_sessions (requirement_id, session_id) values (v_new, v_s) on conflict do nothing;
      end loop;
    end if;
  end loop;
  perform hub_audit('training.setup_copied', 'semester', p_to, jsonb_build_object('from', p_from), jsonb_build_object('requirements', n_req, 'sessions', n_ses, 'materials', n_mat));
  return jsonb_build_object('requirements', n_req, 'sessions', n_ses, 'materials', n_mat, 'from', p_from, 'to', p_to);
end $$;

create or replace function admin_copy_training_setup(p_from text, p_to text, p_opts jsonb default '{}'::jsonb, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v jsonb; v_detail text;
begin
  perform hub_require_admin();
  if p_apply then return hub_copy_training(p_from, p_to, p_opts) || jsonb_build_object('dry_run', false); end if;
  begin
    v := hub_copy_training(p_from, p_to, p_opts);
    raise exception using errcode = 'D0003', message = 'dry run', detail = v::text;
  exception when sqlstate 'D0003' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb || jsonb_build_object('dry_run', true);
  end;
end $$;

-- --------------------------------------------------------------------------
-- 12. REPORTS: the overview, the matrix, and a Tour Guide's own view.
-- --------------------------------------------------------------------------
-- Counts and sessions only - no names - so the committee can see how training
-- is going without seeing who missed what. Administrators also get what needs doing.
create or replace function training_overview(p_term text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := coalesce(p_term, hub_current_term()); r record; reqs jsonb := '[]'::jsonb; ups jsonb; att jsonb := '[]'::jsonb;
        st record; c record; v_admin boolean := hub_is_admin();
begin
  if auth.uid() is null or not (v_admin or in_training()) then raise exception 'Only the training team can see this.'; end if;
  for r in select * from training_requirements where term_id = v_term and active order by sort_order loop
    select count(*) filter (where state = 'complete') complete, count(*) filter (where state = 'waived') waived, count(*) filter (where state = 'excused') excused,
           count(*) filter (where state = 'scheduled') scheduled, count(*) filter (where state = 'makeup_needed') makeup, count(*) filter (where state = 'incomplete') incomplete, count(*) total
      into c from hub_requirement_rows(r.id);
    reqs := reqs || jsonb_build_object('id', r.id, 'name', r.name, 'deadline', r.deadline, 'rule', r.rule, 'total', c.total, 'complete', c.complete, 'waived', c.waived,
              'excused', c.excused, 'scheduled', c.scheduled, 'makeup_needed', c.makeup, 'incomplete', c.incomplete,
              'sessions', (select count(*) from requirement_sessions rs join training_sessions s on s.id = rs.session_id where rs.requirement_id = r.id and s.status in ('scheduled', 'completed')));
  end loop;

  select coalesce(jsonb_agg(x order by x->>'held_on', x->>'start_time'), '[]') into ups from (
    select jsonb_build_object('id', s.id, 'title', s.label, 'held_on', s.held_on, 'start_time', s.start_time, 'end_time', s.end_time, 'location', s.location, 'type', s.training_type, 'required', s.required, 'status', s.status,
             'makeup', s.makeup_for is not null, 'speakers', (select coalesce(jsonb_agg(speaker_name), '[]') from session_speakers where session_id = s.id),
             'expected', (select count(*) from training_attendance a where a.session_id = s.id), 'materials', (select count(*) from training_materials m where m.session_id = s.id)) x
      from training_sessions s where s.term_id = v_term and s.status = 'scheduled' and s.held_on >= current_date and s.held_on <= current_date + 30) q;

  if v_admin then
    for st in select * from training_sessions s where s.term_id = v_term and s.status in ('scheduled', 'completed') loop
      if st.held_on < current_date and st.attendance_submitted_at is null and st.status <> 'cancelled' and exists (select 1 from training_attendance a where a.session_id = st.id) then
        att := att || jsonb_build_object('kind', 'attendance_missing', 'session_id', st.id, 'title', st.label, 'date', st.held_on);
      end if;
      if st.status = 'scheduled' and st.held_on between current_date and current_date + 7 then
        if coalesce(trim(st.location), '') = '' then att := att || jsonb_build_object('kind', 'no_location', 'session_id', st.id, 'title', st.label, 'date', st.held_on); end if;
        if st.required and not exists (select 1 from session_speakers where session_id = st.id) then att := att || jsonb_build_object('kind', 'no_speaker', 'session_id', st.id, 'title', st.label, 'date', st.held_on); end if;
      end if;
    end loop;
    for r in select * from training_requirements where term_id = v_term and active loop
      if not exists (select 1 from requirement_sessions rs join training_sessions s on s.id = rs.session_id where rs.requirement_id = r.id and s.status in ('scheduled', 'completed')) then
        att := att || jsonb_build_object('kind', 'no_sessions', 'requirement_id', r.id, 'title', r.name, 'date', r.deadline);
      end if;
    end loop;
  end if;
  return jsonb_build_object('term', v_term, 'requirements', reqs, 'upcoming', ups, 'attention', att);
end $$;

-- Who stands where on every requirement of a semester. Administrators only.
create or replace function admin_training_matrix(p_term text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := coalesce(p_term, hub_current_term()); r record; out jsonb := '[]'::jsonb;
begin
  perform hub_require_admin();
  for r in select * from training_requirements where term_id = v_term and active order by sort_order loop
    out := out || coalesce((select jsonb_agg(jsonb_build_object('requirement_id', r.id, 'guide_id', x.guide_id, 'state', x.state, 'via', x.via, 'session_id', x.session_id, 'done_on', x.done_on,
                              'next_session', x.next_session, 'next_on', x.next_on, 'missed_session', x.missed_session, 'reason', x.reason)) from hub_requirement_rows(r.id) x), '[]'::jsonb);
  end loop;
  return out;
end $$;

-- Attendance by session, for the reports tab.
create or replace function admin_training_report(p_term text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := coalesce(p_term, hub_current_term());
begin
  perform hub_require_admin();
  return jsonb_build_object('sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.label, 'held_on', s.held_on, 'status', s.status, 'required', s.required,
      'expected', c.total, 'present', c.present, 'excused', c.excused, 'absent', c.absent, 'pending', c.pending) order by s.held_on nulls last)
    from training_sessions s cross join lateral (select count(*) total, count(*) filter (where hub_att_class(a.actual) = 'present') present, count(*) filter (where hub_att_class(a.actual) = 'excused') excused,
        count(*) filter (where hub_att_class(a.actual) = 'absent') absent, count(*) filter (where hub_att_class(a.actual) = 'pending') pending from training_attendance a where a.session_id = s.id) c
    where s.term_id = v_term and s.status in ('scheduled', 'completed')), '[]'::jsonb));
end $$;

-- A Tour Guide's own training: only theirs, found through the account linked to them.
create or replace function my_training(p_term text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_term text := coalesce(p_term, hub_current_term()); g guides%rowtype; r record; x record; out jsonb := '[]'::jsonb; allowed jsonb;
begin
  if auth.uid() is null or not is_member() then raise exception 'Sign in to see your training.'; end if;
  select * into g from guides where member_id = auth.uid() and active;
  if not found then return jsonb_build_object('linked', false); end if;
  for r in select * from training_requirements where term_id = v_term and active order by sort_order loop
    select * into x from hub_requirement_rows(r.id) where guide_id = g.id;
    if not found then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.label, 'held_on', s.held_on, 'start_time', s.start_time, 'location', s.location, 'makeup', s.makeup_for is not null) order by s.held_on), '[]')
      into allowed from requirement_sessions rs join training_sessions s on s.id = rs.session_id where rs.requirement_id = r.id and s.status = 'scheduled' and s.held_on >= current_date;
    out := out || jsonb_build_object('requirement_id', r.id, 'name', r.name, 'description', r.description, 'deadline', r.deadline, 'state', x.state, 'via', x.via, 'done_on', x.done_on, 'next_on', x.next_on,
              'upcoming', allowed, 'materials', (select coalesce(jsonb_agg(jsonb_build_object('title', m.title, 'kind', m.kind, 'url', m.url, 'description', m.description)), '[]') from training_materials m where m.requirement_id = r.id));
  end loop;
  return jsonb_build_object('linked', true, 'guide_id', g.id, 'name', g.full_name, 'term', v_term, 'requirements', out);
end $$;

-- --------------------------------------------------------------------------
-- 13. Who may call what.
-- --------------------------------------------------------------------------
revoke all on function hub_requirement_rows(uuid), hub_training_audience(uuid), hub_seed_attendance(uuid), hub_copy_training(text, text, jsonb), hub_session_title(uuid) from public, anon, authenticated;
grant execute on function hub_att_class(text) to authenticated;
grant execute on function
  admin_save_training_session(uuid, jsonb), admin_set_session_status(uuid, text, text), admin_delete_empty_session(uuid), admin_duplicate_session(uuid, date, text),
  admin_make_makeup(uuid, date, time, time, text, uuid[]), admin_seed_attendance(uuid), admin_set_attendance(uuid, jsonb, boolean), admin_mark_all(uuid, text, boolean),
  admin_save_requirement(uuid, jsonb), admin_set_requirement_sessions(uuid, uuid[]), admin_archive_requirement(uuid, boolean), admin_requirements_from_sessions(text),
  admin_add_requirement_people(uuid, uuid[], boolean), admin_set_completion(uuid, uuid[], text, text), admin_save_training_group(uuid, text, text), admin_set_group_members(uuid, uuid[], text),
  admin_save_speaker(uuid, text, text, text, text, text, uuid), admin_set_session_speakers(uuid, jsonb), admin_save_material(uuid, text, text, text, text, uuid, uuid), admin_delete_material(uuid),
  admin_save_training_template(uuid, jsonb), admin_create_from_template(uuid, text, date, time, text, uuid, date), admin_copy_training_setup(text, text, jsonb, boolean),
  training_overview(text), admin_training_matrix(text), admin_training_report(text), my_training(text)
  to authenticated;

commit;

-- Afterwards this should list the training functions (about 30 rows).
select proname from pg_proc where proname like 'admin\_%' and (proname like '%training%' or proname like '%session%' or proname like '%requirement%' or proname like '%attendance%'
  or proname like '%makeup%' or proname like '%speaker%' or proname like '%material%' or proname like '%completion%' or proname like '%group%' or proname like '%template%' or proname = 'admin_mark_all') order by 1;
