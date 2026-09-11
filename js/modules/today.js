/* ============================================================ Today
   What actually needs you, on arrival.

   The hub has always been six tabs of everything, so knowing whether anything
   needed doing meant opening all of them and reading carefully. This is the
   opposite: only the things that are waiting, only the ones you can act on, and
   an honest "nothing" when there is nothing.
============================================================================ */
import { state, myName, isAdmin, inTraining, inRecruitment } from '../core/state.js';
import { loadDesks } from '../core/sheets.js';
import { $, esc, injectStyle } from '../core/ui.js';
import { go } from '../core/router.js';
import { loadRoster } from './evals.js';
import interviews, { interviewData } from './interviews.js';

injectStyle('today-css', `
.td-hi { font-size:1.4rem; font-weight:650; letter-spacing:-.02em; margin-bottom:4px; }
.td-sub { color:var(--text-faint); font-size:.85rem; margin-bottom:20px; }
.td-row { display:flex; align-items:center; gap:14px; padding:13px 16px;
  border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev);
  margin-bottom:9px; cursor:pointer; text-align:left; width:100%; font:inherit; color:var(--text);
  transition:border-color .13s, background .13s; }
.td-row:hover { border-color:var(--accent); background:var(--accent-soft); }
.td-n { font-size:1.35rem; font-weight:700; min-width:44px; text-align:center; flex:none;
  font-variant-numeric:tabular-nums; }
.td-what { flex:1; min-width:0; }
.td-what b { display:block; font-size:.9rem; font-weight:600; }
.td-what em { display:block; font-style:normal; font-size:.78rem; color:var(--text-faint); margin-top:2px; }
.td-go { color:var(--text-faint); flex:none; }
.td-clear { text-align:center; padding:48px 20px; color:var(--text-soft); }
.td-clear .mark { font-size:34px; display:block; margin-bottom:10px; }
`);

/** Everything that might want attention, with how to act on it. */
function gather() {
  const items = [];
  const guides = state.guides || [];
  const me = state.me?.id;

  if (inTraining() && guides.length) {
    const mine = guides.filter(g => g.evaluatorId === me && g.status === 'claimed');
    const undated = mine.filter(g => !g.date);
    if (undated.length) items.push({ n: undated.length, tone: 'warn',
      what: `Your eval${undated.length === 1 ? ' has' : 's have'} no tour date`,
      why: undated.slice(0, 3).map(g => g.name).join(', ') + (undated.length > 3 ? '…' : ''),
      go: 'evals' });

    const todo = mine.filter(g => g.date);
    if (todo.length) items.push({ n: todo.length,
      what: `Eval${todo.length === 1 ? '' : 's'} you have claimed and not submitted`,
      why: todo.slice(0, 3).map(g => g.name).join(', ') + (todo.length > 3 ? '…' : ''),
      go: 'evals' });

    const urgent = guides.filter(g => g.status === 'open' && g.rank <= 2);
    if (urgent.length) items.push({ n: urgent.length,
      what: 'Unclaimed guides at first or second priority',
      why: 'Nobody has picked these up yet',
      go: 'evals' });

    if (isAdmin()) {
      const unreviewed = guides.filter(g => g.status === 'submitted');
      if (unreviewed.length) items.push({ n: unreviewed.length,
        what: 'Submitted evals waiting to be reviewed',
        why: 'Only codirectors see these',
        go: 'evals' });
    }
  }

  const iv = interviewData();
  if (inRecruitment() && iv?.candidates?.length) {
    const cands = iv.candidates;
    const inRoom = cands.filter(c => c.checkin === 'Yes');
    const notByMe = inRoom.filter(c => !c.scores?.[myName()]);
    if (notByMe.length) items.push({ n: notByMe.length, tone: 'warn',
      what: 'Checked-in candidates you have not scored',
      why: 'They are here and waiting on you',
      go: 'interviews' });

    const nobody = cands.filter(c => c.raters === 0);
    if (nobody.length) items.push({ n: nobody.length,
      what: 'Candidates nobody has scored',
      why: 'No ratings at all yet',
      go: 'interviews' });

    const split = cands.filter(c => (c.spread ?? 0) >= 1.5);
    if (split.length) items.push({ n: split.length,
      what: 'Candidates worth discussing',
      why: 'The panel disagreed by more than a point and a half',
      go: 'interviews' });

    const undecided = cands.filter(c => c.raters > 0 && !c.decision);
    if (undecided.length) items.push({ n: undecided.length,
      what: 'Scored candidates with no decision',
      why: 'Yes, maybe or no still to record',
      go: 'interviews' });
  }
  return items;
}

async function deskGaps() {
  try {
    const rows = await loadDesks();
    if (!rows.length) return null;
    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    const slots = [...new Set(rows.map(r => `${r.desk}|${r.slot}`))];
    let gaps = 0;
    slots.forEach(k => {
      const [desk, slot] = k.split('|');
      DAYS.forEach(d => { if (!rows.some(r => r.desk === desk && r.slot === slot && r.day === d)) gaps++; });
    });
    return gaps;
  } catch { return null; }
}

export default {
  id: 'today',
  title: 'Today',
  crumb: 'What needs you',
  icon: '👋',
  section: 'Hub',

  async mount(view) {
    view.innerHTML = `<div class="td-hi">Hi ${esc(myName().split(' ')[0] || 'there')}</div>
      <div class="td-sub">Checking what needs you…</div><div id="td-list"></div>`;

    await Promise.allSettled([
      inTraining() && !state.guides.length ? loadRoster() : null,
      inRecruitment() ? interviews.prefetch?.() : null
    ]);

    const items = gather();
    const gaps = await deskGaps();
    if (gaps) items.push({ n: gaps, what: 'Uncovered desk slots this week',
                           why: 'Nobody is down for these', go: 'desks' });

    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('.td-hi').textContent = `${greet}, ${myName().split(' ')[0] || 'there'}`;
    $('.td-sub').textContent = items.length
      ? `${items.length} thing${items.length === 1 ? '' : 's'} worth a look.`
      : '';

    $('#td-list').innerHTML = items.length
      ? items.map(i => `
          <button class="td-row" data-go="${esc(i.go)}">
            <span class="td-n" style="color:var(--${i.tone === 'warn' ? 'warn' : 'accent'})">${i.n}</span>
            <span class="td-what"><b>${esc(i.what)}</b><em>${esc(i.why)}</em></span>
            <span class="td-go">→</span>
          </button>`).join('')
      : `<div class="td-clear"><span class="mark">✅</span>
         <p>Nothing needs you right now.</p></div>`;

    $('#td-list').addEventListener('click', e => {
      const row = e.target.closest('[data-go]');
      if (row) go(row.dataset.go);
    });
  }
};
