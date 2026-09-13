/* ========================================== matching people between sources
   The same person is written three different ways depending on which
   spreadsheet you are looking at. Risha is "Risha P" in the database, "Risha
   Pathek" on the training tracker and "Risha Pathak" on the majors sheet.
   Nicknames, initials for surnames, and plain typos are all normal.

   The rule is surname-first, and that is not fussiness. The roster contains
   two people whose first names are both Nicholas/Nick with quite different
   surnames, and a looser matcher put one person's record on the other. So the
   surname has to agree before a first name is even considered, and anything
   that could be two people comes back null to be shown rather than guessed.

   Lifted out of the training module when the majors sheet needed the same job
   done — a second copy would have drifted from the first within a term.
========================================================================== */

const nameParts = full => {
  const raw = String(full || '').toLowerCase();
  const nick = [...raw.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  const words = raw.replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  return { firsts: [...words.slice(0, -1), ...nick], last: words[words.length - 1] || '' };
};

/** One substitution, insertion or deletion apart. */
function within1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/* Note the last clause. "Nick" is NOT a prefix of "Nicholas" — they part
   company at the fourth letter, nich/nick — so prefix matching alone misses
   the commonest nickname there is. A shared three-letter stem catches it, and
   is only reached once the surname already agrees, so it cannot wander off to
   a different person. Two people who share a surname AND a stem come back
   ambiguous and are shown to you rather than guessed at. */
const firstFits = (a, b) =>
  a === b || within1(a, b) ||
  (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b)) ||
  (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3));

/** The one tracker name this form name means, or null if it is not certain. */
export function matchPerson(formName, trackerNames) {
  const f = nameParts(formName);
  if (!f.last) return null;

  const hits = trackerNames.filter(t => {
    const c = nameParts(t);
    const surnameOk = c.last === f.last || within1(c.last, f.last) ||
      // "Leo G" — an initial for a surname only counts when a first name is exact.
      (f.last.length <= 2 && c.last.startsWith(f.last) && c.firsts.some(x => f.firsts.includes(x)));
    if (!surnameOk) return false;
    return f.firsts.some(a => c.firsts.some(b => firstFits(a, b)));
  });
  return hits.length === 1 ? hits[0] : null;
}
