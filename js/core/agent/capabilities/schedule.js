/* Schedule: who is touring when, someone's next tour, and conflicts. Every answer
   comes from the schedule tools (the same data as the Schedule page). */
import { dayLabel, timeLabel, addDays } from '../time.js';
import { Num, count, names, firstName, possessive, join, whenWords, s as pl, cap } from '../engine/respond.js';
import { rangeArgs, person, plainSlot, chips } from './util.js';

const slotParts = (t, id) => { const [date, start] = String(id || '').split('|'); return { date, start, time: start ? timeLabel(start) : '' }; };

/** "10 AM — Alex G., Morgan W." (one line per slot). `showDay` adds the day for ranges. */
function slotLines(t, slots, showDay) {
  return slots.map(x => { const p = slotParts(t, x.id); return `${showDay ? `${dayLabel(p.date, t.ctx.today)} ` : ''}${p.time}${p.time ? ' — ' : ''}${x.guides.length ? x.guides.join(', ') : 'no guides listed'}`; });
}

/** A short list is said in full (no card needed); a long one is summarised and the card carries the rest. */
function tourListText(t, d, label) {
  if (!d.tour_slots) return { text: `Nobody is on the tour schedule ${label}. (The schedule only shows slots that have a guide on them.)`, cards: 'drop' };
  const multiDay = d.from !== d.to;
  const head = `${Num(d.tour_slots)} tour slot${pl(d.tour_slots)} ${label} with ${count(d.distinct_guides, 'guide')}`;
  if (d.slots.length <= 2 && !d.not_shown) return { text: `${head}:\n${slotLines(t, d.slots, multiDay).map(l => `- ${l}`).join('\n')}`, cards: 'drop' };
  return { text: `${head}. ${multiDay ? 'The first is' : 'The earliest is'} ${slotLines(t, d.slots.slice(0, 1), multiDay)[0]}.` };
}

const dateIntent = (id, label, fallback) => ({
  permission: 'schedule.read', mode: 'read', people: 'none', params: ['dateRange', 'tourType'], promote: { person: 'schedule.person' },
  async run(q, t) {
    const range = q.filters.dateRange || fallback(t);
    const r = await t.must('get_tours', { ...rangeArgs(range) });
    return { r, d: r.data, range, tourType: q.filters.tourType };
  },
  respond({ d, range, tourType }, q, t) {
    const label = whenWords(range) || d.range;
    const note = tourType ? ` The schedule doesn’t label tour types, so this is every tour.` : '';
    const a = tourListText(t, d, label);
    return { text: join(a.text, note), cards: a.cards, suggest: chips(d.tour_slots ? 'Any conflicts this week?' : null, 'When is my next tour?') };
  }
});

export default {
  id: 'schedule', label: 'Schedule',
  intents: {
    'schedule.next': {
      permission: 'schedule.read', mode: 'read', people: 'optional', params: [], promote: { dateRange: 'schedule.date' },
      async run(q, t) {
        const p = person(q);
        const r = await t.must('get_next_tour', p ? { person: p.id } : {});
        return { r, d: r.data, p };
      },
      respond({ d, p }, q, t) {
        if (d.schedule_unavailable) return { text: 'The tour schedule isn’t loading right now, so I can’t check that.' };
        const w = d.next_tour ? plainSlot(d.next_tour.when) : null;
        if (!p) {
          if (!w) return { text: join('You don’t have any upcoming tours on the schedule.', d.next_evaluation ? `You’re evaluating ${d.next_evaluation.guide} ${d.next_evaluation.when}.` : ''), suggest: chips('Who is touring tomorrow?') };
          const withWho = d.next_tour.with?.length ? ` with ${names(d.next_tour.with)}` : '';
          return { text: join(`Your next tour is ${w}${withWho}.`, d.next_evaluation ? `You’re also evaluating ${d.next_evaluation.guide} ${d.next_evaluation.when}.` : ''), suggest: chips('Who is touring tomorrow?', 'Any conflicts this week?') };
        }
        const first = firstName(d.person);
        if (!w) return { text: `${d.person} doesn’t have any upcoming tours on the schedule.` };
        const withWho = d.next_tour.with?.length ? `, with ${names(d.next_tour.with)}` : '';
        return { text: join(`${possessive(d.person)} next tour is ${w}${withWho}.`, d.upcoming_tours > 1 ? `${cap(first)} has ${count(d.upcoming_tours, 'tour')} coming up in all.` : ''), suggest: chips(`Who could cover ${first}?`) };
      }
    },

    'schedule.today': dateIntent('schedule.today', 'Today', t => ({ from: t.ctx.today, to: t.ctx.today, label: 'today' })),
    'schedule.date': dateIntent('schedule.date', 'Date', t => ({ from: t.ctx.today, to: t.ctx.today, label: 'today' })),

    'schedule.person': {
      permission: 'schedule.read', mode: 'read', people: 'required', params: ['dateRange'], promote: {},
      async run(q, t) {
        const p = person(q), range = q.filters.dateRange && !q.filters.dateRange.vague ? q.filters.dateRange : { from: t.ctx.today, to: addDays(t.ctx.today, 28), label: 'in the next four weeks' };
        const r = await t.must('get_tours', { ...rangeArgs(range), people: [p.id], limit: 12 });
        return { r, d: r.data, p, range };
      },
      respond({ d, p, range }, q, t) {
        const label = whenWords(range) || d.range, who = p.label, first = firstName(who);
        if (!d.tour_slots) return { text: `${who} isn’t on any tours ${label}.`, cards: 'drop', suggest: chips(`When is ${possessive(first)} next tour?`) };
        const lines = d.slots.slice(0, 3).map(x => { const pr = slotParts(t, x.id); const others = x.guides.filter(g => !g.toLowerCase().startsWith(first.toLowerCase())); return `${dayLabel(pr.date, t.ctx.today)} at ${pr.time}${others.length ? ` with ${names(others)}` : ''}`; });
        const few = d.tour_slots <= 3;
        return { text: few ? `${who} has ${count(d.tour_slots, 'tour')} ${label}:\n${lines.map(l => `- ${l}`).join('\n')}` : `${who} has ${count(d.tour_slots, 'tour')} ${label}. The next is ${lines[0]}.`, cards: few ? 'drop' : undefined, suggest: chips(`Who could cover ${first}?`) };
      }
    },

    'schedule.conflicts': {
      permission: 'schedule.read', mode: 'read', people: 'none', params: ['dateRange'],
      async run(q, t) {
        const range = q.filters.dateRange || { when: 'this week', label: 'this week' };
        const r = await t.must('get_schedule_conflicts', range.from ? rangeArgs(range) : { when: 'this week' });
        return { r, d: r.data, range };
      },
      respond({ d, range }) {
        const label = whenWords(range) || d.range;
        if (!d.conflicts) return { text: join(`No schedule conflicts ${label}.`, d.unmatched_schedule_names ? `${Num(d.unmatched_schedule_names)} schedule name${pl(d.unmatched_schedule_names)} still aren’t matched to a Tour Guide, though.` : ''), cards: d.unmatched_schedule_names ? undefined : 'drop', suggest: d.unmatched_schedule_names ? chips('Which names don’t match?') : chips('Who is touring tomorrow?') };
        const lines = d.problems.slice(0, 3).map(p => p.detail || `${p.who} is ${p.type.replace(/_/g, ' ').replace('double booked', 'double-booked')}: ${String(p.when).replace(/\s*\([^)]*\)/g, '')}`);
        const few = d.conflicts <= 3;
        return { text: few ? `${Num(d.conflicts)} schedule conflict${pl(d.conflicts)} ${label}:\n${lines.map(l => `- ${l}`).join('\n')}` : `${Num(d.conflicts)} schedule conflicts ${label}. Most pressing: ${lines[0]}`, cards: few ? 'drop' : undefined, suggest: chips('Is everything synced?') };
      }
    }
  }
};
