/* ============================================================ Vanessa, the assistant: the controller
   Glues the engine to the page: one conversation per sign-in, the chat UI, voice, and the
   optional local model.

   Every message goes to the engine (engine/router.js), which answers it itself (Standard
   mode: recognises the request, runs typed tools, speaks from the results) and only asks a
   language model running on this computer, if one is set up and healthy, when the wording is
   unusual. If that model is off, absent or slow, nothing changes for the user. The only thing the
   engine hands back is "I didn't recognise that", and then her older built-in answers (handbook
   questions, writing an evaluation, undo) get their turn. Nothing here calls a paid service.
*/
import { state, setting, isAdmin } from '../state.js';
import { refreshIfStale } from '../auth.js';
import { createDeps, resetDepsCache } from './deps.js';
import { newConversation, isStale } from './state.js';
import { handleReply, confirmPending, makeCtx, executeTool } from './runtime.js';
import { createEngine } from './engine/router.js';
import { createLocalAI } from './local/index.js';
import { snapshot as metricsSnapshot } from './engine/metrics.js';
import { pageContext, suggestionsFor, starters } from './page.js';
import { createChatUi } from './chat-ui.js';
import { canListen, canSpeak, canListenOnDevice, onDeviceSpeech, setOnDeviceSpeech, createVoice, speak, stopSpeaking, speakReplies, setSpeakReplies, handsFree, setHandsFree, isSpeaking } from './voice.js';
import { classifyReply } from './pending.js';

import { currentModule, visibleModules } from '../router.js';

let conv = null, deps = null, engine = null, local = null, ui = null, busy = false, notedLocal = false, viaVoice = false;
let hooks = {};

const testKey = 'hub2.vanessa.test';
export function testMode() {
  if (!isAdmin()) return 'live';
  try { const v = localStorage.getItem(testKey); if (v === 'read_only' || v === 'mock') return v; } catch { /* storage blocked */ }
  const s = setting('vanessa.testMode', 'live');
  return s === 'read_only' || s === 'mock' ? s : 'live';
}
export function setTestMode(v) { try { v === 'live' ? localStorage.removeItem(testKey) : localStorage.setItem(testKey, v); } catch { /* storage blocked */ } hooks.paintBanner?.(); }

const owner = () => `${state.me?.id || ''}:${state.sessionVersion}`;
/** The optional local model, created on demand (the admin page uses it without a conversation). */
export const localAI = () => (local ||= createLocalAI());
function ensure() {
  if (!deps) deps = createDeps();
  localAI();
  if (!engine) engine = createEngine({ deps, local, isAdmin, mode: () => setting('vanessa.mode', 'auto') });
  if (!conv || conv.owner !== owner() || isStale(conv)) { conv = newConversation(owner()); resetDepsCache(); }
  return conv;
}

/* ------------------------------------------------------------ the engine's state */
/** Standard Vanessa needs nothing and is always available. */
export const agentAvailable = () => true;
export const agentStatus = () => ({ ...localAI().status(), standard: true, mode: setting('vanessa.mode', 'auto') === 'standard' ? 'standard' : localAI().status().mode });
/** Look at the local model (if one is set up). Never throws; "offline" is a normal answer. */
export async function checkAgent({ force = false } = {}) {
  try { await localAI().check({ force }); } catch { /* offline is fine */ }
  hooks.paintStatus?.();
  return agentStatus();
}
export const engineMetrics = () => metricsSnapshot();

/* ------------------------------------------------------------------ sending */
/** Anything a legacy, in-progress flow owns (writing an evaluation, a pending claim) goes to the legacy path. */
const LEGACY_START = /\b(?:write|submit|draft|finish|start)\b.*\b(?:eval|evaluation|feedback)\b|^(?:undo|revert)\b/i;
export const wantsLegacy = q => LEGACY_START.test(q);

/**
 * @returns {Promise<{handled:boolean}>} handled=false means "use the built-in answers for this message"
 */
export async function agentSend(text, { voice = false } = {}) {
  if (busy) { ui?.note('One moment — I’m still finishing the last thing.', 'is-quiet'); return { handled: true, busy: true }; }
  const c = ensure();
  const mode = testMode();
  // "yes" / "confirm" / "no" while something awaits confirmation are handled in code, never interpreted
  if (c.pending && classifyReply(text)) {
    busy = true;
    try {
      const r = await handleReply({ text, conv: c, deps, testMode: mode, emit: ev => { if (ev.type === 'status') hooks.status?.(ev.text); } });
      if (r) {
        if ('ok' in r) { ui.receipt({ ...r, text: r.text }); if (r.ok && speakReplies()) speak(r.text); }
        else ui.note(r.text);
        ui.syncConfirms(c.pending?.id, 'Cancelled');
        c.at = Date.now(); return { handled: true };
      }
    } finally { busy = false; hooks.idle?.(); }
  }
  if (!(await refreshIfStale())) { ui.note('Your sign-in has expired. Refresh the page and sign in again.'); return { handled: true }; }

  busy = true; viaVoice = voice;
  const turn = ui.beginTurn();
  hooks.working?.(true);
  try {
    const page = pageContext(id => visibleModules().find(m => m.id === id)?.title || id);
    const res = await engine.handle(text, { conv: c, testMode: mode, page, emit: ev => { ui.onEvent(turn, ev); if (ev.type === 'status') hooks.status?.(ev.text); } });
    ui.syncConfirms(c.pending?.id, 'Replaced by a newer request');
    const i = res.info || {};
    deps.logTurn({ engine: res.handled ? i.engine : 'legacy', intent: i.intent, confidence: i.confidence, localCalls: i.localCalls, providerFailed: i.providerFailed, latency: i.latency, tools: i.tools, failed: i.failed, ok: i.ok !== false, error: i.error, route: currentModule()?.id });
    if (i.providerFailed && !notedLocal && isAdmin()) { notedLocal = true; ui.note('The local AI isn’t responding, so I’m using standard mode. Everything still works.', 'is-quiet'); }
    hooks.paintStatus?.();
    if (!res.handled) { turn.root.remove(); return { handled: false, suggestions: res.suggestions }; }
    if (res.text && speakReplies()) speak(res.text, { onEnd: () => { if (handsFree()) hooks.listen?.(); } });
    return { handled: true };
  } finally { busy = false; hooks.working?.(false); hooks.idle?.(); }
}

export function cancelTurn() { /* answers are immediate; nothing is in flight to cancel */ }
export const agentBusy = () => busy;
export function resetAgent() { conv = null; deps = null; engine = null; local = null; notedLocal = false; busy = false; stopSpeaking(); resetDepsCache(); }
export function newConversationNow() { conv = null; ensure(); stopSpeaking(); }

/* -------------------------------------------------------------- home state */
export async function homeState() {
  const c = ensure(), who = deps.who(), route = currentModule()?.id || 'today';
  const h = new Date().getHours(), part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(who.name || '').trim().split(/\s+/)[0];
  const glance = [];
  try {
    const ctx = makeCtx({ deps, conv: c });
    const [next, act] = await Promise.all([executeTool('get_next_tour', {}, ctx), executeTool('get_action_center', { limit: 3 }, ctx)]);
    if (next.ok && next.data.next_tour) glance.push({ text: `Your next tour: ${next.data.next_tour.when}`, link: '#/schedule' });
    if (act.ok && act.data.urgent_or_action) glance.push({ text: `${act.data.urgent_or_action} thing${act.data.urgent_or_action === 1 ? '' : 's'} need${act.data.urgent_or_action === 1 ? 's' : ''} attention`, tone: 'warn', link: '#/actions' });
    const urgent = act.ok && act.data.items.find(i => i.level === 'urgent');
    if (urgent) glance.push({ text: urgent.title, tone: 'urgent' });
  } catch { /* the greeting is useful without them */ }
  const prompts = [...new Set([...suggestionsFor(route, who), ...starters(who)])].slice(0, 4);
  return { greeting: `${part}${first ? ', ' + first : ''}.`, glance: glance.slice(0, 3), prompts };
}

/* ------------------------------------------------------------------- mounting */
export function mountAgent({ panel, send }) {
  const log = panel.querySelector('#v-log'), input = panel.querySelector('#v-input'), form = panel.querySelector('#v-form');
  const live = document.createElement('div'); live.className = 'va-sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); panel.appendChild(live);
  const announce = t => { live.textContent = ''; setTimeout(() => { live.textContent = String(t).slice(0, 300); }, 30); };
  const closeIfNarrow = () => { if (matchMedia('(max-width: 760px)').matches) panel.querySelector('#v-close')?.click(); };

  ui = createChatUi({ log, announce,
    onLink: (route, o = {}) => { if (!route) return; if (route.startsWith('#')) location.hash = route; if (!o.silent) closeIfNarrow(); },
    onConfirm: async () => { busy = true; try { const r = await confirmPending({ conv: ensure(), deps, testMode: testMode(), how: 'button', emit: ev => ev.type === 'status' && hooks.status?.(ev.text) }); ui.receipt({ ...r, text: r.text || r.message }); if (r.ok && speakReplies()) speak(r.text); return r; } finally { busy = false; hooks.idle?.(); } },
    onCancel: async () => { const c = ensure(); const { createPending } = await import('./pending.js'); await createPending(c).cancel(makeCtx({ deps, conv: c })); ui.note('Okay, cancelled. Nothing was changed.'); },
    onAsk: q => send(q), onSpeak: t => { if (speakReplies()) speak(t); } });

  /* ---- composer: mic, read-aloud, status, interim transcript */
  const bar = document.createElement('div'); bar.className = 'va-compose-extra';
  const mic = document.createElement('button'); mic.type = 'button'; mic.id = 'va-mic'; mic.className = 'va-mic'; mic.setAttribute('aria-label', 'Speak to Vanessa'); mic.setAttribute('aria-pressed', 'false'); mic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';
  const interim = document.createElement('div'); interim.className = 'va-interim'; interim.hidden = true; interim.setAttribute('aria-hidden', 'true');
  const stat = document.createElement('div'); stat.className = 'va-status'; stat.hidden = true; stat.setAttribute('role', 'status');
  const banner = document.createElement('div'); banner.className = 'va-testbar'; banner.hidden = true;
  form.insertBefore(mic, form.querySelector('button[type=submit]'));
  form.before(banner, stat, interim);
  if (!canListen()) mic.hidden = true;

  const voice = createVoice({
    onState: s => {
      mic.classList.toggle('is-live', s.state === 'listening'); mic.setAttribute('aria-pressed', String(s.state === 'listening'));
      mic.setAttribute('aria-label', s.state === 'listening' ? 'Stop listening' : 'Speak to Vanessa');
      panel.classList.toggle('is-listening', s.state === 'listening');
      document.documentElement.dataset.vanessa = s.state === 'listening' ? 'listening' : document.documentElement.dataset.vanessa === 'listening' ? 'idle' : document.documentElement.dataset.vanessa;
      if (s.state === 'listening') { stat.hidden = false; stat.textContent = 'Listening… say “cancel” or press Esc to stop.'; announce('Listening'); }
      else if (s.state === 'processing') { stat.textContent = 'Got it…'; }
      else { interim.hidden = true; stat.hidden = !s.message; stat.textContent = s.message || ''; }
    },
    onInterim: t => { interim.hidden = !t; interim.textContent = t; },
    onFinal: t => { interim.hidden = true; stat.hidden = true; send(t, { voice: true }); }
  });
  mic.addEventListener('click', () => (voice.state === 'listening' ? voice.stop() : voice.listen()));
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && voice.state === 'listening') { e.stopPropagation(); voice.cancel(); } else if (e.key === 'Escape' && isSpeaking()) stopSpeaking(); }, true);
  hooks.listen = () => voice.listen();

  /* ---- status + working indicators */
  hooks.status = t => { stat.hidden = false; stat.textContent = t; };
  hooks.working = on => { panel.classList.toggle('is-working', on); form.querySelector('button[type=submit]').disabled = on; if (!on) { stat.hidden = voice.state !== 'listening'; } };
  hooks.idle = () => { if (voice.state !== 'listening') stat.hidden = true; };
  hooks.paintBanner = () => { const m = testMode(); banner.hidden = m === 'live'; banner.textContent = m === 'read_only' ? 'Test mode: read-only. Vanessa will answer questions but won’t prepare any changes.' : m === 'mock' ? 'Test mode: changes are rehearsed only. Nothing is saved.' : ''; };
  hooks.paintStatus = () => { const sub = panel.querySelector('#v-sub'), st = agentStatus(); panel.classList.add('va-active'); panel.classList.toggle('va-enhanced', st.mode === 'enhanced'); if (sub) sub.textContent = st.mode === 'enhanced' ? 'Your Co-Director assistant · enhanced with local AI' : 'Your Co-Director assistant'; };
  hooks.paintBanner();

  /* ---- options (read aloud, hands-free, test mode) */
  const opts = document.createElement('details'); opts.className = 'va-opts';
  opts.innerHTML = `<summary>Voice and options</summary><div class="va-optbody">
    <label class="va-toggle"><input type="checkbox" id="va-speak" ${speakReplies() ? 'checked' : ''} ${canSpeak() ? '' : 'disabled'}> Read answers aloud</label>
    <label class="va-toggle"><input type="checkbox" id="va-hands" ${handsFree() ? 'checked' : ''} ${canListen() && canSpeak() ? '' : 'disabled'}> Keep listening after she answers</label>
    ${canListenOnDevice() ? `<label class="va-toggle"><input type="checkbox" id="va-device" ${onDeviceSpeech() ? 'checked' : ''}> Keep speech on this device</label>` : ''}
    ${isAdmin() ? `<label class="va-sel">Test mode <select id="va-test"><option value="live">Off — real changes (always confirmed)</option><option value="mock">Rehearse — nothing is saved</option><option value="read_only">Read-only — no changes at all</option></select></label>` : ''}
    <p class="va-fine">Typing needs nothing and always works. Voice uses your browser’s own speech features, with no account or cost; the Hub records nothing. ${canListenOnDevice() ? 'Turn on “Keep speech on this device” so the audio isn’t sent to your browser’s speech service.' : 'In Chrome and Edge the audio goes to the browser’s free speech service; Safari recognises on the device.'}</p></div>`;
  panel.querySelector('.v-chips[data-suggestions]')?.before(opts);
  opts.addEventListener('change', e => {
    if (e.target.id === 'va-speak') { setSpeakReplies(e.target.checked); if (!e.target.checked) { stopSpeaking(); opts.querySelector('#va-hands').checked = false; setHandsFree(false); } }
    if (e.target.id === 'va-hands') { setHandsFree(e.target.checked); if (e.target.checked) opts.querySelector('#va-speak').checked = true; }
    if (e.target.id === 'va-device') setOnDeviceSpeech(e.target.checked);
    if (e.target.id === 'va-test') setTestMode(e.target.value);
  });
  const sel = opts.querySelector('#va-test'); if (sel) sel.value = testMode();

  /* ---- keyboard-safe on phones: size the panel to the visible viewport */
  const vv = window.visualViewport;
  const fit = () => { if (vv) panel.style.setProperty('--va-vh', `${Math.round(vv.height)}px`); };
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); fit();

  hooks.paintStatus();                       // she looks for a local model when first opened, not at every page load
  return { ui, home: async () => { const h = await homeState(); const el = ui.home({ ...h, testBanner: '' }); return el; }, checkAgent, voice };
}
