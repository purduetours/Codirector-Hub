/* ============================================================ pending actions
   Vanessa never writes on her own say-so. The sequence is:

     1. a write tool PREPARES the action (validated, conflicts checked)
     2. propose(): the exact parameters are frozen and hashed, and the database
        records the proposal (vanessa_begin_action) with the hash, an expiry and
        the person it belongs to
     3. the person sees what will happen and says yes (button, or a bare "yes")
     4. confirm(): the hash is recomputed from the frozen parameters and the
        DATABASE checks it matches what was shown, that it hasn't expired, hasn't
        been used and belongs to this person. Only then does anything run.
     5. the action runs through the same admin_* function the screens use, then
        the result is RE-READ and checked. Only a verified result is called done.

   The model is not involved after step 2. It cannot confirm, edit or replay an
   action; the words "yes" and "confirm" are matched here, deterministically.
*/
import { hashParams, deepFreeze } from './schema.js';
import { friendly } from './errors.js';

const YES = /^(?:y|yes|yep|yeah|yup|sure|ok|okay|confirm(?:ed)?|do it|go ahead|go for it|sounds good|please do|make it so|approved?|that works|yes please|yes,? (?:please|do it|go ahead|confirm))[.! ]*$/i;
const EXPLICIT = /^(?:yes,? )?(?:i )?confirm(?:ed)?[.! ]*$/i;
const NO = /^(?:n|no|nope|nah|cancel|stop|don'?t|do not|never ?mind|abort|not now|no thanks|forget it|scratch that)[.! ]*$/i;
export const classifyReply = t => { const s = String(t || '').trim(); return EXPLICIT.test(s) ? 'explicit' : YES.test(s) ? 'yes' : NO.test(s) ? 'no' : null; };

const TTL = { high: 5 * 60e3, meaningful: 10 * 60e3, low: 10 * 60e3 };

export function createPending(conv) {
  return {
    current: () => conv.pending,

    async propose(tool, prepared, ctx) {
      const params = deepFreeze(JSON.parse(JSON.stringify(prepared.params ?? {})));
      const hash = await hashParams({ tool: tool.name, params });
      const mode = ctx.testMode === 'mock' ? 'mock' : 'live';
      const id = await ctx.deps.rpc('vanessa_begin_action', { p_kind: tool.name, p_hash: hash, p_summary: prepared.summary, p_risk: prepared.risk, p_mode: mode });
      conv.pending = { id, tool, prepared: { ...prepared, params }, hash, risk: prepared.risk, mode, at: Date.now(), expires: Date.now() + (TTL[prepared.risk] || TTL.meaningful), turn: conv.turns };
      return view(conv.pending);
    },

    /** @param how 'yes' | 'explicit' | 'button' */
    async confirm(ctx, how = 'button') {
      const p = conv.pending;
      if (!p) return { ok: false, code: 'none', message: 'Nothing is waiting for confirmation.' };
      if (Date.now() > p.expires) { conv.pending = null; return { ok: false, code: 'expired', message: 'That request expired. Ask me again and I’ll set it up fresh.' }; }
      if (p.risk === 'high' && how === 'yes') return { ok: false, code: 'needs_explicit', message: `This one is high-impact, so I need an explicit confirmation. Press Confirm, or type “confirm”.\n\n${p.prepared.summary}` };
      conv.pending = null;                                         // single use, whatever happens next
      const params = p.prepared.params;
      const hash = await hashParams({ tool: p.tool.name, params });   // recomputed, not trusted from memory
      try {
        await ctx.deps.rpc('vanessa_confirm_action', { p_id: p.id, p_hash: hash });
      } catch (e) { return { ok: false, code: 'refused', message: friendly(e) }; }

      let result = null, verification = null, error = null;
      if (p.mode === 'mock') {
        verification = { ok: true, done: 1, total: 1, mock: true };
        await finish(ctx, p, true, { mock: true });
        return { ok: true, mock: true, receipt: `TEST MODE — nothing was saved. Would have done: ${p.prepared.summary}`, links: p.prepared.links, tool: p.tool.name };
      }
      const exec = { ...ctx, deps: { ...ctx.deps, rpc: (n, a) => ctx.deps.rpc(n, a, { via: p.id }), insert: (t, r) => ctx.deps.insert(t, r, { via: p.id }) } };
      try { result = await p.prepared.execute(params, exec); } catch (e) { error = e; }
      if (error) {
        await finish(ctx, p, false, { error: String(error.message || error).slice(0, 300) });
        return { ok: false, code: 'failed', message: `I couldn’t save that. ${friendly(error)} Nothing was reported as done.`, retryable: true };
      }
      try { verification = p.prepared.verify ? await p.prepared.verify(params, result, ctx) : { ok: true, done: 1, total: 1 }; }
      catch { verification = { ok: false, unknown: true, done: 0, total: 1, detail: 'I saved it, but I couldn’t re-check the result to be sure.' }; }
      await finish(ctx, p, verification.ok, { done: verification.done, total: verification.total });
      if (verification.ok) return { ok: true, receipt: p.prepared.receipt ? p.prepared.receipt(params, result, verification) : 'Done.', links: p.prepared.links, tool: p.tool.name, result };
      if (verification.partial) return { ok: false, partial: true, code: 'partial', message: `${verification.detail} Nothing else was changed. I can retry the rest if you want.`, links: p.prepared.links, tool: p.tool.name };
      return { ok: false, code: 'unverified', message: verification.detail || 'I couldn’t confirm that it saved, so I won’t call it done. Check the page, or ask me to try again.', links: p.prepared.links, tool: p.tool.name };
    },

    async cancel(ctx) {
      const p = conv.pending; if (!p) return false;
      conv.pending = null;
      try { await ctx.deps.rpc('vanessa_cancel_action', { p_id: p.id }); } catch { /* it expires on its own */ }
      return true;
    }
  };
}

async function finish(ctx, p, ok, result) { try { await ctx.deps.rpc('vanessa_finish_action', { p_id: p.id, p_ok: !!ok, p_result: result }); } catch { /* the write already happened or didn't; logging must not change that */ } }

export const view = p => ({ id: p.id, tool: p.tool.name, summary: p.prepared.summary, rows: p.prepared.rows || [], warnings: p.prepared.warnings || [], risk: p.risk, mode: p.mode, expires: p.expires, links: p.prepared.links || [], reasons: p.prepared.reasons });
