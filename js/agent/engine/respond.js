/* ============================================================ saying things like a person
   Small, reusable pieces for turning structured results into sentences. Capability
   modules compose answers from these so Vanessa reads the same everywhere:

       bad:   14 rows returned.
       good:  14 active Tour Guides still need an evaluation this semester. Four are high priority.

   No randomness: the same facts always give the same words, so behaviour is testable
   and nothing is ever "made up" to sound lively. Variety comes from facts, not dice.
*/
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** 0-9 as words, otherwise digits. */
export const num = n => (Number.isInteger(n) && n >= 0 && n <= 9 ? WORD[n] : String(n));
/** Same, capitalised for the start of a sentence. */
export const Num = n => { const s = num(n); return s[0].toUpperCase() + s.slice(1); };
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const lower = s => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** "1 Tour Guide" / "14 Tour Guides" (digits in cards, words in sentences). */
export const count = (n, one, many = `${one}s`, { words = true } = {}) => `${words ? num(n) : n} ${n === 1 ? one : many}`;
export const are = n => (n === 1 ? 'is' : 'are');
export const has = n => (n === 1 ? 'has' : 'have');
export const s = n => (n === 1 ? '' : 's');

/** "Jordan Smith, Alex Green and 4 others" */
export function names(list, max = 3) {
  const l = [...list];
  if (l.length <= max) return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] || '';
  const rest = l.length - max;
  return `${l.slice(0, max).join(', ')} and ${num(rest)} other${s(rest)}`;
}
export const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
export const possessive = n => (/s$/i.test(n) ? `${n}’` : `${n}’s`);

/** Join sentences, dropping empties. */
export const join = (...parts) => parts.flat().filter(Boolean).map(x => String(x).trim()).filter(Boolean).join(' ');

/** "Did you mean A or B?" style list: "A, B or C" */
export const or = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0] || '');

/** "I’ll assign X…": the summary a write tool prepared, spoken as a promise. */
export const promise = summary => `I’ll ${lower(String(summary || '').replace(/\.$/, ''))}.`;

/** Sentence for a range label: "this week", "Thursday afternoon". */
export function whenWords(w) {
  if (!w) return '';
  let t = w.label || '';
  if (w.after && w.before && w.after >= '12:00' && w.before <= '17:00' && !/afternoon/i.test(t)) t += ' afternoon';
  else if (w.before && !w.after && w.before <= '12:00' && !/morning/i.test(t)) t += ' morning';
  else if (w.after && !w.before && w.after >= '17:00' && !/evening|tonight/i.test(t)) t += ' evening';
  if (/^[A-Z][a-z]+day$/.test(t)) t = `on ${t}`;
  return t;
}
