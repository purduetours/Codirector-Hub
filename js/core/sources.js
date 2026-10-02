/* ============================================================ connected sources
   One pattern for every spreadsheet the Hub learns from:

     External source  ->  adapter  ->  column mapping  ->  identity matching
       ->  validation  ->  PREVIEW  ->  normalised internal data  ->  reconciliation

   A "source" is a Google Sheet (and the tab and layout inside it) that feeds one
   kind of data:

     majors         Tour Guides by Major: who is on the roster, their major, email
     tour_schedule  who gives which tour, and when
     roster         an optional master roster sheet, same shape as majors

   Replacing a sheet — a new January schedule, a new majors list — is the same
   steps for each: paste the link, pick the tab, confirm the columns, preview,
   review the people it could not place, activate. Nothing here is hardcoded to
   one workbook, and no step needs code or SQL.

   Adapters
     table   one row per person (or per tour): any headers, mapped by the admin,
             and remembered (as a template keyed by the headers) for next time
     grid    the weekly-grid schedule Purdue has used so far (month tabs, times
             down the side, days across) — read by the existing grid reader

   Where the work happens: the sheet is read in the browser of whoever clicks
   Sync (Google Sheets offers no other no-key way), matched here as SUGGESTIONS,
   and handed to admin_sync_source, which re-checks everything, stores the
   normalised rows once, and is the only thing that links people. Everyone else
   then reads the stored rows with one small query — nobody re-downloads or
   re-parses the sheet on a page load.
============================================================================ */
import { select } from './db.js';
import { readSheet, loadToursGrid } from './sheets.js';
import { matchIdentity, indexMappings, nameKey, emailKey, normName } from './identity.js';
import { termLabel } from './state.js';
import { admin } from '../modules/admin-kit.js';

/* --------------------------------------------------------------- the link */
/** A pasted Google Sheets link (or bare id) -> { id, gid }. */
export function parseSheetLink(text) {
  const t = String(text || '').trim();
  const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(t);
  const id = m ? m[1] : /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : '';
  const gid = /[#&?]gid=(\d+)/.exec(t)?.[1] || '';
  return { id, gid };
}

/* ------------------------------------------------------------- the fields */
export const KINDS = {
  majors:        { label: 'Tour Guides by Major', blurb: 'Who is on the roster, their major and email.', adapters: ['table'] },
  tour_schedule: { label: 'Tour Schedule',        blurb: 'Who gives which tour, and when.',            adapters: ['grid', 'table'] },
  roster:        { label: 'Master roster sheet',  blurb: 'An optional list of every Tour Guide.',      adapters: ['table'] }
};

/** Mappable fields per kind: [key, label, required?] */
export const FIELDS = {
  majors: [['first', 'First name'], ['last', 'Last name'], ['name', 'Full name (if not split)'], ['email', 'Email'], ['major', 'Major(s)'], ['extId', 'Stable ID (optional)']],
  roster: [['first', 'First name'], ['last', 'Last name'], ['name', 'Full name (if not split)'], ['email', 'Email'], ['major', 'Major(s)'], ['extId', 'Stable ID (optional)']],
  tour_schedule: [['name', 'Tour Guide'], ['first', 'First name'], ['last', 'Last name'], ['date', 'Date'], ['start', 'Start time'], ['slot', 'Time slot / name of tour'], ['evaluator', 'Evaluator (optional)'], ['extId', 'Stable ID (optional)']]
};

const SYNONYMS = {
  first: ['first name', 'firstname', 'first', 'given name', 'preferred first name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'guide', 'tour guide', 'student name', 'student', 'person', 'ambassador', 'guide name'],
  email: ['email', 'e-mail', 'purdue email', 'email address', 'student email'],
  major: ['major(s)', 'majors', 'major', 'program', 'degree', 'area of study', 'field of study'],
  date: ['date', 'tour date', 'day', 'when'],
  start: ['start', 'start time', 'time', 'tour time', 'begins'],
  slot: ['slot', 'time slot', 'tour', 'tour name', 'session', 'time range'],
  evaluator: ['evaluator', 'evaluated by', 'evaluating', 'observer'],
  extId: ['id', 'puid', 'guide id', 'student id', 'person id']
};

const norm = h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Guess which column is which. Exact header wins, then "contains". */
export function suggestMapping(kind, headers) {
  const map = {}, used = new Set();
  for (const [field] of FIELDS[kind] || []) {
    const syn = SYNONYMS[field] || [];
    let hit = headers.find(h => !used.has(h) && syn.includes(norm(h)));
    hit ||= headers.find(h => !used.has(h) && syn.some(s => s.length > 3 && norm(h).includes(s) && !(field === 'name' && /(first|last)/.test(norm(h)))));
    if (hit) { map[field] = hit; used.add(hit); }
  }
  // a split name beats a single name column that was only a loose guess
  if (map.first && map.last && map.name && !SYNONYMS.name.slice(0, 2).includes(norm(map.name))) delete map.name;
  return map;
}

/** The first row that looks like headers: several non-empty, mostly text cells. */
export function headerRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = rows[i].map(c => String(c ?? '').trim()).filter(Boolean);
    if (cells.length >= 2 && cells.filter(c => !/^[\d./:-]+$/.test(c) && !c.includes('@')).length >= Math.ceil(cells.length * .7)) return i;
  }
  return 0;
}

/** Same headers, same mapping: a stable signature to remember a mapping under. */
export const headerSignature = headers => headers.map(norm).filter(Boolean).sort().join('|');

/* ------------------------------------------------------------ dates/times */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

/** Dates as people write them -> YYYY-MM-DD. A year-less date takes the semester's year. */
export function parseDate(text, defaultYear = new Date().getFullYear()) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = /(\d{1,2})\/(\d{1,2})(?!\d)/.exec(t))) return `${defaultYear}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = /([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i.exec(t))) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3] || defaultYear}-${pad(mi + 1)}-${pad(m[2])}`;
  }
  return '';
}

/** "10:00 AM", "10am", "14:30", "10-11" -> 24-hour HH:MM of the start. */
export function parseTime(text) {
  const t = String(text ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/.exec(t);
  if (!m) return '';
  let h = +m[1]; const min = m[2] || '00', ap = m[3];
  if (ap?.startsWith('p') && h < 12) h += 12;
  if (ap?.startsWith('a') && h === 12) h = 0;
  if (!ap && h < 8) h += 12;                       // 1:45 and 2:45 are afternoons on a tour schedule
  return h > 23 ? '' : `${pad(h)}:${min}`;
}

/* ---------------------------------------------------------- reading rows */
const clean = s => String(s ?? '').replace(/[*+`´]+\s*$/, '').trim();

/**
 * Turn the sheet's rows into normalised records. Nothing is saved; everything
 * the admin should know about (skipped rows, duplicates) comes back as warnings.
 *
 * @returns { records, warnings, headers, sample }
 */
export function tableToRecords({ kind, rows, map, year }) {
  const hi = headerRowIndex(rows);
  const headers = (rows[hi] || []).map(h => String(h ?? '').trim());
  const col = field => (map[field] ? headers.indexOf(map[field]) : -1);
  const cell = (r, field) => { const i = col(field); return i < 0 ? '' : clean(r[i]); };
  const out = [], warnings = [], seen = new Set();
  let skipped = 0, dupes = 0;

  for (const r of rows.slice(hi + 1)) {
    if (!r.some(c => String(c ?? '').trim())) continue;
    const first = cell(r, 'first'), last = cell(r, 'last');
    const name = (first || last) ? `${first} ${last}`.trim() : cell(r, 'name');
    const email = cell(r, 'email').toLowerCase();
    if (!name && !email) { skipped++; continue; }
    const shownName = name || email.split('@')[0];
    const rec = { name: shownName, email: email.includes('@') ? email : '', extId: cell(r, 'extId'), identity: nameKey(shownName),
      payload: { first, last, major: cell(r, 'major'), evaluator: cell(r, 'evaluator') } };

    if (kind === 'tour_schedule') {
      const date = parseDate(cell(r, 'date'), year);
      if (!date) { skipped++; continue; }
      const start = parseTime(cell(r, 'start')) || parseTime(cell(r, 'slot'));
      const slot = cell(r, 'slot') || cell(r, 'start');
      Object.assign(rec, { occurred_on: date, slot, start_time: start, key: `${date}|${slot || start}|${nameKey(shownName)}` });
    } else {
      rec.key = rec.email || rec.identity;
    }
    if (seen.has(rec.key)) { dupes++; continue; }
    seen.add(rec.key);
    out.push(rec);
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? ' was' : 's were'} skipped (${kind === 'tour_schedule' ? 'no readable date or guide' : 'no name or email'}).`);
  if (dupes) warnings.push(`${dupes} duplicate row${dupes === 1 ? ' was' : 's were'} ignored.`);
  return { records: out, warnings, headers, sample: out.slice(0, 5) };
}

/** Grid-layout schedule rows -> the same record shape. */
export function gridToRecords(tours) {
  const seen = new Set(), out = [];
  for (const t of tours) {
    const identity = nameKey(t.guide), key = `${t.date}|${t.slot || t.start}|${identity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, identity, name: t.guide, email: '', extId: '', occurred_on: t.date, slot: t.slot, start_time: t.start, payload: {} });
  }
  return { records: out, warnings: [], headers: [], sample: out.slice(0, 5) };
}

/** Read a source definition end to end. Throws plain-language errors. */
export async function readSource(src) {
  const year = Number((/(\d{4})/.exec(termLabel()) || [])[1]) || new Date().getFullYear();
  if (src.adapter === 'grid') {
    const tours = await loadToursGrid(src.sheet_id);
    if (!tours.length) throw new Error('No upcoming tours were found. Check this is the right workbook and that it has this semester’s month tabs.');
    return { ...gridToRecords(tours), rows: tours.length };
  }
  const rows = await readSheet({ sheetId: src.sheet_id, tab: src.tab, gid: src.gid });
  if (rows.length < 2) throw new Error('That tab is empty or has only a header row.');
  const out = tableToRecords({ kind: src.kind, rows, map: src.column_map || {}, year });
  return { ...out, rows: rows.slice(headerRowIndex(rows) + 1).filter(r => r.some(c => String(c ?? '').trim())).length };
}

/** Headers and a suggested mapping for a freshly chosen tab, reusing a remembered template when there is one. */
export async function inspectTab({ kind, sheetId, tab, gid }) {
  const rows = await readSheet({ sheetId, tab, gid });
  const hi = headerRowIndex(rows);
  const headers = (rows[hi] || []).map(h => String(h ?? '').trim()).filter(Boolean);
  let remembered = null;
  try {
    const sig = headerSignature(headers);
    const t = (await select('column_templates', `select=column_map,adapter&kind=eq.${kind}&signature=eq.${encodeURIComponent(sig)}`))?.[0];
    if (t && Object.values(t.column_map).every(h => headers.includes(h))) remembered = t.column_map;
  } catch { /* templates are an optimisation */ }
  return { headers, rows, headerRow: hi, map: remembered || suggestMapping(kind, headers), remembered: !!remembered };
}

/* --------------------------------------------------------------- matching */
export async function loadMatchContext() {
  const [guides, maps] = await Promise.all([
    select('guides', 'select=id,first_name,last_name,full_name,email,active&order=last_name.asc'),
    select('external_identity_mappings', 'select=external_key,source_kind,guide_id,ignored,confirmed').catch(() => [])
  ]);
  return { guides, mappings: indexMappings(maps) };
}

/** Attach a match to every record, and count the outcomes for the preview. */
export function matchRecords(records, kind, ctx) {
  const counts = { auto: 0, saved: 0, alias: 0, review: 0, ignored: 0 };
  for (const r of records) {
    r.match = matchIdentity(r, { kind, guides: ctx.guides, mappings: ctx.mappings });
    const b = r.match.basis;
    if (b === 'id' || b === 'email' || b === 'exact') counts.auto++;
    else if (b === 'saved') counts.saved++;
    else if (b === 'alias') counts.alias++;
    else if (b === 'ignored') counts.ignored++;
    else counts.review++;
  }
  return counts;
}

const toServer = r => ({
  key: r.key, identity: r.identity, name: r.name, email: r.email || null, payload: { ...r.payload, extId: r.extId || undefined },
  occurred_on: r.occurred_on || null, slot: r.slot || null, start_time: r.start_time || null,
  guide_id: r.match?.guideId || null, basis: r.match?.basis || null, candidates: r.match?.candidates?.length ? r.match.candidates : null
});

/** Preview (apply=false) or run (apply=true) a sync of already-matched records. */
export const syncRecords = (sourceId, records, apply) =>
  admin('admin_sync_source', { p_source: sourceId, p_rows: records.map(toServer), p_apply: !!apply });

/** Read + match + sync one connected source. The one function Sync Now calls. */
export async function runSync(src, { apply = true } = {}) {
  let read;
  try { read = await readSource(src); }
  catch (e) { await admin('admin_source_failed', { p_source: src.id, p_message: e.message }).catch(() => {}); throw e; }
  const ctx = await loadMatchContext();
  matchRecords(read.records, src.kind, ctx);
  return { ...read, result: await syncRecords(src.id, read.records, apply) };
}
