/* ============================================================ Tour Schedule
   A day-by-day view of the semester schedule. Reads the same `Schedule` tab the
   eval tracker uses, via a `schedule` action that returns it whole.
============================================================================ */
import { api } from '../core/api.js';
import { $, $$, esc, prettyDate, prettyTime, todayISO, debounce, injectStyle, SEARCH_ICON } from '../core/ui.js';

let rows = null;                       // cached for the session
const local = { search: '', from: '', days: 14 };

injectStyle('sch-css', `
.sch-day { margin-bottom: 18px; }
.sch-date { font-size:.82rem; font-weight:700; color:var(--text-soft); margin-bottom:7px;
  position:sticky; top:0; background:var(--bg); padding:4px 0; z-index:1; }
.sch-date .rel { font-weight:500; color:var(--text-faint); margin-left:7px; }
.sch-slot { display:flex; gap:12px; align-items:flex-start; padding:10px 13px;
  border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev);
  margin-bottom:6px; }
.sch-time { font-size:.8rem; font-weight:650; color:var(--accent); flex:none; width:96px;
  font-variant-numeric:tabular-nums; }
.sch-guides { display:flex; flex-wrap:wrap; gap:6px; flex:1; }
.sch-guide { font-size:.8rem; background:var(--bg-sunken); border-radius:999px; padding:3px 10px; }
.sch-guide.hit { background:var(--accent); color:#fff; font-weight:600; }
.sch-count { font-size:.74rem; color:var(--text-faint); flex:none; }
`);

function group(list) {
  const byDate = new Map();
  list.forEach(r => {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    const slots = byDate.get(r.date);
    const key = r.slot || r.start;
    if (!slots.has(key)) slots.set(key, { start: r.start, slot: r.slot, guides: [] });
    slots.get(key).guides.push(r.guide);
  });
  return byDate;
}

function relLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'today';
  const d = (Date.parse(iso) - Date.parse(today)) / 86400000;
  if (d === 1) return 'tomorrow';
  if (d > 1 && d < 7) return `in ${d} days`;
  return '';
}

function paint() {
  const q = local.search.trim().toLowerCase();
  const from = local.from || todayISO();
  let list = rows.filter(r => r.date >= from);

  const dates = [...new Set(list.map(r => r.date))].sort().slice(0, local.days);
  const cutoff = dates.at(-1);
  list = list.filter(r => r.date <= cutoff);

  const byDate = group(list);
  const html = [...byDate.entries()].sort().map(([date, slots]) => {
    const slotHtml = [...slots.values()]
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
      .map(s => {
        const guides = s.guides.slice().sort();
        const anyHit = q && guides.some(g => g.toLowerCase().includes(q));
        if (q && !anyHit) return '';
        return `<div class="sch-slot">
          <span class="sch-time">${esc(s.slot || prettyTime(s.start))}</span>
          <span class="sch-guides">${guides.map(g =>
            `<span class="sch-guide ${q && g.toLowerCase().includes(q) ? 'hit' : ''}">${esc(g)}</span>`).join('')}</span>
          <span class="sch-count">${guides.length}</span>
        </div>`;
      }).join('');
    if (!slotHtml.trim()) return '';
    const rel = relLabel(date);
    return `<div class="sch-day">
      <div class="sch-date">${esc(prettyDate(date, { weekday: 'long', month: 'long', day: 'numeric' }))}
        ${rel ? `<span class="rel">${esc(rel)}</span>` : ''}</div>
      ${slotHtml}</div>`;
  }).join('');

  $('#sch-body').innerHTML = html.trim()
    ? html
    : '<div class="empty"><div class="empty-mark">📅</div><p>No tours match.</p></div>';
}

export default {
  id: 'schedule',
  title: 'Tour Schedule',
  crumb: 'Who is leading which tour, and when',
  icon: '📅',
  section: 'Tools',

  async mount(view) {
    view.innerHTML = `
      <div class="filters" style="margin-bottom:16px">
        <label class="search">${SEARCH_ICON}<input type="search" id="sch-search" placeholder="Find a guide on the schedule…" autocomplete="off"></label>
        <input type="date" id="sch-from" class="select" aria-label="Start date">
        <select id="sch-days" class="select">
          <option value="7">Next 7 days</option>
          <option value="14" selected>Next 14 days</option>
          <option value="30">Next 30 days</option>
          <option value="999">Whole semester</option>
        </select>
      </div>
      <div id="sch-body"></div>`;

    if (!rows) {
      const data = await api('tourSchedule');
      rows = data.rows || [];
    }

    if (!rows.length) {
      $('#sch-body').innerHTML =
        `<div class="empty"><div class="empty-mark">📅</div>
         <p>No schedule data. Import <code>data/Schedule.csv</code> as a <code>Schedule</code> tab in the sheet.</p></div>`;
      return;
    }

    $('#sch-from').value = local.from || todayISO();
    $('#sch-days').value = String(local.days);
    paint();

    $('#sch-search').addEventListener('input', debounce(e => { local.search = e.target.value; paint(); }));
    $('#sch-from').addEventListener('change', e => { local.from = e.target.value; paint(); });
    $('#sch-days').addEventListener('change', e => { local.days = +e.target.value; paint(); });
  }
};
