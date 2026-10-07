/* ============================================================ time, deterministically
   "Friday", "next week", "after 3 PM" become real dates here, in code, in the
   application's timezone. The model is never asked to work out what day it is
   or what date next Friday falls on -- it passes the phrase through and this
   answers. That is the whole point: language models are confidently wrong
   about calendars.

   Pure functions. `now` and the timezone are arguments so tests are exact.
============================================================================ */
export const DEFAULT_TZ = 'America/Indiana/Indianapolis';
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

const pad = n => String(n).padStart(2, '0');
const utc = iso => new Date(iso + 'T12:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const weekday = s => utc(s).getUTCDay();
const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));

/** Today's date, and the time of day, as seen in `tz`. */
export function clock(now = new Date(), tz = DEFAULT_TZ) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  } catch {
    return { today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, tz: 'local' };
  }
  return { today: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, tz };
}

export function dayLabel(s, today) {
  if (!s) return '';
  if (today) {
    if (s === today) return 'today';
    if (s === addDays(today, 1)) return 'tomorrow';
    if (s === addDays(today, -1)) return 'yesterday';
  }
  const d = utc(s);
  return `${DAYS[d.getUTCDay()][0].toUpperCase()}${DAYS[d.getUTCDay()].slice(1)}, ${MONTHS[d.getUTCMonth()].slice(0, 3).replace(/^./, c => c.toUpperCase())} ${d.getUTCDate()}`;
}
export function timeLabel(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  const h = Number(m[1]), ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return m[2] === '00' ? `${h12} ${ap}` : `${h12}:${m[2]} ${ap}`;
}

/* ---- clock times: "3 pm", "3:30pm", "15:00" -------------------------------- */
function clockTime(txt) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(txt);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0), ap = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (min > 59 || h > 24) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && !m[2] && h <= 7) h += 12;               // "after 3" at a tour desk means 3 PM
  if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * @param {string} text   e.g. "tomorrow after 2pm", "next week", "this weekend", "Oct 9"
 * @returns {{ok:true, from?:string, to?:string, label:string, after?:string, before?:string, at?:string, semester?:string, needs?:string}
 *          | {ok:false, reason:string}}
 */
export function parseWhen(text, { now = new Date(), tz = DEFAULT_TZ } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, reason: 'No time was given.' };
  const { today } = clock(now, tz);
  let s = ` ${raw.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ')} `;
  const out = { ok: true, label: raw };

  /* time-of-day pieces first, so they do not confuse the date words */
  let m;
  if ((m = / (?:after|from|starting|past) (\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?) /.exec(s))) { out.after = clockTime(m[1]); s = s.replace(m[0], ' '); }
  if ((m = / (?:before|until|by|prior to) (\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?) /.exec(s))) { out.before = clockTime(m[1]); s = s.replace(m[0], ' '); }
  if (/ before (?:the )?(?:new guide |orientation |safety )?training /.test(s)) { out.needs = 'training_session'; s = s.replace(/ before (?:the )?(?:new guide |orientation |safety )?training /, ' '); }
  if ((m = / (?:at|@) (\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?) /.exec(s)) || (m = / (\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)) /.exec(s)) || (m = / (\d{1,2}:\d{2}) /.exec(s))) { out.at = clockTime(m[1]); s = s.replace(m[0], ' '); }
  if (/ morning /.test(s)) { out.before = out.before || '12:00'; s = s.replace(/ (?:in the )?morning /, ' '); }
  else if (/ afternoon /.test(s)) { out.after = out.after || '12:00'; out.before = out.before || '17:00'; s = s.replace(/ (?:in the )?afternoon /, ' '); }
  else if (/ (?:evening|tonight) /.test(s) && !/ tonight /.test(s)) { out.after = out.after || '17:00'; s = s.replace(/ (?:in the )?evening /, ' '); }
  else if (/ tonight /.test(s)) { out.after = out.after || '17:00'; }

  const set = (from, to, label) => { out.from = from; out.to = to ?? from; out.label = label; return out; };
  s = s.replace(/ (?:on|for|during|the|of|in|at) /g, ' ').replace(/\s+/g, ' ');
  s = ` ${s.trim()} `;

  if (/ (?:this|next|last) semester /.test(s)) { out.semester = /next/.test(s) ? 'next' : /last/.test(s) ? 'previous' : 'current'; out.label = `${out.semester === 'current' ? 'this' : out.semester === 'next' ? 'next' : 'last'} semester`; return out; }

  if (/ day after tomorrow /.test(s)) return set(addDays(today, 2), null, 'the day after tomorrow');
  if (/ (?:tomorrow|tmrw|tmr) /.test(s)) return set(addDays(today, 1), null, 'tomorrow');
  if (/ yesterday /.test(s)) return set(addDays(today, -1), null, 'yesterday');
  if (/ (?:today|tonight|now) /.test(s)) return set(today, null, 'today');

  if ((m = /(\d{4}-\d{2}-\d{2})/.exec(s))) {
    const d = m[1]; if (Number.isNaN(+utc(d)) || iso(utc(d)) !== d) return { ok: false, reason: `"${d}" is not a real date.` };
    return set(d, null, d);
  }
  if ((m = / (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))? /.exec(s))) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4)); if (y < 100) y += 2000;
    let d = `${y}-${pad(m[1])}-${pad(m[2])}`;
    if (Number.isNaN(+utc(d)) || iso(utc(d)) !== d) return { ok: false, reason: `"${m[0].trim()}" is not a real date.` };
    if (!m[3] && d < today) d = `${y + 1}-${pad(m[1])}-${pad(m[2])}`;
    return set(d, null, d);
  }
  const monthRe = new RegExp(` (${MONTHS.join('|')}|${Object.keys(MON_ABBR).join('|')}) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))? `);
  const monthRe2 = new RegExp(` (\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.join('|')}|${Object.keys(MON_ABBR).join('|')}) `);
  let mo, dd, yy;
  if ((m = monthRe.exec(s))) { mo = m[1]; dd = Number(m[2]); yy = m[3]; }
  else if ((m = monthRe2.exec(s))) { mo = m[2]; dd = Number(m[1]); }
  if (mo) {
    const mi = MONTHS.includes(mo) ? MONTHS.indexOf(mo) : MON_ABBR[mo];
    let y = yy ? Number(yy) : Number(today.slice(0, 4)); let d = `${y}-${pad(mi + 1)}-${pad(dd)}`;
    if (Number.isNaN(+utc(d)) || iso(utc(d)) !== d) return { ok: false, reason: `"${mo} ${dd}" is not a real date.` };
    if (!yy && d < today) d = `${y + 1}-${pad(mi + 1)}-${pad(dd)}`;
    return set(d, null, d);
  }

  if (/ (?:rest of (?:the )?week|remainder of (?:the )?week) /.test(s)) return set(today, addDays(mondayOf(today), 6), 'the rest of this week');
  if (/ this weekend /.test(s) || / (?:the )?weekend /.test(s) && !/ next /.test(s)) { const sat = addDays(mondayOf(today), 5); return set(weekday(today) === 0 ? today : weekday(today) === 6 ? today : sat, addDays(mondayOf(today), 6), 'this weekend'); }
  if (/ next weekend /.test(s)) { const sat = addDays(mondayOf(today), 12); return set(sat, addDays(sat, 1), 'next weekend'); }
  if (/ next week /.test(s)) { const mon = addDays(mondayOf(today), 7); return set(mon, addDays(mon, 6), 'next week'); }
  if (/ last week /.test(s)) { const mon = addDays(mondayOf(today), -7); return set(mon, addDays(mon, 6), 'last week'); }
  if (/ this week /.test(s) || / (?:the )?week /.test(s)) { const mon = mondayOf(today); return set(mon, addDays(mon, 6), 'this week'); }
  if (/ next month /.test(s)) { const d = utc(today); const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12)); const z = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 12)); return set(iso(a), iso(z), 'next month'); }
  if (/ last month /.test(s)) { const d = utc(today); const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12)); const z = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12)); return set(iso(a), iso(z), 'last month'); }
  if (/ this month /.test(s)) { const d = utc(today); const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)); const z = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)); return set(iso(a), iso(z), 'this month'); }
  if ((m = / (?:the )?next (\d{1,2}) days /.exec(s))) return set(today, addDays(today, Number(m[1])), `the next ${m[1]} days`);
  if (/ (?:upcoming|soon|coming up) /.test(s)) return set(today, addDays(today, 14), 'the next two weeks');

  const dayWord = Object.keys(ABBR).concat(DAYS).find(w => new RegExp(` ${w} `).test(s));
  if (dayWord) {
    const target = DAYS.includes(dayWord) ? DAYS.indexOf(dayWord) : ABBR[dayWord];
    const nextWord = new RegExp(` next ${dayWord} `).test(s), lastWord = new RegExp(` last ${dayWord} `).test(s);
    let d;
    if (lastWord) { d = addDays(today, -(((weekday(today) - target) + 6) % 7 + 1)); }
    else if (nextWord) { d = addDays(mondayOf(today), 7 + ((target + 6) % 7)); }
    else { d = addDays(today, (target - weekday(today) + 7) % 7); }
    return set(d, null, `${DAYS[target][0].toUpperCase()}${DAYS[target].slice(1)}`);
  }

  if (out.after || out.before || out.at || out.needs) { out.from = today; out.to = today; out.label = raw; return out; }
  return { ok: false, reason: `I couldn't turn "${raw}" into a date.` };
}

/** Is this clock time inside the window the phrase asked for? */
export function inWindow(time, w) {
  const t = String(time || '').slice(0, 5);
  if (!t) return !(w.after || w.before || w.at);
  if (w.at && t !== w.at) return false;
  if (w.after && t < w.after) return false;
  if (w.before && t >= w.before) return false;
  return true;
}

/** Clamp a range so it never starts in the past (for "what's coming up" questions). */
export function fromToday(range, today) {
  if (!range?.from) return range;
  return { ...range, from: range.from < today ? today : range.from, to: range.to < today ? today : range.to };
}
