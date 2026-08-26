/* ============================================================ API client
   Every module talks to Apps Script through this. Nothing else should call
   fetch() directly — auth headers and error shapes live here.
============================================================================ */
import { state } from './state.js';

/**
 * Read-only actions. Apps Script answers a POST with a 302 to a single-use
 * googleusercontent URL; that second hop intermittently 404s under load, so these
 * are safe and worth retrying. Writes are deliberately not retried — the script may
 * have already run before the redirect failed, and replaying a claim or a rollover
 * would do real damage.
 */
const READS = new Set(['list', 'tourSchedule', 'desks', 'announcements']);

/** The signature of a request that lost its body on the redirect hop. */
const LOST_BODY = /incorrect access code/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Backoff between retries. Apps Script sheds load when it's busy, and hammering it
 * a few hundred milliseconds later just adds to the pile — so wait over a second,
 * with a little jitter so several people retrying at once don't sync up.
 */
const backoff = i => 1200 * i + Math.random() * 600;

export async function api(action, payload = {}) {
  const url = window.CONFIG?.API_URL;
  if (!url || url.startsWith('PASTE_')) {
    throw new Error('config.js still has the placeholder API_URL. Paste your Apps Script /exec URL into it.');
  }

  const body = { action, code: state.code, evaluator: state.name, ...payload };
  const attempts = READS.has(action) ? 3 : 1;
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(backoff(i));

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        // text/plain keeps this a "simple" request, so the browser skips the CORS
        // preflight that Apps Script cannot answer.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow'
      });
    } catch {
      lastErr = new Error('Could not reach the server. Check your connection.');
      continue;
    }

    if (!res.ok) {
      lastErr = new Error(res.status === 404
        ? "Google dropped that request (404)."
        : `Server returned ${res.status}. Check the web app is deployed to "Anyone".`);
      continue;
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Got a non-JSON reply. Set the deployment access to "Anyone".');
    }

    if (!data.ok) {
      // Same redirect quirk as above: a POST that arrives as a bodyless GET has no
      // code attached, so the server correctly rejects it. Retry reads before
      // telling someone their access code is wrong when it isn't.
      if (LOST_BODY.test(data.error || '') && i < attempts - 1) {
        lastErr = new Error(data.error);
        continue;
      }
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  }

  throw new Error((lastErr?.message || 'Request failed.') +
    " Google's script service is being flaky — hit Refresh and try again.");
}

/** Actions the backend doesn't implement yet return a recognisable error. */
export function isUnsupported(err) {
  return /unknown action/i.test(err?.message || '');
}
