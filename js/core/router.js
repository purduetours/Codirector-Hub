/* ============================================================ hash router
   Modules register themselves; the router owns which one is mounted. Hash-based
   so it works on GitHub Pages with no server rewrites.
============================================================================ */
import { $, $$ } from './ui.js';
import { state } from './state.js';

const modules = new Map();
let current = null;

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

export function visibleModules() {
  return list().filter(m => !m.adminOnly || state.isAdmin);
}

export function go(id) {
  if (location.hash.slice(2) === id) render();
  else location.hash = '#/' + id;
}

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const mods = visibleModules().filter(m => !m.soon);
  if (modules.has(id) && mods.some(m => m.id === id)) return id;
  return mods[0]?.id || null;
}

export async function render() {
  const id = currentId();
  if (!id) return;
  const mod = modules.get(id);

  if (current && current.id !== id && current.unmount) {
    try { current.unmount(); } catch { /* a broken teardown shouldn't block navigation */ }
  }

  current = mod;
  paintNav();

  $('#view-title').textContent = mod.title;
  $('#view-crumb').textContent = mod.crumb || '';

  const view = $('#view');
  view.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading…</p></div>';

  try {
    await mod.mount(view);
  } catch (err) {
    view.innerHTML =
      `<div class="empty"><div class="empty-mark">⚠️</div><p>${err.message}</p></div>`;
  }
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
  });
}

export function buildNav() {
  const rail = $('#nav');
  const sections = {};
  visibleModules().forEach(m => (sections[m.section] ||= []).push(m));

  rail.innerHTML = Object.entries(sections).map(([name, mods]) => `
    <div class="rail-section">${name}</div>
    ${mods.map(m => `
      <a class="navlink ${m.soon ? 'is-soon' : ''}" ${m.soon ? '' : `href="#/${m.id}"`} data-mod="${m.id}">
        <span class="ico">${m.icon}</span>
        <span class="lbl">${m.title}</span>
        ${m.soon ? '<span class="pill tone-mute">soon</span>' : '<span class="count" hidden></span>'}
      </a>`).join('')}
  `).join('');

  paintNav();
}

window.addEventListener('hashchange', render);
