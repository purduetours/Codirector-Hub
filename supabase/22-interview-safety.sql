-- Non-destructive safeguards. Existing rows, criteria and aggregate views are unchanged.
begin;
create or replace function public.protect_interview_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from public.interview_scores where candidate_id=old.id) then
    raise exception 'Candidates with recorded evaluations cannot be removed.';
  end if;
  return old;
end $$;
drop trigger if exists protect_interview_history on public.candidates;
create trigger protect_interview_history before delete on public.candidates
for each row execute function public.protect_interview_history();

create or replace function public.interview_save_settings(p_cycle uuid, p_groups text[], p_panel uuid[])
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_codirector() is not true then raise exception 'Administrator access required'; end if;
  perform 1 from interview_cycles where id=p_cycle and is_current for update;
  if not found then raise exception 'Current interview cycle required'; end if;
  if coalesce(cardinality(p_groups),0)=0 or exists(select 1 from unnest(p_groups) g where g is null or btrim(g)='') then raise exception 'At least one named group required'; end if;
  if exists(select 1 from unnest(p_panel) id where not exists(select 1 from members m where m.id=id)) then raise exception 'Unknown panel member'; end if;
  delete from interview_groups where cycle_id=p_cycle;
  insert into interview_groups(cycle_id,name,sort_order) select p_cycle,btrim(g),min(n)::int from unnest(p_groups) with ordinality x(g,n) group by btrim(g);
  delete from interview_panel where cycle_id=p_cycle;
  insert into interview_panel(cycle_id,member_id) select p_cycle,id from (select distinct unnest(p_panel) id) p;
  return true;
end $$;
revoke all on function public.interview_save_settings(uuid,text[],uuid[]) from public;
grant execute on function public.interview_save_settings(uuid,text[],uuid[]) to authenticated;

create or replace function public.interview_replace_unscored(p_cycle uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if public.is_codirector() is not true then raise exception 'Administrator access required'; end if;
  perform 1 from interview_cycles where id=p_cycle and is_current for update;
  if not found then raise exception 'Current interview cycle required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Candidate rows required'; end if;
  -- Locks serialize deletion with foreign-key checks from concurrent score inserts.
  perform 1 from candidates where cycle_id=p_cycle for update;
  delete from candidates where cycle_id=p_cycle; -- trigger rejects ANY recorded evaluation
  insert into candidates(cycle_id,name,puid,year,grad,major,email,group_name)
  select p_cycle, nullif(btrim(r.name),''),r.puid,r.year,r.grad,r.major,r.email,r.group_name
  from jsonb_to_recordset(p_rows) as r(name text,puid text,year text,grad text,major text,email text,group_name text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.interview_replace_unscored(uuid,jsonb) from public;
grant execute on function public.interview_replace_unscored(uuid,jsonb) to authenticated;
commit;
