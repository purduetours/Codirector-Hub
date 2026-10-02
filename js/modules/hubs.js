/* ============================================================ hub pages
   Tours, Team and Admin: a calm landing page per area instead of one sidebar
   entry per tool. Each card is built from what the router says this role may
   open, so a person never sees a card for something they cannot use — and the
   cards cannot drift from the permission check, because they ask it.
============================================================================ */
import { $, esc } from '../core/ui.js';
import { visibleModules } from '../core/router.js';
import { HUBS, hubChildren, hubActions } from '../core/nav.js';
import { iconFor, ICONS } from '../core/icons.js';
import { runAction } from '../core/actions.js';

/** One destination: a tool (link) or an action (button). */
export function hubCard({ href, act, icon, title, desc, badge, tool }) {
  const tag = href ? `a href="${esc(href)}"` : `button type="button" data-act="${esc(act)}"`;
  const end = href ? 'a' : 'button';
  return `<${tag} class="hub-card" style="--tool:var(--t-${esc(tool || 'today')}, var(--gold-deep))">
    <span class="hub-ico" aria-hidden="true">${icon}</span>
    <span class="hub-body"><b>${esc(title)}</b><em>${esc(desc || '')}</em></span>
    ${badge ? `<span class="hub-badge" aria-label="${esc(badge)} waiting">${esc(badge)}</span>` : ''}
    <span class="hub-go" aria-hidden="true">${ICONS.arrow}</span>
  </${end}>`;
}

export const toolCard = m => hubCard({
  href: `#/${m.id}`, icon: iconFor(m), title: m.title, desc: m.crumb, badge: m.badge?.() || '', tool: m.id
});

function makeHub(def) {
  return {
    id: def.id, title: def.title, crumb: def.crumb, icon: def.icon, quiet: true,
    needs: def.needs,
    mount(view) {
      const mods = visibleModules();
      const kids = hubChildren(def, mods);
      const acts = hubActions(def);
      const grid = items => `<div class="hub-grid">${items.map(toolCard).join('')}</div>`;
      /* A hub may arrange its tools in labelled groups (Admin does), so the
         everyday ones are not mixed in with the ones used once a semester. */
      const body = def.groups
        ? def.groups.map(g => { const items = hubChildren({ children: g.children }, mods);
            return items.length ? `<h3 class="hub-h">${esc(g.title)}</h3>${grid(items)}` : ''; }).join('')
        : grid(kids);
      view.innerHTML = `
        <section class="hub" aria-label="${esc(def.title)}">
          <p class="hub-lede">${esc(def.lede)}</p>
          ${body}
          ${acts.length ? `<div class="hub-grid">${acts.map(a => hubCard({ act: a.id, icon: ICONS[a.icon] || ICONS.spark, title: a.title, desc: a.hint, tool: a.id })).join('')}</div>` : ''}
          ${def.advanced ? `<details class="hub-adv"><summary>Advanced</summary><p>${esc(def.advanced)}</p></details>` : ''}
        </section>`;
      view.querySelector('.hub').addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (b) runAction(b.dataset.act);
      });
    },
    unmount() {}
  };
}

export const hubModules = HUBS.filter(h => !['more', 'actions'].includes(h.id)).map(makeHub);
