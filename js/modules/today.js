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
import { state, myName, isAdmin, inTraining, inRecruitment, termLabel } from '../core/state.js';
import { select, update } from '../core/db.js';
import { loadDesks, loadTours } from '../core/sheets.js';
import { $, esc, injectStyle, initials, prettyTime, todayISO } from '../core/ui.js';
import { morphTo, visibleModules } from '../core/router.js';
import { iconFor, ICONS } from '../core/icons.js';
import { presenceSnapshot } from '../core/presence.js';
import { homeActions } from '../core/vanessa-context.js';
import { loadRoster } from './evals.js';
import interviews, { interviewData } from './interviews.js';

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
const count = (n, one, many = one + 's') => `${n < 10 ? WORDS[n] : n} ${n === 1 ? one : many}`;
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

/* Her greeting uses the name on the account — first word of full_name, since
   that is all the members table stores — and simply drops it if there is none. */
function firstName() {
  return String(myName() || '').trim().split(/\s+/)[0] || '';
}

function isoPlus(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ agenda
   What is coming up, built only from what the hub already knows: your own
   claimed evals and their tour dates, today's tours from the workbook,
   unread announcements, and the count of things waiting on you. */
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
    const now = nowHHMM();
    const next = toursToday.slots.find(sl => (sl.start || '') >= now);
    out.push({ today: true, icon: 'schedule', go: 'schedule',
      k: next ? `Next ${prettyTime(next.start)}` : 'Done for today',
      t: `${toursToday.slots.length} tour${toursToday.slots.length === 1 ? '' : 's'} today` });
  }

  const soon = mine.filter(g => g.date === tomorrow);
  if (soon.length) out.push({ icon: 'evals', go: 'evals', k: 'Tomorrow',
    t: soon.length === 1 ? `Eval · ${soon[0].name}` : `${soon.length} evals` });

  const ann = visibleModules().find(m => m.id === 'announcements');
  const unread = Number(ann?.badge?.() || 0);
  if (unread) out.push({ icon: 'announcements', go: 'announcements', k: 'New', t: `${unread} announcement${unread === 1 ? '' : 's'}` });

  if (items.length) out.push({ icon: 'spark', scroll: '#hm-attn', tone: 'warn', k: 'Waiting',
    t: `${items.length} thing${items.length === 1 ? '' : 's'} to look at` });
  return out;
}

function vanessaLine(items, plan) {
  const todayCount = plan.filter(p => p.today && p.icon === 'evals').length;
  const bits = [];
  if (todayCount) bits.push(`you have ${count(todayCount, 'eval')} coming up today`);
  if (items.length) bits.push(`${count(items.length, 'thing')} ${items.length === 1 ? 'is' : 'are'} waiting on you`);
  if (!bits.length) {
    return toursToday?.slots?.length
      ? `Nothing is waiting on you. ${cap(count(toursToday.slots.length, 'tour'))} ${toursToday.slots.length === 1 ? 'is' : 'are'} running today.`
      : 'Nothing is waiting on you right now. Pick something below, or ask me anything.';
  }
  return cap(bits.join(', and ')) + '. Here is the day at a glance.';
}

function paintAgenda(plan) {
  const box = $('#hm-agenda');
  if (!box) return;
  box.innerHTML = plan.map((p, i) => `
    <button type="button" class="hm-plan ${p.tone ? 'is-' + p.tone : ''}" style="--i:${i}"
      ${p.go ? `data-go="${esc(p.go)}"` : ''} ${p.scroll ? `data-scroll="${esc(p.scroll)}"` : ''}>
      <span class="hm-plan-ico">${ICONS[p.icon] || ICONS.spark}</span>
      <span class="hm-plan-body"><em>${esc(p.k)}</em><b>${esc(p.t)}</b></span>
    </button>`).join('');
  box.hidden = !plan.length;
}

/* ---------------------------------------------------------------- deck
   What Vanessa can do for you — verbs, drawn from vanessa-context.js so the
   deck, her panel and her hints all offer the same permission-checked set.
   The first three are given room; the rest sit in a quieter row. */
function paintDeck() {
  const box = $('#hm-deck');
  if (!box) return;
  const acts = homeActions({ toursToday: toursToday ? toursToday.slots.length : null });
  const lead = acts.filter(a => a.weight >= 2).slice(0, 3);
  // Questions first, then places — every place is also in "All your tools".
  const rest = acts.filter(a => !lead.includes(a))
    .sort((x, y) => (x.kind === 'ask' ? 0 : 1) - (y.kind === 'ask' ? 0 : 1) || y.weight - x.weight)
    .slice(0, 6);
  const btn = (a, big) => {
    const tool = a.kind === 'go' ? a.to : (a.icon || 'today');
    const attrs = a.kind === 'go' ? `data-go="${esc(a.to)}"` : `data-ask="${esc(a.q)}"`;
    return `<button type="button" class="hm-act ${big ? 'is-lead' : ''} ${a.kind === 'ask' ? 'is-ask' : ''}" ${attrs}
        style="--tool:var(--t-${esc(tool)}, var(--gold-deep))">
      <span class="hm-act-ico" data-morph-ico>${ICONS[a.icon] || ICONS.spark}</span>
      <span class="hm-act-body"><b>${esc(a.label)}</b>${a.sub ? `<em>${esc(a.sub)}</em>` : ''}</span>
      <span class="hm-act-go">${a.kind === 'ask' ? '<span class="orb orb-xs"><i></i></span>' : ICONS.arrow}</span>
    </button>`;
  };
  box.innerHTML =
    `<div class="hm-deck-lead hm-n${lead.length}">${lead.map(a => btn(a, true)).join('')}</div>` +
    (rest.length ? `<div class="hm-deck-rest">${rest.map(a => btn(a, false)).join('')}</div>` : '');
}

/* All of this person's tools, as a quiet row of places at the foot of the
   page. The rail has them too; this is for the person who scrolled here. */
function paintPlaces() {
  const box = $('#hm-places');
  if (!box) return;
  box.innerHTML = visibleModules().filter(m => m.id !== 'today' && !m.soon).map(m => {
    const b = Number(m.badge?.() || 0);
    return `<a class="hm-place" href="#/${esc(m.id)}" data-go="${esc(m.id)}" style="--tool:var(--t-${esc(m.id)}, var(--gold-deep))">
      <span class="hm-place-ico" data-morph-ico>${iconFor(m)}</span><span>${esc(m.title)}</span>${b ? `<i>${b}</i>` : ''}</a>`;
  }).join('');
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

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function paintTours() {
  const box = $('#hm-tours');
  if (!box) return;
  if (!toursToday) {
    box.innerHTML = `<p class="hm-quiet">The schedule workbook could not be reached. The Schedule tab will retry.</p>`;
    return;
  }
  const { slots } = toursToday;
  if (!slots.length) { box.innerHTML = `<p class="hm-quiet">No tours on the schedule today.</p>`; return; }
  const now = nowHHMM();
  const next = slots.findIndex(sl => (sl.start || '') >= now);
  box.innerHTML = `<ol class="hm-timeline">${slots.map((sl, i) => {
    const cls = next === -1 || i < next ? 'is-past' : i === next ? 'is-next' : '';
    return `<li class="${cls}">
      <span class="hm-time">${esc(sl.slot || prettyTime(sl.start))}</span>
      <span class="hm-guides">${sl.guides.slice().sort().map(g => `<span>${esc(g)}</span>`).join('')}</span>
    </li>`;
  }).join('')}</ol>`;
}

/* ------------------------------------------------------------- active now
   A quiet line under Vanessa rather than a panel: a few faces and a count. */
function paintPresence(snap) {
  const box = $('#hm-presence');
  if (!box) return;
  const users = snap && !snap.error ? (snap.users || []) : [];
  if (!users.length) { box.hidden = true; return; }
  box.hidden = false;
  const faces = users.slice(0, 5).map((u, i) =>
    `<span class="hm-face" style="--i:${i}" title="${esc(u.full_name)}">${esc(initials(u.full_name))}</span>`).join('');
  box.innerHTML = `<span class="hm-faces">${faces}</span>
    <span>${users.length === 1 ? 'Just you here right now' : `${count(users.length, 'team member')} active now`}</span>`;
}

/* ---------------------------------------------------------------- shell */
function dayPart() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function shell() {
  const name = firstName();
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `
  <section class="hm-stage" data-reveal>
    <div class="hm-orb" aria-hidden="true"><span class="hm-halo"></span><span class="orb orb-lg"><i></i></span></div>
    <div class="hm-stage-body">
      <p class="hm-eyebrow"><span>${esc(dayPart())}</span><span>${esc(date)}</span>${termLabel() ? `<span>${esc(termLabel())}</span>` : ''}</p>
      <h1 class="hm-title">${name ? `Welcome back, <span class="hm-name">${esc(name)}</span>.` : 'Welcome back.'}
        <em>What are we working on today?</em></h1>
      <p class="hm-says" id="hm-says"><span class="skel" style="display:inline-block;width:min(420px,70%);height:1em;vertical-align:middle"></span></p>
      <div class="hm-agenda" id="hm-agenda" hidden></div>
      <form class="hm-ask" id="hm-ask">
        <span class="hm-ask-ico">${ICONS.spark}</span>
        <input id="hm-ask-input" autocomplete="off" aria-label="Ask Vanessa" placeholder="Ask Vanessa anything about the hub…">
        <button class="btn btn-primary btn-sm" type="submit">Ask ${ICONS.send}</button>
      </form>
      <p class="hm-presence" id="hm-presence" hidden></p>
    </div>
  </section>

  <div class="hm-sheet">
    <svg class="hm-wave" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 60 L0 34 C 180 6, 360 2, 560 18 S 940 54, 1200 20 L1200 60 Z"/>
    </svg>
    <section class="hm-block" data-reveal>
      <header class="hm-head"><h2>What can I help with?</h2><p>Pick one — I'll take you there, or do it with you.</p></header>
      <div id="hm-deck" class="hm-deck">
        <div class="hm-deck-lead hm-n3"><div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div><div class="skel" style="height:118px"></div></div>
      </div>
    </section>

    <div class="hm-flow">
      <section class="hm-col" id="hm-attn" data-reveal>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.spark}</span><h3>Waiting on you</h3><span class="hm-card-n" id="hm-attn-n"></span></header>
        <div id="td-list"><div class="skel" style="height:58px;margin-bottom:8px"></div><div class="skel" style="height:58px"></div></div>
      </section>
      <section class="hm-col" data-reveal>
        <header class="hm-col-head"><span class="hm-card-ico">${ICONS.clock}</span><h3>On tour today</h3></header>
        <div id="hm-tours"><div class="skel" style="height:40px"></div></div>
      </section>
    </div>

    <section class="hm-block hm-places-block" data-reveal>
      <header class="hm-head"><h2>All your tools</h2></header>
      <nav class="hm-places" id="hm-places" aria-label="Your tools"></nav>
    </section>
  </div>`;
}

let onPresence = null;

export default {
  id: 'today',
  title: 'Home',
  crumb: 'Vanessa, your tools, and what needs you',
  icon: '👋',
  section: 'Hub',

  unmount() {
    if (onPresence) document.removeEventListener('hub:presence', onPresence);
    onPresence = null;
  },

  async mount(view) {
    view.innerHTML = shell();

    const ask = q => document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: q } }));
    $('#hm-ask').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('#hm-ask-input');
      const q = input.value.trim();
      input.value = '';
      ask(q);
    });

    /* One delegate for everything clickable on home. Going somewhere grows
       the clicked element into the workspace; asking hands it to Vanessa. */
    view.addEventListener('click', e => {
      const q = e.target.closest('[data-ask]');
      if (q) { ask(q.dataset.ask); return; }
      const to = e.target.closest('[data-scroll]');
      if (to) { $(to.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const dest = e.target.closest('[data-go]');
      if (dest) { e.preventDefault(); morphTo(dest.dataset.go, dest); }
    });

    paintPresence(presenceSnapshot());
    onPresence = e => paintPresence(e.detail);
    document.addEventListener('hub:presence', onPresence);

    paintPlaces();
    const tours = loadToursToday();

    await Promise.allSettled([
      inTraining() && !state.guides.length ? loadRoster() : null,
      inRecruitment() ? interviews.prefetch?.() : null,
      tours
    ]);
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    const items = gather();
    const gaps = inTraining() ? await deskGaps() : null;
    if (gaps) items.push({ n: gaps, what: 'Uncovered desk slots this week',
                           why: 'Nobody is down for these', go: 'desks' });
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    const plan = agenda(items);
    $('#hm-says').textContent = vanessaLine(items, plan);
    paintAgenda(plan);
    paintDeck();
    paintPlaces();
    paintTours();
    $('#hm-attn-n').textContent = items.length ? String(items.length) : '';

    const row = (i, n) => `
          <button class="td-row hm-row ${i.tone === 'warn' ? 'is-warn' : ''}" data-go="${esc(i.go)}" style="--i:${n}">
            <span class="td-n" data-morph-ico>${i.n}</span>
            <span class="td-what"><b>${esc(i.what)}</b><em>${esc(i.why)}</em></span>
            <span class="td-go">${ICONS.arrow}</span>
          </button>`;
    const SHOWN = 5;
    $('#td-list').innerHTML = items.length
      ? items.slice(0, SHOWN).map(row).join('') +
        (items.length > SHOWN
          ? `<div class="hm-more-list" id="hm-more-list"><div>${items.slice(SHOWN).map(row).join('')}</div></div>
             <button type="button" class="hm-more" aria-expanded="false" aria-controls="hm-more-list">${items.length - SHOWN} more ${ICONS.arrow}</button>`
          : '')
      : `<div class="hm-clear"><span class="hm-clear-mark">${ICONS.check}</span>
         <p><b>All clear.</b> Nothing needs you right now.</p></div>`;
    $('.hm-more')?.addEventListener('click', e => {
      const b = e.currentTarget, openNow = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(openNow));
      $('#hm-more-list').classList.toggle('is-open', openNow);
      b.firstChild.textContent = openNow ? 'Show fewer ' : `${items.length - SHOWN} more `;
    });

    /* Admin only: this names who changed what, which is oversight rather than
       something a committee member needs on their landing screen. */
    if (isAdmin()) {
      const box = document.createElement('div');
      box.id = 'td-changes';
      box.hidden = true;
      view.querySelector('.hm-places-block').before(box);
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
            // Reverting is itself a change, so the feed will show it next time.
          } catch (err) { btn.disabled = false; alert(err.message); }
        });
      }).catch(() => {});
    }
  }
};
