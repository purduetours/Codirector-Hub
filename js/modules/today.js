/* ============================================================ Home
   Vanessa's front door.

   This used to be "Today": a list of what was waiting. It still is — every
   rule in gather() below is unchanged — but it now opens with her, and with
   the tools this person can actually use laid out to be clicked. Nobody has to
   type to get anywhere. Typing is there for asking her things.

   What is on the page, and where each piece comes from:

   · the tool launcher      visibleModules(), the router's own permission
                            check — so a tool that is not in the sidebar is
                            not here either, and there is no second list of
                            who-sees-what to drift out of step
   · what needs you         gather() and deskGaps(), as before
   · on tour today          loadTours(), the schedule workbook the Schedule
                            and Eval Tracker already read (and cache)
   · active now             the presence heartbeat the top bar already runs
   · recent changes         admin only, exactly as before, undo included

   Nothing here is computed that was not already being computed somewhere.
   The id stays 'today' so every bookmark, Vanessa's "take me to today" and
   the router's default all keep landing here.
============================================================================ */
import { state, myName, isAdmin, inTraining, inRecruitment, termLabel, setting } from '../core/state.js';
import { select, update } from '../core/db.js';
import { loadDesks, loadTours } from '../core/sheets.js';
import { $, esc, injectStyle, initials, prettyTime, prettyDate, todayISO } from '../core/ui.js';
import { visibleModules } from '../core/router.js';
import { ICONS } from '../core/icons.js';
import { presenceSnapshot } from '../core/presence.js';
import { resolveActions } from '../core/vanessa-context.js';
import { performAction, actionById, openAction } from '../core/vanessa-os.js';
import { setVanessaState } from '../core/vanessa-state.js';
import { loadRoster } from './evals.js';
import interviews, { interviewData } from './interviews.js';
import { latestAnnouncements } from './announcements.js';
import { getActions, refreshActions, LEVELS } from '../core/actioncenter.js';
import { owedBy, trainingSources } from './training.js';

/* The change feed keeps its original look; the rest of home lives in
   css/home.css because it is the one screen big enough to deserve a file. */
injectStyle('today-css', `
.td-changes-head { cursor:pointer; font-size:var(--fs-sm); font-weight:700; padding:12px 4px; list-style:none; display:flex; gap:8px; align-items:center; }
.td-changes-head::-webkit-details-marker { display:none; }
.td-change { display:flex; gap:12px; font-size:var(--fs-sm); padding:9px 6px; border-top:1px solid var(--line); align-items:baseline; }
.td-change .w { font-weight:700; min-width:120px; flex:none; }
.td-change .t { flex:1; color:var(--text-soft); min-width:0; overflow-wrap:anywhere; }
.td-change .a { color:var(--text-faint); flex:none; font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
.td-undo { border:0; background:none; cursor:pointer; color:var(--gold-deep); font:inherit; font-weight:700;
  font-size:var(--fs-xs); padding:0 2px; flex:none; text-decoration:underline; text-underline-offset:3px; }
.td-undo:disabled { color:var(--text-faint); text-decoration:none; cursor:default; }
#td-changes { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev);
  padding:2px 16px 10px; box-shadow:var(--shadow); }
@media (max-width:620px){ .td-change { flex-wrap:wrap; gap:4px 10px; } .td-change .w { min-width:0; } .td-change .t { flex-basis:100%; order:3; } }
`);

/* What needs attention is no longer decided here: see core/actioncenter.js. */

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
/* Held for a minute: Home is visited constantly, and this is three queries
   that change rarely. Refresh (bust) clears it. */
let changesCache = null;
async function recentChanges() {
  if (changesCache && Date.now() - changesCache.at < 60000) return changesCache.list;
  const list = await loadChanges();
  changesCache = { at: Date.now(), list };
  return list;
}

async function loadChanges() {
  const out = [];
  const name = new Map();

  try {
    /* From the history table, which records what the value WAS. Without that
       a feed can say something changed but not what it changed from, and
       cannot offer to put it back. */
    const rows = await select('training_history',
      'select=id,attendance_id,person_name,field,was,became,changed_at,changed_by&order=changed_at.desc&limit=25');
    const ids = [...new Set((rows || []).map(r => r.changed_by).filter(Boolean))];
    if (ids.length) {
      const who = await select('members', `select=id,full_name&id=in.(${ids.join(',')})`);
      (who || []).forEach(m => name.set(m.id, m.full_name));
    }
    (rows || []).forEach(r => out.push({
      at: r.changed_at,
      who: name.get(r.changed_by) || 'someone',
      what: `${r.person_name}: ${r.field === 'actual' ? '' : 'reason '}“${r.was || 'blank'}” → “${r.became || 'blank'}”`,
      undo: { id: r.attendance_id, field: r.field, value: r.was, person: r.person_name }
    }));
  } catch {
    /* No history table yet (15-training-history.sql has not been run). Fall
       back to the timestamps the row itself carries: that still shows who
       changed what and when, just without the old value, so no undo. Better a
       feed with less in it than a screen that silently shows nothing. */
    try {
      const rows = await select('training_attendance',
        'select=person_name,actual,updated_at,updated_by&updated_by=not.is.null&order=updated_at.desc&limit=20');
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
    } catch { /* training may not be set up at all */ }
  }

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

  /* Administrative changes (people, guides, semesters, settings) from the audit
     log: meaningful operational history rather than system noise. */
  try {
    const rows = await select('admin_audit', 'select=at,actor_name,action,target_label&order=at.desc&limit=10');
    const verbs = { 'person.added': 'invited', 'person.archived': 'archived', 'person.restored': 'restored', 'person.role_changed': 'changed the role of',
      'guide.added': 'added guide', 'guide.archived': 'archived guide', 'guide.restored': 'restored guide', 'semester.started': 'started the semester',
      'term.saved': 'edited the semester', 'role.updated': 'changed the role', 'setting.changed': 'changed the setting', 'import.people': 'imported', 'import.guides': 'imported' };
    (rows || []).filter(r => verbs[r.action]).forEach(r => out.push({ at: r.at, who: r.actor_name || 'someone', what: `${verbs[r.action]} ${r.target_label || ''}`.trim() }));
  } catch { /* the audit log is not installed yet */ }

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
    <summary class="td-changes-head"><span class="hm-dot"></span>Recent changes <span class="muted">· last ${list.length}</span></summary>
    ${list.map((c, i) => `<div class="td-change">
        <span class="w">${esc(c.who)}</span>
        <span class="t">${esc(c.what)}</span>
        <span class="a">${esc(ago(c.at))}</span>
        ${c.undo ? `<button class="td-undo" data-undo="${i}" title="Put it back to “${esc(c.undo.value || 'blank')}”">undo</button>` : ''}
      </div>`).join('')}
  </details>`;
}

/* ------------------------------------------------------------ vocabulary */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (k, one, many = one + 's') => `${k < 10 ? WORDS[k] : k} ${k === 1 ? one : many}`;
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* Her greeting uses the name on the account — the first word of full_name,
   which is all the members table stores — and drops it when there is none. */
const firstName = () => String(myName() || '').trim().split(/\s+/)[0] || '';

function isoPlus(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------- on tour today */
let toursToday = null;
async function loadToursToday() {
  try {
    const rows = await loadTours();
    const today = todayISO();
    const slots = new Map();
    rows.filter(r => r.date === today).forEach(r => {
      const key = r.slot || r.start;
      if (!slots.has(key)) slots.set(key, { start: r.start, slot: r.slot, guides: [] });
      slots.get(key).guides.push(r.guide);
    });
    toursToday = { slots: [...slots.values()].sort((a, b) => (a.start || '').localeCompare(b.start || '')) };
  } catch { toursToday = null; }
  return toursToday;
}
const nextSlot = () => toursToday?.slots?.find(sl => (sl.start || '') >= nowHHMM()) || null;

/* ------------------------------------------------------------ context
   What the action registry is told about the day. Every value is one the
   hub already had in hand. */
function homeContext(gaps) {
  const iv = interviewData();
  const unscoredForMe = inRecruitment() && iv?.candidates?.length
    ? iv.candidates.filter(c => c.checkin === 'Yes' && !c.scores?.[myName()]).length : 0;
  const ann = visibleModules().find(m => m.id === 'announcements');
  const next = nextSlot();
  return {
    toursToday: toursToday ? toursToday.slots.length : null,
    nextTour: next ? prettyTime(next.start) : null,
    unread: Number(ann?.badge?.() || 0),
    deskGaps: gaps || 0,
    unscoredForMe
  };
}

/* ------------------------------------------------------------ agenda */
function agenda(items) {
  const out = [];
  const me = state.me?.id;
  const today = todayISO(), tomorrow = isoPlus(1);
  const mine = inTraining() ? (state.guides || []).filter(g => g.evaluatorId === me && g.status === 'claimed') : [];

  mine.filter(g => g.date === today)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .forEach(g => out.push({ today: true, tone: 'gold', icon: 'evals', go: 'evals',
      k: g.time ? prettyTime(g.time) : 'Today', t: `Eval · ${g.name}` }));

  if (toursToday?.slots?.length) {
    const next = nextSlot();
    out.push({ today: true, icon: 'schedule', go: 'schedule',
      k: next ? `Next ${prettyTime(next.start)}` : 'Done for today',
      t: `${toursToday.slots.length} tour${toursToday.slots.length === 1 ? '' : 's'} today` });
  }
  const soon = mine.filter(g => g.date === tomorrow);
  if (soon.length) out.push({ icon: 'evals', go: 'evals', k: 'Tomorrow',
    t: soon.length === 1 ? `Eval · ${soon[0].name}` : `${soon.length} evals` });
  if (items.length) out.push({ icon: 'spark', scroll: '#hm-attn', tone: 'warn', k: 'Waiting',
    t: `${items.length} thing${items.length === 1 ? '' : 's'} to look at` });
  return out;
}

function vanessaLine(items, plan) {
  const evalsToday = plan.filter(p => p.today && p.icon === 'evals').length;
  const bits = [];
  if (evalsToday) bits.push(`you have ${count(evalsToday, 'eval')} coming up today`);
  if (items.length) bits.push(`${count(items.length, 'thing')} ${items.length === 1 ? 'is' : 'are'} waiting on you`);
  if (!bits.length) {
    return toursToday?.slots?.length
      ? `Nothing is waiting on you. ${cap(count(toursToday.slots.length, 'tour'))} ${toursToday.slots.length === 1 ? 'is' : 'are'} running today.`
      : 'Nothing is waiting on you right now. Pick something below, or ask me anything.';
  }
  return cap(bits.join(', and ')) + '.';
}

function paintAgenda(plan) {
  const box = $('#hm-agenda');
  if (!box) return;
  box.innerHTML = plan.map((p, i) => `
    <button type="button" class="hm-plan ${p.tone ? 'is-' + p.tone : ''}" style="--i:${i}"
      ${p.go ? `data-go="${esc(p.go)}"` : ''} ${p.scroll ? `data-scroll="${esc(p.scroll)}"` : ''}>
      <span class="hm-plan-ico" data-morph-ico>${ICONS[p.icon] || ICONS.spark}</span>
      <span class="hm-plan-body"><em>${esc(p.k)}</em><b>${esc(p.t)}</b></span>
    </button>`).join('');
  box.hidden = !plan.length;
}

/* ---------------------------------------------------------------- actions
   Rendered straight from the registry's tiers:
     primary    in her stage, beside her — what needs you now, with why
     secondary  the tools you usually reach for, on the sheet
     more       folded away, a click to open */
// Buttons name their registry action; clicking runs it through Vanessa's
// one executor, exactly as typing the same request would.
const attrs = a => `data-action="${esc(a.id)}"`;
function actButton(a, size, i = 0) {
  const tool = a.kind === 'open' ? a.to : (a.icon || 'today');
  const line = a.reason || a.status || a.description;
  return `<button type="button" class="hm-act is-${size} ${a.kind === 'ask' ? 'is-ask' : ''}" ${attrs(a)}
      style="--tool:var(--t-${esc(tool)}, var(--gold-deep)); --n:${i}">
    <span class="hm-act-ico" data-morph-ico>${ICONS[a.icon] || ICONS.spark}</span>
    <span class="hm-act-body"><b>${esc(a.title)}</b>${line ? `<em>${esc(line)}</em>` : ''}</span>
    ${a.badge ? `<span class="hm-act-badge">${esc(a.badge)}</span>` : ''}
    <span class="hm-act-go">${a.kind === 'ask' ? '<span class="orb orb-xs"><i></i></span>' : ICONS.arrow}</span>
  </button>`;
}

function paintActions(ctx) {
  /* The notices themselves are on the page below; a card that only says "go
     to Announcements" would be the same thing twice. */
  const acts = resolveActions('today', ctx)
    .filter(a => !(newsRows.length && a.kind === 'open' && a.to === 'announcements'));
  let primary = acts.filter(a => a.tier === 'primary').slice(0, 3);
  // Always something to hand you, even on a quiet day.
  if (!primary.length) primary = acts.slice(0, 2);
  const rest = acts.filter(a => !primary.includes(a));
  // A small role gets everything in plain view; "More" is only for a lot.
  const secondary = rest.length <= 6 ? rest : rest.filter(a => a.tier !== 'more').slice(0, 6);
  const more = rest.filter(a => !secondary.includes(a));

  const focus = $('#hm-focus');
  if (focus) focus.innerHTML = primary.map((a, i) => actButton(a, 'focus', i)).join('');

  const deck = $('#hm-deck');
  if (deck) deck.innerHTML = secondary.map((a, i) => actButton(a, 'deck', i)).join('');
  const block = deck?.closest('.hm-block');
  if (block) block.hidden = !secondary.length && !more.length;
  const box = $('#hm-more');
  if (box) {
    box.hidden = !more.length;
    $('#hm-more-n').textContent = String(more.length);
    $('#hm-more-body').innerHTML = more.map((a, i) => actButton(a, 'mini', i)).join('');
  }
  return primary;
}

/* ---------------------------------------------------------- announcements
   The newest two, so a notice is seen on arrival rather than found by going
   looking. Read-only here; posting stays on the Announcements page. */
let newsRows = [];
function paintNews(rows) {
  try {
    const box = $('#hm-news');
    if (!box || !rows.length) return;
    box.hidden = false;
    $('#hm-news-list').innerHTML = rows.map(a => `<a class="hm-note ${a.unread ? 'is-new' : ''}" href="#/announcements">
        <span class="hm-note-t">${a.pinned ? 'Pinned · ' : ''}${esc(a.title)}${a.unread ? '<span class="hm-new">New</span>' : ''}</span>
        <span class="hm-note-b">${esc(a.body)}</span></a>`).join('');
  } catch { /* announcements are not essential to Home */ }
}

/* ------------------------------------------------------- up next / attention
   "What do I need to know or do next?" Three small painters over the Action
   Center's list; none of them decides anything itself. */
const goRow = a => `<a class="td-row hm-row ${a.level === 'urgent' ? 'is-warn' : ''}" href="${esc(a.url || '#/actions')}">
    <span class="td-what"><b>${esc(a.title)}</b><em>${esc(a.detail || a.source)}</em></span><span class="td-go">${ICONS.arrow}</span></a>`;

function paintNext(acts) {
  const box = $('#hm-next-body');
  if (!box) return;
  const dated = acts.filter(a => a.due && a.level !== 'info').sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const next = dated.find(a => a.due >= todayISO()) || dated[0];
  const slot = nextSlot();
  if (next) {
    box.innerHTML = `<a class="hm-next" href="${esc(next.url)}"><span class="hm-next-k">${esc(next.level === 'urgent' ? 'Overdue' : prettyDay(next.due))}</span>
      <b>${esc(next.title)}</b><em>${esc(next.detail || '')}</em></a>
      <div class="hm-next-acts"><a class="btn btn-primary btn-sm" href="${esc(next.url)}">Open</a>
      <button type="button" class="btn btn-ghost btn-sm" data-vanessa-ask="Brief me">Ask Vanessa</button></div>`;
  } else if (slot) {
    box.innerHTML = `<a class="hm-next" href="#/schedule"><span class="hm-next-k">Today</span><b>Next tour at ${esc(prettyTime(slot.start))}</b>
      <em>${esc(slot.guides.slice().sort().join(', '))}</em></a>`;
  } else {
    box.innerHTML = `<p class="hm-quiet">Nothing is scheduled for you.${visibleModules().some(m => m.id === 'schedule') ? ' <a href="#/schedule">See the tour schedule</a>.' : ''}</p>`;
  }
}

function paintAttention(needs) {
  const col = $('#hm-attn');
  if (!col) return;
  col.hidden = !needs.length;                       // only prominent when something actually needs attention
  $('#hm-flow-a')?.classList.toggle('is-solo', !needs.length);
  $('#hm-attn-n').textContent = needs.length ? String(needs.length) : '';
  $('#td-list').innerHTML = needs.slice(0, 5).map(goRow).join('') +
    (needs.length > 5 ? `<a class="hm-more-btn" href="#/actions">${needs.length - 5} more ${ICONS.arrow}</a>` : '');
}

function paintUpcoming(acts) {
  const box = $('#hm-up-body');
  if (!box) return;
  const horizon = isoPlus(Number(setting('actions.horizonDays', 7)));
  const rows = acts.filter(a => a.level === 'upcoming').map(a => ({ k: prettyDay(a.due), t: a.title, d: a.detail, url: a.url, due: a.due }));
  if (isAdmin()) {
    const src = trainingSources();
    (src?.sessions || []).filter(x => x.held_on && x.held_on >= todayISO() && x.held_on <= horizon)
      .forEach(x => rows.push({ k: prettyDay(x.held_on), t: `Training: ${x.label}`, d: '', url: '#/training', due: x.held_on }));
  }
  rows.sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')));
  box.innerHTML = rows.length
    ? rows.slice(0, 5).map(r => `<a class="hm-up" href="${esc(r.url)}"><span class="hm-up-k">${esc(r.k)}</span><span><b>${esc(r.t)}</b>${r.d ? `<em>${esc(r.d)}</em>` : ''}</span></a>`).join('')
    : `<p class="hm-quiet">Nothing coming up in the next ${Number(setting('actions.horizonDays', 7))} days.</p>`;
}

const prettyDay = iso => {
  if (!iso) return '';
  const t = todayISO();
  return iso === t ? 'Today' : iso === isoPlus(1) ? 'Tomorrow' : prettyDate(iso);
};

/* Admin only: the day in one line of chips, each a doorway to the place to act. */
function paintToday(gaps) {
  const box = $('#hm-today');
  if (!box) return;
  const c = state.counts || {};
  const owed = owedBy()?.size || 0;
  const chips = [
    toursToday ? { t: `${toursToday.slots.length} ${toursToday.slots.length === 1 ? 'tour' : 'tours'} today`, url: '#/schedule' } : null,
    gaps ? { t: `${gaps} desk ${gaps === 1 ? 'slot' : 'slots'} uncovered`, url: '#/desks', warn: true } : null,
    c.open ? { t: `${c.open} guides need an evaluator`, url: '#/evals', warn: c.open > 0 } : null,
    c.submitted ? { t: `${c.submitted} evaluations to review`, url: '#/evals' } : null,
    owed ? { t: `${owed} ${owed === 1 ? 'person owes' : 'people owe'} makeups`, url: '#/training', warn: true } : null
  ].filter(Boolean);
  box.hidden = !chips.length;
  box.innerHTML = `<h2 class="hm-today-h">Today</h2><div class="hm-chips">${chips.map(x => `<a class="hm-chip ${x.warn ? 'is-warn' : ''}" href="${esc(x.url)}">${esc(x.t)}</a>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- tours */
function paintTours() {
  const box = $('#hm-tours');
  if (!box) return;
  if (!toursToday) { box.innerHTML = `<p class="hm-quiet">The schedule workbook could not be reached. The Schedule tab will retry.</p>`; return; }
  const { slots } = toursToday;
  if (!slots.length) { box.innerHTML = `<p class="hm-quiet">No tours on the schedule today.</p>`; return; }
  const now = nowHHMM();
  const next = slots.findIndex(sl => (sl.start || '') >= now);
  box.innerHTML = `<ol class="hm-timeline">${slots.map((sl, i) => {
    const cls = next === -1 || i < next ? 'is-past' : i === next ? 'is-next' : '';
    return `<li class="${cls}" style="--i:${i}">
      <span class="hm-time">${esc(sl.slot || prettyTime(sl.start))}</span>
      <span class="hm-guides">${sl.guides.slice().sort().map(g => `<span>${esc(g)}</span>`).join('')}</span>
    </li>`;
  }).join('')}</ol>`;
}

/* ------------------------------------------------------------- active now */
function paintPresence(snap) {
  const box = $('#hm-presence');
  if (!box) return;
  const users = snap && !snap.error ? (snap.users || []) : [];
  if (!users.length) { box.hidden = true; return; }
  box.hidden = false;
  const faces = users.slice(0, 5).map((u, i) =>
    `<span class="hm-face" style="--i:${i}" title="${esc(u.full_name)}">${esc(initials(u.full_name))}</span>`).join('');
  box.innerHTML = `<span class="hm-faces">${faces}</span>
    <span>${users.length === 1 ? 'Just you here right now' : `${cap(count(users.length, 'teammate'))} active now`}</span>`;
}

/* ---------------------------------------------------------------- shell */
function dayPart() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function shell() {
  const name = firstName();
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const sk = h => `<div class="skel" style="height:${h}px"></div>`;
  return `
  <section class="hm-stage">
    <div class="hm-orb" aria-hidden="true"><span class="hm-halo"></span><span class="orb orb-lg"><i></i></span><span class="hm-thread"></span></div>
    <div class="hm-stage-body">
      <p class="hm-eyebrow"><span>${esc(dayPart())}</span><span>${esc(date)}</span>${termLabel() ? `<span>${esc(termLabel())}</span>` : ''}</p>
      <h1 class="hm-title">${name ? `Hi <span class="hm-name">${esc(name)}</span>, I’m Vanessa.` : 'I’m Vanessa.'}
        <em>Let’s move things forward.</em></h1>
      <p class="hm-says" id="hm-says" aria-live="polite"><span class="skel" style="display:inline-block;width:min(420px,70%);height:1em;vertical-align:middle"></span></p>
      <form class="hm-ask hm-ask-primary" id="hm-ask" role="search">
        <span class="hm-ask-ico">${ICONS.spark}</span>
        <input id="hm-ask-input" autocomplete="off" aria-label="Tell Vanessa what you need" placeholder="Tell me what you need to get done…">
        <button class="btn btn-primary btn-sm" type="submit">Let’s do it ${ICONS.send}</button>
      </form>
      <div class="hm-vanessa-starts" aria-label="Start with Vanessa">
        <button type="button" data-vanessa-ask="Brief me"><span>Start my day</span><b>What needs my attention?</b><em>I’ll pull your priorities together.</em></button>
        ${isAdmin() ? `<button type="button" data-vanessa-ask="Who owes makeup?"><span>Training</span><b>Let’s get everyone caught up.</b><em>Review makeups, update records, draft reminders.</em></button>` : ''}
        <button type="button" data-vanessa-ask="Prepare a meeting agenda"><span>Think ahead</span><b>Help me prepare for a meeting.</b><em>A brief and an editable agenda, right here.</em></button>
      </div>
      <div class="hm-focus" id="hm-focus">${sk(96)}${sk(96)}</div>
      <div class="hm-agenda" id="hm-agenda" hidden></div>
      <p class="hm-presence" id="hm-presence" hidden></p>
    </div>
  </section>

  <div class="hm-sheet">
    <svg class="hm-wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 60 L0 34 C 180 6, 360 2, 560 18 S 940 54, 1200 20 L1200 60 Z"/>
    </svg>
    <section class="hm-block" data-reveal>
      <header class="hm-head"><h2>Quick actions</h2><p>Start something from here.</p></header>
      <div id="hm-deck" class="hm-deck">${sk(64)}${sk(64)}${sk(64)}</div>
      <details class="hm-more" id="hm-more" hidden>
        <summary><span>More</span><span class="hm-card-n" id="hm-more-n"></span>${ICONS.arrow}</summary>
        <div class="hm-more-body" id="hm-more-body"></div>
      </details>
    </section>

    ${isAdmin() ? `<section class="hm-today" id="hm-today" aria-label="Today" hidden></section>` : ''}

    <div class="hm-flow" id="hm-flow-a">
      <section class="hm-col" id="hm-next" data-reveal>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.clock}</span><h3>Up next</h3></header>
        <div id="hm-next-body">${sk(86)}</div>
      </section>
      <section class="hm-col" id="hm-attn" data-reveal hidden>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.spark}</span><h3>Needs attention</h3><span class="hm-card-n" id="hm-attn-n"></span></header>
        <div id="td-list"></div>
      </section>
    </div>

    <div class="hm-flow" id="hm-flow-b">
      <section class="hm-col" id="hm-up" data-reveal>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.schedule}</span><h3>Upcoming</h3><a class="hm-all" href="#/actions">All ${ICONS.arrow}</a></header>
        <div id="hm-up-body">${sk(40)}</div>
      </section>
      <section class="hm-col" data-reveal>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.tours}</span><h3>On tour today</h3></header>
        <div id="hm-tours">${sk(40)}</div>
      </section>
    </div>

    <section class="hm-block hm-news" id="hm-news" data-reveal hidden>
      <header class="hm-col-head"><span class="hm-card-ico">${ICONS.announcements}</span><h3>Announcements</h3><a class="hm-all" href="#/announcements">All ${ICONS.arrow}</a></header>
      <div id="hm-news-list"></div>
    </section>
  </div>`;
}

/* ---------------------------------------------------------------- handoff
   Choosing a tool: she says she is opening it, the choice lifts while the
   rest of the page steps back, then the router grows it into the workspace.
   The pause is short and the navigation always happens — the animation
   sells continuity, it never stands in the way. */
let handing = false;
function handoff(action, el) {
  if (handing || !action) return;
  if (action.kind === 'ask') { performAction(action); return; }
  const mod = visibleModules().find(m => m.id === action.to);
  if (!mod) { performAction(action); return; }     // lets the executor say no, politely
  if (reduced()) { performAction(action, { from: el }); return; }
  handing = true;
  setVanessaState('opening');
  const says = $('#hm-says');
  if (says) says.textContent = `Opening ${mod.title} for you…`;
  el.classList.add('is-chosen');
  $('#view')?.classList.add('is-handing');
  setTimeout(() => { handing = false; performAction(action, { from: el }); }, 240);
}

let onPresence = null, homeEvents = null;

export default {
  id: 'today',
  title: 'Home',
  crumb: 'Vanessa, your tools, and what needs you',
  icon: '👋',
  section: 'Hub',

  /* Drawn inside the route transition, so her orb has somewhere to land. */
  prepaint(view) { view.innerHTML = shell(); },
  bust: () => { changesCache = null; },

  unmount() {
    homeEvents?.abort(); homeEvents=null;
    if (onPresence) document.removeEventListener('hub:presence', onPresence);
    onPresence = null;
    handing = false;
  },

  async mount(view) {
    homeEvents?.abort();homeEvents=new AbortController();
    if (!view.querySelector('.hm-stage')) view.innerHTML = shell();
    setVanessaState('ready');

    const ask = q => document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: q } }));
    $('#hm-ask').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('#hm-ask-input');
      const q = input.value.trim();
      input.value = '';
      ask(q);
    });

    view.addEventListener('click', e => {
      if (document.body.dataset.route !== 'today') return;
      const start = e.target.closest('button[data-vanessa-ask]');
      if (start && view.contains(start)) { ask(start.dataset.vanessaAsk); return; }
      const to = e.target.closest('[data-scroll]');
      if (to) { $(to.dataset.scroll)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); return; }
      const act = e.target.closest('[data-action]');
      if (act) { e.preventDefault(); handoff(actionById(act.dataset.action), act); return; }
      const dest = e.target.closest('[data-go]');
      if (dest) { e.preventDefault(); handoff(openAction(dest.dataset.go), dest); }
    }, {signal:homeEvents.signal});

    paintPresence(presenceSnapshot());
    onPresence = e => paintPresence(e.detail);
    document.addEventListener('hub:presence', onPresence);

    await Promise.allSettled([
      inTraining() && !state.guides.length ? loadRoster() : null,
      inRecruitment() ? interviews.prefetch?.() : null,
      loadToursToday(),
      latestAnnouncements(2).then(r => { newsRows = r; }, () => { newsRows = []; })
    ]);
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    const gaps = inTraining() ? await deskGaps() : null;
    await refreshActions();
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    /* Everything that wants this person comes from the Action Center, the same
       list the bell and Vanessa read — Home does not keep a second set of rules. */
    const acts = getActions();
    const needs = acts.filter(a => LEVELS[a.level].badge);
    const items = needs.map(a => ({ n: 1, what: a.title, why: a.detail || '', go: (a.url || '').replace(/^#\//, '').split('?')[0] }));

    const plan = agenda(items);
    $('#hm-says').textContent = vanessaLine(items, plan);
    const primary = paintActions(homeContext(gaps));
    const handed = new Set(primary.filter(a => a.kind === 'open').map(a => a.to));
    paintAgenda(plan.filter(p => !(p.go && handed.has(p.go) && !p.today) && !(p.go === 'schedule' && handed.has('schedule'))));
    paintTours();
    paintNews(newsRows);
    paintNext(acts);
    paintAttention(needs);
    paintUpcoming(acts);
    if (isAdmin()) paintToday(gaps);
    const rerender = () => {
      if (document.body.dataset.route !== 'today') return;
      const a2 = getActions();
      paintNext(a2); paintAttention(a2.filter(a => LEVELS[a.level].badge)); paintUpcoming(a2);
    };
    document.addEventListener('hub:actions', rerender, { signal: homeEvents.signal });

    /* Admin only: this names who changed what, which is oversight rather than
       something a committee member needs on their landing screen. */
    if (isAdmin()) {
      const box = document.createElement('div');
      box.id = 'td-changes';
      box.hidden = true;
      view.querySelector('#hm-flow-b').after(box);
      recentChanges().then(list => {
        paintChanges(list);
        $('#td-changes')?.addEventListener('click', async e => {
          const btn = e.target.closest('[data-undo]');
          if (!btn) return;
          const c = list[Number(btn.dataset.undo)];
          if (!c?.undo) return;
          if (!confirm(`Put ${c.undo.person} back to “${c.undo.value || 'blank'}”?`)) return;
          btn.disabled = true;
          try {
            await update('training_attendance', `id=eq.${c.undo.id}`, { [c.undo.field]: c.undo.value || null });
            btn.textContent = 'undone';
            setVanessaState('success');
            // Reverting is itself a change, so the feed will show it next time.
          } catch (err) { btn.disabled = false; alert(err.message); setVanessaState('error'); }
        });
      }).catch(() => {});
    }
  }
};
