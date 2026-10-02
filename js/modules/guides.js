/* ==================================================================== Guides
   The tour guide roster: the people who are evaluated and trained.

   Until now this list could only be changed in the database — adding a new
   guide in August, or removing the ones who graduated in May, meant SQL. It is
   now an ordinary screen:

     add, edit, archive, restore (one at a time or in bulk), import and export

   Guides are never deleted. Archiving takes someone off the Eval Tracker, the
   Directory and next semester's list, and keeps every evaluation and
   attendance record that points at them. The rules (no duplicates, valid
   priority, audit trail) are enforced in the database; see
   supabase/18-admin-operations.sql.
============================================================================ */
import { select } from '../core/db.js';
import { state, termId, termLabel } from '../core/state.js';
import { $, $$, esc, toast, injectStyle, initials, debounce } from '../core/ui.js';
import { downloadCsv, readTable, pick } from '../core/csv.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, fail } from './admin-kit.js';
import { loadRoster } from './evals.js';
import { refreshActions } from '../core/actioncenter.js';

injectStyle('guides-css', `
.gd-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
.gd-bar input[type=search] { flex:1 1 220px; min-width:0; width:auto; }
.gd-bar .select { width:auto; min-width:140px; flex:none; }
.gd-row { display:flex; align-items:center; gap:12px; padding:10px 14px; border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); margin-bottom:8px; }
.gd-row.is-out { opacity:.7; }
.gd-row input[type=checkbox] { width:17px; height:17px; accent-color:var(--accent); flex:none; }
.gd-who { flex:1; min-width:0; } .gd-who b { display:block; font-size:.9rem; } .gd-who em { font-style:normal; font-size:.75rem; color:var(--text-faint); }
.gd-prio { font-size:.74rem; color:var(--text-soft); flex:none; }
@media (max-width:640px){ .gd-row { flex-wrap:wrap; } .gd-prio { order:5; width:100%; } }
`);

let guides = [], prios = [], prioOf = new Map();
const ui = { q: '', show: 'active', picked: new Set(), importing: null };

async function load() {
  guides = await select('guides', 'select=id,first_name,last_name,full_name,email,active,archived_at,archive_reason&order=last_name.asc,first_name.asc')
    .catch(() => select('guides', 'select=id,first_name,last_name,full_name,active&order=last_name.asc,first_name.asc'));
  prios = await select('priorities', 'select=name,sort_order,needs_eval&order=sort_order.asc');
  const ev = await select('evals', `select=guide_id,priority&term_id=eq.${termId()}`).catch(() => []);
  prioOf = new Map((ev || []).map(e => [e.guide_id, e.priority]));
}

const shown = () => {
  const q = ui.q.trim().toLowerCase();
  return guides.filter(g => (ui.show === 'all' || (ui.show === 'active') === !!g.active) &&
    (!q || `${g.full_name} ${g.email || ''}`.toLowerCase().includes(q)));
};

function paintList() {
  const rows = shown();
  $('#gd-count').textContent = `${rows.length} shown · ${guides.filter(g => g.active).length} active, ${guides.filter(g => !g.active).length} archived`;
  $('#gd-list').innerHTML = rows.length ? rows.map(g => `<div class="gd-row ${g.active ? '' : 'is-out'}" data-id="${esc(g.id)}">
      <input type="checkbox" data-pick aria-label="Select ${esc(g.full_name)}" ${ui.picked.has(g.id) ? 'checked' : ''}>
      <span class="pp-av" aria-hidden="true">${esc(initials(g.full_name))}</span>
      <span class="gd-who"><b>${esc(g.full_name)}</b><em>${esc(g.email || 'no email on file')}${g.archive_reason ? ` · ${esc(g.archive_reason)}` : ''}</em></span>
      <span class="gd-prio">${g.active ? esc(prioOf.get(g.id) || 'Not on this semester’s tracker') : 'Archived'}</span>
      <button class="btn btn-quiet btn-sm" data-act="edit">Edit</button>
      <button class="btn ${g.active ? 'btn-quiet' : 'btn-ghost'} btn-sm" data-act="${g.active ? 'archive' : 'restore'}">${g.active ? 'Archive' : 'Restore'}</button>
    </div>`).join('')
    : emptyState(guides.length
      ? { title: 'Nobody matches those filters', text: 'Change the search or show Everyone.', icon: 'search' }
      : { title: `No guides on the roster for ${termLabel() || 'this semester'} yet`,
          text: 'Add guides one at a time, or import a CSV with first name, last name, email and priority columns.', icon: 'directory' });
  const n = ui.picked.size;
  $('#gd-selbar').innerHTML = n ? `<div class="pp-sel"><b>${n} selected</b>
    ${ui.show === 'archived' ? '<button class="btn btn-primary btn-sm" id="gd-bulkrestore">Restore selected</button>'
      : '<button class="btn btn-danger btn-sm" id="gd-bulkarchive">Archive selected</button>'}
    <button class="btn btn-quiet btn-sm" id="gd-bulkclear">Clear</button></div>` : '';
  $('#gd-all').checked = rows.length > 0 && rows.every(g => ui.picked.has(g.id));
}

async function refresh() { await load(); paintList(); loadRoster().catch(() => {}); refreshActions({ force: true }); }

const reasonFields = [{ name: 'reason', label: 'Reason (optional)', hint: 'For example: graduated, left the program.' }];

async function archiveIds(ids) {
  const out = await formDialog({ title: `Archive ${ids.length} ${ids.length === 1 ? 'guide' : 'guides'}?`,
    intro: 'They come off the Eval Tracker, the Directory and next semester. Their past evaluations and attendance are kept.',
    fields: reasonFields, submitLabel: 'Archive' });
  if (!out) return;
  await admin('admin_set_guides_active', { p_ids: ids, p_active: false, p_reason: out.reason || null });
  ui.picked.clear(); await refresh(); toast(`Archived ${ids.length}.`);
}

function importHtml(res) {
  return `<div class="card" style="margin-bottom:14px"><h3 style="font-size:.95rem;margin-bottom:4px">Check before importing</h3>
    <p class="muted" style="font-size:.82rem">${res.ok} row${res.ok === 1 ? '' : 's'} are fine${res.errors ? `, <strong>${res.errors} need fixing</strong>` : ''}. Nothing has been saved yet.</p>
    <table class="pp-prev"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Priority</th><th>What will happen</th></tr></thead><tbody>
    ${(res.rows || []).map(r => `<tr class="${r.status === 'error' ? 'bad' : ''}"><td>${r.row}</td><td>${esc(r.name)}</td><td>${esc(r.email || '')}</td><td>${esc(r.priority || '—')}</td><td class="st-${esc(r.status)}">${esc(r.message || '')}</td></tr>`).join('')}</tbody></table>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="gd-doimport" ${res.errors || !res.ok ? 'disabled' : ''}>Import ${res.ok}</button>
    <button class="btn btn-ghost" id="gd-cancelimport">Cancel</button></div>
    ${res.errors ? `<p class="muted" style="font-size:.8rem;margin-top:8px">Priorities must match exactly: ${prios.map(p => esc(p.name)).join('; ')}. Leave priority blank to use the first one.</p>` : ''}</div>`;
}

let abort = null;

export default {
  id: 'guides', needs: 'admin', title: 'Guides', crumb: 'The tour guide roster', icon: '🧭', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    Object.assign(ui, { q: '', show: 'active', picked: new Set(), importing: null });
    await load();
    view.innerHTML = `<div id="gd-setup"></div>
      <div class="gd-bar">
        <input id="gd-q" type="search" placeholder="Search guides" aria-label="Search guides">
        <select id="gd-show" class="select" aria-label="Show"><option value="active">Active</option><option value="archived">Archived</option><option value="all">Everyone</option></select>
        <button class="btn btn-primary btn-sm" id="gd-add">Add guide</button>
        <button class="btn btn-ghost btn-sm" id="gd-import">Import CSV</button>
        <button class="btn btn-ghost btn-sm" id="gd-export">Export CSV</button></div>
      <div id="gd-importbox"></div><div id="gd-selbar"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 2px 8px">
        <label style="font-size:.8rem;color:var(--text-soft);display:flex;gap:8px;align-items:center"><input type="checkbox" id="gd-all" style="width:16px;height:16px;accent-color:var(--accent)"> Select all shown</label>
        <span class="muted" style="font-size:.78rem" id="gd-count"></span></div>
      <div id="gd-list"></div>`;
    paintList();
    admin('admin_health').catch(e => { if (e.setup) $('#gd-setup').innerHTML = setupNotice(); });

    const guideForm = (g = {}) => formDialog({ title: g.id ? `Edit ${g.full_name}` : 'Add a guide', submitLabel: g.id ? 'Save' : 'Add guide',
      fields: [{ name: 'first', label: 'First name', value: g.first_name, required: true }, { name: 'last', label: 'Last name', value: g.last_name, required: true },
        { name: 'email', label: 'Email (optional)', type: 'email', value: g.email || '' },
        { name: 'priority', label: 'Evaluation priority', options: prios.map(p => p.name), value: prioOf.get(g.id) || prios.find(p => p.needs_eval)?.name }] });

    view.addEventListener('click', async e => {
      try {
        if (e.target.closest('#gd-add')) {
          const v = await guideForm(); if (!v) return;
          await admin('admin_save_guide', { p_id: null, p_first: v.first, p_last: v.last, p_email: v.email, p_priority: v.priority });
          await refresh(); toast(`${v.first} ${v.last} added.`); return;
        }
        if (e.target.closest('#gd-export')) { const n = downloadCsv('guides', [['First name', 'Last name', 'Email', 'Priority', 'Status'],
          ...guides.map(g => [g.first_name, g.last_name, g.email || '', prioOf.get(g.id) || '', g.active ? 'Active' : 'Archived'])]); toast(`Exported ${n} guides.`); return; }
        if (e.target.closest('#gd-import')) { const f = document.createElement('input'); f.type = 'file'; f.accept = '.csv,text/csv';
          f.onchange = async () => { try {
            const { records } = readTable(await f.files[0].text());
            const rows = records.map(r => ({ first: pick(r, 'firstname', 'first'), last: pick(r, 'lastname', 'last'), email: pick(r, 'email', 'purdueemail'), priority: pick(r, 'priority', 'evaluationpriority') }));
            if (!rows.length) throw new Error('That file has no rows. It needs a header line, then one guide per line.');
            ui.importing = rows; $('#gd-importbox').innerHTML = importHtml(await admin('admin_import_guides', { p_rows: rows, p_apply: false }));
          } catch (err) { $('#gd-importbox').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; } }; f.click(); return; }
        if (e.target.closest('#gd-cancelimport')) { $('#gd-importbox').innerHTML = ''; return; }
        if (e.target.closest('#gd-doimport')) { const r = await admin('admin_import_guides', { p_rows: ui.importing, p_apply: true });
          $('#gd-importbox').innerHTML = ''; await refresh(); toast(`Imported ${r.ok} guides.`); return; }
        if (e.target.closest('#gd-bulkclear')) { ui.picked.clear(); paintList(); return; }
        if (e.target.closest('#gd-bulkarchive')) { await archiveIds([...ui.picked]); return; }
        if (e.target.closest('#gd-bulkrestore')) { const ids = [...ui.picked]; await admin('admin_set_guides_active', { p_ids: ids, p_active: true }); ui.picked.clear(); await refresh(); toast(`Restored ${ids.length}.`); return; }

        const row = e.target.closest('.gd-row'), act = e.target.closest('[data-act]')?.dataset.act;
        if (!row || !act) return;
        const g = guides.find(x => x.id === row.dataset.id);
        if (act === 'edit') { const v = await guideForm(g); if (!v) return;
          await admin('admin_save_guide', { p_id: g.id, p_first: v.first, p_last: v.last, p_email: v.email, p_priority: v.priority }); await refresh(); toast('Saved.'); }
        else if (act === 'archive') await archiveIds([g.id]);
        else if (act === 'restore') { await admin('admin_set_guides_active', { p_ids: [g.id], p_active: true }); await refresh(); toast(`${g.full_name} restored.`); }
      } catch (err) { fail(err); }
    }, { signal });

    view.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('[data-pick]')) { const id = t.closest('.gd-row').dataset.id; t.checked ? ui.picked.add(id) : ui.picked.delete(id); paintList(); }
      else if (t.id === 'gd-all') { shown().forEach(g => t.checked ? ui.picked.add(g.id) : ui.picked.delete(g.id)); paintList(); }
      else if (t.id === 'gd-show') { ui.show = t.value; ui.picked.clear(); paintList(); }
    }, { signal });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'gd-q') { ui.q = e.target.value; paintList(); } }, 120), { signal });
  }
};
