/* ============================================================ hub entry point */
import { state, myName, isAdmin } from './core/state.js';
import { initAuth, showGate, hideGate, restore, refreshIfStale } from './core/auth.js';
import { register, buildNav, render, paintNav, go, list, visibleModules } from './core/router.js';
import { $, $$, initials, toast } from './core/ui.js';
import { initVanessa, registerWarmers } from './core/vanessa-ui.js';

import evals, { loadRoster } from './modules/evals.js';
import interviews    from './modules/interviews.js';
import schedule      from './modules/schedule.js';
import directory     from './modules/directory.js';
import desks         from './modules/desks.js';
import announcements from './modules/announcements.js';
import today         from './modules/today.js';

[today, announcements, evals, interviews, schedule, directory, desks].forEach(register);

/* The modules already know how to fetch their own data; Vanessa just asks them
   to, rather than reaching past them into the database herself. */
registerWarmers([
  { needs: 'training',    load: () => (state.guides.length ? null : loadRoster()) },
  { needs: 'recruitment', load: () => interviews.prefetch?.() },
  { needs: 'any',         load: () => schedule.prefetch?.() },
  { needs: 'any',         load: () => desks.prefetch?.() }
]);

function paintShell() {
  $('#who-name').textContent = myName();
  $('#who-role').textContent = state.role?.name || '';
  $('#who-avatar').textContent = initials(myName());
  $('#hub-term').textContent = window.CONFIG?.TERM_LABEL || '';
  $('#btn-rollover').hidden = !isAdmin();
  $('#sync').textContent = state.loadedAt
    ? 'Synced ' + state.loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
}

async function start() {
  paintShell();
  buildNav();
  initVanessa();
  await render();
  paintShell();
}

/* --- shell chrome ------------------------------------------------------ */
$('#btn-refresh').addEventListener('click', async function () {
  this.classList.add('is-busy');
  try {
    list().forEach(m => m.bust?.());
    await loadRoster();
    paintShell(); paintNav(); await render();
    toast('Up to date.');
  } catch (err) {
    toast(err.message, 'err');
  }
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

/* Sessions last about an hour. Renew quietly in the background so nobody is
   thrown back to the sign-in screen in the middle of writing an eval. */
setInterval(() => { refreshIfStale().catch(() => {}); }, 5 * 60 * 1000);

/* --- boot -------------------------------------------------------------- */
initAuth(start);

restore()
  .then(ok => { if (ok) { hideGate(); return start(); } showGate(); })
  .catch(err => showGate(err.message));
