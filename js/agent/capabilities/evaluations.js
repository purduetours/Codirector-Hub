/* Evaluations: who still needs one, who is high priority, where an evaluation could
   happen this week, and (with confirmation) putting an evaluator on a tour.

   The ranking and matching are the Hub's own engine (js/core/evalmatch.js, the same
   one behind Evaluation Roster > Auto-match). Vanessa asks it and explains; she does
   not rank anyone herself. */
import { Num, num, count, names, firstName, possessive, join, whenWords, s as pl, are, has, or } from '../engine/respond.js';
import { windowArgs, rangeArgs, person, plainSlot, chips, bandLabel, hasTag, hasToken } from './util.js';
import { displayName } from '../entities.js';

const TERM = 'this semester';
const STATUS_FILTER = { unassigned: 'unassigned', claimed: 'claimed', done: 'done' };
const noun = (n, major) => `${major ? major + ' ' : ''}Tour Guide${pl(n)}`;

/** Shared by evaluation.needs and evaluation.priority. */
async function needsRun(q, t, forceHigh) {
  const f = q.filters, p = person(q);
  if (p) { const r = await t.must('get_person_profile', { person: p.id }); return { mode: 'person', d: r.data, p, r }; }
  const priority = forceHigh ? 'High' : f.priority;
  const filter = STATUS_FILTER[f.status] || (priority === 'High' ? 'high_priority' : 'needs_eval');
  const r = await t.must('list_eval_roster', { filter, ...(priority && filter !== 'high_priority' ? { band: priority } : {}), ...(f.major ? { major: f.major } : {}), ...(f.dateRange && !f.dateRange.vague ? rangeArgs(f.dateRange) : {}), limit: 8 });
  return { mode: 'list', d: r.data, filter, priority, major: f.major, range: f.dateRange };
}

function needsRespond(res, q, t) {
  const { d } = res;
  if (res.mode === 'person') {
    const e = d.evaluation, name = res.p.label, first = firstName(name);
    let text;
    if (!e) text = `I can’t see ${possessive(name)} evaluation status.`;
    else if (e.status === 'not_on_roster') text = `${name} isn’t on this semester’s evaluation roster.`;
    else if (e.status === 'open') text = `Yes — ${name} still needs an evaluation${e.priority ? ` (${e.priority})` : ''} and doesn’t have an evaluator yet.`;
    else if (e.status === 'claimed') text = `${name} still needs an evaluation, but ${e.evaluator || 'an evaluator'} is already lined up${e.date ? ` for ${e.date}` : ''}.`;
    else if (e.status === 'submitted' || e.status === 'reviewed') text = `${name} has already been evaluated this semester.`;
    else if (e.status === 'skip') text = `${name} doesn’t need an evaluation ${TERM}.`;
    else text = `${name}’s evaluation status is ${e.status}.`;
    return { text, cards: 'drop', suggest: e?.status === 'open' ? chips(`Who can evaluate ${first}?`) : chips(`When is ${possessive(first)} next tour?`) };
  }
  const n = d.count, total = d.total ?? n, high = d.high_priority_total ?? 0, major = res.major;
  const withWindow = !!d.window;
  const list = d.people || [];
  let text, suggest;
  if (res.filter === 'high_priority') {
    text = n ? `${Num(n)} ${noun(n, major)} ${n === 1 ? 'is' : 'are'} high priority and still ${n === 1 ? 'needs' : 'need'} an evaluation${withWindow ? ` with a tour ${d.window}` : ''}${n <= 3 ? `: ${names(list.map(x => x.name))}.` : '.'}`
      : withWindow ? `None of the high-priority guides have a tour ${d.window}.` : `No ${major ? major + ' ' : ''}guides are high priority right now.`;
  } else if (res.filter === 'unassigned') {
    text = n ? `${Num(n)} ${noun(n, major)} still ${n === 1 ? 'has' : 'have'} no evaluator assigned${withWindow ? ` and ${n === 1 ? 'has a tour' : 'have tours'} ${d.window}` : ''}.${high && !res.priority ? ` ${Num(high)} ${are(high)} high priority.` : ''}` : 'Every guide who needs an evaluation has an evaluator lined up.';
  } else if (res.filter === 'claimed') {
    text = n ? `${Num(n)} ${noun(n, major)} ${has(n)} an evaluator assigned but ${n === 1 ? 'hasn’t' : 'haven’t'} been evaluated yet.` : 'Nobody is waiting on an assigned evaluation right now.';
  } else if (res.filter === 'done') {
    text = n ? `${Num(n)} ${noun(n, major)} ${has(n)} been evaluated ${TERM}.` : `Nobody has been evaluated ${TERM} yet.`;
  } else if (withWindow) {
    const hiTouring = d.high_priority_in_list ?? 0, when = whenWords(res.range) || d.window;
    text = total ? join(`${Num(total)} ${noun(total, major)} still ${total === 1 ? 'needs' : 'need'} an evaluation.`,
      n ? `${Num(n)} ${n === 1 ? 'has a tour' : 'have tours'} ${when}${hiTouring ? (hiTouring === high && high > 1 ? `, including ${high === 2 ? 'both' : 'all ' + num(high)} high-priority guides` : n === 1 ? ' and is high priority' : `, including ${num(hiTouring)} high-priority`) : ''}.` : `None of them have a tour ${when}.`)
      : `Nobody still needs an evaluation ${TERM}.`;
  } else {
    text = n ? join(`${Num(n)} active ${noun(n, major)} still ${n === 1 ? 'needs' : 'need'} an evaluation ${TERM}.`, high ? `${Num(high)} ${are(high)} marked high priority.` : '') : `Nobody${major ? ' in ' + major : ''} still needs an evaluation ${TERM}.`;
  }
  if (n && n <= 3 && res.filter !== 'high_priority') text = text.replace(/\.$/, `: ${names(list.map(x => `${x.name}${x.band === 'High' ? ' (high priority)' : ''}`))}.`);
  suggest = n ? chips(withWindow ? null : 'Find evaluation opportunities this week', res.filter !== 'high_priority' && high ? 'Who is high priority?' : null, withWindow ? 'Who is the best one to evaluate?' : null) : chips('How are evaluations going?');
  return { text, cards: n && n > 3 ? undefined : 'drop', suggest };
}

const PEOPLE_STATUS = { open: 'needs an evaluator', claimed: 'has an evaluator', submitted: 'was evaluated', reviewed: 'was evaluated', skip: 'doesn’t need one' };

export default {
  id: 'evaluations', label: 'Evaluations',
  intents: {
    'evaluation.needs': {
      permission: 'evaluations.read', mode: 'read', people: 'optional', params: ['dateRange', 'priority', 'major', 'status', 'limit'], promote: {},
      run: (q, t) => needsRun(q, t, false), respond: needsRespond
    },
    'evaluation.priority': {
      permission: 'evaluations.read', mode: 'read', people: 'optional', params: ['dateRange', 'major', 'status', 'limit'], promote: {},
      run: (q, t) => needsRun(q, t, true), respond: needsRespond
    },

    'evaluation.status': {
      permission: 'evaluations.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_eval_status'); return { d: r.data }; },
      respond({ d }) {
        const left = d.still_need_evaluated;
        const text = left ? join(`${Num(left)} of ${d.need_evaluation} guides still need an evaluation ${TERM}${d.high_priority_still_needed ? ` (${num(d.high_priority_still_needed)} high priority)` : ''}.`,
          d.no_evaluator_yet ? `${Num(d.no_evaluator_yet)} ${has(d.no_evaluator_yet)} no evaluator yet${d.high_priority_without_evaluator ? `, including ${num(d.high_priority_without_evaluator)} high-priority` : ''}.` : 'Every one of them has an evaluator lined up.', `${Num(d.done)} ${are(d.done)} done.`)
          : `Everyone who needs an evaluation ${TERM} has had one — ${d.done} done.`;
        return { text, suggest: left ? chips('Who still needs evaluated?', 'Find evaluation opportunities this week') : chips() };
      }
    },

    'evaluation.opportunities': {
      permission: 'evaluations.read', mode: 'read', people: 'optional', params: ['dateRange', 'priority', 'major', 'limit', 'ordinal'], promote: {},
      async run(q, t) {
        const f = q.filters, p = person(q);
        const best1 = hasTag(q, 'BEST') && !p && (f.limit == null || f.limit === 1);
        const r = await t.must('find_eval_opportunities', { ...(p ? { person: p.id } : {}), ...(f.dateRange && !f.dateRange.vague ? rangeArgs(f.dateRange) : {}), ...(f.priority ? { band: f.priority } : {}), ...(f.major ? { major: f.major } : {}), limit: f.limit || 6 });
        return { d: r.data, p, range: f.dateRange, best1, priority: f.priority, ordinal: f.ordinal };
      },
      respond({ d, p, range, best1, priority, ordinal }, q, t) {
        if (p) {
          const name = p.label, first = firstName(name);
          if (d.message) return { text: d.message, cards: 'drop' };
          const free = (d.options || []).filter(o => o.evaluators_free.length);
          if (!free.length) return { text: `${name} has no tour where an evaluator is free right now.`, cards: 'drop' };
          const o = free[0];
          return { text: join(`${name}${d.priority && d.priority !== 'None' && d.priority !== 'Low' ? ` (${bandLabel(d.priority)})` : ''} tours ${plainSlot(o.tour)}, and ${or(o.evaluators_free.slice(0, 3).map(x => x.replace(/ \(.*\)$/, '')))} ${o.evaluators_free.length === 1 ? 'is' : 'are'} free to evaluate.`, free.length > 1 ? `They have ${num(free.length)} upcoming tours with someone free.` : ''),
            suggest: t.can('evaluations.write') ? chips(`Assign ${o.evaluators_free[0].replace(/ \(.*\)$/, '')} to ${name}`) : chips() };
        }
        const label = whenWords(range) || (d.window && d.window !== 'upcoming' ? d.window : 'coming up');
        if (!d.viable_matches) {
          const why = d.unmatched_reasons?.[0];
          return { text: join(`I don’t see a viable evaluation ${range ? label : 'coming up'}${priority ? ` for ${bandLabel(priority)} guides` : ''}.`, why ? `${why.guide}: ${why.reason}` : '', d.need_evaluator ? '' : 'Nobody is waiting on an evaluator.'), cards: 'drop' };
        }
        const b = d.best[0], pick = ordinal != null ? d.best[ordinal === -1 ? d.best.length - 1 : ordinal] || b : b;
        const hi = pick.priority === 'High';
        const first = firstName(pick.guide);
        const lead = ordinal != null ? `Here’s match ${(ordinal === -1 ? d.best.length : ordinal + 1)}: ${pick.guide}.` : best1 ? `${pick.guide} is the strongest opportunity.` : join(`${Num(d.viable_matches)} viable evaluation${pl(d.viable_matches)} ${label}${d.across_tours > 1 ? ` across ${count(d.across_tours, 'tour')}` : ''}.`, `The strongest is ${pick.guide}.`);
        const text = join(lead, `${first} tours ${plainSlot(pick.tour)}, and ${pick.evaluator} is free to evaluate.`, hi ? `${first} is marked high priority.` : '');
        const dialog = { selected: { kind: 'match', mid: pick.match_id, guide: pick.guide } };
        return { text, dialog, cards: best1 ? 'drop' : undefined, suggest: t.can('evaluations.write') ? chips('Set it up', d.viable_matches > 1 && best1 ? `Find evaluation opportunities ${label === 'coming up' ? 'this week' : label}` : null) : chips() };
      }
    },

    'evaluation.assign': {
      permission: 'evaluations.write', mode: 'write', confirm: 'always', people: 'many', ownsPeople: true, params: ['dateRange', 'ordinal', 'limit', 'people'],
      async run(q, t) {
        const f = q.filters, pr = t.ctx.state.proposals;
        const fromProposal = pr && Date.now() - pr.at < 15 * 60e3 && pr.matches?.length && (!f.people?.length || hasTag(q, 'SETITUP'));
        if (fromProposal && !(f.people || []).length) {
          const sel = t.dialog?.selected?.kind === 'match' ? t.dialog.selected.mid : null;
          const args = f.ordinal != null ? { match_ids: [`m${f.ordinal === -1 ? pr.matches.length : f.ordinal + 1}`] } : hasToken(q, 'all', 'everyone', 'every') ? { all: true } : f.limit > 1 ? { top: f.limit } : sel ? { match_ids: [sel] } : { top: 1 };
          const r = await t.must('apply_eval_matches', args);
          return { r, how: 'proposal' };
        }
        const [a, b] = await roles(q, t);
        const date = f.dateRange?.from && f.dateRange.from === f.dateRange.to ? f.dateRange.from : undefined;
        const time = f.dateRange?.at;
        const r = await t.must('assign_evaluation', { assignments: [{ guide: b.id, evaluator: a.label, ...(date ? { date } : {}), ...(time ? { time } : {}) }] });
        return { r, how: 'explicit' };
      },
      respond: () => ({ text: '' })
    },

    'evaluation.set_priority': {
      permission: 'evaluations.write', mode: 'write', confirm: 'always', people: 'many', params: ['priority', 'people'],
      async run(q, t) {
        const f = q.filters;
        if (!f.priority) return { ask: 'Which priority should I set — high, normal or low?' };
        const r = await t.must('change_eval_priority', { people: f.people.map(p => p.id), priority: f.priority });
        return { r };
      },
      respond: () => ({ text: '' })
    },

    'evaluation.set_need': {
      permission: 'evaluations.write', mode: 'write', confirm: 'always', people: 'many', params: ['people'],
      async run(q, t) {
        const ids = q.filters.people.map(p => p.id);
        if (hasToken(q, 'roster') && hasTag(q, 'ADD')) return { r: await t.must('add_to_eval_roster', { people: ids }) };
        const needs = !(hasTag(q, 'NEG', 'SKIP') || hasToken(q, 'skip', 'exempt', 'waive', 'exclude'));
        return { r: await t.must('set_eval_need', { people: ids, needs }) };
      },
      respond: () => ({ text: '' })
    },

    'evaluation.mine': {
      permission: 'self.read', mode: 'read', people: 'none', params: [],
      async run(q, t) { const r = await t.must('get_next_tour', {}); return { d: r.data }; },
      respond({ d }) {
        const e = d.next_evaluation;
        return { text: e ? `You’re evaluating ${e.guide} ${e.when}.` : 'You don’t have any evaluations on the schedule.', cards: 'drop', suggest: chips('When is my next tour?') };
      }
    },

    'evaluation.evaluators': {
      permission: 'evaluations.read', mode: 'read', people: 'none', params: ['dateRange'],
      async run(q, t) {
        const dr = q.filters.dateRange;
        const r = await t.must('get_evaluators', dr ? { from: dr.from, to: dr.to, ...(dr.at ? { time: dr.at } : {}) } : {});
        return { d: r.data, range: dr };
      },
      respond({ d, range }) {
        const l = d.evaluators || [];
        const free = d.free_at ? l.filter(e => e.free && !e.paused) : null;
        const text = free
          ? (free.length ? `${Num(free.length)} evaluator${pl(free.length)} ${free.length === 1 ? 'is' : 'are'} free ${whenWords(range) || d.free_at}: ${names(free.map(e => e.name), 6)}.` : `Nobody on the evaluation team is free ${whenWords(range) || d.free_at}.`)
          : `${Num(l.length)} people can evaluate: ${names(l.map(e => `${e.name} (${e.evaluations})`), 6)}.`;
        return { text: join(text, d.availability_note ? 'I only know existing evaluation bookings, not personal availability.' : ''), cards: 'drop' };
      }
    }
  }
};

/**
 * Who is the evaluator and who is the guide? Said by the sentence ("assign X to Y"),
 * checked against the Hub: the evaluator must be on the evaluation team, the guide on the
 * roster still needing one. A first name shared by two guides is settled the same way
 * (only one of them needs an evaluation and tours that day).
 */
async function roles(q, t) {
  const ppl = q.filters.people || [];
  if (ppl.length < 2) throw t.stop(ppl.length ? 'Who should evaluate them?' : 'Who is evaluating whom? Give me both names, like “assign Taylor to evaluate Jordan Thursday”.');
  const f = q.filters, date = f.dateRange?.from && f.dateRange.from === f.dateRange.to ? f.dateRange : null;
  const ev = (await t.must('get_evaluators', {}, { card: false })).data.evaluators.map(e => ({ id: e.id, name: e.name }));
  const open = (await t.must('list_eval_roster', { filter: 'unassigned', ...(date ? windowArgs(date) : {}), limit: 30 }, { card: false })).data.people;
  const openIds = new Set(open.map(x => x.id));
  const asEvaluator = p => { const c = p.status === 'many' ? p.candidates : [p]; const m = c.filter(x => ev.some(e => e.name.toLowerCase() === (x.label || displayName(x)).toLowerCase())); return m.length === 1 ? { id: m[0].id, label: m[0].label || displayName(m[0]) } : null; };
  const asGuide = p => { const c = p.status === 'many' ? p.candidates : [p]; const m = c.filter(x => openIds.has(x.id)); return m.length === 1 ? { id: m[0].id, label: m[0].label || displayName(m[0]) } : (m.length > 1 ? { many: m } : null); };
  const [x, y] = ppl;
  const fwd = { e: asEvaluator(x), g: asGuide(y) }, rev = { e: asEvaluator(y), g: asGuide(x) };
  let pick = fwd.e && fwd.g ? fwd : rev.e && rev.g && !(fwd.e || fwd.g) ? rev : null;
  if (!pick) pick = fwd.e || fwd.g ? fwd : rev;
  const g = pick.g, e = pick.e;
  if (g?.many) throw t.ask(`Which ${firstName(g.many[0].label)} do you mean?`, g.many.map(m => ({ label: m.label, value: m.id })), 'guide');
  if (!e) throw t.stop(`${x.label || y.label} isn’t on the evaluation team (training committee or admins), so I can’t assign them as an evaluator.`);
  if (!g) { const who = (pick === fwd ? y : x); throw t.stop(`${who.label || who.candidates?.[0]?.label || 'That guide'} doesn’t need an evaluator${date ? ' on a tour that day' : ' right now'}, so I won’t assign one.`); }
  return [e, g];
}
