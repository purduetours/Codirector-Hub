/* ============================================================ Interviews
   Interview day: check candidates in, grade them against the three-part
   rubric, then work the results.
 
   Shown as "Interviews"; the backend is still the standalone Guide Room Apps
   Script, on its own spreadsheet and token auth.
============================================================================ */
import { gr, grConfigured } from '../core/guideRoomApi.js';
import { state } from '../core/state.js';
import {
  $, $$, esc, toast, showError, debounce, injectStyle,
  openModal, closeModal, wireModal, SEARCH_ICON
} from '../core/ui.js';

const CRIT = [
  { k: 'spk', name: 'Speaking skill',     labels: ["Can't speak", 'Meh', 'Average', 'Above avg', 'Ready for a tour'] },
  { k: 'per', name: 'Personable',         labels: ['Nothing there', 'Meh', 'Average', 'Above avg', 'Love listening'] },
  { k: 'imp', name: 'Overall impression', labels: ["Wouldn't hire", 'Meh', 'Average', 'Above avg', 'Need to hire'] }
];
const DECISIONS = ['', 'Yes', 'Maybe', 'No'];

let data = null;                 // { cycle, groups, interviewers, candidates[] }
let pending = [];                // parsed roster rows awaiting Add/Replace
const local = { tab: 'checkin', search: '', who: '', group: '', decision: '', target: null };

injectStyle('gr-css', `
.gr-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
.gr-cand { display:flex; align-items:center; gap:12px; padding:11px 14px;
  border-bottom:1px solid var(--line); width:100%; text-align:left; font:inherit;
  color:var(--text); background:none; border-left:0; border-right:0; border-top:0; cursor:pointer; }
.gr-cand:last-child { border-bottom:0; }
.gr-cand:hover { background:var(--bg-sunken); }
.gr-main { flex:1; min-width:0; }
.gr-name { font-size:.9rem; font-weight:600; }
.gr-sub { font-size:.76rem; color:var(--text-faint); }
.gr-nums { display:flex; gap:6px; flex:none; }
.gr-num { font-size:.74rem; background:var(--bg-sunken); border-radius:999px; padding:2px 8px;
  font-variant-numeric:tabular-nums; color:var(--text-soft); }
.gr-in { accent-color:var(--good); width:19px; height:19px; flex:none; }
.gr-crit { margin-bottom:16px; }
.gr-crit > span { display:block; font-size:.8rem; font-weight:600; color:var(--text-soft); margin-bottom:7px; }
.gr-scale { display:flex; gap:6px; }
.gr-scale input { position:absolute; opacity:0; pointer-events:none; }
.gr-scale label { flex:1; text-align:center; cursor:pointer; border:1px solid var(--line-strong);
  border-radius:var(--radius-sm); padding:9px 3px; transition:all .13s; user-select:none; min-height:56px;
  display:flex; flex-direction:column; justify-content:center; gap:2px; }
.gr-scale label b { font-size:.95rem; font-weight:700; color:var(--text); }
.gr-scale label em { font-style:normal; font-size:.6rem; color:var(--text-faint); line-height:1.2; }
.gr-scale label:hover { border-color:var(--accent); }
.gr-scale input:checked + label { background:var(--accent); border-color:var(--accent); }
.gr-scale input:checked + label b, .gr-scale input:checked + label em { color:#fff; }
.gr-tbl { width:100%; border-collapse:collapse; font-size:.82rem; }
.gr-tbl th, .gr-tbl td { padding:9px 11px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
.gr-tbl th { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--text-faint);
  font-weight:700; background:var(--bg-sunken); position:sticky; top:0; cursor:pointer; }
.gr-tbl td.num { font-variant-numeric:tabular-nums; }
.gr-tbl tr:hover td { background:var(--bg-sunken); }
.gr-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); }
.gr-dec { font:inherit; font-size:.78rem; padding:3px 7px; border-radius:var(--radius-sm);
  border:1px solid var(--line-strong); background:var(--bg-elev); color:var(--text); }
.gr-dec[data-v="Yes"]   { border-color:var(--good); color:var(--good); }
.gr-dec[data-v="Maybe"] { border-color:var(--warn); color:var(--warn); }
.gr-dec[data-v="No"]    { border-color:var(--danger); color:var(--danger); }
.gr-choice { display:flex; gap:14px; align-items:center; justify-content:space-between;
  border:1px solid var(--line-strong); border-radius:var(--radius-sm); padding:13px 15px; }
.gr-choice strong { display:block; font-size:.875rem; }
.gr-choice em { display:block; font-style:normal; font-size:.79rem; color:var(--text-soft);
  margin-top:3px; line-height:1.45; }
.gr-choice.danger { border-color:color-mix(in srgb, var(--danger) 35%, var(--line-strong)); }
.gr-choice .btn { flex:none; }
.gr-map { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.gr-map span { font-size:.74rem; background:var(--bg-sunken); border-radius:999px; padding:3px 9px; }
.gr-map span b { color:var(--accent); }
.gr-prevtbl { width:100%; border-collapse:collapse; font-size:.8rem; }
.gr-prevtbl th, .gr-prevtbl td { padding:6px 9px; border-bottom:1px solid var(--line); text-align:left; }
.gr-prevtbl th { font-size:.68rem; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-faint); font-weight:700; }
@media (max-width:620px) { .gr-choice { flex-direction:column; align-items:stretch; }
  .gr-choice .btn { width:100%; } }
`);

/* ---------------------------------------------------------------- helpers */

const num = v => (typeof v === 'number' && !isNaN(v) ? v : null);

function averages(c) {
  const who = Object.keys(c.scores || {});
  const avg = k => {
    const vals = who.map(w => num(c.scores[w]?.[k])).filter(v => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const spk = avg('spk'), per = avg('per'), imp = avg('imp');
  const parts = [spk, per, imp].filter(v => v !== null);
  return { raters: who.length, spk, per, imp, final: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null };
}

const fmt = v => (v === null ? '—' : v.toFixed(2));
const isIn = c => String(c.checkin || '').trim().toLowerCase() === 'yes';

function filtered(list) {
  const q = local.search.trim().toLowerCase();
  return list.filter(c => {
    if (q && !`${c.name} ${c.major} ${c.email}`.toLowerCase().includes(q)) return false;
    if (local.group && c.group !== local.group) return false;
    return true;
  });
}

/* ---------------------------------------------------------------- roster paste

   Pasting straight out of a Google Sheet gives tab-separated text, and any cell
   containing a comma or a line break arrives wrapped in quotes — the "other campus
   involvements" answers routinely run to several lines. Splitting on \n would tear
   those rows in half, so parse quotes properly.
--------------------------------------------------------------------------------- */

function parseTable(text) {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c));
}

/** Which source column feeds which field. Order matters — first match wins. */
const COLUMN_HINTS = [
  ['name',  [/full name/i, /^name$/i, /your name/i, /candidate/i]],
  ['email', [/e-?mail/i]],
  ['year',  [/year in school/i, /^year$/i, /class standing/i]],
  ['major', [/major/i, /program of study/i]]
];

function detectColumns(header) {
  const found = {};
  const used = new Set();

  for (const [field, patterns] of COLUMN_HINTS) {
    for (const re of patterns) {
      const i = header.findIndex((h, idx) =>
        !used.has(idx) && re.test(h) && !/graduat/i.test(h));   // "Graduation ... Year" is not their year in school
      if (i !== -1) { found[field] = i; used.add(i); break; }
    }
  }
  return found;
}

/**
 * Turns pasted text into the {name, year, major, email} objects importRoster
 * wants. Works with a header row in any column order; falls back to positional
 * Name / Year / Major / Email when there's no recognisable header.
 */
function parseRoster(text) {
  const rows = parseTable(text);
  if (!rows.length) return { rows: [], mapping: null, header: null, skipped: 0 };

  const header = rows[0];
  const cols = detectColumns(header);
  const hasHeader = 'name' in cols;

  const body = hasHeader ? rows.slice(1) : rows;
  const idx = hasHeader ? cols : { name: 0, year: 1, major: 2, email: 3 };

  const out = [];
  let skipped = 0;
  for (const r of body) {
    const name = (r[idx.name] || '').trim();
    if (!name) { skipped++; continue; }
    out.push({
      name,
      year:  (idx.year  !== undefined ? r[idx.year]  : '') || '',
      major: (idx.major !== undefined ? r[idx.major] : '') || '',
      email: (idx.email !== undefined ? r[idx.email] : '') || ''
    });
  }

  return {
    rows: out,
    mapping: idx,
    header: hasHeader ? header : null,
    skipped
  };
}

/* ---------------------------------------------------------------- views */

function checkinView() {
  const list = filtered(data.candidates);
  const inCount = data.candidates.filter(isIn).length;
  return `
    <div class="gr-bar">
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search" placeholder="Find a candidate…" value="${esc(local.search)}"></label>
      <select class="select" id="gr-group">
        <option value="">All groups</option>
        ${data.groups.map(g => `<option value="${esc(g)}" ${local.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
      </select>
      <span class="muted">${inCount} of ${data.candidates.length} checked in</span>
    </div>
    <div class="panel">${list.length ? list.map(c => `
      <label class="gr-cand">
        <input type="checkbox" class="gr-in" data-key="${esc(c.key)}" ${isIn(c) ? 'checked' : ''}>
        <span class="gr-main">
          <span class="gr-name">${esc(c.name)}</span>
          <span class="gr-sub">${esc([c.year, c.major, c.group].filter(Boolean).join(' · '))}</span>
        </span>
      </label>`).join('') : '<div class="empty"><div class="empty-mark">🔍</div><p>No candidates match.</p></div>'}
    </div>`;
}

function gradeView() {
  if (!local.who) {
    return `<div class="callout"><strong>Pick who you are first.</strong>
      Scores are filed under your exact name so the averages line up.</div>
      <div class="gr-bar" style="margin-top:14px">
        <select class="select" id="gr-who" style="flex:0 1 260px">
          <option value="">Who are you?</option>
          ${data.interviewers.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('')}
        </select>
      </div>`;
  }

  const list = filtered(data.candidates.filter(isIn));
  const done = list.filter(c => c.scores?.[local.who]).length;

  return `
    <div class="gr-bar">
      <select class="select" id="gr-who" style="flex:0 1 220px">
        ${data.interviewers.map(w => `<option value="${esc(w)}" ${w === local.who ? 'selected' : ''}>${esc(w)}</option>`).join('')}
      </select>
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search" placeholder="Find a candidate…" value="${esc(local.search)}"></label>
      <span class="muted">${done} of ${list.length} graded</span>
    </div>
    <div class="panel">${list.length ? list.map(c => {
      const s = c.scores?.[local.who];
      return `<button class="gr-cand" data-grade="${esc(c.key)}">
        <span class="gr-main">
          <span class="gr-name">${esc(c.name)}</span>
          <span class="gr-sub">${esc([c.year, c.major, c.group].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="gr-nums">${s
          ? CRIT.map(cr => `<span class="gr-num">${cr.k} ${s[cr.k] ?? '—'}</span>`).join('')
          : '<span class="gr-num">not graded</span>'}</span>
      </button>`;
    }).join('') : '<div class="empty"><div class="empty-mark">✅</div><p>Nobody is checked in yet.</p></div>'}
    </div>`;
}

function resultsView() {
  let rows = filtered(data.candidates).map(c => ({ c, t: averages(c) }));
  if (local.decision) rows = rows.filter(r => (r.c.decision || '') === local.decision);
  rows.sort((a, b) => (b.t.final ?? -1) - (a.t.final ?? -1));

  return `
    <div class="gr-bar">
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search" placeholder="Find a candidate…" value="${esc(local.search)}"></label>
      <select class="select" id="gr-decision">
        <option value="">All decisions</option>
        ${['Yes', 'Maybe', 'No'].map(d => `<option value="${d}" ${local.decision === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="gr-copy">Copy emails (${rows.length})</button>
    </div>
    <div class="gr-wrap"><table class="gr-tbl">
      <thead><tr><th>Name</th><th>Group</th><th>Year</th><th>Raters</th>
        <th>Speak</th><th>Person</th><th>Impress</th><th>Final</th><th>Decision</th></tr></thead>
      <tbody>${rows.length ? rows.map(({ c, t }) => `
        <tr>
          <td><strong>${esc(c.name)}</strong><br><span class="gr-sub">${esc(c.major || '')}</span></td>
          <td>${esc(c.group || '')}</td>
          <td>${esc(c.year || '')}</td>
          <td class="num">${t.raters}</td>
          <td class="num">${fmt(t.spk)}</td>
          <td class="num">${fmt(t.per)}</td>
          <td class="num">${fmt(t.imp)}</td>
          <td class="num"><strong>${fmt(t.final)}</strong></td>
          <td><select class="gr-dec" data-dec="${esc(c.key)}" data-v="${esc(c.decision || '')}">
            ${DECISIONS.map(d => `<option value="${d}" ${(c.decision || '') === d ? 'selected' : ''}>${d || '—'}</option>`).join('')}
          </select></td>
        </tr>`).join('') : '<tr><td colspan="9"><div class="empty"><p>No candidates match.</p></div></td></tr>'}
      </tbody>
    </table></div>`;
}

function setupView() {
  return `
    <div class="callout"><strong>These write straight through to the Guide Room spreadsheet.</strong>
      Clearing is not undoable from here — the sheet keeps its own File → Version history.</div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Cycle &amp; interviewers</h3></div>
      <div style="padding:15px;display:grid;gap:13px">
        <label class="field"><span>Cycle label</span><input id="gr-cycle" value="${esc(data.cycle || '')}"></label>
        <label class="field"><span>Interviewers — one per line</span>
          <textarea id="gr-people" rows="6">${esc((data.interviewers || []).join('\n'))}</textarea></label>
        <p class="hint">Scores are filed under an interviewer's exact name. Renaming or removing
          someone deletes the scores they gave.</p>
        <div><button class="btn btn-primary" id="gr-save">Save settings</button></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Roster</h3></div>
      <div style="padding:15px;display:grid;gap:13px">
        <label class="field">
          <span>Paste candidates</span>
          <textarea id="gr-roster" rows="7" placeholder="Select the rows in your application-responses sheet, copy, and paste here — headers and all."></textarea>
        </label>
        <p class="hint">Paste straight from the Google Form responses sheet. Columns are matched by
          their headings, in any order, and the ones you don't need (timestamp, PUID, involvements)
          are ignored. Long multi-line answers won't break the rows.</p>

        <div><button class="btn btn-ghost" id="gr-preview">Check this paste</button></div>

        <div id="gr-prev" hidden></div>

        <div id="gr-import-actions" hidden style="display:grid;gap:9px">
          <div class="gr-choice">
            <div>
              <strong>Add to roster</strong>
              <em>Keeps everyone already there, appends these on the end. Existing scores are untouched.
                  Use this when more applications come in mid-cycle.</em>
            </div>
            <button class="btn btn-primary" id="gr-append">Add <span id="gr-n-add"></span></button>
          </div>
          <div class="gr-choice danger">
            <div>
              <strong>Replace roster</strong>
              <em>Deletes every candidate currently on the roster <u>and every score already given</u>,
                  then loads these instead. Use this once at the start of a new cycle.</em>
            </div>
            <button class="btn btn-danger" id="gr-import">Replace <span id="gr-n-rep"></span></button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Danger zone</h3></div>
      <div style="padding:15px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-danger" id="gr-clear-roster">Clear roster</button>
        <button class="btn btn-danger" id="gr-clear-people">Clear interviewers</button>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- grading modal */

function openGrade(c) {
  local.target = c;
  const s = c.scores?.[local.who] || {};
  $('#gr-g-name').textContent = c.name;
  $('#gr-g-sub').textContent = [c.year, c.major, c.group].filter(Boolean).join(' · ');
  $('#gr-g-body').innerHTML = CRIT.map(cr => `
    <div class="gr-crit">
      <span>${cr.name}</span>
      <div class="gr-scale">${[1, 2, 3, 4, 5].map(n => `
        <input type="radio" name="gr-${cr.k}" id="gr-${cr.k}-${n}" value="${n}" ${s[cr.k] === n ? 'checked' : ''}>
        <label for="gr-${cr.k}-${n}"><b>${n}</b><em>${esc(cr.labels[n - 1])}</em></label>`).join('')}
      </div>
    </div>`).join('') +
    `<label class="field"><span>Notes</span><textarea id="gr-note" rows="3">${esc(c.comments?.[local.who] || '')}</textarea></label>`;
  $('#gr-g-error').hidden = true;
  openModal($('#gr-modal'));
}

/* ---------------------------------------------------------------- module */

async function refresh() {
  data = await gr('getState');
}

function paint() {
  $$('#gr-tabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === local.tab));
  const body = $('#gr-body');
  if (local.tab === 'checkin') body.innerHTML = checkinView();
  else if (local.tab === 'grade') body.innerHTML = gradeView();
  else if (local.tab === 'results') body.innerHTML = resultsView();
  else body.innerHTML = setupView();
}

export default {
  id: 'interviews',
  title: 'Interviews',
  crumb: 'Check-in, grading and results',
  icon: '🎤',
  section: 'Tools',

  async mount(view) {
    if (!grConfigured()) {
      view.innerHTML = `<div class="empty"><div class="empty-mark">🎤</div>
        <p>Interviews isn't connected. Add its <code>apiUrl</code> and <code>token</code>
        to the <code>GUIDE_ROOM</code> block in <code>config.js</code>.</p></div>`;
      return;
    }

    view.innerHTML = `
      <nav class="tabs" id="gr-tabs" style="margin-bottom:16px">
        <button class="tab is-active" data-tab="checkin">Check in</button>
        <button class="tab" data-tab="grade">Grade</button>
        <button class="tab" data-tab="results">Results</button>
        ${state.isAdmin ? '<button class="tab" data-tab="setup">Setup</button>' : ''}
      </nav>
      <div id="gr-body"><div class="loading"><div class="spinner"></div><p>Loading interviews…</p></div></div>

      <div class="modal-root" id="gr-modal" hidden>
        <div class="modal-scrim" data-close></div>
        <form class="modal modal-lg" id="gr-form">
          <header class="modal-head">
            <div><h2 id="gr-g-name"></h2><p class="muted" id="gr-g-sub"></p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
          </header>
          <div class="modal-body" id="gr-g-body"></div>
          <footer class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="gr-g-save">Save scores</button>
          </footer>
          <p class="form-error" id="gr-g-error" hidden style="margin:0 18px 14px"></p>
        </form>
      </div>`;

    wireModal($('#gr-modal'));
    await refresh();
    if (!local.who && data.interviewers.includes(state.name)) local.who = state.name;
    paint();

    $('#gr-tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      local.tab = t.dataset.tab;
      paint();
    });

    const body = $('#gr-body');

    body.addEventListener('input', debounce(e => {
      if (e.target.id === 'gr-search') { local.search = e.target.value; paint(); }
    }));

    body.addEventListener('change', async e => {
      const t = e.target;

      if (t.id === 'gr-group')    { local.group = t.value; return paint(); }
      if (t.id === 'gr-decision') { local.decision = t.value; return paint(); }
      if (t.id === 'gr-who')      { local.who = t.value; return paint(); }

      if (t.classList.contains('gr-in')) {
        t.disabled = true;
        try {
          await gr('setField', [t.dataset.key, 'checkin', t.checked ? 'Yes' : '']);
          const c = data.candidates.find(x => x.key === t.dataset.key);
          if (c) c.checkin = t.checked ? 'Yes' : '';
          paint();
        } catch (err) { toast(err.message, 'err'); t.checked = !t.checked; }
        finally { t.disabled = false; }
      }

      if (t.classList.contains('gr-dec')) {
        const prev = t.dataset.v;
        try {
          await gr('setField', [t.dataset.dec, 'decision', t.value]);
          const c = data.candidates.find(x => x.key === t.dataset.dec);
          if (c) c.decision = t.value;
          t.dataset.v = t.value;
        } catch (err) { toast(err.message, 'err'); t.value = prev; }
      }
    });

    body.addEventListener('click', async e => {
      const g = e.target.closest('[data-grade]');
      if (g) {
        const c = data.candidates.find(x => x.key === g.dataset.grade);
        if (c) openGrade(c);
        return;
      }

      if (e.target.id === 'gr-copy') {
        let rows = filtered(data.candidates);
        if (local.decision) rows = rows.filter(c => (c.decision || '') === local.decision);
        const emails = rows.map(c => c.email).filter(Boolean).join(', ');
        try { await navigator.clipboard.writeText(emails); toast(`Copied ${rows.length} email addresses.`); }
        catch { toast('Could not reach the clipboard.', 'err'); }
        return;
      }

      /* ---- setup actions (admin only) ---- */
      if (e.target.id === 'gr-save') {
        const btn = e.target;
        btn.disabled = true;
        try {
          const people = $('#gr-people').value.split('\n').map(s => s.trim()).filter(Boolean);
          await gr('saveSettings', [$('#gr-cycle').value.trim(), data.groups, people]);
          await refresh(); paint(); toast('Settings saved.');
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
      }

      if (e.target.id === 'gr-preview') {
        const raw = $('#gr-roster').value.trim();
        if (!raw) return toast('Paste something first.', 'err');

        const parsed = parseRoster(raw);
        pending = parsed.rows;

        const box = $('#gr-prev');
        if (!parsed.rows.length) {
          box.innerHTML = `<div class="callout"><strong>Nothing usable in that paste.</strong>
            Make sure the copied range includes the header row and a column with candidates' names.</div>`;
          box.hidden = false;
          $('#gr-import-actions').hidden = true;
          return;
        }

        const label = { name: 'Name', year: 'Year', major: 'Major', email: 'Email' };
        const mapped = Object.entries(parsed.mapping)
          .filter(([, i]) => i !== undefined)
          .map(([f, i]) => `<span><b>${label[f]}</b> ← ${esc(parsed.header ? parsed.header[i] : 'column ' + (i + 1))}</span>`)
          .join('');
        const missing = ['year', 'major', 'email'].filter(f => parsed.mapping[f] === undefined);

        box.innerHTML = `
          <div class="gr-map">${mapped}</div>
          ${missing.length ? `<p class="hint" style="margin-bottom:9px">No column matched
            <strong>${missing.join(', ')}</strong> — those will be left blank.</p>` : ''}
          ${parsed.skipped ? `<p class="hint" style="margin-bottom:9px">${parsed.skipped}
            row${parsed.skipped === 1 ? '' : 's'} skipped for having no name.</p>` : ''}
          <table class="gr-prevtbl">
            <thead><tr><th>Name</th><th>Year</th><th>Major</th><th>Email</th></tr></thead>
            <tbody>${parsed.rows.slice(0, 6).map(r => `<tr>
              <td>${esc(r.name)}</td><td>${esc(r.year)}</td>
              <td>${esc(r.major)}</td><td>${esc(r.email)}</td></tr>`).join('')}
            </tbody>
          </table>
          <p class="hint" style="margin-top:9px">Showing ${Math.min(6, parsed.rows.length)}
            of <strong>${parsed.rows.length}</strong> candidates. Looks right? Choose below.</p>`;
        box.hidden = false;

        $('#gr-n-add').textContent = parsed.rows.length;
        $('#gr-n-rep').textContent = parsed.rows.length;
        $('#gr-import-actions').hidden = false;
        $('#gr-import-actions').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }

      if (e.target.id === 'gr-import' || e.target.id === 'gr-append') {
        const replace = e.target.id === 'gr-import';
        if (!pending.length) return toast('Check the paste first.', 'err');

        if (replace) {
          const losing = data.candidates.length;
          const scored = data.candidates.filter(c => Object.keys(c.scores || {}).length).length;
          const warn = `Replace the roster?\n\n` +
            `Deletes: ${losing} candidate${losing === 1 ? '' : 's'}` +
            (scored ? `, including ${scored} with scores already recorded` : '') + `.\n` +
            `Loads: ${pending.length} from your paste.\n\nThis cannot be undone from here.`;
          if (!confirm(warn)) return;
        }

        const btn = e.target;
        const n = pending.length;
        btn.disabled = true;
        try {
          await gr('importRoster', [pending, replace]);
          await refresh();
          $('#gr-roster').value = '';
          pending = [];
          paint();
          toast(replace
            ? `Roster replaced — ${n} candidates loaded.`
            : `Added ${n} candidates. Roster is now ${data.candidates.length}.`);
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
      }

      if (e.target.id === 'gr-clear-roster') {
        if (!confirm('Delete every candidate and every score? Interviewers and groups are kept.')) return;
        try { await gr('clearRoster'); await refresh(); paint(); toast('Roster cleared.'); }
        catch (err) { toast(err.message, 'err'); }
      }

      if (e.target.id === 'gr-clear-people') {
        if (!confirm('Remove all interviewers and their score columns? This deletes their scores.')) return;
        try { await gr('clearInterviewers'); await refresh(); paint(); toast('Interviewers cleared.'); }
        catch (err) { toast(err.message, 'err'); }
      }
    });

    $('#gr-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#gr-g-save'), err = $('#gr-g-error');
      const c = local.target;
      btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
      try {
        for (const cr of CRIT) {
          const picked = $(`#gr-g-body input[name="gr-${cr.k}"]:checked`);
          await gr('setScore', [c.key, local.who, cr.k, picked ? Number(picked.value) : null]);
        }
        await gr('setNote', [c.key, local.who, $('#gr-note').value]);
        closeModal($('#gr-modal'));
        await refresh(); paint();
        toast(`Saved scores for ${c.name}.`);
      } catch (e2) { showError(err, e2.message); }
      finally { btn.disabled = false; btn.textContent = 'Save scores'; }
    });
  }
};
