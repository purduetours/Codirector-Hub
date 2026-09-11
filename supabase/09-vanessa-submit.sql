-- Run once in the existing project's Supabase SQL Editor.
-- Requires the hub's existing tables, RLS policies, is_member(), and submit_eval().
-- Keep the existing manual form; Vanessa uses this narrower atomic operation.
begin;

create or replace function public.submit_own_eval(
  p_eval_id uuid,
  p_rating smallint default null,
  p_went_well text default null,
  p_improve text default null,
  p_notes text default null,
  p_tour_date date default null,
  p_tour_time time without time zone default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_eval public.evals%rowtype;
  v_saved public.eval_submissions%rowtype;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception 'Sign in with an active hub account.';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'The rating must be between 1 and 5.';
  end if;
  if coalesce(trim(p_went_well), '') = '' and coalesce(trim(p_improve), '') = '' then
    raise exception 'Add strengths or areas to improve before submitting.';
  end if;
  if greatest(length(coalesce(p_went_well,'')),length(coalesce(p_improve,'')),length(coalesce(p_notes,''))) > 12000 then
    raise exception 'Keep each feedback field under 12000 characters.';
  end if;

  -- Read without FOR UPDATE so exact retries also work with the existing
  -- policy that forbids updating submitted rows. The conditional UPDATE below
  -- takes the row lock and rechecks ownership before any new submission.
  select * into v_eval from public.evals where id = p_eval_id;
  if not found or v_eval.evaluator_id is distinct from auth.uid() then
    raise exception 'This evaluation is no longer claimed by you.';
  end if;

  if v_eval.submitted_at is not null then
    select * into v_saved from public.eval_submissions
      where eval_id = p_eval_id and submitted_by = auth.uid();
    if found
      and v_saved.rating is not distinct from p_rating
      and coalesce(v_saved.went_well,'') = coalesce(p_went_well,'')
      and coalesce(v_saved.improve,'') = coalesce(p_improve,'')
      and coalesce(v_saved.notes,'') = coalesce(p_notes,'')
      and v_eval.tour_date is not distinct from p_tour_date
      and v_eval.tour_time is not distinct from p_tour_time then
      return jsonb_build_object('eval_id',p_eval_id,'already',true,'message','This evaluation was already saved.','receipt',to_jsonb(v_saved) || jsonb_build_object('tour_date',v_eval.tour_date,'tour_time',v_eval.tour_time));
    end if;
    raise exception 'An evaluation is already saved for this guide. This draft was not used; review Eval Tracker.';
  end if;

  update public.evals set tour_date=p_tour_date,tour_time=p_tour_time
    where id=p_eval_id and evaluator_id=auth.uid() and submitted_at is null;
  if not found then
    raise exception 'The evaluation could not be updated. Check your access.';
  end if;
  -- Existing audit log and submission behavior execute in the same transaction.
  -- If anything fails, the date/time update rolls back as well.
  perform public.submit_eval(p_eval_id,p_rating,p_went_well,p_improve,p_notes);
  select * into v_saved from public.eval_submissions where eval_id=p_eval_id;
  return jsonb_build_object('eval_id',p_eval_id,'already',false,'receipt',to_jsonb(v_saved) || jsonb_build_object('tour_date',p_tour_date,'tour_time',p_tour_time));
end;
$$;

revoke all on function public.submit_own_eval(uuid,smallint,text,text,text,date,time without time zone) from public;
revoke all on function public.submit_own_eval(uuid,smallint,text,text,text,date,time without time zone) from anon;
grant execute on function public.submit_own_eval(uuid,smallint,text,text,text,date,time without time zone) to authenticated;

commit;
