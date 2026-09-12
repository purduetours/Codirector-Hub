/* ==================================================== Vanessa, doing things
   Until now she could tell you that eight guides were unclaimed and then leave
   you to go and click the button yourself. This lets her finish the job.

   Three rules, because this is the first thing she does that writes to the
   database rather than reading from it:

   1. She always asks first. Claiming takes a guide out of the pool in front of
      everybody else, and a chatbot that acts on a half-understood sentence is
      worse than one that cannot act at all. Nothing happens without a yes.
   2. She names exactly who she is about to act on, so a wrong match is caught
      by the person rather than discovered afterwards.
   3. She never invents the write. Claiming goes through the same claimGuide()
      the Claim button uses, filter and all, so two people claiming the same
      guide at the same moment is settled the way it always was.
============================================================================ */
import { state, myName, inTraining } from './state.js';
import { claimGuide } from '../modules/evals.js';

/* "claim noah", "put me down for Jane Boilermaker", "I'll take Zach" */
const CLAIM = /\b(?:claim|put me down for|sign me up for|i(?:'| wi)?ll take|give me|assign me)\b\s*(.*)$/i;

let pending = null;                    // { guide } awaiting a yes
export const resetActions = () => { pending = null; };

const YES = /^\s*(y|ye|yes|yep|yeah|yup|sure|ok|okay|please|do it|go on|go ahead|sounds good|confirm)\b/i;
const NO  = /^\s*(n|no|nope|nah|not now|never ?mind|no thanks|cancel|stop|leave it)\b/i;

/** Score-based match so a fuller name beats a shared surname. */
function findGuides(text) {
  const q = String(text || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').trim();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return [];

  return (state.guides || []).map(g => {
    const name = String(g.name || '').toLowerCase();
    const parts = name.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
    let score = 0;
    for (const w of words) {
      if (parts.some(p => p === w)) score += 3;
      else if (parts.some(p => p.startsWith(w) && w.length >= 3)) score += 2;
      else if (name.includes(w) && w.length >= 4) score += 1;
    }
    return { g, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .reduce((keep, x, _i, all) => (x.score === all[0].score ? [...keep, x.g] : keep), []);
}

/**
 * Handle an action, or return null so the ordinary answering path takes over.
 * Async because it writes; the panel already awaits this shape.
 */
export async function handleAction(question) {
  const q = String(question || '').trim();

  /* --- answering a confirmation -------------------------------------- */
  if (pending) {
    const { guide } = pending;
    if (YES.test(q)) {
      pending = null;
      try {
        await claimGuide(guide);
        return { text: `Done — ${guide.name} is yours. Add the tour date on Eval Tracker when you know it.`, go: 'evals' };
      } catch (err) {
        return { text: err.message };
      }
    }
    if (NO.test(q)) { pending = null; return { text: 'Left it alone.' }; }
    pending = null;               // anything else: drop it and answer normally
  }

  const m = CLAIM.exec(q);
  if (!m) return null;
  if (!inTraining()) return { text: 'Claiming evals is for the training committee.' };

  const who = m[1].replace(/\b(for me|please|now|the eval|an eval|eval)\b/gi, '').trim();
  if (!who) return { text: 'Claim who? Give me a name and I will check they are still free.' };

  if (!(state.guides || []).length) {
    return { text: 'The roster has not loaded yet — give it a moment and ask me again.' };
  }

  const hits = findGuides(who);
  if (!hits.length)   return { text: `I cannot find anybody called "${who}" on the roster.` };
  if (hits.length > 1) {
    return { text: `Which one — ${hits.slice(0, 4).map(g => g.name).join(', ')}?` };
  }

  const g = hits[0];
  if (g.status !== 'open') {
    const mine = g.evaluatorId === state.me?.id;
    return { text: mine
      ? `You already have ${g.name}.`
      : `${g.name} is already taken${g.evaluator ? ` — ${g.evaluator} has them` : ''}.` };
  }

  pending = { guide: g };
  return { text: `Claim ${g.name}${g.priority ? ` (${g.priority})` : ''} for you? Say yes and I will put your name on it.` };
}
