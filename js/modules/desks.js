/* ============================================================ Desk Coverage
   Front Desk and Welcome Desk shifts. The source grid is a weekly template
   rather than dated, so this shows a recurring Mon–Fri week and flags any slot
   nobody is covering.
============================================================================ */
import { api } from '../core/api.js';
import { $, esc, prettyTime, injectStyle } from '../core/ui.js';

let rows = null;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const local = { desk: 'Front Desk' };

injectStyle('desk-css', `
.desk-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); }
.desk-tbl { border-collapse:collapse; width:100%; min-width:720px; font-size:.82rem; }
.desk-tbl th, .desk-tbl td { border-bottom:1px solid var(--line); padding:8px 11px; text-align:left; vertical-align:top; }
.desk-tbl th { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-faint); font-weight:700; background:var(--bg-sunken); position:sticky; top:0; }
.desk-tbl td:first-child, .desk-tbl th:first-child {
  font-variant-numeric:tabular-nums; color:var(--text-soft); font-weight:600; white-space:nowrap; }
.desk-person { display:block; }
.desk-gap { color:var(--warn); font-weight:600; }
.desk-tbl tr:hover td { background:var(--bg-sunken); }
`);

function paint() {
  const mine = rows.filter(r => r.desk === local.desk);
  const slots = [...new Set(mine.map(r => r.slot))]
    .sort((a, b) => {
      const A = mine.find(r => r.slot === a).start, B = mine.find(r => r.slot === b).start;
      return A.localeCompare(B);
    });

  let gaps = 0;
  const body = slots.map(slot => {
    const cells = DAYS.map(day => {
      const people = mine.filter(r => r.slot === slot && r.day === day).map(r => r.person);
      if (!people.length) { gaps++; return '<td><span class="desk-gap">⚠ uncovered</span></td>'; }
      return `<td>${people.map(p => `<span class="desk-person">${esc(p)}</span>`).join('')}</td>`;
    }).join('');
    return `<tr><td>${esc(slot)}</td>${cells}</tr>`;
  }).join('');

  $('#desk-body').innerHTML = `
    <div class="desk-wrap">
      <table class="desk-tbl">
        <thead><tr><th>Time</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  $('#desk-note').innerHTML = gaps
    ? `<strong style="color:var(--warn)">${gaps}</strong> uncovered slot${gaps === 1 ? '' : 's'} this week.`
    : 'Every slot is covered.';
}

/** Loads desk coverage once per session. Safe to call in the background. */
async function prime() {
  if (rows) return;
  const data = await api('desks');
  rows = data.rows || [];
}

export default {
  id: 'desks',
  prefetch: prime,
  bust: () => { rows = null; },
  adminOnly: true,
  title: 'Desk Coverage',
  crumb: 'Front and Welcome desk shifts',
  icon: '🛎️',
  section: 'Tools',

  async mount(view) {
    view.innerHTML = `
      <nav class="tabs" id="desk-tabs" style="margin-bottom:16px">
        <button class="tab is-active" data-desk="Front Desk">Front Desk</button>
        <button class="tab" data-desk="Welcome Desk">Welcome Desk</button>
      </nav>
      <div id="desk-body"></div>
      <p class="hint" id="desk-note" style="margin-top:12px"></p>
      <p class="hint" style="margin-top:6px">This is the recurring weekly template from the schedule workbook, not a dated calendar.</p>`;

    if (!rows) await prime();

    if (!rows.length) {
      $('#desk-body').innerHTML =
        `<div class="empty"><div class="empty-mark">🛎️</div>
         <p>No desk data. Import <code>data/Desks.csv</code> as a <code>Desks</code> tab in the sheet.</p></div>`;
      return;
    }

    paint();
    $('#desk-tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      local.desk = t.dataset.desk;
      [...$('#desk-tabs').children].forEach(x => x.classList.toggle('is-active', x === t));
      paint();
    });
  }
};
