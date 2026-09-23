import { setVanessaState } from './vanessa-state.js';
/* ============================================================ UI helpers
   Small, dependency-free utilities every module reaches for.
============================================================================ */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts.at(-1)[0]).toUpperCase();
}

export function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/* --- dates ------------------------------------------------------------- */
export function prettyDate(iso, opts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
}

export function prettyTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '';
  let h = +m[1];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* --- toasts ------------------------------------------------------------ */
export function toast(message, kind) {
  // Every confirmation and failure in the hub comes through here, so this is
  // where Vanessa's orb learns about them: a brief glow for done, a tint for
  // something wrong.
  setVanessaState(kind === 'err' ? 'error' : 'success');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }, kind === 'err' ? 5200 : 3200);
}

/* --- errors in forms --------------------------------------------------- */
export function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
  // Modal bodies scroll — an error pinned below the fold looks like nothing happened.
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

/* --- modals ------------------------------------------------------------ */
/* Who had focus before the dialog opened, so it can be given back. */
const focusBefore = new WeakMap();

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
                  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);

/**
 * Opens a dialog properly.
 *
 * Previously this only hid and showed markup, which is fine with a mouse and
 * poor with anything else: focus stayed behind on the page, Tab wandered off
 * into the sidebar underneath, and closing left focus on <body> so the next
 * Tab started again from the top of the document. Anyone on a keyboard or a
 * screen reader had to hunt for their place every time they claimed an eval.
 */
const leaving = new WeakMap();
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function openModal(root) {
  clearTimeout(leaving.get(root)); root.classList.remove('is-leaving');
  focusBefore.set(root, document.activeElement);
  root.hidden = false;
  document.body.style.overflow = 'hidden';

  const panel = root.querySelector('.modal') || root;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const title = panel.querySelector('h2');
  if (title) {
    if (!title.id) title.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
    panel.setAttribute('aria-labelledby', title.id);
  }

  // First real field, or the panel itself — never a Cancel button.
  const first = focusables(panel).find(el => !el.hasAttribute('data-close'));
  (first || panel).focus?.();
  if (!first) panel.tabIndex = -1;
}

export function closeModal(root) {
  /* It plays a short exit before it is hidden. Everything that matters —
     the scroll lock, focus — is released at once; only the paint lingers, and
     reopening in that moment cancels it. */
  if (calm() || !root.isConnected) root.hidden = true;
  else {
    root.classList.add('is-leaving');
    clearTimeout(leaving.get(root));
    leaving.set(root, setTimeout(() => { root.hidden = true; root.classList.remove('is-leaving'); }, 170));
  }
  document.body.style.overflow = '';
  const back = focusBefore.get(root);
  focusBefore.delete(root);
  // Put them back where they were, if it is still on the page.
  if (back?.isConnected) back.focus?.();
}

export function wireModal(root) {
  root.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeModal(root);
  });

  /* Keep Tab inside the dialog. Without this it walks out of the modal and
     into the page behind it, which is still there and still clickable. */
  root.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || root.hidden) return;
    const panel = root.querySelector('.modal') || root;
    const items = focusables(panel);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/**
 * Closes whatever is open, releasing the body scroll lock with it.
 *
 * Modals are markup inside the view, so navigating away deletes them outright and
 * closeModal never runs — leaving the lock on with no modal left to lift it, and
 * the page silently stuck unscrollable. The router calls this before it repaints.
 */
export function closeAllModals() {
  $$('.modal-root').forEach(r => { if (!r.hidden && !r.classList.contains('is-leaving')) closeModal(r); });
}

/* ================================================================ motion
   Called by the router once a screen has mounted. Two small things that
   make every page feel of a piece without any module having to ask:

   · reveal   surfaces rise into place as they scroll into view, a few at a
              time, rather than the whole page appearing at once
   · tabs     the segmented tab control gets a highlight that slides to the
              chosen tab instead of jumping

   Both are presentation only, both step aside for reduced motion, and a
   module that re-renders its own list later simply gets it without the
   entrance — nothing ever waits on an animation to become usable. */
const REVEAL = '[data-reveal], .card, .panel, .stats > .stat, .tr-wrap, .gr-wrap, .sch-day, .tr-owe, .tr-abs, .ev-day, .ev-cal';
let io = null;

export function reveal(root) {
  if (calm() || !('IntersectionObserver' in window)) return;
  io ||= new IntersectionObserver(entries => {
    let n = 0;
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      el.style.setProperty('--rv-d', `${Math.min(n++, 8) * 45}ms`);
      el.classList.add('rv-in');
      io.unobserve(el);
      // Hand the element back to its own hover transitions once it has landed.
      const done = () => { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--rv-d'); };
      el.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 1200);
    });
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0.04 });

  $$(REVEAL, root)
    .filter(el => !el.closest('.modal-root') && !el.classList.contains('rv'))
    .forEach(el => { el.classList.add('rv'); io.observe(el); });
}

let tabObservers = [];
export function glideTabs(root) {
  // The previous screen's tabs are gone; so are their observers.
  tabObservers.forEach(o => o.disconnect()); tabObservers = [];
  $$('.tabs', root).forEach(tabs => {
    if (tabs.querySelector(':scope > .tab-glider')) return;
    const glider = document.createElement('span');
    glider.className = 'tab-glider';
    glider.setAttribute('aria-hidden', 'true');
    tabs.prepend(glider);
    tabs.classList.add('has-glider');
    const place = () => {
      const on = tabs.querySelector('.tab.is-active:not([hidden])');
      if (!on) { glider.style.opacity = '0'; return; }
      glider.style.opacity = '1';
      glider.style.width = `${on.offsetWidth}px`;
      glider.style.height = `${on.offsetHeight}px`;
      glider.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    };
    glider.style.transition = 'none';
    place();
    requestAnimationFrame(() => { glider.style.transition = ''; });
    const mo = new MutationObserver(place), ro = new ResizeObserver(place);
    mo.observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
    ro.observe(tabs);
    tabObservers.push(mo, ro);
  });
}

export function settle(root) {
  if (!root) return;
  reveal(root);
  glideTabs(root);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});

/* --- misc -------------------------------------------------------------- */
export function debounce(fn, ms = 140) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Per-module CSS, injected once. */
export function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

export const SEARCH_ICON =
  '<svg class="search-icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
