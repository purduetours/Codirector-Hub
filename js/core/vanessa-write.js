/* ============================================================ Vanessa writes
   Rough thoughts in, evaluation wording out — as a SUGGESTION.

     "He was really confident and knew a lot, but I think he talked too fast
      and sometimes gave way too much information. Overall really good though."

       What went well    Alex came across as really confident and clearly knew
                         a lot. Overall, he gave a really good tour.
       Areas to improve  One thing to work on is slowing down when speaking and
                         cutting back on extra detail at times.

   The rules this file keeps, because this is someone's evaluation:

   · It never invents. Every sentence comes from something the evaluator
     said. A point it has no phrasing for is kept in their own words
     ("Also noted: …"), never reworded into something else.
   · It keeps the weight. "really confident" stays really; "good" is not
     promoted to "excellent"; "sometimes" stays "at times"; "a bit quiet"
     stays a little. Softer and More direct change the TONE of the same
     points — neither adds a point or drops one.
   · It never writes to a form. It returns text. Only a click puts it
     anywhere, through the form's own fields.

   Deterministic on purpose: instant on every laptop, no model download, and
   it cannot hallucinate a strength nobody observed.

   Styles: normal (default) · short · direct · soft
============================================================================ */

/* ------------------------------------------------------------ strengths
   say   the clause after the name ("Alex came across as confident")
   adj   the same point as an adjective, for the short and direct styles
   strong/strongAdj   used only when the evaluator intensified it themselves */
const STRENGTHS = [
  { id: 'confident', re: /\bconfiden(?:t|ce|tly)\b|\bself-assured\b/,
    say: 'came across as confident', strong: 'came across as really confident', adj: 'confident', strongAdj: 'really confident' },
  { id: 'knowledge', re: /\bknew (?:everything|it all|all the facts|every fact)\b/,
    say: 'knew the material thoroughly', adj: 'really knowledgeable' },
  { id: 'knowledge', re: /\b(?:knew|knows|know) (?:a lot|so much|a ton|lots|their stuff|his stuff|her stuff|the (?:facts|campus|material|content|history|buildings|route))\b|\bknowledgeable\b|\bwell[- ]informed\b|\bprepared\b/,
    say: 'clearly knew a lot', strong: 'clearly knew a great deal', adj: 'knowledgeable', strongAdj: 'very knowledgeable' },
  { id: 'group', re: /\b(?:good|great|amazing|awesome|excellent|really good|so good) with (?:the )?(?:group|families|guests|kids|people|everyone|parents|visitors|students)\b|\bconnected (?:well )?with\b/,
    say: 'was great with the group', adj: 'great with the group' },
  { id: 'friendly', re: /\b(?:friendly|personable|warm|welcoming|kind|approachable|nice to (?:the )?(?:group|families|guests|everyone))\b/,
    say: 'was friendly and welcoming with the group', adj: 'friendly' },
  { id: 'funny', re: /\b(?:funny|hilarious|humou?r(?:ous)?|made (?:us|them|everyone|people) laugh)\b/,
    say: 'brought good humour to the tour', adj: 'funny' },
  { id: 'engaging', re: /\b(?:engaging|engaged (?:the group|everyone)|entertaining|interactive|kept (?:everyone|the group|people|us) (?:engaged|interested|involved))\b|\bfun\b/,
    say: 'kept the group engaged', strong: 'kept the group really engaged', adj: 'engaging', strongAdj: 'really engaging' },
  { id: 'energy', re: /\b(?:energetic|enthusiastic|energy|lively|passionate|excited|spirited)\b/,
    say: 'brought good energy to the tour', strong: 'brought a lot of energy to the tour', adj: 'energetic', strongAdj: 'really energetic' },
  { id: 'voice', re: /\b(?:loud|projected|clear voice|easy to hear|spoke clearly|articulate|well[- ]spoken)\b/,
    say: 'spoke clearly and was easy to hear', adj: 'clear and easy to hear' },
  { id: 'pace', re: /\b(?:good|great|nice) (?:pace|pacing|timing)\b/, say: 'kept a good pace', adj: 'well paced' },
  { id: 'organised', re: /\b(?:organi[sz]ed|on time|on schedule|kept (?:good )?time|punctual)\b/,
    say: 'kept the tour organised and on time', adj: 'organised and on time' },
  { id: 'questions', re: /\b(?:answered (?:questions|everything|every question)|handled questions|(?:good|great) (?:with|at) questions|good answers)\b/,
    say: 'handled questions well', strong: 'handled questions really well', adj: 'good with questions' },
  { id: 'stories', re: /\b(?:stories|story|personal (?:experience|examples?|touch)|anecdotes?)\b/,
    say: 'shared personal stories', adj: 'good at sharing personal stories' },
  { id: 'professional', re: /\b(?:professional|polished|poised)\b/, say: 'came across as professional', adj: 'professional' },
  { id: 'eye', re: /\b(?:good|great|made|nice) eye contact\b/, say: 'made good eye contact', adj: 'good at making eye contact' },
  { id: 'inclusive', re: /\b(?:inclusive|included everyone|engaged (?:parents|families|students|everyone))\b/,
    say: 'made sure everyone felt included', adj: 'inclusive' },
  { id: 'upbeat', re: /\b(?:smil(?:e|ed|ing)|upbeat|positive attitude|cheerful)\b/, say: 'had an upbeat, positive manner', adj: 'upbeat' }
];

/* The overall verdict, echoing the evaluator's own word. Only used when a
   fragment has no more specific point — "good with questions" is a point
   about questions, not a verdict on the tour. */
const OVERALL = /\b(?:(really|very|super|so|extremely|incredibly|genuinely) )?(good|great|solid|strong|excellent|amazing|awesome|fantastic|outstanding|incredible|phenomenal|decent|fine|okay|ok|alright|not bad)\b/;
const OVERALL_WORD = { amazing: 'excellent', awesome: 'great', fantastic: 'excellent', incredible: 'excellent', phenomenal: 'excellent',
  okay: 'decent', ok: 'decent', alright: 'decent', fine: 'decent', 'not bad': 'decent' };

/* ------------------------------------------------------------ improvements
   ger   gerund, after "One thing to work on is …"
   imp   imperative, for direct ("Slow down …") and soft ("It might help to …")
   short a compact imperative
   {a} becomes "a little " when the evaluator hedged (a bit, kind of) or the
   style is soft; {t} becomes " at times" when they said sometimes. */
const IMPROVE = [
  { id: 'pace', re: /\b(?:talked|talks|talking|spoke|speaks|speaking|went|going|rushed|rushing|talk)\b[^,.;]{0,18}\b(?:fast|quick(?:ly)?)\b|\btoo fast\b|\brush(?:ed|ing)\b|\bslow(?:er)? down\b|\bspeak slower\b/,
    ger: 'slowing down {a}when speaking{t}', imp: 'slow down {a}when speaking{t}', short: 'slow down{t}' },
  { id: 'detail', re: /\b(?:too much|way too much|so much|a lot of|lots of|excess(?:ive)?|extra|unnecessary|random) (?:info(?:rmation)?|details?|facts|content|talking|stats)\b|\bover-?explain\w*|\brambl\w*|\bwent on (?:too long|and on)|\btmi\b|\binfo ?dump\w*|\btoo (?:detailed|wordy|long-winded)\b/,
    ger: 'cutting back on extra detail{t}', imp: 'cut back on extra detail{t}', short: 'trim extra detail{t}' },
  { id: 'voice', re: /\b(?:quiet|hard to hear|soft[- ]?spoken|could not hear|couldn'?t hear|mumbl\w*|not loud enough|too soft)\b/,
    ger: 'projecting {a}more so the whole group can hear', imp: 'project {a}more so the whole group can hear', short: 'project {a}more' },
  { id: 'walk', re: /\bwalk(?:ed|s|ing)? (?:too |really |a bit |kind of )?(?:fast|quickly)\b/,
    ger: 'checking the group is keeping up while walking', imp: 'check the group is keeping up while walking', short: 'watch the walking pace' },
  { id: 'nerves', re: /\b(?:nervous|anxious|shaky|unsure of (?:themselves|himself|herself)|not (?:very |that )?confident|lacked confidence|timid)\b/,
    ger: 'building {a}more confidence{t}', imp: 'keep building confidence', short: 'build confidence' },
  { id: 'filler', re: /\b(?:um+s?|uh+s?|filler(?: words)?|said "?like"? a lot|a lot of "?likes"?)\b/,
    ger: 'cutting down on filler words', imp: 'cut down on filler words', short: 'cut the filler words' },
  { id: 'time', re: /\b(?:late|arrived late|behind schedule|ran (?:long|over)|over ?time|went over|took too long|too long)\b/,
    ger: 'keeping the tour on schedule{t}', imp: 'keep the tour on schedule{t}', short: 'stay on schedule' },
  { id: 'eye', re: /\b(?:no|little|more|not much|poor|lacked|limited) eye contact\b|\blooked at (?:the ground|their phone|his phone|her phone|notes)\b/,
    ger: 'making more eye contact with the group', imp: 'make more eye contact with the group', short: 'make more eye contact' },
  { id: 'facts', re: /\b(?:did not know|didn'?t know|unsure about|got (?:facts|things|some facts|a few facts) wrong|wrong facts?|inaccurate|mixed up|incorrect)\b/,
    ger: 'double-checking a few facts', imp: 'double-check a few facts', short: 'check the facts' },
  { id: 'phone', re: /\bphone\b/, ger: 'keeping the phone away during the tour', imp: 'keep the phone away during the tour', short: 'keep the phone away' },
  { id: 'energy', re: /\b(?:monotone|flat|low energy|boring|dry|lacked energy|unengaging|not (?:very |that |super )?engaging)\b/,
    ger: 'bringing {a}more energy to the delivery', imp: 'bring {a}more energy to the delivery', short: 'bring more energy' },
  { id: 'questions', re: /\b(?:ignored|did not engage|didn'?t engage|forgot about|did not ask for|never asked for) (?:questions|guests|parents|the group)\b|\bno questions\b/,
    ger: 'inviting questions more often', imp: 'invite questions more often', short: 'invite questions' },
  { id: 'route', re: /\b(?:got lost|wrong way|missed a stop|skipped a stop|forgot (?:a|the) stop)\b/,
    ger: 'sticking to the planned route', imp: 'stick to the planned route', short: 'stick to the route' }
];

const TURN = /\b(?:but|however|though|although|except|yet)\b|\b(?:could|should|needs? to|need to|work on|improve on|wish)\b/i;
const MILD = /\b(?:a bit|a little|kind of|kinda|sort of|slightly|somewhat|a tad)\b/;
const OFTEN = /\b(?:sometimes|at times|occasionally|now and then|every so often|here and there|a few times)\b/;
const NEGATIVE = /\b(?:forgot|forget|did not|never|missed|wrong|late|lost|skipped|could not|should(?:n't| not)?|needs? to|confus\w*|awkward|unclear|too|not|no|messed|mistake|problem|issue|struggled|hard to)\b/;
const INTENSE = /\b(?:really|very|super|so|extremely|incredibly|genuinely)\b/;

const SWAPS = [[/[’‘]/g, "'"], [/[“”]/g, '"'], [/\bwasn'?t\b/gi, 'was not'], [/\bweren'?t\b/gi, 'were not'],
  [/\bisn'?t\b/gi, 'is not'], [/\bdidn'?t\b/gi, 'did not'], [/\bcouldn'?t\b/gi, 'could not'], [/\bdoesn'?t\b/gi, 'does not']];

const clean = s => String(s || '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s,.;:!-]+|[\s,.;:!-]+$/g, '')
  .replace(/^(?:and|also|so|then|plus|overall|honestly|tbh|i think|i feel like|i felt like|i thought|just|like|but|though)\s+/i, '')
  .replace(/\s+(?:though|tho|honestly|tbh|overall)$/i, '')
  .trim();

/* A point with no phrasing, kept in the evaluator's own words as a clause:
   "they forgot the library stop" → "forgot the library stop". */
function ownWords(frag) {
  const f = clean(frag).replace(/^(?:he|she|they|[A-Z][a-z]+)\s+(?:were|was|is|are)\s+/i, 'was ')
                       .replace(/^(?:he|she|they)\s+/i, '');
  return f ? f.charAt(0).toLowerCase() + f.slice(1) : '';
}

/* ------------------------------------------------------------ reading notes */
function read(text) {
  const turn = text.search(TURN);
  const sides = [['wentWell', turn >= 0 ? text.slice(0, turn) : text], ['improve', turn >= 0 ? text.slice(turn).replace(TURN, '') : '']];
  const pos = [], neg = [], noted = [];
  let overall = null;
  const seenP = new Set(), seenN = new Set();
  for (const [side, part] of sides) {
    for (const raw of part.split(/[,;.!?]|\band\b|\bplus\b/i)) {
      const frag = clean(raw);
      if (!frag) continue;
      const low = ` ${frag.toLowerCase()} `;
      const mods = { mild: MILD.test(low), often: OFTEN.test(low), intense: INTENSE.test(low) };
      let hit = false;
      for (const e of IMPROVE) {
        if (e.re.test(low)) { hit = true; if (!seenN.has(e.id)) { seenN.add(e.id); neg.push({ e, ...mods }); } }
      }
      if (!hit) for (const e of STRENGTHS) {
        const at = low.search(e.re);
        if (at < 0) continue;
        hit = true;
        /* "not very friendly" is a point to work on, in the same words. */
        if (/\b(?:not|never|lacked|wasn'?t)\b[^,]{0,14}$/.test(low.slice(Math.max(0, at - 24), at))) {
          const id = 'not-' + e.id;
          if (!seenN.has(id)) { seenN.add(id); neg.push({ e: { id, ger: `working on being more ${e.adj}`, imp: `work on being more ${e.adj}`, short: `be more ${e.adj}` }, ...mods }); }
        } else if (!seenP.has(e.id)) { seenP.add(e.id); pos.push({ e, ...mods }); }
      }
      if (!hit) {
        const m = OVERALL.exec(low);
        if (m && !/\bnot (?:very |really |that |so )?(?:good|great)\b/.test(low)) {
          hit = true;
          const word = OVERALL_WORD[m[2]] || m[2];
          const strong = m[1] && !['decent'].includes(word) ? 'really ' : '';
          const art = /^[aeiou]/.test(strong || word) ? 'an' : 'a';
          overall = overall || { say: `gave ${art} ${strong}${word} tour`, adj: `${strong}${word}` };
        }
      }
      // A leftover that reads as a criticism belongs with the improvements, whichever side of "but" it fell.
      if (!hit && frag.split(/\s+/).length > 1) noted.push({ side: NEGATIVE.test(low) ? 'improve' : side, text: ownWords(frag) });
    }
  }
  return { pos, neg, noted, overall };
}

/* ------------------------------------------------------------ composing */
const join = parts => parts.length <= 1 ? (parts[0] || '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const sentence = s => { s = String(s || '').trim(); if (!s) return ''; s = s.charAt(0).toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };
const fill = (tpl, n, style) => tpl.replace('{a}', n.mild || style === 'soft' ? 'a little ' : '').replace('{t}', n.often ? ' at times' : '');

/** An explicit rating the evaluator gave — "4/5", "I'd give him a 4" — or null. Never inferred. */
export function explicitRating(rough) {
  const t = String(rough || '').toLowerCase();
  const m = /\b([1-5])\s*(?:\/|out of)\s*5\b/.exec(t)
         || /\b(?:rating|rate (?:it|him|her|them|this)?|rated|give (?:it|him|her|them|this)?\s*(?:a|an)?|score (?:of)?)\s*(?:of |a |an |is |at )?([1-5])(?!\d)\b/.exec(t)
         || /\b([1-5]) stars?\b/.exec(t);
  return m ? Number(m[1]) : null;
}
const withoutRating = t => t.replace(/\b[1-5]\s*(?:\/|out of)\s*5\b|\b(?:i(?:'d| would)? )?(?:rating|rate (?:it|him|her|them|this)?|rated|give (?:it|him|her|them|this)?\s*(?:a|an)?|score (?:of)?)\s*(?:of |a |an |is |at )?[1-5](?!\d)\b|\b[1-5] stars?\b/gi, ' ');

function pronounOf(t) {
  const he = /\b(he|him|his)\b/i.test(t), she = /\b(she|her|hers)\b/i.test(t);
  return he && !she ? 'he' : she && !he ? 'she' : 'they';
}

/**
 * @param {string} rough   what the evaluator said, in any shape
 * @param {object} opts    { name, variant, field, style }
 * @returns {{ wentWell, improve, rating, empty, points }}
 */
export function polishFeedback(rough, { name = '', variant = 0, field = null, style = 'normal' } = {}) {
  let text = String(rough || '');
  for (const [re, to] of SWAPS) text = text.replace(re, to);
  text = text.trim();
  if (!text) return { wentWell: '', improve: '', rating: null, empty: true, points: 0 };
  const rating = explicitRating(text);
  const r = read(withoutRating(text));
  const pron = pronounOf(text);
  const who = String(name || '').trim().split(/\s+/)[0] || (pron === 'they' ? 'They' : pron[0].toUpperCase() + pron.slice(1));
  const own = side => r.noted.filter(n => n.side === side && n.text).map(n => `Also noted: ${n.text}.`).join(' ');

  let well = '', imp = '';
  const P = r.pos, N = r.neg, O = r.overall;

  if (style === 'short') {
    const adjs = P.map(p => (p.intense && p.e.strongAdj) || p.e.adj);
    well = adjs.length ? sentence(join(adjs) + (O ? ` — ${/^[aeiou]/.test(O.adj) ? 'an' : 'a'} ${O.adj} tour overall` : ''))
         : O ? sentence(`${/^[aeiou]/.test(O.adj) ? 'An' : 'A'} ${O.adj} tour overall`) : '';
    imp = N.length ? sentence(join(N.map(n => fill(n.e.short, n, style)))) : '';
  } else if (style === 'direct') {
    const adjs = P.map(p => (p.intense && p.e.strongAdj) || p.e.adj);
    well = adjs.length ? sentence(`${who} was ${join(adjs)}${O ? `, and ${O.say} overall` : ''}`)
         : O ? sentence(`${who} ${O.say} overall`) : '';
    imp = N.length ? sentence(join(N.map(n => fill(n.e.imp, n, style)))) : '';
  } else {
    const says = P.map(p => (p.intense && p.e.strong) || p.e.say);
    const lead = [
      s => `${who} ${s}`, s => `${who} ${s}`, s => `From the start, ${who} ${s}`
    ][variant % 3];
    well = [says.length ? sentence(lead(join(says))) : '',
            O ? sentence(says.length ? `Overall, ${pron} ${O.say}` : `${who} ${O.say} overall`) : ''].filter(Boolean).join(' ');
    if (N.length) {
      if (style === 'soft') {
        const open = ['It might help to', 'Going forward, it could help to', 'One small suggestion would be to'][variant % 3];
        imp = sentence(`${open} ${join(N.map(n => fill(n.e.imp, n, style)))}`);
      } else {
        const open = ['One thing to work on is', 'Going forward, I would suggest', 'The main thing to focus on next time is'][variant % 3];
        imp = sentence(`${open} ${join(N.map(n => fill(n.e.ger, n, style)))}`);
      }
    }
  }
  well = [well, own('wentWell')].filter(Boolean).join(' ');
  imp = [imp, own('improve')].filter(Boolean).join(' ');
  if (field === 'wentWell') imp = '';
  if (field === 'improve') well = '';
  return { wentWell: well, improve: imp, rating, empty: !well && !imp, points: P.length + N.length + (O ? 1 : 0) + r.noted.length };
}

/** Does this read like notes about how someone did? Used to keep a workflow's
    next message from being mistaken for a new request. */
export function soundsLikeFeedback(rough) {
  const t = ` ${String(rough || '').toLowerCase()} `;
  return IMPROVE.some(e => e.re.test(t)) || STRENGTHS.some(e => e.re.test(t)) || OVERALL.test(t);
}
