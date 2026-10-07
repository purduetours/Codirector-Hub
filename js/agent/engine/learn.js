/* ============================================================ teaching her new phrasings, safely
   When Standard Vanessa can't tell what someone asked, the sentence is kept here, on this
   device only (never sent anywhere), with any name she recognised replaced by {person}. Admin >
   Vanessa lists them and offers "Copy for the developer", which prints lines ready to paste
   into engine/phrasebook.js. A developer reviews them, files each under the right intent, and the
   tests prove it resolves there. Nothing here changes behaviour by itself: she doesn't rewrite her
   own rules, and nothing is learned from one person's phrasing and applied to another's behind
   anyone's back.
*/
const KEY = 'hub2.vanessa.missed', MAX = 60;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = l => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch { /* storage blocked */ } };

/** Remove what could identify someone, keep what shows how it was phrased. */
export function redact(text, ent) {
  let s = String(text || '').slice(0, 200);
  for (const p of [...(ent?.people || [])].sort((a, b) => b.start - a.start)) s = s.slice(0, p.start) + '{person}' + s.slice(p.end);
  return s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '{email}').replace(/\s+/g, ' ').trim();
}

export function noteMissed(text, ent, reason = 'not_understood') {
  const t = redact(text, ent); if (t.length < 4) return;
  const l = read(), k = t.toLowerCase();
  const hit = l.find(x => x.text.toLowerCase() === k);
  if (hit) { hit.n++; hit.at = Date.now(); } else l.unshift({ text: t, n: 1, at: Date.now(), reason });
  write(l.sort((a, b) => b.at - a.at));
}
export const missed = () => read();
export const clearMissed = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
export const forget = text => write(read().filter(x => x.text !== text));

/** Lines to paste under an intent in phrasebook.js (the developer chooses which intent). */
export const snippet = list => list.map(x => `  // asked ${x.n}×\n  '${x.text.replace(/'/g, "\\'").toLowerCase()}',`).join('\n');
