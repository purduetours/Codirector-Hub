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
export function openModal(root) {
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
  root.hidden = true;
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
  $$('.modal-root').forEach(r => { if (!r.hidden) closeModal(r); });
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
