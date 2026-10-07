/* ============================================================ how Vanessa is doing (no content)
   Counters for this browser session: how many requests Standard answered, how many used
   the local model, how often it was unavailable, which intents work, and how long they
   take. No sentence a person typed is ever recorded here. The same shape (minus anything
   identifying) is what gets logged to the database for Admin > Vanessa.
*/
const fresh = () => ({ since: Date.now(), turns: 0, byEngine: { standard: 0, enhanced: 0, legacy: 0 }, localCalls: 0, providerFailures: 0, clarifications: 0, notUnderstood: 0, toolCalls: 0, toolFailures: 0, intents: {}, latency: [] });
let m = fresh();

export function recordTurn(info) {
  m.turns++;
  m.byEngine[info.engine] = (m.byEngine[info.engine] || 0) + 1;
  m.localCalls += info.localCalls || 0;
  if (info.providerFailed) m.providerFailures++;
  if (info.clarified) m.clarifications++;
  if (info.notUnderstood) m.notUnderstood++;
  m.toolCalls += info.tools?.length || 0; m.toolFailures += info.failed?.length || 0;
  if (info.intent) { const k = (m.intents[info.intent] ||= { n: 0, ok: 0, ms: 0, conf: 0 }); k.n++; if (info.ok) k.ok++; k.ms += info.latency || 0; k.conf += info.confidence || 0; }
  if (Number.isFinite(info.latency)) { m.latency.push(info.latency); if (m.latency.length > 200) m.latency.shift(); }
}

export function snapshot() {
  const l = [...m.latency].sort((a, b) => a - b), p = f => (l.length ? l[Math.min(l.length - 1, Math.floor(l.length * f))] : null);
  return { ...m, intents: Object.entries(m.intents).map(([id, k]) => ({ id, n: k.n, ok: k.ok, avgMs: Math.round(k.ms / k.n), avgConfidence: Math.round(100 * k.conf / k.n) / 100 })).sort((a, b) => b.n - a.n), latencyP50: p(0.5), latencyP95: p(0.95) };
}
export const resetMetrics = () => { m = fresh(); };
