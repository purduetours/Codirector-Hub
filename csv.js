/* ================================================================ downloads
   Getting data back out of the hub.

   This matters more than it looks. Two separate times this term a bulk edit
   rewrote dozens of attendance rows, and the only reason it could be put right
   was that the original spreadsheet still existed to compare against. Once the
   hub is the only copy — which is the point of moving off spreadsheets — that
   safety net is gone unless somebody can take one.

   Shared rather than written per module, because the fiddly parts are the same
   everywhere: quoting a value that contains a comma, and the byte order mark
   without which Excel mangles every accented name.
========================================================================== */

/** A value safe to sit in a CSV cell. */
const cell = v => {
  const t = String(v ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * Offer `rows` to the person as a file.
 *
 * `rows` is an array of arrays, the first being the header. The name gets
 * today's date appended, so a folder of these sorts itself.
 */
export function downloadCsv(name, rows) {
  const body = rows.map(r => r.map(cell).join(',')).join('\r\n');

  // ﻿ is the byte order mark. Without it Excel reads the file as Latin-1
  // and turns María into MarÃ­a — which this project has already had to fix
  // once, in the database, by hand.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  a.href = url;
  a.download = `${name}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a delay: revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length - 1;                 // how many data rows went out
}

/* ================================================================== reading
   The other direction: a file somebody chose, turned into rows. Handles what
   spreadsheets really produce — a byte order mark, Windows line endings,
   quoted cells with commas, quotes and newlines inside them, and a ragged last
   line. Pure and synchronous, so a preview costs nothing and tests can reach it.
========================================================================== */

/** Text -> array of arrays. Blank lines are dropped. */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * A CSV with a header row -> records keyed by a forgiving version of each
 * header ("Full Name", "full_name" and "FULL NAME" are all "fullname"), so the
 * file does not have to be spelled exactly the way the importer expects.
 */
export function readTable(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: [], records: [] };
  const key = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows[0].map(key);
  return { headers, records: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

/** First non-empty value among several possible header spellings. */
export const pick = (rec, ...keys) => { for (const k of keys) if (rec[k]) return rec[k]; return ''; };
