/* ============================================================ the words Vanessa knows
   Everything about HOW people phrase things lives here and in intents.js; nothing
   else in the engine contains a pattern for a word.

     text  ->  normalize()  ->  tokens  ->  tags

   Normalising lower-cases, removes accents, expands contractions ("hasn't" ->
   "has not") and collapses multi-word phrases ("make up", "high priority") into
   single tokens. Each token then carries zero or more TAGS (a concept: EVAL, NEED,
   TOUR ...). Intents are defined over tags, so "who still needs evaluated",
   "who hasn't been evaled" and "which guides are left to evaluate" are the same
   thing to the rest of the system without anyone listing every sentence.

   Adding vocabulary: add the word to a TAGS group (or a rule to PHRASES). Adding a
   whole new way of asking: add it to phrasebook.js. Both are data, reviewed like code,
   and covered by tests; nothing rewrites itself in production.
============================================================================ */
export const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ------------------------------------------------------------------ phrases */
const TYPOS = [[/\bstil\b/g, 'still'], [/\bwich\b/g, 'which'], [/\btomorow\b|\btommorow\b|\btommorrow\b/g, 'tomorrow'], [/\bnxt\b/g, 'next'], [/\bwhos\b/g, 'who is']];
const CONTRACTIONS = [
  [/won't/g, 'will not'], [/can't/g, 'can not'], [/cannot/g, 'can not'], [/ain't/g, 'is not'], [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'],
  [/([a-z]+)n't\b/g, '$1 not'],
  [/\b(what|who|how|where|when|why|that|there|here|it|he|she)'s\b/g, '$1 is'],
  [/\b([a-z]+)'re\b/g, '$1 are'], [/\b([a-z]+)'ve\b/g, '$1 have'], [/\b([a-z]+)'ll\b/g, '$1 will'], [/\bi'm\b/g, 'i am'], [/\bi'd\b/g, 'i would']
];

/** [pattern, replacement]. Each collapses a multi-word idea into one token. */
const PHRASES = [
  [/\bmake[- ]?ups?\b|\bmake up (?:session|training|day|date)s?\b/g, 'makeup'],
  [/\bscheduled twice\b|\bbooked twice\b|\btwice at the same time\b|\btwo (?:tours|places) at once\b|\bin two places\b|\bdouble[- ]?book(?:ed|ing)?\b|\bover[- ]?book(?:ed|ing)?\b|\btime clash\b/g, 'doublebooked'],
  [/\bhow many\b|\bnumber of\b|\bhow much\b|\bcount of\b/g, 'howmany'],
  [/\bwhat time\b|\bwhat day\b/g, 'whattime'],
  [/\bset (?:it|that|this|them|those) up\b|\block (?:it|that|them) in\b|\bmake (?:it|that) happen\b|\bbook (?:it|that|them)\b|\bgo ahead and (?:assign|book|set)\b|\bdo (?:it|that)\b|\bput (?:it|that) (?:in|on)\b|\bschedule (?:it|that|them)\b|\bassign (?:it|that|them|the best|the top|the first)\b|\bpair (?:them|it) up\b/g, 'setitup'],
  [/\bgood to go\b|\ball set\b|\bset for\b|\bprepared for\b|\bready for\b/g, 'ready'],
  [/\bweekly (?:plan|brief|briefing|summary|rundown|overview)\b/g, 'brief weekly'],
  [/\bmorning (?:plan|brief|briefing|summary|rundown|overview)\b/g, 'brief morning'],
  [/\bdaily (?:plan|brief|briefing|summary|rundown|overview)\b/g, 'brief'],
  [/\bcatch me up\b|\bfill me in\b|\bbrief me\b|\bbrief(?:ing)? for\b|\bupdate me\b|\bwhat is going on\b|\bwhat is happening\b|\bwhat is up\b|\bwhat is new\b|\bstate of things\b|\bhow are things\b|\bhow is everything\b|\bwhat do i need to know\b|\bgive me the rundown\b|\bwhat is on deck\b|\bwhat is the plan\b/g, 'brief'],
  [/\banything (?:i|we) (?:need|should|have|ought|must) to (?:worry|know|watch|look|see|fix|handle|deal|do|be aware|be concerned)\b|\bshould i (?:worry|be worried|be concerned)\b|\bis there anything (?:wrong|urgent|on fire)\b|\banything (?:wrong|urgent|on fire|slipping|burning)\b|\bfalling through the cracks\b|\bslipping through\b|\boff track\b|\bwhat should i (?:worry|look|be looking) (?:about|at)\b|\bwhat do i need to (?:worry|fix|handle|deal)\b/g, 'worry'],
  [/\bneeds? (?:my |our )?attention\b|\bneeding (?:my |our )?attention\b|\bwaiting on me\b|\bon my plate\b|\bto do list\b|\bmy to dos?\b|\bwhat should i (?:do|work on|tackle)\b|\bwhat is next for me\b/g, 'attention'],
  [/\bup to date\b|\bsynced? up\b|\bup and running\b|\blast (?:sync|synced|updated|refresh(?:ed)?)\b/g, 'uptodate'],
  [/\bout of date\b|\bnot (?:updating|syncing)\b|\bfailed to sync\b/g, 'stale'],
  [/\bhigh(?:est)? priority\b|\btop priority\b|\bfirst priority\b|\bpriority (?:one|1|number one)\b|\bmost urgent\b|\bmost important\b|\burgent(?:ly)?\b|\bcritical\b|\b(?:really|desperately|badly|definitely|most|absolutely) (?:need|needs|needed)\b/g, m => (/need/.test(m) ? 'highprio need' : 'highprio')],
  [/\blow(?:est)? priority\b|\bleast urgent\b|\bnot urgent\b|\bcan wait\b/g, 'lowprio'],
  [/\b(?:normal|medium|regular|mid|middle|standard|average) priority\b/g, 'midprio'],
  [/\bno[- ]?shows?\b/g, 'noshow'],
  [/\bdid not (?:attend|show|come|go|make it)(?: up)?\b|\bwas not (?:there|present|here)\b|\bwere not (?:there|present|here)\b|\bnot (?:there|present)\b|\bdid not make it\b|\bskipped\b|\bditched\b|\bblew off\b/g, 'missed'],
  [/\b(?:we|i) can (?:evaluate|eval)\b|\bcan (?:we|i) (?:evaluate|eval)\b|\bwho (?:can|could|is able to|is free to|is available to|would be able to)\b|\b(?:anyone|anybody|someone|somebody) (?:who )?(?:can|could|is able to|is free to)\b/g, m => (/eval/.test(m) ? 'whocan eval' : 'whocan')],
  [/\bcan not (?:make|come|be there|attend|do|lead|give|work)\b|\bwill not be able\b|\bout sick\b|\bnot able to make\b|\bunable to (?:make|come|attend|lead|give|do)\b|\bhave to miss\b|\bneeds? (?:a |some )?(?:sub|substitute|cover|coverage|replacement|backup)\b|\bfill(?:ing)? in\b|\bstand(?:ing)? in\b|\btake over\b|\bpick(?:ing)? up (?:a |the |his |her |their )?(?:tour|shift)\b|\bswap(?:ping)? (?:with|out)\b|\bsubstitut(?:e|ing)\b|\bwho (?:is|will be) (?:covering|replacing)\b|\bcover(?:ed|ing|s)?\b|\bcoverage\b/g, 'cover'],
  [/\bfront desk\b|\bwelcome desk\b|\bvisitor(?:s)? (?:center|centre|desk)\b|\binformation desk\b|\bdesks?\b/g, 'desk'],
  [/\btell me about\b|\bwhat do you know about\b|\bdetails (?:on|about|for)\b|\binformation (?:on|about)\b|\binfo (?:on|about)\b|\blook ?up\b|\bpull up\b|\bprofile\b|\bbio of\b|\bbackground on\b/g, 'profile'],
  [/\bwhat can you do\b|\bwhat do you do\b|\bhow do you work\b|\bwhat are you\b|\bwhat are your (?:abilities|capabilities|skills|commands)\b|\bhelp me\b|\bhow can you help\b|\bwhat can i ask\b|\bwhat should i ask\b|\bcommands\b|\bcapabilities\b|\bhelp\b/g, 'helpme'],
  [/\bthank you\b|\bthanks\b|\bthank\b|\bcheers\b|\bappreciate (?:it|that)\b|\bgreat\b|\bawesome\b|\bperfect\b|\bnice\b|\bgot it\b|\bcool\b/g, 'thanksword'],
  [/\bgood (?:morning|afternoon|evening|day)\b|\bhello\b|\bhey+\b|\bhi+\b|\byo\b|\bhowdy\b|\bsup\b|\bgreetings\b/g, 'greetword'],
  [/\bsign(?:ed)? ?in\b|\bcheck(?:ed)?[- ]?in\b|\broll ?call\b|\bturn ?out\b|\bshow(?:ed)? up\b/g, 'attendword'],
  [/\bnot (?:matched|matching|linked|mapped|recognized|recognised|resolved)\b|\bdo not match\b|\bdoes not match\b|\bdid not match\b|\bunknown names?\b|\bname (?:issues?|problems?|mismatch(?:es)?)\b|\bwho is this\b/g, 'unmatched'],
  [/\bnot (?:on|in) the (?:schedule|calendar)\b|\bnot scheduled\b|\bno tours?\b|\bnot touring\b|\bhas no tours?\b|\bhave no tours?\b|\bwithout (?:a )?tours?\b/g, 'notonschedule'],
  [/\bno major\b|\bmissing (?:a )?major\b|\bundeclared\b|\bwithout (?:a )?major\b|\bno majors?\b/g, 'nomajor'],
  [/\bnew (?:guides|guide|tgs|hires|members|folks|people)\b|\bnewbies\b|\brookies\b|\bfirst[- ]semester\b|\bjoined (?:this|the) (?:semester|term)\b|\bnew this (?:semester|term)\b/g, 'newguide'],
  [/\bco[- ]?directors?\b/g, 'codirector'],
  [/\bleadership\b|\bleaders\b|\bexec(?:utive)?(?: board| team)?\b/g, 'leadership'],
  [/\btake me to\b|\bbring me to\b|\btake me\b|\bgo to\b|\bhead to\b|\bnavigate to\b|\bjump to\b/g, 'open'],
  [/\bnext (?:tour|one)\b/g, 'nexttour'],
  [/\bwho is (?:on|leading|giving|working)\b/g, 'who touring'],
  [/\bwho is\b|\bwho are\b|\bwho s\b|\bwho was\b|\bwho were\b|\bwho does\b|\bwho do\b|\bwho did\b|\bwho has\b|\bwho have\b|\bwho will\b/g, 'who'],
  [/\bany (?:of )?(?:the )?(?:guides|guide|tgs)\b|\banyone\b|\banybody\b|\bsomeone\b|\bsomebody\b|\beveryone\b|\beverybody\b|\bwhich (?:guides|guide|people|ones|tgs|tour guides)\b/g, 'who'],
  [/\bwhat is\b|\bwhat are\b|\bwhat s\b|\bwhich\b/g, 'what'],
  [/\bhow is\b|\bhow are\b|\bhow s\b|\bhow was\b/g, 'how']
];

/* --------------------------------------------------------------------- tags
   word -> concept. A word may belong to several concepts. */
const TAGS = {
  EVAL: 'eval evals evaled evalled evaluate evaluated evaluates evaluating evaluation evaluations unevaluated assessed observe observed observation observations',
  EVALUATOR: 'evaluator evaluators',
  GUIDE: 'guide guides tg tgs ambassador ambassadors',
  PEOPLEWORD: 'person people folks members member staff',
  TOUR: 'tour tours touring toured nexttour leading lead leads led giving',
  SCHEDULE: 'schedule schedules scheduling calendar agenda lineup shift shifts slot slots timetable',
  NEXT: 'next upcoming soonest nexttour',
  WHO: 'who',
  WHAT: 'what',
  HOWMANY: 'howmany count total tally',
  WHEN: 'when whattime',
  NEED: 'need needs needed needing require requires required requiring owe owes owed lack lacks lacking missing outstanding',
  NEG: 'not never no nobody none neither nor without hasnt havent doesnt dont didnt',
  STILL: 'still yet remaining left leftover unfinished pending incomplete undone behind overdue unassigned unclaimed',
  UNASSIGNED: 'unassigned unclaimed',
  DONEVERB: 'done complete completed finish finished submitted attended had received passed',
  DONE: 'done completed finished submitted reviewed finished',
  ALREADY: 'already recently previously',
  HIGHPRIO: 'highprio',
  LOWPRIO: 'lowprio',
  MIDPRIO: 'midprio',
  PRIORITY: 'priority priorities prioritize prioritise prioritized prioritised ranking ranked rank',
  BEST: 'best strongest ideal optimal top recommend recommended recommendation recommendations suggest suggested suggestion suggestions',
  OPPORTUNITY: 'opportunity opportunities option options matchup matchups',
  MATCH: 'match matches matched matching pairing pairings',
  SETITUP: 'setitup',
  ASSIGN: 'assign assigns assigned assigning book booking put pair line sign',
  CHANGE: 'change changes changed set update updated move raise lower bump promote demote switch make mark',
  ARCHIVE: 'archive archived deactivate remove retire',
  RESTORE: 'restore reactivate unarchive reinstate',
  ADD: 'add create register invite enroll',
  MISSED: 'missed miss noshow absent absence absences skip skipped',
  MAKEUP: 'makeup',
  TRAIN: 'training trainings session sessions workshop workshops orientation',
  ATTEND: 'attendance attended attend attending attendword turnout',
  READY: 'ready',
  COVER: 'cover',
  DESK: 'desk',
  GAP: 'open uncovered empty unfilled unstaffed gap gaps vacant vacancy vacancies understaffed shortage',
  CONFLICT: 'conflict conflicts clash clashes doublebooked overlap overlaps overlapping collision collisions',
  BRIEF: 'brief briefing summary summarize summarise rundown overview digest recap',
  PROBLEM: 'problem problems issue issues wrong broken trouble fire fires worry worried concern concerns risk risks stuck blocked blocker blockers urgent mess',
  ATTENTION: 'attention',
  SYNC: 'sync synced syncing synchronized uptodate stale connected connection refresh refreshed imported import fresh',
  SOURCE: 'source sources spreadsheet spreadsheets sheet sheets feed feeds',
  UNMATCHED: 'unmatched mismatch mismatched unmapped unresolved reconcile reconciliation identity identities',
  MAJOR: 'major majors majoring studying study studies degree department',
  ACTIVE: 'active inactive archived current enrolled',
  ROSTER: 'roster',
  LEADERSHIP: 'leadership',
  NEWGUIDE: 'newguide',
  NOMAJOR: 'nomajor',
  NOTONSCHEDULE: 'notonschedule',
  PROFILE: 'profile',
  HELP: 'helpme',
  THANKS: 'thanksword',
  GREET: 'greetword',
  ANNOUNCE: 'announce announcement announcements announced post posted posts broadcast',
  SEMESTER: 'semester term',
  OPEN: 'open go navigate visit',
  PAGE: 'page screen tab view',
  AVAILABLE: 'available free availability',
  MINE: 'my mine myself me our',
  SHOW: 'show list display give get tell pull',
  FIND: 'find search locate suggest',
  WRITE: 'write draft compose submit',
  REMIND: 'remind reminder reminders nudge ping',
  MATERIALS: 'material materials slides deck handout handouts resources resource',
  WHOCAN: 'whocan',
  UNMATCH: 'unmatched',
  NOTE: 'note notes',
  ACTIVITY: 'activity audit log changes history changed change',
  WORRY: 'worry',
  PROGRESS: 'progress progressing',
  NEW: 'new latest recent recently posted',
  SKIP: 'skip exempt exclude waive excuse excused',
  ROLE: 'role roles permission permissions access admin administrator codirector',
  CODIRECTOR: 'codirector',
  ORDINAL: 'first second third fourth fifth last final one ones number option item candidate other',
  ATTSTATUS: 'late tardy excused absent attended present',
  ALL: 'all everything everyone',
  NOSHOW: 'noshow'
};

export const TAG_OF = new Map();
for (const [tag, words] of Object.entries(TAGS)) for (const w of words.split(/\s+/)) { if (!w || w.endsWith('?')) continue; (TAG_OF.get(w) || TAG_OF.set(w, new Set()).get(w)).add(tag); }

/** Words that carry no meaning of their own for matching. */
export const STOP = new Set(('a an the is are was were be been being am do does did to of for on in at by with that this those these it its i we you our us your their them they he she him her his hers there here please can could would should will shall may might just really very also any some so if then than as from up out about into over under and or but not no yes ok okay hey hi hello hmm um uh well like kind sort bit lot lots maybe actually basically ' + 'right now currently today tomorrow tonight yesterday week weekend month morning afternoon evening night monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun').split(' '));

/** Everyday words that are also plausible names; accepted as a name only when capitalised or cued. */
export const NAME_COLLISIONS = new Set('will mark may grace hope rose page art bill case long young white black brown green gray grey king hall cook bell ward lane fox rich dean chase drew earl faith frank gene gill grant guy hunter jack jay jean joy june april august dawn summer autumn sky sage reed rob ray rod sue ted tim tom wade west wells wood york love major miles noel patch penny pierce price ross sandy shane stone swift tyler victor wise'.split(' '));

/** A short list of ordinary words so a typo-tolerant name match doesn't "find" a person in them. */
export const COMMON = new Set(('tour tours come came code coded core cold cole role roles rule rules more most less many much same such than then them they this that what when where which while whom whose with without within would could should about above after again against all also always among another any are around back been before being below between both but call came can come could day days did does done down during each either else even ever every few find first for found from get give goes going gone good got great had has have having here high home how into just keep know last later left less let life like line list long look made make many might must need never next night none nothing now off often once only other our out over own part people place please put read right same say see seem shall she show side since some soon still such sure take tell than their them then there these they thing think this those though three through time today together too took toward turn under until upon use very want was way well went were what when where whether which while who whole why will with work would year years yes yet you your ' +
  'guide guides group groups desk desks shift shifts slot slots eval evals train training session sessions major majors makeup attendance schedule schedules announce announcement brief briefing cover coverage priority priorities assign assigned evaluate evaluated evaluation evaluator evaluators conflicts conflict tomorrow yesterday monday tuesday wednesday thursday friday saturday sunday morning evening afternoon week weekend month semester spring summer fall winter').split(' '));

/* --------------------------------------------------------------- normalising */
/** The text Vanessa reasons about: lower-case, no accents, contractions and phrases expanded. */
export function normalize(text) {
  let s = strip(String(text ?? '')).replace(/[’‘`]/g, "'").toLowerCase();
  for (const [re, to] of TYPOS) s = s.replace(re, to);
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/([a-z])'s\b/g, '$1').replace(/'/g, '');
  s = s.replace(/[^a-z0-9:/#+ -]+/g, ' ').replace(/\s+/g, ' ');
  s = ` ${s} `;
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

export const tokenize = norm => norm.split(' ').filter(Boolean);

/* A small, deliberate vocabulary for typo repair: the words intents are built from. */
const VOCAB = new Set([...TAG_OF.keys()].filter(w => w.length >= 5));
['tomorrow', 'today', 'tonight', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'weekend', 'afternoon', 'morning', 'evening', 'upcoming', 'schedule', 'training', 'evaluation', 'evaluations', 'evaluate', 'evaluated', 'priority', 'conflicts', 'attendance', 'announcement', 'announcements', 'coverage', 'summary', 'problems', 'semester', 'january', 'february', 'march', 'april', 'august', 'september', 'october', 'november', 'december'].forEach(w => VOCAB.add(w));
const NO_REPAIR = new Set();

/** Edit distance counting only the slips people really make typing: a dropped letter, an extra letter,
 *  two swapped letters. A changed letter is NOT counted (so "looking" is never "booking"). */
function dl(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : Infinity);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
export const distance = dl;

/** "tomorow" -> "tomorrow", "evluated" -> "evaluated". Only toward the vocabulary above, only for longer words. */
export function repair(token) {
  if (token.length < 5 || VOCAB.has(token) || TAG_OF.has(token) || STOP.has(token) || COMMON.has(token) || /\d/.test(token)) return token;
  const max = token.length >= 9 ? 2 : 1;
  let best = null, bd = max + 1;
  for (const w of VOCAB) { if (NO_REPAIR.has(w)) continue; const d = dl(token, w, max); if (d < bd) { bd = d; best = w; } }
  return best && bd <= max ? best : token;
}

/** The set of tags a token list carries, plus derived ones that depend on word combinations. */
export function tagsOf(tokens) {
  const tags = new Set();
  for (const t of tokens) { const g = TAG_OF.get(t); if (g) g.forEach(x => tags.add(x)); }
  const has = (...k) => k.some(x => tags.has(x));
  if (has('NEED', 'STILL') || (has('NEG') && has('EVAL', 'DONEVERB', 'MATCH', 'ATTEND', 'TRAIN'))) tags.add('OUTSTANDING');
  if (has('NEG') && has('DONEVERB', 'EVAL')) tags.add('NOTYET');
  if (has('NEG') && has('NEED') && !has('WHO')) tags.add('NOTNEED');
  if (has('HIGHPRIO', 'LOWPRIO', 'MIDPRIO')) tags.add('PRIO');
  if (has('WHO', 'WHAT', 'HOWMANY', 'SHOW', 'FIND', 'WHEN')) tags.add('ASK');
  return tags;
}

/** Tokens with every word that carries no meaning removed: what similarity is measured on. */
export const contentTokens = tokens => tokens.filter(t => !STOP.has(t));

/** Dice similarity between two token multisets, on concept-normalised tokens. */
export function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/** A token reduced to its concept when it has exactly one, else itself: "evaled" and "evaluate" compare equal. */
export function conceptual(tokens) { return tokens.map(t => { const g = TAG_OF.get(t); return g && g.size === 1 ? [...g][0] : t; }); }
