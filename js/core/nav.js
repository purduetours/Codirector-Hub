/* ============================================================ navigation model
   One description of how the hub is organised, read by the sidebar, the phone
   dock, the hub pages and the command palette — so they cannot disagree.

   The hub used to put every tool in the sidebar. Now a handful of areas
   (hubs) own the tools, and what each person sees is derived from what their
   role can already open:

     Home     everyone      what needs you today, and Vanessa
     Tours    everyone      schedule, desk coverage
     Team     everyone      announcements, evaluations, directory, interviews, training
     Admin    codirectors   access, data health, end of semester
     More     everyone      profile, appearance, help

   Permissions are not decided here. A tool carries its own `needs`, the router
   refuses to mount a tool the role cannot open, and the database refuses the
   data regardless. This file only decides where things are SHOWN.
============================================================================ */
import { has } from './state.js';
import { iconFor, ICONS } from './icons.js';

export const HUBS = [
  { id: 'tours', title: 'Tours', icon: 'tours', crumb: 'Schedule and desk coverage',
    lede: 'Who is leading which tour, and who is on the desks.',
    children: ['schedule', 'desks'] },
  { id: 'team', title: 'Team', icon: 'team', crumb: 'News, evaluations and the people behind them',
    lede: 'Notices, evaluations, the guide directory and recruitment.',
    children: ['announcements', 'evals', 'directory', 'interviews', 'training'] },
  { id: 'admin', title: 'Admin', icon: 'admin', needs: 'admin', crumb: 'People, guides, semesters and settings',
    lede: 'Everything needed to run the program, with no database work. Nobody else sees this area.',
    children: ['people', 'guides', 'evalroster', 'semester', 'sources', 'reconcile', 'datarules', 'audit', 'settings', 'health'],
    groups: [
      { title: 'Run the program', children: ['people', 'guides', 'evalroster', 'semester'] },
      { title: 'Data & spreadsheets', children: ['sources', 'reconcile', 'datarules'] },
      { title: 'Records and settings', children: ['audit', 'settings'] },
      { title: 'Check the setup', children: ['health'] }
    ],
    advanced: 'Database setup, email-provider keys, deployments and recovery are not part of day-to-day running. They are covered in DEVELOPERS.md and are the only things that need a developer.' },
  { id: 'actions', title: 'Action Center', icon: 'bell', crumb: 'Everything that needs you', always: true, nav: false },
  { id: 'more', title: 'More', icon: 'more', crumb: 'Profile, appearance and help', always: true }
];

export const hubById = id => HUBS.find(h => h.id === id);

/** Which hub a tool lives under, so its page can say "← Team" and light the right nav item. */
export const parentHubOf = modId => HUBS.find(h => h.children?.includes(modId));

/* Things that are not pages: they do something. Used as hub cards, palette
   entries and the "+" menu. `quick` ones appear in the "+" menu. `run` is
   defined where it can reach the code that does the work (palette.js). */
export const ACTIONS = [
  { id: 'announce', title: 'Post an announcement', hint: 'Write a notice for the committee', needs: 'admin', quick: true,
    icon: 'announcements', words: 'new notice message pin' },
  { id: 'add-person', title: 'Add a person', hint: 'Let someone sign in and pick their role', needs: 'admin', quick: true,
    icon: 'people', words: 'user invite account member' },
  { id: 'start-eval', title: 'Start an evaluation', hint: 'Vanessa walks you through it', needs: 'training', quick: true,
    icon: 'evals', words: 'evaluate eval claim feedback' },
  { id: 'attendance', title: 'Take training attendance', hint: 'Open the attendance grid', needs: 'admin', quick: true,
    icon: 'training', words: 'training session makeup absent' },
  { id: 'makeups', title: 'Draft makeup reminders', hint: 'Vanessa drafts them; nothing is sent', needs: 'admin', quick: true,
    icon: 'spark', words: 'makeup owe remind email' },
  { id: 'rollover', title: 'Start the next semester', hint: 'Guided: returning guides, leavers, training dates', needs: 'admin', quick: true,
    icon: 'rollover', words: 'rollover semester end of semester priority term new' },
  { id: 'add-guide', title: 'Add a guide', hint: 'Put a new tour guide on the roster', needs: 'admin', quick: true,
    icon: 'directory', words: 'guide roster new tour' },
  { id: 'import-roster', title: 'Import a roster from CSV', hint: 'Check it before anything is saved', needs: 'admin',
    icon: 'directory', words: 'csv upload spreadsheet guides people' },
  { id: 'brief', title: 'Brief me', hint: 'Ask Vanessa what needs attention', icon: 'spark', words: 'summary today vanessa' },
  { id: 'theme', title: 'Switch light / dark', hint: 'Appearance', icon: 'moon', words: 'theme dark light mode appearance' },
  { id: 'refresh', title: 'Refresh everything', hint: 'Reload the latest data', icon: 'refresh', words: 'reload sync update' },
  { id: 'signout', title: 'Sign out', hint: '', icon: 'signout', words: 'log out logout' }
];
export const actionById = id => ACTIONS.find(a => a.id === id);
export const visibleActions = () => ACTIONS.filter(a => has(a.needs));

/* ---------------------------------------------------------------- derived */

/* Shorter names for the phone dock, where five labels share one row. */
const SHORT = { schedule: 'Schedule', announcements: 'News' };

/** The tools in a hub that this role may open, in the hub's order. */
export function hubChildren(hub, mods) {
  const byId = new Map(mods.map(m => [m.id, m]));
  return (hub.children || []).map(id => byId.get(id)).filter(Boolean);
}

export const hubActions = hub => (hub.actions || []).map(actionById).filter(a => a && has(a.needs));

export const hubVisible = (hub, mods) =>
  hub.always || (has(hub.needs) && (hubChildren(hub, mods).length > 0 || hubActions(hub).length > 0));

/**
 * The primary navigation for the signed-in role.
 *
 * A hub that would hold exactly one tool collapses into that tool's own
 * entry — a Tour Guide sees "Announcements", not a "Team" area with one card
 * in it. Each entry says which routes it owns, so the sidebar can keep it lit
 * while somebody is inside any of its pages.
 *
 * @param mods  the tools visibleModules() allows for this role
 */
export function primaryNav(mods, homeId = 'today') {
  const home = mods.find(m => m.id === homeId);
  const out = [];
  if (home) out.push({ id: home.id, title: 'Home', icon: ICONS.today, owns: [home.id] });

  for (const hub of HUBS) {
    if (hub.nav === false || !hubVisible(hub, mods)) continue;
    const kids = hubChildren(hub, mods);
    if (hub.always || kids.length !== 1 || hubActions(hub).length) {
      out.push({ id: hub.id, title: hub.title, icon: ICONS[hub.icon] || ICONS.menu, owns: [hub.id, ...kids.map(k => k.id)], hub: true });
    } else {
      const only = kids[0];
      out.push({ id: only.id, title: only.title, short: SHORT[only.id], icon: iconFor(only), owns: [hub.id, only.id] });
    }
  }
  return out;
}

/** Tools the person can open that are in no hub (a safety net for modules added later). */
export function orphans(mods, homeId = 'today') {
  const homed = new Set(HUBS.flatMap(h => h.children || []));
  return mods.filter(m => m.id !== homeId && !homed.has(m.id));
}
