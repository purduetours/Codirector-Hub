/* ============================================================ errors, in words
   "PGRST116" means nothing to the person who hit it. This turns what the
   database, the network or a module threw into a sentence and a next step —
   and always logs the real thing first, so nothing is hidden from whoever
   has to fix it.

   A message a module already wrote for people ("Blake was just claimed by
   somebody else.") is kept as it is: it is already the right sentence.
============================================================================ */
const RULES = [
  [/schema cache|does not exist|could not find the function|42883|42P01/i,
    'This part of the hub isn’t set up on the server yet. A codirector can run the setup script for it.'],
  [/PGRST116|JSON object requested, multiple \(or no\) rows|no rows|not found|404/i,
    'I couldn’t load that record. It may no longer be available.'],
  [/JWT|token (?:is )?expired|sign.?in expired|401|not authenticated|session (?:has )?expired/i,
    'Your sign-in has expired. Sign in again, then try once more — nothing was changed.'],
  [/permission denied|row-level security|RLS|42501|403|not allowed|forbidden/i,
    'That action isn’t available for your account.'],
  [/duplicate key|already exists|23505|409|conflict/i,
    'Someone changed that just before you did. Refresh to see the latest, then try again.'],
  [/Failed to fetch|NetworkError|network|offline|timed? ?out|ECONN|Load failed/i,
    'I couldn’t reach the server. Check your connection and try again — nothing was changed.'],
  [/5\d\d|internal server|unavailable|bad gateway/i,
    'The server had a problem just now. Try again in a moment — nothing was changed.']
];

/** Is this already written for a person? Sentences with no codes in them. */
const human = m => m && m.length < 160 && /^[A-Z][^{}<>]*[.!?]$/.test(m) && !/\b[A-Z]{2,}\d+|\b\d{3,}\b|error:|exception|undefined|null|TypeError|at \w+ \(/.test(m);

/**
 * @param {unknown} err     what was thrown
 * @param {string}  what    what she was trying to do, for the log
 * @returns {string}        the sentence to show
 */
export function explainError(err, what = 'that') {
  const msg = String(err?.message || err || '');
  console.error(`[Vanessa] ${what} failed:`, err);
  if (human(msg)) return msg;
  const hit = RULES.find(([re]) => re.test(msg) || re.test(String(err?.code || '')));
  return hit ? hit[1] : 'That didn’t go through. Nothing was changed — try again in a moment.';
}
