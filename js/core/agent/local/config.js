/* ============================================================ where the local model lives
   Settings for the OPTIONAL local language model, kept in this browser only (a model
   running on someone's own computer is a per-computer thing, so it is configured per
   computer, by an administrator, in Admin > Vanessa). Nothing here is a secret and nothing is
   ever sent to the Hub's database.

   The one hard rule: the endpoint must be on this computer or this network. Any public address
   (a hosted AI service of any kind) is refused, so the Hub's data cannot be pointed at an
   outside AI service by a settings typo. There is no paid provider in Vanessa, and no key to enter.
*/
export const PROVIDERS = {
  ollama: { label: 'Ollama', endpoint: 'http://localhost:11434', hint: 'The simplest option. Install Ollama, then run: ollama pull llama3.2:3b' },
  openai: { label: 'Local server with an OpenAI-style API (LM Studio, llama.cpp, vLLM)', endpoint: 'http://localhost:1234/v1', hint: 'LM Studio: start its local server. llama.cpp: run llama-server.' },
  browser: { label: 'Model inside this browser (WebGPU)', endpoint: '', hint: 'Uses the optional in-browser model under Vanessa → Smarter answers. Slower, needs a recent Chrome or Edge.' }
};
export const DEFAULTS = { enabled: false, provider: 'ollama', endpoint: PROVIDERS.ollama.endpoint, model: '', rephrase: false, timeoutMs: 12000 };
const KEY = 'hub2.vanessa.local';

export function readConfig() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...DEFAULTS, ...pick(c) }; } catch { return { ...DEFAULTS }; }
}
export function writeConfig(patch) {
  const next = { ...readConfig(), ...pick(patch) };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: stays in memory for this page */ memory = next; }
  return next;
}
let memory = null;
const pick = c => {
  const o = {};
  if ('enabled' in c) o.enabled = !!c.enabled;
  if (c.provider in PROVIDERS) o.provider = c.provider;
  if (typeof c.endpoint === 'string') o.endpoint = c.endpoint.trim().slice(0, 200);
  if (typeof c.model === 'string') o.model = c.model.trim().slice(0, 100);
  if ('rephrase' in c) o.rephrase = !!c.rephrase;
  if (Number.isFinite(c.timeoutMs)) o.timeoutMs = Math.min(60000, Math.max(2000, c.timeoutMs));
  return o;
};
export const effectiveConfig = () => ({ ...readConfig(), ...(memory || {}) });

/** Hosts that count as "on this computer or this network". */
const PRIVATE = [/^localhost$/, /\.localhost$/, /^127\./, /^\[?::1\]?$/, /^0\.0\.0\.0$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /\.local$/, /\.lan$/, /\.internal$/, /\.home\.arpa$/, /\.ts\.net$/, /^[^.]+$/];

/** @returns {{ok:true, url:string} | {ok:false, reason:string}} */
export function checkEndpoint(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, reason: 'That doesn’t look like a web address, for example http://localhost:11434.' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'The address must start with http:// or https://.' };
  if (u.username || u.password) return { ok: false, reason: 'Don’t put a username or key in the address.' };
  const host = u.hostname.toLowerCase();
  if (!PRIVATE.some(re => re.test(host))) return { ok: false, reason: 'Vanessa only talks to a model on this computer or this network, never an outside service. Use localhost or a private address.' };
  return { ok: true, url: u.origin + u.pathname.replace(/\/+$/, '') };
}
