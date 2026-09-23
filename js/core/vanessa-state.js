/* ============================================================ Vanessa state
   Her presence, as one value the whole interface can see.

     idle        nothing happening; a slow drift
     ready       she has just finished loading what she needs
     thinking    working out an answer
     responding  words arriving
     listening   the microphone is on
     opening     handing you a workspace
     success     something you asked for is done
     error       something went wrong

   It lives on <html data-vanessa="…">, so every orb — the home stage, the
   rail, the top bar, the corner pill, the phone dock, her own panel — reacts
   together through CSS alone. No orb is ever told individually.

   Transient states (ready, responding, opening, success, error) fall back to
   idle on their own after a moment, so a missed reset can never leave her
   stuck looking busy.
============================================================================ */
const HOLD = { ready: 1600, responding: 1400, opening: 1100, success: 1800, error: 2600 };
let timer = null;
let current = 'idle';
const listeners = new Set();

export function setVanessaState(next = 'idle') {
  clearTimeout(timer);
  current = next;
  document.documentElement.dataset.vanessa = next;
  listeners.forEach(fn => { try { fn(next); } catch { /* a listener never breaks her */ } });
  if (HOLD[next]) timer = setTimeout(() => setVanessaState('idle'), HOLD[next]);
}

export const vanessaState = () => current;
export function onVanessaState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
