/* Helpers every capability module shares. Nothing here knows about a specific intent. */
import { names, firstName } from '../engine/respond.js';

/** A parsed date range as the tool arguments that mean it. */
export const rangeArgs = r => (r ? { from: r.from, to: r.to ?? r.from, ...(r.label ? { label: r.label } : {}), ...(r.after ? { after_time: r.after } : {}), ...(r.before ? { before_time: r.before } : {}), ...(r.at ? { at_time: r.at } : {}) } : {});
/** The same, for tools that only take a date window (no times). */
export const windowArgs = r => (r ? { from: r.from, to: r.to ?? r.from, ...(r.label ? { label: r.label } : {}) } : {});

export const person = (q, i = 0) => q.filters.people?.[i] || null;
export const hasTag = (q, ...t) => t.some(x => q.tags?.includes(x));
export const hasToken = (q, ...t) => t.some(x => q.tokens?.includes(x));

/** "tomorrow 2 PM (2:00-3:00)" -> "tomorrow 2 PM": the bracketed slot is noise in a sentence. */
export const plainSlot = label => String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

export const guideNames = list => list.map(g => g.name || g);
export { names, firstName };

/** Chips offered after an answer; each one is a sentence Vanessa herself understands (a test checks). */
export const chips = (...c) => c.filter(Boolean).slice(0, 4);

export const bandLabel = b => ({ High: 'high priority', Normal: 'normal priority', Low: 'low priority' })[b] || '';
