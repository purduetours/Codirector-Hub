/* ============================================================ the optional local language model
   Enhanced Vanessa. Sits BEHIND the deterministic engine and is consulted only when a
   message isn't clearly one of the things she already knows. It does three small jobs:

     interpret   sentence -> a structured request from a closed menu (never an answer)
     rephrase    (off by default) reword a finished reply, discarded if it changes any fact
     health      is it there? (cheap, cached, and never an error to the user)

   If it is switched off, not installed, offline, slow, or returns something unusable, the engine
   carries on in Standard mode as if it had never been asked. A failure parks it for a minute so a
   dead server doesn't slow every message. There is no other provider to fall back to: the
   fallback for a local model is Standard Vanessa, never a paid service.
*/
import { effectiveConfig, checkEndpoint } from './config.js';
import { createProvider } from './providers.js';
import { systemPrompt, schema, rephrasePrompt } from './prompts.js';
import { buildQuery } from '../engine/compose.js';
import { handlerFor } from '../capabilities/index.js';
import { normalize } from '../engine/lexicon.js';

const HEALTH_MS = 30e3, PARK_MS = 60e3, HEALTH_TIMEOUT = 2500;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The JSON object in a model reply, however it was wrapped. */
export function parseModelJson(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Reject a reworded reply if it changed a number or introduced a name or link. */
export function guardRephrase(orig, out) {
  const o = String(orig || ''), r = String(out || '').trim().replace(/^["“]|["”]$/g, '');
  if (!r || r.length < 8 || r.length > o.length * 1.6 + 40 || /https?:|www\.|[<>]/.test(r)) return null;
  const nums = s => s.match(/\d+(?::\d{2})?/g) || [];
  const a = new Set(nums(o)), b = new Set(nums(r));
  if ([...b].some(n => !a.has(n)) || [...a].some(n => !b.has(n))) return null;
  const words = new Set(o.toLowerCase().match(/[a-z’']+/g) || []);
  const names = [...r.matchAll(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/g)].map(m => m[0].toLowerCase());
  if (names.some(w => !words.has(w))) return null;
  return r;
}

const grounded = (value, text) => { const v = normalize(String(value || '')); return v.length > 1 && normalize(text).includes(v); };
const cleanQuestion = q => { const s = String(q || '').replace(/[<>*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160); return s.length > 6 && /\?$/.test(s) ? s : 'Could you tell me a bit more about what you’d like?'; };

export function createLocalAI({ fetchImpl = (...a) => globalThis.fetch(...a), config = effectiveConfig, now = () => Date.now(), loader } = {}) {
  let health = { at: 0, ok: false, state: 'unknown', models: [], message: '' }, parkedUntil = 0, checking = null;
  const provider = () => { const cfg = config(); return createProvider(cfg, { fetchImpl, loader }); };

  async function check({ force = false } = {}) {
    const cfg = config();
    if (!cfg.enabled) return (health = { at: now(), ok: false, state: 'off', models: [], message: 'Switched off.' });
    if (!force && now() - health.at < HEALTH_MS && health.state !== 'unknown') return health;
    if (checking) return checking;
    checking = (async () => {
      const p = provider();
      if (!p.ok) return (health = { at: now(), ok: false, state: 'misconfigured', models: [], message: p.reason });
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT);
      try { const h = await p.provider.health(ctl.signal); health = { at: now(), ...h }; if (h.ok) parkedUntil = 0; }
      catch (e) { health = { at: now(), ok: false, state: 'offline', models: [], message: e?.name === 'AbortError' ? 'No answer from the local model.' : (e?.message || 'Offline.') }; }
      finally { clearTimeout(timer); }
      return health;
    })().finally(() => { checking = null; });
    return checking;
  }

  const api = {
    check,
    status() {
      const cfg = config(), enabled = !!cfg.enabled, ok = enabled && health.ok && now() >= parkedUntil;
      return { configured: enabled, enabled, provider: cfg.provider, model: cfg.model, endpoint: cfg.endpoint, state: now() < parkedUntil && enabled ? 'offline' : health.state, ok, message: now() < parkedUntil ? 'Not responding, so Vanessa is using Standard mode for now.' : health.message, models: health.models || [], mode: ok ? 'enhanced' : 'standard', rephrase: !!cfg.rephrase };
    },
    async ready() { const cfg = config(); if (!cfg.enabled || now() < parkedUntil) return false; return (await check()).ok; },
    noteFailure(reason) { parkedUntil = now() + PARK_MS; health = { ...health, ok: false, state: 'offline', message: `Not responding (${reason || 'error'}).` }; },

    /** @returns {Promise<{ok:true, queries:object[], clarify?:string, usage:object, latency:number} | {ok:false, reason:string}>} */
    async interpret({ text, ctx, ent, dialog, allowed }) {
      const cfg = config(), p = provider();
      if (!p.ok) return { ok: false, reason: 'misconfigured' };
      const t0 = now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
      const weekday = DAYS[new Date(ctx.today + 'T12:00:00Z').getUTCDay()];
      const last = dialog?.query ? `${dialog.query.intent}${dialog.query.filters?.dateRange ? ` (${dialog.query.filters.dateRange.label})` : ''}` : null;
      let out;
      try { out = await p.provider.generate({ system: systemPrompt({ allowed, today: ctx.today, weekday, subject: dialog?.subject, last }), user: String(text).slice(0, 600), schema: schema(allowed), maxTokens: 350, signal: ctl.signal }); }
      catch (e) { return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : (e?.code || 'error') }; }
      finally { clearTimeout(timer); }
      const j = parseModelJson(out.text);
      if (!j || !['query', 'clarify', 'none'].includes(j.action)) return { ok: false, reason: 'bad_output' };
      const latency = now() - t0, usage = out.usage || {};
      if (j.action === 'clarify') return { ok: true, queries: [], clarify: cleanQuestion(j.question), usage, latency };
      const queries = [];
      for (const m of Array.isArray(j.queries) ? j.queries.slice(0, 3) : []) {
        if (!m || !handlerFor(m.intent)) continue;                       // unknown: dropped. Known but not allowed for this role: left for validation to refuse, out loud.
        const write = handlerFor(m.intent)?.mode === 'write';
        const q = buildQuery(m.intent, ent, { confidence: 0.8, source: 'local' });
        const f = q.filters;
        // The model may set simple enumerations; names and dates only ever come from the person's own words.
        if (['High', 'Normal', 'Low'].includes(m.priority) && (!write || /\b(high|low|normal|medium|top|urgent)\b/i.test(text))) f.priority = f.priority || m.priority;
        if (['unassigned', 'claimed', 'done', 'needs'].includes(m.status) && !write) f.status = f.status || m.status;
        if (Number.isInteger(m.limit) && m.limit >= 1 && m.limit <= 30 && !write) f.limit = f.limit || m.limit;
        if (['Attended', 'Late', 'Excused', 'Absent'].includes(m.attendance) && grounded(m.attendance, text)) f.attendance = f.attendance || m.attendance;
        for (const k of ['major', 'session', 'requirement', 'text']) if (typeof m[k] === 'string' && grounded(m[k], text)) f[k] = f[k] || m[k].trim();
        if (m.person && m.person2 && f.people?.length >= 2) {
          const i = f.people.findIndex(x => grounded(m.person, x.label || x.query || '') || grounded(x.label || x.query || '', m.person)), k = f.people.findIndex(x => grounded(m.person2, x.label || x.query || '') || grounded(x.label || x.query || '', m.person2));
          if (i > 0 && k === 0) f.people = [f.people[i], ...f.people.filter((_, n) => n !== i)];
        }
        q.reference = !!m.reference; q.mine = !!m.mine;
        queries.push(q);
      }
      return { ok: true, queries, usage, latency };
    },

    /** A friendlier wording of a finished reply, or null (always null unless switched on and healthy). */
    async rephrase(text) {
      const cfg = config();
      if (!cfg.rephrase || !(await api.ready())) return null;
      const p = provider(); if (!p.ok) return null;
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
      try { const out = await p.provider.generate({ system: rephrasePrompt, user: text, maxTokens: 180, signal: ctl.signal }); return guardRephrase(text, out.text); }
      catch { return null; } finally { clearTimeout(timer); }
    },

    /** The admin's "Test Vanessa Engine" button. */
    async test() {
      const cfg = config(), e = cfg.provider === 'browser' ? { ok: true } : checkEndpoint(cfg.endpoint);
      const off = 'Local conversational engine unavailable. Vanessa will continue using Standard Mode.';
      if (!cfg.enabled) return { ok: false, message: off, detail: 'Local AI is switched off.' };
      if (!e.ok) return { ok: false, message: off, detail: e.reason };
      const h = await check({ force: true });
      if (!h.ok) return { ok: false, message: off, detail: h.message };
      const p = provider(), t0 = now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
      try {
        const out = await p.provider.generate({ system: 'Reply with the JSON object {"ok":true} and nothing else.', user: 'ping', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, maxTokens: 20, signal: ctl.signal });
        const j = parseModelJson(out.text);
        if (!j) return { ok: false, message: off, detail: 'The model answered, but not in a form I can use. Try a different model.' };
        return { ok: true, message: 'Local conversational engine connected successfully.', latency: now() - t0, model: cfg.model };
      } catch (err) { return { ok: false, message: off, detail: err?.name === 'AbortError' ? 'The model took too long to answer. A smaller model may suit this computer better.' : (err?.message || 'Error') }; }
      finally { clearTimeout(timer); }
    }
  };
  return api;
}
