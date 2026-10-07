/* ============================================================ auto-match evaluations
   Who should evaluate whom, and at which tour — proposed, never committed.

   This only PROPOSES. The screen shows every pairing with its reasoning and the
   administrator approves them (all, some, or after editing); the database then
   re-checks each one (see admin_assign_evaluations). Nothing here writes.

   What it looks at
     needs        guides on this semester's evaluation roster who need an
                  evaluation, have no evaluator, and have not submitted
     tours        their upcoming tours from the connected schedule
     evaluators   active evaluation-team members who are not paused
     busy         evaluations already claimed (so nobody is double-booked)

   How it decides (in this order)
     1. High priority first (the roster's own tier order), then by name
     2. a guide with a real upcoming tour; the EARLIEST usable one
     3. an evaluator who is free at that tour time and is not the guide
     4. the evaluator with the FEWEST evaluations so far (existing workload plus
        this run), so the load spreads; ties go to someone other than the
        evaluator just used, then alphabetically
   If nobody is free at the earliest tour it tries the next one and flags the
   match as a conflict, so you can see where the schedule was tight.

   Honest limits: the Hub does not know evaluators' personal availability, only
   that they are not already booked at that time and have not been paused. The
   reasons say so, rather than implying more.
============================================================================ */

const key = (date, start) => `${date}|${start || ''}`;

/** Map evaluatorId -> Set of "date|start" they have already claimed (from the roster's claimed evaluations). */
export function bookedSlots(guides) {
  const busy = new Map();
  for (const g of guides) {
    if (g.evaluatorId && g.date && g.status === 'claimed') {
      if (!busy.has(g.evaluatorId)) busy.set(g.evaluatorId, new Set());
      busy.get(g.evaluatorId).add(key(g.date, g.time));
    }
  }
  return busy;
}

/**
 * Who could evaluate `guide` at `tour`, best first: not the guide, not already
 * booked at that time, fewest evaluations so far, ties away from the evaluator
 * just used, then alphabetical. This is THE ordering rule -- the auto-match
 * screen and Vanessa both call it, so they cannot disagree about who is "best".
 *
 * @param o.taken  Map evaluatorId -> Set of "date|start" already committed
 * @param o.load   Map evaluatorId -> evaluations so far
 */
export function rankFreeEvaluators({ guide, tour, evaluators, taken = new Map(), load = new Map(), lastEvaluator = null }) {
  const n = id => load.get(id) ?? 0;
  return evaluators
    .filter(e => e.id !== guide.memberId && !taken.get(e.id)?.has(key(tour.date, tour.start)))
    .sort((a, b) => n(a.id) - n(b.id) || (a.id === lastEvaluator) - (b.id === lastEvaluator) || a.name.localeCompare(b.name));
}

/**
 * @param o.guides      state.guides-shaped rows: {id (eval id), guideId, name, status, rank, priority, tours:[{date,start,slot}], tourEligible?, memberId?}
 * @param o.evaluators  [{id, name, workload}] already filtered to people who may evaluate
 * @param o.busy        Map evaluatorId -> Set of "date|start" they are already committed to
 * @param o.today       ISO date; only tours after this (or today with a later start) count
 * @param o.now         HH:MM, for same-day tours
 */
export function suggestMatches({ guides, evaluators, busy = new Map(), today, now = '00:00' }) {
  const taken = new Map([...busy].map(([id, set]) => [id, new Set(set)]));
  const load = new Map(evaluators.map(e => [e.id, e.workload || 0]));
  const matches = [], unable = [], conflicts = [];
  let lastEvaluator = null;

  const needs = guides
    .filter(g => g.status === 'open')
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || String(a.name).localeCompare(String(b.name)));

  for (const g of needs) {
    if (g.tourEligible === false) { unable.push({ guide: g, reason: 'Marked not eligible for tours.' }); continue; }
    const tours = (g.tours || []).filter(t => t.date > today || (t.date === today && (t.start || '') > now))
      .sort((a, b) => a.date === b.date ? (a.start || '').localeCompare(b.start || '') : a.date.localeCompare(b.date));
    if (!tours.length) { unable.push({ guide: g, reason: 'No upcoming tour on the schedule yet.' }); continue; }

    let pick = null, skipped = 0;
    for (const t of tours) {
      const free = rankFreeEvaluators({ guide: g, tour: t, evaluators, taken, load, lastEvaluator });
      if (free.length) { pick = { t, e: free[0], free: free.length }; break; }
      skipped++;
    }
    if (!pick) { unable.push({ guide: g, reason: 'Every evaluator is already booked at each of their tour times.' }); continue; }

    const { t, e } = pick;
    if (!taken.has(e.id)) taken.set(e.id, new Set());
    taken.get(e.id).add(key(t.date, t.start));
    const before = load.get(e.id); load.set(e.id, before + 1); lastEvaluator = e.id;

    const reasons = [
      `${g.name} is scheduled to give a tour${t.slot ? ` (${t.slot})` : ''}`,
      `${e.name} has no other evaluation at that time`,
      'No evaluation yet this semester',
      g.priority ? `Marked ${g.priority}` : null,
      `${e.name} has ${before} evaluation${before === 1 ? '' : 's'} so far${pick.free > 1 ? ' — the fewest of those free' : ''}`,
      'Evaluator availability beyond existing bookings is not tracked'
    ].filter(Boolean);
    const m = { evalId: g.id, guideId: g.guideId, guideName: g.name, priority: g.priority, rank: g.rank, date: t.date, start: t.start, slot: t.slot,
                evaluatorId: e.id, evaluatorName: e.name, reasons, conflict: skipped > 0 };
    matches.push(m);
    if (skipped) conflicts.push({ ...m, note: `Their first ${skipped === 1 ? 'tour' : skipped + ' tours'} had no free evaluator, so a later one was used.` });
  }
  return { matches, unable, conflicts, needing: needs.length };
}

/** Priority tiers as the three plain bands the screens talk about. */
export function priorityBand(rank, needsEval = true) {
  if (!needsEval) return 'None';
  return rank <= 2 ? 'High' : rank <= 4 ? 'Normal' : 'Low';
}
