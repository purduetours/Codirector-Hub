/* ============================================================ sign-in
   Email and password against the database's own accounts.

   The old gate asked for a name and a shared code. Two problems that fixed
   themselves by moving here: the name is now whatever the account says, so a
   typo cannot file somebody's work under a person who does not exist; and a
   shared code cannot be passed around, because there is no shared code.
============================================================================ */
import { select } from './db.js';
import { state, saveSession, loadSession, clearSession } from './state.js';
import { $, toast } from './ui.js';

const cfg = () => window.CONFIG || {};

async function authCall(path, body) {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = cfg();
  const res = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.msg || 'That email and password did not match.');
  }
  return data;
}

export async function signIn(email, password) {
  saveSession(await authCall('token?grant_type=password', { email, password }));
  await loadMe();
}

/** Access tokens last about an hour; swap ours for a fresh one before it dies. */
export async function refreshIfStale() {
  if (!state.refreshToken) return false;
  if (Date.now() < state.expiresAt - 60_000) return true;
  try {
    saveSession(await authCall('token?grant_type=refresh_token', { refresh_token: state.refreshToken }));
    return true;
  } catch {
    return false;
  }
}

/** The id of the account this token was issued to, straight from the server. */
async function myUserId() {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = cfg();
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${state.token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error('Could not confirm who is signed in. Sign in again.');
  return data.id;
}

/**
 * Who am I, and what may I do?
 *
 * Both answers come from the database rather than from anything this browser
 * claims, so they cannot be tampered with from the console.
 */
export async function loadMe() {
  // Ask the auth server who this token belongs to. Reading the members table
  // and taking the first row is NOT the same thing: every member can see every
  // other member, so that returned an arbitrary colleague -- and then claims
  // and submitted evals would have been filed under their name.
  const uid = await myUserId();
  const rows = await select('members',
    `select=id,full_name,email,role,active&id=eq.${uid}&limit=1`);
  const me = rows && rows[0];
  if (!me || !me.active) {
    throw new Error('That account is not set up for the hub yet. Ask a codirector to add you.');
  }
  state.me = me;
  const roles = await select('roles', `select=*&name=eq.${encodeURIComponent(me.role)}`);
  state.role = (roles && roles[0]) || { name: me.role, is_admin: false, in_recruitment: false, in_training: false };
  return me;
}

export async function restore() {
  if (!loadSession()) return false;
  if (!(await refreshIfStale())) return false;
  try { await loadMe(); return true; } catch { clearSession(); return false; }
}

export function signOut() {
  clearSession();
  showGate();
}

/* ---------------------------------------------------------------- the gate */

export function showGate(message) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  const err = $('#gate-error');
  if (message) { err.textContent = message; err.hidden = false; } else err.hidden = true;
  setTimeout(() => $('#gate-email')?.focus(), 50);
}

export function hideGate() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
}

export function initAuth(onReady) {
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#gate-email').value.trim();
    const password = $('#gate-password').value;
    if (!email || !password) return;

    const btn = $('#gate-submit');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      await signIn(email, password);
      hideGate();
      onReady();
    } catch (err) {
      showGate(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Continue';
    }
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-signout]')) signOut();
  });
}
