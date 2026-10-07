/* ============================================================ identity matching
   "Logann Tuttle", "Logan Tuttle", "L. Tuttle" and "ltuttle@purdue.edu" are one
   person. This module decides, for any row from any spreadsheet, which canonical
   Tour Guide it is — and, just as important, how SURE it is.

   Order of evidence, strongest first (the order is the rule):

     1. a stable external id        (saved against that source)
     2. email                       (the guide's email on file)
     3. a saved decision            (an administrator confirmed it before, for
                                     this source — never asked again)
     4. exact normalised name       (accents, case, punctuation and the
                                     schedule's * + ` marks ignored; one person only)
     5. a known alias               (confirmed for a DIFFERENT source — what
                                     we learn from one sheet helps every other)
     6. fuzzy                       a SUGGESTION only. It carries candidates and a
                                     reason and is never linked until a person
                                     confirms it; the database refuses to store a
                                     fuzzy link even if asked.

   The result is `{ basis, guideId, candidates }`. basis is one of
   id | email | saved | exact | alias | ignored | fuzzy | none.

   Pure: nothing here reads the database or the page, so it is tested directly
   and runs in a few milliseconds over a whole schedule.
============================================================================ */
import { nameParts, within1, firstFits } from './people-match.js';

/** Case, accents, the schedule's flag marks and spacing removed. */
export function normName(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*+`´']+/g, ' ')
    .replace(/[^a-z0-9()\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The key a name is remembered under. */
export const nameKey = s => `name:${normName(s).replace(/[()]/g, '').replace(/\./g, '').replace(/\s+/g, ' ')}`;
export const emailKey = e => `email:${String(e || '').trim().toLowerCase()}`;
export const idKey = i => `id:${String(i || '').trim().toLowerCase()}`;

const fullOf = g => `${g.first_name || ''} ${g.last_name || ''}`.trim();

/* "Nicholas (Nick) Steingraeber": the bracketed word is a nickname, so both
   spellings of the full name count as exact. */
function fullNameKeys(g) {
  const first = String(g.first_name || '');
  const nick = /\(([^)]+)\)/.exec(first)?.[1];
  const bare = first.replace(/\([^)]*\)/g, ' ');
  const keys = new Set([nameKey(`${bare} ${g.last_name}`)]);
  if (nick) keys.add(nameKey(`${nick} ${g.last_name}`));
  keys.add(nameKey(`${first} ${g.last_name}`));
  return [...keys];
}

/** "Alli S." / "Nick Str." — a first name and the start of a surname. */
function abbreviated(label) {
  const clean = String(label || '').replace(/[*+`´']+/g, '').trim();
  const m = /^(.+?)\s+([A-Za-z]{1,6})\.$/.exec(clean) || /^(.+?)\s+([A-Za-z])$/.exec(clean);
  return m ? { first: m[1].trim().toLowerCase(), last: m[2].toLowerCase() } : null;
}

/** Score one guide as a possible meaning of an external name, 0..1, with a plain reason. */
function score(name, g) {
  const f = nameParts(name), c = nameParts(`${g.first_name || ''} ${g.last_name || ''}`);
  if (!f.last) return { s: 0 };
  const ab = abbreviated(name);
  let last = 0, why = [];
  if (c.last === f.last) { last = .6; why.push('same surname'); }
  else if (within1(c.last, f.last)) { last = .45; why.push('surname differs by one letter'); }
  else if (ab && String(g.last_name || '').toLowerCase().startsWith(ab.last)) { last = .35; why.push(`surname starts “${ab.last}”`); }
  if (!last) return { s: 0 };
  let first = 0;
  if (f.firsts.some(a => c.firsts.some(b => a === b))) { first = .4; why.push('same first name'); }
  else if (f.firsts.some(a => a.length === 1 && c.firsts.some(b => b.startsWith(a)))) { first = .2; why.push('matching first initial'); }
  else if (f.firsts.some(a => c.firsts.some(b => firstFits(a, b)))) { first = .25; why.push('similar first name'); }
  if (!first) return { s: 0 };
  return { s: last + first, why: why.join(', ') };
}

/**
 * @param rec  { name, email?, extId? }   one external row
 * @param ctx  { kind, guides, mappings }  guides: canonical guides; mappings: every
 *             saved decision, as a Map  external_key -> [{source_kind, guide_id, ignored, confirmed}]
 */
export function matchIdentity(rec, ctx) {
  const guides = ctx.guides || [];
  const maps = ctx.mappings || new Map();
  const keys = [rec.extId && idKey(rec.extId), rec.email && emailKey(rec.email), rec.name && nameKey(rec.name)].filter(Boolean);
  const find = (key, same) => (maps.get(key) || []).filter(m => m.confirmed && (same === undefined || (m.source_kind === ctx.kind) === same));
  const byId = id => guides.find(g => g.id === id);

  // 1. stable external id, saved for this source
  if (rec.extId) {
    const hit = find(idKey(rec.extId), true)[0];
    if (hit?.guide_id && byId(hit.guide_id)) return { basis: 'id', guideId: hit.guide_id, candidates: [] };
  }

  // 2. email
  const email = String(rec.email || '').trim().toLowerCase();
  if (email) {
    const hits = guides.filter(g => String(g.email || '').toLowerCase() === email);
    if (hits.length === 1) return { basis: 'email', guideId: hits[0].id, candidates: [] };
  }

  // 3. saved decision for this source (by email, then by name)
  for (const key of [rec.email && emailKey(rec.email), rec.name && nameKey(rec.name)].filter(Boolean)) {
    const hit = find(key, true)[0];
    if (hit?.ignored) return { basis: 'ignored', guideId: null, candidates: [] };
    if (hit?.guide_id && byId(hit.guide_id)) return { basis: 'saved', guideId: hit.guide_id, candidates: [] };
  }

  // 4. exact normalised name (only when it names exactly one person)
  if (rec.name) {
    const k = nameKey(rec.name);
    const hits = guides.filter(g => fullNameKeys(g).includes(k));
    if (hits.length === 1) return { basis: 'exact', guideId: hits[0].id, candidates: [] };
    if (hits.length > 1) return { basis: 'fuzzy', guideId: null, candidates: hits.slice(0, 3).map(g => ({ id: g.id, name: fullOf(g), score: .95, why: 'two people share this name' })) };
  }

  // 5. an alias confirmed for some other source
  for (const key of [rec.email && emailKey(rec.email), rec.name && nameKey(rec.name)].filter(Boolean)) {
    const hit = find(key, false).find(m => m.guide_id && byId(m.guide_id));
    if (hit) return { basis: 'alias', guideId: hit.guide_id, candidates: [] };
  }

  // 6. fuzzy: candidates for a person to confirm
  const cands = guides.map(g => ({ g, ...score(rec.name, g) })).filter(x => x.s >= .55)
    .sort((a, b) => b.s - a.s).slice(0, 3)
    .map(x => ({ id: x.g.id, name: fullOf(x.g), score: Math.round(x.s * 100) / 100, why: x.why }));
  return { basis: cands.length ? 'fuzzy' : 'none', guideId: null, candidates: cands };
}

/** Group saved decisions by key so matching is a lookup, not a scan. */
export function indexMappings(rows) {
  const m = new Map();
  for (const r of rows || []) { if (!m.has(r.external_key)) m.set(r.external_key, []); m.get(r.external_key).push(r); }
  return m;
}
