/* ============================================================ the tool registry
   Every tool Vanessa has, in one list. Adding a capability to her is: write a
   tool object in tools/*.js, give it a `cap` from capabilities.js, and it
   appears here. (See VANESSA_ARCHITECTURE.md, "Adding a tool".)

   There is no generic "run this query" tool and there never should be.
*/
import { tools as peopleTools } from './tools/people.js';
import { tools as scheduleTools } from './tools/schedule.js';
import { tools as evalTools } from './tools/evals.js';
import { tools as trainingTools } from './tools/training.js';
import { tools as opsTools } from './tools/ops.js';
import { CAPABILITIES, can } from './capabilities.js';

export const ALL_TOOLS = [...peopleTools, ...scheduleTools, ...evalTools, ...trainingTools, ...opsTools];
export const byName = new Map(ALL_TOOLS.map(t => [t.name, t]));

/** Tools this person may use. What the model is shown, and what the runtime allows. */
export const toolsFor = who => ALL_TOOLS.filter(t => can(t.cap, who));

/** For the diagnostics page and tests: what exists, who gets it, and how risky it is. */
export function describeTools() {
  return ALL_TOOLS.map(t => ({ name: t.name, kind: t.write ? 'write' : 'read', capability: t.cap, label: CAPABILITIES[t.cap]?.label || t.cap }));
}

/** Throws if a tool is malformed. Run by the tests so a bad tool can't ship. */
export function checkRegistry() {
  const seen = new Set(), problems = [];
  for (const t of ALL_TOOLS) {
    if (!/^[a-z][a-z_]{2,40}$/.test(t.name)) problems.push(`${t.name}: bad name`);
    if (seen.has(t.name)) problems.push(`${t.name}: duplicate`); seen.add(t.name);
    if (!CAPABILITIES[t.cap]) problems.push(`${t.name}: unknown capability ${t.cap}`);
    if (!t.description || t.description.length < 30) problems.push(`${t.name}: description too thin`);
    if (t.input_schema?.type !== 'object') problems.push(`${t.name}: schema must be an object`);
    if (t.write ? typeof t.prepare !== 'function' : typeof t.run !== 'function') problems.push(`${t.name}: missing ${t.write ? 'prepare' : 'run'}`);
    if (t.write && /sql|query/i.test(t.name)) problems.push(`${t.name}: looks like raw database access`);
  }
  return problems;
}
