-- Codirector Hub - Vanessa, the assistant (no paid AI anywhere)
--
-- What this adds (nothing is removed, nothing existing changes meaning):
--
--   vanessa_actions    every change Vanessa PROPOSES, with a hash of exactly what
--                      was shown to the person. Short-lived and single-use.
--   vanessa_turns      usage and failure metrics: which engine answered (Standard,
--                      Enhanced with a local model, or her older built-in answers),
--                      which intent, how confident, how long. No question text,
--                      no answers, no names.
--
--   vanessa_begin_action / vanessa_confirm_action / vanessa_finish_action /
--   vanessa_cancel_action / vanessa_log_turn
--                      what the assistant calls. All security definer, all check
--                      the caller is an active member, all work on the CALLER's
--                      own rows only.
--   admin_vanessa_stats  the Admin > Vanessa page (admins only).
--
-- And one change to existing behaviour: hub_audit now notices when a change was
-- made by Vanessa on somebody's behalf and records that in admin_audit.via, so
-- the audit log can say "Vanessa, for Logann" instead of just "Logann".
--
-- Vanessa can NOT run SQL. She calls the same admin_* functions as the screens,
-- as the signed-in person, so every permission check in those functions still
-- applies. Nothing here widens what anyone is allowed to do.
--
-- Vanessa needs no AI service, no API key and no hosted function, so there is
-- no rate limiter or key table here. (If you ran an earlier version of this file
-- that had them, this one tidies them away.)
--
-- Run after 18, 19 and 20. Safe to run twice, and safe to run on top of the earlier
-- version of this file.

begin;

-- --------------------------------------------------------------------------
-- 1. Tables.
-- --------------------------------------------------------------------------
alter table admin_audit add column if not exists via text;

-- An earlier version rate-limited a paid model. There is none now.
drop function if exists vanessa_gate();
drop table if exists vanessa_requests;
do $$ begin
  delete from app_settings where key in ('vanessa.rate_per_minute', 'vanessa.rate_per_day', 'vanessa.agent');
exception when undefined_table then null; end $$;

create table if not exists vanessa_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  kind        text not null check (kind ~ '^[a-z_]{2,60}$'),
  params_hash text not null check (params_hash ~ '^[a-f0-9]{16,128}$'),
  summary     text not null check (length(summary) <= 600),
  risk        text not null check (risk in ('low', 'meaningful', 'high')),
  mode        text not null default 'live' check (mode in ('live', 'mock')),
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'executed', 'failed', 'cancelled', 'expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  confirmed_at timestamptz,
  finished_at  timestamptz,
  result      jsonb
);
create index if not exists vanessa_actions_user on vanessa_actions (user_id, created_at desc);

create table if not exists vanessa_turns (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid not null default auth.uid(),
  engine      text check (engine in ('standard', 'enhanced', 'legacy')),
  intent      text,
  confidence  numeric(3,2),
  local_calls int not null default 0,
  provider_failed boolean not null default false,
  latency_ms  int,
  tools       text[] not null default '{}',
  failed_tools text[] not null default '{}',
  ok          boolean not null default true,
  error_code  text,
  route       text
);
-- If the earlier version of this file was run, bring its table up to date.
alter table vanessa_turns add column if not exists engine text;
alter table vanessa_turns add column if not exists intent text;
alter table vanessa_turns add column if not exists confidence numeric(3,2);
alter table vanessa_turns add column if not exists local_calls int not null default 0;
alter table vanessa_turns add column if not exists provider_failed boolean not null default false;
alter table vanessa_turns drop column if exists mode, drop column if exists model,
                          drop column if exists input_tokens, drop column if exists output_tokens;
create index if not exists vanessa_turns_at on vanessa_turns (at desc);

alter table vanessa_actions  enable row level security;
alter table vanessa_turns    enable row level security;

-- People can see their own proposed actions. Everything else goes through the
-- functions below; there are no insert/update/delete policies on purpose.
drop policy if exists own_vanessa_actions on vanessa_actions;
create policy own_vanessa_actions on vanessa_actions for select using (user_id = auth.uid());

revoke all on vanessa_actions, vanessa_turns from anon, authenticated;
grant select on vanessa_actions to authenticated;

-- --------------------------------------------------------------------------
-- 2. Pending actions.
--    begin   - Vanessa has worked out exactly what she would do and shown it.
--              The hash is of the final, validated parameters.
--    confirm - the person said yes. Succeeds once, for the same person, before
--              expiry, and only if the hash still matches what was shown.
--    finish  - records what happened (so a failed write is never "done").
-- --------------------------------------------------------------------------
create or replace function vanessa_begin_action(p_kind text, p_hash text, p_summary text, p_risk text,
                                                p_mode text default 'live') returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not is_member() then raise exception 'You need to be signed in to do that.'; end if;
  if p_kind !~ '^[a-z_]{2,60}$' then raise exception 'That is not a kind of action I can propose.'; end if;
  if p_hash !~ '^[a-f0-9]{16,128}$' then raise exception 'That request was not valid.'; end if;
  if p_risk not in ('low', 'meaningful', 'high') then raise exception 'That request was not valid.'; end if;
  if p_mode not in ('live', 'mock') then p_mode := 'live'; end if;

  update vanessa_actions set status = 'expired', finished_at = now()
   where user_id = auth.uid() and status = 'pending' and expires_at < now();
  -- One thing waiting at a time: a new proposal replaces the old one.
  update vanessa_actions set status = 'cancelled', finished_at = now()
   where user_id = auth.uid() and status = 'pending';

  insert into vanessa_actions (kind, params_hash, summary, risk, mode, expires_at)
  values (p_kind, p_hash, left(p_summary, 600), p_risk, p_mode,
          now() + case p_risk when 'high' then interval '5 minutes' else interval '10 minutes' end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function vanessa_confirm_action(p_id uuid, p_hash text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a vanessa_actions%rowtype;
begin
  if auth.uid() is null or not is_member() then raise exception 'You need to be signed in to do that.'; end if;
  select * into a from vanessa_actions where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'I could not find that request. Ask me again and I will set it up fresh.'; end if;
  if a.status = 'confirmed' or a.status = 'executed' or a.status = 'failed' then
    raise exception 'That request was already used. Ask me again if you want to repeat it.';
  end if;
  if a.status = 'cancelled' then raise exception 'That request was cancelled.'; end if;
  if a.status = 'expired' or a.expires_at < now() then
    raise exception 'That request expired. Ask me again and I will set it up fresh.';
  end if;
  if a.params_hash <> p_hash then
    raise exception 'The details changed after you reviewed them, so I did not run it.';
  end if;
  update vanessa_actions set status = 'confirmed', confirmed_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'kind', a.kind, 'mode', a.mode, 'risk', a.risk);
end $$;

create or replace function vanessa_finish_action(p_id uuid, p_ok boolean, p_result jsonb default null) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update vanessa_actions
     set status = case when p_ok then 'executed' else 'failed' end,
         finished_at = now(),
         result = case when p_result is null then null else to_jsonb(left(p_result::text, 1500)) end
   where id = p_id and user_id = auth.uid() and status = 'confirmed';
end $$;

create or replace function vanessa_cancel_action(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update vanessa_actions set status = 'cancelled', finished_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending';
end $$;

-- --------------------------------------------------------------------------
-- 3. Metrics. Deliberately content-free: which engine, which intent, how
--    confident, how long, did it work.
-- --------------------------------------------------------------------------
drop function if exists vanessa_log_turn(text, text, int, int, int, text[], text[], boolean, text, text);
create or replace function vanessa_log_turn(p_engine text, p_intent text, p_confidence numeric, p_local_calls int,
                                            p_provider_failed boolean, p_latency_ms int,
                                            p_tools text[], p_failed text[], p_ok boolean, p_error text, p_route text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member() then return; end if;
  insert into vanessa_turns (engine, intent, confidence, local_calls, provider_failed, latency_ms, tools, failed_tools, ok, error_code, route)
  values (case when p_engine in ('standard', 'enhanced', 'legacy') then p_engine else null end,
          case when p_intent ~ '^[a-z_]{2,30}\.[a-z_]{2,30}$' then p_intent else null end,
          case when p_confidence between 0 and 1 then round(p_confidence, 2) else null end,
          least(greatest(coalesce(p_local_calls, 0), 0), 20), coalesce(p_provider_failed, false),
          least(greatest(coalesce(p_latency_ms, 0), 0), 600000),
          coalesce((select array_agg(left(t, 40)) from unnest(p_tools[1:30]) t), '{}'),
          coalesce((select array_agg(left(t, 40)) from unnest(p_failed[1:30]) t), '{}'),
          coalesce(p_ok, true), left(p_error, 60), left(p_route, 40));
  delete from vanessa_turns where at < now() - interval '60 days' and random() < 0.02;
end $$;

-- --------------------------------------------------------------------------
-- 4. Diagnostics for the admin page.
-- --------------------------------------------------------------------------
create or replace function admin_vanessa_stats(p_hours int default 24) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 720)); r jsonb;
begin
  perform hub_require_admin();
  select jsonb_build_object(
    'hours', p_hours,
    'turns', (select count(*) from vanessa_turns where at >= since),
    'ok', (select count(*) from vanessa_turns where at >= since and ok),
    'avg_latency_ms', (select round(avg(latency_ms)) from vanessa_turns where at >= since and ok),
    'p95_latency_ms', (select round((percentile_cont(0.95) within group (order by latency_ms))::numeric) from vanessa_turns where at >= since and ok),
    'people', (select count(distinct user_id) from vanessa_turns where at >= since),
    'last_success_at', (select max(at) from vanessa_turns where ok),
    'by_engine', coalesce((select jsonb_object_agg(coalesce(engine, 'unknown'), n) from (select engine, count(*) as n from vanessa_turns where at >= since group by engine) e), '{}'),
    'local_calls', (select coalesce(sum(local_calls), 0) from vanessa_turns where at >= since),
    'provider_failures', (select count(*) from vanessa_turns where at >= since and provider_failed),
    'not_understood', (select count(*) from vanessa_turns where at >= since and engine = 'legacy'),
    'avg_confidence', (select round(avg(confidence), 2) from vanessa_turns where at >= since and confidence is not null),
    'by_intent', coalesce((select jsonb_agg(x) from (
        select intent, count(*) as n, count(*) filter (where ok) as ok, round(avg(latency_ms)) as avg_ms, round(avg(confidence), 2) as avg_confidence
          from vanessa_turns where at >= since and intent is not null group by intent order by 2 desc limit 25) x), '[]'),
    'by_tool', coalesce((select jsonb_agg(x) from (select t as tool, count(*) as uses from vanessa_turns, unnest(tools) t where at >= since group by t order by 2 desc limit 25) x), '[]'),
    'failing_tools', coalesce((select jsonb_agg(x) from (select t as tool, count(*) as failures from vanessa_turns, unnest(failed_tools) t where at >= since group by t order by 2 desc limit 10) x), '[]'),
    'recent_failures', coalesce((select jsonb_agg(x) from (select at, error_code, failed_tools, route, intent from vanessa_turns where not ok or cardinality(failed_tools) > 0 order by at desc limit 10) x), '[]'),
    'actions', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from vanessa_actions where created_at >= since group by status) s), '{}'),
    'recent_actions', coalesce((select jsonb_agg(x) from (
        select a.created_at as at, a.kind, a.status, a.risk, a.mode, m.full_name as person
          from vanessa_actions a left join members m on m.id = a.user_id order by a.created_at desc limit 15) x), '[]')
  ) into r;
  return r;
end $$;

-- --------------------------------------------------------------------------
-- 5. The audit log learns who really made a change.
--    PostgREST exposes request headers to SQL. The assistant sends the id of
--    the action the person just confirmed; hub_audit only believes it if that
--    action is really confirmed and belongs to the person making the change,
--    so a header can't be used to mislabel anyone else's edits.
-- --------------------------------------------------------------------------
create or replace function hub_audit(p_action text, p_type text, p_label text,
                                     p_before jsonb default null, p_after jsonb default null,
                                     p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare v_hdr text; v_id uuid; v_via text;
begin
  begin
    v_hdr := current_setting('request.headers', true);
    if v_hdr is not null and v_hdr <> '' then
      v_id := nullif(v_hdr::json ->> 'x-vanessa-action', '')::uuid;
      if v_id is not null and exists (select 1 from vanessa_actions
                                       where id = v_id and user_id = auth.uid() and status = 'confirmed' and mode = 'live') then
        v_via := 'vanessa';
      end if;
    end if;
  exception when others then v_via := null;
  end;
  insert into admin_audit (actor_id, actor_name, action, target_type, target_label, before, after, note, via)
  values (auth.uid(), (select full_name from members where id = auth.uid()),
          p_action, p_type, p_label, p_before, p_after, left(p_note, 500), v_via);
end $$;

revoke all on function hub_audit(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 6. Permissions.
-- --------------------------------------------------------------------------
revoke all on function vanessa_begin_action(text, text, text, text, text),
  vanessa_confirm_action(uuid, text), vanessa_finish_action(uuid, boolean, jsonb), vanessa_cancel_action(uuid),
  vanessa_log_turn(text, text, numeric, int, boolean, int, text[], text[], boolean, text, text), admin_vanessa_stats(int)
  from public, anon;
grant execute on function vanessa_begin_action(text, text, text, text, text),
  vanessa_confirm_action(uuid, text), vanessa_finish_action(uuid, boolean, jsonb), vanessa_cancel_action(uuid),
  vanessa_log_turn(text, text, numeric, int, boolean, int, text[], text[], boolean, text, text), admin_vanessa_stats(int)
  to authenticated;

commit;

-- Afterwards this should list 6 rows.
select proname from pg_proc where proname like 'vanessa\_%' or proname = 'admin_vanessa_stats' order by 1;
