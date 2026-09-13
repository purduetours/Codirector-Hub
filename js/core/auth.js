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

  // Which term is current, so nothing has to hardcode it. A missing row is not
  // fatal — termId() falls back — but the hub would then be stuck on one term.
  try {
    const terms = await select('terms', 'select=id,label&is_current=is.true&limit=1');
    if (terms && terms[0]) state.term = terms[0];
  } catch { /* the fallback covers it */ }
  const roles = await select('roles', `select=*&name=eq.${encodeURIComponent(me.role)}`);
  state.role = (roles && roles[0]) || { name: me.role, is_admin: false, in_recruitment: false, in_training: false };

  /* Remember on THIS DEVICE that a Developer signed in here, so the sign-in
     page can show them what has come in while they were away.
     
     The sign-in page runs before anybody has identified themselves, so it
     cannot ask the database who is looking. A role kept on the device is the
     only thing available — and it is a role, not an email, so nothing
     identifying goes into the code or the browser store. Anyone else signing
     in on the same machine clears it again. */
  try {
    if (state.role?.name === 'Developer') localStorage.setItem('hub2.dev', '1');
    else localStorage.removeItem('hub2.dev');
  } catch { /* private window */ }

  return me;
}

export async function restore() {
  if (!loadSession()) return false;
  if (!(await refreshIfStale())) return false;
  try { await loadMe(); return true; } catch { clearSession(); return false; }
}

/**
 * Make a password for an address a codirector has already put on the list.
 *
 * This is not an open door. The database decides what a new account can see,
 * and it looks the address up on the invite list to do it: somebody who was
 * never added lands inactive, and every permission check requires an active
 * member, so they sign in to a hub with nothing in it. Being able to make a
 * password and being allowed to see anything are two different things.
 *
 * It exists so the hub can be handed on. The alternative is that adding a
 * person always means somebody opening the database itself, which is exactly
 * the job this is meant to remove.
 */
export async function signUp(email, password, fullName) {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = cfg();
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password,
      data: fullName ? { full_name: fullName } : undefined
    })
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data.error_code === 'signup_disabled' || /signups not allowed/i.test(data.msg || '')) {
      throw new Error(
        'New passwords are switched off for this hub. A codirector can turn them ' +
        'back on in Supabase under Authentication → Sign In / Providers → ' +
        '"Allow new users to sign up".');
    }
    throw new Error(data.error_description || data.msg || 'That did not work.');
  }

  // Email confirmation on: there is no token yet and they must click the link.
  if (!data.access_token) {
    throw new Error('Check your Purdue email for a confirmation link, then come back and sign in.');
  }

  saveSession(data);
  await loadMe();
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
  let making = false;                 // making a password, rather than signing in

  const paintMode = () => {
    $('#gate-name-wrap').hidden = !making;
    $('#gate-name').required = making;
    $('#gate-password').setAttribute('autocomplete', making ? 'new-password' : 'current-password');
    $('#gate-submit').textContent = making ? 'Create account' : 'Continue';
    $('#gate-swap-text').textContent = making ? 'Already have a password?' : 'First time here?';
    $('#gate-swap').textContent = making ? 'Sign in' : 'Make a password';
    $('#gate-error').hidden = true;
  };

  $('#gate-swap').addEventListener('click', () => { making = !making; paintMode(); });

  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#gate-email').value.trim();
    const password = $('#gate-password').value;
    if (!email || !password) return;

    const btn = $('#gate-submit');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = making ? 'Creating…' : 'Checking…';
    try {
      if (making) await signUp(email, password, $('#gate-name').value.trim());
      else await signIn(email, password);
      hideGate();
      onReady();
    } catch (err) {
      showGate(err.message);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-signout]')) signOut();
  });
}
