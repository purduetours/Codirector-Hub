/* ============================================================ hub entry point */
import { state, onChange } from './core/state.js';
import { initAuth, showGate, hideGate, loadSession, refreshSession } from './core/auth.js';
import { register, buildNav, render, paintNav, go } from './core/router.js';
import { $, $$, initials, toast } from './core/ui.js';

import evals         from './modules/evals.js';
import schedule      from './modules/schedule.js';
import directory     from './modules/directory.js';
import desks         from './modules/desks.js';
import guideroom     from './modules/guideroom.js';
import announcements from './modules/announcements.js';

[announcements, evals, guideroom, schedule, directory, desks].forEach(register);

function paintShell() {
  $('#who-name').textContent = state.name;
  $('#who-role').textContent = state.isAdmin ? 'Codirector' : 'Committee';
  $('#who-avatar').textContent = initials(state.name);
  $('#hub-term').textContent = window.CONFIG?.TERM_LABEL || '';
  $('#btn-rollover').hidden = !state.isAdmin;
  $('#sync').textContent = state.loadedAt
    ? 'Synced ' + state.loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
}

async function start() {
  paintShell();
  buildNav();
  await render();
}

/* --- shell chrome ------------------------------------------------------ */
$('#btn-refresh').addEventListener('click', async function () {
  this.classList.add('is-busy');
  if (await refreshSession()) { paintShell(); paintNav(); await render(); toast('Up to date.'); }
  this.classList.remove('is-busy');
});

$('#btn-rollover').addEventListener('click', async () => {
  if (location.hash.slice(2) !== 'evals') { go('evals'); await new Promise(r => setTimeout(r, 220)); }
  evals.openRollover();
});

// mobile nav
const app = $('#app');
$('#burger').addEventListener('click', () => app.classList.toggle('nav-open'));
$('#nav-scrim').addEventListener('click', () => app.classList.remove('nav-open'));
$('#nav').addEventListener('click', e => { if (e.target.closest('.navlink')) app.classList.remove('nav-open'); });

/* --- boot -------------------------------------------------------------- */
initAuth(start);

if (!state.name) {
  showGate();
} else {
  hideGate();
  loadSession()
    .then(start)
    .catch(err => showGate(err.message));
}
