-- Explicit, fictional interview fixtures. Registry provenance is not user-editable.
begin;
create table if not exists public.interview_samples (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  cycle_id uuid not null references public.interview_cycles(id) on delete cascade,
  sample_key text not null check(sample_key in ('avery','blair','casey')),
  created_by uuid references public.members(id) on delete set null,
  unique(cycle_id,sample_key)
);
alter table public.interview_samples enable row level security;
drop policy if exists read_interview_samples on public.interview_samples;
create policy read_interview_samples on public.interview_samples for select using(public.in_recruitment());
revoke all on public.interview_samples from public, anon, authenticated;
grant select on public.interview_samples to authenticated;

create or replace function public.interview_load_samples(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item record; candidate uuid; added integer := 0;
begin
  if public.is_codirector() is not true then raise exception 'Administrator access required'; end if;
  perform 1 from interview_cycles where id=p_cycle and is_current for update;
  if not found then raise exception 'Current interview cycle required'; end if;
  for item in select * from (values ('avery','Sample — Avery Example',0),('blair','Sample — Blair Example',1),('casey','Sample — Casey Example',3)) x(key,name,scored)
  loop
    if exists(select 1 from interview_samples where cycle_id=p_cycle and sample_key=item.key) then continue; end if;
    insert into candidates(cycle_id,name,group_name,checked_in_at)
    values(p_cycle,item.name,'Sample data',now()) returning id into candidate;
    insert into interview_samples(candidate_id,cycle_id,sample_key,created_by) values(candidate,p_cycle,item.key,auth.uid());
    if item.scored > 0 then
      insert into interview_scores(candidate_id,interviewer_id,speaking,personable,impression,note)
      values(candidate,auth.uid(),4,case when item.scored=3 then 3 end,case when item.scored=3 then 5 end,
        'Fictional sample evaluation for testing. Edit these scores and comments freely.');
    end if;
    added := added + 1;
  end loop;
  return jsonb_build_object('added',added,'total',(select count(*) from interview_samples where cycle_id=p_cycle));
end $$;
revoke all on function public.interview_load_samples(uuid) from public;
grant execute on function public.interview_load_samples(uuid) to authenticated;

create or replace function public.interview_remove_samples(p_cycle uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare removed integer;
begin
  if public.is_codirector() is not true then raise exception 'Administrator access required'; end if;
  perform 1 from interview_cycles where id=p_cycle and is_current for update;
  if not found then raise exception 'Current interview cycle required'; end if;
  -- Only registry-proven sample candidates qualify, regardless of their names.
  perform 1 from candidates c join interview_samples s on s.candidate_id=c.id
  where s.cycle_id=p_cycle and c.cycle_id=p_cycle for update of c;
  delete from interview_scores sc using interview_samples s, candidates c
  where sc.candidate_id=s.candidate_id and c.id=s.candidate_id and s.cycle_id=p_cycle and c.cycle_id=p_cycle;
  delete from candidates c using interview_samples s
  where c.id=s.candidate_id and s.cycle_id=p_cycle and c.cycle_id=p_cycle;
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.interview_remove_samples(uuid) from public;
grant execute on function public.interview_remove_samples(uuid) to authenticated;
commit;
