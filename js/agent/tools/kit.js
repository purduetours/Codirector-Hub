/* Shared helpers for tools. Nothing here touches the DOM or the network directly;
   everything goes through ctx.deps so tests can run the real tools on fake data. */
import { parseWhen, addDays, dayLabel, timeLabel, clock, fromToday } from '../time.js';
import { resolvePerson, PRONOUN, displayName } from '../entities.js';
import { can } from '../capabilities.js';

export class ToolError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

export const ok = (data, more = {}) => ({ ok: true, data, ...more });

/** Free text that came from records, spreadsheets or people. Shortened and flagged. */
export const untrusted = (s, n = 280) => {
  const t = String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const link = (ctx, label, page, params) => ({ label, route: ctx.deps.route(page, params) });
export const first = name => String(name || '').trim().split(/\s+/)[0] || '';

/** Limit a list for the model and the screen; always report the true count. */
export function top(list, n = 8) { return { items: list.slice(0, n), count: list.length, more: Math.max(0, list.length - n) }; }

/* ------------------------------------------------------------------ people */
export async function directory(ctx) { return ctx.deps.directory(); }

/**
 * One person, from a name, an id, or a pronoun. Throws a ToolError the model can
 * act on ("which Jordan?") rather than guessing.
 */
export async function personFrom(ctx, query, { write = false, activeOnly = false } = {}) {
  const dir = await directory(ctx);
  let q = String(query ?? '').trim();
  if (!q) throw new ToolError('missing_person', 'Who? A name is needed.');
  if (PRONOUN.test(q) || /^(?:me|myself|my|i)$/i.test(q)) {
    if (/^(?:me|myself|my|i)$/i.test(q)) {
      const me = dir.people.find(p => p.memberId && p.memberId === ctx.who.id);
      if (me) return me;
      throw new ToolError('not_linked', 'Your account is not linked to a Tour Guide record, so I can’t look you up as one.');
    }
    const f = ctx.state.focus?.person;
    if (f) { const p = dir.people.find(x => x.id === f.id); if (p) return p; }
    throw new ToolError('no_focus', 'I’m not sure who you mean. Give me a name.');
  }
  const byId = dir.people.find(p => p.id === q);
  if (byId) return byId;
  const r = resolvePerson(q, activeOnly ? dir.people.filter(p => p.active !== false) : dir.people);
  if (r.status === 'none') throw new ToolError('not_found', `I couldn’t find anyone called “${q}” in the Tour Guide list.`);
  if (r.status === 'many') throw new ToolError('ambiguous', `More than one person matches “${q}”. Ask which one.`,
    { candidates: r.candidates.map(c => ({ id: c.id, name: displayName(c), ...(can('people.read', ctx.who) ? { major: c.major || undefined } : {}), active: c.active !== false })) });
  if (r.fuzzy && write) throw new ToolError('confirm_name', `“${q}” isn’t an exact match. Did you mean ${displayName(r.person)}? Confirm the name before I change anything.`,
    { candidates: [{ id: r.person.id, name: displayName(r.person) }] });
  return r.person;
}

export async function peopleFrom(ctx, queries, opts = {}) {
  const out = [];
  for (const q of queries) out.push(await personFrom(ctx, q, opts));
  return [...new Map(out.map(p => [p.id, p])).values()];
}

/* -------------------------------------------------------------------- time */
export function windowOf(ctx, args, { fallback = 'today', future = false } = {}) {
  const { today, time } = clock(ctx.now, ctx.tz);
  let r;
  if (args.date) r = { ok: true, from: args.date, to: args.date, label: args.label || args.date };
  else if (args.from || args.to) r = { ok: true, from: args.from || args.to, to: args.to || args.from, label: args.label || `${args.from || args.to}${args.to && args.to !== args.from ? ` to ${args.to}` : ''}` };
  else r = parseWhen(args.when || fallback, { now: ctx.now, tz: ctx.tz });
  if (!r.ok) throw new ToolError('bad_time', r.reason);
  if (r.from && r.to && r.from > r.to) throw new ToolError('bad_time', 'The end date is before the start date.');
  if (r.from && r.to && (Date.parse(r.to) - Date.parse(r.from)) / 864e5 > 370) throw new ToolError('bad_time', 'That range is too long. Try a month or less.');
  if (args.after_time) r.after = args.after_time;
  if (args.before_time) r.before = args.before_time;
  if (args.at_time) r.at = args.at_time;
  if (future) r = fromToday(r, today);
  return { ...r, today, nowTime: time };
}

export const when = (ctx, date, start) => `${dayLabel(date, ctx.today)}${start ? ` at ${timeLabel(start)}` : ''}`;

/* ------------------------------------------------------ names on the schedule */
const initialsKey = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
/** Does a schedule label ("Jordan S.", "Jordan Smith") belong to this person? */
export function labelMatches(label, person) {
  const t = initialsKey(label);
  if (!t.length) return false;
  const f = initialsKey(person.first)[0] || '', l = initialsKey(person.last).join(' ');
  if (person.aliases?.some(a => initialsKey(a).join(' ') === t.join(' '))) return true;
  if (t.length === 1) return t[0] === f;
  const lastTok = t[t.length - 1];
  return t[0] === f && (lastTok === l || (lastTok.length === 1 && lastTok === l[0]) || l.startsWith(lastTok) && lastTok.length >= 3);
}

/** Slots (with guides as people where we can tell) between two dates, plus filters. */
export async function slotsIn(ctx, win, { people = [], includeAll = true } = {}) {
  const t = await Promise.resolve().then(() => ctx.deps.tours(win.from, win.to)).catch(() => ({ ok: false }));
  if (!t.ok) throw new ToolError('schedule_unavailable', 'The tour schedule isn’t loading right now, so I can’t check it.');
  let slots = t.slots.filter(s => s.date >= win.from && s.date <= win.to);
  const hasWindow = win.after || win.before || win.at;
  if (hasWindow) slots = slots.filter(s => { const x = String(s.start || '').slice(0, 5); if (!x) return false; if (win.at && x !== win.at) return false; if (win.after && x < win.after) return false; if (win.before && x >= win.before) return false; return true; });
  if (people.length) slots = slots.filter(s => people.every(p => s.guides.some(g => labelMatches(g, p))));
  slots.sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));
  return { slots, source: t };
}

export const slotLabel = (ctx, s) => `${dayLabel(s.date, ctx.today)}${s.start ? ` at ${timeLabel(s.start)}` : ''}${s.slot ? ` (${s.slot})` : ''}`;
export const slotId = s => `${s.date}|${String(s.start || '').slice(0, 5)}`;
export { addDays, dayLabel, timeLabel, clock, displayName };
