/* ============================================================ running a tool, and confirming a change
   The two things every route (Standard, or Enhanced with a local model) shares:

     executeTool   validate -> permission check -> run, or (for a change) PREPARE
     handleReply   a bare "yes" / "confirm" / "no" while a change is waiting

   What this file guarantees, whoever asked:
     - a tool the person's role doesn't have is never run
     - every argument is validated against the tool's schema before it runs
     - a write tool only PREPARES; confirmation is handled here, in code, never by a model
     - nothing is reported done that wasn't verified (see pending.js)
   It has no DOM and no globals: everything it touches arrives through `deps`.
*/
import { byName } from './registry.js';
import { can, CAPABILITIES } from './capabilities.js';
import { validate, canonical } from './schema.js';
import { ToolError } from './tools/kit.js';
import { friendly } from './errors.js';
import { clock, DEFAULT_TZ } from './time.js';
import { remember } from './state.js';
import { createPending, classifyReply } from './pending.js';

export const LIMITS = { toolMs: 25000, maxInput: 2000, cacheMs: 20000 };
const NO_CACHE = new Set(['find_eval_opportunities', 'get_training_gaps', 'get_briefing', 'open_page']);

/** Everything a tool may touch, built per turn. */
export function makeCtx({ deps, conv, now = deps.now?.() || new Date(), testMode = 'live' }) {
  const who = deps.who();
  const tz = deps.tz || DEFAULT_TZ;
  const { today } = clock(now, tz);
  const ctx = { deps, who, now, tz, today, term: deps.term?.(), state: conv.agent, testMode, conv };
  ctx.call = async (name, args = {}) => { const r = await executeTool(name, args, ctx, { internal: true }); return r.ok ? r.data : null; };
  return ctx;
}

const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('That took too long.')), ms); })]).finally(() => clearTimeout(t)); };

/** Validate -> permission -> run/prepare. Never throws; returns {ok, ...}. */
export async function executeTool(name, input, ctx, { internal = false, emit } = {}) {
  const tool = byName.get(name);
  if (!tool) return { ok: false, error: 'unknown_tool', message: `There's no tool called ${name}.` };
  if (!can(tool.cap, ctx.who)) return { ok: false, error: 'not_permitted', message: `That needs access to “${CAPABILITIES[tool.cap]?.label || tool.cap}”, which your role doesn’t include.` };
  if (tool.write && ctx.testMode === 'read_only') return { ok: false, error: 'test_mode', message: 'Vanessa is in read-only test mode, so she can’t prepare changes.' };
  const v = validate(input, tool.input_schema);
  if (!v.ok) return { ok: false, error: 'invalid_input', message: v.errors.join(' ') };

  const key = name + canonical(v.value), cache = ctx.state.cache || (ctx.state.cache = new Map());
  if (!tool.write && !NO_CACHE.has(name)) { const hit = cache.get(key); if (hit && Date.now() - hit.at < LIMITS.cacheMs) return hit.r; }
  try {
    let r;
    if (tool.write) {
      const prepared = await withTimeout(tool.prepare(v.value, ctx), LIMITS.toolMs);
      if (!['low', 'meaningful', 'high'].includes(prepared.risk)) throw new Error('A write tool returned no risk level.');
      const pend = createPending(ctx.conv);
      const view = await pend.propose(tool, prepared, ctx);
      r = { ok: true, data: { status: 'awaiting_user_confirmation', summary: prepared.summary, risk: prepared.risk, warnings: prepared.warnings || [], instruction: 'The user now sees a confirmation card. Tell them briefly what you will do and ask them to confirm. Do NOT say it is done.' }, pending: view, focus: prepared.focus };
    } else r = await withTimeout(tool.run(v.value, ctx), LIMITS.toolMs);
    if (!tool.write && !NO_CACHE.has(name)) cache.set(key, { at: Date.now(), r });
    return r;
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.code, message: e.message, extra: e.extra };
    return { ok: false, error: 'tool_failed', message: friendly(e), internal: String(e?.message || e).slice(0, 200) };
  }
}

/* ----------------------------------------------------- confirmations (no model) */
/** A bare "yes"/"confirm"/"no" is handled here, never by the model. Returns null if `text` isn't one. */
export async function handleReply({ text, conv, deps, emit = () => {}, testMode = 'live' }) {
  const kind = classifyReply(text);
  if (!kind || !conv.pending) return null;
  const ctx = makeCtx({ deps, conv, testMode });
  const pend = createPending(conv);
  conv.at = Date.now();
  if (kind === 'no') {
    const s = conv.pending.prepared.summary;
    await pend.cancel(ctx);
    conv.messages.push({ role: 'user', content: text }, { role: 'assistant', content: `Cancelled. I didn’t do this: ${s}` });
    emit({ type: 'cancelled', summary: s });
    return { handled: true, text: 'Okay, cancelled. Nothing was changed.' };
  }
  // a bare "yes" only counts if the proposal was the last thing said
  if (conv.pending.turn !== conv.turns) {
    const s = conv.pending.prepared.summary;
    return { handled: true, text: `Just to be sure — do you want me to go ahead with this?\n\n${s}\n\nPress Confirm, or type “confirm”.` };
  }
  return confirmPending({ conv, deps, emit, testMode, how: kind, said: text });
}

export async function confirmPending({ conv, deps, emit = () => {}, testMode = 'live', how = 'button', said }) {
  const ctx = makeCtx({ deps, conv, testMode });
  const pend = createPending(conv);
  emit({ type: 'status', text: 'Saving that…' });
  const r = await pend.confirm(ctx, how);
  conv.messages.push({ role: 'user', content: said || '(confirmed in the interface)' });
  const text = r.ok ? (r.mock ? r.receipt : r.receipt) : r.message;
  conv.messages.push({ role: 'assistant', content: r.ok ? `Done. ${r.receipt}` : `That did not complete: ${r.message}` });
  if (r.code === 'needs_explicit') { conv.pending = pend.current() || conv.pending; }
  if (r.ok) { conv.agent.cache = new Map(); deps.invalidate?.(); remember(conv, { focus: r.result?.focus }); conv.receipts.unshift({ at: Date.now(), text: r.receipt, tool: r.tool }); }
  emit({ type: 'receipt', ...r, text });
  return { handled: true, ...r, text };
}
