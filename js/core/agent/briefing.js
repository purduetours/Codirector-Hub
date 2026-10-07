/* ============================================================ briefs
   The operations brief, the morning brief, the weekly plan and the training and
   evaluation briefs. Built from the same tools Vanessa answers questions with
   (through ctx.call, which applies the person's permissions), so a brief can
   never show something the person couldn't ask for directly.

   Deliberately not tied to the chat: the app can call buildBrief() on a schedule
   later (a morning notification, an email) and get the same structured result.

   Shape:  { kind, title, sections: [{ title, tone, items: [{ text, level, link? }] }], generated }
   It is short on purpose. Each section carries at most five lines; the most
   actionable come first.
============================================================================ */
import { plural, dayLabel, clock } from './tools/kit.js';

const cap = (list, n = 5) => list.slice(0, n);
const item = (text, level = 'info', link) => ({ text, level, ...(link ? { link } : {}) });
const lk = (ctx, label, page, params) => ({ label, route: ctx.deps.route(page, params) });
const TITLES = { operations: 'Operations brief', morning: 'Morning brief', weekly: 'Weekly plan', training: 'Training brief', evaluation: 'Evaluation brief' };

export async function buildBrief(kind, ctx) {
  const { today } = clock(ctx.now, ctx.tz);
  const w = ctx.who;
  const staff = !!(w.admin || w.training || w.recruitment);
  const memo = new Map();
  const get = (name, args = {}) => { const k = name + JSON.stringify(args); if (!memo.has(k)) memo.set(k, ctx.call(name, args)); return memo.get(k); };
  const none = Promise.resolve(null);

  const sections = [];
  const sec = (title, items, tone) => { if (items.length) sections.push({ title, tone, items: cap(items) }); };

  /* ------------------------------------------------ personal brief */
  const personal = !staff || (kind === 'morning' && !w.admin && !w.training);
  if (personal) {
    const [next, train, ann, act] = await Promise.all([get('get_next_tour', {}), get('get_training_status', {}), get('get_announcements', { limit: 3 }), get('get_action_center', { limit: 5 })]);
    const mine = [];
    if (next?.next_tour) mine.push(item(`Your next tour is ${next.next_tour.when}${next.next_tour.with?.length ? ' with ' + next.next_tour.with.join(', ') : ''}.`, 'info', lk(ctx, 'Open schedule', 'schedule')));
    else if (next && !next.schedule_unavailable) mine.push(item('You have no upcoming tours on the schedule.'));
    if (next?.next_evaluation) mine.push(item(`You’re evaluating ${next.next_evaluation.guide} ${next.next_evaluation.when}.`));
    sec('You', mine);
    const todo = (train?.requirements || []).filter(r => !['Complete', 'Waived', 'Excused'].includes(r.state));
    sec('Training', todo.map(r => item(`${r.requirement}: ${r.state}${r.next_session ? ` — next ${dayLabel(r.next_session, today)}` : ''}`, r.state === 'Needs makeup' ? 'action' : 'info', lk(ctx, 'My training', 'trainhub', { tab: 'mine' }))), todo.length ? 'warn' : undefined);
    sec('Needs attention', (act?.items || []).filter(i => i.level === 'urgent' || i.level === 'action').map(i => item(i.title, i.level)), 'warn');
    sec('Announcements', (ann?.announcements || []).slice(0, 2).map(a => item(a.title, 'info', lk(ctx, 'Announcements', 'announcements'))));
    if (!sections.length) sections.push({ title: 'All clear', tone: 'good', items: [item('Nothing needs your attention right now.')] });
    return { kind: 'personal', title: 'Your brief', sections, generated: ctx.now.toISOString() };
  }

  /* ------------------------------------------------ leadership / admin */
  const week = kind === 'weekly';
  const wantToday = kind === 'operations' || kind === 'morning';
  const wantTrain = ['operations', 'training', 'weekly'].includes(kind);
  const wantEval = ['operations', 'evaluation', 'weekly'].includes(kind);
  const wantSchedule = kind !== 'training' && kind !== 'evaluation';
  const [toursToday, toursNext, conflicts, evalStatus, opps, tOverview, health, act] = await Promise.all([
    wantToday ? get('get_tours', { when: 'today' }) : none,
    wantSchedule ? get('get_tours', { when: week ? 'next week' : 'tomorrow' }) : none,
    wantSchedule ? get('get_schedule_conflicts', { when: week ? 'next week' : 'this week' }) : none,
    wantEval ? get('get_eval_status') : none,
    wantEval ? get('find_eval_opportunities', { when: week ? 'next week' : 'this week', limit: 3 }) : none,
    wantTrain ? get('get_training_overview') : none,
    w.admin && wantSchedule ? get('get_data_health') : none,
    wantToday ? get('get_action_center', { limit: 5 }) : none
  ]);

  const missing = [];
  if (wantEval && evalStatus == null && opps == null) missing.push('evaluations');
  if (wantSchedule && toursNext == null && conflicts == null) missing.push('the tour schedule');
  if (wantTrain && tOverview == null) missing.push('training');
  if (w.admin && wantSchedule && health == null) missing.push('the data connections');
  if (toursToday) sec('Today', [item(toursToday.tour_slots ? `${plural(toursToday.tour_slots, 'tour slot')} with ${plural(toursToday.distinct_guides, 'guide')}.` : 'No tours on the schedule today.', 'info', lk(ctx, 'Schedule', 'schedule'))]);

  const attention = [];
  (conflicts?.problems || []).slice(0, 3).forEach(p => attention.push(item(p.detail || `${p.who} is ${p.type.replace(/_/g, ' ').replace('double booked', 'double-booked')} ${String(p.when).replace(/\s*\([^)]*\)/g, '')}`, 'action', lk(ctx, 'Schedule', 'schedule'))));
  if (evalStatus?.high_priority_without_evaluator) attention.push(item(`${plural(evalStatus.high_priority_without_evaluator, 'high-priority guide')} still ${evalStatus.high_priority_without_evaluator === 1 ? 'has' : 'have'} no evaluator.`, 'action', lk(ctx, 'Evaluation Roster', 'evalroster')));
  (tOverview?.needs_attention || []).slice(0, 3).forEach(a => attention.push(item(({ attendance_missing: `Attendance for ${a.title} hasn’t been recorded.`, no_location: `${a.title} has no location yet.`, no_speaker: `${a.title} has no speaker yet.`, no_sessions: `${a.title} has no sessions scheduled.` })[a.kind] || a.title, 'action', lk(ctx, 'Training', 'trainhub'))));
  const makeup = (tOverview?.requirements || []).reduce((n, r) => n + (r.makeup_needed || 0), 0);
  if (makeup) attention.push(item(`${plural(makeup, 'makeup')} still needed in training.`, 'action', lk(ctx, 'Training', 'trainhub', { tab: 'people' })));
  (health?.problems || []).slice(0, 2).forEach(p => attention.push(item(p, 'action', lk(ctx, 'Data health', 'health'))));
  (act?.items || []).filter(i => i.level === 'urgent').slice(0, 2).forEach(i => { if (!attention.some(a => a.text === i.title)) attention.push(item(i.title, 'urgent')); });
  sec('Needs attention', attention, 'warn');

  const upcoming = [];
  if (evalStatus && (kind === 'evaluation' || week)) upcoming.push(item(`${evalStatus.still_need_evaluated} still need evaluated (${evalStatus.high_priority_still_needed} high priority); ${evalStatus.no_evaluator_yet} have no evaluator.`));
  if (toursNext?.tour_slots) upcoming.push(item(`${week ? 'Next week' : 'Tomorrow'}: ${plural(toursNext.tour_slots, 'tour slot')}.`, 'info', lk(ctx, 'Schedule', 'schedule')));
  (tOverview?.upcoming_sessions || []).slice(0, 2).forEach(s => upcoming.push(item(`${s.title} — ${s.when}${s.location && s.location !== 'no location yet' ? ' · ' + s.location : ''}.`, 'upcoming', lk(ctx, 'Training', 'trainhub', { tab: 'sessions' }))));
  if (opps?.viable_matches) upcoming.push(item(`${plural(opps.viable_matches, 'evaluation opportunity')} ${week ? 'next week' : 'this week'} across ${plural(opps.across_tours, 'tour')}.`, 'info', lk(ctx, 'Evaluation Roster', 'evalroster', { tab: 'match' })));
  sec('Upcoming', upcoming);
  if (missing.length) sections.push({ title: 'Not available', tone: 'warn', items: [item(`I couldn’t load ${missing.join(' or ')} just now, so this brief leaves ${missing.length === 1 ? 'it' : 'them'} out.`)] });
  if (!sections.length) sections.push({ title: 'All clear', tone: 'good', items: [item('Nothing needs your attention right now.')] });
  return { kind, title: TITLES[kind] || 'Brief', sections, generated: ctx.now.toISOString() };
}
