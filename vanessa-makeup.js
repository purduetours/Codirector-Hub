/* Structured completion reports. A question or a future plan is not a write. */
export function makeupRequest(raw, now = new Date()) {
  let text = String(raw || '').replace(/[’‘]/g, "'").trim();
  if (!/\bmake[ -]?ups?\b/i.test(text)) return null;
  text = text.replace(/^(?:(?:hey|hi|okay|ok|vanessa|please|thanks)[,!\s]+)+/i, '')
    .replace(/^(?:can|could|would) you (?:please )?/i, '')
    .replace(/^(?:i (?:just )?(?:wanted to |want to )?(?:let you know|tell you)|just (?:letting you know|so you know))[, :]+/i, '');
  if (/\?\s*$/.test(text) && !/\b(?:can|could|would) you\b/i.test(raw)) return null;
  if (/\b(?:not|never|hasn't|haven't|didn't|hasnt|havent|didnt|isn't|isnt|don't|dont|doesn't|doesnt|will|tomorrow|if|when|might|should|needs?|owes?)\b/i.test(text)) return null;
  if (/^(?:did|has|have|is|was|who|which|how|what)\b/i.test(text)) return null;
  if (!/\b(?:completed?|finished|done|did|mark|record|log|clear)\b/i.test(text)) return null;
  let note = null, completedOn = null, session = null, error = null;
  const noteMatch = /\s+(?:note\s*:\s*|after\s+|by\s+)(.+?)[.!?]*$/i.exec(text);
  if (noteMatch) { note = noteMatch[1].trim(); text = text.slice(0, noteMatch.index); }
  const date = /\b(today|tonight|yesterday|on\s+\d{4}-\d{2}-\d{2})\b/i.exec(text);
  if (date) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/yesterday/i.test(date[1])) d.setDate(d.getDate() - 1);
    const iso = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
    completedOn = /^on /i.test(date[1]) ? date[1].slice(3).trim() : iso(d);
    const parsed = new Date(`${completedOn}T12:00:00`);
    if (Number.isNaN(parsed.getTime()) || iso(parsed) !== completedOn || completedOn > iso(now)) error = 'Give me a valid completion date, today or earlier, using YYYY-MM-DD.';
    text = text.slice(0, date.index) + text.slice(date.index + date[0].length);
  }
  const sessionMatch = /\bfor (?:the )?(.+?)[.!?]*$/i.exec(text);
  if (sessionMatch && !/^(?:me|us|them|him|her)$/i.test(sessionMatch[1])) {
    session = sessionMatch[1].replace(/\s+(?:session|training)$/i, '').trim(); text = text.slice(0, sessionMatch.index);
  }
  text = text.replace(/^(?:mark|record|log|clear)\s+(?!(?:completed?|finished|did|has)\b)/i, '');
  // Keep separators so multiple people are reviewed as a batch.
  const name = text.replace(/'s\b/gi, '').replace(/\b(?:make[ -]?ups?|training|sessions?|as|completed?|finished|done|did|their|his|her|has|have|is|was|just|already|finally|successfully|please|all|of|the|for|me)\b/gi, ' ')
    .replace(/[^\p{L}\s,'&-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return { name, names: name.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean), session, completedOn, note, error };
}
export function ignoredAbsenceSession(label) {
  return /^(?:(?:monday|sunday|tuesday|wednesday|thursday|friday|saturday)[, ]+)?(?:sept?(?:ember)?\.?\s+0?7(?:st|nd|rd|th)?|0?9[/-]0?7)(?:[, /-]+(?:20)?26)?$/i.test(String(label || '').trim());
}
export const normalizedName = name => String(name || '').toLowerCase().normalize('NFKC').replace(/[’‘]/g, "'").trim().replace(/\s+/g, ' ');
export function matchingNames(query, names) {
  const q = normalizedName(query), exact = names.filter(n => normalizedName(n) === q);
  if (exact.length) return exact;
  const parts = q.split(' ').filter(Boolean);
  return parts.length ? names.filter(n => parts.every(p => normalizedName(n).split(' ').includes(p))) : [];
}
