/* ============================================================ remembering what we're talking about
   Structured conversation state, kept independently of any language model:

     subject     the area we're in ('evaluation', 'schedule', 'training' ...)
     query       the last request that worked (intent + filters)
     resultSet   the last list shown ("the first one" means something)
     selected    the match or person she last singled out ("set it up")
     awaiting    a question she asked and is waiting on ("which Jordan?")

   plus the pointers the tools keep (conv.agent.focus: person, tour, session) and the
   pending action. Follow-ups are resolved from this, deterministically, so
   "what about Thursday?" still means evaluations after "who still needs evaluated?"
   whether or not a model is running.

   It is a set of pointers, never a source of facts: names and ids in here are re-read
   from the Hub whenever they're used. Dropped when the account changes, on "new
   conversation", and after twenty idle minutes.
*/
import { chooseFrom, peopleEntries } from './extract.js';
import { handlerFor } from '../capabilities/index.js';

export const DIALOG_TTL = 20 * 60e3;

export function dialogOf(conv) {
  const a = conv.agent;
  if (!a.dialog) a.dialog = { at: 0, subject: null, query: null, resultSet: null, selected: null, awaiting: null };
  return a.dialog;
}
export const fresh = (d, now = Date.now()) => !!d && d.at > 0 && now - d.at < DIALOG_TTL;
export const clearDialog = conv => { conv.agent.dialog = { at: 0, subject: null, query: null, resultSet: null, selected: null, awaiting: null }; };

/** The state under the names the design uses (also what the tests assert on). */
export function view(conv) {
  const d = dialogOf(conv), f = conv.agent.focus || {};
  return { currentPerson: f.person || null, currentTour: f.tour || null, currentTraining: f.session || null, currentEvaluation: d.selected?.kind === 'match' ? d.selected : null,
    currentDateRange: d.query?.filters?.dateRange || null, previousResultSet: d.resultSet, pendingAction: conv.pending ? { summary: conv.pending.prepared.summary, risk: conv.pending.risk } : null, subject: d.subject, awaiting: d.awaiting ? d.awaiting.question : null };
}

/** After a request ran: what to remember. */
export function record(conv, { query, resultSet, selected, now = Date.now() }) {
  const d = dialogOf(conv), h = handlerFor(query.intent);
  d.at = now; d.query = { intent: query.intent, filters: query.filters, text: query.text, tags: query.tags, tokens: query.tokens };
  d.subject = query.intent.split('.')[0] === 'assistant' ? d.subject : query.intent.split('.')[0];
  if (resultSet) d.resultSet = resultSet;
  if (selected !== undefined) d.selected = selected; else if (h?.mode === 'read' && !['evaluation.opportunities', 'evaluation.assign'].includes(query.intent)) d.selected = null;
  d.awaiting = null;
}

/* ------------------------------------------------------------- follow-ups */
const MORE = /^(?:more|show more|see more|the rest|show me the rest|show all|show them all|list them all|list all|everyone|all of them|all)$/;
const WHY = /^(?:why|why is that|why them|why him|why her|why that one|why this one|how come|explain|explain that|what makes (?:them|that one|him|her) the best)$/;
const SLOT_FILTER = { when: 'dateRange', priority: 'priority', major: 'major', count: 'limit', status: 'status', session: 'session', requirement: 'requirement', attendance: 'attendance' };

/** Which slots a message carries on its own, as {filter, value}. */
export function slotsOf(ent) {
  const s = [];
  if (ent.when) s.push(['dateRange', ent.when]);
  if (ent.people.length) s.push(['people', peopleEntries(ent.people)]);
  if (ent.priority) s.push(['priority', ent.priority]);
  if (ent.major) s.push(['major', ent.major]);
  if (ent.count != null) s.push(['limit', ent.count]);
  if (ent.status) s.push(['status', ent.status]);
  if (ent.session) s.push(['session', ent.session]);
  if (ent.requirement) s.push(['requirement', ent.requirement]);
  if (ent.attendance) s.push(['attendance', ent.attendance]);
  return s;
}

/**
 * Is this message a continuation of the last request? Returns what to run next, or null.
 * Only called when nothing in the sentence is strong enough to stand on its own.
 */
export function followUp({ ent, norm, dialog, now = Date.now() }) {
  if (!fresh(dialog, now) || !dialog.query) return null;
  const last = dialog.query, h = handlerFor(last.intent);
  if (!h) return null;
  const bare = norm.replace(/\b(?:please|ok|okay|then|so|and|also)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (MORE.test(bare)) return { kind: 'more', query: { ...last, filters: { ...last.filters, limit: Math.min(30, (last.filters.limit || 6) * 3) }, source: 'followup' } };
  if (WHY.test(bare)) return { kind: 'why' };

  if (ent.ordinal != null && dialog.resultSet?.items?.length) {
    const items = dialog.resultSet.items, it = ent.ordinal === -1 ? items[items.length - 1] : items[ent.ordinal];
    if (!it) return { kind: 'out_of_range', count: items.length };
    if (dialog.resultSet.kind === 'matches') return { kind: 'pick', query: { intent: 'evaluation.opportunities', filters: { ordinal: ent.ordinal, limit: 6, ...(last.filters.dateRange ? { dateRange: last.filters.dateRange } : {}) }, text: ent.raw, tags: [], tokens: [], source: 'followup' }, selected: { kind: 'match', mid: it.id, guide: it.name } };
    if (dialog.resultSet.kind === 'people') return { kind: 'pick', query: { intent: 'people.profile', filters: { people: [{ id: it.id, label: it.name, status: 'one' }] }, text: ent.raw, tags: [], tokens: [], source: 'followup' } };
    return null;
  }

  const slots = slotsOf(ent);
  if (!slots.length) return null;
  let intent = last.intent, handler = h;
  const filters = { ...last.filters };
  for (const [key, value] of slots) {
    const accepts = x => x.params.includes(key) || (key === 'people' && x.people !== 'none');
    if (!accepts(handler)) {
      const slot = key === 'dateRange' ? 'dateRange' : key === 'people' ? 'person' : key;
      const to = handler.promote?.[slot] || handler.promote?.[key];
      const next = to && handlerFor(to);
      if (!next || !accepts(next)) return null;
      intent = to; handler = next;
    }
    filters[key] = value;
  }
  return { kind: 'slot', query: { intent, filters, text: ent.raw, tags: last.tags || [], tokens: last.tokens || [], source: 'followup' }, carried: last.intent };
}

/* ------------------------------------------------------------- awaiting */
/**
 * She asked a question ("which Jordan?"). Is this the answer?
 * Returns { query } to run, { cancelled } if they backed out, or null if it's something else.
 */
export function resolveAwaiting({ text, ent, norm, awaiting, now = Date.now() }) {
  if (!awaiting || now - awaiting.at > DIALOG_TTL) return null;
  const q = awaiting.query, withFilter = (key, value) => ({ ...q, filters: { ...q.filters, [key]: value }, source: 'followup' });
  if (/^(?:no|nope|nevermind|never mind|cancel|forget it|skip|stop)\b/.test(norm)) return { cancelled: true };
  const opts = awaiting.options || [];
  if (awaiting.slot === 'text' && !opts.length) return text.trim().length >= 2 ? { query: withFilter('text', text.trim().replace(/^["“”]|["“”]$/g, '')) } : null;
  if (awaiting.slot === 'date' && !opts.length) return ent.when ? { query: withFilter('dateRange', ent.when) } : null;
  if (awaiting.slot === 'requirement' && !opts.length) return ent.requirement ? { query: withFilter('requirement', ent.requirement) } : null;
  if (!opts.length) return null;
  const single = opts.length === 1 && /^(?:y|yes|yep|yeah|yup|sure|correct|right|that one|thats right|that is right|him|her|them)\b/.test(norm);
  const pick = single ? opts[0] : chooseFrom(text, opts.map(o => ({ ...o, name: o.label })));
  if (!pick) {
    if (awaiting.slot === 'person' || awaiting.slot === 'guide') {                  // a full name typed in answer
      const one = ent.people.find(p => p.status === 'one' && opts.some(o => o.value === p.person.id));
      if (one) return { query: replacePerson(q, awaiting, one.person.id, `${one.person.first} ${one.person.last}`.trim()) };
    }
    return null;
  }
  if (awaiting.slot === 'person' || awaiting.slot === 'guide') return { query: replacePerson(q, awaiting, pick.value, pick.label) };
  if (awaiting.slot === 'attendance') return { query: withFilter('attendance', pick.value) };
  if (awaiting.slot === 'issue') return { query: withFilter('issue', pick.value) };
  if (awaiting.slot === 'role') return { query: withFilter('text', pick.value) };
  return null;
}

function replacePerson(q, awaiting, id, label) {
  const people = (q.filters.people || []).map(p => ({ ...p }));
  const i = Number.isInteger(awaiting.index) && people[awaiting.index] ? awaiting.index : people.findIndex(p => p.status === 'many' || p.fuzzy);
  const entry = { id, label, status: 'one', fuzzy: false, candidates: [] };
  if (i >= 0) people[i] = entry; else people.push(entry);
  return { ...q, filters: { ...q.filters, people }, source: 'followup' };
}
