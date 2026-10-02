/* ============================================================== Data Sources
   Where the Hub's outside information comes from, whether it is healthy, and the
   one workflow for replacing any of it.

   Sources
     Tour Guides by Major   roster, majors, emails (a Google Sheet)
     Tour Schedule          who gives which tour, and when (a Google Sheet)
     Master roster sheet    optional

   For each: what is connected, when it last synced, how many people matched,
   and three buttons — Sync now, Change source, Review matches.

   Change source (the January workflow) is a short guided checklist that needs no
   code and no database work:
     1 Connect   paste the Google Sheets link (the link of the tab you want works)
     2 Columns   check which column is which; a layout seen before is recognised
     3 Preview   what was read, who matched, what would change — nothing saved yet
     4 Review    place anyone the Hub could not (your answers are remembered)
     5 Start     the new sheet becomes current and the first sync runs

   Everything about people matching is explained in core/identity.js; everything
   about the stored rows and what a sync may change is enforced in
   supabase/19-data-management.sql.
============================================================================ */
import { select } from '../core/db.js';
import { state, termLabel } from '../core/state.js';
import { $, esc, toast, injectStyle, prettyDate } from '../core/ui.js';
import { confirmDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, setupMissing as isSetupMissing, fail } from './admin-kit.js';
import { KINDS, FIELDS, parseSheetLink, inspectTab, readSource, loadMatchContext, matchRecords, syncRecords, runSync, headerSignature, tableToRecords, suggestMapping } from '../core/sources.js';
import { readSheet, bustSheets } from '../core/sheets.js';
import { nameKey } from '../core/identity.js';
import { refreshActions } from '../core/actioncenter.js';

injectStyle('sources-css', `
.ds-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin-bottom:18px; }
.ds-stat { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:14px 16px; }
.ds-stat b { font-size:1.5rem; letter-spacing:-.03em; display:block; } .ds-stat span { color:var(--text-soft); font-size:var(--fs-sm); }
.ds-stat.is-warn { border-color:color-mix(in srgb, var(--warn) 45%, var(--line)); } .ds-stat a { font-size:var(--fs-sm); }
.ds-src { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:18px; margin-bottom:14px; display:grid; gap:10px; }
.ds-src h3 { font-size:1.05rem; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.ds-meta { display:flex; gap:18px; flex-wrap:wrap; color:var(--text-soft); font-size:var(--fs-sm); }
.ds-err { color:var(--danger); font-size:var(--fs-sm); }
.ds-map { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; }
.ds-prev { width:100%; border-collapse:collapse; font-size:var(--fs-sm); } .ds-prev th, .ds-prev td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
.ds-rev { display:grid; gap:8px; margin:8px 0; } .ds-rev > div { display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 12px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface-1); }
.ds-rev b { flex:1 1 180px; } .ds-rev .select { width:auto; min-width:180px; }
`);

let status = null, sources = [], wiz = null, guidesList = [];
const MONTHS = ['August', 'September', 'October', 'November', 'December', 'January', 'February', 'March', 'April', 'MayJune', 'May', 'June', 'July'];
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : prettyDate(iso.slice(0, 10)); };
const plural = (n, a, b = a + 's') => `${n} ${n === 1 ? a : b}`;

async function loadAll() {
  status = await admin('admin_data_status');
  sources = status.sources || [];
}

/* ------------------------------------------------------------- overview */
function overview(view) {
  const issues = Object.values(status.issues || {}).reduce((a, b) => a + b, 0);
  const sched = status.schedule_unmatched || 0;
  view.innerHTML = `<div id="ds-setup"></div>
    <h2 class="hub-h" style="margin-top:0">${esc(status.term?.label || termLabel())}</h2>
    <div class="ds-cards">
      <div class="ds-stat"><b>${status.active_guides}</b><span>active Tour Guides on the master list</span> <a href="#/guides">Open</a></div>
      <div class="ds-stat"><b>${status.needing_eval}</b><span>need evaluation · ${status.awaiting_assignment} awaiting an evaluator</span> <a href="#/evalroster">Open</a></div>
      <div class="ds-stat ${issues ? 'is-warn' : ''}"><b>${issues}</b><span>roster items to review (people not matched, conflicts, missing)</span> <a href="#/reconcile">Review</a></div>
      <div class="ds-stat ${sched ? 'is-warn' : ''}"><b>${sched}</b><span>schedule rows not matched to a Tour Guide</span> <a href="#/reconcile?kind=tour_schedule">Review</a></div>
      ${status.not_on_eval_roster ? `<div class="ds-stat is-warn"><b>${status.not_on_eval_roster}</b><span>active guides not on the evaluation roster</span> <a href="#/evalroster">Add</a></div>` : ''}
    </div>
    <h2 class="hub-h">Connected sources</h2>
    ${Object.keys(KINDS).map(kind => sourceCard(kind)).join('')}`;
}

function sourceCard(kind) {
  const k = KINDS[kind], s = sources.find(x => x.kind === kind);
  if (!s) return `<section class="ds-src"><h3>${esc(k.label)} <span class="chip is-mute">Not connected</span></h3><p class="muted" style="font-size:.88rem;margin:0">${esc(k.blurb)}${kind === 'tour_schedule' ? ' Until one is connected, the Hub reads the workbook linked under Settings.' : ''}</p>
    <div><button class="btn btn-primary btn-sm" data-connect="${kind}">Connect</button></div></section>`;
  const bad = s.status === 'error';
  return `<section class="ds-src"><h3>${esc(k.label)} <span class="chip ${bad ? 'is-warn' : 'is-good'}">${bad ? 'Needs attention' : 'Connected'}</span></h3>
    <div class="ds-meta"><span><b>${esc(s.name)}</b>${s.tab ? ` · tab “${esc(s.tab)}”` : s.gid ? ' · selected tab' : ''} · ${s.adapter === 'grid' ? 'weekly grid' : 'table'}</span><span>${s.row_count ?? '—'} rows</span>
      <span>Last synced: ${esc(ago(s.last_success_at))}</span>${s.last_attempt_at && s.last_attempt_at !== s.last_success_at ? `<span>Last tried: ${esc(ago(s.last_attempt_at))}</span>` : ''}</div>
    ${s.last_error ? `<div class="ds-err">${esc(s.last_error)}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-sync="${esc(s.id)}">Sync now</button><button class="btn btn-ghost btn-sm" data-change="${kind}">Change source</button>
      <a class="btn btn-ghost btn-sm" href="#/reconcile?kind=${kind}">Review matches</a><a class="btn btn-quiet btn-sm" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${esc(s.sheet_id)}">Open the sheet</a></div></section>`;
}

/** Sync now: read, match, then SHOW what would change before saving. */
async function syncNow(id, view) {
  const s = sources.find(x => x.id === id);
  const btn = view.querySelector(`[data-sync="${id}"]`); btn.disabled = true; btn.textContent = 'Reading the sheet…';
  try {
    bustSheets();
    const src = { id: s.id, kind: s.kind, adapter: s.adapter, sheet_id: s.sheet_id, tab: s.tab, gid: s.gid, column_map: (await select('external_sources', `select=column_map&id=eq.${id}`))[0]?.column_map || {} };
    const run = await runSync(src, { apply: false });
    const r = run.result;
    const ok = await confirmDialog({ title: `Sync ${KINDS[s.kind].label}?`, confirmLabel: 'Sync', lines: [
      `${plural(r.rows, 'row')} read. ${r.matched_auto} matched automatically${r.matched_saved ? `, ${r.matched_saved} using saved matches` : ''}, ${r.needs_review} need review.`,
      `Changes: ${plural(r.new_people, 'new person', 'new people')} not on your list · ${plural(r.major_updates, 'major update')}${r.conflicts ? ` · ${plural(r.conflicts, 'conflict')}` : ''}${r.possible_inactive ? ` · ${plural(r.possible_inactive, 'person')} on your list but not in the sheet` : ''}.`,
      'Nobody is added, removed or archived automatically; anything uncertain goes to Reconciliation.', ...(run.warnings || [])] });
    if (!ok) { btn.disabled = false; btn.textContent = 'Sync now'; return; }
    await syncRecords(s.id, run.records, true);
    toast('Synced.'); await loadAll(); overview(view); refreshActions({ force: true });
  } catch (e) { fail(e); await loadAll().catch(() => {}); overview(view); }
}

/* ------------------------------------------------------------ the wizard */
const STEPS = ['Connect', 'Columns', 'Preview', 'Review', 'Start'];

function stepper() { return `<div class="sm-steps">${STEPS.map((s, i) => `<span class="sm-step ${i === wiz.step ? 'is-on' : i < wiz.step ? 'is-done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`; }
const wizNav = (next = 'Continue', back = true) => `<div class="sm-nav">${back ? '<button class="btn btn-ghost" data-w="back">Back</button>' : '<button class="btn btn-ghost" data-w="cancel">Cancel</button>'}<button class="btn btn-primary" data-w="next">${next}</button></div>`;

function paintWizard(view, error = '') {
  const w = wiz, k = KINDS[w.kind];
  let body = '';
  if (w.step === 0) body = `<h3>Connect the new ${esc(k.label)} sheet</h3>
    <p class="muted" style="font-size:.88rem">Paste the Google Sheets link. If the sheet has several tabs, open the one you want first, then copy the link — it remembers the tab. The sheet must be shared as “Anyone with the link can view”.</p>
    <label class="field"><span>Link to the sheet</span><input id="w-link" value="${esc(w.link || '')}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
    ${w.kind === 'tour_schedule' ? `<fieldset class="field"><span>How is the schedule laid out?</span>
      <label class="toggle-row"><input type="radio" name="w-adapter" value="grid" ${w.adapter === 'grid' ? 'checked' : ''}> Weekly grid with month tabs, like the current Purdue schedule</label>
      <label class="toggle-row"><input type="radio" name="w-adapter" value="table" ${w.adapter === 'table' ? 'checked' : ''}> A simple table — one row per tour, with a date column</label></fieldset>` : ''}
    <label class="field" id="w-tabwrap" ${w.adapter === 'grid' ? 'hidden' : ''}><span>Tab name (only if the link did not include one)</span><input id="w-tab" value="${esc(w.tab || '')}" placeholder="Sheet1"></label>${wizNav('Check the sheet', false)}`;
  else if (w.step === 1) {
    const fields = FIELDS[w.kind];
    body = `<h3>Which column is which?</h3><p class="muted" style="font-size:.88rem">${w.remembered ? 'This layout was recognised from last time — check it still looks right.' : 'These are best guesses from the headings. Change anything that is wrong.'}</p>
      <div class="ds-map">${fields.map(([f, label]) => `<label class="field"><span>${esc(label)}</span><select class="select" data-col="${f}"><option value="">— not used —</option>${w.headers.map(h => `<option${w.map[f] === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>${wizNav('Preview')}`;
  } else if (w.step === 2) {
    const p = w.preview;
    body = !p ? '<p class="muted">Reading and matching…</p>' : `<h3>Here is what the Hub found</h3>
      <div class="am-sum"><div><b>${p.rows}</b>rows read</div><div><b>${p.sync.matched_auto}</b>matched automatically</div><div><b>${p.sync.matched_saved}</b>matched from saved answers</div><div><b>${p.sync.needs_review}</b>need review</div></div>
      <p style="font-size:.9rem">${plural(p.sync.new_people, 'new person', 'new people')} not on your list · ${plural(p.sync.major_updates, 'major update')}${p.sync.conflicts ? ` · ${plural(p.sync.conflicts, 'conflict')} to decide` : ''}${p.sync.possible_inactive ? ` · ${plural(p.sync.possible_inactive, 'person')} on your list but not in this sheet` : ''}.</p>
      ${(p.warnings || []).map(x => `<div class="sm-warn">${esc(x)}</div>`).join('')}
      <table class="ds-prev"><thead><tr><th>Name</th><th>${w.kind === 'tour_schedule' ? 'When' : 'Major'}</th><th>Matched to</th></tr></thead><tbody>${p.records.slice(0, 8).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(w.kind === 'tour_schedule' ? `${r.occurred_on || ''} ${r.slot || ''}` : r.payload.major || '')}</td>
        <td>${r.match.guideId ? esc(guidesList.find(g => g.id === r.match.guideId)?.full_name || '') + ` <span class="chip">${esc(r.match.basis)}</span>` : `<span class="chip is-warn">${r.match.basis === 'ignored' ? 'ignored' : 'needs review'}</span>`}</td></tr>`).join('')}</tbody></table>${wizNav('Continue')}`;
  } else if (w.step === 3) {
    const un = w.preview.records.filter(r => !r.match.guideId && r.match.basis !== 'ignored');
    const seen = new Set(), people = un.filter(r => !seen.has(r.identity) && seen.add(r.identity)).slice(0, 25);
    body = `<h3>People the Hub could not place</h3><p class="muted" style="font-size:.88rem">Choose who each one is. Your answer is remembered — you will not be asked again, here or next semester. ${un.length ? '' : 'Nobody needs review.'}</p>
      <div class="ds-rev">${people.map((r, i) => `<div><b>${esc(r.name)}${r.email ? ` <span class="src-badge">${esc(r.email)}</span>` : ''}</b>
        <select class="select" data-pick="${i}" aria-label="Who is ${esc(r.name)}?"><option value="">Choose a Tour Guide…</option>${(r.match.candidates || []).map(c => `<option value="${esc(c.id)}">★ ${esc(c.name)} — ${esc(c.why || 'possible match')}</option>`).join('')}${guidesList.filter(g => g.active && !(r.match.candidates || []).some(c => c.id === g.id)).map(g => `<option value="${esc(g.id)}">${esc(g.full_name)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" data-match="${i}">Match</button></div>`).join('')}</div>
      ${un.length > people.length ? `<p class="muted" style="font-size:.8rem">…and ${un.length - people.length} more. You can finish them in Reconciliation after the sheet is connected.</p>` : ''}
      <p class="muted" style="font-size:.82rem">Not sure? Skip — they are listed in Reconciliation with the same choices.</p>${wizNav('Continue')}`;
    w.people = people;
  } else if (w.step === 4) {
    body = `<h3>Ready to start using “${esc(w.name)}”</h3>
      <p class="muted" style="font-size:.9rem">It becomes the current ${esc(k.label)} source and the first sync runs now. ${sources.find(s => s.kind === w.kind) ? `The previous sheet (${esc(sources.find(s => s.kind === w.kind).name)}) is disconnected, and its rows are kept as history.` : ''} Nobody is added, removed or archived automatically.</p>
      <div class="sm-nav"><button class="btn btn-ghost" data-w="back">Back</button><button class="btn btn-primary" data-w="go">Start using it</button></div>`;
  }
  view.innerHTML = `<section class="sm-card">${stepper()}${body}${error ? `<p class="form-error">${esc(error)}</p>` : ''}</section>`;
}

/** Does this workbook look like the weekly-grid schedule? (month tabs with a "Time" column) */
async function looksLikeGrid(sheetId) {
  for (const m of MONTHS) {
    try { const rows = await readSheet({ sheetId, tab: m }); if (rows.some(r => String(r[2] || '').trim() === 'Time')) return true; } catch (e) { if (/not shared/i.test(e.message)) throw e; }
  }
  return false;
}

async function advance(view, to) {
  const w = wiz;
  try {
    if (w.step === 0 && to > 0) {
      const { id, gid } = parseSheetLink($('#w-link', view).value); w.link = $('#w-link', view).value;
      if (!id) return paintWizard(view, 'That does not look like a Google Sheets link.');
      w.sheetId = id; w.gid = gid; w.tab = ($('#w-tab', view)?.value || '').trim();
      if (w.kind === 'tour_schedule') {
        w.adapter = view.querySelector('input[name=w-adapter]:checked')?.value || 'table';
        if (!view.querySelector('input[name=w-adapter]:checked')) { w.adapter = (await looksLikeGrid(id)) ? 'grid' : 'table'; }
      } else w.adapter = 'table';
      w.name = `${KINDS[w.kind].label} (${new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })})`;
      if (w.adapter === 'grid') { w.map = {}; w.step = 2; paintWizard(view); return preview(view); }
      const t = await inspectTab({ kind: w.kind, sheetId: id, tab: w.tab, gid });
      Object.assign(w, { headers: t.headers, map: t.map, remembered: t.remembered, step: 1 }); return paintWizard(view);
    }
    if (w.step === 1 && to > 1) {
      const need = w.kind === 'tour_schedule' ? !w.map.date || !(w.map.name || (w.map.first && w.map.last)) : !(w.map.name || (w.map.first && w.map.last) || w.map.email);
      if (need) return paintWizard(view, w.kind === 'tour_schedule' ? 'Choose the Tour Guide column and the Date column.' : 'Choose the column that holds the person (a name, first and last name, or an email).');
      w.step = 2; paintWizard(view); return preview(view);
    }
    w.step = to; paintWizard(view);
    if (w.step === 3 && !guidesList.length) { await loadMatchContext().then(c => { guidesList = c.guides; }); paintWizard(view); }
  } catch (e) { paintWizard(view, e.message); }
}

async function preview(view) {
  const w = wiz;
  try {
    const src = { kind: w.kind, adapter: w.adapter, sheet_id: w.sheetId, tab: w.tab, gid: w.gid, column_map: w.map };
    const read = await readSource(src);
    const ctx = await loadMatchContext(); guidesList = ctx.guides;
    matchRecords(read.records, w.kind, ctx);
    // save (inactive) so the database can rehearse the sync exactly
    w.sourceId = await admin('admin_save_source', { p_id: w.sourceId || null, p_kind: w.kind, p_name: w.name, p_sheet_id: w.sheetId, p_sheet_title: w.name, p_tab: w.tab || null, p_gid: w.gid || null,
      p_adapter: w.adapter, p_column_map: w.map, p_options: {} });
    const sync = await syncRecords(w.sourceId, read.records, false);
    w.preview = { ...read, sync }; w.ctx = ctx; paintWizard(view);
  } catch (e) { w.step = w.adapter === 'grid' ? 0 : 1; paintWizard(view, e.message); }
}

let abort = null;

export default {
  id: 'sources', needs: 'admin', title: 'Data Sources', crumb: 'Spreadsheets the Hub learns from', icon: '🔌', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); wiz = null; },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    wiz = null;
    try { await loadAll(); } catch (e) { view.innerHTML = isSetupMissing(e) || e.setup ? setupNotice() : `<p class="form-error">${esc(e.message)}</p>`; return; }
    overview(view);
    loadMatchContext().then(c => { guidesList = c.guides; }).catch(() => {});

    view.addEventListener('click', async e => {
      const sync = e.target.closest('[data-sync]'), change = e.target.closest('[data-change],[data-connect]');
      if (sync) return syncNow(sync.dataset.sync, view);
      if (change) { wiz = { kind: change.dataset.change || change.dataset.connect, step: 0, adapter: 'table', map: {}, link: '', tab: '' }; if (wiz.kind === 'tour_schedule') wiz.adapter = 'auto'; return paintWizard(view); }
      const a = e.target.closest('[data-w]')?.dataset.w;
      if (a && wiz) {
        if (a === 'cancel') { wiz = null; return overview(view); }
        if (a === 'back') { wiz.step = wiz.step === 2 && wiz.adapter === 'grid' ? 0 : Math.max(0, wiz.step - 1); return paintWizard(view); }
        if (a === 'next') return advance(view, wiz.step + 1);
        if (a === 'go') {
          const btn = e.target.closest('button'); btn.disabled = true; btn.textContent = 'Starting…';
          try {
            await admin('admin_save_template', { p_kind: wiz.kind, p_signature: headerSignature(wiz.headers || []) || `grid:${wiz.kind}`, p_adapter: wiz.adapter, p_column_map: wiz.map });
            await admin('admin_activate_source', { p_id: wiz.sourceId });
            const r = await syncRecords(wiz.sourceId, wiz.preview.records, true);
            bustSheets(); await loadAll();
            // the shell reads connected sources once at sign-in; refresh it
            const act = (await select('external_sources', 'select=id,kind,sheet_id,adapter,tab,gid&active=eq.true')).reduce((m, x) => ({ ...m, [x.kind]: x }), {});
            state.sources = act;
            view.innerHTML = `<section class="sm-card">${emptyState({ title: `${KINDS[wiz.kind].label} is connected`, icon: 'check', text: `${r.rows} rows read, ${r.needs_review} still need a decision.`,
              action: `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px">${r.needs_review ? '<a class="btn btn-primary" href="#/reconcile">Review the rest</a>' : ''}<button class="btn btn-ghost" data-w="cancel">Back to Data Sources</button></div>` })}</section>`;
            refreshActions({ force: true });
          } catch (x) { fail(x); btn.disabled = false; btn.textContent = 'Start using it'; }
        }
        return;
      }
      const m = e.target.closest('[data-match]');
      if (m && wiz) {
        const i = Number(m.dataset.match), rec = wiz.people[i], gid = view.querySelector(`[data-pick="${i}"]`).value;
        if (!gid) return toast('Choose a Tour Guide first.', 'err');
        try { await admin('admin_confirm_match', { p_kind: wiz.kind, p_key: rec.identity, p_guide: gid, p_name: rec.name, p_email: rec.email || null });
          const ctx = await loadMatchContext(); guidesList = ctx.guides; matchRecords(wiz.preview.records, wiz.kind, ctx); paintWizard(view); toast(`${rec.name} matched and remembered.`);
        } catch (x) { fail(x); }
      }
    }, { signal });

    view.addEventListener('change', e => {
      if (!wiz) return;
      const t = e.target;
      if (t.dataset.col) { if (t.value) wiz.map[t.dataset.col] = t.value; else delete wiz.map[t.dataset.col]; }
      else if (t.name === 'w-adapter') { wiz.adapter = t.value; $('#w-tabwrap', view).hidden = t.value === 'grid'; }
    }, { signal });
  }
};
