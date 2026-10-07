/* ============================================================ Interviews
   Interview day: check candidates in, grade them against the three-part
   rubric, then work the results.
 
   Native ES modules and Supabase; scores belong to immutable member IDs.
============================================================================ */
import { select, update, upsert, insert, remove, rpc, toCandidate } from '../core/db.js';
import { state, myName, isAdmin, termLabel, onSessionReset } from '../core/state.js';
import { shareInterviews } from '../core/vanessa-ui.js';
import { downloadCsv } from '../core/csv.js';
import { takeJumpTarget } from '../core/quicksearch.js';
import {
  $, $$, esc, sameName, toast, showError, debounce, injectStyle,
  openModal, closeModal, wireModal, SEARCH_ICON
} from '../core/ui.js';

import { completion, aggregate, matches, panelProgress } from './interviews/model.js';
import { createAutosave } from './interviews/autosave.js';

const CRIT = [
  { k: 'spk', name: 'Speaking skill',     labels: ["Can't speak", 'Meh', 'Average', 'Above avg', 'Ready for a tour'] },
  { k: 'per', name: 'Personable',         labels: ['Nothing there', 'Meh', 'Average', 'Above avg', 'Love listening'] },
  { k: 'imp', name: 'Overall impression', labels: ["Wouldn't hire", 'Meh', 'Average', 'Above avg', 'Need to hire'] }
];
const DECISIONS = ['', 'Yes', 'Maybe', 'No'];

/* Spelled to match what the roster parser recognises in a pasted sheet, so a
   hand-added candidate and an imported one read the same on the sheet. */
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];

let data = null;                 // { cycle, groups, interviewers, candidates[] }

/** What this tab has loaded, for the Today screen. Null until it has run. */
let sharedData = null;
export const interviewData = () => sharedData;
let nameOf = new Map();          // member id -> full name
const candidateWrites = new Set();
let pending = [];                // parsed roster rows awaiting Add/Replace
/* No `who` any more. The old app made each interviewer pick their own name from
   a dropdown, which is how scores could be filed under the wrong person and why
   removing an interviewer left a tab grading as a ghost. You are whoever signed
   in, and the database refuses a score written under anyone else's name. */
const local = { tab: 'grade', search: '', group: '', decision: '',
                decFilter: '__undecided', target: null, detail: null,
                sort: 'final', sortAsc: false, status: '', queue: [] };

injectStyle('gr-css', `
#gr-tabs { overflow-x:auto; flex-wrap:nowrap; }
#gr-tabs .tab { white-space:nowrap; }
.gr-crit { border:0; padding:0; min-width:0; }
.gr-crit legend { font-weight:600; margin-bottom:10px; font-size:.9rem; }
.gr-scale input:focus-visible + label { outline:3px solid var(--text); outline-offset:3px; }
#gr-modal .modal-foot { flex-wrap:wrap; }
#gr-modal .modal { background:#141218; }
#gr-detail .modal { background:#141218; }
#gr-save-state { margin-top:16px; font-size:.85rem; }
#gr-note { min-height:120px; }
@media(max-width:600px) { .gr-cand { flex-wrap:wrap; }.gr-nums { flex-wrap:wrap; }.gr-scale { gap:4px; }.gr-scale label { min-width:0; }.gr-scale label em { overflow-wrap:anywhere; } }

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
.gr-scale input:checked + label b, .gr-scale input:checked + label em { color:var(--accent-text); }
.gr-tbl { width:100%; border-collapse:collapse; font-size:.82rem; }
.gr-tbl th, .gr-tbl td { padding:9px 11px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
.gr-tbl th { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; color:var(--text-faint);
  font-weight:700; background:var(--bg-sunken); position:sticky; top:0; }
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
.gr-sort { cursor:pointer; user-select:none; white-space:nowrap; }
.gr-sort:hover { color:var(--accent); }
.gr-sort.on { color:var(--accent); }
.gr-sort:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
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
.dec-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
.dec-chip { font:inherit; font-size:.82rem; font-weight:600; cursor:pointer;
  border:1px solid var(--line-strong); background:var(--bg-elev); color:var(--text-soft);
  border-radius:999px; padding:7px 14px; transition:all .13s; }
.dec-chip b { font-variant-numeric:tabular-nums; margin-left:3px; }
.dec-chip:hover { border-color:var(--accent); color:var(--text); }
.dec-chip.on { color:#fff; border-color:transparent; }
.dec-chip.on.u { background:var(--text-soft); }
.dec-chip.on.y { background:var(--good); }
.dec-chip.on.m { background:var(--warn); }
.dec-chip.on.n { background:var(--danger); }
.dec-chip.on.a { background:var(--accent); color:var(--accent-text); }

.dec-row { display:flex; align-items:center; gap:14px; padding:12px 15px;
  border-bottom:1px solid var(--line); }
.dec-row:last-child { border-bottom:0; }
.dec-row:hover { background:var(--bg-sunken); }
.dec-score { font-size:1.15rem; font-weight:700; font-variant-numeric:tabular-nums;
  width:52px; flex:none; text-align:center; color:var(--accent); }
.dec-score.none { color:var(--text-faint); font-weight:500; }
.dec-main { flex:1; min-width:0; display:grid; gap:1px; }
.dec-name { font-size:.94rem; font-weight:650; }
.dec-raters { font-size:.72rem; color:var(--text-faint); }
.dec-pick { display:flex; gap:5px; flex:none; }
.dec-btn { font:inherit; font-size:.8rem; font-weight:600; cursor:pointer; min-width:60px;
  border:1px solid var(--line-strong); background:var(--bg-elev); color:var(--text-soft);
  border-radius:var(--radius-sm); padding:8px 10px; transition:all .12s; }
.dec-btn:hover { border-color:var(--text-soft); color:var(--text); }
.dec-btn.on { color:#fff; border-color:transparent; }
.dec-btn.yes.on   { background:var(--good); }
.dec-btn.maybe.on { background:var(--warn); }
.dec-btn.no.on    { background:var(--danger); }

@media (max-width:620px) {
  .dec-row { flex-wrap:wrap; gap:9px; }
  .dec-main { flex:1 1 60%; }
  .dec-pick { flex:1 1 100%; }
  .dec-btn { flex:1; }
}
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

function averages(c) { return aggregate(c.scores); }

const fmt = v => (v === null ? '—' : v.toFixed(2));

/** "Sophomore · grad May 2029 · Marketing" — whichever parts we actually have. */
function subLine(c) {
  return [c.year, c.grad ? 'grad ' + c.grad : '', c.major].filter(Boolean).join(' · ');
}
const isIn = c => String(c.checkin || '').trim().toLowerCase() === 'yes';

function filtered(list) {
  const q = local.search.trim().toLowerCase();
  return list.filter(c => {
    if (!matches(c, q)) return false;
    if (local.tab === 'checkin' && local.group && c.group !== local.group) return false;
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
  // PUID is matched by heading only, never by content: a ten-digit column could as
  // easily be a phone number. Claiming it here also keeps it away from the year and
  // major detectors, which is how PUIDs ended up in the year field once before.
  ['puid',  [/puid/i, /purdue\s*id/i, /student\s*id/i]],
  ['name',  [/full name/i, /^name$/i, /your name/i, /candidate/i]],
  ['email', [/e-?mail/i]],
  ['grad',  [/graduation/i, /grad (date|year|month)/i, /expected graduation/i]],
  ['year',  [/year in school/i, /^year$/i, /class standing/i, /classification/i]],
  ['major', [/major/i, /program of study/i]]
];

/* Content signatures, used when a heading doesn't say what the column holds.
   The responses sheet has had its "Year in School" heading overwritten with
   "Column 5" before now, which silently pushed PUIDs into the year field — so
   don't rely on headings alone. */
const LOOKS_LIKE = {
  year:  v => /^(freshman|sophomore|junior|senior|grad(uate)?|1st|2nd|3rd|4th)\b/i.test(v),
  grad:  v => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}/i.test(v)
              || /^(spring|fall|summer|winter)\s*'?\d{2,4}/i.test(v),
  email: v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v),

  /* Major has no distinctive shape, so it's found by elimination: short prose,
     no digits, no @. The length ceiling keeps it away from the long
     "other campus involvements" answers, which otherwise look identical. */
  major: v => v.length >= 3 && v.length <= 60
              && /[A-Za-z]/.test(v)
              && !/\d/.test(v)
              && !/@/.test(v)
              && v.split(/\s+/).length <= 8
};

/**
 * How often a column's non-empty values match a signature.
 *
 * One row is enough to decide. Pasting a single late applicant is a normal thing
 * to do, and demanding two rows meant that paste matched nothing at all.
 */
function columnLooksLike(rows, col, test) {
  let seen = 0, hits = 0;
  for (const r of rows) {
    const v = (r[col] || '').trim();
    if (!v) continue;
    seen++;
    if (test(v)) hits++;
  }
  return seen >= 1 && hits / seen >= 0.7;
}

function detectColumns(header, body, reserved, skipMajor) {
  const found = {};
  const used = new Set();
  if (reserved !== undefined) used.add(reserved);

  // 1. by heading
  for (const [field, patterns] of COLUMN_HINTS) {
    for (const re of patterns) {
      const i = header.findIndex((h, idx) => {
        if (used.has(idx) || !re.test(h)) return false;
        // "Graduation Month and Year" must never be taken for year in school
        if (field === 'year' && /graduat/i.test(h)) return false;
        return true;
      });
      if (i !== -1) { found[field] = i; used.add(i); break; }
    }
  }

  // 2. by what the column actually contains, for anything still missing.
  //    Order matters: the distinctive shapes claim their columns first, so major
  //    — the loosest test — only ever sees what's left over.
  if (body && body.length) {
    const wanted = skipMajor ? ['year', 'grad', 'email'] : ['year', 'grad', 'email', 'major'];
    for (const field of wanted) {
      if (found[field] !== undefined) continue;

      const fits = [];
      for (let c = 0; c < header.length; c++) {
        if (used.has(c)) continue;
        if (columnLooksLike(body, c, LOOKS_LIKE[field])) fits.push(c);
      }
      if (!fits.length) continue;

      // Several columns can read like a major (name does too). Prefer the one
      // just after whatever we already identified, which is how these forms run.
      let pick = fits[0];
      if (field === 'major') {
        const anchor = Math.max(
          found.grad ?? -1, found.year ?? -1, found.email ?? -1, found.name ?? -1);
        const after = fits.filter(c => c > anchor);
        pick = after.length ? after[0] : fits[fits.length - 1];
      }
      found[field] = pick;
      used.add(pick);
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

  // Try treating row one as headings; if that yields no name column, treat every
  // row as data and identify columns purely by content.
  let header = rows[0];
  let cols = detectColumns(header, rows.slice(1));
  let hasHeader = cols.name !== undefined;
  let body = rows.slice(1);

  if (!hasHeader) {
    body = rows;
    const blank = header.map(() => '');

    // Claim only the unmistakable columns first (year, grad, email). Major is held
    // back deliberately: its test is loose enough to match a person's name, and a
    // paste of one candidate would otherwise lose the name to it.
    const firstPass = detectColumns(blank, body, undefined, true);
    const taken = new Set(Object.values(firstPass));
    let nameCol;
    for (let c = 0; c < header.length; c++) {
      if (taken.has(c)) continue;
      if (columnLooksLike(body, c,
          v => /^[A-Za-z][A-Za-z'.-]*\s+[A-Za-z]/.test(v) && !/@/.test(v) && !/\d/.test(v))) {
        nameCol = c; break;
      }
    }

    cols = detectColumns(blank, body, nameCol);
    if (nameCol !== undefined) cols.name = nameCol;
  }

  const idx = cols;
  const out = [];
  let skipped = 0;

  if (idx.name === undefined) return { rows: [], mapping: idx, header: null, skipped: rows.length };

  for (const r of body) {
    const name = (r[idx.name] || '').trim();
    if (!name) { skipped++; continue; }
    const pick = f => (idx[f] !== undefined ? r[idx[f]] : '') || '';
    out.push({ name, puid: pick('puid'), year: pick('year'), grad: pick('grad'),
               major: pick('major'), email: pick('email') });
  }

  return { rows: out, mapping: idx, header: hasHeader ? header : null, skipped };
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
        <input type="checkbox" class="gr-in" ${candidateWrites.has(c.key) ? 'disabled' : ''} data-key="${esc(c.key)}" ${isIn(c) ? 'checked' : ''}>
        <span class="gr-main">
          <span class="gr-name">${esc(c.name)}</span>
          <span class="gr-sub">${esc(subLine(c))}${
            c.group ? (subLine(c) ? ' · ' : '') + groupTag(c.group) : ''}</span>
        </span>
      </label>`).join('') : '<div class="empty"><div class="empty-mark">🔍</div><p>No candidates match.</p></div>'}
    </div>`;
}

function gradeView() {
  const candidates = data.candidates.filter(isIn);
  const mine = c => completion(c.scores?.[state.me.id], c.comments?.[state.me.id]);
  const done = candidates.filter(c => mine(c).status === 'Complete').length;
  const list = filtered(candidates).filter(c => !local.status || mine(c).status === local.status);
  return `<div class="gr-bar">
    <span class="muted">Evaluating as <strong>${esc(myName())}</strong></span>
    <label class="search">${SEARCH_ICON}<input aria-label="Find a candidate" type="search" id="gr-search" placeholder="Find a candidate…" value="${esc(local.search)}"></label>
    <select id="gr-status" class="select" aria-label="Evaluation status">${['', 'Not Started', 'In Progress', 'Complete'].map(x => `<option ${x === local.status ? 'selected' : ''} value="${x}">${x || 'All evaluations'}</option>`).join('')}</select>
    <span class="muted">${done} / ${candidates.length} complete · ${candidates.length - done} remaining</span>
    </div><p class="hint">Check candidates in to make them available here. All three scores are required for completion; comments are optional.</p>
    <div class="panel">${list.length ? list.map(c => {
      const status = mine(c), draft = saver?.entries.get(c.key);
      return `<button class="gr-cand" data-grade="${esc(c.key)}">
        <span class="gr-main"><span class="gr-name">${esc(c.name)}</span><br><span class="gr-sub">${esc(c.group || '')}</span></span>
        <span class="gr-num">${draft?.dirty ? 'Unsaved changes' : status.status}</span>
        <span class="gr-sub">${status.missing.length ? `${status.missing.length} score${status.missing.length === 1 ? '' : 's'} remaining` : '3 / 3 scored'}</span>
      </button>`;
    }).join('') : `<div class="empty"><p>${data.candidates.length ? 'No checked-in candidates match this view.' : 'No interview candidates have been added yet.'}</p></div>`}</div>`;
}

/* Which column the Results table is sorted by. Final score descending is the
   right default — it is the question the room is usually asking — but "who has
   nobody scored yet" and "show me the strong speakers" are real questions too,
   and re-sorting by hand in a spreadsheet afterwards defeats the point of the
   table being here. */
const RESULT_COLS = {
  name:   { label: 'Name',    get: r => r.c.name || '',      text: true },
  group:  { label: 'Group',   get: r => r.c.group || '',     text: true },
  year:   { label: 'Year',    get: r => r.c.year || '',      text: true },
  grad:   { label: 'Grad',    get: r => r.c.grad || '',      text: true },
  raters: { label: 'Complete', get: r => panelProgress(r.c, data.panel).complete },
  spk:    { label: 'Speak',   get: r => r.t.spk ?? -1 },
  per:    { label: 'Person',  get: r => r.t.per ?? -1 },
  imp:    { label: 'Impress', get: r => r.t.imp ?? -1 },
  final:  { label: 'Final',   get: r => r.t.final ?? -1 }
};

function sortResults(rows) {
  const key = local.sort || 'final';
  const col = RESULT_COLS[key] || RESULT_COLS.final;
  const dir = local.sortAsc ? 1 : -1;
  return rows.sort((a, b) => col.text
    ? String(col.get(a)).localeCompare(String(col.get(b))) * dir
    : (col.get(a) - col.get(b)) * dir);
}

const sortableHead = () => Object.entries(RESULT_COLS).map(([k, c]) => {
  const on = (local.sort || 'final') === k;
  const arrow = on ? (local.sortAsc ? ' ▲' : ' ▼') : '';
  return `<th class="gr-sort${on ? ' on' : ''}" data-sort="${k}" role="button" tabindex="0"
    aria-sort="${on ? (local.sortAsc ? 'ascending' : 'descending') : 'none'}"
    title="Sort by ${c.label}">${c.label}${arrow}</th>`;
}).join('');

/* The record of a hiring decision, and until now it existed only inside the
   database. One bad afternoon and there is no copy. Includes each criterion
   and the rater count, because a final score with no workings behind it is not
   much use to whoever inherits the file. */
function exportResults() {
  let rows = filtered(data.candidates).map(c => ({ c, t: averages(c) }));
  if (local.decision) rows = rows.filter(r => (r.c.decision || '') === local.decision);
  sortResults(rows);

  const head = ['Name', 'Group', 'Year', 'Grad', 'Major', 'Email',
                'Raters', 'Speaking', 'Personable', 'Impression', 'Final', 'Decision', 'Completed evaluations', 'Expected panel evaluations'];
  const body = rows.map(({ c, t }) => [
    c.name, c.group || '', c.year || '', c.grad || '', c.major || '', c.email || '',
    t.raters, fmt(t.spk), fmt(t.per), fmt(t.imp), fmt(t.final), c.decision || '', panelProgress(c, data.panel).complete, data.panel.length || 'Not configured'
  ]);
  toast(`Downloaded ${downloadCsv('interview-results', [head, ...body])} candidates.`);
}

function resultsView() {
  let rows = filtered(data.candidates).map(c => ({ c, t: averages(c) }));
  if (local.decision) rows = rows.filter(r => (r.c.decision || '') === local.decision);
  sortResults(rows);

  return `
    <div class="gr-bar">
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search" placeholder="Find a candidate…" value="${esc(local.search)}"></label>
      <select class="select" id="gr-decision">
        <option value="">All decisions</option>
        ${['Yes', 'Maybe', 'No'].map(d => `<option value="${d}" ${local.decision === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="gr-copy">Copy emails (${rows.length})</button>
      <button class="btn btn-ghost btn-sm" id="gr-refresh-results">Refresh results</button>
      <button class="btn btn-ghost btn-sm" id="gr-export" title="Download aggregate results">Download CSV</button>
    </div>
    ${data.candidates.some(c => c.sample) ? '<p class="callout">These results include fictional sample data. An administrator can remove it in Setup.</p>' : ''}
    <p class="hint">Final = mean of the three criterion averages (blank scores ignored). Partial evaluations contribute. Equal scores stay tied; sorting adds no tie-breaker.</p>
    <div class="gr-wrap"><table class="gr-tbl">
      <thead><tr>${sortableHead()}<th>Decision</th></tr></thead>
      <tbody>${rows.length ? rows.map(({ c, t }) => `
        <tr class="gr-clickrow" data-open="${esc(c.key)}">
          <td><button class="btn btn-quiet btn-sm" data-open="${esc(c.key)}">${esc(c.name)}</button><br><span class="gr-sub">${esc(c.major || '')}</span></td>
          <td>${groupTag(c.group)}</td>
          <td>${esc(c.year || '')}</td>
          <td>${esc(c.grad || '')}</td>
          <td class="num">${completionLabel(c)}<br><span class="gr-sub">${t.raters} scored</span></td>
          <td class="num">${fmt(t.spk)}</td>
          <td class="num">${fmt(t.per)}</td>
          <td class="num">${fmt(t.imp)}</td>
          <td class="num"><strong>${fmt(t.final)}</strong></td>
          <td data-noopen><select class="gr-dec" aria-label="Decision for ${esc(c.name)}" ${candidateWrites.has(c.key) ? 'disabled' : ''} data-dec="${esc(c.key)}" data-v="${esc(c.decision || '')}">
            ${DECISIONS.map(d => `<option value="${d}" ${(c.decision || '') === d ? 'selected' : ''}>${d || '—'}</option>`).join('')}
          </select></td>
        </tr>`).join('') : '<tr><td colspan="10"><div class="empty"><p>No candidates match.</p></div></td></tr>'}
      </tbody>
    </table></div>`;
}

function decisionsView() {
  let rows = filtered(data.candidates).map(c => ({ c, t: averages(c) }));

  const counts = {
    yes:   data.candidates.filter(c => c.decision === 'Yes').length,
    maybe: data.candidates.filter(c => c.decision === 'Maybe').length,
    no:    data.candidates.filter(c => c.decision === 'No').length
  };
  counts.undecided = data.candidates.length - counts.yes - counts.maybe - counts.no;

  if (local.decFilter === '__undecided') rows = rows.filter(r => !String(r.c.decision || '').trim());
  else if (local.decFilter) rows = rows.filter(r => (r.c.decision || '') === local.decFilter);

  // Best-scored first; anyone ungraded drops to the bottom rather than the top.
  rows.sort((a, b) => (b.t.final ?? -1) - (a.t.final ?? -1));

  const chip = (val, label, n, cls) =>
    `<button class="dec-chip ${cls} ${local.decFilter === val ? 'on' : ''}" data-filter="${val}">
       ${label} <b>${n}</b></button>`;

  return `
    <div class="dec-bar">
      ${chip('__undecided', 'Undecided', counts.undecided, 'u')}
      ${chip('Yes', 'Yes', counts.yes, 'y')}
      ${chip('Maybe', 'Maybe', counts.maybe, 'm')}
      ${chip('No', 'No', counts.no, 'n')}
      ${chip('', 'All', data.candidates.length, 'a')}
    </div>

    <div class="filters" style="margin-bottom:14px">
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search"
        placeholder="Find a candidate…" value="${esc(local.search)}"></label>
      <button class="btn btn-ghost btn-sm" id="gr-copy">Copy emails (${rows.length})</button>
    </div>

    ${rows.length ? `<div class="panel">${rows.map(({ c, t }) => `
      <div class="dec-row">
        <span class="dec-score ${t.final === null ? 'none' : ''}">${t.final === null ? '—' : t.final.toFixed(2)}</span>
        <span class="dec-main">
          <span class="dec-name">${esc(c.name)}</span>
          <span class="gr-sub">${esc(subLine(c))}${c.group ? (subLine(c) ? ' · ' : '') + groupTag(c.group) : ''}</span>
          <span class="dec-raters">${t.raters ? t.raters + ' rater' + (t.raters === 1 ? '' : 's') : 'not graded yet'}</span>
        </span>
        <span class="dec-pick" data-key="${esc(c.key)}">
          ${['Yes', 'Maybe', 'No'].map(d =>
            `<button class="dec-btn ${d.toLowerCase()} ${c.decision === d ? 'on' : ''}"
                     data-set="${d}" ${candidateWrites.has(c.key) ? 'disabled' : ''} title="Mark ${esc(c.name)} as ${d}">${d}</button>`).join('')}
        </span>
      </div>`).join('')}</div>`
      : `<div class="empty"><div class="empty-mark">${counts.undecided === 0 ? '✅' : '🔍'}</div>
         <p>${counts.undecided === 0 && !local.decision
              ? 'Every candidate has a decision.'
              : 'Nobody matches that filter.'}</p></div>`}`;
}

/**
 * The whole roster, one row each, with everything held about a person — including
 * the PUID, which nothing else on screen shows. Admin-only: this is where people
 * get taken off, and that takes their scores with them.
 */
function rosterView() {
  const rows = filtered(data.candidates);
  const cell = v => esc(v || '') || '<span class="muted">—</span>';

  return `
    <div class="gr-bar">
      <label class="search">${SEARCH_ICON}<input type="search" id="gr-search"
        placeholder="Search name, major or email…" value="${esc(local.search)}" autocomplete="off"></label>
      <span class="muted">${rows.length} of ${data.candidates.length} on the roster</span>
    </div>

    ${rows.length ? `<div class="gr-wrap"><table class="gr-tbl">
      <thead><tr>
        <th>Name</th><th>Year</th><th>Major</th><th>PUID</th>
        <th>Email</th><th>Group</th><th class="num">Ratings</th><th></th>
      </tr></thead>
      <tbody>${rows.map(c => {
        const n = Object.keys(c.scores || {}).length;
        if (n || saver?.entries.get(c.key)?.dirty) return toast('This applicant has an evaluation or unsaved changes and cannot be removed.', 'err');
        return `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${cell(c.year)}</td>
          <td>${cell(c.major)}</td>
          <td class="num">${cell(c.puid)}</td>
          <td>${cell(c.email)}</td>
          <td>${c.group ? groupTag(c.group) : '<span class="muted">—</span>'}</td>
          <td class="num">${n || '<span class="muted">—</span>'}</td>
          <td><button class="btn btn-quiet btn-sm" data-remove="${esc(c.key)}"
                aria-label="Remove ${esc(c.name)} from the roster"
                title="Remove from the roster">✕</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`
    : `<div class="empty"><div class="empty-mark">${local.search ? '🔍' : '👥'}</div>
       <p>${local.search ? 'Nobody matches that search.' : 'Nobody on the roster yet — add people in Setup.'}</p></div>`}

    <p class="hint" style="margin-top:11px">Only applicants without recorded evaluations can be removed. To add a candidate, use <strong>Setup</strong>.</p>`;
}

function setupView() {
  const sampleCount = data.candidates.filter(c => c.sample).length;
  return `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h3>Try Interviews with sample data</h3></div>
      <div style="padding:15px;display:grid;gap:12px">
        <p class="hint">Load three clearly labeled fictional applicants into this cycle. They are checked in, with one unstarted, one partial, and one complete evaluation under your account. Real applicants and scores stay untouched. Samples are visible to Recruitment and included in results until removed.</p>
        <p class="hint">${sampleCount} sample applicants currently loaded. Repeating the import keeps existing samples and your edits.</p>
        <div class="gr-bar"><button class="btn btn-ghost" id="gr-load-samples" ${data.cycleId ? '' : 'disabled'}>Load sample data</button>
        <button class="btn btn-quiet" id="gr-remove-samples" ${sampleCount ? '' : 'disabled'}>Remove sample data</button></div>
      </div>
    </div>

    <div class="callout"><strong>Applicant and panel setup</strong>
      Recorded evaluations are protected. Removing a panel assignment never removes that person’s scores.</div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Cycle &amp; interviewers</h3></div>
      <div style="padding:15px;display:grid;gap:13px">
        <label class="field"><span>Cycle label</span><input id="gr-cycle" readonly value="${esc(data.cycle || '')}"></label>

        <label class="field"><span>Groups — one per line</span>
          <textarea id="gr-groups" rows="4">${esc((data.groups || []).join('\n'))}</textarea></label>
        <p class="hint">Candidates are dealt into these groups evenly as they're imported.
          Changing them here only affects <em>future</em> imports — anyone already on the roster
          keeps the group they were given.</p>

        <fieldset><legend>Expected interviewers</legend>
          ${data.members.filter(m => m.active || data.panel.includes(m.id)).map(m => `<label style="display:block;padding:6px"><input type="checkbox" data-panel="${esc(m.id)}" ${data.panel.includes(m.id) ? 'checked' : ''}> ${esc(m.full_name)}${m.active ? '' : ' (inactive)'}</label>`).join('')}
        </fieldset><p class="hint">Choose the expected panel for completion counts. Assignments do not grant access; Recruitment permissions are managed in Members. Historical scores remain even if a person leaves the panel.</p>

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
        <p class="hint">Paste straight from the Google Form responses sheet — with or without the
          header row, in any column order, one applicant or all of them. Columns are worked out from
          their headings and from what they contain, so the ones you don't need (timestamp,
          involvements) are ignored. A column headed PUID, Purdue ID or Student ID is picked up. Long multi-line answers won't break the rows.</p>

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
              <em>Replaces this cycle’s unscored applicants atomically. Unavailable once any evaluation or comment has been recorded.</em>
            </div>
            <button class="btn btn-danger" id="gr-import">Replace <span id="gr-n-rep"></span></button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Add one candidate</h3></div>
      <div style="padding:15px;display:grid;gap:13px">
        <p class="hint">For a single late applicant. To load a batch, paste them in above.</p>

        <label class="field"><span>Name</span>
          <input id="gr-one-name" autocomplete="off" placeholder="First Last"></label>

        <div class="row2">
          <label class="field"><span>Year in school</span>
            <select id="gr-one-year">
              <option value="">—</option>
              ${YEARS.map(y => `<option>${y}</option>`).join('')}
            </select></label>
          <label class="field"><span>Major</span>
            <input id="gr-one-major" autocomplete="off" placeholder="e.g. Mechanical Engineering"></label>
        </div>

        <div class="row2">
          <label class="field"><span>PUID</span>
            <input id="gr-one-puid" autocomplete="off" inputmode="numeric" placeholder="0012345678"></label>
          <label class="field"><span>Email</span>
            <input id="gr-one-email" type="email" autocomplete="off" placeholder="name@purdue.edu"></label>
        </div>

        <p class="hint">Only the name is required — the rest can be filled in later from
          your source roster. They join the group rotation like any other import.</p>
        <p class="form-error" id="gr-one-error" hidden></p>

        <div><button class="btn btn-primary" id="gr-one-add">Add candidate</button></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Danger zone</h3></div>
      <div style="padding:15px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-danger" id="gr-clear-roster">Clear roster</button>
        
      </div>
    </div>`;
}

let saver = null;
let owner = null;
let mounted = false;
const personLabel = id => {
  const name = nameOf.get(id);
  if (!name) return `Former interviewer (${id})`;
  const duplicate = [...nameOf.values()].filter(n => n === name).length > 1;
  return name + (duplicate ? ` (ID ${id.slice(-8)})` : '');
};
function completionLabel(c) {
  const p = panelProgress(c, data.panel);
  return p.expected ? `${p.complete} / ${p.expected} complete` : `${Object.values(c.scores).filter(s => completion(s).status === 'Complete').length} complete · panel not set`;
}
function share() {
  // Keep the established Vanessa read-only shape; identity remains ID-based here.
  const labels = new Map([...nameOf].map(([id, name]) => [id, id !== state.me?.id && [...nameOf.values()].filter(n => n === name).length > 1 ? `${name} (${id})` : name]));
  sharedData = { ...data, interviewers: data.interviewers.map(id => labels.get(id) || personLabel(id)), candidates: data.candidates.map(c => ({ ...c, ...aggregate(c.scores),
    scores: Object.fromEntries(Object.entries(c.scores).map(([id, value]) => [labels.get(id) || personLabel(id), value])),
    comments: Object.fromEntries(Object.entries(c.comments).map(([id, value]) => [labels.get(id) || personLabel(id), value])) })) };
  shareInterviews(sharedData);
}
function ensureSaver() {
  if (saver && owner === `${state.me?.id}:${data.cycleId}`) {
    for (const c of data.candidates) { const e = saver.get(c.key, { scores: c.scores[state.me.id] || {}, note: c.comments[state.me.id] || '' }); if (!e.dirty) e.value = { scores: c.scores[state.me.id] || {}, note: c.comments[state.me.id] || '' }; }
    return;
  }
  saver?.stop(); owner = `${state.me?.id}:${data.cycleId}`;
  const actor = state.me?.id, version = state.sessionVersion;
  let storage; try { storage = sessionStorage; } catch { /* private browser */ }
  saver = createAutosave({ storage, namespace: `hub.interviews.${actor}.${data.cycleId}.`,
    write: async (id, value) => {
      if (state.me?.id !== actor || state.sessionVersion !== version || !state.role?.in_recruitment) throw new Error('Session changed');
      const row = { candidate_id: id, interviewer_id: actor, speaking: value.scores.spk ?? null,
        personable: value.scores.per ?? null, impression: value.scores.imp ?? null, note: value.note || null,
        updated_at: new Date().toISOString() };
      const result = await upsert('interview_scores', row, 'candidate_id,interviewer_id');
      if (state.me?.id !== actor || state.sessionVersion !== version || !Array.isArray(result) || result.length !== 1 ||
          Object.entries(row).some(([k, v]) => k !== 'updated_at' && result[0][k] !== v)) throw new Error('Save not verified');
      const c = data?.candidates.find(c => c.key === id);
      if (c) { c.scores[actor] = { ...value.scores }; c.comments[actor] = value.note; share(); }
    }, changed: () => {
      if (!mounted || state.me?.id !== actor) return;
      updateSaveState();
      if ($('#gr-modal')?.hidden) paint();
    }
  });
  for (const c of data.candidates) saver.get(c.key, { scores: c.scores[actor] || {}, note: c.comments[actor] || '' });
}
function flushCurrent() {
  const entry = saver?.entries.get(local.target?.key);
  if (entry && entry.state !== 'recovered') void saver.flush(entry.id);
}
function updateSaveState() {
  const e = saver?.entries.get(local.target?.key), el = $('#gr-save-state');
  if (!e || !el) return;
  const current = completion(e.value.scores, e.value.note);
  const messages = { saved: 'Saved', pending: 'Waiting to save…', saving: 'Saving…', error: "Your evaluation couldn’t be saved. Your entry is still here. Try again.", recovered: 'Recovered unsaved changes. Review them, then choose Retry save.' };
  el.textContent = (e.state === 'saved' && current.status === 'Not Started' ? 'No changes to save' : messages[e.state]) + (e.dirty && !e.durable ? ' Keep this tab open until saving succeeds.' : '');
  $('#gr-completion').textContent = current.missing.length ? `${current.missing.length} ${current.missing.length === 1 ? 'criterion still needs a score' : 'criteria still need scores'}: ${current.missing.map(k => CRIT.find(c => c.k === k).name).join(', ')}.` : e.dirty ? 'All criteria scored · waiting for save' : 'Complete · all 3 criteria saved';
  $('#gr-g-save').textContent = e.state === 'error' || e.state === 'recovered' ? 'Retry save' : 'Save now';
  $('#gr-g-save').disabled = !e.dirty || e.state === 'saving';
}
window.addEventListener('beforeunload', event => { if (saver?.pending()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => saver?.flushAll());
onSessionReset(() => { saver?.stop(); saver = null; owner = null; data = null; local.target = null; local.detail = null; local.tab = 'grade'; local.search = ''; sharedData = null; shareInterviews(null); });

/**
 * Adds candidates to the current cycle, dealing them into the interview groups
 * in turn exactly as the old importer did.
 */
async function importCandidates(rows, replace) {
  const cycles = await select('interview_cycles', 'select=id&is_current=eq.true&limit=1');
  const cycleId = cycles[0].id;


  const groups = data.groups || [];
  const base = replace ? 0 : (data.candidates || []).length;
  const records = rows.map((p, i) => ({
    cycle_id:   cycleId,
    name:       p.name,
    puid:       p.puid  || null,
    year:       p.year  || null,
    grad:       p.grad  || null,
    major:      p.major || null,
    email:      p.email || null,
    group_name: groups.length ? groups[(base + i) % groups.length] : null
  }));
  if (replace) await rpc('interview_replace_unscored', { p_cycle: cycleId, p_rows: records });
  else await insert('candidates', records);
}

/* ---------------------------------------------------------------- breakdown */

/** Match score RLS: even admins may only clear their own evaluation. */
function canClear(who) { return who === state.me?.id; }

function renderDetail(c) {
  const t = averages(c);
  const graded = Object.keys(c.scores || {}).filter(w => Object.values(c.scores[w]).some(v => v != null) || c.comments?.[w]);
  const pending = panelProgress(c, data.panel).missing;

  const avg = s => {
    const v = [s.spk, s.per, s.imp].filter(x => x !== null && x !== undefined);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—';
  };

  return `
    <p class="hint">${completionLabel(c)}. Partial scores are included in the averages.</p>
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
          <td><span class="gr-who">${esc(personLabel(w))}</span></td>
          <td class="n">${sc.spk ?? '—'}</td>
          <td class="n">${sc.per ?? '—'}</td>
          <td class="n">${sc.imp ?? '—'}</td>
          <td class="n"><strong>${avg(sc)}</strong></td>
          <td class="act">${canClear(w)
            ? `<button class="btn btn-quiet btn-sm" data-clear="${esc(w)}" title="Clear your rating">Clear</button>`
            : ''}</td>
        </tr>
        ${note ? `<tr class="noterow"><td colspan="6"><div class="gr-note">${esc(note)}</div></td></tr>` : ''}`;
      }).join('')}</tbody>
    </table>` : '<p class="hint">Nobody has graded this candidate yet.</p>'}

    ${pending.length ? `<p class="hint" style="margin-top:11px">Incomplete or missing evaluations from
      <strong>${esc(pending.map(personLabel).join(', '))}</strong>.</p>` : ''}`;
}

function openDetail(c) {
  local.detail = c;
  $('#gr-d-name').textContent = c.name;
  $('#gr-d-sub').innerHTML = [
    esc(subLine(c)),
    c.group ? groupTag(c.group) : ''
  ].filter(Boolean).join(' · ');
  $('#gr-d-body').innerHTML = renderDetail(c);
  openModal($('#gr-detail'));
  $('#gr-d-name').tabIndex = -1;
  $('#gr-d-name').focus();
}

/* ---------------------------------------------------------------- grading modal */

function openGrade(c) {
  if (local.target && local.target.key !== c.key) flushCurrent();
  local.target = c;
  const draft = saver.get(c.key, { scores: c.scores[state.me.id] || {}, note: c.comments[state.me.id] || '' });
  const s = draft.value.scores;
  $('#gr-g-name').textContent = c.name;
  $('#gr-g-sub').textContent = [subLine(c), c.group].filter(Boolean).join(' · ');
  $('#gr-g-body').innerHTML = CRIT.map(cr => `
    <fieldset class="gr-crit"><legend>${cr.name} · 1–5 required</legend>
      <div class="gr-scale">${[1, 2, 3, 4, 5].map(n => `
        <input type="radio" name="gr-${cr.k}" id="gr-${cr.k}-${n}" value="${n}" ${s[cr.k] === n ? 'checked' : ''}>
        <label for="gr-${cr.k}-${n}"><b>${n}</b><em>${esc(cr.labels[n - 1])}</em></label>`).join('')}
      </div>
    </fieldset>`).join('') +
    `<label class="field"><span>Comments (optional · visible to Recruitment)</span><textarea id="gr-note" rows="5">${esc(draft.value.note)}</textarea></label>`;
  $('#gr-g-error').hidden = true;
  updateSaveState();
  const queue = local.queue.map(id => data.candidates.find(c => c.key === id)).filter(Boolean);
  const position = queue.findIndex(x => x.key === c.key);
  $('#gr-prev-candidate').disabled = position <= 0;
  $('#gr-next-candidate').disabled = position < 0 || position >= queue.length - 1;
  if ($('#gr-modal').hidden) openModal($('#gr-modal'));
}

/* ---------------------------------------------------------------- module */

/**
 * Current-cycle candidates and panel; historical evaluator IDs stay attached to scores.
 * Results refresh is explicit; score saves update only the confirmed candidate row.
 */
async function refresh() {
  const version = state.sessionVersion;
  const cycles = await select('interview_cycles', 'select=*&is_current=eq.true&limit=1');
  const cycle = cycles?.[0];
  const [cands, rawScores, members, groups, panel, samples] = cycle ? await Promise.all([
    select('candidate_results', `select=*&cycle_id=eq.${cycle.id}&order=name.asc`),
    select('interview_scores', 'select=*'),
    select('members', 'select=id,full_name,active&order=full_name.asc'),
    select('interview_groups', `select=name&cycle_id=eq.${cycle.id}&order=sort_order.asc`),
    select('interview_panel', `select=member_id&cycle_id=eq.${cycle.id}`),
    select('interview_samples', `select=candidate_id&cycle_id=eq.${cycle.id}`)
  ]) : [[], [], [], [], [], []];
  if (version !== state.sessionVersion) throw new Error('Account changed.');
  nameOf = new Map(members.map(m => [m.id, m.full_name]));
  const sampleIds = new Set(samples.map(s => s.candidate_id));
  const candidates = cands.map(row => ({ ...toCandidate(row), sample: sampleIds.has(row.id) })), byKey = new Map(candidates.map(c => [c.key, c]));
  for (const r of rawScores) {
    const c = byKey.get(r.candidate_id); if (!c) continue;
    c.scores[r.interviewer_id] = { spk: r.speaking, per: r.personable, imp: r.impression };
    c.comments[r.interviewer_id] = r.note || '';
  }
  data = { cycle: cycle?.label || termLabel(), cycleId: cycle?.id || '', groups: groups.map(g => g.name),
    interviewers: [...new Set([...panel.map(m => m.member_id), ...rawScores.filter(r => byKey.has(r.candidate_id)).map(r => r.interviewer_id)])],
    panel: panel.map(m => m.member_id), members, candidates };
  share();
  if (local.group && !data.groups.includes(local.group)) local.group = '';
}

/**
 * Redraws the current tab.
 *
 * Everything on the tab is rebuilt, INCLUDING the search box, so whatever you
 * were typing in is thrown away and replaced mid-keystroke. Left alone that
 * makes search unusable: you type one letter, the box you are typing in
 * vanishes, and the second letter goes nowhere.
 *
 * So note what had focus and where the cursor was, and put it back afterwards.
 */
function paint() {
  if (!data || !mounted) return;
  share();
  const active = document.activeElement;
  const keep = active && active.id && $('#gr-body')?.contains(active)
    ? { id: active.id,
        start: active.selectionStart ?? null,
        end: active.selectionEnd ?? null }
    : null;

  $$('#gr-tabs .tab').forEach(t => { const selected = t.dataset.tab === local.tab; t.classList.toggle('is-active', selected); t.id = `gr-tab-${t.dataset.tab}`; t.setAttribute('aria-selected', selected); t.tabIndex = selected ? 0 : -1; });
  try { sessionStorage.setItem('hub.interviews.tab', local.tab); } catch { /* optional */ }
  const body = $('#gr-body');
  body.setAttribute('aria-labelledby', `gr-tab-${local.tab}`);
  if (local.tab === 'checkin') body.innerHTML = checkinView();
  else if (local.tab === 'grade') body.innerHTML = gradeView();
  else if (local.tab === 'results') body.innerHTML = resultsView();
  else if (local.tab === 'decisions') body.innerHTML = decisionsView();
  else if (local.tab === 'roster') body.innerHTML = rosterView();
  else body.innerHTML = setupView();

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.focus();
      // Text inputs keep the caret where it was, so typing carries on mid-word
      // instead of jumping to the end.
      if (keep.start !== null && el.setSelectionRange) {
        try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
      }
    }
  }
}

export default {
  id: 'interviews',
  needs: 'recruitment',
  prefetch: async () => { if (!data) await refresh(); },
  bust: () => { data = null; sharedData = null; shareInterviews(null); },
  unmount: () => { mounted = false; if (saver?.pending()) toast('Interview changes are still pending. Keep this tab open; return to Evaluate to check or retry.', 'err'); void saver?.flushAll(); },
  title: 'Interviews',
  crumb: 'Check-in, grading and results',
  icon: '🎤',
  section: 'Tools',

  async mount(view) {
    mounted = true;
    try { local.tab = sessionStorage.getItem('hub.interviews.tab') || local.tab; } catch { /* optional */ }
    if (!['checkin','grade','results','decisions', ...(isAdmin() ? ['roster','setup'] : [])].includes(local.tab)) local.tab = 'grade';
    view.innerHTML = `
      <nav class="tabs" role="tablist" aria-label="Interviews" id="gr-tabs" style="margin-bottom:16px">
        <button class="tab is-active" role="tab" aria-controls="gr-body" data-tab="checkin">Check in</button>
        <button class="tab" role="tab" aria-controls="gr-body" data-tab="grade">Evaluate</button>
        <button class="tab" role="tab" aria-controls="gr-body" data-tab="results">Results</button>
        <button class="tab" role="tab" aria-controls="gr-body" data-tab="decisions">Decisions</button>
        ${isAdmin() ? '<button class="tab" role="tab" aria-controls="gr-body" data-tab="roster">Applicants</button>' : ''}
        ${isAdmin() ? '<button class="tab" role="tab" aria-controls="gr-body" data-tab="setup">Setup</button>' : ''}
      </nav>
      <div id="gr-body" role="tabpanel" aria-label="Interview content"><div class="loading"><div class="spinner"></div><p>Loading interviews…</p></div></div>

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
          <div class="modal-body"><p id="gr-completion" class="hint" aria-live="polite"></p><div id="gr-g-body"></div><p id="gr-save-state" role="status" aria-live="polite"></p></div>
          <footer class="modal-foot">
            <button type="button" class="btn btn-ghost" id="gr-prev-candidate">Previous</button>
            <button type="button" class="btn btn-ghost" id="gr-next-candidate">Next</button>
            <button type="button" class="btn btn-ghost" data-close>Done</button>
            <button type="submit" class="btn btn-primary" id="gr-g-save">Save now</button>
          </footer>
          <p class="form-error" id="gr-g-error" hidden style="margin:0 18px 14px"></p>
        </form>
      </div>`;

    wireModal($('#gr-modal'));
    // Keep navigation fast; Results exposes an explicit refresh.
    if (!data) await refresh();
    ensureSaver();
    // Sent here by the search box; show that candidate rather than everybody.
    const jump = takeJumpTarget();
    if (jump) { local.search = jump; local.tab = 'results'; }
    paint();

    $('#gr-tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      local.tab = t.dataset.tab;
      paint();
    });

    const body = $('#gr-body');

    /* A sortable heading is a button, so it must answer the keyboard too.
       Declared after `body` on purpose — putting it above the const threw
       "Cannot access 'body' before initialization" and silently killed every
       handler below it, which left the whole Interviews tab inert. */
    body.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const th = e.target.closest?.('.gr-sort');
      if (!th) return;
      e.preventDefault();
      th.click();
    });

    body.addEventListener('input', debounce(e => {
      if (e.target.id === 'gr-search') { local.search = e.target.value; paint(); }
    }));

    body.addEventListener('change', async e => {
      const t = e.target;
      if (t.id === 'gr-status') { local.status = t.value; paint(); return; }

      if (t.id === 'gr-group')    { local.group = t.value; return paint(); }
      if (t.id === 'gr-decision') { local.decision = t.value; return paint(); }

      if (t.classList.contains('gr-in')) {
        // Optimistic: the tick lands immediately and the write happens behind it.
        // Waiting three seconds per person made checking in a queue feel broken,
        // and the write is idempotent, so the worst case is a revert.
        const key = t.dataset.key;
        if (candidateWrites.has(key)) return;
        candidateWrites.add(key);
        const want = t.checked;
        const hadFocus = document.activeElement === t;
        const c = data.candidates.find(x => x.key === key);
        if (c) c.checkin = want ? 'Yes' : '';
        paint();
        // paint() swaps the whole list, so the tick just clicked is a different
        // element now and focus has gone back to the top of the page. Checking a
        // queue of people in by keyboard is unusable that way.
        if (hadFocus) $(`.gr-in[data-key="${key}"]`)?.focus();

        try {
          const result = await update('candidates', `id=eq.${key}`, { checked_in_at: want ? new Date().toISOString() : null });
          if (result?.length !== 1 || result[0].id !== key || !!result[0].checked_in_at !== want) throw new Error('Not verified');
        } catch (err) {
          const back = data.candidates.find(x => x.key === key);
          if (back) back.checkin = want ? '' : 'Yes';     // put it back
          paint();
          toast('Check-in could not be saved. Try again.', 'err');
        } finally { candidateWrites.delete(key); if (mounted) { paint(); if (hadFocus) $(`.gr-in[data-key="${key}"]`)?.focus(); } }
      }

      if (t.classList.contains('gr-dec')) {
        if (candidateWrites.has(t.dataset.dec)) return;
        candidateWrites.add(t.dataset.dec); t.disabled = true;
        const prev = t.dataset.v;
        const c = data.candidates.find(x => x.key === t.dataset.dec);
        if (c) c.decision = t.value;
        t.dataset.v = t.value;                            // colour updates at once
        try {
          const result = await update('candidates', `id=eq.${t.dataset.dec}`,
            { decision: t.value || null, decided_by: state.me.id, decided_at: new Date().toISOString() });
          if (result?.length !== 1 || result[0].id !== t.dataset.dec || (result[0].decision || '') !== t.value) throw new Error('Not verified');
        } catch (err) {
          if (c) c.decision = prev;
          t.value = prev; t.dataset.v = prev;
          toast('That change could not be saved. Your data has not been confirmed; try again.', 'err');
        } finally { candidateWrites.delete(t.dataset.dec); t.disabled = false; }
      }
    });

    wireModal($('#gr-detail'));

    $('#gr-d-body').addEventListener('click', async e => {
      const b = e.target.closest('[data-clear]');
      if (!b || b.dataset.clear !== state.me?.id || !confirm('Clear your scores and comment for this candidate?')) return;
      const c = local.detail;
      saver.get(c.key, { scores: c.scores[state.me.id] || {}, note: c.comments[state.me.id] || '' });
      saver.edit(c.key, { scores: { spk: null, per: null, imp: null }, note: '' });
      await saver.flush(c.key);
      if (mounted && local.detail?.key === c.key) $('#gr-d-body').innerHTML = renderDetail(c);
      if (saver.entries.get(c.key).dirty) toast('Could not clear your evaluation. Retry from Evaluate.', 'err');
    });

    body.addEventListener('click', async e => {
      /* Clicking a column heading sorts by it; clicking the same one again
         reverses. Default direction per column is the useful one: highest
         score first for numbers, A–Z for names. */
      if (e.target.id === 'gr-export') return exportResults();
      if (e.target.id === 'gr-refresh-results') {
        e.target.disabled = true;
        try { await refresh(); ensureSaver(); paint(); } catch { toast('Results could not be refreshed. Try again.', 'err'); e.target.disabled = false; }
        return;
      }

      const th = e.target.closest('.gr-sort');
      if (th) {
        const key = th.dataset.sort;
        if (local.sort === key) local.sortAsc = !local.sortAsc;
        else { local.sort = key; local.sortAsc = !!RESULT_COLS[key]?.text; }
        return paint();
      }

      const openRow = e.target.closest('[data-open]');
      if (openRow && !e.target.closest('[data-noopen]')) {
        const c = data.candidates.find(x => x.key === openRow.dataset.open);
        if (c) return openDetail(c);
      }

      const g = e.target.closest('[data-grade]');
      if (g) {
        const c = data.candidates.find(x => x.key === g.dataset.grade);
        if (c) { local.queue = filtered(data.candidates.filter(isIn)).filter(c => !local.status || completion(c.scores[state.me.id], c.comments[state.me.id]).status === local.status).map(c => c.key); openGrade(c); }
        return;
      }

      const setBtn = e.target.closest('[data-set]');
      if (setBtn) {
        const key = setBtn.closest('[data-key]').dataset.key;
        const c = data.candidates.find(x => x.key === key);
        if (!c) return;
        if (candidateWrites.has(key)) return;
        candidateWrites.add(key);
        // Clicking the current answer clears it, so a misclick is one tap to undo.
        const next = c.decision === setBtn.dataset.set ? '' : setBtn.dataset.set;
        const prev = c.decision || '';

        const hadFocus = document.activeElement === setBtn;
        c.decision = next;      // optimistic, same as check-in
        paint();
        if (hadFocus) $(`[data-key="${key}"] [data-set="${setBtn.dataset.set}"]`)?.focus();
        try {
          const result = await update('candidates', `id=eq.${key}`,
            { decision: next || null, decided_by: state.me.id, decided_at: new Date().toISOString() });
          if (result?.length !== 1 || result[0].id !== key || (result[0].decision || '') !== next) throw new Error('Not verified');
        } catch (err) {
          c.decision = prev;
          paint();
          toast('That decision could not be saved. Try again.', 'err');
        } finally { candidateWrites.delete(key); if (mounted) paint(); }
        return;
      }

      const chip = e.target.closest('[data-filter]');
      if (chip) {
        local.decFilter = chip.dataset.filter;
        paint();
        return;
      }

      if (e.target.id === 'gr-copy') {
        let rows = filtered(data.candidates);
        const f = local.tab === 'decisions' ? local.decFilter : local.decision;
        if (f === '__undecided') rows = rows.filter(c => !String(c.decision || '').trim());
        else if (f) rows = rows.filter(c => (c.decision || '') === f);
        const emails = rows.map(c => c.email).filter(Boolean);
        if (!emails.length) return toast('Nobody in that list has an email address on file.', 'err');
        try {
          await navigator.clipboard.writeText(emails.join(', '));
          const missing = rows.length - emails.length;
          toast(`Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}.` +
                (missing ? ` ${missing} had none on file.` : ''));
        } catch { toast('Could not reach the clipboard.', 'err'); }
        return;
      }

      const rm = e.target.closest('[data-remove]');
      if (rm) {
        if (!isAdmin()) return;
        const c = data.candidates.find(x => x.key === rm.dataset.remove);
        if (!c) return;
        const n = Object.keys(c.scores || {}).length;
        if (n || saver?.entries.get(c.key)?.dirty) return toast('This applicant has an evaluation or unsaved changes and cannot be removed.', 'err');
        if (!confirm(
          `Remove ${c.name} from the roster?` +
          (n ? `\n\nThis also deletes the ${n} rating${n === 1 ? '' : 's'} already given for them.` : '') +
          `\n\nThis cannot be undone from here.`)) return;

        rm.disabled = true;
        try {
          await remove('candidates', `id=eq.${c.key}`);
          await refresh();
          paint();
          toast(`Removed ${c.name}.`);
        } catch (err) { toast('That change could not be saved. Your data has not been confirmed; try again.', 'err'); rm.disabled = false; }
        return;
      }

      /* ---- setup actions (admin only; database also enforces authorization) ---- */
      if (!isAdmin()) return;
      if (e.target.id === 'gr-load-samples' || e.target.id === 'gr-remove-samples') {
        const deleting = e.target.id === 'gr-remove-samples';
        if (saver?.pending()) return toast('Save or retry your pending evaluations before changing sample data.', 'err');
        if (!confirm(deleting
          ? 'Permanently remove the labeled sample applicants and all evaluations on those samples? Real applicants are untouched.'
          : 'Add 3 fictional sample applicants to this cycle? Two example evaluations will be recorded under your account. Samples will appear in results until removed.')) return;
        const btn = e.target; btn.disabled = true;
        try {
          const result = await rpc(deleting ? 'interview_remove_samples' : 'interview_load_samples', { p_cycle: data.cycleId });
          if (deleting ? !Number.isInteger(result) : !Number.isInteger(result?.added) || !Number.isInteger(result?.total)) throw new Error('Not verified');
          saver?.stop(); saver = null; owner = null;
          await refresh(); ensureSaver(); paint();
          toast(deleting ? `Removed ${result} sample applicants.` : result.added ? `Loaded ${result.added} sample applicants. Open Evaluate to try them.` : 'Sample data is already loaded. Your edits were kept.');
        } catch { toast('Sample data could not be confirmed. Try again; repeated imports do not duplicate samples. Check that the sample-data migration is installed.', 'err'); btn.disabled = false; }
        return;
      }
      if (e.target.id === 'gr-save') {
        const btn = e.target;
        const lines = sel => $(sel).value.split('\n').map(x => x.trim()).filter(Boolean);
        const groups = lines('#gr-groups');
        const people = [...$$('[data-panel]:checked')].map(el => el.dataset.panel);
        if (!groups.length) return toast('Keep at least one group.', 'err');
        btn.disabled = true;
        try {
          if (await rpc('interview_save_settings', { p_cycle: data.cycleId, p_groups: groups, p_panel: people }) !== true) throw new Error('Not verified');
          await refresh(); paint(); toast('Settings saved.');
        } catch { toast('Settings could not be saved. Your choices are still here. Check that the interview safety migration is installed.', 'err'); btn.disabled = false; }
      }

      if (e.target.id === 'gr-preview') {
        const raw = $('#gr-roster').value.trim();
        if (!raw) return toast('Paste something first.', 'err');

        const parsed = parseRoster(raw);
        pending = parsed.rows;

        const box = $('#gr-prev');
        if (!parsed.rows.length) {
          box.innerHTML = `<div class="callout"><strong>Nothing usable in that paste.</strong>
            Nothing in it looked like a candidate name. Check you copied the rows themselves —
            a name column is the one thing that can't be worked out from context.</div>`;
          box.hidden = false;
          $('#gr-import-actions').hidden = true;
          return;
        }

        const label = { name: 'Name', puid: 'PUID', year: 'Year', grad: 'Grad', major: 'Major', email: 'Email' };
        const mapped = Object.entries(parsed.mapping)
          .filter(([, i]) => i !== undefined)
          .map(([f, i]) => `<span><b>${label[f]}</b> ← ${esc(parsed.header ? parsed.header[i] : 'column ' + (i + 1))}</span>`)
          .join('');
        const missing = ['puid', 'year', 'grad', 'major', 'email'].filter(f => parsed.mapping[f] === undefined);

        box.innerHTML = `
          <div class="gr-map">${mapped}</div>
          ${missing.length ? `<p class="hint" style="margin-bottom:9px">No column matched
            <strong>${missing.join(', ')}</strong> — those will be left blank.</p>` : ''}
          ${parsed.skipped ? `<p class="hint" style="margin-bottom:9px">${parsed.skipped}
            row${parsed.skipped === 1 ? '' : 's'} skipped for having no name.</p>` : ''}
          <table class="gr-prevtbl">
            <thead><tr><th>Name</th><th>PUID</th><th>Year</th><th>Grad</th><th>Major</th><th>Email</th></tr></thead>
            <tbody>${parsed.rows.slice(0, 6).map(r => `<tr>
              <td>${esc(r.name)}</td><td>${esc(r.puid)}</td><td>${esc(r.year)}</td><td>${esc(r.grad)}</td>
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

        if (replace && (data.candidates.some(c => Object.keys(c.scores).length) || saver?.pending())) return toast('Recorded evaluations or unsaved changes prevent replacing this roster.', 'err');
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
          await importCandidates(pending, replace);
          await refresh();
          $('#gr-roster').value = '';
          pending = [];
          paint();
          toast(replace
            ? `Roster replaced — ${n} candidates loaded.`
            : `Added ${n} candidates. Roster is now ${data.candidates.length}.`);
        } catch (err) { toast('That change could not be saved. Your data has not been confirmed; try again.', 'err'); btn.disabled = false; }
      }

      if (e.target.id === 'gr-one-add') {
        const btn = e.target, err = $('#gr-one-error');
        const val = sel => $(sel).value.trim();
        const person = {
          name:  val('#gr-one-name'),
          puid:  val('#gr-one-puid'),
          year:  val('#gr-one-year'),
          major: val('#gr-one-major'),
          email: val('#gr-one-email'),
          grad:  ''
        };

        err.hidden = true;
        if (!person.name) return showError(err, 'Give them a name — everything else can wait.');
        if (person.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(person.email)) {
          return showError(err, "That email address doesn't look right.");
        }

        // Adding is an append and is never retried, so a double-click or a second
        // go at the same person would quietly sit them on the roster twice.
        const clash = data.candidates.find(c => sameName(c.name, person.name));
        if (clash && !confirm(`${clash.name} is already on the roster. Add a second entry anyway?`)) return;

        btn.disabled = true;
        btn.textContent = 'Adding…';
        try {
          await importCandidates([person], false);
          await refresh();
          paint();                       // rebuilds the tab, which clears the form
          toast(`Added ${person.name}.`);
        } catch (e2) {
          showError(err, 'This applicant could not be added. Check your connection and try again.');
          btn.disabled = false;
          btn.textContent = 'Add candidate';
        }
      }

      if (e.target.id === 'gr-clear-roster') {
        if (data.candidates.some(c => Object.keys(c.scores).length) || saver?.pending()) return toast('Recorded evaluations or unsaved changes prevent clearing this roster.', 'err');
        if (!confirm('Delete every unscored applicant in this cycle? This cannot be undone.')) return;
        try {
          const cy = await select('interview_cycles', 'select=id&is_current=eq.true&limit=1');
          await remove('candidates', `cycle_id=eq.${cy[0].id}`);
          await refresh(); paint(); toast('Roster cleared.');
        }
        catch (err) { toast('That change could not be saved. Your data has not been confirmed; try again.', 'err'); }
      }

      if (e.target.id === 'gr-clear-people') {
        toast('Interviewers are set by their role now — change someone in Members.', 'err');
        return;
      }
    });

    const capture = () => {
      if (!local.target) return;
      const scores = Object.fromEntries(CRIT.map(cr => [cr.k, Number($(`#gr-g-body input[name="gr-${cr.k}"]:checked`)?.value) || null]));
      saver.edit(local.target.key, { scores, note: $('#gr-note').value });
    };
    $('#gr-g-body').addEventListener('input', capture);
    $('#gr-form').addEventListener('submit', e => { e.preventDefault(); void saver.flush(local.target.key); });
    $('#gr-modal').addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { flushCurrent(); paint(); }
      const step = e.target.id === 'gr-next-candidate' ? 1 : e.target.id === 'gr-prev-candidate' ? -1 : 0;
      if (step) { const list = local.queue.map(id => data.candidates.find(c => c.key === id)).filter(Boolean); const c = list[list.findIndex(c => c.key === local.target.key) + step]; if (c) { openGrade(c); $('#gr-g-name').tabIndex = -1; $('#gr-g-name').focus(); } }
    });
    $('#gr-modal').addEventListener('keydown', e => { if (e.key === 'Escape') { flushCurrent(); paint(); } });
    $('#gr-tabs').addEventListener('keydown', e => {
      const tabs = [...$$('#gr-tabs .tab')], index = tabs.indexOf(e.target);
      if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  }
};
