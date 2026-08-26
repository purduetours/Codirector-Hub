/* ============================================================ hub entry point */
import { state, onChange } from './core/state.js';
import { initAuth, showGate, hideGate, loadSession, refreshSession } from './core/auth.js';
import { register, buildNav, render, paintNav, go, list, visibleModules } from './core/router.js';
import { $, $$, initials, toast } from './core/ui.js';

import evals         from './modules/evals.js';
import schedule      from './modules/schedule.js';
import directory     from './modules/directory.js';
import desks         from './modules/desks.js';
import interviews    from './modules/interviews.js';
import announcements from './modules/announcements.js';

[announcements, evals, interviews, schedule, directory, desks].forEach(register);

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
  warmUp();
}

/**
 * Quietly loads the other tools once the first screen is up.
 *
 * Every one of these is a 3-8 second round trip to Apps Script, and paying it the
 * moment someone clicks is what makes the hub feel slow. Fetching ahead means the
 * tab is usually ready before they get there.
 *
 * Staggered on purpose: firing them together is exactly the pattern that makes
 * Google start dropping requests.
 */
async function warmUp() {
  const pending = visibleModules().filter(m => m.prefetch && m.id !== currentModuleId());
  for (const m of pending) {
    try {
      await m.prefetch();
      paintNav();                       // a prefetched badge can now be accurate
    } catch {
      // a failed warm-up is invisible; the tab will simply load on demand
    }
    await new Promise(r => setTimeout(r, 1200));
  }
}

function currentModuleId() {
  return location.hash.replace(/^#\/?/, '').split('?')[0];
}

/* --- shell chrome ------------------------------------------------------ */
$('#btn-refresh').addEventListener('click', async function () {
  this.classList.add('is-busy');
  // Modules hold their data for the session, so Refresh has to clear them or it
  // just re-renders the same cached rows.
  list().forEach(m => m.bust?.());
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
