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

export async function gr(fn, args = []) {
  const c = window.CONFIG?.GUIDE_ROOM;
  if (!grConfigured()) {
    throw new Error('Guide Room is not connected. Add its apiUrl and token to config.js.');
  }

  let res;
  try {
    res = await fetch(c.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: c.token, fn, args }),
      redirect: 'follow'
    });
  } catch {
    throw new Error('Could not reach Guide Room. Check the connection and the /exec URL.');
  }

  if (!res.ok) throw new Error(`Guide Room returned ${res.status}.`);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Guide Room sent a non-JSON reply — check its deployment access is "Anyone".');
  }

  if (!data.ok) throw new Error(data.error || 'Guide Room request failed.');
  return data.result;
}
