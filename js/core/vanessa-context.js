/* ============================================================ Vanessa context
   What Vanessa offers to do, depending on where you are and who you are.

   One list, read by everything that shows her actions — the home deck, her
   panel's suggestions, the hint under a page title, the follow-ups after an
   answer and the floating control on tool pages — so they can never disagree.

   Two kinds of action, and nothing else:
     go   open a tool the router will let this person open
     ask  put a question to her that her matcher (vanessa.js) already answers,
          or start a flow she already runs (the eval write-up)

   Nothing here does anything new. It is a better-organised doorway onto what
   the hub could already do.

   Permissions: every `go` is checked against visibleModules(), the router's
   own rule, and every `ask` declares the committee it needs using the same
   role checks the router uses. There is no second permission model here —
   just the existing one, asked twice.
============================================================================ */
import { state, isAdmin, inTraining, inRecruitment } from './state.js';
import { visibleModules } from './router.js';

const mine = () => (state.guides || []).filter(g => g.evaluatorId && g.evaluatorId === state.me?.id);
const myClaimed = () => mine().filter(g => g.status === 'claimed');
const openCount = () => (state.guides || []).filter(g => g.status === 'open').length;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const NEEDS = {
  any: () => true,
  training: inTraining,
  recruitment: inRecruitment,
  admin: isAdmin
};

/* ---------------------------------------------------------------- per page
   `icon` names an entry in icons.js. `sub` is a short live line, only where
   the data to fill it is already loaded. */
const PAGES = {
  today: () => [],   // home builds its own deck, see homeActions()

  evals: () => [
    myClaimed().length && { kind: 'ask', q: 'Help me write an eval', label: 'Write up an eval with me', icon: 'evals', needs: 'training',
      sub: `${plural(myClaimed().length, 'claimed eval')} waiting on you` },
    { kind: 'ask', q: 'What are my evals?', label: 'What are my evals?', needs: 'training' },
    { kind: 'ask', q: 'Who needs an eval and has a tour tomorrow?', label: 'Who needs an eval and leads tomorrow?', needs: 'training' },
    { kind: 'ask', q: 'How far along are the evals?', label: 'How far along are we?', needs: 'training' },
    { kind: 'ask', q: 'How do I claim someone?', label: 'How does claiming work?', needs: 'training' },
    { kind: 'go', to: 'schedule', label: "Today's tours", icon: 'schedule' }
  ],

  interviews: () => [
    { kind: 'ask', q: 'Who has not checked in?', label: 'Who has not checked in?', needs: 'recruitment' },
    { kind: 'ask', q: 'Who is ungraded?', label: 'Who is ungraded?', needs: 'recruitment' },
    { kind: 'ask', q: 'Who is worth discussing?', label: 'Who is worth discussing?', needs: 'recruitment' },
    { kind: 'ask', q: 'Who are the top candidates?', label: 'Top candidates', needs: 'recruitment' },
    { kind: 'ask', q: 'How is the final score worked out?', label: 'How is the score worked out?', needs: 'recruitment' }
  ],

  training: () => [
    { kind: 'ask', q: 'Who owes a makeup?', label: 'Who owes a makeup?', needs: 'admin' },
    { kind: 'ask', q: 'Who filed an absence?', label: 'Who filed an absence?', needs: 'admin' },
    { kind: 'ask', q: 'How did the last training go?', label: 'How did the last session go?', needs: 'admin' }
  ],

  schedule: () => [
    { kind: 'ask', q: 'Who is leading tours today?', label: 'Who is leading today?' },
    { kind: 'ask', q: 'Who is leading tours tomorrow?', label: 'Who is leading tomorrow?' },
    { kind: 'ask', q: 'Who is leading tours this week?', label: 'This week at a glance' },
    { kind: 'ask', q: 'Who needs an eval and has a tour tomorrow?', label: 'Evals I could do tomorrow', needs: 'training' }
  ],

  desks: () => [
    { kind: 'ask', q: 'Which desk slots are uncovered?', label: 'Which slots are uncovered?', needs: 'training' },
    { kind: 'ask', q: 'Show front desk coverage', label: 'Front Desk coverage', needs: 'training' },
    { kind: 'ask', q: 'Show welcome desk coverage', label: 'Welcome Desk coverage', needs: 'training' }
  ],

  directory: () => [
    { kind: 'ask', q: 'Who still needs an eval?', label: 'Who still needs an eval?', needs: 'training' },
    { kind: 'ask', q: 'Who has no tour scheduled?', label: 'Who has no tour scheduled?', needs: 'training' }
  ],

  announcements: () => [
    { kind: 'ask', q: 'What do I need to do?', label: 'What do I need to do?' }
  ],

  people: () => [
    { kind: 'ask', q: 'What can you do?', label: 'What can you help with?' }
  ],

  health: () => [
    { kind: 'ask', q: 'What can you do?', label: 'What can you help with?' }
  ]
};

/* Always welcome, wherever you are. */
const EVERYWHERE = () => [
  { kind: 'ask', q: 'What do I need to do?', label: 'What do I need to do?' },
  { kind: 'ask', q: 'What should I wear on tour?', label: 'What should I wear on tour?' }
];

function allowed(a) {
  if (!a) return false;
  if (a.kind === 'go') return visibleModules().some(m => m.id === a.to && !m.soon);
  return (NEEDS[a.needs || 'any'] || NEEDS.any)();
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(a => {
    const key = a.kind === 'go' ? `go:${a.to}` : `ask:${a.q.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What she offers on a page, most useful first. */
export function actionsFor(routeId, { withGeneral = true } = {}) {
  const page = (PAGES[routeId] || (() => []))();
  return dedupe([...page, ...(withGeneral ? EVERYWHERE() : [])].filter(allowed));
}

/** Just the questions, for the one-line hint under a page title. */
export function questionsFor(routeId, n = 2) {
  return actionsFor(routeId, { withGeneral: false }).filter(a => a.kind === 'ask').slice(0, n).map(a => a.q);
}

/* ------------------------------------------------------------------ home
   The deck on the front door: verbs, not places. Each one is either a tool
   this person can open or something Vanessa can already do for them, and
   the order puts what is waiting first. */
export function homeActions({ toursToday = null } = {}) {
  const claimed = myClaimed();
  const open = openCount();
  const deck = [
    claimed.length && { kind: 'ask', q: 'Help me write an eval', label: 'Complete an evaluation', icon: 'evals', needs: 'training', weight: 3,
      sub: `${plural(claimed.length, 'eval')} you have claimed` },
    { kind: 'go', to: 'evals', label: claimed.length ? 'Open the Eval Tracker' : 'Claim an evaluation', icon: 'evals', weight: 2,
      sub: open ? `${open} guide${open === 1 ? '' : 's'} up for grabs` : 'Claim, schedule and submit' },
    { kind: 'go', to: 'schedule', label: "Check today's tours", icon: 'schedule', weight: 2,
      sub: toursToday == null ? 'Who is leading, and when'
         : toursToday ? `${plural(toursToday, 'tour')} on today` : 'No tours on today' },
    { kind: 'go', to: 'interviews', label: 'Run interviews', icon: 'interviews', weight: 2, sub: 'Check-in, grading and results' },
    { kind: 'ask', q: 'Who is worth discussing?', label: 'Who is worth discussing?', icon: 'spark', needs: 'recruitment', weight: 1 },
    { kind: 'go', to: 'training', label: 'View attendance', icon: 'training', weight: 2, sub: 'Training, makeups and absences' },
    { kind: 'ask', q: 'Who owes a makeup?', label: 'Who owes a makeup?', icon: 'spark', needs: 'admin', weight: 1 },
    { kind: 'ask', q: 'Which desk slots are uncovered?', label: 'Find desk gaps', icon: 'desks', needs: 'training', weight: 1 },
    { kind: 'go', to: 'announcements', label: 'Read announcements', icon: 'announcements', weight: 1, sub: 'Notices for the committee' },
    { kind: 'go', to: 'people', label: 'Manage people & access', icon: 'people', weight: 1 },
    { kind: 'go', to: 'health', label: 'Check data health', icon: 'health', weight: 1 },
    { kind: 'ask', q: 'What should I wear on tour?', label: 'Handbook questions', icon: 'spark', weight: 0, sub: 'Dress code, strikes, absences' }
  ];
  return dedupe(deck.filter(allowed));
}
