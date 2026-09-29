# Operations platform rollout

This package is a local implementation, not a production deployment. Do not publish the frontend before database setup and staging validation.

## Prerequisites

The deployed Hub must already have the role/committee helpers (`is_member`, `is_codirector`, `in_training`), evaluation tables/RLS and submission RPCs, migration 10 reminder settings, and training history from migrations 13–16. The repository omits the original intermediate role migrations. Recover their authoritative definitions from the deployed project's migration history before attempting a clean installation. Do not substitute the simplified helpers used in local test fixtures.

Review existing `members`, `roles`, `evals`, `eval_submissions`, `training_history`, grants and policies in staging. Source migrations 01–17 are historical context, not a script to rerun against an existing installation.

## Apply

1. Back up the existing database and test against a staging clone with representative roles.
2. Apply `supabase/18-operations-platform.sql` in a transaction through the normal Supabase migration process. It is repeatable; local tests apply it twice.
3. Verify personal reminders are visible only to their owner, including against administrator accounts. Verify training/administration activity remains leadership-only and evaluation activity follows current evaluation visibility.
4. Exercise claim, schedule, release, submission, identical submission retry, makeup completion and undo with real staging accounts. The new evaluation guard intentionally rejects protected-column edits from ordinary evaluators; confirm every legitimate deployed workflow uses the documented services/RPCs.
5. Publish the static frontend as one coordinated version. Existing explicit page bookmarks remain valid; the default landing page is Command Center.
6. Check desktop and mobile sign-in, the command palette, notification history and database logs. Use a hard refresh if the host caches ES modules.

No secrets or external email providers need to be configured for these additions. The existing email worker, scheduler and enablement settings are unchanged. In-app notification synchronization reads the existing `hours_before` setting, even when email is disabled, and runs when notifications or Command Center are loaded. This is not background delivery or push notification support. Undated-time evaluations use end of day for in-app reminders; the email worker still requires a tour time.

## Data model

- `hub_reminders`: private personal reminders with title, due time, completion and update timestamps. Owner RLS; selected columns can be updated. No team-wide surveillance of personal reminders.
- `hub_notifications`: server-created owner-scoped history. Read-only table for clients; the narrow `hub_read_notifications` RPC derives the current user. `hub_sync_notifications` deduplicates due reminders/evaluations.
- `hub_activity`: append-only client-facing audit history from database triggers. Evaluation claims, releases, schedule/reassignment/submission/review changes; reminder lifecycle; existing training history; member access changes. Names and entity IDs are included, but evaluation feedback, private absence reasons and email addresses are not copied into activity metadata.
- `hub_guard_eval`: prevents ordinary evaluators from editing administrative columns or silently changing submitted/other-owned evaluations. It preserves the existing atomic submission transaction.

History starts when migration 18 is installed. It does not manufacture old events, observe external spreadsheet edits, or assert whether a change originated in Vanessa versus a UI button. Both produce the same authoritative event; recent Vanessa action IDs are separately kept in device-local structured memory.

## Limits and rollback

Personal reminders and activity return at most 500 and 100 rows per read; notifications return the latest 200. The interface labels these bounds. Large-history pagination remains future work. Notifications persist after a reminder is completed; deleting a reminder removes its linked notifications. A date change has a distinct reminder notification identity.

A failed migration rolls back as one transaction. For a frontend rollback, redeploy the previous static release and leave the new tables/history in place. Do not drop personal data or audit records as a routine rollback. If the evaluation guard conflicts with a legitimate production workflow, restore the prior trigger behavior only after reviewing that workflow and its authorization requirements; do not relax RLS to make a test pass.

Inspect/clear Vanessa Memory under Workspace. It stores at most 30 account-and-Hub-scoped entity/action IDs plus timestamps for 30 days on the current browser. It does not sync devices. Existing saved evaluation drafts remain a separate feature and retain their existing clear/resume controls.
