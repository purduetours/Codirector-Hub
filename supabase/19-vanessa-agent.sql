-- Apply after 18. Durable tool receipts, atomic mutation+history, safe retries.
begin;
create table if not exists public.hub_agent_actions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.members(id),
 request_id uuid not null,
 action text not null check(action in ('evaluation.claim','evaluation.release','reminder.create','reminder.complete','notifications.read')),
 parameters jsonb not null,
 eval_id uuid references public.evals(id) on delete set null,
 result jsonb not null,
 summary text not null,
 created_at timestamptz not null default now(),
 unique(owner_id,request_id)
);
create index if not exists hub_agent_actions_owner_at on public.hub_agent_actions(owner_id,created_at desc);
alter table public.hub_agent_actions enable row level security;
revoke all on public.hub_agent_actions from public,anon,authenticated;
grant select on public.hub_agent_actions to authenticated;
drop policy if exists agent_actions_owner on public.hub_agent_actions;
create policy agent_actions_owner on public.hub_agent_actions for select to authenticated using (
 is_member() and owner_id=auth.uid() and (eval_id is null or exists(select 1 from public.evals e where e.id=eval_id))
);
create or replace function public.hub_agent_action(p_request_id uuid,p_action text,p_params jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 who uuid=auth.uid(); prior hub_agent_actions; ev evals; rem hub_reminders;
 allowed text[]; result jsonb; summary text; subject uuid; name text; ids uuid[]; count_read integer;
 receipt_id uuid; stamp timestamptz; expected_owner uuid; due timestamptz;
begin
 if who is null or not is_member() then raise exception 'Active hub account required';end if;
 if p_request_id is null or jsonb_typeof(p_params) is distinct from 'object' then raise exception 'Invalid tool request';end if;
 if p_action like 'evaluation.%' and not in_training() then raise exception 'Evaluation access required';end if;
 allowed=case p_action
  when 'evaluation.claim' then array['eval_id','expected_owner','expected_date','expected_time','date','time']
  when 'evaluation.release' then array['eval_id','expected_owner','expected_date','expected_time']
  when 'reminder.create' then array['title','due_at']
  when 'reminder.complete' then array['id']
  when 'notifications.read' then array['ids'] else null end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_params) k where k<>all(allowed)) then raise exception 'Unsupported tool or parameter';end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text||':'||p_request_id::text,0));
 select * into prior from hub_agent_actions where owner_id=who and request_id=p_request_id;
 if found then
  if prior.action<>p_action or prior.parameters<>p_params then raise exception 'Request identity was already used for a different action';end if;
  if prior.eval_id is not null and not is_codirector() and not exists(select 1 from evals e where e.id=prior.eval_id and (e.submitted_at is null or e.evaluator_id=who)) then raise exception 'Evaluation is no longer accessible';end if;
  return jsonb_build_object('id',prior.id,'action',prior.action,'result',prior.result,'summary',prior.summary,'created_at',prior.created_at,'replayed',true);
 end if;
 if p_action in ('evaluation.claim','evaluation.release') then
  if not (p_params ?& array['eval_id','expected_owner','expected_date','expected_time']) then raise exception 'Evaluation review snapshot required';end if;
  if exists(select 1 from jsonb_each(p_params) x where x.key in ('expected_date','date') and x.value<>'null'::jsonb and (jsonb_typeof(x.value)<>'string' or (x.value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$')) then raise exception 'Valid evaluation date required';end if;
  if exists(select 1 from jsonb_each(p_params) x where x.key in ('expected_time','time') and x.value<>'null'::jsonb and (jsonb_typeof(x.value)<>'string' or (x.value#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$')) then raise exception 'Valid evaluation time required';end if;
  select * into ev from evals where id=(p_params->>'eval_id')::uuid for update;
  if not found or ev.submitted_at is not null then raise exception 'Evaluation is unavailable or already submitted';end if;
  if not exists(select 1 from terms t join guides g on g.id=ev.guide_id join priorities p on p.name=ev.priority where t.id=ev.term_id and t.is_current and g.active and p.needs_eval) then raise exception 'Evaluation is unavailable for the current term';end if;
  expected_owner=(p_params->>'expected_owner')::uuid;
  if ev.evaluator_id is distinct from expected_owner or ev.tour_date is distinct from (p_params->>'expected_date')::date or ev.tour_time is distinct from (p_params->>'expected_time')::time then raise exception 'Evaluation changed since review. Refresh it before trying again';end if;
  if p_action='evaluation.claim' then
   if ev.evaluator_id is not null then raise exception 'Evaluation was just claimed by someone else';end if;
   update evals set evaluator_id=who,claimed_at=now(),tour_date=(p_params->>'date')::date,tour_time=(p_params->>'time')::time where id=ev.id returning * into ev;
  else
   if ev.evaluator_id is null or (ev.evaluator_id<>who and not is_codirector()) then raise exception 'You can only release your own evaluation';end if;
   update evals set evaluator_id=null,claimed_at=null,tour_date=null,tour_time=null where id=ev.id returning * into ev;
  end if;
  subject=ev.id;select full_name into name from guides where id=ev.guide_id;
  result=jsonb_build_object('id',ev.id,'guide_id',ev.guide_id,'evaluator_id',ev.evaluator_id,'claimed_at',ev.claimed_at,'tour_date',ev.tour_date,'tour_time',ev.tour_time,'submitted_at',ev.submitted_at);
  summary=case p_action when 'evaluation.claim' then 'Claimed' else 'Released' end||' the evaluation for '||coalesce(name,'a guide');
 elsif p_action='reminder.create' then
  if jsonb_typeof(p_params->'title') is distinct from 'string' or length(btrim(p_params->>'title')) not between 1 and 240 or not p_params?'due_at' then raise exception 'Reminder title and due date required';end if;
  if jsonb_typeof(p_params->'due_at') is distinct from 'string' or (p_params->>'due_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$' then raise exception 'Due date must include timezone';end if;
  due=(p_params->>'due_at')::timestamptz;
  if due is null or not isfinite(due) then raise exception 'Valid reminder due date required';end if;
  insert into hub_reminders(owner_id,title,due_at) values(who,btrim(p_params->>'title'),due) returning * into rem;
  result=to_jsonb(rem);summary='Created reminder: '||rem.title;
 elsif p_action='reminder.complete' then
  update hub_reminders set completed_at=coalesce(completed_at,now()) where id=(p_params->>'id')::uuid and owner_id=who returning * into rem;
  if not found then raise exception 'Reminder is unavailable';end if;
  result=to_jsonb(rem);summary='Completed reminder: '||rem.title;
 else
  if jsonb_typeof(p_params->'ids') is distinct from 'array' then raise exception 'Notification IDs required';end if;
  if jsonb_array_length(p_params->'ids') not between 1 and 100 then raise exception 'Choose between 1 and 100 notifications';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_params->'ids');
  update hub_notifications n set read_at=now() where n.owner_id=who and n.id=any(ids) and n.read_at is null
   and (n.eval_id is null or (in_training() and exists(select 1 from evals e where e.id=n.eval_id and (is_codirector() or e.submitted_at is null or e.evaluator_id=who))));
  get diagnostics count_read=row_count;result=jsonb_build_object('count',count_read);summary='Marked '||count_read||' notifications as read';
 end if;
 insert into hub_agent_actions(owner_id,request_id,action,parameters,eval_id,result,summary)
 values(who,p_request_id,p_action,p_params,subject,result,summary) returning id,created_at into receipt_id,stamp;
 return jsonb_build_object('id',receipt_id,'action',p_action,'result',result,'summary',summary,'created_at',stamp,'replayed',false);
end $$;
revoke all on function public.hub_agent_action(uuid,text,jsonb) from public,anon;
grant execute on function public.hub_agent_action(uuid,text,jsonb) to authenticated;
-- Aggregate on the server and retain the caller's row-level visibility.
create or replace function public.hub_agent_analytics() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare answer jsonb;
begin
 if auth.uid() is null or not is_member() or not is_codirector() then raise exception 'Leadership access required';end if;
 select jsonb_build_object('workload',coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb),
  'sampleSize',coalesce(sum(w.total),0),'truncated',false,'limitation','Current term only; historical causes cannot be inferred.') into answer
 from (select coalesce(evaluator_name,'Unclaimed') as name,count(*) as total,count(*) filter(where submitted_at is null) as outstanding
  from eval_roster where needs_eval and term_id in(select id from terms where is_current)
  group by evaluator_id,evaluator_name order by count(*) filter(where submitted_at is null) desc) w;
 return answer;
end $$;
revoke all on function public.hub_agent_analytics() from public,anon;
grant execute on function public.hub_agent_analytics() to authenticated;
commit;
