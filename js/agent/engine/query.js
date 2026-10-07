/* ============================================================ the structured request
   Whatever understood the sentence (the deterministic engine or the optional local
   model), the result is the same plain object, and this is the only shape the rest of
   Vanessa will execute:

       { intent: 'evaluation.opportunities',
         filters: { priority: 'High', dateRange: { from, to, label, after?, before? }, people: [...], limit: 3 },
         confidence: 0.94, source: 'standard' | 'followup' | 'local', text, tags }

   Nothing the model says is trusted because it is local. A Query is checked here before it
   runs: the intent must exist and be allowed for this person, filters must be ones that intent
   accepts and be well formed, dates must be real and reasonable, and names are resolved against
   the Hub's own list (never taken on the model's word). Anything else is dropped.
*/
import { handlerFor } from '../capabilities/index.js';
import { can } from '../capabilities.js';
import { addDays } from '../time.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDate = s => ISO.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
const str = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;

/** Per-filter validators. Return the cleaned value, or undefined to drop it. */
const FILTER = {
  dateRange(v, { today }) {
    if (!v || typeof v !== 'object' || !isDate(v.from) || !isDate(v.to ?? v.from)) return undefined;
    const to = v.to ?? v.from, a = Date.parse(v.from), b = Date.parse(to), t = Date.parse(today);
    if (b < a || (b - a) / 864e5 > 370 || Math.abs(a - t) / 864e5 > 800 || Math.abs(b - t) / 864e5 > 800) return undefined;
    const out = { from: v.from, to, label: String(v.label || v.from).slice(0, 60) };
    for (const k of ['after', 'before', 'at']) if (v[k] != null) { if (!HM.test(v[k])) return undefined; out[k] = v[k]; }
    if (v.vague) out.vague = true;
    return out;
  },
  priority: v => (['High', 'Normal', 'Low'].includes(v) ? v : undefined),
  major: v => (str(v, 60) ? v.trim() : undefined),
  status: v => (['unassigned', 'claimed', 'done', 'needs'].includes(v) ? v : undefined),
  session: v => (str(v, 80) ? v.trim() : undefined),
  requirement: v => (str(v, 80) ? v.trim() : undefined),
  semester: v => (typeof v === 'string' && /^[a-z]+-\d{4}$/.test(v) ? v : undefined),
  attendance: v => (['Attended', 'Late', 'Excused', 'Absent', 'Absent, Need Makeup'].includes(v) ? v : undefined),
  text: v => (str(v, 2000) ? v.trim() : undefined),
  page: v => (typeof v === 'string' && /^[a-z0-9_-]{2,30}$/.test(v) ? v : undefined),
  limit: v => (Number.isInteger(v) && v >= 1 && v <= 30 ? v : undefined),
  ordinal: v => (Number.isInteger(v) && v >= -1 && v <= 30 ? v : undefined),
  email: v => (typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 120 ? v : undefined),
  issue: v => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? v : undefined),
  tourType: v => (str(v, 40) ? v.trim() : undefined),
  people(v) {
    if (!Array.isArray(v)) return undefined;
    const out = v.slice(0, 6).filter(p => p && typeof p === 'object' && (typeof p.id === 'string' || Array.isArray(p.candidates))).map(p => ({ id: p.id, label: String(p.label || '').slice(0, 80), status: p.status === 'many' ? 'many' : 'one', fuzzy: !!p.fuzzy, memberId: p.memberId || null, candidates: (p.candidates || []).slice(0, 8).map(c => ({ id: String(c.id), label: String(c.label || '').slice(0, 80), sub: c.sub ? String(c.sub).slice(0, 60) : undefined })), query: p.query ? String(p.query).slice(0, 80) : undefined }));
    return out;
  }
};

/** Keep only the filters this intent accepts, each well formed. Reports what it dropped. */
export function cleanFilters(intent, filters = {}, { today }) {
  const h = handlerFor(intent), out = {}, dropped = [];
  for (const [k, v] of Object.entries(filters || {})) {
    if (v == null) continue;
    const allowed = h && (h.params.includes(k) || (k === 'people' && h.people !== 'none'));
    const fn = FILTER[k];
    if (!allowed || !fn) { dropped.push(k); continue; }
    const c = fn(v, { today });
    if (c === undefined) dropped.push(k); else out[k] = c;
  }
  return { filters: out, dropped };
}

/**
 * @returns {{ok:true, query:object, dropped:string[]} | {ok:false, error:string, message:string}}
 */
export function validateQuery(q, { who, today }) {
  if (!q || typeof q !== 'object') return { ok: false, error: 'malformed', message: 'That wasn’t a request I could read.' };
  const h = handlerFor(q.intent);
  if (!h) return { ok: false, error: 'unknown_intent', message: `There’s no such capability as “${String(q.intent).slice(0, 40)}”.` };
  if (!can(h.permission, who)) return { ok: false, error: 'not_permitted', message: 'That isn’t available to your role.' };
  const { filters, dropped } = cleanFilters(q.intent, q.filters, { today });
  const conf = Number.isFinite(q.confidence) ? Math.min(1, Math.max(0, q.confidence)) : 0;
  return { ok: true, dropped, query: { intent: q.intent, filters, confidence: conf, source: q.source || 'standard', text: String(q.text || '').slice(0, 1200), tags: Array.isArray(q.tags) ? q.tags.slice(0, 60) : [], tokens: Array.isArray(q.tokens) ? q.tokens.slice(0, 80) : [] } };
}

/** A relative window used when the model's date phrase can't be parsed: never guessed. */
export const defaultWindow = today => ({ from: today, to: addDays(today, 6), label: 'this week' });
