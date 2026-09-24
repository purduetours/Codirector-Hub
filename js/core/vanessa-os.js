/* ============================================================ Vanessa OS
   The coordinator. Every typed request goes through one pipeline:

     user input
       → understand      what do they want?          vanessa-language.js
       → context         who, where, what is open,   vanessa-exec.js context()
                         what task is under way       vanessa-memory.js
       → permission      may this account, NOW?      canRun, at execution time
       → resolve         which record? ask if two     vanessa-facts.js
       → confirm         before anything that writes  confirm plans
       → execute         the module's own function   claimGuide, queueOpenEval,
                                                      the eval form's Submit,
                                                      markMakeupDone, the router
       → result + next   a card with the next step    vanessa-ui.js renders it

   Step order inside interpret():

     1. control     cancel · go home · go back — always available, so nobody
                    is ever trapped inside a workflow
     2. the task    an evaluation under way gets the next message first:
                    "he was confident but rushed" is notes for THAT eval,
                    "make it shorter" reworks THAT suggestion
     3. references  "the second one", "open it", "his tour"
     4. intents     the fast, deterministic table below
     5. nothing     null — her existing answering (vanessa.js) takes over,
                    so every question she could answer before still works

   The fast path is the whole pipeline: nothing here waits on a model, and
   data is only loaded by the intents that need it, through the modules that
   own it. "Open attendance" resolves the instant it is sent.

   What comes back is a plan — a response component the panel renders:
     reply · select · confirm · suggest · summary · handoff
   Buttons carry run(), which may return the next plan: that is how a
   workflow chains without anybody typing.
============================================================================ */
import { state } from './state.js';
import { canRun, TOOL_INFO } from './vanessa-context.js';
import { understand } from './vanessa-language.js';
import { activeFlow, endFlow, previousRoute, recallOrdinal, lastList, rememberList } from './vanessa-memory.js';
import { workContext } from './vanessa-work.js';
import { presenceSnapshot } from './presence.js';
import { prettyTime, todayISO } from './ui.js';
import { evalDraft } from './vanessa-eval.js';
import { pendingConfirmation } from './vanessa-actions.js';
import { NO, first, context, openAction, actionById, performAction, denied, toolTitle } from './vanessa-exec.js';
import * as evalFlow from './vanessa-flow-eval.js';
import * as info from './vanessa-flow-info.js';

export { context, openAction, actionById, performAction };

/* ------------------------------------------------------------ control */
function cancel() {
  const f = endFlow('cancelled');
  if (!f && lastList()?.kind === 'choice') return { type: 'reply', text: 'Okay — dropped that.', cancelled: true };
  if (!f) return { type: 'reply', text: 'Okay. Nothing’s in progress — what would you like to do?' };
  const what = f.id === 'evaluate' && f.data.name ? `the evaluation for ${first(f.data.name)}` : 'that';
  const kept = f.id === 'evaluate' && f.data.evalId ? ' Anything already in the form stays saved there.' : '';
  return { type: 'reply', text: `Okay — I’ve stopped ${what}. Nothing was submitted.${kept}`, cancelled: true };
}

function goHome() {
  const f = endFlow('cancelled');
  if (context().route === 'today') return { type: 'reply', text: f ? 'Okay — stopped that. You’re already home.' : 'You’re already home.' };
  return performAction(openAction('today'), { params: { say: f ? 'Okay — stopped that. Taking you home.' : 'Taking you home.' } });
}

function goBack() {
  const prev = previousRoute();
  if (!prev || !canRun(openAction(prev))) return { type: 'reply', text: 'There’s nowhere to go back to yet.' };
  return performAction(openAction(prev), { params: { say: `Back to ${prev === 'today' ? 'Home' : toolTitle(prev)}.` } });
}

/* ------------------------------------------------------------ intents
   Intent → what the app does about it. Each handler checks its own
   permission (through the workflow it calls) and returns a plan, or null
   to let her ordinary answering have a go. */
const HANDLERS = {
  open_tool: u => {
    if (u.tool === 'today') return goHome();
    // "where's attendance": say where it lives, so next time they know.
    const title = toolTitle(u.tool);
    const say = u.toolName && !title.toLowerCase().includes(u.toolName.split(' ')[0]) && u.toolName !== 'eval'
      ? `${u.toolName[0].toUpperCase() + u.toolName.slice(1)} is in ${title} — opening it.` : null;
    const out = performAction(openAction(u.tool), say ? { params: { say } } : {});
    return out?.type === 'handoff' ? out : denied();
  },
  evaluate:        u => evalFlow.startEvaluation(u),
  write_feedback:  u => evalFlow.writeFeedback(u),
  feedback_note:   u => evalFlow.notesWithoutTask(u),
  refine:          u => (evalDraft() || u.words > 5 ? null : { type: 'reply', text: 'There’s nothing of mine to rework right now. Tell me how a tour went and I’ll write it up.' }),
  submit:          async u => {
    if (evalDraft() || u.c.howto) return null;                                  // her older chat draft has its own submit
    const form = workContext()?.kind === 'eval-form' ? workContext() : null;
    if (form) { await evalFlow.writeFeedback({ raw: '', names: [] }); return evalFlow.review(); }
    return { type: 'reply', text: 'There’s nothing waiting to be submitted right now.', actions: canRun(openAction('evals')) ? [{ label: 'Do an evaluation', run: () => evalFlow.startEvaluation({}) }] : [] };
  },
  evaluating:      u => info.whoEvaluating(u),
  attendance:      u => info.attendance(u),
  mark_attendance: () => info.markAttendance(),
  active:          () => info.showActive(),
  tours:           u => u.sub === 'mine' ? info.myNextTour()
                      : u.sub === 'slot' ? info.showSlot(u)
                      : u.sub === 'ref' ? info.resolveRef(u)
                      : u.sub === 'person' ? info.findPersonFlow(u)
                      : info.showTours(u),
  people:          u => info.findPersonFlow(u, { strict: !u.c.find }),
  help_here:       () => info.helpHere(),
  explain_tool:    u => info.explainTool(u),
  reference:       u => {
    if (u.ordinal !== null) {
      const item = recallOrdinal(u.ordinal);
      return item ? item.run() : { type: 'reply', text: 'I’m not sure which list you mean — could you name it?' };
    }
    return info.resolveRef(u);
  }
};

/* Two requests with no data behind them beyond what is on screen. */
function adminTools() {
  const tools = ['people', 'health', 'training'].filter(id => canRun(openAction(id)));
  if (!tools.length) return { type: 'reply', kind: 'alert', text: NO };
  return { type: 'select', title: 'Which admin tool?',
    options: tools.map(id => ({ label: toolTitle(id), sub: TOOL_INFO[id]?.explain || '', run: () => performAction(openAction(id)) })) };
}
function showToday() {
  const rows = [], today = todayISO();
  const mine = context().can.training ? (state.guides || []).filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed') : [];
  mine.filter(g => g.date === today).forEach(g => rows.push([g.time ? prettyTime(g.time) : 'Today', `Your eval · ${g.name}`]));
  const waiting = mine.filter(g => !g.date).length;
  if (waiting) rows.push(['Waiting', `${waiting} claimed eval${waiting === 1 ? ' has' : 's have'} no tour date`]);
  const snap = presenceSnapshot();
  if (snap && !snap.error && snap.users?.length > 1) rows.push(['Active', `${snap.users.length} teammates online`]);
  const actions = [openAction('schedule'), context().can.training ? openAction('evals') : null].filter(a => a && canRun(a));
  return { type: 'summary', title: 'Today', text: rows.length ? 'Here is what I can see for today.' : 'Nothing of yours is scheduled today.',
    rows, actions: actions.map(a => ({ label: a.title, run: () => performAction(a) })) };
}
const LEGACY = [
  { id: 'open_admin', when: t => /\b(admin|codirector) (tools?|stuff|settings|area)\b|^(open |show )?admin$/.test(t), run: adminTools },
  { id: 'show_today', when: t => /^(what is|show( me)?|tell me)\s+(on\s+|up\s+|happening\s+)?(for\s+)?(today|my day)\b|\bwhat is (happening|going on) today\b|^my day$/.test(t), run: showToday }
];

/* ------------------------------------------------------------ interpret */
/** A typed request → a plan, or null for her ordinary answering. */
export async function interpret(question) {
  const q = String(question || '').trim();
  if (!q || !state.me) return null;
  const u = understand(q);

  // 1. control — her older yes/no confirmations and chat draft keep their own words
  if (u.intent === 'cancel' && !pendingConfirmation() && !evalDraft()) { const out = cancel(); rememberList('choice', []); return { ...out, intent: 'cancel' }; }
  if (u.intent === 'home') return { ...goHome(), intent: 'home' };
  if (u.intent === 'back') return { ...goBack(), intent: 'back' };

  // 2. the task under way
  if (activeFlow('evaluate')) {
    const plan = await evalFlow.continueEvaluation(u);
    if (plan) return { ...plan, intent: 'evaluate' };
  }

  // 3–4. references and intents
  const run = HANDLERS[u.intent];
  if (run) {
    const plan = await run(u);
    if (plan) return { ...plan, intent: u.intent };
  }
  for (const l of LEGACY) if (l.when(u.text)) return { ...l.run(), intent: l.id };
  return null;
}

/** For tests and diagnostics: how a sentence reads, without running it. */
export { understand };
