/* ============================================================ Action Center
   One answer to "what needs this person right now?", computed from data the
   hub already loads, and shared by everything that wants to say so:

     Home          the "Needs attention" and "Upcoming" sections
     the bell      the badge in the top bar and its panel
     the Actions   the full list, including what has been dismissed
     page
     Vanessa       "what needs my attention?" (see getActions())

   There is deliberately no table of tasks. Every item is derived: an eval
   that is overdue is overdue because the tracker says so, and it disappears
   when the tracker changes, not when somebody remembers to tick it off. The
   only thing stored is what a person has chosen to dismiss (action_states,
   their own rows only).

   Item shape
     id        stable key, e.g. "eval-undated:3". Include the count when the
               item is a tally, so a dismissed "3 unclaimed" comes back as
               "5 unclaimed" rather than staying hidden.
     title     what it is, short
     detail    why it matters / who
     level     urgent | action | upcoming | info   (see LEVELS)
     source    which part of the hub it came from
     due       ISO date when there is one
     at        when it was raised, if known
     url       where the fix is: "#/evals"
     dismissible  may the person hide it?
   Items a role cannot act on are never produced for that role.
============================================================================ */
import { state, inTraining, inRecruitment, isAdmin, setting } from './state.js';
import { select, upsert, remove, rpc } from './db.js';
import { loadDesks } from './sheets.js';
import { todayISO, prettyDate, prettyTime } from './ui.js';
import { loadRoster } from '../modules/evals.js';
import { interviewData } from '../modules/interviews.js';
import { latestAnnouncements } from '../modules/announcements.js';
import training, { owedBy } from '../modules/training.js';

/** Restrained urgency: only the first two count toward the badge. */
export const LEVELS = {
  urgent:   { label: 'Urgent',       rank: 0, badge: true  },
  action:   { label: 'Needs action', rank: 1, badge: true  },
  upcoming: { label: 'Upcoming',     rank: 2, badge: false },
  info:     { label: 'For your information', rank: 3, badge: false }
};

let items = [];              // everything computed, before dismissals
let states = new Map();      // key -> { state, until }
let computedAt = 0;
let inflight = null;

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const isoPlus = d => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const when = (date, time) => [prettyDate(date), time ? prettyTime(time) : ''].filter(Boolean).join(' · ');

/* ---------------------------------------------------------------- sources */

function evalItems(out) {
  const guides = state.guides || [];
  if (!inTraining() || !guides.length) return;      // evaluations are the training committee's, whatever is in memory
  const me = state.me?.id, today = todayISO();
  const horizon = isoPlus(Number(setting('actions.horizonDays', 7)));
  const mine = guides.filter(g => g.evaluatorId === me && g.status === 'claimed');

  const undated = mine.filter(g => !g.date);
  if (undated.length) out.push({ id: `eval-undated:${undated.length}`, level: 'action', source: 'Evaluations', url: '#/evals',
    title: `${plural(undated.length, 'evaluation')} need a tour date`,
    detail: undated.slice(0, 3).map(g => g.name).join(', ') + (undated.length > 3 ? '…' : '') });

  for (const g of mine.filter(g => g.date)) {
    const overdue = g.date < today;
    if (!overdue && g.date > horizon) continue;
    out.push({ id: `eval:${g.id}:${g.date}`, source: 'Evaluations', url: '#/evals', due: g.date, dismissible: !overdue,
      level: overdue ? 'urgent' : g.date === today ? 'action' : 'upcoming',
      title: overdue ? `Overdue: evaluation for ${g.name}` : `Evaluate ${g.name}`,
      detail: overdue ? `The tour was ${prettyDate(g.date)}. Submit it, or release the guide.` : when(g.date, g.time) });
  }

  const rank = Number(setting('actions.urgentPriorityRank', 2));
  const urgent = guides.filter(g => g.status === 'open' && g.rank <= rank);
  if (urgent.length) out.push({ id: `eval-unclaimed:${urgent.length}`, level: 'action', source: 'Evaluations', url: '#/evals', dismissible: true,
    title: `${plural(urgent.length, 'guide')} at top priority ${urgent.length === 1 ? 'has' : 'have'} no evaluator`,
    detail: 'Nobody has picked these up yet.' });

  if (isAdmin()) {
    const waiting = guides.filter(g => g.status === 'submitted');
    if (waiting.length) out.push({ id: `eval-review:${waiting.length}`, level: 'action', source: 'Evaluations', url: '#/evals', dismissible: true,
      title: `${plural(waiting.length, 'submitted evaluation')} to review`, detail: 'Only codirectors see these.' });
    const late = guides.filter(g => g.status === 'claimed' && g.evaluatorId !== me && g.date && g.date < today);
    if (late.length) out.push({ id: `eval-late:${late.length}`, level: 'urgent', source: 'Evaluations', url: '#/evals',
      title: `${plural(late.length, 'evaluation')} overdue across the committee`,
      detail: late.slice(0, 3).map(g => `${g.name} (${g.evaluator || 'unassigned'})`).join(', ') + (late.length > 3 ? '…' : '') });
  }
}

function interviewItems(out) {
  const cands = interviewData()?.candidates;
  if (!inRecruitment() || !cands?.length) return;
  const mineName = state.me?.full_name;
  const unscored = cands.filter(c => c.checkin === 'Yes' && !c.scores?.[mineName]);
  if (unscored.length) out.push({ id: `iv-unscored:${unscored.length}`, level: 'urgent', source: 'Interviews', url: '#/interviews',
    title: `${plural(unscored.length, 'checked-in candidate')} you have not scored`, detail: 'They are here and waiting on you.' });
  const undecided = cands.filter(c => c.raters > 0 && !c.decision);
  if (undecided.length) out.push({ id: `iv-undecided:${undecided.length}`, level: 'action', source: 'Interviews', url: '#/interviews', dismissible: true,
    title: `${plural(undecided.length, 'scored candidate')} with no decision`, detail: 'Yes, maybe or no is still to be recorded.' });
}

async function deskItems(out) {
  if (!inTraining()) return;
  try {
    const rows = await loadDesks();
    if (!rows.length) return;
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    let gaps = 0;
    for (const k of new Set(rows.map(r => `${r.desk}|${r.slot}`))) {
      const [desk, slot] = k.split('|');
      DAYS.forEach(d => { if (!rows.some(r => r.desk === desk && r.slot === slot && r.day === d)) gaps++; });
    }
    if (gaps) out.push({ id: `desk-gaps:${gaps}`, level: 'action', source: 'Desk coverage', url: '#/desks', dismissible: true,
      title: `${plural(gaps, 'desk slot')} uncovered this week`, detail: 'Nobody is down for these.' });
  } catch { /* the workbook is unreachable; Desk Coverage says so itself */ }
}

async function announcementItems(out) {
  try {
    const rows = await latestAnnouncements(10);
    const fresh = rows.filter(a => a.unread);
    for (const a of fresh.filter(a => a.pinned)) out.push({ id: `ann:${a.id}`, level: 'action', source: 'Announcements', url: '#/announcements',
      at: a.at, title: `Pinned: ${a.title}`, detail: 'Read this one, then it clears.', dismissible: true });
    const rest = fresh.filter(a => !a.pinned);
    if (rest.length) out.push({ id: `ann-new:${rest.length}`, level: 'info', source: 'Announcements', url: '#/announcements', dismissible: true,
      at: rest[0].at, title: `${plural(rest.length, 'new announcement')}`, detail: rest[0].title });
  } catch { /* not essential */ }
}

/* ---------------------------------------------------------------- training
   From the training tables, not from a second set of rules: administrators see
   what needs running (attendance not in, missing room or speaker, makeups,
   deadlines); a Tour Guide linked to an account sees only their own (a makeup
   they owe, a deadline, a session tomorrow). Timing is deliberately sparing:
   a session shows from two days out, a deadline from two weeks. */
const dayDiff = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 864e5);

async function trainingItems(out) {
  let usedNew = false;
  if (isAdmin()) {
    try {
      const ov = await rpc('training_overview');
      if (ov?.requirements?.length || ov?.upcoming?.length) usedNew = true;
      for (const a of ov?.attention || []) {
        if (a.kind === 'attendance_missing') out.push({ id: `tr-att:${a.session_id}`, level: 'action', source: 'Training', url: `#/trainhub?tab=attendance&session=${a.session_id}`, due: a.date, dismissible: true,
          title: `Attendance has not been entered for ${a.title}`, detail: `It was ${prettyDate(a.date)}. Mark who came so completion updates.` });
        if (a.kind === 'no_location') out.push({ id: `tr-loc:${a.session_id}`, level: dayDiff(a.date) <= 0 ? 'urgent' : 'action', source: 'Training', url: `#/trainhub?tab=sessions&open=${a.session_id}`, due: a.date,
          title: dayDiff(a.date) <= 0 ? `${a.title} is today and has no room assigned` : `${a.title} has no room or link yet`, detail: prettyDate(a.date) });
        if (a.kind === 'no_speaker') out.push({ id: `tr-spk:${a.session_id}`, level: 'action', source: 'Training', url: `#/trainhub?tab=sessions&open=${a.session_id}`, due: a.date, dismissible: true,
          title: `${a.title} has no speaker assigned`, detail: prettyDate(a.date) });
        if (a.kind === 'no_sessions') out.push({ id: `tr-nosess:${a.requirement_id}`, level: 'action', source: 'Training', url: '#/trainhub?tab=requirements', dismissible: true,
          title: `${a.title} has no sessions scheduled`, detail: 'People cannot complete it until a session is approved.' });
      }
      const makeup = (ov?.requirements || []).reduce((n, r) => n + (r.makeup_needed || 0), 0);
      if (makeup) out.push({ id: `tr-makeup:${makeup}`, level: 'action', source: 'Training', url: '#/trainhub?tab=people&filter=makeup', dismissible: true,
        title: `${plural(makeup, 'person', 'people')} need${makeup === 1 ? 's' : ''} a makeup`, detail: 'Assign them to a session or mark them excused.' });
      for (const r of ov?.requirements || []) {
        const left = r.total - r.complete - r.waived - r.excused;
        if (r.deadline && left > 0 && dayDiff(r.deadline) <= 14) out.push({ id: `tr-due:${r.id}:${left}`, level: dayDiff(r.deadline) < 0 ? 'urgent' : 'upcoming', source: 'Training', url: `#/trainhub?tab=people&req=${r.id}`, due: r.deadline, dismissible: dayDiff(r.deadline) >= 0,
          title: `${r.name}: ${plural(left, 'person', 'people')} not done`, detail: dayDiff(r.deadline) < 0 ? `Was due ${prettyDate(r.deadline)}.` : `Due ${prettyDate(r.deadline)}.` });
      }
    } catch { /* the training tools are not installed yet; the older makeups item below covers it */ }
  }
  /* A Tour Guide's own, whoever else they are. */
  try {
    const my = await rpc('my_training');
    if (my?.linked) {
      for (const r of my.requirements || []) {
        if (r.state === 'makeup_needed') out.push({ id: `my-makeup:${r.requirement_id}`, level: 'action', source: 'Training', url: '#/trainhub?tab=my',
          title: `You missed ${r.name} and need a makeup`, detail: r.upcoming?.[0] ? `Next chance: ${prettyDate(r.upcoming[0].held_on)}.` : 'Ask a codirector when the next makeup is.' });
        else if (!['complete', 'waived', 'excused'].includes(r.state) && r.deadline && dayDiff(r.deadline) <= 14)
          out.push({ id: `my-due:${r.requirement_id}`, level: dayDiff(r.deadline) < 0 ? 'urgent' : 'action', source: 'Training', url: '#/trainhub?tab=my', due: r.deadline, dismissible: dayDiff(r.deadline) >= 0,
            title: `${r.name} must be completed by ${prettyDate(r.deadline)}`, detail: r.state === 'scheduled' ? `You are signed up for ${prettyDate(r.next_on)}.` : 'Check the sessions below it on your Training page.' });
        const next = (r.upcoming || [])[0];
        if (next && r.state === 'scheduled' && dayDiff(next.held_on) >= 0 && dayDiff(next.held_on) <= 2)
          out.push({ id: `my-soon:${next.id}`, level: 'upcoming', source: 'Training', url: '#/trainhub?tab=my', due: next.held_on, dismissible: true,
            title: `${next.title} is ${dayDiff(next.held_on) === 0 ? 'today' : dayDiff(next.held_on) === 1 ? 'tomorrow' : 'in 2 days'}${next.start_time ? ' at ' + prettyTime(next.start_time.slice(0, 5)) : ''}`, detail: next.location || '' });
      }
    }
  } catch { /* not linked, or not installed */ }
  return usedNew;
}

async function adminItems(out) {
  if (!isAdmin()) return;

  const newTraining = out._trainingNew;
  try { if (!newTraining) await training.prefetch?.(); } catch { /* training may not be set up */ }
  const owed = newTraining ? null : owedBy();
  if (owed?.size) out.push({ id: `makeups:${owed.size}`, level: 'action', source: 'Training', url: '#/training', dismissible: true,
    title: `${plural(owed.size, 'person', 'people')} owe${owed.size === 1 ? 's' : ''} a makeup`, detail: 'Open Training to record or remind.' });

  let h = null;
  try { h = await rpc('admin_health'); }
  catch (e) {
    if (/could not find|does not exist|schema cache|function/i.test(e.message || '')) {
      out.push({ id: 'setup-missing', level: 'urgent', source: 'Setup', url: '#/health',
        title: 'One-time admin setup has not been run', detail: 'A developer needs to run supabase/18-admin-operations.sql once. Open Health for details.' });
    }
    return;
  }
  if (!h) return;
  if (!h.current_term) out.push({ id: 'no-term', level: 'urgent', source: 'Semester', url: '#/semester',
    title: 'No current semester is set', detail: 'Create or start one so the tracker and training know which term this is.' });
  else {
    const ends = h.current_term.ends_on, warn = Number(setting('actions.semesterWarningDays', 14));
    if (!ends) out.push({ id: `term-dates:${h.current_term.id}`, level: 'info', source: 'Semester', url: '#/semester', dismissible: true,
      title: `${h.current_term.label} has no dates`, detail: 'Add start and end dates so the hub can remind you when the semester is ending.' });
    else if (ends <= isoPlus(warn)) out.push({ id: `term-ending:${h.current_term.id}`, level: ends < todayISO() ? 'urgent' : 'action', source: 'Semester', url: '#/semester', due: ends,
      title: ends < todayISO() ? `${h.current_term.label} ended ${prettyDate(ends)}` : `${h.current_term.label} ends ${prettyDate(ends)}`,
      detail: 'Start the next semester when you are ready: returning guides, leavers, training dates.' });
  }
  if (h.people_bad_role) out.push({ id: `bad-role:${h.people_bad_role}`, level: 'urgent', source: 'People', url: '#/people',
    title: `${plural(h.people_bad_role, 'person', 'people')} ha${h.people_bad_role === 1 ? 's' : 've'} an unrecognised role`, detail: 'They cannot see anything until a valid role is chosen.' });
  if (h.pending_signups) out.push({ id: `signups:${h.pending_signups}`, level: 'action', source: 'People', url: '#/people?show=waiting', dismissible: true,
    title: `${plural(h.pending_signups, 'account')} ${h.pending_signups === 1 ? 'has' : 'have'} signed up without an invitation`, detail: 'They see an empty hub. Add them if they belong.' });
  if (h.guides_missing_eval) out.push({ id: `no-eval:${h.guides_missing_eval}`, level: 'action', source: 'Guides', url: '#/guides',
    title: `${plural(h.guides_missing_eval, 'guide')} missing from this semester's tracker`, detail: 'Archive them, or they will not be evaluated.' });
  if (h.evals_for_archived_guides) out.push({ id: `arch-claim:${h.evals_for_archived_guides}`, level: 'action', source: 'Evaluations', url: '#/evals',
    title: `${plural(h.evals_for_archived_guides, 'evaluation')} claimed for an archived guide`, detail: 'Release or restore the guide.' });
  if (h.sources_failing) out.push({ id: `sources-failing:${h.sources_failing}`, level: 'urgent', source: 'Data Sources', url: '#/sources',
    title: `${plural(h.sources_failing, 'connected spreadsheet')} could not be read`, detail: 'Check the sheet is still shared, then sync again.' });
  if (h.open_issues) out.push({ id: `recon:${h.open_issues}`, level: 'action', source: 'Reconciliation', url: '#/reconcile', dismissible: true,
    title: `${plural(h.open_issues, 'roster item')} need${h.open_issues === 1 ? 's' : ''} a decision`, detail: 'People not matched, missing from a sheet, or conflicting. Nothing changes until you choose.' });
  if (h.sources_connected === 0) out.push({ id: 'no-sources', level: 'info', source: 'Data Sources', url: '#/sources', dismissible: true,
    title: 'No spreadsheets are connected', detail: 'Connect the tour schedule and the Tour Guides by Major sheet so the Hub keeps the roster and schedule in step.' });
  if (h.admins < 2) out.push({ id: 'one-admin', level: 'info', source: 'People', url: '#/people', dismissible: true,
    title: 'Only one administrator', detail: 'Give a second person the Codirector role so the hub is never locked out.' });
}

/* ------------------------------------------------------------- the engine */

async function compute() {
  const out = [];
  if (inTraining() && !state.guides?.length) { try { await loadRoster(); } catch { /* shown on its own page */ } }
  evalItems(out);
  interviewItems(out);
  out._trainingNew = await trainingItems(out);
  await Promise.all([deskItems(out), announcementItems(out), adminItems(out)]);
  delete out._trainingNew;

  try {
    const rows = await select('action_states', 'select=key,state,until');
    states = new Map((rows || []).map(r => [r.key, r]));
  } catch { states = new Map(); }       // table not created yet: nothing is dismissible, everything shows

  items = out;
  computedAt = Date.now();
  document.dispatchEvent(new CustomEvent('hub:actions'));
  return items;
}

/** Recompute (at most once a minute unless forced). Safe to call from anywhere. */
export function refreshActions({ force = false } = {}) {
  if (!state.me) return Promise.resolve([]);
  if (inflight) return inflight;
  if (!force && Date.now() - computedAt < 60_000) return Promise.resolve(items);
  const version = state.sessionVersion;
  inflight = compute().catch(() => items).finally(() => { inflight = null; });
  return inflight.then(r => (version === state.sessionVersion ? r : []));
}

export function resetActions() { items = []; states = new Map(); computedAt = 0; inflight = null; }

const hidden = it => {
  const s = states.get(it.id);
  return !!s && (!s.until || new Date(s.until) > new Date());
};

/** Items to show, most pressing first. `all` includes dismissed ones. */
export function getActions({ all = false } = {}) {
  return items
    .filter(it => all || !hidden(it))
    .map(it => ({ ...it, dismissed: hidden(it) }))
    .sort((a, b) => LEVELS[a.level].rank - LEVELS[b.level].rank || String(a.due || '9').localeCompare(String(b.due || '9')));
}

export const actionBadge = () => getActions().filter(a => LEVELS[a.level].badge).length;

export async function dismissAction(id) {
  states.set(id, { state: 'dismissed', until: null });
  document.dispatchEvent(new CustomEvent('hub:actions'));
  try { await upsert('action_states', [{ key: id, state: 'dismissed' }], 'user_id,key'); } catch { /* it simply returns next visit */ }
}

export async function restoreAction(id) {
  states.delete(id);
  document.dispatchEvent(new CustomEvent('hub:actions'));
  try { await remove('action_states', `key=eq.${encodeURIComponent(id)}`); } catch { /* ignore */ }
}
