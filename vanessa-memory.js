/* ============================================================ short-term memory
   What Vanessa is in the middle of, so nobody has to repeat themselves.

     workflow   the task under way — "evaluate", with its step and what has
                been decided so far (which eval, the notes, the wording).
                It lasts until it is completed, cancelled, replaced by a new
                task, or left alone for long enough to stop being relevant.
     list       the last set of things she showed (tours, people, choices),
                so "the second one" and "open it" mean something.
     focus      the one thing most recently in view, for "his tour", "that one".

   Deliberately short. After a few minutes a pronoun is a guess, and guessing
   who "him" is in an evaluation is exactly the mistake not to make — so
   references expire and anything ambiguous comes back as a choice.

   Session-bound: a different sign-in or a reset wipes all of it.
============================================================================ */
const FLOW_IDLE = 30 * 60e3;       // a task left for half an hour is over
const REF_IDLE  = 6 * 60e3;        // "that one" means nothing after a few minutes

let flow = null, list = null, focus = null, owner = null;
const listeners = new Set();
const now = () => Date.now();

/* ------------------------------------------------------------ workflow */
export function startFlow(id, step, data = {}) {
  const replaced = flow && flow.id !== id ? flow : null;
  flow = { id, step, data: { ...data }, at: now(), started: now() };
  tell();
  return replaced;
}
export function updateFlow(patch = {}) {
  if (!flow) return null;
  const { step, ...data } = patch;
  if (step) flow.step = step;
  Object.assign(flow.data, data);
  flow.at = now();
  tell();
  return flow;
}
/** Ends the task. reason: completed | cancelled | replaced | stale */
export function endFlow(reason = 'completed') {
  const was = flow;
  flow = null;
  if (was) { was.ended = reason; tell(); }
  return was;
}
export function activeFlow(id = null) {
  if (flow && now() - flow.at > FLOW_IDLE) endFlow('stale');
  if (!flow) return null;
  return !id || flow.id === id ? flow : null;
}
export const onFlowChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = () => listeners.forEach(fn => { try { fn(flow); } catch { /* never break her */ } });

/* ------------------------------------------------------------ references
   items: [{ label, sub?, kind, entity?, run() → plan }] — run is what
   "open it" does with that item. */
export function rememberList(kind, items) {
  list = items?.length ? { kind, items: items.slice(0, 12), at: now() } : items ? null : list;
  if (items?.length === 1) rememberFocus(items[0]);
}
export function rememberFocus(item) { focus = item ? { ...item, at: now() } : null; }

/** "the second one" → that item, or null if nothing clear is in view. */
export function recallOrdinal(i) {
  if (!list || now() - list.at > REF_IDLE) return null;
  const idx = i < 0 ? list.items.length - 1 : i;
  return list.items[idx] || null;
}
/** "it", "that one", "him": the single thing in view, or the choices if several are. */
export function recallFocus() {
  const fresh = x => x && now() - x.at <= REF_IDLE;
  if (fresh(focus)) return { item: focus };
  if (fresh(list) && list.items.length === 1) return { item: list.items[0] };
  if (fresh(list) && list.items.length > 1) return { choices: list.items };
  return null;
}
export const lastList = () => (list && now() - list.at <= REF_IDLE ? list : null);

/* ------------------------------------------------------------ routes, for "go back" */
const trail = [];
export function noteRoute(id) {
  if (trail[trail.length - 1] !== id) trail.push(id);
  if (trail.length > 12) trail.shift();
}
export function previousRoute() {
  return trail.length > 1 ? trail[trail.length - 2] : null;
}

export function resetMemory(who = null) {
  flow = null; list = null; focus = null; owner = who; trail.length = 0;
  tell();
}
export const memoryOwner = () => owner;
