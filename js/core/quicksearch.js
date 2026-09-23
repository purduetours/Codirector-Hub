/* ============================================================ quick search
   One box that finds a person, from anywhere in the hub.

   The hub now knows a lot about each guide — eval status, training, makeups,
   majors, tours, desk shifts — and it is all reachable, but only by picking
   the right tab first and then filtering. Asking "what is going on with
   Saandiya" meant three screens.

   This is deliberately only people. A search that also returned tabs, sessions
   and announcements would need ranking rules and would still mostly be used to
   find somebody, so it does the one job well: type part of a name, press
   Enter, land on them.
============================================================================ */
import { state, isAdmin, inTraining, inRecruitment } from './state.js';
import { $, esc, injectStyle } from './ui.js';
import { go } from './router.js';
import { interviewData } from '../modules/interviews.js';

injectStyle('qs-css', `
.qs-wrap { position:relative; flex:none; }
.qs-wrap::before { content:""; position:absolute; left:13px; top:50%; width:15px; height:15px; transform:translateY(-50%);
  pointer-events:none; opacity:.55;
  background:currentColor; color:var(--text-faint);
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='6.5'/%3E%3Cpath d='m20 20-4.2-4.2'/%3E%3C/svg%3E") center/contain no-repeat;
          mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='6.5'/%3E%3Cpath d='m20 20-4.2-4.2'/%3E%3C/svg%3E") center/contain no-repeat; }
.qs-input { font:inherit; font-size:var(--fs-sm) !important; padding:8px 30px 8px 35px !important; width:210px !important;
  min-height:36px; border:1px solid var(--line) !important; border-radius:999px !important;
  background:var(--bg-elev) !important; color:var(--text); box-shadow:none !important;
  transition:width var(--dur-3) var(--ease), border-color var(--dur-2) !important; }
.qs-input:focus { outline:none; border-color:var(--gold-deep) !important; box-shadow:var(--ring) !important; width:280px !important; }
.qs-wrap::after { content:"/"; position:absolute; right:11px; top:50%; transform:translateY(-50%);
  font:600 .68rem var(--mono); color:var(--text-faint); border:1px solid var(--line-strong);
  border-radius:5px; padding:0 5px; line-height:1.5; pointer-events:none; }
.qs-wrap:focus-within::after { display:none; }
.qs-pop { position:absolute; top:calc(100% + 8px); right:0; z-index:70; width:310px; padding:6px;
  background:var(--bg-elev); border:1px solid var(--line); border-radius:var(--radius);
  box-shadow:var(--shadow-lg); overflow:hidden; animation:pop var(--dur-2) var(--ease-out); }
.qs-hit { display:block; width:100%; text-align:left; font:inherit; border:0; background:none;
  padding:9px 12px; cursor:pointer; color:var(--text); border-radius:10px; }
.qs-hit:hover, .qs-hit.on { background:var(--gold-wash); }
.qs-hit b { display:block; font-size:var(--fs-sm); font-weight:700; }
.qs-hit em { display:block; font-style:normal; font-size:var(--fs-xs); color:var(--text-faint); }
.qs-none { padding:10px 12px; font-size:var(--fs-sm); color:var(--text-faint); }
@media (max-width:1100px){ .qs-input { width:160px !important; } .qs-input:focus { width:220px !important; } }
@media (max-width:860px){ .qs-wrap::after { display:none; } .qs-input { width:40px !important; padding-right:8px !important; color:transparent; cursor:pointer; }
  .qs-input::placeholder { color:transparent; }
  .qs-input:focus { width:min(60vw,240px) !important; color:var(--text); cursor:text; }
  .qs-input:focus::placeholder { color:var(--text-faint); }
  .qs-pop { position:fixed; left:12px; right:12px; top:calc(64px + env(safe-area-inset-top)); width:auto; } }
@media print { .qs-wrap { display:none; } }
`);

let hits = [], cursor = 0;

/** Guides and, in recruitment, interview candidates. */
function search(q) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const words = t.split(/\s+/).filter(Boolean);
  const out = [];

  const score = name => {
    const low = String(name || '').toLowerCase();
    if (!words.every(w => low.includes(w))) return 0;
    return low.startsWith(words[0]) ? 3 : 1;      // a leading match ranks first
  };

  if (inTraining()) {
    for (const g of state.guides || []) {
      const s = score(g.name);
      if (s) out.push({ s, name: g.name, sub: g.priority || 'guide', go: 'directory', kind: 'guide' });
    }
  }
  if (inRecruitment()) {
    for (const c of interviewData()?.candidates || []) {
      const s = score(c.name);
      if (s) out.push({ s, name: c.name, sub: `candidate${c.group ? ' · ' + c.group : ''}`, go: 'interviews', kind: 'candidate' });
    }
  }
  return out.sort((a, b) => b.s - a.s || a.name.localeCompare(b.name)).slice(0, 7);
}

function paint(pop) {
  if (!hits.length) {
    pop.innerHTML = '<div class="qs-none">Nobody by that name.</div>';
    return;
  }
  pop.innerHTML = hits.map((h, i) =>
    `<button class="qs-hit ${i === cursor ? 'on' : ''}" data-i="${i}">
       <b>${esc(h.name)}</b><em>${esc(h.sub)}</em></button>`).join('');
}

/**
 * Open whoever was chosen.
 *
 * The Directory is where a guide's full picture lives, so a guide goes there
 * with their name pre-filled rather than to a screen the person then has to
 * search again themselves.
 */
function open(hit) {
  if (!hit) return;
  sessionStorage.setItem('hub2.qs.jump', hit.name);
  go(hit.go);
}

export function initQuickSearch() {
  const host = $('.topbar-actions');
  if (!host || $('#qs-input')) return;

  const wrap = document.createElement('div');
  wrap.className = 'qs-wrap';
  wrap.innerHTML = `<input id="qs-input" class="qs-input" type="search" autocomplete="off"
    placeholder="Find a person…" aria-label="Find a person">`;
  host.prepend(wrap);

  const input = $('#qs-input');
  let pop = null;

  const close = () => { pop?.remove(); pop = null; hits = []; cursor = 0; };

  const update = () => {
    hits = search(input.value);
    cursor = 0;
    if (!input.value.trim()) return close();
    if (!pop) { pop = document.createElement('div'); pop.className = 'qs-pop'; wrap.append(pop); }
    paint(pop);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (input.value.trim()) update(); });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % hits.length; paint(pop); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); cursor = (cursor - 1 + hits.length) % hits.length; paint(pop); }
    if (e.key === 'Enter')     { e.preventDefault(); const h = hits[cursor]; input.value = ''; close(); open(h); }
  });

  wrap.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const h = hits[Number(b.dataset.i)];
    input.value = ''; close(); open(h);
  });

  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });

  /* "/" focuses the box, the way every search field on the web does. Ignored
     while someone is already typing somewhere, or it eats the character. */
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    if (t.matches?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    input.focus();
  });
}

/** Consumed by whichever screen was opened, so it can jump to the person. */
export function takeJumpTarget() {
  const v = sessionStorage.getItem('hub2.qs.jump');
  if (v) sessionStorage.removeItem('hub2.qs.jump');
  return v;
}
