import { update } from '../core/db.js';
import { state, inTraining, isAdmin } from '../core/state.js';

/** Shared by the tracker and Vanessa. Conditional writes protect stale cards. */
export async function changeEvaluation(kind, g, {date = null, time = null, notes = null} = {}) {
  if (!state.me || !inTraining()) throw new Error('Evaluation actions require training access.');
  if (!g?.id || g.submitted) throw new Error('This evaluation has already been submitted or is unavailable.');
  if (kind !== 'claim' && !isAdmin() && g.evaluatorId !== state.me.id) throw new Error('You can only change your own claimed evaluation.');
  if (!['claim', 'release', 'schedule'].includes(kind)) throw new Error('Unknown evaluation action.');
  let filter = `id=eq.${encodeURIComponent(g.id)}&submitted_at=is.null`;
  const patch = kind === 'release'
    ? {evaluator_id:null, claimed_at:null, tour_date:null, tour_time:null}
    : {tour_date:date, tour_time:time, scheduling_notes:notes};
  if (kind === 'claim') {
    filter += '&evaluator_id=is.null';
    Object.assign(patch, {evaluator_id:state.me.id, claimed_at:new Date().toISOString()});
  } else {
    if (!g.evaluatorId) throw new Error('This evaluation is no longer claimed.');
    filter += `&evaluator_id=eq.${encodeURIComponent(g.evaluatorId)}`;
    // A review must still describe the schedule the person saw.
    filter += g.date ? `&tour_date=eq.${encodeURIComponent(g.date)}` : '&tour_date=is.null';
    filter += g.time ? `&tour_time=eq.${encodeURIComponent(g.time)}` : '&tour_time=is.null';
  }
  const rows = await update('evals', filter, patch);
  if (!rows?.length) throw new Error('This evaluation changed. Refresh it before trying again.');
  return rows[0];
}
