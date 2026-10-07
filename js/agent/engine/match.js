/* ============================================================ what are they asking for?
   Scores every intent against a sentence and returns them best-first, each with the
   reason ("rule 3", or "like: who still needs an eval"). Pure: given the same text, entities
   and conversation it always gives the same answer, and it never calls the network.

   Confidence is the strength of the best rule (see intents.js), or a similarity score when
   the sentence resembles a known example more than any rule anticipated.
*/
import { INTENTS } from './intents.js';
import { tokenize, normalize, tagsOf, TAG_OF, STOP, COMMON, contentTokens, dice } from './lexicon.js';
import { entityTags } from './extract.js';

/** Confidence bands used by the router. */
export const HIGH = 0.75;
export const MEDIUM = 0.5;

/* The vector for an example or a sentence: its meaningful words plus the concepts they carry. */
function vector(tokens) {
  const v = new Set();
  for (const t of contentTokens(tokens)) { const tg = TAG_OF.get(t); if (tg) { v.add(t); tg.forEach(x => v.add(x)); } }
  return [...v];
}
/* A resemblance only counts when both sentences are about the same THINGS (evaluations, training,
   tours ...). "who still needs an eval" and "who still needs training" differ by one word and mean
   different things, so similarity alone must never move one onto the other. */
const TOPICS = new Set(['EVAL', 'EVALUATOR', 'TRAIN', 'MAKEUP', 'TOUR', 'SCHEDULE', 'COVER', 'DESK', 'CONFLICT', 'ANNOUNCE', 'BRIEF', 'PROBLEM', 'SYNC', 'SOURCE', 'UNMATCHED', 'MAJOR', 'MATERIALS', 'ATTEND', 'MISSED', 'READY', 'PRIO', 'SEMESTER', 'ACTIVE', 'LEADERSHIP', 'PROFILE']);
const sharedConcepts = (a, b) => { const B = new Set(b); return a.filter(x => /^[A-Z]+$/.test(x) && B.has(x)).length; };
const topicsOf = v => v.filter(x => TOPICS.has(x)).sort().join('|');
const EXAMPLES = INTENTS.map(i => ({ id: i.id, vectors: i.examples.map(e => { const v = vector(tokenize(normalize(e))); return { text: e, v, topics: topicsOf(v) }; }).filter(x => x.v.length >= 3 && x.topics) }));

/**
 * How much of what was said did she actually understand? A sentence that is mostly words she has
 * no concept for ("a second set of eyes", "the whole situation") is being matched on a couple of
 * keywords, so its confidence is reduced: she'd rather ask a model, or ask the person, than be
 * confidently wrong. Chatty-but-clear requests lose very little.
 */
const LITERALS = new Set();
const collect = c => { if (Array.isArray(c)) c.forEach(collect); else if (typeof c === 'string' && c.startsWith('#')) LITERALS.add(c.slice(1)); else if (typeof c === 'string' && /^[a-z]+$/.test(c)) LITERALS.add(c); };
for (const i of INTENTS) for (const r of i.rules) { r.all.forEach(collect); (r.none || []).forEach(collect); }
export function understoodShare(ent) {
  const content = ent.tokens.filter(t => !STOP.has(t) && !/^\d+$/.test(t) && !ent.consumed?.has(t));
  if (!content.length) return 1;
  return content.filter(t => TAG_OF.has(t) || COMMON.has(t) || LITERALS.has(t)).length / content.length;
}

/** Everything a rule may ask about the sentence. */
export function factsOf(ent, { dialog, proposals = false, awaiting = false } = {}) {
  const tags = tagsOf(ent.tokens);
  for (const t of entityTags(ent)) tags.add(t);
  if (dialog?.subject) tags.add(`$${dialog.subject}`);
  if (ent.tokens.length <= 4) tags.add('$short');
  if (proposals) tags.add('$proposals');
  if (awaiting) tags.add('$awaiting');
  return { tags, tokens: new Set(ent.tokens) };
}

const holds = (c, f) => (Array.isArray(c) ? c.some(x => holds(x, f)) : c.startsWith('#') ? f.tokens.has(c.slice(1)) : /^[a-z]/.test(c) ? f.tokens.has(c) : f.tags.has(c));
const ruleHolds = (r, f) => r.all.every(c => holds(c, f)) && !(r.none || []).some(c => holds(c, f));

/**
 * @returns {{id:string, score:number, via:string}[]} best first; only intents scoring above 0.
 */
export function rank(ent, ctx = {}) {
  const f = factsOf(ent, ctx), vec = vector(ent.tokens), topics = topicsOf(vec), out = [];
  const share = understoodShare(ent), factor = (0.5 + 0.5 * share) * (ent.compound ? 0.85 : 1);
  for (const i of INTENTS) {
    let best = 0, via = '', spec = 0;
    i.rules.forEach((r, k) => { if (ruleHolds(r, f) && (r.c > best || (r.c === best && r.all.length > spec))) { best = r.c; via = `rule ${k + 1}`; spec = r.all.length; } });
    const ex = EXAMPLES.find(e => e.id === i.id);
    for (const e of ex.vectors) {
      if (e.topics !== topics) continue;
      const sim = dice(vec, e.v);
      if (sim >= 0.75 && sharedConcepts(vec, e.v) >= 3) { const c = Math.min(0.85, 0.45 + 0.5 * sim); if (c > best) { best = c; via = `like “${e.text}”`; } }
    }
    if (best > 0) out.push({ id: i.id, score: Math.round(best * factor * 100) / 100, via, spec });
  }
  return out.sort((a, b) => b.score - a.score || b.spec - a.spec);
}

/** The decision a router needs: the winner, how far ahead it is, and the runner-up. */
export function decide(ranked) {
  const [top, second] = ranked;
  if (!top) return { top: null, second: null, margin: 0, band: 'none' };
  const margin = top.score - (second?.score ?? 0);
  return { top, second: second || null, margin, band: top.score >= HIGH ? 'high' : top.score >= MEDIUM ? 'medium' : 'low' };
}
