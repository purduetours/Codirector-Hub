-- ============================================================================
-- Codirector Hub v2 — schema
--
-- Replaces the Google Sheets + Apps Script backend. Written to be read by
-- whoever inherits this after Logan, so it is commented more heavily than a
-- schema normally would be.
--
-- The single most important line in this file is the primary key on
-- interview_scores. That is what fixes the interview-day freeze: two people
-- grading the same candidate now write two different rows instead of queueing
-- behind one lock on one spreadsheet.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- people ---
-- One row per real person, tied to a real login. The old app asked people to
-- type their own name into a free-text box, so "Sam", "sam" and a typo were
-- three different evaluators and someone's own submitted evals could vanish
-- from their view forever. A name that comes from the account cannot drift.
create table members (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text unique,
  is_codirector boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index on members (active) where active;

-- ---------------------------------------------------------------- terms ----
create table terms (
  id         text primary key,               -- 'fall-2026'
  label      text not null,                  -- 'Fall 2026'
  is_current boolean not null default false
);

-- only one term can be current
create unique index one_current_term on terms (is_current) where is_current;

-- =================================================== EVAL TRACKER ==========

create table guides (
  id         uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name  text not null,
  full_name  text generated always as (first_name || ' ' || last_name) stored,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index on guides (last_name);

-- The priority ladder, lowest first. Kept as a table rather than a hardcoded
-- list so a codirector can rename a tier without a code change.
create table priorities (
  name       text primary key,
  sort_order int  not null,
  needs_eval boolean not null default true   -- false = "No Need to Eval"
);

insert into priorities (name, sort_order, needs_eval) values
  ('First Priority to Eval',  1, true),
  ('Second Priority',         2, true),
  ('Third Priority',          3, true),
  ('Fourth Priority',         4, true),
  ('Fifth Priority',          5, true),
  ('Last Priority',           6, true),
  ('No Need to Eval',         7, false),
  ('Not Needed to be Evaled', 8, false);

-- One eval per guide per term.
--
-- The old rollover WIPED these columns in place, so last semester's record was
-- destroyed to make room for this one, and running it twice moved everybody up
-- two tiers with no way back. Keying on term means rollover inserts new rows
-- and history simply accumulates.
create table evals (
  id               uuid primary key default gen_random_uuid(),
  term_id          text not null references terms(id),
  guide_id         uuid not null references guides(id) on delete cascade,
  priority         text not null references priorities(name),
  evaluator_id     uuid references members(id) on delete set null,
  tour_date        date,
  tour_time        time,
  scheduling_notes text,
  claimed_at       timestamptz,
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  unique (term_id, guide_id)
);

create index on evals (term_id);
create index on evals (evaluator_id);

-- The written feedback, kept separate so it survives everything above it.
create table eval_submissions (
  id           uuid primary key default gen_random_uuid(),
  eval_id      uuid not null unique references evals(id) on delete cascade,
  rating       smallint check (rating between 1 and 5),
  went_well    text,
  improve      text,
  notes        text,
  submitted_by uuid references members(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Rollover, recorded rather than guessed at.
--
-- The primary key is the guard: the same promotion cannot be applied twice, so
-- a dropped reply followed by an impatient second click is a no-op instead of
-- moving all 103 guides up an extra tier.
create table rollovers (
  from_term text not null references terms(id),
  to_term   text not null references terms(id),
  ran_at    timestamptz not null default now(),
  ran_by    uuid references members(id) on delete set null,
  primary key (from_term, to_term)
);

-- =================================================== INTERVIEWS ============

create table interview_cycles (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,                  -- 'Fall 2026'
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index one_current_cycle on interview_cycles (is_current) where is_current;

create table interview_groups (
  cycle_id   uuid not null references interview_cycles(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  primary key (cycle_id, name)
);

-- Who is on the panel this cycle.
create table interview_panel (
  cycle_id  uuid not null references interview_cycles(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (cycle_id, member_id)
);

create table candidates (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references interview_cycles(id) on delete cascade,
  name          text not null,
  -- TEXT, deliberately. 93 of the 95 real PUIDs begin with a zero and three of
  -- them contain a dash. Anything numeric destroys them.
  puid          text,
  year          text,
  grad          text,                        -- free text: "May 2029/30?" is real
  major         text,
  email         text,
  group_name    text,
  checked_in_at timestamptz,
  decision      text check (decision in ('Yes','Maybe','No')),
  decided_by    uuid references members(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index on candidates (cycle_id);

-- ---------------------------------------------------------------------------
-- THE FIX.
--
-- The spreadsheet held one COLUMN per interviewer per criterion, so every save
-- was a read-modify-write of a shared row and had to take a global lock. Nine
-- interviewers therefore graded strictly one at a time, ~3 seconds each, and
-- the client retried five times into that same queue.
--
-- One row per interviewer per candidate means two people grading the same
-- person touch two different rows. No lock, no queue, no collision, ever.
-- ---------------------------------------------------------------------------
create table interview_scores (
  candidate_id   uuid not null references candidates(id) on delete cascade,
  interviewer_id uuid not null references members(id) on delete cascade,
  speaking       smallint check (speaking   between 1 and 5),
  personable     smallint check (personable between 1 and 5),
  impression     smallint check (impression between 1 and 5),
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (candidate_id, interviewer_id)
);

create index on interview_scores (interviewer_id);

-- =================================================== SHARED ================

create table announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  author_id  uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table activity_log (
  id         bigserial primary key,
  actor_id   uuid references members(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index on activity_log (created_at desc);
