/* ============================================================ understanding
   What someone typed → what they are trying to do.

   "yo I need to do an eval", "can I evaluate someone?", "I need to fill out a
   tour evaluation" and "help me evaluate my tour" are one request. Rather
   than a regex per phrasing, a message is read as a handful of CONCEPTS —
   eval, task, open, where, attendance, tours, help, cancel … — plus the
   ENTITIES in it (a day, a time, an ordinal, a tool, the words that might be
   a name). Each intent is then a small rule over those concepts, scored, and
   the best one wins. Adding a phrasing is usually one word in a concept, not
   a new rule.

   This file only understands. It never reads app data and never acts: the
   same sentence always reads the same way, in well under a millisecond, with
   no model and no network — which is what lets "open attendance" resolve the
   instant it is sent.

     understand(text) → {
       intent, score, sub,          best guess, how sure (0–1), and a variant
       c,                           concept flags (c.eval, c.task, …)
       day, time, ordinal, tool,    entities
       names,                       leftover words that could be a name
       refine,                      shorter | direct | soft | again | restart
       question, words, text, raw
     }
============================================================================ */
import { TOOL_INFO } from './vanessa-context.js';
import { dateRange } from './vanessa-dates.js';

/* ------------------------------------------------------------ normalising
   Casual typing in, one spelling out. */
const SWAPS = [
  [/[’‘`]/g, "'"], [/[“”]/g, '"'],
  [/\bwhere'?s\b/g, 'where is'], [/\bwhat'?s\b/g, 'what is'], [/\bwho'?s\b/g, 'who is'],
  [/\bhow'?s\b/g, 'how is'], [/\bi'?m\b/g, 'i am'], [/\bi'?d\b/g, 'i would'], [/\bi'?ll\b/g, 'i will'],
  [/\bdon'?t\b/g, 'do not'], [/\bdoesn'?t\b/g, 'does not'], [/\bdidn'?t\b/g, 'did not'], [/\bcan'?t\b/g, 'cannot'],
  [/\bwanna\b/g, 'want to'], [/\bgonna\b/g, 'going to'], [/\bgotta\b/g, 'got to'], [/\blemme\b/g, 'let me'],
  [/\bpl[sz]\b/g, 'please'], [/\bu\b/g, 'you'], [/\bur\b/g, 'your'], [/\brn\b/g, 'right now'], [/\bidk\b/g, 'i do not know'],
  [/\b(tmrw|tmr|tomorow|tommorow|tommorrow)\b/g, 'tomorrow'], [/\btdy\b/g, 'today'],
  [/\bev[ae]?l?u?a?[ui]?tion\b/g, 'evaluation'], [/\bevaulation\b/g, 'evaluation'], [/\bevalaution\b/g, 'evaluation'],
  [/\batt[ae]nd[ae]n?[cs]e\b/g, 'attendance'], [/\btrainig\b/g, 'training'],
  [/\s+/g, ' ']
];
/* Openers that carry no meaning of their own. "actually never mind" keeps
   its never mind; "yo I need to do an eval" keeps everything after yo. */
const FILLER = /^(?:(?:yo|hey|hi|hello|hiya|ok|okay|so|um+|uh+|hmm+|well|alright|vanessa|please|quick question|real quick|bro|dude|actually|and|oh)\b[\s,!.:-]*)+/;

export function normalize(raw) {
  let t = String(raw || '').toLowerCase().trim();
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  const question = /\?\s*$/.test(t);
  t = t.replace(/[!?.]+$/g, '').trim();
  const peeled = t.replace(FILLER, '').trim();
  return { text: peeled || t, question };
}

/* ------------------------------------------------------------ concepts */
const C = {
  eval:      /\b(evals?|evaluat\w*|observ(?:e|ing|ation)s?)\b/,
  evaluating:/\bwho (?:is |was |will be )?(?:evaluating|evaluates|observing|doing (?:the |an? )?eval(?:uation)?s?)\b|\bwho has (?:the )?eval\w* (?:for|of)\b|\bwho (?:is|was) (?:the )?evaluator\b/,
  feedback:  /\b(feedback|comments?|write-?ups?|wording)\b/,
  write:     /\b(write|writing|word it|phrase|polish|reword|rewrite|clean (?:it |this |that |my \w+ )?up|improve (?:this|it|my|the) (?:wording|feedback|comments?|notes)|fix (?:this|my|the) (?:wording|feedback|comments?)|make (?:it|this|that) sound|help me say|turn (?:this|that|it) into)\b/,
  task:      /\b(need to|needs to|got to|have to|has to|want to|would like to|let me|can i|could i|may i|help me|time to|am (?:going|about|trying) to|going to|trying to|start|begin|fill (?:out|in)|complete|finish|give|record|log|do (?:an?|my|the|some|this)\b)|^i (?:need|want|have|got)\b|^(?:evaluate|observe)\b/,
  open:      /^(?:please )?(?:open|open up|go to|goto|take me(?: to)?|bring (?:me )?(?:up|to)|pull up|jump to|navigate to|switch to|launch|get me to|head to|show me the|load)\b/,
  where:     /\bwhere (?:is|are|do i find|can i find|would i find|do i go|is the)\b/,
  attend:    /\b(attendance|attend(?:ed|ing|s)?|absent|absences?|missed|miss(?:ing)? (?:training|the session)|show(?:ed)? up|no.?shows?|makeups?|make ups?)\b/,
  absform:   /\b(absence form|absences? tab|file an absence|filed absences?|report an absence|absence requests?)\b/,
  mark:      /\b(mark|take attendance|record attendance|check (?:\w+ )?(?:in|off))\b/,
  tours:     /\b(tours?|leading|leads|lead(?:ing)? (?:a |the )?tour|schedule)\b/,
  active:    /\b(active|online|logged in|on right now|around right now|here right now|signed in)\b|^who is (?:on|here|around)$/,
  find:      /\b(find|look up|lookup|look for|search(?: for)?|info(?:rmation)?|details|profile|tell me about|pull up)\b/,
  help:      /\b(what (?:does|do|is|are) (?:this|these|the|it)\b|what (?:does|do) (?!i\b|we\b|you\b)[a-z ]{2,30}? do\b|what is [a-z ]{2,30}? for\b|how do i use|how does (?:this|it) work|what am i (?:supposed|meant) to do|what do i do|what can i do (?:here|on this)|what is this|explain|what is it for|walk me through)\b|^help$|^help me$|^how does this work$/,
  here:      /\b(here|this page|this screen|this tool|this tab|this section|this)\b/,
  cancel:    /^(?:no,? )?(?:never ?mind|nvm|cancel(?: that| this| it)?|stop|forget (?:it|that|about it)|scratch that|not now|leave it|quit|exit|nah)\b(?! (?:the|my) eval)/,
  home:      /^(?:please )?(?:go |take me |back |head )?(?:to )?(?:the )?home(?: page| screen)?$|^(?:go|back|head) home\b|\bback to (?:the )?home\b/,
  back:      /^(?:go )?back$|^(?:go )?back (?:a (?:page|step)|to (?:the )?(?:last|previous) (?:page|one|screen))$|^previous(?: page)?$/,
  submit:    /\b(submit|send (?:it|that|this) (?:in|off)?|turn (?:it|that|this) in|finali[sz]e)\b/,
  accept:    /^(?:yes,? |yeah,? |yep,? )?(?:use (?:this|that|it|both|these)|looks? (?:good|great|fine)|perfect|that works|sounds good|love it|that is (?:good|great|perfect|fine)|good to go|great|keep it)\b/,
  yes:       /^(?:y|ye|yes|yep|yeah|yup|sure|ok|okay|do it|go ahead|go on|confirm|please do)$/,
  no:        /^(?:n|no|nope|nah|no thanks)$/,
  mine:      /\b(my|mine|me|i)\b/,
  next:      /\b(next|upcoming|soonest|coming up)\b/,
  ref:       /\b(it|that|this|that one|this one|the one|him|her|them|his|their|hers|theirs)\b/,
  dataQ:     /^(?:who|how many|how much|which|list|count|show (?:me )?(?:all|who|everyone|the list)|what are (?:my|the)|how far|is anyone|are there|what is (?:my|the) (?:progress|status))\b/,
  howto:     /^(?:how (?:do|can|should|would) (?:i|we|you)|how to|what happens (?:if|when)|why (?:can|cannot|do|does))\b/,
  noTour:    /\b(no tours?|without a tour|not scheduled|no scheduled|no date)\b/,
  today:     /\b(today|tonight|this morning|this afternoon)\b/,
  /* Sounds like notes about how someone did, not a request. */
  note:      /^(?!(?:when|where|who|what|how|why|which|is|are|do|does|can|could|will|would|should)\b)(?:(?:i think |honestly |overall,? )?(?:he|she|they|[a-z]+) (?:was|were|did|talked|spoke|knew|seemed|had|is|gave|could|should|went|kept|made|forgot|rushed|needs?|mumbled|rambled)\b|overall\b|honestly\b)/
};

/* "the second one", "#2", "number 3", "option 1", a bare "2". */
const ORD = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, sixth: 5, '6th': 5, last: -1 };
function ordinalFrom(t) {
  const w = new RegExp(`\\b(?:the )?(${Object.keys(ORD).join('|')})(?: one| option| tour| person| guide)?\\b`).exec(t);
  if (w && !/\bfirst priority|second priority|third priority|fourth priority|last (?:week|session|training|one i)\b/.test(t)) return ORD[w[1]];
  const n = /^(?:#|number |option |no\.? )?([1-9])$/.exec(t.trim()) || /\b(?:#|number |option )([1-9])\b/.exec(t);
  return n ? Number(n[1]) - 1 : null;
}

/* "2 PM", "2pm", "2:00", "14:30", "the 2", "the 1:30". A bare number is only
   a time with am/pm, a colon, or "the N" — so "2 evals" is never two o'clock. */
export function timeFrom(t) {
  const s = t.replace(/\b(\d+)\s+(evals?|guides?|tours?|people|stars?|out of)\b/g, '');
  let m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)(?=\W|$)/.exec(s) || /\b(\d{1,2}):(\d{2})\b/.exec(s);
  if (!m) { const the = /\bthe (\d{1,2})(?::(\d{2}))?(?= tour| slot| one|$|\s*\?)/.exec(s); if (the) m = [the[0], the[1], the[2], '']; }
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] || '00'; const ap = (m[3] || '').toLowerCase();
  if (h > 23 || Number(min) > 59) return null;
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if ((!ap || ap.startsWith('o')) && h < 8) h += 12;        // "the 2:00 tour" is the afternoon
  return `${String(h).padStart(2, '0')}:${min}`;
}

/* A day only when a day word is really there — dateRange treats "next" as a
   question about a date, and "what's my next tour" is not one. */
const DAY_WORD = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week|\d{4}-\d{2}-\d{2})\b/;
function dayFrom(t) {
  if (!DAY_WORD.test(t)) return null;
  const r = dateRange(t.replace(/\bnext (?!week\b|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\w+/g, ''));
  return r && !r.error ? { from: r.from, to: r.to } : null;
}

/* Tool names, longest first, so "eval tracker" beats "eval". */
const TOOL_NAMES = Object.entries(TOOL_INFO)
  .flatMap(([id, t]) => [...t.names, ...(t.also || [])].map(n => [n, id]))
  .sort((a, b) => b[0].length - a[0].length);
function toolFrom(t) {
  for (const [n, id] of TOOL_NAMES) if (new RegExp(`\\b${n}\\b`).test(t)) return { id, name: n };
  return null;
}
/* Nothing but a tool's name, maybe with "the", "page" or "please": "Evaluations". */
function bareTool(t, tool) {
  if (!tool) return false;
  const rest = t.replace(new RegExp(`\\b${tool.name}\\b`), ' ')
    .replace(/\b(the|page|tab|tool|screen|please|now|real quick|for me|section|thing)\b/g, ' ').trim();
  return !rest;
}

/* Words that could be a name: whatever is left once every concept word and
   common word is taken out. The facts layer decides if they ARE a name. */
const COMMON = new Set(('a an the is are was were be been am do does did can could would should will shall may might must ' +
  'i me my mine you your he him his she her they them their it its this that these those who what when where which why how ' +
  'to of in on at for with from by about into over after before up down out off and or but so if then than too very really ' +
  'just please thanks thank now right here there today tonight tomorrow yesterday week next last this morning afternoon evening ' +
  'need needs want wants have has had got get give gives show tell find look search open go take bring pull jump see check know ' +
  'eval evals evaluate evaluating evaluation evaluations evaluator observe tour tours leading lead leads schedule scheduled ' +
  'attendance absent absence absences missed makeup makeups training session sessions form mark info information details profile ' +
  'someone somebody anyone anybody everyone people person guide guides one ones pm am oclock time slot active online ' +
  'help write feedback comments comment notes wording polish page tool screen tab home back cancel submit start do doing ' +
  'upcoming soonest coming going lookup like some any all still yet has hasnt was wasnt am im whos whats wheres ' +
  'monday tuesday wednesday thursday friday saturday sunday first second third fourth fifth last hey yo hi ok okay ' +
  'happening running planned left remaining else other more many much anything something stuff thing things way lot bit ' +
  'kind sort probably maybe wait also again sure yes no not nope yeah tracker directory coverage desk desks announcements ' +
  'notices interviews interview grading accounts access data health hub vanessa whole everything list view see pick choose ' +
  'select mean meant supposed use using work works working explain does oh um uh gonna wanna gotta got ready fill out').split(' '));
function nameWords(t, tool) {
  if (tool) t = t.replace(new RegExp(`\\b${tool.name}\\b`, 'g'), ' ');
  return t.replace(/'s\b/g, '').replace(/[^a-z\s'-]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 2 && !COMMON.has(w) && !/^\d/.test(w));
}

/* How to rework a suggestion: "that sounded too harsh" is softer, "too soft"
   is more direct. Checked in that order so "too blunt" is never "blunter". */
export function refineFrom(t) {
  if (/\b(too (?:harsh|blunt|mean|critical|direct|strong|negative|rude|cold|much criticism))\b|\b(soft(?:er|en(?: it)?)|gentler|nicer|kinder|friendlier|tone (?:it|that|this) down|less harsh|more positive|warmer|nicer)\b/.test(t)) return 'soft';
  if (/\b(too (?:soft|nice|gentle|vague|fluffy|sugar\w*|positive))\b|\b(more direct|blunter|straight(?:er)? to the point|to the point|firmer|more honest|be direct|more straightforward|direct)\b/.test(t)) return 'direct';
  if (/\b(shorter|too long|shorten|trim (?:it|that|this)|more concise|concise|briefer|brief|cut (?:it|that|this) down|less wordy|too wordy|tighter)\b/.test(t)) return 'short';
  if (/\b(start over|from scratch|restart|redo (?:it|this|that) all|begin again|clear (?:it|that))\b/.test(t)) return 'restart';
  if (/\b(try again|another (?:way|version|one|take)|rephrase|reword (?:it|that|this)|different wording|say it differently|other wording)\b/.test(t)) return 'again';
  return null;
}

/* ------------------------------------------------------------ intents
   Each is a score from the concepts. Most rules are one line; the order only
   breaks ties. The OS layer decides what an intent does, and whether this
   account may. */
const RULES = [
  ['cancel',        u => u.c.cancel && u.words <= 7 ? 1 : 0],
  ['home',          u => u.c.home ? 1 : 0],
  ['back',          u => u.c.back ? 1 : 0],
  ['refine',        u => u.refine && u.words <= 9 ? 0.9 : 0],
  ['accept',        u => u.c.accept && u.words <= 6 ? 0.85 : 0],
  ['submit',        u => u.c.submit && u.words <= 7 && !u.c.howto && !u.c.dataQ ? 0.85 : 0],
  ['help_here',     u => u.c.help && !u.tool && (u.c.here || u.words <= 6) && !u.c.eval && !/\b(need to|should i)\b/.test(u.text) ? 0.9 : 0],
  ['explain_tool',  u => u.tool && !u.c.mine && (u.c.help || /^(?:what|who) (?:is|are) (?:the |an? )?[a-z ]{2,30}$/.test(u.text)) && !u.names.length ? 0.9 : 0],
  ['open_tool',     u => u.tool && (u.bare || ((u.c.open || u.c.where) && !u.c.dataQ && !u.names.length)) && !u.c.absform ? 0.95 : 0],
  ['reference',     u => ((u.ordinal !== null && (u.words <= 5 || u.c.open || /\b(pick|choose|go with|select|want|take)\b/.test(u.text)))
                          || /^(?:open|show|pull up|view|see|do|start) (?:it|that|that one|this one|him|her|them)$/.test(u.text)
                          || /^(?:that|this|the other) one$/.test(u.text)) ? 0.75 : 0],
  ['evaluating',    u => u.c.evaluating ? 0.92 : 0],
  ['evaluate',      u => {
    if (u.c.dataQ || u.c.howto || u.c.evaluating) return 0;
    if (u.c.eval && (u.c.task || u.c.write || /\b(someone|somebody|a tour|my tour|this tour|the tour)\b/.test(u.text))) return 0.9;
    if (u.c.eval && u.names.length && /\b(open|pull up|start)\b/.test(u.text)) return 0.88;
    if (u.c.feedback && u.c.task && !u.c.write) return 0.8;
    return 0; }],
  ['write_feedback',u => u.c.write && (u.c.feedback || u.c.here || u.c.ref || /\bthis\b/.test(u.text)) ? 0.86 : 0],
  ['attendance',    u => {
    if (u.c.absform) return 0.9;
    if (!u.c.attend || u.c.howto) return 0;
    // Makeups and filed absences have their own answers and actions already.
    if (/\b(rules?|policy|policies|how many strikes|allowed|makeups?|make ups?|owes?|filed|will miss|going to miss)\b/.test(u.text)) return 0;
    return 0.82; }],
  ['mark_attendance', u => u.c.mark && /\b(someone|somebody|attendance|absent|present|them|people|here)\b|^i need to mark\b/.test(u.text) && !/makeup/.test(u.text) ? 0.88 : 0],
  ['active',        u => u.c.active && (u.c.dataQ || u.words <= 4 || /\b(who|anyone|show|list)\b/.test(u.text)) ? 0.9 : 0],
  ['tours',         u => {
    if (u.c.eval || u.c.noTour || u.c.howto) return 0;
    if (u.c.mine && u.c.next && /\btours?\b/.test(u.text)) return 0.88;
    if (u.time && /\bwho (?:has|is (?:on|leading|doing|giving|running)|leads|got)\b/.test(u.text)) return 0.86;
    if (u.c.ref && /\b(his|her|their) (?:next )?tours?\b/.test(u.text)) return 0.8;
    if (/\btours\b|\bschedule\b|\bleading\b/.test(u.text) && (u.day || u.c.dataQ || /\b(what|find|show|list|any)\b/.test(u.text))) return 0.8;
    if (u.c.tours && u.day) return 0.8;
    return 0; }],
  ['people',        u => u.names.length && !u.c.note && (u.c.find || /^(?:who is|show me)\b/.test(u.text)) && !/^how many\b/.test(u.text) ? 0.8 : 0],
  ['feedback_note', u => u.c.note && u.words >= 4 && !u.question ? 0.6 : 0]
];

/** Read a message. Pure: the same text always reads the same way. */
export function understand(raw) {
  const { text, question } = normalize(raw);
  const c = {};
  for (const k in C) c[k] = C[k].test(text);
  const tool = toolFrom(text);
  const u = {
    raw: String(raw || ''), text, question, c,
    words: text ? text.split(/\s+/).length : 0,
    tool: tool?.id || null, toolName: tool?.name || null, bare: bareTool(text, tool),
    day: dayFrom(text), time: timeFrom(text), ordinal: ordinalFrom(text),
    names: nameWords(text, tool), refine: refineFrom(text),
    intent: null, score: 0, sub: null
  };
  for (const [id, rule] of RULES) {
    const s = rule(u);
    if (s > u.score) { u.intent = id; u.score = s; }
  }
  if (u.intent === 'attendance') {
    u.sub = c.absform ? 'form'
      : /\bwho (?:was|is|were|has been)? ?(?:absent|missing|not there|a no.?show)|\bwho (?:missed|did not (?:come|show))|\babsent (?:today|yesterday|on)\b|\bwho was out\b/.test(text) ? 'absent'
      : u.names.length ? 'person' : 'show';
  }
  if (u.intent === 'tours') {
    u.sub = u.c.mine && u.c.next ? 'mine' : u.c.ref && /\b(his|her|their) (?:next )?tours?\b/.test(text) ? 'ref' : u.time ? 'slot' : u.names.length ? 'person' : 'day';
  }
  return u;
}
