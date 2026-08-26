/* ============================================================ Guide Room API
   Guide Room predates the hub and speaks a different dialect: its own
   deployment, its own spreadsheet, and token auth with a {token, fn, args}
   envelope that answers {ok, result}. Kept separate from core/api.js rather
   than bent to fit, so neither has to compromise.
============================================================================ */

export function grConfigured() {
  const c = window.CONFIG?.GUIDE_ROOM;
  return !!(c && c.apiUrl && c.token && !c.apiUrl.startsWith('PASTE'));
}

/**
 * Calls that only read. Apps Script answers a POST with a 302 to a single-use
 * googleusercontent URL, and that second hop intermittently 404s under load — so
 * these are worth retrying. Writes are NOT retried: the script may well have run
 * before the redirect failed, and replaying an import would double the roster.
 */
/**
 * Calls that are safe to send twice. Every one of these sets specific cells to
 * specific values, so a replay lands on the same result — which means a request
 * lost to Google's flaky redirect can simply be sent again.
 *
 * Deliberately absent: importRoster (an append would double the roster),
 * clearRoster and clearInterviewers (destructive enough to want a human deciding
 * to repeat them).
 */
const GR_RETRYABLE = new Set([
  'ping', 'getState',        // reads
  'setScore', 'setNote', 'setField', 'saveGrade', 'saveSettings'
]);

/** The signature of a request that lost its body on the redirect hop. */
const LOST_BODY = /bad or missing token/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Backoff between retries. Apps Script sheds load when it's busy, and hammering it
 * a few hundred milliseconds later just adds to the pile — so wait over a second,
 * with a little jitter so several people retrying at once don't sync up.
 */
const backoff = i => Math.min(1000 * i, 4000) + Math.random() * 700;

export async function gr(fn, args = []) {
  const c = window.CONFIG?.GUIDE_ROOM;
  if (!grConfigured()) {
    throw new Error('Guide Room is not connected. Add its apiUrl and token to config.js.');
  }

  // Five, not three: a browser hitting this endpoint sees the redirect hop 404 far
  // more often than a plain client does, and these calls are safe to repeat.
  const attempts = GR_RETRYABLE.has(fn) ? 5 : 1;
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(backoff(i));
    try {
      const res = await fetch(c.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: c.token, fn, args }),
        redirect: 'follow'
      });

      if (!res.ok) {
        // 404/5xx here is the redirect hop failing, not a bad request — retryable.
        lastErr = new Error(
          res.status === 404
            ? 'Interviews: Google dropped that request (404). Retrying…'
            : `Interviews returned ${res.status}.`
        );
        continue;
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Interviews sent a non-JSON reply — check its deployment access is "Anyone".');
      }

      if (!data.ok) {
        // Apps Script answers a POST with a 302 and the browser follows it as a GET.
        // Occasionally the request reaches /exec as a bare GET with no body at all, so
        // the script sees no token and says so — even though the token is fine. On a
        // read that's worth another go rather than an alarming error.
        if (LOST_BODY.test(data.error || '') && i < attempts - 1) {
          lastErr = new Error(data.error);
          continue;
        }
        throw new Error(data.error || 'Interviews request failed.');
      }
      return data.result;

    } catch (err) {
      // A thrown error from the response body is a real answer; don't retry it.
      if (!/Retrying|returned \d+/.test(err.message) && !(err instanceof TypeError)) throw err;
      lastErr = err;
    }
  }

  throw new Error(
    (lastErr?.message || 'Interviews could not be reached.').replace(' Retrying…', '') +
    ' Google\'s script service is being flaky — hit Refresh and try again.'
  );
}
