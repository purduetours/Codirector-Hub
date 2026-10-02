/* ================================================================== Semester
   Everything about the semester the hub is running, and the guided way to
   start the next one.

   Before this, a new semester meant: insert a row into `terms` in SQL, edit
   TERM_LABEL in config.js, run the rollover from the Eval Tracker, and remember
   to archive graduated guides by hand. It is now one wizard, and the last step
   changes nothing until you have seen exactly what will happen.

   What the wizard does and does not touch
     carried forward   guides who are staying (promoted one priority tier),
                       the people who keep access, their roles
     changed           leavers are ARCHIVED, never deleted; new hires are
                       invited; role changes are applied; training sessions for
                       the new semester are created
     NOT copied        evaluations, attendance, scores, announcements. They stay
                       with the semester where they happened and remain readable.

   The preview is the real run with the result rolled back (see
   supabase/18-admin-operations.sql), so it cannot disagree with what happens.
============================================================================ */
import { select } from '../core/db.js';
import { state, termId, termLabel } from '../core/state.js';
import { $, $$, esc, toast, injectStyle, prettyDate } from '../core/ui.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, fail } from './admin-kit.js';
import { refreshActions } from '../core/actioncenter.js';
import { loadRoster } from './evals.js';

injectStyle('semester-css', `
.sm-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:18px; margin-bottom:14px; }
.sm-card h3 { font-size:1.05rem; margin-bottom:4px; }
.sm-meta { display:flex; gap:18px; flex-wrap:wrap; color:var(--text-soft); font-size:.86rem; margin:6px 0 12px; }
.sm-steps { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
.sm-step { font-size:.76rem; padding:4px 11px; border-radius:999px; background:var(--bg-sunken); color:var(--text-faint); }
.sm-step.is-on { background:var(--accent-soft); color:var(--pink-soft); font-weight:700; }
.sm-step.is-done { color:var(--good); }
.sm-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
.sm-list { max-height:340px; overflow:auto; border:1px solid var(--line); border-radius:var(--radius-sm); margin:8px 0; }
.sm-li { display:flex; gap:10px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--line); font-size:.88rem; }
.sm-li:last-child { border-bottom:0; } .sm-li b { flex:1; font-weight:600; } .sm-li em { font-style:normal; color:var(--text-faint); font-size:.76rem; }
.sm-li input[type=checkbox] { width:17px; height:17px; accent-color:var(--accent); }
.sm-li.is-leaving { background:var(--warn-bg); }
.sm-sum { display:grid; gap:8px; margin:12px 0; }
.sm-sum div { display:flex; justify-content:space-between; gap:12px; padding:9px 12px; background:var(--surface-1); border:1px solid var(--hairline); border-radius:var(--radius-sm); font-size:.9rem; }
.sm-sum b { font-variant-numeric:tabular-nums; }
.sm-warn { font-size:.84rem; color:var(--warn); background:var(--warn-bg); border-radius:var(--radius-sm); padding:8px 12px; margin:6px 0; }
.sm-keep { font-size:.82rem; color:var(--text-soft); }
.sm-keep li { margin:3px 0; }
.sm-row { display:grid; grid-template-columns:1fr 1.2fr 1fr auto; gap:8px; margin-bottom:8px; align-items:end; }
@media (max-width:700px){ .sm-row { grid-template-columns:1fr 1fr; } }
.sm-nav { display:flex; justify-content:space-between; gap:10px; margin-top:16px; flex-wrap:wrap; }
`);

const STEPS = ['Semester', 'Guides', 'Committee', 'Training', 'Review', 'Start'];
const SEASONS = ['Fall', 'Spring', 'Summer'];
let terms = [], activeGuides = [], activePeople = [], roleList = [], prios = [];
let wiz = null;

const rank = t => { const m = /^(fall|spring|summer)-(\d{4})$/.exec(t.id) || []; return Number(m[2] || 0) * 10 + ({ spring: 1, summer: 2, fall: 3 }[m[1]] || 0); };

async function loadTerms() {
  terms = await select('terms', 'select=id,label,academic_year,starts_on,ends_on,is_current')
    .catch(() => select('terms', 'select=id,label,is_current'));
  terms.sort((a, b) => rank(b) - rank(a));
}

async function loadWizardData() {
  [activeGuides, activePeople, roleList, prios] = await Promise.all([
    select('guides', 'select=id,full_name&active=eq.true&order=last_name.asc'),
    select('members', 'select=id,full_name,email,role&active=eq.true&order=full_name.asc'),
    select('roles', 'select=name,is_admin&order=sort_order.asc'),
    select('priorities', 'select=name&order=sort_order.asc')
  ]);
}

/** The semester that naturally follows the current one. */
function suggest() {
  const m = /^(fall|spring|summer)-(\d{4})$/.exec(termId());
  if (!m) return { season: 'Fall', year: new Date().getFullYear() };
  return m[1] === 'fall' ? { season: 'Spring', year: Number(m[2]) + 1 } : { season: 'Fall', year: Number(m[2]) };
}
const termIdOf = d => `${d.season.toLowerCase()}-${d.year}`;
const academicYear = d => d.season === 'Fall' ? `${d.year}–${String(d.year + 1).slice(2)}` : `${d.year - 1}–${String(d.year).slice(2)}`;

function freshWizard() {
  const s = suggest();
  return { step: 0, season: s.season, year: s.year, starts: '', ends: '', leavingGuides: new Set(), newGuides: '',
    leavingPeople: new Set(), roleChanges: {}, newPeople: [], sessions: [], copyTraining: true, shiftDays: 182, copySessions: true, promote: true, preview: null, gSearch: '', typed: '' };
}

/* ------------------------------------------------------------- the page */
function overview(view) {
  const cur = terms.find(t => t.is_current);
  const dates = t => t.starts_on || t.ends_on ? `${t.starts_on ? prettyDate(t.starts_on) : '?'} – ${t.ends_on ? prettyDate(t.ends_on) : '?'}` : 'No dates set';
  view.innerHTML = `<div id="sm-setup"></div>
    ${cur ? `<section class="sm-card"><h3>${esc(cur.label)} <span class="pill tone-good">Current</span></h3>
        <div class="sm-meta"><span>${esc(dates(cur))}</span>${cur.academic_year ? `<span>Academic year ${esc(cur.academic_year)}</span>` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-edit="${esc(cur.id)}">Edit name and dates</button>
        <a class="btn btn-ghost btn-sm" href="#/training">Training sessions</a><a class="btn btn-ghost btn-sm" href="#/guides">Guide roster</a></div></section>`
      : `<section class="sm-card">${emptyState({ title: 'No semester is current', text: 'The tracker and training need to know which semester this is. Start one below.', icon: 'schedule' })}</section>`}
    <section class="sm-card"><h3>Start a new semester</h3>
      <p class="muted" style="font-size:.88rem;margin-bottom:12px">A guided checklist: new dates, who is returning and who is leaving, new hires, role changes and training dates.
        You see exactly what will change before anything does, and nothing is ever deleted.</p>
      <button class="btn btn-primary" id="sm-start">Start the next semester</button></section>
    <section class="sm-card"><h3>All semesters</h3>
      ${terms.length ? `<div class="sm-list" style="max-height:none">${terms.map(t => `<div class="sm-li"><b>${esc(t.label)}</b><em>${esc(dates(t))}</em>
        ${t.is_current ? '<span class="pill tone-good">Current</span>' : ''}<button class="btn btn-quiet btn-sm" data-edit="${esc(t.id)}">Edit</button></div>`).join('')}</div>`
        : '<p class="muted">None yet.</p>'}
      <p class="sm-keep" style="margin-top:8px">Past semesters stay readable: their evaluations, attendance and announcements are never removed.</p></section>`;
}

/* --------------------------------------------------------------- wizard */
function nav(back = true, next = 'Continue') {
  return `<div class="sm-nav">${back ? '<button class="btn btn-ghost" data-wiz="back">Back</button>' : '<button class="btn btn-ghost" data-wiz="cancel">Cancel</button>'}
    <button class="btn btn-primary" data-wiz="next">${next}</button></div>`;
}

function stepSemester() {
  const w = wiz, id = termIdOf(w);
  return `<h3>When is the new semester?</h3>
    <div class="sm-grid">
      <label class="field"><span>Season</span><select class="select" data-f="season">${SEASONS.map(s => `<option${s === w.season ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field"><span>Year</span><input type="number" data-f="year" value="${w.year}" min="2020" max="2100"></label>
      <label class="field"><span>First day</span><input type="date" data-f="starts" value="${esc(w.starts)}"></label>
      <label class="field"><span>Last day</span><input type="date" data-f="ends" value="${esc(w.ends)}"></label></div>
    <p class="muted" style="margin-top:10px;font-size:.86rem">This will be called <strong>${esc(w.season)} ${w.year}</strong> (academic year ${esc(academicYear(w))}).
      ${terms.some(t => t.id === id) ? 'A semester with this name already exists; its dates will be updated.' : ''}</p>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:.9rem"><input type="checkbox" data-f="promote" ${w.promote ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)">
      Move returning guides up one evaluation priority tier</label>${nav(false)}`;
}

function stepGuides() {
  const w = wiz, q = w.gSearch.toLowerCase();
  const rows = activeGuides.filter(g => !q || g.full_name.toLowerCase().includes(q));
  return `<h3>Which guides are leaving?</h3>
    <p class="muted" style="font-size:.86rem">Tick anyone who has graduated or left. They are archived — their history is kept — and left off the new tracker. Everyone else carries over.</p>
    <input type="search" data-f="gSearch" placeholder="Search guides" value="${esc(w.gSearch)}" aria-label="Search guides">
    <div class="sm-list">${rows.length ? rows.map(g => `<label class="sm-li ${w.leavingGuides.has(g.id) ? 'is-leaving' : ''}"><input type="checkbox" data-leave-g="${esc(g.id)}" ${w.leavingGuides.has(g.id) ? 'checked' : ''}><b>${esc(g.full_name)}</b><em>${w.leavingGuides.has(g.id) ? 'leaving' : 'returning'}</em></label>`).join('')
      : `<div class="sm-li">${activeGuides.length ? 'No guide matches that search.' : 'There are no active guides yet. Add some under Admin → Guides, or paste new guides below.'}</div>`}</div>
    <p style="font-size:.86rem"><strong>${w.leavingGuides.size}</strong> leaving · <strong>${activeGuides.length - w.leavingGuides.size}</strong> returning</p>
    <label class="field" style="margin-top:10px"><span>New guides joining (optional) — one per line: first name, last name, email</span>
      <textarea data-f="newGuides" rows="4" placeholder="Jane, Boilermaker, jane@purdue.edu">${esc(w.newGuides)}</textarea></label>${nav()}`;
}

function stepCommittee() {
  const w = wiz, me = (state.me?.email || '').toLowerCase();
  return `<h3>The committee</h3>
    <p class="muted" style="font-size:.86rem">Change anyone's role, or tick them as leaving. Leavers are archived and lose access; nothing they did is removed.</p>
    <div class="sm-list">${activePeople.map(p => {
      const self = (p.email || '').toLowerCase() === me, leaving = w.leavingPeople.has(p.email.toLowerCase());
      return `<div class="sm-li ${leaving ? 'is-leaving' : ''}"><b>${esc(p.full_name)}<br><em>${esc(p.email)}</em></b>
        <select class="select" data-role-for="${esc(p.email.toLowerCase())}" aria-label="Role for ${esc(p.full_name)}" ${leaving ? 'disabled' : ''}>
          ${roleList.map(r => `<option${(w.roleChanges[p.email.toLowerCase()] || p.role) === r.name ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <label style="display:flex;gap:6px;align-items:center;font-size:.8rem"><input type="checkbox" data-leave-p="${esc(p.email.toLowerCase())}" ${leaving ? 'checked' : ''} ${self ? 'disabled title="You cannot remove yourself"' : ''}> Leaving</label></div>`;
    }).join('')}</div>
    <h4 style="margin:14px 0 6px;font-size:.92rem">New hires</h4>
    ${w.newPeople.map((p, i) => `<div class="sm-row"><label class="field"><span>Name</span><input data-np="${i}" data-k="name" value="${esc(p.name)}"></label>
      <label class="field"><span>Purdue email</span><input data-np="${i}" data-k="email" type="email" value="${esc(p.email)}"></label>
      <label class="field"><span>Role</span><select class="select" data-np="${i}" data-k="role">${roleList.map(r => `<option${p.role === r.name ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <button class="btn btn-quiet btn-sm" data-np-del="${i}" aria-label="Remove this row">✕</button></div>`).join('')}
    <button class="btn btn-ghost btn-sm" data-wiz="addperson">Add a new hire</button>${nav()}`;
}

const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const labelFor = iso => { const d = new Date(iso + 'T12:00:00'); return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}`; };

function stepTraining() {
  const w = wiz;
  return `<h3>Training sessions</h3>
    <label class="toggle-row" style="margin:6px 0"><input type="checkbox" data-f="copyTraining" ${w.copyTraining ? 'checked' : ''}> Copy ${esc(termLabel())}’s training setup into the new semester</label>
    <p class="muted" style="font-size:.84rem;margin:0 0 6px 26px">Requirements, who they apply to, and their materials. Attendance, completion and missed-training history are never copied — they stay with ${esc(termLabel())}.</p>
    ${w.copyTraining ? `<div class="sm-grid" style="margin:0 0 12px 26px"><label class="field"><span>Move deadlines and dates by (days)</span><input type="number" data-f="shiftDays" value="${w.shiftDays}"></label>
      <label class="toggle-row" style="align-self:end"><input type="checkbox" data-f="copySessions" ${w.copySessions ? 'checked' : ''}> Also copy sessions as drafts</label></div>` : ''}
    <p class="muted" style="font-size:.86rem">Optional extra sessions. Each is created with a blank attendance row for every guide.</p>
    ${w.sessions.length ? w.sessions.map((s, i) => `<div class="sm-row" style="grid-template-columns:1.4fr 1fr auto"><label class="field"><span>Name</span><input data-ss="${i}" data-k="label" value="${esc(s.label)}"></label>
      <label class="field"><span>Date</span><input type="date" data-ss="${i}" data-k="held_on" value="${esc(s.held_on)}"></label>
      <button class="btn btn-quiet btn-sm" data-ss-del="${i}" aria-label="Remove this session">✕</button></div>`).join('')
      : emptyState({ title: 'No training sessions yet', text: 'Add them one at a time, or generate a weekly series. You can also add them later under Training.', icon: 'training' })}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-ghost btn-sm" data-wiz="addsession">Add a session</button>
      <button class="btn btn-ghost btn-sm" data-wiz="weekly">Generate weekly sessions…</button></div>${nav()}`;
}

function parseNewGuides() {
  return wiz.newGuides.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [first, last, email, priority] = l.split(',').map(x => x.trim());
    return { first, last, email: email || null, priority: priority || null };
  });
}

const payload = apply => ({
  p_to: termIdOf(wiz), p_label: `${wiz.season} ${wiz.year}`, p_year: academicYear(wiz), p_starts: wiz.starts || null, p_ends: wiz.ends || null,
  p_leaving_guides: [...wiz.leavingGuides], p_leaving_people: [...wiz.leavingPeople], p_promote: wiz.promote,
  p_sessions: wiz.sessions.filter(s => s.label.trim()),
  p_role_changes: Object.entries(wiz.roleChanges).filter(([e]) => !wiz.leavingPeople.has(e)).map(([email, role]) => ({ email, role })),
  p_new_people: wiz.newPeople.filter(p => p.name || p.email), p_new_guides: parseNewGuides(), p_apply: apply
});

function stepReview() {
  const p = wiz.preview;
  if (!p) return '<p class="muted">Checking what will happen…</p>';
  return `<h3>Here is exactly what will happen</h3>
    <p class="muted" style="font-size:.86rem">Nothing has been changed yet. This is a rehearsal of the real thing.</p>
    <div class="sm-sum">
      <div><span>New semester</span><b>${esc(wiz.season)} ${wiz.year}${p.new_term ? '' : ' (updating dates)'}</b></div>
      <div><span>Guides carrying over</span><b>${p.guides_carried}</b></div>
      <div><span>…moved up a priority tier</span><b>${p.guides_promoted}</b></div>
      <div><span>New guides joining</span><b>${p.new_guides}</b></div>
      <div><span>Guides archived (leaving)</span><b>${p.guides_archived}</b></div>
      <div><span>Committee members archived</span><b>${p.people_archived}</b></div>
      <div><span>New hires invited</span><b>${p.new_people}</b></div>
      <div><span>Role changes</span><b>${p.role_changes}</b></div>
      <div><span>Training sessions created</span><b>${p.sessions}</b></div></div>
    ${(p.warnings || []).map(w => `<div class="sm-warn">${esc(w)}</div>`).join('')}
    <p class="sm-keep"><strong>Not touched:</strong></p>
    <ul class="sm-keep"><li>Evaluations, attendance, interview scores and announcements from ${esc(termLabel())} stay exactly where they are.</li>
      <li>The tour schedule and Tour Guides by Major sheet are connected under Admin → Data Sources. After starting, connect this semester’s sheets there, review any unmatched people, and run Auto-match on the Evaluation Roster.</li></ul>${nav(true, 'Looks right — continue')}`;
}

function stepStart() {
  return `<h3>Ready to start ${esc(wiz.season)} ${wiz.year}?</h3>
    <p class="muted" style="font-size:.9rem">${esc(wiz.season)} ${wiz.year} becomes the current semester for everyone the next time they open the hub. This cannot be run twice,
      and the changes you reviewed are recorded in the audit log. To undo individual changes afterwards you can restore archived people and guides.</p>
    <label class="field" style="max-width:260px"><span>Type <b>START</b> to confirm</span><input data-f="typed" value="${esc(wiz.typed)}" autocomplete="off"></label>
    <div class="sm-nav"><button class="btn btn-ghost" data-wiz="back">Back</button><button class="btn btn-primary" data-wiz="go" ${wiz.typed.trim().toUpperCase() === 'START' ? '' : 'disabled'}>Start the semester</button></div>`;
}

function paintWizard(view) {
  const body = [stepSemester, stepGuides, stepCommittee, stepTraining, stepReview, stepStart][wiz.step]();
  view.innerHTML = `<section class="sm-card"><div class="sm-steps" aria-label="Progress">${STEPS.map((s, i) =>
    `<span class="sm-step ${i === wiz.step ? 'is-on' : i < wiz.step ? 'is-done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>${body}</section>`;
}

function validateStep(view) {
  const w = wiz;
  if (w.step === 0) {
    if (!w.starts || !w.ends) return 'Choose the first and last day of the semester.';
    if (w.ends <= w.starts) return 'The last day must be after the first day.';
    if (!Number.isInteger(Number(w.year)) || w.year < 2020) return 'Enter a four-digit year.';
    if (termIdOf(w) === termId()) return `${w.season} ${w.year} is already the current semester.`;
  }
  if (w.step === 2) {
    const bad = w.newPeople.find(p => (p.name || p.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || ''));
    if (bad) return `"${bad.name || bad.email}" needs a valid email address.`;
  }
  if (w.step === 1) {
    const lines = parseNewGuides();
    const bad = lines.find(g => !g.first || !g.last);
    if (bad) return 'Each new guide line needs a first and last name, separated by commas.';
  }
  return '';
}

let abort = null;

export default {
  id: 'semester', needs: 'admin', title: 'Semester', crumb: 'The current semester, and starting the next', icon: '🗓️', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); wiz = null; },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    wiz = null;
    await loadTerms();
    overview(view);
    admin('admin_health').catch(e => { if (e.setup) $('#sm-setup').innerHTML = setupNotice(); });

    const err = msg => { let el = $('.sm-error', view); if (!el) { el = document.createElement('p'); el.className = 'form-error sm-error'; view.querySelector('.sm-card').append(el); } el.textContent = msg; el.hidden = !msg; };

    const go = async n => {
      const problem = n > wiz.step ? validateStep(view) : '';
      if (problem) return err(problem);
      wiz.step = Math.max(0, n);
      if (wiz.step === 4) {                      // review: rehearse the real run
        wiz.preview = null; paintWizard(view);
        try { wiz.preview = await admin('admin_start_semester', payload(false)); }
        catch (e) { wiz.step = 3; paintWizard(view); return err(e.message); }
      }
      paintWizard(view);
    };

    view.addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        const t = terms.find(x => x.id === edit.dataset.edit);
        const v = await formDialog({ title: `Edit ${t.label}`, submitLabel: 'Save', fields: [
          { name: 'label', label: 'Name', value: t.label, required: true }, { name: 'year', label: 'Academic year', value: t.academic_year || '', hint: 'For example 2026–27' },
          { name: 'starts', label: 'First day', type: 'date', value: t.starts_on || '' }, { name: 'ends', label: 'Last day', type: 'date', value: t.ends_on || '' }] });
        if (!v) return;
        try { await admin('admin_save_term', { p_id: t.id, p_label: v.label, p_year: v.year, p_starts: v.starts || null, p_ends: v.ends || null });
          await loadTerms(); overview(view); toast('Saved.'); refreshActions({ force: true }); } catch (x) { fail(x); }
        return;
      }
      if (e.target.closest('#sm-start')) {
        try { await loadWizardData(); } catch (x) { return fail(x); }
        wiz = freshWizard(); paintWizard(view); return;
      }
      const act = e.target.closest('[data-wiz]')?.dataset.wiz;
      if (!act || !wiz) {
        if (wiz) { const d = e.target.closest('[data-np-del],[data-ss-del]'); if (d) { if (d.dataset.npDel != null) wiz.newPeople.splice(+d.dataset.npDel, 1); else wiz.sessions.splice(+d.dataset.ssDel, 1); paintWizard(view); } }
        return;
      }
      if (act === 'cancel') { wiz = null; overview(view); return; }
      if (act === 'back') return go(wiz.step - 1);
      if (act === 'next') return go(wiz.step + 1);
      if (act === 'addperson') { wiz.newPeople.push({ name: '', email: '', role: roleList.find(r => !r.is_admin)?.name || roleList[0]?.name }); paintWizard(view); return; }
      if (act === 'addsession') { wiz.sessions.push({ label: '', held_on: '' }); paintWizard(view); return; }
      if (act === 'weekly') {
        const v = await formDialog({ title: 'Generate weekly sessions', submitLabel: 'Add sessions', fields: [
          { name: 'first', label: 'First session date', type: 'date', value: wiz.starts, required: true }, { name: 'count', label: 'How many weeks', type: 'number', value: '6', required: true }] });
        if (!v) return;
        const n = Math.min(20, Math.max(1, Number(v.count) || 0));
        for (let i = 0; i < n; i++) { const d = new Date(v.first + 'T12:00:00'); d.setDate(d.getDate() + 7 * i); const iso = d.toISOString().slice(0, 10); if (!wiz.sessions.some(s => s.held_on === iso)) wiz.sessions.push({ label: labelFor(iso), held_on: iso }); }
        paintWizard(view); return;
      }
      if (act === 'go') {
        const ok = await confirmDialog({ title: `Start ${wiz.season} ${wiz.year}?`, confirmLabel: 'Start semester', danger: true,
          lines: ['This switches the hub to the new semester for everyone.', 'It cannot be run a second time.'] });
        if (!ok) return;
        const btn = e.target.closest('button'); btn.disabled = true; btn.textContent = 'Starting…';
        try {
          const r = await admin('admin_start_semester', payload(true));
          let copied = null;
          if (wiz.copyTraining && r.from_term) { try { copied = await admin('admin_copy_training_setup', { p_from: r.from_term, p_to: termIdOf(wiz), p_opts: { shift_days: Number(wiz.shiftDays) || 0, sessions: !!wiz.copySessions, materials: true }, p_apply: true }); } catch (e) { copied = { error: e.message }; } }
          view.innerHTML = `<section class="sm-card">${emptyState({ title: `${wiz.season} ${wiz.year} has started`, icon: 'check',
            text: `${r.guides_carried} guides carried over, ${r.guides_archived} archived, ${r.sessions} training sessions created.${copied?.requirements != null ? ` Training setup copied: ${copied.requirements} requirement${copied.requirements === 1 ? '' : 's'}${copied.sessions ? `, ${copied.sessions} draft session${copied.sessions === 1 ? '' : 's'}` : ''} — review and update the dates.` : copied?.error ? ` The training setup could not be copied (${copied.error}); you can do it from Training → Requirements.` : ''}`,
            action: `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"><a class="btn btn-primary" href="#/sources">Connect this semester’s sheets</a><a class="btn btn-ghost" href="#/reconcile">Reconcile people</a><a class="btn btn-ghost" href="#/evalroster">Evaluation roster</a><a class="btn btn-ghost" href="#/trainhub?tab=requirements">Review training setup</a></div>` })}</section>`;
          wiz = null;
          // the shell reads the term once at sign-in; reloading it is the honest way to show the new one
          setTimeout(() => location.reload(), 2500);
        } catch (x) { fail(x); btn.disabled = false; btn.textContent = 'Start the semester'; }
      }
    }, { signal });

    view.addEventListener('input', e => {
      if (!wiz) return;
      const t = e.target;
      if (t.dataset.f) { const k = t.dataset.f; wiz[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
        if (k === 'gSearch' || k === 'typed' || k === 'newGuides') { if (k === 'typed') $('[data-wiz=go]', view).disabled = t.value.trim().toUpperCase() !== 'START'; if (k === 'gSearch') { const pos = t.selectionStart; paintWizard(view); const n = $('[data-f=gSearch]', view); n.focus(); n.setSelectionRange(pos, pos); } } }
      else if (t.dataset.np != null) wiz.newPeople[+t.dataset.np][t.dataset.k] = t.value;
      else if (t.dataset.ss != null) wiz.sessions[+t.dataset.ss][t.dataset.k] = t.value;
    }, { signal });

    view.addEventListener('change', e => {
      if (!wiz) return;
      const t = e.target;
      if (t.dataset.leaveG) { t.checked ? wiz.leavingGuides.add(t.dataset.leaveG) : wiz.leavingGuides.delete(t.dataset.leaveG); paintWizard(view); }
      else if (t.dataset.leaveP) { t.checked ? wiz.leavingPeople.add(t.dataset.leaveP) : wiz.leavingPeople.delete(t.dataset.leaveP); paintWizard(view); }
      else if (t.dataset.roleFor) { const p = activePeople.find(x => x.email.toLowerCase() === t.dataset.roleFor); if (t.value === p.role) delete wiz.roleChanges[t.dataset.roleFor]; else wiz.roleChanges[t.dataset.roleFor] = t.value; }
      else if (['season', 'year', 'promote', 'starts', 'ends', 'copyTraining'].includes(t.dataset.f)) paintWizard(view);
      else if (t.dataset.np != null && t.dataset.k === 'role') wiz.newPeople[+t.dataset.np].role = t.value;
    }, { signal });
  }
};
