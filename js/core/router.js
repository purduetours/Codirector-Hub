/* ============================================================ hash router
   Modules register themselves; the router owns which one is mounted. Hash-based
   so it works on GitHub Pages with no server rewrites.
============================================================================ */
import { $, $$, closeAllModals, settle } from './ui.js';
import { isAdmin, inTraining, inRecruitment } from './state.js';
import { iconFor } from './icons.js';
import { setVanessaState } from './vanessa-state.js';

const modules = new Map();
let current = null;

/* Things outside the router that care which screen is showing — the Vanessa
   hint under the title, the phone dock. Told after every mount. */
const routeListeners = new Set();
export function onRoute(fn) { routeListeners.add(fn); return () => routeListeners.delete(fn); }
export const currentModule = () => current;

/**
 * @param {object} mod
 *   id, title, icon, section, adminOnly?, soon?, mount(el), unmount?(), badge?()
 */
export function register(mod) {
  modules.set(mod.id, mod);
}

export function list() {
  return [...modules.values()];
}

/**
 * What this person is allowed to see in the sidebar.
 *
 * A module declares what it needs -- 'admin', 'training' or 'recruitment' --
 * and the answer comes from their role in the database. Hiding a tab is only
 * tidiness: the database refuses the data regardless, so typing the address in
 * by hand gets an empty screen rather than somebody else's evals.
 */
export function visibleModules() {
  return list().filter(m => {
    if (m.needs === 'admin')       return isAdmin();
    if (m.needs === 'training')    return inTraining();
    if (m.needs === 'recruitment') return inRecruitment();
    return true;
  });
}

export function go(id) {
  if (location.hash.slice(2) === id) render();
  else location.hash = '#/' + id;
}

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const mods = visibleModules().filter(m => !m.soon);
  if (modules.has(id) && mods.some(m => m.id === id)) return id;

  /* Bounced somewhere else, so say so.

     Asking for a tab your role cannot see used to land you on Eval Tracker
     while the address bar still read #/interviews — so bookmarking it, copying
     the link to somebody, or pressing Back all did something other than what
     the URL promised. Rewriting the hash costs nothing and keeps the address
     honest. `replace` rather than assignment, so the route you cannot reach
     does not become a Back-button trap. */
  const fallback = mods[0]?.id || null;
  if (fallback && id && id !== fallback) {
    location.replace(`${location.pathname}${location.search}#/${fallback}`);
  }
  return fallback;
}

let rendering = false;
let queued = null;

/**
 * Renders the module named by the hash.
 *
 * Serialised on purpose: mounts are async (most fetch before painting), and two
 * overlapping mounts race to write the same view — the loser paints stale or
 * empty content into the winner's page. Clicking quickly through the sidebar is
 * enough to trigger it, so a render that arrives mid-flight is queued and run
 * once the current one settles.
 */
export async function render() {
  if (rendering) { queued = true; return; }
  rendering = true;
  try {
    await renderOnce();
  } finally {
    rendering = false;
    if (queued) { queued = false; await render(); }
  }
}

/* ------------------------------------------------------------ transitions
   Moving between screens should feel like one surface changing shape, not a
   page being thrown away. Where the browser supports View Transitions the
   rail and top bar hold still while the workspace glides; when a tool is
   picked from Vanessa's home, the tile itself expands into the workspace.

   Only the painting is wrapped. The data fetch (mount) happens after the
   transition has captured the new frame, so a slow request can never hold
   an animation hostage — the workspace arrives, then its content rises in.
   Routes, hashes and the render queue are exactly as they were. */
let pendingMorph = null;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Navigate, growing the workspace out of `el` (a tile or action). */
export function morphTo(id, el) {
  pendingMorph = el || null;
  go(id);
}

function tint(id) {
  const root = document.documentElement;
  const c = getComputedStyle(root).getPropertyValue(`--t-${id}`).trim();
  if (c) root.style.setProperty('--ambient-tint', c);
}

async function renderOnce() {
  const id = currentId();
  if (!id) return;
  const mod = modules.get(id);
  const changing = !current || current.id !== id;
  const firstPaint = !current;
  const fromId = current?.id || null;

  if (current && current.id !== id && current.unmount) {
    try { current.unmount(); } catch { /* a broken teardown shouldn't block navigation */ }
  }

  // Anything still open belongs to the outgoing view and is about to be wiped with
  // it. Close it properly first, or its scroll lock outlives it.
  closeAllModals();

  const view = $('#view');
  const from = pendingMorph?.isConnected ? pendingMorph : null;
  pendingMorph = null;

  const swap = () => {
    current = mod;
    paintNav();
    $('#view-title').textContent = mod.title;
    $('#view-crumb').textContent = mod.crumb || '';
    document.body.dataset.route = mod.id;
    document.documentElement.style.setProperty('--tool', `var(--t-${mod.id}, var(--gold-deep))`);
    tint(mod.id);
    const ico = $('#view-ico');
    if (ico) ico.innerHTML = iconFor(mod);

    view.classList.remove('is-entering', 'is-handing');
    view.style.viewTransitionName = '';
    /* A module that can draw its frame instantly (Home) does so inside the
       transition, so the new screen has real shapes to animate into — her
       orb, most of all. Everything else shows the loader and fills in after. */
    if (mod.prepaint) {
      try { mod.prepaint(view); } catch { view.innerHTML = ''; }
    } else {
      view.innerHTML = `<div class="loading loading-v" role="status">
        <span class="orb orb-sm"><i></i></span>
        <p>Opening ${mod.title}…</p>
        <div class="skel-lines"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>
      </div>`;
    }
    if (changing) window.scrollTo({ top: 0, behavior: 'instant' });
    if (from) document.documentElement.classList.add('vt-morph');
    routeListeners.forEach(fn => { try { fn(mod); } catch { /* a listener never blocks a page */ } });
  };

  /* A background tab cannot run a view transition (the browser refuses with
     InvalidStateError), so it just swaps. An aborted one is harmless — the
     swap still runs — so its promises are caught rather than left to shout. */
  if (document.startViewTransition && changing && !firstPaint && !reducedMotion() && document.visibilityState === 'visible') {
    if (from) {
      from.style.viewTransitionName = 'workspace';
      const fromIco = from.querySelector('[data-morph-ico]');
      if (fromIco) fromIco.style.viewTransitionName = 'tool-ico';
      view.style.viewTransitionName = 'none';   // the tile is the workspace, for one frame
    }
    // Going home plays the handoff backwards: the workspace recedes and
    // Vanessa comes forward again.
    const homeward = id === 'today' && fromId && fromId !== 'today';
    if (homeward) document.documentElement.classList.add('vt-home');
    const vt = document.startViewTransition(swap);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => document.documentElement.classList.remove('vt-morph', 'vt-home'));
    try { await vt.updateCallbackDone; } catch { /* swap threw; fall through and mount anyway */ }
  } else {
    swap();
  }

  try {
    await mod.mount(view);
  } catch (err) {
    /* Said the way she would say it, with a way to try again — and the real
       error still in the console, and one click away on screen, for whoever
       is debugging. */
    console.error(`[${mod.id}]`, err);
    view.innerHTML = `<div class="v-fail" role="alert">
        <span class="orb orb-sm"><i></i></span>
        <h3>I couldn't open ${mod.title} just now.</h3>
        <p>It is usually the connection. Try again, and if it keeps happening the details below will help whoever looks after the hub.</p>
        <div class="v-fail-acts"><button type="button" class="btn btn-primary" data-retry>Try again</button>
          <a class="btn btn-ghost" href="#/today">Back to Home</a></div>
        <details><summary>Details</summary><code>${String(err?.message || err).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code></details>
      </div>`;
    setVanessaState('error');
    view.querySelector('[data-retry]')?.addEventListener('click', () => render());
  }
  // Replay the entrance once the real content is in, not over the spinner.
  void view.offsetWidth;
  view.classList.add('is-entering');
  settle(view);
}

export function paintNav() {
  const id = currentId();
  $$('.navlink').forEach(a => {
    a.classList.toggle('is-active', a.dataset.mod === id);
    const mod = modules.get(a.dataset.mod);
    const badge = mod?.badge?.();
    const slot = a.querySelector('.count');
    if (slot) {
      slot.textContent = badge ?? '';
      slot.hidden = !badge;
    }
    if (badge) a.dataset.badge = badge; else delete a.dataset.badge;
  });
  $$('[data-dock]').forEach(a => a.classList.toggle('is-active', a.dataset.dock === id));
}

export function buildNav() {
  const rail = $('#nav');
  const sections = {};
  /* Codirector-only tools get their own group, so a codirector can see at a
     glance which screens are theirs alone — and nobody else ever sees the
     heading, because visibleModules() has already removed those tools. */
  visibleModules().forEach(m => (sections[m.needs === 'admin' ? 'Codirectors' : m.section] ||= []).push(m));

  rail.innerHTML = Object.entries(sections).map(([name, mods]) => `
    <div class="rail-section">${name}</div>
    ${mods.map(m => `
      <a class="navlink ${m.soon ? 'is-soon' : ''}" ${m.soon ? '' : `href="#/${m.id}"`} data-mod="${m.id}"
         style="--tool:var(--t-${m.id}, var(--gold-deep))" title="${m.title}">
        <span class="ico">${iconFor(m)}</span>
        <span class="lbl">${m.title}</span>
        ${m.soon ? '<span class="pill tone-mute">soon</span>' : '<span class="count" hidden></span>'}
      </a>`).join('')}
  `).join('');

  paintNav();
}

window.addEventListener('hashchange', render);
