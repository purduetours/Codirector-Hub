/* ============================================================ the capability router
   Every intent Vanessa can act on is declared here, by capability module, and each one
   says everything the engine needs to run it safely:

     permission   which entry of ../capabilities.js (who may use what) it needs
     mode         'read' | 'write'
     confirm      'always' for writes: the change is prepared, shown, and only runs after a yes
     people       how it treats names: 'none' | 'optional' | 'required' | 'many'
     params       which filters it accepts (anything else a request carries is dropped)
     promote      { slot: intent } when a follow-up adds a slot this intent can't take
     run(q, t)    the execution function: calls typed tools through t.call / t.must
     respond(r,q,t) the response builder: facts in, sentences out

   Both ways in (the deterministic engine and the optional local model) produce the same
   Query and go through here, so they share one permission check and one set of rules.
   There is no way to ask for something that is not in this table.
*/
import schedule from './schedule.js';
import evaluations from './evaluations.js';
import training from './training.js';
import coverage from './coverage.js';
import people from './people.js';
import operations from './operations.js';
import data from './data.js';
import assistant from './assistant.js';
import { CAPABILITIES, can } from '../capabilities.js';

export const MODULES = [schedule, evaluations, training, coverage, people, operations, data, assistant];
export const HANDLERS = new Map();
for (const m of MODULES) for (const [id, h] of Object.entries(m.intents)) HANDLERS.set(id, { ...h, id, capability: m.id });

export const handlerFor = id => HANDLERS.get(id) || null;
export const isWrite = id => handlerFor(id)?.mode === 'write';
/** Intents this person may use: what the local model is offered, and what the engine will run. */
export const allowedIntents = who => [...HANDLERS.values()].filter(h => can(h.permission, who)).map(h => h.id);

/** Run by the tests: the intent catalogue and the capability table must agree, and every handler must be well formed. */
export function checkCapabilities(intentIds) {
  const problems = [];
  const ids = new Set(intentIds);
  for (const id of ids) if (!HANDLERS.has(id)) problems.push(`${id}: recognised but has no capability handler`);
  for (const [id, h] of HANDLERS) {
    if (!ids.has(id)) problems.push(`${id}: has a handler but no intent definition`);
    if (!CAPABILITIES[h.permission]) problems.push(`${id}: unknown permission ${h.permission}`);
    if (!['read', 'write'].includes(h.mode)) problems.push(`${id}: mode must be read or write`);
    if (h.mode === 'write' && h.confirm !== 'always') problems.push(`${id}: a write must require confirmation`);
    if (!['none', 'optional', 'required', 'many'].includes(h.people)) problems.push(`${id}: people policy missing`);
    if (!Array.isArray(h.params)) problems.push(`${id}: params must be a list`);
    if (typeof h.run !== 'function' || typeof h.respond !== 'function') problems.push(`${id}: needs run() and respond()`);
  }
  return problems;
}
