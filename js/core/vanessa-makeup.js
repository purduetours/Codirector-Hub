/* Parse completion reports separately from questions, plans and negations. */
export function makeupRequest(raw) {
  let text = String(raw || '').toLowerCase().replace(/[’‘]/g, "'").trim();
  if (!/\bmake[ -]?ups?\b/.test(text)) return null;
  if (/\?\s*$/.test(text) && !/\b(?:can|could|would) you\b/.test(text)) return null;
  if (/\b(?:not|never|hasn't|haven't|didn't|hasnt|havent|didnt|isn't|isnt|don't|dont|doesn't|doesnt|will|tomorrow|if|when|might|should|needs?|owes?)\b/.test(text)) return null;
  if (/^(?:did|has|have|is|was|who|which|how|what)\b/.test(text)) return null;
  if (!/\b(?:completed?|finished|done|did|mark|record|log|clear)\b/.test(text)) return null;
  text = text.replace(/^(?:(?:hey|hi|okay|ok|vanessa|please|thanks)[,!\s]+)+/, '')
    .replace(/^(?:can|could|would) you (?:please )?/, '')
    .replace(/^(?:i (?:just )?(?:wanted to |want to )?(?:let you know|tell you)|just (?:letting you know|so you know))[, :]+/, '');
  const session = /\bfor (?:the )?(.+?)(?:\s+(?:session|training))?[.!?]*$/.exec(text);
  if (session) text = text.slice(0, session.index);
  const name = text.replace(/^(?:mark|record|log|clear)\s+(?!(?:completed?|finished|did|has)\b)/, '').replace(/'s\b/g, '').replace(/\b(?:make[ -]?ups?|training|sessions?|as|completed?|finished|done|did|their|his|her|has|have|is|was|just|already|finally|successfully|please|today|tonight|yesterday|all|of|the|for|me)\b/g, ' ').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return { name, session: session?.[1]?.replace(/\s+(?:session|training)$/, '').trim() || null };
}

// This obsolete form option is not a missing training session.
export function ignoredAbsenceSession(label) {
  return /^(?:(?:monday|sunday|tuesday|wednesday|thursday|friday|saturday)[, ]+)?(?:sept?(?:ember)?\.?\s+0?7(?:st|nd|rd|th)?|0?9[/-]0?7)(?:[, /-]+(?:20)?26)?$/i.test(String(label || '').trim());
}
