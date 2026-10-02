/* ========================================================= Training: attendance
   Taking attendance in the room, on a phone, in a few seconds.

   Each expected person is a card with five large buttons — Present, Late,
   Excused, Absent, Makeup needed. "Mark everyone still blank as present" is one
   tap, so with 50 people in the room you only touch the exceptions. Nothing is
   saved until you press Save (one request for the whole room), and submitting
   closes the session out.

   Marking attendance IS updating completion: the database recomputes every
   requirement the session counts toward, so nobody records it twice. The older
   full-grid editor is still available (Classic grid) for anyone who prefers it.

   Spreadsheets can come in too: upload, preview, match each name to a canonical
   Tour Guide (remembered), validate, import.
============================================================================ */
import { select } from '../core/db.js';
import { $, esc, toast, injectStyle, prettyDate, debounce, todayISO } from '../core/ui.js';
import { readTable, pick } from '../core/csv.js';
import { confirmDialog } from '../core/dialog.js';
import { admin, emptyState, fail } from './admin-kit.js';
import { ATTENDANCE, attClass, whenText, SESSION_STATUS } from './train-data.js';
import { matchIdentity, indexMappings, nameKey } from '../core/identity.js';

injectStyle('train-att-css', `
.at-head { display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between; margin-bottom:12px; }
.at-title b { font-size:1.1rem; display:block; } .at-title span { color:var(--text-soft); font-size:var(--fs-sm); }
.at-stats { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px; } .at-stats .chip { font-size:var(--fs-sm); padding:3px 11px; margin:0; }
.at-list { display:grid; gap:8px; padding-bottom:110px; }
.at-card { display:grid; gap:8px; padding:12px 14px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev); }
.at-card.is-changed { border-color:color-mix(in srgb, var(--pink) 55%, var(--line)); }
.at-name { font-weight:650; font-size:var(--fs-lg); display:flex; justify-content:space-between; gap:8px; align-items:baseline; } .at-name em { font-style:normal; font-size:var(--fs-xs); color:var(--text-faint); font-weight:500; }
.at-btns { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; }
.at-btn { font:inherit; font-size:var(--fs-sm); font-weight:650; min-height:44px; padding:6px 4px; border-radius:12px; border:1px solid var(--line); background:var(--bg-sunken); color:var(--text-soft); cursor:pointer; transition:background var(--dur-1), border-color var(--dur-1); }
.at-btn:hover { border-color:var(--line-strong); color:var(--text); }
.at-btn.on.good { background:var(--good-bg); color:var(--good); border-color:var(--good); } .at-btn.on.warn { background:var(--warn-bg); color:var(--warn); border-color:var(--warn); } .at-btn.on.mute { background:var(--mute-bg); color:var(--text); border-color:var(--line-strong); }
.at-bar { position:fixed; left:0; right:0; bottom:0; z-index:40; padding:10px 16px calc(10px + env(safe-area-inset-bottom)); display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; background:var(--bg-elev); border-top:1px solid var(--line-strong); box-shadow:0 -10px 30px rgba(0,0,0,.35); }
.at-bar b { font-size:var(--fs-md); } .at-bar span { color:var(--text-soft); font-size:var(--fs-sm); }
@media (min-width:861px){ .at-bar { left:var(--rail); } .at-btns { max-width:520px; } }
@media (max-width:520px){ .at-btns { grid-template-columns:repeat(3,1fr); } .at-btn { min-height:48px; } }
body.is-attendance .dock { display:none; }
`);

const ui = { session: '', q: '', chip: '', marks: new Map(), rows: [], loaded: '' };

function chooseDefault(d, wanted) {
  if (wanted && d.sessions.some(s => s.id === wanted)) return wanted;
  const t = todayISO(), live = d.sessions.filter(s => s.status !== 'draft' && s.status !== 'cancelled' && s.held_on);
  const today = live.find(s => s.held_on === t); if (today) return today.id;
  const past = live.filter(s => s.held_on < t).sort((a, b) => b.held_on.localeCompare(a.held_on)); if (past[0]) return past[0].id;
  return live[0]?.id || '';
}

async function loadRows(ctx) {
  let rows = await select('training_attendance', `select=id,guide_id,person_name,actual&session_id=eq.${ui.session}&order=person_name.asc`);
  if (!rows.length) { await admin('admin_seed_attendance', { p_session: ui.session }).catch(() => {}); rows = await select('training_attendance', `select=id,guide_id,person_name,actual&session_id=eq.${ui.session}&order=person_name.asc`); }
  ui.rows = rows.filter(r => r.guide_id); ui.loaded = ui.session; ui.marks = new Map();
}

const current = r => (ui.marks.has(r.guide_id) ? ui.marks.get(r.guide_id) : r.actual) || '';
const changes = () => ui.rows.filter(r => ui.marks.has(r.guide_id) && (ui.marks.get(r.guide_id) || '') !== (r.actual || ''));

function paint(ctx, host) {
  const s = ctx.data.sessions.find(x => x.id === ui.session);
  if (!s) { $('#at-body', host).innerHTML = emptyState({ title: 'No session to take attendance for', icon: 'training', text: 'Create a session first, then come back here on the day.' }); return; }
  const q = ui.q.trim().toLowerCase();
  const rows = ui.rows.filter(r => (!q || r.person_name.toLowerCase().includes(q)) && (ui.chip !== 'blank' || !current(r)) && (ui.chip !== 'absent' || attClass(current(r)) === 'absent' || attClass(current(r)) === 'excused'));
  const cnt = { present: 0, excused: 0, absent: 0, pending: 0 }; ui.rows.forEach(r => { cnt[attClass(current(r))]++; });
  $('#at-body', host).innerHTML = `
    <div class="at-head"><div class="at-title"><b>${esc(s.label)}</b><span>${esc(whenText(s))}${s.location ? ' · ' + esc(s.location) : ''} · ${esc(SESSION_STATUS[s.status])}${s.attendance_submitted_at ? ' · attendance submitted' : ''}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-allpresent>Mark everyone still blank as present</button><a class="btn btn-ghost btn-sm" href="#/training">Classic grid</a></div></div>
    <div class="at-stats"><span class="chip is-good">${cnt.present} present</span><span class="chip is-warn">${cnt.absent} absent</span><span class="chip is-mute">${cnt.excused} excused</span><span class="chip">${cnt.pending} not marked</span></div>
    <div class="gd-bar"><input id="at-q" type="search" placeholder="Find a name" aria-label="Find a name" value="${esc(ui.q)}"><button class="tab ${ui.chip === 'blank' ? 'is-active' : ''}" data-chip="blank">Not marked</button><button class="tab ${ui.chip === 'absent' ? 'is-active' : ''}" data-chip="absent">Absent / excused</button></div>
    ${ui.rows.length ? `<div class="at-list">${rows.map(r => { const cur = current(r), changed = ui.marks.has(r.guide_id) && (ui.marks.get(r.guide_id) || '') !== (r.actual || '');
      return `<div class="at-card ${changed ? 'is-changed' : ''}" data-g="${esc(r.guide_id)}"><div class="at-name">${esc(r.person_name)}<em>${cur ? '' : 'not marked'}</em></div>
        <div class="at-btns" role="group" aria-label="Attendance for ${esc(r.person_name)}">${ATTENDANCE.map(([val, label, tone]) => `<button type="button" class="at-btn ${cur === val || (val === 'Attended' && attClass(cur) === 'present' && cur !== 'Late') ? 'on ' + tone : ''}" data-set="${esc(val)}" aria-pressed="${cur === val}">${label}</button>`).join('')}</div></div>`; }).join('') || emptyState({ title: 'Nobody matches', icon: 'search', text: 'Clear the filter above.' })}</div>`
      : emptyState({ title: 'Nobody is expected at this session', icon: 'users', text: 'Approve it for a requirement (Requirements tab) so the right people appear, or add people from the People tab.' })}
    <details style="margin:8px 0 24px"><summary style="cursor:pointer;font-weight:650">Import attendance from a spreadsheet</summary><div id="at-import" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-import>Choose a CSV…</button> <span class="muted" style="font-size:.82rem">Columns: name (or email) and status. You see and match everything before anything is saved.</span></div></details>`;
  const n = changes().length;
  let bar = $('#at-bar'); if (!bar) { bar = document.createElement('div'); bar.id = 'at-bar'; bar.className = 'at-bar'; document.body.append(bar); document.body.classList.add('is-attendance'); }
  bar.innerHTML = `<span><b>${n}</b> unsaved change${n === 1 ? '' : 's'} · ${cnt.pending} not marked</span><span style="display:flex;gap:8px"><button class="btn btn-ghost" data-save ${n ? '' : 'disabled'}>Save</button><button class="btn btn-primary" data-submit>${n ? 'Save & submit attendance' : 'Submit attendance'}</button></span>`;
}

let barHandler = null;
export const leaveAttendance = () => {
  $('#at-bar')?.remove(); document.body.classList.remove('is-attendance');
  if (barHandler) { document.removeEventListener('click', barHandler); barHandler = null; }
};

async function save(ctx, host, submit) {
  const ch = changes();
  const blank = ui.rows.filter(r => !current(r)).length;
  if (submit) {
    const ok = await confirmDialog({ title: 'Submit attendance?', confirmLabel: 'Submit', lines: [blank ? `${blank} ${blank === 1 ? 'person is' : 'people are'} still not marked. They stay blank and are not counted as absent.` : 'Everyone is marked.', 'Submitting closes the session out. Completion updates for everyone.'] });
    if (!ok) return;
  }
  try {
    const r = await admin('admin_set_attendance', { p_session: ui.session, p_entries: ch.map(x => ({ guide_id: x.guide_id, status: ui.marks.get(x.guide_id) || null })), p_submit: !!submit });
    await ctx.reload(true); await loadRows(ctx); paint(ctx, host);
    toast(submit ? `Attendance submitted (${ch.length} saved).` : `Saved ${r.saved}.`);
  } catch (x) { fail(x); }
}

/* ------------------------------------------------------------- CSV import */
const STATUS_WORDS = [[/^(present|p|yes|y|attended|here|x|✓)$/i, 'Attended'], [/^(late|tardy)$/i, 'Late'], [/^(excused|e)$/i, 'Excused'], [/^(absent|a|no|n|missed)$/i, 'Absent'], [/^(makeup|make-?up needed|absent,? need makeup)$/i, 'Absent, Need Makeup']];
const toStatus = t => STATUS_WORDS.find(([re]) => re.test(String(t || '').trim()))?.[1] || '';

async function importCsv(ctx, host, file) {
  const box = $('#at-import', host);
  try {
    const { records } = readTable(await file.text());
    if (!records.length) throw new Error('That file has no rows. It needs a header line, then one person per line with a name (or email) and a status.');
    const guides = await select('guides', 'select=id,first_name,last_name,full_name,email,active&active=eq.true');
    const maps = indexMappings(await select('external_identity_mappings', 'select=external_key,source_kind,guide_id,ignored,confirmed').catch(() => []));
    const rows = records.map((r, i) => {
      const name = pick(r, 'name', 'fullname', 'person', 'tourguide', 'guide') || `${pick(r, 'firstname', 'first')} ${pick(r, 'lastname', 'last')}`.trim(), email = pick(r, 'email', 'purdueemail');
      const status = toStatus(pick(r, 'status', 'attendance', 'attended', 'present'));
      const m = matchIdentity({ name, email }, { kind: 'training_import', guides, mappings: maps });
      return { i: i + 1, name, email, status, raw: pick(r, 'status', 'attendance', 'attended', 'present'), match: m, guideId: m.guideId };
    });
    const draw = () => {
      const bad = rows.filter(r => !r.guideId || !r.status), ok = rows.length - bad.length;
      box.innerHTML = `<h4 style="font-size:.95rem;margin-bottom:4px">Check before importing</h4><p class="muted" style="font-size:.82rem">${ok} ready${bad.length ? `, <strong>${bad.length} need attention</strong>` : ''}. Nothing is saved yet.</p>
        <table class="pp-prev"><thead><tr><th>#</th><th>In the file</th><th>Matched to</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr class="${!r.guideId || !r.status ? 'bad' : ''}"><td>${r.i}</td><td>${esc(r.name || r.email)}</td>
          <td>${r.guideId ? esc(guides.find(g => g.id === r.guideId)?.full_name || '') + ` <span class="chip">${esc(r.match.basis || 'chosen')}</span>` : `<select class="select" data-m="${r.i}"><option value="">Choose a Tour Guide…</option>${(r.match.candidates || []).map(c => `<option value="${esc(c.id)}">★ ${esc(c.name)}</option>`).join('')}${guides.map(g => `<option value="${esc(g.id)}">${esc(g.full_name)}</option>`).join('')}</select>`}</td>
          <td>${r.status ? esc(r.status) : `<span class="st-error">“${esc(r.raw || '')}” is not a status</span>`}</td></tr>`).join('')}</tbody></table>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary" id="at-doimport" ${bad.length || !ok ? 'disabled' : ''}>Import ${ok}</button><button class="btn btn-ghost" id="at-cancel">Cancel</button></div>
        ${bad.length ? '<p class="muted" style="font-size:.8rem;margin-top:8px">Choose who each unmatched name is (it is remembered), and use statuses like Present, Late, Excused or Absent.</p>' : ''}`;
    };
    draw();
    box.onchange = async e => { const sel = e.target.closest('[data-m]'); if (!sel || !sel.value) return; const r = rows.find(x => x.i === +sel.dataset.m);
      try { await admin('admin_confirm_match', { p_kind: 'training_import', p_key: nameKey(r.name), p_guide: sel.value, p_name: r.name, p_email: r.email || null }); r.guideId = sel.value; r.match = { basis: 'confirmed', candidates: [] }; draw(); } catch (x) { fail(x); } };
    box.onclick = async e => {
      if (e.target.closest('#at-cancel')) { box.innerHTML = '<button class="btn btn-ghost btn-sm" data-import>Choose a CSV…</button>'; return; }
      if (e.target.closest('#at-doimport')) { try { const r = await admin('admin_set_attendance', { p_session: ui.session, p_entries: rows.map(x => ({ guide_id: x.guideId, status: x.status })), p_submit: false });
        await ctx.reload(true); await loadRows(ctx); paint(ctx, host); toast(`Imported ${r.saved}.`); } catch (x) { fail(x); } }
    };
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
}

export async function mountAttendance(host, ctx) {
  const d = ctx.data;
  ui.session = chooseDefault(d, ctx.params?.session || ui.session); ui.q = ''; ui.chip = ''; ui.marks = new Map(); ui.loaded = '';
  host.innerHTML = `<div class="gd-bar"><select id="at-session" class="select" aria-label="Session" style="flex:1;min-width:220px">${d.sessions.filter(s => s.status !== 'draft').map(s => `<option value="${esc(s.id)}"${s.id === ui.session ? ' selected' : ''}>${esc(s.label)} · ${esc(whenText(s))}${s.status === 'cancelled' ? ' (cancelled)' : ''}</option>`).join('')}</select></div><div id="at-body"></div>`;
  if (!d.sessions.length || !ui.session) { paint(ctx, host); return; }
  try { await loadRows(ctx); } catch (x) { fail(x); }
  paint(ctx, host);
  host.addEventListener('change', async e => {
    if (e.target.id === 'at-session') { if (changes().length && !await confirmDialog({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true, lines: ['You have marks that are not saved yet.'] })) { e.target.value = ui.session; return; }
      ui.session = e.target.value; await loadRows(ctx); paint(ctx, host); }
  });
  host.addEventListener('input', debounce(e => { if (e.target.id === 'at-q') { ui.q = e.target.value; paint(ctx, host); } }, 100));
  host.addEventListener('click', async e => {
    const set = e.target.closest('[data-set]');
    if (set) { const g = set.closest('[data-g]').dataset.g, row = ui.rows.find(r => r.guide_id === g), val = set.dataset.set;
      const cur = current(row); const same = cur === val || (val === 'Attended' && attClass(cur) === 'present' && cur !== 'Late');
      ui.marks.set(g, same ? '' : val); const y = window.scrollY; paint(ctx, host); window.scrollTo(0, y); return; }
    const chip = e.target.closest('[data-chip]'); if (chip) { ui.chip = ui.chip === chip.dataset.chip ? '' : chip.dataset.chip; return paint(ctx, host); }
    if (e.target.closest('[data-allpresent]')) { ui.rows.forEach(r => { if (!current(r)) ui.marks.set(r.guide_id, 'Attended'); }); return paint(ctx, host); }
    if (e.target.closest('[data-import]')) { const f = document.createElement('input'); f.type = 'file'; f.accept = '.csv,text/csv'; f.onchange = () => f.files[0] && importCsv(ctx, host, f.files[0]); f.click(); }
  });
  if (barHandler) document.removeEventListener('click', barHandler);
  barHandler = ev => { const b = ev.target.closest('#at-bar [data-save],#at-bar [data-submit]'); if (!b || !host.isConnected) return; save(ctx, host, b.hasAttribute('data-submit')); };
  document.addEventListener('click', barHandler);
}
