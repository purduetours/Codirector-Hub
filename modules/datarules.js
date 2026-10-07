/* ================================================================ Data Rules
   The few rules that decide how outside data and the Hub's own data combine,
   all editable in plain words:

     Field ownership   which source is trusted for which field. If the Tour Guides
                       by Major sheet owns "Major", a sync keeps majors current;
                       if the Hub owns it, the sheet can only raise a conflict for
                       you to decide. Evaluation priority is always the Hub's.
     Major names       CS / Comp Sci / Computer Science -> one name. Nothing is
                       guessed: only what you list is renamed.
     Remembered        every "this spelling is that person" answer you have given,
     matches           so a wrong one can be undone. Nothing is asked twice.
============================================================================ */
import { select } from '../core/db.js';
import { $, esc, toast, injectStyle } from '../core/ui.js';
import { confirmDialog } from '../core/dialog.js';
import { admin, emptyState, setupNotice, setupMissing, fail } from './admin-kit.js';
import { tableHtml, bindTable, sortRows, nextSort } from './datatable.js';

injectStyle('datarules-css', `.dr-own { display:grid; gap:10px; max-width:640px; } .dr-own > div { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev); }
.dr-own em { display:block; font-style:normal; font-size:var(--fs-xs); color:var(--text-faint); } .dr-add { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; } .dr-add input { flex:1 1 180px; width:auto; }`);

const FIELD_INFO = {
  major: ['Major', 'Which source is trusted for each guide’s major.', ['majors', 'roster', 'hub']],
  email: ['Email', 'Which source is trusted for each guide’s email address.', ['hub', 'roster', 'majors']],
  eval_priority: ['Evaluation priority', 'Always set by hand in the Hub.', ['hub']],
  tour_assignment: ['Tour assignments', 'Who gives which tour.', ['tour_schedule', 'hub']]
};
const OWNER = { hub: 'Codirector Hub (set by hand)', majors: 'Tour Guides by Major', roster: 'Master roster sheet', tour_schedule: 'Tour Schedule' };

let owners = {}, majors = [], maps = [], guides = new Map(), seenMajors = [], tab = 'own';
const ui = { sort: { key: 'name', dir: 1 }, picked: new Set() };

async function load() {
  const [o, m, a, g] = await Promise.all([
    select('field_ownership', 'select=field,owner'), select('major_mappings', 'select=raw,canonical&order=raw.asc'),
    select('external_identity_mappings', 'select=id,source_kind,external_key,external_name,guide_id,ignored,confirmed_at&order=confirmed_at.desc.nullslast&limit=500'),
    select('guides', 'select=id,full_name,major')
  ]);
  owners = Object.fromEntries(o.map(x => [x.field, x.owner])); majors = m; maps = a; guides = new Map(g.map(x => [x.id, x]));
  // every major value currently on file that is not already a mapping target
  const known = new Set(m.map(x => x.raw)), canon = new Set(m.map(x => x.canonical.toLowerCase()));
  const count = new Map();
  g.forEach(x => String(x.major || '').split(';').map(s => s.trim()).filter(Boolean).forEach(v => count.set(v, (count.get(v) || 0) + 1)));
  seenMajors = [...count].filter(([v]) => !known.has(v.toLowerCase()) && !canon.has(v.toLowerCase())).sort((a, b) => a[0].localeCompare(b[0]));
}

function body() {
  if (tab === 'own') return `<p class="muted" style="font-size:.88rem;margin-bottom:12px">A source “owns” a field when you trust it to keep that field current. Anything you edit by hand in the Hub is recorded as a visible override that no sync will undo.</p>
    <div class="dr-own">${Object.entries(FIELD_INFO).map(([f, [label, hint, opts]]) => `<div><span><b>${esc(label)}</b><em>${esc(hint)}</em></span>
      <select class="select" data-owner="${f}" aria-label="Who owns ${esc(label)}" ${opts.length === 1 ? 'disabled' : ''}>${opts.map(o => `<option value="${o}"${owners[f] === o ? ' selected' : ''}>${esc(OWNER[o])}</option>`).join('')}</select></div>`).join('')}</div>`;
  if (tab === 'majors') return `<p class="muted" style="font-size:.88rem;margin-bottom:12px">Map the many ways a major is written onto one name. Only what you list is renamed; everything else is kept exactly as written.</p>
    <form class="dr-add" id="dr-form"><input name="raw" placeholder="As written, e.g. CS" required><input name="canonical" placeholder="Becomes, e.g. Computer Science" required><button class="btn btn-primary btn-sm" type="submit">Add</button>
      <button class="btn btn-ghost btn-sm" type="button" id="dr-apply" title="Re-apply the names to everyone already on file">Apply to everyone now</button></form>
    ${seenMajors.length ? `<div class="callout" style="margin-bottom:12px"><strong>Majors currently on file</strong> that you have not mapped (tap to start a mapping): ${seenMajors.slice(0, 24).map(([v, n]) => `<button type="button" class="chip" data-seen="${esc(v)}">${esc(v)} · ${n}</button>`).join(' ')}</div>` : ''}
    ${majors.length ? `<div class="dt-wrap"><table class="dt"><thead><tr><th>As written</th><th>Becomes</th><th></th></tr></thead><tbody>${majors.map(m => `<tr><td>${esc(m.raw)}</td><td>${esc(m.canonical)}</td><td><button class="btn btn-quiet btn-sm" data-delmajor="${esc(m.raw)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
      : emptyState({ title: 'No major names mapped yet', icon: 'search', text: 'When a sheet says “ECE” or “Comp Sci”, add a line here so it becomes one consistent name.' })}`;
  const cols = [{ key: 'name', label: 'Spelling', sortable: true, value: m => m.external_name || m.external_key, render: m => `<b>${esc(m.external_name || m.external_key.replace(/^(name|email|id):/, ''))}</b>${m.ignored ? '<span class="chip is-mute">ignored</span>' : ''}` },
    { key: 'src', label: 'Seen on', sortable: true, render: m => esc(m.source_kind.replace('_', ' ')) },
    { key: 'who', label: 'Is', sortable: true, value: m => guides.get(m.guide_id)?.full_name || '', render: m => m.ignored ? 'Not one of our guides' : esc(guides.get(m.guide_id)?.full_name || '—') },
    { key: 'x', label: '', render: m => `<button class="btn btn-quiet btn-sm" data-forget="${m.id}">Forget</button>` }];
  return `<p class="muted" style="font-size:.88rem;margin-bottom:12px">Every “this is that person” answer you have given. Forget one to be asked again next sync.</p>
    ${tableHtml({ columns: cols, rows: sortRows(maps, cols, ui.sort), sort: ui.sort, selected: ui.picked, rowKey: m => String(m.id), selectable: false, empty: emptyState({ title: 'No remembered matches yet', icon: 'directory', text: 'They appear here when you confirm who a name in a spreadsheet is.' }) })}`;
}

function paint(view) {
  $('#dr-body', view).innerHTML = body();
  view.querySelectorAll('.pp-tabs .tab').forEach(t => { t.classList.toggle('is-active', t.dataset.tab === tab); t.setAttribute('aria-selected', String(t.dataset.tab === tab)); });
}

let abort = null;
export default {
  id: 'datarules', needs: 'admin', title: 'Data Rules', crumb: 'Who owns each field, major names, remembered matches', icon: '📐', section: 'Tools', quiet: true,
  unmount() { abort?.abort(); },
  async mount(view) {
    abort?.abort(); abort = new AbortController(); const signal = abort.signal; tab = 'own';
    try { await load(); } catch (e) { view.innerHTML = setupMissing(e) ? setupNotice() : `<p class="form-error">${esc(e.message)}</p>`; return; }
    view.innerHTML = `<div class="tabs pp-tabs" role="tablist"><button class="tab is-active" role="tab" data-tab="own">Field ownership</button><button class="tab" role="tab" data-tab="majors">Major names</button><button class="tab" role="tab" data-tab="maps">Remembered matches</button></div><div id="dr-body"></div>`;
    paint(view);
    bindTable(view, { onSort: k => { ui.sort = nextSort(ui.sort, k); paint(view); } });
    const reload = async msg => { await load(); paint(view); if (msg) toast(msg); };
    view.addEventListener('click', async e => {
      try {
        const t = e.target.closest('.pp-tabs [data-tab]'); if (t) { tab = t.dataset.tab; return paint(view); }
        const seen = e.target.closest('[data-seen]'); if (seen) { const f = $('#dr-form', view); f.raw.value = seen.dataset.seen; f.canonical.focus(); return; }
        const del = e.target.closest('[data-delmajor]'); if (del) { await admin('admin_delete_major_mapping', { p_raw: del.dataset.delmajor }); return reload('Removed.'); }
        if (e.target.closest('#dr-apply')) { const r = await admin('admin_renormalize_majors'); return reload(`Updated ${r.updated} guide${r.updated === 1 ? '' : 's'}.`); }
        const f = e.target.closest('[data-forget]'); if (f) {
          if (!await confirmDialog({ title: 'Forget this match?', confirmLabel: 'Forget', lines: ['The Hub will ask who this is again the next time it sees it.', 'Nothing about the person themselves changes.'] })) return;
          await admin('admin_forget_match', { p_id: Number(f.dataset.forget) }); await reload('Forgotten.');
        }
      } catch (x) { fail(x); }
    }, { signal });
    view.addEventListener('change', async e => { if (e.target.dataset.owner) { try { await admin('admin_set_field_owner', { p_field: e.target.dataset.owner, p_owner: e.target.value }); toast('Saved.'); } catch (x) { fail(x); await reload(); } } }, { signal });
    view.addEventListener('submit', async e => { if (e.target.id !== 'dr-form') return; e.preventDefault();
      try { await admin('admin_save_major_mapping', { p_raw: e.target.raw.value, p_canonical: e.target.canonical.value }); await reload('Saved. Use “Apply to everyone now” to update existing records.'); } catch (x) { fail(x); } }, { signal });
  }
};
