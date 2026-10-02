/* ================================================================== Settings
   Operational settings: the things that used to live in code or in the database
   by hand, now editable here. Each one has a sensible default, so leaving this
   page alone is always safe.

   Two kinds of configuration, deliberately kept apart:

     Operational   what this program does day to day — which spreadsheet holds
                   the tour schedule, how soon to warn about the semester
                   ending, who to contact. Editable here, safe to change.

     Infrastructure  API keys, passwords, the database address, the email
                   provider. These are secrets. They are NEVER shown or stored
                   here (the database refuses setting names that look like
                   secrets) and live only in Supabase, set up once by a
                   developer. See DEVELOPERS.md.
============================================================================ */
import { rpc } from '../core/db.js';
import { state, setting } from '../core/state.js';
import { $, esc, toast, injectStyle } from '../core/ui.js';
import { select } from '../core/db.js';
import { bustSheets } from '../core/sheets.js';
import { admin, setupNotice, fail } from './admin-kit.js';
import { refreshActions } from '../core/actioncenter.js';

injectStyle('settings-css', `
.st-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:18px; margin-bottom:14px; display:grid; gap:12px; }
.st-card h3 { font-size:1rem; } .st-card p.muted { font-size:.84rem; margin:0; }
.st-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
.st-note { font-size:.8rem; color:var(--text-faint); }
.st-secret { border-style:dashed; }
`);

/** Pull the id out of a Google Sheets link, or accept a bare id. */
export function sheetId(v) {
  const t = String(v || '').trim();
  const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(t);
  const id = m ? m[1] : t;
  return /^[a-zA-Z0-9_-]{20,}$/.test(id) ? id : '';
}

const SHEETS = [
  ['sheets.tours', 'Tour schedule workbook', 'Who is leading which tour, and the desk rota. One tab per month.'],
  ['sheets.absences', 'Training absence form responses', 'The Google Form responses people file before missing training.'],
  ['sheets.majors', 'Majors workbook', 'What each guide studies. Optional.']
];

let reminders = null, admins = [];

function paint(view) {
  const v = (k, d) => setting(k, d);
  view.innerHTML = `<div id="st-setup"></div>
  <form class="st-card" data-form="sheets"><h3>Shared spreadsheets</h3>
    <p class="muted">The hub reads these Google Sheets live. Paste the sheet's link (or its id). Each one must be shared so the hub can read it. Leave a box empty to use the built-in link.</p>
    ${SHEETS.map(([key, label, hint]) => `<label class="field"><span>${esc(label)}</span><input name="${key}" value="${esc(state.settings?.[key] || '')}" placeholder="Using the built-in link" autocomplete="off"><em>${esc(hint)}</em></label>`).join('')}
    <div><button class="btn btn-primary btn-sm" type="submit">Save links</button></div></form>

  <form class="st-card" data-form="alerts"><h3>Dashboard &amp; alerts</h3>
    <p class="muted">How the Action Center decides what deserves attention.</p>
    <div class="st-grid">
      <label class="field"><span>Show upcoming evaluations within (days)</span><input name="actions.horizonDays" type="number" min="1" max="30" value="${esc(v('actions.horizonDays', 7))}"></label>
      <label class="field"><span>Flag unclaimed guides in the top … priorities</span><input name="actions.urgentPriorityRank" type="number" min="1" max="6" value="${esc(v('actions.urgentPriorityRank', 2))}"></label>
      <label class="field"><span>Warn about the semester ending (days before)</span><input name="actions.semesterWarningDays" type="number" min="1" max="90" value="${esc(v('actions.semesterWarningDays', 14))}"></label></div>
    <div><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form>

  <form class="st-card" data-form="contact"><h3>Who to ask for help</h3>
    <p class="muted">Shown to everyone on the More page, so people know who to contact when something is wrong.</p>
    <div class="st-grid"><label class="field"><span>Name or role</span><input name="contact.name" maxlength="80" value="${esc(v('contact.name', ''))}" placeholder="The Codirectors"></label>
      <label class="field"><span>Email</span><input name="contact.email" type="email" maxlength="120" value="${esc(v('contact.email', ''))}" placeholder="tours@purdue.edu"></label></div>
    <div><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form>

  <form class="st-card" data-form="vanessa"><h3>Vanessa</h3>
    <p class="muted">Vanessa can help with administration in plain language. She uses the same checks as the screens and always asks before changing anything.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="adminActions" ${v('vanessa.adminActions', true) !== false ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)">
      Let her archive, restore and invite people and guides when I ask (“deactivate John”, “add Alex Kim, alex@purdue.edu”)</label>
    <div><button class="btn btn-primary btn-sm" type="submit">Save</button></div></form>

  <form class="st-card" data-form="reminders" id="st-rem"><h3>Tour reminders</h3>${remindersHtml()}</form>

  <section class="st-card st-secret"><h3>Not managed here</h3>
    <p class="muted">Passwords, API keys, the database address and the email provider are secrets. They are deliberately <strong>not</strong> shown or stored on this page.
      They were set up once in Supabase and almost never need to change. If one has to — for example after an email provider change — that is the one time a developer is needed (see DEVELOPERS.md).</p></section>`;
}

function remindersHtml() {
  if (!reminders || reminders.unavailable) return `<p class="muted">Reminders are not set up for this hub. A developer can enable them (see DEVELOPERS.md); until then this switch does nothing.</p>`;
  const r = reminders;
  return `<p class="muted">Email evaluators a reminder before the tour they claimed. Turning this on does not change who can see what.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="enabled" ${r.enabled ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)"> Send reminders</label>
    <div class="st-grid">
      <label class="field"><span>Hours before the tour</span><input name="hours" type="number" min="1" max="168" value="${esc(r.hours_before ?? 24)}"></label>
      <label class="field"><span>Send a copy to</span><select class="select" name="owner"><option value="">Choose a person</option>${admins.map(a => `<option value="${esc(a.id)}"${a.id === r.owner_id ? ' selected' : ''}>${esc(a.full_name)}</option>`).join('')}</select></label>
      <label class="field"><span>"From" email address</span><input name="from" type="email" value="${esc(r.from_email || '')}" placeholder="hub@yourdomain.edu"></label>
      <label class="field"><span>Hub web address</span><input name="url" value="${esc(r.hub_url || '')}" placeholder="https://…"></label></div>
    <p class="st-note">The email service itself (its account and key) is set up in Supabase and is not editable here.</p>
    <div><button class="btn btn-primary btn-sm" type="submit">Save reminder settings</button></div>`;
}

async function save(key, value) { await admin('admin_set_setting', { p_key: key, p_value: value }); state.settings[key] = value; }

export default {
  id: 'settings', needs: 'admin', title: 'Settings', crumb: 'Links, alerts and contact details', icon: '⚙️', section: 'Tools', quiet: true,

  async mount(view) {
    reminders = await admin('admin_get_reminders').catch(e => (e.setup ? { unavailable: true } : null));
    admins = await select('members', 'select=id,full_name&active=eq.true&order=full_name.asc').catch(() => []);
    paint(view);
    admin('admin_health').catch(e => { if (e.setup) $('#st-setup').innerHTML = setupNotice(); });

    view.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, kind = f.dataset.form, btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        if (kind === 'sheets') {
          for (const [key, label] of SHEETS) {
            const raw = f.elements[key].value.trim();
            if (raw && !sheetId(raw)) throw new Error(`${label}: that does not look like a Google Sheets link.`);
          }
          for (const [key] of SHEETS) await save(key, sheetId(f.elements[key].value) || null).catch(err => { throw err; });
          bustSheets(); toast('Links saved. The next page you open will use them.');
        } else if (kind === 'alerts') {
          for (const k of ['actions.horizonDays', 'actions.urgentPriorityRank', 'actions.semesterWarningDays']) {
            const n = Number(f.elements[k].value); if (!Number.isInteger(n) || n < 1) throw new Error('Those numbers must be whole numbers of at least 1.');
            await save(k, n);
          }
          toast('Saved.'); refreshActions({ force: true });
        } else if (kind === 'contact') {
          for (const k of ['contact.name', 'contact.email']) await save(k, f.elements[k].value.trim() || null);
          toast('Saved.');
        } else if (kind === 'vanessa') {
          await save('vanessa.adminActions', f.elements.adminActions.checked); toast('Saved.');
        } else if (kind === 'reminders') {
          await admin('admin_set_reminders', { p_enabled: f.elements.enabled.checked, p_hours: Number(f.elements.hours.value), p_owner: f.elements.owner.value || null,
            p_from: f.elements.from.value, p_url: f.elements.url.value });
          reminders = await admin('admin_get_reminders'); toast('Reminder settings saved.');
        }
      } catch (err) { fail(err); }
      btn.disabled = false;
    });
  }
};
