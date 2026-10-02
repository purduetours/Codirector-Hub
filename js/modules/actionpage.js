/* ============================================================ Action Center page
   Everything the bell summarises, grouped by how pressing it is, with the
   dismissed items one click away in case something was hidden by mistake.
============================================================================ */
import { $, esc } from '../core/ui.js';
import { getActions, LEVELS, dismissAction, restoreAction, refreshActions } from '../core/actioncenter.js';
import { prettyDate } from '../core/ui.js';
import { ICONS } from '../core/icons.js';

let listener = null;

function paint(view) {
  const all = getActions({ all: true });
  const live = all.filter(a => !a.dismissed), gone = all.filter(a => a.dismissed);
  const groups = Object.entries(LEVELS).map(([key, v]) => ({ key, label: v.label, rows: live.filter(a => a.level === key) })).filter(g => g.rows.length);
  view.innerHTML = `<section class="ac">
    ${groups.length ? groups.map(g => `<div class="ac-group is-${g.key}"><h3>${esc(g.label)} <span>${g.rows.length}</span></h3>
      <ul class="ac-list">${g.rows.map(a => `<li class="ac-row">
        <a class="ac-main" href="${esc(a.url || '#/today')}"><b>${esc(a.title)}</b>
          <em>${esc(a.detail || '')}</em>
          <span class="ac-meta">${esc(a.source)}${a.due ? ` · ${esc(prettyDate(a.due))}` : ''}</span></a>
        ${a.dismissible ? `<button type="button" class="btn btn-quiet btn-sm" data-dismiss="${esc(a.id)}">Dismiss</button>` : ''}
        <span class="ac-go" aria-hidden="true">${ICONS.arrow}</span></li>`).join('')}</ul></div>`).join('')
      : `<div class="empty-state"><span class="es-mark">${ICONS.check}</span><h3>You're all caught up</h3>
         <p>Nothing needs you right now. New items appear here when an evaluation is due, a notice is posted, or something needs a decision.</p></div>`}
    ${gone.length ? `<details class="ac-gone"><summary>${gone.length} dismissed</summary><ul class="ac-list">${gone.map(a => `<li class="ac-row">
      <span class="ac-main"><b>${esc(a.title)}</b><em>${esc(a.source)}</em></span>
      <button type="button" class="btn btn-quiet btn-sm" data-restore="${esc(a.id)}">Bring back</button></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

export default {
  id: 'actions', title: 'Action Center', crumb: 'Everything that needs you', icon: 'bell', quiet: true,
  async mount(view) {
    paint(view);
    await refreshActions({ force: true });
    paint(view);
    view.addEventListener('click', e => {
      const d = e.target.closest('[data-dismiss]'), r = e.target.closest('[data-restore]');
      if (d) dismissAction(d.dataset.dismiss); if (r) restoreAction(r.dataset.restore);
    });
    listener = () => paint(view);
    document.addEventListener('hub:actions', listener);
  },
  unmount() { document.removeEventListener('hub:actions', listener); }
};
