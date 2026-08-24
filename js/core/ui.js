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
export function openModal(root) {
  root.hidden = false;
  document.body.style.overflow = 'hidden';
}
export function closeModal(root) {
  root.hidden = true;
  document.body.style.overflow = '';
}
export function wireModal(root) {
  root.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeModal(root);
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('.modal-root').forEach(r => { if (!r.hidden) closeModal(r); });
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
