-- ============================================================================
-- Codirector Hub v2 — row level security
--
-- In the old app the rule "a committee member never sees anyone else's
-- completed eval" lived in a single `if` in Code.gs. It worked, but it was one
-- careless edit away from leaking every written evaluation in the program.
--
-- Here the database enforces it on every query, whatever the app asks for.
-- ============================================================================

-- Helpers. SECURITY DEFINER on purpose: these read `members`, which is itself
-- protected, and without it every policy that calls them would recurse.
create or replace function is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.id = auth.uid() and m.active);
$$;

create or replace function is_codirector() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.id = auth.uid() and m.active and m.is_codirector
  );
$$;

alter table members            enable row level security;
alter table terms              enable row level security;
alter table priorities         enable row level security;
alter table guides             enable row level security;
alter table evals              enable row level security;
alter table eval_submissions   enable row level security;
alter table rollovers          enable row level security;
alter table interview_cycles   enable row level security;
alter table interview_groups   enable row level security;
alter table interview_panel    enable row level security;
alter table candidates         enable row level security;
alter table interview_scores   enable row level security;
alter table announcements      enable row level security;
alter table activity_log       enable row level security;

-- ---------------------------------------------------------------- reference
-- Everyone signed in can read the shared lists; only codirectors change them.
create policy read_members     on members     for select using (is_member());
create policy write_members    on members     for all    using (is_codirector()) with check (is_codirector());

create policy read_terms       on terms       for select using (is_member());
create policy write_terms      on terms       for all    using (is_codirector()) with check (is_codirector());

create policy read_priorities  on priorities  for select using (is_member());
create policy write_priorities on priorities  for all    using (is_codirector()) with check (is_codirector());

create policy read_guides      on guides      for select using (is_member());
create policy write_guides     on guides      for all    using (is_codirector()) with check (is_codirector());

-- ---------------------------------------------------------------- evals ----
-- The rule the whole program rests on: you may see an eval that is still open
-- or claimed, your own whatever its state, and — if you are a codirector —
-- everything. Somebody else's SUBMITTED eval is invisible, full stop.
create policy read_evals on evals for select using (
  is_member() and (
    is_codirector()
    or submitted_at is null
    or evaluator_id = auth.uid()
  )
);

-- Claiming, rescheduling and releasing. Submitting and rolling over go through
-- functions instead (04-functions.sql) because they have to be atomic.
create policy update_evals on evals for update
  using (
    is_member() and (
      is_codirector()
      or (submitted_at is null and (evaluator_id is null or evaluator_id = auth.uid()))
    )
  )
  with check (
    is_codirector() or evaluator_id = auth.uid() or evaluator_id is null
  );

create policy insert_evals on evals for insert with check (is_codirector());
create policy delete_evals on evals for delete using (is_codirector());

-- The written feedback itself. Same rule, enforced separately, because this is
-- the table that would actually hurt to leak.
create policy read_eval_submissions on eval_submissions for select using (
  is_member() and (
    is_codirector()
    or submitted_by = auth.uid()
  )
);

create policy insert_eval_submissions on eval_submissions for insert
  with check (is_member() and submitted_by = auth.uid());

create policy read_rollovers  on rollovers for select using (is_member());
create policy write_rollovers on rollovers for all    using (is_codirector()) with check (is_codirector());

-- ------------------------------------------------------------ interviews ---
-- Interview data is committee-wide by design: the panel has to see the whole
-- board to make decisions in the room.
create policy read_cycles   on interview_cycles for select using (is_member());
create policy write_cycles  on interview_cycles for all    using (is_codirector()) with check (is_codirector());

create policy read_groups   on interview_groups for select using (is_member());
create policy write_groups  on interview_groups for all    using (is_codirector()) with check (is_codirector());

create policy read_panel    on interview_panel  for select using (is_member());
create policy write_panel   on interview_panel  for all    using (is_codirector()) with check (is_codirector());

create policy read_cands    on candidates for select using (is_member());
-- Check-in and the Yes/Maybe/No call are things any panellist does on the day.
create policy update_cands  on candidates for update using (is_member()) with check (is_member());
create policy insert_cands  on candidates for insert with check (is_codirector());
create policy delete_cands  on candidates for delete using (is_codirector());

-- Scores: everyone on the panel reads all of them, and nobody can write over
-- somebody else's. In the spreadsheet there was nothing stopping one
-- interviewer typing in another's column.
create policy read_scores  on interview_scores for select using (is_member());
create policy write_scores on interview_scores for all
  using (interviewer_id = auth.uid())
  with check (interviewer_id = auth.uid());

-- --------------------------------------------------------------- shared ----
create policy read_announcements  on announcements for select using (is_member());
create policy write_announcements on announcements for all    using (is_codirector()) with check (is_codirector());

create policy insert_log on activity_log for insert with check (is_member());
create policy read_log   on activity_log for select using (is_codirector());
