/* ============================================================ Training: sessions
   Every training event, as a list or a timeline, and one drawer to do everything
   to one of them: edit it, say which requirements it counts toward, assign
   speakers, attach materials, duplicate it, cancel it, make a makeup, or jump to
   taking attendance.

   Nothing is deleted. A session is cancelled (its attendance and history stay),
   and only one that nobody has been marked at can be removed outright.
============================================================================ */
import { $, esc, toast, openModal, closeModal, prettyDate } from '../core/ui.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, fail } from './admin-kit.js';
import { tableHtml, bindTable, sortRows, nextSort } from './datatable.js';
import { SESSION_STATUS, TYPES, whenText, isPast, loadSpeakers, loadTemplates } from './train-data.js';
import { downloadCsv } from '../core/csv.js';
import { kindIcon } from './train-materials.js';

const ui = { view: 'list', type: '', status: '', req: '', q: '', sort: { key: 'when', dir: 1 } };

function filtered(ctx) {
  const d = ctx.data, q = ui.q.trim().toLowerCase();
  const inReq = ui.req ? new Set(d.links.filter(l => l.requirement_id === ui.req).map(l => l.session_id)) : null;
  return d.sessions.filter(s => (!ui.type || s.training_type === ui.type) && (!ui.status || s.status === ui.status) && (!inReq || inReq.has(s.id))
    && (!q || `${s.label} ${s.location || ''} ${s.training_type}`.toLowerCase().includes(q)));
}

const speakersOf = (d, id) => d.speakers.filter(x => x.session_id === id).map(x => x.speaker_name);
const reqsOf = (d, id) => d.links.filter(l => l.session_id === id).map(l => d.requirements.find(r => r.id === l.requirement_id)).filter(Boolean);

function columns(ctx) {
  const d = ctx.data;
  return [
    { key: 'when', label: 'When', sortable: true, value: s => `${s.held_on || '9'} ${s.start_time || ''}`, render: s => esc(whenText(s)) },
    { key: 'title', label: 'Session', sortable: true, value: s => s.label, render: s => `<button type="button" class="dt-name" data-open="${esc(s.id)}">${esc(s.label)}</button>
        ${s.makeup_for ? '<span class="chip is-warn">Makeup</span>' : ''}${s.required ? '' : '<span class="chip is-mute">Optional</span>'}<span class="dt-sub">${esc(s.training_type)}${reqsOf(d, s.id).length ? ' · ' + esc(reqsOf(d, s.id).map(r => r.name).join(', ')) : ''}</span>` },
    { key: 'location', label: 'Where', sortable: true, render: s => s.location ? esc(s.location) : '<span class="chip is-warn">No room</span>' },
    { key: 'speaker', label: 'Speaker', render: s => { const n = speakersOf(d, s.id); return n.length ? esc(n.join(', ')) : (s.required && !isPast(s) ? '<span class="chip is-warn">None assigned</span>' : '—'); } },
    { key: 'status', label: 'Status', sortable: true, render: s => `<span class="chip ${s.status === 'cancelled' ? 'is-mute' : s.status === 'completed' ? 'is-good' : s.status === 'draft' ? 'is-warn' : ''}">${esc(SESSION_STATUS[s.status])}</span>${s.attendance_submitted_at ? '<span class="chip is-good">Attendance in</span>' : ''}` },
    ...(ctx.admin ? [{ key: 'act', label: '', render: s => `<button class="btn btn-ghost btn-sm" data-att="${esc(s.id)}">Attendance</button>` }] : [])
  ];
}

function timeline(ctx, list) {
  const groups = new Map();
  list.forEach(s => { const k = s.held_on ? new Date(s.held_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'No date yet'; (groups.get(k) || groups.set(k, []).get(k)).push(s); });
  return [...groups].map(([month, rows]) => `<section class="tl-month"><h3>${esc(month)}</h3>${rows.map(s => `<button type="button" class="tl-item ${s.status === 'cancelled' ? 'is-cancelled' : ''}" data-open="${esc(s.id)}">
      <span class="tl-date"><b>${s.held_on ? new Date(s.held_on + 'T12:00:00').getDate() : '—'}</b><em>${s.held_on ? new Date(s.held_on + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }) : ''}</em></span>
      <span class="tl-body"><b>${esc(s.label)}</b><em>${esc(whenText(s).split(' · ').slice(1).join(' · ') || 'Time not set')} · ${esc(s.location || 'No room yet')}</em>
        <span>${s.makeup_for ? '<span class="chip is-warn">Makeup</span>' : ''}${s.required ? '<span class="chip is-hi">Required</span>' : '<span class="chip is-mute">Optional</span>'}<span class="chip">${esc(s.training_type)}</span>${s.status !== 'scheduled' ? `<span class="chip is-mute">${esc(SESSION_STATUS[s.status])}</span>` : ''}</span></span></button>`).join('')}</section>`).join('')
    || emptyState({ title: 'Nothing matches', icon: 'search', text: 'Change the filters above.' });
}

function paint(ctx, host) {
  const list = filtered(ctx);
  const cols = columns(ctx);
  $('#ss-body', host).innerHTML = !ctx.data.sessions.length
    ? emptyState({ title: `No training sessions for ${ctx.termLabel} yet`, icon: 'training', text: 'Create one, or start from a template if you run the same training every semester. If you copied last semester’s setup, its sessions are waiting as drafts.',
        action: ctx.admin ? '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-new>New session</button></div>' : '' })
    : ui.view === 'timeline' ? timeline(ctx, list)
    : tableHtml({ columns: cols, rows: sortRows(list, cols, ui.sort), sort: ui.sort, selected: new Set(), rowKey: s => s.id, selectable: false, empty: emptyState({ title: 'Nothing matches', icon: 'search', text: 'Change the filters above.' }) });
  $('#ss-count', host).textContent = `${list.length} of ${ctx.data.sessions.length}`;
}

/* A read-only card for people who can see sessions but not change them. */
function info(ctx, id) {
  const d = ctx.data, s = d.sessions.find(x => x.id === id); if (!s) return;
  const root = document.createElement('div'); root.className = 'modal-root'; root.hidden = true;
  const mats = d.materials.filter(m => m.session_id === s.id);
  root.innerHTML = `<div class="modal-scrim" data-close></div><div class="modal"><header class="modal-head"><div><h2>${esc(s.label)}</h2><p class="muted">${esc(whenText(s))}${s.location ? ' · ' + esc(s.location) : ''}</p></div></header>
    <div class="modal-body">${s.description ? `<p>${esc(s.description)}</p>` : ''}<p class="muted">${esc(s.training_type)} · ${s.required ? 'Required' : 'Optional'} · ${esc(SESSION_STATUS[s.status])}${speakersOf(d, s.id).length ? ' · ' + esc(speakersOf(d, s.id).join(', ')) : ''}</p>
      ${mats.length ? `<div class="alias-list">${mats.map(m => `<div class="alias-row"><span>${kindIcon(m.kind)} <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a></span></div>`).join('')}</div>` : ''}</div>
    <footer class="modal-foot"><button class="btn btn-ghost" data-close>Close</button></footer></div>`;
  document.body.append(root);
  const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); };
  root.addEventListener('click', e => { if (e.target.closest('[data-close]')) done(); }); root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
  openModal(root);
}

/* ------------------------------------------------------------------ drawer */
async function drawer(ctx, id, host) {
  if (!ctx.admin) return info(ctx, id);
  const d = ctx.data, s = id ? d.sessions.find(x => x.id === id) : null, isNew = !s;
  const [spk] = await Promise.all([loadSpeakers().catch(() => [])]);
  const mine = s ? reqsOf(d, s.id).map(r => r.id) : [];
  const assigned = s ? d.speakers.filter(x => x.session_id === s.id) : [];
  const mats = s ? d.materials.filter(m => m.session_id === s.id) : [];
  const root = document.createElement('div');
  root.className = 'modal-root'; root.hidden = true;
  root.innerHTML = `<div class="modal-scrim" data-close></div>
  <form class="modal modal-xl" autocomplete="off">
    <header class="modal-head"><div><h2>${isNew ? 'New training session' : esc(s.label)}</h2>${isNew ? '' : `<p class="muted">${esc(whenText(s))} · ${esc(SESSION_STATUS[s.status])}${s.makeup_for ? ' · makeup' : ''}</p>`}</div></header>
    <div class="modal-body">
      <div class="drawer-grid">
        <label class="field"><span>Title</span><input name="title" value="${esc(s?.label || '')}" required></label>
        <label class="field"><span>Type</span><select class="select" name="training_type">${[...new Set([...TYPES, s?.training_type].filter(Boolean))].map(t => `<option${(s?.training_type || 'General') === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input type="date" name="held_on" value="${esc(s?.held_on || '')}"></label>
        <label class="field"><span>Starts</span><input type="time" name="start_time" value="${esc((s?.start_time || '').slice(0, 5))}"></label>
        <label class="field"><span>Ends</span><input type="time" name="end_time" value="${esc((s?.end_time || '').slice(0, 5))}"></label>
        <label class="field"><span>Location</span><input name="location" value="${esc(s?.location || '')}" placeholder="Room or link"></label>
        <label class="field"><span>Capacity (optional)</span><input type="number" min="0" name="capacity" value="${esc(s?.capacity ?? '')}"></label>
        <label class="field"><span>Status</span><select class="select" name="status">${Object.entries(SESSION_STATUS).map(([k, v]) => `<option value="${k}"${(s?.status || 'scheduled') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="drawer-grid"><label class="toggle-row"><input type="checkbox" name="required" ${s?.required !== false ? 'checked' : ''}> Required</label>
        <label class="toggle-row"><input type="checkbox" name="makeup_eligible" ${s?.makeup_eligible !== false ? 'checked' : ''}> People who miss it can make it up</label></div>
      <label class="field"><span>Description</span><textarea name="description" rows="2">${esc(s?.description || '')}</textarea></label>
      <label class="field"><span>Notes (for organisers)</span><textarea name="notes" rows="2">${esc(s?.notes || '')}</textarea></label>
      ${isNew ? '' : `
      <div class="drawer-sec">Counts toward</div>
      ${d.requirements.length ? `<div class="alias-list">${d.requirements.filter(r => r.active).map(r => `<label class="toggle-row"><input type="checkbox" data-req="${esc(r.id)}" ${mine.includes(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('')}</div>`
        : '<p class="muted" style="font-size:var(--fs-sm)">No requirements yet. Create one under Requirements, then tick it here.</p>'}
      <div class="drawer-sec">Speakers</div>
      <div id="sp-list" class="alias-list">${assigned.map(a => `<div class="alias-row" data-sp="${esc(a.speaker_id)}"><span>${esc(a.speaker_name)} <span class="src-badge">${esc(a.role)}</span></span><button type="button" class="btn btn-quiet btn-sm" data-sp-del>Remove</button></div>`).join('') || '<p class="muted" style="font-size:var(--fs-sm)">Nobody assigned.</p>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="select" id="sp-pick" style="max-width:260px"><option value="">Add a speaker…</option>${spk.filter(x => x.active && !assigned.some(a => a.speaker_id === x.id)).map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.affiliation ? ' · ' + esc(x.affiliation) : ''}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost btn-sm" data-sp-add>Add</button><button type="button" class="btn btn-quiet btn-sm" data-sp-new>New speaker…</button></div>
      <div class="drawer-sec">Materials</div>
      <div class="alias-list">${mats.map(m => `<div class="alias-row"><span>${kindIcon(m.kind)} <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a></span><button type="button" class="btn btn-quiet btn-sm" data-mat-del="${esc(m.id)}">Remove</button></div>`).join('') || '<p class="muted" style="font-size:var(--fs-sm)">No materials yet.</p>'}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-mat-add style="justify-self:start">Add a resource</button>`}
      <p class="form-error" id="dr-err" hidden></p>
    </div>
    <footer class="modal-foot" style="justify-content:space-between">
      <span style="display:flex;gap:6px;flex-wrap:wrap">${isNew ? '' : `<button type="button" class="btn btn-quiet btn-sm" data-dup>Duplicate</button><button type="button" class="btn btn-quiet btn-sm" data-makeup ${s.makeup_eligible === false ? 'disabled' : ''}>Make a makeup</button>
        <button type="button" class="btn btn-quiet btn-sm" data-announce>Announce</button>
        ${s.status === 'cancelled' ? '<button type="button" class="btn btn-quiet btn-sm" data-reopen>Re-open</button>' : '<button type="button" class="btn btn-quiet btn-sm" data-cancel-session>Cancel session</button>'}
        <button type="button" class="btn btn-quiet btn-sm" data-delete>Delete…</button>`}</span>
      <span style="display:flex;gap:8px"><button type="button" class="btn btn-ghost" data-close>Close</button><button type="submit" class="btn btn-primary">${isNew ? 'Create session' : 'Save'}</button></span></footer>
  </form>`;
  document.body.append(root);
  const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); };
  const err = m => { const e = $('#dr-err', root); e.textContent = m; e.hidden = !m; };
  const redo = async msg => { await ctx.reload(); done(); if (msg) toast(msg); paint(ctx, host); };

  root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.req) {     // tick / untick: the requirement's approved sessions are replaced with the new list
      try {
        const cur = d.links.filter(l => l.requirement_id === t.dataset.req).map(l => l.session_id);
        const next = t.checked ? [...new Set([...cur, s.id])] : cur.filter(x => x !== s.id);
        await admin('admin_set_requirement_sessions', { p_req: t.dataset.req, p_sessions: next });
        await ctx.reload(); toast(t.checked ? 'Now counts toward it. Expected people were added.' : 'No longer counts toward it.');
      } catch (x) { fail(x); t.checked = !t.checked; }
    }
  });
  root.addEventListener('click', async e => {
    try {
      if (e.target.closest('[data-close]')) return done();
      const t = e.target;
      if (t.closest('[data-sp-add]')) { const v = $('#sp-pick', root).value; if (!v) return;
        await admin('admin_set_session_speakers', { p_session: s.id, p_speakers: [...assigned.map(a => ({ speaker_id: a.speaker_id, role: a.role })), { speaker_id: v, role: 'Speaker' }] }); return redo('Speaker added.'); }
      if (t.closest('[data-sp-del]')) { const id2 = t.closest('[data-sp]').dataset.sp;
        await admin('admin_set_session_speakers', { p_session: s.id, p_speakers: assigned.filter(a => a.speaker_id !== id2).map(a => ({ speaker_id: a.speaker_id, role: a.role })) }); return redo('Speaker removed.'); }
      if (t.closest('[data-sp-new]')) { const v = await formDialog({ title: 'New speaker', submitLabel: 'Add speaker', intro: 'They do not need an account. Contact details are visible to administrators only.',
          fields: [{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'affiliation', label: 'Department or organisation' }] }); if (!v) return;
        const sid = await admin('admin_save_speaker', { p_id: null, p_name: v.name, p_email: v.email, p_phone: v.phone, p_affiliation: v.affiliation });
        await admin('admin_set_session_speakers', { p_session: s.id, p_speakers: [...assigned.map(a => ({ speaker_id: a.speaker_id, role: a.role })), { speaker_id: sid, role: 'Speaker' }] }); return redo('Speaker added.'); }
      if (t.closest('[data-mat-add]')) { const v = await formDialog({ title: 'Add a resource', submitLabel: 'Add', fields: [{ name: 'title', label: 'Title', required: true },
          { name: 'kind', label: 'Type', options: ['doc', 'slides', 'pdf', 'video', 'webpage', 'internal', 'other'], value: 'doc' }, { name: 'url', label: 'Link (https://…)', required: true }, { name: 'description', label: 'Short description' }] }); if (!v) return;
        await admin('admin_save_material', { p_id: null, p_title: v.title, p_kind: v.kind, p_url: v.url, p_description: v.description, p_session: s.id, p_requirement: null }); return redo('Resource added.'); }
      const md = t.closest('[data-mat-del]'); if (md) { await admin('admin_delete_material', { p_id: md.dataset.matDel }); return redo('Removed.'); }
      if (t.closest('[data-dup]')) { const v = await formDialog({ title: 'Duplicate this session', submitLabel: 'Duplicate', intro: 'The copy starts as a draft with the same details, speakers, materials and requirements — never the attendance.', fields: [{ name: 'date', label: 'New date', type: 'date' }, { name: 'title', label: 'Title', value: s.label + ' (copy)' }] }); if (!v) return;
        await admin('admin_duplicate_session', { p_id: s.id, p_date: v.date || null, p_title: v.title }); return redo('Duplicated as a draft.'); }
      if (t.closest('[data-makeup]')) { const v = await formDialog({ title: 'Create a makeup session', submitLabel: 'Create makeup', intro: 'It counts toward the same requirements, and starts with exactly the people who still owe this training.',
          fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'start', label: 'Starts', type: 'time', value: (s.start_time || '').slice(0, 5) }, { name: 'end', label: 'Ends', type: 'time', value: (s.end_time || '').slice(0, 5) }, { name: 'location', label: 'Location', value: s.location || '' }] }); if (!v) return;
        const r = await admin('admin_make_makeup', { p_original: s.id, p_date: v.date, p_start: v.start || null, p_end: v.end || null, p_location: v.location || null, p_guides: null }); return redo(`Makeup created for ${r.assigned} ${r.assigned === 1 ? 'person' : 'people'}.`); }
      if (t.closest('[data-announce]')) { sessionStorage.setItem('hub2.ann.draft', JSON.stringify({ title: `${s.label} — ${s.held_on ? prettyDate(s.held_on) : 'date to come'}`,
          body: `${s.label}\n${whenText(s)}${s.location ? `\nWhere: ${s.location}` : ''}${s.description ? `\n\n${s.description}` : ''}${s.required ? '\n\nThis training is required.' : ''}` })); done(); location.hash = '#/announcements'; return; }
      if (t.closest('[data-cancel-session]')) { if (!await confirmDialog({ title: `Cancel “${s.label}”?`, confirmLabel: 'Cancel session', danger: true, lines: ['It stops counting toward requirements, and nobody can be marked at it.', 'Its attendance and history are kept. You can re-open it.'] })) return;
        await admin('admin_set_session_status', { p_id: s.id, p_status: 'cancelled', p_reason: null }); return redo('Cancelled.'); }
      if (t.closest('[data-reopen]')) { await admin('admin_set_session_status', { p_id: s.id, p_status: 'scheduled', p_reason: null }); return redo('Re-opened.'); }
      if (t.closest('[data-delete]')) { if (!await confirmDialog({ title: `Delete “${s.label}”?`, confirmLabel: 'Delete', danger: true, lines: ['Only possible if nobody has been marked at it. Otherwise cancel it instead — history is never lost.'] })) return;
        await admin('admin_delete_empty_session', { p_id: s.id }); return redo('Deleted.'); }
    } catch (x) { err(x.message); }
  });
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('[type=submit]'); btn.disabled = true; err('');
    const fields = { title: f.title.value, training_type: f.training_type.value, held_on: f.held_on.value || null, start_time: f.start_time.value || null, end_time: f.end_time.value || null,
      location: f.location.value, capacity: f.capacity.value || null, status: f.status.value, required: f.required.checked, makeup_eligible: f.makeup_eligible.checked, description: f.description.value, notes: f.notes.value };
    if (isNew) fields.term_id = ctx.term;
    try { const r = await admin('admin_save_training_session', { p_id: s?.id || null, p_f: fields }); await ctx.reload(); done(); toast(isNew ? 'Session created.' : 'Saved.'); paint(ctx, host); }
    catch (x) { err(x.message); btn.disabled = false; }
  });
  openModal(root);
}

async function fromTemplate(ctx, host) {
  const tpls = (await loadTemplates().catch(() => [])).filter(t => t.active);
  if (!tpls.length) return toast('No templates yet — create one under Resources.', 'err');
  const v = await formDialog({ title: 'Create from a template', submitLabel: 'Create', intro: 'Makes the session with the template’s details and materials. Add a deadline to create the requirement too.',
    fields: [{ name: 'tpl', label: 'Template', options: tpls.map(t => t.name), value: tpls[0].name }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'start', label: 'Starts', type: 'time' },
      { name: 'location', label: 'Location (blank = template’s)' }, { name: 'deadline', label: 'Requirement deadline (optional)', type: 'date' }] });
  if (!v) return;
  try { const t = tpls.find(x => x.name === v.tpl); await admin('admin_create_from_template', { p_template: t.id, p_term: ctx.term, p_date: v.date, p_start: v.start || null, p_location: v.location || null, p_requirement: null, p_deadline: v.deadline || null });
    await ctx.reload(); paint(ctx, host); toast('Created.'); } catch (x) { fail(x); }
}

export function mountSessions(host, ctx) {
  const d = ctx.data;
  host.innerHTML = `<div class="gd-bar"><input id="ss-q" type="search" placeholder="Search sessions" aria-label="Search sessions">
      <select id="ss-type" class="select" aria-label="Type"><option value="">Any type</option>${[...new Set([...TYPES, ...d.sessions.map(s => s.training_type)])].map(t => `<option>${esc(t)}</option>`).join('')}</select>
      <select id="ss-status" class="select" aria-label="Status"><option value="">Any status</option>${Object.entries(SESSION_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="ss-req" class="select" aria-label="Requirement"><option value="">Any requirement</option>${d.requirements.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
      <div class="tabs" style="margin:0"><button class="tab is-active" data-view="list">List</button><button class="tab" data-view="timeline">Timeline</button></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${ctx.admin ? '<button class="btn btn-primary btn-sm" data-new>New session</button><button class="btn btn-ghost btn-sm" data-tpl>From a template</button>' : ''}<button class="btn btn-ghost btn-sm" data-export>Export CSV</button><span class="muted" style="font-size:.78rem;align-self:center" id="ss-count"></span></div>
    <div id="ss-body"></div>`;
  paint(ctx, host);
  bindTable(host, { onSort: k => { ui.sort = nextSort(ui.sort, k); paint(ctx, host); } });
  host.addEventListener('input', e => { if (e.target.id === 'ss-q') { ui.q = e.target.value; paint(ctx, host); } });
  host.addEventListener('change', e => { const t = e.target; if (t.id === 'ss-type') ui.type = t.value; else if (t.id === 'ss-status') ui.status = t.value; else if (t.id === 'ss-req') ui.req = t.value; else return; paint(ctx, host); });
  host.addEventListener('click', e => {
    const v = e.target.closest('[data-view]'); if (v) { ui.view = v.dataset.view; host.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('is-active', b === v)); return paint(ctx, host); }
    const o = e.target.closest('[data-open]'); if (o) return drawer(ctx, o.dataset.open, host);
    if (e.target.closest('[data-new]')) return drawer(ctx, null, host);
    if (e.target.closest('[data-tpl]')) return fromTemplate(ctx, host);
    const a = e.target.closest('[data-att]'); if (a) return ctx.go('attendance', { session: a.dataset.att });
    if (e.target.closest('[data-export]')) toast(`Exported ${downloadCsv('training-sessions', [['Title', 'Date', 'Start', 'End', 'Location', 'Type', 'Required', 'Status', 'Speakers'], ...filtered(ctx).map(s => [s.label, s.held_on || '', s.start_time || '', s.end_time || '', s.location || '', s.training_type, s.required ? 'Yes' : 'No', s.status, speakersOf(ctx.data, s.id).join('; ')])])} sessions.`);
  });
  if (ctx.params?.open) drawer(ctx, ctx.params.open, host);
}

export { drawer as openSessionDrawer };
