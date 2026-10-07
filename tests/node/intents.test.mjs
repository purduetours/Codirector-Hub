// The deterministic intent layer, with no network and no model: how many ways of asking
// land on the right intent, what gets extracted, and that the catalogue and the capability
// router never disagree. Everything here runs on the same fake Hub the other tests use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, entityTags, chooseFrom } from '../../js/core/agent/engine/extract.js';
import { rank, decide, HIGH } from '../../js/core/agent/engine/match.js';
import { INTENTS, INTENT_IDS } from '../../js/core/agent/engine/intents.js';
import { PHRASEBOOK } from '../../js/core/agent/engine/phrasebook.js';
import { normalize, tokenize, repair } from '../../js/core/agent/engine/lexicon.js';
import { checkCapabilities, HANDLERS } from '../../js/core/agent/capabilities/index.js';
import { makeWorld, NOW } from './helpers.mjs';

const w = makeWorld();
const env = { people: w.people, evaluators: w.evaluators, now: NOW, tz: 'America/Indiana/Indianapolis', majors: w.people.map(p => p.major).filter(Boolean), priorities: w.priorities,
  sessions: w.training.sessions.map(s => s.label), requirements: w.training.requirements.map(r => r.name),
  pages: [{ id: 'schedule', title: 'Schedule' }, { id: 'evalroster', title: 'Evaluation Roster' }, { id: 'trainhub', title: 'Training' }, { id: 'reconcile', title: 'Reconciliation' }] };
const read = (text, ctx = {}) => { const ent = extract(text, env); const ranked = rank(ent, ctx); return { ent, ranked, ...decide(ranked) }; };
const top = (text, ctx) => read(text, ctx).top?.id;

test('the catalogue and the capability router agree, and every handler is well formed', () => {
  assert.deepEqual(checkCapabilities(INTENT_IDS), []);
  assert.ok(INTENT_IDS.length >= 50, 'a rich catalogue');
  for (const i of INTENTS) assert.ok(i.rules.length && i.examples.length, `${i.id} has rules and examples`);
});

/* [sentence, intent]. Natural variations, typos, and casual phrasing: no sentence is listed twice for the same wording. */
const CORPUS = [
  // evaluations
  ['Who needs evaluated?', 'evaluation.needs'], ['Who still needs an eval?', 'evaluation.needs'], ['Who hasn\'t been evaled?', 'evaluation.needs'], ['who hasnt been evaluated yet', 'evaluation.needs'],
  ['which guides are left to evaluate', 'evaluation.needs'], ['who is still unevaluated', 'evaluation.needs'], ['who do we still need to evaluate this semester', 'evaluation.needs'], ['who still needs an evaluation', 'evaluation.needs'],
  ['guides that still need evals', 'evaluation.needs'], ['who has not had an eval', 'evaluation.needs'], ['show me who needs evaluations', 'evaluation.needs'], ['who needs to be evaluated this week', 'evaluation.needs'],
  ['who is high priority', 'evaluation.priority'], ['show me the high priority evals', 'evaluation.priority'], ['which guides are top priority for evaluation', 'evaluation.priority'],
  ['how are evaluations going', 'evaluation.status'], ['how many evals are left', 'evaluation.needs'], ['evaluation progress', 'evaluation.status'], ['how many guides still need evaluations', 'evaluation.needs'],
  ['find eval opportunities this week', 'evaluation.opportunities'], ['who can evaluate Jordan Smith', 'evaluation.opportunities'], ['Find me a high priority eval Thursday', 'evaluation.opportunities'],
  ['who should I evaluate this week', 'evaluation.opportunities'], ['any evaluation matches tomorrow', 'evaluation.opportunities'], ['best eval opportunity thursday', 'evaluation.opportunities'],
  ['Do we have anybody that really needs an eval and is touring sometime Thursday afternoon?', 'evaluation.opportunities'], ['who needs an eval and is touring friday', 'evaluation.opportunities'],
  ['Assign Taylor Brown to evaluate Jordan Smith', 'evaluation.assign'], ['have Riley evaluate Casey on tuesday', 'evaluation.assign'], ['put Sam Cole on Alex Green\'s eval', 'evaluation.assign'],
  ['make Jordan Smith high priority', 'evaluation.set_priority'], ['set Alex Green to low priority', 'evaluation.set_priority'], ['prioritize Casey Diaz for evals', 'evaluation.set_priority'],
  ['skip Casey Diaz\'s evaluation this semester', 'evaluation.set_need'], ['add Pat Quinn to the evaluation roster', 'evaluation.set_need'],
  ['what are my evaluations', 'evaluation.mine'], ['am I evaluating anyone', 'evaluation.mine'],
  ['who are the evaluators', 'evaluation.evaluators'],
  // schedule
  ['When is my next tour?', 'schedule.next'], ['when do I tour next', 'schedule.next'], ['what is my next tour', 'schedule.next'], ['when is Alex Green\'s next tour', 'schedule.next'],
  ['who is touring today', 'schedule.today'], ['who\'s on tour now', 'schedule.today'], ['who is giving tours today', 'schedule.today'], ['what tours are today', 'schedule.today'],
  ['who is touring tomorrow', 'schedule.date'], ['who is on the schedule friday', 'schedule.date'], ['what tours are on thursday afternoon', 'schedule.date'], ['show me next week\'s tours', 'schedule.date'], ['who tours on oct 12', 'schedule.date'],
  ['when does Casey Diaz tour this week', 'schedule.person'], ['Casey Diaz\'s schedule', 'schedule.person'], ['is Alex Green touring friday', 'schedule.person'],
  ['any conflicts friday', 'schedule.conflicts'], ['is anyone double booked', 'schedule.conflicts'], ['any schedule issues this week', 'schedule.conflicts'], ['are there overlapping tours', 'schedule.conflicts'], ['any scheduling problems', 'schedule.conflicts'],
  // training
  ['who missed training', 'training.missing'], ['who missed training this week', 'training.missing'], ['who still needs training', 'training.missing'], ['who hasn\'t done orientation', 'training.missing'], ['who is behind on training', 'training.missing'], ['who didn\'t show up to campus safety', 'training.missing'],
  ['when is the next training', 'training.upcoming'], ['upcoming training sessions', 'training.upcoming'], ['is there training this week', 'training.upcoming'], ['what training sessions do we have', 'training.upcoming'],
  ['who needs a makeup', 'training.makeup'], ['who owes makeup training', 'training.makeup'], ['any makeup issues', 'training.makeup'],
  ['assign them to a makeup', 'training.assign_makeup'], ['set up a makeup thursday for Jordan Smith', 'training.assign_makeup'],
  ['what training does Jordan Smith still need', 'training.person'], ['is Jordan Smith done with orientation', 'training.person'],
  ['what training do I still need', 'training.mine'], ['am I caught up on training', 'training.mine'],
  ['who attended campus safety', 'training.attendance'], ['attendance for the last training', 'training.attendance'], ['how was attendance at orientation', 'training.attendance'],
  ['mark Jordan Smith absent for new guide training', 'training.mark_attendance'], ['record Casey Diaz as late', 'training.mark_attendance'],
  ['are we ready for training tomorrow', 'training.readiness'], ['is new guide training ready', 'training.readiness'],
  ['how is training going', 'training.overview'], ['training summary', 'operations.brief'],
  ['where are the training slides', 'training.materials'], ['draft a reminder for them', 'training.remind'],
  ['schedule a training called Leadership Skills on friday at 6', 'training.create_session'],
  // coverage
  ['which desk slots are uncovered', 'coverage.open'], ['is the front desk covered this week', 'coverage.open'], ['any coverage gaps', 'coverage.open'], ['do we have open desk shifts', 'coverage.open'],
  ['who could cover Casey Diaz tomorrow', 'coverage.suggest'], ['Casey Diaz can\'t make her friday tour', 'coverage.suggest'], ['I can\'t make my tour thursday', 'coverage.suggest'], ['who can take Alex Green\'s tour', 'coverage.suggest'],
  // people
  ['who are the CS majors', 'people.search'], ['who is on leadership', 'people.search'], ['which guides have no major', 'people.search'], ['who isn\'t on the schedule', 'people.search'], ['who is new this semester', 'people.search'], ['how many active guides do we have', 'people.active'], ['who is inactive', 'people.active'],
  ['tell me about Jordan Smith', 'people.profile'], ['pull up Taylor Brown', 'people.profile'], ['who is Alex Green', 'people.profile'], ['look up Casey Diaz', 'people.profile'],
  ['what is Jordan Smith\'s major', 'people.major'], ['what majors do we have', 'people.major'],
  ['add Alex Smith as a tour guide', 'people.add'], ['archive Dana Reyes', 'people.archive'], ['restore Dana Reyes', 'people.archive'], ['change Jordan Smith\'s major to biology', 'people.update'], ['add a note to Casey Diaz: out friday', 'people.note'],
  // operations
  ['what\'s going on today', 'operations.brief'], ['give me the brief', 'operations.brief'], ['brief me', 'operations.brief'], ['catch me up', 'operations.brief'], ['give me the weekly plan', 'operations.brief'], ['morning brief', 'operations.brief'],
  ['Anything I need to worry about?', 'operations.problems'], ['what needs attention today', 'operations.problems'], ['what\'s going wrong this week', 'operations.problems'], ['any problems', 'operations.problems'], ['is anything on fire', 'operations.problems'],
  ['any announcements', 'operations.announcements'], ['what are the latest announcements', 'operations.announcements'],
  ['post an announcement that training is moved to friday', 'operations.announce'],
  ['what semester is it', 'operations.semester'], ['show me recent activity', 'operations.activity'], ['open the evaluation roster', 'operations.open'], ['take me to the schedule', 'operations.open'],
  // data
  ['is everything synced', 'data.sync_status'], ['did the schedule sync', 'data.sync_status'], ['is the data up to date', 'data.sync_status'], ['are the sources working', 'data.sync_status'],
  ['which names don\'t match', 'data.unmatched'], ['any unmatched names', 'data.unmatched'], ['what still needs matching', 'data.unmatched'],
  // assistant
  ['what can you do', 'assistant.help'], ['help', 'assistant.help'], ['hi', 'assistant.greet'], ['good morning', 'assistant.greet'], ['thanks', 'assistant.thanks'], ['thank you', 'assistant.thanks'], ['are you using ai', 'assistant.engine']
];
for (const [phrase, intent] of CORPUS) {
  test(`understands: “${phrase}” → ${intent}`, () => {
    const r = read(phrase);
    assert.equal(r.top?.id, intent, `${phrase} → ${r.ranked.slice(0, 3).map(x => `${x.id} ${x.score} (${x.via})`).join(' | ')}`);
    assert.ok(r.top.score >= HIGH, `confident enough to act (${r.top.score})`);
  });
}

test('every phrasing taught in the phrasebook resolves to the intent it is filed under', () => {
  let n = 0;
  for (const [id, list] of Object.entries(PHRASEBOOK)) { assert.ok(INTENT_IDS.includes(id), `${id} exists`); for (const p of list) { n++; const r = read(p); assert.equal(r.top?.id, id, `“${p}” should be ${id}, got ${r.ranked.slice(0, 2).map(x => x.id).join(', ')}`); } }
  assert.ok(n >= 10);
});

test('every example sentence in the catalogue resolves to its own intent', () => {
  const bad = [];
  for (const i of INTENTS) for (const e of i.examples) {
    if (/\b(?:jd|jordy|oct 12)\b/i.test(e)) continue;
    const r = read(e, { proposals: false });
    // contextual examples ("set it up") need conversation state; checked in the conversation tests
    if (!r.top) { if (!(/set it up|assign the best|assign them|forget|call jordan/i.test(e) || i.rules.every(x => x.all.some(c => String(c).startsWith('$'))))) bad.push(`“${e}” matched nothing (${i.id})`); continue; }
    if (r.top.id !== i.id) bad.push(`“${e}” is an example of ${i.id} but resolves to ${r.ranked.slice(0, 2).map(x => `${x.id} ${x.score}`).join(', ')}`);
  }
  assert.deepEqual(bad, []);
});

test('unrelated or unclear sentences are not confidently misread', () => {
  for (const s of ['what is the capital of France', 'asdf qwerty', 'who still needs parking', 'tell me a joke', 'how tall is Mount Everest', 'bananas']) {
    const r = read(s);
    assert.ok(!r.top || r.top.score < HIGH, `“${s}” should not be confident: ${r.ranked[0]?.id} ${r.ranked[0]?.score}`);
  }
});

test('the same intent for typos, case and punctuation', () => {
  for (const s of ['WHO STILL NEEDS EVALUATED???', 'who stil needs an evaluaton', 'who needs evaluated  ', '  who   needs   evaluated?!', 'who needs evaluted tomorow']) assert.equal(top(s), 'evaluation.needs', s);
});

test('a question about someone else\'s evaluation is a lookup, not an assignment', () => {
  assert.notEqual(top('is Taylor Brown evaluating Jordan Smith'), 'evaluation.assign');
  assert.notEqual(top('who is Riley evaluating thursday'), 'evaluation.assign');
});

/* ----------------------------------------------------------------- entities */
test('entities: dates in words become real dates in the app timezone', () => {
  const f = s => extract(s, env).when;
  assert.deepEqual([f('tomorrow').from, f('Friday').from, f('next week').from, f('this week').to], ['2026-10-06', '2026-10-09', '2026-10-12', '2026-10-11']);
  const th = f('Thursday afternoon'); assert.deepEqual([th.from, th.after, th.before], ['2026-10-08', '12:00', '17:00']);
  assert.equal(f('who is touring Oct 12').from, '2026-10-12');
  assert.equal(f('tomorrow morning').before, '12:00');
  assert.equal(f('who tours after 3 pm friday').after, '15:00');
  assert.equal(extract('any conflicts Friday?', env).when.from, '2026-10-09', 'punctuation does not hide a date');
  assert.equal(f('no date here'), null);
});

test('entities: people resolve against the live Tour Guide list', () => {
  const p = s => extract(s, env).people;
  assert.equal(p('tell me about Casey')[0].status, 'one'); assert.equal(p('tell me about Casey')[0].person.last, 'Diaz');
  assert.equal(p('tell me about Jordan')[0].status, 'many'); assert.deepEqual(p('tell me about Jordan')[0].candidates.map(c => c.last).sort(), ['Lee', 'Smith']);
  assert.equal(p('tell me about Jordan Smith')[0].person.last, 'Smith');
  assert.equal(p('when is j smith touring')[0].person.last, 'Smith', 'initial + last name');
  assert.equal(p('when is Lex Green touring')[0].person.first, 'Alex', 'a saved alias');
  assert.equal(p('tell me about Jordon Smith')[0].person.last, 'Smith', 'a one-letter typo in a full name');
  assert.equal(p('who needs evaluated').length, 0, 'ordinary words are never names');
  assert.equal(p('who can come tomorrow').length, 0, '"come" is not "Cole"');
  assert.equal(p('assign Taylor to Jordan Smith').length, 2);
  assert.equal(p('assign Taylor to Jordan Smith')[0].person.first, 'Taylor', 'order of mention is kept');
  assert.equal(p('Casey and Taylor Brown').length, 2);
});

test('entities: name-like everyday words need a capital or a cue to count as a name', () => {
  const people = [...w.people, { id: 'x1', first: 'Will', last: 'Hart', active: true, aliases: [] }, { id: 'x2', first: 'Grace', last: 'Moon', active: true, aliases: [] }];
  const e = s => extract(s, { ...env, people }).people.map(p => p.person?.first);
  assert.deepEqual(e('who will be touring tomorrow'), []);
  assert.deepEqual(e('mark attendance for training'), []);
  assert.deepEqual(e('when is Will touring'), ['Will']);
  assert.deepEqual(e('tell me about Grace'), ['Grace']);
});

test('entities: priority, major, status, count, ordinal, session, semester', () => {
  const x = s => extract(s, env);
  assert.equal(x('who really needs an eval').priority, 'High'); assert.equal(x('low priority guides').priority, 'Low'); assert.equal(x('first priority to eval').priority, 'High');
  assert.equal(x('the comp sci guy').major, 'Computer Science'); assert.equal(x('who are the cs majors').major, 'Computer Science'); assert.equal(x('data science majors').major, 'Data Science');
  assert.equal(x('who is the best, me').major, null, '"me" is not the ME major');
  assert.equal(x('who has no evaluator').status, 'unassigned'); assert.equal(x('who has been evaluated already').status, 'done');
  assert.equal(x('top 3').count, 3); assert.equal(x('show me the best five').count, 5);
  assert.equal(x('the first one').ordinal, 0); assert.equal(x('the second one').ordinal, 1); assert.equal(x('the last one').ordinal, -1); assert.equal(x('number 3').ordinal, 2); assert.equal(x('second').ordinal, 1);
  assert.equal(x('who missed campus safety').session, 'Campus Safety'); assert.equal(x('who needs orientation').requirement, 'Orientation');
  assert.equal(x('who needs an eval in fall 2026').semester.id, 'fall-2026');
  assert.equal(x('tell me about them').reference, true); assert.equal(x('when is his next tour').reference, true);
  assert.equal(x('open the evaluation roster').page.id, 'evalroster');
});

test('entities: "me" in a request is not the person\'s own name', () => {
  assert.equal(extract('show me who needs evaluated', env).mine, false);
  assert.equal(extract('when is my next tour', env).mine, true);
  assert.equal(extract('find me a high priority eval', env).mine, false);
});

test('choosing from a list: names, ordinals and descriptions', () => {
  const c = [{ label: 'Jordan Smith', sub: 'Computer Science', value: 'g1' }, { label: 'Jordan Lee', sub: 'Data Science', value: 'g2' }];
  assert.equal(chooseFrom('the first one', c).value, 'g1'); assert.equal(chooseFrom('second', c).value, 'g2'); assert.equal(chooseFrom('Jordan Lee', c).value, 'g2');
  assert.equal(chooseFrom('the data science one', c, { majors: ['Data Science', 'Computer Science'] }).value, 'g2'); assert.equal(chooseFrom('smith', c).value, 'g1');
  assert.equal(chooseFrom('banana', c), null); assert.equal(chooseFrom('Jordan', c), null, 'still ambiguous');
});

test('lexicon: contractions, phrases and typo repair', () => {
  assert.equal(normalize("Who hasn't been evaled?"), 'who not been evaled');
  assert.ok(normalize('make-up session').includes('makeup')); assert.ok(normalize("what's going on").includes('brief'));
  assert.equal(repair('tomorow'), 'tomorrow'); assert.equal(repair('thrusday'), 'thursday'); assert.equal(repair('evluated'), 'evaluated'); assert.equal(repair('jordan'), 'jordan');
});
