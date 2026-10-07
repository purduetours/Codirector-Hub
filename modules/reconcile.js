/* ============================================================== Reconciliation
   Where the Hub's sources disagree with each other or with the master list, in
   one place, grouped by what kind of problem it is, each with the choices that
   fix it. No SQL, and no decision is ever taken for you.

     People not matched      a name or email in a sheet that is not on the master
                             list. Choose who it is (remembered forever), create
                             a new Tour Guide from it, or ignore it.
     Schedule not matched    the same, for names on the tour schedule.
     On our list, not theirs a Tour Guide the Hub has but the Tour Guides by Major
                             sheet does not list. Keep active, make inactive for
                             this semester (never deleted), or review.
     Conflicting major/email the sheet and the Hub disagree. Use the spreadsheet's
                             value, or keep the Hub's (recorded as a visible
                             override you can undo).
     Possible duplicates     two active guides that look like one person.

   Once resolved, an item is not raised again — a remembered match for a person,
   a decision for the semester for the rest.
============================================================================ */
import { select } from '../core/db.js';
import { esc, toast, injectStyle, $ } from '../core/ui.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, setupMissing, fail, hashParams } from './admin-kit.js';
import { nameParts, firstFits } from '../core/people-match.js';
import { refreshActions } from '../core/actioncenter.js';
import { KINDS } from '../core/sources.js';

injectStyle('reconcile-css', `
.rc-group { margin-bottom:26px; } .rc-group h3 { font-size:var(--fs-md); display:flex; gap:10px; align-items:baseline; margin-bottom:4px; } .rc-group h3 span { color:var(--text-faint); font-weight:500; font-size:var(--fs-sm); }
.rc-group > p { color:var(--text-soft); font-size:var(--fs-sm); margin:0 0 10px; max-width:70ch; }
.rc-row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; padding:12px 14px; margin-bottom:8px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev); }
.rc-who { flex:1 1 220px; min-width:0; } .rc-who b { display:block; } .rc-who em { font-style:normal; font-size:var(--fs-xs); color:var(--text-faint); display:block; }
.rc-act { display:flex; gap:8px; flex-wrap:wrap; align-items:center; } .rc-act .select { width:auto; min-width:200px; }
.rc-vs { display:flex; gap:14px; flex-wrap:wrap; font-size:var(--fs-sm); } .rc-vs span b { color:var(--text-faint); font-weight:600; margin-right:4px; }
`);

const GROUPS = [
  { kinds: ['unmatched_person'], title: 'People not matched', text: 'These names appear in a spreadsheet but are not on your Tour Guide list. Say who each one is — the Hub remembers — or add them.' },
  { kinds: ['schedule_unmatched'], title: 'Schedule names not matched', text: 'These people are on the tour schedule but the Hub cannot tell which Tour Guide they are.' },
  { kinds: ['roster_missing_in_source'], title: 'On your list but not in the sheet', text: 'These Tour Guides are active here but missing from the Tour Guides by Major sheet. They may have left, or the sheet may be behind. Nothing happens until you choose.' },
  { kinds: ['conflicting_major', 'conflicting_email'], title: 'Conflicting information', text: 'The spreadsheet and the Hub disagree. Choose which one is right for this person.' }
];

let issues = [], guides = [];
let filter = { kind: '' };

const candidatesOf = i => (i.suggested || []).map(c => c.id);

function row(i) {
  const src = KINDS[i.source_kind]?.label || '';
  if (i.kind === 'unmatched_person' || i.kind === 'schedule_unmatched') {
    const cands = i.suggested || [];
    const opts = `<option value="">Choose a Tour Guide…</option>${cands.map(c => `<option value="${esc(c.id)}">★ ${esc(c.name)} — ${esc(c.why || 'possible match')}</option>`).join('')}
      ${guides.filter(g => g.active && !cands.some(c => c.id === g.id)).map(g => `<option value="${esc(g.id)}">${esc(g.full_name)}</option>`).join('')}`;
    return `<div class="rc-row" data-i="${i.id}"><div class="rc-who"><b>${esc(i.external_name)}</b><em>${esc(src)}${i.detail?.email ? ` · ${esc(i.detail.email)}` : ''}${i.detail?.major ? ` · ${esc(i.detail.major)}` : ''}</em></div>
      <div class="rc-act"><select class="select" data-pick aria-label="Who is ${esc(i.external_name)}?">${opts}</select><button class="btn btn-primary btn-sm" data-do="confirm_match">Confirm match</button>
      <button class="btn btn-ghost btn-sm" data-do="create_guide">Create new person</button><button class="btn btn-quiet btn-sm" data-do="ignore">Ignore</button></div></div>`;
  }
  if (i.kind === 'roster_missing_in_source') {
    return `<div class="rc-row" data-i="${i.id}"><div class="rc-who"><b>${esc(i.external_name)}</b><em>Not found in ${esc(i.detail?.source || src)}</em></div>
      <div class="rc-act"><button class="btn btn-ghost btn-sm" data-do="keep_active">Keep active</button><button class="btn btn-ghost btn-sm" data-do="mark_inactive">Make inactive this semester</button><a class="btn btn-quiet btn-sm" href="#/guides">Review</a></div></div>`;
  }
  const field = i.kind === 'conflicting_major' ? 'Major' : 'Email';
  return `<div class="rc-row" data-i="${i.id}"><div class="rc-who"><b>${esc(guides.find(g => g.id === i.guide_id)?.full_name || i.external_name)}</b><em>${field} · ${esc(src)}</em></div>
    <div class="rc-vs"><span><b>Hub</b>${esc(i.detail?.hub || '—')}</span><span><b>Spreadsheet</b>${esc(i.detail?.source || '—')}</span></div>
    <div class="rc-act"><button class="btn btn-ghost btn-sm" data-do="use_codirector">Keep the Hub’s value</button><button class="btn btn-primary btn-sm" data-do="use_source">Use the spreadsheet’s</button></div></div>`;
}

function duplicates() {
  const act = guides.filter(g => g.active), out = [];
  for (let a = 0; a < act.length && out.length < 10; a++) for (let b = a + 1; b < act.length; b++) {
    const x = nameParts(act[a].full_name), y = nameParts(act[b].full_name);
    if (x.last && x.last === y.last && x.firsts.some(p => y.firsts.some(q => firstFits(p, q)))) out.push([act[a], act[b]]);
  }
  return out;
}

function paint(view) {
  const list = issues.filter(i => !filter.kind || i.source_kind === filter.kind);
  const dups = duplicates();
  const html = GROUPS.map(g => {
    const rows = list.filter(i => g.kinds.includes(i.kind));
    if (!rows.length) return '';
    const strong = g.kinds[0].endsWith('unmatched') || g.kinds[0] === 'unmatched_person' ? rows.filter(i => (i.suggested || [])[0]?.score >= .8) : [];
    return `<section class="rc-group"><h3>${esc(g.title)} <span>${rows.length}</span></h3><p>${esc(g.text)}</p>
      ${strong.length ? `<div style="margin-bottom:8px"><button class="btn btn-ghost btn-sm" data-bulk="${g.kinds[0]}">Confirm the ${strong.length} strong suggestion${strong.length === 1 ? '' : 's'} (★ top picks)</button></div>` : ''}
      ${rows.map(row).join('')}</section>`;
  }).join('') + (dups.length ? `<section class="rc-group"><h3>Possible duplicate people <span>${dups.length}</span></h3><p>These active Tour Guides look like they could be one person. Nothing is merged automatically: open the list and archive the extra one if they really are the same.</p>
      ${dups.map(([a, b]) => `<div class="rc-row"><div class="rc-who"><b>${esc(a.full_name)} · ${esc(b.full_name)}</b><em>Same surname and similar first name</em></div><a class="btn btn-ghost btn-sm" href="#/guides">Open Tour Guides</a></div>`).join('')}</section>` : '');
  $('#rc-body', view).innerHTML = html || emptyState({ title: 'Everything lines up', icon: 'check', text: 'No spreadsheet people are waiting to be matched and nothing conflicts. New items appear here after a sync.' });
  $('#rc-filter', view).value = filter.kind;
}

async function load() {
  [issues, guides] = await Promise.all([
    select('sync_issues', 'select=id,kind,source_kind,external_key,external_name,guide_id,detail,suggested,term_id&status=eq.open&order=created_at.desc&limit=500'),
    select('guides', 'select=id,full_name,active&order=last_name.asc')
  ]);
}

let abort = null;

export default {
  id: 'reconcile', needs: 'admin', title: 'Reconciliation', crumb: 'Where the sources disagree', icon: '🔀', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); },

  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    filter = { kind: hashParams().kind || '' };
    try { await load(); } catch (e) { view.innerHTML = setupMissing(e) ? setupNotice() : `<p class="form-error">${esc(e.message)}</p>`; return; }
    view.innerHTML = `<div class="gd-bar"><select id="rc-filter" class="select" aria-label="Filter by source"><option value="">All sources</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <a class="btn btn-ghost btn-sm" href="#/sources">Data Sources</a><a class="btn btn-ghost btn-sm" href="#/datarules">Data Rules</a></div><div id="rc-body"></div>`;
    paint(view);

    const resolve = async (id, action, extra = {}) => {
      const r = await admin('admin_resolve_issue', { p_issue: Number(id), p_action: action, p_guide: extra.guide || null, p_first: extra.first || null, p_last: extra.last || null });
      await load(); paint(view); refreshActions({ force: true });
      return r;
    };
    view.addEventListener('change', e => { if (e.target.id === 'rc-filter') { filter.kind = e.target.value; paint(view); } }, { signal });
    view.addEventListener('click', async e => {
      try {
        const b = e.target.closest('[data-bulk]');
        if (b) {
          const kinds = GROUPS.find(g => g.kinds[0] === b.dataset.bulk).kinds;
          const rows = issues.filter(i => kinds.includes(i.kind) && (i.suggested || [])[0]?.score >= .8 && (!filter.kind || i.source_kind === filter.kind));
          if (!await confirmDialog({ title: `Confirm ${rows.length} suggested match${rows.length === 1 ? '' : 'es'}?`, confirmLabel: 'Confirm all', lines: [rows.slice(0, 6).map(i => `${i.external_name} → ${i.suggested[0].name}`).join('; ') + (rows.length > 6 ? '…' : ''), 'Each is remembered, so you will not be asked again.'] })) return;
          for (const i of rows) await resolve(i.id, 'confirm_match', { guide: i.suggested[0].id });
          return toast(`Matched ${rows.length}.`);
        }
        const d = e.target.closest('[data-do]'), rowEl = e.target.closest('.rc-row');
        if (!d || !rowEl) return;
        const id = rowEl.dataset.i, action = d.dataset.do, issue = issues.find(i => i.id == id);
        if (action === 'confirm_match') {
          const g = rowEl.querySelector('[data-pick]').value; if (!g) return toast('Choose a Tour Guide first.', 'err');
          await resolve(id, 'confirm_match', { guide: g }); toast(`${issue.external_name} matched — remembered.`);
        } else if (action === 'create_guide') {
          const parts = (issue.external_name || '').trim().split(/\s+/);
          const v = await formDialog({ title: `Create a Tour Guide from “${issue.external_name}”`, intro: 'They join the master list (and this semester’s evaluation roster).', submitLabel: 'Create',
            fields: [{ name: 'first', label: 'First name', value: parts.slice(0, -1).join(' ') || parts[0], required: true }, { name: 'last', label: 'Last name', value: parts.length > 1 ? parts[parts.length - 1] : '', required: true }] });
          if (!v) return;
          await resolve(id, 'create_guide', { first: v.first, last: v.last }); toast(`${v.first} ${v.last} added.`);
        } else if (action === 'ignore') {
          if (!await confirmDialog({ title: `Ignore “${issue.external_name}”?`, confirmLabel: 'Ignore', lines: ['They are not one of your Tour Guides. The Hub will not ask about this spelling again.'] })) return;
          await resolve(id, 'ignore'); toast('Ignored.');
        } else if (action === 'mark_inactive') {
          if (!await confirmDialog({ title: `Make ${issue.external_name} inactive this semester?`, confirmLabel: 'Make inactive', lines: ['They leave this semester’s tracker. They stay on the master list and all history is kept.', 'Reverse it any time from Tour Guides.'] })) return;
          await resolve(id, action); toast('Marked inactive for this semester.');
        } else { await resolve(id, action); toast('Done.'); }
      } catch (x) { fail(x); }
    }, { signal });
  }
};
