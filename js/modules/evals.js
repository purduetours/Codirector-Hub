/* ============================================================ Evals module
   The tour-guide eval tracker, ported into the hub. Same backend, same rules:
   claim -> schedule -> submit, with completed evals visible only to admins
   (filtered server-side) plus the end-of-semester rollover.
============================================================================ */
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { refreshSession } from '../core/auth.js';
import { paintNav } from '../core/router.js';
import {
  $, $$, esc, sameName, prettyDate, prettyTime, toast, showError,
  openModal, closeModal, wireModal, debounce, injectStyle, SEARCH_ICON
} from '../core/ui.js';

const STATUS_LABEL = { open: 'Open', claimed: 'Claimed', submitted: 'Submitted', reviewed: 'Reviewed', skip: 'No eval' };
const TONE = { open: 'tone-open', claimed: 'tone-warn', submitted: 'tone-good', reviewed: 'tone-info', skip: 'tone-mute' };
const TOUR_PREVIEW = 5;

const local = { tab: 'open', search: '', priority: '', target: null, toursExpanded: false };

const isMine = g => sameName(g.evaluator, state.name);

injectStyle('evals-css', `
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
.rating input:checked + label { background:var(--accent); border-color:var(--accent); color:#fff; }
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
`);

/* ---------------------------------------------------------------- markup */

function shell() {
  const admin = state.isAdmin;
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
    <button class="tab" data-tab="mine">My evals <span class="tab-badge" id="ev-badge" hidden>0</span></button>
    <button class="tab" data-tab="claimed">Claimed</button>
    <button class="tab" data-tab="done" ${admin ? '' : 'hidden'}>Done</button>
    <button class="tab" data-tab="all">Everyone</button>
  </nav>

  <div class="filters" style="margin-bottom:16px">
    <label class="search">${SEARCH_ICON}<input type="search" id="ev-search" placeholder="Search a guide's name…" autocomplete="off"></label>
    <select id="ev-priority" class="select" aria-label="Filter by priority"><option value="">All priorities</option></select>
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
        <p class="hint">Submitting writes to the Submissions tab and drops this guide to Last Priority.</p>
        <p class="form-error" id="ev-eval-error" hidden></p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" id="ev-eval-submit">Submit eval</button>
      </footer>
    </form>
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
  const admin = state.isAdmin;
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
  if ((g.status === 'submitted' || g.status === 'reviewed') && admin) {
    actions.push(b('review', g.status === 'reviewed' ? 'Undo reviewed' : 'Mark reviewed', 'btn-ghost'));
  }

  return `<article class="card ev-card ${mine ? 'is-mine' : ''}" data-status="${esc(g.status)}"
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

  const rows = visible();
  $('#ev-list').innerHTML = rows.map(card).join('');
  $('#ev-empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('#ev-empty-text').textContent = (local.search || local.priority)
      ? 'No guides match those filters.' : (EMPTY[local.tab] || 'Nothing here.');
  }
  paintNav();
}

async function reload() {
  await refreshSession();
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

function openClaim(g, editing) {
  local.target = g;
  local.toursExpanded = false;
  $('#ev-claim-title').textContent = editing ? 'Edit schedule' : 'Claim eval';
  $('#ev-claim-sub').textContent = `${g.name} · ${g.priority || ''}`;
  $('#ev-claim-date').value = g.date || '';
  $('#ev-claim-time').value = g.time || '';
  $('#ev-claim-notes').value = g.notes || '';
  const go = $('#ev-claim-submit');
  go.textContent = editing ? 'Save' : 'Claim it';
  go.dataset.mode = editing ? 'schedule' : 'claim';
  $('#ev-claim-error').hidden = true;
  renderTours();
  openModal($('#ev-modal-claim'));
}

function openEval(g) {
  local.target = g;
  $('#ev-eval-sub').textContent = `${g.name} · ${g.priority || ''}`;
  $('#ev-eval-date').value = g.date || '';
  $('#ev-eval-time').value = g.time || '';
  ['#ev-well', '#ev-improve', '#ev-notes'].forEach(s => ($(s).value = ''));
  $$('#ev-rating input').forEach(i => (i.checked = false));
  $('#ev-eval-error').hidden = true;
  openModal($('#ev-modal-eval'));
  setTimeout(() => $('#ev-well').focus(), 60);
}

/* ---------------------------------------------------------------- module */

export default {
  id: 'evals',
  title: 'Eval Tracker',
  crumb: 'Claim and submit tour guide evaluations',
  icon: '📋',
  section: 'Tools',
  badge: () => state.guides.filter(g => isMine(g) && g.status === 'claimed').length || null,

  async mount(view) {
    if (!state.guides.length) await refreshSession();
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
      if (s.dataset.jump === 'done' && !state.isAdmin) return;
      $$('#ev-tabs .tab').find(t => t.dataset.tab === s.dataset.jump)?.click();
    });

    $('#ev-search').addEventListener('input', debounce(e => { local.search = e.target.value; paint(); }));
    $('#ev-priority').addEventListener('change', e => { local.priority = e.target.value; paint(); });

    $('#ev-list').addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const g = state.guides.find(x => x.id === b.dataset.id);
      if (!g) return;

      if (b.dataset.act === 'claim')  return openClaim(g, false);
      if (b.dataset.act === 'edit')   return openClaim(g, true);
      if (b.dataset.act === 'submit') return openEval(g);

      if (b.dataset.act === 'unclaim') {
        if (!confirm(`Release ${g.name} back to the open list?`)) return;
        b.disabled = true;
        try { toast((await api('unclaim', { id: g.id })).message); await reload(); }
        catch (err) { toast(err.message, 'err'); b.disabled = false; }
      }
      if (b.dataset.act === 'review') {
        b.disabled = true;
        try { toast((await api('markReviewed', { id: g.id, value: g.status !== 'reviewed' })).message); await reload(); }
        catch (err) { toast(err.message, 'err'); b.disabled = false; }
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
        const r = await api(mode, {
          id: local.target.id,
          date: $('#ev-claim-date').value,
          time: $('#ev-claim-time').value,
          notes: $('#ev-claim-notes').value
        });
        closeModal($('#ev-modal-claim'));
        toast(r.message);
        await reload();
      } catch (e2) {
        showError(err, e2.message);
        reload().catch(() => {});
      } finally { go.disabled = false; go.textContent = label; }
    });

    $('#ev-eval-form').addEventListener('submit', async e => {
      e.preventDefault();
      const go = $('#ev-eval-submit'), err = $('#ev-eval-error');
      if (!$('#ev-well').value.trim() && !$('#ev-improve').value.trim()) {
        return showError(err, 'Add at least a little feedback before submitting.');
      }
      const checked = $('#ev-rating input:checked');
      go.disabled = true; go.textContent = 'Submitting…'; err.hidden = true;
      try {
        const r = await api('submit', {
          id: local.target.id,
          date: $('#ev-eval-date').value,
          time: $('#ev-eval-time').value,
          rating: checked ? checked.value : '',
          wentWell: $('#ev-well').value,
          improve: $('#ev-improve').value,
          notes: $('#ev-notes').value
        });
        closeModal($('#ev-modal-eval'));
        toast(r.priorityChanged ? `${r.message} Priority moved to ${r.priorityChanged.split(' -> ')[1]}.` : r.message);
        await reload();
      } catch (e2) { showError(err, e2.message); }
      finally { go.disabled = false; go.textContent = 'Submit eval'; }
    });

    if (state.isAdmin) wireRollover();
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
      const { summary: s } = await api('rollover', { clearProgress: $('#ev-roll-clear').checked, dryRun: true });
      const moves = Object.keys(s.moves || {}).sort();
      $('#ev-roll-preview').innerHTML = '<h4>What will happen</h4>' +
        (moves.length
          ? moves.map(k => `<div class="preview-row"><span>${esc(k)}</span><span class="n">${s.moves[k]}</span></div>`).join('')
          : '<div class="preview-row"><span>No priority changes</span><span class="n">0</span></div>') +
        `<div class="preview-note"><strong>${s.promoted}</strong> moved up · <strong>${s.alreadyTop}</strong> already at First Priority · <strong>${s.untouched}</strong> left alone${s.clearProgress ? ` · <strong>${s.cleared}</strong> records cleared` : ''}</div>`;
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
      const r = await api('rollover', { clearProgress: clear, dryRun: false });
      closeModal($('#ev-modal-roll'));
      toast(r.message);
      await reload();
    } catch (e2) { showError(err, e2.message); go.disabled = false; go.textContent = 'Run rollover'; }
  });
}
