/* ======================================================= Training: requirements & people
   REQUIREMENTS say what must be done and by whom; SESSIONS are the occasions
   that satisfy them. "New Tour Guide Orientation" can have three approved
   sessions (two regular, one makeup) and attending any one completes it for
   everyone it applies to — nobody updates completion by hand after taking
   attendance.

   PEOPLE is the same facts from the other side: for each Tour Guide, what they
   have done, what is missing, what is next, and who needs a makeup. Overrides
   (complete, waived, excused, incomplete) are one click, recorded with a
   reason, and can be returned to automatic.

   Audience: all guides, new guides, leadership, evaluators, named cohorts
   (groups) and hand-picked people — always the canonical Tour Guides.
============================================================================ */
import { select } from '../core/db.js';
import { $, esc, toast, injectStyle, openModal, closeModal, prettyDate, debounce } from '../core/ui.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { downloadCsv } from '../core/csv.js';
import { admin, emptyState, fail } from './admin-kit.js';
import { tableHtml, bindTable, sortRows, nextSort } from './datatable.js';
import { STATE_LABEL, STATE_TONE, audienceText, byPerson, loadGroups, whenText, attClass } from './train-data.js';
import { loadTerms } from './train-data.js';

injectStyle('train-people-css', `
.rq-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:16px; margin-bottom:12px; display:grid; gap:10px; }
.rq-top { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; } .rq-top h3 { font-size:1.02rem; }
.rq-meta { display:flex; gap:14px; flex-wrap:wrap; color:var(--text-soft); font-size:var(--fs-sm); }
.rq-bar { height:8px; border-radius:99px; background:var(--bg-sunken); overflow:hidden; display:flex; } .rq-bar i { display:block; height:100%; }
.rq-bar .c { background:var(--good); } .rq-bar .s { background:var(--pink); } .rq-bar .m { background:var(--warn); }
.rq-nums { font-size:var(--fs-sm); color:var(--text-soft); display:flex; gap:12px; flex-wrap:wrap; } .rq-nums b { color:var(--text); }
.pr-row { display:flex; gap:10px; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface-1); margin-bottom:8px; flex-wrap:wrap; }
.pr-row b { font-size:var(--fs-md); } .pr-row em { display:block; font-style:normal; font-size:var(--fs-xs); color:var(--text-faint); }
.pick-list { max-height:260px; overflow:auto; border:1px solid var(--line); border-radius:var(--radius-sm); }
.pick-list label { display:flex; gap:10px; padding:7px 12px; border-bottom:1px solid var(--line); font-size:var(--fs-md); align-items:center; } .pick-list label:last-child { border-bottom:0; }
.pick-list input { width:16px; height:16px; accent-color:var(--accent); }
.rm-msg { width:100%; min-height:160px; font:inherit; }
`);

/* --------------------------------------------------------------- pickers */
/** A searchable checklist of Tour Guides in a dialog. Resolves to the chosen ids, or null. */
export function pickPeople({ title, guides, chosen = [], intro = '', confirm = 'Done' }) {
  return new Promise(resolve => {
    const root = document.createElement('div'); root.className = 'modal-root'; root.hidden = true;
    const picked = new Set(chosen);
    root.innerHTML = `<div class="modal-scrim" data-close></div><form class="modal"><header class="modal-head"><div><h2>${esc(title)}</h2>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}</div></header>
      <div class="modal-body"><input type="search" id="pk-q" placeholder="Search" aria-label="Search people"><div class="pick-list" id="pk-list"></div><p class="muted" id="pk-n" style="font-size:var(--fs-sm)"></p></div>
      <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">${esc(confirm)}</button></footer></form>`;
    document.body.append(root);
    const draw = () => { const q = $('#pk-q', root).value.trim().toLowerCase();
      $('#pk-list', root).innerHTML = guides.filter(g => !q || g.full_name.toLowerCase().includes(q)).map(g => `<label><input type="checkbox" value="${esc(g.id)}" ${picked.has(g.id) ? 'checked' : ''}> ${esc(g.full_name)}</label>`).join('') || '<p class="muted" style="padding:10px">Nobody matches.</p>';
      $('#pk-n', root).textContent = `${picked.size} selected`; };
    let out = null; const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); resolve(out); };
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) done(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
    root.addEventListener('change', e => { if (e.target.type === 'checkbox') { e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value); $('#pk-n', root).textContent = `${picked.size} selected`; } });
    root.addEventListener('input', debounce(e => { if (e.target.id === 'pk-q') draw(); }, 100));
    root.querySelector('form').addEventListener('submit', e => { e.preventDefault(); out = [...picked]; done(); });
    draw(); openModal(root);
  });
}

/** Compose a reminder: opens the person's own email app (no sending from here), or copies the text. */
export function reminderDialog({ people, subject, body }) {
  return new Promise(resolve => {
    const emails = people.map(p => p.email).filter(Boolean), without = people.filter(p => !p.email);
    const root = document.createElement('div'); root.className = 'modal-root'; root.hidden = true;
    root.innerHTML = `<div class="modal-scrim" data-close></div><form class="modal"><header class="modal-head"><div><h2>Remind ${people.length} ${people.length === 1 ? 'person' : 'people'}</h2>
      <p class="muted">Nothing is sent from the Hub. This opens your own email app with everyone in BCC, or you can copy the text.</p></div></header>
      <div class="modal-body"><label class="field"><span>Subject</span><input id="rm-sub" value="${esc(subject)}"></label><label class="field"><span>Message</span><textarea id="rm-body" class="rm-msg">${esc(body)}</textarea></label>
      ${without.length ? `<p class="callout">${without.length} ${without.length === 1 ? 'person has' : 'people have'} no email on file: ${esc(without.slice(0, 5).map(p => p.full_name).join(', '))}${without.length > 5 ? '…' : ''}.</p>` : ''}</div>
      <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Close</button><button type="button" class="btn btn-ghost" data-copy="emails">Copy emails</button><button type="button" class="btn btn-ghost" data-copy="msg">Copy message</button>
      <a class="btn btn-primary" id="rm-open" target="_blank" rel="noopener">Open email app</a></footer></form>`;
    document.body.append(root);
    const link = () => { $('#rm-open', root).href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent($('#rm-sub', root).value)}&body=${encodeURIComponent($('#rm-body', root).value)}`; };
    link(); root.addEventListener('input', link);
    const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); resolve(); };
    root.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return done();
      const c = e.target.closest('[data-copy]'); if (c) { try { await navigator.clipboard.writeText(c.dataset.copy === 'emails' ? emails.join(', ') : `${$('#rm-sub', root).value}\n\n${$('#rm-body', root).value}`); toast('Copied.'); } catch { toast('Copy is not available here.', 'err'); } }
    });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
    openModal(root);
  });
}

/* ------------------------------------------------------------ requirements */
async function requirementDrawer(ctx, id, host, groups) {
  const d = ctx.data, r = id ? d.requirements.find(x => x.id === id) : null, a = r?.audience || { all: true };
  const linked = new Set(r ? d.links.filter(l => l.requirement_id === r.id).map(l => l.session_id) : []);
  let chosen = new Set(a.guide_ids || []);
  const root = document.createElement('div'); root.className = 'modal-root'; root.hidden = true;
  root.innerHTML = `<div class="modal-scrim" data-close></div><form class="modal modal-xl" autocomplete="off"><header class="modal-head"><div><h2>${r ? esc(r.name) : 'New requirement'}</h2></div></header>
    <div class="modal-body">
      <div class="drawer-grid"><label class="field"><span>Name</span><input name="name" value="${esc(r?.name || '')}" required placeholder="New Tour Guide Orientation"></label>
        <label class="field"><span>Deadline (optional)</span><input type="date" name="deadline" value="${esc(r?.deadline || '')}"></label>
        <label class="field"><span>Completes when</span><select class="select" name="rule"><option value="any"${r?.rule !== 'all' ? ' selected' : ''}>They attend any one approved session</option><option value="all"${r?.rule === 'all' ? ' selected' : ''}>They attend every approved session</option></select></label></div>
      <label class="field"><span>Description</span><textarea name="description" rows="2">${esc(r?.description || '')}</textarea></label>
      <div class="drawer-sec">Who it applies to</div>
      <div class="drawer-grid">${[['all', 'All Tour Guides'], ['new', 'New guides'], ['leadership', 'Leadership'], ['evaluators', 'Evaluators']].map(([k, l]) => `<label class="toggle-row"><input type="checkbox" name="aud_${k}" ${a[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      ${groups.length ? `<div class="drawer-grid">${groups.map(g => `<label class="toggle-row"><input type="checkbox" data-group="${esc(g.id)}" ${(a.group_ids || []).includes(g.id) ? 'checked' : ''}> ${esc(g.name)} <span class="src-badge">${g.members.length}</span></label>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-people>Choose individual people…</button><span class="muted" id="rq-n" style="font-size:var(--fs-sm)">${chosen.size} chosen</span></div>
      <div class="drawer-sec">Approved sessions</div>
      ${d.sessions.filter(s => s.status !== 'cancelled').length ? `<div class="pick-list">${d.sessions.filter(s => s.status !== 'cancelled').map(s => `<label><input type="checkbox" data-sess="${esc(s.id)}" ${linked.has(s.id) ? 'checked' : ''}> ${esc(s.label)} <span class="src-badge">${esc(whenText(s))}</span>${s.makeup_for ? ' <span class="chip is-warn">Makeup</span>' : ''}</label>`).join('')}</div>`
        : '<p class="muted" style="font-size:var(--fs-sm)">No sessions yet — create them under Sessions, then come back to approve them.</p>'}
      <p class="form-error" id="dr-err" hidden></p></div>
    <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary">${r ? 'Save' : 'Create requirement'}</button></footer></form>`;
  document.body.append(root);
  const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); };
  const err = m => { const e = $('#dr-err', root); e.textContent = m; e.hidden = !m; };
  root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) return done();
    if (e.target.closest('[data-people]')) { const v = await pickPeople({ title: 'Individual people', guides: ctx.guides.filter(g => g.active), chosen: [...chosen], intro: 'Added to everyone the other settings already include.' }); if (v) { chosen = new Set(v); $('#rq-n', root).textContent = `${chosen.size} chosen`; } }
  });
  root.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target.elements, btn = e.target.querySelector('[type=submit]'); btn.disabled = true; err('');
    const audience = { all: f.aud_all.checked, new: f.aud_new.checked, leadership: f.aud_leadership.checked, evaluators: f.aud_evaluators.checked,
      group_ids: [...root.querySelectorAll('[data-group]:checked')].map(c => c.dataset.group), guide_ids: [...chosen] };
    try {
      const res = await admin('admin_save_requirement', { p_id: r?.id || null, p_f: { name: f.name.value, description: f.description.value, deadline: f.deadline.value || null, rule: f.rule.value, audience, ...(r ? {} : { term_id: ctx.term }) } });
      await admin('admin_set_requirement_sessions', { p_req: res.id, p_sessions: [...root.querySelectorAll('[data-sess]:checked')].map(c => c.dataset.sess) });
      await ctx.reload(true); done(); toast(r ? 'Saved.' : 'Requirement created.'); ctx.rerender();
    } catch (x) { err(x.message); btn.disabled = false; }
  });
  openModal(root);
}

/** Copy last semester's setup: requirements, audiences, materials (and sessions as drafts). Never attendance. */
export async function copyFlow(ctx, host) {
  const terms = (await loadTerms()).filter(t => t.id !== ctx.term);
  if (!terms.length) return toast('There is no other semester to copy from.', 'err');
  const v = await formDialog({ title: 'Copy training setup', submitLabel: 'Preview', intro: 'Copies requirements, who they apply to, and their materials. Attendance, completion and missed-training history are never copied.',
    fields: [{ name: 'from', label: 'Copy from', options: terms.map(t => t.label), value: terms[0].label }, { name: 'shift', label: 'Move deadlines and dates by (days)', type: 'number', value: '182', hint: 'About 182 days from fall to spring. 0 keeps them as they are.' },
      { name: 'sessions', label: 'Also copy sessions as drafts', options: ['Yes', 'No'], value: 'Yes' }] });
  if (!v) return;
  const from = terms.find(t => t.label === v.from);
  const opts = { shift_days: Number(v.shift) || 0, sessions: v.sessions === 'Yes', materials: true };
  try {
    const pv = await admin('admin_copy_training_setup', { p_from: from.id, p_to: ctx.term, p_opts: opts, p_apply: false });
    if (!await confirmDialog({ title: `Copy from ${from.label}?`, confirmLabel: 'Copy', lines: [`${pv.requirements} requirement${pv.requirements === 1 ? '' : 's'}, ${pv.sessions} draft session${pv.sessions === 1 ? '' : 's'} and ${pv.materials} resource${pv.materials === 1 ? '' : 's'} will be added to ${ctx.termLabel}.`,
      'Anything that already exists here by name is skipped. You can review and edit everything afterwards.'] })) return;
    await admin('admin_copy_training_setup', { p_from: from.id, p_to: ctx.term, p_opts: opts, p_apply: true });
    await ctx.reload(true); toast('Copied. Review the drafts and update the dates.'); ctx.rerender();
  } catch (x) { fail(x); }
}

export async function mountRequirements(host, ctx) {
  const d = ctx.data, groups = await loadGroups().catch(() => []);
  const ov = (await ctx.getOverview().catch(() => ({ requirements: [] }))).requirements || [];
  host.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn btn-primary btn-sm" data-new>New requirement</button><button class="btn btn-ghost btn-sm" data-copy>Copy setup from another semester</button>
      ${!d.requirements.length && d.sessions.length ? '<button class="btn btn-ghost btn-sm" data-backfill>Make a requirement from each existing session</button>' : ''}<button class="btn btn-ghost btn-sm" data-groups>Cohorts (${groups.length})</button></div>
    ${d.requirements.length ? d.requirements.map(r => { const c = ov.find(x => x.id === r.id) || {}; const total = c.total || 0, done = (c.complete || 0) + (c.waived || 0) + (c.excused || 0);
      const sess = d.links.filter(l => l.requirement_id === r.id).map(l => d.sessions.find(s => s.id === l.session_id)).filter(Boolean);
      return `<section class="rq-card ${r.active ? '' : 'is-out'}"><div class="rq-top"><div><h3>${esc(r.name)} ${r.active ? '' : '<span class="chip is-mute">Archived</span>'}</h3>
        <div class="rq-meta"><span>${esc(audienceText(r.audience, groups, ctx.guides))}</span>${r.deadline ? `<span>Due ${esc(prettyDate(r.deadline))}</span>` : ''}<span>${r.rule === 'all' ? 'Every session' : 'Any one session'}</span></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-edit="${esc(r.id)}">Edit</button><button class="btn btn-quiet btn-sm" data-people-of="${esc(r.id)}">See who</button><button class="btn btn-quiet btn-sm" data-arch="${esc(r.id)}" data-on="${r.active ? 1 : 0}">${r.active ? 'Archive' : 'Restore'}</button></div></div>
        ${total ? `<div class="rq-bar" role="img" aria-label="${done} of ${total} complete"><i class="c" style="width:${100 * done / total}%"></i><i class="s" style="width:${100 * (c.scheduled || 0) / total}%"></i><i class="m" style="width:${100 * (c.makeup_needed || 0) / total}%"></i></div>
          <div class="rq-nums"><span><b>${done}</b> / ${total} complete</span>${c.scheduled ? `<span><b>${c.scheduled}</b> scheduled</span>` : ''}${c.makeup_needed ? `<span><b>${c.makeup_needed}</b> need a makeup</span>` : ''}${c.incomplete ? `<span><b>${c.incomplete}</b> not done yet</span>` : ''}</div>` : '<p class="muted" style="font-size:var(--fs-sm);margin:0">Nobody is covered yet — check who it applies to.</p>'}
        <div class="rq-meta">${sess.length ? sess.map(s => `<span class="chip">${esc(s.label)}${s.status === 'cancelled' ? ' (cancelled)' : ''}</span>`).join('') : '<span class="chip is-warn">No sessions approved yet</span>'}</div></section>`; }).join('')
      : emptyState({ title: `No training requirements for ${ctx.termLabel} yet`, icon: 'training', text: 'A requirement is what people must complete (like New Guide Orientation); sessions are the occasions that satisfy it. Create one, or copy last semester’s setup.' })}`;
  host.addEventListener('click', async e => {
    try {
      if (e.target.closest('[data-new]')) return requirementDrawer(ctx, null, host, groups);
      if (e.target.closest('[data-copy]')) return copyFlow(ctx, host);
      if (e.target.closest('[data-backfill]')) { if (!await confirmDialog({ title: 'Create requirements from sessions?', confirmLabel: 'Create', lines: ['Each existing session becomes its own requirement for all Tour Guides — how it has been run so far.', 'You can merge or edit them afterwards.'] })) return;
        const r = await admin('admin_requirements_from_sessions', { p_term: ctx.term }); await ctx.reload(true); toast(`Created ${r.created}.`); return ctx.rerender(); }
      const ed = e.target.closest('[data-edit]'); if (ed) return requirementDrawer(ctx, ed.dataset.edit, host, groups);
      const pp = e.target.closest('[data-people-of]'); if (pp) return ctx.go('people', { req: pp.dataset.peopleOf });
      const ar = e.target.closest('[data-arch]'); if (ar) { await admin('admin_archive_requirement', { p_id: ar.dataset.arch, p_archived: ar.dataset.on === '1' }); await ctx.reload(true); return ctx.rerender(); }
      if (e.target.closest('[data-groups]')) return groupsDialog(ctx, host);
    } catch (x) { fail(x); }
  }, { once: false });
}

async function groupsDialog(ctx, host) {
  const groups = await loadGroups();
  const v = await formDialog({ title: 'Cohorts', submitLabel: 'Continue', intro: 'Named groups you can assign requirements to (for example "Fall 2026 new guides"). Pick one to edit its people, or create a new one.',
    fields: [{ name: 'g', label: 'Cohort', options: ['+ New cohort…', ...groups.map(g => `${g.name} (${g.members.length})`)], value: '+ New cohort…' }] });
  if (!v) return;
  try {
    let id, cur;
    if (v.g.startsWith('+')) { const n = await formDialog({ title: 'New cohort', submitLabel: 'Create', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description' }] }); if (!n) return; id = await admin('admin_save_training_group', { p_id: null, p_name: n.name, p_description: n.description }); cur = []; }
    else { const g = groups.find(x => v.g.startsWith(g_name(x))); id = g.id; cur = g.members; }
    const ids = await pickPeople({ title: 'Who is in this cohort?', guides: ctx.guides.filter(g => g.active), chosen: cur }); if (!ids) return;
    await admin('admin_set_group_members', { p_group: id, p_guides: ids, p_mode: 'set' }); toast('Cohort saved.'); ctx.rerender();
  } catch (x) { fail(x); }
}
const g_name = g => `${g.name} (`;

/* ------------------------------------------------------------------ people */
const ui = { q: '', status: '', req: '', chips: new Set(), picked: new Set(), sort: { key: 'name', dir: 1 } };

export async function mountPeople(host, ctx) {
  const d = ctx.data;
  const [matrix, terms] = await Promise.all([ctx.matrix(), select('guide_terms', 'select=guide_id,term_id').catch(() => [])]);
  const newIds = new Set(ctx.guides.map(g => g.id)); terms.forEach(t => { if (t.term_id !== ctx.term) newIds.delete(t.guide_id); });
  // a chip that every single person has says nothing, so it is only shown when it tells people apart
  const showNew = newIds.size > 0 && newIds.size < ctx.guides.length, showEval = ctx.guides.some(g => !g.evaluator_eligible);
  if (ctx.params?.req) { ui.req = ctx.params.req; }
  if (ctx.params?.filter === 'makeup') ui.status = 'makeup';
  const people = () => {
    const rows = ui.req ? matrix.filter(m => m.requirement_id === ui.req) : matrix;
    const per = byPerson(rows, d.requirements);
    return ctx.guides.filter(g => per.has(g.id)).map(g => ({ ...g, ...per.get(g.id), total: per.get(g.id).rows.length, isNew: newIds.has(g.id) }));
  };
  const matches = p => {
    const q = ui.q.trim().toLowerCase();
    if (q && !p.full_name.toLowerCase().includes(q)) return false;
    if (ui.status === 'complete' && p.done !== p.total) return false;
    if (ui.status === 'incomplete' && p.done === p.total) return false;
    if (ui.status === 'makeup' && !p.makeup) return false;
    if (ui.chips.has('new') && !p.isNew) return false; if (ui.chips.has('leadership') && !p.is_leadership) return false; if (ui.chips.has('evaluator') && !p.evaluator_eligible) return false;
    return true;
  };
  const cols = [
    { key: 'name', label: 'Tour Guide', sortable: true, value: p => p.full_name, render: p => `<button type="button" class="dt-name" data-open="${esc(p.id)}">${esc(p.full_name)}</button>${p.is_leadership ? '<span class="chip is-hi">Leadership</span>' : ''}${showNew && p.isNew ? '<span class="chip">New</span>' : ''}${showEval && p.evaluator_eligible ? '<span class="chip is-mute">Evaluator</span>' : ''}` },
    { key: 'done', label: 'Completion', sortable: true, value: p => p.total ? p.done / p.total : 1, render: p => `<b>${p.done}</b> / ${p.total}` },
    { key: 'missing', label: 'Missing', render: p => p.missing.length ? p.missing.slice(0, 3).map(m => `<span class="chip ${STATE_TONE[m.state] || ''}">${esc(m.name)}</span>`).join('') + (p.missing.length > 3 ? `<span class="chip">+${p.missing.length - 3}</span>` : '') : '<span class="muted">—</span>' },
    { key: 'next', label: 'Next training', sortable: true, value: p => p.next || '9', render: p => p.next ? esc(prettyDate(p.next)) : '—' },
    { key: 'makeup', label: 'Makeup', sortable: true, value: p => p.makeup, render: p => p.makeup ? `<span class="chip is-warn">${p.makeup} needed</span>` : '—' },
    { key: 'status', label: 'Status', render: p => p.done === p.total ? '<span class="chip is-good">Complete</span>' : p.makeup ? '<span class="chip is-warn">Needs makeup</span>' : '<span class="chip">In progress</span>' }
  ];
  const paint = () => {
    const rows = sortRows(people().filter(matches), cols, ui.sort), all = people();
    $('#pp-count', host).textContent = `${rows.length} of ${all.length} · ${all.filter(p => p.done === p.total).length} complete`;
    $('#pp-table', host).innerHTML = tableHtml({ columns: cols, rows, sort: ui.sort, selected: ui.picked, rowKey: p => p.id, empty: emptyState(d.requirements.length ? { title: 'Nobody matches those filters', icon: 'search', text: 'Clear a filter to see more people.' } : { title: 'No requirements yet', icon: 'training', text: 'Create requirements first; this table shows who has done each.' }) });
    const n = ui.picked.size;
    $('#pp-sel', host).innerHTML = n ? `<div class="pp-sel"><b>${n} selected</b><button class="btn btn-ghost btn-sm" data-b="mark">Mark requirement…</button><button class="btn btn-ghost btn-sm" data-b="assign">Assign to a session…</button><button class="btn btn-ghost btn-sm" data-b="group">Add to cohort…</button>
      <button class="btn btn-ghost btn-sm" data-b="remind">Send reminder…</button><button class="btn btn-ghost btn-sm" data-b="export">Export</button><button class="btn btn-quiet btn-sm" data-b="clear">Clear</button></div>` : '';
  };
  host.innerHTML = `<div class="gd-bar"><input id="pp-q" type="search" placeholder="Search people" aria-label="Search people"><select id="pp-status" class="select" aria-label="Status"><option value="">Everyone</option><option value="incomplete">Still owe training</option><option value="makeup">Need a makeup</option><option value="complete">Complete</option></select>
      <select id="pp-req" class="select" aria-label="Requirement"><option value="">All requirements</option>${d.requirements.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
      ${[['new', 'New guides'], ['leadership', 'Leadership'], ['evaluator', 'Evaluators']].map(([k, l]) => `<button class="tab" data-chip="${k}">${l}</button>`).join('')}<button class="btn btn-ghost btn-sm" data-b="export-all">Export CSV</button></div>
    <div id="pp-sel"></div><div style="text-align:right;margin:2px 2px 8px"><span class="muted" style="font-size:.78rem" id="pp-count"></span></div><div id="pp-table"></div>`;
  $('#pp-status', host).value = ui.status; $('#pp-req', host).value = ui.req; paint();
  bindTable($('#pp-table', host), { onSort: k => { ui.sort = nextSort(ui.sort, k); paint(); }, onToggle: (id, on) => { on ? ui.picked.add(id) : ui.picked.delete(id); paint(); },
    onToggleAll: on => { people().filter(matches).forEach(p => on ? ui.picked.add(p.id) : ui.picked.delete(p.id)); paint(); } });
  host.addEventListener('input', debounce(e => { if (e.target.id === 'pp-q') { ui.q = e.target.value; paint(); } }, 100));
  host.addEventListener('change', e => { if (e.target.id === 'pp-status') ui.status = e.target.value; else if (e.target.id === 'pp-req') ui.req = e.target.value; else return; paint(); });

  const chosen = () => ctx.guides.filter(g => ui.picked.has(g.id));
  const reqPick = (title) => formDialog({ title, submitLabel: 'Continue', fields: [{ name: 'req', label: 'Requirement', options: d.requirements.filter(r => r.active).map(r => r.name), value: d.requirements.find(r => r.id === ui.req)?.name || d.requirements[0]?.name }] }).then(v => v && d.requirements.find(r => r.name === v.req));
  host.addEventListener('click', async e => {
    try {
      const chip = e.target.closest('[data-chip]'); if (chip) { const k = chip.dataset.chip; ui.chips.has(k) ? ui.chips.delete(k) : ui.chips.add(k); chip.classList.toggle('is-active', ui.chips.has(k)); return paint(); }
      const o = e.target.closest('[data-open]'); if (o) return profile(ctx, o.dataset.open, matrix, () => ctx.go('people', {}));
      const b = e.target.closest('[data-b]')?.dataset.b; if (!b) return;
      if (b === 'clear') { ui.picked.clear(); return paint(); }
      if (b === 'export-all' || b === 'export') {
        const rows = (b === 'export' ? people().filter(p => ui.picked.has(p.id)) : people().filter(matches));
        return toast(`Exported ${downloadCsv('training-completion', [['Tour Guide', 'Email', 'Completed', 'Required', 'Missing', 'Makeups needed', 'Next training'], ...rows.map(p => [p.full_name, p.email || '', p.done, p.total, p.missing.map(m => m.name).join('; '), p.makeup, p.next || ''])])} people.`);
      }
      if (b === 'mark') {
        const req = await reqPick('Mark a requirement'); if (!req) return;
        const v = await formDialog({ title: `Mark “${req.name}” for ${ui.picked.size} people`, submitLabel: 'Apply', intro: 'This overrides what attendance says. Choose Automatic to return to normal.', fields: [{ name: 'status', label: 'Mark as', options: ['Complete', 'Waived', 'Excused', 'Incomplete', 'Automatic (follow attendance)'], value: 'Waived' }, { name: 'reason', label: 'Reason (optional)' }] }); if (!v) return;
        const s = v.status.startsWith('Automatic') ? null : v.status.toLowerCase();
        const r = await admin('admin_set_completion', { p_req: req.id, p_guides: [...ui.picked], p_status: s, p_reason: v.reason || null });
        ui.picked.clear(); await ctx.reload(true); toast(`Updated ${r.changed}.`); return ctx.go('people', { req: ui.req });
      }
      if (b === 'assign') {
        const open = d.sessions.filter(s => s.status === 'scheduled' && s.held_on >= new Date().toISOString().slice(0, 10)); if (!open.length) return toast('There is no upcoming session to assign them to.', 'err');
        const v = await formDialog({ title: `Assign ${ui.picked.size} people to a session`, submitLabel: 'Assign', intro: 'They are added to the session’s roster, ready to be marked. Use this for makeups.', fields: [{ name: 's', label: 'Session', options: open.map(s => `${s.label} · ${whenText(s)}`), value: `${open[0].label} · ${whenText(open[0])}` }] }); if (!v) return;
        const s = open.find(x => `${x.label} · ${whenText(x)}` === v.s);
        const r = await admin('admin_set_attendance', { p_session: s.id, p_entries: [...ui.picked].map(id => ({ guide_id: id, status: null })), p_submit: false });
        ui.picked.clear(); await ctx.reload(true); toast(`Added ${r.saved} to ${s.label}.`); return ctx.go('people', { req: ui.req });
      }
      if (b === 'group') {
        const groups = await loadGroups(); if (!groups.length) return toast('Create a cohort first (Requirements → Cohorts).', 'err');
        const v = await formDialog({ title: 'Add to a cohort', submitLabel: 'Add', fields: [{ name: 'g', label: 'Cohort', options: groups.map(g => g.name), value: groups[0].name }] }); if (!v) return;
        const g = groups.find(x => x.name === v.g); await admin('admin_set_group_members', { p_group: g.id, p_guides: [...ui.picked], p_mode: 'add' }); ui.picked.clear(); paint(); return toast(`Added to ${g.name}.`);
      }
      if (b === 'remind') {
        const per = byPerson(matrix, d.requirements), who = chosen();
        const missing = who.map(g => per.get(g.id)?.missing.map(m => m.name) || []).flat();
        const names = [...new Set(missing)];
        return reminderDialog({ people: who, subject: `Training reminder${names.length === 1 ? ': ' + names[0] : ''}`,
          body: `Hi,\n\nA quick reminder that you still need to complete ${names.length ? names.join(', ') : 'your training'}${names.length ? '' : ''}. If you are not sure when the next session is, check the Training page in Codirector Hub.\n\nThanks!` });
      }
    } catch (x) { fail(x); }
  });
}

/* ------------------------------------------------------------ person profile */
async function profile(ctx, guideId, matrix, back) {
  const d = ctx.data, g = ctx.guides.find(x => x.id === guideId);
  const rows = matrix.filter(m => m.guide_id === guideId);
  const att = await select('training_attendance', `select=session_id,actual&guide_id=eq.${guideId}`).catch(() => []);
  const root = document.createElement('div'); root.className = 'modal-root'; root.hidden = true;
  root.innerHTML = `<div class="modal-scrim" data-close></div><div class="modal modal-xl"><header class="modal-head"><div><h2>${esc(g.full_name)}</h2><p class="muted">${esc(ctx.termLabel)} training${g.email ? ' · ' + esc(g.email) : ''}</p></div></header>
    <div class="modal-body">
      ${rows.length ? rows.map(m => { const r = d.requirements.find(x => x.id === m.requirement_id); return `<div class="pr-row" data-req="${esc(r.id)}"><span><b>${esc(r.name)}</b><em>${m.state === 'complete' && m.done_on ? 'Done ' + esc(prettyDate(m.done_on)) + (m.via === 'manual' ? ' (set by hand)' : ' (attended)') : m.state === 'scheduled' && m.next_on ? 'Scheduled ' + esc(prettyDate(m.next_on)) : r.deadline ? 'Due ' + esc(prettyDate(r.deadline)) : ''}${m.reason ? ' · ' + esc(m.reason) : ''}</em></span>
        <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="chip ${STATE_TONE[m.state]}">${esc(STATE_LABEL[m.state])}</span>${m.via === 'manual' ? '<span class="chip is-warn">by hand</span>' : ''}
        <select class="select" data-set aria-label="Set status for ${esc(r.name)}" style="min-width:150px"><option value="">Change…</option><option value="complete">Mark complete</option><option value="waived">Waive</option><option value="excused">Excuse</option><option value="incomplete">Mark incomplete</option><option value="auto">Back to automatic</option></select></span></div>`; }).join('') : '<p class="muted">No requirements apply to this person this semester.</p>'}
      <div class="drawer-sec">Attendance</div>
      <div class="alias-list">${att.length ? att.map(a => { const s = d.sessions.find(x => x.id === a.session_id); return s ? `<div class="alias-row"><span>${esc(s.label)} <span class="src-badge">${esc(whenText(s))}</span></span><span class="chip ${attClass(a.actual) === 'present' ? 'is-good' : attClass(a.actual) === 'pending' ? 'is-mute' : 'is-warn'}">${esc(a.actual || 'Not marked')}</span></div>` : ''; }).join('') : '<p class="muted" style="font-size:var(--fs-sm)">Nothing recorded this semester.</p>'}</div>
    </div><footer class="modal-foot"><button class="btn btn-ghost" data-close>Close</button></footer></div>`;
  document.body.append(root);
  const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); };
  root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
  root.addEventListener('click', e => { if (e.target.closest('[data-close]')) done(); });
  root.addEventListener('change', async e => {
    const sel = e.target.closest('[data-set]'); if (!sel || !sel.value) return;
    const req = sel.closest('[data-req]').dataset.req, val = sel.value;
    try {
      let reason = null;
      if (val !== 'auto') { const v = await formDialog({ title: 'Reason (optional)', submitLabel: 'Save', fields: [{ name: 'reason', label: 'Why?' }] }); if (!v) { sel.value = ''; return; } reason = v.reason || null; }
      await admin('admin_set_completion', { p_req: req, p_guides: [guideId], p_status: val === 'auto' ? null : val, p_reason: reason });
      await ctx.reload(true); done(); toast('Updated.'); ctx.go('people', { req: ctx.params?.req || '' });
    } catch (x) { fail(x); sel.value = ''; }
  });
  openModal(root);
}
