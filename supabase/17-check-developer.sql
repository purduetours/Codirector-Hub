-- Read-only check that the Developer can open submitted evals.
-- Every row should say ok = true. Changes nothing.
select
  m.full_name,
  m.role,
  m.active,
  coalesce(r.in_training, false)              as eval_tracker_on,
  (select count(*) from eval_submissions)     as submissions_in_db,
  (m.active and m.role = 'Developer' and coalesce(r.in_training, false)) as ok
from members m
left join roles r on r.name = m.role
where m.role ilike '%dev%';
