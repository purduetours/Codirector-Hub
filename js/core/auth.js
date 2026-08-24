/* ============================================================ sign-in gate
   Same shared-code model as the standalone eval tracker: a name plus one of two
   codes. The committee code and the admin code go in the same box — the server
   works out which was used and answers with isAdmin.
============================================================================ */
import { api } from './api.js';
import { state, signIn, persistSession, signOut } from './state.js';
import { $, esc, toast } from './ui.js';

/**
 * Loads the shared roster payload. Everything the hub knows about guides comes
 * from this one call, so modules don't each hit the network.
 */
export async function loadSession() {
  const data = await api('list');
  state.isAdmin   = data.isAdmin === true;
  state.committee = data.committee || [];
  state.guides    = data.guides || [];
  state.counts    = data.counts || {};
  state.neededTotal = data.neededTotal || 0;
  state.loadedAt  = new Date();
  fillCommitteeList();
  return data;
}

function fillCommitteeList() {
  const dl = $('#committee-list');
  if (dl) dl.innerHTML = state.committee.map(n => `<option value="${esc(n)}"></option>`).join('');
}

export function showGate(message) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#gate-code-field').hidden = window.CONFIG?.REQUIRE_CODE === false;

  const err = $('#gate-error');
  if (message) { err.textContent = message; err.hidden = false; }
  else err.hidden = true;

  $('#gate-name').value = state.name || '';
  setTimeout(() => $('#gate-name').focus(), 50);
}

export function hideGate() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
}

/** Wires the gate form. `onReady` runs once a sign-in succeeds. */
export function initAuth(onReady) {
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#gate-name').value.trim();
    const code = $('#gate-code').value.trim();
    if (!name) return;

    signIn(name, code);

    const btn = $('#gate-submit');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      await loadSession();
      persistSession();
      hideGate();
      onReady();
    } catch (err) {
      showGate(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  });

  document.addEventListener('click', e => {
    if (e.target.closest('[data-signout]')) {
      signOut();
      showGate();
    }
  });
}

export async function refreshSession() {
  try {
    await loadSession();
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}
