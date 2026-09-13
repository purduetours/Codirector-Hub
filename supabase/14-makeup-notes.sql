-- ============================================================================
-- Codirector Hub — evidence for a completed makeup
--
-- "Makeup Completed" currently records that something happened but not what or
-- when. If a guide later disputes a strike, or a codirector hands over
-- mid-term, there is nothing behind the word — and the person who marked it is
-- the only one who knows.
--
-- Both columns are optional. Marking a makeup done without them still works
-- exactly as before; this only makes it possible to say more.
-- ============================================================================
begin;

alter table training_attendance add column if not exists makeup_on   date;
alter table training_attendance add column if not exists makeup_note text;

comment on column training_attendance.makeup_on   is 'When the makeup was actually done.';
comment on column training_attendance.makeup_note is 'What it was — a session attended, a task, a conversation.';

-- Clearing the outcome clears its evidence, so a row can never claim a makeup
-- happened on a date while saying the person is still absent.
create or replace function clear_makeup_evidence() returns trigger
  language plpgsql security invoker as $$
begin
  if new.actual is distinct from 'Makeup Completed' then
    new.makeup_on := null;
    new.makeup_note := null;
  end if;
  return new;
end $$;

drop trigger if exists training_makeup_evidence on training_attendance;
create trigger training_makeup_evidence before insert or update on training_attendance
  for each row execute function clear_makeup_evidence();

commit;
