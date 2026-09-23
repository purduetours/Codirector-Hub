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
import { go, visibleModules } from '../core/router.js';
import { iconFor, ICONS } from '../core/icons.js';
import { presenceSnapshot } from '../core/presence.js';
import { vanessaSuggestions } from '../core/vanessa-ui.js';
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

/* ---------------------------------------------------------------- launcher
   Which tools come first. A tool with something waiting in it leads; after
   that, the tool this person's committee lives in. The order is a guess at
   relevance, never a gate — every tool they can reach is on the page. */
const HOME_ORDER = ['evals', 'interviews', 'schedule', 'training', 'announcements', 'desks', 'directory', 'people', 'health'];

function toolLine(m) {
  const c = state.counts || {};
  if (m.id === 'evals' && state.guides?.length) {
    const mine = state.guides.filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed').length;
    return `${c.open || 0} up for grabs${mine ? ` · ${mine} yours` : ''}`;
  }
  if (m.id === 'interviews') {
    const cands = interviewData()?.candidates;
    if (cands?.length) return `${cands.length} candidates · ${cands.filter(x => x.checkin === 'Yes').length} checked in`;
  }
  if (m.id === 'schedule' && toursToday) {
    return toursToday.slots.length ? `${toursToday.slots.length} tour${toursToday.slots.length === 1 ? '' : 's'} today` : 'No tours today';
  }
  return m.crumb || '';
}

function rankTools(items) {
  const waiting = new Map();
  items.forEach(i => waiting.set(i.go, (waiting.get(i.go) || 0) + i.n));
  const tools = visibleModules().filter(m => m.id !== 'today' && !m.soon);
  const pos = id => { const i = HOME_ORDER.indexOf(id); return i < 0 ? 99 : i; };
  return tools
    .map(m => ({ m, waiting: waiting.get(m.id) || 0, badge: Number(m.badge?.() || 0) }))
    .sort((a, b) => (b.waiting > 0) - (a.waiting > 0) || (b.badge > 0) - (a.badge > 0) || pos(a.m.id) - pos(b.m.id));
}

function tile(t, featured) {
  const { m, waiting, badge } = t;
  const count = waiting || badge;
  return `<a class="hm-tool ${featured ? 'is-featured' : ''}" href="#/${esc(m.id)}" style="--tool:var(--t-${esc(m.id)}, var(--gold-deep))">
    <span class="hm-tool-ico">${iconFor(m)}</span>
    <span class="hm-tool-body">
      <span class="hm-tool-name">${esc(m.title)}</span>
      <span class="hm-tool-line" data-line="${esc(m.id)}">${esc(toolLine(m))}</span>
    </span>
    ${count ? `<span class="hm-tool-count" title="${waiting ? 'Waiting on you' : 'New'}">${count}</span>` : ''}
    <span class="hm-tool-go">${ICONS.arrow}</span>
  </a>`;
}

function paintLauncher(items) {
  const ranked = rankTools(items);
  const box = $('#hm-tools');
  if (!box) return;
  if (!ranked.length) {
    box.innerHTML = '<p class="muted">Your role does not include any tools yet. A codirector can change that in People.</p>';
    return;
  }
  // Two featured on a normal role; three when there is enough to fill a row.
  const lead = ranked.length >= 6 ? 3 : Math.min(2, ranked.length);
  box.innerHTML =
    `<div class="hm-featured hm-cols-${lead}">${ranked.slice(0, lead).map(t => tile(t, true)).join('')}</div>` +
    (ranked.length > lead ? `<div class="hm-rest">${ranked.slice(lead).map(t => tile(t, false)).join('')}</div>` : '');
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
  if (!slots.length) {
    box.innerHTML = `<p class="hm-quiet">No tours on the schedule today.</p>`;
    return;
  }
  const now = nowHHMM();
  const next = slots.findIndex(s => (s.start || '') >= now);
  box.innerHTML = `<ol class="hm-timeline">${slots.map((s, i) => {
    const past = next === -1 ? true : i < next;
    const cls = past ? 'is-past' : i === next ? 'is-next' : '';
    return `<li class="${cls}">
      <span class="hm-time">${esc(s.slot || prettyTime(s.start))}</span>
      <span class="hm-guides">${s.guides.slice().sort().map(g => `<span>${esc(g)}</span>`).join('')}</span>
    </li>`;
  }).join('')}</ol>`;
  const line = $('[data-line="schedule"]');
  if (line) line.textContent = `${slots.length} tour${slots.length === 1 ? '' : 's'} today`;
}

/* ------------------------------------------------------------- active now */
function paintPresence(snap) {
  const box = $('#hm-active');
  if (!box) return;
  if (!snap) { box.innerHTML = '<p class="hm-quiet">Checking who is around…</p>'; return; }
  if (snap.error) { box.innerHTML = '<p class="hm-quiet">Could not load who is active. Retrying automatically.</p>'; return; }
  const users = snap.users || [];
  $('#hm-active-n').textContent = users.length ? String(users.length) : '';
  box.innerHTML = users.length
    ? `<ul class="hm-people">${users.slice(0, 12).map(u => `<li title="${esc(u.full_name)}">
        <span class="hm-av">${esc(initials(u.full_name))}</span>
        <span>${esc(u.full_name)}${u.member_id === state.me?.id ? ' <em>(you)</em>' : ''}</span></li>`).join('')}</ul>` +
      (users.length > 12 ? `<p class="hm-quiet">and ${users.length - 12} more</p>` : '')
    : '<p class="hm-quiet">Nobody else is on right now.</p>';
}

/* ---------------------------------------------------------------- greeting */
function dayPart() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function vanessaLine(items) {
  if (!items.length) return 'Nothing is waiting on you right now. Pick a tool, or ask me anything about the hub.';
  const total = items.reduce((n, i) => n + i.n, 0);
  const top = items[0];
  return items.length === 1
    ? `One thing needs a look: ${top.what.toLowerCase()}.`
    : `${items.length} things are waiting — ${total} item${total === 1 ? '' : 's'} in all. The most pressing: ${top.what.toLowerCase()}.`;
}

function shell() {
  const first = myName().split(' ')[0] || 'there';
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const role = state.role?.name || '';
  const chips = vanessaSuggestions();
  return `
  <section class="hm-hero">
    <div class="hm-hero-glow" aria-hidden="true"></div>
    <div class="hm-orb" aria-hidden="true"><span class="orb orb-lg"><i></i></span></div>
    <div class="hm-hero-body">
      <p class="hm-eyebrow"><span>${esc(dayPart())}</span><span>${esc(date)}</span>${termLabel() ? `<span>${esc(termLabel())}</span>` : ''}${role ? `<span>${esc(role)}</span>` : ''}</p>
      <h1 class="hm-title">Hi, ${esc(first)}. <em>What are we working on today?</em></h1>
      <p class="hm-says" id="hm-says"><span class="skel" style="display:inline-block;width:min(420px,70%);height:1em;vertical-align:middle"></span></p>
      <form class="hm-ask" id="hm-ask">
        <span class="hm-ask-ico">${ICONS.spark}</span>
        <input id="hm-ask-input" autocomplete="off" aria-label="Ask Vanessa" placeholder="Ask Vanessa anything about the hub…">
        <button class="btn btn-primary btn-sm" type="submit">Ask ${ICONS.send}</button>
      </form>
      <div class="hm-chips">${chips.map(q => `<button type="button" class="hm-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>
  </section>

  <section class="hm-section">
    <header class="hm-head"><h2>Your tools</h2><p>Everything your role can open. Tap one to go straight there.</p></header>
    <div id="hm-tools" class="hm-tools"><div class="hm-featured hm-cols-2"><div class="skel" style="height:132px"></div><div class="skel" style="height:132px"></div></div></div>
  </section>

  <div class="hm-split">
    <section class="hm-card hm-attn">
      <header class="hm-card-head"><span class="hm-card-ico">${ICONS.spark}</span><h3>Waiting on you</h3><span class="hm-card-n" id="hm-attn-n"></span></header>
      <div id="td-list"><div class="skel" style="height:58px;margin-bottom:8px"></div><div class="skel" style="height:58px"></div></div>
    </section>
    <div class="hm-side">
      <section class="hm-card">
        <header class="hm-card-head"><span class="hm-card-ico">${ICONS.clock}</span><h3>On tour today</h3></header>
        <div id="hm-tours"><div class="skel" style="height:40px"></div></div>
      </section>
      <section class="hm-card">
        <header class="hm-card-head"><span class="hm-card-ico hm-live">${ICONS.users}</span><h3>Active now</h3><span class="hm-card-n" id="hm-active-n"></span></header>
        <div id="hm-active"></div>
      </section>
    </div>
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
      if (!q) return ask('');
      input.value = '';
      ask(q);
    });
    view.querySelector('.hm-chips').addEventListener('click', e => {
      const chip = e.target.closest('[data-ask]');
      if (chip) ask(chip.dataset.ask);
    });

    paintPresence(presenceSnapshot());
    onPresence = e => paintPresence(e.detail);
    document.addEventListener('hub:presence', onPresence);

    // The launcher paints at once from what is already known, then again
    // once the roster and interviews have arrived with their counts.
    paintLauncher([]);
    const tours = loadToursToday().then(paintTours);

    await Promise.allSettled([
      inTraining() && !state.guides.length ? loadRoster() : null,
      inRecruitment() ? interviews.prefetch?.() : null
    ]);
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    const items = gather();
    const gaps = inTraining() ? await deskGaps() : null;
    if (gaps) items.push({ n: gaps, what: 'Uncovered desk slots this week',
                           why: 'Nobody is down for these', go: 'desks' });
    if (!view.isConnected || document.body.dataset.route !== 'today') return;

    $('#hm-says').textContent = vanessaLine(items);
    $('#hm-attn-n').textContent = items.length ? String(items.length) : '';
    paintLauncher(items);
    tours.then(() => { if (view.isConnected) paintTours(); });

    $('#td-list').innerHTML = items.length
      ? items.map(i => `
          <button class="td-row hm-row ${i.tone === 'warn' ? 'is-warn' : ''}" data-go="${esc(i.go)}">
            <span class="td-n">${i.n}</span>
            <span class="td-what"><b>${esc(i.what)}</b><em>${esc(i.why)}</em></span>
            <span class="td-go">${ICONS.arrow}</span>
          </button>`).join('')
      : `<div class="hm-clear"><span class="hm-clear-mark">${ICONS.check}</span>
         <p><b>All clear.</b> Nothing needs you right now.</p></div>`;

    /* Admin only: this names who changed what, which is oversight rather than
       something a committee member needs on their landing screen. */
    if (isAdmin()) {
      const box = document.createElement('div');
      box.id = 'td-changes';
      box.hidden = true;
      view.querySelector('.hm-split').after(box);
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

    $('#td-list').addEventListener('click', e => {
      const row = e.target.closest('[data-go]');
      if (row) go(row.dataset.go);
    });
  }
};
