/* ============================================================ one request, being carried out
   What a capability's run() and respond() are handed as `t`. It is the only way a
   capability reaches the Hub: every tool call goes through executeTool(), which validates
   the arguments, checks the person's role, and (for writes) only PREPARES a change.

   A capability can end a turn early in two ways, by throwing what these return:
     throw t.stop('plain explanation')            nothing more to do; say this
     throw t.ask('Which one?', options, 'person') a question; the next message answers it
*/
import { executeTool } from '../runtime.js';
import { remember } from '../state.js';
import { can } from '../capabilities.js';

export class StopTurn extends Error {
  constructor(o) { super(o.text || 'stop'); Object.assign(this, o); }
}

export function makeTurn({ ctx, q, dialog, engine }) {
  const t = {
    ctx, q, dialog, engine, deps: ctx.deps, who: ctx.who,
    results: [], used: [], failed: [], cards: [], pending: null, navigate: null, list: null,
    can: cap => can(cap, ctx.who),

    /** Run a tool. Never throws; returns { ok, data?, error?, message? }. */
    async call(name, args = {}, o = {}) {
      const r = await executeTool(name, args, ctx);
      t.used.push(name); if (!r.ok) t.failed.push(name);
      t.results.push({ name, args, r });
      if (r.ok) {
        remember(ctx.conv, r);
        if (r.list) t.list = r.list;
        if (r.card && o.card !== false) t.cards.push({ card: r.card, links: r.links, tool: name });
        if (r.pending) t.pending = r.pending;
        if (r.navigate) t.navigate = r.navigate;
      }
      return r;
    },
    /** Run a tool and stop the whole turn (with an explanation) if it failed. */
    async must(name, args, o) { const r = await t.call(name, args, o); if (!r.ok) throw new StopTurn({ failure: r, cards: 'drop' }); return r; },

    stop: (text, o = {}) => new StopTurn({ text, cards: 'drop', ...o }),
    ask: (question, options = [], slot = 'text', index) => new StopTurn({ text: question, cards: 'drop', ask: { question, options, slot, index } })
  };
  return t;
}
