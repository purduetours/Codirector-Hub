/* ================================================================== Training
   One home for training, shaped to who is looking:

     Administrators   Overview · Sessions · Requirements · Attendance · People ·
                      Resources · Reports   (and "My training" if they are guides)
     Committee        Overview and Sessions, read-only — counts, never who missed
     Tour Guides      "My training": what they have done, what they still owe,
                      what is coming, makeups, and the materials for each

   The semester picker at the top switches the whole center to any past or
   future semester; history is never overwritten when a new one starts. Only the
   chosen semester is loaded, by filtered queries, so this stays fast.

   Completion (complete / scheduled / makeup needed …) is never decided here: it
   comes from the database, from attendance, so the center, the Action Center,
   Vanessa and a guide's own page always agree.
============================================================================ */
import { state, termId, isAdmin, inTraining } from '../core/state.js';
import { $, esc, toast, injectStyle, prettyDate, prettyTime, todayISO } from '../core/ui.js';
import { downloadCsv } from '../core/csv.js';
import { admin, emptyState, setupNotice, setupMissing, hashParams } from './admin-kit.js';
import { loadTerms, loadTerm, loadMatrix, loadOverview, loadReport, loadGuides, byPerson, whenText, STATE_LABEL, STATE_TONE } from './train-data.js';
import { mountSessions } from './train-sessions.js';
import { mountRequirements, mountPeople } from './train-people.js';
import { mountAttendance, leaveAttendance } from './train-attendance.js';
import { mountResources, materialCard } from './train-materials.js';
import { ICONS } from '../core/icons.js';

injectStyle('trainhub-css', `
.th-top { display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:14px; }
.th-top .select { width:auto; min-width:170px; }
.th-past { padding:9px 14px; margin-bottom:14px; border-radius:var(--radius-sm); background:var(--warn-bg); color:var(--warn); font-size:var(--fs-sm); }
.th-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); gap:22px; }
@media (max-width:900px){ .th-grid { grid-template-columns:1fr; } }
.th-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:16px; margin-bottom:16px; }
.th-card h3 { font-size:var(--fs-md); margin-bottom:10px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.up-item { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); cursor:pointer; background:none; border-left:0; border-right:0; border-top:0; width:100%; text-align:left; font:inherit; color:var(--text); }
.up-item:last-child { border-bottom:0; } .up-item:hover b { color:var(--pink-soft); }
.up-when { width:64px; flex:none; text-align:center; } .up-when b { display:block; font-size:1.25rem; line-height:1; } .up-when em { font-style:normal; font-size:var(--fs-2xs); color:var(--text-faint); text-transform:uppercase; }
.up-body { display:grid; gap:2px; min-width:0; } .up-body em { font-style:normal; font-size:var(--fs-sm); color:var(--text-soft); }
.na-item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:9px 0; border-bottom:1px solid var(--line); font-size:var(--fs-md); } .na-item:last-child { border-bottom:0; }
.my-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:16px; margin-bottom:12px; display:grid; gap:10px; }
.my-card h3 { font-size:1.02rem; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
.my-note { padding:9px 12px; border-radius:var(--radius-sm); font-size:var(--fs-md); background:var(--warn-bg); color:var(--warn); }
.my-next { display:flex; flex-wrap:wrap; gap:8px; } .my-next .chip { font-size:var(--fs-sm); padding:4px 12px; margin:0; }
.rp-row { display:grid; grid-template-columns:minmax(120px,1.2fr) 3fr auto; gap:12px; align-items:center; padding:8px 0; border-bottom:1px solid var(--line); font-size:var(--fs-md); }
@media (max-width:600px){ .rp-row { grid-template-columns:1fr; gap:4px; } }
`);

const TABS = [['overview', 'Overview'], ['sessions', 'Sessions'], ['requirements', 'Requirements'], ['attendance', 'Attendance'], ['people', 'People'], ['resources', 'Resources'], ['reports', 'Reports']];
let ctx = null;

const pct = (n, t) => t ? Math.round(100 * n / t) : 0;

/* ---------------------------------------------------------------- overview */
async function overviewTab(host) {
  const ov = await ctx.getOverview();
  const d = ctx.data, admin_ = ctx.admin;
  const up = ov.upcoming.slice(0, 6);
  const needs = [];
  const makeup = ov.requirements.reduce((n, r) => n + (r.makeup_needed || 0), 0);
  ov.attention.forEach(a => {
    if (a.kind === 'attendance_missing') needs.push({ t: `Attendance has not been entered for “${a.title}”`, go: ['attendance', { session: a.session_id }], b: 'Take attendance' });
    if (a.kind === 'no_location') needs.push({ t: `“${a.title}” has no room or link (${prettyDate(a.date)})`, go: ['sessions', { open: a.session_id }], b: 'Add a location' });
    if (a.kind === 'no_speaker') needs.push({ t: `“${a.title}” has no speaker assigned (${prettyDate(a.date)})`, go: ['sessions', { open: a.session_id }], b: 'Assign' });
    if (a.kind === 'no_sessions') needs.push({ t: `“${a.title}” has no sessions scheduled`, go: ['requirements', {}], b: 'Set up' });
  });
  if (makeup) needs.push({ t: `${makeup} ${makeup === 1 ? 'person needs' : 'people need'} a makeup`, go: ['people', { filter: 'makeup' }], b: 'See who' });
  ov.requirements.filter(r => r.deadline && r.total - r.complete - r.waived - r.excused > 0 && r.deadline <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) && r.deadline >= todayISO())
    .forEach(r => needs.push({ t: `“${r.name}” is due ${prettyDate(r.deadline)} — ${r.total - r.complete - r.waived - r.excused} not done yet`, go: ['people', { req: r.id }], b: 'See who' }));
  const totalReq = ov.requirements.reduce((a, r) => ({ done: a.done + r.complete + r.waived + r.excused, total: a.total + r.total }), { done: 0, total: 0 });
  host.innerHTML = `<div class="th-grid"><div>
      <section class="th-card"><h3>Upcoming training <button class="btn btn-ghost btn-sm" data-go="sessions">All sessions</button></h3>
        ${up.length ? up.map(s => `<button type="button" class="up-item" data-open="${esc(s.id)}"><span class="up-when"><b>${new Date(s.held_on + 'T12:00:00').getDate()}</b><em>${new Date(s.held_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', weekday: 'short' })}</em></span>
          <span class="up-body"><b>${esc(s.title)}</b><em>${s.start_time ? esc(prettyTime(s.start_time.slice(0, 5))) : 'Time not set'} · ${s.location ? esc(s.location) : '<span class="chip is-warn">No room</span>'}</em>
            <span>${s.makeup ? '<span class="chip is-warn">Makeup</span>' : ''}${s.required ? '<span class="chip is-hi">Required</span>' : '<span class="chip is-mute">Optional</span>'}<span class="chip">${esc(s.type)}</span>
            ${admin_ ? `<span class="chip">${s.expected} expected</span>${(s.speakers || []).length ? `<span class="chip">${esc(s.speakers.join(', '))}</span>` : s.required ? '<span class="chip is-warn">No speaker</span>' : ''}` : ''}</span></span></button>`).join('')
          : emptyState({ title: 'Nothing scheduled in the next 30 days', icon: 'schedule', text: admin_ ? 'Create a session, or start from a template.' : 'Nothing is scheduled right now.', action: admin_ ? '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-go="sessions">Plan a session</button></div>' : '' })}</section>
      <section class="th-card"><h3>Required training completion</h3>
        ${ov.requirements.length ? `${admin_ || true ? `<p style="font-size:1.4rem;margin:0 0 10px"><b>${totalReq.done}</b> <span class="muted" style="font-size:.9rem">of ${totalReq.total} required items complete</span></p>` : ''}
          ${ov.requirements.map(r => { const done = r.complete + r.waived + r.excused; return `<div class="rp-row"><span><b>${esc(r.name)}</b>${r.deadline ? `<span class="dt-sub">Due ${esc(prettyDate(r.deadline))}</span>` : ''}</span>
            <span class="rq-bar" role="img" aria-label="${done} of ${r.total} complete"><i class="c" style="width:${pct(done, r.total)}%"></i><i class="s" style="width:${pct(r.scheduled, r.total)}%"></i><i class="m" style="width:${pct(r.makeup_needed, r.total)}%"></i></span><span><b>${done}</b> / ${r.total}</span></div>`; }).join('')}`
          : emptyState({ title: 'No requirements yet', icon: 'training', text: admin_ ? 'Define what people must complete this semester.' : 'Nothing is required yet.', action: admin_ ? '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-go="requirements">Set up requirements</button></div>' : '' })}</section>
    </div><div>
      ${admin_ ? `<section class="th-card"><h3>Needs attention <span class="chip">${needs.length}</span></h3>${needs.length ? needs.map((n, i) => `<div class="na-item"><span>${esc(n.t)}</span><button class="btn btn-ghost btn-sm" data-na="${i}">${esc(n.b)}</button></div>`).join('') : '<p class="muted" style="margin:0">All clear. Nothing needs you right now.</p>'}</section>` : ''}
      ${admin_ ? `<section class="th-card"><h3>Quick actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-go="attendance">Take attendance</button><button class="btn btn-ghost btn-sm" data-go="sessions">New session</button><button class="btn btn-ghost btn-sm" data-go="requirements">New requirement</button><button class="btn btn-ghost btn-sm" data-go="people">Who still owes training</button><a class="btn btn-ghost btn-sm" href="#/training">Classic grid</a></div></section>` : ''}
    </div></div>`;
  host.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) return ctx.go(g.dataset.go, {});
    const na = e.target.closest('[data-na]'); if (na) return ctx.go(...needs[Number(na.dataset.na)].go);
    const o = e.target.closest('[data-open]'); if (o) return ctx.go('sessions', { open: o.dataset.open });
  });
}

/* ----------------------------------------------------------------- reports */
async function reportsTab(host) {
  const [ov, rp, matrix] = await Promise.all([ctx.getOverview(), loadReport(ctx.term), ctx.matrix()]);
  const guides = new Map(ctx.guides.map(g => [g.id, g]));
  const groups = [['All Tour Guides', () => true], ['Leadership', g => g.is_leadership], ['Evaluators', g => g.evaluator_eligible]];
  const per = byPerson(matrix, ctx.data.requirements);
  const states = matrix.reduce((a, m) => ({ ...a, [m.state]: (a[m.state] || 0) + 1 }), {});
  const makeupSessions = ctx.data.sessions.filter(s => s.makeup_for);
  host.innerHTML = `<div class="th-grid"><div>
    <section class="th-card"><h3>Completion by requirement <button class="btn btn-ghost btn-sm" data-csv="req">Export</button></h3>
      ${ov.requirements.map(r => { const done = r.complete + r.waived + r.excused; return `<div class="rp-row"><span><b>${esc(r.name)}</b></span><span class="rq-bar"><i class="c" style="width:${pct(done, r.total)}%"></i><i class="s" style="width:${pct(r.scheduled, r.total)}%"></i><i class="m" style="width:${pct(r.makeup_needed, r.total)}%"></i></span><span><b>${pct(done, r.total)}%</b> · ${done}/${r.total}</span></div>`; }).join('') || '<p class="muted">No requirements yet.</p>'}</section>
    <section class="th-card"><h3>Attendance by session <button class="btn btn-ghost btn-sm" data-csv="att">Export</button></h3>
      ${rp.sessions.length ? `<div class="dt-wrap"><table class="dt"><thead><tr><th>Session</th><th>Date</th><th>Present</th><th>Excused</th><th>Absent</th><th>Not marked</th></tr></thead><tbody>${rp.sessions.map(s => `<tr><td>${esc(s.title)}${s.required ? '' : '<span class="chip is-mute">Optional</span>'}</td><td>${s.held_on ? esc(prettyDate(s.held_on)) : '—'}</td><td>${s.present}</td><td>${s.excused}</td><td>${s.absent}</td><td>${s.pending}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No sessions yet.</p>'}</section>
    </div><div>
    <section class="th-card"><h3>By group</h3>${groups.map(([name, f]) => { const rows = [...per.values()].filter(p => f(guides.get(p.guide_id) || {})); const done = rows.filter(p => p.done === p.rows.length).length;
        return `<div class="rp-row"><span><b>${esc(name)}</b></span><span class="rq-bar"><i class="c" style="width:${pct(done, rows.length)}%"></i></span><span><b>${done}</b> / ${rows.length} fully complete</span></div>`; }).join('')}</section>
    <section class="th-card"><h3>Makeups</h3><div class="rq-nums" style="flex-direction:column;gap:6px"><span><b>${states.makeup_needed || 0}</b> still need one</span><span><b>${states.scheduled || 0}</b> scheduled for a coming session</span><span><b>${makeupSessions.length}</b> makeup session${makeupSessions.length === 1 ? '' : 's'} this semester</span><span><b>${states.waived || 0}</b> waived · <b>${states.excused || 0}</b> excused</span></div></section>
    </div></div>`;
  host.addEventListener('click', e => {
    const c = e.target.closest('[data-csv]'); if (!c) return;
    if (c.dataset.csv === 'req') toast(`Exported ${downloadCsv('training-completion-by-requirement', [['Requirement', 'Deadline', 'Applies to', 'Complete', 'Waived', 'Excused', 'Scheduled', 'Makeup needed', 'Not done yet'], ...ov.requirements.map(r => [r.name, r.deadline || '', r.total, r.complete, r.waived, r.excused, r.scheduled, r.makeup_needed, r.incomplete])])} rows.`);
    else toast(`Exported ${downloadCsv('training-attendance-by-session', [['Session', 'Date', 'Expected', 'Present', 'Excused', 'Absent', 'Not marked'], ...rp.sessions.map(s => [s.title, s.held_on || '', s.expected, s.present, s.excused, s.absent, s.pending])])} rows.`);
  });
}

/* --------------------------------------------------------------- my training */
async function myTab(host) {
  const my = await admin('my_training', { p_term: ctx.term });
  if (!my.linked) { host.innerHTML = emptyState({ title: 'Your account is not linked to a Tour Guide', icon: 'user', text: 'Ask a codirector to link your account to your Tour Guide record (Admin → Tour Guides) and your training will appear here.' }); return; }
  const open = my.requirements.filter(r => !['complete', 'waived', 'excused'].includes(r.state));
  host.innerHTML = `<p class="muted" style="font-size:.9rem;margin-bottom:14px"><b style="color:var(--text)">${my.requirements.length - open.length} of ${my.requirements.length}</b> required trainings complete${open.length ? `, ${open.length} still to do` : ' — you are all caught up'}.</p>
    ${my.requirements.length ? my.requirements.map(r => `<section class="my-card"><h3>${esc(r.name)} <span class="chip ${STATE_TONE[r.state]}" style="margin:0">${esc(STATE_LABEL[r.state])}</span></h3>
      ${r.description ? `<p class="muted" style="margin:0;font-size:.88rem">${esc(r.description)}</p>` : ''}
      ${r.state === 'makeup_needed' ? '<div class="my-note"><b>You missed this and need a makeup.</b> Pick one of the sessions below, or ask a codirector.</div>' : ''}
      ${r.state === 'complete' && r.done_on ? `<p class="muted" style="margin:0;font-size:.86rem">Completed ${esc(prettyDate(r.done_on))}${r.via === 'manual' ? ' (recorded by a codirector)' : ''}.</p>` : ''}
      ${r.deadline && !['complete', 'waived', 'excused'].includes(r.state) ? `<p style="margin:0;font-size:.9rem">Due <b>${esc(prettyDate(r.deadline))}</b></p>` : ''}
      ${r.upcoming.length && !['complete', 'waived', 'excused'].includes(r.state) ? `<div class="my-next">${r.upcoming.map(s => `<span class="chip is-hi">${esc(prettyDate(s.held_on))}${s.start_time ? ' · ' + esc(prettyTime(s.start_time.slice(0, 5))) : ''}${s.location ? ' · ' + esc(s.location) : ''}${s.makeup ? ' (makeup)' : ''}</span>`).join('')}</div>` : ''}
      ${r.materials.length ? `<div class="mat-grid">${r.materials.map(materialCard).join('')}</div>` : ''}</section>`).join('')
      : emptyState({ title: 'Nothing is required of you yet', icon: 'check', text: `No training is assigned to you for ${ctx.termLabel}.` })}`;
}

/* -------------------------------------------------------------------- shell */
const TAB_FN = { overview: overviewTab, sessions: h => mountSessions(h, ctx), requirements: h => mountRequirements(h, ctx), attendance: h => mountAttendance(h, ctx), people: h => mountPeople(h, ctx), resources: h => mountResources(h, ctx), reports: reportsTab, my: myTab };

async function show(view, tab) {
  leaveAttendance();
  ctx.tab = tab;
  view.querySelectorAll('.th-tabs .tab').forEach(t => { t.classList.toggle('is-active', t.dataset.tab === tab); t.setAttribute('aria-selected', String(t.dataset.tab === tab)); });
  const host = document.createElement('div'); host.id = 'th-tab';
  $('#th-body', view).replaceChildren(host);
  host.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try { await TAB_FN[tab](host); } catch (e) { host.innerHTML = setupMissing(e) || e.setup ? setupNotice() : `<p class="form-error">${esc(e.message)}</p>`; }
}

export default {
  id: 'trainhub', title: 'Training', crumb: 'Sessions, requirements and your status', icon: '🎓', section: 'Hub', quiet: true,

  unmount() { leaveAttendance(); ctx = null; },

  async mount(view) {
    const params = hashParams();
    const adm = isAdmin(), team = adm || inTraining();
    const terms = await loadTerms().catch(() => []);
    const term = params.term || termId();
    ctx = { term, termLabel: terms.find(t => t.id === term)?.label || term, admin: adm, team, params, tab: '', overview: null, _matrix: null };
    const tabs = adm ? TABS : team ? TABS.filter(([k]) => ['overview', 'sessions'].includes(k)) : [];
    // a Tour Guide (or anyone linked to one) also gets their own page
    /* "My training" only where it can mean something: always for a plain Tour Guide
       (it explains how to link their account if not), and for anyone else only if
       their account is actually linked to a Tour Guide. */
    const mine = adm || team ? await admin('my_training', { p_term: term }).then(r => !!r.linked, () => false) : true;
    if (mine) { tabs.push(['my', 'My training']); if (!adm && !team) tabs.unshift(tabs.pop()); }

    const load = async () => {
      ctx.data = await loadTerm(ctx.term);
      ctx.guides = await loadGuides().catch(() => []);
      ctx.overview = null; ctx._matrix = null;
    };
    ctx.matrix = async () => (ctx._matrix ||= await loadMatrix(ctx.term));
    ctx.getOverview = async () => (ctx.overview ||= await loadOverview(ctx.term));
    ctx.reload = async () => { await load(); };
    ctx.rerender = () => show(view, ctx.tab);
    ctx.go = (tab, p = {}) => { ctx.params = p; const q = new URLSearchParams({ tab, ...(ctx.term !== termId() ? { term: ctx.term } : {}), ...p }); history.replaceState(null, '', `${location.pathname}${location.search}#/trainhub?${q}`); return show(view, tab); };

    view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    try { if (adm || team) await load(); else { ctx.data = { sessions: [], requirements: [], links: [], speakers: [], materials: [] }; ctx.guides = []; } }
    catch (e) { view.innerHTML = setupMissing(e) ? `<section class="sm-card">${setupNotice()}<p class="muted" style="margin-top:10px">The training tools need the training database update (supabase/20-training-management.sql). The classic attendance page still works: <a href="#/training">open it</a>.</p></section>` : `<p class="form-error">${esc(e.message)}</p>`; return; }

    view.innerHTML = `<div class="th-top"><div class="tabs th-tabs" role="tablist" aria-label="Training sections" style="margin:0">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${adm || team ? `<select id="th-term" class="select" aria-label="Semester">${terms.map(t => `<option value="${esc(t.id)}"${t.id === ctx.term ? ' selected' : ''}>${esc(t.label)}${t.is_current ? ' (current)' : ''}</option>`).join('')}</select>` : ''}</div>
      ${ctx.term !== termId() ? `<div class="th-past">You are looking at ${esc(ctx.termLabel)}, not the current semester. Everything shown is that semester’s history.</div>` : ''}
      <div id="th-body"></div>`;
    view.addEventListener('click', e => { const t = e.target.closest('.th-tabs [data-tab]'); if (t) ctx.go(t.dataset.tab, {}); });
    view.addEventListener('change', e => { if (e.target.id === 'th-term') { const q = new URLSearchParams({ tab: ctx.tab, term: e.target.value }); location.hash = `#/trainhub?${q}`; } });
    await show(view, tabs.some(([k]) => k === params.tab) ? params.tab : tabs[0][0]);
  }
};
