/* ============================================================ Today
   What actually needs you, on arrival.

   The hub has always been six tabs of everything, so knowing whether anything
   needed doing meant opening all of them and reading carefully. This is the
   opposite: only the things that are waiting, only the ones you can act on, and
   an honest "nothing" when there is nothing.
============================================================================ */
import { state, myName, isAdmin, inTraining, inRecruitment } from '../core/state.js';
import { select } from '../core/db.js';
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
.td-changes-head { cursor:pointer; font-size:.8rem; font-weight:600; padding:8px 2px; }
.td-change { display:flex; gap:10px; font-size:.78rem; padding:5px 8px; border-top:1px solid var(--line); }
.td-change .w { font-weight:600; min-width:110px; flex:none; }
.td-change .t { flex:1; color:var(--text-soft); }
.td-change .a { color:var(--text-faint); flex:none; }
#td-changes { margin-top:22px; border:1px solid var(--line); border-radius:var(--radius);
  background:var(--bg-elev); padding:4px 12px 8px; }
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

/* ------------------------------------------------------------ what changed
   A glance at what has been altered lately, for whoever is responsible for the
   records being right.

   Built after two incidents where dozens of attendance rows were rewritten and
   nothing on any screen looked wrong — the only way to notice was to diff the
   database against the original spreadsheet. The database was already
   recording who and when on every edit; nothing surfaced it. This does.

   Deliberately read-only and deliberately short. It is a smoke alarm, not an
   audit system: if something here is a surprise, go and look properly.
-------------------------------------------------------------------------- */
async function recentChanges() {
  const out = [];
  const name = new Map();

  try {
    const rows = await select('training_attendance',
      'select=person_name,actual,updated_at,updated_by&updated_by=not.is.null&order=updated_at.desc&limit=25');
    const ids = [...new Set((rows || []).map(r => r.updated_by))];
    if (ids.length) {
      const who = await select('members', `select=id,full_name&id=in.(${ids.join(',')})`);
      (who || []).forEach(m => name.set(m.id, m.full_name));
    }
    (rows || []).forEach(r => out.push({
      at: r.updated_at,
      who: name.get(r.updated_by) || 'someone',
      what: `set ${r.person_name} to “${r.actual || 'blank'}” on training`
    }));
  } catch { /* the table may not exist yet */ }

  try {
    const evals = await select('evals',
      'select=claimed_at,submitted_at,evaluator_id,guide:guides(full_name),member:members!evals_evaluator_id_fkey(full_name)' +
      '&or=(claimed_at.not.is.null,submitted_at.not.is.null)&order=claimed_at.desc&limit=15');
    (evals || []).forEach(e => {
      const g = e.guide?.full_name || 'a guide';
      const m = e.member?.full_name || 'someone';
      if (e.submitted_at) out.push({ at: e.submitted_at, who: m, what: `submitted an eval for ${g}` });
      else if (e.claimed_at) out.push({ at: e.claimed_at, who: m, what: `claimed ${g}` });
    });
  } catch { /* the join name may differ; the training half still works */ }

  return out
    .filter(x => x.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 12);
}

function paintChanges(list) {
  const box = $('#td-changes');
  if (!box) return;
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;

  const ago = iso => {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  box.innerHTML = `<details${list.some(x => Date.now() - new Date(x.at) < 3600000) ? ' open' : ''}>
    <summary class="td-changes-head">Recent changes <span class="muted">· last ${list.length}</span></summary>
    ${list.map(c => `<div class="td-change">
        <span class="w">${esc(c.who)}</span>
        <span class="t">${esc(c.what)}</span>
        <span class="a">${esc(ago(c.at))}</span>
      </div>`).join('')}
  </details>`;
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

    /* Admin only: this names who changed what, which is oversight rather than
       something a committee member needs on their landing screen. */
    if (isAdmin()) {
      const box = document.createElement('div');
      box.id = 'td-changes';
      box.hidden = true;
      $('#td-list').after(box);
      recentChanges().then(paintChanges).catch(() => {});
    }

    $('#td-list').addEventListener('click', e => {
      const row = e.target.closest('[data-go]');
      if (row) go(row.dataset.go);
    });
  }
};
