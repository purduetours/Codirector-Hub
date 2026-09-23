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
import { smallTalk, smallTalkStrong, peel } from './vanessa-chat.js';
import { HANDBOOK } from './vanessa-handbook.js';
import { state, myName, isAdmin, inTraining, inRecruitment } from './state.js';
import { esc, todayISO } from './ui.js';
import { taskSummary } from './vanessa-tasks.js';
import { matchEvalTours } from './vanessa-tour-match.js';
import { dateRange, dayISO, DAY_NAMES } from './vanessa-dates.js';

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
  // Keep phrase words, including prepositions and negation. "tours on" must
  // never collapse to "tour" and claim every question mentioning a tour.
  const words = text => String(text || '').toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || [];
  const ws = words(q);
  return phrases.some(p => {
    const parts = words(p);
    return parts.length && ws.some((_, i) => parts.every((part, j) => {
      const w = ws[i+j];
      return w && (w === part || stem(w) === stem(part) || near(w, part));
    }));
  });
}

function topicMatch(q) {
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
  return { topic: bestScore >= 2 ? best : null, score: bestScore };
}
const topicFor = q => topicMatch(q).topic;

/* ------------------------------------------------------------ eval answers */

function evalAnswers(q) {
  const g = state.guides || [];
  if (!inTraining()) return null;

  if (!state.loadedAt && !g.length) return has(q, 'eval', 'evals', 'claimed') ? 'Evaluations have not loaded yet. Try Refresh.' : null;
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

  if (has(q, 'need an eval', 'needs eval', 'unclaimed', 'up for grabs',
             'available', 'nobody claimed', 'not claimed', 'hasnt been claimed',
             'no evaluator', 'without an evaluator', 'left to claim', 'who needs an eval', 'who still needs an eval')) {
    const open = g.filter(x => x.status === 'open');
    const top = open.filter(x => x.rank <= 2);
    remember(open.filter(x => x.rank <= 2).map(x => x.name));
    return `${open.length} guide${open.length === 1 ? ' is' : 's are'} unclaimed.` +
      (top.length ? ` ${top.length} of them are first or second priority:\n` +
        top.slice(0, 10).map(x => `- ${x.name} (${x.priority})`).join('\n') +
        (top.length > 10 ? `\n…and ${top.length - 10} more.` : '') : '');
  }

  if (has(q, 'no tour', 'no scheduled tours', 'without a tour', 'not scheduled', 'no date')) {
    if (state.guideToursLoaded === false) return 'The guide schedule could not be loaded. Try Refresh before checking who has no tours.';
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

/* ------------------------------------------------- training answers -------
   Attendance, makeups and who has said in advance they will be missing.

   Worth its own section rather than being folded into the handbook: "who
   missed training" used to return the written absence POLICY, which is a real
   paragraph and completely useless when what you wanted was five names.
-------------------------------------------------------------------------- */
function trainingAnswers(q) {
  const t = shared.training;
  // Training is codirector-only, so she will not discuss it with anyone else.
  if (!t || !isAdmin()) return null;
  const { sessions = [], attendance = [], absences = [] } = t;
  if (!sessions.length) return null;

  const byId = new Map(sessions.map(s => [s.id, s]));
  const label = id => byId.get(id)?.label || '';
  const past = s => !s.held_on || s.held_on <= todayISO();
  const owed = attendance.filter(a => /absent/i.test(a.actual || ''));

  /* --- who owes a makeup ------------------------------------------------ */
  if (has(q, 'makeup', 'make up', 'made up', 'owes', 'owe', 'outstanding', 'still absent',
             'not done their', 'catch up', 'behind on training')) {
    if (!owed.length) return 'Nobody owes a makeup — everyone marked absent has completed one.';
    const people = [...new Set(owed.map(a => a.person_name))];
    remember(people);
    return `${people.length} ${people.length === 1 ? 'person owes' : 'people owe'} a makeup:\n` +
      owed.slice(0, 12).map(a => `- ${a.person_name} — ${label(a.session_id)}`).join('\n') +
      (owed.length > 12 ? `\n…and ${owed.length - 12} more.` : '');
  }

  /* --- who has said they will be away ----------------------------------- */
  if (has(q, 'filed', 'absence form', 'said they', 'told us', 'will miss', 'going to miss',
             'will be gone', 'wont be there', 'will not be there', 'heads up',
             'missing the next', 'missing next', 'out next', 'away next', 'skipping')) {
    if (!absences.length) return 'Nobody has filed an absence.';
    const upcoming = sessions.filter(s => !past(s));
    const next = upcoming[0];
    if (next && has(q, 'next', 'upcoming', 'this week')) {
      const who = absences.filter(a => a.sessions.some(x => sameSession(x, next.label)));
      remember(who.map(a => a.name));
      return who.length
        ? `${who.length} filed an absence for ${next.label}:\n` +
          who.slice(0, 12).map(a => `- ${a.name}`).join('\n')
        : `Nobody has filed an absence for ${next.label}.`;
    }
    remember(absences.map(a => a.name));
    return `${absences.length} absence${absences.length === 1 ? '' : 's'} filed. The most recent:\n` +
      absences.slice(0, 8).map(a => `- ${a.name} — ${a.sessions.join(', ') || 'no session given'}`).join('\n') +
      '\n\nThe Training tab has the reasons.';
  }

  /* --- how a particular session went, or the term overall --------------- */
  if (has(q, 'training', 'attendance', 'attended', 'showed up', 'turned up', 'came to',
             'absent on', 'was absent', 'were absent', 'missed', 'no show', 'did not come')) {
    const named = sessions.find(s => String(q).toLowerCase().includes(s.label.toLowerCase()));
    const target = named || [...sessions].reverse().find(past);
    if (!target) return 'No training session has happened yet this term.';

    const rows = attendance.filter(a => a.session_id === target.id);
    const came = rows.filter(a => /^attended/i.test(a.actual || '')).length;
    const madeUp = rows.filter(a => /^makeup/i.test(a.actual || '')).length;
    const missing = rows.filter(a => /absent/i.test(a.actual || ''));
    remember(missing.map(a => a.person_name));

    return `${target.label}: ${came} of ${rows.length} attended` +
      (madeUp ? `, ${madeUp} completed a makeup` : '') +
      (missing.length
        ? `, ${missing.length} still owe one:\n` + missing.slice(0, 10).map(a => `- ${a.person_name}`).join('\n')
        : '. Nobody is outstanding.') +
      (named ? '' : `\n\nThat is the most recent session; name another and I will look it up.`);
  }
  return null;
}

/** "November 2rd" and "November 2nd" are the same evening. */
const sameSession = (a, b) => {
  const k = x => String(x || '').toLowerCase().replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1').replace(/[^a-z0-9]/g, '');
  return k(a) === k(b);
};

/* ------------------------------------------------- interview answers ------ */

let interviewData = null;
const shared = { tours: null, desks: null, training: null, majors: null };
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
  if (!inRecruitment()) return null;
  if (!d) return has(q, 'candidate', 'candidates', 'interview', 'ungraded', 'checked in') ? 'Interviews have not loaded yet. Try Refresh.' : null;
  const cands = d.candidates || [];


  if (has(q, 'discuss', 'talk about', 'disagree', 'split', 'contentious', 'worth')) {
    const flags = discussionFlags(cands).slice(0, 8);
    if (!flags.length) return 'Nothing stands out — the panel broadly agreed on everybody who has been scored.';
    remember(flags.map(f => f.c.name));
    return `${vary('These ' + flags.length + ' are worth talking about',
                   flags.length + ' I would put in front of the room',
                   flags.length + ' worth a conversation')}:\n` +
      flags.map(f => `- ${f.c.name} — ${f.c.final !== null ? f.c.final.toFixed(2) : 'no score'}: ${f.why.join(', ')}`).join('\n');
  }

  if (has(q, 'ungraded', 'not graded', 'nobody scored', 'no scores', 'still need grading',
             'hasnt been graded', 'havent been graded', 'has not been graded',
             'nobody graded', 'no one graded', 'not been scored', 'without scores',
             'still ungraded', 'yet to be graded', 'needs grading')) {
    const none = cands.filter(c => c.raters === 0);
    remember(none.map(c => c.name));
    return none.length
      ? `${none.length} candidates have no scores at all:\n` + none.slice(0, 12).map(c => `- ${c.name}`).join('\n')
      : vary('Everybody has been scored by at least one person.',
             'Nobody has been missed — everyone has at least one score.');
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
    remember(top.map(c => c.name));
    return vary('Highest scoring so far', 'Top of the list at the moment', 'Leading the field') + ':\n' + top.map(c =>
      `- ${c.name} — ${c.final.toFixed(2)} from ${c.raters} raters` +
      (c.spread >= 1.5 ? ` (but they disagreed by ${c.spread.toFixed(1)})` : '')).join('\n');
  }

  if (/\b(?:not|never|hasnt|havent|hasn't|haven't)\b.*\b(?:checked|check|arrived)\b|\b(?:missing|absent) candidates\b/i.test(q)) {
    const missing = cands.filter(c => c.checkin !== 'Yes');
    remember(missing.map(c => c.name));
    return missing.length ? `${missing.length} candidates have not checked in:\n` + missing.slice(0,12).map(c => `- ${c.name}`).join('\n') : 'Every candidate has checked in.';
  }

  if (has(q, 'checked in', 'check in', 'arrived', 'here')) {
    const inn = cands.filter(c => c.checkin === 'Yes').length;
    return `${inn} of ${cands.length} candidates are checked in.`;
  }

  // Candidates get the same treatment guides do: any part of the name is enough,
  // and two Neffs means she asks which rather than picking one.
  const who = findPeople(q, cands, c => c.name);
  if (who.length > 1) {
    const names = who.slice(0, 4).map(c => c.name);
    remember(names);
    memory.pending = { kind: 'which', options: names };
    return `Could be ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}. Which one?`;
  }
  const named = who[0];
  if (named) {
    remember(null, named.name);
    const f = discussionFlags(cands).find(f => f.c === named);
    return `${named.name} — ${named.final !== null ? named.final.toFixed(2) : 'not scored yet'}` +
      (named.raters ? ` from ${named.raters} raters` : '') +
      (named.group ? `, group ${named.group}` : '') +
      (named.decision ? `. Decision: ${named.decision}.` : '. No decision yet.') +
      (f ? `\n\nWorth noting: ${f.why.join(', ')}.` : '');
  }
  return null;
}

/* --------------------------------------------------- a particular guide ---
   "who is evaluating Jane Boilermaker", "when is Jane leading a tour". Matched on any
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

/**
 * Everyone in `list` whose name appears in the question, best match first.
 *
 * Scoring matters more than it looks. "Sadie Neff" and "Emma Neff" both contain
 * "Neff", so a plain contains-check calls every mention ambiguous forever --
 * including when the person has just told you which one they meant. Counting
 * how many parts of the name are present means a full name beats a surname and
 * the ambiguity resolves.
 */
function findPeople(q, list, nameOf) {
  const ws = tokens(q);
  const scored = list.map(p => {
    const parts = tokens(nameOf(p));
    const score = parts.filter(part => ws.some(w => w === part || near(w, part))).length;
    return { p, score };
  }).filter(x => x.score > 0);

  if (!scored.length) return [];
  const best = Math.max(...scored.map(x => x.score));
  return scored.filter(x => x.score === best).map(x => x.p);
}

function guideAnswers(q) {
  const g = state.guides || [];
  if (!inTraining()) return null;


  const hits = findPeople(q, g, x => x.name);
  if (hits.length > 1) {
    // Ask, and remember that we asked, so a bare "the second one" lands.
    const names = hits.slice(0, 4).map(x => x.name);
    remember(names);
    memory.pending = { kind: 'which', options: names };
    return `Could be ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}. Which one?`;
  }
  if (!hits.length) return null;

  const x = hits[0];
  remember(null, x.name);
  const bits = [`${x.name} — ${x.priority || 'no priority set'}.`];
  if (x.skip) bits.push('Marked as not needing an eval this term.');
  else if (x.status === 'open') bits.push('Nobody has claimed them yet.');
  else if (x.evaluator) bits.push(
    `${x.evaluatorId === state.me?.id ? 'You are' : x.evaluator + ' is'} evaluating them` +
    (x.date ? `, on ${prettyDay(x.date)}${x.time ? ' at ' + prettyClock(x.time) : ''}.` : ', no tour date set yet.') +
    (x.status === 'submitted' ? ' Eval submitted.' : x.status === 'reviewed' ? ' Eval submitted and reviewed.' : ''));

  /* What they study, and how their training is going. Both come from other
     screens, so she says them only when those have loaded — never a blank
     where a fact should be. */
  const st = shared.majors?.get(x.name);
  if (st) {
    const study = [
      st.majors?.length ? st.majors.join(' and ') : '',
      st.minors?.length ? `minoring in ${st.minors.join(' and ')}` : ''
    ].filter(Boolean).join(', ');
    if (study) bits.push(`Studying ${study}${st.year ? ` — ${st.year.toLowerCase()}` : ''}.`);
  }

  const tr = shared.training?.perPerson?.get(x.name);
  if (tr) {
    if (tr.owed) bits.push(`Training: ${tr.owed} makeup${tr.owed === 1 ? '' : 's'} still owed.`);
    else if (tr.filed) bits.push(`Training: all square, ${tr.filed} absence${tr.filed === 1 ? '' : 's'} filed in advance.`);
    else bits.push('Training: nothing outstanding.');
  }

  const range = dateRange(q.replace(new RegExp(x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ''));
  if (range?.error) return range.error;
  const tours = (x.tours || []).filter(t => !range || (t.date >= range.from && t.date <= range.to));
  if (state.guideToursLoaded === false) bits.push('Tour times have not loaded. Try Refresh.');
  else if (tours.length) {
    const next = tours.slice(0, 3);
    bits.push(`\nUpcoming tours:\n` + next.map(t => `- ${prettyDay(t.date)} at ${prettyClock(t.start)}`).join('\n') +
      (tours.length > 3 ? `\n…and ${tours.length - 3} more.` : ''));
  } else if (!x.skip) {
    bits.push(range ? `\nNo tours listed from ${range.from} through ${range.to}.` : '\nNo scheduled tours to pick from, so their eval has to be dated by hand.');
  }
  return bits.join(' ');
}

/* ------------------------------------------------------- tours and desks --- */

function scheduleAnswers(q) {
  if (!has(q, 'tour', 'tours', 'schedule', 'leading')) return null;
  if (has(q, 'no tour', 'no scheduled tours', 'without a tour', 'not scheduled', 'no date')) return null;
  if ((state.guides || []).length && inTraining() && findPeople(q, state.guides, x => x.name).length) return null;
  const tours = shared.tours;
  if (!tours) return 'The tour schedule has not loaded yet. Try Refresh before checking tour times.';
  const range = dateRange(q);
  if (range?.error) return range.error;
  if (!range && !/\b(who|when|list|show)\b/i.test(q)) return null;
  const dates = range || dateRange('today');
  const day = tours.filter(t => t.date >= dates.from && t.date <= dates.to);
  const label = dates.from === dates.to ? prettyDay(dates.from) : `${prettyDay(dates.from)} through ${prettyDay(dates.to)}`;
  if (!day.length) return `No tours are listed in the loaded schedule for ${label}.`;
  const bySlot = {};
  day.forEach(t => (bySlot[`${t.date}|${t.slot || t.start}`] ||= []).push(t.guide));
  return `${day.length} guide assignment${day.length === 1 ? '' : 's'} for ${label}:\n` +
    Object.entries(bySlot).map(([key, who]) => {
      const [date, slot] = key.split('|');
      return `- ${dates.from !== dates.to ? prettyDay(date) + ', ' : ''}${slot}: ${who.join(', ')}`;
    }).join('\n');
}

function deskAnswers(q) {
  if (!has(q, 'desk', 'desks', 'coverage', 'uncovered desk')) return null;
  if (!inTraining()) return 'Desk Coverage is available to the training team. Your current role does not include it.';
  const desks = shared.desks;
  if (!desks) return 'Desk coverage has not loaded yet. Try Refresh before checking coverage.';
  const range = dateRange(q);
  if (range?.error) return range.error;
  const days = [];
  if (range) {
    const d = new Date(range.start);
    while (d <= range.end) { days.push(DAY_NAMES[d.getDay()]); d.setDate(d.getDate()+1); }
  } else days.push('Monday','Tuesday','Wednesday','Thursday','Friday');
  const which = /welcome/i.test(q) ? 'Welcome Desk' : /front/i.test(q) ? 'Front Desk' : null;
  const source = desks.filter(r => !which || r.desk === which);
  const rows = source.filter(r => days.includes(r.day));
  const label = `${which || 'Desk'} coverage for ${days.join(', ')} (recurring weekly template)`;
  if (has(q, 'uncovered', 'gap', 'nobody', 'empty', 'missing')) {
    const slots = [...new Set(source.map(d => `${d.desk}|${d.slot}`))];
    if (!slots.length) return 'No desk slots are loaded, so I cannot determine which slots are uncovered.';
    const gaps = [];
    for (const key of slots) {
      const [desk, slot] = key.split('|');
      for (const day of days.filter(d => d !== 'Saturday' && d !== 'Sunday')) {
        if (!rows.some(x => x.desk === desk && x.slot === slot && x.day === day && x.person)) gaps.push(`${desk}, ${day} ${slot}`);
      }
    }
    if (days.every(d => d === 'Saturday' || d === 'Sunday')) return 'The desk template only covers Monday through Friday.';
    return `${label}:\n` + (gaps.length ? `${gaps.length} uncovered slots:\n` + gaps.slice(0,12).map(g => `- ${g}`).join('\n') : 'All loaded slots are covered.');
  }
  const filled = rows.filter(r => r.person);
  if (!filled.length) return `${label}: no assignments are listed.`;
  return `${label}:\n` + filled.slice(0,30).map(r => `- ${r.day}, ${r.slot}: ${r.person}`).join('\n');
}

/* ------------------------------------------------------------- navigation */

const DESTINATIONS = [
  { to: 'evals',         k: ['eval tracker', 'evals', 'eval', 'roster', 'claim'] },
  { to: 'interviews',    k: ['interview', 'grading', 'grade', 'candidate', 'check in', 'decisions'] },
  { to: 'schedule',      k: ['schedule', 'tours', 'tour schedule'] },
  { to: 'desks',         k: ['desk', 'desks', 'coverage'] },
  { to: 'directory',     k: ['directory', 'guide list', 'guides'] },
  { to: 'announcements', k: ['announcement', 'announcements', 'notices'] },
  { to: 'training',      k: ['training', 'makeup', 'makeups', 'attendance', 'absence form'] },
  { to: 'people',        k: ['people', 'members', 'accounts', 'who can sign in'] }
];

function navigation(q) {
  // 'Show me ungraded candidates' asks for an answer, not a tab change.
  if (!/^(?:please\s+)?(?:open|go to|take me to|jump to|navigate to)\b/i.test(q)) return null;
  for (const d of DESTINATIONS) {
    if (d.k.some(k => q.toLowerCase().includes(k))) {
      const barred =
        (['evals', 'desks', 'directory'].includes(d.to) && !inTraining()) ||
        (['training', 'people'].includes(d.to) && !isAdmin()) ||
        (d.to === 'interviews' && !inRecruitment()) ||
        false;
      if (barred) return { say: 'Your current role does not include that tool.' };
      const NICE = { evals: 'Eval Tracker', training: 'Training', people: 'People', desks: 'Desk Coverage' };
      return { go: d.to, say: `Opening ${NICE[d.to] || d.to}.` };
    }
  }
  return null;
}

/* ------------------------------------------------------------ remembering
   What makes this feel like a conversation rather than a search box is that she
   remembers the last couple of turns: who was just named, what list she just
   read out, and whether she asked you something and is waiting on an answer.

   Deliberately shallow -- a handful of turns, cleared when the subject changes.
   Anything longer starts guessing at what "her" meant three questions ago.
-------------------------------------------------------------------------- */

const memory = { list: [], person: null, pending: null, recent: [], lastQuestion: null };

export function forget() { memory.list = []; memory.person = null; memory.pending = null; memory.recent = []; }
export function resetVanessaData() {
  forget(); greeted = false; interviewData = null; shared.tours = shared.desks = null;
}

/** Called by the answers that read out a list, so "the second one" can work. */
function remember(list, person) {
  if (Array.isArray(list)) memory.list = list.slice(0, 12);
  if (person) memory.person = person;
}

const YES = /^\s*(y|ye|yes|yep|yeah|yup|sure|ok|okay|please|do it|go on|go ahead|sounds good)\b/i;
const NO  = /^\s*(n|no|nope|nah|not now|never ?mind|no thanks|leave it)\b/i;

const ORDINALS = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2,
                   fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: -1 };

/**
 * Turns "tell me about the second one" or "what about her" into a question that
 * names somebody, so everything downstream can stay simple.
 */
function resolveReference(q) {
  for (const word in ORDINALS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(q) && memory.list.length) {
      const i = ORDINALS[word] < 0 ? memory.list.length - 1 : ORDINALS[word];
      if (memory.list[i]) return { q: `${q} ${memory.list[i]}`, used: memory.list[i] };
    }
  }
  if (/\b(he|him|his|she|her|hers|they|them|their|that one|this one|the other one)\b/i.test(q)
      && memory.person) {
    return { q: `${q} ${memory.person}`, used: memory.person };
  }
  return { q, used: null };
}

/** Say the same thing differently each time, so she does not sound like a form. */
function vary(...options) {
  const fresh = options.filter(o => !memory.recent.includes(o));
  const pick = (fresh.length ? fresh : options)[Math.floor(Math.random() * (fresh.length || options.length))];
  memory.recent = [pick, ...memory.recent].slice(0, 6);
  return pick;
}

/* ------------------------------------------------------------- handbook
   Anything the hub itself cannot answer might still be in the Tour Guide
   Handbook: what to wear, what earns a strike, how to handle a question you do
   not know. Scored on word overlap, and she quotes the sentences that actually
   matched rather than the whole section, with the page so it can be looked up.
-------------------------------------------------------------------------- */

/* How many sections each word appears in. A word in one section is a strong
   signal; a word in fifteen tells you nothing. Without this, "can I wear
   sandals" scored on "wear" and "can" and lost to whichever section was
   longest, while "sandals" — the only word that mattered — counted once. */
let DF = null;
function docFreq() {
  if (DF) return DF;
  DF = new Map();
  for (const sec of HANDBOOK) {
    for (const w of new Set(tokens(sec.title + ' ' + sec.text))) {
      DF.set(w, (DF.get(w) || 0) + 1);
    }
  }
  return DF;
}
const rarity = w => Math.log(1 + HANDBOOK.length / (1 + (docFreq().get(w) || 0)));

/* People and handbooks use different words for the same thing. The handbook
   says "outfit"; every guide alive says "wear". It says "sub"; they say
   "cover". Without this the dress code -- one of the most asked questions
   there is -- was unfindable, because not one word of "what should I wear on
   tour" appears in the section that answers it.

   Expansion happens on the question only, so a question reaches the section
   that answers it without the handbook text being altered. */
const SYNONYMS = {
  wear: ['outfit', 'attire', 'clothing', 'dress'],
  dress: ['outfit', 'attire', 'clothing'],
  clothes: ['outfit', 'attire', 'clothing'],
  outfit: ['attire', 'clothing'],
  uniform: ['polo', 'outfit', 'attire'],
  shoes: ['sandal', 'flip', 'toed'],
  sandals: ['sandal', 'flip'],
  cover: ['sub', 'substitute'],
  sub: ['substitute', 'cover'],
  miss: ['absence', 'absent'],
  skip: ['absence', 'absent'],
  sick: ['absence', 'absent', 'excuse'],
  late: ['tardy', 'absence'],
  punish: ['strike'],
  trouble: ['strike'],
  pay: ['webclock', 'clock', 'hour'],
  paid: ['webclock', 'clock', 'hour'],
  timesheet: ['webclock', 'clock'],
  phone: ['cell'],
  rain: ['weather', 'inclement'],
  question: ['faq', 'answer'],
  boss: ['todd', 'amanda', 'coordinator']
};

function expand(words) {
  const out = new Set(words);
  for (const w of words) (SYNONYMS[w] || []).forEach(x => out.add(stem(x)));
  return [...out];
}

/* Words that belong to the hub, not to the handbook.
 The handbook is a whole printed booklet about Purdue, so it can find a plausible-sounding sentence for almost anything. Asked "what's the average score" it answered "the average starting salary for graduates is $79,364" -- a real sentence, confidently delivered, and nothing to do with the question. That is the worst thing she does, because it is indistinguishable from a real answer.
 So the handbook is barred outright from questions that use hub vocabulary. It knows about being a tour guide; it knows nothing about who is claimed, who is ungraded or what anybody scored, and it should not be allowed to guess. Those questions go unanswered instead, which is honest and also lets them reach the model tier. */
const HUB_WORDS = /\b(eval|evals|evaluation|evaluations|evaluator|claim|claimed|unclaimed|candidate|candidates|interview|interviews|interviewer|grade|graded|ungraded|grading|score|scores|scored|scoring|rating|ratings|average|decision|decisions|undecided|roster|priority|priorities|submitted|submit|reviewed|rollover|checked in|checkin|desk|desks|uncovered|slot|slots|assignment|assignments|committee|codirector|training|trainings|makeup|makeups|attendance|absence|absences|hub|tab|dashboard)\b/i;

/**
 * The handbook section that best fits the question, with its score.
 *
 * Split out of handbookAnswer so the model tier can share the retrieval and
 * apply its own, looser bar. The strict quoting path needs a high bar because
 * a bad quote reads as fact; a model that is handed a passage can weigh it and
 * say it is not sure, so it can afford to see more.
 */
function bestSection(q) {
  if (HUB_WORDS.test(q)) return null;
  const base = [...new Set(tokens(q))];
  if (!base.length) return null;
  const ws = expand(base);

  const scored = HANDBOOK.map(sec => {
    const body = new Set(tokens(sec.text));
    const title = new Set(tokens(sec.title));
    let score = 0, matched = 0, rarest = 0;
    for (const w of ws) {
      const inBody = body.has(w) || [...body].some(b => near(b, w));
      const inTitle = title.has(w) || [...title].some(t => near(t, w));
      if (!inBody && !inTitle) continue;
      matched++;
      rarest = Math.max(rarest, rarity(w));
      score += inTitle ? rarity(w) * 2 : rarity(w);
    }
    return { sec, score, matched, rarest, ws };
  }).sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

/** What the model is allowed to read: a real match, but not a desperate one. */
export function handbookContext(q) {
  const best = bestSection(q);
  if (!best || best.rarest < 1.6 || best.score < 1.6) return null;
  return { title: best.sec.title, page: best.sec.page, text: best.sec.text };
}

function handbookAnswer(q) {
  if (HUB_WORDS.test(q)) return null;      // not its territory — see HUB_WORDS
  const base = [...new Set(tokens(q))];
  // One word is enough if it is a rare one. "What are postcards for" reduces to
  // just "postcard" once the filler is stripped, and that is the whole question.
  // Judged on what was actually typed, before synonyms pad it out.
  if (!base.length || (base.length < 2 && rarity(base[0]) < 2)) return null;
  const ws = expand(base);

  const scored = HANDBOOK.map(sec => {
    const body = new Set(tokens(sec.text));
    const title = new Set(tokens(sec.title));
    let score = 0, matched = 0, rarest = 0;
    for (const w of ws) {
      const inBody = body.has(w) || [...body].some(b => near(b, w));
      const inTitle = title.has(w) || [...title].some(t => near(t, w));
      if (!inBody && !inTitle) continue;
      matched++;
      rarest = Math.max(rarest, rarity(w));
      score += inTitle ? rarity(w) * 2 : rarity(w);
    }
    return { sec, score, matched, rarest };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  /* The handbook has to EARN the answer, because it is the last thing tried and
     will otherwise swallow every question. Left at a low bar it told somebody
     asking "who do we still gotta look at" about Purdue's astronauts, and
     "how many people showed up" got the strikes policy — confidently wrong,
     which is worse than admitting to not following, and it also meant nothing
     ever reached the model tier.

     Three things have to hold: enough of the question actually appears; at
     least one of those words is distinctive rather than filler; and this
     section is a clear winner rather than one of twenty equally vague matches. */
  /* Deliberately cautious, and here is the evidence for why.
     
     Scoring both a set of real handbook questions and a set of hub questions
     phrased casually, the two overlap completely:
     
       "what are postcards for"        score 3.98  matched 1  rarest 1.99
       "who do we still gotta look at" score 3.98  matched 2  rarest 1.99
     
     Identical on every signal. "look", "people" and "put on" really are in the
     handbook, so counting words cannot tell the two apart -- the difference is
     meaning. Left permissive it told somebody asking who still needed an eval
     about Purdue's astronauts, which is worse than not answering.
     
     So this now answers only when a genuinely distinctive word is present, and
     stays quiet otherwise. The questions it turns away fall through to the
     model tier, which can actually read them. */
  if (best.rarest < 2.3 || best.matched < 1 || best.score < 2.3) return null;

  // Quote the sentences carrying the question's words, not the whole page.
  const sentences = best.sec.text.split(/(?<=[.!?])\s+/).filter(x => x.length > 20);
  const ranked = sentences.map(sn => {
    const t = new Set(tokens(sn));
    return { sn, n: ws.reduce((acc, w) => acc + ((t.has(w) || [...t].some(x => near(x, w))) ? rarity(w) : 0), 0) };
  }).sort((a, b) => b.n - a.n).filter(x => x.n > 0);

  const quote = (ranked.length ? ranked.slice(0, 3).map(x => x.sn) : sentences.slice(0, 2)).join(' ');
  if (!quote) return null;
  return { score: best.score,
           text: `${quote}\n\n— Tour Guide Handbook, ${best.sec.title} (page ${best.sec.page})` };
}


/* ------------------------------------------------------------------ ask */

/** Something she can offer to do, that "yes" will then carry out. */
function offerFor(q, text) {
  if (has(q, 'discuss', 'worth', 'disagree') && inRecruitment())
    return { say: 'Want me to open Interviews?', go: 'interviews' };
  if (has(q, 'ungraded', 'not graded', 'no scores') && inRecruitment())
    return { say: 'Shall I take you to Grade?', go: 'interviews' };
  if (has(q, 'unclaimed', 'need an eval', 'up for grabs') && inTraining())
    return { say: 'Want to see them on the Eval Tracker?', go: 'evals' };
  if (has(q, 'uncovered', 'gap') )
    return { say: 'Want me to open Desk Coverage?', go: 'desks' };
  return null;
}

/* ------------------------------------------------- "what needs me?"
   The single most common thing anyone actually types, in a dozen phrasings,
   and until now every one of them got a shrug: "whos free", "anything for
   me", "idk what to do", "is there anything urgent", "who is behind".

   They are all the same question, and the hub already computes the answer for
   the Today screen. This routes the plain-English versions to it rather than
   making people learn the phrase the matcher wants.
-------------------------------------------------------------------------- */
const NEEDS_ME = new RegExp([
  'anything (for me|i (need|should)|urgent|pressing|waiting|outstanding|left)',
  'what (do i|should i|can i|needs|is) (need|do|doing|be doing|left|next|urgent|waiting)',
  'what needs (me|doing|my attention)',
  '(whats|what is) (urgent|pressing|next|left|outstanding|on my plate)',
  'wh(o|at)s free',
  'i(dk| dont know| do not know) what to do',
  'where (do i|should i) start',
  'catch me up', 'whats going on', 'sum(mary|marise|marize)',
  'am i behind', 'who is behind', 'whos behind', 'anyone behind',
  'nothing to do', 'give me something'
].join('|'), 'i');

/** Everything waiting on this person, most pressing first. */
function needsMe() {
  const bits = [];
  const g = state.guides || [];
  const me = state.me?.id;

  if (inTraining() && g.length) {
    const mine = g.filter(x => x.evaluatorId === me && x.status === 'claimed');
    const undated = mine.filter(x => !x.date);
    if (undated.length) bits.push(`${undated.length} of your claimed eval${undated.length === 1 ? ' has' : 's have'} no tour date yet: ` +
      undated.slice(0, 5).map(x => x.name).join(', ') + (undated.length > 5 ? '…' : ''));
    const dated = mine.filter(x => x.date);
    if (dated.length) bits.push(`${dated.length} eval${dated.length === 1 ? '' : 's'} you have claimed and not submitted: ` +
      dated.slice(0, 5).map(x => `${x.name} (${x.date})`).join(', ') + (dated.length > 5 ? '…' : ''));
    if (!mine.length) {
      const urgent = g.filter(x => x.status === 'open' && x.rank <= 2);
      if (urgent.length) bits.push(`You have not claimed anybody. ${urgent.length} guides are unclaimed at first or second priority.`);
    }
    if (isAdmin()) {
      const waiting = g.filter(x => x.status === 'submitted');
      if (waiting.length) bits.push(`${waiting.length} submitted eval${waiting.length === 1 ? '' : 's'} waiting for a codirector to review.`);
    }
  }

  if (inRecruitment() && interviewData?.candidates?.length) {
    const c = interviewData.candidates;
    const unscored = c.filter(x => x.checkin === 'Yes' && !x.scores?.[myName()]);
    if (unscored.length) bits.push(`${unscored.length} checked-in candidate${unscored.length === 1 ? ' is' : 's are'} waiting on a score from you.`);
    const none = c.filter(x => x.raters === 0);
    if (none.length) bits.push(`${none.length} candidates have no scores from anybody yet.`);
  }

  if (!bits.length) {
    return 'Nothing is waiting on you right now. ' +
      vary('Enjoy it.', 'Genuinely — you are clear.', 'Make the most of it.');
  }
  return (bits.length === 1 ? 'One thing:' : `${bits.length} things:`) + '\n' +
    bits.map(b => `- ${b}`).join('\n');
}

/* Some questions genuinely cannot be answered as asked -- "how many people",
   "show me everything". Guessing produces confident nonsense and shrugging
   wastes the person's turn. Asking which they meant is the honest reply, and
   it is what a colleague would do. */
function clarify(q) {
  const t = String(q).toLowerCase().trim();

  if (/^(how many|how much)( people| are there| do we have)?\??$/.test(t) ||
      /^how many (people|are there|of them|total)\??$/.test(t)) {
    const opts = [];
    if (inTraining())    opts.push('guides needing an eval');
    if (inRecruitment()) opts.push('interview candidates');
    opts.push('people on the hub');
    return `How many of what — ${opts.join(', ')}? Say the word and I will count them.`;
  }

  if (/^(show me |give me |tell me )?(everything|all of it|all|the lot)\??$/.test(t)) {
    const opts = [];
    if (inTraining())    opts.push('"how far along are the evals"');
    if (inRecruitment()) opts.push('"who is worth discussing"');
    opts.push('"who is leading tours today"', '"anything for me"');
    return `More than fits in one answer. Pick a thread and I will pull it:\n` +
           opts.map(o => `- ${o}`).join('\n');
  }
  return null;
}

export function ask(question) {
  let q = String(question || '').trim();
  if (!state.me) return { text: 'Sign in to use Vanessa.' };
  if (!q) return { text: vary('Ask me anything about the hub.', 'What would you like to know?') };

  /* --- is this an answer to something she just asked? --------------------- */
  const waiting = memory.pending;
  memory.pending = null;

  if (waiting && waiting.kind === 'details' && YES.test(q)) q = waiting.question;
  if (waiting && waiting.kind === 'details' && NO.test(q)) return { text: 'Okay. What else would you like to know?' };
  if (waiting && waiting.kind === 'offer') {
    if (YES.test(q)) return { text: vary('Right you are.', 'On it.', 'Sure.'), go: waiting.go };
    if (NO.test(q))  return { text: vary('No problem.', 'Fine — anything else?', 'Right you are.') };
  }
  // A bare yes or no with nothing outstanding should say so, not go rummaging
  // through the help topics for something containing the word "no".
  if (!waiting && (YES.test(q) || NO.test(q)) && q.split(/\s+/).length <= 3) {
    return { text: vary('Yes to what, sorry? I have lost the thread.',
                        'I am not sure what that is answering — ask me again?',
                        'You have lost me — what were we on?') };
  }
  if (waiting && waiting.kind === 'which') {
    const matches = findPeople(q, waiting.options.map(name => ({ name })), x => x.name);
    if (matches.length === 1) q = `tell me about ${matches[0].name}`;

  }

  /* --- is this just somebody saying hello? -------------------------------
     Peel off the greeting and the address. If nothing is left, there was no
     question underneath and she should simply be friendly. If something IS
     left, answer that and let the "hi bro" cost nothing. */
  const peeled = peel(q);
  if (peeled.social) {
    const chat = smallTalk(q);
    if (chat) return { text: socialReply(chat) };
  } else if (peeled.stripped) {
    q = peeled.rest;              // "hey bro who needs an eval" -> "who needs an eval"
  }

  /* --- "what about tomorrow?" --------------------------------------------
     A bare time or place with no verb is a follow-up to whatever was just
     asked. On its own "what about tomorrow" means nothing; after "who is
     leading tours today" it plainly means the same question, moved a day.
     So the previous question is reused with the new time swapped in. */
  const followUp = /^\s*(and\s+|so\s+|ok\s+|but\s+)?(what about|how about|and)\s+(.+?)\s*\??$/i.exec(q);
  if (followUp && memory.lastQuestion) {
    const bit = followUp[3].trim();
    const WHEN = /\b(today|tomorrow|yesterday|tonight|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i;
    const when = WHEN.exec(bit);
    if (when) {
      // Swap the time word in the old question, or append it if it had none.
      q = WHEN.test(memory.lastQuestion)
        ? memory.lastQuestion.replace(WHEN, when[0])
        : `${memory.lastQuestion} ${when[0]}`;
    } else if (inTraining() && findPeople(bit, state.guides || [], x => x.name).length === 1) {
      /* "what about Saandiya" is a change of subject, not the same question
         with a name stuck on the end. Without this it appended her to the
         previous question and cheerfully re-read the makeup list. */
      q = `tell me about ${findPeople(bit, state.guides, x => x.name)[0].name}`;
    } else {
      q = `${memory.lastQuestion} ${bit}`;
    }
  }

  /* --- "the second one", "what about her" -------------------------------- */
  const ref = resolveReference(q);
  q = ref.q;

  // Worth building on later, once it is clear this is a real question.
  if (q.split(/\s+/).length >= 2) memory.lastQuestion = q;

  // Specific handbook/how-to topics win before operational data matching.
  const earlyTopic = topicMatch(q).topic;
  /* Was `TOPICS.indexOf(earlyTopic) >= 15`, which decided what counted as a
     handbook answer by its POSITION in the array. It happened to be right, and
     would have gone quietly wrong the first time anybody inserted a topic --
     a nasty thing to leave for whoever inherits this. The topics now say so
     themselves. */
  /* A written handbook answer explains a rule. It must not answer a question
     about people: "what are the rules about absences" is the policy, "who
     filed an absence" is five names, and both contain the word absence. Asking
     who or how many is asking about the data, so the handbook stands aside. */
  const aboutPeople = /^\s*(who|how many|which (guides?|people|candidates?)|list|show me who|anyone|anybody)\b/i.test(q);
  const handbookTopic = !!earlyTopic?.book && !aboutPeople;
  if (handbookTopic) return { text: earlyTopic.a };
  if (/\bwho\b.*\b(?:still|gotta)\b.*\b(?:look|evaluate|eval)\b/i.test(q)) {
    if (inTraining() && inRecruitment() && !/\bevals?\b/i.test(q)) return { text: 'Do you mean guides needing an eval, or candidates needing interview scores?', stuck: false };
    q = inTraining() ? 'who still needs an eval' : 'who is ungraded';
  }
  /* "anything for me", "whos free", "idk what to do" -- all one question. */
  if (NEEDS_ME.test(q)) return { text: needsMe() };

  const vague = clarify(q);
  if (vague) return { text: vague };

  const tasks=taskSummary(q);
  if(tasks)return tasks;
  const tourMatch=matchEvalTours(q);
  if(tourMatch){if(tourMatch.names)remember(tourMatch.names);return {text:tourMatch.text};}
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
  // words happen to be in it. "When is Jane Boilermaker LEADING a tour" otherwise
  // collided with the word "leader" and came back with the top scorers.
  const namesOne = (state.guides || []).length &&
                   findPeople(q, state.guides, x => x.name).length === 1;

  if (/^(?:tell me about|what about|who is)\s+/i.test(q)) {
    const guideHits = inTraining() ? findPeople(q, state.guides || [], x => x.name) : [];
    const candidateHits = inRecruitment() ? findPeople(q, interviewData?.candidates || [], x => x.name) : [];
    if (guideHits.length && candidateHits.length && !/\b(tour|eval|interview|candidate)\b/i.test(q)) return { text: 'Do you mean the guide or the interview candidate? Include tour or interview in your question.' };
    if (guideHits.length && !/\b(interview|candidate)\b/i.test(q)) return { text: guideAnswers(q) };
    if (candidateHits.length) return { text: interviewAnswers(q) };
    if (/^tell me about\s+/i.test(q) && !earlyTopic) return { text: 'I could not identify that person in your loaded hub data. Try their full name.' };
  }
  const answer = trainingAnswers(q)
    || deskAnswers(q)
    || scheduleAnswers(q)
    || (namesOne ? guideAnswers(q) : null)
    || (interviewy ? (interviewAnswers(q) || evalAnswers(q))
                   : (evalAnswers(q) || interviewAnswers(q)))
    || guideAnswers(q);

  if (answer) {
    // Only offer when she has actually just read out a list worth acting on,
    // and never twice in a row -- an assistant that ends every answer with a
    // question is exhausting.
    const offer = memory.pending ? null : offerFor(q, answer);
    if (offer && memory.list.length) {
      memory.pending = { kind: 'offer', go: offer.go };
      return { text: `${answer}\n\n${offer.say}` };
    }
    return { text: answer };
  }

  /* Nothing computable, and the message is almost entirely social -- "thanks",
     "who are you", "im tired". This has to come BEFORE the handbook, which will
     happily answer anything: ask it about "thanks" and it returns a genuine
     sentence about thanking families on tour, which is worse than useless
     because it looks like a real answer. Coverage decides it, so a question
     that merely contains a social phrase is untouched. */
  const strongChat = smallTalkStrong(q);
  if (strongChat) return { text: socialReply(strongChat) };

  /* One rule, rather than a pile of thresholds.

     The topic keywords ARE the definition of "this is a question about the app".
     So if a topic matches solidly, it is a hub question and the handbook does not
     get a vote. If the topic match is weak or absent, try the handbook. A weak
     topic still beats nothing at all.

     This replaced a set of competing score thresholds that kept trading one
     wrong answer for another: fixing "what should I wear on tour" broke "how is
     the final score worked out", and fixing that broke it back. */
  const { topic, score: topicScore } = topicMatch(q);

  if (topic && topicScore >= 4) return { text: topic.a };

  const book = handbookAnswer(q);
  if (book) return { text: book.text };
  if (topic) return { text: topic.a };

  /* Nothing computed, no topic, no handbook. Before shrugging, see whether it
     was conversational all along -- "are you sure", "this is broken", "what
     can you do" carry real content words, so they never reached the social
     check at the top, and every one of them deserves better than a shrug. */
  const chat = smallTalk(q);
  if (chat) return { text: socialReply(chat) };

  // `stuck` tells the caller the keyword matcher gave up. That is the only
  // moment the model tier is allowed to have an opinion.
  return { stuck: true, text: vary(
    'I did not follow that one.', 'Sorry — not sure what you mean there.', 'That one is beyond me.') +
    ' I can tell you who still needs an eval, who is worth discussing, how the scoring works, ' +
    'or take you to a tab. Try "who still needs an eval" or "open interviews".' };
}

/* ------------------------------------------------------------ small talk
   "hi bro" is the first thing a lot of people type, and answering it with
   "I did not follow that one" makes her look broken before she has had a
   chance. The replies live in vanessa-chat.js; the two that need live numbers
   are built here, because a hello is worth a great deal more when it also
   tells you what is sitting waiting for you.
-------------------------------------------------------------------------- */

/** The single most pressing thing for this person right now, in a few words. */
function whatIsWaiting() {
  const g = state.guides || [];
  const me = state.me?.id;

  if (inTraining() && g.length) {
    const mine = g.filter(x => x.evaluatorId === me && x.status === 'claimed');
    if (mine.length) return `You have ${mine.length} eval${mine.length === 1 ? '' : 's'} claimed and not submitted.`;
  }

  if (inRecruitment() && interviewData?.candidates?.length) {
    const here = interviewData.candidates.filter(c => c.checkin === 'Yes' && !c.scores?.[myName()]);
    if (here.length) return `${here.length} checked-in candidate${here.length === 1 ? ' is' : 's are'} waiting on a score from you.`;
  }

  if (inTraining() && g.length) {
    const urgent = g.filter(x => x.status === 'open' && x.rank <= 2);
    if (urgent.length) return `${urgent.length} guides at first or second priority are still unclaimed.`;
  }

  if (inRecruitment() && interviewData?.candidates?.length) {
    const none = interviewData.candidates.filter(c => c.raters === 0);
    if (none.length) return `${none.length} candidates have not been graded by anyone yet.`;
  }
  return null;
}

/* Said once. Her opening line IS a greeting, so somebody typing "hi" straight
   afterwards got the identical sentence back, which looks like a stuck record.
   The headline goes out the first time; after that she just acknowledges. */
let greeted = false;

function greetText() {
  const hour = new Date().getHours();
  const when = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const name = myName().split(' ')[0] || '';
  const waiting = whatIsWaiting();

  if (greeted) {
    return vary('Still here. What do you need?',
                'Hello again — what can I get you?',
                `Hi${name ? ', ' + name : ''}. Ask away.`,
                'Go on then, what are we looking at?');
  }
  greeted = true;

  if (waiting) {
    memory.pending = { kind: 'details', question: inTraining() && (state.guides || []).some(g => g.evaluatorId === state.me?.id && g.status === 'claimed') ? 'what are my evals' : inRecruitment() && interviewData?.candidates?.length ? 'who is ungraded' : 'who still needs an eval' };
  }
  return waiting
    ? `${when}${name ? ', ' + name : ''}. ${waiting} Want the details, or is it something else?`
    : vary(`${when}${name ? ', ' + name : ''}. What do you need?`,
           `Hello${name ? ', ' + name : ''}. What are you working on?`,
           `${when}. Nothing is shouting for you at the moment — what can I get you?`);
}

function capabilityText() {
  const can = [];
  if (inTraining())     can.push('• Evals — who still needs one, what you have claimed, how far along we are, who has no tour scheduled');
  if (inTraining())     can.push('• Training — who owes a makeup, who filed an absence, how a session went');
  if (inRecruitment())  can.push('• Interviews — who is ungraded, who is worth discussing, the top candidates, how many are undecided');
  can.push('• The schedule — who is leading tours today, tomorrow, or this week');
  if (inTraining()) can.push('• Desks — weekly coverage and uncovered slots');
  can.push('• The handbook — what to wear, what earns a strike, the absence rules, what to do when you do not know an answer');
  can.push('• Getting about — say "open interviews" or "take me to the schedule" and I will');

  return 'Quite a lot, as long as it is about this hub:\n\n' + can.join('\n') +
         '\n\nAsk about a person or task; include a date when it matters. ' +
         'A good first one is "who is worth discussing".';
}

/** A social reply, with the live ones filled in. */
function socialReply(item) {
  const pick = vary(...item.replies);
  if (pick === '__GREET__') return greetText();
  if (pick === '__CAPABILITIES__') return capabilityText();
  return pick;
}

/* The first thing anyone sees. Same rule as a hello: say what is actually
   waiting, rather than announcing herself and leaving them to think of
   something. */
export const greeting = () => greetText();

/**
 * Everything the in-browser model should see for one question.
 *
 * `facts` is what the deterministic code worked out — the real numbers, which
 * the model is told to use verbatim and never recompute. `book` is the
 * handbook passage, if the question is a handbook question. `notes` are the
 * written answers about how the hub itself works.
 */
export function llmContext(question) {
  const q = String(question || '').trim();
  const deterministic = ask(q);

  const topic = topicMatch(q).topic;
  return {
    facts: deterministic.stuck ? null : deterministic.text,
    book:  handbookContext(q),
    notes: topic ? topic.a : null,
    go:    deterministic.go || null,
    fallback: deterministic.text
  };
}

/** The written note about how the hub works that best fits, if any. */
export function topicNote(question) {
  const t = topicMatch(String(question || '')).topic;
  return t ? t.a : null;
}
