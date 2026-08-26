/* ============================================================ Guide Directory
   Every guide the hub knows about, with a profile pulling together their eval
   status and tour load. Built entirely from the roster payload already loaded
   for the evals module — no extra network call.
============================================================================ */
import { state } from '../core/state.js';
import { refreshSession } from '../core/auth.js';
import {
  $, $$, esc, prettyDate, prettyTime, debounce, injectStyle,
  openModal, closeModal, wireModal, SEARCH_ICON
} from '../core/ui.js';

const local = { search: '', priority: '', sort: 'priority' };

const STATUS_LABEL = { open: 'Not evaluated', claimed: 'Eval claimed', submitted: 'Evaluated', reviewed: 'Reviewed', skip: 'No eval needed' };
const TONE = { open: 'tone-open', claimed: 'tone-warn', submitted: 'tone-good', reviewed: 'tone-info', skip: 'tone-mute' };

injectStyle('dir-css', `
.dir-row { display:flex; align-items:center; gap:13px; padding:11px 15px;
  border-bottom:1px solid var(--line); cursor:pointer; background:none; border-left:0;
  border-right:0; border-top:0; width:100%; text-align:left; font:inherit; color:var(--text); }
.dir-row:last-child { border-bottom:0; }
.dir-row:hover { background:var(--bg-sunken); }
.dir-av { width:34px; height:34px; border-radius:50%; background:var(--accent-soft);
  color:var(--accent); display:grid; place-items:center; font-size:.75rem; font-weight:700; flex:none; }
.dir-main { flex:1; min-width:0; }
.dir-name { font-size:.9rem; font-weight:600; }
.dir-sub { font-size:.76rem; color:var(--text-faint); }
.dir-tours { font-size:.78rem; color:var(--text-soft); font-variant-numeric:tabular-nums; flex:none; }
.dir-list { max-height:none; }
.prof-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; }
.prof-stat { background:var(--bg-sunken); border-radius:var(--radius-sm); padding:11px 13px; }
.prof-stat .n { font-size:1.3rem; font-weight:700; line-height:1.2; }
.prof-stat .l { font-size:.72rem; color:var(--text-soft); }
.prof-tours { display:grid; gap:5px; max-height:220px; overflow-y:auto; }
.prof-tour { display:flex; justify-content:space-between; gap:10px; font-size:.83rem;
  padding:7px 10px; background:var(--bg-sunken); border-radius:var(--radius-sm); }
.prof-tour .s { color:var(--text-soft); font-variant-numeric:tabular-nums; }
`);

function sorted() {
  const q = local.search.trim().toLowerCase();
  let rows = state.guides.filter(g => {
    if (local.priority && g.priority !== local.priority) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });
  if (local.sort === 'name') rows = [...rows].sort((a, b) => a.last.localeCompare(b.last));
  else if (local.sort === 'tours') rows = [...rows].sort((a, b) => (b.tours?.length || 0) - (a.tours?.length || 0));
  return rows;
}

function row(g) {
  const n = g.tours?.length || 0;
  return `<button class="dir-row" data-id="${esc(g.id)}">
    <span class="dir-av">${esc((g.first[0] || '') + (g.last[0] || '')).toUpperCase()}</span>
    <span class="dir-main">
      <span class="dir-name">${esc(g.name)}</span>
      <span class="dir-sub">${esc(g.priority || '—')}</span>
    </span>
    <span class="dir-tours">${n} tour${n === 1 ? '' : 's'}</span>
    <span class="pill ${TONE[g.status]}">${esc(STATUS_LABEL[g.status] || g.status)}</span>
  </button>`;
}

function profile(g) {
  const tours = g.tours || [];
  const when = [prettyDate(g.date), prettyTime(g.time)].filter(Boolean).join(' · ');
  return `
    <div class="prof-grid">
      <div class="prof-stat"><div class="n">${tours.length}</div><div class="l">Upcoming tours</div></div>
      <div class="prof-stat"><div class="n" style="font-size:.95rem;padding-top:5px">${esc(STATUS_LABEL[g.status])}</div><div class="l">Eval status</div></div>
      ${g.evaluator ? `<div class="prof-stat"><div class="n" style="font-size:.95rem;padding-top:5px">${esc(g.evaluator)}</div><div class="l">Evaluator</div></div>` : ''}
    </div>
    ${when ? `<p class="muted">Eval tour scheduled for <strong>${esc(when)}</strong></p>` : ''}
    ${g.notes ? `<p class="muted">Notes: ${esc(g.notes)}</p>` : ''}
    <div class="field"><span>Upcoming tours</span>
      ${tours.length
        ? `<div class="prof-tours">${tours.map(t =>
            `<div class="prof-tour"><span>${esc(prettyDate(t.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span class="s">${esc(t.slot || prettyTime(t.start))}</span></div>`).join('')}</div>`
        : '<p class="hint">Nothing on the schedule for them.</p>'}
    </div>`;
}

export default {
  id: 'directory',
  adminOnly: true,
  title: 'Guide Directory',
  crumb: 'Everyone on the roster, and what we know about them',
  icon: '👥',
  section: 'Tools',

  async mount(view) {
    if (!state.guides.length) await refreshSession();

    view.innerHTML = `
      <div class="filters" style="margin-bottom:16px">
        <label class="search">${SEARCH_ICON}<input type="search" id="dir-search" placeholder="Search guides…" autocomplete="off"></label>
        <select id="dir-priority" class="select"><option value="">All priorities</option></select>
        <select id="dir-sort" class="select">
          <option value="priority">Sort: priority</option>
          <option value="name">Sort: last name</option>
          <option value="tours">Sort: most tours</option>
        </select>
      </div>
      <div class="panel"><div class="dir-list" id="dir-list"></div></div>
      <p class="hint" id="dir-count" style="margin-top:10px"></p>

      <div class="modal-root" id="dir-modal" hidden>
        <div class="modal-scrim" data-close></div>
        <div class="modal">
          <header class="modal-head">
            <div><h2 id="dir-p-name"></h2><p class="muted" id="dir-p-prio"></p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
          </header>
          <div class="modal-body" id="dir-p-body"></div>
          <footer class="modal-foot"><button class="btn btn-ghost" data-close>Close</button></footer>
        </div>
      </div>`;

    wireModal($('#dir-modal'));

    const sel = $('#dir-priority');
    sel.innerHTML = '<option value="">All priorities</option>' +
      [...new Set(state.guides.map(g => g.priority).filter(Boolean))]
        .map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

    const paint = () => {
      const rows = sorted();
      $('#dir-list').innerHTML = rows.length
        ? rows.map(row).join('')
        : '<div class="empty"><div class="empty-mark">🔍</div><p>No guides match.</p></div>';
      $('#dir-count').textContent = `${rows.length} of ${state.guides.length} guides`;
    };
    paint();

    $('#dir-search').addEventListener('input', debounce(e => { local.search = e.target.value; paint(); }));
    $('#dir-priority').addEventListener('change', e => { local.priority = e.target.value; paint(); });
    $('#dir-sort').addEventListener('change', e => { local.sort = e.target.value; paint(); });

    $('#dir-list').addEventListener('click', e => {
      const b = e.target.closest('.dir-row');
      if (!b) return;
      const g = state.guides.find(x => x.id === b.dataset.id);
      if (!g) return;
      $('#dir-p-name').textContent = g.name;
      $('#dir-p-prio').textContent = g.priority || '';
      $('#dir-p-body').innerHTML = profile(g);
      openModal($('#dir-modal'));
    });
  }
};
