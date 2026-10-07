/* Evaluations. The matching itself is js/core/evalmatch.js, the same engine behind
   Admin > Evaluation Roster > Auto-match; Vanessa only calls it and explains. */
import { ok, ToolError, personFrom, peopleFrom, directory, top, plural, link, displayName, untrusted, windowOf, when, addDays, clock, first, slotLabel } from './kit.js';
import { writeTool, RISK, bySize, tally } from './write.js';
import { suggestMatches, rankFreeEvaluators, bookedSlots, priorityBand } from '../../evalmatch.js';
import { resolvePerson } from '../entities.js';
import { fromToday } from '../time.js';
import { can } from '../capabilities.js';

const S = (o = {}) => ({ type: 'string', ...o });
const timeProps = {
  when: S({ maxLength: 60, description: 'Natural time: "this week", "tomorrow", "Thursday", "next week".' }),
  date: S({ format: 'date' }), from: S({ format: 'date' }), to: S({ format: 'date' }), label: S({ maxLength: 60 }),
  after_time: S({ format: 'time' }), before_time: S({ format: 'time' }), at_time: S({ format: 'time' })
};
const BAND_LABEL = { High: 'high priority', Normal: 'normal priority', Low: 'low priority', None: 'no evaluation needed' };
const bandOf = g => priorityBand(g.rank, !g.skip);
const STATUS = { open: 'Needs an evaluator', claimed: 'Evaluator assigned', submitted: 'Submitted', reviewed: 'Reviewed', skip: 'Not needed this semester' };

async function load(ctx, { force = false } = {}) {
  const r = await ctx.deps.roster({ force });
  if (!r.ok) throw new ToolError('roster_unavailable', 'The evaluation roster isn’t loading right now.');
  const dir = await directory(ctx);
  const info = new Map(dir.people.map(p => [p.id, p]));
  const evaluators = await ctx.deps.evaluators(r.guides);
  return { guides: r.guides.map(g => ({ ...g, tourEligible: info.get(g.guideId)?.tourEligible, memberId: info.get(g.guideId)?.memberId, major: info.get(g.guideId)?.major })), evaluators, dir };
}
const nextTourOf = (g, today) => (g.tours || []).find(t => t.date >= today);
const shape = (ctx, g, today) => ({ id: g.guideId, name: g.name, priority: g.priority || undefined, band: bandOf(g), status: STATUS[g.status] || g.status, evaluator: g.evaluator || undefined,
  next_tour: nextTourOf(g, today) ? slotLabel(ctx, nextTourOf(g, today)) : null, next_tour_date: nextTourOf(g, today)?.date });

/** Window-limited copy of the roster for the engine, so "this week" means tours this week. */
function inWindow(guides, win) {
  return guides.map(g => ({ ...g, tours: (g.tours || []).filter(t => (!win.from || t.date >= win.from) && (!win.to || t.date <= win.to) && timeOk(t.start, win)) }));
}
/** A tour's start time against "afternoon", "after 2 PM", "at 10". */
function timeOk(start, w) {
  if (!(w.after || w.before || w.at)) return true;
  const x = String(start || '').slice(0, 5); if (!x) return false;
  return !(w.at && x !== w.at) && !(w.after && x < w.after) && !(w.before && x >= w.before);
}

export const tools = [
  {
    name: 'get_eval_status', cap: 'evaluations.read', status: 'Checking the evaluation roster…', show: true,
    description: 'Overall evaluation picture this semester: how many guides still need to be evaluated, how many have no evaluator yet, how many are high priority, how many are done. Use first for "who still needs evaluated", then list_eval_roster for names.',
    input_schema: { type: 'object', properties: {} },
    async run(_a, ctx) {
      const { guides } = await load(ctx);
      const needed = guides.filter(g => !g.skip && g.status !== 'skip');
      const open = needed.filter(g => g.status === 'open'), claimed = needed.filter(g => g.status === 'claimed');
      const done = needed.filter(g => g.status === 'submitted' || g.status === 'reviewed');
      const high = [...open, ...claimed].filter(g => bandOf(g) === 'High');
      const data = { semester: ctx.term?.label, on_roster: guides.length, need_evaluation: needed.length, still_need_evaluated: open.length + claimed.length, no_evaluator_yet: open.length, evaluator_assigned_not_done: claimed.length,
        done: done.length, high_priority_still_needed: high.length, high_priority_without_evaluator: open.filter(g => bandOf(g) === 'High').length, not_needed: guides.length - needed.length };
      return ok(data, { card: { kind: 'rows', title: 'Evaluations this semester', rows: [['Still need evaluated', `${data.still_need_evaluated} (${data.high_priority_still_needed} high priority)`], ['No evaluator yet', String(data.no_evaluator_yet)], ['Evaluator assigned', String(data.evaluator_assigned_not_done)], ['Done', `${data.done} of ${data.need_evaluation}`]],
        links: [link(ctx, 'Open Evaluation Roster', 'evalroster')], asks: data.still_need_evaluated ? ['Who is high priority?', 'Find eval opportunities this week'] : [] } });
    }
  },
  {
    name: 'list_eval_roster', cap: 'evaluations.read', status: 'Reading the roster…', show: true,
    description: 'Names from the evaluation roster by filter: needs_eval (not yet evaluated, including those with an evaluator assigned), unassigned (no evaluator yet), high_priority (still needed, top priority band), claimed (evaluator assigned), done (submitted or reviewed — "recently evaluated"), not_on_roster. Optionally narrow by priority band or major. Results are sorted by priority then name, with each person\'s next tour.',
    input_schema: { type: 'object', properties: { filter: S({ enum: ['needs_eval', 'unassigned', 'high_priority', 'claimed', 'done', 'not_on_roster'] }), band: S({ enum: ['High', 'Normal', 'Low'] }), major: S({ maxLength: 60 }), ...timeProps, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['filter'] },
    async run({ filter, band, major, limit = 10, ...timeArgs }, ctx) {
      const { guides, dir } = await load(ctx);
      const { today } = clock(ctx.now, ctx.tz);
      let list;
      if (filter === 'not_on_roster') {
        const on = new Set(guides.map(g => g.guideId));
        const items = dir.people.filter(p => p.active !== false && !on.has(p.id)).sort((a, b) => a.last.localeCompare(b.last));
        const t = top(items, limit);
        return ok({ count: t.count, people: t.items.map(p => ({ id: p.id, name: displayName(p) })), not_shown: t.more }, { list: { kind: 'people', items: t.items.map(p => ({ id: p.id, name: displayName(p) })) } });
      }
      list = guides.filter(g => !g.skip && g.status !== 'skip');
      if (filter === 'needs_eval') list = list.filter(g => g.status === 'open' || g.status === 'claimed');
      else if (filter === 'unassigned') list = list.filter(g => g.status === 'open');
      else if (filter === 'high_priority') list = list.filter(g => (g.status === 'open' || g.status === 'claimed') && bandOf(g) === 'High');
      else if (filter === 'claimed') list = list.filter(g => g.status === 'claimed');
      else if (filter === 'done') list = list.filter(g => g.status === 'submitted' || g.status === 'reviewed');
      if (band) list = list.filter(g => bandOf(g) === band);
      if (major) list = list.filter(g => (g.major || '').toLowerCase().includes(major.toLowerCase()));
      list.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));
      const total = list.length, highTotal = list.filter(g => bandOf(g) === 'High').length;
      let windowLabel;
      if (timeArgs.when || timeArgs.date || timeArgs.from || timeArgs.to) {
        const w = fromToday(windowOf(ctx, timeArgs), today), now = clock(ctx.now, ctx.tz).time;
        windowLabel = w.label;
        list = list.filter(g => (g.tours || []).some(x => x.date >= w.from && x.date <= w.to && (x.date > today || String(x.start || '').slice(0, 5) >= now) && timeOk(x.start, w)));
      }
      const t = top(list, limit);
      const high = list.filter(g => bandOf(g) === 'High').length;
      return ok({ filter, count: t.count, total, high_priority_total: highTotal, high_priority_in_list: high, ...(windowLabel ? { window: windowLabel, touring_in_window: t.count } : {}), people: t.items.map(g => shape(ctx, g, today)), not_shown: t.more },
        { list: { kind: 'people', items: t.items.map(g => ({ id: g.guideId, name: g.name })) },
          card: { kind: 'list', title: `${t.count} ${filter === 'high_priority' ? 'high-priority guides still need evaluated' : filter === 'unassigned' ? 'guides have no evaluator yet' : filter === 'done' ? 'guides evaluated this semester' : filter === 'claimed' ? 'guides have an evaluator assigned' : 'guides still need evaluated'}${windowLabel ? ` · touring ${windowLabel}` : ''}`,
            items: t.items.map(g => ({ label: g.name, sub: [BAND_LABEL[bandOf(g)] ? bandOf(g) : '', g.evaluator ? `evaluator ${g.evaluator}` : '', nextTourOf(g, today) ? `next tour ${slotLabel(ctx, nextTourOf(g, today))}` : 'no upcoming tour'].filter(Boolean).join(' · '), badge: bandOf(g) === 'High' ? 'High' : '' })),
            more: t.more ? { count: t.more, link: link(ctx, 'View all', 'evalroster') } : null } });
    }
  },
  {
    name: 'get_evaluators', cap: 'evaluations.read', status: 'Checking evaluators…',
    description: 'The people who can evaluate (training team and admins), how many evaluations each already has, and whether they are paused for auto-match. Optionally say who is free at a particular date/time.',
    input_schema: { type: 'object', properties: { ...timeProps, time: S({ format: 'time' }) } },
    async run(args, ctx) {
      const { guides, evaluators } = await load(ctx);
      const busy = bookedSlots(guides);
      let list = evaluators.map(e => ({ id: e.id, name: e.name, evaluations: e.workload, paused: !e.available }));
      let label;
      if (args.date || args.when) { const w = windowOf(ctx, args); label = `${w.label}${args.time ? ' ' + args.time : ''}`; list = list.map(e => ({ ...e, free: !busy.get(e.id)?.has(`${w.from}|${args.time || ''}`) })); }
      return ok({ evaluators: list.slice(0, 20), count: list.length, free_at: label, availability_note: 'The Hub only knows existing evaluation bookings and who is paused; it does not know personal availability.' });
    }
  },
  {
    name: 'find_eval_opportunities', cap: 'evaluations.read', status: 'Comparing evaluator availability…', show: true,
    description: 'Find viable evaluations using the Hub\'s real auto-match engine: guides who still need an evaluator, matched to an upcoming tour in the time window and a free evaluator, highest priority first. With `person`, shows each upcoming tour of that guide and the evaluators free at it ("who can evaluate Jordan"). Results are remembered so the user can say "set that up" and you can call apply_eval_matches. Always relay the reasons briefly.',
    input_schema: { type: 'object', properties: { ...timeProps, person: S({ maxLength: 80 }), band: S({ enum: ['High', 'Normal', 'Low'], description: 'Only guides in this priority band.' }), major: S({ maxLength: 60 }), limit: { type: 'integer', minimum: 1, maximum: 20 } } },
    async run(args, ctx) {
      const { guides, evaluators, dir } = await load(ctx);
      const { today, time } = clock(ctx.now, ctx.tz);
      const hasWin = !!(args.when || args.date || args.from);
      const win = hasWin ? fromToday(windowOf(ctx, args), today) : { from: today, to: addDays(today, 60), label: 'in the coming weeks' };
      const busy = bookedSlots(guides);
      if (args.person) {
        const p = await personFrom(ctx, args.person);
        const g = guides.find(x => x.guideId === p.id);
        if (!g) return ok({ person: displayName(p), on_roster: false, message: `${displayName(p)} isn’t on this semester’s evaluation roster.` });
        if (g.status !== 'open') return ok({ person: displayName(p), status: STATUS[g.status] || g.status, message: g.status === 'claimed' ? `${displayName(p)} already has ${g.evaluator || 'an evaluator'}${g.date ? ' on ' + when(ctx, g.date, g.time) : ''}.` : `${displayName(p)} doesn’t need an evaluator right now (${STATUS[g.status] || g.status}).` });
        const tours = (g.tours || []).filter(t => t.date >= win.from && t.date <= win.to && (t.date > today || String(t.start).slice(0, 5) > time)).slice(0, 4);
        if (!tours.length) return ok({ person: displayName(p), tours: [], message: `${displayName(p)} has no tour ${hasWin ? win.label : 'coming up'} on the schedule.` });
        const load0 = new Map(evaluators.map(e => [e.id, e.workload]));
        const options = tours.map(t => ({ tour: slotLabel(ctx, t), date: t.date, start: t.start, free: rankFreeEvaluators({ guide: g, tour: t, evaluators: evaluators.filter(e => e.available), taken: busy, load: load0 }).slice(0, 5).map(e => ({ id: e.id, name: e.name, evaluations: e.workload })) }));
        const matches = options.filter(o => o.free.length).map(o => ({ evalId: g.id, guideId: g.guideId, guideName: g.name, date: o.date, start: o.start, evaluatorId: o.free[0].id, evaluatorName: o.free[0].name, reasons: [`${o.free[0].name} has no other evaluation at that time`, `${o.free[0].name} has ${o.free[0].evaluations} evaluation${o.free[0].evaluations === 1 ? '' : 's'} so far`] }));
        ctx.state.proposals = { at: Date.now(), matches: matches.map((m, i) => ({ ...m, mid: `m${i + 1}` })) };
        return ok({ person: displayName(p), priority: bandOf(g), options: options.map(o => ({ tour: o.tour, evaluators_free: o.free.map(f => `${f.name} (${f.evaluations} so far)`) })), availability_note: 'Only existing evaluation bookings are checked; personal availability isn\'t tracked.' },
          { focus: { person: { id: p.id, name: displayName(p) } },
            card: { kind: 'list', title: `Who can evaluate ${first(displayName(p))}`, items: options.map(o => ({ label: o.tour, sub: o.free.length ? o.free.map(f => f.name).join(', ') : 'Nobody is free' })) } });
      }
      const plan = suggestMatches({ guides: inWindow(guides, win), evaluators: evaluators.filter(e => e.available), busy, today, now: time });
      const reason = hasWin ? `No tour ${win.label}.` : null;
      const keep = x => (!args.band || priorityBand(x.rank) === args.band) && (!args.major || (guides.find(g => g.guideId === x.guideId)?.major || '').toLowerCase().includes(args.major.toLowerCase()));
      plan.matches = plan.matches.filter(keep); plan.unable = plan.unable.filter(u => keep({ rank: u.guide.rank, guideId: u.guide.guideId }));
      const matches = plan.matches.map((m, i) => ({ ...m, mid: `m${i + 1}` }));
      ctx.state.proposals = { at: Date.now(), matches, window: win.label };
      const t = top(matches, args.limit || 6);
      const tourCount = new Set(matches.map(m => `${m.date}|${m.start}`)).size;
      return ok({ window: hasWin ? win.label : 'upcoming', need_evaluator: plan.needing, viable_matches: matches.length, across_tours: tourCount, conflicts_used_later_tour: plan.conflicts.length,
          unmatched: plan.unable.length, unmatched_reasons: top(plan.unable.map(u => ({ guide: u.guide.name, reason: reason || u.reason })), 5).items,
          best: t.items.map(m => ({ match_id: m.mid, guide: m.guideName, priority: priorityBand(m.rank), tour: slotLabel(ctx, m), evaluator: m.evaluatorName, why: m.reasons })), not_shown: t.more,
          availability_note: 'Only existing evaluation bookings are checked; personal availability isn\'t tracked.' },
        { card: { kind: 'list', title: `${plural(matches.length, 'viable evaluation')} ${hasWin ? win.label : 'coming up'}`,
            items: t.items.map(m => ({ label: `${m.guideName} · ${slotLabel(ctx, m)}`, sub: `${m.evaluatorName} · ${m.reasons.slice(0, 2).join('; ')}`, badge: m.rank <= 2 ? 'High' : '', ...(can('evaluations.write', ctx.who) ? { ask: `Assign match ${m.mid.slice(1)}`, askLabel: 'Assign' } : {}) })),
            more: t.more ? { count: t.more, link: link(ctx, 'Review all', 'evalroster', { tab: 'match' }) } : null, links: [link(ctx, 'Review in Auto-match', 'evalroster')], asks: matches.length && can('evaluations.write', ctx.who) ? ['Assign the best one'] : [] } });
    }
  },

  /* ----------------------------------------------------------------- writes */
  writeTool({
    name: 'change_eval_priority', cap: 'evaluations.write', status: 'Preparing the priority change…',
    description: 'Set the evaluation priority of one or more Tour Guides. Priority is a tier name from the Hub, or a band: "High", "Normal", "Low". Prepares the change for the user to confirm; does not save it.',
    input_schema: { type: 'object', properties: { people: { type: 'array', minItems: 1, maxItems: 40, items: S({ maxLength: 80 }) }, priority: S({ minLength: 2, maxLength: 60 }) }, required: ['people', 'priority'] },
    async prepare({ people, priority }, ctx) {
      const { guides } = await load(ctx);
      const tiers = (await ctx.deps.priorities()).slice().sort((a, b) => a.sort_order - b.sort_order);
      const needs = tiers.filter(t => t.needs_eval);
      let tier = tiers.find(t => t.name.toLowerCase() === priority.toLowerCase());
      if (!tier) { const b = priority.toLowerCase().replace(/ priority$/, ''); const idx = { high: 0, normal: 2, low: 4 }[b]; if (idx != null && needs.length) tier = needs[Math.min(idx, needs.length - 1)]; }
      if (!tier) throw new ToolError('bad_priority', `There's no priority called “${priority}”. The tiers are: ${tiers.map(t => t.name).join(', ')}.`);
      const found = await peopleFrom(ctx, people, { write: true });
      const rows = found.map(p => ({ p, g: guides.find(g => g.guideId === p.id) }));
      const notOn = rows.filter(r => !r.g).map(r => displayName(r.p));
      if (notOn.length === rows.length) throw new ToolError('not_on_roster', `${notOn.join(', ')} ${notOn.length === 1 ? 'isn’t' : 'aren’t'} on this semester’s evaluation roster. Add ${notOn.length === 1 ? 'them' : 'them'} to the roster first.`);
      const change = rows.filter(r => r.g && r.g.priority !== tier.name);
      const same = rows.filter(r => r.g && r.g.priority === tier.name).map(r => displayName(r.p));
      if (!change.length) throw new ToolError('no_change', `${same.join(', ')} ${same.length === 1 ? 'is' : 'are'} already at “${tier.name}”.`);
      const ids = change.map(r => r.p.id);
      const summary = `Change ${change.length === 1 ? displayName(change[0].p) + '’s' : change.length + ' guides’'} evaluation priority${change.length === 1 ? ` from ${change[0].g.priority || 'unset'}` : ''} to ${tier.name}.`;
      return {
        summary, risk: bySize(change.length, { high: 5 }),
        rows: [...change.slice(0, 8).map(r => [displayName(r.p), `${r.g.priority || 'unset'} → ${tier.name}`]), ...(change.length > 8 ? [['…', `and ${change.length - 8} more`]] : [])],
        warnings: [...(notOn.length ? [`Not on the roster, left out: ${notOn.join(', ')}.`] : []), ...(same.length ? [`Already at that priority: ${same.join(', ')}.`] : [])],
        params: { guide_ids: ids, priority: tier.name, names: change.map(r => displayName(r.p)) },
        execute: (p, c) => c.deps.rpc('admin_set_eval_priority', { p_guide_ids: p.guide_ids, p_priority: p.priority }),
        verify: async (p, _r, c) => { const r = await c.deps.roster({ force: true }); const done = r.guides.filter(g => p.guide_ids.includes(g.guideId) && g.priority === p.priority).length; return tally(done, p.guide_ids.length, 'priorities'); },
        receipt: p => `Set ${p.names.length === 1 ? p.names[0] + '’s' : p.names.length + ' guides’'} evaluation priority to ${p.priority}.`,
        links: [link(ctx, 'View roster', 'evalroster')], focus: { person: { id: ids[0], name: displayName(change[0].p) } }
      };
    }
  }),
  writeTool({
    name: 'assign_evaluation', cap: 'evaluations.write', status: 'Checking the evaluator is free…',
    description: 'Assign an evaluator to evaluate a Tour Guide on one of that guide\'s tours. Give guide and evaluator names; date/time optional (defaults to the guide\'s earliest upcoming tour where the evaluator is free). Prepares for confirmation; checks the guide needs an evaluator, is touring then, and the evaluator has no conflict.',
    input_schema: { type: 'object', properties: { assignments: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', properties: { guide: S({ minLength: 1, maxLength: 80 }), evaluator: S({ minLength: 1, maxLength: 80 }), date: S({ format: 'date' }), time: S({ format: 'time' }) }, required: ['guide', 'evaluator'] } } }, required: ['assignments'] },
    prepare: (args, ctx) => prepareAssignments(args.assignments, ctx)
  }),
  writeTool({
    name: 'apply_eval_matches', cap: 'evaluations.write', status: 'Preparing the assignments…',
    description: 'Assign the evaluator matches that find_eval_opportunities just produced. Use match_ids from that result (e.g. ["m1"]), or top=N for the first N, or all=true. Only works on the most recent proposal; if the roster has changed since, matches that are no longer valid are dropped and reported.',
    input_schema: { type: 'object', properties: { match_ids: { type: 'array', maxItems: 40, items: S({ pattern: '^m\\d{1,3}$' }) }, top: { type: 'integer', minimum: 1, maximum: 40 }, all: { type: 'boolean' } } },
    async prepare(args, ctx) {
      const pr = ctx.state.proposals;
      if (!pr || Date.now() - pr.at > 15 * 60e3) throw new ToolError('no_proposal', 'There are no recent matches to apply. Run find_eval_opportunities first.');
      let pick = pr.matches;
      if (args.match_ids?.length) pick = pr.matches.filter(m => args.match_ids.includes(m.mid));
      else if (args.top) pick = pr.matches.slice(0, args.top);
      else if (!args.all) throw new ToolError('which', 'Which matches? Give match_ids, top, or all.');
      if (!pick.length) throw new ToolError('no_match', 'None of those matches are in the latest proposal.');
      return prepareAssignments(pick.map(m => ({ guideId: m.guideId, evaluatorId: m.evaluatorId, date: m.date, time: m.start, reasons: m.reasons })), ctx, { fromProposal: true });
    }
  }),
  writeTool({
    name: 'set_eval_need', cap: 'evaluations.write', status: 'Preparing the change…',
    description: 'Mark Tour Guides as needing, or not needing, an evaluation this semester.',
    input_schema: { type: 'object', properties: { people: { type: 'array', minItems: 1, maxItems: 40, items: S({ maxLength: 80 }) }, needs: { type: 'boolean' } }, required: ['people', 'needs'] },
    async prepare({ people, needs }, ctx) {
      const { guides } = await load(ctx);
      const found = await peopleFrom(ctx, people, { write: true });
      const rows = found.map(p => ({ p, g: guides.find(g => g.guideId === p.id) })).filter(r => r.g && (needs ? r.g.skip : !r.g.skip));
      if (!rows.length) throw new ToolError('no_change', needs ? 'They already need an evaluation (or aren’t on the roster).' : 'They’re already marked as not needing one (or aren’t on the roster).');
      return { summary: `Mark ${rows.length === 1 ? displayName(rows[0].p) : rows.length + ' guides'} as ${needs ? 'needing' : 'not needing'} an evaluation this semester.`, risk: bySize(rows.length, { high: 5 }),
        rows: rows.slice(0, 8).map(r => [displayName(r.p), needs ? 'Needs evaluation' : 'No evaluation needed']), params: { guide_ids: rows.map(r => r.p.id), needs, names: rows.map(r => displayName(r.p)) },
        execute: (p, c) => c.deps.rpc('admin_set_eval_need', { p_guide_ids: p.guide_ids, p_needs: p.needs }),
        verify: async (p, _r, c) => { const r = await c.deps.roster({ force: true }); return tally(r.guides.filter(g => p.guide_ids.includes(g.guideId) && g.skip === !p.needs).length, p.guide_ids.length, 'guides'); },
        receipt: p => `Marked ${p.names.length === 1 ? p.names[0] : p.names.length + ' guides'} as ${p.needs ? 'needing' : 'not needing'} an evaluation.`, links: [link(ctx, 'View roster', 'evalroster')] };
    }
  }),
  writeTool({
    name: 'add_to_eval_roster', cap: 'evaluations.write', status: 'Preparing the roster change…',
    description: 'Add active Tour Guides who are not yet on this semester\'s evaluation roster. Priority optional (defaults to the first tier).',
    input_schema: { type: 'object', properties: { people: { type: 'array', minItems: 1, maxItems: 60, items: S({ maxLength: 80 }) }, priority: S({ maxLength: 60 }) }, required: ['people'] },
    async prepare({ people, priority }, ctx) {
      const { guides } = await load(ctx);
      const tiers = await ctx.deps.priorities();
      const tier = priority ? tiers.find(t => t.name.toLowerCase() === priority.toLowerCase()) : null;
      if (priority && !tier) throw new ToolError('bad_priority', `There's no priority called “${priority}”.`);
      const found = await peopleFrom(ctx, people, { write: true, activeOnly: true });
      const fresh = found.filter(p => !guides.some(g => g.guideId === p.id));
      if (!fresh.length) throw new ToolError('no_change', 'They’re all already on the roster.');
      return { summary: `Add ${fresh.length === 1 ? displayName(fresh[0]) : fresh.length + ' guides'} to the ${ctx.term?.label || 'current'} evaluation roster${tier ? ` at ${tier.name}` : ''}.`, risk: bySize(fresh.length, { high: 15 }),
        rows: fresh.slice(0, 8).map(p => [displayName(p), tier?.name || 'First priority']), params: { guide_ids: fresh.map(p => p.id), priority: tier?.name || null, names: fresh.map(displayName) },
        execute: (p, c) => c.deps.rpc('admin_add_to_eval_roster', { p_guide_ids: p.guide_ids, p_priority: p.priority }),
        verify: async (p, _r, c) => { const r = await c.deps.roster({ force: true }); return tally(r.guides.filter(g => p.guide_ids.includes(g.guideId)).length, p.guide_ids.length, 'guides'); },
        receipt: p => `Added ${p.names.length === 1 ? p.names[0] : p.names.length + ' guides'} to the evaluation roster.`, links: [link(ctx, 'View roster', 'evalroster')] };
    }
  })
];

/** Shared by assign_evaluation and apply_eval_matches: validate against the CURRENT roster. */
async function prepareAssignments(list, ctx, { fromProposal = false } = {}) {
  const { guides, evaluators } = await load(ctx, { force: true });
  const busy = bookedSlots(guides);
  const good = [], problems = [];
  const taken = new Map([...busy].map(([k, v]) => [k, new Set(v)]));
  for (const a of list) {
    let guide, ev, label;
    try {
      const p = a.guideId ? (await directory(ctx)).people.find(x => x.id === a.guideId) : await personFrom(ctx, a.guide, { write: true });
      if (!p) throw new ToolError('not_found', 'That guide is no longer in the list.');
      label = displayName(p);
      guide = guides.find(g => g.guideId === p.id);
      if (!guide) throw new ToolError('not_on_roster', `${label} isn’t on this semester’s evaluation roster.`);
      if (guide.status !== 'open') throw new ToolError('not_open', guide.status === 'claimed' ? `${label} already has an evaluator (${guide.evaluator}).` : `${label} doesn’t need an evaluator right now (${STATUS[guide.status] || guide.status}).`);
      if (a.evaluatorId) ev = evaluators.find(e => e.id === a.evaluatorId);
      else {
        const r = resolvePerson(a.evaluator, evaluators.map(e => { const [f, ...l] = e.name.split(' '); return { id: e.id, first: f, last: l.join(' '), active: true }; }));
        if (r.status === 'many') throw new ToolError('ambiguous', `More than one evaluator matches “${a.evaluator}”: ${r.candidates.map(c => c.first + ' ' + c.last).join(', ')}.`);
        if (r.status === 'none') throw new ToolError('not_found', `“${a.evaluator}” isn’t on the evaluation team (training committee or admin).`);
        if (r.fuzzy) throw new ToolError('confirm_name', `Did you mean ${r.person.first} ${r.person.last}? Confirm the evaluator’s name first.`);
        ev = evaluators.find(e => e.id === r.person.id);
      }
      if (!ev) throw new ToolError('not_found', 'That evaluator is no longer on the team.');
      if (ev.id === guide.memberId) throw new ToolError('self', `${ev.name} can’t evaluate their own tour.`);
      const { today, time } = clock(ctx.now, ctx.tz);
      const usable = (guide.tours || []).filter(t => t.date > today || (t.date === today && String(t.start).slice(0, 5) > time));
      let tour;
      if (a.date) {
        tour = usable.find(t => t.date === a.date && (!a.time || String(t.start).slice(0, 5) === String(a.time).slice(0, 5)));
        if (!tour) throw new ToolError('not_touring', `${label} isn’t on a tour ${when(ctx, a.date, a.time)} (or it has passed). ${usable[0] ? `Their next is ${slotLabel(ctx, usable[0])}.` : 'They have no upcoming tours listed.'}`);
      } else {
        tour = usable.find(t => !taken.get(ev.id)?.has(`${t.date}|${t.start || ''}`));
        if (!tour) throw new ToolError('no_tour', usable.length ? `${ev.name} is already booked at each of ${label}’s upcoming tours.` : `${label} has no upcoming tour on the schedule.`);
      }
      const k = `${tour.date}|${tour.start || ''}`;
      if (taken.get(ev.id)?.has(k)) throw new ToolError('conflict', `${ev.name} already has a conflicting evaluation at ${slotLabel(ctx, tour)}.`);
      (taken.get(ev.id) || taken.set(ev.id, new Set()).get(ev.id)).add(k);
      good.push({ guide, ev, tour, label, reasons: a.reasons, paused: !ev.available });
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      problems.push({ guide: label || a.guide || 'Someone', message: e.message, code: e.code, extra: e.extra });
    }
  }
  if (!good.length) {
    const only = problems[0];
    throw new ToolError(only.code || 'cannot_assign', problems.length === 1 ? only.message : `I couldn’t set any of these up: ${problems.map(p => `${p.guide}: ${p.message}`).join(' ')}`, only.extra || {});
  }
  const one = good.length === 1 ? good[0] : null;
  return {
    summary: one ? `Assign ${one.ev.name} to evaluate ${one.label} on ${slotLabel(ctx, one.tour)}.` : `Assign ${good.length} evaluations.`,
    risk: bySize(good.length, { high: 10 }),
    rows: good.slice(0, 10).map(x => [x.label, `${x.ev.name} · ${slotLabel(ctx, x.tour)}`]).concat(good.length > 10 ? [['…', `and ${good.length - 10} more`]] : []),
    warnings: [...problems.map(p => `Skipped ${p.guide}: ${p.message}`), ...good.filter(x => x.paused).map(x => `${x.ev.name} is paused for auto-match (you chose them directly).`),
      ...(fromProposal ? ['Availability beyond existing bookings isn’t tracked.'] : [])],
    reasons: one?.reasons,
    params: { assignments: good.map(x => ({ eval_id: x.guide.id, evaluator_id: x.ev.id, date: x.tour.date, time: x.tour.start || null, guide: x.label, evaluator: x.ev.name, when: slotLabel(ctx, x.tour).replace(/\s*\([^)]*\)\s*$/, '') })) },
    execute: (p, c) => c.deps.rpc('admin_assign_evaluations', { p_assignments: p.assignments.map(({ eval_id, evaluator_id, date, time }) => ({ eval_id, evaluator_id, date, time })) }),
    verify: async (p, r, c) => {
      const fresh = await c.deps.roster({ force: true });
      const done = p.assignments.filter(a => fresh.guides.some(g => g.id === a.eval_id && g.evaluatorId === a.evaluator_id && g.status === 'claimed')).length;
      const t = tally(done, p.assignments.length, 'assignments');
      if (r?.failed?.length) t.detail = `${done} of ${p.assignments.length} saved. ${r.failed.map(f => `${p.assignments.find(a => a.eval_id === f.eval_id)?.guide || 'One'}: ${f.reason}`).join(' ')}`;
      return t;
    },
    receipt: p => p.assignments.length === 1 ? `Assigned ${p.assignments[0].evaluator} to evaluate ${p.assignments[0].guide} ${p.assignments[0].when ? p.assignments[0].when : 'on ' + p.assignments[0].date}.` : `Assigned ${p.assignments.length} evaluations.`,
    links: [link(ctx, 'View evaluation roster', 'evalroster')],
    focus: { person: { id: good[0].guide.guideId, name: good[0].label } }
  };
}
