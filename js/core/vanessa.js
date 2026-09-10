/* ============================================================ Vanessa
   Answers questions, counts things up, flags candidates worth discussing and
   jumps you to the right tab.

   Two rules this is built on:

   1. Every answer is computed, never generated. The numbers come out of the
      same data the screens render, so they cannot be subtly wrong. There is no
      model here, which also means she works on every phone with no key, no
      cost and no server.

   2. She reads ONLY what is already in memory, and never makes her own request.
      The database already withholds what you are not allowed to see, so
      whatever reached this browser is what you were entitled to. Asking again
      on her own could quietly widen that; reading what is here cannot.
============================================================================ */
import { TOPICS } from './vanessa-knowledge.js';
import { state, myName, isAdmin, inTraining, inRecruitment } from './state.js';
import { esc } from './ui.js';

/* --------------------------------------------------------------- matching
   People do not type the phrase you thought of. "who hasnt been graded",
   "whos ungraded", "nobody graded these yet" are all the same question, so
   matching is done on stemmed words with a tolerance for one typo rather than
   on exact phrases.
-------------------------------------------------------------------------- */

const STOP = new Set(['the','a','an','is','are','was','were','do','does','did','can','i','me','my',
                      'we','our','you','your','of','for','to','in','on','at','and','or','it','that',
                      'this','there','what','which','how','many','much','please','tell','show','give']);

/** "graded", "grading", "grades" -> "grade" */
function stem(w) {
  for (const end of ['ings','ing','ers','er','ies','ied','es','ed','s']) {
    if (w.length > end.length + 2 && w.endsWith(end)) {
      let base = w.slice(0, -end.length);
      if (end === 'ies') base += 'y';
      return base;
    }
  }
  return w;
}

function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** One typo apart, for words long enough that a typo is likelier than a coincidence. */
function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/** Does the question contain any of these ideas? Typos and word endings allowed. */
function has(q, ...phrases) {
  const ws = tokens(q);
  const raw = String(q || '').toLowerCase();
  return phrases.some(p => {
    if (raw.includes(p)) return true;
    const parts = tokens(p);
    return parts.length > 0 && parts.every(part => ws.some(w => w === part || near(w, part)));
  });
}

function topicFor(q) {
  const ws = tokens(q);
  let best = null, bestScore = 0;
  for (const t of TOPICS) {
    let score = 0;
    for (const k of t.k) {
      if (String(q).toLowerCase().includes(k)) { score += k.split(' ').length * 2; continue; }
      const parts = tokens(k);
      if (parts.length && parts.every(part => ws.some(w => w === part || near(w, part)))) score += parts.length;
    }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 2 ? best : null;
}

/* ------------------------------------------------------------ eval answers */

function evalAnswers(q) {
  const g = state.guides || [];
  if (!g.length || !inTraining()) return null;

  const mine = g.filter(x => x.evaluatorId === state.me?.id);

  const firstPerson = /\bmy\b|\bmine\b|\bi(?:'ve| have)? claimed\b/i.test(q);
  if (firstPerson && has(q, 'eval', 'guide', 'claim', 'assigned', 'doing')) {
    const open = mine.filter(x => x.status === 'claimed');
    if (!mine.length) return 'You have not claimed anybody yet. The Available tab on Eval Tracker has ' +
      g.filter(x => x.status === 'open').length + ' guides up for grabs.';
    const undated = open.filter(x => !x.date);
    return `You have ${open.length} claimed and not yet submitted:\n` +
      open.map(x => `- ${x.name}${x.date ? ` — ${x.date}` : ' — no tour date yet'}`).join('\n') +
      (undated.length ? `\n\n${undated.length} of them still need a tour date.` : '');
  }

  if (has(q, 'need an eval', 'needs eval', 'still need', 'unclaimed', 'up for grabs',
             'available', 'nobody claimed', 'not claimed', 'hasnt been claimed',
             'no evaluator', 'without an evaluator', 'left to claim')) {
    const open = g.filter(x => x.status === 'open');
    const top = open.filter(x => x.rank <= 2);
    return `${open.length} guides are unclaimed.` +
      (top.length ? ` ${top.length} of them are first or second priority:\n` +
        top.slice(0, 10).map(x => `- ${x.name} (${x.priority})`).join('\n') +
        (top.length > 10 ? `\n…and ${top.length - 10} more.` : '') : '');
  }

  if (has(q, 'no tour', 'without a tour', 'not scheduled', 'no date')) {
    const none = g.filter(x => !x.skip && !x.tours.length);
    return `${none.length} guides who need an eval have no scheduled tours to pick from, so they have to be scheduled by hand:\n` +
      none.slice(0, 12).map(x => `- ${x.name}`).join('\n') + (none.length > 12 ? `\n…and ${none.length - 12} more.` : '');
  }

  if (has(q, 'progress', 'how far', 'evals done', 'evals submitted', 'left to do')) {
    const c = state.counts || {};
    const done = (c.submitted || 0) + (c.reviewed || 0);
    return `${done} of ${state.neededTotal} evals are submitted. ` +
      `${c.open || 0} unclaimed, ${c.claimed || 0} claimed and in progress, ${c.skip || 0} not needed this term.`;
  }
  return null;
}

/* ------------------------------------------------- interview answers ------ */

let interviewData = null;
const shared = { tours: null, desks: null };
export function shareInterviews(d) { interviewData = d; }
export function shareOther(kind, rows) { shared[kind] = rows; }

/**
 * How much the raters disagreed, and whether that is worth the room's time.
 *
 * This deliberately never says "hire" or "do not hire". A threshold on an
 * average is not a recommendation, but phrased as one it arrives in the room
 * before anybody has spoken and quietly shifts who has to justify themselves.
 * What a human genuinely cannot see at a glance is DISAGREEMENT — so that is
 * what gets flagged, with the reason attached.
 */
function discussionFlags(cands) {
  const graded = cands.filter(c => c.raters > 0);
  if (!graded.length) return [];
  const panel = Math.max(...graded.map(c => c.raters));

  return graded.map(c => {
    const why = [];
    if (c.spread !== null && c.spread >= 1.5) why.push(`raters disagreed by ${c.spread.toFixed(1)} points`);
    if (c.raters <= Math.max(2, Math.floor(panel / 2))) why.push(`only ${c.raters} of ${panel} scored them`);
    if (!c.decision) why.push('no decision recorded');
    return { c, why };
  }).filter(x => x.why.length >= (x.c.spread >= 1.5 ? 1 : 2))
    .sort((a, b) => (b.c.spread ?? 0) - (a.c.spread ?? 0));
}

function interviewAnswers(q) {
  const d = interviewData;
  if (!d || !inRecruitment()) return null;
  const cands = d.candidates || [];
  if (!cands.length) return null;

  if (has(q, 'discuss', 'talk about', 'disagree', 'split', 'contentious', 'worth')) {
    const flags = discussionFlags(cands).slice(0, 8);
    if (!flags.length) return 'Nothing stands out — the panel broadly agreed on everybody who has been scored.';
    return `${flags.length} worth talking about:\n` +
      flags.map(f => `- ${f.c.name} — ${f.c.final !== null ? f.c.final.toFixed(2) : 'no score'}: ${f.why.join(', ')}`).join('\n');
  }

  if (has(q, 'ungraded', 'not graded', 'nobody scored', 'no scores', 'still need grading',
             'hasnt been graded', 'havent been graded', 'has not been graded',
             'nobody graded', 'no one graded', 'not been scored', 'without scores',
             'still ungraded', 'yet to be graded', 'needs grading')) {
    const none = cands.filter(c => c.raters === 0);
    return none.length
      ? `${none.length} candidates have no scores at all:\n` + none.slice(0, 12).map(c => `- ${c.name}`).join('\n')
      : 'Everybody has been scored by at least one person.';
  }

  if (has(q, 'undecided', 'no decision', 'still deciding')) {
    const un = cands.filter(c => !c.decision);
    return `${un.length} candidates have no decision recorded. ` +
      `So far: ${cands.filter(c => c.decision === 'Yes').length} yes, ` +
      `${cands.filter(c => c.decision === 'Maybe').length} maybe, ` +
      `${cands.filter(c => c.decision === 'No').length} no.`;
  }

  if (has(q, 'top', 'highest', 'best', 'strongest', 'top scorer', 'ranked')) {
    const top = cands.filter(c => c.final !== null).sort((a, b) => b.final - a.final).slice(0, 8);
    return 'Highest scoring so far:\n' + top.map(c =>
      `- ${c.name} — ${c.final.toFixed(2)} from ${c.raters} raters` +
      (c.spread >= 1.5 ? ` (but they disagreed by ${c.spread.toFixed(1)})` : '')).join('\n');
  }

  if (has(q, 'checked in', 'check in', 'arrived', 'here')) {
    const inn = cands.filter(c => c.checkin === 'Yes').length;
    return `${inn} of ${cands.length} candidates are checked in.`;
  }

  const named = cands.find(c => q.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]) &&
                                q.toLowerCase().includes(c.name.toLowerCase().split(' ').pop()));
  if (named) {
    const f = discussionFlags([named])[0];
    return `${named.name} — ${named.final !== null ? named.final.toFixed(2) : 'not scored yet'}` +
      (named.raters ? ` from ${named.raters} raters` : '') +
      (named.group ? `, group ${named.group}` : '') +
      (named.decision ? `. Decision: ${named.decision}.` : '. No decision yet.') +
      (f ? `\n\nWorth noting: ${f.why.join(', ')}.` : '');
  }
  return null;
}

/* --------------------------------------------------- a particular guide ---
   "who is evaluating Noah Cash", "when is Ella leading a tour". Matched on any
   part of the name so a first name alone is enough, and it refuses to answer
   when two guides fit rather than picking one.
-------------------------------------------------------------------------- */

const prettyDay = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
const prettyClock = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return t || '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
};

function findPeople(q, list, nameOf) {
  const ws = tokens(q);
  const hits = list.filter(p => {
    const parts = tokens(nameOf(p));
    return parts.some(part => ws.some(w => w === part || near(w, part)));
  });
  return hits;
}

function guideAnswers(q) {
  const g = state.guides || [];
  if (!g.length || !inTraining()) return null;
  if (!has(q, 'who', 'when', 'evaluat', 'claim', 'tour', 'lead')) return null;

  const hits = findPeople(q, g, x => x.name);
  if (hits.length !== 1) return hits.length > 1
    ? `More than one guide matches that — did you mean ${hits.slice(0, 4).map(x => x.name).join(', ')}?`
    : null;

  const x = hits[0];
  const bits = [`${x.name} — ${x.priority || 'no priority set'}.`];
  if (x.skip) bits.push('Marked as not needing an eval this term.');
  else if (x.status === 'open') bits.push('Nobody has claimed them yet.');
  else if (x.evaluator) bits.push(
    `${x.evaluatorId === state.me?.id ? 'You are' : x.evaluator + ' is'} evaluating them` +
    (x.date ? `, on ${prettyDay(x.date)}${x.time ? ' at ' + prettyClock(x.time) : ''}.` : ', no tour date set yet.') +
    (x.status === 'submitted' ? ' Eval submitted.' : x.status === 'reviewed' ? ' Eval submitted and reviewed.' : ''));

  if (x.tours && x.tours.length) {
    const next = x.tours.slice(0, 3);
    bits.push(`\nUpcoming tours:\n` + next.map(t => `- ${prettyDay(t.date)} at ${prettyClock(t.start)}`).join('\n') +
      (x.tours.length > 3 ? `\n…and ${x.tours.length - 3} more.` : ''));
  } else if (!x.skip) {
    bits.push('\nNo scheduled tours to pick from, so their eval has to be dated by hand.');
  }
  return bits.join(' ');
}

/* ------------------------------------------------------- tours and desks --- */

function scheduleAnswers(q) {
  const tours = shared.tours;
  if (!tours || !tours.length) return null;

  // "when is Noah Cash leading a tour" is a question about Noah, not about
  // today, so step aside and let the guide answer take it.
  if ((state.guides || []).length &&
      findPeople(q, state.guides, x => x.name).length === 1) return null;

  if (has(q, 'tomorrow', 'today', 'this week', 'tours on', 'leading today', 'who is leading')) {
    const today = new Date();
    if (has(q, 'tomorrow')) today.setDate(today.getDate() + 1);
    const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const day = tours.filter(t => t.date === iso);
    if (!day.length) return `No tours ${has(q,'tomorrow') ? 'tomorrow' : 'today'} (${prettyDay(iso)}).`;
    const bySlot = {};
    day.forEach(t => (bySlot[t.slot] ||= []).push(t.guide));
    return `${day.length} guides leading on ${prettyDay(iso)}:\n` +
      Object.entries(bySlot).map(([slot, who]) => `- ${slot}: ${who.join(', ')}`).join('\n');
  }
  return null;
}

function deskAnswers(q) {
  const desks = shared.desks;
  if (!desks || !desks.length) return null;
  if (!has(q, 'desk', 'welcome desk', 'front desk', 'cover', 'uncovered', 'gap')) return null;

  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const day = DAYS.find(d => q.toLowerCase().includes(d.toLowerCase()));
  const which = /welcome/i.test(q) ? 'Welcome Desk' : /front/i.test(q) ? 'Front Desk' : null;

  if (has(q, 'uncovered', 'gap', 'nobody', 'empty', 'missing')) {
    const slots = [...new Set(desks.map(d => `${d.desk}|${d.slot}`))];
    const gaps = [];
    slots.forEach(key => {
      const [dk, slot] = key.split('|');
      DAYS.forEach(d => {
        if (!desks.some(x => x.desk === dk && x.slot === slot && x.day === d)) gaps.push(`${dk}, ${d} ${slot}`);
      });
    });
    return gaps.length
      ? `${gaps.length} uncovered desk slots:\n` + gaps.slice(0, 12).map(g => `- ${g}`).join('\n') +
        (gaps.length > 12 ? `\n…and ${gaps.length - 12} more.` : '')
      : 'Every desk slot is covered this week.';
  }

  let rows = desks;
  if (day) rows = rows.filter(r => r.day === day);
  if (which) rows = rows.filter(r => r.desk === which);
  if (!rows.length) return `Nobody is on the ${which || 'desk'}${day ? ' on ' + day : ''}.`;
  const bySlot = {};
  rows.forEach(r => (bySlot[`${r.desk} ${r.slot}`] ||= []).push(r.person));
  return `${which || 'Desk'} cover${day ? ' on ' + day : ''}:\n` +
    Object.entries(bySlot).slice(0, 14).map(([k, who]) => `- ${k}: ${who.join(', ')}`).join('\n');
}

/* ------------------------------------------------------------- navigation */

const DESTINATIONS = [
  { to: 'evals',         k: ['eval tracker', 'evals', 'eval', 'roster', 'claim'] },
  { to: 'interviews',    k: ['interview', 'grading', 'grade', 'candidate', 'check in', 'decisions'] },
  { to: 'schedule',      k: ['schedule', 'tours', 'tour schedule'] },
  { to: 'desks',         k: ['desk', 'desks', 'coverage'] },
  { to: 'directory',     k: ['directory', 'guide list', 'guides'] },
  { to: 'announcements', k: ['announcement', 'announcements', 'notices'] }
];

function navigation(q) {
  if (!has(q, 'show', 'open', 'go to', 'take me', 'jump')) return null;
  for (const d of DESTINATIONS) {
    if (d.k.some(k => q.toLowerCase().includes(k))) {
      return { go: d.to, say: `Opening ${d.to === 'evals' ? 'Eval Tracker' : d.to}.` };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ ask */

export function ask(question) {
  const q = String(question || '').trim();
  if (!q) return { text: 'Ask me anything about the hub.' };

  const nav = navigation(q);
  if (nav) return { text: nav.say, go: nav.go };

  // "How do I claim someone" wants the instructions, not a list of what you have
  // claimed. A how-to phrasing goes to the written answers first.
  if (/\b(how (do|can|would|should) (i|we|you)|how to|what happens (if|when)|why (can|cant|can't))\b/i.test(q)) {
    const t = topicFor(q);
    if (t) return { text: t.a };
  }

  // Interview wording wins the tie. "How many are undecided" is about candidates,
  // but a generic eval matcher used to grab it on the way past.
  const interviewy = has(q, 'candidate', 'interview', 'undecided', 'decision', 'graded',
                            'grading', 'rater', 'checked in', 'discuss', 'top ', 'highest');
  // Naming exactly one person makes it a question about them, whatever other
  // words happen to be in it. "When is Noah Cash LEADING a tour" otherwise
  // collided with the word "leader" and came back with the top scorers.
  const namesOne = (state.guides || []).length &&
                   findPeople(q, state.guides, x => x.name).length === 1;

  const answer = deskAnswers(q)
    || scheduleAnswers(q)
    || (namesOne ? guideAnswers(q) : null)
    || (interviewy ? (interviewAnswers(q) || evalAnswers(q))
                   : (evalAnswers(q) || interviewAnswers(q)))
    || guideAnswers(q);
  if (answer) return { text: answer };

  const topic = topicFor(q);
  if (topic) return { text: topic.a };

  return { text: "I did not follow that. I can tell you who still needs an eval, who is worth discussing, " +
                 "how the scoring works, or take you to a tab — try \"who still needs an eval\" or \"open interviews\"." };
}

export const greeting = () => `Hi ${myName().split(' ')[0] || 'there'}, I'm Vanessa. How can I help?`;
