/* ============================================================ admin kit
   Small shared pieces for the administration screens, so they behave alike:
   one way to call an admin function and explain a failure, one empty state,
   one way to tell somebody the one-time setup has not been run.
============================================================================ */
import { rpc } from '../core/db.js';
import { esc, toast } from '../core/ui.js';
import { ICONS } from '../core/icons.js';

/** True when the database simply does not have the admin functions yet. */
export const setupMissing = err => /could not find the function|schema cache|does not exist|PGRST202/i.test(String(err?.message || err));

/** Call an admin function. Throws an Error whose message is fit to show a person. */
export async function admin(name, args = {}) {
  try {
    return await rpc(name, args);
  } catch (err) {
    if (setupMissing(err)) {
      const e = new Error('This needs the one-time admin setup. Ask a developer to run supabase/18-admin-operations.sql (see DEVELOPERS.md).');
      e.setup = true;
      throw e;
    }
    // Postgres wraps our messages; show just the sentence.
    throw new Error(String(err.message || err).replace(/^.*?(?:ERROR:|exception:)\s*/i, ''));
  }
}

/** A message that explains what is missing and what to do — never just "nothing here". */
export function emptyState({ title, text = '', action = '', icon = 'spark' }) {
  return `<div class="empty-state"><span class="es-mark">${ICONS[icon] || ICONS.spark}</span>
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

export const setupNotice = () => `<div class="callout setup-note"><strong>One-time setup needed.</strong>
  Some of these tools need a database update that has not been run yet. A developer can run
  <code>supabase/18-admin-operations.sql</code> in the Supabase SQL editor — it takes a few seconds, never deletes anything,
  and only has to be done once. Until then, older features keep working.</div>`;

export const fail = err => toast(err.message || String(err), 'err');

/** Pill markup for a status word. */
export const pill = (tone, label) => `<span class="pp-state ${tone}">${esc(label)}</span>`;

/** Query-string values from the current hash: "#/people?show=waiting" -> {show:'waiting'}. */
export function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
