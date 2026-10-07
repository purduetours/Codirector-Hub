/* Coverage: desk slots nobody is down for, and who could cover a tour. The Hub can't
   change the tour schedule (it lives in a spreadsheet), so she SUGGESTS cover and says
   so; she never claims to have arranged it. */
import { dayLabel, timeLabel } from '../time.js';
import { Num, count, names, firstName, possessive, join, whenWords, s as pl } from '../engine/respond.js';
import { rangeArgs, person, plainSlot, chips } from './util.js';

export default {
  id: 'coverage', label: 'Coverage',
  intents: {
    'coverage.open': {
      permission: 'coverage.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_coverage_gaps'); return { d: r.data }; },
      respond({ d }) {
        if (d.available === false) return { text: d.message, cards: 'drop' };
        if (!d.uncovered_desk_slots) return { text: 'Every desk slot is covered this week.', cards: 'drop', suggest: chips('Who is touring tomorrow?') };
        const n = d.uncovered_desk_slots;
        return { text: join(`${Num(n)} desk slot${pl(n)} ${n === 1 ? 'has' : 'have'} nobody on ${n === 1 ? 'it' : 'them'} this week${n <= 3 ? `: ${names(d.slots)}.` : '.'}`, 'I can only see tour slots that have a guide on them, so an entirely empty tour slot wouldn’t show up here.'), cards: n <= 3 ? 'drop' : undefined, suggest: chips('Any conflicts this week?') };
      }
    },

    'coverage.suggest': {
      permission: 'coverage.read', mode: 'read', people: 'optional', params: ['dateRange'],
      async run(q, t) {
        const p = person(q), dr = q.filters.dateRange;
        const r = await t.must('suggest_coverage', { person: p ? p.id : 'me', ...(dr ? rangeArgs(dr) : { when: 'today' }), ...(dr?.at ? { start: dr.at } : {}) });
        return { d: r.data, p, range: dr };
      },
      respond({ d, p, range }) {
        const who = p ? p.label : 'You', first = p ? firstName(p.label) : 'you';
        if (!d.needs_cover) return { text: d.message || `${who} isn’t on a tour ${range ? whenWords(range) : 'then'}.`, cards: 'drop' };
        const o = d.needs_cover[0], c = o.candidates;
        if (!c.length) return { text: `Nobody is free to cover ${plainSlot(o.tour)} — everyone eligible already has a tour then.`, cards: 'drop' };
        return { text: join(`For ${p ? possessive(first) : 'your'} tour ${plainSlot(o.tour)}, ${names(c.slice(0, 3).map(x => x.name))} ${c.length === 1 ? 'is' : 'are'} free${c[0].tours_that_week === 0 ? ` — ${firstName(c[0].name)} has no other tours that week` : ''}.`,
          'I can’t change the tour schedule from here, so this is a suggestion — update it in the schedule spreadsheet, or ask them directly.', 'Classes and personal availability aren’t tracked.'), suggest: chips() };
      }
    },

    'coverage.person': {
      permission: 'coverage.read', mode: 'read', people: 'required', params: ['dateRange'],
      async run(q, t) {
        const p = person(q), dr = q.filters.dateRange || { when: 'this week', label: 'this week' };
        const r = await t.must('get_tours', { ...(dr.from ? rangeArgs(dr) : { when: 'this week' }), people: [p.id], limit: 6 }, { card: false });
        return { d: r.data, p, range: dr };
      },
      respond({ d, p, range }, q, t) {
        const first = firstName(p.label), label = whenWords(range) || d.range;
        if (!d.tour_slots) return { text: `${p.label} isn’t on a tour ${label}.`, cards: 'drop' };
        const lines = d.slots.slice(0, 3).map(x => { const [date, start] = String(x.id).split('|'); const others = x.guides.filter(g => !g.toLowerCase().startsWith(first.toLowerCase())); return `${dayLabel(date, t.ctx.today)} at ${timeLabel(start)} ${others.length ? `with ${names(others)}` : 'on their own'}`; });
        return { text: `${p.label} has ${count(d.tour_slots, 'tour')} ${label}:\n${lines.map(l => `- ${l}`).join('\n')}`, cards: 'drop', suggest: chips(`Who could cover ${first}?`) };
      }
    }
  }
};
