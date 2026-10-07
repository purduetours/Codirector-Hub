/* ============================================================ conversation state
   Short-lived and in memory only. It holds what she is currently talking about (a person,
   a tour, a session), the last list she showed (so "the first one" has a meaning), the
   dialog state (engine/dialog.js), and the pending action.

   It is NOT a source of facts. Names and ids in here are pointers; anything
   about a person (role, evaluation status, attendance) is re-read from the Hub
   every time it's needed. It is dropped when the account changes, on "new
   conversation", and after a long idle period.
*/
const IDLE_MS = 45 * 60e3;

export function newConversation(owner = '') {
  return { owner, at: Date.now(), messages: [], turns: 0, agent: { focus: {}, lists: {}, proposals: null, dialog: null }, pending: null, receipts: [] };
}
export const isStale = c => !c || Date.now() - c.at > IDLE_MS;

/** Small structured recap of where the conversation is, sent as context (never as chat). */
export function recap(c) {
  const f = c.agent.focus || {}, l = c.agent.lists || {};
  const out = {};
  if (f.person) out.person = f.person;
  if (f.tour) out.tour = f.tour;
  if (f.session) out.session = f.session;
  if (l.last?.items?.length) out.last_list = { kind: l.last.kind, items: l.last.items.slice(0, 8) };
  if (c.agent.proposals?.matches?.length) out.eval_matches_available = c.agent.proposals.matches.slice(0, 5).map(m => ({ match_id: m.mid, guide: m.guideName, evaluator: m.evaluatorName, date: m.date }));
  if (c.pending) out.pending_action = { summary: c.pending.prepared.summary, risk: c.pending.prepared.risk };
  return out;
}

export function remember(c, result) {
  if (result.focus) c.agent.focus = { ...c.agent.focus, ...Object.fromEntries(Object.entries(result.focus).filter(([, v]) => v)) };
  if (result.list) c.agent.lists.last = { kind: result.list.kind, items: result.list.items.slice(0, 30) };
}
