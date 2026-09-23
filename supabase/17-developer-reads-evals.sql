-- ===========================================================================
-- Codirector Hub - the Developer can read submitted evals
--
-- Until now only codirectors (and the person who wrote it) could read a
-- submitted eval. The Developer maintains the tracker and needs to be able to
-- open one to check it saved properly, so they are added to both read rules:
-- the eval row itself, and the written feedback in eval_submissions.
--
-- Read only. Marking reviewed, releasing and the rollover stay with
-- codirectors, because update_evals is not touched here.
-- ===========================================================================
begin;

create or replace function is_developer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.id = auth.uid() and m.active and m.role = 'Developer'
  );
$$;

grant execute on function is_developer() to authenticated;

drop policy if exists read_evals            on evals;
drop policy if exists read_eval_submissions on eval_submissions;

create policy read_evals on evals for select using (
  in_training() and (
    is_codirector()
    or is_developer()
    or submitted_at is null
    or evaluator_id = auth.uid()
  )
);

create policy read_eval_submissions on eval_submissions for select using (
  in_training() and (is_codirector() or is_developer() or submitted_by = auth.uid())
);

commit;
