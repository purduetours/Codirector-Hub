/* ============================================================ LocalAIProvider
   The one interface the engine knows about. Anything that can answer "given this
   instruction and this message, produce JSON (or text)" can sit behind it, so the runtime
   can be swapped (Ollama today, something else tomorrow) without touching Vanessa:

       provider.health(signal)   -> { ok, state, models, message }
                state: 'available' | 'no_model' | 'model_missing' | 'offline' | 'unsupported'
       provider.generate({ system, user, schema?, maxTokens?, signal })
                                 -> { text, usage?: { input, output } }

   Providers do I/O and nothing else: they hold no Hub data and make no decisions. They are
   handed only the text they are given.
*/
import { checkEndpoint } from './config.js';

export class ProviderError extends Error { constructor(code, message) { super(message); this.code = code; } }

const get = async (fetchImpl, url, signal) => {
  let res;
  try { res = await fetchImpl(url, { method: 'GET', signal }); } catch (e) { if (e?.name === 'AbortError') throw e; throw new ProviderError('offline', 'Couldn’t reach the local model.'); }
  if (!res.ok) throw new ProviderError('offline', `The local model answered ${res.status}.`);
  return res.json();
};
const post = async (fetchImpl, url, body, signal) => {
  let res;
  try { res = await fetchImpl(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { if (e?.name === 'AbortError') throw e; throw new ProviderError('offline', 'Couldn’t reach the local model.'); }
  if (!res.ok) { const j = await res.json().catch(() => null); const m = j?.error?.message || (typeof j?.error === 'string' ? j.error : ''); throw new ProviderError(res.status === 404 ? 'model_missing' : 'error', typeof m === 'string' && m ? m.slice(0, 160) : `The local model answered ${res.status}.`); }
  return res.json();
};
const has = (models, wanted) => models.some(n => n === wanted || n === `${wanted}:latest` || n.split(':')[0] === wanted);

/* ------------------------------------------------------------------ Ollama */
export function ollama({ endpoint, model, fetchImpl }) {
  const base = endpoint.replace(/\/+$/, '');
  return {
    name: 'ollama',
    async health(signal) {
      const r = await get(fetchImpl, `${base}/api/tags`, signal);
      const models = (r.models || []).map(m => m.name || m.model).filter(Boolean);
      if (!models.length) return { ok: false, state: 'model_missing', models, message: 'Ollama is running but has no models yet. Run: ollama pull llama3.2:3b' };
      if (!model) return { ok: false, state: 'no_model', models, message: 'Choose a model.' };
      if (!has(models, model)) return { ok: false, state: 'model_missing', models, message: `“${model}” isn’t installed. Run: ollama pull ${model}` };
      return { ok: true, state: 'available', models, message: 'Connected.' };
    },
    async generate({ system, user, schema, maxTokens = 400, signal }) {
      const r = await post(fetchImpl, `${base}/api/chat`, { model, stream: false, ...(schema ? { format: schema } : {}), options: { temperature: 0, num_predict: maxTokens }, keep_alive: '15m', messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, signal);
      return { text: r.message?.content ?? '', usage: { input: r.prompt_eval_count || 0, output: r.eval_count || 0 } };
    }
  };
}

/* ----------------------------------------------- OpenAI-style local servers */
export function openaiCompatible({ endpoint, model, fetchImpl }) {
  const base = /\/v1$/.test(endpoint) ? endpoint : `${endpoint.replace(/\/+$/, '')}/v1`;
  return {
    name: 'openai',
    async health(signal) {
      const r = await get(fetchImpl, `${base}/models`, signal);
      const models = (r.data || []).map(m => m.id).filter(Boolean);
      if (!models.length) return { ok: false, state: 'model_missing', models, message: 'The server is running but no model is loaded.' };
      if (!model) return { ok: false, state: 'no_model', models, message: 'Choose a model.' };
      if (!models.includes(model)) return { ok: false, state: 'model_missing', models, message: `“${model}” isn’t loaded on the server.` };
      return { ok: true, state: 'available', models, message: 'Connected.' };
    },
    async generate({ system, user, schema, maxTokens = 400, signal }) {
      const r = await post(fetchImpl, `${base}/chat/completions`, { model, stream: false, temperature: 0, max_tokens: maxTokens, ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'vanessa_request', strict: true, schema } } } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, signal);
      return { text: r.choices?.[0]?.message?.content ?? '', usage: { input: r.usage?.prompt_tokens || 0, output: r.usage?.completion_tokens || 0 } };
    }
  };
}

/* ------------------------------------- the in-browser model (already in the Hub) */
export function browserModel({ loader = () => import('../../vanessa-llm.js') } = {}) {
  return {
    name: 'browser',
    async health() {
      let m; try { m = await loader(); } catch { return { ok: false, state: 'unsupported', models: [], message: 'The in-browser model isn’t available here.' }; }
      if (m.llmReady()) return { ok: true, state: 'available', models: ['in-browser'], message: 'Connected.' };
      if (!m.llmSupported()) return { ok: false, state: 'unsupported', models: [], message: 'This browser has no WebGPU, so it can’t run a model in the tab.' };
      return { ok: false, state: 'offline', models: [], message: 'Not loaded yet. Turn on “Smarter answers” in Vanessa’s panel to download it once.' };
    },
    async generate({ system, user, signal }) {
      const m = await loader();
      if (!m.llmReady()) throw new ProviderError('offline', 'The in-browser model isn’t loaded.');
      const text = await m.askLlm([{ role: 'system', content: system }, { role: 'user', content: user }], null, signal);
      return { text: m.splitThinking ? m.splitThinking(String(text)).answer : String(text), usage: { input: 0, output: 0 } };
    }
  };
}

/** Build the provider the config names, or explain why it can't be built. */
export function createProvider(cfg, { fetchImpl = (...a) => globalThis.fetch(...a), loader } = {}) {
  if (cfg.provider === 'browser') return { ok: true, provider: browserModel({ loader }) };
  const e = checkEndpoint(cfg.endpoint);
  if (!e.ok) return { ok: false, reason: e.reason, state: 'misconfigured' };
  const make = cfg.provider === 'openai' ? openaiCompatible : ollama;
  return { ok: true, provider: make({ endpoint: e.url, model: cfg.model, fetchImpl }) };
}
