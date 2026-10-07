import test from 'node:test';
import assert from 'node:assert/strict';
import { toHtml, toSpeech, esc } from '../../js/core/agent/format.js';

test('format: model and record text can never become markup', () => {
  const evil = '<img src=x onerror=alert(1)> **bold** <script>x</script> [link](javascript:alert(1)) "q" \'s\'';
  const h = toHtml(evil);
  assert.ok(!/<img|<script|onerror=alert/.test(h.replace(/&lt;[^]*?&gt;/g, '')), h);
  assert.ok(h.includes('&lt;img') && h.includes('&lt;script&gt;')); assert.match(h, /<b>bold<\/b>/);
  assert.ok(!h.includes('<a '), 'no links are ever created from text');
  assert.equal(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
});
test('format: paragraphs and bullet lists', () => {
  assert.equal(toHtml('One\n\nTwo'), '<p>One</p><p>Two</p>');
  assert.equal(toHtml('Lead\n- a\n- b\n1. c'), '<p>Lead</p><ul><li>a</li><li>b</li><li>c</li></ul>');
  assert.equal(toHtml(''), '');
});
test('speech: markup, list symbols, links and ids are not read aloud', () => {
  assert.equal(toSpeech('**Jordan** has a tour.\n- Thursday at 2 PM\n- See #/guides?q=Jordan and https://x.com/y'), 'Jordan has a tour. Thursday at 2 PM. See and');
});

/* A fake browser speech recogniser */
let instances = [];
class FakeRec { constructor() { instances.push(this); } start() { this.started = true; } stop() { this.stopped = true; this.onend?.(); } abort() { this.aborted = true; }
  say(text, final = true) { this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] }); } }
globalThis.SpeechRecognition = FakeRec;
const { createVoice, canListen, canSpeak, speakReplies, setSpeakReplies } = await import('../../js/core/agent/voice.js');
const rig = () => { instances = []; const log = { states: [], interim: [], final: [] }; const v = createVoice({ onState: s => log.states.push(s), onInterim: t => log.interim.push(t), onFinal: t => log.final.push(t) }); return { v, log, rec: () => instances.at(-1) }; };

test('voice: listening → interim → final text goes to the same send() as typing', () => {
  const { v, log, rec } = rig(); assert.equal(canListen(), true);
  v.listen(); assert.equal(rec().started, true); assert.equal(log.states.at(-1).state, 'listening');
  rec().say('who needs evaluated', false); assert.deepEqual(log.interim, ['who needs evaluated']);
  rec().say('who needs evaluated this week', true); assert.equal(log.states.at(-1).state, 'processing');
  rec().onend(); assert.deepEqual(log.final, ['who needs evaluated this week']); assert.equal(log.states.at(-1).state, 'idle');
});
test('voice: saying "cancel" sends nothing', () => {
  const { v, log, rec } = rig(); v.listen(); rec().say('cancel'); rec().onend();
  assert.deepEqual(log.final, []); assert.equal(log.states.at(-1).cancelled, true);
});
test('voice: cancel() aborts the recogniser and sends nothing, even if it later reports a result', () => {
  const { v, log, rec } = rig(); v.listen(); const r = rec(); r.say('assign taylor', false); v.cancel();
  assert.equal(r.aborted, true); r.say('assign taylor', true); r.onend?.(); assert.deepEqual(log.final, []); assert.equal(v.state, 'idle');
});
test('voice: errors explain themselves and recover', () => {
  const { v, log, rec } = rig(); v.listen(); rec().onerror({ error: 'not-allowed' });
  assert.equal(log.states.at(-1).state, 'error'); assert.match(log.states.at(-1).message, /blocked/i);
  v.listen(); rec().onerror({ error: 'no-speech' }); assert.match(log.states.at(-1).message, /didn.t catch/);
  v.listen(); rec().onerror({ error: 'aborted' }); assert.equal(log.states.at(-1).state, 'idle');
  v.listen(); assert.equal(log.states.at(-1).state, 'listening', 'a new attempt works after an error');
});
test('voice: silence is not sent', () => { const { v, log, rec } = rig(); v.listen(); rec().onend(); assert.deepEqual(log.final, []); });
test('voice: a second tap while listening does not start a second recogniser', () => { const { v, rec } = rig(); v.listen(); v.listen(); assert.equal(instances.length, 1); });
test('voice: unsupported browsers say so and typing is unaffected', () => {
  const saved = globalThis.SpeechRecognition; delete globalThis.SpeechRecognition;
  const log = []; const v = createVoice({ onState: s => log.push(s) }); v.listen();
  assert.equal(canListen(), false); assert.match(log.at(-1).message, /isn.t supported/); assert.equal(canSpeak(), false); assert.equal(speakReplies(), false);
  globalThis.SpeechRecognition = saved;
});
test('voice: preferences live in this browser only and tolerate blocked storage', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => setSpeakReplies(true)); assert.equal(speakReplies(), false);
  delete globalThis.localStorage;
});

test('voice: on-device recognition is requested only when the browser can and the person asked', async () => {
  const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const { canListenOnDevice, onDeviceSpeech, setOnDeviceSpeech } = await import('../../js/core/agent/voice.js');
  assert.equal(canListenOnDevice(), false, 'this browser has no processLocally'); setOnDeviceSpeech(true); assert.equal(onDeviceSpeech(), false, 'cannot be on where it is unsupported');
  FakeRec.prototype.processLocally = false;                                           // a browser that supports it
  assert.equal(canListenOnDevice(), true); assert.equal(onDeviceSpeech(), true);
  const { v, rec } = rig(); v.listen(); assert.equal(rec().processLocally, true, 'recognition is asked to stay on the device');
  v.cancel(); setOnDeviceSpeech(false);
  const b = rig(); b.v.listen(); assert.notEqual(b.rec().processLocally, true, 'not requested when off'); b.v.cancel();
  delete FakeRec.prototype.processLocally; delete globalThis.localStorage;
});
