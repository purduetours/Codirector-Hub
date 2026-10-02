/* ============================================================== Data health
   Where the hub and the spreadsheets it reads disagree.

   Every problem listed here was found by hand during a single afternoon:
   forty guides missing from the majors sheet, one person spelled three
   different ways across three sources, an absence form offering a session the
   tracker does not have, and a typo — "November 2rd" — quietly making a
   submission match nothing.

   None of it was visible anywhere. Each was found by exporting two things and
   diffing them, which is not a process anybody will repeat, and certainly not
   one to hand to whoever inherits this. So the checks live here and run
   themselves.

   Everything is read-only, and everything is a QUESTION rather than a verdict.
   A guide missing from the majors sheet is not necessarily wrong — they may
   have joined last week. The page says what does not line up and leaves the
   judgement to a person.
============================================================================ */
import { ignoredAbsenceSession } from '../core/vanessa-makeup.js';
import { state, isAdmin } from '../core/state.js';
import { loadAbsences, loadMajors, loadTours } from '../core/sheets.js';
import { admin, setupNotice } from './admin-kit.js';
import { prettyDate } from '../core/ui.js';
import { matchPerson } from '../core/people-match.js';
import { loadRoster } from './evals.js';
import training, { trainingSources } from './training.js';
import { $, esc, injectStyle, toast } from '../core/ui.js';
import { downloadCsv } from '../core/csv.js';
import { go } from '../core/router.js';

injectStyle('health-css', `
.hz { display:grid; gap:12px; }
.hz-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:14px 16px; }
.hz-card.ok { opacity:.72; }
.hz-head { display:flex; align-items:baseline; gap:10px; margin-bottom:4px; }
.hz-mark { font-size:1rem; flex:none; }
.hz-title { font-weight:650; font-size:.92rem; flex:1; }
.hz-count { font-size:.75rem; color:var(--text-faint); flex:none; }
.hz-why { font-size:.82rem; color:var(--text-soft); margin-bottom:8px; }
.hz-items { display:flex; flex-wrap:wrap; gap:5px; }
.hz-item { font-size:.74rem; padding:2px 9px; border-radius:999px; background:var(--bg-sunken); color:var(--text-soft); }
.hz-item.warn { background:var(--warn-bg); color:var(--warn); }
.hz-more { font-size:.74rem; color:var(--text-faint); align-self:center; }
.hz-act { margin-top:9px; display:flex; gap:6px; flex-wrap:wrap; }
.hz-h { font-size:.78rem; font-weight:750; text-transform:uppercase; letter-spacing:.08em; color:var(--text-faint); margin:4px 0 10px; }
#hz-setup { margin-bottom:26px; }
.hz-mark { width:20px; text-align:center; font-weight:800; }
.hz-ok { color:var(--good); } .hz-warn { color:var(--warn); } .hz-bad { color:var(--danger); } .hz-info { color:var(--text-faint); }
`);

let checks = null;

/** Each check reports what it looked at, and what did not line up. */
async function runChecks() {
  const out = [];
  const guides = state.guides || [];
  const names = guides.map(g => g.name);

  /* --- majors sheet coverage ------------------------------------------- */
  try {
    const majors = await loadMajors();
    const matched = new Set();
    const unknown = [];
    for (const rec of majors) {
      const hit = matchPerson(rec.name, names);
      if (hit) matched.add(hit); else unknown.push(rec.name);
    }
    const missing = names.filter(n => !matched.has(n));
    out.push({
      title: 'Guides missing from the majors sheet',
      why: 'That workbook is maintained separately. A guide who is not on it shows no major anywhere in the hub.',
      items: missing, tone: 'warn', looked: `${names.length} guides`
    });
    out.push({
      title: 'Names on the majors sheet matching nobody',
      why: 'Usually somebody who has left the programme, but it can also be a spelling the matcher cannot resolve.',
      items: unknown, looked: `${majors.length} listed`
    });
  } catch {
    out.push({ title: 'Majors sheet could not be read', why: 'Check the workbook is still shared.', items: ['unreachable'], tone: 'warn' });
  }

  /* --- absence form vs the training tracker ----------------------------- */
  try {
    const absences = await loadAbsences();
    const src = trainingSources();
    if (src?.sessions?.length) {
      const people = [...new Set(src.attendance.map(a => a.person_name))];
      const known = new Set(src.sessions.map(s => sessionKey(s.label)));
      const noMatch = [], unknownSessions = new Set();

      for (const a of absences) {
        if (!matchPerson(a.name, people)) noMatch.push(a.name);
        a.sessions.forEach(x => { if (!known.has(sessionKey(x)) && !ignoredAbsenceSession(x)) unknownSessions.add(x); });
      }
      out.push({
        title: 'Absence submissions matching nobody on the tracker',
        why: 'These people have told you they will be away and the hub cannot show it against their name.',
        items: noMatch, tone: 'warn', looked: `${absences.length} submissions`
      });
      out.push({
        title: 'Sessions the form offers that the tracker does not have',
        why: 'The form and the tracker have drifted apart. Fixing the form removes the mismatch at the source.',
        items: [...unknownSessions], tone: 'warn', looked: `${src.sessions.length} sessions`
      });
    }
  } catch {
    out.push({ title: 'Absence form could not be read', why: 'Check the form responses sheet is still shared.', items: ['unreachable'], tone: 'warn' });
  }

  /* --- guides the schedule never mentions ------------------------------- */
  const noTours = guides.filter(g => !g.skip && !(g.tours || []).length).map(g => g.name);
  out.push({
    title: 'Guides with no upcoming tour on the schedule',
    why: 'An eval has to be scheduled by hand for these, because there is nothing to pick from.',
    items: noTours, looked: `${guides.length} guides`, goTo: 'evals'
  });

  return out;
}

const sessionKey = label =>
  String(label || '').toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/[^a-z0-9]/g, '');

function card(c) {
  const n = c.items.length;
  return `<div class="hz-card ${n ? '' : 'ok'}">
    <div class="hz-head">
      <span class="hz-mark">${n ? (c.tone === 'warn' ? '⚠️' : '•') : '✅'}</span>
      <span class="hz-title">${esc(c.title)}</span>
      <span class="hz-count">${n || 'none'}${c.looked ? ` of ${esc(c.looked)}` : ''}</span>
    </div>
    <div class="hz-why">${esc(c.why)}</div>
    ${n ? `<div class="hz-items">
      ${c.items.slice(0, 25).map(i => `<span class="hz-item ${c.tone === 'warn' ? 'warn' : ''}">${esc(i)}</span>`).join('')}
      ${n > 25 ? `<span class="hz-more">…and ${n - 25} more</span>` : ''}
    </div>` : ''}
  </div>`;
}

export default {
  id: 'health',
  needs: 'admin',
  title: 'Health',
  crumb: 'Is the hub set up and in good order?',
  icon: '🩺',
  section: 'Tools',

  async mount(view) {
    view.innerHTML = `<section id="hz-setup" class="hz-setup"><h3 class="hz-h">Setup check</h3><div class="hz" id="hz-setup-list"><div class="loading"><div class="spinner"></div></div></div></section>
      <section><h3 class="hz-h">Data check</h3><div id="hz-data"><div class="loading"><div class="spinner"></div><p>Checking the hub against its sources…</p></div></div></section>`;

    setupCheck().then(html => { const el = $('#hz-setup-list'); if (el) el.innerHTML = html; });

    if (!state.guides.length) await loadRoster();
    await training.prefetch?.();
    checks = await runChecks();

    const problems = checks.reduce((n, c) => n + c.items.length, 0);
    $('#hz-data').innerHTML = `
      <p class="muted" style="margin-bottom:14px">
        ${problems
          ? `${problems} thing${problems === 1 ? '' : 's'} do not line up between the hub and the spreadsheets. None of these is necessarily wrong — a guide who joined last week will not be on the majors sheet yet.`
          : 'Everything lines up with the spreadsheets.'}
      </p>
      <div class="hz">${checks.map(card).join('')}</div>
      <div class="hz-act"><button class="btn btn-ghost btn-sm" id="hz-export">Download this report</button></div>`;

    $('#hz-export').addEventListener('click', () => {
      const rows = [['Check', 'Item']];
      checks.forEach(c => c.items.forEach(i => rows.push([c.title, i])));
      toast(`Downloaded ${downloadCsv('data-health', rows)} findings.`);
    });
  }
};

/* --------------------------------------------------------------- setup check
   The same questions a developer would ask when handed a hub that "isn't
   working", answered in plain words with the next step. Raw errors never appear
   here: each failure says what it means for the program and what to do. */
async function setupCheck() {
  const rows = [];
  const add = (tone, title, text, link) => rows.push({ tone, title, text, link });
  let h = null;
  try { h = await admin('admin_health'); add('ok', 'Database connected', 'The hub can read and write its records.'); add('ok', 'Admin tools installed', 'The one-time database setup has been run.'); }
  catch (e) {
    if (e.setup) { add('ok', 'Database connected', 'The hub can read and write its records.');
      add('bad', 'Admin tools are not installed yet', 'A developer needs to run supabase/18-admin-operations.sql once in the Supabase SQL editor. Until then, adding guides, starting a semester and the audit log will not work. Everything else does.'); }
    else add('bad', 'The database could not be reached', 'Check your internet connection and refresh. If it keeps happening, the Supabase project may be paused — a developer can resume it from the Supabase dashboard.');
  }
  if (h) {
    const t = h.current_term;
    t ? add('ok', `Current semester: ${t.label}`, t.starts_on && t.ends_on ? `${prettyDate(t.starts_on)} – ${prettyDate(t.ends_on)}` : 'It has no dates yet — add them so the hub can remind you when it is ending.', '#/semester')
      : add('bad', 'No current semester', 'Start one so the tracker, training and reminders know which term this is.', '#/semester');
    h.current_terms > 1 && add('bad', 'More than one current semester', 'This should never happen. A developer should look at the terms table.');
    h.admins >= 2 ? add('ok', `${h.admins} administrators`, 'More than one person can run the hub.')
      : add(h.admins === 1 ? 'warn' : 'bad', h.admins === 1 ? 'Only one administrator' : 'No administrators', 'Give a second person the Codirector role so the hub is never locked out.', '#/people');
    h.people_bad_role ? add('bad', `${h.people_bad_role} people have an unrecognised role`, 'They cannot see anything until a valid role is chosen.', '#/people') : add('ok', 'Everyone has a valid role', '');
    h.guides_missing_eval ? add('warn', `${h.guides_missing_eval} guides are not on this semester's tracker`, 'Restore them through the Guides screen or archive them.', '#/guides') : add('ok', 'Every active guide is on the tracker', `${h.active_guides} active guides.`);
    h.training_sessions ? add('ok', `${h.training_sessions} training sessions this semester`, '', '#/training') : add('warn', 'No training sessions this semester', 'Create them under Training so attendance can be taken.', '#/training');
    h.pending_signups ? add('warn', `${h.pending_signups} ${h.pending_signups === 1 ? 'account signed' : 'accounts signed'} up without an invitation`, 'Add them under People if they belong.', '#/people?show=waiting') : null;
    add(h.reminders_enabled ? 'ok' : 'info', h.reminders_enabled ? 'Tour reminders are on' : 'Tour reminders are off', h.reminders_enabled ? '' : 'Optional. Turn them on under Settings.', '#/settings');
  }
  try { const t = await loadTours(); t.length ? add('ok', 'Tour schedule workbook reachable', `${t.length} tour rows found.`) : add('warn', 'Tour schedule workbook returned no tours', 'Check the link under Settings, and that this semester’s tabs exist.', '#/settings'); }
  catch { add('bad', 'Tour schedule workbook could not be read', 'Check that the Google Sheet is still shared and the link under Settings is right.', '#/settings'); }

  const mark = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
  return rows.map(r => `<div class="hz-card ${r.tone === 'ok' ? 'ok' : ''}"><div class="hz-head"><span class="hz-mark hz-${r.tone}">${mark[r.tone]}</span>
    <span class="hz-title">${esc(r.title)}</span>${r.link ? `<a class="hz-count" href="${esc(r.link)}">Open</a>` : ''}</div>${r.text ? `<div class="hz-why">${esc(r.text)}</div>` : ''}</div>`).join('');
}
