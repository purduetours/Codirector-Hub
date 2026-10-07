/* ============================================================ the bell
   A single quiet entry point for "does anything need me?": a bell in the top
   bar with a count that only includes what is genuinely Urgent or Needs action.
   Upcoming and informational items are in the panel, never in the number, so
   the badge stays rare enough to mean something.
============================================================================ */
import { $, esc } from './ui.js';
import { ICONS } from './icons.js';
import { getActions, actionBadge, dismissAction, refreshActions, LEVELS } from './actioncenter.js';
import { onRoute } from './router.js';

let panel = null;

const row = a => `<li class="bl-item is-${a.level}">
  <a class="bl-link" href="${esc(a.url || '#/actions')}">
    <span class="bl-dot" aria-hidden="true"></span>
    <span class="bl-txt"><b>${esc(a.title)}</b>${a.detail ? `<em>${esc(a.detail)}</em>` : ''}</span>
    <span class="bl-tag">${esc(LEVELS[a.level].label)}</span>
  </a>
  ${a.dismissible ? `<button type="button" class="bl-x" data-dismiss="${esc(a.id)}" aria-label="Dismiss: ${esc(a.title)}" title="Dismiss">${ICONS.close}</button>` : ''}
</li>`;

function paintBadge() {
  const n = actionBadge();
  const btn = $('#btn-bell');
  if (!btn) return;
  const b = btn.querySelector('.bell-n');
  b.textContent = n > 9 ? '9+' : String(n || '');
  b.hidden = !n;
  btn.setAttribute('aria-label', n ? `Action Center, ${n} need${n === 1 ? 's' : ''} attention` : 'Action Center, nothing needs attention');
}

function paintPanel() {
  if (!panel) return;
  const list = getActions();
  panel.querySelector('.bl-body').innerHTML = list.length
    ? `<ul class="bl-list">${list.slice(0, 8).map(row).join('')}</ul>`
    : `<p class="bl-clear"><b>You're all caught up.</b><br>Nothing needs you right now.</p>`;
  panel.querySelector('.bl-more').hidden = list.length <= 8;
}

function close() { panel?.remove(); panel = null; $('#btn-bell')?.setAttribute('aria-expanded', 'false'); }

function open(btn) {
  panel = document.createElement('div');
  panel.className = 'bl-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Action Center');
  panel.innerHTML = `<header class="bl-head"><h3>Action Center</h3><a href="#/actions">View all</a></header>
    <div class="bl-body"></div><a class="bl-more" href="#/actions" hidden>See everything</a>`;
  btn.parentElement.append(panel);
  btn.setAttribute('aria-expanded', 'true');
  paintPanel();
  panel.addEventListener('click', e => {
    const x = e.target.closest('[data-dismiss]');
    if (x) { dismissAction(x.dataset.dismiss); return; }
    if (e.target.closest('a')) close();
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); btn.focus(); } });
  panel.querySelector('a')?.focus();
}

export function initBell() {
  const host = $('.topbar-actions');
  if (!host || $('#btn-bell')) return;
  const wrap = document.createElement('div');
  wrap.className = 'bell-wrap';
  wrap.innerHTML = `<button id="btn-bell" type="button" class="icon-btn bell" aria-haspopup="dialog" aria-expanded="false" aria-label="Action Center">
    ${ICONS.bell}<span class="bell-n" hidden></span></button>`;
  host.prepend(wrap);

  $('#btn-bell').addEventListener('click', e => { panel ? close() : open(e.currentTarget); });
  document.addEventListener('click', e => { if (panel && !wrap.contains(e.target)) close(); });
  document.addEventListener('hub:actions', () => { paintBadge(); paintPanel(); });
  onRoute(() => { close(); refreshActions(); });       // cheap: at most once a minute
  setInterval(() => { if (!document.hidden) refreshActions({ force: true }); }, 5 * 60 * 1000);
  paintBadge();
  refreshActions({ force: true });
}
