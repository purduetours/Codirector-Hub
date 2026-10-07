/* ============================================================ command palette
   Cmd/Ctrl+K from anywhere: pages, actions and people in one box, so a
   codirector can reach any advanced feature without it living in the sidebar.

   Everything offered is filtered by the same checks as the rest of the hub —
   visibleModules(), visibleHubs(), has(needs) — so the palette can never list
   a place or a verb the role cannot use. It searches only what is already in
   memory (page list, loaded roster, loaded candidates): no network, no index.

   Also owns the "+" quick-actions menu, which is the same list narrowed to
   the verbs worth one click.
============================================================================ */
import { go, visibleModules, visibleHubs } from './router.js';
import { visibleActions } from './nav.js';
import { runAction } from './actions.js';
import { iconFor, ICONS } from './icons.js';
import { $, esc } from './ui.js';
import { people, jumpTo } from './quicksearch.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------- the index */
function pages() {
  const mods = visibleModules().filter(m => !m.soon);
  const hubs = visibleHubs();
  return [
    ...hubs.map(h => ({ kind: 'Page', title: h.title, hint: h.crumb, icon: ICONS[h.icon] || ICONS.more, words: h.id, run: () => go(h.id) })),
    ...mods.map(m => ({ kind: 'Page', title: m.title, hint: m.crumb, icon: iconFor(m), words: `${m.id} ${m.id === 'today' ? 'dashboard' : ''}`, run: () => go(m.id) }))
  ];
}
const actions = () => visibleActions().map(a => ({
  kind: 'Action', title: a.title, hint: a.hint, icon: ICONS[a.icon] || ICONS.spark, words: a.words, run: () => runAction(a.id)
}));

function match(items, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.map(it => {
    const hay = `${it.title} ${it.words || ''} ${it.hint || ''}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
    const t = it.title.toLowerCase();
    return { it, s: t.startsWith(words[0]) ? 3 : t.includes(words[0]) ? 2 : 1 };
  }).filter(Boolean).sort((a, b) => b.s - a.s).map(x => x.it);
}

function results(q) {
  q = q.trim();
  if (!q) return [...actions().filter(a => a.kind === 'Action').slice(0, 5), ...pages().slice(0, 8)];
  return [
    ...match(actions(), q).slice(0, 5),
    ...match(pages(), q).slice(0, 6),
    ...people(q).map(p => ({ kind: 'Person', title: p.name, hint: p.sub, icon: ICONS.user, run: () => jumpTo(p) }))
  ];
}

/* --------------------------------------------------------------------- UI */
let root = null, list = [], cursor = 0, opener = null;

function paintList() {
  const box = $('#pal-list', root);
  if (!list.length) { box.innerHTML = '<p class="pal-none">Nothing matches.</p>'; $('#pal-input', root).removeAttribute('aria-activedescendant'); return; }
  let last = '';
  box.innerHTML = list.map((r, i) => {
    const head = r.kind !== last ? `<div class="pal-group" role="presentation">${r.kind === 'Person' ? 'People' : r.kind + 's'}</div>` : '';
    last = r.kind;
    return `${head}<button type="button" role="option" id="pal-o${i}" class="pal-item ${i === cursor ? 'on' : ''}" data-i="${i}" aria-selected="${i === cursor}">
      <span class="pal-ico" aria-hidden="true">${r.icon || ''}</span>
      <span class="pal-txt"><b>${esc(r.title)}</b>${r.hint ? `<em>${esc(r.hint)}</em>` : ''}</span></button>`;
  }).join('');
  $('#pal-input', root).setAttribute('aria-activedescendant', `pal-o${cursor}`);
  $('#pal-o' + cursor, root)?.scrollIntoView({ block: 'nearest' });
}

function build() {
  root = document.createElement('div');
  root.className = 'pal'; root.hidden = true;
  root.innerHTML = `<div class="pal-scrim" data-close></div>
    <div class="pal-box" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div class="pal-top"><span aria-hidden="true">${ICONS.search}</span>
        <input id="pal-input" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true"
          aria-controls="pal-list" aria-autocomplete="list" placeholder="Search pages, people and actions…" aria-label="Search pages, people and actions">
        <kbd>Esc</kbd></div>
      <div id="pal-list" class="pal-list" role="listbox" aria-label="Results"></div>
    </div>`;
  document.body.append(root);

  const input = $('#pal-input', root);
  const refresh = () => { list = results(input.value); cursor = 0; paintList(); };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % Math.max(list.length, 1); paintList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = (cursor - 1 + list.length) % Math.max(list.length, 1); paintList(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(list[cursor]); }
    else if (e.key === 'Tab') e.preventDefault();       // the box is the only stop; Esc leaves
  });
  root.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-i]');
    if (b) choose(list[Number(b.dataset.i)]);
  });
  root.addEventListener('mousemove', e => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== cursor) {
      $('#pal-o' + cursor, root)?.classList.remove('on'); cursor = Number(b.dataset.i); b.classList.add('on');
    }
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
}

function choose(r) { if (!r) return; close(false); r.run(); }

export function openPalette() {
  if (!root) build();
  if (!root.hidden) return;
  opener = document.activeElement;
  root.hidden = false;
  document.body.classList.add('pal-open');
  const input = $('#pal-input', root);
  input.value = ''; list = results(''); cursor = 0; paintList();
  input.focus();
}

export function close(restore = true) {
  if (!root || root.hidden) return;
  root.hidden = true;
  document.body.classList.remove('pal-open');
  if (restore && opener?.isConnected) opener.focus?.();
}

/* ------------------------------------------------------------ "+" menu */
let menu = null;
function closeMenu() { menu?.remove(); menu = null; $('#btn-quick')?.setAttribute('aria-expanded', 'false'); }

function openMenu(btn) {
  const acts = visibleActions().filter(a => a.quick);
  menu = document.createElement('div');
  menu.className = 'qa-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Quick actions');
  menu.innerHTML = acts.map(a => `<button type="button" role="menuitem" class="qa-item" data-act="${esc(a.id)}">
    <span class="pal-ico" aria-hidden="true">${ICONS[a.icon] || ICONS.spark}</span>
    <span class="pal-txt"><b>${esc(a.title)}</b><em>${esc(a.hint)}</em></span></button>`).join('');
  btn.parentElement.append(menu);
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
  menu.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { closeMenu(); runAction(b.dataset.act); } });
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMenu(); btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
}

/* ------------------------------------------------------------------- init */
export function initPalette() {
  const host = $('.topbar-actions');
  if (!host || $('#btn-search')) return;

  const search = document.createElement('button');
  search.id = 'btn-search'; search.type = 'button'; search.className = 'qs-btn';
  search.setAttribute('aria-label', 'Search and commands');
  search.innerHTML = `${ICONS.search}<span class="qs-lbl">Search</span><kbd>${isMac ? '⌘' : 'Ctrl '}K</kbd>`;
  host.prepend(search);
  search.addEventListener('click', openPalette);

  const quick = visibleActions().some(a => a.quick);
  if (quick) {
    const wrap = document.createElement('div');
    wrap.className = 'qa-wrap';
    wrap.innerHTML = `<button id="btn-quick" type="button" class="icon-btn qa-btn" aria-label="Quick actions" aria-haspopup="menu" aria-expanded="false" title="Quick actions">${ICONS.plus}</button>`;
    host.prepend(wrap);
    $('#btn-quick').addEventListener('click', e => { menu ? closeMenu() : openMenu(e.currentTarget); });
    document.addEventListener('click', e => { if (menu && !wrap.contains(e.target)) closeMenu(); });
  }

  document.addEventListener('hub:palette', openPalette);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); root && !root.hidden ? close() : openPalette(); return; }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.target.matches?.('input, textarea, select, [contenteditable]')) {
      e.preventDefault(); openPalette();
    }
  });
}
