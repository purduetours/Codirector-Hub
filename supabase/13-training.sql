-- ============================================================================
-- Codirector Hub — training attendance
--
-- Replaces the tracking spreadsheet. Two tables rather than the sheet's shape,
-- because the sheet is a grid — one column pair per training date, growing
-- sideways every time a date is added — and a grid is painful to query, filter
-- or add a date to. One row per person per session says the same thing and
-- lets the app ask "who has an outstanding makeup" without knowing how many
-- dates exist.
--
-- Two values are kept per person per session, exactly as the sheet does:
--   expectation — why they might miss it (Class/Exam, Club, Emergency/Sick…)
--   actual      — what happened (Attended, Makeup Completed, Absent Need Makeup)
--
-- Both are free text on purpose. The sheet's vocabulary has already drifted
-- once ("Makeup Complete" and "Makeup Completed" both appear in it), and a
-- check constraint would mean a migration every time somebody wants a new
-- reason. The app offers the known options as a dropdown; the column does not
-- forbid a new one.
-- ============================================================================
begin;

create table if not exists training_sessions (
  id         uuid primary key default gen_random_uuid(),
  term_id    text not null references terms(id) on delete cascade,
  label      text not null,                    -- 'August 24th', as people say it
  held_on    date,                             -- resolved where it can be
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (term_id, label)
);

create table if not exists training_attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references training_sessions(id) on delete cascade,
  -- Linked to the guide roster where the names line up, so training and evals
  -- talk about the same person. Nullable because the training list is not the
  -- eval list: somebody can be trained without being up for an eval.
  guide_id    uuid references guides(id) on delete set null,
  person_name text not null,
  expectation text,
  actual      text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references members(id) on delete set null,
  unique (session_id, person_name)
);

create index if not exists training_attendance_session on training_attendance (session_id);
create index if not exists training_attendance_guide   on training_attendance (guide_id);

-- ---------------------------------------------------------------- access ---
-- Training is the training committee's tool, so they read it. Editing is a
-- codirector job, matching how the spreadsheet was actually used: one person
-- keeping it straight rather than a hundred people typing into it.
alter table training_sessions   enable row level security;
alter table training_attendance enable row level security;

drop policy if exists read_training_sessions  on training_sessions;
drop policy if exists write_training_sessions on training_sessions;
create policy read_training_sessions  on training_sessions for select using (in_training());
create policy write_training_sessions on training_sessions for all
  using (is_codirector()) with check (is_codirector());

drop policy if exists read_training_attendance  on training_attendance;
drop policy if exists write_training_attendance on training_attendance;
create policy read_training_attendance  on training_attendance for select using (in_training());
create policy write_training_attendance on training_attendance for all
  using (is_codirector()) with check (is_codirector());

-- Stamp who changed what, so a surprising edit can be traced to a person.
create or replace function touch_training() returns trigger
  language plpgsql security invoker as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

drop trigger if exists training_attendance_touch on training_attendance;
create trigger training_attendance_touch before update on training_attendance
  for each row execute function touch_training();

commit;
