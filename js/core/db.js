/* ============================================================ database
   Everything the app reads or writes goes through here.

   This replaces the old Apps Script client wholesale. Worth knowing what is
   gone along with it:

     - No lock. Two people can write at the same moment.
     - No retry storm. Requests answer in well under a second, so there is
       nothing to retry into. The old five-attempt policy is exactly what
       turned nine interviewers into forty queued requests on the day.
     - No "the write landed but the reply got lost". A failure here is a real
       failure, so the app can say so plainly.

   Permissions are NOT enforced in this file. They are enforced by the database
   on every single query, whatever this code asks for. If a committee member
   requests somebody else's submitted eval, Postgres returns nothing.
============================================================================ */
import { state } from './state.js';

const cfg = () => window.CONFIG || {};

/** Raw REST call against PostgREST. */
async function rest(path, opts = {}) {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = cfg();
  if (!url || !key) throw new Error('config.js is missing the database address or key.');

  let res;
  try {
    res = await fetch(`${url}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: key,
        Authorization: `Bearer ${state.token || key}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }

  if (!res.ok) {
    // Postgres speaks in constraint names; turn the ones people will actually
    // hit into something a committee member can act on.
    const msg = (data && (data.message || data.hint)) || `Server returned ${res.status}.`;
    if (res.status === 401 || res.status === 403) {
      throw new Error('Your sign-in has expired. Refresh the page and sign in again.');
    }
    throw new Error(msg);
  }
  return data;
}

/** SELECT. `query` is PostgREST syntax, e.g. 'select=*&order=last_name'. */
export function select(table, query = 'select=*') {
  return rest(`${table}?${query}`);
}

/** UPDATE, returning the rows that actually changed. */
export function update(table, filter, patch) {
  return rest(`${table}?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
}

/** INSERT or UPDATE in one go, keyed on the table's primary key. */
export function upsert(table, rows, onConflict) {
  const q = onConflict ? `?on_conflict=${onConflict}` : '';
  return rest(`${table}${q}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
  });
}

export function insert(table, rows) {
  return rest(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
  });
}

export function remove(table, filter) {
  return rest(`${table}?${filter}`, { method: 'DELETE' });
}

/** Call one of the database functions (submit_eval, run_rollover, ...). */
export function rpc(name, args = {}) {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/* ------------------------------------------------------------------ shapes
   The modules were written against the old Apps Script payloads and they look
   right, so rather than rewrite the screens the rows are reshaped here to
   match what those modules already expect.
-------------------------------------------------------------------------- */

/** eval_roster row -> the guide object the Eval Tracker renders. */
export function toGuide(r) {
  return {
    id:        r.id,               // the eval, which is what every action acts on
    guideId:   r.guide_id,
    first:     r.first_name,
    last:      r.last_name,
    name:      r.full_name,
    priority:  r.priority || '',
    rank:      r.priority_rank ?? 99,
    skip:      !r.needs_eval,
    date:      r.tour_date || '',
    time:      (r.tour_time || '').slice(0, 5),
    evaluator: r.evaluator_name || '',
    evaluatorId: r.evaluator_id,
    submitted: !!r.submitted_at,
    reviewed:  !!r.reviewed_at,
    claimedAt: r.claimed_at || '',
    notes:     r.scheduling_notes || '',
    status:    r.status,
    tours:     []                  // filled from the tour schedule workbook later
  };
}

/** candidate_results row -> the candidate object the Interviews screen renders. */
export function toCandidate(r) {
  return {
    key:      r.id,
    name:     r.name,
    puid:     r.puid || '',
    year:     r.year || '',
    grad:     r.grad || '',
    major:    r.major || '',
    email:    r.email || '',
    group:    r.group_name || '',
    checkin:  r.checked_in ? 'Yes' : '',
    decision: r.decision || '',
    raters:   r.raters || 0,
    spk:      r.speaking   === null ? null : Number(r.speaking),
    per:      r.personable === null ? null : Number(r.personable),
    imp:      r.impression === null ? null : Number(r.impression),
    final:    r.final      === null ? null : Number(r.final),
    spread:   r.spread     === null ? null : Number(r.spread),
    scores:   {},                  // filled in by the Interviews module
    comments: {}
  };
}
