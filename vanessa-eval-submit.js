/* Submit an explicitly reviewed chat draft through the existing eval API. */
import { state, inTraining } from './state.js';
import { rpc } from './db.js';
import { refreshIfStale } from './auth.js';

export function validateEvalDraft(draft) {
  if (!draft || !draft.evalId) throw new Error('Choose an evaluation first.');
  if (draft.rating !== null && (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5))
    throw new Error('Choose a rating from 1 to 5, or leave it blank.');
  if (!String(draft.wentWell || '').trim() && !String(draft.improve || '').trim())
    throw new Error('Add feedback under What went well or Areas to improve.');
  for (const key of ['wentWell','improve','notes']) {
    if (typeof draft[key] !== 'string' || draft[key].length > 12000) throw new Error('Keep each feedback field under 12,000 characters.');
  }
  if (draft.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new Error('Use YYYY-MM-DD for the tour date.');
    const d = new Date(draft.date + 'T12:00:00Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== draft.date) throw new Error('Enter a valid tour date.');
  }
  if (draft.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error('Use a valid 24-hour tour time, such as 14:30.');
}
export async function submitReviewedEval(draft) {
  validateEvalDraft(draft);
  const owner = state.me?.id, version = state.sessionVersion;
  if (!owner || !inTraining() || draft.owner !== owner) throw new Error('Sign in with the account that created this draft.');
  const stillCurrent = () => {
    if (version !== state.sessionVersion || state.me?.id !== owner) throw new Error('Your account changed. Start a new draft.');
  };
  if (state.refreshToken && !(await refreshIfStale())) throw new Error('Your sign-in expired. Sign in again before submitting.');
  stillCurrent();
  let result;
  try {
    result = await rpc('submit_own_eval', {
      p_eval_id:draft.evalId, p_rating:draft.rating,
      p_went_well:draft.wentWell, p_improve:draft.improve, p_notes:draft.notes,
      p_tour_date:draft.date || null, p_tour_time:draft.time || null
    });
  } catch(err) {
    if (/submit_own_eval.*(?:schema|cache|not find|not exist)|(?:not find|not exist).*submit_own_eval/i.test(err.message))
      throw new Error('Chat submission needs the included 09-vanessa-submit.sql setup. Your draft has not been discarded.');
    throw err;
  }
  stillCurrent();
  if (!result || result.eval_id !== draft.evalId) throw new Error('The server did not confirm the save. Check Eval Tracker or retry this same draft.');
  let receipt='';
  const saved=result.receipt;
  if(saved && saved.eval_id===draft.evalId && saved.submitted_by===owner){
    receipt=`Receipt: ${saved.id}\nSaved: ${saved.created_at}\nTour: ${saved.tour_date||'Not set'} ${saved.tour_time||''} (Purdue local time)\nRating: ${saved.rating??'Not rated'}\nWhat went well: ${saved.went_well||'None'}\nAreas to improve: ${saved.improve||'None'}\nOther notes: ${saved.notes||'None'}`;
  }else receipt='Detailed receipt unavailable with the current server setup. Your evaluation was confirmed saved; view it in Eval Tracker.';
  if (result.already) return { message:'This evaluation was already saved.', already:true, receipt };
  return { message: 'Eval submitted.', already: false, receipt };
}
