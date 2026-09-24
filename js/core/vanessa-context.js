/* ============================================================ Vanessa actions
   Everything Vanessa can offer, as data.

   Each action is one entry in ACTIONS:

     id           stable name
     title        what the button says
     description  one line under it
     icon         an entry in icons.js
     kind         'open' (a tool) or 'ask' (a question she already answers,
                  or a flow she already runs — the eval write-up)
     to / q       the tool id, or the question
     needs        'any' | 'training' | 'recruitment' | 'admin'   (asks only;
                  an 'open' is checked against the router itself)
     context      the routes it belongs on, or '*' for everywhere
     category     'tool' | 'task' | 'question' | 'help' — for grouping
     priority     number, or ctx => number; return null to hide it
     badge        ctx => count to show, or null
     status       ctx => short live line, or null
     reason       ctx => why it is being promoted right now, or null

   resolveActions(route, ctx) filters by permission, scores by priority and
   sorts them into tiers — primary (needs you now), secondary (what you
   usually reach for) and more (everything else) — and every surface that
   shows her actions renders from that one result. Adding a capability later
   is one entry here, not another hand-built row of buttons.

   Permissions: an 'open' is allowed only if visibleModules() — the router's
   own rule — includes the tool. An 'ask' declares the committee it needs,
   checked with the same role functions the router uses. Nothing here grants
   anything; the database still decides what data comes back.
============================================================================ */
import { state, isAdmin, inTraining, inRecruitment } from './state.js';
import { visibleModules } from './router.js';

/* ------------------------------------------------------------ live data
   Read from what is already loaded. Nothing is fetched here. */
const mine        = () => (state.guides || []).filter(g => g.evaluatorId && g.evaluatorId === state.me?.id);
const myClaimed   = () => mine().filter(g => g.status === 'claimed');
const openGuides  = () => (state.guides || []).filter(g => g.status === 'open');
const urgentOpen  = () => openGuides().filter(g => g.rank <= 2);
const toReview    = () => (state.guides || []).filter(g => g.status === 'submitted');
const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The claimed eval whose tour is today, soonest first — the most relevant thing on Home. */
const evalToday = () => myClaimed().filter(g => g.date === todayStr()).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))[0] || null;
const clock = t => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

const NEEDS = { any: () => true, training: inTraining, recruitment: inRecruitment, admin: isAdmin };

/* ------------------------------------------------------------ the tools
   One plain-language line per tool, used when somebody asks Vanessa what a
   tool is, and as the description on its action. */
export const TOOL_INFO = {
  today: { names: ['home', 'vanessa'], explain: 'Home is where I live: what needs you today, and every tool your account can open.', helps: "",
    howto: ['Tell me what you are trying to do — “I need to do an eval”, “who has the 2 PM?”.', 'Or pick one of the actions below; the most pressing come first.', 'Every tool your account can open is one click away.'] },
  announcements: { names: ['announcements', 'notices'], explain: 'Notices for the committee. Everyone can read them; codirectors post them.', helps: "I can tell you what needs doing.",
    howto: ['Newest notices are at the top.', 'Codirectors can post, edit and pin notices here.'] },
  evals: { names: ['eval tracker', 'evaluation tool', 'evaluations', 'evaluation', 'evals', 'eval'], also: ['tracker'], explain: 'The Eval Tracker is where tour guide evaluations happen: claim a guide, pick one of their tours, then submit your feedback.', helps: "I can help you write feedback or find a tour to evaluate.",
    howto: ['Available lists guides nobody has claimed yet — claim one and pick their tour.', 'Mine holds the ones you claimed; open one to write and submit the evaluation.', 'Or just tell me “I need to do an eval” and I’ll walk you through it.'] },
  interviews: { names: ['interviews', 'interview tool', 'grading'], explain: 'Interviews runs recruitment day: check candidates in, grade them, and see results and decisions.', helps: "I can find who is ungraded or worth discussing.",
    howto: ['Check candidates in as they arrive.', 'Grade each one you interviewed.', 'Results shows scores, disagreements and decisions.'] },
  training: { names: ['training', 'attendance'], also: ['attendance tool', 'absence form'], explain: 'Training tracks attendance at each session, who owes a makeup, and absences filed in advance.', helps: "I can find who owes a makeup or who filed an absence.",
    howto: ['Attendance: pick a session, then set each person’s status in the grid.', 'Makeups owed: mark a makeup done when someone completes it.', 'Absence form: responses people filed ahead of time.'] },
  schedule: { names: ['tour schedule', 'schedule'], explain: 'The Tour Schedule shows who is leading which tour, read live from the shared workbook.', helps: "I can tell you who is leading, any day.",
    howto: ['Search for a guide, or change the start date and range.', 'It reads the shared workbook live, so changes there show up here.'] },
  directory: { names: ['guide directory', 'directory'], explain: 'The Guide Directory is everyone on the roster, with their eval status, tours and details in one place.', helps: "I can find who still needs an eval.",
    howto: ['Search by name, or filter by priority.', 'Open a guide to see their tours, evaluation and training at a glance.'] },
  desks: { names: ['desk coverage', 'desks', 'desk'], explain: 'Desk Coverage is the weekly Front and Welcome desk rota, with any uncovered slots called out.', helps: "I can find uncovered slots.",
    howto: ['Each day shows who covers the Front and Welcome desks.', 'Uncovered slots are called out so they can be filled.'] },
  people: { names: ['people', 'accounts', 'access'], explain: 'People controls who can sign in to the hub and which role — and so which tools — each person has.', helps: "I can explain what each role can see.",
    howto: ['Add someone’s email so they can sign in.', 'Their role decides which tools they see.', 'Changes take effect at their next sign-in.'] },
  health: { names: ['data health'], explain: 'Data health lists where the hub and the spreadsheets disagree, so records can be put right.', helps: "I can explain what each check means.",
    howto: ['Each check lists records that disagree between the hub and a sheet.', 'Fix the record at its source, then refresh.'] }
};

/* ------------------------------------------------------------ registry */
const ACTIONS = [
  /* --- home: the day ------------------------------------------------- */
  { id: 'complete-eval', kind: 'ask', q: 'I need to do an evaluation', needs: 'training', context: ['today', 'evals'],
    title: 'Complete an evaluation', icon: 'evals', category: 'task',
    description: 'Pick the tour, tell me how it went, approve the wording',
    // A tour happening today outranks everything; a claim waiting is next.
    priority: () => (evalToday() ? 98 : myClaimed().length ? 92 : null),
    badge: () => myClaimed().length || null,
    reason: () => evalToday() ? `${evalToday().name.split(' ')[0]}’s tour is today${evalToday().time ? ` at ${clock(evalToday().time)}` : ''}.`
                : myClaimed().length ? `You have ${n(myClaimed().length, 'claimed evaluation')} waiting.` : null },

  { id: 'review-evals', kind: 'open', to: 'evals', context: ['today'],
    title: 'Review submitted evals', icon: 'evals', category: 'task',
    description: 'Mark them reviewed once you have read them',
    priority: () => (isAdmin() && toReview().length ? 80 : null),
    badge: () => toReview().length || null,
    reason: () => toReview().length ? `${n(toReview().length, 'submitted eval')} to review.` : null },

  { id: 'claim-eval', kind: 'open', to: 'evals', context: ['today'],
    title: 'Claim an evaluation', icon: 'evals', category: 'tool',
    description: 'Claim, schedule and submit tour guide evals',
    priority: () => (urgentOpen().length ? 76 : 60),
    status: () => openGuides().length ? `${openGuides().length} guides up for grabs` : null,
    reason: () => urgentOpen().length ? `${n(urgentOpen().length, 'first or second priority guide')} still unclaimed.` : null },

  { id: 'tours-today', kind: 'open', to: 'schedule', context: ['today', 'evals'],
    title: "Today's tours", icon: 'schedule', category: 'tool',
    description: 'Who is leading, and when',
    priority: ctx => (ctx.route === 'evals' ? 30 : ctx.toursToday ? 72 : 58),
    status: ctx => ctx.toursToday == null ? null : ctx.toursToday ? `${n(ctx.toursToday, 'tour')} today${ctx.nextTour ? ` · next ${ctx.nextTour}` : ''}` : 'No tours today' },

  { id: 'interviews', kind: 'open', to: 'interviews', context: ['today'],
    title: 'Run interviews', icon: 'interviews', category: 'tool',
    description: 'Check-in, grading and results',
    priority: ctx => (ctx.unscoredForMe ? 90 : 64),
    badge: ctx => ctx.unscoredForMe || null,
    reason: ctx => ctx.unscoredForMe ? `${n(ctx.unscoredForMe, 'checked-in candidate')} waiting on your score.` : null },

  { id: 'attendance', kind: 'open', to: 'training', context: ['today'],
    title: 'Attendance', icon: 'training', category: 'tool',
    description: 'Training sessions, makeups and absences', priority: 56 },

  { id: 'announcements', kind: 'open', to: 'announcements', context: ['today'],
    title: 'Announcements', icon: 'announcements', category: 'tool',
    description: 'Notices for the committee',
    priority: ctx => (ctx.unread ? 74 : 30),
    badge: ctx => ctx.unread || null,
    reason: ctx => ctx.unread ? `${n(ctx.unread, 'new announcement')}.` : null },

  { id: 'desk-gaps', kind: 'ask', q: 'Which desk slots are uncovered?', needs: 'training', context: ['today'],
    title: 'Find desk gaps', icon: 'desks', category: 'question',
    description: 'Front and Welcome desk coverage',
    priority: ctx => (ctx.deskGaps ? 62 : 34),
    badge: ctx => ctx.deskGaps || null },

  { id: 'makeups', kind: 'ask', q: 'Who owes a makeup?', needs: 'admin', context: ['today'],
    title: 'Who owes a makeup?', icon: 'training', category: 'question', priority: 44 },

  { id: 'discuss', kind: 'ask', q: 'Who is worth discussing?', needs: 'recruitment', context: ['today'],
    title: 'Who is worth discussing?', icon: 'interviews', category: 'question', priority: 42 },

  { id: 'directory', kind: 'open', to: 'directory', context: ['today'], title: 'Guide Directory', icon: 'directory', category: 'tool',
    description: 'Everyone on the roster', priority: 26 },
  { id: 'desks', kind: 'open', to: 'desks', context: ['today'], title: 'Desk Coverage', icon: 'desks', category: 'tool',
    description: 'The weekly desk rota', priority: 24 },
  { id: 'people', kind: 'open', to: 'people', context: ['today'], title: 'People & access', icon: 'people', category: 'tool',
    description: 'Who can sign in, and what they see', priority: 22 },
  { id: 'health', kind: 'open', to: 'health', context: ['today'], title: 'Data health', icon: 'health', category: 'tool',
    description: 'Where the hub and sheets disagree', priority: 20 },
  { id: 'handbook', kind: 'ask', q: 'What should I wear on tour?', context: ['today'], title: 'Handbook questions', icon: 'spark', category: 'help',
    description: 'Dress code, strikes, absences', priority: 18 },

  /* --- evals ----------------------------------------------------------- */
  { id: 'my-evals', kind: 'ask', q: 'What are my evals?', needs: 'training', context: ['evals'], title: 'What are my evals?', category: 'question', priority: 70 },
  { id: 'evals-tomorrow', kind: 'ask', q: 'Who needs an eval and has a tour tomorrow?', needs: 'training', context: ['evals', 'schedule'],
    title: 'Who needs an eval and leads tomorrow?', category: 'question', priority: ctx => (ctx.route === 'schedule' ? 40 : 66) },
  { id: 'eval-progress', kind: 'ask', q: 'How far along are the evals?', needs: 'training', context: ['evals'], title: 'How far along are we?', category: 'question', priority: 60 },
  { id: 'how-claim', kind: 'ask', q: 'How do I claim someone?', needs: 'training', context: ['evals'], title: 'How does claiming work?', category: 'help', priority: 40 },

  /* --- interviews ------------------------------------------------------ */
  { id: 'not-in', kind: 'ask', q: 'Who has not checked in?', needs: 'recruitment', context: ['interviews'], title: 'Who has not checked in?', category: 'question', priority: 72 },
  { id: 'ungraded', kind: 'ask', q: 'Who is ungraded?', needs: 'recruitment', context: ['interviews'], title: 'Who is ungraded?', category: 'question', priority: 70 },
  { id: 'discuss-here', kind: 'ask', q: 'Who is worth discussing?', needs: 'recruitment', context: ['interviews'], title: 'Who is worth discussing?', category: 'question', priority: 66 },
  { id: 'top', kind: 'ask', q: 'Who are the top candidates?', needs: 'recruitment', context: ['interviews'], title: 'Top candidates', category: 'question', priority: 60 },
  { id: 'score-how', kind: 'ask', q: 'How is the final score worked out?', needs: 'recruitment', context: ['interviews'], title: 'How is the score worked out?', category: 'help', priority: 40 },

  /* --- training -------------------------------------------------------- */
  { id: 'owes', kind: 'ask', q: 'Who owes a makeup?', needs: 'admin', context: ['training'], title: 'Who owes a makeup?', category: 'question', priority: 72 },
  { id: 'filed', kind: 'ask', q: 'Who filed an absence?', needs: 'admin', context: ['training'], title: 'Who filed an absence?', category: 'question', priority: 68 },
  { id: 'last-session', kind: 'ask', q: 'How did the last training go?', needs: 'admin', context: ['training'], title: 'How did the last session go?', category: 'question', priority: 60 },

  /* --- schedule -------------------------------------------------------- */
  { id: 'lead-today', kind: 'ask', q: 'Who is leading tours today?', context: ['schedule'], title: 'Who is leading today?', category: 'question', priority: 72 },
  { id: 'lead-tomorrow', kind: 'ask', q: 'Who is leading tours tomorrow?', context: ['schedule'], title: 'Who is leading tomorrow?', category: 'question', priority: 68 },
  { id: 'lead-week', kind: 'ask', q: 'Who is leading tours this week?', context: ['schedule'], title: 'This week at a glance', category: 'question', priority: 60 },

  /* --- desks ----------------------------------------------------------- */
  { id: 'uncovered', kind: 'ask', q: 'Which desk slots are uncovered?', needs: 'training', context: ['desks'], title: 'Which slots are uncovered?', category: 'question', priority: 72 },
  { id: 'front', kind: 'ask', q: 'Show front desk coverage', needs: 'training', context: ['desks'], title: 'Front Desk coverage', category: 'question', priority: 60 },
  { id: 'welcome', kind: 'ask', q: 'Show welcome desk coverage', needs: 'training', context: ['desks'], title: 'Welcome Desk coverage', category: 'question', priority: 58 },

  /* --- directory ------------------------------------------------------- */
  { id: 'still-need', kind: 'ask', q: 'Who still needs an eval?', needs: 'training', context: ['directory'], title: 'Who still needs an eval?', category: 'question', priority: 70 },
  { id: 'no-tour', kind: 'ask', q: 'Who has no tour scheduled?', needs: 'training', context: ['directory'], title: 'Who has no tour scheduled?', category: 'question', priority: 64 },

  /* --- everywhere ------------------------------------------------------ */
  { id: 'todo', kind: 'ask', q: 'What do I need to do?', context: '*', title: 'What do I need to do?', category: 'question', priority: ctx => (ctx.route === 'today' ? null : 14) },
  { id: 'wear', kind: 'ask', q: 'What should I wear on tour?', context: '*', title: 'What should I wear on tour?', category: 'help', priority: ctx => (ctx.route === 'today' ? null : 10) },
  { id: 'can-do', kind: 'ask', q: 'What can you do?', context: ['people', 'health', 'announcements'], title: 'What can you help with?', category: 'help', priority: 30 },
  { id: 'home', kind: 'open', to: 'today', context: '*', title: 'Back to Home', icon: 'today', category: 'tool',
    priority: ctx => (ctx.route === 'today' ? null : 8) }
];

/* ------------------------------------------------------------ resolver */
const val = (f, ctx) => (typeof f === 'function' ? f(ctx) : f);

/** May this account run it, right now? The one permission question every
   Vanessa action is asked at the moment it runs — not just when drawn. */
export function canRun(a) { return !!a && allowed(a); }

function allowed(a) {
  if (a.kind === 'open') return visibleModules().some(m => m.id === a.to && !m.soon);
  return (NEEDS[a.needs || 'any'] || NEEDS.any)();
}

/**
 * The actions for a route, permission-checked, scored and tiered.
 * @returns {{ id, kind, to, q, title, description, icon, category, tier,
 *             priority, badge, status, reason }[]}
 */
export function resolveActions(route = 'today', ctx = {}) {
  ctx = { ...ctx, route };
  const seen = new Set();
  return ACTIONS
    .filter(a => a.context === '*' || a.context.includes(route))
    .filter(allowed)
    .map(a => {
      let priority = val(a.priority, ctx);
      if (priority == null) return null;
      const out = {
        id: a.id, kind: a.kind, to: a.to, q: a.q, title: a.title, icon: a.icon,
        category: a.category, description: a.description || '',
        badge: a.badge ? a.badge(ctx) : null,
        status: a.status ? a.status(ctx) : null,
        reason: a.reason ? a.reason(ctx) : null
      };
      out.priority = priority;
      out.tier = priority >= 70 ? 'primary' : priority >= 40 ? 'secondary' : 'more';
      return out;
    })
    .filter(Boolean)
    .filter(a => { const key = a.kind === 'open' ? `open:${a.to}` : `ask:${a.q.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.priority - a.priority);
}

/* ------------------------------------------------------------ explaining
   "What is the evaluation tool?" — a short answer and a way in, or a polite
   no if this account cannot open it. Only fires on questions plainly asking
   what a tool is, so handbook and data questions are untouched. */
const EXPLAIN = /^\s*(?:what(?:'s| is| are| does)|explain|tell me what|how does)\b/i;
const NO = "That tool isn't available for your account.";

export function explainTool(question) {
  const q = String(question || '').toLowerCase();
  if (!EXPLAIN.test(q)) return null;
  // Asking about the tool, not its contents: "what is the eval tracker", not "what are my evals".
  if (/\b(my|mine|who|how many|which|today|tomorrow|this week)\b/.test(q)) return null;
  if (!/\b(tool|tracker|tab|page|section|for|do|work|mean)\b/.test(q) && !/^\s*what(?:'s| is)\s+(?:the\s+)?[a-z ]+\??\s*$/.test(q)) return null;
  const hit = Object.entries(TOOL_INFO)
    .flatMap(([id, t]) => t.names.map(name => ({ id, name, t })))
    .sort((a, b) => b.name.length - a.name.length)
    .find(({ name }) => new RegExp(`\\b${name}\\b`).test(q));
  if (!hit) return null;
  const mod = visibleModules().find(m => m.id === hit.id);
  if (!mod) return { denied: true, text: NO };
  return { to: hit.id, title: mod.title, text: hit.t.explain };
}

/* ------------------------------------------------------------ legacy shape
   The first two passes rendered {kind:'go'|'ask', label, sub}. These keep
   those callers working on top of the registry. */
const legacy = a => ({ kind: a.kind === 'open' ? 'go' : 'ask', to: a.to, q: a.q, label: a.title,
  sub: a.status || a.description, icon: a.icon, weight: a.tier === 'primary' ? 3 : a.tier === 'secondary' ? 2 : 1,
  badge: a.badge, reason: a.reason, tier: a.tier, id: a.id });

export function actionsFor(routeId, { withGeneral = true } = {}) {
  return resolveActions(routeId)
    .filter(a => withGeneral || !['todo', 'wear', 'home'].includes(a.id))
    .map(legacy);
}

export function questionsFor(routeId, n = 2) {
  return actionsFor(routeId, { withGeneral: false }).filter(a => a.kind === 'ask').slice(0, n).map(a => a.q);
}

