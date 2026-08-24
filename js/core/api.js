/* ============================================================ API client
   Every module talks to Apps Script through this. Nothing else should call
   fetch() directly — auth headers and error shapes live here.
============================================================================ */
import { state } from './state.js';

export async function api(action, payload = {}) {
  const url = window.CONFIG?.API_URL;
  if (!url || url.startsWith('PASTE_')) {
    throw new Error('config.js still has the placeholder API_URL. Paste your Apps Script /exec URL into it.');
  }

  const body = { action, code: state.code, evaluator: state.name, ...payload };

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
  } catch (err) {
    throw new Error('Could not reach the server. Check your connection.');
  }

  if (!res.ok) {
    throw new Error(`Server returned ${res.status}. Check the web app is deployed to "Anyone".`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Got a non-JSON reply. Set the deployment access to "Anyone".');
  }

  if (!data.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** Actions the backend doesn't implement yet return a recognisable error. */
export function isUnsupported(err) {
  return /unknown action/i.test(err?.message || '');
}
