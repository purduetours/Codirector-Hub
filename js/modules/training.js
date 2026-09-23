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
import { select, update, insert, remove } from '../core/db.js';
import { loadAbsences, formStamp } from '../core/sheets.js';
import { state, isAdmin, termId } from '../core/state.js';
import { $, $$, esc, toast, injectStyle, prettyDate, todayISO, debounce, SEARCH_ICON } from '../core/ui.js';
import { shareData } from '../core/vanessa-ui.js';
import { downloadCsv } from '../core/csv.js';
import { matchPerson } from '../core/people-match.js';

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
/* On a phone the two dropdowns shared about 250px and both truncated to
   "Make…" and "Atten…", which makes choosing a value guesswork. Stacked, each
   one gets the full width of the cell. */
@media (max-width:620px){
  .tr-cell { flex-direction:column; align-items:stretch; }
  .tr-cell .tr-sel { max-width:none; width:100%; }
  /* And give the column enough room for the longest option, or stacking just
     produces two truncated dropdowns instead of one. The table scrolls
     sideways anyway, so width costs nothing here. */
  .tr-tbl tbody td { min-width:178px; }
}
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
/* A suggestion from the form, not yet part of the record. */
.tr-sel.suggested { background:var(--warn-bg); color:var(--warn); border:1px dashed var(--warn); }
.tr-edited { position:relative; }
.tr-edited::after { content:""; position:absolute; top:4px; right:4px; width:5px; height:5px;
  border-radius:50%; background:var(--accent); opacity:.55; }
.tr-del { float:right; border:0; background:none; cursor:pointer; color:var(--text-faint);
  font-size:.7rem; padding:0 2px; line-height:1; }
.tr-del:hover { color:var(--danger); }
.tr-sub { font-size:.7rem; color:var(--text-faint); font-weight:400; }
.tr-filed { color:var(--warn); cursor:help; border-bottom:1px dotted currentColor; }
.tr-guess { color:var(--warn); font-style:italic; cursor:help; }
.tr-owe { display:flex; align-items:center; gap:14px; padding:11px 14px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-elev); margin-bottom:8px; }
.tr-owe-who { min-width:190px; flex:none; }
.tr-owe-who b { display:block; font-size:.9rem; font-weight:600; }
.tr-owe-who em { display:block; font-style:normal; font-size:.72rem; color:var(--text-faint); margin-top:1px; }
.tr-owe-list { flex:1; display:flex; flex-wrap:wrap; gap:5px; }
.tr-owe-pill { font-size:.72rem; padding:3px 9px; border-radius:999px; background:var(--warn-bg); color:var(--warn); }
.tr-owe-pill.assumed { background:transparent; border:1px dashed var(--line-strong); color:var(--text-faint); }
@media (max-width:620px){ .tr-owe { flex-wrap:wrap; } .tr-owe-who { min-width:0; width:100%; } }

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
/** "November 2rd" and "November 2nd" are the same evening. */
export const sessionKey = label =>
  String(label || '').toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/[^a-z0-9]/g, '');

let sessions = null, attendance = null, absences = null;
const local = { tab: 'attendance', search: '', session: '' };

/* Vanessa's handoff: "show me attendance for today" opens the Attendance tab
   on the session held that day, when there is one. Returns what it found so
   she can say so honestly. */
let focusDate = null;
export function focusTraining({ date = null } = {}) {
  local.tab = 'attendance';
  focusDate = date;
  const hit = date && sessions ? sessions.find(x => x.held_on === date) : null;
  if (hit) local.session = hit.id;
  return hit ? { label: hit.label } : null;
}

let loadError = null;

/* Tolerant on purpose. The tables arrive with a migration somebody has to run
   in Supabase, and until they do these reads 404. A tab that throws on mount
   would take the whole screen down and give no clue why, so a missing table is
   treated as "not set up yet" and says so. */
let editorNames = new Map();      // member id -> name, for "changed by"

async function loadAll() {
  loadError = null;
  try {
    const [s, a] = await Promise.all([
      select('training_sessions',   `select=*&term_id=eq.${termId()}&order=sort_order.asc`),
      select('training_attendance', 'select=id,session_id,guide_id,person_name,expectation,actual,updated_at,updated_by,makeup_on,makeup_note')
    ]);
    sessions = s || [];
    attendance = a || [];
    /* Who touched a cell. The trigger has been stamping updated_by since the
       table was created and nothing ever showed it, so a surprising value had
       no story attached — which is exactly the situation that cost an
       afternoon of diffing against a spreadsheet. */
    const ids = [...new Set(attendance.map(a => a.updated_by).filter(Boolean))];
    if (ids.length) {
      try {
        const who = await select('members', `select=id,full_name&id=in.(${ids.join(',')})`);
        editorNames = new Map((who || []).map(m => [m.id, m.full_name]));
      } catch { /* names are a nicety; the grid works without them */ }
    }

    indexFiled();
    shareWithVanessa();      // she must know even if this screen is never opened
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

/**
 * What the dropdown should show when somebody has filed an absence.
 *
 * The tracker was filled in optimistically: every session, including ones that
 * have not happened yet, arrived marked "Attended". So for a future date that
 * word is a placeholder rather than an observation, and a filed absence should
 * win over it. For a date that has already passed it is a real observation
 * made by a person who was in the room, and the form does NOT get to overrule
 * it — plenty of people file an absence and then turn up anyway.
 *
 * Nothing here is saved. It is shown as a suggestion until a codirector
 * accepts it, so the record never quietly disagrees with what somebody typed.
 */
function suggestedActual(row, person, session) {
  if (!filedFor(person, session.label)) return null;
  if (!row.actual) return 'Absent, Need Makeup';

  const future = session.held_on && session.held_on > todayISO();
  if (future && /^attended/i.test(row.actual)) return 'Absent, Need Makeup';
  return null;
}

const filedFor = (person, label) => filedIndex?.get(`${person}|${sessionKey(label)}`) || null;

/* Vanessa reads only what a screen has already loaded, so she gets this the
   moment it is assembled — the same rows, already matched to the form, rather
   than a second query of her own that could disagree with what is on show. */
function shareWithVanessa() {
  if (!sessions) return;
  const perPerson = new Map();
  for (const a of attendance) {
    const k = a.person_name;
    if (!perPerson.has(k)) perPerson.set(k, { attended: 0, makeup: 0, owed: 0, filed: 0 });
    const v = perPerson.get(k);
    if (/^attended/i.test(a.actual || '')) v.attended++;
    if (/^makeup/i.test(a.actual || '')) v.makeup++;
    if (/absent/i.test(a.actual || '') || inferredAbsent(a)) v.owed++;
    if (filedFor(k, sessions.find(x => x.id === a.session_id)?.label || '')) v.filed++;
  }

  shareData('training', {
    sessions,
    attendance,
    perPerson,
    absences: absences || [],
    filed: filedIndex ? [...filedIndex.keys()] : [],
    unmatched: filedUnmatched
  });
}

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

/* --------------------------------------------------------- adding a session
   Sessions could only be created with SQL, which meant every August somebody
   would have to open Supabase — the exact thing the People tab exists to end.

   Adding one also seeds a row for everybody already on the tracker. Without
   that the column exists but every cell reads "—", because attendance rows are
   what the grid is built from, and there would be nothing to click.
-------------------------------------------------------------------------- */
async function addSession() {
  const label = prompt('What is the session called? (for example: February 8th)');
  if (!label?.trim()) return;

  const when = prompt('What date is it? (YYYY-MM-DD, or leave blank)', '') || null;
  if (when && !/^\d{4}-\d{2}-\d{2}$/.test(when)) return toast('That date is not YYYY-MM-DD.', 'err');
  if (sessions.some(x => x.label.toLowerCase() === label.trim().toLowerCase()))
    return toast('There is already a session with that name.', 'err');

  try {
    const made = await insert('training_sessions', [{
      term_id: termId(), label: label.trim(), held_on: when,
      sort_order: sessions.length ? Math.max(...sessions.map(s => s.sort_order)) + 1 : 0
    }]);
    const session = made?.[0];
    if (!session) throw new Error('The session was not created.');

    const names = [...new Set(attendance.map(a => a.person_name))];
    if (names.length) {
      const guideOf = new Map(attendance.map(a => [a.person_name, a.guide_id]));
      await insert('training_attendance', names.map(n => ({
        session_id: session.id, person_name: n, guide_id: guideOf.get(n) || null,
        expectation: 'Attendance Expected', actual: null
      })));
    }
    await loadAll();
    indexFiled(); shareWithVanessa();
    toast(`${session.label} added for ${names.length} guides.`);
    paint();
  } catch (err) { toast(err.message, 'err'); }
}

/** Removing one takes its attendance with it, so it says so first. */
async function removeSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  const rows = attendance.filter(a => a.session_id === id).length;
  if (!confirm(`Delete "${s.label}"?\n\nThis also deletes ${rows} attendance record${rows === 1 ? '' : 's'} for it. It cannot be undone — take a CSV first if you are unsure.`)) return;
  try {
    await remove('training_sessions', `id=eq.${id}`);
    await loadAll();
    indexFiled(); shareWithVanessa();
    if (local.session === id) local.session = '';
    toast(`${s.label} deleted.`);
    paint();
  } catch (err) { toast(err.message, 'err'); }
}

/* ------------------------------------------------------------- exporting
   A way back out.

   This matters more than it looks. During development 62 rows were rewritten
   by mistake and the only reason it could be put right was that the original
   spreadsheet still existed to diff against. The moment the sheet and the
   database drift apart — which is the point of moving off the sheet — that
   safety net is gone. A download restores it: take one before a big edit, and
   a bad afternoon costs a paste rather than a term.

   Laid out like the original sheet, one column pair per session, so it opens
   in Google Sheets looking like the thing it replaced.
-------------------------------------------------------------------------- */
function exportCsv() {
  const head = ['Name', ...sessions.flatMap(s => [s.label, 'Actual'])];
  const rows = people().map(p => [
    p.name,
    ...sessions.flatMap(s => {
      const r = p.rows.get(s.id);
      return [r?.expectation || '', r?.actual || (r && inferredAbsent(r) ? 'Absent (assumed)' : '')];
    })
  ]);
  toast(`Downloaded ${downloadCsv('training-attendance', [head, ...rows])} guides.`);
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

  // How many suggestions are outstanding across everything on screen.
  const byId = new Map(sessions.map(x => [x.id, x]));
  const pending = attendance.filter(a => {
    const sess = byId.get(a.session_id);
    return sess && suggestedActual(a, a.person_name, sess);
  }).length;

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
    ${pending ? `<div class="callout" style="margin-bottom:14px">
      <strong>${pending} ${pending === 1 ? 'person has' : 'people have'} filed an absence</strong> for a session still
      marked as attended. They are shown dashed and are not saved yet.
      <span class="muted" style="display:block;margin-top:6px">Set each one yourself when you are ready — picking the value in the dropdown saves it.</span>
    </div>` : ''}
    <div class="filters" style="margin-bottom:14px">
      <label class="search">${SEARCH_ICON}<input type="search" id="tr-search" placeholder="Find a guide…" value="${esc(local.search)}" autocomplete="off"></label>
      <button class="btn btn-ghost btn-sm" id="tr-export" title="Download the whole grid, laid out like the old spreadsheet">Download CSV</button>
      ${isAdmin() ? '<button class="btn btn-ghost btn-sm" id="tr-add">＋ Session</button>' : ''}
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
        ${shown.map(s => `<th>${esc(s.label)}
          ${admin ? `<button class="tr-del" data-del="${esc(s.id)}" title="Delete this session">✕</button>` : ''}
          <div class="tr-sub">${s.held_on ? esc(prettyDate(s.held_on)) : ''}</div></th>`).join('')}
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map(p => `<tr>
          <th>${esc(p.name)}</th>
          ${shown.map(s => {
            const r = p.rows.get(s.id);
            if (!r) return '<td class="tr-sub">—</td>';
            const filed = filedFor(p.name, s.label);
            const suggest = suggestedActual(r, p.name, s);
            const guess = inferredAbsent(r);
            return `<td class="${r.updated_by ? 'tr-edited' : ''}">
              ${admin ? cellEditor(r, suggest)
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

/* The suggestion is shown as its own option with a value that is not a real
   attendance value. That matters: while the suggestion was simply "Absent,
   Need Makeup" pre-selected, ANY change event on the control — a re-render, a
   stray script, a browser quirk — saved it, because the shown value genuinely
   differed from the stored one and looked exactly like a choice. One row was
   silently rewritten that way during testing.
   
   With a sentinel, the initial state cannot be written at all: the handler
   sees SUGGESTED and stops. Picking the real "Absent, Need Makeup" underneath
   it saves normally, and so does "Accept them all". */
const SUGGESTED = '__suggested__';

const options = (list, current) =>
  ['<option value="">—</option>',
   ...list.map(o => `<option value="${esc(o)}" ${o === current ? 'selected' : ''}>${esc(o)}</option>`),
   // A value the sheet used that is not in our list still shows, rather than
   // silently resetting somebody's record to blank the moment it is touched.
   (current && !list.includes(current)) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ''
  ].join('');

const makeupNote = r => {
  if (!/^makeup/i.test(r.actual || '')) return '';
  const bits = [r.makeup_on ? `Made up ${prettyDate(r.makeup_on)}` : '', r.makeup_note || ''].filter(Boolean);
  return bits.join(' — ');
};

const editedNote = r => {
  const mk = makeupNote(r);
  if (mk) return mk + (r.updated_by ? ` · recorded by ${editorNames.get(r.updated_by) || 'someone'}` : '');
  if (!r.updated_by) return '';
  const who = editorNames.get(r.updated_by) || 'someone';
  const when = r.updated_at ? new Date(r.updated_at).toLocaleString(undefined,
    { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return `Changed by ${who}${when ? ` on ${when}` : ''}`;
};

const cellEditor = (r, suggest) => `
  <div class="tr-cell"${editedNote(r) ? ` title="${esc(editedNote(r))}"` : ''}>
    <select class="tr-sel ${suggest ? 'suggested' : TONE(r.actual)}" data-field="actual" data-id="${esc(r.id)}"
      data-stored="${esc(r.actual || '')}"
      aria-label="Attendance"${suggest ? ` title="They filed an absence for this session. Not saved yet — pick it to confirm."` : ''}>
      ${suggest ? `<option value="${SUGGESTED}" selected>${esc(suggest)} (from form)</option>` : ''}
      ${options(ACTUAL, suggest ? null : r.actual)}
    </select>
    <select class="tr-sel" data-field="expectation" data-id="${esc(r.id)}"
      data-stored="${esc(r.expectation || '')}" aria-label="Reason">
      ${options(EXPECTATION, r.expectation)}
    </select>
  </div>`;

/* --------------------------------------------------------------- makeups
   The question the grid is bad at answering.

   A hundred rows by eight columns is fine for "what happened on the 31st" and
   hopeless for "who still owes me something" — that answer is six cells
   scattered across eight hundred. This is the same data asked the other way
   round: only the people with something outstanding, what they owe, and how
   long it has been sitting there.

   Outstanding means marked absent and not since marked "Makeup Completed" —
   completing the makeup is exactly what changes the cell. Sessions that are
   assumed absent (a reason given, nothing recorded) are counted too, and
   marked as such, because they are the ones most likely to be forgotten.
-------------------------------------------------------------------------- */
function makeupsView() {
  if (!sessions.length) return attendanceView();

  const byLabel = new Map(sessions.map(x => [x.id, x]));
  const owed = new Map();                       // person -> [{session, assumed}]

  for (const a of attendance) {
    const isAbsent  = /absent/i.test(a.actual || '');
    const isAssumed = inferredAbsent(a);
    if (!isAbsent && !isAssumed) continue;
    const sess = byLabel.get(a.session_id);
    if (!sess) continue;
    if (!owed.has(a.person_name)) owed.set(a.person_name, []);
    owed.get(a.person_name).push({ sess, assumed: isAssumed && !isAbsent, row: a });
  }

  const q = local.search.trim().toLowerCase();
  const list = [...owed.entries()]
    .filter(([name]) => !q || name.toLowerCase().includes(q))
    .map(([name, items]) => ({ name, items: items.sort((a, b) => a.sess.sort_order - b.sess.sort_order) }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));

  const total = [...owed.values()].reduce((n, i) => n + i.length, 0);
  const today = new Date();
  const daysSince = iso => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round((today - new Date(y, m - 1, d)) / 86400000);
  };

  if (!list.length) {
    return `<div class="empty"><div class="empty-mark">✅</div>
      <p>Nobody owes a makeup.</p>
      <p class="muted" style="margin-top:6px">Everyone marked absent has since completed one.</p></div>`;
  }

  return `
    <div class="filters" style="margin-bottom:14px">
      <label class="search">${SEARCH_ICON}<input type="search" id="tr-search" placeholder="Find a guide…" value="${esc(local.search)}" autocomplete="off"></label>
      <span class="muted" style="align-self:center">${list.length} ${list.length === 1 ? 'person' : 'people'} · ${total} outstanding</span>
    </div>
    ${list.map(p => `
      <div class="tr-owe">
        <div class="tr-owe-who">
          <b>${esc(p.name)}</b>
          <em>${p.items.length} outstanding</em>
        </div>
        <div class="tr-owe-list">
          ${p.items.map(({ sess, assumed, row }) => {
            const age = daysSince(sess.held_on);
            return `<span class="tr-owe-pill${assumed ? ' assumed' : ''}"
              title="${assumed ? 'Gave a reason, nothing recorded yet' : 'Marked absent, needs a makeup'}">
              ${esc(sess.label)}${age !== null && age > 0 ? ` · ${age}d ago` : ''}${assumed ? ' · assumed' : ''}</span>`;
          }).join('')}
        </div>
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-clear="${esc(p.name)}"
          title="Mark every outstanding session for this person as Makeup Completed">Makeup done</button>` : ''}
      </div>`).join('')}
    <p class="muted" style="margin-top:12px">Outstanding means marked absent and not since marked as a completed makeup.</p>`;
}

/* Read means on screen. Called when the Absence tab paints, so the sign-in
   page stops counting submissions this person has now seen. */
function markAbsencesSeen() {
  if (!absences?.length) return;
  const newest = Math.max(...absences.map(a => formStamp(a.when)));
  try { localStorage.setItem('hub2.abs.seen', String(newest)); } catch { /* private window */ }
}

function absencesView() {
  markAbsencesSeen();
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
  shareWithVanessa();
  $('#tr-body').innerHTML =
    local.tab === 'makeups'  ? makeupsView()
    : local.tab === 'absences' ? absencesView()
    : attendanceView();
}

export default {
  id: 'training',
  // Codirectors only: this is a record about a hundred named students,
  // and the database policies match (16-training-codirectors-only.sql).
  needs: 'admin',
  title: 'Training',
  crumb: 'Attendance, makeups and who has said they will miss one',
  icon: '🎓',
  section: 'Tools',
  prefetch: async () => {
    if (!sessions) await loadAll();
    if (absences === null) absences = await loadAbsences().catch(() => []);
    indexFiled(); shareWithVanessa();
  },
  bust: () => { sessions = null; attendance = null; absences = null; shareData('training', null); },

  async mount(view) {
    /* The highlighted tab has to come from local.tab, not be hardcoded. Coming
       back to this screen with "absences" remembered used to draw Attendance as
       the active tab while painting the absence list underneath it. */
    const tab = (id, label) =>
      `<button class="tab${local.tab === id ? ' is-active' : ''}" data-tab="${id}">${label}</button>`;

    view.innerHTML = `
      <nav class="tabs" id="tr-tabs" style="margin-bottom:16px">
        ${tab('attendance', 'Attendance')}${tab('makeups', 'Makeups owed')}${tab('absences', 'Absence form')}
      </nav>
      <div id="tr-body"><div class="loading"><div class="spinner"></div><p>Loading training…</p></div></div>`;

    if (!sessions) await loadAll();
    if (focusDate) { const hit = (sessions || []).find(x => x.held_on === focusDate); if (hit) local.session = hit.id; focusDate = null; }

    /* The grid needs the form too, now that it marks who has filed. It is a
       separate trip to Google though, so the table is painted from the
       database first and the markers appear a moment later — better than
       holding a hundred rows behind a spreadsheet fetch. */
    if (absences === null) {
      const arriving = loadAbsences()
        .then(a => { absences = a; indexFiled(); shareWithVanessa(); })
        .catch(() => { absences = []; });
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

    /* Buttons fire click, not change. These lived in the change handler and so
       did nothing at all — the confirm never appeared and the row stayed put. */
    body.addEventListener('click', async e => {
      /* Only a real person may set off a bulk write.
      
         There used to be an "Accept them all" button here that wrote every
         suggested absence in one go. It rewrote 62 rows of real attendance
         twice during development, and neither time could the trigger be
         reproduced — the second time was after a guard had supposedly closed
         the hole. A bulk overwrite whose cause is not understood does not
         belong anywhere near a term's records, so it is gone rather than
         patched again. Suggestions are still shown; accepting one is a
         dropdown, one cell at a time.

         What remains is per-person and named. It is still restricted to a real
         click, because a script must never be able to set one off. */
      if (!e.isTrusted && e.target.closest?.('button[data-clear]')) return;

      /* These went missing when the bulk-apply block was cut out — the slice
         took the lines below it too, and the buttons silently stopped working
         while still being drawn. Restored, and tested individually. */
      if (e.target.id === 'tr-export') return exportCsv();
      if (e.target.id === 'tr-add')    return addSession();
      const del = e.target.closest('[data-del]');
      if (del) return removeSession(del.dataset.del);

      const clear = e.target.closest('button[data-clear]');
      if (clear) {
        const who = clear.dataset.clear;
        const rows = attendance.filter(a => a.person_name === who &&
          (/absent/i.test(a.actual || '') || inferredAbsent(a)));
        if (!rows.length) return;
        if (!confirm(`Mark ${rows.length} outstanding session${rows.length === 1 ? '' : 's'} for ${who} as Makeup Completed?`)) return;
        /* Optional, and asked for once rather than per session. Skipping it
           leaves the record exactly as it was before this existed. */
        const on = prompt(`When did ${who} do the makeup? (YYYY-MM-DD, or leave blank)`, todayISO()) ?? '';
        if (on && !/^\d{4}-\d{2}-\d{2}$/.test(on)) return toast('That date is not YYYY-MM-DD.', 'err');
        const note = prompt('What was it? (optional — a session attended, a task, a conversation)', '') ?? '';

        clear.disabled = true;
        try {
          // One at a time on purpose: if the third fails, the first two still
          // stand and the list simply shows what is left.
          for (const r of rows) {
            const patch = { actual: 'Makeup Completed', makeup_on: on || null, makeup_note: note.trim() || null };
            await update('training_attendance', `id=eq.${r.id}`, patch);
            Object.assign(r, patch);
          }
          toast(`${who} is all caught up.`);
          paint();
        } catch (err) { toast(err.message, 'err'); clear.disabled = false; paint(); }
        return;
      }

    });

    body.addEventListener('change', async e => {
      if (e.target.id === 'tr-session') { local.session = e.target.value; return paint(); }

      const sel = e.target.closest('.tr-sel');
      if (!sel) return;
      const row = attendance.find(a => a.id === sel.dataset.id);
      if (!row) return;

      const field = sel.dataset.field;
      const was = row[field] || '';
      const now = sel.value || null;

      /* Only write what a person actually picked.

         A suggested cell shows "Absent, Need Makeup" while the record still
         says "Attended", so the control's value and the stored value disagree
         on purpose. That is fine until something fires a change event nobody
         asked for — a re-render, a stray script — at which point the
         suggestion would be saved as though it had been chosen. Comparing
         against the value this control was DRAWN with, rather than against
         whatever it is showing now, means an accidental event writes nothing.
         One stray row appeared in testing this way; it should not be possible. */
      // The untouched suggestion. Nobody chose it, so nothing is saved.
      if (now === SUGGESTED) return;

      const drawnWith = sel.dataset.stored || '';
      if ((now || '') === drawnWith) return;              // nothing was chosen
      sel.disabled = true;
      try {
        await update('training_attendance', `id=eq.${row.id}`, { [field]: now });
        row[field] = now;
        sel.dataset.stored = now || '';        // this is the record now
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

/* ------------------------------------------------------- for Vanessa to act
   Exported so she can finish the job rather than telling you where to click,
   and so there is one implementation of "mark a makeup done" rather than hers
   and the button's drifting apart.
-------------------------------------------------------------------------- */

/** person -> how many sessions they still owe, or null if nothing is loaded. */
export function owedBy() {
  if (!attendance) return null;
  const m = new Map();
  for (const a of attendance) {
    if (!/absent/i.test(a.actual || '') && !inferredAbsent(a)) continue;
    m.set(a.person_name, (m.get(a.person_name) || 0) + 1);
  }
  return m;
}

/** Mark everything this person owes as completed. Returns how many changed. */
export async function markMakeupDone(person) {
  const rows = (attendance || []).filter(a => a.person_name === person &&
    (/absent/i.test(a.actual || '') || inferredAbsent(a)));
  if (!rows.length) throw new Error(`${person} does not owe a makeup.`);
  for (const r of rows) {
    await update('training_attendance', `id=eq.${r.id}`, { actual: 'Makeup Completed' });
    r.actual = 'Makeup Completed';
  }
  indexFiled(); shareWithVanessa();
  if ($('#tr-body')) paint();
  return rows.length;
}

/** One guide's training term at a glance, for the Directory profile. */
export function trainingFor(name) {
  if (!attendance || !sessions) return null;
  const mine = attendance.filter(a => a.person_name === name);
  if (!mine.length) return null;
  const byId = new Map(sessions.map(x => [x.id, x]));
  return {
    attended: mine.filter(a => /^attended/i.test(a.actual || '')).length,
    makeup:   mine.filter(a => /^makeup/i.test(a.actual || '')).length,
    owed:     mine.filter(a => /absent/i.test(a.actual || '') || inferredAbsent(a)).length,
    filed:    mine.filter(a => filedFor(name, byId.get(a.session_id)?.label || '')).length
  };
}

/** The raw material, for the data-health checks. */
export const trainingSources = () => (sessions ? { sessions, attendance, absences } : null);
