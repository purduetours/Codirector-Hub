-- ============================================================================
-- Codirector Hub  -  training edit history, so a change can be undone
--
-- The table already recorded WHO changed a row and WHEN. It never recorded
-- what the value had been, which is the one thing needed to put it back.
--
-- This term that gap cost real work: dozens of attendance rows were rewritten
-- twice, and the only reason the correct values could be restored was that the
-- original spreadsheet still existed to compare against. Once the hub is the
-- only copy, that is not a recovery plan.
--
-- One row per change, written by a trigger so nothing can edit attendance
-- without leaving a trace. Insert-only: history that can be edited is not
-- history.
-- ============================================================================
begin;

create table if not exists training_history (
  id           bigserial primary key,
  attendance_id uuid not null references training_attendance(id) on delete cascade,
  person_name  text not null,
  session_id   uuid,
  field        text not null,               -- 'actual' or 'expectation'
  was          text,
  became       text,
  changed_by   uuid references members(id) on delete set null,
  changed_at   timestamptz not null default now()
);

create index if not exists training_history_recent on training_history (changed_at desc);
create index if not exists training_history_row    on training_history (attendance_id);

alter table training_history enable row level security;

drop policy if exists read_training_history on training_history;
drop policy if exists no_write_history      on training_history;

-- Readable by the training committee, writable by nobody: the trigger runs as
-- the definer and is the only thing that may add to it.
create policy read_training_history on training_history for select using (in_training());

create or replace function log_training_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.actual is distinct from old.actual then
    insert into training_history (attendance_id, person_name, session_id, field, was, became, changed_by)
    values (new.id, new.person_name, new.session_id, 'actual', old.actual, new.actual, auth.uid());
  end if;
  if new.expectation is distinct from old.expectation then
    insert into training_history (attendance_id, person_name, session_id, field, was, became, changed_by)
    values (new.id, new.person_name, new.session_id, 'expectation', old.expectation, new.expectation, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists training_attendance_history on training_attendance;
create trigger training_attendance_history after update on training_attendance
  for each row execute function log_training_change();

commit;
