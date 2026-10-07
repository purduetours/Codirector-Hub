/* ============================================================ evaluators
   Who may evaluate, how many they already have, and whether they are paused.
   Shared by the Evaluation Roster screen and by Vanessa, so both mean the same
   thing by "available evaluator".

   Anyone whose role is on the training team (or is an administrator) can
   evaluate; `evaluator_available` lets someone be kept out of auto-match without
   changing their role.
============================================================================ */
import { select } from './db.js';

export async function loadEvaluators(guides = []) {
  const [mem, roles] = await Promise.all([
    select('members', 'select=id,full_name,role,evaluator_available&active=eq.true&order=full_name.asc').catch(() => select('members', 'select=id,full_name,role&active=eq.true')),
    select('roles', 'select=name,is_admin,in_training')
  ]);
  const team = new Set(roles.filter(r => r.in_training || r.is_admin).map(r => r.name));
  const claimed = new Map();
  guides.forEach(g => { if (g.evaluatorId) claimed.set(g.evaluatorId, (claimed.get(g.evaluatorId) || 0) + 1); });
  return mem.filter(m => team.has(m.role)).map(m => ({ id: m.id, name: m.full_name, available: m.evaluator_available !== false, workload: claimed.get(m.id) || 0 }));
}
