/* ============================================================ evaluation workflow
   Vanessa's flagship: from "I need to do an eval" to "Done. Anything else?"

     choose   Which tour? — the evaluator's own claimed evals, most relevant
              first (today, then soonest, then undated), with unclaimed guides
              leading at the time they named. Picking one opens the Eval
              Tracker's own form for it.
     notes    "Tell me how it went." Whatever they type next is notes for THIS
              evaluation — nobody has to say "for the tour I just picked".
     suggest  Polished wording from those notes (vanessa-write.js), with
              Use this · Shorter · More direct · Softer · Edit · Start over.
     review   What the FORM now holds, read back from the form: rating,
              strengths, improvements. Submit here is the form's own Submit.

   What it never does:
   · write to the form without a click (and it asks before replacing words
     already in a field)
   · submit without the review card's button — "submit it" typed shows the
     review; it does not send
   · take the form away: the person can type in it, edit, submit or close it
     at any point, and she simply follows what the form holds

   Claiming, opening and submitting are the Eval Tracker's own functions —
   claimGuide(), queueOpenEval(), and the form's submit handler. There is no
   second implementation of any of them here.
============================================================================ */
import { state, inTraining } from './state.js';
import { canRun } from './vanessa-context.js';
import { workContext, onWorkContext } from './vanessa-work.js';
import { startFlow, updateFlow, endFlow, activeFlow } from './vanessa-memory.js';
import { polishFeedback, soundsLikeFeedback, explicitRating } from './vanessa-write.js';
import { roster, myClaims, tourOf } from './vanessa-facts.js';
import { explainError } from './vanessa-errors.js';
import { NO, first, context, openAction, performAction, denied, go } from './vanessa-exec.js';
import { setVanessaState } from './vanessa-state.js';
import { findPeople } from './vanessa.js';
import { prettyTime, prettyDate, todayISO } from './ui.js';
import { claimGuide, queueOpenEval, mayReadEval } from '../modules/evals.js';

const FLOW = 'evaluate';
const dayLabel = d => !d ? '' : d === todayISO() ? 'today' : prettyDate(d);
const whenLabel = t => t ? [t.start ? prettyTime(t.start) : '', dayLabel(t.date)].filter(Boolean).join(' · ') : 'no tour picked yet';
const inDay = (date, day) => !day || (date >= day.from && date <= day.to);
const allowed = () => inTraining() && canRun(openAction('evals'));

/* Most relevant first: today, then soonest upcoming, then undated, then past. */
function byRelevance(a, b) {
  const rank = t => !t ? 2 : t.date === todayISO() ? 0 : t.date > todayISO() ? 1 : 3;
  const ta = tourOf(a), tb = tourOf(b);
  return rank(ta) - rank(tb) || (ta?.date || '').localeCompare(tb?.date || '') || (ta?.start || '').localeCompare(tb?.start || '') || a.name.localeCompare(b.name);
}

const optionFor = (g, day) => {
  const t = tourOf(g, day);
  return { label: `${first(g.name)} — ${t?.start ? prettyTime(t.start) : 'no time set'}`,
    sub: [g.name, dayLabel(t?.date) || 'no tour date yet'].filter(Boolean).join(' · '),
    run: () => chooseEval(g, t) };
};

/* ------------------------------------------------------------ start */
export async function startEvaluation(u = {}, { notes = '' } = {}) {
  if (!allowed()) return denied();
  const r = await roster();
  if (!r.ok) return { type: 'reply', kind: 'error', text: 'I couldn’t load the eval roster just now, so I can’t list your tours.', retry: () => startEvaluation(u, { notes }) };

  startFlow(FLOW, 'choose', { notes });
  const names = u.names || [];
  if (names.length) { const named = byName(names, notes); if (named) return named; }

  const day = u.day || null, time = u.time || null;
  const mine = myClaims().sort(byRelevance);
  const fits = g => {
    const t = tourOf(g, day);
    if (day && !t) return false;
    if (time) return g.time === time || (g.tours || []).some(x => x.start === time && inDay(x.date, day));
    return true;
  };
  const claimed = mine.filter(fits);

  // Exactly one that fits what they said: no question needed.
  if (claimed.length === 1 && (time || day || mine.length === 1)) return chooseEval(claimed[0], tourOf(claimed[0], day));

  const open = (time || day) ? (state.guides || []).filter(g => g.status === 'open' && !g.skip && fits(g)).slice(0, 4) : [];
  if (!claimed.length && !open.length) {
    if (!mine.length) return claimSomeone(day);
    return { type: 'select', flow: FLOW, title: 'I couldn’t match that to one of your evaluations.', text: 'Here are the ones you have claimed:',
      options: mine.slice(0, 6).map(g => optionFor(g)), extra: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
  }
  return {
    type: 'select', flow: FLOW,
    title: notes ? 'Which tour is this feedback for?' : 'Which tour are you evaluating?',
    options: [
      ...claimed.slice(0, 6).map(g => optionFor(g, day)),
      ...open.map(g => { const t = tourOf(g, day); return { label: `${first(g.name)} — ${t?.start ? prettyTime(t.start) : 'tour'}`,
        sub: `${g.name} · not claimed yet · ${g.priority || ''}`.replace(/ · $/, ''), run: () => confirmClaim(g, t) }; })
    ],
    extra: [{ label: 'Someone else', run: () => claimSomeone(day) }]
  };
}

/* "Open John's evaluation." Any status, handled honestly. */
function byName(words, notes) {
  const hits = findPeople(words.join(' '), (state.guides || []).filter(g => !g.skip), g => g.name);
  if (!hits.length) return null;
  const mine = hits.filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed');
  if (mine.length === 1) return chooseEval(mine[0], tourOf(mine[0]));
  if (hits.length > 1) {
    return { type: 'select', flow: FLOW, title: `Which ${first(hits[0].name)} did you mean?`,
      options: hits.slice(0, 5).map(g => ({ label: `${g.name}${tourOf(g)?.start ? ` — ${prettyTime(tourOf(g).start)}` : ''}`,
        sub: statusLine(g), run: () => openFor(g) })) };
  }
  return openFor(hits[0]);
}
const statusLine = g => g.evaluatorId === state.me?.id ? (g.status === 'claimed' ? `yours · ${whenLabel(tourOf(g))}` : 'yours · submitted')
  : g.status === 'open' ? 'not claimed yet' : g.status === 'claimed' ? `being evaluated by ${g.evaluator || 'someone else'}` : `submitted${g.evaluator ? ` by ${g.evaluator}` : ''}`;

function openFor(g) {
  if (g.evaluatorId === state.me?.id && g.status === 'claimed') return chooseEval(g, tourOf(g));
  if (g.status === 'open') return confirmClaim(g, tourOf(g));
  if (g.status === 'claimed') {
    endFlow('cancelled');
    return { type: 'reply', text: `${g.evaluator || 'Someone else'} is evaluating ${g.name}, so that form is theirs to fill in.`, actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
  }
  endFlow('completed');
  if (!mayReadEval(g)) return { type: 'reply', text: `${g.name}’s evaluation has already been submitted. Only codirectors can read submitted feedback.` };
  queueOpenEval(g.id);
  const say = `Opening ${first(g.name)}’s submitted evaluation.`;
  return context().route === 'evals' ? { type: 'handoff', to: 'evals', text: say } : performAction(openAction('evals'), { params: { say } });
}

/* No claims yet: offer guides who need one and lead soon. */
function claimSomeone(day) {
  const soon = (state.guides || []).filter(g => g.status === 'open' && !g.skip && tourOf(g, day))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || byRelevance(a, b)).slice(0, 5);
  if (!soon.length) {
    endFlow('cancelled');
    return { type: 'reply', text: myClaims().length ? 'Nobody unclaimed has a tour coming up that I can see.' : 'You haven’t claimed anyone yet, and nobody unclaimed has a tour coming up on the schedule.',
      actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
  }
  return { type: 'select', flow: FLOW, title: myClaims().length ? 'These guides still need an evaluation:' : 'You haven’t claimed anyone yet.',
    text: 'These guides need an evaluation and have tours coming up. Pick one and I’ll claim it — I’ll check with you first.',
    options: soon.map(g => { const t = tourOf(g, day); return { label: `${first(g.name)} — ${whenLabel(t)}`, sub: `${g.name} · ${g.priority || 'priority not set'}`, run: () => confirmClaim(g, t) }; }),
    extra: [go('evals', 'Browse everyone')].filter(Boolean) };
}

/* Claiming takes a guide away from everyone else — always a confirmation,
   then the tracker's own claimGuide(). */
function confirmClaim(g, t) {
  return {
    type: 'confirm', flow: FLOW, title: `Claim ${g.name}?`,
    text: 'This puts your name on their evaluation so nobody else takes it. Then I’ll open the form.',
    rows: [['Guide', g.name], ['Priority', g.priority || '—'], ['Tour', whenLabel(t)]],
    confirm: { label: 'Claim and evaluate', run: async () => {
      if (!allowed()) return { type: 'reply', kind: 'alert', text: NO };          // checked again at the moment of writing
      try { await claimGuide(g, t ? { date: t.date, time: t.start || null } : {}); }
      catch (err) { return { type: 'reply', kind: 'error', text: explainError(err, 'claiming') }; }
      setVanessaState('success');
      return chooseEval((state.guides || []).find(x => x.id === g.id) || g, t);
    } },
    cancel: { label: 'Not now' }
  };
}

/* ------------------------------------------------------------ the form */
function chooseEval(g, t) {
  if (!allowed()) return denied();
  if (!activeFlow(FLOW)) startFlow(FLOW, 'choose', {});
  const notes = activeFlow(FLOW).data.notes || '';
  updateFlow({ step: 'notes', evalId: g.id, name: g.name, tour: t || null });
  const when = t?.start ? `${prettyTime(t.start)} tour` : 'tour';
  const say = notes
    ? `Opening ${first(g.name)}’s evaluation. Here’s your feedback, written up:`
    : `Opening ${first(g.name)}’s evaluation for the ${when}. When you’re ready, tell me how it went in your own words — rough is fine — and I’ll turn it into feedback for you to approve.`;
  const hand = handToEval(g, say);
  // Not `then`: a plan with a then() is a thenable, and awaiting it would never settle.
  if (notes && hand?.type === 'handoff') hand.next = () => suggestFor(notes);
  return hand;
}

function handToEval(g, say) {
  queueOpenEval(g.id);
  if (context().route === 'evals') { setVanessaState('opening'); return { type: 'handoff', to: 'evals', text: say, stay: true }; }
  const out = performAction(openAction('evals'), { params: { say } });
  return out?.type === 'handoff' ? { ...out, text: say, stay: true } : out;
}

/** The open form for this evaluation — reopening it if it was closed. Its
    own saved draft brings back anything already typed. */
async function ensureForm(evalId) {
  const live = () => { const w = workContext(); return w?.kind === 'eval-form' && w.data.evalId === evalId ? w : null; };
  if (live()) return live();
  const g = (state.guides || []).find(x => x.id === evalId);
  if (!g || g.status !== 'claimed' || g.evaluatorId !== state.me?.id) return null;
  queueOpenEval(evalId);
  if (context().route !== 'evals') performAction(openAction('evals'), { params: { say: '' } });
  if (live()) return live();
  return new Promise(resolve => {
    const stop = onWorkContext(() => { if (live()) { stop(); clearTimeout(t); resolve(live()); } });
    const t = setTimeout(() => { stop(); resolve(live()); }, 5000);
  });
}

/* ------------------------------------------------------------ suggestion */
export function suggestFor(rough, { style = null, variant = 0 } = {}) {
  const f = activeFlow(FLOW);
  if (!f?.data.evalId) return null;
  const st = style || f.data.style || 'normal';
  const s = polishFeedback(rough, { name: f.data.name, style: st, variant });
  if (s.empty) {
    updateFlow({ step: 'notes' });
    return { type: 'reply', text: `I couldn’t pick out anything to work with there. Tell me a little about what ${first(f.data.name)} did well and what could be better — even a few words is enough.` };
  }
  updateFlow({ step: 'suggest', rough, style: st, variant, suggestion: s });
  return suggestPlan(f.data, s, st);
}

function suggestPlan(d, s, style) {
  const TONE = { short: 'Shorter version', direct: 'More direct', soft: 'Softer', normal: '' };
  return {
    type: 'suggest', flow: FLOW, generated: true,
    title: `For ${first(d.name)}’s evaluation${TONE[style] ? ` · ${TONE[style]}` : ''}`,
    text: 'Written from your notes — nothing goes into the form until you choose.',
    parts: [['wentWell', 'What went well', s.wentWell], ['improve', 'Areas to improve', s.improve]]
      .filter(([, , t]) => t).map(([key, label, text]) => ({ key, label, text })),
    rating: s.rating,
    actions: {
      use:     () => useSuggestion({ s }),
      short:   () => refine('short'),
      direct:  () => refine('direct'),
      soft:    () => refine('soft'),
      edit:    () => useSuggestion({ s, thenEdit: true }),
      restart: () => restart()
    }
  };
}

export function refine(style) {
  const f = activeFlow(FLOW);
  if (!f?.data.rough) return { type: 'reply', text: 'There’s no suggestion of mine to change right now. Tell me how the tour went and I’ll write one.' };
  if (style === 'restart') return restart();
  const again = style === 'again' || style === f.data.style;
  return suggestFor(f.data.rough, { style: style === 'again' ? f.data.style : style, variant: again ? (f.data.variant || 0) + 1 : 0 });
}

function restart() {
  const f = activeFlow(FLOW);
  if (!f) return null;
  updateFlow({ step: 'notes', rough: '', suggestion: null, style: 'normal', variant: 0 });
  return { type: 'reply', text: `Starting fresh. Tell me again how ${first(f.data.name)}’s tour went.` };
}

/* Into the form, through the form. Words already in a field are never
   replaced without asking. */
async function useSuggestion({ s = null, replace = false, append = false, thenEdit = false } = {}) {
  const f = activeFlow(FLOW);
  s = s || f?.data.suggestion;
  if (!s) return null;
  if (!allowed()) return denied();
  const form = await ensureForm(f.data.evalId);
  if (!form) return { type: 'reply', kind: 'alert', text: 'I couldn’t open that evaluation’s form, so nothing was added. It may have been submitted or unclaimed.', actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };

  const parts = [['wentWell', 'What went well', s.wentWell], ['improve', 'Areas to improve', s.improve]].filter(([, , t]) => t);
  const busy = parts.filter(([k, , t]) => form.read(k).trim() && form.read(k).trim() !== t);
  if (busy.length && !replace && !append) {
    return { type: 'confirm', flow: FLOW, title: `The form already has writing under ${busy.map(b => b[1]).join(' and ')}.`,
      text: 'Replace it with my version, or add mine underneath?',
      rows: busy.map(([k, label]) => [`Now in ${label}`, form.read(k)]),
      confirm: { label: 'Replace', run: () => useSuggestion({ s, replace: true, thenEdit }) },
      secondary: [{ label: 'Add below', run: () => useSuggestion({ s, append: true, thenEdit }) }],
      cancel: { label: 'Keep mine' } };
  }
  for (const [k, , t] of parts) {
    const now = form.read(k).trim();
    form.write(k, append && now && now !== t ? `${now}\n\n${t}` : t);
  }
  if (s.rating && !form.read('rating')) form.write('rating', s.rating);
  updateFlow({ step: 'review' });
  if (thenEdit) {
    form.focus('wentWell');
    return { type: 'reply', kind: 'confirm', text: 'It’s in the form — edit it however you like. Say “review it” when you want me to read it back, or submit it from the form yourself.', closeOnNarrow: true };
  }
  return reviewPlan(form, 'Added to the form.');
}

/* ------------------------------------------------------------ review & submit */
export async function review(lead = '') {
  const f = activeFlow(FLOW);
  if (!f?.data.evalId) return null;
  const form = await ensureForm(f.data.evalId);
  if (!form) return { type: 'reply', kind: 'alert', text: 'That evaluation’s form isn’t available any more — it may already be submitted.', actions: [go('evals', 'Open the Eval Tracker')].filter(Boolean) };
  return reviewPlan(form, lead);
}

function reviewPlan(form, lead = '') {
  const f = activeFlow(FLOW);
  const v = { rating: form.read('rating'), wentWell: form.read('wentWell').trim(), improve: form.read('improve').trim(), notes: form.read('notes').trim(),
    date: form.read('date'), time: form.read('time') };
  if (!v.wentWell && !v.improve) {
    updateFlow({ step: 'notes' });
    return { type: 'reply', text: `${lead ? lead + ' ' : ''}The form needs something under What went well or Areas to improve before it can be submitted. Tell me how the tour went and I’ll draft it.` };
  }
  updateFlow({ step: 'review' });
  const when = v.time ? `${prettyTime(v.time)} ` : '';
  return {
    type: 'confirm', flow: FLOW, source: 'form',
    title: `${lead ? lead + ' ' : ''}Here’s what I have for ${first(f.data.name)}’s ${when}tour:`,
    rows: [['Overall rating', v.rating ? `${v.rating} / 5` : 'Not set'], ['What went well', v.wentWell || '—'], ['Areas to improve', v.improve || '—'],
      ...(v.notes ? [['Other notes', v.notes]] : []), ...(v.date ? [['Tour', [prettyDate(v.date), v.time ? prettyTime(v.time) : ''].filter(Boolean).join(' · ')]] : [])],
    rate: v.rating ? null : { label: 'Add a rating?', run: n => { form.write('rating', n); return reviewPlan(form); } },
    confirm: { label: 'Submit evaluation', run: () => submitNow() },
    secondary: [{ label: 'Edit', run: () => { form.focus('wentWell'); return { type: 'reply', text: 'Over to you — it’s all in the form. Tell me when you want it read back.', closeOnNarrow: true }; } }],
    cancel: { label: 'Not yet', run: () => ({ type: 'reply', text: 'Okay — it’s saved as a draft in the form. Say “submit it” when you’re ready.' }) }
  };
}

async function submitNow() {
  const f = activeFlow(FLOW);
  if (!f?.data.evalId) return { type: 'reply', text: 'There’s no evaluation in progress to submit.' };
  if (!allowed()) return { type: 'reply', kind: 'alert', text: NO };             // at the moment of submitting, not when the card was drawn
  const form = await ensureForm(f.data.evalId);
  if (!form) return { type: 'reply', kind: 'alert', text: 'That form isn’t open, so nothing was submitted.' };
  const name = f.data.name;
  const result = await form.submit();                                            // the Eval Tracker's own submit handler
  if (!result.ok) {
    return { type: 'reply', kind: 'error', text: `${explainError(result.error, 'submitting the evaluation')} Your writing is still in the form.`, retry: () => submitNow() };
  }
  endFlow('completed');
  setVanessaState('success');
  return { type: 'reply', kind: 'confirm', text: `Done — ${first(name)}’s evaluation is submitted. Anything else?`,
    actions: [{ label: 'Evaluate another', run: () => startEvaluation({}) }, go('today', 'Back to Home')].filter(Boolean) };
}

/* ------------------------------------------------------------ continuing
   While the task is under way, the next message belongs to it — unless it
   is plainly something else, which is answered without losing the task. */
export async function continueEvaluation(u) {
  const f = activeFlow(FLOW);
  if (!f) return null;
  if (!allowed()) { endFlow('cancelled'); return denied(); }
  const step = f.step;

  if (step === 'suggest' && u.refine) return refine(u.refine);
  if (step === 'suggest' && u.intent === 'accept') return useSuggestion();
  if (u.intent === 'submit' || /^(?:review|read (?:it|that) back|check (?:it|this)|what do (?:we|you) have|show me (?:it|the review))\b/.test(u.text)) {
    return f.data.evalId ? review() : null;
  }
  if (!f.data.evalId) return null;                                            // still choosing: the choice card handles it
  const rating = explicitRating(u.raw);
  if (rating && u.words <= 6 && step !== 'notes') {
    const form = await ensureForm(f.data.evalId);
    if (form) { form.write('rating', rating); return reviewPlan(form, `Rating set to ${rating}.`); }
  }
  if (/^(?:let me |i(?:'ll| will) )?edit(?: it| this)?(?: myself)?$/.test(u.text)) {
    const form = await ensureForm(f.data.evalId);
    form?.focus('wentWell');
    return { type: 'reply', text: 'It’s all yours in the form.', closeOnNarrow: true };
  }
  const strongOther = u.score >= 0.8 && !['write_feedback', 'feedback_note', 'evaluate', 'refine', 'accept'].includes(u.intent);
  if (!strongOther && (u.intent === 'feedback_note' || soundsLikeFeedback(u.raw) || (step === 'notes' && u.words >= 4 && !u.question))) {
    return suggestFor(u.raw);
  }
  return null;
}

/* "help me write this", "polish my feedback" — for the open form or the task. */
export async function writeFeedback(u) {
  if (!inTraining()) return { type: 'reply', kind: 'alert', text: NO };
  const rough = u.raw.includes(':') ? u.raw.slice(u.raw.indexOf(':') + 1).trim() : '';
  let f = activeFlow(FLOW);
  const form = workContext()?.kind === 'eval-form' ? workContext() : null;
  if ((!f || !f.data.evalId) && form) {                              // they opened the form themselves: pick it up from there
    startFlow(FLOW, 'notes', { evalId: form.data.evalId, name: form.data.name });
    f = activeFlow(FLOW);
  }
  if (!f?.data.evalId) return startEvaluation(u, { notes: rough });
  const inForm = form ? `${form.read('wentWell')} ${form.read('improve')}`.trim() : '';
  const notes = rough.split(/\s+/).length >= 3 ? rough : inForm;
  if (notes) return suggestFor(notes);
  updateFlow({ step: 'notes' });
  return { type: 'reply', text: `Tell me roughly how ${first(f.data.name)}’s tour went — “confident, knew a lot, but talked too fast” is plenty — and I’ll write it up.` };
}

/* Notes typed with nothing open: whose tour were they about? */
export async function notesWithoutTask(u) {
  if (!inTraining()) return null;
  const form = workContext()?.kind === 'eval-form' ? workContext() : null;
  if (form) { startFlow(FLOW, 'notes', { evalId: form.data.evalId, name: form.data.name }); return suggestFor(u.raw); }
  return startEvaluation({ day: u.day, time: u.time }, { notes: u.raw });
}

/* A submit made in the form directly still finishes the task. */
document.addEventListener('hub:eval-submitted', e => {
  const f = activeFlow(FLOW);
  if (f && f.data.evalId === e.detail?.evalId) endFlow('completed');
});
