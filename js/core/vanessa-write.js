/* ============================================================ Vanessa writes
   Rough thoughts in, polished evaluation wording out — as a SUGGESTION.

     "They were really good, confident, knew everything, but they talked too fast."
       → What went well:   Alex gave a strong tour, presented with confidence
                           and showed thorough knowledge of campus.
       → Areas to improve: One thing to work on is slowing the pace so every
                           guest can take everything in.

   Rules this file keeps:
   · It never invents. Every sentence comes from something the evaluator
     said; a fragment it has no phrasing for is kept in their own words.
   · It never writes to a form. It returns text; the caller shows it with
     Use this / Edit / Try again, and only a click puts it anywhere.
   · Positives and improvements are split on the words people actually use
     to turn a corner — but, however, though, could, should, needs to.

   Deterministic on purpose: it works on every laptop, instantly, with no
   model download, and it cannot hallucinate a strength nobody observed.
============================================================================ */

const POSITIVE = [
  [/\b(really |very |super )?(good|great|amazing|awesome|excellent|fantastic|solid|strong)\b/, ['gave a strong tour', 'led an excellent tour', 'delivered a really solid tour']],
  [/\bconfiden(t|ce|tly)\b/, ['presented with confidence', 'carried the group with real confidence', 'spoke confidently throughout']],
  [/\b(knew (everything|a lot|their stuff|so much)|knowledgeable|well[- ]informed|knew the (facts|campus|buildings))\b/, ['showed thorough knowledge of campus', 'knew the campus inside out', 'had every fact ready']],
  [/\b(friendly|personable|warm|welcoming|kind|approachable)\b/, ['was warm and personable with the group', 'made guests feel welcome', 'was friendly and easy to talk to']],
  [/\b(engaging|funny|fun|entertaining|energetic|enthusiastic|energy|lively)\b/, ['kept the group engaged', 'brought real energy to the tour', 'kept things lively and engaging']],
  [/\b(loud|projected|clear voice|easy to hear|spoke clearly)\b/, ['projected clearly', 'spoke clearly enough for everyone to hear']],
  [/\b(organi[sz]ed|on time|on schedule|kept time|punctual)\b/, ['kept the tour well organised and on time', 'kept everything running on schedule']],
  [/\b(answered (questions|everything)|handled questions|good with questions)\b/, ['handled questions well', 'answered questions with ease']],
  [/\b(stories|story|personal|anecdotes?)\b/, ['shared personal stories that brought campus to life', 'wove in personal stories guests clearly enjoyed']],
  [/\b(professional|polished)\b/, ['came across as professional and polished']],
  [/\b(eye contact)\b/, ['made good eye contact with the group']],
  [/\b(inclusive|included everyone|engaged (parents|families|students))\b/, ['made sure the whole group felt included']]
];

const IMPROVE = [
  [/\b(talked|talks|spoke|speaks|went|going) (too |a bit |kind of |really )?(fast|quickly|quick)\b|\brushed\b|\btoo fast\b/, ['slowing the pace so every guest can take everything in', 'easing the pace a little so the group can follow along']],
  [/\b(quiet|hard to hear|soft[- ]spoken|couldn'?t hear|mumbl\w*)\b/, ['projecting their voice so the whole group can hear', 'speaking up so guests at the back can hear']],
  [/\bwalk(ed|s|ing)? (too |really )?(fast|quickly)\b|\bwalk (slower|more slowly)\b/, ['checking the group is keeping up while walking between stops']],
  [/\b(slow(er)? down|(?<!walk )slower|speed)\b/, ['slowing the pace so every guest can take everything in', 'easing the pace a little so the group can follow along']],
  [/\b(nervous|anxious|shaky|unsure of (themselves|himself|herself))\b/, ['building confidence with a little more practice']],
  [/\b(um+s?|uh+s?|filler( words)?|said "?like"? a lot)\b/, ['cutting down on filler words']],
  [/\b(late|arrived late|behind schedule|ran (long|over)|over time|too long)\b/, ['keeping stops concise so the tour stays on schedule']],
  [/\b(no eye contact|eye contact|looked at (the ground|their phone))\b/, ['making more eye contact with the group']],
  [/\b(didn'?t know|unsure|got (facts|things) wrong|wrong facts?|inaccurate)\b/, ['brushing up on a few key facts']],
  [/\bphone\b/, ['keeping their phone away during the tour']],
  [/\b(monotone|flat|low energy|boring|dry)\b/, ['bringing a bit more energy and variety to their delivery']],
  [/\b(ignored|didn'?t engage|forgot about) (questions|guests|parents|the group)\b/, ['checking in with the group and inviting questions more often']]
];

const TURN = /\b(?:but|however|though|although|except|yet)\b|\b(?:could|should|needs? to|need to|work on|improve on|wish)\b/i;

const clean = s => String(s || '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
  .replace(/^(and|also|so|then)\s+/i, '');

/* A fragment we have no phrasing for, kept in the evaluator's words but
   turned to read as a clause: "they were always smiling" → "were always smiling". */
function asClause(frag) {
  let f = clean(frag).replace(/^(they|he|she|[A-Z][a-z]+)\s+(were|was|is|are)\s+/i, 'was ')
                     .replace(/^(they|he|she)\s+/i, '');
  return f ? f.charAt(0).toLowerCase() + f.slice(1) : '';
}

function pick(options, variant) { return options[variant % options.length]; }

/* Each fragment is judged on its own: "quiet but friendly" is a criticism
   then a strength, whatever order it arrives in. A fragment neither bank
   recognises is kept verbatim and marked as the evaluator's own note, on
   the side of the turn it came from — never reworded into something else. */
function classify(fragments, variant, side) {
  const pos = [], neg = [], noted = [];
  const usedP = new Set(), usedN = new Set();
  for (const frag of fragments) {
    const low = ' ' + frag.toLowerCase() + ' ';
    let hit = false;
    IMPROVE.forEach(([re, options], i) => { if (!usedN.has(i) && re.test(low)) { usedN.add(i); hit = true; neg.push(pick(options, variant)); } });
    if (!hit) POSITIVE.forEach(([re, options], i) => { if (!usedP.has(i) && re.test(low)) { usedP.add(i); hit = true; pos.push(pick(options, variant)); } });
    if (!hit && frag.split(/\s+/).length > 1) noted.push({ side, text: clean(frag) });
  }
  return { pos, neg, noted };
}

const list = parts => parts.length <= 1 ? (parts[0] || '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const sentence = s => { s = s.trim(); if (!s) return ''; s = s.charAt(0).toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };

/**
 * @param {string} rough   what the evaluator said, in any shape
 * @param {object} opts    { name, variant, field } — field narrows the result
 * @returns {{ wentWell: string, improve: string, empty: boolean }}
 */
export function polishFeedback(rough, { name = '', variant = 0, field = null } = {}) {
  const text = String(rough || '').replace(/[“”]/g, '"').trim();
  if (!text) return { wentWell: '', improve: '', empty: true };
  const who = String(name || '').trim().split(/\s+/)[0] || 'They';

  // The turn word only tells us which side an unrecognised note belongs to.
  const turn = text.search(TURN);
  const before = turn >= 0 ? text.slice(0, turn) : text;
  const after  = turn >= 0 ? text.slice(turn).replace(TURN, '') : '';
  const frags = part => part.split(/[,;.]|\band\b/i).map(clean).filter(Boolean);
  const a = classify(frags(before), variant, 'wentWell');
  const b = classify(frags(after), variant, 'improve');
  let pos = [...a.pos, ...b.pos], neg = [...a.neg, ...b.neg];
  const noted = [...a.noted, ...b.noted];
  if (field === 'wentWell') neg = [];
  if (field === 'improve') pos = [];
  const note = sideName => noted.filter(n => (field ? n.side === field || field === sideName : n.side === sideName) && (!field || field === sideName))
    .map(n => `Also noted: ${n.text.charAt(0).toLowerCase() + n.text.slice(1)}.`).join(' ');

  const openers = [
    p => `${who} ${list(p)}`,
    p => `${who} ${list(p)}`,
    p => `Overall, ${who} ${list(p)}`
  ];
  const turners = [
    n => `One thing to work on is ${list(n)}`,
    n => `Going forward, I'd suggest ${list(n)}`,
    n => `The main opportunity is ${list(n)}`
  ];
  const well = [pos.length ? sentence(openers[variant % openers.length](pos)) : '', note('wentWell')].filter(Boolean).join(' ');
  const imp  = [neg.length ? sentence(turners[variant % turners.length](neg)) : '', note('improve')].filter(Boolean).join(' ');
  return { wentWell: well, improve: imp, empty: !well && !imp };
}
