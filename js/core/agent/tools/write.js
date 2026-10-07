/* A write tool never writes. It PREPARES: it validates everything, resolves every
   name, checks for conflicts, and returns exactly what would happen plus a
   function that would do it. The runtime stores that, shows it to the person,
   and only a confirmation (never the model) runs it.

   prepare(args, ctx) -> {
     summary   one sentence: "Assign Taylor Brown to evaluate Jordan Smith on Thursday at 2 PM."
     rows      [[label, value]] for the preview card
     params    the exact, final parameters. Frozen and hashed; the database holds the hash.
     risk      'low' | 'meaningful' | 'high'
     execute   async (params, ctx) => result      (calls an admin_* function; nothing else)
     verify    async (params, result, ctx) => {ok, done, total, detail}   (re-reads and checks)
     receipt   (params, result, verification) => string
     links     [{label, route}]
     warnings  [string]
   }
*/
export function writeTool(def) { return { ...def, write: true }; }

export const RISK = { LOW: 'low', MEANINGFUL: 'meaningful', HIGH: 'high' };
/** Bulk size decides risk when the action itself is only "meaningful". */
export const bySize = (n, { high = 10 } = {}) => n > high ? RISK.HIGH : RISK.MEANINGFUL;

/** Report what really happened after a multi-item write. */
export function tally(done, total, noun) {
  if (done === total) return { ok: true, done, total };
  if (done === 0) return { ok: false, done, total, detail: `None of the ${total} ${noun} could be saved.` };
  return { ok: false, done, total, partial: true, detail: `${done} of ${total} ${noun} saved; ${total - done} did not.` };
}
