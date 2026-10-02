/* ===================================================================== Audit
   A readable record of who changed what: people added and archived, roles
   changed, semesters started, settings edited. Written by the database itself
   whenever an admin function runs, so it cannot be skipped by a screen that
   forgets to log, and it never contains passwords or keys.

   Read-only, and administrators only (the table's policy says so).
============================================================================ */
import { select } from '../core/db.js';
import { $, esc, injectStyle, debounce } from '../core/ui.js';
import { downloadCsv } from '../core/csv.js';
import { emptyState, setupNotice, setupMissing } from './admin-kit.js';

injectStyle('audit-css', `
.au-row { display:grid; grid-template-columns:150px 1fr; gap:4px 14px; padding:11px 14px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev); margin-bottom:8px; font-size:.88rem; }
.au-when { color:var(--text-faint); font-size:.78rem; font-variant-numeric:tabular-nums; }
.au-what b { font-weight:650; } .au-what em { font-style:normal; color:var(--text-soft); display:block; font-size:.8rem; margin-top:2px; }
@media (max-width:640px){ .au-row { grid-template-columns:1fr; } }
`);

const WORDS = {
  'person.added': 'invited', 'person.updated': 'updated', 'person.role_changed': 'changed the role of', 'person.archived': 'archived',
  'person.restored': 'restored', 'person.invite_cancelled': 'cancelled the invitation for', 'role.updated': 'changed what the role grants:',
  'guide.added': 'added guide', 'guide.updated': 'edited guide', 'guide.archived': 'archived guide', 'guide.restored': 'restored guide',
  'term.saved': 'edited the semester', 'semester.started': 'started the semester', 'setting.changed': 'changed the setting',
  'reminders.changed': 'changed tour reminder settings', 'import.people': 'imported', 'import.guides': 'imported'
};
const GROUPS = [['', 'Everything'], ['person', 'People'], ['guide', 'Guides'], ['semester', 'Semesters'], ['term', 'Semester edits'], ['role', 'Roles'], ['setting', 'Settings'], ['import', 'Imports']];

const show = v => v == null ? '' : typeof v === 'object' ? Object.entries(v).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${k.replace(/_/g, ' ')}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(', ') : String(v);

const when = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let rows = [], more = false;
const PAGE = 50;

function paint() {
  const g = $('#au-group').value, q = $('#au-q').value.trim().toLowerCase();
  const list = rows.filter(r => (!g || r.action.startsWith(g + '.')) && (!q || `${r.actor_name} ${r.target_label} ${r.action} ${r.note || ''}`.toLowerCase().includes(q)));
  $('#au-list').innerHTML = list.length ? list.map(r => `<div class="au-row"><span class="au-when">${esc(when(r.at))}</span>
    <span class="au-what"><b>${esc(r.actor_name || 'Someone')}</b> ${esc(WORDS[r.action] || r.action)} <b>${esc(r.target_label || '')}</b>
    ${r.before || r.after ? `<em>${r.before ? `${esc(show(r.before))} → ` : ''}${esc(show(r.after))}</em>` : ''}${r.note ? `<em>Reason: ${esc(r.note)}</em>` : ''}</span></div>`).join('')
    : emptyState({ title: rows.length ? 'Nothing matches that filter' : 'No administrative changes recorded yet',
        text: rows.length ? 'Try a different filter.' : 'When someone is added or archived, a role changes, or a semester starts, it appears here.', icon: 'search' });
  $('#au-more').hidden = !more;
}

async function load(append = false) {
  const got = await select('admin_audit', `select=*&order=at.desc&limit=${PAGE + 1}&offset=${append ? rows.length : 0}`);
  more = got.length > PAGE;
  rows = append ? rows.concat(got.slice(0, PAGE)) : got.slice(0, PAGE);
}

export default {
  id: 'audit', needs: 'admin', title: 'Activity', crumb: 'Who changed what, and when', icon: '📜', section: 'Tools', quiet: true,

  async mount(view) {
    view.innerHTML = `<div id="au-setup"></div><div class="pp-bar"><input id="au-q" type="search" placeholder="Search by name or action" aria-label="Search the activity log">
      <select id="au-group" class="select" aria-label="Type">${GROUPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" id="au-export">Export CSV</button></div>
      <div id="au-list"></div><div style="text-align:center;margin:12px"><button class="btn btn-ghost" id="au-more" hidden>Show older</button></div>`;
    try { await load(); } catch (e) { if (setupMissing(e)) { $('#au-setup').innerHTML = setupNotice(); } else $('#au-list').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    paint();
    $('#au-group').addEventListener('change', paint);
    $('#au-q').addEventListener('input', debounce(paint, 120));
    $('#au-more').addEventListener('click', async () => { await load(true); paint(); });
    $('#au-export').addEventListener('click', () => downloadCsv('activity', [['When', 'Who', 'Action', 'Target', 'Before', 'After', 'Reason'],
      ...rows.map(r => [r.at, r.actor_name, r.action, r.target_label, show(r.before), show(r.after), r.note || ''])]));
  }
};
