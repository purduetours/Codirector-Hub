// Standard Vanessa end to end: NO language model, NO network. A message goes in, the
// deterministic engine recognises it, runs the real typed tools against the fake Hub, and
// answers. These are the "final test scenarios" in Standard mode: conversation follow-ups,
// confirmed writes, permissions, the operations brief, honest failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../js/core/agent/engine/router.js';
import { handleReply } from '../../js/core/agent/runtime.js';
import { classifyReply } from '../../js/core/agent/pending.js';
import { view } from '../../js/core/agent/engine/dialog.js';
import { snapshot, resetMetrics } from '../../js/core/agent/engine/metrics.js';
import { makeDeps, freshConv, WHO } from './helpers.mjs';

// Standard mode must never touch the network: any attempt fails the test that made it.
const realFetch = globalThis.fetch; let fetched = [];
globalThis.fetch = (...a) => { fetched.push(String(a[0])); throw new Error('Standard Vanessa must not use the network'); };
test.after(() => { globalThis.fetch = realFetch; });

const SEEN = new Set();                        // every follow-up chip any answer offered
const wrote = deps => deps.calls.filter(([n]) => /^admin_/.test(n) || n === 'insert');
function harness(who = WHO.admin, o = {}) {
  const deps = makeDeps(who, undefined, o.deps), conv = freshConv();
  const engine = createEngine({ deps, local: null, isAdmin: () => !!who.admin });
  const say = async (text, extra = {}) => {
    const ev = [];
    if (conv.pending && classifyReply(text)) { const r = await handleReply({ text, conv, deps, ...extra }); return { reply: r, text: r.text, ok: r.ok, ev }; }
    const r = await engine.handle(text, { conv, emit: e => ev.push(e), ...extra });
    const chips = ev.find(e => e.type === 'suggest')?.items; if (!r.asked) (chips || []).forEach(c => SEEN.add(c));        // the options of a question are answers, not requests
    return { ...r, ev, cards: ev.filter(e => e.type === 'card').map(e => e.card), pending: ev.find(e => e.type === 'pending')?.pending, chips };
  };
  return { deps, conv, engine, say };
}

test('standard: next tour, for me and for someone else; an ambiguous first name asks which', async () => {
  const h = harness(WHO.member);
  let r = await h.say('When is my next tour?');
  assert.match(r.text, /Your next tour is Wednesday, Oct 7 at 11 AM with Pat Q/); assert.equal(r.info.engine, 'standard'); assert.equal(r.info.intent, 'schedule.next');
  r = await h.say("When is Jordan's next tour?");
  assert.match(r.text, /Which Jordan do you mean/); assert.deepEqual(r.chips, ['Jordan Lee (Data Science)', 'Jordan Smith (Computer Science)']);
  r = await h.say('the second one');
  assert.match(r.text, /Jordan Smith’s next tour is Thursday, Oct 8 at 2 PM, with Dana R/);
  r = await h.say('when is his next tour');
  assert.match(r.text, /Jordan Smith’s next tour/, 'a pronoun means the person just discussed');
  assert.deepEqual(wrote(h.deps), []);
});

test('standard: schedule by day, time of day, person and conflicts', async () => {
  const h = harness(WHO.member);
  let r = await h.say('who is touring tomorrow'); assert.match(r.text, /Three tour slots tomorrow with three guides/); assert.ok(r.cards.length);
  r = await h.say('who is touring friday afternoon'); assert.match(r.text, /Casey D\./); assert.doesNotMatch(r.text, /Alex G/, 'the 10 AM slot is not in the afternoon');
  r = await h.say('who is on the 2 pm tour thursday'); assert.match(r.text, /Jordan S\./);
  r = await h.say('when does Casey Diaz tour this week'); assert.match(r.text, /Casey Diaz has/);
  r = await h.say('any conflicts this week'); assert.match(r.text, /Pat Q\. is double-booked/);
  r = await h.say('any conflicts friday'); assert.match(r.text, /No schedule conflicts/);
});

test('standard: "Who still needs evaled this week?" then "Who\'s the best one Thursday?" then "Set it up" then yes', async () => {
  const h = harness(WHO.admin);
  let r = await h.say('Who still needs evaled this week?');
  assert.match(r.text, /Four Tour Guides still need an evaluation\. Three have tours this week, including both high-priority guides/); assert.equal(r.info.engine, 'standard');
  r = await h.say("Who's the best one Thursday?");
  assert.match(r.text, /Jordan Smith is the strongest opportunity\. Jordan tours Thursday, Oct 8 at 2 PM, and Riley Park is free to evaluate/); assert.match(r.text, /high priority/);
  assert.deepEqual(r.chips, ['Set it up']);
  r = await h.say('Set it up.');
  assert.ok(r.pending, 'a confirmation card'); assert.match(r.text, /I’ll assign Riley Park to evaluate Jordan Smith on Thursday, Oct 8 at 2 PM/); assert.match(r.text, /Press Confirm|say “yes”/);
  assert.deepEqual(wrote(h.deps), [], 'nothing is written before the yes');
  assert.equal(h.deps.world.roster.find(g => g.id === 'e1').status, 'open');
  r = await h.say('yes');
  assert.equal(r.ok, true); assert.match(r.text, /Assigned Riley Park to evaluate Jordan Smith/);
  const g = h.deps.world.roster.find(x => x.id === 'e1'); assert.equal(g.status, 'claimed'); assert.equal(g.evaluator, 'Riley Park');
  const call = h.deps.calls.find(([n]) => n === 'admin_assign_evaluations'); assert.ok(call[2].via.startsWith('act-'), 'audited as Vanessa on behalf of the person');
  assert.equal(h.conv.pending, null);
});

test('standard: follow-ups use stored state: another day, another person, "show me high priority", "the first one"', async () => {
  const h = harness(WHO.admin);
  await h.say('Who still needs evaluated?');
  assert.equal(view(h.conv).subject, 'evaluation');
  let r = await h.say('What about Thursday?');
  assert.equal(r.info.intent, 'evaluation.needs'); assert.equal(r.info.source, 'followup'); assert.match(r.text, /One has a tour on Thursday and is high priority/);
  r = await h.say('what about Casey Diaz?'); assert.match(r.text, /Casey Diaz still needs an evaluation|Yes — Casey Diaz/);
  r = await h.say('who still needs evaluated'); r = await h.say('show me high priority');
  assert.equal(r.info.intent, 'evaluation.priority'); assert.match(r.text, /Two Tour Guides are high priority/); assert.match(r.text, /Jordan Smith/);
  r = await h.say('the first one');
  assert.equal(r.info.intent, 'people.profile'); assert.match(r.text, /Jordan Smith is an active Tour Guide majoring in Computer Science/);
  assert.equal(view(h.conv).currentPerson.name, 'Jordan Smith');
  r = await h.say('who still needs evaluated'); r = await h.say('just the unassigned');
  assert.match(r.text, /no evaluator assigned/);
});

test('standard: "find me a high priority eval Thursday" is a multi-step business workflow, ranked by the Hub', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('Find me a high priority eval Thursday');
  assert.equal(r.info.intent, 'evaluation.opportunities');
  assert.match(r.text, /Jordan Smith/); assert.match(r.text, /Riley Park/);
  assert.ok(!/Casey/.test(r.text), 'Casey is not high priority and has no Thursday tour');
  assert.deepEqual(r.info.tools, ['find_eval_opportunities'], 'one tool call: the ranking is the Hub’s engine, not text');
});

test('standard: the spec example — a long, loosely-worded request is understood without a model', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('Do we have anybody that really needs an eval and is touring sometime Thursday afternoon?');
  assert.equal(r.info.engine, 'standard'); assert.equal(r.info.intent, 'evaluation.opportunities');
  assert.match(r.text, /Jordan Smith/);
});

test('standard: training — who missed, makeup, attendance, readiness, and a makeup through confirmation', async () => {
  const h = harness(WHO.admin);
  let r = await h.say('Who missed training?');
  assert.match(r.text, /One person missed training this week \(Accessibility Training\): Jordan Smith/);
  r = await h.say('Assign them to a makeup'); assert.match(r.text, /What day should the makeup be/); assert.equal(h.conv.pending, null);
  r = await h.say('Thursday'); assert.ok(r.pending); assert.match(r.text, /I’ll create a makeup for “Accessibility Training” on Thursday, Oct 8 and assign Jordan Smith/);
  assert.deepEqual(wrote(h.deps), []);
  r = await h.say('confirm'); assert.equal(r.ok, true);
  const call = h.deps.calls.find(([n]) => n === 'admin_make_makeup'); assert.deepEqual(call[1].p_guides, ['g1']); assert.equal(call[1].p_original, 's3'); assert.equal(call[1].p_date, '2026-10-08');
  r = await h.say('who needs a makeup'); assert.match(r.text, /Jordan Smith/);
  r = await h.say('attendance for accessibility training'); assert.match(r.text, /Accessibility Training/);
  r = await h.say('are we ready for training tomorrow'); assert.match(r.text, /New Guide Training.*isn’t ready/); assert.match(r.text, /Location/);
  r = await h.say('when is the next training'); assert.match(r.text, /New Guide Training/);
});

test('standard: the operations brief and "anything to worry about" read across schedule, evaluations, training and data', async () => {
  const h = harness(WHO.admin);
  let r = await h.say("What's going on today?");
  assert.equal(r.info.intent, 'operations.brief'); assert.equal(r.cards[0].kind, 'brief');
  assert.match(r.text, /need attention/); assert.match(r.text, /Pat Q\./); assert.match(r.text, /high-priority guide/); assert.match(r.text, /no location/);
  assert.deepEqual(r.info.failed, []);
  r = await h.say('Anything I need to worry about?');
  assert.equal(r.info.intent, 'operations.problems'); assert.match(r.text, /Five things need attention/);
  r = await h.say('is everything synced'); assert.match(r.text, /need.* a look|synced/i);
  r = await h.say('which names don’t match'); assert.match(r.text, /Jordy S\./); assert.match(r.text, /Jordan Smith/);
});

test('standard: people — search by major, profile, major of a person', async () => {
  const h = harness(WHO.admin);
  let r = await h.say('who are the cs majors'); assert.match(r.text, /Jordan Smith/); assert.match(r.text, /Alex Green/);
  r = await h.say('tell me about Casey'); assert.match(r.text, /Casey Diaz is an active Tour Guide/); assert.equal(r.cards[0].kind, 'person');
  r = await h.say("what is Jordan Smith's major"); assert.match(r.text, /Computer Science/);
  r = await h.say('the comp sci guy that needs evaluated'); assert.match(r.text, /Computer Science Tour Guide/); assert.match(r.text, /Jordan Smith|Alex Green/);
  r = await h.say('which guides have no major'); assert.match(r.text, /Casey Diaz|Pat Quinn/);
});

test('standard: coverage suggestions are suggestions, and say so', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('who could cover Casey tomorrow');
  assert.match(r.text, /free/); assert.doesNotMatch(r.text, /Pat Quinn|Dana/); assert.match(r.text, /can’t change the tour schedule/);
  assert.deepEqual(wrote(h.deps), []);
  const d = await h.say('which desk slots are uncovered'); assert.match(d.text, /desk slot/i);
});

test('standard: writes — add a guide, archive with a clarifying question, a typo is never trusted', async () => {
  const h = harness(WHO.admin);
  let r = await h.say('Add Alex Smith as a tour guide');
  assert.ok(r.pending, 'prepared'); assert.equal(h.deps.world.people.length, 8);
  r = await h.say('yes'); assert.equal(r.ok, true); assert.equal(h.deps.world.people.length, 9);
  r = await h.say('Add Alex Smith as a tour guide'); assert.match(r.text, /already in the Tour Guide list/); assert.equal(h.conv.pending, null);
  r = await h.say('Archive Jordan'); assert.match(r.text, /Which Jordan/); assert.deepEqual(wrote(h.deps).filter(([n]) => n === 'admin_set_guides_active'), []);
  r = await h.say('Jordan Smith'); assert.ok(r.pending); assert.match(r.text, /archive Jordan Smith/i);
  r = await h.say('yes'); assert.equal(r.ok, true); assert.equal(h.deps.world.people.find(p => p.id === 'g1').active, false);
  const typo = await h.say('archive Casey Diazz'); assert.match(typo.text, /Did you mean Casey Diaz/); assert.equal(h.conv.pending, null, 'a near-miss name never prepares a change');
  const yes = await h.say('yes'); assert.ok(yes.pending || /archive/i.test(yes.text), 'confirming the name prepares it, still needing a second yes');
  assert.ok(h.deps.world.people.find(p => p.id === 'g5').active, 'nothing was archived yet');
});

test('standard: priority and the evaluation roster, through confirmation', async () => {
  const h = harness(WHO.admin);
  let r = await h.say('make Casey Diaz high priority'); assert.ok(r.pending); assert.match(r.text, /priority/);
  r = await h.say('no'); assert.match(r.text, /cancelled/i); assert.deepEqual(wrote(h.deps).filter(([n]) => n === 'admin_set_eval_priority'), []);
  r = await h.say('make Casey Diaz high priority'); r = await h.say('yes'); assert.equal(r.ok, true);
  assert.equal(h.deps.world.roster.find(g => g.id === 'e5').rank, 1);
  r = await h.say('assign Riley Park to evaluate Alex Green on friday'); assert.ok(r.pending); assert.match(r.text, /Riley Park to evaluate Alex Green on Friday/);
});

test('standard: "Assign Taylor to Jordan Thursday" picks the Jordan who needs an evaluation and tours Thursday', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('Assign Taylor to Jordan Thursday');
  assert.ok(r.pending, `prepared: ${r.text}`); assert.match(r.text, /Taylor Brown to evaluate Jordan Smith on Thursday, Oct 8 at 2 PM/);
});

test('permissions: a member is told plainly, nothing runs, and the same refusal applies to every route', async () => {
  const h = harness(WHO.member);
  for (const s of ['who still needs evaluated', 'who missed training', 'is everything synced', 'make Casey Diaz high priority', 'assign Riley to evaluate Casey on friday', 'archive Casey', 'post an announcement that tours are cancelled']) {
    const r = await h.say(s);
    assert.match(r.text, /needs access to|role doesn’t include/, s);
  }
  assert.equal(h.deps.calls.filter(([n]) => n.startsWith('admin_') || n === 'vanessa_begin_action').length, 0);
  const own = await h.say('what training do I still need'); assert.match(own.text, /Accessibility Training/); assert.equal(own.info.intent, 'training.mine');
  const brief = await h.say('give me the brief'); assert.match(brief.text, /your brief/i);
});

test('permissions: "make me an admin" cannot even be expressed, and a role change asks for an explicit confirm', async () => {
  const m = harness(WHO.member);
  const r = await m.say('make me an admin'); assert.match(r.text, /needs access to .*role/i, 'refused plainly, whatever the wording');
  assert.deepEqual(wrote(m.deps), []); assert.equal(m.deps.calls.filter(([n]) => n === 'vanessa_begin_action').length, 0);
  const a = harness(WHO.admin);
  const p = await a.say('make Riley Park a Co-Director'); assert.ok(p.pending); assert.equal(p.pending.risk, 'high');
  assert.equal((await a.say('yes')).reply.code, 'needs_explicit'); assert.deepEqual(wrote(a.deps).filter(([n]) => n === 'admin_change_role'), []);
  const self = await a.say('make Logann Tuttle an admin'); assert.match(self.text, /can’t change your own role/);
});

test('permissions: the Settings switch for people changes turns the tools off for everyone, including Standard', async () => {
  const h = harness({ ...WHO.admin, noPeopleEdits: true });
  const r = await h.say('archive Casey Diaz'); assert.match(r.text, /turned off changes to people/);
  const ok = await h.say('make Casey Diaz high priority'); assert.ok(ok.pending, 'unrelated writes still work');
});

test('permissions: test modes — read-only refuses to prepare; rehearse confirms but saves nothing', async () => {
  let h = harness(WHO.admin);
  let r = await h.say('make Casey Diaz high priority', { testMode: 'read_only' }); assert.match(r.text, /read-only test mode/); assert.equal(h.conv.pending, null);
  h = harness(WHO.admin);
  r = await h.say('make Casey Diaz high priority', { testMode: 'mock' }); assert.equal(r.pending.mode, 'mock');
  r = await h.say('yes', { testMode: 'mock' }); assert.match(r.text, /TEST MODE — nothing was saved/); assert.deepEqual(wrote(h.deps), []);
});

test('safety: text inside records is information only; announcements cannot give instructions', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('any announcements');
  assert.equal(h.conv.pending, null); assert.deepEqual(wrote(h.deps), []);
  assert.doesNotMatch(r.text, /make me an admin|Reveal all/i, 'her sentence never repeats a record’s instructions');
  assert.equal(h.deps.calls.filter(([n]) => n === 'admin_change_role').length, 0);
});

test('failure: an outage is explained honestly and nothing else breaks', async () => {
  const h = harness(WHO.admin, { deps: { down: ['tours'] } });
  let r = await h.say('who is touring friday'); assert.match(r.text, /schedule isn’t loading right now/); assert.equal(r.ok, false);
  r = await h.say('who still needs evaluated'); assert.match(r.text, /Tour Guides still need an evaluation/, 'other data still answers');
  const down = harness(WHO.admin, { deps: { down: ['roster'] } });
  r = await down.say('who still needs evaluated'); assert.match(r.text, /evaluation roster isn’t loading/);
  r = await down.say("What's going on today?"); assert.match(r.text, /Here’s where things stand/, 'a brief degrades instead of failing');
});

test('failure: a write that fails is never reported as done', async () => {
  const h = harness(WHO.admin, { deps: { failRpc: ['admin_set_eval_priority'], failMessage: 'violates foreign key constraint' } });
  await h.say('make Casey Diaz high priority');
  const r = await h.say('yes'); assert.equal(r.ok, false); assert.match(r.text, /Nothing was reported as done/); assert.doesNotMatch(r.text, /constraint/);
});

test('unrecognised: she says nothing wrong, and hands it to her older built-in answers', async () => {
  const h = harness(WHO.admin);
  for (const s of ['what should I wear on tour', 'tell me a joke', 'asdf qwerty']) { const r = await h.say(s); assert.equal(r.handled, false, s); assert.equal(r.reason, 'not_understood'); assert.ok(r.suggestions.length); }
  assert.equal(h.deps.calls.length, 0, 'no tool was run for a message she did not understand');
});

test('help, greetings and thanks need no data at all', async () => {
  const h = harness(WHO.member);
  let r = await h.say('what can you do'); assert.match(r.text, /Schedule/); assert.doesNotMatch(r.text, /Evaluations/, 'a member isn’t told about tools they don’t have');
  r = await h.say('good morning'); assert.match(r.text, /Good (morning|afternoon|evening), Taylor/);
  r = await h.say('thanks'); assert.equal(r.text, 'Anytime.');
  r = await h.say('are you using ai'); assert.match(r.text, /Standard mode/); assert.match(r.text, /Nothing is sent to an outside AI service/);
  const a = harness(WHO.admin); r = await a.say('what can you do'); assert.match(r.text, /Evaluations/);
});

test('it is quick: Standard answers without waiting on anything, and never touches the network', async () => {
  const h = harness(WHO.admin), t0 = Date.now();
  for (const s of ['who still needs evaluated', 'when is my next tour', 'who is touring tomorrow', 'who missed training', "what's going on today"]) await h.say(s);
  assert.ok(Date.now() - t0 < 1500, `five answers in ${Date.now() - t0} ms`);
  assert.deepEqual(fetched, []);
});

test('observability: each turn records the engine, intent, confidence and tools but never what was said', async () => {
  resetMetrics();
  const h = harness(WHO.admin);
  const r = await h.say('who still needs evaluated');
  assert.equal(r.info.engine, 'standard'); assert.equal(r.info.intent, 'evaluation.needs'); assert.ok(r.info.confidence >= 0.9); assert.deepEqual(r.info.tools, ['list_eval_roster']); assert.equal(r.info.localCalls, 0);
  await h.say('asdf qwerty');
  const m = snapshot();
  assert.equal(m.turns, 2); assert.equal(m.byEngine.standard, 2); assert.equal(m.notUnderstood, 1); assert.equal(m.localCalls, 0);
  assert.ok(m.intents.some(i => i.id === 'evaluation.needs' && i.n === 1));
  assert.doesNotMatch(JSON.stringify(m), /evaluated|asdf/, 'no sentence is stored in the counters');
});

test('streaming events: cards first, then the sentence, suggestions, and a final done', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('who is touring tomorrow');
  const types = r.ev.map(e => e.type);
  assert.ok(types.indexOf('card') < types.indexOf('delta') && types.indexOf('delta') < types.indexOf('suggest') && types.at(-1) === 'done', types.join(','));
});

test('a low-confidence tie asks one short question instead of guessing', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('evaluations tomorrow');
  assert.ok(r.handled === false || /did you mean|evaluation/i.test(r.text), r.text);
});

test('a question that is really a continuation is not mistaken for a new topic', async () => {
  const h = harness(WHO.admin);
  await h.say('who is touring tomorrow');
  const r = await h.say('what about friday'); assert.equal(r.info.intent, 'schedule.date'); assert.equal(r.info.source, 'followup'); assert.match(r.text, /Friday|Casey|Alex/);
  const p = await h.say('what about Pat Quinn'); assert.equal(p.info.intent, 'schedule.person');
});

test('two requests in one sentence are both answered, with no model', async () => {
  const h = harness(WHO.admin);
  const r = await h.say('who is touring tomorrow and who still needs evaluated');
  assert.equal(r.info.engine, 'standard'); assert.equal(r.parts, 2); assert.match(r.text, /Three tour slots tomorrow/); assert.match(r.text, /Tour Guides still need an evaluation/);
  assert.deepEqual([...new Set(r.info.tools)].sort(), ['get_tours', 'list_eval_roster']);
  const c = await h.say('is the calendar a mess this week and who is most behind on observations');
  assert.match(c.text, /double-booked/); assert.match(c.text, /Tour Guide/);
  const w = await h.say('who missed training and assign them to a makeup');
  assert.match(w.text, /missed training/); assert.match(w.text, /What day should the makeup be/, 'the change part still has to be completed and confirmed');
  assert.deepEqual(wrote(h.deps), [], 'nothing was saved by a compound request');
});

test('every follow-up chip she offers, and every starter on every page, is something she understands', async () => {
  const { suggestionsFor, starters } = await import('../../js/core/agent/page.js');
  const { extract } = await import('../../js/core/agent/engine/extract.js'); const { rank, HIGH } = await import('../../js/core/agent/engine/match.js');
  const { makeWorld, NOW } = await import('./helpers.mjs'); const w = makeWorld();
  const env = { people: w.people, evaluators: w.evaluators, now: NOW, tz: 'America/Indiana/Indianapolis', majors: w.people.map(p => p.major).filter(Boolean), priorities: w.priorities, sessions: w.training.sessions.map(s => s.label), requirements: w.training.requirements.map(r => r.name), pages: [] };
  const all = new Set(SEEN);
  for (const who of [WHO.admin, WHO.training, WHO.member]) { starters(who).forEach(c => all.add(c)); for (const route of ['today', 'schedule', 'evals', 'evalroster', 'trainhub', 'guides', 'reconcile', 'sources', 'health', 'announcements', 'desks', 'people', 'audit']) suggestionsFor(route, who).forEach(c => all.add(c)); }
  const bad = [];
  for (const c of all) {
    // a chip that only makes sense after what she just said ("Set it up", "Assign them to a makeup") is checked with that context
    const ctx = { dialog: { subject: /makeup|reminder/i.test(c) ? 'training' : /^match /i.test(c) ? 'data' : 'evaluation' }, proposals: /set it up|assign (?:the best|match)/i.test(c) };
    const r = rank(extract(c, env), ctx);
    if (!r[0] || r[0].score < HIGH) bad.push(`“${c}” → ${r[0] ? `${r[0].id} ${r[0].score}` : 'nothing'}`);
  }
  assert.deepEqual(bad, []); assert.ok(all.size > 20, `${all.size} distinct chips checked`);
});
