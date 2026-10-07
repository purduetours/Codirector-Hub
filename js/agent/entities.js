/* ============================================================ who does "Jordan" mean?
   Resolution against the hub's own list of Tour Guides (the canonical identity
   system), including names people have been saved under before.

   It never invents anyone. One clear match is used. Several are returned as
   several so the person is asked "Jordan Smith or Jordan Lee?". A match that
   needed a spelling correction is flagged `fuzzy`, and writes refuse to act on
   those without the person confirming the name.
============================================================================ */
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export const PRONOUN = /^(?:him|her|them|he|she|they|their|theirs|his|hers|that person|this person|that guide|this guide|that one|the same person)$/i;

function within1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * @param {string} query
 * @param {{id:string, first:string, last:string, active?:boolean, aliases?:string[]}[]} people
 * @returns {{status:'one'|'many'|'none', person?:object, candidates:object[], fuzzy?:boolean, note?:string}}
 */
export function resolvePerson(query, people) {
  let raw = String(query ?? '').trim();
  if (/^[^,]+,[^,]+$/.test(raw)) raw = raw.split(',').reverse().join(' ');       // "Smith, Jordan"
  const q = norm(raw), t = q.split(' ').filter(Boolean);
  if (!t.length) return { status: 'none', candidates: [] };

  const scored = [];
  for (const p of people) {
    const f = norm(p.first), l = norm(p.last), full = `${f} ${l}`.trim();
    const aliases = (p.aliases || []).map(norm);
    let tier = 0;
    if (q === full || aliases.includes(q)) tier = 1;
    else if (t.length === 2 && ((t[0].length === 1 && t[0] === f[0] && t[1] === l) || (t[1].length === 1 && t[0] === f && t[1] === l[0])
              || (t[1].length === 1 && t[1] === f[0] && t[0] === l) || (t[0].length === 1 && t[1] === f && t[0] === l[0]))) tier = 2;
    else if (t.length === 2 && ((t[0] === f && t[1] === l) || (t[0] === l && t[1] === f))) tier = 1;
    else if (t.length === 1 && (t[0] === f || t[0] === l)) tier = 4;
    else if (t.length === 1 && t[0].length >= 3 && (f.startsWith(t[0]) || l.startsWith(t[0]))) tier = 5;
    else if (t.length >= 2 && t.every(w => full.split(' ').some(x => x === w))) tier = 3;
    else if (t.length >= 2 && t.length <= 3 && t.every(w => full.split(' ').some(x => x.startsWith(w) && w.length >= 3))) tier = 5;
    else if (t.length === 1 && t[0].length >= 4 && (within1(t[0], f) || within1(t[0], l))) tier = 6;
    else if (t.length === 2 && t[0].length >= 3 && t[1].length >= 3 && ((within1(t[0], f) && within1(t[1], l)) || (within1(t[0], l) && within1(t[1], f)))) tier = 6;
    else if (aliases.some(a => a.startsWith(q) && q.length >= 4)) tier = 5;
    if (tier) scored.push({ p, tier });
  }
  if (!scored.length) return { status: 'none', candidates: [] };
  const best = Math.min(...scored.map(x => x.tier));
  let group = scored.filter(x => x.tier === best).map(x => x.p);
  const activeOnes = group.filter(p => p.active !== false);
  let note;
  if (group.length > 1 && activeOnes.length === 1) { note = `${group.length - 1} inactive guide${group.length === 2 ? '' : 's'} share${group.length === 2 ? 's' : ''} that name.`; group = activeOnes; }
  const cands = group.sort((a, b) => (b.active !== false) - (a.active !== false) || `${a.last}${a.first}`.localeCompare(`${b.last}${b.first}`)).slice(0, 8);
  if (cands.length === 1) return { status: 'one', person: cands[0], candidates: cands, fuzzy: best === 6, tier: best, note };
  return { status: 'many', candidates: cands, tier: best };
}

/** Resolve a list of names; collects every problem rather than stopping at the first. */
export function resolveMany(queries, people, { allowFuzzy = true } = {}) {
  const found = [], problems = [];
  for (const q of queries) {
    const r = resolvePerson(q, people);
    if (r.status === 'one' && (allowFuzzy || !r.fuzzy)) found.push(r.person);
    else if (r.status === 'one') problems.push({ query: q, issue: 'fuzzy', candidates: r.candidates });
    else problems.push({ query: q, issue: r.status === 'many' ? 'ambiguous' : 'not_found', candidates: r.candidates });
  }
  return { found, problems };
}

export const displayName = p => `${p.first} ${p.last}`.trim();
