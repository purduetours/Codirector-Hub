/* ==================================================================== People
   Who can sign in to the hub, and what each of them is allowed to see.

   This is the screen a new codirector lives in, so it is built to be run
   without anybody opening Supabase:

     Accounts   add, find, change a role, archive and restore people, in bulk,
                and import or export the list as a CSV
     Roles      what each role grants, in plain words, and who holds it

   How a person gets in, in two steps:
     1. You add them here (their name, email and role go on the invite list).
     2. They press "Make a password" on the sign-in page with that same email.
        The database then hands them the name and role you chose.
   Somebody who was never invited can still make a password and sees an empty
   hub: every permission check requires an active member.

   Nobody is ever deleted. "Archive" removes access and keeps every record that
   points at the person — their evals, scores and attendance — intact, and
   "Restore" puts them back with their old role.

   The rules that matter are enforced by the database, not by this page (see
   supabase/18-admin-operations.sql): only administrators can use these
   functions, the last administrator cannot be removed or demoted, you cannot
   archive or demote yourself, and every change is written to the audit log.
   Until that file has been run, this screen falls back to the older direct
   writes for add / change role / archive, so nothing stops working.
============================================================================ */
import { select, insert, update, remove, upsert } from '../core/db.js';
import { state } from '../core/state.js';
import { $, $$, esc, toast, showError, injectStyle, initials, debounce } from '../core/ui.js';
import { downloadCsv, readTable, pick } from '../core/csv.js';
import { confirmDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, fail, hashParams } from './admin-kit.js';
import { refreshActions } from '../core/actioncenter.js';

injectStyle('people-css', `
.pp-tabs { display:flex; gap:6px; margin-bottom:16px; }
.pp-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
.pp-bar input[type=search] { flex:1 1 220px; min-width:0; }
.pp-bar .select { flex:none; width:auto; min-width:150px; }
.pp-bar input[type=search] { width:auto; }
.pp-add { display:grid; grid-template-columns:1.4fr 1.6fr 1fr auto; gap:10px; align-items:end; }
@media (max-width:760px){ .pp-add { grid-template-columns:1fr; } }
.pp-row { display:flex; align-items:center; gap:12px; padding:11px 14px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-elev); margin-bottom:8px; }
.pp-row input[type=checkbox] { width:17px; height:17px; flex:none; accent-color:var(--accent); }
.pp-av { width:34px; height:34px; border-radius:50%; flex:none; display:grid; place-items:center;
  background:var(--accent-soft); color:var(--pink-soft); font-size:.74rem; font-weight:700; }
.pp-who { flex:1; min-width:0; }
.pp-who b { display:block; font-size:.9rem; font-weight:600; }
.pp-who em { display:block; font-style:normal; font-size:.75rem; color:var(--text-faint); margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pp-row select { flex:none; max-width:190px; }
.pp-state { font-size:.72rem; padding:3px 9px; border-radius:999px; flex:none; white-space:nowrap; }
.pp-state.in    { background:var(--good-bg);  color:var(--good); }
.pp-state.wait  { background:var(--warn-bg);  color:var(--warn); }
.pp-state.out   { background:var(--bg-sunken); color:var(--text-faint); }
.pp-state.err   { background:var(--danger-bg); color:var(--danger); }
.pp-row.is-out { opacity:.7; }
.pp-sel { position:sticky; bottom:84px; z-index:5; display:flex; gap:10px; align-items:center; flex-wrap:wrap;
  padding:10px 14px; margin:10px 0; background:var(--bg-elev); border:1px solid var(--pink); border-radius:var(--radius);
  box-shadow:var(--shadow-md), var(--glow-sm); }
.pp-sel b { margin-right:auto; }
.pp-prev { width:100%; border-collapse:collapse; font-size:.82rem; margin:10px 0; }
.pp-prev th, .pp-prev td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
.pp-prev tr.bad td { background:var(--danger-bg); }
.pp-prev .st-new { color:var(--good); } .pp-prev .st-error { color:var(--danger); font-weight:650; }
.rl { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:16px; margin-bottom:12px; display:grid; gap:10px; }
.rl h3 { font-size:1rem; display:flex; gap:10px; align-items:baseline; }
.rl h3 span { font-size:.75rem; color:var(--text-faint); font-weight:500; }
.rl-flags { display:flex; gap:16px; flex-wrap:wrap; }
.rl-flags label { display:flex; gap:8px; align-items:center; font-size:.86rem; }
.rl-flags input { width:17px; height:17px; accent-color:var(--accent); }
.rl textarea { min-height:60px; }
.rl-gives { font-size:.84rem; color:var(--text-soft); margin:0; padding-left:18px; }
`);

/* Can a person actually make a password right now? The instruction on this page
   is false when Supabase has new sign-ups switched off, and a new administrator
   would have no way to work out why it failed — so ask, once, with an address
   that cannot exist (nothing is created either way). */
let signupsAnswer = null;
function signupsOpen() {
  if (!signupsAnswer) signupsAnswer = probeSignups().then(v => { if (v === null) signupsAnswer = null; return v; });
  return signupsAnswer;
}
async function probeSignups() {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = window.CONFIG || {};
  try {
    const res = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x'.repeat(12) }) });
    const d = await res.json().catch(() => ({}));
    return !(d.error_code === 'signup_disabled' || /signups not allowed/i.test(d.msg || ''));
  } catch { return null; }
}

let roles = [], roster = [], members = [];
let setupOk = true;                       // false until we learn the admin functions are missing
const ui = { tab: 'accounts', q: '', show: 'active', role: '', picked: new Set(), importing: null };

const byEmail = e => String(e || '').trim().toLowerCase();

async function load() {
  [roles, roster, members] = await Promise.all([
    select('roles', 'select=*&order=sort_order.asc'),
    select('member_roster', 'select=*&order=full_name.asc'),
    select('members', 'select=id,full_name,email,role,active,archived_at,archive_reason&order=full_name.asc')
      .catch(() => select('members', 'select=id,full_name,email,role,active&order=full_name.asc'))
  ]);
}

/** One row per person, whether they have signed up yet or not. */
function everyone() {
  const seen = new Map();
  roster.forEach(r => seen.set(byEmail(r.email), { email: byEmail(r.email), name: r.full_name, role: r.role, invited: true, account: null }));
  members.forEach(m => {
    const k = byEmail(m.email);
    const row = seen.get(k) || { email: k, name: m.full_name, role: m.role, invited: false, account: null };
    row.account = m; row.name = m.full_name || row.name; row.role = m.role || row.role;
    seen.set(k, row);
  });
  const order = Object.fromEntries(roles.map((r, i) => [r.name, i]));
  return [...seen.values()].sort((a, b) =>
    (order[a.role] ?? 99) - (order[b.role] ?? 99) || String(a.name).localeCompare(String(b.name)));
}

const stateOf = p =>
  p.account?.active ? 'active' : p.account ? 'archived' : 'waiting';
const LABEL = { active: ['in', 'Active'], waiting: ['wait', 'Not signed up yet'], archived: ['out', 'Archived'] };
const isAdminRole = name => !!roles.find(r => r.name === name)?.is_admin;

function roleOptions(current) {
  const known = roles.some(r => r.name === current);
  return (known ? '' : `<option value="${esc(current || '')}" selected>${esc(current || 'No role')} (not recognised)</option>`) +
    roles.map(r => `<option value="${esc(r.name)}"${r.name === current ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
}

function visible() {
  const q = ui.q.trim().toLowerCase();
  return everyone().filter(p => {
    const st = stateOf(p);
    if (ui.show !== 'all' && st !== ui.show) return false;
    if (ui.role && p.role !== ui.role) return false;
    return !q || `${p.name} ${p.email}`.toLowerCase().includes(q);
  });
}

function row(p) {
  const st = stateOf(p), [cls, label] = LABEL[st];
  const me = byEmail(p.email) === byEmail(state.me?.email);
  const bad = !roles.some(r => r.name === p.role);
  return `<div class="pp-row ${st === 'archived' ? 'is-out' : ''}" data-email="${esc(p.email)}">
    <input type="checkbox" data-pick aria-label="Select ${esc(p.name || p.email)}" ${ui.picked.has(p.email) ? 'checked' : ''} ${me ? 'disabled' : ''}>
    <span class="pp-av" aria-hidden="true">${esc(initials(p.name || p.email))}</span>
    <span class="pp-who"><b>${esc(p.name || '—')}${me ? ' <span class="muted" style="font-weight:400">(you)</span>' : ''}</b>
      <em>${esc(p.email)}${p.account?.archive_reason ? ` · ${esc(p.account.archive_reason)}` : ''}</em></span>
    <span class="pp-state ${bad ? 'err' : cls}">${bad ? 'Needs a role' : esc(label)}</span>
    <select class="select" data-act="role" aria-label="Role for ${esc(p.name || p.email)}"
      ${me || st === 'archived' ? 'disabled' : ''} ${me ? 'title="You cannot change your own role"' : ''}>${roleOptions(p.role)}</select>
    ${st === 'archived'
      ? `<button class="btn btn-ghost btn-sm" data-act="restore">Restore</button>`
      : `<button class="btn btn-quiet btn-sm" data-act="archive" ${me ? 'disabled' : ''}>${st === 'waiting' ? 'Cancel invite' : 'Archive'}</button>`}
  </div>`;
}

/* ------------------------------------------------------------- accounts */
function accountsHtml() {
  return `
  <details class="card" id="pp-addbox" style="margin-bottom:14px" ${everyone().length ? '' : 'open'}>
    <summary style="cursor:pointer;font-weight:650">Add someone</summary>
    <p class="muted" style="font-size:.82rem;margin:8px 0 12px">
      They appear here straight away. To get in they press <strong>Make a password</strong> on the sign-in page,
      using this exact email — then the hub already knows their name and what they may see.</p>
    <div class="callout" id="pp-signup" hidden style="margin-bottom:12px"></div>
    <form class="pp-add" id="pp-form">
      <label class="field"><span>Full name</span><input id="pp-name" placeholder="Jane Boilermaker" required></label>
      <label class="field"><span>Purdue email</span><input id="pp-email" type="email" placeholder="name@purdue.edu" required></label>
      <label class="field"><span>Role</span><select id="pp-role" class="select"></select></label>
      <button class="btn btn-primary" type="submit">Add</button>
    </form>
    <p class="form-error" id="pp-error" hidden style="margin-top:10px"></p>
  </details>

  <div class="pp-bar">
    <input id="pp-q" type="search" placeholder="Search name or email" aria-label="Search people" value="${esc(ui.q)}">
    <select id="pp-show" class="select" aria-label="Show">
      ${[['active', 'Active'], ['waiting', 'Not signed up yet'], ['archived', 'Archived'], ['all', 'Everyone']]
        .map(([v, l]) => `<option value="${v}"${ui.show === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <select id="pp-rolefilter" class="select" aria-label="Role">
      <option value="">All roles</option>${roles.map(r => `<option${ui.role === r.name ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" id="pp-import">Import CSV</button>
    <button class="btn btn-ghost btn-sm" id="pp-export">Export CSV</button>
  </div>

  <div id="pp-importbox"></div>
  <div id="pp-selbar"></div>
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 2px 8px">
    <label style="font-size:.8rem;color:var(--text-soft);display:flex;gap:8px;align-items:center">
      <input type="checkbox" id="pp-all" style="width:16px;height:16px;accent-color:var(--accent)"> Select all shown</label>
    <span class="muted" style="font-size:.78rem" id="pp-count"></span>
  </div>
  <div id="pp-list"></div>`;
}

function paintList() {
  const rows = visible();
  const all = everyone();
  const active = all.filter(p => stateOf(p) === 'active').length;
  const waiting = all.filter(p => stateOf(p) === 'waiting').length;
  $('#pp-count').textContent = `${rows.length} shown · ${active} active${waiting ? ` · ${waiting} yet to make a password` : ''}`;
  $('#pp-role').innerHTML = roleOptions('Training Committee');

  $('#pp-list').innerHTML = rows.length ? rows.map(row).join('')
    : emptyState(all.length
        ? { title: 'Nobody matches those filters', text: 'Try a different search, or switch the filter to Everyone.', icon: 'search' }
        : { title: `Nobody has been added for ${state.term?.label || 'this semester'} yet`,
            text: 'Add the committee here one at a time, or import a CSV with name, email and role columns.', icon: 'team' });

  const n = ui.picked.size;
  $('#pp-selbar').innerHTML = n ? `<div class="pp-sel"><b>${n} selected</b>
    <select id="pp-bulkrole" class="select" aria-label="Role for selected"><option value="">Change role to…</option>
      ${roles.map(r => `<option>${esc(r.name)}</option>`).join('')}</select>
    ${ui.show === 'archived' ? '<button class="btn btn-primary btn-sm" id="pp-bulkrestore">Restore selected</button>'
      : '<button class="btn btn-danger btn-sm" id="pp-bulkarchive">Archive selected</button>'}
    <button class="btn btn-quiet btn-sm" id="pp-bulkclear">Clear</button></div>` : '';
  $('#pp-all').checked = rows.length > 0 && rows.every(p => ui.picked.has(p.email));
}

async function refresh() { await load(); paintList(); refreshActions({ force: true }); }

/* ---- the writes. Each prefers the database function and falls back to the
        older direct writes only where the function does not exist yet. ----- */
async function saveFn(name, args, legacy) {
  try { return await admin(name, args); }
  catch (e) { if (e.setup && legacy) { setupOk = false; return legacy(); } throw e; }
}

const addPerson = (email, name, role) => saveFn('admin_save_person', { p_email: email, p_name: name, p_role: role }, async () => {
  await upsert('member_roster', [{ email, full_name: name, role }], 'email');
  const m = members.find(x => byEmail(x.email) === email);
  if (m) await update('members', `id=eq.${m.id}`, { role, active: true, full_name: name });
  return { result: m ? 'restored' : 'added' };
});

const changeRole = (email, role) => saveFn('admin_change_role', { p_email: email, p_role: role }, async () => {
  await update('member_roster', `email=eq.${encodeURIComponent(email)}`, { role });
  const m = members.find(x => byEmail(x.email) === email);
  if (m) await update('members', `id=eq.${m.id}`, { role });
});

const archive = (emails, reason) => saveFn('admin_archive_people', { p_emails: emails, p_reason: reason || null }, async () => {
  for (const email of emails) {
    await remove('member_roster', `email=eq.${encodeURIComponent(email)}`);
    const m = members.find(x => byEmail(x.email) === email);
    if (m) await update('members', `id=eq.${m.id}`, { active: false });
  }
});

/* ---------------------------------------------------------------- import */
function importHtml(res) {
  const rows = res.rows || [];
  return `<div class="card" style="margin-bottom:14px">
    <h3 style="font-size:.95rem;margin-bottom:4px">Check before importing</h3>
    <p class="muted" style="font-size:.82rem">${res.ok} row${res.ok === 1 ? '' : 's'} are fine${res.errors ? `, <strong>${res.errors} need fixing</strong>` : ''}.
      Nothing has been saved yet.</p>
    <table class="pp-prev"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>What will happen</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.status === 'error' ? 'bad' : ''}"><td>${r.row}</td><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.role)}</td>
        <td class="st-${esc(r.status)}">${esc(r.message || '')}</td></tr>`).join('')}</tbody></table>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" id="pp-doimport" ${res.errors || !res.ok ? 'disabled' : ''}>Import ${res.ok} ${res.ok === 1 ? 'person' : 'people'}</button>
      <button class="btn btn-ghost" id="pp-cancelimport">Cancel</button></div>
    ${res.errors ? '<p class="muted" style="font-size:.8rem;margin-top:8px">Fix the highlighted rows in your file and choose it again. Roles must match exactly: ' + roles.map(r => esc(r.name)).join(', ') + '.</p>' : ''}
  </div>`;
}

async function startImport(file) {
  const box = $('#pp-importbox');
  try {
    const { records } = readTable(await file.text());
    const rows = records.map(r => ({
      name: pick(r, 'fullname', 'name', 'person'),
      email: pick(r, 'email', 'purdueemail', 'emailaddress'),
      role: pick(r, 'role', 'committee') || 'Training Committee'
    }));
    if (!rows.length) throw new Error('That file has no rows. It needs a header line, then one person per line, with name, email and role columns.');
    ui.importing = rows;
    box.innerHTML = importHtml(await admin('admin_import_people', { p_rows: rows, p_apply: false }));
  } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
}

/* ------------------------------------------------------------------ roles */
function plainGrants(r) {
  const g = ['Read the tour schedule and announcements'];
  if (r.in_training) g.push('Claim and write tour guide evaluations; see Desk Coverage and the Guide Directory');
  if (r.in_recruitment) g.push('Check in and grade interview candidates');
  if (r.is_admin) g.push('Everything above, plus Training, People, Guides, Semester, Settings, Audit and Health');
  return g;
}

function rolesHtml() {
  const people = everyone();
  return `<p class="muted" style="font-size:.86rem;margin-bottom:14px">A role decides which tools a person sees <em>and</em> what the database lets them read.
    Change someone's role from the Accounts tab. The switches below change what a role grants, so they ask you to confirm.</p>
    ${roles.map(r => {
      const n = people.filter(p => p.role === r.name && stateOf(p) === 'active').length;
      return `<form class="rl" data-role="${esc(r.name)}">
        <h3>${esc(r.name)} <span>${n} active ${n === 1 ? 'person' : 'people'}</span></h3>
        <label class="field"><span>Description (shown to administrators)</span>
          <textarea name="desc" maxlength="300" placeholder="Who holds this role and what they are responsible for">${esc(r.description || '')}</textarea></label>
        <div class="rl-flags">
          <label><input type="checkbox" name="training" ${r.in_training ? 'checked' : ''}> Training tools</label>
          <label><input type="checkbox" name="recruit" ${r.in_recruitment ? 'checked' : ''}> Recruitment tools</label>
          <label><input type="checkbox" name="admin" ${r.is_admin ? 'checked' : ''}> Administrator</label>
        </div>
        <ul class="rl-gives">${plainGrants(r).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div><button class="btn btn-ghost btn-sm" type="submit">Save ${esc(r.name)}</button></div></form>`;
    }).join('')}`;
}

async function saveRole(form) {
  const name = form.dataset.role, r = roles.find(x => x.name === name);
  const next = { in_training: form.training.checked, in_recruitment: form.recruit.checked, is_admin: form.admin.checked };
  const widened = (next.is_admin && !r.is_admin) || (next.in_training && !r.in_training) || (next.in_recruitment && !r.in_recruitment);
  const narrowed = (!next.is_admin && r.is_admin) || (!next.in_training && r.in_training) || (!next.in_recruitment && r.in_recruitment);
  if (widened || narrowed) {
    const holders = everyone().filter(p => p.role === name && stateOf(p) === 'active').length;
    const ok = await confirmDialog({
      title: `Change what ${name} can do?`,
      lines: [
        `${holders} active ${holders === 1 ? 'person holds' : 'people hold'} this role and will see the change next time they open the hub.`,
        next.is_admin && !r.is_admin ? 'Administrator access lets them change everyone else’s access. Only grant it to people you would trust with that.' : '',
        narrowed ? 'Removing access takes effect immediately on the server.' : ''
      ].filter(Boolean),
      confirmLabel: 'Save changes', danger: next.is_admin !== r.is_admin
    });
    if (!ok) return;
  }
  await admin('admin_update_role', { p_name: name, p_description: form.desc.value, p_in_training: next.in_training,
    p_in_recruitment: next.in_recruitment, p_is_admin: next.is_admin });
  await load();
  toast(`${name} saved.`);
}

/* -------------------------------------------------------------- the page */
function paint() {
  $('#pp-body').innerHTML = ui.tab === 'accounts' ? accountsHtml() : rolesHtml();
  $$('.pp-tabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === ui.tab));
  $$('.pp-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
  if (ui.tab === 'accounts') paintList();
}

let abort = null;

export default {
  id: 'people',
  needs: 'admin',
  title: 'People',
  crumb: 'Committee accounts, roles and access',
  icon: '🔑',
  section: 'Tools',

  unmount() { abort?.abort(); },

  async mount(view) {
    abort?.abort(); abort = new AbortController();
    const signal = abort.signal;
    const params = hashParams();
    ui.tab = 'accounts'; ui.q = ''; ui.role = ''; ui.picked = new Set(); ui.importing = null;
    ui.show = ['active', 'waiting', 'archived', 'all'].includes(params.show) ? params.show : 'active';

    view.innerHTML = `<div id="pp-setup"></div>
      <div class="tabs pp-tabs" role="tablist" aria-label="People sections">
        <button class="tab is-active" role="tab" data-tab="accounts">Accounts</button>
        <button class="tab" role="tab" data-tab="roles">Roles</button></div>
      <div id="pp-body"></div>`;

    await load();
    paint();
    signupsOpen().then(open => {
      const box = $('#pp-signup');
      if (open !== false || !box) return;
      box.hidden = false;
      box.innerHTML = '<strong>Nobody can make a password at the moment.</strong><br>You can still add people here, but the sign-in page will refuse them until this is switched on once, in Supabase: <em>Authentication → Sign In / Providers → Allow new users to sign up</em>. It is safe to switch on: anyone who signs up without being added here sees an empty hub.';
    });
    // Learn quietly whether the admin functions exist, so we can say so once.
    admin('admin_health').catch(e => { if (e.setup) { setupOk = false; $('#pp-setup').innerHTML = setupNotice(); } });

    view.addEventListener('click', async e => {
      const tab = e.target.closest('.pp-tabs [data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; paint(); return; }

      if (e.target.closest('#pp-import')) { const f = document.createElement('input'); f.type = 'file'; f.accept = '.csv,text/csv';
        f.onchange = () => f.files[0] && startImport(f.files[0]); f.click(); return; }
      if (e.target.closest('#pp-export')) {
        const n = downloadCsv('people', [['Name', 'Email', 'Role', 'Status'], ...everyone().map(p => [p.name, p.email, p.role, LABEL[stateOf(p)][1]])]);
        toast(`Exported ${n} people.`); return;
      }
      if (e.target.closest('#pp-cancelimport')) { $('#pp-importbox').innerHTML = ''; ui.importing = null; return; }
      if (e.target.closest('#pp-doimport')) {
        const btn = e.target.closest('button'); btn.disabled = true;
        try { const r = await admin('admin_import_people', { p_rows: ui.importing, p_apply: true });
          $('#pp-importbox').innerHTML = ''; ui.importing = null; await refresh(); toast(`Imported ${r.ok} people.`);
        } catch (err) { fail(err); btn.disabled = false; }
        return;
      }

      if (e.target.closest('#pp-bulkclear')) { ui.picked.clear(); paintList(); return; }
      if (e.target.closest('#pp-bulkarchive')) {
        const emails = [...ui.picked];
        const ok = await confirmDialog({ title: `Archive ${emails.length} ${emails.length === 1 ? 'person' : 'people'}?`, danger: true, confirmLabel: 'Archive',
          lines: ['They lose access to the hub right away.', 'Their past evaluations, scores and attendance are kept exactly as they are.', 'You can restore anyone later from the Archived filter.'] });
        if (!ok) return;
        try { const r = await archive(emails, 'Archived in bulk'); ui.picked.clear(); await refresh(); toast(`Archived ${r?.archived ?? emails.length}.`); } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('#pp-bulkrestore')) {
        try { const r = await admin('admin_restore_people', { p_emails: [...ui.picked] }); ui.picked.clear(); await refresh(); toast(`Restored ${r.restored}.`); } catch (err) { fail(err); }
        return;
      }

      const rowEl = e.target.closest('.pp-row'); const act = e.target.closest('[data-act]')?.dataset.act;
      if (!rowEl || !act || act === 'role') return;
      const email = rowEl.dataset.email, person = everyone().find(p => p.email === email);
      if (!person) return;
      const name = person.name || email;
      try {
        if (act === 'archive') {
          const waiting = stateOf(person) === 'waiting';
          const ok = await confirmDialog({ title: waiting ? `Cancel ${name}'s invitation?` : `Archive ${name}?`, danger: !waiting, confirmLabel: waiting ? 'Cancel invite' : 'Archive',
            lines: waiting ? ['They have not made a password yet. They will not be able to get in.']
              : ['They lose access to the hub right away.', 'Their past evaluations, scores and attendance are kept exactly as they are.', 'You can restore them at any time.'] });
          if (!ok) return;
          await archive([email]); await refresh(); toast(`${name} ${waiting ? 'is no longer invited' : 'archived'}.`);
        } else if (act === 'restore') {
          await admin('admin_restore_people', { p_emails: [email] }); await refresh(); toast(`${name} restored.`);
        }
      } catch (err) { fail(err); }
    }, { signal });

    view.addEventListener('change', async e => {
      const t = e.target;
      if (t.matches('[data-pick]')) { const em = t.closest('.pp-row').dataset.email; t.checked ? ui.picked.add(em) : ui.picked.delete(em); paintList(); return; }
      if (t.id === 'pp-all') { visible().forEach(p => { if (byEmail(p.email) !== byEmail(state.me?.email)) t.checked ? ui.picked.add(p.email) : ui.picked.delete(p.email); }); paintList(); return; }
      if (t.id === 'pp-show') { ui.show = t.value; ui.picked.clear(); paintList(); return; }
      if (t.id === 'pp-rolefilter') { ui.role = t.value; paintList(); return; }
      if (t.id === 'pp-bulkrole' && t.value) {
        const role = t.value, emails = [...ui.picked];
        const grants = isAdminRole(role);
        const ok = await confirmDialog({ title: `Change ${emails.length} ${emails.length === 1 ? 'person' : 'people'} to ${role}?`, danger: grants, confirmLabel: 'Change role',
          lines: [grants ? 'This role has administrator access — they will be able to change everyone’s access.' : 'They will see a different set of tools next time they open the hub.'] });
        if (!ok) { t.value = ''; return; }
        try { for (const em of emails) await changeRole(em, role); ui.picked.clear(); await refresh(); toast('Roles changed.'); } catch (err) { fail(err); await refresh(); }
        return;
      }
      if (t.matches('select[data-act="role"]')) {
        const email = t.closest('.pp-row').dataset.email, person = everyone().find(p => p.email === email), role = t.value;
        const sensitive = isAdminRole(role) || isAdminRole(person.role);
        if (sensitive) {
          const ok = await confirmDialog({ title: `Make ${person.name || email} ${role}?`, danger: true, confirmLabel: 'Change role',
            lines: [isAdminRole(role) ? 'This role has administrator access.' : `${person.role} has administrator access, and this takes it away.`, 'You can change it back at any time.'] });
          if (!ok) { t.value = person.role; return; }
        }
        t.disabled = true;
        try { await changeRole(email, role); await refresh(); toast('Role changed.'); } catch (err) { fail(err); await refresh(); }
      }
    }, { signal });

    view.addEventListener('input', debounce(e => { if (e.target.id === 'pp-q') { ui.q = e.target.value; paintList(); } }, 120), { signal });

    view.addEventListener('submit', async e => {
      e.preventDefault();
      if (e.target.id === 'pp-form') {
        const name = $('#pp-name').value.trim(), email = byEmail($('#pp-email').value), role = $('#pp-role').value, err = $('#pp-error');
        err.hidden = true;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showError(err, 'That does not look like an email address.');
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const r = await addPerson(email, name, role);
          await refresh(); $('#pp-name').value = ''; $('#pp-email').value = '';
          toast(r?.result === 'restored' ? `${name} is back in.` : `${name} added — they can make a password now.`);
        } catch (e2) { showError(err, e2.message); }
        btn.disabled = false;
      } else if (e.target.matches('.rl')) {
        try { await saveRole(e.target); paint(); } catch (err) { fail(err); }
      }
    }, { signal });
  }
};
