-- Operations platform. Apply AFTER deployed role/access and reminder migrations.
-- No email jobs are enabled. All functions pin search_path and derive identity.
begin;
create table if not exists public.hub_reminders (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.members(id),
 title text not null check(length(btrim(title)) between 1 and 240),
 due_at timestamptz not null,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists hub_reminders_owner_due on public.hub_reminders(owner_id,due_at);
alter table public.hub_reminders enable row level security;
drop policy if exists reminders_owner on public.hub_reminders;
create policy reminders_owner on public.hub_reminders for all to authenticated
 using(is_member() and owner_id=auth.uid()) with check(is_member() and owner_id=auth.uid());
revoke all on public.hub_reminders from public,anon,authenticated;
grant select,insert,delete on public.hub_reminders to authenticated;
revoke update on public.hub_reminders from authenticated;
grant update(title,due_at,completed_at) on public.hub_reminders to authenticated;

create table if not exists public.hub_activity (
 id bigint generated always as identity primary key,
 actor_id uuid references public.members(id),
 owner_id uuid references public.members(id),
 eval_id uuid references public.evals(id) on delete cascade,
 category text not null check(category in ('evaluation','reminder','training','administration')),
 action text not null,
 summary text not null,
 metadata jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index if not exists hub_activity_created on public.hub_activity(created_at desc);
create index if not exists hub_activity_eval on public.hub_activity(eval_id,created_at desc);
create index if not exists hub_activity_owner on public.hub_activity(owner_id,created_at desc);
alter table public.hub_activity enable row level security;
drop policy if exists activity_visible on public.hub_activity;
create policy activity_visible on public.hub_activity for select to authenticated using (
 is_member() and (
  (category='reminder' and owner_id=auth.uid()) or
  (category='evaluation' and exists(select 1 from public.evals e where e.id=eval_id) and (is_codirector() or actor_id=auth.uid() or owner_id=auth.uid())) or
  (category in ('training','administration') and is_codirector())
 )
);
revoke all on public.hub_activity from public,anon,authenticated;
grant select on public.hub_activity to authenticated;

create table if not exists public.hub_notifications (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.members(id),
 category text not null check(category in ('evaluation','reminder','administration')),
 title text not null,
 route text not null check(route in ('evals','reminders','activity')),
 eval_id uuid references public.evals(id) on delete cascade,
 reminder_id uuid references public.hub_reminders(id) on delete cascade,
 source_key text not null,
 read_at timestamptz,
 created_at timestamptz not null default now(),
 unique(owner_id,source_key)
);
create index if not exists hub_notifications_owner_created on public.hub_notifications(owner_id,created_at desc);
alter table public.hub_notifications enable row level security;
drop policy if exists notifications_owner on public.hub_notifications;
create policy notifications_owner on public.hub_notifications for select to authenticated using (
 is_member() and owner_id=auth.uid() and (eval_id is null or exists(select 1 from public.evals e where e.id=eval_id))
);
revoke all on public.hub_notifications from public,anon,authenticated;
grant select on public.hub_notifications to authenticated;

create or replace function public.hub_read_notifications(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if not is_member() then raise exception 'Active hub account required'; end if;
 update hub_notifications set read_at=now() where owner_id=auth.uid() and read_at is null
 and (p_ids is null or id=any(p_ids));
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.hub_read_notifications(uuid[]) from public,anon;
grant execute on function public.hub_read_notifications(uuid[]) to authenticated;

create or replace function public.hub_reminder_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare verb text; item public.hub_reminders;
begin
 if TG_OP='UPDATE' then
  new.updated_at=now();
  if new.title is not distinct from old.title and new.due_at is not distinct from old.due_at and new.completed_at is not distinct from old.completed_at then return new; end if;
 end if;
 if TG_OP='DELETE' then item=old;verb='deleted';
 else item=new;verb=case when TG_OP='INSERT' then 'created' when new.completed_at is not null and old.completed_at is null then 'completed' when new.completed_at is null and old.completed_at is not null then 'reopened' else 'updated' end;end if;
 insert into hub_activity(actor_id,owner_id,category,action,summary,metadata)
 values(auth.uid(),item.owner_id,'reminder','reminder.'||verb,'Reminder '||verb||': '||item.title,jsonb_build_object('reminder_id',item.id));
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists hub_reminder_audit on public.hub_reminders;
create trigger hub_reminder_audit before insert or update or delete on public.hub_reminders for each row execute function public.hub_reminder_event();

-- Preserve existing submission RPCs while preventing row-level policies from
-- accidentally authorizing protected column edits by ordinary evaluators.
create or replace function public.hub_guard_eval() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or is_codirector() then return new;end if;
 if not is_member() or not in_training() then raise exception 'Evaluation access required';end if;
 if new.id<>old.id or new.term_id<>old.term_id or new.guide_id<>old.guide_id or new.priority is distinct from old.priority or new.reviewed_at is distinct from old.reviewed_at then
  raise exception 'Only leadership can change evaluation administration';end if;
 if old.submitted_at is not null then raise exception 'This evaluation has already been submitted';end if;
 if old.evaluator_id is not null and old.evaluator_id<>auth.uid() then raise exception 'This evaluation belongs to another evaluator';end if;
 if new.evaluator_id is not null and new.evaluator_id<>auth.uid() then raise exception 'You can only claim an evaluation for yourself';end if;
 if new.submitted_at is not null and new.evaluator_id is distinct from auth.uid() then raise exception 'Submitted evaluations must retain their evaluator';end if;
 if new.submitted_at is distinct from old.submitted_at and not exists(select 1 from eval_submissions s where s.eval_id=new.id and s.submitted_by=auth.uid()) then
  raise exception 'Submit the evaluation feedback before marking it submitted';end if;
 return new;
end $$;
drop trigger if exists hub_eval_guard on public.evals;
create trigger hub_eval_guard before update on public.evals for each row execute function public.hub_guard_eval();

create or replace function public.hub_eval_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare verb text; actor text; guide text;
begin
 verb=case
 when new.submitted_at is distinct from old.submitted_at then 'submitted'
 when new.reviewed_at is distinct from old.reviewed_at then 'review_changed'
 when old.evaluator_id is null and new.evaluator_id is not null then 'claimed'
 when old.evaluator_id is not null and new.evaluator_id is null then 'released'
 when new.evaluator_id is distinct from old.evaluator_id then 'reassigned'
 when new.tour_date is distinct from old.tour_date or new.tour_time is distinct from old.tour_time then 'rescheduled'
 when new.priority is distinct from old.priority then 'priority_changed' else null end;
 if verb is null then return new;end if;
 select full_name into actor from members where id=auth.uid();
 select full_name into guide from guides where id=new.guide_id;
 insert into hub_activity(actor_id,owner_id,eval_id,category,action,summary,metadata)
 values(auth.uid(),coalesce(new.evaluator_id,old.evaluator_id),new.id,'evaluation','evaluation.'||verb,
 coalesce(actor,'System')||' '||replace(verb,'_',' ')||' an evaluation for '||coalesce(guide,'a guide'),
 jsonb_build_object('date',new.tour_date,'time',new.tour_time,'previous_evaluator_id',old.evaluator_id,'evaluator_id',new.evaluator_id));
 if new.evaluator_id is not null and (new.evaluator_id is distinct from old.evaluator_id or verb='rescheduled') then
 insert into hub_notifications(owner_id,category,title,route,eval_id,source_key)
 values(new.evaluator_id,'evaluation','Evaluation '||verb||': '||coalesce(guide,'guide'),'evals',new.id,'change:'||gen_random_uuid()::text);
 end if;
 return new;
end $$;
drop trigger if exists hub_eval_audit on public.evals;
create trigger hub_eval_audit after update on public.evals for each row execute function public.hub_eval_event();

create or replace function public.hub_sync_notifications() returns integer
language plpgsql security definer set search_path=public as $$
declare n integer; total integer=0; horizon integer=24;
begin
 if not is_member() then raise exception 'Active hub account required';end if;
 select hours_before into horizon from tour_reminder_settings limit 1;
 insert into hub_notifications(owner_id,category,title,route,reminder_id,source_key)
 select owner_id,'reminder',title,'reminders',id,'reminder:'||id||':'||due_at::text from hub_reminders
 where owner_id=auth.uid() and completed_at is null and due_at<=now() order by due_at limit 500
 on conflict(owner_id,source_key) do nothing;
 get diagnostics n=row_count;total=total+n;
 if in_training() then
 insert into hub_notifications(owner_id,category,title,route,eval_id,source_key)
 select e.evaluator_id,'evaluation',case when e.tour_date<(now() at time zone 'America/Indiana/Indianapolis')::date then 'Evaluation needs follow-up: ' else 'Upcoming evaluation: ' end||g.full_name,
 'evals',e.id,'due:'||e.id||':'||e.tour_date||':'||coalesce(e.tour_time::text,'undated-time')||':'||case when e.tour_date<(now() at time zone 'America/Indiana/Indianapolis')::date then 'past' else 'upcoming' end
 from evals e join guides g on g.id=e.guide_id join terms t on t.id=e.term_id join priorities p on p.name=e.priority
 where e.evaluator_id=auth.uid() and e.submitted_at is null and e.reviewed_at is null and g.active and t.is_current and p.needs_eval
 and e.tour_date is not null and (e.tour_date+coalesce(e.tour_time,'23:59'::time)) at time zone 'America/Indiana/Indianapolis' <=now()+make_interval(hours=>coalesce(horizon,24))
 order by e.tour_date limit 500 on conflict(owner_id,source_key) do nothing;
 get diagnostics n=row_count;total=total+n;end if;
 return total;
end $$;
revoke all on function public.hub_sync_notifications() from public,anon;
grant execute on function public.hub_sync_notifications() to authenticated;
-- Trigger functions cannot be called as ordinary RPCs.
revoke all on function public.hub_reminder_event(), public.hub_eval_event(), public.hub_guard_eval() from public,anon,authenticated;
-- Bridge the existing training history instead of maintaining another writer.
create or replace function public.hub_training_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor text;
begin
 select full_name into actor from members where id=new.changed_by;
 insert into hub_activity(actor_id,category,action,summary,metadata)
 values(new.changed_by,'training','training.'||new.field||'_changed',coalesce(actor,'System')||' updated training for '||new.person_name,
 jsonb_build_object('attendance_id',new.attendance_id,'session_id',new.session_id,'field',new.field));
 return new;
end $$;
drop trigger if exists hub_training_audit on public.training_history;
create trigger hub_training_audit after insert on public.training_history for each row execute function public.hub_training_event();

create or replace function public.hub_member_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor text;
begin
 if new.active is not distinct from old.active and new.is_codirector is not distinct from old.is_codirector and (to_jsonb(new)->>'role') is not distinct from (to_jsonb(old)->>'role') then return new;end if;
 select full_name into actor from members where id=auth.uid();
 insert into hub_activity(actor_id,category,action,summary,metadata)
 values(auth.uid(),'administration','member.access_changed',coalesce(actor,'System')||' updated access for '||coalesce(new.full_name,'a member'),jsonb_build_object('member_id',new.id));
 return new;
end $$;
drop trigger if exists hub_member_audit on public.members;
create trigger hub_member_audit after update on public.members for each row execute function public.hub_member_event();
revoke all on function public.hub_training_event(),public.hub_member_event() from public,anon,authenticated;

commit;
