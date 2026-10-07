/* ============================================================ "who needs an eval and what's tomorrow?"
   Two requests in one sentence. Split on the conjunction, but only if both halves are real
   requests of their own (the router checks that each one is recognised confidently and that they
   differ); otherwise the sentence is treated as one thing, as before.
*/
const CONJ = /(?:,?\s+and then\s+|,?\s+and also\s+|;\s*|,?\s+plus\s+|,?\s+also\s+|,?\s+and\s+|,\s+then\s+)/ig;

/** @returns {[string, string] | null} */
export function splitCompound(text) {
  const t = String(text || '').trim().replace(/[?.!\s]+$/, '');
  if (t.split(/\s+/).length < 7) return null;
  let m; CONJ.lastIndex = 0;
  while ((m = CONJ.exec(t))) {
    const a = t.slice(0, m.index).trim(), b = t.slice(m.index + m[0].length).trim();
    if (a.split(/\s+/).length >= 3 && b.split(/\s+/).length >= 3) return [a, b];
  }
  return null;
}
