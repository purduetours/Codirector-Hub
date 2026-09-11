/* ==================================================================== People
   Who can sign in to the hub, and what each of them is allowed to see.

   This exists so the job can be handed on. Until now, adding somebody meant
   opening Supabase and writing SQL, which is fine for whoever built the thing
   and hopeless for whoever inherits it. Everything on this screen is an
   ordinary form.

   How a person actually gets in, in two steps:

     1. You add them here. That writes them to the invite list, with the role
        you picked -- their name and their permissions, waiting for them.
     2. They make a password on the sign-in page. The moment they do, the
        database reads the invite list and hands them the name and role you set.

   Somebody who was never invited can still make a password, and it gets them
   nothing at all: the database marks an uninvited account inactive, and every
   permission check requires an active member. They sign in and see an empty
   hub. That is the protection, and it is in the database rather than in this
   page, so it holds however the page is changed.

   What this screen deliberately cannot do is delete somebody's login outright.
   That needs the secret admin key, which must never sit in a web page -- it
   would let anyone who viewed source read and destroy the whole database.
   Removing somebody here takes away everything they can see, which is the part
   that matters; erasing the login itself is a job for the Supabase dashboard.
============================================================================ */
import { select, insert, update, remove, upsert } from '../core/db.js';
import { state, isAdmin, myName } from '../core/state.js';
import { $, $$, esc, toast, showError, injectStyle, initials } from '../core/ui.js';

injectStyle('people-css', `
.pp-add { display:grid; grid-template-columns:1.4fr 1.6fr 1fr auto; gap:10px; align-items:end; }
@media (max-width:760px){ .pp-add { grid-template-columns:1fr; } }
.pp-row { display:flex; align-items:center; gap:12px; padding:11px 14px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-elev); margin-bottom:8px; }
.pp-av { width:34px; height:34px; border-radius:50%; flex:none; display:grid; place-items:center;
  background:var(--accent-soft); color:var(--accent); font-size:.74rem; font-weight:700; }
.pp-who { flex:1; min-width:0; }
.pp-who b { display:block; font-size:.9rem; font-weight:600; }
.pp-who em { display:block; font-style:normal; font-size:.75rem; color:var(--text-faint); margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pp-row select { flex:none; max-width:190px; }
.pp-state { font-size:.72rem; padding:3px 9px; border-radius:999px; flex:none; white-space:nowrap; }
.pp-state.in    { background:var(--good-bg);  color:var(--good); }
.pp-state.wait  { background:var(--warn-bg);  color:var(--warn); }
.pp-state.out   { background:var(--bg-sunken); color:var(--text-faint); }
.pp-row.is-out { opacity:.62; }
.pp-group { font-size:.76rem; font-weight:650; color:var(--text-faint); text-transform:uppercase;
  letter-spacing:.05em; margin:20px 0 9px; }
@media (max-width:560px){
  .pp-row { flex-wrap:wrap; }
  .pp-row select { max-width:none; width:100%; order:5; }
}
`);

/**
 * Can a person actually make a password right now?
 *
 * Worth checking rather than assuming, because the instruction on this page --
 * "they make a password on the sign-in page" -- is simply false when the
 * setting is off, and a new codirector following a false instruction has no
 * way of working out why it failed.
 *
 * Asked with an address that cannot exist, so nothing is created either way.
 * A refusal naming the setting means it is off; any other complaint (about the
 * address) means the door is open.
 */
async function signupsOpen() {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = window.CONFIG || {};
  try {
    const res = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x'.repeat(12) })
    });
    const d = await res.json().catch(() => ({}));
    return !(d.error_code === 'signup_disabled' || /signups not allowed/i.test(d.msg || ''));
  } catch {
    return null;                    // offline; say nothing rather than guess
  }
}

let roles = [];
let roster = [];      // the invite list
let members = [];     // people who have actually made a password

const byEmail = e => String(e || '').trim().toLowerCase();

async function load() {
  [roles, roster, members] = await Promise.all([
    select('roles', 'select=*&order=sort_order.asc'),
    select('member_roster', 'select=*&order=full_name.asc'),
    select('members', 'select=id,full_name,email,role,active&order=full_name.asc')
  ]);
}

/** One row per person, whether they have signed up yet or not. */
function everyone() {
  const seen = new Map();

  roster.forEach(r => seen.set(byEmail(r.email), {
    email: byEmail(r.email), name: r.full_name, role: r.role, invited: true, account: null
  }));

  members.forEach(m => {
    const k = byEmail(m.email);
    const row = seen.get(k) || { email: k, name: m.full_name, role: m.role, invited: false, account: null };
    row.account = m;
    row.name = m.full_name || row.name;
    seen.set(k, row);
  });

  const order = Object.fromEntries(roles.map((r, i) => [r.name, i]));
  return [...seen.values()].sort((a, b) =>
    (order[a.role] ?? 99) - (order[b.role] ?? 99) || String(a.name).localeCompare(String(b.name)));
}

function stateOf(p) {
  if (p.account && p.account.active) return { cls: 'in',   label: 'Signed in' };
  if (p.account && !p.account.active) return { cls: 'out',  label: 'No access' };
  return { cls: 'wait', label: 'Not signed up yet' };
}

function roleOptions(current) {
  return roles.map(r =>
    `<option value="${esc(r.name)}"${r.name === current ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
}

function row(p) {
  const st = stateOf(p);
  const me = byEmail(p.email) === byEmail(state.me?.email);
  return `<div class="pp-row ${st.cls === 'out' ? 'is-out' : ''}" data-email="${esc(p.email)}">
    <span class="pp-av">${esc(initials(p.name || p.email))}</span>
    <span class="pp-who">
      <b>${esc(p.name || '—')}${me ? ' <span class="muted" style="font-weight:400">(you)</span>' : ''}</b>
      <em>${esc(p.email)}</em>
    </span>
    <span class="pp-state ${st.cls}">${esc(st.label)}</span>
    <select class="select" data-act="role" aria-label="Role for ${esc(p.name || p.email)}"
      ${me ? 'disabled title="You cannot change your own role"' : ''}>${roleOptions(p.role)}</select>
    <button class="btn btn-quiet btn-sm" data-act="remove" ${me ? 'disabled' : ''}
      title="Take away their access">✕</button>
  </div>`;
}

function paint() {
  const people = everyone();
  const waiting = people.filter(p => !p.account).length;

  $('#pp-count').textContent =
    `${people.filter(p => p.account?.active).length} signed in` +
    (waiting ? ` · ${waiting} yet to make a password` : '');

  $('#pp-role').innerHTML = roleOptions('Training Committee');

  const groups = roles.map(r => ({
    name: r.name,
    rows: people.filter(p => p.role === r.name)
  })).filter(g => g.rows.length);

  const stray = people.filter(p => !roles.some(r => r.name === p.role));
  if (stray.length) groups.push({ name: 'No recognised role', rows: stray });

  $('#pp-list').innerHTML = groups.map(g =>
    `<div class="pp-group">${esc(g.name)}</div>${g.rows.map(row).join('')}`).join('');
}

export default {
  id: 'people',
  needs: 'admin',
  title: 'People',
  crumb: 'Who can sign in, and what they can see',
  icon: '🔑',
  section: 'Tools',

  async mount(view) {
    view.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <h2 style="font-size:.98rem;font-weight:650;margin-bottom:4px">Add someone</h2>
        <p class="muted" style="font-size:.82rem;margin-bottom:14px">
          They appear here straight away. To actually get in they press
          <strong>Make a password</strong> on the sign-in page, using this exact email address —
          then the hub already knows their name and what they are allowed to see.
        </p>
        <div class="callout" id="pp-signup" hidden style="margin-bottom:14px"></div>
        <form class="pp-add" id="pp-form">
          <label class="field"><span>Full name</span>
            <input id="pp-name" placeholder="Jane Boilermaker" required></label>
          <label class="field"><span>Purdue email</span>
            <input id="pp-email" type="email" placeholder="name@purdue.edu" required></label>
          <label class="field"><span>Role</span>
            <select id="pp-role" class="select"></select></label>
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
        <p class="form-error" id="pp-error" hidden style="margin-top:10px"></p>
      </div>

      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:2px">
        <h2 style="font-size:.98rem;font-weight:650">Everyone</h2>
        <span class="muted" style="font-size:.78rem" id="pp-count"></span>
      </div>
      <div id="pp-list"></div>`;

    await load();
    paint();

    signupsOpen().then(open => {
      if (open !== false) return;              // fine, or unknown: say nothing
      const box = $('#pp-signup');
      box.hidden = false;
      box.innerHTML =
        '<strong>Nobody can make a password at the moment.</strong><br>' +
        'You can still add people here, but the sign-in page will refuse them until this is ' +
        'switched on once, in Supabase: <em>Authentication → Sign In / Providers → ' +
        'Allow new users to sign up</em>.<br><br>' +
        'It is safe to switch on. Anyone who signs up without being added here lands with no ' +
        'access at all — the hub is empty for them until somebody on this page invites them.';
    });

    /* --- adding ---------------------------------------------------------- */
    $('#pp-form').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#pp-name').value.trim();
      const email = byEmail($('#pp-email').value);
      const role = $('#pp-role').value;
      const err = $('#pp-error');
      err.hidden = true;

      if (!name || !email) return;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return showError(err, 'That does not look like an email address.');
      }
      if (roster.some(r => byEmail(r.email) === email)) {
        return showError(err, `${email} is already on the list.`);
      }

      const btn = $('#pp-form button[type=submit]');
      btn.disabled = true;
      try {
        await upsert('member_roster', [{ email, full_name: name, role }], 'email');

        // Already has a password from a previous term? Switch them straight on.
        const existing = members.find(m => byEmail(m.email) === email);
        if (existing) await update('members', `id=eq.${existing.id}`, { role, active: true, full_name: name });

        await load();
        paint();
        $('#pp-name').value = '';
        $('#pp-email').value = '';
        toast(existing ? `${name} is back in.` : `${name} added — they can make a password now.`);
      } catch (e2) {
        showError(err, e2.message);
      }
      btn.disabled = false;
    });

    /* --- changing a role, and taking access away -------------------------- */
    $('#pp-list').addEventListener('change', async e => {
      const sel = e.target.closest('select[data-act="role"]');
      if (!sel) return;
      const email = sel.closest('.pp-row').dataset.email;
      const role = sel.value;
      sel.disabled = true;
      try {
        await update('member_roster', `email=eq.${encodeURIComponent(email)}`, { role });
        const m = members.find(x => byEmail(x.email) === email);
        if (m) await update('members', `id=eq.${m.id}`, { role });
        await load();
        paint();
        toast('Role changed.');
      } catch (err) {
        toast(err.message, 'err');
        sel.disabled = false;
      }
    });

    $('#pp-list').addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act="remove"]');
      if (!btn) return;
      const email = btn.closest('.pp-row').dataset.email;
      const person = everyone().find(p => p.email === email);
      if (!person) return;

      if (!confirm(
        `Take away ${person.name || email}'s access?\n\n` +
        `They will still be able to sign in, but the hub will be empty for them — ` +
        `no evals, no interviews, nothing.\n\n` +
        `You can add them back at any time.`)) return;

      btn.disabled = true;
      try {
        await remove('member_roster', `email=eq.${encodeURIComponent(email)}`);
        const m = members.find(x => byEmail(x.email) === email);
        if (m) await update('members', `id=eq.${m.id}`, { active: false });
        await load();
        paint();
        toast(`${person.name || email} no longer has access.`);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }
};
