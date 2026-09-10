-- ============================================================================
-- Codirector Hub v2 — operations that have to be all-or-nothing
--
-- Most things the app does are a single row change and go straight through the
-- API: claiming an eval, ticking someone in, setting a score, recording a
-- decision. Those are safe as plain updates because Postgres does them
-- atomically anyway.
--
-- Claiming, for instance, is just:
--     update evals set evaluator_id = <you> where id = ? and evaluator_id is null
-- Two people racing for the same guide: one gets a row back, the other gets
-- none and is told it was taken. No lock, no function needed.
--
-- What IS in here is the handful of operations that touch more than one row and
-- would leave a mess if they stopped halfway.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Anyone invited into the project gets a members row automatically.
--
-- Without this there is a chicken-and-egg problem: writing to members requires
-- being a codirector, and being a codirector requires a members row.
--
-- This assumes signups are INVITE ONLY. Turn off open signup in the dashboard
-- (Authentication -> Providers -> Email -> disable "Allow new users to sign
-- up"), or anyone on the internet with an email address becomes a member.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (id, full_name, email)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      initcap(replace(split_part(new.email, '@', 1), '.', ' '))
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Submitting an eval.
--
-- Two things happen together — the written feedback is stored and the eval is
-- stamped as submitted — and it would be bad to end up with either one alone.
--
-- Deliberately idempotent. In the old app a dropped reply meant the person was
-- told it failed, retyped several paragraphs, submitted again, and got
-- "already submitted" — which read like a second failure when in fact both had
-- worked. Sending this twice now simply returns the eval that is already there.
-- ---------------------------------------------------------------------------
create or replace function submit_eval(
  p_eval_id   uuid,
  p_rating    smallint default null,
  p_went_well text default null,
  p_improve   text default null,
  p_notes     text default null
) returns jsonb language plpgsql security invoker as $$
declare
  v_eval evals;
begin
  select * into v_eval from evals where id = p_eval_id for update;

  if not found then
    raise exception 'That guide is no longer on the tracker. Refresh and try again.';
  end if;

  if v_eval.submitted_at is not null then
    if v_eval.evaluator_id = auth.uid() then
      return jsonb_build_object(
        'eval_id', v_eval.id, 'already', true,
        'message', 'That eval was already saved.');
    end if;
    raise exception 'An eval for this guide has already been submitted by somebody else.';
  end if;

  if v_eval.evaluator_id is distinct from auth.uid() and not is_codirector() then
    raise exception 'That guide is claimed by somebody else.';
  end if;

  insert into eval_submissions (eval_id, rating, went_well, improve, notes, submitted_by)
  values (p_eval_id, p_rating, p_went_well, p_improve, p_notes, auth.uid());

  update evals
     set submitted_at = now(),
         evaluator_id = coalesce(evaluator_id, auth.uid())
   where id = p_eval_id;

  insert into activity_log (actor_id, action, detail)
  values (auth.uid(), 'submit', 'eval ' || p_eval_id);

  return jsonb_build_object(
    'eval_id', p_eval_id, 'already', false, 'message', 'Eval submitted.');
end $$;

-- ---------------------------------------------------------------------------
-- End of semester rollover.
--
-- The old version rewrote the tracker in place: last semester's record was
-- destroyed to make room, and running it a second time moved all 103 guides up
-- an extra tier with no way back. Since a dropped reply made a second click the
-- obvious thing to do, that was a real risk rather than a theoretical one.
--
-- This inserts the next term's evals instead of overwriting anything, so every
-- past term stays readable. The insert into rollovers is the guard: its primary
-- key means the same promotion cannot be applied twice, no timers involved.
-- ---------------------------------------------------------------------------
create or replace function run_rollover(
  p_from_term text,
  p_to_term   text,
  p_dry_run   boolean default true
) returns jsonb language plpgsql security invoker as $$
declare
  v_promoted   int := 0;
  v_already    int := 0;
  v_untouched  int := 0;
  v_moves      jsonb := '{}'::jsonb;
  r            record;
  v_next       text;
begin
  if not is_codirector() then
    raise exception 'Only codirectors can run the end of semester rollover.';
  end if;

  if not exists (select 1 from terms where id = p_to_term) then
    raise exception 'There is no term called "%". Create it first.', p_to_term;
  end if;

  if not p_dry_run and exists (
       select 1 from rollovers where from_term = p_from_term and to_term = p_to_term) then
    raise exception
      'That rollover has already been run. Nothing was changed. Look at the tracker: the priorities have already moved.';
  end if;

  for r in
    select e.id, e.guide_id, e.priority, p.sort_order, p.needs_eval
      from evals e join priorities p on p.name = e.priority
     where e.term_id = p_from_term
  loop
    if not r.needs_eval then
      v_untouched := v_untouched + 1;
      v_next := r.priority;
    elsif r.sort_order <= 1 then
      v_already := v_already + 1;
      v_next := r.priority;
    else
      select name into v_next from priorities
       where sort_order = r.sort_order - 1 and needs_eval
       limit 1;
      v_next := coalesce(v_next, r.priority);
      v_promoted := v_promoted + 1;
      v_moves := jsonb_set(v_moves, array[r.priority || ' -> ' || v_next],
                   to_jsonb(coalesce((v_moves->>(r.priority || ' -> ' || v_next))::int, 0) + 1));
    end if;

    if not p_dry_run then
      insert into evals (term_id, guide_id, priority)
      values (p_to_term, r.guide_id, v_next)
      on conflict (term_id, guide_id) do nothing;
    end if;
  end loop;

  if not p_dry_run then
    insert into rollovers (from_term, to_term, ran_by)
    values (p_from_term, p_to_term, auth.uid());

    update terms set is_current = false where is_current;
    update terms set is_current = true  where id = p_to_term;

    insert into activity_log (actor_id, action, detail)
    values (auth.uid(), 'rollover',
            p_from_term || ' -> ' || p_to_term || ': ' || v_promoted || ' promoted');
  end if;

  return jsonb_build_object(
    'dry_run',   p_dry_run,
    'promoted',  v_promoted,
    'already_top', v_already,
    'untouched', v_untouched,
    'moves',     v_moves,
    'message',   case when p_dry_run
                   then 'Preview only — nothing was changed.'
                   else 'Rollover complete: ' || v_promoted || ' guides moved up.' end);
end $$;

grant execute on function submit_eval  to authenticated;
grant execute on function run_rollover to authenticated;
