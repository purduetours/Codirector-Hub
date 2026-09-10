-- ============================================================================
-- Codirector Hub v2 — computed views
--
-- The old backend STORED the averages in spreadsheet columns and recalculated
-- them inside the write lock on every save, which is most of why grading was
-- slow. Here they are views: never stored, never stale, nothing to recalculate,
-- and no lock involved.
--
-- The arithmetic deliberately matches the old app exactly:
--   speaking   = mean of the interviewers who scored speaking   (blanks ignored)
--   personable = mean of the interviewers who scored personable (blanks ignored)
--   impression = mean of the interviewers who scored impression (blanks ignored)
--   final      = mean of those three means, ignoring any that are absent
--   raters     = interviewers who scored at least one of the three
--
-- SECURITY_INVOKER on both views is not optional. A Postgres view normally runs
-- with its owner's rights, which would step straight past the row level security
-- on the tables beneath it -- and eval_roster would then show every committee
-- member every submitted eval in the program, which is the one thing the whole
-- permission model exists to prevent.
--
-- final is NOT the mean of every individual number. Averaging each criterion
-- first is what stops one interviewer skipping one box from dragging a
-- candidate down. avg() ignores NULLs natively, which is exactly the behaviour
-- we want and the reason none of this needs COALESCE.
-- ============================================================================

create or replace view candidate_results with (security_invoker = true) as
with rater as (
  select
    s.candidate_id,
    s.interviewer_id,
    s.speaking, s.personable, s.impression,
    -- this one rater's own mean across the criteria they actually filled in
    (select avg(v) from unnest(array[s.speaking, s.personable, s.impression]) as v)
      as rater_mean
  from interview_scores s
),
agg as (
  select
    candidate_id,
    count(*) filter (where rater_mean is not null)      as raters,
    avg(speaking)                                       as speaking,
    avg(personable)                                     as personable,
    avg(impression)                                     as impression,
    -- how far apart the raters were. This is the signal a human cannot see at
    -- a glance and the thing worth flagging for discussion.
    max(rater_mean) - min(rater_mean)                    as spread,
    stddev_samp(rater_mean)                              as stddev
  from rater
  group by candidate_id
)
select
  c.id,
  c.cycle_id,
  c.name,
  c.puid,
  c.year,
  c.grad,
  c.major,
  c.email,
  c.group_name,
  c.checked_in_at,
  (c.checked_in_at is not null)                          as checked_in,
  c.decision,
  coalesce(a.raters, 0)                                  as raters,
  a.speaking,
  a.personable,
  a.impression,
  (select avg(v) from unnest(array[a.speaking, a.personable, a.impression]) as v)
                                                         as final,
  a.spread,
  a.stddev
from candidates c
left join agg a on a.candidate_id = c.id;

-- ---------------------------------------------------------------------------
-- The eval roster, with the status the app has always shown.
-- ---------------------------------------------------------------------------
create or replace view eval_roster with (security_invoker = true) as
select
  e.id,
  e.term_id,
  e.guide_id,
  g.first_name,
  g.last_name,
  g.full_name,
  e.priority,
  p.sort_order              as priority_rank,
  p.needs_eval,
  e.evaluator_id,
  m.full_name               as evaluator_name,
  e.tour_date,
  e.tour_time,
  e.scheduling_notes,
  e.claimed_at,
  e.submitted_at,
  e.reviewed_at,
  case
    when not p.needs_eval        then 'skip'
    when e.reviewed_at  is not null then 'reviewed'
    when e.submitted_at is not null then 'submitted'
    when e.evaluator_id is not null then 'claimed'
    else                                 'open'
  end                       as status
from evals e
join guides     g on g.id = e.guide_id
join priorities p on p.name = e.priority
left join members m on m.id = e.evaluator_id;
