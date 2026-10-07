/* Schedule: who is touring when, conflicts, and who could cover. The schedule is
   visible to every signed-in person, so these tools only gate the extra layers
   (evaluator names, data health) on their own capabilities. */
import { ok, ToolError, personFrom, directory, top, plural, link, displayName, slotsIn, windowOf, labelMatches, slotLabel, slotId, when, addDays, clock, dayLabel, timeLabel, first } from './kit.js';
import { can } from '../capabilities.js';
import { fromToday } from '../time.js';

const S = (o = {}) => ({ type: 'string', ...o });
const timeProps = {
  when: S({ maxLength: 60, description: 'Natural time: "today", "tomorrow", "Friday", "next week", "this weekend", "Oct 9", "tomorrow after 2 PM".' }),
  date: S({ format: 'date', description: 'An exact date, YYYY-MM-DD. Prefer `when` for anything the user said in words.' }),
  from: S({ format: 'date' }), to: S({ format: 'date' }), label: S({ maxLength: 60, description: 'How to describe the range in the answer (optional).' }),
  after_time: S({ format: 'time' }), before_time: S({ format: 'time' }), at_time: S({ format: 'time', description: 'Exact start time of one slot.' })
};

const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** [start,end) in minutes; end comes from the slot label ("2:00-3:00") when it parses, else an hour. */
export function slotInterval(s) {
  const a = mins(s.start); if (a == null) return null;
  const m = /-\s*(\d{1,2})(?::(\d{2}))?/.exec(String(s.slot || ''));
  let end = a + 60;
  if (m) { let h = Number(m[1]); const mi = Number(m[2] || 0); if (h * 60 + mi <= a) h += 12; if (h < 24) end = h * 60 + mi; }
  return [a, end];
}
const overlap = (x, y) => x && y && x[0] < y[1] && y[0] < x[1];

export const tools = [
  {
    name: 'get_tours', cap: 'schedule.read', status: 'Checking the schedule…', show: true,
    description: 'Tours on the schedule for a date or range, grouped by time slot with the guides on each. Optionally filter to slots containing certain people (all must be on it) and a time window. Use for "who is touring tomorrow", "who is on the 2 PM tour Friday", "which tour had Jordan and Taylor together".',
    input_schema: { type: 'object', properties: { ...timeProps, people: { type: 'array', maxItems: 4, items: S({ maxLength: 80 }) }, limit: { type: 'integer', minimum: 1, maximum: 40 } } },
    async run(args, ctx) {
      const win = windowOf(ctx, args, { fallback: 'today' });
      const people = [];
      for (const q of args.people || []) people.push(await personFrom(ctx, q));
      let { slots } = await slotsIn(ctx, win, { people });
      if (win.needs === 'training_session') {
        const s = await ctx.deps.firstSessionOn(win.from);
        if (s?.start_time) slots = slots.filter(x => String(x.start).slice(0, 5) < String(s.start_time).slice(0, 5)); else throw new ToolError('no_session', `There's no training session on ${dayLabel(win.from, ctx.today)} to be "before".`);
      }
      const t = top(slots, args.limit || 12);
      const guides = new Set(slots.flatMap(s => s.guides));
      const rows = t.items.map(s => ({ id: slotId(s), when: slotLabel(ctx, s), guides: s.guides }));
      return ok({ range: win.label, from: win.from, to: win.to, tour_slots: t.count, distinct_guides: guides.size, slots: rows, not_shown: t.more },
        { list: { kind: 'tours', items: t.items.map(s => ({ id: slotId(s), date: s.date, start: s.start })) },
          card: { kind: 'list', title: `${plural(t.count, 'tour slot')} ${win.label}`.replace(/^1 tour slot/, '1 tour slot'),
            items: t.items.map(s => ({ label: slotLabel(ctx, s), sub: s.guides.join(', ') || 'No guides listed' })),
            more: t.more ? { count: t.more, link: link(ctx, 'Open schedule', 'schedule') } : null, links: [link(ctx, 'Open schedule', 'schedule')] } });
    }
  },
  {
    name: 'get_next_tour', cap: 'schedule.read', status: 'Finding the next tour…', show: true,
    description: 'The next upcoming tour (and any evaluation) for a person. With no person, it is the signed-in user\'s own next tour.',
    input_schema: { type: 'object', properties: { person: S({ maxLength: 80 }) } },
    async run({ person }, ctx) {
      const { today, time } = clock(ctx.now, ctx.tz);
      if (!person || /^(me|my|myself|i)$/i.test(person)) {
        const u = await ctx.deps.myUpcoming();
        const tour = u.leading?.[0], ev = u.evals?.[0];
        const data = { next_tour: tour ? { when: slotLabel(ctx, tour), id: slotId(tour), with: tour.guides.filter(g => !labelMatches(g, { first: first(ctx.who.name), last: ctx.who.name.split(' ').slice(1).join(' ') })) } : null,
          next_evaluation: ev ? { guide: ev.name, when: when(ctx, ev.date, ev.time) } : undefined, upcoming_tours: u.leading?.length ?? 0, schedule_unavailable: u.toursMissing || undefined };
        return ok(data, { card: tour ? { kind: 'rows', title: 'Your next tour', rows: [['When', slotLabel(ctx, tour)], ['With', data.next_tour.with.join(', ') || '—'], ...(ev ? [['Evaluating', `${ev.name} · ${when(ctx, ev.date, ev.time)}`]] : [])], links: [link(ctx, 'Open schedule', 'schedule')] } : null });
      }
      const p = await personFrom(ctx, person);
      const { slots } = await slotsIn(ctx, { from: today, to: addDays(today, 150) }, { people: [p] });
      const next = slots.filter(s => s.date > today || !s.start || String(s.start).slice(0, 5) >= time);
      return ok({ person: displayName(p), next_tour: next[0] ? { when: slotLabel(ctx, next[0]), with: next[0].guides.filter(g => !labelMatches(g, p)) } : null, upcoming_tours: next.length },
        { focus: { person: { id: p.id, name: displayName(p) }, tour: next[0] ? { id: slotId(next[0]), date: next[0].date, start: next[0].start } : undefined } });
    }
  },
  {
    name: 'get_tour_details', cap: 'schedule.read', status: 'Opening that tour…', show: true,
    description: 'Everything known about one tour slot: the guides on it, and (for people allowed to see evaluations) any evaluator assigned. Identify it by date and start time.',
    input_schema: { type: 'object', properties: { date: S({ format: 'date' }), when: S({ maxLength: 40 }), start: S({ format: 'time', description: '24-hour start time of the slot.' }) } },
    async run(args, ctx) {
      const win = windowOf(ctx, args, { fallback: 'today' });
      let { slots } = await slotsIn(ctx, win);
      if (args.start) slots = slots.filter(s => String(s.start).slice(0, 5) === args.start);
      if (!slots.length) return ok({ found: false, message: 'No tour is listed in that slot.' });
      if (slots.length > 1) return ok({ found: 'several', slots: slots.slice(0, 8).map(s => ({ id: slotId(s), when: slotLabel(ctx, s) })), ask_user: 'Several slots match. Ask which time.' });
      const s = slots[0];
      const data = { id: slotId(s), when: slotLabel(ctx, s), guides: s.guides };
      if (can('evaluations.read', ctx.who)) {
        const r = await ctx.deps.roster();
        if (r.ok) data.evaluations = r.guides.filter(g => g.date === s.date && String(g.time || '').slice(0, 5) === String(s.start).slice(0, 5) && g.status !== 'skip' && g.evaluator)
          .map(g => ({ guide: g.name, evaluator: g.evaluator, status: g.status }));
      }
      return ok(data, { focus: { tour: { id: slotId(s), date: s.date, start: s.start } },
        card: { kind: 'rows', title: slotLabel(ctx, s), rows: [['Guides', s.guides.join(', ') || '—'], ...(data.evaluations?.length ? [['Evaluations', data.evaluations.map(e => `${e.evaluator} → ${e.guide}`).join('; ')]] : [])], links: [link(ctx, 'Open schedule', 'schedule')] } });
    }
  },
  {
    name: 'get_schedule_conflicts', cap: 'schedule.read', status: 'Looking for conflicts…', show: true,
    description: 'Problems in the schedule for a date range: a guide listed on two overlapping tours, an evaluator assigned to two evaluations at once (if the user can see evaluations), an evaluation booked on a tour its guide is not actually on, and schedule names that don\'t match a Tour Guide (admins). Use for "any conflicts Friday", "is anyone double-booked".',
    input_schema: { type: 'object', properties: { ...timeProps } },
    async run(args, ctx) {
      const { today } = clock(ctx.now, ctx.tz);
      const win = fromToday(windowOf(ctx, args, { fallback: 'this week' }), today);
      const { slots } = await slotsIn(ctx, win);
      const problems = [];
      const byGuide = new Map();
      for (const s of slots) for (const g of new Set(s.guides)) { const k = `${s.date}|${g.toLowerCase()}`; (byGuide.get(k) || byGuide.set(k, []).get(k)).push(s); }
      for (const [k, list] of byGuide) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
        if (overlap(slotInterval(list[i]), slotInterval(list[j])) || (list[i].start === list[j].start)) {
          const name = list[i].guides.find(g => g.toLowerCase() === k.split('|')[1]) || k.split('|')[1];
          problems.push({ type: 'double_booked', who: name, when: `${slotLabel(ctx, list[i])} and ${slotLabel(ctx, list[j])}` });
        }
      if (can('evaluations.read', ctx.who)) {
        const r = await ctx.deps.roster();
        if (r.ok) {
          const per = new Map();
          for (const g of r.guides.filter(x => x.status === 'claimed' && x.date && x.date >= win.from && x.date <= win.to)) {
            const k = `${g.evaluatorId}|${g.date}`; (per.get(k) || per.set(k, []).get(k)).push(g);
            const touring = slots.some(s => s.date === g.date && String(s.start).slice(0, 5) === String(g.time || '').slice(0, 5) && s.guides.some(l => labelMatches(l, { first: g.first, last: g.last })));
            if (g.time && !touring && slots.some(s => s.date === g.date)) problems.push({ type: 'evaluation_not_on_tour', who: g.name, when: when(ctx, g.date, g.time), detail: `${g.evaluator || 'An evaluator'} is booked to evaluate ${g.name}, but ${first(g.name)} isn’t listed on that tour.` });
          }
          for (const list of per.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
            if (list[i].time && list[i].time === list[j].time) problems.push({ type: 'evaluator_double_booked', who: list[i].evaluator, when: when(ctx, list[i].date, list[i].time) });
        }
      }
      let unmatched;
      if (can('data.read', ctx.who)) { try { unmatched = (await ctx.deps.unmatched()).length; } catch { /* optional */ } }
      const t = top(problems, 10);
      return ok({ range: win.label, from: win.from, to: win.to, conflicts: t.count, problems: t.items, not_shown: t.more, unmatched_schedule_names: unmatched },
        { card: { kind: 'list', title: t.count ? `${plural(t.count, 'schedule conflict')} ${win.label}` : `No schedule conflicts ${win.label}`, tone: t.count ? 'warn' : 'good',
            items: t.items.map(p => ({ label: p.who, sub: p.detail || `${p.type.replace(/_/g, ' ')} · ${p.when}` })), links: unmatched ? [link(ctx, `${unmatched} unmatched name${unmatched === 1 ? '' : 's'}`, 'reconcile')] : [] } });
    }
  },
  {
    name: 'get_coverage_gaps', cap: 'coverage.read', status: 'Checking coverage…', show: true,
    description: 'Desk slots this week that nobody is down for. (The Hub only sees tour slots that have a guide on them, so it cannot tell you about an entirely empty tour slot; say so if asked.)',
    input_schema: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const rows = await ctx.deps.desks();
      if (!rows.ok) return ok({ available: false, message: 'The desk schedule isn’t loading right now.' });
      const gaps = []; const seen = new Set();
      for (const r of rows.rows) { const k = `${r.desk}|${r.slot}|${r.day}`; if (seen.has(k)) continue; seen.add(k); if (!rows.rows.some(x => x.desk === r.desk && x.slot === r.slot && x.day === r.day && x.person)) gaps.push(r); }
      const t = top(gaps, 10);
      return ok({ uncovered_desk_slots: t.count, slots: t.items.map(g => `${g.desk}, ${g.day} ${g.slot}`), not_shown: t.more, limitation: 'Tour slots with no guide at all do not appear in the schedule data.' },
        { card: { kind: 'list', title: t.count ? `${plural(t.count, 'desk slot')} uncovered this week` : 'Every desk slot is covered this week', tone: t.count ? 'warn' : 'good', items: t.items.map(g => ({ label: `${g.desk} · ${g.day}`, sub: g.slot })), links: [link(ctx, 'Open Desk Coverage', 'desks')] } });
    }
  },
  {
    name: 'suggest_coverage', cap: 'coverage.read', status: 'Finding who is free…', show: true,
    description: 'Who could cover a tour for someone who can\'t make it. Give the person and the day (and time if they have several tours). Returns active, tour-eligible guides who are not on a conflicting tour, fewest tours that week first, with the reason. This only SUGGESTS: the Hub cannot change the tour schedule, which lives in the spreadsheet. Availability beyond the tour schedule (classes, etc.) is unknown.',
    input_schema: { type: 'object', properties: { person: S({ minLength: 1, maxLength: 80 }), ...timeProps, start: S({ format: 'time' }) }, required: ['person'] },
    async run(args, ctx) {
      const p = await personFrom(ctx, args.person);
      const win = windowOf(ctx, args, { fallback: 'today' });
      const mine = (await slotsIn(ctx, win, { people: [p] })).slots.filter(s => !args.start || String(s.start).slice(0, 5) === args.start);
      if (!mine.length) return ok({ person: displayName(p), tour: null, message: `${displayName(p)} isn’t listed on a tour ${win.label}.` });
      const dir = await directory(ctx);
      const wkFrom = addDays(win.from, -((new Date(win.from + 'T12:00:00Z').getUTCDay() + 6) % 7)), wkTo = addDays(wkFrom, 6);
      const week = (await slotsIn(ctx, { from: wkFrom, to: wkTo })).slots;
      const out = mine.map(target => {
        const iv = slotInterval(target);
        const sameDay = week.filter(s => s.date === target.date);
        const cands = dir.people.filter(c => c.id !== p.id && c.active !== false && c.tourEligible !== false)
          .filter(c => !sameDay.some(s => (s.start === target.start || overlap(slotInterval(s), iv)) && s.guides.some(g => labelMatches(g, c))))
          .map(c => ({ c, load: week.filter(s => s.guides.some(g => labelMatches(g, c))).length }))
          .sort((a, b) => a.load - b.load || `${a.c.last}${a.c.first}`.localeCompare(`${b.c.last}${b.c.first}`));
        return { tour: slotLabel(ctx, target), id: slotId(target), candidates: cands.slice(0, 5).map(x => ({ id: x.c.id, name: displayName(x.c), tours_that_week: x.load, why: `No conflicting tour at that time; ${x.load === 0 ? 'no other tours' : plural(x.load, 'other tour')} that week.` })), eligible_count: cands.length };
      });
      return ok({ person: displayName(p), needs_cover: out, assigning: 'The Hub can\'t change the spreadsheet schedule. Tell the user to update the schedule source, or offer to note it.', caveat: 'Only tour conflicts are checked; classes and personal availability are not known.' },
        { focus: { person: { id: p.id, name: displayName(p) }, tour: { id: out[0].id, date: mine[0].date, start: mine[0].start } },
          card: { kind: 'list', title: `Who could cover ${first(displayName(p))} ${win.label}`, items: out[0].candidates.map(c => ({ label: c.name, sub: c.why })) } });
    }
  }
];
