/* Calendar ranges use local dates, matching the schedule's date strings. */
export const dayISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function dateRange(question, now = new Date()) {
  const q = question.toLowerCase();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  const exact = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q);
  if (exact) {
    start.setFullYear(+exact[1], +exact[2]-1, +exact[3]);
    if (dayISO(start) !== exact[0]) return { error: 'That date is not valid. Use YYYY-MM-DD.' };
    end.setTime(start.getTime());
  } else if (/\b(next|this) week\b/.test(q)) {
    // The workbook loader includes upcoming tours only. Be explicit about that.
    const mondayOffset = (start.getDay()+6)%7;
    if (/\bnext week\b/.test(q)) start.setDate(start.getDate()+7-mondayOffset);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6 - (end.getDay()+6)%7);
  } else if (/\btomorrow\b/.test(q)) {
    start.setDate(start.getDate()+1); end.setTime(start.getTime());
  } else {
    const weekday = DAY_NAMES.findIndex(day => new RegExp(`\\b${day}\\b`, 'i').test(q));
    if (weekday >= 0) {
      let delta = (weekday-start.getDay()+7)%7;
      if (/\bnext\b/.test(q) && delta === 0) delta = 7;
      start.setDate(start.getDate()+delta); end.setTime(start.getTime());
    } else if (!/\btoday\b/.test(q)) {
      if (/\b(yesterday|month|weekend|last|next|ago|january|february|march|april|may|june|july|august|september|october|november|december)\b|\d\s*\//.test(q))
        return { error: 'Which date do you mean? Use today, tomorrow, a weekday, this week, next week, or YYYY-MM-DD.' };
      return null;
    }
  }
  return { from: dayISO(start), to: dayISO(end), start, end };
}
