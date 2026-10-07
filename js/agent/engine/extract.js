/* ============================================================ the things a sentence mentions
   Deterministic entity extraction: people, dates, times, training sessions and
   requirements, majors, evaluation priority, semesters, counts, "the first one",
   "them". Names are resolved against the Hub's own Tour Guide list (live data),
   so "Jordan" means a real person, two Jordans means a question, and a name that
   isn't on the list is never invented.

   Nothing here decides what the user WANTS; that is match.js. This only finds what
   they are talking ABOUT.

   `env` is everything it may look at, handed in so it can run on fake data:
     { people, now, tz, majors?, sessions?, requirements?, priorities? }
============================================================================ */
import { norm as entNorm, resolvePerson, displayName } from '../entities.js';
import { parseWhen, clock } from '../time.js';
import { normalize, tokenize, repair, tagsOf, STOP, COMMON, NAME_COLLISIONS, TAG_OF } from './lexicon.js';

const CUES = new Set('for with about to of on from by and than is does has did cover covering evaluate evaluating assign see find tell show whose'.split(' '));
const GENERIC = new Set('training session sessions the a an of for new'.split(' '));
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORD = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1, final: -1, other: 1 };

/** [alias phrase, canonical major]. Short forms that are also words are guarded in majorFrom. */
export const MAJOR_ALIASES = [
  ['cs', 'Computer Science'], ['cse', 'Computer Science'], ['comp sci', 'Computer Science'], ['compsci', 'Computer Science'], ['computer science', 'Computer Science'], ['computer sci', 'Computer Science'],
  ['ds', 'Data Science'], ['data science', 'Data Science'], ['bio', 'Biology'], ['biology', 'Biology'], ['psych', 'Psychology'], ['psychology', 'Psychology'], ['econ', 'Economics'], ['economics', 'Economics'],
  ['poli sci', 'Political Science'], ['polysci', 'Political Science'], ['political science', 'Political Science'], ['ee', 'Electrical Engineering'], ['ece', 'Electrical and Computer Engineering'],
  ['electrical engineering', 'Electrical Engineering'], ['me', 'Mechanical Engineering'], ['mech e', 'Mechanical Engineering'], ['mechanical engineering', 'Mechanical Engineering'], ['cgt', 'Computer Graphics Technology'],
  ['chem', 'Chemistry'], ['chemistry', 'Chemistry'], ['nursing', 'Nursing'], ['business', 'Business'], ['engineering', 'Engineering'], ['math', 'Mathematics'], ['mathematics', 'Mathematics'],
  ['accounting', 'Accounting'], ['finance', 'Finance'], ['marketing', 'Marketing'], ['english', 'English'], ['history', 'History'], ['biochem', 'Biochemistry'], ['neuro', 'Neuroscience'], ['physics', 'Physics'], ['agriculture', 'Agriculture'], ['aviation', 'Aviation'], ['education', 'Education']
];
const SHORT_MAJORS = new Set(['me', 'ee', 'ds', 'bio', 'chem', 'math', 'english', 'history']);       // need the word "major" nearby, or a matching major on the roster

const TOUR_TYPES = [[/\binfo(?:rmation)? session\b/, 'info session'], [/\bgroup tours?\b|\bgroups?\b/, 'group'], [/\bindividual tours?\b|\bindividual\b|\bone on one\b|\bsolo\b/, 'individual'], [/\bprivate\b|\bvip\b/, 'private'], [/\bovernight\b/, 'overnight'], [/\btransfer\b/, 'transfer'], [/\badmitted\b/, 'admitted students'], [/\bvirtual\b|\bonline\b/, 'virtual'], [/\baccessible\b|\baccessibility tour\b/, 'accessible']];
const ATTEND_WORDS = [[/\babsent need(?:s)? makeup\b|\babsent makeup\b/, 'Absent, Need Makeup'], [/\blate\b|\btardy\b/, 'Late'], [/\bexcused\b/, 'Excused'], [/\b(?:absent|missed|noshow|no show)\b/, 'Absent'], [/\b(?:attended|present|here|showed up|came)\b/, 'Attended']];

/* ------------------------------------------------------------------- words */
function wordsOf(text) {
  const out = []; const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu; let m;
  while ((m = re.exec(text))) {
    const raw = m[0].replace(/[.'’-]+$/, '').replace(/['’]s$/i, '');
    if (!raw) continue;
    const before = text.slice(0, m.index).trimEnd();
    out.push({ raw, norm: entNorm(raw), start: m.index, end: m.index + m[0].length, cap: /^\p{Lu}/u.test(raw) && raw !== raw.toUpperCase() || /^\p{Lu}\p{Ll}/u.test(raw), initial: !before || /[.!?]$/.test(before) });
  }
  return out;
}

/* ------------------------------------------------------------------ people */
/**
 * @returns {{query:string, status:'one'|'many', person?:object, candidates:object[], fuzzy:boolean, tier:number, start:number, end:number, index:number}[]}
 */
export function findPeople(text, people, { allowFuzzy = true } = {}) {
  const w = wordsOf(text), claimed = new Array(w.length).fill(false), found = [];
  const common = x => (STOP.has(x) || TAG_OF.has(x)) && !NAME_COLLISIONS.has(x);
  const collides = x => NAME_COLLISIONS.has(x) || COMMON.has(x);
  const cued = i => i > 0 && CUES.has(w[i - 1].norm);
  for (const n of [3, 2, 1]) {
    for (let i = 0; i + n <= w.length; i++) {
      if (claimed.slice(i, i + n).some(Boolean)) continue;
      const sl = w.slice(i, i + n);
      if (n > 1 && (STOP.has(sl[0].norm) || STOP.has(sl[n - 1].norm) || sl.some(x => !x.norm))) continue;
      if (n === 1 && (!sl[0].norm || common(sl[0].norm))) continue;
      const q = sl.map(x => x.raw).join(' ');
      const r = resolvePerson(q, people);
      if (r.status === 'none') continue;
      const tier = r.tier ?? 9, tok = sl[0].norm;
      let ok;
      if (n >= 3) ok = tier <= 3;
      else if (n === 2) ok = tier <= 3 || (tier === 5 && sl.every(x => x.norm.length >= 3)) || (tier === 6 && allowFuzzy && sl.every(x => !collides(x.norm) && x.norm.length >= 4));
      else if (tier <= 1 || tier === 4) ok = !collides(tok) || (sl[0].cap && !sl[0].initial) || cued(i);
      else if (tier === 5) ok = tok.length >= 4 && !collides(tok) && (sl[0].cap || cued(i) || tok.length >= 5);
      else ok = allowFuzzy && tier === 6 && tok.length >= 5 && !collides(tok) && ((sl[0].cap && !sl[0].initial) || cued(i));
      if (!ok) continue;
      for (let k = i; k < i + n; k++) claimed[k] = true;
      found.push({ query: q, status: r.status, person: r.person, candidates: r.candidates, fuzzy: !!r.fuzzy || tier === 6, tier, start: sl[0].start, end: sl[n - 1].end, index: i, note: r.note });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const seen = new Set();
  return found.filter(f => { const k = f.status === 'one' ? f.person.id : f.candidates.map(c => c.id).join(','); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ------------------------------------------------------------------- dates */
const mask = (text, spans) => { let s = text; for (const sp of [...spans].sort((a, b) => b.start - a.start)) s = s.slice(0, sp.start) + ' '.repeat(sp.end - sp.start) + s.slice(sp.end); return s; };
const fixTypos = s => s.replace(/[A-Za-z]{5,}/g, w => { const l = w.toLowerCase(), r = repair(l); return r === l ? w : r; });

function whenOf(text, spans, env) {
  const s = fixTypos(mask(text, spans)).replace(/['’]s\b/gi, '').replace(/[?!;:()"“”]/g, ' ').replace(/\b(?<!right )now\b/gi, ' ');
  const r = parseWhen(s, { now: env.now, tz: env.tz });
  if (!r.ok) return { when: null, semester: null, bad: /not a real date/.test(r.reason) ? r.reason : null };
  if (r.semester) return { when: null, semester: r.semester };
  const vague = /\b(?:upcoming|soon|coming up)\b/i.test(s) && r.label === 'the next two weeks';
  return { when: { from: r.from, to: r.to ?? r.from, label: r.label, ...(r.after ? { after: r.after } : {}), ...(r.before ? { before: r.before } : {}), ...(r.at ? { at: r.at } : {}), ...(vague ? { vague: true } : {}), ...(r.needs ? { needs: r.needs } : {}) }, semester: null };
}

/* ------------------------------------------------------------------- others */
function priorityOf(norm, env) {
  if (/\bhighprio\b/.test(norm)) return 'High';
  if (/\blowprio\b/.test(norm)) return 'Low';
  if (/\bmidprio\b/.test(norm)) return 'Normal';
  for (const t of env.priorities || []) {
    const n = normalize(t.name).replace(/ to eval$/, '');
    if (n.length > 4 && norm.includes(n)) return t.sort_order <= 2 ? 'High' : t.sort_order <= 4 ? 'Normal' : 'Low';
  }
  return null;
}

function majorOf(norm, env) {
  const toks = ` ${norm} `, hasWord = /\bmajors?\b|\bmajoring\b|\bstudying\b|\bstudies\b/.test(norm);
  const onRoster = [...new Set((env.majors || []).filter(Boolean))];
  const nrm = s => normalize(s);
  for (const m of onRoster.sort((a, b) => b.length - a.length)) { const n = nrm(m); if (n.length >= 4 && toks.includes(` ${n} `)) return m; }
  for (const [alias, canon] of MAJOR_ALIASES.sort((a, b) => b[0].length - a[0].length)) {
    if (!toks.includes(` ${alias} `)) continue;
    if (SHORT_MAJORS.has(alias) && !hasWord && !onRoster.some(m => nrm(m).includes(nrm(canon).split(' ')[0]))) continue;
    if (alias === 'me' && !hasWord) continue;
    const real = onRoster.find(m => nrm(m) === nrm(canon)) || onRoster.find(m => nrm(m).includes(nrm(canon)));
    return real || canon;
  }
  return null;
}

function labelMention(norm, labels) {
  const toks = new Set(tokenize(norm));
  let best = null, bs = 0;
  for (const label of labels || []) {
    const lt = tokenize(normalize(label)).filter(t => !GENERIC.has(t) && t.length > 2);
    if (!lt.length) continue;
    const hit = lt.filter(t => toks.has(t) || (t.length > 4 && [...toks].some(x => x.length > 4 && ((x.startsWith(t) && t.length / x.length >= 0.75) || (t.startsWith(x) && x.length / t.length >= 0.75))))).length;
    if (hit === lt.length && hit > bs) { best = label; bs = hit; }
  }
  return best;
}

function pageOf(norm, env) {
  const toks = new Set(tokenize(norm));
  let best = null, bs = 0;
  for (const p of env.pages || []) for (const n of [p.title, p.id]) {
    const lt = tokenize(normalize(n)).filter(t => t.length > 2);
    if (lt.length && lt.every(t => toks.has(t) || toks.has(t.replace(/s$/, '')) || toks.has(t + 's')) && lt.length > bs) { best = p; bs = lt.length; }
  }
  return best;
}

function semesterOf(text, parsedSemester) {
  const m = /\b(fall|spring|summer|winter)\s*(?:semester\s*)?(?:of\s*)?(20\d{2}|\d{2})\b/i.exec(text);
  if (m) { const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]); return { id: `${m[1].toLowerCase()}-${y}`, label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${y}` }; }
  if (parsedSemester === 'current') return { id: null, label: 'this semester' };
  if (parsedSemester) return { id: null, label: `${parsedSemester === 'previous' ? 'last' : 'next'} semester`, unsupported: true };
  return null;
}

function countOf(norm) {
  let m;
  if ((m = /\b(?:top|first|best|next) (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b(?! (?:one|guy|person))/.exec(norm))) { const n = Number(m[1]) || WORD_NUM[m[1]]; if (n && n <= 30) return n; }
  if ((m = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten) (?:best|top|strongest|options|matches|opportunities)\b/.exec(norm))) { const n = Number(m[1]) || WORD_NUM[m[1]]; if (n && n <= 30) return n; }
  return null;
}
function ordinalOf(norm) {
  let m;
  if ((m = /\b(?:the )?(first|second|third|fourth|fifth|last|final|other) (?:one|guy|person|guide|option|match|name|result|item|session|tour|slot|candidate)\b/.exec(norm))) return ORD[m[1]];
  if ((m = /\b(?:number|no|option|item|candidate|match|#)\s*(\d{1,2})\b/.exec(norm))) return Number(m[1]) - 1;
  if ((m = /^(?:the )?(first|second|third|fourth|fifth|last)(?: one)?$/.exec(norm.replace(/\b(?:please|then|ok|okay)\b/g, '').trim()))) return ORD[m[1]];
  if ((m = /^#?(\d{1,2})$/.exec(norm.trim()))) return Number(m[1]) - 1;
  return null;
}
function statusOf(norm, tokens) {
  if (/\bunassigned\b|\bunclaimed\b|\bno evaluator\b|\bwithout an? evaluator\b/.test(norm)) return 'unassigned';
  if (/\b(?:assigned|claimed|lined up|has an evaluator|have an evaluator)\b/.test(norm)) return 'claimed';
  const tg = tagsOf(tokens);
  if (tg.has('EVAL') && !tg.has('OPEN') && (tg.has('DONE') || tg.has('ALREADY'))) return 'done';
  return null;
}
const REF = /\b(?:him|her|them|they|their|his|hers|theirs|that person|that guide|that guy|that one|this one|same person|same guide|those|these|the same one)\b/;

/* ------------------------------------------------------------------- the lot */
/**
 * @param {string} text
 * @param {object} env
 * @returns {object} entities (see keys below). Never throws.
 */
export function extract(text, env = {}) {
  const raw = String(text ?? '').slice(0, 1200);
  const known = new Set((env.people || []).map(p => entNorm(`${p.first} ${p.last}`)));
  const members = (env.evaluators || []).filter(e => e?.name && !known.has(entNorm(e.name))).map(e => { const [first, ...rest] = String(e.name).trim().split(/\s+/); return { id: `ev:${e.id}`, first, last: rest.join(' '), active: true, aliases: [], evaluator: true }; });
  const people = findPeople(raw, [...(env.people || []), ...members], { allowFuzzy: env.allowFuzzy !== false });
  const spans = people.map(p => ({ start: p.start, end: p.end }));
  const { when, semester: ps, bad } = whenOf(raw, spans, { now: env.now || new Date(), tz: env.tz });
  const masked = mask(raw, spans);
  const norm = tokenize(normalize(masked)).map(repair).join(' ');
  const quoted = (/["“”]([^"“”]{3,400})["“”]/.exec(raw) || [])[1] || null;
  const ent = {
    raw, norm, tokens: tokenize(norm), people, when, badDate: bad || null,
    priority: priorityOf(norm, env),
    major: majorOf(norm, env),
    session: labelMention(norm, env.sessions), requirement: labelMention(norm, env.requirements),
    semester: semesterOf(raw, ps),
    count: countOf(norm), ordinal: ordinalOf(norm), status: statusOf(norm, tokenize(norm)),
    reference: REF.test(norm) || /\bit\b/.test(norm) && norm.split(' ').length <= 4,
    tourType: (TOUR_TYPES.find(([re]) => re.test(norm)) || [])[1] || null,
    attendance: (ATTEND_WORDS.find(([re]) => re.test(norm)) || [])[1] || null,
    compound: tokenize(norm).length > 8 && /\b(?:and|also|plus|then)\b.*\b(?:who|what|when|where|how|any|is|are|show|give|tell|find|list)\b/.test(norm),
    question: /\?\s*$/.test(raw) || /^\s*(?:is|was|did|does|do|has|have|are|were|can|could|who|what|when|where|why|how|which)\b/i.test(raw),
    quoted, page: pageOf(norm, env), today: clock(env.now || new Date(), env.tz).today,
    mine: /\b(?:my|mine|myself|me|i)\b/.test(raw.toLowerCase().replace(/['’]/g, '').replace(/\b(?:show|give|tell|get|let|help|find|bring|send|pull|make|remind|brief|text|call|ask|take|put|set|book|assign|have|do|can|could|would|will) me\b/g, ' ')),
    email: (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(raw) || [])[0] || null
  };
  ent.consumed = new Set([ent.session, ent.requirement, ent.major, ent.page?.title, ent.quoted].filter(Boolean).flatMap(x => tokenize(normalize(x))));
  return ent;
}

/** People the sentence mentioned, in the shape a Query carries (resolved ids, or candidates to choose from). */
export const peopleEntries = list => list.map(p => (p.status === 'one'
  ? { id: p.person.id, label: displayName(p.person), status: 'one', fuzzy: !!p.fuzzy, memberId: p.person.memberId || null, query: p.query, candidates: [] }
  : { status: 'many', label: p.query, query: p.query, fuzzy: false, candidates: p.candidates.map(c => ({ id: c.id, label: displayName(c), sub: c.major || undefined })) }));

/** What entity kinds were found, as tags for intent rules ("@date", "@person", ...). */
export function entityTags(e) {
  const t = new Set();
  if (e.when) { t.add('@date'); if (e.when.from === e.today && e.when.to === e.today) t.add('@today'); if (e.when.from === e.when.to) t.add('@day'); else t.add('@range'); if (e.when.after || e.when.before || e.when.at) t.add('@time'); }
  if (e.people.length) { t.add('@person'); if (e.people.length > 1) t.add('@people'); }
  if (e.priority) t.add('@priority');
  if (e.major) t.add('@major');
  if (e.session) t.add('@session');
  if (e.requirement) t.add('@requirement');
  if (e.semester) t.add('@semester');
  if (e.count != null) t.add('@count');
  if (e.ordinal != null) t.add('@ordinal');
  if (e.reference) t.add('@ref');
  if (e.mine) t.add('@mine');
  if (e.attendance) t.add('@attendance');
  if (e.status) t.add('@status');
  if (e.page) t.add('@page');
  if (e.question) t.add('@question');
  if (e.quoted) t.add('@quoted');
  if (e.tourType) t.add('@tourtype');
  return t;
}

/**
 * Pick one of a list of offered candidates from a typed answer: a name, "the first one",
 * "the second", "number 2", "the CS one". Returns the candidate or null.
 */
export function chooseFrom(text, candidates, env = {}) {
  const list = candidates || [];
  if (!list.length) return null;
  const norm = normalize(text);
  const ord = ordinalOf(norm);
  if (ord != null) { const c = ord === -1 ? list[list.length - 1] : list[ord]; if (c) return c; }
  const exact = list.filter(c => normalize(c.label || c.name || '') === norm);
  if (exact.length === 1) return exact[0];
  const toks = tokenize(norm).filter(t => !STOP.has(t));
  const hits = list.filter(c => { const l = tokenize(normalize(`${c.label || c.name || ''} ${c.sub || ''}`)); return toks.length && toks.every(t => l.some(x => x === t || (t.length > 3 && x.startsWith(t)))); });
  if (hits.length === 1) return hits[0];
  const m = majorOf(norm, { majors: list.map(c => c.sub).filter(Boolean), ...env });
  if (m) { const mm = list.filter(c => normalize(c.sub || '').includes(normalize(m))); if (mm.length === 1) return mm[0]; }
  return null;
}

export { clock };
