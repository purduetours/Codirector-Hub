/* ============================================================ execution
   The one door every Vanessa action walks through, clicked or typed.

     context()        who, where, what is open — built on demand from what the
                      app already knows, never cached, never fetched
     openAction(id)   the registry's "open this tool" action
     actionById(id)   an action from a button's data-action
     performAction()  permission-checked AT THE MOMENT IT RUNS, then handed to
                      the router or the module that owns it
     denied(tool)     the polite no, with nearby things this account CAN do

   Split out of vanessa-os.js so the workflows (vanessa-flow-*.js) can run
   actions without importing the layer that routes to them.
============================================================================ */
import { state, myName, isAdmin, inTraining, inRecruitment } from './state.js';
import { visibleModules, currentModule, morphTo } from './router.js';
import { resolveActions, canRun } from './vanessa-context.js';
import { workContext } from './vanessa-work.js';
import { activeFlow } from './vanessa-memory.js';
import { setVanessaState } from './vanessa-state.js';
import { todayISO } from './ui.js';
import { focusTraining } from '../modules/training.js';

export const NO = "That tool isn't available for your account.";
export const first = name => String(name || '').trim().split(/\s+/)[0] || '';
export const toolTitle = id => visibleModules().find(m => m.id === id)?.title || 'that';

/* ------------------------------------------------------------ context
   Four levels, one object: the user, the application, the session (what
   she is in the middle of) and a pointer to the data context. Cheap enough
   to build per message — it reads references, it copies nothing. */
export function context() {
  const m = currentModule();
  return {
    user: { id: state.me?.id || null, firstName: first(myName()), role: state.role?.name || '' },
    can: { admin: isAdmin(), training: inTraining(), recruitment: inRecruitment() },
    route: m?.id || 'today',
    module: m?.title || 'Home',
    record: workContext(),           // an open form or selected record, if a module published one
    flow: activeFlow(),              // the task under way, if any
    today: todayISO()
  };
}

export function openAction(to, params) {
  return resolveActions(context().route).find(a => a.kind === 'open' && a.to === to)
      || resolveActions('today').find(a => a.kind === 'open' && a.to === to)
      || { id: `open-${to}`, kind: 'open', to, title: toolTitle(to), params };
}

export function actionById(id) {
  const route = context().route;
  return resolveActions(route).find(a => a.id === id) || resolveActions('today').find(a => a.id === id) || null;
}

/** Nearby things this account can do, for a refusal that is not a dead end. */
export function denied(extra = '') {
  const alts = resolveActions('today').filter(a => a.kind === 'open' && a.to !== 'today').slice(0, 2);
  return { type: 'reply', kind: 'alert', text: NO + (extra ? ` ${extra}` : ''),
    actions: alts.map(a => ({ label: a.title, run: () => performAction(a) })) };
}

export function performAction(action, { from = null, params = null } = {}) {
  if (!action || !canRun(action)) return { type: 'reply', kind: 'alert', text: NO };    // checked every time, never trusted from a hidden button
  if (action.kind === 'ask') {
    document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: action.q } }));
    return null;
  }
  const p = params || action.params || {};
  if (action.to === 'training' && (p.date || p.tab || p.session)) focusTraining({ date: p.date, tab: p.tab, session: p.session });
  setVanessaState('opening');
  morphTo(action.to, from);
  return { type: 'handoff', to: action.to, text: p.say || `Opening ${toolTitle(action.to)}.` };
}

/** A plan button that opens a tool — or nothing at all, if this account cannot. */
export function go(to, label = null, params = null) {
  const a = openAction(to);
  return canRun(a) ? { label: label || `Open ${toolTitle(to)}`, go: to, run: () => performAction(a, { params }) } : null;
}
