-- Backend-only reminders. Disabled until REMINDERS-SETUP.md is completed.
begin;
create table if not exists public.tour_reminder_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, owner_id uuid references public.members(id),
 from_email text, hub_url text,
 hours_before integer not null default 24 check(hours_before between 1 and 168)
);
insert into public.tour_reminder_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.tour_reminder_deliveries (
 id uuid primary key default gen_random_uuid(),
 eval_id uuid not null references public.evals(id) on delete cascade,
 evaluator_id uuid not null,tour_date date not null,tour_time time not null,tour_at timestamptz not null,
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','failed','cancelled')),
 attempts integer not null default 0,first_attempt_at timestamptz,next_attempt_at timestamptz not null default now(),
 lease_id uuid,lease_until timestamptz,provider_id text,accepted_at timestamptz,last_error text,
 unique(eval_id,evaluator_id,tour_date,tour_time)
);
alter table public.tour_reminder_settings enable row level security;
alter table public.tour_reminder_deliveries enable row level security;
revoke all on public.tour_reminder_settings,public.tour_reminder_deliveries from public,anon,authenticated;
grant all on public.tour_reminder_settings,public.tour_reminder_deliveries to service_role;

-- Confirmed Auth email is authoritative; no fuzzy matching or client recipients.
create or replace view public.tour_reminder_candidates as
select e.id eval_id,e.evaluator_id,e.tour_date,e.tour_time,
 (e.tour_date+e.tour_time) at time zone 'America/Indiana/Indianapolis' tour_at,
 lower(u.email) evaluator_email,lower(ou.email) owner_email,
 s.from_email,s.hub_url,s.hours_before,g.full_name guide_name,m.full_name evaluator_name
from public.evals e
join public.terms t on t.id=e.term_id and t.is_current
join public.priorities p on p.name=e.priority and p.needs_eval
join public.guides g on g.id=e.guide_id and g.active
join public.members m on m.id=e.evaluator_id and m.active
join auth.users u on u.id=m.id and u.email_confirmed_at is not null
cross join public.tour_reminder_settings s
join public.members om on om.id=s.owner_id and om.active
join auth.users ou on ou.id=om.id and ou.email_confirmed_at is not null
where s.enabled and e.submitted_at is null and e.reviewed_at is null
 and e.tour_date is not null and e.tour_time is not null
 and u.email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 and ou.email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 and s.from_email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 and s.hub_url ~ '^https://[^[:space:]]+$';
revoke all on public.tour_reminder_candidates from public,anon,authenticated;
grant select on public.tour_reminder_candidates to service_role;

create or replace function public.queue_tour_reminders() returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.tour_reminder_deliveries(eval_id,evaluator_id,tour_date,tour_time,tour_at,payload)
 select c.eval_id,c.evaluator_id,c.tour_date,c.tour_time,c.tour_at,
 jsonb_build_object('from',c.from_email,'to',jsonb_build_array(c.evaluator_email),
 'cc',case when c.owner_email=c.evaluator_email then '[]'::jsonb else jsonb_build_array(c.owner_email) end,
 'subject','Tour evaluation reminder — '||c.tour_date::text,
 'text','Hi '||c.evaluator_name||E',\n\nYou are scheduled to evaluate '||c.guide_name||E'’s tour.\n\nDate: '||c.tour_date::text||E'\nTime: '||to_char(c.tour_time,'HH12:MI AM')||E' (Purdue local time, America/Indiana/Indianapolis)\n\nCheck the current assignment in Eval Tracker: '||c.hub_url||E'\n\nIf your plans changed, update your claim in the hub.\n\nVanessa · Codirector Hub')
 from public.tour_reminder_candidates c
 where c.tour_at>now() and c.tour_at<=now()+make_interval(hours=>c.hours_before)
 on conflict(eval_id,evaluator_id,tour_date,tour_time) do nothing;
 get diagnostics n=row_count;return n;
end $$;

create or replace function public.claim_tour_reminder() returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.tour_reminder_deliveries%rowtype;
begin
 update public.tour_reminder_deliveries d set status='cancelled',last_error='Assignment, recipients or settings changed, or tour started.'
 where d.status in ('pending','sending') and (d.lease_until is null or d.lease_until<now()) and (
 d.tour_at<=now() or not exists(select 1 from public.tour_reminder_candidates c
 where c.eval_id=d.eval_id and c.evaluator_id=d.evaluator_id and c.tour_date=d.tour_date and c.tour_time=d.tour_time
 and c.evaluator_email=d.payload->'to'->>0 and c.from_email=d.payload->>'from'
 and (case when c.owner_email=c.evaluator_email then '[]'::jsonb else jsonb_build_array(c.owner_email) end)=d.payload->'cc'));
 -- Stop before the provider's 24-hour idempotency window expires.
 update public.tour_reminder_deliveries set status='failed',last_error='Retry limit reached. Check provider history before any manual resend.'
 where status in ('pending','sending') and (lease_until is null or lease_until<now())
 and (attempts>=8 or first_attempt_at<now()-interval '23 hours');
 select * into r from public.tour_reminder_deliveries
 where status in ('pending','sending') and next_attempt_at<=now() and (lease_until is null or lease_until<now())
 order by tour_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.tour_reminder_deliveries set status='sending',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=r.id returning * into r;
 return to_jsonb(r);
end $$;

create or replace function public.finish_tour_reminder(p_id uuid,p_lease uuid,p_status text,p_provider text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('accepted','pending','failed') then raise exception 'Invalid reminder status';end if;
 if p_status='accepted' and nullif(p_provider,'') is null then raise exception 'Provider ID required';end if;
 update public.tour_reminder_deliveries set status=p_status,provider_id=p_provider,
 accepted_at=case when p_status='accepted' then now() else null end,last_error=left(p_error,300),
 next_attempt_at=now()+interval '5 minutes'*least(attempts,6),lease_until=null
 where id=p_id and lease_id=p_lease and status='sending';
 return found;
end $$;
revoke all on function public.queue_tour_reminders(),public.claim_tour_reminder(),public.finish_tour_reminder(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.queue_tour_reminders(),public.claim_tour_reminder(),public.finish_tour_reminder(uuid,uuid,text,text,text) to service_role;
commit;
