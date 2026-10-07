/* People: who someone is, and lists of people. Names resolve through the
   canonical Tour Guide list; what is shown depends on the capability. */
import { ok, ToolError, personFrom, directory, top, plural, link, displayName, untrusted, slotsIn, windowOf, labelMatches, slotLabel, when, addDays, clock } from './kit.js';
import { can } from '../capabilities.js';

const S = (o = {}) => ({ type: 'string', ...o });

export const tools = [
  {
    name: 'remember_nickname', cap: 'self.read', status: 'Remembering that…',
    description: 'Remember a shorthand the user uses for a person ("when I say JD I mean the Jordan in the Tour Guide list") so future questions understand it. Saved only in this browser for this user. Use only when the user asks you to remember a nickname.',
    input_schema: { type: 'object', properties: { nickname: S({ minLength: 2, maxLength: 40 }), person: S({ minLength: 1, maxLength: 80 }) }, required: ['nickname', 'person'] },
    async run({ nickname, person }, ctx) {
      const p = await personFrom(ctx, person, { write: true });
      const r = ctx.deps.setNickname(nickname, p.id);
      if (!r.ok) throw new ToolError('cannot', r.message);
      ctx.state.cache = new Map();                      // earlier lookups no longer hold
      return ok({ remembered: `${nickname} → ${displayName(p)}`, note: 'Saved on this device only.' });
    }
  },
  {
    name: 'forget_nickname', cap: 'self.read', status: 'Forgetting that…',
    description: 'Forget a nickname previously remembered for this user.',
    input_schema: { type: 'object', properties: { nickname: S({ minLength: 2, maxLength: 40 }) }, required: ['nickname'] },
    async run({ nickname }, ctx) { const had = ctx.deps.removeNickname(nickname); ctx.state.cache = new Map(); return ok({ forgotten: had }); }
  },
  {
    name: 'find_people', cap: 'self.read', status: 'Looking up names…',
    description: 'Look up people by name (first name, full name, "J Smith", nickname). Use this to check who someone is or to disambiguate before another tool. Returns up to 8 candidates; if several share a name, ask the user which one.',
    input_schema: { type: 'object', properties: { query: S({ minLength: 1, maxLength: 80 }) }, required: ['query'] },
    async run({ query }, ctx) {
      const dir = await directory(ctx);
      try {
        const p = await personFrom(ctx, query);
        return ok({ match: 'one', person: brief(p, ctx), note: undefined }, { focus: { person: ref(p) } });
      } catch (e) {
        if (e.code === 'ambiguous') return ok({ match: 'several', candidates: e.extra.candidates, ask_user: 'Ask which one they mean.' });
        if (e.code === 'not_found') return ok({ match: 'none', message: e.message });
        throw e;
      }
    }
  },
  {
    name: 'get_person_profile', cap: 'self.read', status: 'Pulling up their profile…', show: true,
    description: 'Summarize one Tour Guide: active status, major, upcoming tours, evaluation status (if the user may see it), training standing (if the user may see it). Use "me" for the signed-in user. Respects what the user is allowed to see.',
    input_schema: { type: 'object', properties: { person: S({ minLength: 1, maxLength: 80, description: 'Name, id, "me", or a pronoun for the person under discussion.' }) }, required: ['person'] },
    async run({ person }, ctx) {
      const p = await personFrom(ctx, person);
      const isMe = !!p.memberId && p.memberId === ctx.who.id;
      if (!isMe && !can('people.read', ctx.who)) throw new ToolError('not_permitted', 'You can see your own profile, but not other people’s.');
      const data = { name: displayName(p), active: p.active !== false };
      const rows = [['Status', p.active !== false ? 'Active Tour Guide' : 'Inactive']];
      if (p.major) { data.major = p.major; rows.push(['Major', p.major]); }
      if (can('people.read', ctx.who) || isMe) {
        if (p.leadership) { data.leadership = true; rows.push(['Role', 'Leadership']); }
      }
      // tours: the schedule is visible to everyone
      const { today } = clock(ctx.now, ctx.tz);
      try {
        const { slots } = await slotsIn(ctx, { from: today, to: addDays(today, 120) }, { people: [p] });
        data.upcoming_tours = slots.length;
        data.next_tours = slots.slice(0, 3).map(s => slotLabel(ctx, s));
        rows.push(['Upcoming tours', slots.length ? `${slots.length} · next ${slotLabel(ctx, slots[0])}` : 'None on the schedule']);
      } catch { data.tours_unavailable = true; rows.push(['Upcoming tours', 'The schedule isn’t loading']); }
      if (can('evaluations.read', ctx.who) || isMe) {
        try {
          const r = await ctx.deps.roster();
          const e = r.ok && r.guides.find(g => g.guideId === p.id);
          if (e) {
            data.evaluation = { status: e.status, priority: e.priority || undefined, evaluator: e.evaluator || undefined, date: e.date || undefined };
            rows.push(['Evaluation', ({ open: 'Needs an evaluator', claimed: `Claimed${e.evaluator ? ' by ' + e.evaluator : ''}${e.date ? ' · ' + when(ctx, e.date, e.time) : ''}`, submitted: 'Submitted', reviewed: 'Reviewed', skip: 'Not needed this semester' })[e.status] || e.status]);
            if (e.priority && e.status === 'open') rows.push(['Priority', e.priority]);
          } else if (r.ok) { data.evaluation = { status: 'not_on_roster' }; rows.push(['Evaluation', 'Not on this semester’s roster']); }
        } catch { /* evaluation data is optional here */ }
      }
      if (isMe || can('training.read.people', ctx.who)) {
        try {
          const t = isMe ? await ctx.deps.myTraining() : await ctx.deps.trainingFor(p.id);
          if (t?.requirements?.length) {
            const done = t.requirements.filter(r => ['complete', 'waived', 'excused'].includes(r.state)).length;
            const need = t.requirements.filter(r => r.state === 'makeup_needed').map(r => r.name);
            data.training = { done, total: t.requirements.length, makeup_needed: need, not_done: t.requirements.filter(r => r.state === 'incomplete').map(r => r.name) };
            rows.push(['Training', `${done} of ${t.requirements.length} requirements complete`]);
            if (need.length) rows.push(['Needs makeup', need.join(', ')]);
          }
        } catch { /* optional */ }
      }
      if (can('people.read.detail', ctx.who) && p.notes) data.notes = untrusted(p.notes, 240);
      return ok(data, { focus: { person: ref(p) },
        card: { kind: 'person', title: displayName(p), sub: [p.active !== false ? 'Active Tour Guide' : 'Inactive', p.major, p.leadership ? 'Leadership' : ''].filter(Boolean).join(' · '),
          badges: [data.evaluation?.status === 'open' ? { text: data.evaluation.priority ? `Needs eval · ${data.evaluation.priority}` : 'Needs eval', tone: 'warn' } : null, data.training?.makeup_needed?.length ? { text: 'Makeup needed', tone: 'warn' } : null, data.upcoming_tours ? { text: `${data.upcoming_tours} upcoming tour${data.upcoming_tours === 1 ? '' : 's'}` } : null].filter(Boolean),
          rows: rows.filter(([k]) => !['Status', 'Major'].includes(k)), links: [can('people.read', ctx.who) ? link(ctx, 'Open profile', 'guides', { q: displayName(p) }) : null].filter(Boolean),
          asks: [data.upcoming_tours ? 'When is their next tour?' : null, data.evaluation?.status === 'open' && can('evaluations.read', ctx.who) ? 'Who can evaluate them?' : null].filter(Boolean) } });
    }
  },
  {
    name: 'list_people', cap: 'people.read', status: 'Checking the roster…', show: true,
    description: 'List Tour Guides by a filter: by major, leadership, missing major, not on the tour schedule, joined this semester, or inactive. Returns the count, the first few names, and a link to see everyone. Use for "who are the CS majors", "who is leadership", "who has no major", "who isn\'t on the schedule".',
    input_schema: { type: 'object', properties: {
      filter: S({ enum: ['major', 'leadership', 'no_major', 'not_on_schedule', 'new_this_semester', 'inactive', 'all_active'] }),
      major: S({ maxLength: 60, description: 'For filter=major: a major name or common abbreviation like "CS".' }),
      limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['filter'] },
    async run({ filter, major, limit = 12 }, ctx) {
      const dir = await directory(ctx);
      let list = dir.people;
      let label;
      if (filter === 'major') {
        if (!major) throw new ToolError('missing', 'Which major?');
        const m = major.toLowerCase();
        const alias = { cs: 'computer science', cse: 'computer science', ds: 'data science', ee: 'electrical engineering', me: 'mechanical engineering', poli: 'political science', psych: 'psychology', bio: 'biology', chem: 'chemistry', econ: 'economics', ece: 'electrical' }[m] || m;
        list = list.filter(p => p.active !== false && p.major && (p.major.toLowerCase().includes(alias) || p.major.toLowerCase() === m));
        label = `${major} majors`;
      } else if (filter === 'leadership') { list = list.filter(p => p.active !== false && p.leadership); label = 'leadership'; }
      else if (filter === 'no_major') { list = list.filter(p => p.active !== false && !p.major); label = 'active guides without a major'; }
      else if (filter === 'inactive') { list = list.filter(p => p.active === false); label = 'inactive guides'; }
      else if (filter === 'new_this_semester') { list = list.filter(p => p.active !== false && p.newThisTerm); label = 'new this semester'; }
      else if (filter === 'not_on_schedule') {
        const { today } = clock(ctx.now, ctx.tz);
        const { slots } = await slotsIn(ctx, { from: today, to: addDays(today, 150) });
        list = list.filter(p => p.active !== false && p.tourEligible !== false && !slots.some(s => s.guides.some(g => labelMatches(g, p))));
        label = 'active guides with no upcoming tour';
      } else { list = list.filter(p => p.active !== false); label = 'active Tour Guides'; }
      list = list.sort((a, b) => `${a.last}${a.first}`.localeCompare(`${b.last}${b.first}`));
      const t = top(list, limit);
      const byMajor = {}; list.forEach(p => { const k = p.major || 'No major listed'; byMajor[k] = (byMajor[k] || 0) + 1; });
      return ok({ filter: label, count: t.count, people: t.items.map(p => ({ id: p.id, name: displayName(p), major: p.major || undefined })), not_shown: t.more, by_major: Object.entries(byMajor).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([major, n]) => ({ major, n })) },
        { list: { kind: 'people', items: t.items.map(p => ({ id: p.id, name: displayName(p) })) },
          card: { kind: 'list', title: `${t.count} ${label}`, items: t.items.map(p => ({ label: displayName(p), sub: p.major || '' })), more: t.more ? { count: t.more, link: link(ctx, 'View all', 'guides') } : null } });
    }
  }
];

const ref = p => ({ id: p.id, name: displayName(p) });
const brief = (p, ctx) => ({ id: p.id, name: displayName(p), active: p.active !== false, ...(can('people.read', ctx.who) ? { major: p.major || undefined } : {}) });
