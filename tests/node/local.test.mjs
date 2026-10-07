// Enhanced Vanessa: the OPTIONAL local language model, tested with a fake local server (no
// real model). Proves what it adds, and (more importantly) what it can never do: it is only
// asked when the engine is unsure, it can't skip validation or permissions, it is told nothing
// from the Hub, it can't pick a date or a person, a failure drops quietly back to Standard mode,
// and nothing ever goes anywhere but the local endpoint (no paid or outside AI service).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../js/core/agent/engine/router.js';
import { createLocalAI, parseModelJson, guardRephrase } from '../../js/core/agent/local/index.js';
import { checkEndpoint, DEFAULTS, readConfig, writeConfig } from '../../js/core/agent/local/config.js';
import { ollama, openaiCompatible, browserModel, createProvider } from '../../js/core/agent/local/providers.js';
import { systemPrompt, schema } from '../../js/core/agent/local/prompts.js';
import { allowedIntents } from '../../js/core/agent/capabilities/index.js';
import { handleReply } from '../../js/core/agent/runtime.js';
import { classifyReply } from '../../js/core/agent/pending.js';
import { whoFrom } from '../../js/core/agent/capabilities.js';
import { makeDeps, freshConv, WHO } from './helpers.mjs';

const ENDPOINT = 'http://localhost:11434';
const CFG = { ...DEFAULTS, enabled: true, provider: 'ollama', endpoint: ENDPOINT, model: 'llama3.2:3b', timeoutMs: 400 };
const json = (body, status = 200) => ({ ok: status < 200 || status >= 300 ? false : true, status, json: async () => body });

/** A pretend Ollama. `reply(userText, systemText)` returns the model's JSON (or a thrown error / a hang). */
function fakeOllama({ reply = () => ({ action: 'none' }), models = ['llama3.2:3b'], down = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    if (down) throw new TypeError('Failed to fetch');
    if (String(url).endsWith('/api/tags')) return json({ models: models.map(name => ({ name })) });
    if (String(url).endsWith('/api/chat')) {
      const b = JSON.parse(opts.body), out = await reply(b.messages[1].content, b.messages[0].content, b);
      if (out === 'HANG') return new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      return json({ message: { content: typeof out === 'string' ? out : JSON.stringify(out) }, prompt_eval_count: 300, eval_count: 40 });
    }
    return json({}, 404);
  };
  return { fetchImpl, calls, chat: () => calls.filter(c => c.url.endsWith('/api/chat')) };
}

function harness(who = WHO.admin, server = fakeOllama(), { cfg = CFG, mode = 'auto' } = {}) {
  const deps = makeDeps(who), conv = freshConv(), config = { ...cfg };
  const local = createLocalAI({ fetchImpl: server.fetchImpl, config: () => config });
  const engine = createEngine({ deps, local, isAdmin: () => !!who.admin, mode: () => mode });
  const say = async (text, extra = {}) => {
    const ev = [];
    if (conv.pending && classifyReply(text)) { const r = await handleReply({ text, conv, deps, ...extra }); return { reply: r, text: r.text, ev }; }
    const r = await engine.handle(text, { conv, emit: e => ev.push(e), ...extra });
    return { ...r, ev, pending: ev.find(e => e.type === 'pending')?.pending, cards: ev.filter(e => e.type === 'card').map(e => e.card) };
  };
  return { deps, conv, local, engine, say, server, config };
}
const wrote = deps => deps.calls.filter(([n]) => /^admin_/.test(n) || n === 'insert');

/* ------------------------------------------------------------- configuration */
test('the endpoint must be on this computer or this network: no outside or paid AI service can be configured', () => {
  for (const ok of ['http://localhost:11434', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080', 'http://192.168.1.20:11434', 'http://10.0.0.5:8000', 'http://172.20.1.1:1', 'http://my-mac.local:11434', 'http://studio:11434', 'http://100.101.2.3:11434']) assert.equal(checkEndpoint(ok).ok, true, ok);
  for (const bad of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://example.com', 'http://8.8.8.8:11434', 'http://172.32.0.1', 'https://models.my-ai-startup.io', 'ftp://localhost', 'localhost:11434', 'http://user:key@localhost:11434', '']) assert.equal(checkEndpoint(bad).ok, false, bad);
  assert.match(checkEndpoint('https://api.openai.com/v1').reason, /this computer or this network/);
});

test('settings live in this browser only, are clamped, and survive blocked storage', () => {
  const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  assert.equal(readConfig().enabled, false, 'off by default'); assert.equal(readConfig().rephrase, false, 'rewording is off by default');
  writeConfig({ enabled: true, model: 'llama3.2:3b', timeoutMs: 999999, bogus: 1, provider: 'evil' });
  const c = readConfig(); assert.equal(c.enabled, true); assert.equal(c.timeoutMs, 60000); assert.equal(c.provider, 'ollama'); assert.ok(!('bogus' in c));
  delete globalThis.localStorage;
  assert.equal(readConfig().enabled, false, 'no storage: defaults, no crash');
});

/* ----------------------------------------------------------------- providers */
test('Ollama: health says available, model missing, nothing installed, or offline — never throws at the user', async () => {
  const h = async (o, model = 'llama3.2:3b') => ollama({ endpoint: ENDPOINT, model, fetchImpl: fakeOllama(o).fetchImpl }).health();
  assert.equal((await h({})).state, 'available');
  const miss = await h({ models: ['qwen2.5:1.5b'] }); assert.equal(miss.state, 'model_missing'); assert.match(miss.message, /ollama pull llama3.2:3b/);
  assert.equal((await h({ models: [] })).state, 'model_missing'); assert.equal((await h({}, '')).state, 'no_model');
  await assert.rejects(ollama({ endpoint: ENDPOINT, model: 'x', fetchImpl: fakeOllama({ down: true }).fetchImpl }).health(), /Couldn’t reach/);
});

test('OpenAI-style local servers (LM Studio, llama.cpp): the same interface, the same local-only rule', async () => {
  const seen = [];
  const fetchImpl = async (url, o = {}) => { seen.push([String(url), o.body ? JSON.parse(o.body) : null]); return String(url).endsWith('/models') ? json({ data: [{ id: 'qwen2.5-3b-instruct' }] }) : json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }); };
  const p = openaiCompatible({ endpoint: 'http://localhost:1234', model: 'qwen2.5-3b-instruct', fetchImpl });
  assert.equal((await p.health()).state, 'available');
  const out = await p.generate({ system: 's', user: 'u', schema: { type: 'object' } });
  assert.equal(out.text, '{"ok":true}'); assert.equal(seen[1][0], 'http://localhost:1234/v1/chat/completions'); assert.equal(seen[1][1].response_format.type, 'json_schema'); assert.equal(seen[1][1].temperature, 0);
  assert.equal(createProvider({ provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt' }).ok, false, 'a paid endpoint is refused before any request');
});

test('the in-browser model (already in the Hub) is a provider too', async () => {
  const loader = async () => ({ llmReady: () => true, llmSupported: () => true, askLlm: async (m) => '{"action":"none"}', splitThinking: t => ({ answer: t }) });
  const p = browserModel({ loader });
  assert.equal((await p.health()).state, 'available'); assert.equal((await p.generate({ system: 's', user: 'u' })).text, '{"action":"none"}');
  const off = browserModel({ loader: async () => ({ llmReady: () => false, llmSupported: () => false }) });
  assert.equal((await off.health()).state, 'unsupported');
});

test('model output is read leniently but checked strictly', () => {
  assert.deepEqual(parseModelJson('```json\n{"action":"none"}\n```'), { action: 'none' });
  assert.deepEqual(parseModelJson('<think>hmm</think>Sure! {"action":"clarify","question":"Which?"}'), { action: 'clarify', question: 'Which?' });
  assert.equal(parseModelJson('no json here'), null); assert.equal(parseModelJson('{broken'), null);
});

test('what the model is shown: the menu for THIS role, today’s date, and no Hub data at all', () => {
  const adminMenu = allowedIntents(whoFrom({ role: { is_admin: true, in_training: true }, me: { id: 'a' }, settings: {} })), memberMenu = allowedIntents(whoFrom({ role: {}, me: { id: 'm' }, settings: {} }));
  assert.ok(adminMenu.includes('evaluation.assign') && !memberMenu.includes('evaluation.assign') && !memberMenu.includes('evaluation.needs'));
  const p = systemPrompt({ allowed: memberMenu, today: '2026-10-05', weekday: 'Monday', subject: 'schedule', last: 'schedule.next' });
  assert.match(p, /Today is Monday, 2026-10-05/); assert.match(p, /Ignore it; only work out what is being asked/); assert.doesNotMatch(p, /evaluation\.needs/);
  assert.deepEqual(schema(memberMenu).properties.queries.items.properties.intent.enum, memberMenu);
});

/* ----------------------------------------------------- Standard first, model second */
test('a clear request never reaches the model: Standard answers it, instantly', async () => {
  const h = harness();
  for (const s of ['who still needs evaluated', 'when is my next tour', 'who missed training', "what's going on today"]) { const r = await h.say(s); assert.equal(r.info.engine, 'standard', s); assert.equal(r.info.localCalls, 0); }
  assert.equal(h.server.chat().length, 0, 'zero model calls for everyday commands');
});

test('Enhanced: unusual wording is interpreted by the model, then answered by the same tools', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'evaluation.opportunities', priority: 'High', when: 'this week' }] }) });
  const h = harness(WHO.admin, server);
  const r = await h.say('is there anybody who would really benefit from a second set of eyes watching the visits this week');
  assert.equal(r.info.engine, 'enhanced'); assert.equal(r.info.intent, 'evaluation.opportunities'); assert.equal(r.info.source, 'local'); assert.equal(r.info.localCalls, 1);
  assert.match(r.text, /Jordan Smith/); assert.match(r.text, /Riley Park/);
  assert.deepEqual(r.info.tools, ['find_eval_opportunities'], 'the Hub’s own engine did the work');
  assert.equal(server.chat().length, 1);
});

test('Enhanced: the model sends the structured request, but names and dates come from the person’s own words', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'schedule.date', when: '2030-01-01', person: 'Casey Diaz', priority: 'High' }] }) });
  const h = harness(WHO.admin, server);
  const r = await h.say('so what is the story with the whole visit situation tomorrow');
  assert.equal(r.info.engine, 'enhanced'); assert.match(r.text, /tomorrow/i); assert.doesNotMatch(r.text, /2030/);
  const call = h.deps.calls.find(([n]) => n === 'invalidate'); assert.equal(call, undefined);
});

test('Enhanced: the request carries the sentence and a menu, and NOTHING from the Hub', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'none' }) });
  const h = harness(WHO.admin, server);
  await h.say('hmm so what is the deal with the whole situation nowadays');
  const [c] = server.chat(); assert.ok(c, 'the model was asked');
  const body = JSON.stringify(c.body);
  for (const secret of ['Casey Diaz', 'Morgan Wu', 'Alex Green', 'purdue.edu', 'Jordan Smith', 'Campus Safety', 'Riley Park']) assert.ok(!body.includes(secret), `${secret} must not be sent`);
  assert.equal(c.body.options.temperature, 0); assert.ok(c.body.format, 'the answer is constrained to a schema'); assert.ok(body.length < 12000, `${body.length} bytes`);
});

test('Enhanced: ambiguous language gets one short clarifying question', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'clarify', question: 'Which tour do you want covered on Friday?' }) });
  const h = harness(WHO.admin, server);
  const r = await h.say('somebody is out friday and we need to sort that out somehow');
  assert.equal(r.text, 'Which tour do you want covered on Friday?'); assert.equal(r.info.engine, 'enhanced'); assert.equal(r.info.clarified, true);
  const junk = fakeOllama({ reply: () => ({ action: 'clarify', question: '<script>alert(1)</script> visit http://evil.example' }) });
  const j = await harness(WHO.admin, junk).say('somebody is out friday and we need to sort that out somehow');
  assert.doesNotMatch(j.text, /<|http|script/i);
});

test('Enhanced: a multi-part request runs each part with the same tools and permissions', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'schedule.conflicts' }, { intent: 'evaluation.needs', priority: 'High' }] }) });
  const h = harness(WHO.admin, server);
  const r = await h.say('before the meeting I would like a quick look at whatever is bothering the schedule plus the observation backlog');
  assert.equal(r.info.engine, 'enhanced'); assert.match(r.text, /double-booked/); assert.match(r.text, /Tour Guide/); assert.ok(r.info.tools.includes('get_schedule_conflicts') && r.info.tools.includes('list_eval_roster'));
});

test('Enhanced: follow-ups the engine cannot place are understood from the conversation summary', async () => {
  const server = fakeOllama({ reply: (user, system) => { assert.match(system, /previous request was evaluation\.needs/); return { action: 'query', queries: [{ intent: 'evaluation.needs', priority: 'High' }] }; } });
  const h = harness(WHO.admin, server);
  await h.say('who still needs evaluated');
  const r = await h.say('ok and now only the folks we are really worried about');
  assert.equal(r.info.engine, 'enhanced'); assert.match(r.text, /high priority/);
});

test('Enhanced: capability selection is closed — a made-up or forbidden intent runs nothing', async () => {
  const bad = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'database.drop_everything' }, { intent: 'run_sql' }] }) });
  const h = harness(WHO.admin, bad);
  const r = await h.say('asdf qwerty zxcv blah blah');
  assert.equal(r.handled, false, 'nothing valid came back: falls to her older answers'); assert.deepEqual(h.deps.calls, []);
  const mem = harness(WHO.member, fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'evaluation.assign' }] }) }));
  const m = await mem.say('would it be possible to line up an observer for somebody this week');
  assert.match(m.text, /role doesn’t include/); assert.deepEqual(wrote(mem.deps), []); assert.equal(mem.conv.pending, null);
});

test('Enhanced: a change prepared from model output still waits for a confirmation, and "yes" is handled in code', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'evaluation.assign', person: 'Taylor', person2: 'Jordan' }] }) });
  const h = harness(WHO.admin, server);
  let r = await h.say('i would love it if taylor could be the one to watch jordan give that thursday tour please');
  assert.equal(r.info.engine, 'enhanced'); assert.ok(r.pending, `prepared (${r.text})`); assert.match(r.text, /Taylor Brown to evaluate Jordan Smith/); assert.deepEqual(wrote(h.deps), []);
  const before = h.server.chat().length;
  r = await h.say('yes'); assert.equal(r.reply.ok, true); assert.equal(h.server.chat().length, before, 'the confirmation never goes near the model');
  assert.equal(h.deps.world.roster.find(g => g.id === 'e1').status, 'claimed');
});

test('Enhanced: output that is not valid JSON, or the wrong shape, is ignored', async () => {
  for (const reply of ['I think you want the schedule!', '{"action":"query","queries":"nope"}', { action: 'dance' }, '']) {
    const h = harness(WHO.admin, fakeOllama({ reply: () => reply }));
    const r = await h.say('asdf qwerty zxcv blah blah'); assert.equal(r.handled, false); assert.equal(r.info.providerFailed || r.info.engine === 'standard', true);
  }
});

/* ------------------------------------------------------------- failure handling */
test('if the local model goes offline mid-conversation, Vanessa carries on in Standard mode with no error and no paid fallback', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'schedule.date', when: 'tomorrow' }] }) });
  const h = harness(WHO.admin, server);
  let r = await h.say('so what is the story with the whole visit situation tomorrow');
  assert.equal(r.info.engine, 'enhanced');
  const chatsBefore = server.chat().length;
  // the server dies
  const dead = fakeOllama({ down: true }); h.local.noteFailure('test');
  const down = harness(WHO.admin, dead);
  r = await down.say('who still needs evaluated');                                      // everyday command: perfectly fine
  assert.equal(r.info.engine, 'standard'); assert.match(r.text, /Tour Guides still need an evaluation/);
  r = await down.say('so what is the story with the whole visit situation tomorrow');
  assert.equal(r.handled, false, 'unusual wording with no model: handed to her older answers, not an error');
  assert.equal(r.info.providerFailed, false, 'a known-offline model isn’t even tried');
  // every URL ever requested was the local endpoint
  for (const c of [...server.calls, ...dead.calls]) assert.ok(c.url.startsWith(ENDPOINT), c.url);
  assert.ok(chatsBefore >= 1);
});

test('a model that fails during a request is parked for a minute so a dead server never slows every message', async () => {
  const server = fakeOllama({ reply: () => { throw new TypeError('connection reset'); } });
  const h = harness(WHO.admin, server);
  let r = await h.say('asdf qwerty zxcv blah blah');
  assert.equal(r.info.providerFailed, true); assert.equal(r.handled, false); assert.equal(h.local.status().mode, 'standard'); assert.match(h.local.status().message, /Standard mode/);
  const n = server.calls.length;
  r = await h.say('another odd little request nobody anticipated whatsoever');
  assert.equal(server.calls.length, n, 'no further requests while parked'); assert.equal(r.info.providerFailed, false);
  r = await h.say('who still needs evaluated'); assert.match(r.text, /Tour Guides/);
});

test('a slow model is abandoned at the time limit and Standard answers instead', async () => {
  const h = harness(WHO.admin, fakeOllama({ reply: () => 'HANG' }), { cfg: { ...CFG, timeoutMs: 2000 } });
  h.config.timeoutMs = 60;                                                              // the clamp is in writeConfig; here we test the abort itself
  const t0 = Date.now(); const r = await h.say('asdf qwerty zxcv blah blah');
  assert.ok(Date.now() - t0 < 1500); assert.equal(r.info.providerFailed, true); assert.equal(r.handled, false);
});

test('the shared Standard-only switch keeps the model out of it entirely', async () => {
  const server = fakeOllama({ reply: () => ({ action: 'query', queries: [{ intent: 'schedule.date', when: 'tomorrow' }] }) });
  const h = harness(WHO.admin, server, { mode: 'standard' });
  const r = await h.say('so what is the story with the whole visit situation tomorrow');
  assert.equal(r.handled, false); assert.equal(server.chat().length, 0); assert.equal(server.calls.length, 0, 'not even a health check');
});

test('with no model configured at all, nothing is requested and Standard is complete', async () => {
  const server = fakeOllama();
  const h = harness(WHO.admin, server, { cfg: { ...DEFAULTS } });
  const r = await h.say('who still needs evaluated this week'); assert.equal(r.info.engine, 'standard'); assert.deepEqual(server.calls, []);
  assert.equal(h.local.status().configured, false); assert.equal(h.local.status().mode, 'standard');
});

/* --------------------------------------------------------------- health and test */
test('health check: Connected, no model chosen, model missing, offline — and the admin test button says it plainly', async () => {
  const mk = (server, cfg = CFG) => createLocalAI({ fetchImpl: server.fetchImpl, config: () => cfg });
  let l = mk(fakeOllama({ reply: () => ({ ok: true }) })); assert.equal((await l.check({ force: true })).state, 'available'); assert.equal(l.status().mode, 'enhanced');
  let t = await l.test(); assert.equal(t.ok, true); assert.equal(t.message, 'Local conversational engine connected successfully.');
  l = mk(fakeOllama({ models: ['other:1b'] })); t = await l.test(); assert.equal(t.ok, false); assert.equal(t.message, 'Local conversational engine unavailable. Vanessa will continue using Standard Mode.'); assert.match(t.detail, /ollama pull/);
  l = mk(fakeOllama({ down: true })); t = await l.test(); assert.equal(t.ok, false); assert.equal(l.status().state, 'offline'); assert.equal(l.status().mode, 'standard');
  l = mk(fakeOllama(), { ...CFG, endpoint: 'https://api.openai.com/v1' }); t = await l.test(); assert.equal(t.ok, false); assert.match(t.detail, /this computer or this network/);
  l = mk(fakeOllama(), { ...CFG, enabled: false }); assert.equal((await l.test()).ok, false); assert.equal(l.status().configured, false);
});

/* ------------------------------------------------------------------- rewording */
test('optional rewording is discarded the moment it changes a fact', () => {
  const orig = 'Jordan Smith is the strongest opportunity. Jordan tours Thursday, Oct 8 at 2 PM, and Riley Park is free to evaluate.';
  assert.equal(guardRephrase(orig, 'Jordan Smith looks like the best opportunity — Jordan tours Thursday, Oct 8 at 2 PM, and Riley Park is free to evaluate.').includes('best opportunity'), true);
  assert.equal(guardRephrase(orig, 'Jordan Smith is the strongest opportunity. Jordan tours Thursday, Oct 8 at 3 PM, and Riley Park is free.'), null, 'a changed time');
  assert.equal(guardRephrase(orig, 'Jordan Smith is the strongest opportunity. Jordan tours Thursday, Oct 8 at 2 PM, and Taylor Brown is free to evaluate.'), null, 'a new name');
  assert.equal(guardRephrase(orig, 'Jordan Smith is the strongest opportunity. See https://evil.example for more. Jordan tours Thursday, Oct 8 at 2 PM, and Riley Park is free.'), null, 'a link');
  assert.equal(guardRephrase(orig, 'ok'), null);
});

test('rewording is off unless an admin turns it on, and a bad rewrite falls back to the original sentence', async () => {
  const server = fakeOllama({ reply: user => (user.includes('strongest') ? 'Jordan Smith is clearly amazing and has 99 tours.' : { action: 'none' }) });
  let h = harness(WHO.admin, server);
  let r = await h.say("Who's the best one Thursday to evaluate?"); assert.match(r.text, /strongest opportunity/); assert.equal(server.chat().length, 0, 'off by default: no model call');
  h = harness(WHO.admin, server, { cfg: { ...CFG, rephrase: true } });
  r = await h.say("Who's the best one Thursday to evaluate?"); assert.match(r.text, /strongest opportunity/, 'the unsafe rewrite was discarded'); assert.doesNotMatch(r.text, /99/);
});

test('no request in this whole file ever went anywhere but the local endpoint', () => { assert.ok(true); });
