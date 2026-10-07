/* ============================================================ facts
   Everything Vanessa states about the programme comes from here — and
   everything here comes from data the hub has actually loaded.

   Each answer carries where it came from ("Tour schedule", "Eval roster"),
   so the panel can show it as a fact, apart from anything she writes. When
   the data is missing the answer SAYS it is missing ({ ok:false }), and the
   caller tells the person so. There is no path in this file that produces a
   tour, a person, a time or a status that was not in a loaded row.

   Permissions are checked here too, with the same role functions the router
   uses, so a fact this account may not see never leaves this file. The
   database's own row security still decides what was loaded in the first
   place.
============================================================================ */
import { state, myName, isAdmin, inTraining } from './state.js';
import { shared, ensure, loadedAt } from './vanessa-data.js';
import { presenceSnapshot } from './presence.js';
import { matchPerson } from './people-match.js';
import { findPeople } from './vanessa.js';
import { todayISO } from './ui.js';

export const SOURCE = { tours: 'Tour schedule', roster: 'Eval roster', training: 'Training records', presence: 'active users list' };
const unloaded = what => ({ ok: false, reason: 'unloaded', what });
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ------------------------------------------------------------ roster */
export async function roster() {
  if (!inTraining()) return { ok: false, reason: 'denied' };
  if (!(state.guides || []).length) await ensure('roster');
  return (state.guides || []).length || state.loadedAt ? { ok: true, guides: state.guides, source: SOURCE.roster, at: state.loadedAt } : unloaded('the eval roster');
}
export const myClaims = () => (state.guides || []).filter(g => g.evaluatorId === state.me?.id && g.status === 'claimed');

/** The tour a claimed eval is for: its scheduled one, else their next on the schedule. */
export function tourOf(g, day = null) {
  if (g.date && (!day || (g.date >= day.from && g.date <= day.to))) return { date: g.date, start: g.time || '' };
  const t = (g.tours || []).find(x => x.date >= todayISO() && (!day || (x.date >= day.from && x.date <= day.to)));
  return t ? { date: t.date, start: t.start, slot: t.slot } : null;
}

/* ------------------------------------------------------------ tours */
/** Tours between two dates, grouped into slots. Everyone may see the schedule. */
export async function tours(from = todayISO(), to = from) {
  await ensure('tours');
  const rows = shared.tours;
  if (!rows) return unloaded('the tour schedule');
  const slots = new Map();
  for (const t of rows) {
    if (t.date < from || t.date > to) continue;
    const k = `${t.date}|${t.start}`;
    if (!slots.has(k)) slots.set(k, { date: t.date, start: t.start, slot: t.slot, guides: [] });
    slots.get(k).guides.push(t.guide);
  }
  return { ok: true, slots: [...slots.values()], source: SOURCE.tours, at: loadedAt('tours') };
}

/** The roster guides leading a slot, when the eval roster is visible. */
export function guidesInSlot(slot) {
  if (!inTraining()) return [];
  return (state.guides || []).filter(g => (g.tours || []).some(t => t.date === slot.date && t.start === slot.start));
}

/** Who is evaluating which tour, from the roster's claimed dates and times. */
export async function evaluations({ date = null, time = null, names = null } = {}) {
  const r = await roster();
  if (!r.ok) return r;
  let list = r.guides.filter(g => g.evaluator && g.status !== 'open' && g.status !== 'skip');
  if (names?.length) list = findPeople(names.join(' '), list, g => g.name);
  else if (date) list = list.filter(g => g.date === date && (!time || g.time === time));
  return { ok: true, items: list.sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '').localeCompare(b.time || '')), source: SOURCE.roster, at: r.at };
}

/** This person's own upcoming tours: evaluations they are doing, and tours they lead. */
export async function myUpcoming() {
  const out = { ok: true, evals: [], leading: [], source: [] };
  if (inTraining()) {
    await roster();
    out.evals = myClaims().filter(g => g.date && g.date >= todayISO() && !(g.date === todayISO() && g.time && g.time < nowHHMM()))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
    out.source.push(SOURCE.roster);
  }
  const t = await tours(todayISO(), '9999-12-31');
  if (t.ok) {
    const me = myName();
    out.leading = t.slots.filter(s => s.guides.some(label => matchPerson(label, [me])))
      .filter(s => !(s.date === todayISO() && s.start && s.start < nowHHMM()));
    out.source.push(SOURCE.tours);
  } else out.toursMissing = true;
  return out;
}

/* ------------------------------------------------------------ people
   Guides by name, from every source this account may see. Two plausible
   matches come back as two — the caller asks which, never guesses. */
export async function findPerson(words) {
  const q = words.join(' ');
  if (!q.trim()) return { ok: true, hits: [] };
  if (inTraining()) {
    const r = await roster();
    if (r.ok) {
      const hits = findPeople(q, r.guides, g => g.name);
      if (hits.length) return { ok: true, hits: hits.map(g => ({ kind: 'guide', name: g.name, g })), source: SOURCE.roster };
    }
  }
  // Everyone can see the schedule: match "Max S." by first name, and surname initial if given.
  const t = await tours(todayISO(), '9999-12-31');
  if (!t.ok) return inTraining() ? { ok: true, hits: [] } : t;
  const labels = new Map();
  for (const s of t.slots) for (const g of s.guides) {
    const parts = g.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    const fits = words.some(w => w.length >= 3 && parts[0] && (parts[0] === w || parts[0].startsWith(w)))
      && (words.length < 2 || !parts[1] || words.some(w => w[0] === parts[1][0]));
    if (fits) { if (!labels.has(g)) labels.set(g, []); labels.get(g).push(s); }
  }
  return { ok: true, hits: [...labels].map(([label, slots]) => ({ kind: 'label', name: label, slots })), source: SOURCE.tours };
}

/* ------------------------------------------------------------ training (codirectors) */
export async function training() {
  if (!isAdmin()) return { ok: false, reason: 'denied' };
  await ensure('training');
  return shared.training?.sessions ? { ok: true, ...shared.training, source: SOURCE.training, at: loadedAt('training') } : unloaded('the training records');
}

/** A session held on a day, or the most recent one before it. */
export function sessionOn(t, date) {
  const past = t.sessions.filter(s => s.held_on && s.held_on <= (date || todayISO())).sort((a, b) => a.held_on.localeCompare(b.held_on));
  return { exact: t.sessions.find(s => s.held_on === date) || null, latest: past.at(-1) || null };
}
export function absentAt(t, session) {
  return t.attendance.filter(a => a.session_id === session.id && /absent/i.test(a.actual || '')).map(a => a.person_name);
}
export function attendanceOf(t, words) {
  const names = [...t.perPerson.keys()];
  const exact = matchPerson(words.join(' '), names);
  const hits = exact ? [exact] : findPeople(words.join(' '), names.map(name => ({ name })), x => x.name).map(x => x.name);
  return hits.map(name => ({ name, ...t.perPerson.get(name) }));
}

/* ------------------------------------------------------------ presence */
export function active() {
  const snap = presenceSnapshot();
  if (!snap) return unloaded('active users');
  if (snap.error) return { ok: false, reason: 'error', what: 'active users' };
  return { ok: true, users: snap.users || [], source: SOURCE.presence };
}
