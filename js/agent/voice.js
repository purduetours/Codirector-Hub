/* ============================================================ voice, for the conversation
   Speaking to Vanessa and hearing her answer. It feeds the SAME send() as typing,
   so there is no separate voice logic: what you say becomes a message, and the
   reply is read aloud if you've turned that on.

   Uses the browser's own speech recognition and speech synthesis: there is no speech
   service, key or account behind it, nothing is recorded or stored by the Hub, and nothing
   here costs anything. Be aware where the audio goes, though: Chrome and Edge send it to
   their vendor's free speech service; Safari recognises on the device. Where the browser
   supports it, "Keep speech on this device" asks for on-device recognition instead.
   Where the browser has neither speech feature, the buttons simply don't appear and typing
   works as before (typing is always complete).

   States: idle -> listening -> processing -> idle   (or error, which explains itself)
   Saying "cancel" or pressing Escape stops listening without sending.
*/
import { toSpeech } from './format.js';

const Rec = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = () => typeof Rec() === 'function';
export const canSpeak = () => typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function';

const KEY = 'hub2.vanessa.voice';
const prefs = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = p => { try { localStorage.setItem(KEY, JSON.stringify({ ...prefs(), ...p })); } catch { /* storage blocked */ } };
export const speakReplies = () => !!prefs().speak && canSpeak();
export const handsFree = () => !!prefs().handsFree && canListen();
export const setSpeakReplies = on => save({ speak: !!on });
export const setHandsFree = on => save({ handsFree: !!on, ...(on ? { speak: true } : {}) });
/** Ask the browser to recognise speech on this device (only where it can). */
export const canListenOnDevice = () => { try { return canListen() && 'processLocally' in Rec().prototype; } catch { return false; } };
export const onDeviceSpeech = () => !!prefs().onDevice && canListenOnDevice();
export const setOnDeviceSpeech = on => save({ onDevice: !!on });

const ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser’s site settings, or type instead.',
  'service-not-allowed': 'The browser’s speech service isn’t available. Type instead.',
  'language-not-supported': 'On-device speech isn’t installed for this language yet. Turn off “Keep speech on this device” to use your browser’s speech service, or type instead.',
  'audio-capture': 'I can’t find a microphone. Check it’s connected, or type instead.',
  network: 'I couldn’t reach the browser’s speech service. Check the connection, or type instead.',
  'no-speech': 'I didn’t catch anything. Tap the mic and try again.',
  aborted: ''
};

export function createVoice({ onState = () => {}, onInterim = () => {}, onFinal = () => {}, lang = 'en-US' } = {}) {
  let rec = null, gen = 0, timer = null, state = 'idle', heard = '';
  const set = (s, extra = {}) => { state = s; onState({ state: s, ...extra }); };

  function stopTimers() { clearTimeout(timer); timer = null; }
  function listen() {
    if (rec) return;
    if (!canListen()) { set('error', { message: 'Voice input isn’t supported in this browser. You can type instead.' }); return; }
    if (globalThis.isSecureContext === false) { set('error', { message: 'The microphone needs a secure (https) connection.' }); return; }
    stopSpeaking();
    const my = ++gen; heard = '';
    let r;
    try {
      r = new (Rec())(); rec = r; r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      if (onDeviceSpeech()) { try { r.processLocally = true; } catch { /* not supported after all */ } }
      r.onresult = e => {
        if (my !== gen) return;
        let txt = '', final = false;
        for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0]?.transcript || ''; if (e.results[i].isFinal) final = true; }
        heard = txt.trim(); onInterim(heard);
        if (final) { set('processing'); }
      };
      r.onerror = e => { if (my !== gen) return; stopTimers(); rec = null; gen++; const m = ERRORS[e.error]; set(m ? 'error' : 'idle', { message: m || 'Voice input stopped.' }); };
      r.onend = () => {
        if (my !== gen) return; stopTimers(); rec = null;
        const text = heard.trim(); heard = '';
        if (!text) { set('idle'); return; }
        if (/^(?:cancel|never ?mind|stop listening)[.!]?$/i.test(text)) { set('idle', { cancelled: true }); return; }
        set('idle'); onFinal(text);
      };
      set('listening');
      r.start();                                               // must be inside the user's tap
      timer = setTimeout(() => stop(), 30000);                 // never listen forever
      timer?.unref?.();                                        // (Node only: lets test runs finish)
    } catch {
      gen++; rec = null; stopTimers(); set('error', { message: 'The microphone couldn’t start. Check permissions, or type instead.' });
    }
  }
  function stop() { if (!rec) return; const r = rec; try { r.stop(); } catch { cancel(); } timer = setTimeout(() => { if (rec === r) cancel(); }, 3000); }
  function cancel() { const r = rec; gen++; rec = null; heard = ''; stopTimers(); try { r?.abort(); } catch { /* already stopped */ } set('idle', { cancelled: true }); }
  return { listen, stop, cancel, get state() { return state; } };
}

let speaking = null;
export function speak(text, { onEnd = () => {} } = {}) {
  if (!canSpeak()) { onEnd(); return; }
  stopSpeaking();
  const t = toSpeech(text).slice(0, 700);
  if (!t) { onEnd(); return; }
  const u = new SpeechSynthesisUtterance(t);
  u.rate = 1.03; u.onend = u.onerror = () => { if (speaking === u) speaking = null; onEnd(); };
  speaking = u; globalThis.speechSynthesis.speak(u);
}
export function stopSpeaking() { speaking = null; try { globalThis.speechSynthesis?.cancel(); } catch { /* no synthesis */ } }
export const isSpeaking = () => !!speaking;
