/* ============================================================ shared workbooks
   The tour schedule and desk rota live in a workbook other people maintain, and
   they are not moving into the database. Nobody is going to start editing
   Postgres to say who is on the Welcome desk on Thursday.

   So the browser reads that workbook directly. No key, no sign-in, no server —
   the same trick the analytics hub uses. It is the last thing Apps Script was
   doing, which is what lets it go away entirely.
============================================================================ */

const SHEET_ID = '1XIfi_T4G1tkc_8D28cQWXUtCgk7Cb-BuyLrEvhfAzno';

/**
 * Which month tabs belong to the term we are in, and what year they are.
 *
 * The workbook keeps every month of the year as a tab and marks the ones that
 * are not this semester by HIDING them -- January through July still hold last
 * spring, full of guides who have since graduated. A browser reading the sheet
 * as CSV cannot see that a tab is hidden, so it has to know which months belong
 * to the term instead. That also fixes the year: "9/7" is unambiguous once you
 * know the term, where guessing the nearest year turned last January into next.
 *
 * Rolling over to spring is a one-word change in config.js.
 */
function termTabs() {
  const label = String(window.CONFIG?.TERM_LABEL || '');
  const m = /(spring|summer|fall|autumn)\s*(\d{4})/i.exec(label);
  const year = m ? Number(m[2]) : new Date().getFullYear();
  const isFall = !m || /fall|autumn/i.test(m[1]);
  return isFall
    ? { tabs: ['August', 'September', 'October', 'November', 'December'], year }
    : { tabs: ['January', 'February', 'March', 'April', 'MayJune', 'July'], year };
}
const DESK_TABS  = ['Front Desk', 'Welcome Desk'];
const SAT_TAB    = 'Saturdays';

const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december'];

/** Mon–Fri, three columns of guides each. */
const GRID_DAYS = [[3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17]];

/** Cells holding a note rather than a person. */
const NOT_A_GUIDE = /no tour|labor day|holiday|desk|closed|break|tentative|tours this week|❌/i;

/**
 * "Ben S.+", "Ben S.*" and "Ben S.`" are all just Ben S.
 *
 * The marks flag a picked-up or swapped shift. The old backend stripped * and +
 * but not the backtick, so names like "Alli S.+`" came through with the marks
 * still attached and never matched anybody on the roster.
 */
function cleanGuide(v) {
  return String(v || '').replace(/[*+`´'\s]+$/, '').trim();
}

function slotStart(slot) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?/.exec(String(slot || ''));
  if (!m) return '';
  let h = parseInt(m[1], 10);
  if (h < 8) h += 12;                       // 1:45 and 2:45 are afternoons
  return String(h).padStart(2, '0') + ':' + (m[2] || '00');
}

/**
 * Today, in the reader's own timezone.
 *
 * toISOString() is UTC, so after about 8pm Eastern it already reports tomorrow
 * and every one of today's tours gets filtered out as though it had happened.
 * Invisible all day, wrong every evening -- precisely when somebody checks what
 * they are leading tomorrow.
 */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The grid writes dates as "Monday 9/7" with no year. Pick whichever year puts
 * that date nearest to today, so a December tab read in January still lands on
 * the right side of the new year.
 */
function gridDate(text, year) {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(String(text || ''));
  if (!m) return '';
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Minimal CSV reader — quoted fields, embedded commas and newlines. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field); rows.push(row);
  return rows;
}

/* One trip per tab, per session.

   The same month grid is wanted by the Schedule tab, the Today screen, the
   guide roster and Vanessa's warm-up, and every one of them was fetching it
   from Google again -- a quarter of a second each, repeated four or five times
   for no new information. Holding the parsed rows removes all of that.

   The promise is what gets held, not the result, so two screens asking at the
   same moment share one request rather than racing. A tab that fails is not
   kept, so a dropped connection does not poison the rest of the session, and
   Refresh empties the lot. */
const tabCache = new Map();

/** Forget everything read from the workbook; the next ask goes to Google. */
export const bustSheets = () => tabCache.clear();

function fetchTab(tab) {
  if (tabCache.has(tab)) return tabCache.get(tab);

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
              `?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

  const pending = fetch(url)
    .then(res => (res.ok ? res.text() : null))
    .then(text => (text === null ? null : parseCSV(text)))
    .catch(() => null)          // a missing tab is normal, not an error
    .then(rows => {
      if (rows === null) tabCache.delete(tab);   // let a later try succeed
      return rows;
    });

  tabCache.set(tab, pending);
  return pending;
}

/**
 * Every week grid, as {date, start, slot, guide}, today onward.
 *
 * Slots are found by scanning for a time range in the Time column rather than
 * by counting rows. The old parser assumed every slot occupied exactly two rows
 * and so silently skipped any week where one had been resized — which is why
 * some tours never appeared in the hub at all.
 */
export async function loadTours() {
  const today = todayISO();
  const out = [], seen = new Set();
  const { tabs: months, year } = termTabs();
  const tabs = await Promise.all(months.map(fetchTab));

  tabs.forEach(rows => {
    if (!rows) return;
    const headers = [];
    rows.forEach((r, i) => { if (String(r[2] || '').trim() === 'Time') headers.push(i); });

    headers.forEach((h, hi) => {
      const stop = hi + 1 < headers.length ? headers[hi + 1] : rows.length;

      const dates = {};
      GRID_DAYS.forEach((cols, d) => {
        const iso = gridDate(rows[h][cols[0]], year);
        if (iso && iso >= today) dates[d] = iso;
      });
      if (!Object.keys(dates).length) return;   // whole week is in the past

      let slot = '', start = '';
      for (let r = h + 1; r < stop; r++) {
        const label = String(rows[r][2] || '').trim();
        if (label && label.includes('-')) { slot = label; start = slotStart(label); }
        if (!slot) continue;

        for (const d in dates) {
          for (const c of GRID_DAYS[d]) {
            const guide = cleanGuide(rows[r][c]);
            if (!guide || NOT_A_GUIDE.test(guide)) continue;
            const key = `${dates[d]}|${slot}|${guide}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ date: dates[d], start, slot, guide });
          }
        }
      }
    });
  });

  // Saturdays come from a separate tab in a different shape; same fields out.
  (await loadSaturdays()).forEach(t => {
    const key = `${t.date}|${t.slot}|${t.guide}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  });

  out.sort((a, b) => a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date));
  return out;
}

/**
 * Saturday tours, which live on their own tab and in their own shape.
 *
 * This was missing entirely. The month grids only run Monday to Friday, so
 * every Saturday tour the programme has ever run was invisible to the hub --
 * not shown on the schedule, and never offered when claiming an eval, which
 * meant a guide who only ever led on Saturdays could not be evaluated from
 * their schedule at all.
 *
 * The tab is laid out sideways compared with the month grids: one column per
 * Saturday, the date in the second row as "September 12" rather than "9/12",
 * and the guides listed straight down underneath. Times are fixed and written
 * in the footnote rather than in a column -- guides arrive at 8:30 and the
 * tour itself runs 9:45 to 11:15.
 *
 * The footnote also says one of the bolded guides stays back and does not give
 * the tour. Bold does not survive the export to CSV, so everybody listed is
 * treated as scheduled; better to offer one tour too many than to silently
 * drop somebody who did lead.
 */
const SAT_SLOT = '9:45-11:15';

function longDate(text, year) {
  const m = /([a-z]+)\s+(\d{1,2})/i.exec(String(text || ''));
  if (!m) return '';
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return '';
  return `${year}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function loadSaturdays() {
  const rows = await fetchTab(SAT_TAB);
  if (!rows || rows.length < 3) return [];

  const { year } = termTabs();
  const today = todayISO();

  // The row carrying the dates: the first one where more than one cell parses
  // as a date. Found rather than hard-coded, so an added title row does not
  // silently empty the whole tab.
  let dateRow = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const hits = rows[i].filter(c => longDate(c, year)).length;
    if (hits >= 2) { dateRow = i; break; }
  }
  if (dateRow < 0) return [];

  const out = [], seen = new Set();
  rows[dateRow].forEach((cell, col) => {
    const date = longDate(cell, year);
    if (!date || date < today) return;

    for (let r = dateRow + 1; r < rows.length; r++) {
      const guide = cleanGuide(rows[r][col]);
      if (!guide || NOT_A_GUIDE.test(guide)) continue;
      if (guide.split(/\s+/).length > 4) continue;      // the footnote, not a name
      const key = `${date}|${SAT_SLOT}|${guide}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ date, start: slotStart(SAT_SLOT), slot: SAT_SLOT, guide });
    }
  });
  return out;
}

/** The desk rota: a recurring Mon–Fri template rather than dated weeks. */
export async function loadDesks() {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const PAIRS = [[3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];
  const out = [];
  const tabs = await Promise.all(DESK_TABS.map(fetchTab));

  tabs.forEach((rows, t) => {
    if (!rows) return;
    rows.forEach(r => {
      const slot = String(r[2] || '').trim();
      if (!slot || !slot.includes('-') || !/^\s*\d/.test(slot)) return;
      const [a, b] = slot.split('-');
      DAYS.forEach((day, d) => {
        PAIRS[d].forEach(c => {
          const person = cleanGuide(r[c]);
          if (!person || NOT_A_GUIDE.test(person)) return;
          out.push({ desk: DESK_TABS[t], day, start: slotStart(a), end: slotStart(b), slot, person });
        });
      });
    });
  });
  return out;
}
