-- ============================================================================
-- Codirector Hub v2 — split the two committees apart
--
-- Recruitment does interviews. Training does evals. Codirectors, the Developer
-- and Advisors sit on both, so nothing changes for them.
--
-- Setting the flags in `roles` was not enough on its own: the policies still
-- said "any signed-in member", so the flags described an intention the database
-- was not acting on. This makes them real.
--
-- Where the line is drawn:
--   sensitive   eval feedback, interview scores and decisions -> gated
--   not         people's names, terms, priorities, announcements -> any member
--
-- Guides stay readable by everyone. A list of guide names is not a secret, and
-- the schedule and directory need it. What is private is what was WRITTEN about
-- them, and that lives in eval_submissions.
-- ============================================================================

begin;

update roles set in_training    = false where name = 'Recruitment Committee';
update roles set in_recruitment = false where name = 'Training Committee';

-- ----------------------------------------------------------- eval tracker --
drop policy if exists read_evals              on evals;
drop policy if exists update_evals            on evals;
drop policy if exists read_eval_submissions   on eval_submissions;
drop policy if exists insert_eval_submissions on eval_submissions;

-- Unchanged in spirit: you see an eval that is open or claimed, your own
-- whatever state it is in, and everything if you are an admin. Now it also has
-- to be your committee's tool at all.
create policy read_evals on evals for select using (
  in_training() and (
    is_codirector()
    or submitted_at is null
    or evaluator_id = auth.uid()
  )
);

create policy update_evals on evals for update
  using (
    in_training() and (
      is_codirector()
      or (submitted_at is null and (evaluator_id is null or evaluator_id = auth.uid()))
    )
  )
  with check (is_codirector() or evaluator_id = auth.uid() or evaluator_id is null);

create policy read_eval_submissions on eval_submissions for select using (
  in_training() and (is_codirector() or submitted_by = auth.uid())
);

create policy insert_eval_submissions on eval_submissions for insert
  with check (in_training() and submitted_by = auth.uid());

-- ------------------------------------------------------------- interviews --
drop policy if exists read_cycles  on interview_cycles;
drop policy if exists read_groups  on interview_groups;
drop policy if exists read_panel   on interview_panel;
drop policy if exists read_cands   on candidates;
drop policy if exists update_cands on candidates;
drop policy if exists read_scores  on interview_scores;
drop policy if exists write_scores on interview_scores;

create policy read_cycles on interview_cycles for select using (in_recruitment());
create policy read_groups on interview_groups for select using (in_recruitment());
create policy read_panel  on interview_panel  for select using (in_recruitment());
create policy read_cands  on candidates       for select using (in_recruitment());

-- Checking somebody in and recording the Yes/Maybe/No is what the panel does on
-- the day, so it is not admin-only — but it is now recruitment-only.
create policy update_cands on candidates for update
  using (in_recruitment()) with check (in_recruitment());

create policy read_scores on interview_scores for select using (in_recruitment());

-- Still nobody may write over another interviewer's scores.
create policy write_scores on interview_scores for all
  using  (in_recruitment() and interviewer_id = auth.uid())
  with check (in_recruitment() and interviewer_id = auth.uid());

commit;

-- What each role can now reach.
select r.name as role,
       r.is_admin       as sees_everything,
       r.in_recruitment as interviews,
       r.in_training    as eval_tracker,
       count(m.id)      as people
  from roles r
  left join members m on m.role = r.name
 group by r.name, r.sort_order, r.is_admin, r.in_recruitment, r.in_training
 order by r.sort_order;
