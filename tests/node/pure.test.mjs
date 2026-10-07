import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, clock, inWindow, addDays, dayLabel, timeLabel } from '../../js/core/agent/time.js';
import { validate, canonical, hashParams } from '../../js/core/agent/schema.js';
import { resolvePerson } from '../../js/core/agent/entities.js';
import { can, capabilitiesOf, CAPABILITIES } from '../../js/core/agent/capabilities.js';
import { ALL_TOOLS, toolsFor, checkRegistry, describeTools } from '../../js/core/agent/registry.js';
import { classifyReply } from '../../js/core/agent/pending.js';
import { friendly } from '../../js/core/agent/errors.js';
import { newConversation, remember, recap } from '../../js/core/agent/state.js';
import { WHO, NOW } from './helpers.mjs';

const W = (t, o = {}) => parseWhen(t, { now: NOW, tz: 'America/Indiana/Indianapolis', ...o });   // Mon 2026-10-05

test('time: the clock is read in the application timezone, not UTC', () => {
  assert.equal(clock(new Date('2026-10-06T02:30:00Z'), 'America/Indiana/Indianapolis').today, '2026-10-05');   // 10:30 PM Monday there
  assert.equal(clock(new Date('2026-10-06T02:30:00Z'), 'UTC').today, '2026-10-06');
});
test('time: relative days', () => {
  assert.equal(W('today').from, '2026-10-05'); assert.equal(W('tomorrow').from, '2026-10-06'); assert.equal(W('yesterday').from, '2026-10-04');
  assert.equal(W('day after tomorrow').from, '2026-10-07');
});
test('time: weekdays mean the upcoming one; "next" means next week', () => {
  assert.equal(W('Friday').from, '2026-10-09'); assert.equal(W('monday').from, '2026-10-05'); assert.equal(W('on thursday').from, '2026-10-08');
  assert.equal(W('next friday').from, '2026-10-16'); assert.equal(W('last friday').from, '2026-10-02');
});
test('time: weeks, weekends, months', () => {
  assert.deepEqual([W('this week').from, W('this week').to], ['2026-10-05', '2026-10-11']);
  assert.deepEqual([W('next week').from, W('next week').to], ['2026-10-12', '2026-10-18']);
  assert.deepEqual([W('this weekend').from, W('this weekend').to], ['2026-10-10', '2026-10-11']);
  assert.deepEqual([W('next month').from, W('next month').to], ['2026-11-01', '2026-11-30']);
  assert.deepEqual([W('this month').from, W('this month').to], ['2026-10-01', '2026-10-31']);
  assert.deepEqual([W('the next 3 days').from, W('the next 3 days').to], ['2026-10-05', '2026-10-08']);
});
test('time: explicit dates, and rolling a past date to next year', () => {
  assert.equal(W('Oct 9').from, '2026-10-09'); assert.equal(W('10/9').from, '2026-10-09'); assert.equal(W('2026-12-01').from, '2026-12-01');
  assert.equal(W('September 3rd').from, '2027-09-03');
});
test('time: nonsense dates are refused, not guessed', () => {
  assert.equal(W('2026-02-30').ok, false); assert.equal(W('13/45').ok, false); assert.equal(W('whenever').ok, false); assert.equal(W('').ok, false);
});
test('time: times of day', () => {
  assert.equal(W('after 3 PM').after, '15:00'); assert.equal(W('before 5pm').before, '17:00'); assert.equal(W('Thursday at 2pm').at, '14:00');
  assert.equal(W('tomorrow morning').before, '12:00'); assert.equal(W('friday afternoon').after, '12:00');
  assert.equal(W('after 3').after, '15:00');                                  // a bare small hour is the afternoon at a tour desk
  assert.equal(W('friday after 2:30 pm').after, '14:30');
  assert.equal(W('before training').needs, 'training_session');
});
test('time: semester words are flagged, not turned into dates', () => { assert.equal(W('next semester').semester, 'next'); assert.equal(W('next semester').from, undefined); });
test('time: windows and labels', () => {
  assert.equal(inWindow('14:00', { after: '13:00', before: '15:00' }), true); assert.equal(inWindow('15:00', { before: '15:00' }), false); assert.equal(inWindow('09:00', { after: '13:00' }), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(dayLabel('2026-10-06', '2026-10-05'), 'tomorrow'); assert.equal(dayLabel('2026-10-09', '2026-10-05'), 'Friday, Oct 9'); assert.equal(timeLabel('14:30'), '2:30 PM'); assert.equal(timeLabel('00:00'), '12 AM');
});

test('schema: accepts good input, rejects unknown keys and wrong types', () => {
  const s = { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 5 }, d: { type: 'string', format: 'date' }, e: { type: 'string', enum: ['a', 'b'] }, l: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 3 } } }, required: ['e'] };
  assert.equal(validate({ e: 'a', n: '3' }, s).value.n, 3);                                  // numeric strings are accepted
  assert.equal(validate({ e: 'c' }, s).ok, false); assert.equal(validate({}, s).ok, false);
  assert.match(validate({ e: 'a', extra: 1 }, s).errors[0], /not something this tool accepts/);
  assert.equal(validate({ e: 'a', n: 9 }, s).ok, false); assert.equal(validate({ e: 'a', n: 1.5 }, s).ok, false);
  assert.equal(validate({ e: 'a', d: '2026-02-30' }, s).ok, false); assert.equal(validate({ e: 'a', d: '2026-10-05' }, s).ok, true);
  assert.equal(validate({ e: 'a', l: ['x', 'y', 'z'] }, s).ok, false); assert.equal(validate({ e: 'a', l: ['toolong'] }, s).ok, false);
  assert.equal(validate('nope', s).ok, false); assert.equal(validate([1], s).ok, false);
});
test('schema: hashing is order-independent and detects any change', async () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(await hashParams({ a: 1, b: 2 }), await hashParams({ b: 2, a: 1 }));
  assert.notEqual(await hashParams({ a: 1 }), await hashParams({ a: 2 }));
  assert.match(await hashParams({}), /^[a-f0-9]{64}$/);
});

const P = [{ id: 1, first: 'Jordan', last: 'Smith', active: true }, { id: 2, first: 'Jordan', last: 'Lee', active: true }, { id: 3, first: 'Taylor', last: 'Brown', active: true }, { id: 4, first: 'Taylor', last: 'Old', active: false }, { id: 5, first: 'Alex', last: 'Green', aliases: ['Lex Green'] }];
test('entities: one clear match, several, none, aliases, initials, last-first order', () => {
  assert.equal(resolvePerson('Jordan Smith', P).person.id, 1); assert.equal(resolvePerson('J Smith', P).person.id, 1); assert.equal(resolvePerson('Smith, Jordan', P).person.id, 1);
  assert.equal(resolvePerson('jordan s', P).person.id, 1); assert.equal(resolvePerson('Lex Green', P).person.id, 5); assert.equal(resolvePerson('Brown', P).person.id, 3);
  const many = resolvePerson('Jordan', P); assert.equal(many.status, 'many'); assert.deepEqual(many.candidates.map(c => c.id).sort(), [1, 2]);
  assert.equal(resolvePerson('Zed', P).status, 'none'); assert.equal(resolvePerson('', P).status, 'none');
});
test('entities: an active guide beats an inactive one with the same name, and says so', () => {
  const r = resolvePerson('Taylor', P); assert.equal(r.person.id, 3); assert.match(r.note, /inactive/);
});
test('entities: spelling slips are flagged fuzzy so writes can refuse them', () => {
  const r = resolvePerson('Tailor Brown', P); assert.equal(r.status, 'one'); assert.equal(r.fuzzy, true);
  assert.equal(resolvePerson('Taylor Brown', P).fuzzy, false);
});

test('capabilities: the same flags as the router, nothing broader', () => {
  const m = capabilitiesOf(WHO.member), t = capabilitiesOf(WHO.training), a = capabilitiesOf(WHO.admin);
  assert.ok(m.includes('schedule.read') && m.includes('training.self') && m.includes('self.read'));
  for (const c of ['evaluations.read', 'evaluations.write', 'people.write', 'roles.write', 'data.read', 'training.read.people', 'audit.read']) assert.ok(!m.includes(c), `member must not have ${c}`);
  assert.ok(t.includes('evaluations.read') && t.includes('training.read') && !t.includes('evaluations.write') && !t.includes('training.read.people') && !t.includes('people.write'));
  assert.equal(a.length, Object.keys(CAPABILITIES).length);
  assert.equal(can('nonexistent', WHO.admin), false); assert.equal(can('schedule.read', null), false);
});

test('registry: every tool is well formed, and there is no raw database tool', () => {
  assert.deepEqual(checkRegistry(), []);
  assert.ok(ALL_TOOLS.length >= 40);
  assert.ok(!ALL_TOOLS.some(t => /sql|query|execute|raw/i.test(t.name)));
  for (const t of ALL_TOOLS) assert.equal(t.input_schema.type, 'object');
});
test('registry: a member is never shown a write tool or admin read tool', () => {
  const names = toolsFor(WHO.member).map(t => t.name);
  assert.ok(names.includes('get_next_tour') && names.includes('get_training_status'));
  for (const n of ['assign_evaluation', 'change_eval_priority', 'set_guides_active', 'change_person_role', 'create_announcement', 'get_data_health', 'get_training_gaps', 'list_eval_roster', 'update_training_attendance']) assert.ok(!names.includes(n), `${n} leaked to a member`);
  assert.ok(toolsFor(WHO.admin).length > toolsFor(WHO.training).length && toolsFor(WHO.training).length > toolsFor(WHO.member).length);
});
test('registry: write tools are marked as writes in what is described', () => {
  const d = describeTools(); assert.ok(d.filter(x => x.kind === 'write').length >= 12);
  assert.equal(d.find(x => x.name === 'assign_evaluation').kind, 'write'); assert.equal(d.find(x => x.name === 'get_tours').kind, 'read');
});

test('confirmation words: yes / explicit / no are matched exactly, anything else is not a reply', () => {
  for (const y of ['yes', 'Yep', 'yeah.', 'Confirm', 'do it', 'go ahead', 'sure!', 'yes please', 'ok']) assert.ok(['yes', 'explicit'].includes(classifyReply(y)), y);
  for (const n of ['no', 'cancel', 'nope', 'never mind', 'stop']) assert.equal(classifyReply(n), 'no', n);
  assert.equal(classifyReply('confirm'), 'explicit'); assert.equal(classifyReply('yes, confirm'), 'explicit');
  for (const x of ['yes but make it Alex', 'use Taylor', 'who else?', 'yes and also archive Jordan', 'okay what about Friday', '']) assert.equal(classifyReply(x), null, x);
});

test('errors: backend messages become sentences, never raw SQL', () => {
  assert.match(friendly(new Error('update or delete on table "guides" violates foreign key constraint')), /archive them instead/);
  assert.match(friendly(new Error('Failed to fetch')), /couldn’t reach/);
  assert.match(friendly(new Error('duplicate key value violates unique constraint "x"')), /already exists/);
  assert.equal(friendly(new Error('Only administrators can do that.')), 'Only administrators can do that.');
  assert.doesNotMatch(friendly(new Error('syntax error at or near "select" column foo relation bar')), /select|column|relation/i);
});

test('state: focus and the last list are kept as pointers, and the recap is small', () => {
  const c = newConversation('u');
  remember(c, { focus: { person: { id: 'g1', name: 'Jordan Smith' }, tour: null }, list: { kind: 'people', items: Array.from({ length: 50 }, (_, i) => ({ id: 'g' + i, name: 'N' + i })) } });
  assert.equal(c.agent.focus.person.name, 'Jordan Smith'); assert.equal(c.agent.lists.last.items.length, 30, 'bounded');
  const r = recap(c); assert.equal(r.person.name, 'Jordan Smith'); assert.equal(r.last_list.items.length, 8);
  remember(c, { focus: { person: { id: 'g2', name: 'Alex Green' } } }); assert.equal(c.agent.focus.person.name, 'Alex Green');
});
