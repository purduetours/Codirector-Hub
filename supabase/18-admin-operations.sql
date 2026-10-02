-- ============================================================================
-- Codirector Hub - administration without SQL
--
-- Run this ONCE, in the Supabase SQL editor (Run, not Explain). It is safe to
-- run again: every statement is "create if not exists" / "create or replace".
-- Nothing here deletes or rewrites existing data.
--
-- Why it exists
--   Until now several routine jobs needed somebody to open this console:
--     - adding a semester (the `terms` row)            -> Admin > Semester
--     - adding or retiring tour guides                 -> Admin > Guides
--     - archiving people who left, changing roles      -> Admin > People
--     - the tour-reminder switch and its settings      -> Admin > Settings
--     - checking whether the setup is healthy          -> Admin > Health
--   Every one of those is now an ordinary screen in the hub, and each of them
--   lands here: functions that check the caller is an administrator, refuse
--   anything that would leave the hub without one, and write a line to the
--   audit log. The screens are convenience; THESE are the safety.
--
-- Rules the functions enforce, whatever the front end sends
--   * only an active member whose role has is_admin may call them
--   * nobody is ever deleted - people and guides are archived, so their evals,
--     attendance and scores keep pointing at a real record
--   * the last administrator cannot be archived or demoted, and you cannot
--     demote or archive yourself
--   * a semester cannot be started twice, and only one term is ever current
--   * every change writes who / what / before / after to admin_audit
-- ============================================================================
begin;

-- --------------------------------------------------------------------------
-- 0. Tables the app already depends on in production but that no earlier file
--    created (they were made by hand). Declared here so a fresh project, or a
--    developer reading the repo, can see their shape. A no-op where they exist.
-- --------------------------------------------------------------------------
create table if not exists roles (
  name           text primary key,
  is_admin       boolean not null default false,   -- sees and may change everything
  in_training    boolean not null default false,   -- Eval Tracker, Directory, Desk Coverage
  in_recruitment boolean not null default false,   -- Interviews
  sort_order     int     not null default 0
);

create table if not exists member_roster (         -- the invite list
  email     text primary key,
  full_name text not null,
  role      text
);

alter table members add column if not exists role text;

-- --------------------------------------------------------------------------
-- 1. New columns: archiving instead of deleting, and term dates.
-- --------------------------------------------------------------------------
alter table roles   add column if not exists description text;

alter table members add column if not exists archived_at    timestamptz;
alter table members add column if not exists archived_by    uuid;
alter table members add column if not exists archive_reason text;

alter table guides  add column if not exists email          text;
alter table guides  add column if not exists archived_at    timestamptz;
alter table guides  add column if not exists archive_reason text;

alter table terms   add column if not exists academic_year text;
alter table terms   add column if not exists starts_on     date;
alter table terms   add column if not exists ends_on       date;

-- A guide who was archived must leave the Eval Tracker. The view is the same
-- as before with one column added at the end (guide_active); the app filters
-- on it, and falls back gracefully if this file has not been run yet.
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
  g.active as guide_active
from evals e
join guides     g on g.id = e.guide_id
join priorities p on p.name = e.priority
left join members m on m.id = e.evaluator_id
  $sql$;
exception when others then
  -- The live view differs from the one in the repo. Leave it alone: the app
  -- works without the extra column (archived guides then still show in the
  -- Eval Tracker until a developer reconciles the view).
  raise notice 'eval_roster was not changed: %', sqlerrm;
end
$view$;

-- --------------------------------------------------------------------------
-- 2. Operational settings (never secrets) and the audit log.
-- --------------------------------------------------------------------------
create table if not exists app_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]{1,80}$'),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table if not exists admin_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_name   text,
  action       text not null,                -- 'person.archived', 'semester.started', ...
  target_type  text,
  target_label text,
  before       jsonb,
  after        jsonb,
  note         text
);
create index if not exists admin_audit_at on admin_audit (at desc);

-- What each person has dismissed or finished in their Action Center. Only ever
-- their own rows; nothing here is shared or visible to anybody else.
create table if not exists action_states (
  user_id uuid not null default auth.uid(),
  key     text not null check (length(key) <= 200),
  state   text not null check (state in ('dismissed', 'done')),
  until   timestamptz,
  at      timestamptz not null default now(),
  primary key (user_id, key)
);

-- --------------------------------------------------------------------------
-- 3. Who counts as an administrator. The same rule the app uses to decide who
--    sees the Admin area: an active member whose role has is_admin.
-- --------------------------------------------------------------------------
create or replace function hub_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m join roles r on r.name = m.role
    where m.id = auth.uid() and m.active and r.is_admin);
$$;

-- Active administrators, not counting the listed emails. The last-admin guard.
create or replace function hub_admins_excluding(p_emails text[]) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from members m join roles r on r.name = m.role
  where m.active and r.is_admin
    and lower(coalesce(m.email, '')) <> all (coalesce(p_emails, '{}'::text[]));
$$;

create or replace function hub_require_admin() returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not hub_is_admin() then
    raise exception 'Only an administrator can do that.';
  end if;
end $$;

create or replace function hub_audit(p_action text, p_type text, p_label text,
                                     p_before jsonb default null, p_after jsonb default null,
                                     p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit (actor_id, actor_name, action, target_type, target_label, before, after, note)
  values (auth.uid(), (select full_name from members where id = auth.uid()),
          p_action, p_type, p_label, p_before, p_after, left(p_note, 500));
end $$;

-- --------------------------------------------------------------------------
-- 4. Row-level security for the new tables.
-- --------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table admin_audit  enable row level security;
alter table action_states enable row level security;

drop policy if exists read_settings on app_settings;
create policy read_settings on app_settings for select using (is_member());   -- writes: functions only

drop policy if exists read_audit on admin_audit;
create policy read_audit on admin_audit for select using (hub_is_admin());    -- writes: functions only

drop policy if exists own_action_states on action_states;
create policy own_action_states on action_states for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 5. PEOPLE (committee accounts)
-- --------------------------------------------------------------------------
create or replace function hub_clean_email(p text) returns text
  language sql immutable as $$ select lower(trim(coalesce(p, ''))) $$;

-- Add or update one person on the invite list, and switch on an existing account.
create or replace function hub_save_person(p_email text, p_name text, p_role text) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_email text := hub_clean_email(p_email);
  v_name  text := trim(coalesce(p_name, ''));
  v_old   members%rowtype;
  v_was   boolean;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% is not an email address.', p_email; end if;
  if v_name = '' then raise exception 'A name is required for %.', v_email; end if;
  if not exists (select 1 from roles where name = p_role) then raise exception 'There is no role called "%".', p_role; end if;

  select * into v_old from members where lower(email) = v_email;
  v_was := found;

  -- Moving an existing administrator to a non-admin role must leave another one.
  if v_was and v_old.active and exists (select 1 from roles where name = v_old.role and is_admin)
     and not exists (select 1 from roles where name = p_role and is_admin)
     and hub_admins_excluding(array[v_email]) < 1 then
    raise exception 'That would leave the hub with no administrator.';
  end if;

  insert into member_roster (email, full_name, role) values (v_email, v_name, p_role)
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role;

  if v_was then
    update members set full_name = v_name, role = p_role, active = true,
           archived_at = null, archived_by = null, archive_reason = null
     where id = v_old.id;
    perform hub_audit(case when v_old.active then 'person.updated' else 'person.restored' end, 'person', v_name,
      jsonb_build_object('role', v_old.role, 'active', v_old.active, 'name', v_old.full_name),
      jsonb_build_object('role', p_role, 'active', true, 'name', v_name));
    return case when v_old.active then 'updated' else 'restored' end;
  end if;

  perform hub_audit('person.added', 'person', v_name, null, jsonb_build_object('email', v_email, 'role', p_role));
  return 'added';
end $$;

create or replace function admin_save_person(p_email text, p_name text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform hub_require_admin();
  v := hub_save_person(p_email, p_name, p_role);
  return jsonb_build_object('result', v);
end $$;

-- Change one person's role. Cannot demote yourself or the last administrator.
create or replace function hub_change_role(p_email text, p_role text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_email text := hub_clean_email(p_email);
  m members%rowtype;
  v_me text;
begin
  if not exists (select 1 from roles where name = p_role) then raise exception 'There is no role called "%".', p_role; end if;
  select * into m from members where lower(email) = v_email;
  select lower(email) into v_me from members where id = auth.uid();

  if found and m.active and exists (select 1 from roles where name = m.role and is_admin)
     and not exists (select 1 from roles where name = p_role and is_admin) then
    if v_email = v_me then raise exception 'You cannot remove your own administrator access. Ask another administrator.'; end if;
    if hub_admins_excluding(array[v_email]) < 1 then raise exception 'That would leave the hub with no administrator.'; end if;
  end if;

  update member_roster set role = p_role where email = v_email;
  if m.id is not null then update members set role = p_role where id = m.id; end if;
  perform hub_audit('person.role_changed', 'person', coalesce(m.full_name, v_email),
    jsonb_build_object('role', m.role), jsonb_build_object('role', p_role));
end $$;

create or replace function admin_change_role(p_email text, p_role text) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  perform hub_change_role(p_email, p_role);
  return jsonb_build_object('result', 'changed');
end $$;

-- Take access away (archive) from, or give it back (restore) to, several people
-- at once. Their records stay exactly where they are.
create or replace function hub_archive_people(p_emails text[], p_reason text) returns int
  language plpgsql security definer set search_path = public as $$
declare
  v_emails text[] := array(select hub_clean_email(x) from unnest(p_emails) x);
  v_me text; n int := 0; m members%rowtype; e text;
begin
  select lower(email) into v_me from members where id = auth.uid();
  if v_me = any (v_emails) then raise exception 'You cannot archive your own account.'; end if;
  if hub_admins_excluding(v_emails) < 1 then raise exception 'That would leave the hub with no administrator.'; end if;

  foreach e in array v_emails loop
    delete from member_roster where email = e;
    select * into m from members where lower(email) = e;
    if found and m.active then
      update members set active = false, archived_at = now(), archived_by = auth.uid(),
             archive_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
       where id = m.id;
      perform hub_audit('person.archived', 'person', m.full_name,
        jsonb_build_object('role', m.role, 'active', true), jsonb_build_object('active', false), p_reason);
      n := n + 1;
    elsif not found then
      perform hub_audit('person.invite_cancelled', 'person', e);
    end if;
  end loop;
  return n;
end $$;

create or replace function admin_archive_people(p_emails text[], p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform hub_require_admin();
  if coalesce(array_length(p_emails, 1), 0) = 0 then raise exception 'Nobody was selected.'; end if;
  n := hub_archive_people(p_emails, p_reason);
  return jsonb_build_object('archived', n);
end $$;

create or replace function admin_restore_people(p_emails text[]) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e text; m members%rowtype; n int := 0; v_list text[];
begin
  perform hub_require_admin();
  v_list := array(select hub_clean_email(x) from unnest(p_emails) x);
  foreach e in array v_list loop
    select * into m from members where lower(email) = e;
    if not found then continue; end if;
    if m.role is null or not exists (select 1 from roles where name = m.role) then
      raise exception '% has no valid role to go back to. Use Add person to give them one.', m.full_name;
    end if;
    perform hub_save_person(e, m.full_name, m.role);
    n := n + 1;
  end loop;
  return jsonb_build_object('restored', n);
end $$;

-- A roster import is validated here, not in the browser: the screen shows what
-- this returns, and only then asks for confirmation.
create or replace function admin_import_people(p_rows jsonb, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; out jsonb := '[]'::jsonb; seen text[] := '{}';
  v_email text; v_name text; v_role text; v_status text; v_msg text;
  bad int := 0; good int := 0;
begin
  perform hub_require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'There are no rows to import.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Import at most 500 people at a time.'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_email := hub_clean_email(r->>'email'); v_name := trim(coalesce(r->>'name', '')); v_role := trim(coalesce(r->>'role', ''));
    v_status := 'ok'; v_msg := null;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_status := 'error'; v_msg := 'Not a valid email address.';
    elsif v_name = '' then v_status := 'error'; v_msg := 'Name is missing.';
    elsif not exists (select 1 from roles where name = v_role) then v_status := 'error'; v_msg := 'Unknown role "' || v_role || '".';
    elsif v_email = any (seen) then v_status := 'error'; v_msg := 'Listed more than once.';
    else
      if exists (select 1 from members where lower(email) = v_email and active) then v_status := 'update'; v_msg := 'Already has access; name and role will be updated.';
      elsif exists (select 1 from members where lower(email) = v_email) then v_status := 'restore'; v_msg := 'Was archived; will be restored.';
      else v_status := 'new'; v_msg := 'Will be invited.'; end if;
    end if;
    seen := seen || v_email;
    if v_status = 'error' then bad := bad + 1; else good := good + 1; end if;
    out := out || jsonb_build_object('row', i, 'email', v_email, 'name', v_name, 'role', v_role, 'status', v_status, 'message', v_msg);
  end loop;

  if p_apply then
    if bad > 0 then raise exception 'Fix the % row(s) with errors first. Nothing was imported.', bad; end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      perform hub_save_person(r->>'email', r->>'name', r->>'role');
    end loop;
    perform hub_audit('import.people', 'import', good || ' people');
  end if;
  return jsonb_build_object('applied', p_apply, 'ok', good, 'errors', bad, 'rows', out);
end $$;

-- --------------------------------------------------------------------------
-- 6. ROLES: what each one grants. Descriptions and the committee switches are
--    editable; the administrator switch is guarded.
-- --------------------------------------------------------------------------
create or replace function admin_update_role(p_name text, p_description text, p_in_training boolean,
                                             p_in_recruitment boolean, p_is_admin boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r roles%rowtype; v_me_role text;
begin
  perform hub_require_admin();
  select * into r from roles where name = p_name;
  if not found then raise exception 'There is no role called "%".', p_name; end if;
  select role into v_me_role from members where id = auth.uid();

  if r.is_admin and not p_is_admin then
    if v_me_role = p_name then raise exception 'You hold this role, so you cannot remove its administrator access.'; end if;
    if (select count(*) from members m join roles x on x.name = m.role
         where m.active and x.is_admin and x.name <> p_name) < 1 then
      raise exception 'That would leave the hub with no administrator.';
    end if;
  end if;

  update roles set description = nullif(trim(coalesce(p_description, '')), ''),
         in_training = p_in_training, in_recruitment = p_in_recruitment, is_admin = p_is_admin
   where name = p_name;
  perform hub_audit('role.updated', 'role', p_name,
    jsonb_build_object('is_admin', r.is_admin, 'in_training', r.in_training, 'in_recruitment', r.in_recruitment),
    jsonb_build_object('is_admin', p_is_admin, 'in_training', p_in_training, 'in_recruitment', p_in_recruitment));
  return jsonb_build_object('result', 'saved');
end $$;

-- --------------------------------------------------------------------------
-- 7. GUIDES (the tour guide roster)
-- --------------------------------------------------------------------------
create or replace function hub_first_priority() returns text
  language sql stable as $$ select name from priorities where needs_eval order by sort_order limit 1 $$;

create or replace function hub_save_guide(p_id uuid, p_first text, p_last text, p_email text, p_priority text) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_first text := trim(coalesce(p_first, '')); v_last text := trim(coalesce(p_last, ''));
  v_email text := nullif(hub_clean_email(p_email), '');
  v_prio  text := coalesce(nullif(trim(coalesce(p_priority, '')), ''), hub_first_priority());
  v_term  text; v_id uuid := p_id; old guides%rowtype;
begin
  if v_first = '' or v_last = '' then raise exception 'A first and last name are both required.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% is not an email address.', p_email; end if;
  if not exists (select 1 from priorities where name = v_prio) then raise exception 'There is no priority called "%".', v_prio; end if;
  select id into v_term from terms where is_current;

  if v_id is null then
    select * into old from guides where lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last) limit 1;
    if found then
      if old.active then raise exception '% % is already on the roster.', v_first, v_last; end if;
      raise exception '% % is archived. Restore them instead of adding again.', v_first, v_last;
    end if;
    insert into guides (first_name, last_name, email) values (v_first, v_last, v_email) returning id into v_id;
    if v_term is not null then
      insert into evals (term_id, guide_id, priority) values (v_term, v_id, v_prio) on conflict (term_id, guide_id) do nothing;
    end if;
    perform hub_audit('guide.added', 'guide', v_first || ' ' || v_last, null, jsonb_build_object('priority', v_prio));
    return 'added';
  end if;

  select * into old from guides where id = v_id;
  if not found then raise exception 'That guide no longer exists.'; end if;
  if exists (select 1 from guides where id <> v_id and active
             and lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last)) then
    raise exception 'Another guide already has that name.';
  end if;
  update guides set first_name = v_first, last_name = v_last, email = v_email where id = v_id;
  if v_term is not null and p_priority is not null then
    update evals set priority = v_prio where term_id = v_term and guide_id = v_id and submitted_at is null;
  end if;
  perform hub_audit('guide.updated', 'guide', v_first || ' ' || v_last,
    jsonb_build_object('name', old.full_name, 'email', old.email), jsonb_build_object('name', v_first || ' ' || v_last, 'email', v_email));
  return 'updated';
end $$;

create or replace function admin_save_guide(p_id uuid, p_first text, p_last text, p_email text, p_priority text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  return jsonb_build_object('result', hub_save_guide(p_id, p_first, p_last, p_email, p_priority));
end $$;

-- Archive or restore guides. Their evals and attendance stay; the guide simply
-- stops appearing in the tracker, the directory and next semester.
create or replace function admin_set_guides_active(p_ids uuid[], p_active boolean, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare g guides%rowtype; n int := 0; i uuid; v_term text;
begin
  perform hub_require_admin();
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Nobody was selected.'; end if;
  select id into v_term from terms where is_current;
  foreach i in array p_ids loop
    select * into g from guides where id = i;
    if not found or g.active = p_active then continue; end if;
    update guides set active = p_active,
           archived_at = case when p_active then null else now() end,
           archive_reason = case when p_active then null else nullif(left(trim(coalesce(p_reason, '')), 200), '') end
     where id = i;
    if p_active and v_term is not null then      -- a returning guide needs a place on this term's tracker
      insert into evals (term_id, guide_id, priority) values (v_term, i, hub_first_priority()) on conflict (term_id, guide_id) do nothing;
    end if;
    perform hub_audit(case when p_active then 'guide.restored' else 'guide.archived' end, 'guide', g.full_name, null, null, p_reason);
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $$;

create or replace function admin_import_guides(p_rows jsonb, p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; out jsonb := '[]'::jsonb; seen text[] := '{}';
  v_first text; v_last text; v_email text; v_prio text; v_status text; v_msg text; v_key text;
  bad int := 0; good int := 0; g guides%rowtype;
begin
  perform hub_require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'There are no rows to import.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Import at most 500 guides at a time.'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_first := trim(coalesce(r->>'first', '')); v_last := trim(coalesce(r->>'last', ''));
    v_email := nullif(hub_clean_email(r->>'email'), ''); v_prio := nullif(trim(coalesce(r->>'priority', '')), '');
    v_key := lower(v_first || ' ' || v_last); v_status := 'new'; v_msg := 'Will be added.';
    if v_first = '' or v_last = '' then v_status := 'error'; v_msg := 'First and last name are both required.';
    elsif v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_status := 'error'; v_msg := 'Not a valid email address.';
    elsif v_prio is not null and not exists (select 1 from priorities where name = v_prio) then v_status := 'error'; v_msg := 'Unknown priority "' || v_prio || '".';
    elsif v_key = any (seen) then v_status := 'error'; v_msg := 'Listed more than once.';
    else
      select * into g from guides where lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last) limit 1;
      if found and g.active then v_status := 'skip'; v_msg := 'Already on the roster; left as is.';
      elsif found then v_status := 'restore'; v_msg := 'Was archived; will be restored.'; end if;
    end if;
    seen := seen || v_key;
    if v_status = 'error' then bad := bad + 1; else good := good + 1; end if;
    out := out || jsonb_build_object('row', i, 'name', trim(v_first || ' ' || v_last), 'email', v_email, 'priority', v_prio, 'status', v_status, 'message', v_msg);
  end loop;

  if p_apply then
    if bad > 0 then raise exception 'Fix the % row(s) with errors first. Nothing was imported.', bad; end if;
    for r in select * from jsonb_array_elements(p_rows) loop
      select * into g from guides where lower(first_name) = lower(trim(r->>'first')) and lower(last_name) = lower(trim(r->>'last')) limit 1;
      if found and g.active then continue;
      elsif found then perform admin_set_guides_active(array[g.id], true, null);
      else perform hub_save_guide(null, r->>'first', r->>'last', r->>'email', r->>'priority'); end if;
    end loop;
    perform hub_audit('import.guides', 'import', good || ' guides');
  end if;
  return jsonb_build_object('applied', p_apply, 'ok', good, 'errors', bad, 'rows', out);
end $$;

-- --------------------------------------------------------------------------
-- 8. SEMESTERS
-- --------------------------------------------------------------------------
-- Edit a term's name and dates (does not change which term is current).
create or replace function admin_save_term(p_id text, p_label text, p_year text, p_starts date, p_ends date) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare old terms%rowtype;
begin
  perform hub_require_admin();
  select * into old from terms where id = p_id;
  if not found then raise exception 'There is no semester called "%".', p_id; end if;
  if trim(coalesce(p_label, '')) = '' then raise exception 'A semester needs a name.'; end if;
  if p_starts is not null and p_ends is not null and p_ends <= p_starts then raise exception 'The end date must be after the start date.'; end if;
  update terms set label = trim(p_label), academic_year = nullif(trim(coalesce(p_year, '')), ''), starts_on = p_starts, ends_on = p_ends where id = p_id;
  perform hub_audit('term.saved', 'semester', p_label,
    jsonb_build_object('label', old.label, 'starts_on', old.starts_on, 'ends_on', old.ends_on),
    jsonb_build_object('label', p_label, 'starts_on', p_starts, 'ends_on', p_ends));
  return jsonb_build_object('result', 'saved');
end $$;

-- Start a new semester: one transaction, previewable.
--   * history stays with the semester it happened in; nothing is copied or deleted
--   * guides who are leaving are archived; everyone else active gets a place on
--     the new tracker, moved up a priority tier when p_promote
--   * people who are leaving lose access (archived, never deleted); role changes
--     and new hires are applied; training sessions for the new term are created
--     and seeded for each guide
--
-- The preview (p_apply = false) is not a separate calculation. It runs the very
-- same work and then rolls it back, so what it reports is exactly what the real
-- run will do, including any error the real run would hit.
create or replace function hub_start_semester(
  p_to text, p_label text, p_year text, p_starts date, p_ends date,
  p_leaving_guides uuid[], p_leaving_people text[], p_promote boolean, p_sessions jsonb,
  p_role_changes jsonb, p_new_people jsonb, p_new_guides jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from text; v_leave_p text[] := array(select hub_clean_email(x) from unnest(coalesce(p_leaving_people, '{}')) x);
  v_leave_g uuid[] := coalesce(p_leaving_guides, '{}');
  v_new_term boolean; v_carry int := 0; v_promoted int := 0; v_arch_g int := 0; v_arch_p int := 0; v_sess int := 0;
  v_roles int := 0; v_hires int := 0; v_newg int := 0;
  r record; v_next text; s jsonb; v_sid uuid; v_labels text[] := '{}'; v_label text; v_me text;
  v_warn jsonb := '[]'::jsonb;
begin
  if p_to !~ '^(fall|spring|summer)-[0-9]{4}$' then raise exception 'The semester id must look like fall-2027 or spring-2028.'; end if;
  if trim(coalesce(p_label, '')) = '' then raise exception 'A semester needs a name.'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'Give the semester a start date and an end date after it.'; end if;

  select id into v_from from terms where is_current;
  if v_from = p_to then raise exception '% is already the current semester.', p_label; end if;
  if exists (select 1 from rollovers where to_term = p_to) then raise exception '% has already been started. Nothing was changed.', p_label; end if;
  v_new_term := not exists (select 1 from terms where id = p_to);

  select lower(email) into v_me from members where id = auth.uid();
  if v_me = any (v_leave_p) then raise exception 'You cannot remove your own access while starting a semester.'; end if;

  if jsonb_typeof(p_sessions) <> 'array' or jsonb_typeof(p_role_changes) <> 'array'
     or jsonb_typeof(p_new_people) <> 'array' or jsonb_typeof(p_new_guides) <> 'array' then
    raise exception 'The semester details were not in the expected shape.';
  end if;
  for s in select * from jsonb_array_elements(p_sessions) loop
    v_label := trim(coalesce(s->>'label', ''));
    if v_label = '' then raise exception 'Every training session needs a name.'; end if;
    if lower(v_label) = any (v_labels) then raise exception 'Two training sessions are both called "%".', v_label; end if;
    v_labels := v_labels || lower(v_label);
    v_sess := v_sess + 1;
  end loop;

  -- the new semester row first: the tracker rows below point at it
  insert into terms (id, label, academic_year, starts_on, ends_on, is_current)
  values (p_to, trim(p_label), nullif(trim(coalesce(p_year, '')), ''), p_starts, p_ends, false)
  on conflict (id) do update set label = excluded.label, academic_year = excluded.academic_year,
    starts_on = excluded.starts_on, ends_on = excluded.ends_on;

  -- people: new hires, then role changes, then leavers (so admin checks see the final picture)
  for s in select * from jsonb_array_elements(p_new_people) loop
    perform hub_save_person(s->>'email', s->>'name', s->>'role'); v_hires := v_hires + 1;
  end loop;
  for s in select * from jsonb_array_elements(p_role_changes) loop
    perform hub_change_role(s->>'email', s->>'role'); v_roles := v_roles + 1;
  end loop;
  if hub_admins_excluding(v_leave_p) < 1 then raise exception 'That would leave the hub with no administrator.'; end if;
  select count(*) into v_arch_p from (select lower(email) as e from members where active
                                      union select lower(email) from member_roster) x where e = any (v_leave_p);
  if cardinality(v_leave_p) > 0 then perform hub_archive_people(v_leave_p, 'Left at end of ' || coalesce(v_from, 'term')); end if;

  -- guides: new ones join the current tracker at their priority, leavers are archived
  for s in select * from jsonb_array_elements(p_new_guides) loop
    perform hub_save_guide(null, s->>'first', s->>'last', s->>'email', s->>'priority'); v_newg := v_newg + 1;
  end loop;
  select count(*) into v_arch_g from guides where active and id = any (v_leave_g);
  update guides set active = false, archived_at = now(), archive_reason = 'Left at end of ' || coalesce(v_from, 'term')
   where active and id = any (v_leave_g);

  for r in select g.id, e.priority, p.sort_order, p.needs_eval
             from guides g
             left join evals e on e.guide_id = g.id and e.term_id = v_from
             left join priorities p on p.name = e.priority
            where g.active
  loop
    v_carry := v_carry + 1;
    if r.priority is null then v_next := hub_first_priority();
    elsif not p_promote or not r.needs_eval or r.sort_order <= 1 then v_next := r.priority;
    else
      select name into v_next from priorities where sort_order = r.sort_order - 1 and needs_eval limit 1;
      v_next := coalesce(v_next, r.priority);
      if v_next <> r.priority then v_promoted := v_promoted + 1; end if;
    end if;
    insert into evals (term_id, guide_id, priority) values (p_to, r.id, v_next) on conflict (term_id, guide_id) do nothing;
  end loop;

  for s in select * from jsonb_array_elements(p_sessions) loop
    v_sid := null;
    insert into training_sessions (term_id, label, held_on, sort_order)
    values (p_to, trim(s->>'label'), nullif(s->>'held_on', '')::date,
            (select coalesce(max(sort_order), -1) + 1 from training_sessions where term_id = p_to))
    on conflict (term_id, label) do nothing returning id into v_sid;
    if v_sid is not null then
      insert into training_attendance (session_id, guide_id, person_name, expectation)
      select v_sid, g.id, g.full_name, 'Attendance Expected' from guides g where g.active
      on conflict (session_id, person_name) do nothing;
    end if;
  end loop;

  if v_from is not null then insert into rollovers (from_term, to_term, ran_by) values (v_from, p_to, auth.uid()); end if;
  update terms set is_current = false where is_current;
  update terms set is_current = true where id = p_to;
  insert into activity_log (actor_id, action, detail) values (auth.uid(), 'rollover', coalesce(v_from, '-') || ' -> ' || p_to);
  perform hub_audit('semester.started', 'semester', p_label, jsonb_build_object('from', v_from),
    jsonb_build_object('to', p_to, 'guides_carried', v_carry, 'guides_archived', v_arch_g, 'people_archived', v_arch_p,
                       'sessions', v_sess, 'new_people', v_hires, 'role_changes', v_roles, 'new_guides', v_newg));

  if v_from is null then v_warn := v_warn || to_jsonb('There was no current semester, so nobody was promoted; everyone starts at first priority.'::text); end if;
  if v_carry = 0 then v_warn := v_warn || to_jsonb('No guides are on the new tracker. Add guides under Admin > Guides.'::text); end if;
  if v_sess = 0 then v_warn := v_warn || to_jsonb('No training sessions were created. Add them under Training.'::text); end if;

  return jsonb_build_object('from_term', v_from, 'to_term', p_to, 'new_term', v_new_term,
    'guides_carried', v_carry, 'guides_promoted', v_promoted, 'guides_archived', v_arch_g, 'new_guides', v_newg,
    'people_archived', v_arch_p, 'new_people', v_hires, 'role_changes', v_roles, 'sessions', v_sess, 'warnings', v_warn);
end $$;

create or replace function admin_start_semester(
  p_to text, p_label text, p_year text, p_starts date, p_ends date,
  p_leaving_guides uuid[] default '{}', p_leaving_people text[] default '{}',
  p_promote boolean default true, p_sessions jsonb default '[]'::jsonb,
  p_role_changes jsonb default '[]'::jsonb, p_new_people jsonb default '[]'::jsonb, p_new_guides jsonb default '[]'::jsonb,
  p_apply boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_detail text;
begin
  perform hub_require_admin();
  if p_apply then
    return hub_start_semester(p_to, p_label, p_year, p_starts, p_ends, p_leaving_guides, p_leaving_people, p_promote,
                              p_sessions, p_role_changes, p_new_people, p_new_guides) || jsonb_build_object('dry_run', false);
  end if;
  begin
    v := hub_start_semester(p_to, p_label, p_year, p_starts, p_ends, p_leaving_guides, p_leaving_people, p_promote,
                            p_sessions, p_role_changes, p_new_people, p_new_guides);
    raise exception using errcode = 'D0001', message = 'dry run', detail = v::text;
  exception when sqlstate 'D0001' then
    get stacked diagnostics v_detail = pg_exception_detail;      -- everything above has been rolled back
    return v_detail::jsonb || jsonb_build_object('dry_run', true);
  end;
end $$;

-- --------------------------------------------------------------------------
-- 9. SETTINGS (operational only; keys that look like secrets are refused) and
--    the tour-reminder switch, which used to be edited in the table directly.
-- --------------------------------------------------------------------------
create or replace function admin_set_setting(p_key text, p_value jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  perform hub_require_admin();
  if p_key !~ '^[a-z0-9_.]{1,80}$' then raise exception 'That is not a valid setting name.'; end if;
  if p_key ~* '(secret|token|password|passwd|api_?key|service_?role|private)' then
    raise exception 'Secrets are never stored in settings. They belong in Supabase, not in the app.';
  end if;
  if length(p_value::text) > 4000 then raise exception 'That value is too long.'; end if;
  select value into old from app_settings where key = p_key;
  insert into app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform hub_audit('setting.changed', 'setting', p_key, to_jsonb(old), p_value);
  return jsonb_build_object('result', 'saved');
end $$;

create or replace function admin_get_reminders() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r tour_reminder_settings%rowtype;
begin
  perform hub_require_admin();
  select * into r from tour_reminder_settings where singleton;
  return jsonb_build_object('enabled', r.enabled, 'owner_id', r.owner_id, 'from_email', r.from_email,
                            'hub_url', r.hub_url, 'hours_before', r.hours_before);
exception when undefined_table then
  return jsonb_build_object('unavailable', true);
end $$;

create or replace function admin_set_reminders(p_enabled boolean, p_hours int, p_owner uuid, p_from text, p_url text) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  if p_hours is null or p_hours not between 1 and 168 then raise exception 'Send reminders between 1 and 168 hours ahead.'; end if;
  if p_enabled then
    if p_from !~ '^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$' then raise exception 'Reminders need a valid "from" email address.'; end if;
    if p_url !~ '^https://[^\s]+$' then raise exception 'The hub address must start with https://'; end if;
    if p_owner is null or not exists (select 1 from members where id = p_owner and active) then raise exception 'Choose who gets a copy of each reminder.'; end if;
  end if;
  update tour_reminder_settings set enabled = p_enabled, hours_before = p_hours, owner_id = p_owner,
         from_email = nullif(trim(coalesce(p_from, '')), ''), hub_url = nullif(trim(coalesce(p_url, '')), '') where singleton;
  perform hub_audit('reminders.changed', 'setting', 'Tour reminders', null,
    jsonb_build_object('enabled', p_enabled, 'hours_before', p_hours));
  return jsonb_build_object('result', 'saved');
end $$;

-- --------------------------------------------------------------------------
-- 10. HEALTH and the Action Center's admin signals.
-- --------------------------------------------------------------------------
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
        (select count(*) from guides g where g.active and not exists (select 1 from evals e where e.guide_id = g.id and e.term_id = t.id)) end,
    'evals_for_archived_guides', case when t.id is null then 0 else
        (select count(*) from evals e join guides g on g.id = e.guide_id where e.term_id = t.id and not g.active and e.submitted_at is null and e.evaluator_id is not null) end,
    'training_sessions', case when t.id is null then 0 else (select count(*) from training_sessions where term_id = t.id) end,
    'pending_signups',  (select count(*) from members m where not m.active and m.archived_at is null
                          and m.created_at > now() - interval '30 days'
                          and not exists (select 1 from member_roster x where lower(x.email) = lower(m.email))));
  begin
    v := v || jsonb_build_object('reminders_enabled', (select enabled from tour_reminder_settings where singleton));
  exception when undefined_table then null; end;
  return v;
end $$;

create or replace function admin_pending_signups() returns table (email text, full_name text, signed_up_at timestamptz)
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  return query select m.email, m.full_name, m.created_at from members m
   where not m.active and m.archived_at is null and m.created_at > now() - interval '30 days'
     and not exists (select 1 from member_roster x where lower(x.email) = lower(m.email))
   order by m.created_at desc;
end $$;

-- A line in the audit log for something the screens do directly (for example
-- deleting an announcement). Free text is trimmed; callers must be administrators.
create or replace function admin_log(p_action text, p_label text, p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform hub_require_admin();
  if p_action !~ '^[a-z]+\.[a-z_]+$' then raise exception 'Bad audit action.'; end if;
  perform hub_audit(p_action, 'other', left(p_label, 200), null, null, p_note);
end $$;

-- --------------------------------------------------------------------------
-- 11. Who may call what. Helpers are internal; the admin_* functions check the
--     caller themselves, so granting them to signed-in users is safe.
-- --------------------------------------------------------------------------
revoke all on function hub_audit(text, text, text, jsonb, jsonb, text),
              hub_save_person(text, text, text), hub_save_guide(uuid, text, text, text, text),
              hub_archive_people(text[], text), hub_change_role(text, text), hub_start_semester(text, text, text, date, date, uuid[], text[], boolean, jsonb, jsonb, jsonb, jsonb), hub_require_admin() from public, anon, authenticated;
grant execute on function hub_is_admin() to authenticated;
grant execute on function
  admin_save_person(text, text, text), admin_change_role(text, text), admin_archive_people(text[], text),
  admin_restore_people(text[]), admin_import_people(jsonb, boolean), admin_update_role(text, text, boolean, boolean, boolean),
  admin_save_guide(uuid, text, text, text, text), admin_set_guides_active(uuid[], boolean, text),
  admin_import_guides(jsonb, boolean), admin_save_term(text, text, text, date, date),
  admin_start_semester(text, text, text, date, date, uuid[], text[], boolean, jsonb, jsonb, jsonb, jsonb, boolean),
  admin_set_setting(text, jsonb), admin_get_reminders(), admin_set_reminders(boolean, int, uuid, text, text),
  admin_health(), admin_pending_signups(), admin_log(text, text, text)
  to authenticated;

commit;

-- Afterwards this should list the admin_* functions (about 17 rows).
select proname from pg_proc where proname like 'admin\_%' order by 1;
