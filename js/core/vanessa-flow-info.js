/* ============================================================ information workflows
   Tours, people, attendance, who is active, and "what do I do here?" —
   answered as cards with a next step, never a paragraph and a dead end.

   Every fact comes from vanessa-facts.js (loaded data, with its source);
   when something is not loaded, the card says so instead of guessing. Every
   button is a registry action or a module's own function, and a tool this
   account cannot open never appears as a button at all.
============================================================================ */
import { state, isAdmin, inTraining } from './state.js';
import { canRun, TOOL_INFO, resolveActions } from './vanessa-context.js';
import { rememberFocus, recallFocus } from './vanessa-memory.js';
import * as facts from './vanessa-facts.js';
import { NO, first, context, openAction, performAction, denied, go, toolTitle } from './vanessa-exec.js';
import { prettyTime, prettyDate, todayISO } from './ui.js';
import { setJumpTarget } from './quicksearch.js';
import { markMakeupDone } from '../modules/training.js';
import { explainError } from './vanessa-errors.js';
import { startEvaluation } from './vanessa-flow-eval.js';

const dayLabel = d => d === todayISO() ? 'today' : prettyDate(d);
const rangeLabel = day => !day ? 'today' : day.from === day.to ? dayLabel(day.from) : `${prettyDate(day.from)} – ${prettyDate(day.to)}`;
const missing = (r, retry) => ({ type: 'reply', kind: 'alert',
  text: r.reason === 'denied' ? NO : `I couldn’t load ${r.what || 'that'} just now, so I can’t answer from it. I won’t guess.`, retry: r.reason === 'denied' ? null : retry });
const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;

/* ------------------------------------------------------------ tours */
export async function showTours(u) {
  const day = u.day || { from: todayISO(), to: todayISO() };
  const r = await facts.tours(day.from, day.to);
  if (!r.ok) return missing(r, () => showTours(u));
  const multi = day.from !== day.to;
  if (!r.slots.length) {
    return { type: 'summary', title: `Tours · ${rangeLabel(day)}`, text: `Nothing is on the schedule for ${rangeLabel(day)}.`, source: r.source, at: r.at,
      actions: [go('schedule', 'Open the Tour Schedule')].filter(Boolean) };
  }
  const items = r.slots.map(s => ({
    label: `${multi ? prettyDate(s.date) + ' · ' : ''}${s.start ? prettyTime(s.start) : s.slot}`,
    sub: s.guides.join(', '), kind: 'tour', entity: s, run: () => slotCard(s)
  }));
  const guides = r.slots.reduce((k, s) => k + s.guides.length, 0);
  return { type: 'summary', title: `Tours · ${rangeLabel(day)}`, source: r.source, at: r.at,
    text: `${n(r.slots.length, 'tour slot')}, ${n(guides, 'guide')} leading.`, items: items.slice(0, 10),
    more: items.length > 10 ? `…and ${items.length - 10} more on the schedule.` : '',
    actions: [go('schedule', 'Open the Tour Schedule'),
      inTraining() && r.slots.some(s => facts.guidesInSlot(s).some(g => g.status === 'open' || (g.evaluatorId === state.me?.id && g.status === 'claimed')))
        ? { label: 'Evaluate one of these', run: () => startEvaluation({ day }) } : null].filter(Boolean) };
}

/** One tour slot: who leads it and, where visible, who is evaluating. */
function slotCard(s) {
  rememberFocus({ kind: 'tour', label: `${prettyTime(s.start)} tour`, entity: s, run: () => slotCard(s) });
  const rows = [['Leading', s.guides.join(', ')], ['When', `${dayLabel(s.date)}${s.start ? ` · ${prettyTime(s.start)}` : ''}${s.slot ? ` (${s.slot})` : ''}`]];
  const roster = facts.guidesInSlot(s);
  const evaluated = roster.filter(g => g.evaluator && g.date === s.date && g.time === s.start);
  if (inTraining()) rows.push(['Evaluations', evaluated.length ? evaluated.map(g => `${g.evaluatorId === state.me?.id ? 'You' : g.evaluator} → ${first(g.name)}`).join(', ') : 'Nobody is evaluating this tour']);
  const mine = roster.filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed');
  const open = roster.filter(g => g.status === 'open' && !g.skip);
  return { type: 'summary', title: `${s.start ? prettyTime(s.start) : s.slot} tour · ${dayLabel(s.date)}`, rows, source: facts.SOURCE.tours,
    actions: [(mine.length || open.length) && inTraining() ? { label: 'Evaluate this tour', run: () => startEvaluation({ day: { from: s.date, to: s.date }, time: s.start }) } : null,
      go('schedule', 'View on the schedule')].filter(Boolean) };
}

export async function showSlot(u) {
  const day = u.day || { from: todayISO(), to: todayISO() };
  const r = await facts.tours(day.from, day.to);
  if (!r.ok) return missing(r, () => showSlot(u));
  const hits = r.slots.filter(s => s.start === u.time);
  if (!hits.length) {
    const near = r.slots.slice(0, 6);
    return { type: 'summary', title: `${prettyTime(u.time)} · ${rangeLabel(day)}`, source: r.source,
      text: `There’s no ${prettyTime(u.time)} tour on the schedule for ${rangeLabel(day)}.${near.length ? ' These are:' : ''}`,
      items: near.map(s => ({ label: prettyTime(s.start), sub: s.guides.join(', '), kind: 'tour', entity: s, run: () => slotCard(s) })),
      actions: [go('schedule', 'Open the Tour Schedule')].filter(Boolean) };
  }
  return slotCard(hits[0]);
}

export async function myNextTour() {
  const r = await facts.myUpcoming();
  const ev = r.evals[0], lead = r.leading[0];
  const rows = [], actions = [];
  if (ev) rows.push(['Your next evaluation', `${first(ev.name)}’s tour · ${dayLabel(ev.date)}${ev.time ? ` at ${prettyTime(ev.time)}` : ''}`]);
  if (lead) rows.push(['You’re leading', `${dayLabel(lead.date)}${lead.start ? ` at ${prettyTime(lead.start)}` : ''}`]);
  if (ev) actions.push({ label: `Start ${first(ev.name)}’s evaluation`, run: () => startEvaluation({ names: [ev.name.split(' ')[0], ev.name.split(' ').at(-1)] }) });
  if (lead) actions.push({ label: 'View tour', run: () => slotCard(lead) });
  actions.push(go('today', 'Open Today'));
  if (!rows.length) {
    return { type: 'reply', text: r.toursMissing && !inTraining() ? 'I couldn’t load the tour schedule, so I can’t see your next tour. I won’t guess.'
      : 'I can’t find an upcoming tour for you in what’s loaded — no evaluation with a date, and I don’t see you on the tour schedule.',
      actions: [go('schedule', 'Open the Tour Schedule')].filter(Boolean) };
  }
  const soonest = [ev && { d: ev.date, t: ev.time }, lead && { d: lead.date, t: lead.start }].filter(Boolean).sort((a, b) => a.d.localeCompare(b.d) || (a.t || '').localeCompare(b.t || ''))[0];
  return { type: 'summary', title: 'Coming up for you', source: r.source.join(' · '),
    text: `Your next tour is ${dayLabel(soonest.d)}${soonest.t ? ` at ${prettyTime(soonest.t)}` : ''}.`, rows, actions: actions.filter(Boolean) };
}

/* "Who is evaluating today / the 1:30 / Blake?" */
export async function whoEvaluating(u) {
  if (!inTraining()) return denied();
  const day = u.day || (u.names.length ? null : { from: todayISO(), to: todayISO() });
  const r = await facts.evaluations({ date: day?.from || null, time: u.time, names: u.names });
  if (!r.ok) return missing(r, () => whoEvaluating(u));
  const label = u.names.length ? u.names.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : `${u.time ? prettyTime(u.time) + ' · ' : ''}${rangeLabel(day)}`;
  if (!r.items.length) {
    return { type: 'reply', text: u.names.length ? `I don’t see anyone evaluating ${label} yet.` : `Nobody has an evaluation scheduled for ${label}.`,
      actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
  }
  return { type: 'summary', title: `Evaluations · ${label}`, source: r.source,
    items: r.items.slice(0, 10).map(g => ({ label: `${g.evaluatorId === state.me?.id ? 'You' : g.evaluator} → ${g.name}`,
      sub: [g.date ? dayLabel(g.date) : 'no date yet', g.time ? prettyTime(g.time) : '', g.status === 'claimed' ? '' : g.status].filter(Boolean).join(' · '),
      kind: 'guide', entity: g, run: () => personCard({ kind: 'guide', name: g.name, g }) })),
    actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
}

/* ------------------------------------------------------------ people */
export async function findPersonFlow(u, { strict = false } = {}) {
  const r = await facts.findPerson(u.names);
  if (!r.ok) return missing(r, () => findPersonFlow(u, { strict }));
  if (!r.hits.length) {
    if (strict) return null;                                   // "who is worth discussing" was never a name
    return { type: 'reply', text: `I couldn’t find anyone called “${u.names.join(' ')}” in what I can see.`, actions: [go('directory', 'Open the Guide Directory')].filter(Boolean) };
  }
  if (r.hits.length > 1) {
    return { type: 'select', title: `Which ${u.names[0][0].toUpperCase() + u.names[0].slice(1)} did you mean?`,
      options: r.hits.slice(0, 6).map(h => ({ label: h.name, sub: h.kind === 'guide' ? [h.g.priority, nextTourText(h.g)].filter(Boolean).join(' · ') : `${n(h.slots.length, 'tour')} on the schedule`,
        run: () => personCard(h) })) };
  }
  return personCard(r.hits[0]);
}
const nextTourText = g => { const t = (g.tours || []).find(x => x.date >= todayISO()); return t ? `next tour ${dayLabel(t.date)} ${prettyTime(t.start)}` : ''; };

export function personCard(h) {
  rememberFocus({ kind: 'person', label: h.name, entity: h, run: () => personCard(h) });
  if (h.kind === 'label') {
    return { type: 'summary', title: h.name, source: facts.SOURCE.tours,
      items: h.slots.slice(0, 6).map(s => ({ label: `${dayLabel(s.date)} · ${prettyTime(s.start)}`, sub: 'leading', kind: 'tour', entity: s, run: () => slotCard(s) })),
      text: h.slots.length ? `Upcoming tours on the schedule:` : 'No upcoming tours on the schedule.', actions: [go('schedule', 'Open the Tour Schedule')].filter(Boolean) };
  }
  const g = h.g, rows = [];
  rows.push(['Priority', g.priority || 'Not set']);
  rows.push(['Evaluation', g.skip ? 'Not needed this term' : g.status === 'open' ? 'Not claimed yet'
    : `${g.evaluatorId === state.me?.id ? 'You' : g.evaluator || 'Someone'}${g.status === 'claimed' ? ' — in progress' : g.status === 'reviewed' ? ' — submitted and reviewed' : ' — submitted'}${g.date ? ` · ${dayLabel(g.date)}${g.time ? ' ' + prettyTime(g.time) : ''}` : ''}`]);
  const next = (g.tours || []).filter(t => t.date >= todayISO()).slice(0, 3);
  rows.push(['Next tours', state.guideToursLoaded === false ? 'Schedule not loaded' : next.length ? next.map(t => `${dayLabel(t.date)} ${prettyTime(t.start)}`).join(', ') : 'None on the schedule']);
  const actions = [];
  if (g.evaluatorId === state.me?.id && g.status === 'claimed') actions.push({ label: `Evaluate ${first(g.name)}`, run: () => startEvaluation({ names: g.name.toLowerCase().split(/\s+/) }) });
  if (g.status === 'open' && !g.skip) actions.push({ label: `Claim ${first(g.name)}`, run: () => startEvaluation({ names: g.name.toLowerCase().split(/\s+/) }) });
  const dir = openAction('directory');
  if (canRun(dir)) actions.push({ label: 'Open in Directory', run: () => { setJumpTarget(g.name); return performAction(dir); } });
  if (isAdmin()) actions.push({ label: 'Check attendance', run: () => personAttendance({ names: g.name.toLowerCase().split(/\s+/), raw: g.name }) });
  return { type: 'summary', title: g.name, rows, source: facts.SOURCE.roster, actions };
}

/* ------------------------------------------------------------ active */
export function showActive() {
  const r = facts.active();
  if (!r.ok) return { type: 'reply', kind: 'alert', text: r.reason === 'error' ? 'I can’t see who is active right now — it retries on its own every half minute.' : 'Active users haven’t loaded yet. Give it a moment.' };
  const others = r.users.filter(x => x.member_id !== state.me?.id);
  if (!others.length) return { type: 'reply', text: 'Just you right now.', source: r.source };
  return { type: 'summary', title: 'Active now', source: r.source, text: `${n(r.users.length, 'person', 'people')} on the hub right now:`,
    steps: r.users.map(x => x.member_id === state.me?.id ? `${x.full_name} (you)` : x.full_name), plain: true };
}

/* ------------------------------------------------------------ attendance (codirectors) */
const trainingAllowed = () => isAdmin() && canRun(openAction('training'));

export async function attendance(u) {
  if (!trainingAllowed()) return denied();
  if (u.sub === 'form') return performAction(openAction('training'), { params: { tab: 'absences', say: 'Opening the absence form responses.' } });
  if (u.sub === 'person') return personAttendance(u);
  const t = await facts.training();
  if (!t.ok) return missing(t, () => attendance(u));
  const date = u.day?.from || todayISO();
  const { exact, latest } = facts.sessionOn(t, date);
  if (u.sub === 'absent') {
    const s = exact || latest;
    if (!s) return { type: 'reply', text: 'No training session has happened yet this term.' };
    const absent = facts.absentAt(t, s);
    const lead = exact ? '' : `There was no training session ${dayLabel(date)}. The most recent was ${s.label} (${prettyDate(s.held_on)}). `;
    return { type: 'summary', title: `Absent · ${s.label}`, source: t.source, at: t.at,
      text: `${lead}${absent.length ? `${n(absent.length, 'person was', 'people were')} marked absent:` : 'Nobody was marked absent.'}`,
      items: absent.slice(0, 12).map(name => ({ label: name, kind: 'person', entity: { name }, run: () => personAttendance({ names: name.toLowerCase().split(/\s+/), raw: name }) })),
      actions: [{ label: `Open ${s.label}`, run: () => performAction(openAction('training'), { params: { session: s.id, say: `Opening attendance for ${s.label}.` } }) }] };
  }
  const say = exact ? `Opening attendance for ${exact.label}.` : u.day ? `There’s no training session ${dayLabel(date)} — opening all attendance.` : 'Opening attendance.';
  return performAction(openAction('training'), { params: { session: exact?.id || null, say } });
}

export async function personAttendance(u) {
  if (!trainingAllowed()) return denied();
  const t = await facts.training();
  if (!t.ok) return missing(t, () => personAttendance(u));
  const hits = facts.attendanceOf(t, u.names);
  if (!hits.length) return { type: 'reply', text: `I couldn’t find “${u.names.join(' ')}” in the training records.`, actions: [go('training', 'Open attendance')].filter(Boolean) };
  if (hits.length > 1) {
    return { type: 'select', title: 'Which person did you mean?', options: hits.slice(0, 6).map(h => ({ label: h.name, sub: `${h.owed ? `${n(h.owed, 'makeup')} owed` : 'nothing owed'}`, run: () => personAttendance({ names: h.name.toLowerCase().split(/\s+/) }) })) };
  }
  const h = hits[0];
  rememberFocus({ kind: 'person', label: h.name, entity: h, run: () => personAttendance({ names: h.name.toLowerCase().split(/\s+/) }) });
  const actions = [];
  if (h.owed) actions.push({ label: 'Mark makeup done', run: () => confirmMakeup(h.name, h.owed) });
  actions.push({ label: 'Open attendance', run: () => performAction(openAction('training'), { params: { tab: h.owed ? 'makeups' : 'attendance', say: 'Opening Training.' } }) });
  return { type: 'summary', title: `${h.name} · training`, source: t.source, at: t.at,
    rows: [['Attended', String(h.attended)], ['Makeups completed', String(h.makeup)], ['Still owed', String(h.owed)], ['Absences filed ahead', String(h.filed)]], actions };
}

/* A write, so a confirmation — then the Training module's own markMakeupDone(). */
function confirmMakeup(name, owed) {
  return { type: 'confirm', title: `Mark ${name}’s makeup as done?`, text: `This records ${n(owed, 'outstanding session')} as a completed makeup.`,
    rows: [['Person', name], ['Sessions', String(owed)]],
    confirm: { label: 'Mark as done', run: async () => {
      if (!trainingAllowed()) return { type: 'reply', kind: 'alert', text: NO };
      try { const k = await markMakeupDone(name); return { type: 'reply', kind: 'confirm', text: `Done — ${name} is marked as having completed ${n(k, 'makeup')}.` }; }
      catch (err) { return { type: 'reply', kind: 'error', text: explainError(err, 'marking the makeup') }; }
    } }, cancel: { label: 'Cancel' } };
}

/* "I need to mark someone": which session, then the grid where it is marked. */
export async function markAttendance() {
  if (!trainingAllowed()) return denied();
  const t = await facts.training();
  if (!t.ok) return missing(t, () => markAttendance());
  const sessions = [...t.sessions].sort((a, b) => (b.held_on || '').localeCompare(a.held_on || '')).slice(0, 5);
  if (!sessions.length) return { type: 'reply', text: 'There are no training sessions set up yet.', actions: [go('training', 'Open Training')].filter(Boolean) };
  return { type: 'select', title: 'Which session are you marking?', text: 'I’ll open its attendance — choose each person’s status in the grid.',
    options: sessions.map(s => ({ label: s.label, sub: s.held_on ? prettyDate(s.held_on) : 'no date', run: () => performAction(openAction('training'), { params: { session: s.id, say: `Opening ${s.label}. Pick each person’s status in the grid.` } }) })) };
}

/* ------------------------------------------------------------ help
   Page-aware: inside a tool, "what do I do here?" is about that tool. */
export function helpHere() {
  const ctx = context();
  const form = ctx.record?.kind === 'eval-form' ? ctx.record : null;
  if (form) {
    return { type: 'summary', kind: 'explain', title: `${form.data.name}’s evaluation`,
      text: 'This is the evaluation form. Give an overall rating from 1 to 5, write what went well and what could improve, then Submit. Your writing is saved on this device as you type.',
      steps: ['Tell me how the tour went in your own words — I’ll draft both boxes for you to approve.'],
      actions: [] };
  }
  const info = TOOL_INFO[ctx.route] || TOOL_INFO.today;
  const acts = resolveActions(ctx.route).filter(a => a.id !== 'home' && a.id !== 'todo' && a.id !== 'wear').slice(0, 3);
  return { type: 'summary', kind: 'explain', title: ctx.route === 'today' ? 'Home' : ctx.module,
    text: info.explain, steps: info.howto || [],
    actions: acts.map(a => ({ label: a.title, run: () => performAction(a) })) };
}

export function explainTool(u) {
  const mod = openAction(u.tool);
  if (!canRun(mod)) return denied();
  const info = TOOL_INFO[u.tool];
  return { type: 'summary', kind: 'explain', title: toolTitle(u.tool), text: info.explain, steps: info.howto || [],
    actions: [u.tool !== context().route ? go(u.tool) : null].filter(Boolean) };
}

/* ------------------------------------------------------------ references
   "open it", "his tour" — only when it is clear what is meant. */
export function resolveRef(u) {
  const r = recallFocus();
  if (!r) return { type: 'reply', text: 'I’m not sure which one you mean — could you name it?' };
  if (r.choices) return { type: 'select', title: 'Which one did you mean?', options: r.choices.slice(0, 6).map(c => ({ label: c.label, sub: c.sub, run: c.run })) };
  const item = r.item;
  if (u.sub === 'ref' || /\btours?\b/.test(u.text)) {
    const g = item.entity?.g;
    if (g) {
      const next = (g.tours || []).filter(t => t.date >= todayISO()).slice(0, 5);
      return next.length ? { type: 'summary', title: `${first(g.name)}’s tours`, source: facts.SOURCE.tours,
        items: next.map(t => ({ label: `${dayLabel(t.date)} · ${prettyTime(t.start)}`, kind: 'tour', entity: t, run: () => slotCard({ ...t, guides: [g.name] }) })) }
        : { type: 'reply', text: `${first(g.name)} has no upcoming tours on the schedule.` };
    }
    if (item.entity?.slots) return personCard(item.entity);
  }
  return item.run ? item.run() : null;
}

