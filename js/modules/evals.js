/* ============================================================ Evals module
   The tour-guide eval tracker, ported into the hub. Same backend, same rules:
   claim -> schedule -> submit, with completed evals visible only to admins
   (filtered server-side) plus the end-of-semester rollover.
============================================================================ */
import { select, update, rpc, toGuide } from '../core/db.js';
import { loadTours } from '../core/sheets.js';
import { state, myName, isAdmin, termId, nextTermId } from '../core/state.js';
import { paintNav } from '../core/router.js';
import { downloadCsv } from '../core/csv.js';
import {
  $, $$, esc, sameName, prettyDate, prettyTime, todayISO, toast, showError,
  openModal, closeModal, wireModal, debounce, injectStyle, SEARCH_ICON
} from '../core/ui.js';

const STATUS_LABEL = { open: 'Open', claimed: 'Claimed', submitted: 'Submitted', reviewed: 'Reviewed', skip: 'No eval' };
const TONE = { open: 'tone-open', claimed: 'tone-warn', submitted: 'tone-good', reviewed: 'tone-info', skip: 'tone-mute' };
const TOUR_PREVIEW = 5;

const local = { tab: 'open', search: '', priority: '', month: null, day: null, target: null, toursExpanded: false };

const isMine = g => !!g.evaluatorId && g.evaluatorId === state.me?.id;

/* Who may read submitted feedback: admins, plus the Developer (read only, see
   supabase/17-developer-reads-evals.sql). Mirrors the database, which is the
   rule that actually matters. */
const canReadEvals = () => isAdmin() || state.role?.name === 'Developer';

injectStyle('evals-css', `
.ev-cal { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev);
  padding:12px; margin-bottom:18px; }
.ev-cal-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.ev-cal-head strong { flex:1; font-size:.95rem; letter-spacing:-.01em; }
.ev-cal-nav { font:inherit; cursor:pointer; border:1px solid var(--line-strong); background:var(--bg);
  color:var(--text); border-radius:8px; width:28px; height:28px; line-height:1; flex:none; }
.ev-cal-nav:hover { border-color:var(--accent); }
.ev-cal-today { font:inherit; font-size:.74rem; cursor:pointer; padding:5px 10px; border-radius:999px;
  border:1px solid var(--line-strong); background:var(--bg); color:var(--text-soft); flex:none; }
.ev-cal-today:hover { border-color:var(--accent); color:var(--text); }
.ev-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
.ev-cal-dow { text-align:center; font-size:.68rem; font-weight:600; color:var(--text-faint);
  padding-bottom:4px; text-transform:uppercase; letter-spacing:.04em; }
.ev-cal-day { font:inherit; color:var(--text); cursor:pointer; aspect-ratio:1; min-height:38px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
  border:1px solid transparent; border-radius:9px; background:transparent; padding:2px; }
.ev-cal-day .d { font-size:.82rem; font-variant-numeric:tabular-nums; }
.ev-cal-day .n { font-size:.62rem; font-weight:700; color:var(--accent); line-height:1; }
.ev-cal-day.has { background:var(--accent-soft); border-color:color-mix(in srgb, var(--accent) 22%, transparent); }
.ev-cal-day.none { color:var(--text-faint); cursor:default; }
.ev-cal-day.off { visibility:hidden; }
.ev-cal-day.today { border-color:var(--accent); }
.ev-cal-day.sel { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }
/* Gold on the black selected day; white would read as any old calendar. */
.ev-cal-day.sel .n { color:var(--gold); }
.ev-cal-day:not(.none):not(.sel):hover { border-color:var(--accent); }
.ev-day { margin-bottom:18px; }
.ev-day-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  padding:0 2px 7px; border-bottom:1px solid var(--line); margin-bottom:8px; position:sticky; top:var(--topbar);
  background:var(--bg); z-index:1; }
.ev-day-name { font-size:.95rem; font-weight:650; letter-spacing:-.01em; }
.ev-day-name .soon { color:var(--accent); }
.ev-day-count { font-size:.75rem; color:var(--text-faint); flex:none; }
.ev-slot { display:flex; align-items:center; gap:12px; padding:9px 12px; border:1px solid var(--line);
  border-radius:var(--radius); background:var(--bg-elev); margin-bottom:6px; }
.ev-slot.taken { background:transparent; border-style:dashed; }
.ev-slot-time { font-size:.78rem; color:var(--text-faint); font-variant-numeric:tabular-nums;
  min-width:112px; flex:none; }
.ev-slot-who { flex:1; min-width:0; }
.ev-slot-who b { display:block; font-size:.88rem; font-weight:600; }
.ev-slot-who em { display:block; font-style:normal; font-size:.74rem; color:var(--text-faint); margin-top:1px; }
.ev-slot .btn { flex:none; }
@media (max-width:520px){
  .ev-slot { flex-wrap:wrap; gap:6px 10px; }
  .ev-slot-time { min-width:0; width:100%; }
}
.ev-card { display:flex; flex-direction:column; gap:11px; position:relative; overflow:hidden; }
.ev-card::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--tone,var(--line-strong)); }
.ev-card.is-mine { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.ev-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.ev-name { font-size:1rem; font-weight:650; letter-spacing:-.01em; }
.ev-prio { font-size:.74rem; color:var(--text-faint); font-weight:500; margin-top:1px; }
.ev-meta { display:grid; gap:5px; font-size:.82rem; }
.ev-row { display:flex; gap:8px; align-items:baseline; }
.ev-row .k { color:var(--text-faint); flex:none; width:62px; font-size:.78rem; }
.ev-row .v { color:var(--text); font-weight:500; overflow-wrap:anywhere; }
.ev-row .v.you { color:var(--accent); font-weight:650; }
.ev-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:auto; padding-top:3px; }
.ev-actions .btn { flex:1 1 auto; }
.ev-actions .btn-quiet { flex:0 0 auto; }
.progress-head { display:flex; justify-content:space-between; align-items:baseline;
  font-size:.8rem; color:var(--text-soft); margin-bottom:6px; font-weight:500; }
.progress-track { height:7px; background:var(--bg-sunken); border-radius:999px; overflow:hidden; }
.progress-fill { height:100%; width:0; border-radius:999px;
  background:linear-gradient(90deg,var(--accent),var(--good)); transition:width .5s cubic-bezier(.2,.7,.3,1); }
.tourlist { display:grid; gap:6px; max-height:232px; overflow-y:auto; padding:4px; margin:-4px; }
.tour-opt { display:flex; align-items:center; gap:10px; border:1px solid var(--line-strong);
  border-radius:var(--radius-sm); padding:10px 12px; cursor:pointer; text-align:left;
  background:var(--bg-elev); font:inherit; color:var(--text); min-height:44px;
  transition:border-color .13s, background .13s; }
.tour-opt:hover, .tour-opt.is-picked { border-color:var(--accent); background:var(--accent-soft); }
.tour-opt.is-picked .tour-check { opacity:1; }
.tour-when { font-weight:600; font-size:.875rem; flex:1; }
.tour-slot { font-size:.8rem; color:var(--text-soft); font-variant-numeric:tabular-nums; }
.tour-check { color:var(--accent); font-weight:700; opacity:0; flex:none; }
.rating { display:flex; gap:7px; flex-wrap:wrap; }
.rating input { position:absolute; opacity:0; pointer-events:none; }
.rating label { flex:1 1 0; min-width:46px; text-align:center; cursor:pointer;
  border:1px solid var(--line-strong); border-radius:var(--radius-sm); padding:9px 4px;
  font-size:.85rem; font-weight:600; color:var(--text-soft); transition:all .13s; user-select:none; }
.rating label:hover { border-color:var(--accent); color:var(--text); }
.rating input:checked + label { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }
.checkline { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--line-strong);
  border-radius:var(--radius-sm); padding:12px 14px; cursor:pointer; }
.checkline input { width:17px; height:17px; margin-top:2px; flex:none; accent-color:var(--accent); }
.checkline strong { display:block; font-size:.875rem; font-weight:600; }
.checkline em { display:block; font-style:normal; font-size:.8rem; color:var(--text-soft); margin-top:3px; }
.preview { background:var(--bg-sunken); border-radius:var(--radius-sm); padding:12px 14px; font-size:.84rem; }
.preview h4 { margin:0 0 8px; font-size:.78rem; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-faint); font-weight:700; }
.preview-row { display:flex; justify-content:space-between; gap:12px; padding:4px 0;
  border-bottom:1px dashed var(--line); }
.preview-row:last-child { border-bottom:0; }
.preview-row .n { font-variant-numeric:tabular-nums; font-weight:650; flex:none; }
.preview-note { margin-top:9px; color:var(--text-soft); font-size:.8rem; }
.ev-card.is-viewable { cursor:pointer; transition:border-color .13s; }
.ev-card.is-viewable:hover, .ev-card.is-viewable:focus-visible { border-color:var(--accent); }
.ev-resp { display:grid; gap:14px; }
.ev-resp-rating { display:flex; align-items:baseline; gap:8px; }
.ev-resp-rating .n { font-size:1.6rem; font-weight:700; color:var(--accent); font-variant-numeric:tabular-nums; }
.ev-resp h4 { margin:0 0 5px; font-size:.74rem; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-faint); font-weight:700; }
.ev-resp-text { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--bg-sunken);
  border-radius:var(--radius-sm); padding:11px 13px; font-size:.88rem; line-height:1.5; }
.ev-resp-text.none { color:var(--text-faint); font-style:italic; }
`);

/* ---------------------------------------------------------------- markup */

function shell() {
  const admin = isAdmin();
  const ratings = window.CONFIG?.RATING_OPTIONS || ['1', '2', '3', '4', '5'];
  return `
  <section class="stats" style="margin-bottom:16px">
    <button class="stat" data-jump="open"><span class="stat-num" id="ev-s-open" style="color:var(--open)">–</span><span class="stat-lbl">Up for grabs</span></button>
    <button class="stat" data-jump="mine"><span class="stat-num" id="ev-s-mine" style="color:var(--accent)">–</span><span class="stat-lbl">Yours</span></button>
    <button class="stat" data-jump="claimed"><span class="stat-num" id="ev-s-claimed" style="color:var(--warn)">–</span><span class="stat-lbl">Claimed</span></button>
    <button class="stat" data-jump="done"><span class="stat-num" id="ev-s-done" style="color:var(--good)">–</span><span class="stat-lbl">Submitted</span></button>
  </section>

  <div style="margin-bottom:20px">
    <div class="progress-head"><span id="ev-prog-label">—</span><span id="ev-prog-pct"></span></div>
    <div class="progress-track"><div class="progress-fill" id="ev-prog-fill"></div></div>
  </div>

  <nav class="tabs" id="ev-tabs" style="margin-bottom:14px">
    <button class="tab is-active" data-tab="open">Available</button>
    <button class="tab" data-tab="days">By day</button>
    <button class="tab" data-tab="mine">My evals <span class="tab-badge" id="ev-badge" hidden>0</span></button>
    <button class="tab" data-tab="claimed">Claimed</button>
    <button class="tab" data-tab="done" ${canReadEvals() ? '' : 'hidden'}>Done</button>
    <button class="tab" data-tab="all">Everyone</button>
  </nav>

  <div class="filters" style="margin-bottom:16px">
    <label class="search">${SEARCH_ICON}<input type="search" id="ev-search" placeholder="Search a guide's name…" autocomplete="off"></label>
    <select id="ev-priority" class="select" aria-label="Filter by priority"><option value="">All priorities</option></select>
    <button type="button" class="btn btn-ghost btn-sm" id="ev-export" title="Download whatever this tab is currently showing">Download CSV</button>
  </div>

  <div id="ev-banner" class="callout" style="margin-bottom:14px" hidden></div>
  <section id="ev-list" class="grid" aria-live="polite"></section>
  <div id="ev-empty" class="empty" hidden><div class="empty-mark">🎉</div><p id="ev-empty-text"></p></div>

  <!-- claim / schedule -->
  <div class="modal-root" id="ev-modal-claim" hidden>
    <div class="modal-scrim" data-close></div>
    <form class="modal" id="ev-claim-form">
      <header class="modal-head">
        <div><h2 id="ev-claim-title">Claim eval</h2><p class="muted" id="ev-claim-sub"></p></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="modal-body">
        <div class="field" id="ev-pick-wrap" hidden>
          <span>Pick a tour they're leading</span>
          <div class="tourlist" id="ev-pick"></div>
          <button type="button" class="linkish" id="ev-pick-more" hidden></button>
        </div>
        <div id="ev-manual">
          <div class="row2">
            <label class="field"><span>Tour date</span><input type="date" id="ev-claim-date"></label>
            <label class="field"><span>Tour time</span><input type="time" id="ev-claim-time"></label>
          </div>
        </div>
        <label class="field"><span>Notes <em class="muted">(optional)</em></span>
          <textarea id="ev-claim-notes" rows="2" placeholder="e.g. meeting them at the visitor center"></textarea></label>
        <p class="hint" id="ev-claim-hint"></p>
        <p class="form-error" id="ev-claim-error" hidden></p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="ev-claim-submit">Claim it</button>
      </footer>
    </form>
  </div>

  <!-- submit eval -->
  <div class="modal-root" id="ev-modal-eval" hidden>
    <div class="modal-scrim" data-close></div>
    <form class="modal modal-lg" id="ev-eval-form">
      <header class="modal-head">
        <div><h2>Submit eval</h2><p class="muted" id="ev-eval-sub"></p></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="modal-body">
        <div class="row2">
          <label class="field"><span>Tour date</span><input type="date" id="ev-eval-date"></label>
          <label class="field"><span>Tour time</span><input type="time" id="ev-eval-time"></label>
        </div>
        <fieldset class="field"><legend>Overall rating</legend>
          <div class="rating" id="ev-rating" role="radiogroup">
            ${ratings.map((o, i) => `<input type="radio" name="ev-rating" id="ev-r${i}" value="${esc(o)}"><label for="ev-r${i}">${esc(o)}</label>`).join('')}
          </div>
        </fieldset>
        <label class="field"><span>What went well</span>
          <textarea id="ev-well" rows="4" placeholder="Strengths, standout moments, good habits…"></textarea></label>
        <label class="field"><span>Areas to improve</span>
          <textarea id="ev-improve" rows="4" placeholder="Concrete, actionable suggestions…"></textarea></label>
        <label class="field"><span>Other notes <em class="muted">(optional)</em></span>
          <textarea id="ev-notes" rows="2"></textarea></label>
        <p class="hint" id="ev-draft-note" hidden style="color:var(--good)"></p>
        <p class="hint">Submitting writes to the Submissions tab and drops this guide to Last Priority.</p>
        <p class="form-error" id="ev-eval-error" hidden></p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="ev-eval-submit">Submit eval</button>
      </footer>
    </form>
  </div>

  <!-- view a submitted eval (read-only) -->
  <div class="modal-root" id="ev-modal-view" hidden>
    <div class="modal-scrim" data-close></div>
    <div class="modal modal-lg">
      <header class="modal-head">
        <div><h2 id="ev-view-title">Eval responses</h2><p class="muted" id="ev-view-sub"></p></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="modal-body"><div id="ev-view-body" class="ev-resp"></div></div>
      <footer class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Close</button>
      </footer>
    </div>
  </div>

  ${admin ? rolloverModal() : ''}`;
}

function rolloverModal() {
  return `
  <div class="modal-root" id="ev-modal-roll" hidden>
    <div class="modal-scrim" data-close></div>
    <form class="modal modal-lg" id="ev-roll-form">
      <header class="modal-head">
        <div><h2>End of semester rollover</h2><p class="muted">Moves everyone up one priority tier.</p></div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <div class="modal-body">
        <div class="callout"><strong>Guides who never got evaluated become the most urgent next semester.</strong>
          Everyone moves one step: Last → Fifth → Fourth → Third → Second → First. Anyone already at
          First Priority stays, and guides marked <em>No Need to Eval</em> are left alone.</div>
        <label class="checkline"><input type="checkbox" id="ev-roll-clear" checked>
          <span><strong>Also clear this semester's progress</strong>
          <em>Wipes evaluator names, tour dates and both checkboxes. Submitted feedback is never touched.</em></span></label>
        <div id="ev-roll-preview" class="preview" hidden></div>
        <p class="form-error" id="ev-roll-error" hidden></p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-ghost" id="ev-roll-preview-btn">Preview</button>
        <button type="submit" class="btn btn-danger" id="ev-roll-go" disabled>Preview first</button>
      </footer>
    </form>
  </div>`;
}

/* ---------------------------------------------------------------- render */

function inTab(g) {
  switch (local.tab) {
    case 'open':    return g.status === 'open';
    case 'mine':    return isMine(g);
    case 'claimed': return g.status === 'claimed';
    case 'done':    return g.status === 'submitted' || g.status === 'reviewed';
    default:        return true;
  }
}

function visible() {
  const q = local.search.trim().toLowerCase();
  return state.guides.filter(g => {
    if (!inTab(g)) return false;
    if (local.priority && g.priority !== local.priority) return false;
    if (q && !`${g.name} ${g.priority} ${g.evaluator}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function card(g) {
  const mine = isMine(g);
  const admin = isAdmin();
  const when = [prettyDate(g.date), prettyTime(g.time)].filter(Boolean).join(' · ');

  const meta = [];
  if (g.evaluator) meta.push(`<div class="ev-row"><span class="k">Evaluator</span><span class="v${mine ? ' you' : ''}">${esc(mine ? 'You' : g.evaluator)}</span></div>`);
  if (when)        meta.push(`<div class="ev-row"><span class="k">Tour</span><span class="v">${esc(when)}</span></div>`);
  if (g.notes)     meta.push(`<div class="ev-row"><span class="k">Notes</span><span class="v">${esc(g.notes)}</span></div>`);
  if (g.status === 'reviewed') meta.push(`<div class="ev-row"><span class="k">Feedback</span><span class="v">Reviewed ✓</span></div>`);

  const b = (act, label, cls, title) =>
    `<button class="btn ${cls}" data-act="${act}" data-id="${esc(g.id)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;

  const actions = [];
  if (g.status === 'open') actions.push(b('claim', 'Claim', 'btn-primary'));
  else if (g.status === 'claimed' && mine) {
    actions.push(b('submit', 'Submit eval', 'btn-primary'), b('edit', 'Edit', 'btn-ghost'), b('unclaim', '✕', 'btn-quiet', 'Release this claim'));
  } else if (g.status === 'claimed' && admin) {
    actions.push(b('unclaim', 'Release', 'btn-ghost'), b('submit', 'Submit eval', 'btn-ghost'));
  }
  // The database only hands the feedback to admins and to whoever wrote it.
  if ((g.status === 'submitted' || g.status === 'reviewed') && (canReadEvals() || mine)) {
    actions.push(b('view', 'View responses', 'btn-primary'));
  }
  if ((g.status === 'submitted' || g.status === 'reviewed') && admin) {
    actions.push(b('review', g.status === 'reviewed' ? 'Undo reviewed' : 'Mark reviewed', 'btn-ghost'));
  }

  const viewable = (g.status === 'submitted' || g.status === 'reviewed') && (canReadEvals() || mine);
  return `<article class="card ev-card ${mine ? 'is-mine' : ''}${viewable ? ' is-viewable' : ''}" data-status="${esc(g.status)}"
      ${viewable ? `data-view="${esc(g.id)}" tabindex="0" title="Open responses"` : ''}
      style="--tone:var(--${g.status === 'open' ? 'open' : g.status === 'claimed' ? 'warn' : g.status === 'submitted' ? 'good' : g.status === 'reviewed' ? 'info' : 'mute'})">
    <div class="ev-top">
      <div><div class="ev-name">${esc(g.name)}</div><div class="ev-prio">${esc(g.priority || '—')}</div></div>
      <span class="pill ${TONE[g.status]}">${esc(STATUS_LABEL[g.status] || g.status)}</span>
    </div>
    ${meta.length ? `<div class="ev-meta">${meta.join('')}</div>` : ''}
    ${actions.length ? `<div class="ev-actions">${actions.join('')}</div>` : ''}
  </article>`;
}

const EMPTY = {
  open: 'Every guide has been claimed. Nice.',
  mine: 'You have not claimed anyone yet — check the Available tab.',
  claimed: 'Nothing is currently claimed and waiting.',
  done: 'No evals have been submitted yet.',
  all: 'No guides match that search.'
};

/* ------------------------------------------------------------- by day ----
   Asked for by the committee: "which evals can I actually go to on Thursday?"

   Every other tab answers "who needs an eval" and leaves you to open each card
   to find out when they are leading. This inverts it -- the schedule first,
   the people second -- because that is the order the question arrives in. You
   know which afternoon you are free before you know whose tour you want.

   The tours are the same ones already hanging off each guide from the shared
   workbook, so nothing new is fetched. A guide leading three tours appears on
   three days, which is correct: each is a separate chance to go and watch.
-------------------------------------------------------------------------- */

function dayGroups() {
  const q = local.search.trim().toLowerCase();
  const keep = g =>
    (g.status === 'open' || g.status === 'claimed') &&
    (!local.priority || g.priority === local.priority) &&
    (!q || `${g.name} ${g.priority} ${g.evaluator}`.toLowerCase().includes(q));

  const byDate = new Map();
  state.guides.forEach(g => {
    if (!keep(g)) return;
    (g.tours || []).forEach(t => {
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push({ g, t });
    });
  });

  return new Map([...byDate.entries()].map(([date, rows]) => [date, {
    rows: rows.sort((a, b) =>
      a.t.start.localeCompare(b.t.start) || a.g.name.localeCompare(b.g.name)),
    free: rows.filter(r => r.g.status === 'open').length
  }]));
}

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* The month grid. Seven columns, because Saturday tours are real -- they live
   on their own tab in the workbook and were invisible to the hub until now. */
function calendar(groups) {
  const today = todayISO();
  if (!local.month) local.month = today.slice(0, 7);

  const [y, m] = local.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = first.getDay();                       // Sunday = 0
  const days = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="ev-cal-day off"></span>');

  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const g = groups.get(iso);
    const free = g ? g.free : 0;
    const cls = [
      'ev-cal-day',
      g ? 'has' : 'none',
      iso === today ? 'today' : '',
      iso === local.day ? 'sel' : ''
    ].filter(Boolean).join(' ');

    cells.push(g
      ? `<button class="${cls}" data-day="${iso}" title="${free} to claim">
           <span class="d">${d}</span>${free ? `<span class="n">${free}</span>` : ''}</button>`
      : `<span class="${cls}"><span class="d">${d}</span></span>`);
  }

  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="ev-cal">
    <div class="ev-cal-head">
      <strong>${esc(label)}</strong>
      <button class="ev-cal-today" data-cal="today">Today</button>
      <button class="ev-cal-nav" data-cal="prev" aria-label="Previous month">‹</button>
      <button class="ev-cal-nav" data-cal="next" aria-label="Next month">›</button>
    </div>
    <div class="ev-cal-grid">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<span class="ev-cal-dow">${d}</span>`).join('')}
      ${cells.join('')}
    </div>
  </div>`;
}

function dayView() {
  const groups = dayGroups();
  const today = todayISO();

  /* Land on a day that has something on it. Opening the tab on an empty
     Sunday, with the answer two squares away, is a poor first impression. */
  if (!local.day || !groups.has(local.day)) {
    local.day = groups.has(today)
      ? today
      : [...groups.keys()].sort().find(d => d >= today) || [...groups.keys()].sort().pop() || today;
    local.month = local.day.slice(0, 7);
  }

  const cal = calendar(groups);
  const picked = groups.get(local.day);

  if (!picked) {
    return cal + `<div class="ev-day"><div class="ev-day-head">
      <span class="ev-day-name">${esc(prettyDate(local.day, { weekday: 'long', month: 'long', day: 'numeric' }))}</span>
      </div><p class="muted" style="padding:6px 2px">No tours that day.</p></div>`;
  }

  const { rows, free } = picked;
  const label = local.day === today ? 'Today' : '';
  const full = prettyDate(local.day, { weekday: 'long', month: 'long', day: 'numeric' });

  return cal + `<section class="ev-day">
    <div class="ev-day-head">
      <span class="ev-day-name">${label ? `<span class="soon">${label}</span> · ` : ''}${esc(full)}</span>
      <span class="ev-day-count">${free ? `${free} to claim` : 'all claimed'}</span>
    </div>
    ${rows.map(({ g, t }) => {
      const mine = isMine(g);
      const taken = g.status !== 'open';
      const who = taken
        ? (mine ? 'Claimed by you' : g.evaluator ? `Claimed by ${g.evaluator}` : 'Already claimed')
        : (g.priority || '');
      return `<div class="ev-slot ${taken ? 'taken' : ''}">
        <span class="ev-slot-time">${esc(t.slot || prettyTime(t.start))}</span>
        <span class="ev-slot-who"><b>${esc(g.name)}</b><em>${esc(who)}</em></span>
        ${taken
          ? ''
          : `<button class="btn btn-primary btn-sm" data-act="claim" data-id="${esc(g.id)}"
                data-date="${esc(t.date)}" data-start="${esc(t.start)}">Claim</button>`}
      </div>`;
    }).join('')}
  </section>`;
}

/* The eval roster as it stands — who is claimed, by whom, when the tour is and
   whether feedback has been submitted. Not the written feedback itself: that
   is somebody's candid opinion of a colleague and does not belong in a file
   that gets emailed around. */
function exportEvals() {
  const head = ['Guide', 'Priority', 'Status', 'Evaluator', 'Tour date', 'Tour time', 'Notes', 'Upcoming tours'];
  const rows = visible().map(g => [
    g.name, g.priority || '', STATUS_LABEL[g.status] || g.status, g.evaluator || '',
    g.date || '', g.time || '', g.notes || '', (g.tours || []).length
  ]);
  toast(`Downloaded ${downloadCsv('eval-tracker', [head, ...rows])} guides.`);
}

function paint() {
  const c = state.counts || {};
  const open = c.open || 0, claimed = c.claimed || 0;
  const done = (c.submitted || 0) + (c.reviewed || 0);
  const needed = state.neededTotal || (open + claimed + done);
  const mine = state.guides.filter(isMine).length;

  $('#ev-s-open').textContent = open;
  $('#ev-s-mine').textContent = mine;
  $('#ev-s-claimed').textContent = claimed;
  $('#ev-s-done').textContent = done;

  const badge = $('#ev-badge');
  badge.textContent = mine;
  badge.hidden = !mine;

  const pct = Math.round((done / (needed || 1)) * 100);
  $('#ev-prog-fill').style.width = pct + '%';
  $('#ev-prog-label').textContent = `${done} of ${needed} evals submitted`;
  $('#ev-prog-pct').textContent = pct + '%';

  const undated = state.guides.filter(g => isMine(g) && g.status === 'claimed' && !g.date);
  const banner = $('#ev-banner');
  banner.innerHTML = `You have <strong>${undated.length}</strong> claimed eval${undated.length > 1 ? 's' : ''} with no tour date yet — add one so the committee knows it's scheduled.`;
  banner.hidden = !undated.length;

  // priority filter options
  const sel = $('#ev-priority');
  const seen = [...new Set(state.guides.map(g => g.priority).filter(Boolean))];
  const keep = sel.value;
  sel.innerHTML = '<option value="">All priorities</option>' + seen.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  if (seen.includes(keep)) sel.value = keep;

  const list = $('#ev-list');

  if (local.tab === 'days') {
    const empty = !dayGroups().size;
    list.classList.remove('grid');
    list.innerHTML = empty ? '' : dayView();
    $('#ev-empty').hidden = !empty;
    if (empty) {
      $('#ev-empty-text').textContent = (local.search || local.priority)
        ? 'No guides match those filters on any upcoming day.'
        : 'Nobody who still needs an eval has a tour on the schedule yet. Tours are read from the shared workbook, so they appear here as soon as they are put in.';
    }
    paintNav();
    return;
  }

  list.classList.add('grid');
  const rows = visible();
  list.innerHTML = rows.map(card).join('');
  $('#ev-empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('#ev-empty-text').textContent = (local.search || local.priority)
      ? 'No guides match those filters.' : (EMPTY[local.tab] || 'Nothing here.');
  }
  paintNav();
}

/**
 * The whole roster in one query.
 *
 * The old app fetched this from Apps Script, which took three to eight seconds
 * and shed load when several people asked at once. This is a single indexed
 * read and comes back in well under a second, so there is no prefetching, no
 * caching and no retry policy to get wrong.
 */
/**
 * Claim a guide for the signed-in person.
 *
 * Exported so Vanessa can do it without keeping her own copy of the write. The
 * `evaluator_id=is.null` filter is the important part and must not be
 * duplicated loosely: it is what makes two people claiming at the same instant
 * safe, because Postgres hands the row to exactly one of them and the other
 * gets nothing back rather than quietly overwriting.
 */
export async function claimGuide(g, { date = null, time = null } = {}) {
  const rows = await update('evals', `id=eq.${g.id}&evaluator_id=is.null`, {
    evaluator_id: state.me.id,
    claimed_at:   new Date().toISOString(),
    tour_date:    date,
    tour_time:    time
  });
  if (!rows || !rows.length) throw new Error(`${g.name} was just claimed by somebody else.`);
  await loadRoster();
  paintNav();
  return rows[0];
}

export async function loadRoster() {
  const version = state.sessionVersion;
  const rows = await select('eval_roster',
    `select=*&term_id=eq.${termId()}&order=priority_rank.asc,last_name.asc`);
  state.guides = (rows || []).map(toGuide);

  // Counts cover the WHOLE roster so the progress bar stays truthful even for
  // somebody who cannot see every card.
  const c = { open: 0, claimed: 0, submitted: 0, reviewed: 0, skip: 0 };
  state.guides.forEach(g => { c[g.status] = (c[g.status] || 0) + 1; });
  state.counts = c;
  state.neededTotal = state.guides.filter(g => g.status !== 'skip').length;
  state.loadedAt = new Date();

  state.guideToursLoaded = false;
  await attachTours().then(() => { if (version === state.sessionVersion) state.guideToursLoaded = true; }).catch(() => {});   // never block the roster on the workbook
  return state.guides;
}

/**
 * Hangs each guide's upcoming tours off their card, so claiming somebody offers
 * their real tour times instead of an empty date box.
 *
 * The schedule writes people as "Alli S." while the roster says "Alli Serrano",
 * and it is not as simple as first name plus last initial:
 *
 *   "Nick Str."       -> Stromberg, so a surname matches on any prefix
 *   "Cait G."         -> Caitlin Giordano, so first names do too
 *   "Allison (Allie)" -> the roster carries the nickname in brackets
 *   "Saandiya KPS"    -> only the first word of the first name is used
 *
 * Ported from the matcher the live hub has been using for a year, including its
 * refusal to guess: two plausible guides means no match at all, because quietly
 * hanging a tour on the wrong Ben is worse than hanging it on nobody.
 */
/* Only the two the matcher genuinely cannot work out. Note both point at the
   spelling on the GUIDE roster, which is not always the spelling on the
   committee list: Myelei is Whitaker as a guide and Capelle as a committee
   member. Aliasing her to Capelle sent every one of her tours nowhere.

   "Nick Str." deliberately has no entry -- the surname prefix match resolves it
   to Stromberg on its own, and an alias here would hijack it to Steingraeber. */
const ALIASES = {
  'nick s.':   'Nicholas (Nick) Steingraeber',
  'myelei c.': 'Myelei Whitaker'
};

let tourCache = null;

function buildNameIndex(guides) {
  const index = new Map();
  const add = (key, g) => {
    key = String(key || '').trim().toLowerCase();
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    const arr = index.get(key);
    if (!arr.includes(g)) arr.push(g);
  };
  guides.forEach(g => {
    const first = String(g.first || '').trim();
    const paren = /^(.*?)\s*\((.*?)\)\s*$/.exec(first);
    if (paren) { add(paren[1], g); add(paren[2], g); } else { add(first, g); }
    add(first.split(/\s+/)[0], g);
  });
  return index;
}

function resolveGuide(label, index, byName) {
  const clean = String(label || '').replace(/[*+`\u00b4']+/g, '').trim();
  if (!clean) return null;

  const alias = ALIASES[clean.toLowerCase()];
  if (alias) return byName.get(alias.toLowerCase()) || null;

  const m = /^(.+?)\s+([A-Za-z]+)\.?$/.exec(clean);
  if (!m) return null;
  const first = m[1].trim().toLowerCase();
  const surname = m[2].trim().toLowerCase();
  const surnameFits = g => String(g.last || '').trim().toLowerCase().startsWith(surname);

  const exact = index.get(first);
  if (exact && exact.length) {
    const hits = exact.filter(surnameFits);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;          // genuinely ambiguous
  }

  // The schedule sometimes shortens a first name the roster spells out. Accept
  // that only when the surname agrees and exactly one guide fits.
  const loose = [];
  for (const [key, group] of index) {
    if (!key.startsWith(first)) continue;
    group.forEach(g => { if (surnameFits(g) && !loose.includes(g)) loose.push(g); });
  }
  return loose.length === 1 ? loose[0] : null;
}

async function attachTours() {
  const version = state.sessionVersion;
  if (!tourCache) {
    const loaded = await loadTours();
    if (version !== state.sessionVersion) return;
    tourCache = loaded;
  }

  state.guides.forEach(g => { g.tours = []; });
  const index = buildNameIndex(state.guides);
  const byName = new Map(state.guides.map(g => [String(g.name).toLowerCase(), g]));

  const unmatched = new Set();
  for (const t of tourCache) {
    const g = resolveGuide(t.guide, index, byName);
    if (!g) { unmatched.add(t.guide); continue; }
    g.tours.push({ date: t.date, start: t.start, slot: t.slot });
  }
  state.guides.forEach(g => g.tours.sort((a, b) =>
    a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
  state.unmatchedSchedule = [...unmatched];
  paintNav();

  /* Tours arrive from the workbook a moment after the roster does, and the
     By day tab is made entirely of tours -- without this it would paint empty
     and stay that way until something else happened to redraw it. */
  if (document.getElementById('ev-list')) paint();
}

async function reload() {
  await loadRoster();
  paint();
}

/* ---------------------------------------------------------------- tours */

function renderTours() {
  const tours = local.target?.tours || [];
  const wrap = $('#ev-pick-wrap'), more = $('#ev-pick-more');

  if (!tours.length) {
    wrap.hidden = true; more.hidden = true;
    $('#ev-manual').style.display = '';
    $('#ev-claim-hint').textContent = 'No scheduled tours found for them — enter the date yourself.';
    return;
  }

  wrap.hidden = false;
  const shown = local.toursExpanded ? tours : tours.slice(0, TOUR_PREVIEW);
  const picked = $('#ev-claim-date').value, pickedTime = $('#ev-claim-time').value;

  $('#ev-pick').innerHTML = shown.map((t, i) => {
    const on = t.date === picked && (!pickedTime || t.start === pickedTime);
    return `<button type="button" class="tour-opt ${on ? 'is-picked' : ''}" data-i="${i}">
      <span class="tour-when">${esc(prettyDate(t.date))}</span>
      <span class="tour-slot">${esc(t.slot || prettyTime(t.start))}</span>
      <span class="tour-check">✓</span></button>`;
  }).join('');

  more.hidden = tours.length <= TOUR_PREVIEW;
  more.textContent = local.toursExpanded ? 'Show fewer' : `Show all ${tours.length} tours`;

  $('#ev-manual').style.display = (!local.toursExpanded && !picked) ? 'none' : '';
  $('#ev-claim-hint').textContent = picked
    ? 'Tour selected. You can still adjust the date or time by hand.'
    : 'Pick one above, or scroll for more.';
}

/* `preset` is the tour that was actually clicked. Claiming from the By day tab
   means you already chose the day and the time -- being handed an empty date
   box and a list of their other tours would be asking the same question twice. */
function openClaim(g, editing, preset) {
  local.target = g;
  local.toursExpanded = false;
  $('#ev-claim-title').textContent = editing ? 'Edit schedule' : 'Claim eval';
  $('#ev-claim-sub').textContent = `${g.name} · ${g.priority || ''}`;
  $('#ev-claim-date').value = preset?.date || g.date || '';
  $('#ev-claim-time').value = preset?.start || g.time || '';
  $('#ev-claim-notes').value = g.notes || '';
  const go = $('#ev-claim-submit');
  go.textContent = editing ? 'Save' : 'Claim it';
  go.dataset.mode = editing ? 'schedule' : 'claim';
  $('#ev-claim-error').hidden = true;
  renderTours();
  openModal($('#ev-modal-claim'));
}

/* ---------------------------------------------------------- form drafts
   An eval is the longest thing anybody types into this hub — several
   paragraphs of considered feedback about a colleague. The modal already
   survives a failed submit, but not a closed tab, a flat battery or a stray
   Escape, and losing it means writing the whole thing again from memory.

   So it is saved to this browser as it is typed, per guide and per person, and
   offered back the next time that eval is opened. It is deliberately local: an
   unfinished, unsubmitted opinion about somebody is not something to be
   pushing to a shared database on every keystroke.
-------------------------------------------------------------------------- */
const DRAFT_KEY = id => `hub2.evaldraft.${state.me?.id || 'anon'}.${id}`;
const DRAFT_FIELDS = ['#ev-well', '#ev-improve', '#ev-notes'];

function saveDraft() {
  const g = local.target;
  if (!g) return;
  const checked = $('#ev-rating input:checked');
  const draft = {
    well:   $('#ev-well').value,
    improve:$('#ev-improve').value,
    notes:  $('#ev-notes').value,
    rating: checked ? checked.value : null,
    at:     Date.now()
  };
  // Nothing typed yet is not a draft; do not litter storage with empties.
  const empty = !draft.well.trim() && !draft.improve.trim() && !draft.notes.trim() && !draft.rating;
  try {
    if (empty) localStorage.removeItem(DRAFT_KEY(g.id));
    else localStorage.setItem(DRAFT_KEY(g.id), JSON.stringify(draft));
  } catch { /* private window, or full — the form still works */ }
  paintDraftNote();
}

function readDraft(id) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && typeof d.well === 'string') ? d : null;
  } catch { return null; }
}

const clearDraft = id => { try { localStorage.removeItem(DRAFT_KEY(id)); } catch {} };

function paintDraftNote() {
  const note = $('#ev-draft-note');
  if (!note || !local.target) return;
  const d = readDraft(local.target.id);
  note.hidden = !d;
  if (d) note.textContent = 'Saved on this device — you can close this and come back.';
}

function openEval(g) {
  local.target = g;
  $('#ev-eval-sub').textContent = `${g.name} · ${g.priority || ''}`;
  $('#ev-eval-date').value = g.date || '';
  $('#ev-eval-time').value = g.time || '';
  ['#ev-well', '#ev-improve', '#ev-notes'].forEach(s => ($(s).value = ''));
  $$('#ev-rating input').forEach(i => (i.checked = false));
  $('#ev-eval-error').hidden = true;

  // Hand back whatever was typed last time and never submitted.
  const draft = readDraft(g.id);
  if (draft) {
    $('#ev-well').value    = draft.well    || '';
    $('#ev-improve').value = draft.improve || '';
    $('#ev-notes').value   = draft.notes   || '';
    if (draft.rating) {
      const hit = $$('#ev-rating input').find(i => i.value === draft.rating);
      if (hit) hit.checked = true;
    }
  }
  paintDraftNote();
  openModal($('#ev-modal-eval'));
  setTimeout(() => $('#ev-well').focus(), 60);
}

/* Read-only view of what was submitted. Fetched on open rather than with the
   roster: the feedback is the sensitive part and there is no reason to pull
   every guide's into the browser just to draw the cards. */
async function openView(g) {
  const body = $('#ev-view-body');
  $('#ev-view-title').textContent = g.name;
  const when = [prettyDate(g.date), prettyTime(g.time)].filter(Boolean).join(' · ');
  $('#ev-view-sub').textContent = [g.priority, g.evaluator && `Evaluated by ${isMine(g) ? 'you' : g.evaluator}`, when]
    .filter(Boolean).join(' · ');
  body.innerHTML = '<p class="muted">Loading…</p>';
  openModal($('#ev-modal-view'));

  try {
    const rows = await select('eval_submissions',
      `select=rating,went_well,improve,notes,created_at&eval_id=eq.${g.id}&limit=1`);
    const s = rows && rows[0];
    if (!s) {
      body.innerHTML = '<p class="muted">No written feedback was found for this eval. It may have been submitted outside the hub.</p>';
      return;
    }
    const text = (label, v) => `<div><h4>${label}</h4>${
      v && v.trim()
        ? `<div class="ev-resp-text">${esc(v)}</div>`
        : '<div class="ev-resp-text none">Nothing written.</div>'}</div>`;
    body.innerHTML = `
      <div class="ev-resp-rating"><h4 style="margin:0">Overall rating</h4>
        <span class="n">${s.rating != null ? esc(String(s.rating)) : '—'}</span></div>
      ${text('What went well', s.went_well)}
      ${text('Areas to improve', s.improve)}
      ${text('Other notes', s.notes)}
      <p class="hint">Submitted ${esc(new Date(s.created_at).toLocaleString())}${g.status === 'reviewed' ? ' · Reviewed ✓' : ''}</p>`;
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

/* ---------------------------------------------------------------- module */

export default {
  id: 'evals',
  bust: () => { tourCache = null; },
  needs: 'training',
  title: 'Eval Tracker',
  crumb: 'Claim and submit tour guide evaluations',
  icon: '📋',
  section: 'Tools',
  badge: () => state.guides.filter(g => isMine(g) && g.status === 'claimed').length || null,

  async mount(view) {
    if (!state.guides.length) await loadRoster();
    view.innerHTML = shell();
    $$('.modal-root', view).forEach(wireModal);
    paint();

    $('#ev-tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      local.tab = t.dataset.tab;
      $$('#ev-tabs .tab').forEach(x => x.classList.toggle('is-active', x === t));
      paint();
    });

    view.querySelector('.stats').addEventListener('click', e => {
      const s = e.target.closest('.stat');
      if (!s) return;
      if (s.dataset.jump === 'done' && !canReadEvals()) return;
      $$('#ev-tabs .tab').find(t => t.dataset.tab === s.dataset.jump)?.click();
    });

    $('#ev-search').addEventListener('input', debounce(e => { local.search = e.target.value; paint(); }));
    $('#ev-priority').addEventListener('change', e => { local.priority = e.target.value; paint(); });

    $('#ev-export').addEventListener('click', exportEvals);

    $('#ev-list').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest?.('[data-view]');
      if (!c || e.target !== c) return;
      e.preventDefault();
      const g = state.guides.find(x => x.id === c.dataset.view);
      if (g) openView(g);
    });

    $('#ev-list').addEventListener('click', async e => {
      const day = e.target.closest('[data-day]');
      if (day) { local.day = day.dataset.day; local.month = local.day.slice(0, 7); return paint(); }

      const nav = e.target.closest('[data-cal]');
      if (nav) {
        if (nav.dataset.cal === 'today') {
          local.day = todayISO(); local.month = local.day.slice(0, 7);
        } else {
          const [y, m] = local.month.split('-').map(Number);
          const d = new Date(y, m - 1 + (nav.dataset.cal === 'next' ? 1 : -1), 1);
          local.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }
        return paint();
      }

      const b = e.target.closest('button[data-act]');
      if (!b) {
        // Anywhere else on a submitted card opens what was written.
        const c = e.target.closest('[data-view]');
        const cg = c && state.guides.find(x => x.id === c.dataset.view);
        if (cg) openView(cg);
        return;
      }
      const g = state.guides.find(x => x.id === b.dataset.id);
      if (!g) return;

      if (b.dataset.act === 'claim') {
        const d = b.dataset.date;
        return openClaim(g, false, d ? { date: d, start: b.dataset.start } : null);
      }
      if (b.dataset.act === 'edit')   return openClaim(g, true);
      if (b.dataset.act === 'submit') return openEval(g);
      if (b.dataset.act === 'view')   return openView(g);

      if (b.dataset.act === 'unclaim') {
        if (!confirm(`Release ${g.name} back to the open list?`)) return;
        b.disabled = true;
        try {
          await update('evals', `id=eq.${g.id}`,
            { evaluator_id: null, claimed_at: null, tour_date: null, tour_time: null });
          toast(`Released ${g.name}.`);
          await reload();
        } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      }
      if (b.dataset.act === 'review') {
        b.disabled = true;
        const on = g.status !== 'reviewed';
        try {
          await update('evals', `id=eq.${g.id}`, { reviewed_at: on ? new Date().toISOString() : null });
          toast(`${on ? 'Marked' : 'Unmarked'} ${g.name} as reviewed.`);
          await reload();
        } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      }
    });

    $('#ev-pick').addEventListener('click', e => {
      const b = e.target.closest('.tour-opt');
      if (!b || !local.target) return;
      const tours = local.toursExpanded ? local.target.tours : local.target.tours.slice(0, TOUR_PREVIEW);
      const t = tours[+b.dataset.i];
      if (!t) return;
      $('#ev-claim-date').value = t.date;
      $('#ev-claim-time').value = t.start || '';
      renderTours();
    });
    $('#ev-pick-more').addEventListener('click', () => { local.toursExpanded = !local.toursExpanded; renderTours(); });
    $('#ev-claim-date').addEventListener('change', renderTours);
    $('#ev-claim-time').addEventListener('change', renderTours);

    $('#ev-claim-form').addEventListener('submit', async e => {
      e.preventDefault();
      const go = $('#ev-claim-submit'), err = $('#ev-claim-error');
      const mode = go.dataset.mode === 'schedule' ? 'schedule' : 'claim';
      const label = go.textContent;
      go.disabled = true; go.textContent = 'Saving…'; err.hidden = true;
      try {
        const patch = {
          tour_date: $('#ev-claim-date').value || null,
          tour_time: $('#ev-claim-time').value || null,
          scheduling_notes: $('#ev-claim-notes').value || null
        };
        // Claiming filters on "nobody has it yet", so if two people press the
        // button at the same instant one gets the row back and the other gets
        // none. No lock, no queue -- Postgres settles it.
        let filter = `id=eq.${local.target.id}`;
        if (mode === 'claim') {
          patch.evaluator_id = state.me.id;
          patch.claimed_at = new Date().toISOString();
          filter += '&evaluator_id=is.null';
        }
        const rows = await update('evals', filter, patch);
        if (mode === 'claim' && (!rows || !rows.length)) {
          throw new Error(`${local.target.name} was just claimed by somebody else.`);
        }
        closeModal($('#ev-modal-claim'));
        toast(mode === 'claim' ? `You claimed ${local.target.name}.` : 'Schedule updated.');
        await reload();
      } catch (e2) {
        showError(err, e2.message);
        reload().catch(() => {});
      } finally { go.disabled = false; go.textContent = label; }
    });

    /* Saved as it is typed, so closing the tab is not a disaster. Debounced —
       this runs on every keystroke across three textareas. */
    const stash = debounce(saveDraft, 400);
    DRAFT_FIELDS.forEach(sel => $(sel).addEventListener('input', stash));
    $('#ev-rating').addEventListener('change', saveDraft);

    $('#ev-eval-form').addEventListener('submit', async e => {
      e.preventDefault();
      const go = $('#ev-eval-submit'), err = $('#ev-eval-error');
      if (!$('#ev-well').value.trim() && !$('#ev-improve').value.trim()) {
        return showError(err, 'Add at least a little feedback before submitting.');
      }
      const checked = $('#ev-rating input:checked');
      go.disabled = true; go.textContent = 'Submitting…'; err.hidden = true;
      try {
        if ($('#ev-eval-date').value || $('#ev-eval-time').value) {
          await update('evals', `id=eq.${local.target.id}`, {
            tour_date: $('#ev-eval-date').value || null,
            tour_time: $('#ev-eval-time').value || null
          });
        }
        const r = await rpc('submit_eval', {
          p_eval_id:   local.target.id,
          p_rating:    checked ? Number(checked.value) : null,
          p_went_well: $('#ev-well').value,
          p_improve:   $('#ev-improve').value,
          p_notes:     $('#ev-notes').value
        });
        clearDraft(local.target.id);      // it is on the server now
        closeModal($('#ev-modal-eval'));
        toast(r?.message || 'Eval submitted.');
        await reload();
      } catch (e2) { showError(err, e2.message); }
      finally { go.disabled = false; go.textContent = 'Submit eval'; }
    });

    if (isAdmin()) wireRollover();
  },

  /** Called by the shell's "End of semester" action. */
  openRollover() {
    const root = $('#ev-modal-roll');
    if (!root) return;
    $('#ev-roll-preview').hidden = true;
    $('#ev-roll-error').hidden = true;
    $('#ev-roll-clear').checked = true;
    const go = $('#ev-roll-go');
    go.disabled = true; go.textContent = 'Preview first';
    openModal(root);
  }
};

function wireRollover() {
  const reset = () => {
    $('#ev-roll-preview').hidden = true;
    $('#ev-roll-error').hidden = true;
    const go = $('#ev-roll-go');
    go.disabled = true; go.textContent = 'Preview first';
  };
  $('#ev-roll-clear').addEventListener('change', reset);

  $('#ev-roll-preview-btn').addEventListener('click', async function () {
    const err = $('#ev-roll-error');
    this.disabled = true; this.textContent = 'Checking…'; err.hidden = true;
    try {
      const s = await rpc('run_rollover', { p_from_term: termId(), p_to_term: nextTermId(), p_dry_run: true });
      const moves = Object.keys(s.moves || {}).sort();
      $('#ev-roll-preview').innerHTML = '<h4>What will happen</h4>' +
        (moves.length
          ? moves.map(k => `<div class="preview-row"><span>${esc(k)}</span><span class="n">${s.moves[k]}</span></div>`).join('')
          : '<div class="preview-row"><span>No priority changes</span><span class="n">0</span></div>') +
        `<div class="preview-note"><strong>${s.promoted}</strong> moved up · <strong>${s.already_top}</strong> already at First Priority · <strong>${s.untouched}</strong> left alone${false ? ` · <strong>${s.cleared}</strong> records cleared` : ''}</div>`;
      const box = $('#ev-roll-preview');
      box.hidden = false;
      box.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      const go = $('#ev-roll-go');
      go.disabled = false; go.textContent = 'Run rollover';
    } catch (e2) { showError(err, e2.message); }
    finally { this.disabled = false; this.textContent = 'Preview'; }
  });

  $('#ev-roll-form').addEventListener('submit', async e => {
    e.preventDefault();
    const clear = $('#ev-roll-clear').checked;
    if (!confirm(clear
      ? "This moves every guide up a tier AND clears this semester's evaluators, dates and checkboxes.\n\nSubmitted feedback is kept. Continue?"
      : 'This moves every guide up one priority tier. Continue?')) return;
    const go = $('#ev-roll-go'), err = $('#ev-roll-error');
    go.disabled = true; go.textContent = 'Running…'; err.hidden = true;
    try {
      const r = await rpc('run_rollover', { p_from_term: termId(), p_to_term: nextTermId(), p_dry_run: false });
      closeModal($('#ev-modal-roll'));
      toast(r.message);
      await reload();
    } catch (e2) {
      // Running this twice promotes everyone two tiers. Say so plainly.
      showError(err, e2.message +
        ' Check the Tracker before running it again — a rollover that runs twice' +
        ' moves every guide up two tiers, and there is no undo.');
      go.disabled = false; go.textContent = 'Run rollover';
    }
  });
}
