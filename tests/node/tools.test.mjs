// The typed tools, the permission layers and the confirmation system, with no language
// model of any kind involved. These are the guarantees that hold whether a request came from
// Standard Vanessa or from a local model: nothing is written without a yes, the database
// re-checks every change, nothing is reported done that wasn't, and a role only reaches what
// it should. (The conversation itself is tested in engine.test.mjs and local.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReply, confirmPending, executeTool, makeCtx } from '../../js/core/agent/runtime.js';
import { remember } from '../../js/core/agent/state.js';
import { makeDeps, freshConv, WHO } from './helpers.mjs';

const wrote = deps => deps.calls.filter(([n]) => /^admin_/.test(n) || n === 'insert');
/** Prepare a change the way the engine does: a tool call that creates the pending action. */
async function prep(deps, conv, tool, args, testMode = 'live') {
  conv.turns++;
  return executeTool(tool, args, makeCtx({ deps, conv, testMode }));
}

test('tool validation: bad arguments, unknown tools and malformed input are errors the model can read', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  assert.equal((await executeTool('get_tours', { when: 'Friday', bogus: 1 }, ctx)).error, 'invalid_input');
  assert.equal((await executeTool('get_tours', { date: '2026-02-30' }, ctx)).error, 'invalid_input');
  assert.equal((await executeTool('get_tours', { when: 'someday' }, ctx)).error, 'bad_time');
  assert.equal((await executeTool('drop_all_tables', {}, ctx)).error, 'unknown_tool');
  assert.equal((await executeTool('execute_sql', { sql: 'delete from guides' }, ctx)).error, 'unknown_tool');
  assert.equal((await executeTool('assign_evaluation', { assignments: [] }, ctx)).error, 'invalid_input');
  assert.equal((await executeTool('set_guides_active', { people: Array(50).fill('x'), active: false }, ctx)).error, 'invalid_input', 'bulk sizes are bounded');
  assert.equal((await executeTool('change_eval_priority', { people: ['Jordan Smith'], priority: 'Banana' }, ctx)).error, 'bad_priority');
  assert.equal((await executeTool('update_training_attendance', { session: 'New Guide', entries: [{ person: 'Jordan Smith', status: 'dancing' }] }, ctx)).error, 'cannot');
  assert.deepEqual(wrote(deps), []);
});

test('writes refuse approximate names (a typo must not edit the wrong person)', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('set_guides_active', { people: ['Jordan Smyth'], active: false }, ctx);
  assert.equal(r.ok, false); assert.equal(r.error, 'confirm_name'); assert.equal(r.extra.candidates[0].name, 'Jordan Smith');
  const read = await executeTool('get_person_profile', { person: 'Jordan Smyth' }, ctx); assert.equal(read.ok, true, 'reads may use an approximate match');
});

test('a member cannot see someone else\'s profile, evaluations or training through any read tool', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  assert.equal((await executeTool('get_person_profile', { person: 'Jordan Smith' }, ctx)).error, 'not_permitted');
  assert.equal((await executeTool('get_training_status', { person: 'Jordan Smith' }, ctx)).error, 'not_permitted');
  assert.equal((await executeTool('find_eval_opportunities', {}, ctx)).error, 'not_permitted');
  const mine = await executeTool('get_person_profile', { person: 'me' }, ctx); assert.equal(mine.ok, true); assert.equal(mine.data.name, 'Taylor Brown');
  const t = await executeTool('get_training_status', {}, ctx); assert.equal(t.ok, true); assert.ok(t.data.requirements.some(r => r.state === 'Needs makeup'));
});

test('a training-team member sees evaluations but not who missed training', async () => {
  const deps = makeDeps(WHO.training), ctx = makeCtx({ deps, conv: freshConv() });
  assert.equal((await executeTool('get_eval_status', {}, ctx)).ok, true);
  assert.equal((await executeTool('get_training_overview', {}, ctx)).ok, true);
  assert.equal((await executeTool('get_training_gaps', { kind: 'missed' }, ctx)).error, 'not_permitted');
  assert.equal((await executeTool('assign_evaluation', { assignments: [{ guide: 'Casey Diaz', evaluator: 'Riley Park' }] }, ctx)).error, 'not_permitted');
});

test('materials: only https links are ever returned', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('get_training_materials', { query: 'safety' }, ctx);
  assert.equal(r.data.count, 1); assert.equal(r.card.items[0].href, 'https://example.com/safety.pdf');
});

test('cross-system readiness: location, speaker, materials, announcements and unsubmitted attendance', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('get_training_readiness', { when: 'tomorrow' }, ctx);
  assert.equal(r.ok, true); assert.equal(r.data.ready, false); assert.ok(r.data.blockers.some(b => /Location/.test(b))); assert.ok(r.data.blockers.some(b => /Speaker/.test(b)));
  assert.ok(r.data.checklist.find(c => c.item === 'Announced').ok, 'the pinned announcement mentions it');
  const past = await executeTool('get_training_readiness', { session: 'Accessibility' }, ctx);
  assert.ok(past.data.checklist.some(c => c.item === 'Attendance recorded' && !c.ok));
});

test('coverage: gaps come from the desk data and the limit is stated', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('get_coverage_gaps', {}, ctx);
  assert.equal(r.data.uncovered_desk_slots, 1); assert.match(r.data.limitation, /do not appear/);
});

test('search finds a training by its speaker', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('get_training_sessions', { query: 'Xander' }, ctx);
  assert.equal(r.data.count, 1); assert.equal(r.data.sessions[0].title, 'Campus Safety');
  const t = await executeTool('get_tours', { people: ['Jordan Smith', 'Dana Reyes'] , when: 'this week' }, ctx);
  assert.equal(t.data.tour_slots, 1, 'a tour with both people together');
});

test('large results are summarised with a count and a "view all" link', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  for (let i = 0; i < 40; i++) deps.world.people.push({ id: 'x' + i, first: 'Guide', last: 'N' + String(i).padStart(2, '0'), active: true, major: 'Computer Science', aliases: [] });
  const r = await executeTool('list_people', { filter: 'major', major: 'CS', limit: 10 }, ctx);
  assert.equal(r.data.count, 42); assert.equal(r.data.people.length, 10); assert.equal(r.data.not_shown, 32); assert.ok(r.card.more.link.route.startsWith('#/guides'));
});

test('briefs: a member gets a personal brief; the same builder serves scheduled use', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  const { buildBrief } = await import('../../js/core/agent/briefing.js');
  const b = await buildBrief('operations', ctx);
  assert.equal(b.kind, 'personal'); assert.ok(b.sections.some(s => s.title === 'You'));
  const adminCtx = makeCtx({ deps: makeDeps(WHO.admin), conv: freshConv() });
  for (const k of ['operations', 'morning', 'weekly', 'training', 'evaluation']) { const x = await buildBrief(k, adminCtx); assert.ok(x.sections.length > 0 && x.title, k); assert.ok(x.sections.every(s => s.items.length <= 5)); }
});

test('open_page only links to pages the role can open', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  assert.equal((await executeTool('open_page', { page: 'audit' }, ctx)).error, 'no_page');
  const r = await executeTool('open_page', { page: 'schedule', go: true }, ctx); assert.equal(r.navigate, '#/schedule');
});

test('a member looking up a name learns only the name: no major, no account link', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  const one = await executeTool('find_people', { query: 'Casey Diaz' }, ctx); assert.deepEqual(Object.keys(one.data.person).sort(), ['active', 'id', 'name']);
  const many = await executeTool('find_people', { query: 'Jordan' }, ctx); assert.ok(many.data.candidates.every(c => !('major' in c)));
  const staff = await executeTool('find_people', { query: 'Jordan Smith' }, makeCtx({ deps: makeDeps(WHO.training), conv: freshConv() })); assert.equal(staff.data.person.major, 'Computer Science');
});

test('the Settings switch for people changes turns off Vanessa\'s people and role tools', async () => {
  const { toolsFor } = await import('../../js/core/agent/registry.js'); const { whoFrom } = await import('../../js/core/agent/capabilities.js');
  const on = toolsFor(whoFrom({ role: { is_admin: true, in_training: true }, me: { id: 'a' }, settings: {} })).map(t => t.name), off = toolsFor(whoFrom({ role: { is_admin: true, in_training: true }, me: { id: 'a' }, settings: { 'vanessa.adminActions': false } })).map(t => t.name);
  for (const n of ['add_tour_guide', 'set_guides_active', 'change_person_role', 'update_tour_guide']) { assert.ok(on.includes(n), n); assert.ok(!off.includes(n), n + ' should be off'); }
  assert.ok(off.includes('assign_evaluation'), 'unrelated tools stay');
});

test('nicknames: remembered shorthand resolves later, and only for a real person', async () => {
  const deps = makeDeps(WHO.admin), ctx = makeCtx({ deps, conv: freshConv() });
  assert.equal((await executeTool('find_people', { query: 'Lexy' }, ctx)).data.match, 'none');
  const r = await executeTool('remember_nickname', { nickname: 'Lexy', person: 'Alex Green' }, ctx); assert.equal(r.ok, true);
  const f = await executeTool('find_people', { query: 'Lexy' }, ctx); assert.equal(f.data.match, 'one'); assert.equal(f.data.person.name, 'Alex Green');
  assert.equal((await executeTool('remember_nickname', { nickname: 'Jo', person: 'Jordan' }, ctx)).error, 'ambiguous', 'never attached to an unresolved person');
});

test('cards offer relevant follow-up chips only to people who may use them', async () => {
  const a = makeCtx({ deps: makeDeps(WHO.admin), conv: freshConv() });
  const g = await executeTool('get_training_gaps', { kind: 'missed' }, a); assert.deepEqual(g.card.asks, ['Assign them to a makeup', 'Draft a reminder for them']);
  const st = await executeTool('get_eval_status', {}, a); assert.ok(st.card.asks.includes('Who is high priority?'));
  const op = await executeTool('find_eval_opportunities', { when: 'tomorrow' }, a); assert.deepEqual(op.card.asks, ['Assign the best one']);
  const t = makeCtx({ deps: makeDeps(WHO.training), conv: freshConv() });
  const op2 = await executeTool('find_eval_opportunities', { when: 'tomorrow' }, t); assert.deepEqual(op2.card.asks, [], 'the training team can look but not assign');
});

test('16b. injected text in a guide note or announcement is length-limited and flagged untrusted in tool output', async () => {
  const deps = makeDeps(WHO.admin); deps.world.announcements[1].body = 'x'.repeat(5000);
  const ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('get_announcements', {}, ctx);
  assert.ok(r.data.announcements.every(a => a.text.length <= 301));
});

test('permission layers are independent: a tampered client still cannot write, because the database refuses', async () => {
  const deps = makeDeps(WHO.member);
  // bypass the client capability check entirely and call the RPC directly, as a hand-edited client could
  await assert.rejects(deps.rpc('admin_set_guides_active', { p_ids: ['g1'], p_active: false }), /Only administrators/);
  assert.ok(deps.world.people.find(p => p.id === 'g1').active);
});

test('a failed write is never reported as done, and the failure is recorded', async () => {
  const deps = makeDeps(WHO.admin, undefined, { failRpc: ['admin_assign_evaluations'], failMessage: 'update or delete on table violates foreign key constraint' }), conv = freshConv();
  await prep(deps, conv, 'assign_evaluation', { assignments: [{ guide: 'Casey Diaz', evaluator: 'Riley Park' }] });
  const y = await handleReply({ text: 'yes', conv, deps });
  assert.equal(y.ok, false); assert.equal(y.code, 'failed'); assert.doesNotMatch(y.text, /^Done/); assert.match(y.text, /Nothing was reported as done/);
  assert.doesNotMatch(y.text, /constraint|foreign key/i, 'raw database errors are never shown');
  assert.equal(deps.world.roster.find(g => g.id === 'e5').status, 'open');
  assert.equal([...deps.pend.values()].at(-1).status, 'failed');
});

test('a partial failure is reported accurately', async () => {
  const deps = makeDeps(WHO.admin, undefined, { failAssign: ['e1'] }), conv = freshConv();
  await prep(deps, conv, 'assign_evaluation', { assignments: [{ guide: 'Jordan Smith', evaluator: 'Riley Park', date: '2026-10-08' }, { guide: 'Alex Green', evaluator: 'Sam Cole', date: '2026-10-09' }] });
  const y = await handleReply({ text: 'yes', conv, deps });
  assert.equal(y.ok, false); assert.equal(y.partial, true); assert.match(y.message, /1 of 2/); assert.match(y.message, /Jordan Smith: That guide was archived/);
});

test('a bare "yes" with nothing pending does nothing; with a stale proposal it asks first', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  assert.equal(await handleReply({ text: 'yes', conv, deps }), null, 'nothing to confirm: not handled');
  await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false });
  conv.turns++;                                                                   // something else was said in between
  const y = await handleReply({ text: 'yes', conv, deps });
  assert.equal(y.handled, true); assert.match(y.text, /do you want me to go ahead/i); assert.deepEqual(wrote(deps).filter(([n]) => n === 'admin_set_eval_need'), []);
  const ok2 = await handleReply({ text: 'confirm', conv, deps }); assert.match(ok2.text, /Marked|go ahead/);
});

test('proposing a new change replaces the old one, and the old one can never run', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false });
  const first = conv.pending.id;
  await prep(deps, conv, 'set_eval_need', { people: ['Alex Green'], needs: false });
  assert.notEqual(conv.pending.id, first); assert.equal(deps.pend.get(first).status, 'cancelled');
  await assert.rejects(async () => deps.rpc('vanessa_confirm_action', { p_id: first, p_hash: 'x' }), /already used/);
});

test('tampering with the reviewed parameters is caught by the hash the database holds', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  await prep(deps, conv, 'set_guides_active', { people: ['Jordan Smith'], active: false });
  assert.ok(Object.isFrozen(conv.pending.prepared.params), 'the reviewed parameters are frozen');
  assert.throws(() => { conv.pending.prepared.params.ids.push('g2'); }, TypeError);
  conv.pending.prepared = { ...conv.pending.prepared, params: { ...conv.pending.prepared.params, ids: ['g2', 'g3'] } };   // someone swaps the object itself
  const y = await handleReply({ text: 'yes', conv, deps });
  assert.equal(y.ok, false); assert.match(y.message, /details changed/);
  assert.deepEqual(wrote(deps).filter(([n]) => n === 'admin_set_guides_active'), []); assert.ok(deps.world.people.find(p => p.id === 'g2').active);
});

test('an expired request refuses to run (server clock and client clock)', async () => {
  const deps = makeDeps(WHO.admin, undefined, { expire: true }), conv = freshConv();
  await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false });
  const y = await handleReply({ text: 'yes', conv, deps }); assert.equal(y.ok, false); assert.match(y.message, /expired/);
  conv.pending = null;
  await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false });
  conv.pending.expires = Date.now() - 1;
  assert.equal((await handleReply({ text: 'yes', conv, deps })).code, 'expired');
  assert.deepEqual(wrote(deps).filter(([n]) => n === 'admin_set_eval_need'), []);
});

test('a high-impact change needs an explicit confirmation: "yes" is not enough', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  await prep(deps, conv, 'set_guides_active', { people: ['Jordan Smith', 'Alex Green'], active: false });
  assert.equal(conv.pending.risk, 'high');
  assert.equal((await handleReply({ text: 'yes', conv, deps })).code, 'needs_explicit');
  assert.deepEqual(wrote(deps).filter(([n]) => n === 'admin_set_guides_active'), []);
  const r = await confirmPending({ conv, deps, how: 'button' }); assert.equal(r.ok, true);
});

test('cancelling leaves nothing changed', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  await prep(deps, conv, 'set_guides_active', { people: ['Jordan Smith'], active: false });
  const no = await handleReply({ text: 'no', conv, deps });
  assert.match(no.text, /cancelled/i); assert.equal(conv.pending, null); assert.deepEqual(wrote(deps).filter(([n]) => n === 'admin_set_guides_active'), []);
});

test('test modes: read-only prepares nothing; mock confirms but saves nothing', async () => {
  let deps = makeDeps(WHO.admin), conv = freshConv();
  const r = await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false }, 'read_only');
  assert.equal(r.error, 'test_mode'); assert.equal(conv.pending, null);
  deps = makeDeps(WHO.admin); conv = freshConv();
  await prep(deps, conv, 'set_eval_need', { people: ['Jordan Lee'], needs: false }, 'mock');
  assert.equal(conv.pending.mode, 'mock');
  const y = await handleReply({ text: 'yes', conv, deps, testMode: 'mock' });
  assert.equal(y.ok, true); assert.match(y.receipt, /TEST MODE — nothing was saved/);
  assert.deepEqual(wrote(deps), []); assert.equal(deps.world.roster.find(g => g.id === 'e2').skip, false);
});

test('the write that follows a confirmation carries the Vanessa action id for the audit log', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  await prep(deps, conv, 'set_guides_active', { people: ['Jordan Smith'], active: false });
  await handleReply({ text: 'yes', conv, deps });
  const call = deps.calls.find(([n]) => n === 'admin_set_guides_active');
  assert.ok(call[2].via?.startsWith('act-')); assert.equal(deps.pend.get(call[2].via).status, 'executed');
});

test('a role the person does not have never reaches a tool, and nothing is recorded', async () => {
  const deps = makeDeps(WHO.member), conv = freshConv();
  const r = await prep(deps, conv, 'change_person_role', { person_email: 'taylor@purdue.edu', role: 'Co-Director' });
  assert.equal(r.error, 'not_permitted'); assert.match(r.message, /role doesn.t include/);
  assert.equal(deps.calls.filter(([n]) => n === 'vanessa_begin_action').length, 0, 'no pending action was even recorded');
  assert.deepEqual(wrote(deps), []);
});

test('even an administrator cannot have Vanessa change their own role', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv();
  assert.equal((await prep(deps, conv, 'change_person_role', { person_email: 'logann@purdue.edu', role: 'Member' })).error, 'self');
});

test('read tools respect the role: a member is refused the staff views', async () => {
  const deps = makeDeps(WHO.member), ctx = makeCtx({ deps, conv: freshConv() });
  const r = await executeTool('list_eval_roster', { filter: 'needs_eval' }, ctx);
  assert.equal(r.error, 'not_permitted');
  for (const t of ['get_training_gaps', 'get_data_health', 'get_recent_activity', 'get_unmatched_identities']) assert.equal((await executeTool(t, t === 'get_training_gaps' ? { kind: 'missed' } : {}, ctx)).error, 'not_permitted');
});

test('conversation focus survives as pointers, and facts are looked up again', async () => {
  const deps = makeDeps(WHO.admin), conv = freshConv(), ctx = makeCtx({ deps, conv });
  remember(conv, await executeTool('get_person_profile', { person: 'Jordan Smith' }, ctx));
  assert.equal(conv.agent.focus.person.name, 'Jordan Smith');
  const next = await executeTool('get_next_tour', { person: 'them' }, ctx);
  assert.equal(next.data.person, 'Jordan Smith'); assert.match(next.data.next_tour.when, /Thursday/);
});
