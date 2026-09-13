-- ===========================================================================
-- Codirector Hub - training attendance becomes codirector-only
--
-- It was readable by the whole training committee and writable by codirectors.
-- It is now both, for codirectors alone.
--
-- Hiding the tab in the app is not the same thing. Anyone signed in can call
-- the database directly with the key that ships in config.js, so a tab that is
-- merely hidden still hands over every row to anyone who looks. This is the
-- change that actually restricts it; the tab going away is the visible half.
--
-- What is in here: who attended which training, who is absent, who owes a
-- makeup, and why people said they would miss one. That is a record about a
-- hundred named students, which is reason enough to keep the circle small.
-- ===========================================================================
begin;

drop policy if exists read_training_sessions   on training_sessions;
drop policy if exists read_training_attendance on training_attendance;
drop policy if exists read_training_history    on training_history;

create policy read_training_sessions   on training_sessions   for select using (is_codirector());
create policy read_training_attendance on training_attendance for select using (is_codirector());
create policy read_training_history    on training_history    for select using (is_codirector());

-- The write policies were already codirector-only; restated so the whole rule
-- for these tables can be read in one place rather than across two files.
drop policy if exists write_training_sessions   on training_sessions;
drop policy if exists write_training_attendance on training_attendance;
create policy write_training_sessions   on training_sessions   for all
  using (is_codirector()) with check (is_codirector());
create policy write_training_attendance on training_attendance for all
  using (is_codirector()) with check (is_codirector());

commit;

-- Afterwards: every row below should say is_codirector().
select tablename, policyname, qual
  from pg_policies
 where tablename in ('training_sessions','training_attendance','training_history')
 order by tablename, policyname;
