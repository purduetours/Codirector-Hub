/* ================================================================= Training
   Who turned up, and who has already said they will not.

   Two halves, deliberately different in kind:

   Attendance was a spreadsheet with a column pair per training date, growing
   sideways all term. It now lives in the database, one row per person per
   session, and is edited here — change a dropdown and it saves. Editing is a
   codirector job, same as the sheet was.

   Absences are the Google Form's own responses, read live and never copied.
   Nobody edits them here, they only ever grow, and a stale copy of who will be
   missing on Monday is worse than no copy at all.
============================================================================ */
import { select, update } from '../core/db.js';
import { loadAbsences } from '../core/sheets.js';
import { state, isAdmin } from '../core/state.js';
import { $, $$, esc, toast, injectStyle, prettyDate, debounce, SEARCH_ICON } from '../core/ui.js';

/* The sheet's own vocabulary, offered as dropdowns. Free text underneath, so a
   value that arrives from elsewhere still displays rather than vanishing. */
const EXPECTATION = ['Attendance Expected', 'Class/Exam', 'Club/ Student Org/ FSCL',
                     'Work/ Grad Things', 'Family Thing', 'Emergency/Sick'];
const ACTUAL      = ['Attended', 'Makeup Completed', 'Absent, Need Makeup'];

const TONE = a =>
  !a ? 'mute'
  : /^attended/i.test(a) ? 'good'
  : /^makeup completed/i.test(a) ? 'info'
  : /absent/i.test(a) ? 'warn' : 'mute';

injectStyle('tr-css', `
.tr-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); }
.tr-tbl { border-collapse:collapse; width:100%; font-size:.82rem; }
.tr-tbl th, .tr-tbl td { padding:7px 10px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
.tr-tbl thead th { position:sticky; top:0; background:var(--bg-sunken); z-index:2; font-size:.72rem;
  text-transform:uppercase; letter-spacing:.04em; color:var(--text-faint); }
.tr-tbl tbody th { position:sticky; left:0; background:var(--bg-elev); font-weight:600; z-index:1; }
.tr-tbl tbody tr:hover th, .tr-tbl tbody tr:hover td { background:var(--accent-soft); }
.tr-cell { display:flex; gap:4px; align-items:center; }
.tr-pill { font-size:.7rem; padding:2px 8px; border-radius:999px; }
.tr-pill.good { background:var(--good-bg); color:var(--good); }
.tr-pill.warn { background:var(--warn-bg); color:var(--warn); }
.tr-pill.info { background:var(--info-bg); color:var(--info); }
.tr-pill.mute { background:var(--mute-bg); color:var(--mute); }
.tr-sel { font:inherit; font-size:.75rem; padding:3px 4px; border:1px solid var(--line);
  border-radius:6px; background:var(--bg-elev); color:var(--text); max-width:150px; }
.tr-sel.dirty { border-color:var(--accent); }
/* The point of a grid is scanning it. Editors are dropdowns, which are all the
   same colour, so the status is carried by the control itself. */
.tr-sel.good { background:var(--good-bg); color:var(--good); border-color:transparent; }
.tr-sel.warn { background:var(--warn-bg); color:var(--warn); border-color:transparent; }
.tr-sel.info { background:var(--info-bg); color:var(--info); border-color:transparent; }
.tr-sel.mute { background:var(--mute-bg); color:var(--mute); border-color:transparent; }
.tr-sub { font-size:.7rem; color:var(--text-faint); font-weight:400; }
.tr-filed { color:var(--warn); cursor:help; border-bottom:1px dotted currentColor; }
.tr-guess { color:var(--warn); font-style:italic; cursor:help; }
.tr-abs { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev);
  padding:12px 14px; margin-bottom:9px; }
.tr-abs-top { display:flex; justify-content:space-between; gap:12px; align-items:baseline; margin-bottom:5px; }
.tr-abs-name { font-weight:650; font-size:.92rem; }
.tr-abs-when { font-size:.72rem; color:var(--text-faint); flex:none; }
.tr-abs-for { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:6px; }
.tr-abs-for span { font-size:.7rem; padding:2px 8px; border-radius:999px; background:var(--warn-bg); color:var(--warn); }
.tr-abs-why { font-size:.83rem; color:var(--text-soft); white-space:pre-wrap; }
`);


/* ------------------------------------------------ matching form to tracker
   The absence form is typed by hand, so the names in it rarely line up with
   the tracker. Real shapes it has to survive: a nickname and an initial where
   the tracker has the full name, a surname typed with one letter too many, and
   two letters transposed.

   The rule is surname-first, and that is not fussiness. This roster contains
   two people whose first names are both "Nicholas/Nick" with quite different
   surnames, and a looser matcher happily put a form response on the wrong one.
   Marking the wrong guide absent is worse than marking nobody.
   So the surname has to agree before a first name is even considered, and any
   name that could be two people is left unmatched and shown to you instead.
-------------------------------------------------------------------------- */
const nameParts = full => {
  const raw = String(full || '').toLowerCase();
  const nick = [...raw.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  const words = raw.replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  return { firsts: [...words.slice(0, -1), ...nick], last: words[words.length - 1] || '' };
};

/** One substitution, insertion or deletion apart. */
function within1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/* Note the last clause. "Nick" is NOT a prefix of "Nicholas" — they part
   company at the fourth letter, nich/nick — so prefix matching alone misses
   the commonest nickname there is. A shared three-letter stem catches it, and
   is only reached once the surname already agrees, so it cannot wander off to
   a different person. Two people who share a surname AND a stem come back
   ambiguous and are shown to you rather than guessed at. */
const firstFits = (a, b) =>
  a === b || within1(a, b) ||
  (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b)) ||
  (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3));

/** The one tracker name this form name means, or null if it is not certain. */
export function matchPerson(formName, trackerNames) {
  const f = nameParts(formName);
  if (!f.last) return null;

  const hits = trackerNames.filter(t => {
    const c = nameParts(t);
    const surnameOk = c.last === f.last || within1(c.last, f.last) ||
      // "Leo G" — an initial for a surname only counts when a first name is exact.
      (f.last.length <= 2 && c.last.startsWith(f.last) && c.firsts.some(x => f.firsts.includes(x)));
    if (!surnameOk) return false;
    return f.firsts.some(a => c.firsts.some(b => firstFits(a, b)));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** "November 2rd" and "November 2nd" are the same evening. */
export const sessionKey = label =>
  String(label || '').toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/[^a-z0-9]/g, '');

let sessions = null, attendance = null, absences = null;
const local = { tab: 'attendance', search: '', session: '' };

let loadError = null;

/* Tolerant on purpose. The tables arrive with a migration somebody has to run
   in Supabase, and until they do these reads 404. A tab that throws on mount
   would take the whole screen down and give no clue why, so a missing table is
   treated as "not set up yet" and says so. */
async function loadAll() {
  loadError = null;
  try {
    const [s, a] = await Promise.all([
      select('training_sessions',   'select=*&term_id=eq.fall-2026&order=sort_order.asc'),
      select('training_attendance', 'select=id,session_id,guide_id,person_name,expectation,actual')
    ]);
    sessions = s || [];
    attendance = a || [];
  } catch (err) {
    sessions = []; attendance = [];
    loadError = err?.message || 'Training data could not be loaded.';
  }
}

/* ---------------------------------------------------- filed absences
   Who has told us in advance that they will not be there.

   Read off the form every time this screen loads, matched to the tracker, and
   laid over the grid. Nothing is written: a form response is what somebody
   said they intend, an attendance record is what happened, and quietly turning
   the first into the second would overwrite a codirector's own marking the
   moment a student filed a late form. The grid shows both and lets you decide.
-------------------------------------------------------------------------- */
let filedIndex = null, filedUnmatched = [], filedUnknownSessions = [];

function indexFiled() {
  filedIndex = new Map();          // `${person}|${sessionKey}` -> reason
  filedUnmatched = [];
  const unknown = new Set();
  if (!absences || !sessions) return;

  const names = [...new Set(attendance.map(a => a.person_name))];
  const known = new Map(sessions.map(x => [sessionKey(x.label), x.label]));

  for (const a of absences) {
    const person = matchPerson(a.name, names);
    if (!person) { filedUnmatched.push(a.name); continue; }
    for (const raw of a.sessions) {
      const k = sessionKey(raw);
      if (!known.has(k)) { unknown.add(raw); continue; }
      filedIndex.set(`${person}|${k}`, a.reason || 'No reason given');
    }
  }
  filedUnknownSessions = [...unknown];
}

const filedFor = (person, label) => filedIndex?.get(`${person}|${sessionKey(label)}`) || null;

/**
 * What the grid should show when nothing has been recorded yet.
 *
 * If somebody gave a reason they would miss a session, "blank" does not mean
 * "we do not know" — it means absent and nobody has written it down. Shown as
 * an inference rather than saved, so the record still says what a person
 * actually entered and this vanishes the moment one is chosen.
 */
const inferredAbsent = row =>
  !row.actual && row.expectation && row.expectation !== 'Attendance Expected';

/** person -> { name, bySession: Map(sessionId -> row) } */
function people() {
  const byPerson = new Map();
  for (const r of attendance) {
    if (!byPerson.has(r.person_name)) byPerson.set(r.person_name, { name: r.person_name, rows: new Map() });
    byPerson.get(r.person_name).rows.set(r.session_id, r);
  }
  const q = local.search.trim().toLowerCase();
  return [...byPerson.values()]
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function attendanceView() {
  const shown = local.session ? sessions.filter(s => s.id === local.session) : sessions;
  const rows = people();
  const admin = isAdmin();

  if (!sessions.length) {
    return `<div class="empty"><div class="empty-mark">📋</div>
      <p><strong>Training attendance is not set up yet.</strong></p>
      <p class="muted" style="margin-top:6px">A codirector needs to run <code>13-training.sql</code> and then the
      import in Supabase. The Absence form tab works without it.</p>
      ${loadError ? `<p class="muted" style="margin-top:8px">${esc(loadError)}</p>` : ''}</div>`;
  }

  const totals = shown.map(s => {
    const forS = attendance.filter(a => a.session_id === s.id);
    // "owed" counts what is recorded absent plus what is assumed absent, or
    // the number on screen would disagree with the cells underneath it.
    return { s,
      attended: forS.filter(a => /^attended/i.test(a.actual || '')).length,
      owed: forS.filter(a => /absent/i.test(a.actual || '') || inferredAbsent(a)).length,
      filed: forS.filter(a => filedFor(a.person_name, s.label)).length,
      all: forS.length };
  });

  return `
    <div class="filters" style="margin-bottom:14px">
      <label class="search">${SEARCH_ICON}<input type="search" id="tr-search" placeholder="Find a guide…" value="${esc(local.search)}" autocomplete="off"></label>
      <select id="tr-session" class="select" aria-label="Show one session">
        <option value="">All sessions</option>
        ${sessions.map(s => `<option value="${esc(s.id)}" ${local.session === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select>
    </div>

    <section class="stats" style="margin-bottom:16px">
      ${totals.map(t => `<div class="stat"><span class="stat-num">${t.attended}</span>
        <span class="stat-lbl">${esc(t.s.label)}${t.owed ? ` · ${t.owed} owed` : ''}${t.filed ? ` · ${t.filed} filed` : ''}</span></div>`).join('')}
    </section>

    <div class="tr-wrap"><table class="tr-tbl">
      <thead><tr><th>Guide</th>
        ${shown.map(s => `<th>${esc(s.label)}<div class="tr-sub">${s.held_on ? esc(prettyDate(s.held_on)) : ''}</div></th>`).join('')}
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map(p => `<tr>
          <th>${esc(p.name)}</th>
          ${shown.map(s => {
            const r = p.rows.get(s.id);
            if (!r) return '<td class="tr-sub">—</td>';
            const filed = filedFor(p.name, s.label);
            const guess = inferredAbsent(r);
            return `<td>
              ${admin ? cellEditor(r)
                      : `<span class="tr-pill ${guess ? 'warn' : TONE(r.actual)}">${esc(r.actual || (guess ? 'Absent (assumed)' : '—'))}</span>`}
              <div class="tr-sub">
                ${guess && admin ? '<span class="tr-guess" title="They gave a reason and nothing has been recorded, so they are assumed absent until you say otherwise">assumed absent</span> ' : ''}
                ${filed ? `<span class="tr-filed" title="${esc(filed)}">✉ filed an absence</span>` : esc(r.expectation || '')}
              </div></td>`;
          }).join('')}
        </tr>`).join('') : `<tr><td colspan="${shown.length + 1}"><div class="empty"><p>Nobody matches that.</p></div></td></tr>`}
      </tbody>
    </table></div>`;
}

const options = (list, current) =>
  ['<option value="">—</option>',
   ...list.map(o => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}</option>`),
   // A value the sheet used that is not in our list still shows, rather than
   // silently resetting somebody's record to blank the moment it is touched.
   (current && !list.includes(current)) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ''
  ].join('');

const cellEditor = r => `
  <div class="tr-cell">
    <select class="tr-sel ${TONE(r.actual)}" data-field="actual" data-id="${esc(r.id)}" aria-label="Attendance">
      ${options(ACTUAL, r.actual)}
    </select>
    <select class="tr-sel" data-field="expectation" data-id="${esc(r.id)}" aria-label="Reason">
      ${options(EXPECTATION, r.expectation)}
    </select>
  </div>`;

function absencesView() {
  if (absences === null) return `<div class="loading"><div class="spinner"></div><p>Reading the absence form…</p></div>`;
  if (!absences.length)  return `<div class="empty"><div class="empty-mark">✅</div><p>Nobody has filed an absence.</p></div>`;

  const q = local.search.trim().toLowerCase();
  const shown = absences.filter(a => !q ||
    a.name.toLowerCase().includes(q) || a.sessions.join(' ').toLowerCase().includes(q));

  /* Anything the matcher could not place is said out loud. A form response
     that quietly matched nobody is the one failure mode that matters here —
     somebody tells you they will be away and the hub silently loses it. */
  indexFiled();
  const problems = [];
  if (filedUnmatched.length) problems.push(
    `<strong>${filedUnmatched.length} name${filedUnmatched.length === 1 ? '' : 's'} on the form ` +
    `${filedUnmatched.length === 1 ? 'does' : 'do'} not match anybody on the tracker:</strong> ` +
    esc(filedUnmatched.join(', ')) + '. Their absence is not shown on the grid.');
  if (filedUnknownSessions.length) problems.push(
    `<strong>The form offers ${filedUnknownSessions.length === 1 ? 'a session' : 'sessions'} the tracker does not have:</strong> ` +
    esc(filedUnknownSessions.join(', ')) + '. Worth making the two agree.');

  return `
    ${problems.length ? `<div class="callout" style="margin-bottom:14px">${problems.join('<br><br>')}</div>` : ''}
    <div class="filters" style="margin-bottom:14px">
      <label class="search">${SEARCH_ICON}<input type="search" id="tr-search" placeholder="Find a name or a date…" value="${esc(local.search)}" autocomplete="off"></label>
      <span class="muted" style="align-self:center">${shown.length} of ${absences.length}</span>
    </div>
    ${shown.map(a => `
      <article class="tr-abs">
        <div class="tr-abs-top">
          <span class="tr-abs-name">${esc(a.name)}</span>
          <span class="tr-abs-when">${esc(a.when)}</span>
        </div>
        <div class="tr-abs-for">${a.sessions.map(s => `<span>${esc(s)}</span>`).join('')}</div>
        ${a.reason ? `<div class="tr-abs-why">${esc(a.reason)}</div>` : ''}
      </article>`).join('')}
    <p class="muted" style="margin-top:12px">Read straight from the absence form, so it is never a stale copy.</p>`;
}

function paint() {
  indexFiled();
  $('#tr-body').innerHTML = local.tab === 'attendance' ? attendanceView() : absencesView();
}

export default {
  id: 'training',
  needs: 'training',
  title: 'Training',
  crumb: 'Attendance, makeups and who has said they will miss one',
  icon: '🎓',
  section: 'Tools',
  prefetch: async () => { if (!sessions) await loadAll(); if (absences === null) absences = await loadAbsences().catch(() => []); },
  bust: () => { sessions = null; attendance = null; absences = null; },

  async mount(view) {
    /* The highlighted tab has to come from local.tab, not be hardcoded. Coming
       back to this screen with "absences" remembered used to draw Attendance as
       the active tab while painting the absence list underneath it. */
    const tab = (id, label) =>
      `<button class="tab${local.tab === id ? ' is-active' : ''}" data-tab="${id}">${label}</button>`;

    view.innerHTML = `
      <nav class="tabs" id="tr-tabs" style="margin-bottom:16px">
        ${tab('attendance', 'Attendance')}${tab('absences', 'Absence form')}
      </nav>
      <div id="tr-body"><div class="loading"><div class="spinner"></div><p>Loading training…</p></div></div>`;

    if (!sessions) await loadAll();

    /* The grid needs the form too, now that it marks who has filed. It is a
       separate trip to Google though, so the table is painted from the
       database first and the markers appear a moment later — better than
       holding a hundred rows behind a spreadsheet fetch. */
    if (absences === null) {
      const arriving = loadAbsences().then(a => { absences = a; }).catch(() => { absences = []; });
      if (local.tab === 'absences') await arriving;     // that tab IS the form
      else arriving.then(() => { if ($('#tr-body')) paint(); });
    }
    paint();

    $('#tr-tabs').addEventListener('click', async e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      local.tab = t.dataset.tab;
      local.search = '';
      $$('#tr-tabs .tab').forEach(x => x.classList.toggle('is-active', x === t));
      paint();
      if (local.tab === 'absences' && absences === null) {
        absences = await loadAbsences().catch(() => []);
        paint();
      }
    });

    const body = $('#tr-body');

    body.addEventListener('input', debounce(e => {
      if (e.target.id === 'tr-search') { local.search = e.target.value; paint(); }
    }));

    body.addEventListener('change', async e => {
      if (e.target.id === 'tr-session') { local.session = e.target.value; return paint(); }

      const sel = e.target.closest('.tr-sel');
      if (!sel) return;
      const row = attendance.find(a => a.id === sel.dataset.id);
      if (!row) return;

      const field = sel.dataset.field;
      const was = row[field] || '';
      const now = sel.value || null;
      sel.disabled = true;
      try {
        await update('training_attendance', `id=eq.${row.id}`, { [field]: now });
        row[field] = now;
        sel.classList.add('dirty');
        // Repaint only the pill colour; a full repaint would steal focus mid-edit.
        if (field === 'actual') {
          // Recolour in place; a full repaint would take focus away mid-edit.
          sel.className = `tr-sel ${TONE(now)}`;
          const pill = sel.closest('td')?.querySelector('.tr-pill');
          if (pill) { pill.className = `tr-pill ${TONE(now)}`; pill.textContent = now || '—'; }
        }
      } catch (err) {
        sel.value = was;                       // put it back; the save did not happen
        toast(err.message, 'err');
      }
      sel.disabled = false;
    });
  }
};
