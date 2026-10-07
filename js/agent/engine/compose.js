/* ============================================================ the query composer
   Sentence -> entities -> a structured Query. This is where "Who still needs evaled
   Thursday afternoon, the CS ones?" becomes

       { intent: 'evaluation.needs',
         filters: { dateRange: {from, to, after:'12:00', before:'17:00'}, major: 'Computer Science' } }

   so that running it is predictable and testable. The same Query shape is what the optional
   local model produces; both go through the capability router and its one permission check.
*/
import { normalize, tagsOf } from './lexicon.js';
import { extract, peopleEntries } from './extract.js';
import { rank, decide } from './match.js';
import { handlerFor } from '../capabilities/index.js';
import { cleanFilters } from './query.js';

/** Live data the extractors resolve against, gathered once per message (the deps cache it). */
export async function buildEnv(ctx, text) {
  const deps = ctx.deps, pre = normalize(text);
  let people = [], sessions = [], requirements = [], priorities = [], evaluators = [];
  try { people = (await deps.directory()).people; } catch { /* names just won't resolve */ }
  if (/train|session|orient|makeup|attend|safety|requirement|accessib|workshop/.test(pre)) { try { const t = await deps.trainingTerm(); sessions = (t.sessions || []).map(s => s.label); requirements = (t.requirements || []).map(r => r.name); } catch { /* optional */ } }
  if (/eval|assign|\bhave\b|\bput\b|\blet\b/.test(pre) && ctx.who.admin) { try { const r = await deps.roster(); if (r.ok) evaluators = (await deps.evaluators(r.guides)).map(e => ({ id: e.id, name: e.name })); } catch { /* names just won't resolve */ } }
  if (/prior|urgent|first|second|third|tier/.test(pre)) { try { priorities = await deps.priorities(); } catch { /* optional */ } }
  return { people, majors: [...new Set(people.map(p => p.major).filter(Boolean))], now: ctx.now, tz: ctx.tz, sessions, requirements, priorities, evaluators, pages: deps.pages?.() || [] };
}

/** Entities -> the filters one intent accepts. */
export function buildQuery(intent, ent, { confidence = 0, source = 'standard', via = '' } = {}) {
  const raw = { dateRange: ent.when, priority: ent.priority, major: ent.major, session: ent.session, requirement: ent.requirement, semester: ent.semester?.id, limit: ent.count, ordinal: ent.ordinal,
    attendance: ent.attendance, status: ent.status, page: ent.page?.id, text: ent.quoted, email: ent.email, tourType: ent.tourType, people: ent.people.length ? peopleEntries(ent.people) : undefined };
  const { filters } = cleanFilters(intent, raw, { today: ent.today });
  const tags = [...tagsOf(ent.tokens)];
  return { intent, filters, confidence, source, via, text: ent.raw, tags, tokens: ent.tokens, ...(ent.semester?.unsupported ? { note: `I can only look at the current semester or one you name, like “fall 2025”.` } : {}) };
}

/**
 * The whole front half: text -> entities -> ranked intents.
 * @returns {{ent:object, ranked:object[], decision:object, env:object}}
 */
export async function understand(ctx, text, { dialog, proposals = false, awaiting = false, env } = {}) {
  env = env || await buildEnv(ctx, text);
  const ent = extract(text, env);
  const ranked = rank(ent, { dialog, proposals, awaiting }).filter(r => handlerFor(r.id));
  return { ent, ranked, decision: decide(ranked), env };
}
