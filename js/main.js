/* ============================================================ hub entry point */
import { initPresence, resetPresence } from './core/presence.js';
import { state, myName, isAdmin, inTraining, onSessionReset } from './core/state.js';
import { initAuth, showGate, hideGate, restore, refreshIfStale } from './core/auth.js';
import { register, buildNav, render, paintNav, go, list, visibleModules, onRoute } from './core/router.js';
import { $, $$, esc, initials, toast } from './core/ui.js';
import { ICONS } from './core/icons.js';
import { hintsFor } from './core/vanessa-hints.js';
import { TOOL_INFO } from './core/vanessa-context.js';
import { bustSheets, loadAbsences, formStamp } from './core/sheets.js';
import { registerEvalActions } from './core/vanessa-eval.js';
import { submitReviewedEval } from './core/vanessa-eval-submit.js';
import { initVanessa, registerWarmers, prewarm, resetVanessa, resetWarmup, openVanessa, toggleVanessa, onVanessaToggle } from './core/vanessa-ui.js';
import { initQuickSearch } from './core/quicksearch.js';

import evals, { loadRoster } from './modules/evals.js';
import interviews    from './modules/interviews.js';
import schedule      from './modules/schedule.js';
import directory     from './modules/directory.js';
import desks         from './modules/desks.js';
import announcements from './modules/announcements.js';
import today         from './modules/today.js';
import people        from './modules/people.js';
import training      from './modules/training.js';
import health        from './modules/health.js';

[today, announcements, evals, interviews, training, schedule, directory, desks, people, health].forEach(register);

/* The modules already know how to fetch their own data; Vanessa just asks them
   to, rather than reaching past them into the database herself. */
registerWarmers([
  { needs: 'training', label: 'evaluations', load: () => (state.guides.length ? null : loadRoster()) },
  { needs: 'recruitment', label: 'interviews', load: () => interviews.prefetch?.() },
  { needs: 'any', label: 'tour schedule', load: () => schedule.prefetch?.() },
  { needs: 'training', label: 'desk coverage', load: () => desks.prefetch?.() },
  { needs: 'admin', label: 'training attendance', load: () => training.prefetch?.() }
]);

onSessionReset(() => {
  list().forEach(m => m.bust?.()); bustSheets(); resetVanessa(); resetPresence();
  $('#view').replaceChildren();
});

registerEvalActions({ load: loadRoster, submit: submitReviewedEval });

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
  initQuickSearch();
  initPresence();
  await render();
  paintShell();

  /* Load what Vanessa needs now, in the background, rather than when somebody
     clicks her and waits. The screen is already painted at this point, so this
     costs the user nothing and saves them a pause later. */
  prewarm();
}

/* ------------------------------------------------- what came in overnight
   A line on the sign-in page saying how many absence submissions have arrived
   since this person last read them.

   Two deliberate limits.

   It shows a COUNT and nothing else. The sign-in page is public — anybody who
   reaches the URL sees it, signed in or not — so a student's name next to
   "will be absent" has no business there. The names are one sign-in away.

   And it only appears where a Developer last signed in, because that is who
   asked to be told. Everyone else gets the ordinary sign-in page.
-------------------------------------------------------------------------- */
const ABS_SEEN = 'hub2.abs.seen';

async function paintGateNews() {
  const el = $('#gate-news');
  if (!el) return;
  try { if (localStorage.getItem('hub2.dev') !== '1') return; } catch { return; }

  try {
    const rows = await loadAbsences();
    if (!rows.length) return;

    let seen = 0;
    try { seen = Number(localStorage.getItem(ABS_SEEN) || 0); } catch {}
    const fresh = rows.filter(r => formStamp(r.when) > seen);
    if (!fresh.length) return;

    const newest = new Date(Math.max(...fresh.map(r => formStamp(r.when))));
    el.textContent = `${fresh.length} new absence ${fresh.length === 1 ? 'submission' : 'submissions'} ` +
      `since you last looked — the most recent ${newest.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}. ` +
      `Sign in to see who.`;
    el.hidden = false;
  } catch { /* the form is unreachable; the sign-in page is not the place to say so */ }
}
paintGateNews();

/* --------------------------------------------------------- version stamp
   "Did my upload actually go live?"

   GitHub Pages tells browsers to hold these files for ten minutes without
   checking, so right after an upload the answer is often no, and there was no
   way to tell except by squinting at the page. This asks the server when
   index.html was last written and prints it, which needs no version number to
   remember to bump — every upload changes it by itself.

   The request deliberately bypasses the cache, or it would cheerfully report
   the age of the copy already in the browser, which is precisely the thing in
   doubt. If the file on the server is newer than the one this page was built
   from, it says so: your upload has landed and a reload will pick it up.
-------------------------------------------------------------------------- */
async function paintVersion() {
  const el = $('#rail-ver');
  if (!el) return;
  try {
    const res = await fetch(`${location.pathname}?v=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    const when = res.headers.get('last-modified');
    if (!when) { el.textContent = ''; return; }

    const built = new Date(when);
    const stamp = built.toLocaleString(undefined,
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

    // Newer on the server than what this tab loaded? Then this tab is behind.
    const loaded = window.__hubLoadedAt || 0;
    if (loaded && built.getTime() > loaded + 1000) {
      el.textContent = `Updated ${stamp} — reload to get it`;
      el.classList.add('stale');
    } else {
      el.textContent = `Updated ${stamp}`;
      el.classList.remove('stale');
    }
  } catch { el.textContent = ''; }
}
paintVersion();
// Cheap enough to re-check occasionally, so a tab left open all day notices.
setInterval(paintVersion, 10 * 60 * 1000);

/* ------------------------------------------------------------- dark mode
   Follows the laptop until somebody says otherwise, then remembers.

   The button says what it will DO, not what is currently on — "Dark mode" when
   you are in daylight. A toggle labelled with its own current state is the
   classic way to make people click it twice to find out which way round it is.
-------------------------------------------------------------------------- */
const THEME_KEY = 'hub2.theme';
// Noir is the identity, so dark is the default; light is an explicit choice.
const isDark = () => document.documentElement.dataset.theme !== 'light';

function paintTheme() {
  const dark = isDark();
  const btn = $('#btn-theme');
  if (!btn) return;
  $('#theme-ico').innerHTML = dark ? ICONS.sun : ICONS.moon;
  $('#theme-lbl').textContent = dark ? 'Light mode' : 'Dark mode';
  btn.setAttribute('aria-pressed', String(dark));
  btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

$('#btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private window */ }
  paintTheme();
});

/* Somebody who has never touched the toggle should still follow their laptop
   when it flips at sunset. */
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (!document.documentElement.dataset.theme) paintTheme();
});

paintTheme();

const app = $('#app');

/* --- shell chrome ------------------------------------------------------ */
$('#burger').innerHTML = ICONS.menu;
$('#refresh-ico').innerHTML = ICONS.refresh;
$('#rollover-ico').innerHTML = ICONS.rollover;
$('#who-out').innerHTML = ICONS.signout;
$('#dock-home-ico').innerHTML = ICONS.today;
$('#dock-menu-ico').innerHTML = ICONS.menu;

/* Vanessa is opened from the rail, the top bar and the phone dock. All three
   go through the one launcher, so her open/closed state has one owner. */
['#rail-ask', '#v-top', '#dock-vanessa', '#v-float'].forEach(sel =>
  $(sel).addEventListener('click', () => { app.classList.remove('nav-open'); toggleVanessa(); }));
onVanessaToggle(isOpen => $('#v-top').setAttribute('aria-expanded', String(isOpen)));

/* Depth and glass: the ambient light drifts at its own pace as the page
   scrolls, and the top bar turns to glass once content passes under it.
   One passive listener, throttled to the frame. */
let scrollTick = false;
window.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    document.documentElement.style.setProperty('--scroll', String(Math.round(window.scrollY)));
    document.body.classList.toggle('is-scrolled', window.scrollY > 8);
    // Which way you are going: the corner pill tucks away on the way down.
    const y = window.scrollY;
    if (Math.abs(y - lastY) > 6) { document.body.classList.toggle('is-scrolling-down', y > lastY && y > 120); lastY = y; }
  });
}, { passive: true });
let lastY = 0;

/* Fold the rail to icons on a big screen, for people who know the way. */
const paintFold = () => {
  const folded = document.documentElement.classList.contains('rail-folded');
  $('#rail-fold').setAttribute('aria-pressed', String(folded));
  $('#rail-fold').setAttribute('aria-label', folded ? 'Unfold the sidebar' : 'Fold the sidebar');
};
$('#rail-fold').innerHTML = ICONS.arrow;
$('#rail-fold').addEventListener('click', () => {
  const folded = document.documentElement.classList.toggle('rail-folded');
  try { localStorage.setItem('hub2.rail', folded ? 'folded' : 'open'); } catch { /* private window */ }
  paintFold();
});
paintFold();

/* The corner control names the page and her best question for it. Arriving
   from Home, she introduces herself for a moment — "here with you in Eval
   Tracker" — then settles into the corner. */
let lastRoute = null, peekTimer = null;
onRoute(mod => {
  const [first] = hintsFor(mod.id);
  const float = $('#v-float');
  $('#v-float-title').textContent = `Ask Vanessa about ${mod.title}`;
  $('#v-float-sub').textContent = first ? `Try “${first}”` : 'Questions, tours, the handbook';
  clearTimeout(peekTimer);
  float.classList.remove('is-peek');
  if (lastRoute === 'today' && mod.id !== 'today') {
    $('#v-float-sub').textContent = `Here with you in ${mod.title}${first ? ` · try “${first}”` : ''}`;
    float.classList.add('is-peek');
    peekTimer = setTimeout(() => {
      float.classList.remove('is-peek');
      $('#v-float-sub').textContent = first ? `Try “${first}”` : 'Questions, tours, the handbook';
    }, 3200);
  }
  lastRoute = mod.id;
});

/* Her one contextual question for the page you are on. */
onRoute(mod => {
  const box = $('#v-hint');
  const qs = hintsFor(mod.id);
  const helps = TOOL_INFO[mod.id]?.helps;
  box.hidden = mod.id === 'today' || (!qs.length && !helps);
  box.innerHTML = box.hidden ? '' :
    `<span class="v-hint-lead"><span class="orb orb-xs"><i></i></span>` +
    `<span class="v-hint-say">You're in ${esc(mod.title)}.${helps ? ` ${esc(helps)}` : ''}</span></span>` +
    qs.map(q => `<button type="button" class="v-hint-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
});
$('#v-hint').addEventListener('click', e => {
  const chip = e.target.closest('[data-ask]');
  if (chip) openVanessa(chip.dataset.ask);
});

/* The home screen asks her things too; it raises this rather than importing
   her panel, so the module stays a plain page. */
document.addEventListener('hub:ask', e => openVanessa(e.detail?.question || ''));
$('#btn-refresh').addEventListener('click', async function () {
  this.classList.add('is-busy');
  try {
    list().forEach(m => m.bust?.());
    bustSheets(); resetWarmup();
    if (inTraining()) await loadRoster();
    paintShell(); paintNav(); await render();
    prewarm();
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
$('#burger').addEventListener('click', () => app.classList.toggle('nav-open'));
$('#dock-menu').addEventListener('click', () => app.classList.toggle('nav-open'));
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
