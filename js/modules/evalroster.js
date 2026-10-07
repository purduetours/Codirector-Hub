/* ========================================================== Evaluation Roster
   Who needs evaluating this semester, how urgently, and who will do it.

   Every row is a canonical Tour Guide (the same person the schedule, the
   Tour Guides by Major sheet and training all point at); nothing here is a
   second list of people.

   Priority
     The Hub already ranks guides in tiers (First Priority … Last Priority, and
     "No Need to Eval"), and the end-of-semester rollover moves them up a tier.
     This screen edits those same tiers, and shows each as a plain band — High
     (tiers 1–2), Normal (3–4), Low (5+), None — so you can filter and sort by
     urgency without learning the ladder. Priority is always set here, by hand;
     no spreadsheet can overwrite it.

   Needs evaluation
     A guide needs one when their tier is anything but "No Need to Eval".
     Suggestions ("14 active guides are not on this semester's roster") are
     shown as suggestions; nothing is added until you say so.

   Auto-match
     Proposes who should evaluate each guide at which of their upcoming tours,
     with the reasoning, and waits for approval (see core/evalmatch.js).
============================================================================ */
import { select } from '../core/db.js';
import { state, termId, termLabel } from '../core/state.js';
import { $, esc, toast, injectStyle, debounce, prettyDate, prettyTime, todayISO } from '../core/ui.js';
import { downloadCsv } from '../core/csv.js';
import { confirmDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, fail } from './admin-kit.js';
import { tableHtml, bindTable, sortRows, nextSort } from './datatable.js';
import { loadRoster } from './evals.js';
import { suggestMatches, priorityBand, bookedSlots } from '../core/evalmatch.js';
import { loadEvaluators } from '../core/evaldata.js';
import { refreshActions } from '../core/actioncenter.js';

injectStyle('evalroster-css', `
.er-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-bottom:16px; }
.er-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:14px 16px; display:grid; gap:8px; }
.er-card b { font-size:1.6rem; letter-spacing:-.03em; } .er-card span { color:var(--text-soft); font-size:var(--fs-sm); }
.er-card.is-warn { border-color:color-mix(in srgb, var(--warn) 45%, var(--line)); }
.am-sum { display:flex; gap:12px; flex-wrap:wrap; margin:10px 0 14px; }
.am-sum div { padding:10px 16px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface-1); } .am-sum b { font-size:1.3rem; display:block; }
.am-why { margin:4px 0 0; padding-left:18px; color:var(--text-soft); font-size:var(--fs-xs); }
.am-bad { color:var(--text-soft); font-size:var(--fs-sm); }
`);

let guideInfo = new Map(), last = new Map(), notOnRoster = [], evaluators = [], prios = [], setupMissing = false;
const ui = { tab: 'roster', q: '', band: '', status: '', need: '', sort: { key: 'rank', dir: 1 }, picked: new Set(), plan: null, edit: new Map() };

async function load() {
  await loadRoster();
  const [gs, subs, pr] = await Promise.all([
    select('guides', 'select=id,first_name,last_name,full_name,active,tour_eligible,member_id,is_leadership').catch(() => { setupMissing = true; return select('guides', 'select=id,first_name,last_name,full_name,active'); }),
    select('evals', 'select=guide_id,submitted_at&submitted_at=not.is.null').catch(() => []),
    select('priorities', 'select=name,sort_order,needs_eval&order=sort_order.asc')
  ]);
  guideInfo = new Map(gs.map(g => [g.id, g]));
  prios = pr;
  last = new Map(); subs.forEach(s => { if (!last.get(s.guide_id) || s.submitted_at > last.get(s.guide_id)) last.set(s.guide_id, s.submitted_at); });
  const onRoster = new Set(state.guides.map(g => g.guideId));
  const termsOff = await select('guide_terms', `select=guide_id&term_id=eq.${termId()}&active=eq.false`).catch(() => []);
  const off = new Set(termsOff.map(t => t.guide_id));
  notOnRoster = gs.filter(g => g.active && !onRoster.has(g.id) && !off.has(g.id));
  evaluators = await loadEvaluators(state.guides);
}

const band = g => priorityBand(g.rank, !g.skip);
const statusLabel = { open: 'Needs an evaluator', claimed: 'Claimed', submitted: 'Submitted', reviewed: 'Reviewed', skip: 'No evaluation needed' };

function shown() {
  const q = ui.q.trim().toLowerCase();
  return state.guides.filter(g => (!ui.band || band(g) === ui.band) && (!ui.status || g.status === ui.status)
    && (!ui.need || (ui.need === 'yes') === !g.skip) && (!q || g.name.toLowerCase().includes(q)));
}

const columns = [
  { key: 'name', label: 'Tour Guide', sortable: true, render: g => `<b>${esc(g.name)}</b>${guideInfo.get(g.guideId)?.is_leadership ? '<span class="chip is-hi">Leadership</span>' : ''}` },
  { key: 'rank', label: 'Priority', sortable: true, value: g => g.skip ? 99 : g.rank, render: g => `<select class="select" data-prio="${esc(g.guideId)}" aria-label="Priority for ${esc(g.name)}">${prios.map(p => `<option${p.name === g.priority ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select><span class="chip ${band(g) === 'High' ? 'is-hi' : band(g) === 'None' ? 'is-mute' : ''}">${band(g)}</span>` },
  { key: 'need', label: 'Needs evaluation', sortable: true, value: g => g.skip ? 0 : 1, render: g => `<input type="checkbox" data-need="${esc(g.guideId)}" ${g.skip ? '' : 'checked'} aria-label="Needs evaluation: ${esc(g.name)}">` },
  { key: 'status', label: 'Status', sortable: true, render: g => esc(statusLabel[g.status] || g.status) },
  { key: 'evaluator', label: 'Evaluator', sortable: true, render: g => esc(g.evaluator || '—') },
  { key: 'tour', label: 'Evaluation tour', sortable: true, value: g => g.date || '9', render: g => g.date ? `${esc(prettyDate(g.date))}${g.time ? ` · ${esc(prettyTime(g.time))}` : ''}` : '—' },
  { key: 'next', label: 'Next scheduled tour', value: g => g.tours?.[0]?.date || '9', sortable: true, render: g => g.tours?.[0] ? `${esc(prettyDate(g.tours[0].date))}${g.tours[0].start ? ` · ${esc(prettyTime(g.tours[0].start))}` : ''}` : '<span class="muted">none found</span>' },
  { key: 'last', label: 'Last evaluated', sortable: true, value: g => last.get(g.guideId) || '', render: g => last.get(g.guideId) ? esc(prettyDate(last.get(g.guideId).slice(0, 10))) : '<span class="muted">never</span>' }
];

/* -------------------------------------------------------------- the tabs */
function rosterHtml() {
  const open = state.guides.filter(g => g.status === 'open').length;
  return `${notOnRoster.length ? `<div class="er-card is-warn" style="margin-bottom:12px"><b>${notOnRoster.length}</b><span>active Tour Guides are not on ${esc(termLabel())}’s evaluation roster: ${esc(notOnRoster.slice(0, 4).map(g => g.full_name).join(', '))}${notOnRoster.length > 4 ? '…' : ''}.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="addall">Add all to the roster</button><a class="btn btn-ghost btn-sm" href="#/guides">Review individually</a></div></div>` : ''}
    <div class="gd-bar"><input id="er-q" type="search" placeholder="Search guides" aria-label="Search guides" value="${esc(ui.q)}">
      <select id="er-band" class="select" aria-label="Priority"><option value="">Any priority</option>${['High', 'Normal', 'Low', 'None'].map(b => `<option${ui.band === b ? ' selected' : ''}>${b}</option>`).join('')}</select>
      <select id="er-status" class="select" aria-label="Status"><option value="">Any status</option>${Object.entries(statusLabel).map(([k, v]) => `<option value="${k}"${ui.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <select id="er-need" class="select" aria-label="Needs evaluation"><option value="">Needs evaluation: any</option><option value="yes"${ui.need === 'yes' ? ' selected' : ''}>Needs evaluation</option><option value="no"${ui.need === 'no' ? ' selected' : ''}>Does not</option></select>
      <button class="btn btn-ghost btn-sm" data-act="export">Export CSV</button></div>
    <div id="er-selbar"></div>
    <p class="muted" style="font-size:.8rem;margin:0 2px 8px">${open} still need an evaluator. High = first and second priority, Normal = third and fourth, Low = fifth and below.</p>
    <div id="er-table"></div>`;
}

function paintTable() {
  const list = sortRows(shown(), columns, ui.sort);
  $('#er-table').innerHTML = tableHtml({ columns, rows: list, sort: ui.sort, selected: ui.picked, rowKey: g => g.guideId,
    empty: emptyState(state.guides.length ? { title: 'Nobody matches those filters', icon: 'search', text: 'Change the filters above.' }
      : { title: `Nobody is on the evaluation roster for ${termLabel()} yet`, icon: 'evals', text: 'Add Tour Guides to the roster with the button above, or start the semester from Admin → Semester to carry returning guides forward.' }) });
  const n = ui.picked.size;
  $('#er-selbar').innerHTML = n ? `<div class="pp-sel"><b>${n} selected</b>
    <select id="er-bulkprio" class="select" aria-label="Set priority"><option value="">Set priority…</option>${prios.map(p => `<option>${esc(p.name)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" data-act="need-yes">Needs evaluation</button><button class="btn btn-ghost btn-sm" data-act="need-no">No evaluation needed</button><button class="btn btn-quiet btn-sm" data-act="clear">Clear</button></div>` : '';
}

function matchHtml() {
  const p = ui.plan;
  if (!p) return `<div class="er-card"><b>Auto-match</b><span>Pairs each Tour Guide who still needs an evaluation with an upcoming tour and a free evaluator, highest priority first. You see every pairing and the reasoning, and nothing is assigned until you approve.</span>
    <div><button class="btn btn-primary" data-act="build">Build suggestions</button></div></div>`;
  return `<div class="am-sum"><div><b>${p.needing}</b>need evaluations</div><div><b>${p.matches.length}</b>suggested</div><div><b>${p.unable.length}</b>unable to match</div><div><b>${p.conflicts.length}</b>used a later tour</div></div>
    ${p.matches.length ? `<div class="dt-wrap"><table class="dt"><thead><tr><th class="dt-sel"><input type="checkbox" data-am-all checked aria-label="Select all"></th><th>Tour Guide</th><th>Tour</th><th>Evaluator</th><th>Why</th></tr></thead><tbody>
      ${p.matches.map((m, i) => `<tr><td class="dt-sel"><input type="checkbox" data-am="${i}" checked></td>
        <td><b>${esc(m.guideName)}</b><span class="chip ${m.rank <= 2 ? 'is-hi' : ''}">${esc(priorityBand(m.rank))}</span></td>
        <td>${esc(prettyDate(m.date))}${m.start ? ` · ${esc(prettyTime(m.start))}` : ''}${m.conflict ? '<span class="chip is-warn">later tour</span>' : ''}</td>
        <td><select class="select" data-am-eval="${i}" aria-label="Evaluator for ${esc(m.guideName)}">${evaluators.filter(e => e.available).map(e => `<option value="${esc(e.id)}"${e.id === m.evaluatorId ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select></td>
        <td><details><summary>Reasons</summary><ul class="am-why">${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details></td></tr>`).join('')}</tbody></table></div>
      <div style="display:flex;gap:8px;margin:14px 0;flex-wrap:wrap"><button class="btn btn-primary" data-act="approve">Approve selected</button><button class="btn btn-ghost" data-act="build">Rebuild</button></div>`
      : emptyState({ title: 'Nothing to suggest', icon: 'evals', text: p.needing ? 'Nobody who needs an evaluation has a usable upcoming tour yet. Check the tour schedule is connected under Data Sources.' : 'Everyone who needs an evaluation already has an evaluator.' })}
    ${p.unable.length ? `<h4 style="margin:18px 0 8px;font-size:.92rem">Unable to match</h4><div class="am-bad">${p.unable.map(u => `<div>• <b>${esc(u.guide.name)}</b> — ${esc(u.reason)}</div>`).join('')}</div>` : ''}`;
}

function evaluatorsHtml() {
  const cols = [{ key: 'name', label: 'Evaluator', sortable: true, render: e => `<b>${esc(e.name)}</b>` }, { key: 'workload', label: 'Evaluations claimed', sortable: true },
    { key: 'available', label: 'Available for auto-match', render: e => `<input type="checkbox" data-avail="${esc(e.id)}" ${e.available ? 'checked' : ''} aria-label="Available: ${esc(e.name)}">` }];
  return `<p class="muted" style="font-size:.86rem;margin-bottom:10px">Anyone with the Training Committee role (or an administrator) can evaluate. Add or remove people under <a href="#/people">People</a>. Untick someone to keep them out of auto-match (for example, away this semester) without changing their role.</p>
    ${tableHtml({ columns: cols, rows: evaluators, selected: new Set(), rowKey: e => e.id, selectable: false, empty: emptyState({ title: 'No evaluators yet', text: 'Give people the Training Committee role under People.', icon: 'team' }) })}`;
}

function paint(view) {
  $('#er-body', view).innerHTML = ui.tab === 'roster' ? rosterHtml() : ui.tab === 'match' ? matchHtml() : evaluatorsHtml();
  view.querySelectorAll('.pp-tabs .tab').forEach(t => { t.classList.toggle('is-active', t.dataset.tab === ui.tab); t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)); });
  if (ui.tab === 'roster') paintTable();
}

async function build() {
  await loadRoster();
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const busy = bookedSlots(state.guides);
  const guides = state.guides.map(g => ({ ...g, tourEligible: guideInfo.get(g.guideId)?.tour_eligible, memberId: guideInfo.get(g.guideId)?.member_id }));
  ui.plan = suggestMatches({ guides, evaluators: evaluators.filter(e => e.available), busy, today: todayISO(), now: hhmm });
}

let abort = null;

export default {
  id: 'evalroster', needs: 'admin', title: 'Evaluation Roster', crumb: 'Who needs evaluating, and who will do it', icon: '📝', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    Object.assign(ui, { tab: 'roster', q: '', band: '', status: '', need: '', picked: new Set(), plan: null, sort: { key: 'rank', dir: 1 } });
    setupMissing = false;
    await load();
    view.innerHTML = `<div id="er-setup">${setupMissing ? setupNotice() : ''}</div>
      <div class="tabs pp-tabs" role="tablist"><button class="tab is-active" role="tab" data-tab="roster">Roster</button><button class="tab" role="tab" data-tab="match">Auto-match</button><button class="tab" role="tab" data-tab="evaluators">Evaluators</button></div><div id="er-body"></div>`;
    paint(view);
    bindTable(view, { onSort: k => { ui.sort = nextSort(ui.sort, k); paintTable(); }, onToggle: (id, on) => { on ? ui.picked.add(id) : ui.picked.delete(id); paintTable(); },
      onToggleAll: on => { shown().forEach(g => on ? ui.picked.add(g.guideId) : ui.picked.delete(g.guideId)); paintTable(); } });
    const reload = async msg => { await load(); paint(view); refreshActions({ force: true }); if (msg) toast(msg); };

    view.addEventListener('click', async e => {
      const tab = e.target.closest('.pp-tabs [data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; paint(view); return; }
      const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
      try {
        if (a === 'clear') { ui.picked.clear(); paintTable(); }
        else if (a === 'export') toast(`Exported ${downloadCsv('evaluation-roster', [['Tour Guide', 'Priority', 'Band', 'Needs evaluation', 'Status', 'Evaluator', 'Evaluation date', 'Last evaluated'],
          ...shown().map(g => [g.name, g.priority, band(g), g.skip ? 'No' : 'Yes', statusLabel[g.status], g.evaluator || '', g.date || '', (last.get(g.guideId) || '').slice(0, 10)])])} rows.`);
        else if (a === 'addall') {
          if (!await confirmDialog({ title: `Add ${notOnRoster.length} guides to the roster?`, confirmLabel: 'Add all', lines: [`They join ${termLabel()}’s evaluation roster at first priority; change any of them afterwards.`] })) return;
          const r = await admin('admin_add_to_eval_roster', { p_guide_ids: notOnRoster.map(g => g.id), p_priority: null }); await reload(`Added ${r.added}.`);
        } else if (a === 'need-yes' || a === 'need-no') { const ids = [...ui.picked]; await admin('admin_set_eval_need', { p_guide_ids: ids, p_needs: a === 'need-yes' }); ui.picked.clear(); await reload(`Updated ${ids.length}.`); }
        else if (a === 'build') { ui.plan = null; paint(view); await build(); paint(view); }
        else if (a === 'approve') {
          const picks = [...view.querySelectorAll('[data-am]:checked')].map(c => Number(c.dataset.am));
          if (!picks.length) return toast('Nothing is ticked.', 'err');
          const asg = picks.map(i => { const m = ui.plan.matches[i]; return { eval_id: m.evalId, evaluator_id: view.querySelector(`[data-am-eval="${i}"]`).value, date: m.date, time: m.start || null }; });
          if (!await confirmDialog({ title: `Assign ${asg.length} evaluation${asg.length === 1 ? '' : 's'}?`, confirmLabel: 'Assign', lines: ['Each evaluator is shown as having claimed that guide, for that tour.', 'Each one is re-checked as it is saved; any that fail are listed and the rest still go through.'] })) return;
          const r = await admin('admin_assign_evaluations', { p_assignments: asg });
          ui.plan = null; await load(); await build(); paint(view); refreshActions({ force: true });
          toast(`Assigned ${r.assigned}${r.failed.length ? `; ${r.failed.length} could not be saved` : ''}.`, r.failed.length ? 'err' : undefined);
          if (r.failed.length) $('#er-body', view).insertAdjacentHTML('afterbegin', `<div class="callout" style="margin-bottom:12px"><strong>Not assigned:</strong><br>${r.failed.map(f => `${esc(state.guides.find(g => g.id === f.eval_id)?.name || 'A guide')}: ${esc(f.reason)}`).join('<br>')}</div>`);
        }
      } catch (x) { fail(x); }
    }, { signal });

    view.addEventListener('change', async e => {
      const t = e.target;
      try {
        if (t.id === 'er-band') { ui.band = t.value; paintTable(); } else if (t.id === 'er-status') { ui.status = t.value; paintTable(); } else if (t.id === 'er-need') { ui.need = t.value; paintTable(); }
        else if (t.dataset.prio) { await admin('admin_set_eval_priority', { p_guide_ids: [t.dataset.prio], p_priority: t.value }); await reload(); }
        else if (t.dataset.need) { await admin('admin_set_eval_need', { p_guide_ids: [t.dataset.need], p_needs: t.checked }); await reload(); }
        else if (t.id === 'er-bulkprio' && t.value) { const ids = [...ui.picked]; await admin('admin_set_eval_priority', { p_guide_ids: ids, p_priority: t.value }); ui.picked.clear(); await reload(`Priority set for ${ids.length}.`); }
        else if (t.matches('[data-am-all]')) view.querySelectorAll('[data-am]').forEach(c => { c.checked = t.checked; });
        else if (t.dataset.avail) { await admin('admin_set_evaluator_available', { p_member: t.dataset.avail, p_available: t.checked }); await reload(); }
      } catch (x) { fail(x); await reload(); }
    }, { signal });
    view.addEventListener('input', debounce(e => { if (e.target.id === 'er-q') { ui.q = e.target.value; paintTable(); } }, 120), { signal });
  }
};
