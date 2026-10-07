/** Interview math: mean each criterion, then mean the available criterion means. */
export const keys = ['spk', 'per', 'imp'];
export const validScore = n => Number.isInteger(n) && n >= 1 && n <= 5;
export function completion(scores = {}, note = '') {
  const missing = keys.filter(k => !validScore(scores[k]));
  return { missing, status: !missing.length ? 'Complete' : missing.length < 3 || note.trim() ? 'In Progress' : 'Not Started' };
}
export function aggregate(scores = {}) {
  const rows = Object.values(scores);
  const result = {};
  for (const k of keys) {
    const values = rows.map(s => s[k]).filter(validScore);
    result[k] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }
  const parts = keys.map(k => result[k]).filter(n => n !== null);
  result.final = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  result.raters = rows.filter(s => keys.some(k => validScore(s[k]))).length;
  return result;
}
export function matches(candidate, query) {
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const haystack = normalize(`${candidate.name} ${candidate.major || ''} ${candidate.email || ''}`);
  return normalize(query).trim().split(/\s+/).every(word => haystack.includes(word));
}
export function panelProgress(candidate, panel) {
  const complete = panel.filter(id => completion(candidate.scores?.[id], candidate.comments?.[id]).status === 'Complete');
  return { complete: complete.length, expected: panel.length, missing: panel.filter(id => !complete.includes(id)) };
}
