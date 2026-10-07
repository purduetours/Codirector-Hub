/* ============================================================ Vanessa, helping run the program
   Administrative requests in plain words — "deactivate John", "bring back Ella",
   "add Alex Kim, alex@purdue.edu as Training Committee", "what is overdue?".

   The rules she follows here are the same ones the screens follow, because she
   uses the same functions:

   · She never touches the database herself. A write goes through the very
     admin_* functions the People and Guides screens call (see
     supabase/18-admin-operations.sql), which check the caller is an
     administrator, refuse to remove the last one, protect your own account and
     write to the audit log. If she asked for something those functions refuse,
     she says what they said.
   · Only administrators are offered any of it, and the check is made here
     before she even looks anybody up — not just when the button is pressed.
   · Every write is a question first. She names exactly who, says what will be
     kept (their records are never deleted), and waits for a yes.
   · Admin can switch her admin actions off in Settings (vanessa.adminActions).
============================================================================ */
import { state, isAdmin, inTraining, setting } from './state.js';
import { select } from './db.js';
import { admin } from '../modules/admin-kit.js';
import { getActions, LEVELS, refreshActions } from './actioncenter.js';
import { matchingNames } from './vanessa-makeup.js';
import { go, denied } from './vanessa-exec.js';
import { runAction } from './actions.js';
import { nameKey } from './identity.js';
import { priorityBand } from './evalmatch.js';
import { prettyDate, prettyTime } from './ui.js';

const reply = text => ({ type: 'reply', text });
const allowed = () => isAdmin() && setting('vanessa.adminActions', true) !== false;

const ARCHIVE = /^(?:please\s+)?(?:deactivate|archive|offboard|remove access (?:for|from)|take (?:away )?access (?:from|away from)|remove)\s+(.+?)[.!?]*$/i;
const RESTORE = /^(?:please\s+)?(?:restore|reactivate|bring back|re-?add)\s+(.+?)[.!?]*$/i;
const ADD     = /^(?:please\s+)?add\s+(guide\s+)?(.+?)(?:\s*[,;]\s*|\s+)([^\s@,;]+@[^\s@,;]+)(?:\s+as\s+(?:a\s+|an\s+)?(.+?))?[.!?]*$/i;
const ADD_BARE = /^(?:please\s+)?add\s+(?:a\s+|the\s+)?(?:guide\s+|person\s+|someone\s+)?(.+?)\s+to\s+(?:the\s+)?(?:\w+\s+)?(?:roster|team|committee|hub)[.!?]*$/i;
const NEEDS = /\b(?:what(?:'s| is| are)|show(?: me)?|list)\b.*\b(?:overdue|urgent|waiting on (?:me|you)|action center|needs? (?:my )?(?:attention|action))\b|\bwhat needs (?:my )?(?:attention|action)\b/i;
const COVERAGE = /\b(?:uncovered|coverage|desk gaps?|unstaffed)\b/i;
const TOP = /\b(?:highest|top|most urgent)[- ]priority\b.*\b(?:evaluations?|guides?)\b|\bwho (?:are|is) (?:the )?(?:highest|top)[- ]priority\b/i;
const ISSUES = /\b(?:unresolved|roster problems?|(?:don['’]?t|do not|doesn['’]?t) match (?:the )?schedule|not matched|missing from the (?:master )?(?:roster|list)|reconciliation)\b/i;
const PRIORITY = /^(?:please\s+)?(?:mark|set|make)\s+(.+?)\s+(?:as\s+|to\s+)?(high|normal|low)(?:[ -]priority)?[.!?]*$/i;
const MATCHTO = /^(?:please\s+)?match\s+(.+?)\s+(?:to|with|as)\s+(.+?)[.!?]*$/i;
const NEXTTOUR = /\bwhen(?:'s| is)\s+(.+?)(?:'s|’s)\s+next\s+tour\b|\bnext tour for\s+(.+?)[?.!]*$/i;
const BEHIND = /\bwho (?:has(?:n'?t| not)|have(?:n'?t| not)|is behind on|are behind on|hasn'?t finished)\b.*\btraining\b/i;

export function adminIntent(raw) {
  const q = String(raw || '').trim().replace(/^(?:hey[, ]+)?vanessa[, ]+/i, '');
  let t;
  if (TOP.test(q)) return { id: 'top_priority' };
  if (ISSUES.test(q)) return { id: 'issues' };
  if ((t = NEXTTOUR.exec(q))) return { id: 'next_tour', who: (t[1] || t[2]).trim() };
  if ((t = PRIORITY.exec(q))) return { id: 'priority', who: t[1].trim(), band: t[2].toLowerCase() };
  if ((t = MATCHTO.exec(q))) return { id: 'match', ext: t[1].trim(), who: t[2].trim() };
  if (BEHIND.test(q)) return { id: 'makeups' };
  if (NEEDS.test(q)) return { id: 'needs', overdue: /overdue/i.test(q) };
  if (COVERAGE.test(q) && /\b(?:desk|tour|week|friday|monday|tuesday|wednesday|thursday|schedule)\b/i.test(q)) return { id: 'coverage' };
  let m;
  if ((m = ADD.exec(q))) return { id: 'add', guide: !!m[1], name: m[2].trim(), email: m[3], role: (m[4] || '').trim() };
  if ((m = ADD_BARE.exec(q))) return { id: 'add_help', name: m[1].trim() };
  if ((m = RESTORE.exec(q))) return { id: 'restore', who: m[1].trim() };
  if ((m = ARCHIVE.exec(q)) && !/\b(?:eval|tour|claim|reminder|announcement)\b/i.test(m[1])) return { id: 'archive', who: m[1].trim() };
  return null;
}

/* ----------------------------------------------------------- finding people */
async function candidates(query, { active }) {
  const [people, guides] = await Promise.all([
    select('members', `select=id,full_name,email,role&active=eq.${active}`),
    select('guides', `select=id,full_name&active=eq.${active}`)
  ]);
  const out = [];
  matchingNames(query, people.map(p => p.full_name)).forEach(n => people.filter(p => p.full_name === n).forEach(p => out.push({ kind: 'person', name: n, email: p.email, role: p.role })));
  matchingNames(query, guides.map(g => g.full_name)).forEach(n => guides.filter(g => g.full_name === n).forEach(g => out.push({ kind: 'guide', name: n, id: g.id })));
  return out;
}

const label = c => (c.kind === 'person' ? `${c.name} · committee (${c.role || 'no role'})` : `${c.name} · tour guide`);

/** What is on file for them, so the question can say what will be KEPT. */
async function recordsOf(c) {
  try {
    if (c.kind === 'guide') {
      const [ev, tr] = await Promise.all([select('evals', `select=id&guide_id=eq.${c.id}`), select('training_attendance', `select=id&guide_id=eq.${c.id}`).catch(() => [])]);
      return `${c.name} has ${ev.length} evaluation record${ev.length === 1 ? '' : 's'} and ${tr.length} training record${tr.length === 1 ? '' : 's'}.`;
    }
  } catch { /* fall through to the generic sentence */ }
  return `${c.name} has records across the hub.`;
}

/* ------------------------------------------------------------------- writes */
async function archive(c) {
  const kept = await recordsOf(c);
  return {
    type: 'confirm', title: `Archive ${c.name}?`,
    text: `${kept} I can archive ${c.kind === 'guide' ? 'them' : 'their account'} so ${c.kind === 'guide' ? 'they leave the tracker and next semester' : 'they lose access'}, and every record stays exactly as it is. You can restore ${c.kind === 'guide' ? 'them' : 'them'} later.`,
    rows: [['Who', label(c)], ['What changes', c.kind === 'guide' ? 'Archived; off the tracker' : 'Access removed'], ['What is kept', 'All evaluations, scores and attendance']],
    confirm: { label: 'Archive', run: async () => {
      if (!allowed()) return denied();
      try {
        if (c.kind === 'guide') await admin('admin_set_guides_active', { p_ids: [c.id], p_active: false, p_reason: 'Archived via Vanessa' });
        else await admin('admin_archive_people', { p_emails: [c.email], p_reason: 'Archived via Vanessa' });
        refreshActions({ force: true });
        return { type: 'reply', kind: 'confirm', text: `Done — ${c.name} is archived. Their records are kept; say “restore ${c.name.split(' ')[0]}” to bring them back.` };
      } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; }
    } }, cancel: { label: 'Cancel' }
  };
}

async function restore(c) {
  return {
    type: 'confirm', title: `Restore ${c.name}?`, text: c.kind === 'guide' ? 'They go back on this semester’s tracker.' : 'They get their access back with the role they had.',
    rows: [['Who', label(c)]],
    confirm: { label: 'Restore', run: async () => {
      if (!allowed()) return denied();
      try {
        if (c.kind === 'guide') await admin('admin_set_guides_active', { p_ids: [c.id], p_active: true });
        else await admin('admin_restore_people', { p_emails: [c.email] });
        refreshActions({ force: true });
        return { type: 'reply', kind: 'confirm', text: `Done — ${c.name} is back.` };
      } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; }
    } }, cancel: { label: 'Cancel' }
  };
}

async function add(intent) {
  const parts = intent.name.split(/\s+/);
  if (intent.guide) {
    if (parts.length < 2) return reply('I need a first and last name for a guide — for example “add guide Alex Kim, alex@purdue.edu”.');
    return { type: 'confirm', title: `Add ${intent.name} as a guide?`, text: 'They go on this semester’s tracker at the first priority.',
      rows: [['Name', intent.name], ['Email', intent.email]],
      confirm: { label: 'Add guide', run: async () => {
        if (!allowed()) return denied();
        try { await admin('admin_save_guide', { p_id: null, p_first: parts[0], p_last: parts.slice(1).join(' '), p_email: intent.email, p_priority: null });
          refreshActions({ force: true }); return { type: 'reply', kind: 'confirm', text: `Done — ${intent.name} is on the roster.` };
        } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } };
  }
  const roles = await select('roles', 'select=name&order=sort_order.asc').catch(() => []);
  const role = roles.find(r => r.name.toLowerCase() === intent.role.toLowerCase())?.name
    || roles.find(r => intent.role && r.name.toLowerCase().includes(intent.role.toLowerCase()))?.name
    || (roles.find(r => /training/i.test(r.name))?.name) || roles[0]?.name;
  if (!role) return reply('I couldn’t load the list of roles. Try again, or use Admin → People.');
  return { type: 'confirm', title: `Invite ${intent.name}?`, text: 'They can then make a password on the sign-in page with this exact email and will land with this role.',
    rows: [['Name', intent.name], ['Email', intent.email], ['Role', role]],
    confirm: { label: 'Invite', run: async () => {
      if (!allowed()) return denied();
      try { await admin('admin_save_person', { p_email: intent.email, p_name: intent.name, p_role: role });
        refreshActions({ force: true }); return { type: 'reply', kind: 'confirm', text: `Done — ${intent.name} is invited as ${role}.` };
      } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } };
}

/* -------------------------------------------------------------------- reads */
async function needs({ overdue }) {
  await refreshActions();
  let list = getActions().filter(a => LEVELS[a.level].badge);
  if (overdue) list = list.filter(a => /overdue/i.test(a.title));
  return {
    type: 'summary', title: overdue ? 'What is overdue' : 'What needs your attention',
    text: list.length ? 'The same list as your Action Center, most pressing first.' : overdue ? 'Nothing is overdue right now.' : 'Nothing needs you right now.',
    items: list.slice(0, 8).map(a => ({ label: a.title, sub: a.detail || a.source, run: () => { location.hash = a.url || '#/actions'; return { type: 'reply', text: 'Opening it.' }; } })),
    actions: [go('actions', 'Open Action Center')], source: 'Action Center', at: new Date()
  };
}

async function coverage() {
  await refreshActions();
  const gap = getActions({ all: true }).find(a => a.id.startsWith('desk-gaps'));
  return gap
    ? { type: 'summary', title: 'Coverage', text: `${gap.title}. ${gap.detail}`, actions: [go('desks', 'Open Desk Coverage'), go('schedule', 'Open the tour schedule')], source: 'Desk coverage', at: new Date() }
    : reply('Every desk slot this week has someone down for it. The tour schedule itself is in Tours.');
}


/* ------------------------------------- canonical data: roster, priority, matches */
const rosterNames = () => (state.guides || []).map(g => g.name);

async function topPriority() {
  if (!inTraining() && !isAdmin()) return denied();
  const open = (state.guides || []).filter(g => g.status === 'open').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));
  const high = open.filter(g => (g.rank ?? 99) <= 2);
  return { type: 'summary', title: 'Highest-priority evaluations', text: high.length ? `${high.length} guide${high.length === 1 ? '' : 's'} at High priority still need an evaluator.` : 'Nobody at High priority is waiting for an evaluator.',
    items: (high.length ? high : open.slice(0, 6)).slice(0, 10).map(g => ({ label: g.name, sub: `${g.priority} · ${g.tours?.[0] ? `next tour ${prettyDate(g.tours[0].date)}` : 'no upcoming tour found'}` })),
    actions: [go('evalroster', 'Open the Evaluation Roster')], source: 'Evaluation roster', at: new Date() };
}

async function issuesSummary() {
  if (!isAdmin()) return denied();
  let rows;
  try { rows = await select('sync_issues', 'select=kind,external_name&status=eq.open&limit=200'); }
  catch { return { type: 'reply', kind: 'alert', text: 'I couldn’t load the reconciliation list. The data tools may not be set up yet — see Health.' }; }
  const by = {}; rows.forEach(r => { (by[r.kind] ||= []).push(r.external_name); });
  const label = { unmatched_person: 'People in a sheet not on your list', schedule_unmatched: 'Schedule names not matched', roster_missing_in_source: 'On your list, missing from the sheet', conflicting_major: 'Conflicting majors', conflicting_email: 'Conflicting emails' };
  return { type: 'summary', title: 'Unresolved roster problems', text: rows.length ? 'Nothing changes until you choose; each has options in Reconciliation.' : 'Nothing is waiting. The roster, schedule and sheets line up.',
    rows: Object.entries(by).map(([k, v]) => [label[k] || k, `${v.length}: ${v.slice(0, 4).join(', ')}${v.length > 4 ? '…' : ''}`]), actions: [go('reconcile', 'Open Reconciliation')], source: 'Reconciliation', at: new Date() };
}

async function nextTour(who) {
  if (!inTraining() && !isAdmin()) return denied();
  const hits = matchingNames(who, rosterNames());
  if (!hits.length) return reply(`I couldn’t find “${who}” on the roster.`);
  const g = state.guides.find(x => x.name === hits[0]);
  const t = (g.tours || [])[0];
  return reply(t ? `${g.name}’s next tour is ${prettyDate(t.date)}${t.start ? ` at ${prettyTime(t.start)}` : ''}${hits.length > 1 ? ` (I picked ${g.name}; there were ${hits.length} close matches)` : ''}.` : `${g.name} has no upcoming tour in the connected schedule.`);
}

async function setPriority(who, band) {
  if (!isAdmin()) return denied();
  if (setting('vanessa.adminActions', true) === false) return reply('Administrative actions through me are switched off in Settings.');
  const hits = matchingNames(who, rosterNames());
  if (!hits.length) return reply(`I couldn’t find “${who}” on the evaluation roster.`);
  const pick = async name => {
    const g = state.guides.find(x => x.name === name);
    const tiers = (await select('priorities', 'select=name,sort_order,needs_eval&order=sort_order.asc')).filter(p => p.needs_eval);
    const tier = band === 'high' ? tiers[0] : band === 'low' ? tiers[tiers.length - 1] : tiers[Math.min(2, tiers.length - 1)];
    return { type: 'confirm', title: `Mark ${g.name} as ${band} priority?`, text: `This sets their evaluation priority to “${tier.name}”. Priority is always set by hand, so no spreadsheet will change it.`,
      rows: [['Tour Guide', g.name], ['Now', g.priority || '—'], ['New', `${tier.name} (${priorityBand(tier.sort_order)})`]],
      confirm: { label: 'Set priority', run: async () => {
        if (!allowed()) return denied();
        try { await admin('admin_set_eval_priority', { p_guide_ids: [g.guideId], p_priority: tier.name }); refreshActions({ force: true });
          return { type: 'reply', kind: 'confirm', text: `Done — ${g.name} is now ${band} priority.` };
        } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } };
  };
  if (hits.length > 1) return { type: 'select', title: 'Which one do you mean?', options: hits.map(n => ({ label: n, run: () => pick(n) })) };
  return pick(hits[0]);
}

async function matchTo(ext, who) {
  if (!isAdmin()) return denied();
  if (setting('vanessa.adminActions', true) === false) return reply('Administrative actions through me are switched off in Settings.');
  const gs = await select('guides', 'select=id,full_name&active=eq.true');
  const hits = matchingNames(who, gs.map(g => g.full_name));
  if (!hits.length) return reply(`I couldn’t find a Tour Guide called “${who}”. Try their full name as it is on the master list.`);
  const g = gs.find(x => x.full_name === hits[0]);
  const go1 = g1 => ({ type: 'confirm', title: `Treat “${ext}” as ${g1.full_name}?`, text: 'Wherever “' + ext + '” appears in a connected spreadsheet it will be recognised as this person, and the Hub will remember it.',
    rows: [['Spelling', ext], ['Is', g1.full_name]],
    confirm: { label: 'Match and remember', run: async () => {
      if (!allowed()) return denied();
      try { await admin('admin_confirm_match', { p_kind: 'tour_schedule', p_key: nameKey(ext), p_guide: g1.id, p_name: ext, p_email: null }); refreshActions({ force: true });
        return { type: 'reply', kind: 'confirm', text: `Done — “${ext}” is now ${g1.full_name}.` };
      } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } });
  if (hits.length > 1) return { type: 'select', title: 'Which one do you mean?', options: hits.map(n => ({ label: n, run: () => go1(gs.find(x => x.full_name === n)) })) };
  return go1(g);
}

/* ------------------------------------------------------------------ router */
export async function runAdmin(intent) {
  if (intent.id === 'top_priority') return topPriority();
  if (intent.id === 'next_tour') return nextTour(intent.who);
  if (intent.id === 'issues') return issuesSummary();
  if (intent.id === 'priority') return setPriority(intent.who, intent.band);
  if (intent.id === 'match') return matchTo(intent.ext, intent.who);
  if (intent.id === 'makeups' || intent.id === 'needs' || intent.id === 'coverage') {
    if (intent.id === 'makeups' && !isAdmin()) return denied();
    return intent.id === 'needs' ? needs(intent) : intent.id === 'coverage' ? coverage() : { run: 'makeups' };
  }
  if (!isAdmin()) return denied();
  if (setting('vanessa.adminActions', true) === false) return reply('Administrative actions through me are switched off in Settings. You can do this from Admin → People or Guides.');
  if (intent.id === 'add') return add(intent);
  if (intent.id === 'add_help') return { type: 'reply', text: `To invite ${intent.name} I need their Purdue email and role — for example “add ${intent.name}, name@purdue.edu as Training Committee”. Or use the form.`,
    actions: [{ label: 'Open Add person', run: () => { runAction('add-person'); return { type: 'reply', text: 'Opening the form.' }; } }] };

  const restoring = intent.id === 'restore';
  let found;
  try { found = await candidates(intent.who, { active: !restoring }); }
  catch { return { type: 'reply', kind: 'alert', text: 'I couldn’t look people up just now. Try again in a moment.' }; }
  if (!found.length) return reply(`I couldn’t find ${restoring ? 'an archived' : 'an active'} person called “${intent.who}”. Try their full name as it appears in the hub.`);
  const act = restoring ? restore : archive;
  if (found.length > 1) return { type: 'select', title: 'Which one do you mean?', options: found.map(c => ({ label: label(c), run: () => act(c) })) };
  return act(found[0]);
}
