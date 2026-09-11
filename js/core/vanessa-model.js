/* ============================================================ the model tier
   An optional language model, used for ONE job: understanding a question that
   the keyword matcher did not.
   
   It never answers. It never sees a candidate, a score or an eval. It is handed
   the question and a list of the things Vanessa already knows how to do, and it
   picks the closest one. The deterministic code then produces the answer
   exactly as it always did.

   That constraint is the whole design. A small model is decent at "which of
   these is being asked for" and hopeless at averaging sixty-seven candidates,
   so it does the first and is never trusted with the second. The worst it can
   do is pick the wrong question — and it only ever runs when the alternative
   was "I did not follow that", so a wrong guess replaces nothing.

   Chrome supplies the model itself (Gemini Nano) and will not begin the
   download without a click, which is why this is a button rather than something
   that happens when the app opens.
============================================================================ */

const LM = () => self.LanguageModel || self.ai?.languageModel;

let session = null;
let state = 'unknown';     // unknown | unavailable | ready | loading | failed

export const modelState = () => state;
export const modelSupported = () => !!LM();

/** The questions Vanessa can already answer. The model maps onto this list. */
export const CANONICAL = [
  'who still needs an eval',
  'what are my evals',
  'how far along are the evals',
  'which guides have no scheduled tours',
  'who is worth discussing',
  'who is ungraded',
  'how many are undecided',
  'who are the top candidates',
  'how many are checked in',
  'who is leading tours today',
  'which desk slots are uncovered',
  'who is on the front desk monday',
  'tell me about NAME',
  'how do I claim someone',
  'how is the final score worked out',
  'why can I not see other evals',
  'what should I wear on tour',
  'what gets me a strike',
  'what are the rules about absences',
  'what are postcards for',
  'who works in the admissions office',
  'what do I do if I do not know an answer on tour',
  'how do I make a tour personal'
];

export async function checkAvailability() {
  const api = LM();
  if (!api) { state = 'unavailable'; return state; }
  try {
    const a = api.availability ? await api.availability() : 'available';
    state = (a === 'available' || a === 'downloadable' || a === 'downloading') ? 'unknown' : 'unavailable';
    return a;
  } catch {
    state = 'unavailable';
    return 'unavailable';
  }
}

/**
 * Must be called from a click: Chrome refuses to start the download otherwise.
 * `onProgress` gets 0..1 while the model is fetched.
 */
const REMEMBER = 'hub2.vanessa.model';

/** Has this person turned it on before on this device? */
export const wasEnabled = () => {
  try { return localStorage.getItem(REMEMBER) === '1'; } catch { return false; }
};

/**
 * Quietly restore on a later visit.
 *
 * The download only happens once -- Chrome keeps the model, not the site -- so
 * on every visit after the first this needs no click and no waiting, which is
 * what "runs when you open the app" actually looks like once the first time is
 * out of the way.
 */
export async function resumeIfEnabled() {
  if (!wasEnabled() || !LM()) return false;
  try {
    const a = await LM().availability();
    if (a !== 'available') return false;      // still needs a gesture; leave it
    return await enableModel();
  } catch { return false; }
}

export async function enableModel(onProgress) {
  const api = LM();
  if (!api) { state = 'unavailable'; throw new Error('This browser has no built-in model. Chrome or Edge on a laptop can do this; phones cannot yet.'); }

  state = 'loading';
  try {
    session = await api.create({
      initialPrompts: [{
        role: 'system',
        content:
          'You match a question to the closest item in a list. ' +
          'Reply with the matching item copied EXACTLY, and nothing else. ' +
          'If a person is named, reply with the item and put their name in place of NAME. ' +
          'If nothing in the list fits, reply exactly: NONE'
      }],
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          if (onProgress) onProgress(e.loaded ?? 0);
        });
      }
    });
    state = 'ready';
    try { localStorage.setItem(REMEMBER, '1'); } catch { /* private window */ }
    return true;
  } catch (err) {
    state = 'failed';
    session = null;
    throw new Error(err.message || 'The model could not be started.');
  }
}

export function disableModel() {
  try { session?.destroy?.(); } catch { /* already gone */ }
  session = null;
  state = 'unknown';
  try { localStorage.removeItem(REMEMBER); } catch { /* ignore */ }
}

/**
 * Which known question is this? Returns null rather than guessing loosely — an
 * answer to the wrong question is worse than admitting to not following.
 */
export async function interpret(question) {
  if (!session || state !== 'ready') return null;
  try {
    const reply = (await session.prompt(
      `List:\n${CANONICAL.map(c => `- ${c}`).join('\n')}\n\nQuestion: ${question}\n\nMatching item:`
    )).trim().replace(/^[-•*]\s*/, '').replace(/^["']|["']$/g, '');

    if (!reply || /^none$/i.test(reply)) return null;

    // Accept only something that really is on the list, allowing a name to have
    // been substituted for NAME. A model that invents an answer gets ignored.
    const exact = CANONICAL.find(c => c.toLowerCase() === reply.toLowerCase());
    if (exact) return exact;

    const slot = CANONICAL.find(c => c.includes('NAME'));
    if (slot) {
      const shape = new RegExp('^' + slot.replace('NAME', '(.+)').replace(/[.*+?^${}()|[\]\\]/g, m => m === '(' || m === ')' || m === '.' || m === '+' ? m : '\\' + m) + '$', 'i');
      const m = reply.match(shape);
      if (m) return reply;
    }
    return null;
  } catch {
    return null;
  }
}
