/* ============================================================ More
   Everything infrequent, in one calm place: who you are signed in as, what
   that lets you do, appearance, help and sign-out. Settings are sections of
   this page rather than navigation items of their own; the admin-only ones
   live under Admin.
============================================================================ */
import { state, myName, termLabel, has, setting } from '../core/state.js';
import { $, esc, initials } from '../core/ui.js';
import { visibleModules } from '../core/router.js';
import { orphans, hubById } from '../core/nav.js';
import { ICONS } from '../core/icons.js';
import { runAction } from '../core/actions.js';
import { hubCard, toolCard } from './hubs.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const isDark = () => document.documentElement.dataset.theme !== 'light';

/* What the role can do, in words — the answer to "why can't I see X?". */
function accessLines() {
  const r = state.role || {};
  const lines = ['Read the tour schedule and announcements'];
  if (r.in_training)    lines.push('Claim and write tour guide evaluations; see desk coverage and the guide directory');
  if (r.in_recruitment) lines.push('Check in and grade interview candidates');
  if (r.is_admin)       lines.push('Manage training attendance, people and access, announcements and semester tools');
  return lines;
}

function paint(view) {
  const mods = visibleModules();
  const extra = orphans(mods);
  const admin = has('admin') ? hubById('admin') : null;
  view.innerHTML = `
  <section class="more">
    <div class="more-profile">
      <span class="avatar avatar-lg" aria-hidden="true">${esc(initials(myName()))}</span>
      <div class="more-who"><h3>${esc(myName() || 'Signed in')}</h3>
        <p>${esc(state.role?.name || '')}${termLabel() ? ` · ${esc(termLabel())}` : ''}</p>
        ${state.me?.email ? `<p class="faint">${esc(state.me.email)}</p>` : ''}</div>
    </div>

    ${admin ? `<div class="more-block"><h4>Management</h4><div class="hub-grid">${hubCard({ href: '#/admin', icon: ICONS.admin, title: 'Admin', desc: admin.crumb, tool: 'people' })}</div></div>` : ''}

    <div class="more-block"><h4>What your account can do</h4>
      <ul class="more-access">${accessLines().map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="faint">Something missing? A codirector sets your role.</p></div>

    <div class="more-block"><h4>Preferences</h4>
      <div class="more-rows">
        <button type="button" class="more-row" data-act="theme"><span>Appearance</span><b id="more-theme">${isDark() ? 'Dark' : 'Light'} · tap to switch</b></button>
        <button type="button" class="more-row" data-act="refresh"><span>Data</span><b>Refresh everything</b></button>
        <button type="button" class="more-row" data-search><span>Search &amp; commands</span><b><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>K</kbd></b></button>
      </div></div>

    ${setting('contact.email', '') || setting('contact.name', '') ? `<div class="more-block"><h4>Who to ask</h4>
      <p class="faint" style="font-size:var(--fs-md);color:var(--text-soft)">${esc(setting('contact.name', 'The Codirectors'))}${setting('contact.email', '') ? ` · <a href="mailto:${esc(setting('contact.email', ''))}">${esc(setting('contact.email', ''))}</a>` : ''}</p></div>` : ''}

    <div class="more-block"><h4>Help</h4>
      <div class="more-rows">
        <button type="button" class="more-row" data-ask="What can you do?"><span>Vanessa</span><b>What can you help me with?</b></button>
        <button type="button" class="more-row" data-ask="Brief me"><span>Today</span><b>Brief me</b></button>
      </div></div>

    ${extra.length ? `<div class="more-block"><h4>Other tools</h4><div class="hub-grid">${extra.map(toolCard).join('')}</div></div>` : ''}

    <div class="more-block"><button type="button" class="btn btn-ghost" data-act="signout">Sign out</button></div>
  </section>`;
}

export default {
  id: 'more', title: 'More', crumb: 'Profile, appearance and help', icon: 'more', quiet: true,

  mount(view) {
    paint(view);
    view.querySelector('.more').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) { runAction(act.dataset.act); return; }
      const q = e.target.closest('[data-ask]');
      if (q) { document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: q.dataset.ask } })); return; }
      if (e.target.closest('[data-search]')) document.dispatchEvent(new CustomEvent('hub:palette'));
    });
    this._theme = () => { const t = $('#more-theme'); if (t) t.textContent = `${isDark() ? 'Dark' : 'Light'} · tap to switch`; };
    document.addEventListener('hub:theme-changed', this._theme);
  },
  unmount() { document.removeEventListener('hub:theme-changed', this._theme); }
};
