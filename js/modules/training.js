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
.tr-abs { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev);
  padding:12px 14px; margin-bottom:9px; }
.tr-abs-top { display:flex; justify-content:space-between; gap:12px; align-items:baseline; margin-bottom:5px; }
.tr-abs-name { font-weight:650; font-size:.92rem; }
.tr-abs-when { font-size:.72rem; color:var(--text-faint); flex:none; }
.tr-abs-for { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:6px; }
.tr-abs-for span { font-size:.7rem; padding:2px 8px; border-radius:999px; background:var(--warn-bg); color:var(--warn); }
.tr-abs-why { font-size:.83rem; color:var(--text-soft); white-space:pre-wrap; }
`);

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
    return { s, attended: forS.filter(a => /^attended/i.test(a.actual || '')).length,
             owed: forS.filter(a => /absent/i.test(a.actual || '')).length, all: forS.length };
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
        <span class="stat-lbl">${esc(t.s.label)}${t.owed ? ` · ${t.owed} owed` : ''}</span></div>`).join('')}
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
            return `<td>${admin ? cellEditor(r) : `<span class="tr-pill ${TONE(r.actual)}">${esc(r.actual || '—')}</span>`}
              <div class="tr-sub">${esc(r.expectation || '')}</div></td>`;
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

  return `
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
  $('#tr-body').innerHTML = local.tab === 'attendance' ? attendanceView() : absencesView();
}

export default {
  id: 'training',
  needs: 'training',
  title: 'Training',
  crumb: 'Attendance, makeups and who has said they will miss one',
  icon: '🎓',
  section: 'Tools',
  prefetch: async () => { if (!sessions) await loadAll(); },
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
    // Returning straight onto the absence tab must fetch it, not sit on a spinner.
    if (local.tab === 'absences' && absences === null) absences = await loadAbsences().catch(() => []);
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
