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
const local = { tab: 'checkin', search: '', who: '', group: '', decision: '',
                target: null, detail: null };

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
.gr-legend { display:flex; gap:11px; flex-wrap:wrap; font-size:.76rem; color:var(--text-soft); }
.gr-group { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.gr-group i { width:9px; height:9px; border-radius:50%; flex:none; display:inline-block;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.14); }
.gr-clickrow { cursor:pointer; }
.gr-brk { width:100%; border-collapse:collapse; font-size:.83rem; }
.gr-brk th, .gr-brk td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; }
.gr-brk th { font-size:.68rem; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-faint); font-weight:700; }
.gr-brk td.n { font-variant-numeric:tabular-nums; text-align:center; width:52px; }
.gr-brk tr.pending td { color:var(--text-faint); font-style:italic; }
.gr-note { font-size:.82rem; color:var(--text-soft); background:var(--bg-sunken);
  border-radius:var(--radius-sm); padding:8px 11px; white-space:pre-wrap; }
.gr-brk tr.has-note td { border-bottom:0; padding-bottom:4px; }
.gr-brk tr.noterow td { padding-top:0; }
.gr-brk td.act { text-align:right; white-space:nowrap; width:1%; }
.gr-brk td, .gr-brk th { vertical-align:middle; }
.gr-who { font-weight:600; }
.gr-sumrow { display:flex; gap:9px; flex-wrap:wrap; margin-bottom:4px; }
.gr-sum { background:var(--bg-sunken); border-radius:var(--radius-sm); padding:9px 13px; flex:1; min-width:88px; }
.gr-sum .n { font-size:1.15rem; font-weight:700; font-variant-numeric:tabular-nums; }
.gr-sum .l { font-size:.7rem; color:var(--text-soft); }
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

/* Groups are usually colour names, so show the colour. Anything that isn't a
   known colour still gets a stable swatch derived from its name, so a group
   called "Star" looks deliberate rather than broken. */
const GROUP_COLORS = {
  green: '#22c55e', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
  orange: '#f97316', yellow: '#eab308', purple: '#a855f7', violet: '#8b5cf6',
  teal: '#14b8a6', cyan: '#06b6d4', gold: '#d4a017', silver: '#9ca3af',
  black: '#111827', white: '#e5e7eb', grey: '#6b7280', gray: '#6b7280',
  brown: '#92400e', lime: '#84cc16', navy: '#1e3a8a', maroon: '#7f1d1d'
};

function groupColor(name) {
  const key = String(name || '').trim().toLowerCase();
  if (GROUP_COLORS[key]) return GROUP_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 55%)`;
}

function groupTag(name) {
  if (!name) return '';
  return `<span class="gr-group"><i style="background:${groupColor(name)}"></i>${esc(name)}</span>`;
}

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
      <span class="gr-legend">${data.groups.map(g => groupTag(g)).join('')}</span>
    </div>
    <div class="panel">${list.length ? list.map(c => `
      <label class="gr-cand">
        <input type="checkbox" class="gr-in" data-key="${esc(c.key)}" ${isIn(c) ? 'checked' : ''}>
        <span class="gr-main">
          <span class="gr-name">${esc(c.name)}</span>
          <span class="gr-sub">${esc([c.year, c.major].filter(Boolean).join(' · '))}${
            c.group ? (c.year || c.major ? ' · ' : '') + groupTag(c.group) : ''}</span>
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
          <span class="gr-sub">${esc([c.year, c.major].filter(Boolean).join(' · '))}${
            c.group ? (c.year || c.major ? ' · ' : '') + groupTag(c.group) : ''}</span>
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
        <tr class="gr-clickrow" data-open="${esc(c.key)}">
          <td><strong>${esc(c.name)}</strong><br><span class="gr-sub">${esc(c.major || '')}</span></td>
          <td>${groupTag(c.group)}</td>
          <td>${esc(c.year || '')}</td>
          <td class="num">${t.raters}</td>
          <td class="num">${fmt(t.spk)}</td>
          <td class="num">${fmt(t.per)}</td>
          <td class="num">${fmt(t.imp)}</td>
          <td class="num"><strong>${fmt(t.final)}</strong></td>
          <td data-noopen><select class="gr-dec" data-dec="${esc(c.key)}" data-v="${esc(c.decision || '')}">
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

        <label class="field"><span>Groups — one per line</span>
          <textarea id="gr-groups" rows="4">${esc((data.groups || []).join('\n'))}</textarea></label>
        <p class="hint">Candidates are dealt into these groups evenly as they're imported.
          Changing them here only affects <em>future</em> imports — anyone already on the roster
          keeps the group they were given.</p>

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

/**
 * Saves a grade in one request, falling back to the original four calls when the
 * Guide Room script hasn't been redeployed with saveGrade yet. Slow, but working,
 * beats fast-but-broken while a deploy is pending.
 */
let canBatchGrade = true;
let warnedSlow = false;

async function saveGradeCall(key, who, scores, note) {
  if (canBatchGrade) {
    try {
      return await gr('saveGrade', [key, who, scores, note]);
    } catch (err) {
      // Any failure here falls back to the original four calls. The obvious case is
      // an older deployment without saveGrade, but a dropped request is worth the
      // same treatment — the writes are idempotent, so re-sending them is safe and
      // a saved grade matters more than saving it the fast way.
      canBatchGrade = false;
      console.warn('saveGrade unavailable, using per-field writes:', err.message);
    }
  }

  // Set each criterion individually. Same end state as saveGrade, four round trips.
  // Spaced out on purpose: firing four at Apps Script back to back is exactly when
  // it starts dropping them, and a failure here can leave a grade half-written.
  const gap = () => new Promise(r => setTimeout(r, 350));
  for (const cr of CRIT) {
    await gr('setScore', [key, who, cr.k, scores[cr.k]]);
    await gap();
  }
  await gr('setNote', [key, who, note]);
  return true;
}

/* ---------------------------------------------------------------- breakdown */

/** Who may wipe an interviewer's rating: that interviewer, or an admin. */
function canClear(who) {
  return state.isAdmin || who.toLowerCase() === String(local.who || '').trim().toLowerCase();
}

function renderDetail(c) {
  const t = averages(c);
  const graded = data.interviewers.filter(w => c.scores?.[w]);
  const pending = data.interviewers.filter(w => !c.scores?.[w]);

  const avg = s => {
    const v = [s.spk, s.per, s.imp].filter(x => x !== null && x !== undefined);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—';
  };

  return `
    <div class="gr-sumrow">
      <div class="gr-sum"><div class="n">${t.raters}</div><div class="l">Raters</div></div>
      <div class="gr-sum"><div class="n">${fmt(t.spk)}</div><div class="l">Speaking</div></div>
      <div class="gr-sum"><div class="n">${fmt(t.per)}</div><div class="l">Personable</div></div>
      <div class="gr-sum"><div class="n">${fmt(t.imp)}</div><div class="l">Impression</div></div>
      <div class="gr-sum"><div class="n">${fmt(t.final)}</div><div class="l">Final</div></div>
    </div>

    ${graded.length ? `
    <table class="gr-brk">
      <thead><tr><th>Interviewer</th><th class="n">Spk</th><th class="n">Per</th>
        <th class="n">Imp</th><th class="n">Avg</th><th></th></tr></thead>
      <tbody>${graded.map(w => {
        const sc = c.scores[w];
        const note = c.comments?.[w];
        return `<tr class="${note ? 'has-note' : ''}">
          <td><span class="gr-who">${esc(w)}</span></td>
          <td class="n">${sc.spk ?? '—'}</td>
          <td class="n">${sc.per ?? '—'}</td>
          <td class="n">${sc.imp ?? '—'}</td>
          <td class="n"><strong>${avg(sc)}</strong></td>
          <td class="act">${canClear(w)
            ? `<button class="btn btn-quiet btn-sm" data-clear="${esc(w)}" title="Clear ${esc(w)}'s rating">Clear</button>`
            : ''}</td>
        </tr>
        ${note ? `<tr class="noterow"><td colspan="6"><div class="gr-note">${esc(note)}</div></td></tr>` : ''}`;
      }).join('')}</tbody>
    </table>` : '<p class="hint">Nobody has graded this candidate yet.</p>'}

    ${pending.length ? `<p class="hint" style="margin-top:11px">Not yet graded by
      <strong>${esc(pending.join(', '))}</strong>.</p>` : ''}`;
}

function openDetail(c) {
  local.detail = c;
  $('#gr-d-name').textContent = c.name;
  $('#gr-d-sub').innerHTML = [
    esc([c.year, c.major].filter(Boolean).join(' · ')),
    c.group ? groupTag(c.group) : ''
  ].filter(Boolean).join(' · ');
  $('#gr-d-body').innerHTML = renderDetail(c);
  openModal($('#gr-detail'));
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
  adminOnly: true,
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

      <div class="modal-root" id="gr-detail" hidden>
        <div class="modal-scrim" data-close></div>
        <div class="modal modal-lg">
          <header class="modal-head">
            <div><h2 id="gr-d-name"></h2><p class="muted" id="gr-d-sub"></p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
          </header>
          <div class="modal-body" id="gr-d-body"></div>
          <footer class="modal-foot"><button class="btn btn-ghost" data-close>Close</button></footer>
        </div>
      </div>

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
    // Re-entering the tab shouldn't cost another 6-second round trip; the toolbar's
    // Refresh is there when someone wants the sheet re-read.
    if (!data) await refresh();
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

    wireModal($('#gr-detail'));

    // Clear one interviewer's rating, from inside the breakdown.
    $('#gr-d-body').addEventListener('click', async e => {
      const b = e.target.closest('[data-clear]');
      if (!b) return;
      const who = b.dataset.clear, c = local.detail;
      if (!confirm(`Clear ${who}'s rating for ${c.name}? Their scores and note are deleted.`)) return;

      b.disabled = true;
      try {
        await saveGradeCall(c.key, who, { spk: null, per: null, imp: null }, '');
        if (c.scores) delete c.scores[who];
        if (c.comments) delete c.comments[who];
        $('#gr-d-body').innerHTML = renderDetail(c);
        paint();
        toast(`Cleared ${who}'s rating for ${c.name}.`);
      } catch (err) { toast(err.message, 'err'); b.disabled = false; }
    });

    body.addEventListener('click', async e => {
      const openRow = e.target.closest('[data-open]');
      if (openRow && !e.target.closest('[data-noopen]')) {
        const c = data.candidates.find(x => x.key === openRow.dataset.open);
        if (c) return openDetail(c);
      }

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
        const lines = sel => $(sel).value.split('\n').map(x => x.trim()).filter(Boolean);
        const groups = lines('#gr-groups');
        const people = lines('#gr-people');

        if (!groups.length) return toast('Keep at least one group.', 'err');

        // Renaming an interviewer drops their score columns, so name the cost first.
        const losing = (data.interviewers || []).filter(w => !people.includes(w));
        const scored = losing.filter(w => data.candidates.some(c => c.scores?.[w]));
        if (scored.length && !confirm(
          `Removing ${scored.join(', ')} deletes the scores they gave. Continue?`)) return;

        btn.disabled = true;
        try {
          await gr('saveSettings', [$('#gr-cycle').value.trim(), groups, people]);
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

      const scores = {};
      for (const cr of CRIT) {
        const picked = $(`#gr-g-body input[name="gr-${cr.k}"]:checked`);
        scores[cr.k] = picked ? Number(picked.value) : null;
      }
      const note = $('#gr-note').value;

      btn.disabled = true; btn.textContent = 'Saving…'; err.hidden = true;
      try {
        // One request for all four values, instead of the four separate calls this
        // used to make — at ~4s each that was fifteen-odd seconds per candidate.
        // Older deployments don't have saveGrade, so fall back rather than break.
        await saveGradeCall(c.key, local.who, scores, note);

        // Update in place rather than refetching the whole roster — another 6s
        // round trip for data we already know the shape of.
        if (Object.values(scores).some(v => v !== null)) {
          c.scores = { ...(c.scores || {}), [local.who]: scores };
        } else if (c.scores) {
          delete c.scores[local.who];
        }
        c.comments = { ...(c.comments || {}) };
        if (note) c.comments[local.who] = note; else delete c.comments[local.who];

        closeModal($('#gr-modal'));
        paint();
        if (!canBatchGrade && !warnedSlow) {
          warnedSlow = true;
          toast(`Saved ${c.name}. (Interviews backend is a version behind — saves are slower until it's redeployed.)`);
        } else {
          toast(`Saved scores for ${c.name}.`);
        }
      } catch (e2) { showError(err, e2.message); }
      finally { btn.disabled = false; btn.textContent = 'Save scores'; }
    });
  }
};
