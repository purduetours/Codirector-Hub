/* ============================================================ Vanessa OS
   The thin orchestration layer that lets people think in tasks, not pages.

   Every request — a button she shows, or a sentence someone types — goes
   through the same five steps:

     1. interpret   which intent is this?            (INTENTS, below)
     2. resolve     which action or workflow?        (the registry in vanessa-context.js)
     3. check       may this account do it, NOW?     (canRun — at execution time,
                                                      never trusting that a hidden
                                                      button stayed hidden)
     4. validate    is the context there?            (a claimed eval, a loaded roster…)
     5. execute     through the module's own logic   (claimGuide, queueOpenEval,
                                                      focusTraining, the router)

   It owns no business logic. Claiming is claimGuide(), the same function the
   Claim button calls; opening an evaluation is the Eval Tracker's own form;
   attendance is the Training module's own tab. Vanessa decides WHAT to do
   and asks the module that already knows HOW.

   What comes back is a plan — a response component the panel renders:

     { type: 'reply',    kind, text }                 message / warning / failure
     { type: 'select',   title, text, options, extra } pick from existing records
     { type: 'confirm',  title, text, rows, confirm, cancel }   review before commit
     { type: 'suggest',  title, parts, again }        wording to Use / Edit / Try again
     { type: 'summary',  title, text, rows, actions } structured information
     { type: 'handoff',  to, text }                   she is opening a workspace

   Options and buttons carry run(), which may return the next plan — that is
   what makes a workflow chain: "evaluate a tour" → which tour? → claim first?
   → open the form.
============================================================================ */
import { state, myName, isAdmin, inTraining, inRecruitment } from './state.js';
import { visibleModules, currentModule, morphTo } from './router.js';
import { resolveActions, canRun, TOOL_INFO } from './vanessa-context.js';
import { workContext } from './vanessa-work.js';
import { polishFeedback } from './vanessa-write.js';
import { setVanessaState } from './vanessa-state.js';
import { prettyTime, prettyDate, todayISO } from './ui.js';
import { presenceSnapshot } from './presence.js';
import { evalDraft, editEvalDraft } from './vanessa-eval.js';
import { loadRoster, claimGuide, queueOpenEval } from '../modules/evals.js';
import { focusTraining, trainingSources } from '../modules/training.js';

const NO = "That tool isn't available for your account.";
const first = name => String(name || '').trim().split(/\s+/)[0] || '';
const title = id => visibleModules().find(m => m.id === id)?.title || 'that';

/* ------------------------------------------------------------ context
   One place that knows the situation, so no module has to teach Vanessa. */
export function context() {
  const m = currentModule();
  return {
    user: { id: state.me?.id || null, firstName: first(myName()), role: state.role?.name || '' },
    can: { admin: isAdmin(), training: inTraining(), recruitment: inRecruitment() },
    route: m?.id || 'today',
    module: m?.title || 'Home',
    record: workContext(),
    today: todayISO()
  };
}

/* ------------------------------------------------------------ execution
   The single door every action walks through, clicked or typed. */
export function openAction(to, params) {
  return resolveActions(context().route).find(a => a.kind === 'open' && a.to === to)
      || resolveActions('today').find(a => a.kind === 'open' && a.to === to)
      || { id: `open-${to}`, kind: 'open', to, title: title(to), params };
}

/** Look an action up by id, for buttons that carry data-action. */
export function actionById(id) {
  const route = context().route;
  return resolveActions(route).find(a => a.id === id) || resolveActions('today').find(a => a.id === id) || null;
}

export function performAction(action, { from = null, params = null } = {}) {
  if (!action) return { type: 'reply', kind: 'alert', text: NO };
  if (!canRun(action)) return { type: 'reply', kind: 'alert', text: NO };    // step 3, every time
  if (action.kind === 'ask') {
    document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: action.q } }));
    return null;
  }
  const p = params || action.params || {};
  if (action.to === 'training' && p.date) focusTraining({ date: p.date });
  setVanessaState('opening');
  morphTo(action.to, from);
  return { type: 'handoff', to: action.to, text: p.say || `Opening ${title(action.to)}.` };
}

/* ------------------------------------------------------------ helpers */
const WORDS_OF_DAY = { today: 0, tonight: 0, tomorrow: 1 };
function dayFrom(q) {
  const m = /\b(today|tonight|tomorrow)\b/i.exec(q);
  if (!m) return null;
  const d = new Date(); d.setDate(d.getDate() + WORDS_OF_DAY[m[1].toLowerCase()]);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/* "2 PM", "2pm", "2:00", "14:30" — a bare number is only a time with am/pm
   or a colon, so "2 evals" is never read as two o'clock. */
function timeFrom(q) {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\b|$)/i.exec(q.replace(/\b(\d+)\s+(evals?|guides?|tours?|people)\b/gi, ''));
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]); const min = m[2] || '00'; const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if (!ap && h < 8) h += 12;                         // "the 2:00 tour" is the afternoon
  return `${String(h).padStart(2, '0')}:${min}`;
}
function nameHits(q, list) {
  const words = q.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const STOP = new Set(['the', 'tour', 'eval', 'evaluate', 'evaluation', 'need', 'want', 'for', 'and', 'with', 'today', 'tomorrow', 'this', 'that', 'can', 'you', 'help', 'let', 'start', 'pm', 'am']);
  const keys = words.filter(w => !STOP.has(w));
  if (!keys.length) return [];
  return list.filter(g => {
    const parts = String(g.name || '').toLowerCase().replace(/[()]/g, ' ').split(/\s+/);
    return keys.some(w => parts.some(p => p === w || (w.length >= 3 && p.startsWith(w))));
  });
}
/** The tour a claimed eval is for: its scheduled one, else their next one. */
function tourOf(g, day = null) {
  if (g.date && (!day || g.date === day)) return { date: g.date, start: g.time || '' };
  const t = (g.tours || []).find(x => x.date >= todayISO() && (!day || x.date === day));
  return t ? { date: t.date, start: t.start } : null;
}
const whenLabel = t => t ? [t.start ? prettyTime(t.start) : '', t.date === todayISO() ? 'today' : prettyDate(t.date)].filter(Boolean).join(' · ') : 'no tour picked yet';

/* ------------------------------------------------------------ workflows */

/** Open a claimed eval's form, from Vanessa, through the tracker's own form. */
function handToEval(g, t) {
  const say = `Got it. Opening the evaluation for ${first(g.name)}${t?.start ? `’s ${prettyTime(t.start)} tour` : ''}.`;
  if (!canRun(openAction('evals'))) return { type: 'reply', kind: 'alert', text: NO };
  queueOpenEval(g.id);
  // Already in the tracker: the form opens where you are, no page change.
  if (context().route === 'evals') { setVanessaState('opening'); return { type: 'handoff', to: 'evals', text: say }; }
  const out = performAction(openAction('evals'), { params: { say } });
  return out?.type === 'handoff' ? { ...out, text: say } : out;
}

async function startEvaluation(q) {
  if (!inTraining()) return { type: 'reply', kind: 'alert', text: NO };
  if (!(state.guides || []).length) {
    try { await loadRoster(); } catch { return { type: 'reply', kind: 'error', text: 'I could not load the eval roster just now. Try again in a moment.' }; }
  }
  const day = dayFrom(q), time = timeFrom(q);
  const mine = state.guides.filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed');
  const fits = g => {
    const t = tourOf(g, day);
    if (day && !t) return false;
    if (time) return (g.tours || []).some(x => x.start === time && (!day || x.date === day)) || (g.time === time);
    return true;
  };
  let claimed = mine.filter(fits);
  const named = nameHits(q, claimed);
  if (named.length) claimed = named;

  // Exactly one: no question needed, straight into the form.
  if (claimed.length === 1 && (time || named.length || mine.length === 1)) return handToEval(claimed[0], tourOf(claimed[0], day));

  // Guides still open whose tour matches, if a time or name was given.
  const open = (time || day || nameHits(q, state.guides).length)
    ? state.guides.filter(g => g.status === 'open' && fits(g) && (!nameHits(q, state.guides).length || nameHits(q, [g]).length)).slice(0, 4)
    : [];

  if (!claimed.length && !open.length) {
    return { type: 'select', title: mine.length ? 'I could not match that tour to one of your evals.' : 'You have no claimed evals yet.',
      text: mine.length ? 'Pick one of yours, or look on the Eval Tracker.' : 'Claim a guide first — the Eval Tracker shows who is up for grabs and when they lead.',
      options: mine.slice(0, 6).map(g => ({ label: `${first(g.name)} — ${whenLabel(tourOf(g))}`, sub: g.name, run: () => handToEval(g, tourOf(g)) })),
      extra: [{ label: 'Open the Eval Tracker', run: () => performAction(openAction('evals')) }] };
  }

  return {
    type: 'select', title: 'Which tour are you evaluating?',
    options: [
      ...claimed.slice(0, 6).map(g => { const t = tourOf(g, day); return {
        label: `${t?.start ? prettyTime(t.start) : 'No time yet'} — ${first(g.name)}`,
        sub: `${g.name} · yours${t ? ` · ${t.date === todayISO() ? 'today' : prettyDate(t.date)}` : ''}`,
        run: () => handToEval(g, t) }; }),
      ...open.map(g => { const t = tourOf(g, day); return {
        label: `${t?.start ? prettyTime(t.start) : 'Tour'} — ${first(g.name)}`,
        sub: `${g.name} · unclaimed · ${g.priority || ''}`,
        run: () => confirmClaim(g, t) }; })
    ],
    extra: [{ label: 'Find another', run: () => performAction(openAction('evals')) }]
  };
}

/* Claiming writes, and takes a guide away from everyone else — so it is
   always a confirmation first, then the tracker's own claimGuide(). */
function confirmClaim(g, t) {
  return {
    type: 'confirm', title: `Claim ${g.name}?`,
    text: 'This puts your name on their evaluation so nobody else takes it. Then I will open the form.',
    rows: [['Guide', g.name], ['Priority', g.priority || '—'], ['Tour', whenLabel(t)]],
    confirm: { label: 'Claim and evaluate', run: async () => {
      if (!inTraining()) return { type: 'reply', kind: 'alert', text: NO };        // checked again at the moment of writing
      try {
        await claimGuide(g, t ? { date: t.date, time: t.start || null } : {});
      } catch (err) { return { type: 'reply', kind: 'error', text: err.message }; }
      setVanessaState('success');
      const fresh = state.guides.find(x => x.id === g.id) || g;
      return handToEval(fresh, t);
    } },
    cancel: { label: 'Not now' }
  };
}

function showAttendance(q) {
  const action = openAction('training');
  if (!canRun(action)) return { type: 'reply', kind: 'alert', text: NO };
  const date = dayFrom(q);
  const hit = date ? (trainingSources()?.sessions || []).find(s => s.held_on === date) : null;
  const say = date
    ? (hit ? `Opening attendance for ${hit.label}.` : `There is no training session on ${date === todayISO() ? 'today' : prettyDate(date)} — opening all attendance.`)
    : 'Opening attendance.';
  return performAction(action, { params: { date, say } });
}

function adminTools() {
  const tools = ['people', 'health', 'training'].filter(id => canRun(openAction(id)));
  if (!tools.length) return { type: 'reply', kind: 'alert', text: NO };
  return { type: 'select', title: 'Which admin tool?',
    options: tools.map(id => ({ label: title(id), sub: TOOL_INFO[id]?.explain || '', run: () => performAction(openAction(id)) })) };
}

async function showToday() {
  const rows = [];
  const today = todayISO();
  const mine = inTraining() ? (state.guides || []).filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed') : [];
  mine.filter(g => g.date === today).forEach(g => rows.push([g.time ? prettyTime(g.time) : 'Today', `Your eval · ${g.name}`]));
  const waiting = mine.filter(g => !g.date).length;
  if (waiting) rows.push(['Waiting', `${waiting} claimed eval${waiting === 1 ? ' has' : 's have'} no tour date`]);
  const snap = presenceSnapshot();
  if (snap && !snap.error && snap.users?.length > 1) rows.push(['Active', `${snap.users.length} teammates online`]);
  const actions = [openAction('schedule'), inTraining() ? openAction('evals') : null].filter(a => a && canRun(a));
  return { type: 'summary', title: 'Today', text: rows.length ? 'Here is what I can see for today.' : 'Nothing of yours is scheduled today.',
    rows, actions: actions.map(a => ({ label: a.title, run: () => performAction(a) })) };
}

/* Tool names from TOOL_INFO, longest first, so "eval tracker" beats "eval". */
const TOOL_NAMES = Object.entries(TOOL_INFO).flatMap(([id, t]) => t.names.map(n => [n, id])).sort((a, b) => b[0].length - a[0].length);
function openNamedTool(q) {
  const rest = q.replace(/^\s*(?:please\s+)?(?:open|go to|take me to|jump to|navigate to|bring up|pull up|show me|switch to)\s+(?:the\s+)?/i, '').replace(/[?.!]+$/, '').trim().toLowerCase();
  const hit = TOOL_NAMES.find(([n]) => rest === n || rest === `${n} page` || rest === `${n} tab` || rest === `${n} tool`);
  if (!hit) return null;
  return performAction(openAction(hit[1]));
}

/* ------------------------------------------------------------ writing
   Help with the evaluation that is open — the form, or her chat draft. The
   suggestion is only ever applied by a click, through the form's own field
   setter or the draft's own edit function. */
function roughFrom(q) {
  const after = q.includes(':') ? q.slice(q.indexOf(':') + 1) : q;
  return after.replace(/^\s*(can you |could you |please )?(help me )?(write|word|phrase|polish|reword|rewrite|clean up|improve|fix)\s+(this|my|the|a)?\s*(comment|feedback|wording|eval(uation)?|it)?\s*(for me)?\s*[.?!]?\s*/i, '').trim();
}

export function writingHelp(q, variant = 0) {
  const ctx = context();
  const form = ctx.record?.kind === 'eval-form' ? ctx.record : null;
  const draft = evalDraft();
  if (!form && !draft) return null;
  if (!inTraining()) return { type: 'reply', kind: 'alert', text: NO };

  let rough = roughFrom(q);
  if (rough.split(/\s+/).length < 3) {
    rough = form ? `${form.read('wentWell')} ${form.read('improve')}`.trim()
                 : `${draft.wentWell || ''} ${draft.improve || ''}`.trim();
  }
  const name = form ? form.data.name : draft.name;
  if (!rough) return { type: 'reply', text: `Tell me roughly how ${first(name)}'s tour went — "confident, knew everything, but talked too fast" is plenty — and I will suggest the wording.` };

  const s = polishFeedback(rough, { name, variant });
  if (s.empty) return { type: 'reply', text: 'I could not find anything to work with there. Try a few words about what went well and what could be better.' };

  const apply = (key, text) => {
    if (form && form.isOpen()) { form.write(key, text); return true; }
    const d = evalDraft();
    if (d) { editEvalDraft(d.draftId, d.revision, { [key]: text }); return true; }
    return false;
  };
  return {
    type: 'suggest', title: `For ${first(name)}'s evaluation`,
    text: 'From your notes — nothing changes until you choose.',
    parts: [['wentWell', 'What went well', s.wentWell], ['improve', 'Areas to improve', s.improve]]
      .filter(([, , t]) => t)
      .map(([key, label, text]) => ({ key, label, text,
        use: () => apply(key, text) ? { type: 'reply', kind: 'confirm', text: `Added to ${label}. You can still edit it before submitting.` }
                                    : { type: 'reply', kind: 'alert', text: 'That form has closed, so I could not add it. Nothing was changed.' } })),
    again: () => writingHelp(`${q}`, variant + 1)
  };
}

/* ------------------------------------------------------------ intents
   First match wins. Each returns a plan, or null to let the next one (and
   finally her ordinary answering) have a go. */
const INTENTS = [
  { id: 'write_feedback',
    when: q => /\b(write|word|phrase|polish|reword|rewrite|clean up|improve|fix|help)\b.{0,30}\b(comment|feedback|wording|this|it)\b/i.test(q)
            || (!!workContext() && /^\s*(they|he|she)\s+(were|was|did|talked|spoke|knew|seemed)\b/i.test(q)),
    run: q => writingHelp(q) },
  { id: 'start_evaluation',
    when: q => !/^\s*(who|how|which|what|when|why|is|are|do|does)\b/i.test(q) &&
               (/\b(evaluat\w*|observ\w*)\b/i.test(q) || /\b(eval|evaluation)\b.{0,20}\b(tour|the \d)/i.test(q) || /\bthe\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s+tour\b/i.test(q)),
    run: q => startEvaluation(q) },
  { id: 'open_attendance', when: q => /\battendance\b/i.test(q) && !/^\s*(who|how many|what are the)\b/i.test(q), run: q => showAttendance(q) },
  { id: 'open_admin', when: q => /\b(admin|codirector) (tools?|stuff|settings|area)\b|^\s*(open |show )?admin\s*$/i.test(q), run: () => adminTools() },
  { id: 'show_today', when: q => /^\s*(what'?s|what is|show( me)?|tell me)\s+(on\s+|up\s+|happening\s+)?(for\s+)?(today|my day)\b|\bwhat'?s (happening|going on) today\b|^\s*my day\s*$/i.test(q), run: () => showToday() },
  { id: 'open_tool', when: q => /^\s*(please\s+)?(open|go to|take me to|jump to|navigate to|bring up|pull up|show me|switch to)\b/i.test(q), run: q => openNamedTool(q) }
];

/** Interpret a typed request. A plan, or null for her ordinary answering. */
export async function interpret(question) {
  const q = String(question || '').trim();
  if (!q || !state.me) return null;
  for (const intent of INTENTS) {
    if (!intent.when(q)) continue;
    const plan = await intent.run(q);
    if (plan !== null && plan !== undefined) return { ...plan, intent: intent.id };
  }
  return null;
}
