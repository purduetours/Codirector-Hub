/* ================================================================ Tour Guides
   The Master Tour Guide List: one record per person, the identity every
   spreadsheet is matched back to.

   Everything routine is here, without SQL:
     add · edit · archive / restore · active THIS semester or not · major ·
     leadership · evaluator and tour eligibility · linked committee account ·
     evaluation priority and whether they still need evaluating · aliases (the
     other spellings the schedule or a sheet uses for them) · notes ·
     search, sort, filter, bulk actions, CSV import and export

   Three ideas worth knowing
     Archived       the person left; they leave every list, their history stays
     Inactive       they are still a guide but not taking part THIS semester
                    (reversible, and it never touches their history)
     Source badges  a field filled by a spreadsheet says which one. If you edit
                    it here, that is recorded as an override you can see, and
                    "Return to source value" undoes it. Nothing is silently
                    overwritten later and nothing is hidden.

   All rules (duplicates, valid priority, audit trail) are enforced in the
   database; see supabase/18- and 19-*.sql.
============================================================================ */
import { select } from '../core/db.js';
import { state, termId, termLabel } from '../core/state.js';
import { $, $$, esc, toast, injectStyle, debounce, openModal, closeModal } from '../core/ui.js';
import { downloadCsv, readTable, pick } from '../core/csv.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, fail } from './admin-kit.js';
import { tableHtml, bindTable, sortRows, nextSort } from './datatable.js';
import { loadRoster } from './evals.js';
import { refreshActions } from '../core/actioncenter.js';
import { nameKey } from '../core/identity.js';
import { priorityBand } from '../core/evalmatch.js';

injectStyle('guides-css', `
.gd-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
.gd-bar input[type=search] { flex:1 1 220px; min-width:0; width:auto; }
.gd-bar .select { width:auto; min-width:140px; flex:none; }
.gd-review { display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px 14px; margin-bottom:12px; border:1px solid color-mix(in srgb, var(--warn) 40%, var(--line)); border-radius:var(--radius-sm); background:var(--warn-bg); font-size:var(--fs-md); }
`);

let guides = [], prios = [], evalOf = new Map(), termOf = new Map(), overrides = new Map(), owners = {}, aliasRows = [], members = [], issueCount = 0;
let setupMissing = false;
const ui = { q: '', show: 'active', band: '', need: '', sort: { key: 'name', dir: 1 }, picked: new Set() };

const FIELDS_NEW = 'major,is_leadership,evaluator_eligible,tour_eligible,notes,member_id';
async function load() {
  guides = await select('guides', `select=id,first_name,last_name,full_name,email,active,archive_reason,${FIELDS_NEW}&order=last_name.asc,first_name.asc`)
    .catch(() => { setupMissing = true; return select('guides', 'select=id,first_name,last_name,full_name,email,active&order=last_name.asc').catch(() => select('guides', 'select=id,first_name,last_name,full_name,active&order=last_name.asc')); });
  const tid = termId();
  const [pr, ev, gt, ov, own, al, mem, iss] = await Promise.all([
    select('priorities', 'select=name,sort_order,needs_eval&order=sort_order.asc'),
    select('evals', `select=guide_id,priority&term_id=eq.${tid}`).catch(() => []),
    select('guide_terms', `select=guide_id,active&term_id=eq.${tid}`).catch(() => []),
    select('guide_overrides', 'select=guide_id,field,value,source_value').catch(() => []),
    select('field_ownership', 'select=field,owner').catch(() => []),
    select('external_identity_mappings', 'select=id,source_kind,external_key,external_name,guide_id,ignored&guide_id=not.is.null').catch(() => []),
    select('members', 'select=id,full_name&active=eq.true&order=full_name.asc').catch(() => []),
    select('sync_issues', 'select=id&status=eq.open').catch(() => [])
  ]);
  prios = pr; evalOf = new Map(ev.map(e => [e.guide_id, e.priority]));
  termOf = new Map(gt.map(t => [t.guide_id, t.active]));
  overrides = new Map(ov.map(o => [`${o.guide_id}|${o.field}`, o]));
  owners = Object.fromEntries(own.map(o => [o.field, o.owner])); aliasRows = al; members = mem; issueCount = iss.length;
}

const prio = g => prios.find(p => p.name === evalOf.get(g.id));
const inTerm = g => g.active && termOf.get(g.id) !== false;
const OWNER = { hub: 'the Hub', majors: 'Tour Guides by Major', roster: 'the master roster', tour_schedule: 'the tour schedule' };

function rows() {
  const q = ui.q.trim().toLowerCase();
  return guides.filter(g => {
    const st = ui.show;
    if (st === 'active' && !inTerm(g)) return false;
    if (st === 'inactive' && !(g.active && termOf.get(g.id) === false)) return false;
    if (st === 'archived' && g.active) return false;
    if (ui.band && priorityBand(prio(g)?.sort_order ?? 99, prio(g)?.needs_eval) !== ui.band) return false;
    if (ui.need === 'yes' && !prio(g)?.needs_eval) return false;
    if (ui.need === 'no' && prio(g)?.needs_eval) return false;
    return !q || `${g.full_name} ${g.email || ''} ${g.major || ''}`.toLowerCase().includes(q);
  });
}

const columns = [
  { key: 'name', label: 'Name', sortable: true, value: g => `${g.last_name} ${g.first_name}`, render: g => `<button type="button" class="dt-name" data-open="${esc(g.id)}">${esc(g.full_name)}</button>
      ${g.is_leadership ? '<span class="chip is-hi">Leadership</span>' : ''}${!g.active ? '<span class="chip is-mute">Archived</span>' : termOf.get(g.id) === false ? '<span class="chip is-warn">Inactive this semester</span>' : ''}` },
  { key: 'email', label: 'Email', sortable: true, render: g => esc(g.email || '—') },
  { key: 'major', label: 'Major', sortable: true, render: g => `${esc(g.major || '—')}${overrides.has(`${g.id}|major`) ? '<span class="chip is-warn" title="Set by hand; differs from the spreadsheet">override</span>' : ''}` },
  { key: 'priority', label: 'Priority', sortable: true, value: g => prio(g)?.sort_order ?? 99, render: g => { const p = prio(g); return p ? `${esc(p.name)}<span class="chip ${p.needs_eval ? (p.sort_order <= 2 ? 'is-hi' : '') : 'is-mute'}">${esc(priorityBand(p.sort_order, p.needs_eval))}</span>` : '<span class="muted">Not on roster</span>'; } },
  { key: 'aliases', label: 'Also known as', render: g => { const n = aliasRows.filter(a => a.guide_id === g.id && a.external_key.startsWith('name:')).length; return n ? `${n} spelling${n === 1 ? '' : 's'}` : '—'; } }
];

function paint() {
  const list = sortRows(rows(), columns, ui.sort);
  const active = guides.filter(inTerm).length;
  $('#gd-count').textContent = `${list.length} shown · ${active} active in ${termLabel() || 'this semester'} · ${guides.filter(g => !g.active).length} archived`;
  $('#gd-table').innerHTML = tableHtml({ columns, rows: list, sort: ui.sort, selected: ui.picked, rowKey: g => g.id,
    empty: emptyState(guides.length ? { title: 'Nobody matches those filters', text: 'Change the search or show Everyone.', icon: 'search' }
      : { title: `No Tour Guides yet for ${termLabel() || 'this semester'}`, text: 'Add guides one at a time, import a CSV, or connect the Tour Guides by Major sheet under Data Sources and create them from there.', icon: 'directory',
          action: '<div style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="#/sources">Connect a spreadsheet</a></div>' }) });
  const n = ui.picked.size;
  $('#gd-selbar').innerHTML = n ? `<div class="pp-sel"><b>${n} selected</b>
    <select id="gd-bulkprio" class="select" aria-label="Set priority"><option value="">Set priority…</option>${prios.map(p => `<option>${esc(p.name)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" data-bulk="need-yes">Needs evaluation</button><button class="btn btn-ghost btn-sm" data-bulk="need-no">No evaluation needed</button>
    <button class="btn btn-ghost btn-sm" data-bulk="term-on">Active this semester</button><button class="btn btn-ghost btn-sm" data-bulk="term-off">Inactive this semester</button>
    <button class="btn btn-ghost btn-sm" data-bulk="csv">Export</button>
    ${ui.show === 'archived' ? '<button class="btn btn-primary btn-sm" data-bulk="restore">Restore</button>' : '<button class="btn btn-danger btn-sm" data-bulk="archive">Archive</button>'}
    <button class="btn btn-quiet btn-sm" data-bulk="clear">Clear</button></div>` : '';
  $('#gd-review').hidden = !issueCount;
  $('#gd-review b').textContent = `${issueCount} item${issueCount === 1 ? '' : 's'}`;
}

async function refresh() { await load(); paint(); loadRoster().catch(() => {}); refreshActions({ force: true }); }

/* ----------------------------------------------------------------- drawer */
function drawer(g) {
  const isNew = !g;
  const ov = f => overrides.get(`${g?.id}|${f}`);
  const src = f => owners[f] && owners[f] !== 'hub' ? `<span class="src-badge">Filled by ${esc(OWNER[owners[f]] || owners[f])}</span>` : '<span class="src-badge">Set in the Hub</span>';
  const fieldNote = f => ov(f) ? `<span class="chip is-warn">override</span> <button type="button" class="btn btn-quiet btn-sm" data-clear="${f}">Return to source value (${esc(ov(f).source_value || 'blank')})</button>` : '';
  const aliases = isNew ? [] : aliasRows.filter(a => a.guide_id === g.id);
  const p = g && prio(g);
  const root = document.createElement('div');
  root.className = 'modal-root'; root.hidden = true;
  root.innerHTML = `<div class="modal-scrim" data-close></div>
   <form class="modal modal-xl" autocomplete="off">
    <header class="modal-head"><div><h2>${isNew ? 'Add a Tour Guide' : esc(g.full_name)}</h2>${isNew ? '' : `<p class="muted">${g.active ? (termOf.get(g.id) === false ? 'Inactive this semester' : 'Active') : 'Archived'}</p>`}</div></header>
    <div class="modal-body">
      <div class="drawer-grid">
        <label class="field"><span>First name</span><input name="first_name" value="${esc(g?.first_name || '')}" required></label>
        <label class="field"><span>Last name</span><input name="last_name" value="${esc(g?.last_name || '')}" required></label>
        <label class="field"><span>Email ${src('email')}</span><input name="email" type="email" value="${esc(g?.email || '')}"></label>
        <label class="field"><span>Major(s) ${src('major')}</span><input name="major" value="${esc(g?.major || '')}" placeholder="Computer Science; Data Science"><em>${isNew ? '' : fieldNote('major')}</em></label>
      </div>
      <div class="drawer-sec">Evaluation</div>
      <div class="drawer-grid">
        <label class="field"><span>Priority <span class="src-badge">Set in the Hub</span></span><select class="select" name="priority"><option value="">Not on the roster</option>${prios.map(x => `<option${p?.name === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="toggle-row"><input type="checkbox" name="evaluator_eligible" ${g?.evaluator_eligible !== false ? 'checked' : ''}> Can evaluate others</label>
        <label class="toggle-row"><input type="checkbox" name="tour_eligible" ${g?.tour_eligible !== false ? 'checked' : ''}> Eligible for tours</label>
        <label class="toggle-row"><input type="checkbox" name="is_leadership" ${g?.is_leadership ? 'checked' : ''}> Leadership</label>
      </div>
      ${isNew ? '' : `<div class="drawer-sec">This semester (${esc(termLabel())})</div>
      <label class="toggle-row"><input type="checkbox" name="in_term" ${g.active && termOf.get(g.id) !== false ? 'checked' : ''} ${g.active ? '' : 'disabled'}> Taking part this semester ${g.active ? '' : '(restore them first)'}</label>
      <div class="drawer-sec">Linked account</div>
      <label class="field"><span>Committee account (if this guide also signs in)</span><select class="select" name="member_id"><option value="">None</option>${members.map(m => `<option value="${esc(m.id)}"${g.member_id === m.id ? ' selected' : ''}>${esc(m.full_name)}</option>`).join('')}</select></label>
      <div class="drawer-sec">Also known as</div>
      <div class="alias-list">${aliases.length ? aliases.map(a => `<div class="alias-row"><span>${esc(a.external_name || a.external_key.replace(/^(name|email|id):/, ''))} <span class="src-badge">on ${esc(a.source_kind.replace('_', ' '))}</span></span><button type="button" class="btn btn-quiet btn-sm" data-forget="${a.id}">Forget</button></div>`).join('') : '<p class="muted" style="font-size:var(--fs-sm)">No other spellings saved. They are added when you confirm a match, or add one below.</p>'}</div>
      <div style="display:flex;gap:8px"><input name="alias" placeholder="Another way their name appears, e.g. Logan T." style="flex:1"><button type="button" class="btn btn-ghost btn-sm" data-addalias>Add</button></div>`}
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="1000">${esc(g?.notes || '')}</textarea></label>
      <p class="form-error" id="dr-err" hidden></p>
    </div>
    <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">${isNew ? 'Add guide' : 'Save'}</button></footer>
   </form>`;
  document.body.append(root);
  const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); };
  const err = m => { const e = $('#dr-err', root); e.textContent = m; e.hidden = !m; };
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) return done();
    try {
      const c = e.target.closest('[data-clear]');
      if (c) { await admin('admin_clear_override', { p_guide: g.id, p_field: c.dataset.clear }); await refresh(); toast('Returned to the source value.'); done(); return; }
      const f = e.target.closest('[data-forget]');
      if (f) { await admin('admin_forget_match', { p_id: Number(f.dataset.forget) }); await refresh(); toast('Forgotten. It will be asked about again next sync.'); done(); return; }
      if (e.target.closest('[data-addalias]')) {
        const v = root.querySelector('[name=alias]').value.trim(); if (!v) return;
        await admin('admin_confirm_match', { p_kind: 'tour_schedule', p_key: nameKey(v), p_guide: g.id, p_name: v, p_email: null });
        await refresh(); toast(`“${v}” will now be recognised as ${g.full_name}.`); done();
      }
    } catch (x) { err(x.message); }
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('[type=submit]'); btn.disabled = true; err('');
    try {
      if (isNew) {
        const r = await admin('admin_save_guide', { p_id: null, p_first: f.first_name.value, p_last: f.last_name.value, p_email: f.email.value, p_priority: f.priority.value || null });
        await refresh();
        const made = guides.find(x => x.first_name.toLowerCase() === f.first_name.value.trim().toLowerCase() && x.last_name.toLowerCase() === f.last_name.value.trim().toLowerCase());
        if (made) await admin('admin_update_guide', { p_id: made.id, p_fields: { major: f.major.value || null, is_leadership: f.is_leadership.checked, evaluator_eligible: f.evaluator_eligible.checked, tour_eligible: f.tour_eligible.checked, notes: f.notes.value } }).catch(() => {});
        await refresh(); toast(`${f.first_name.value} ${f.last_name.value} added.`); return done();
      }
      const fields = {};
      const set = (k, v) => { if ((g[k] ?? (typeof v === 'boolean' ? (k === 'is_leadership' ? false : true) : '')) !== v) fields[k] = v; };
      set('first_name', f.first_name.value.trim()); set('last_name', f.last_name.value.trim());
      set('email', f.email.value.trim()); set('major', f.major.value.trim());
      set('is_leadership', f.is_leadership.checked); set('evaluator_eligible', f.evaluator_eligible.checked); set('tour_eligible', f.tour_eligible.checked);
      set('notes', f.notes.value.trim());
      if ((g.member_id || '') !== f.member_id.value) fields.member_id = f.member_id.value || null;
      if (Object.keys(fields).length) await admin('admin_update_guide', { p_id: g.id, p_fields: fields });
      const was = prio(g)?.name || '';
      if (f.priority.value && f.priority.value !== was) await admin('admin_set_eval_priority', { p_guide_ids: [g.id], p_priority: f.priority.value });
      if (f.in_term && !f.in_term.disabled && f.in_term.checked !== inTerm(g)) await admin('admin_set_guide_term', { p_ids: [g.id], p_term: termId(), p_active: f.in_term.checked });
      await refresh(); toast('Saved.'); done();
    } catch (x) { err(x.message); btn.disabled = false; }
  });
  openModal(root);
}

/* ------------------------------------------------------------------- page */
let abort = null;

export default {
  id: 'guides', needs: 'admin', title: 'Tour Guides', crumb: 'The Master Tour Guide List', icon: '🧭', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    Object.assign(ui, { q: '', show: 'active', band: '', need: '', picked: new Set(), sort: { key: 'name', dir: 1 } });
    setupMissing = false;
    await load();
    view.innerHTML = `<div id="gd-setup">${setupMissing ? setupNotice() : ''}</div>
      <div class="gd-review" id="gd-review" hidden><span><b></b> from your spreadsheets need a decision.</span><a class="btn btn-ghost btn-sm" href="#/reconcile">Review</a></div>
      <div class="gd-bar">
        <input id="gd-q" type="search" placeholder="Search name, email or major" aria-label="Search guides">
        <select id="gd-show" class="select" aria-label="Show"><option value="active">Active this semester</option><option value="inactive">Inactive this semester</option><option value="archived">Archived</option><option value="all">Everyone</option></select>
        <select id="gd-band" class="select" aria-label="Priority"><option value="">Any priority</option><option>High</option><option>Normal</option><option>Low</option><option>None</option></select>
        <select id="gd-need" class="select" aria-label="Needs evaluation"><option value="">Needs evaluation: any</option><option value="yes">Needs evaluation</option><option value="no">Does not</option></select>
        <button class="btn btn-primary btn-sm" id="gd-add">Add guide</button>
        <button class="btn btn-ghost btn-sm" id="gd-import">Import CSV</button><button class="btn btn-ghost btn-sm" id="gd-export">Export CSV</button></div>
      <div id="gd-importbox"></div><div id="gd-selbar"></div>
      <div style="text-align:right;margin:2px 2px 8px"><span class="muted" style="font-size:.78rem" id="gd-count"></span></div>
      <div id="gd-table"></div>`;
    paint();
    admin('admin_health').catch(e => { if (e.setup) $('#gd-setup').innerHTML = setupNotice(); });

    bindTable($('#gd-table'), {
      onSort: k => { ui.sort = nextSort(ui.sort, k); paint(); },
      onToggle: (id, on) => { on ? ui.picked.add(id) : ui.picked.delete(id); paint(); },
      onToggleAll: on => { rows().forEach(g => on ? ui.picked.add(g.id) : ui.picked.delete(g.id)); paint(); }
    });

    const bulk = async (fn, ok) => { try { const ids = [...ui.picked]; await fn(ids); ui.picked.clear(); await refresh(); toast(ok(ids.length)); } catch (x) { fail(x); } };
    view.addEventListener('click', async e => {
      const open = e.target.closest('[data-open]');
      if (open) return drawer(guides.find(g => g.id === open.dataset.open));
      if (e.target.closest('#gd-add')) return drawer(null);
      if (e.target.closest('#gd-export')) { const n = downloadCsv('tour-guides', [['First name', 'Last name', 'Email', 'Major', 'Priority', 'Leadership', 'Status'],
        ...rows().map(g => [g.first_name, g.last_name, g.email || '', g.major || '', prio(g)?.name || '', g.is_leadership ? 'Yes' : '', g.active ? (termOf.get(g.id) === false ? 'Inactive this semester' : 'Active') : 'Archived'])]); return toast(`Exported ${n} guides.`); }
      if (e.target.closest('#gd-import')) { const f = document.createElement('input'); f.type = 'file'; f.accept = '.csv,text/csv';
        f.onchange = async () => { try {
          const { records } = readTable(await f.files[0].text());
          const r = records.map(x => ({ first: pick(x, 'firstname', 'first'), last: pick(x, 'lastname', 'last'), email: pick(x, 'email', 'purdueemail'), priority: pick(x, 'priority', 'evaluationpriority') }));
          if (!r.length) throw new Error('That file has no rows. It needs a header line, then one guide per line.');
          const res = await admin('admin_import_guides', { p_rows: r, p_apply: false });
          $('#gd-importbox').innerHTML = `<div class="card" style="margin-bottom:14px"><h3 style="font-size:.95rem">Check before importing</h3><p class="muted" style="font-size:.82rem">${res.ok} fine${res.errors ? `, <strong>${res.errors} need fixing</strong>` : ''}. Nothing is saved yet.</p>
            <table class="pp-prev"><tbody>${res.rows.map(x => `<tr class="${x.status === 'error' ? 'bad' : ''}"><td>${x.row}</td><td>${esc(x.name)}</td><td class="st-${esc(x.status)}">${esc(x.message)}</td></tr>`).join('')}</tbody></table>
            <button class="btn btn-primary" id="gd-doimport" ${res.errors ? 'disabled' : ''}>Import ${res.ok}</button> <button class="btn btn-ghost" id="gd-cancelimport">Cancel</button></div>`;
          ui.importing = r; } catch (x) { $('#gd-importbox').innerHTML = `<p class="form-error">${esc(x.message)}</p>`; } }; f.click(); return; }
      if (e.target.closest('#gd-cancelimport')) { $('#gd-importbox').innerHTML = ''; return; }
      if (e.target.closest('#gd-doimport')) { try { const r = await admin('admin_import_guides', { p_rows: ui.importing, p_apply: true }); $('#gd-importbox').innerHTML = ''; await refresh(); toast(`Imported ${r.ok} guides.`); } catch (x) { fail(x); } return; }
      const b = e.target.closest('[data-bulk]')?.dataset.bulk;
      if (!b) return;
      const term = on => ids => admin('admin_set_guide_term', { p_ids: ids, p_term: termId(), p_active: on });
      if (b === 'clear') { ui.picked.clear(); return paint(); }
      if (b === 'csv') { const sel = guides.filter(g => ui.picked.has(g.id)); return toast(`Exported ${downloadCsv('tour-guides-selected', [['First name', 'Last name', 'Email', 'Major'], ...sel.map(g => [g.first_name, g.last_name, g.email || '', g.major || ''])])} guides.`); }
      if (b === 'need-yes') return bulk(ids => admin('admin_set_eval_need', { p_guide_ids: ids, p_needs: true }), n => `${n} now need evaluating.`);
      if (b === 'need-no') return bulk(ids => admin('admin_set_eval_need', { p_guide_ids: ids, p_needs: false }), n => `${n} no longer need evaluating.`);
      if (b === 'term-on') return bulk(term(true), n => `${n} active this semester.`);
      if (b === 'term-off') { if (!await confirmDialog({ title: 'Make them inactive this semester?', confirmLabel: 'Make inactive', lines: ['They leave this semester’s tracker.', 'They stay on the master list and all history is kept. You can reverse this any time.'] })) return; return bulk(term(false), n => `${n} inactive this semester.`); }
      if (b === 'restore') return bulk(ids => admin('admin_set_guides_active', { p_ids: ids, p_active: true }), n => `Restored ${n}.`);
      if (b === 'archive') {
        const out = await formDialog({ title: `Archive ${ui.picked.size} ${ui.picked.size === 1 ? 'guide' : 'guides'}?`, intro: 'They leave every list and next semester. Evaluations, attendance and tours stay on record.', fields: [{ name: 'reason', label: 'Reason (optional)' }], submitLabel: 'Archive' });
        if (!out) return;
        return bulk(ids => admin('admin_set_guides_active', { p_ids: ids, p_active: false, p_reason: out.reason || null }), n => `Archived ${n}.`);
      }
    }, { signal });

    view.addEventListener('change', async e => {
      const t = e.target;
      if (t.id === 'gd-show') { ui.show = t.value; ui.picked.clear(); paint(); }
      else if (t.id === 'gd-band') { ui.band = t.value; paint(); }
      else if (t.id === 'gd-need') { ui.need = t.value; paint(); }
      else if (t.id === 'gd-bulkprio' && t.value) { const ids = [...ui.picked]; try { await admin('admin_set_eval_priority', { p_guide_ids: ids, p_priority: t.value }); ui.picked.clear(); await refresh(); toast(`Priority set for ${ids.length}.`); } catch (x) { fail(x); } }
    }, { signal });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'gd-q') { ui.q = e.target.value; paint(); } }, 120), { signal });
  }
};
