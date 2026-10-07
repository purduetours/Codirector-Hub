/* Turn what went wrong into something a person can act on. The database already
   words its own refusals plainly (admin_* functions raise readable messages), so
   those pass through; the rest are translated. Raw error text is never shown. */
export function friendly(err) {
  const raw = String(err?.message || err || '');
  if (/failed to fetch|networkerror|could not reach|load failed/i.test(raw)) return 'I couldn’t reach the Hub’s server just now. Check the connection and try again.';
  if (/sign-in has expired|jwt|401|403/i.test(raw)) return 'Your sign-in has expired. Refresh the page and sign in again, then ask me again.';
  if (/foreign key|violates foreign|still referenced/i.test(raw)) return 'That person still has historical records, so they can’t be permanently deleted. I can archive them instead.';
  if (/duplicate key|already exists|unique constraint/i.test(raw)) return 'That already exists, so nothing was added.';
  if (/not null|null value/i.test(raw)) return 'Something required was missing, so it wasn’t saved.';
  if (/permission denied|row-level security|rls/i.test(raw)) return 'Your account isn’t allowed to do that.';
  if (/only administrators|administrator/i.test(raw)) return raw.length < 160 ? raw : 'That needs an administrator.';
  if (/timeout|timed out|aborted/i.test(raw)) return 'That took too long. Try again in a moment.';
  if (/^[A-Z][^]{8,220}[.!]$/.test(raw) && !/\b(select|insert|update|delete|function|syntax|column|relation|constraint)\b/i.test(raw)) return raw;
  return 'Something went wrong on the server, so that wasn’t saved. Nothing was changed.';
}
