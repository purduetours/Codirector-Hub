# Codirector Hub — Vanessa Operations Upgrade

Local implementation prepared September 29, 2026, from GitHub main `172016094ff4c4a270706baa7b5ff01d997c9d16`.

**Delivery status:** the standalone click fix is applied to the original Downloads project. The full platform upgrade is supplied as a separate source archive. Neither has been published to GitHub Pages, and no production database migration or outgoing email was executed. The full upgrade requires migration 18 and staging verification before rollout.

## 1. Features implemented

- Vanessa Command Center as the default landing page: personal evaluation workload, due reminders, tours today, unread notifications, prioritized next steps and accessible changes since the previous recorded visit.
- Natural-language claim/release, personal reminder creation/completion/deletion, notification reading and read-state changes, activity queries, filtered tour searches, evaluation assignment to a selected tour, operations and analytics summaries.
- Shared evaluation claim/release/scheduling service used by Eval Tracker and Vanessa. Reviewed releases include stale owner/date/time and submitted-state protections.
- Tour Operations daily timeline and seven-day summary, guide/evaluator joins using the existing roster matcher, exact-time collisions and recurring desk-template gaps. Coverage requirements and tour duration remain explicitly unknown.
- Personal reminder list, editing, completion/reopening and deletion; persisted in-app notifications with categories/read state/history; protected activity feed; leadership evaluation analytics with date filters and actual timestamp-based turnaround.
- Cmd/Ctrl+K palette with keyboard navigation, accessible modal behavior, pages, guides, currently loaded tours, reminders, notifications and a direct Vanessa request option.
- Structured page/entity context and bounded, account-and-Hub-scoped device memory with inspection and clearing. Existing evaluation drafts remain separate.
- Reorganized navigation, consistent dark/pink workspace surfaces, mobile cards, usable loading/error/empty states, visible keyboard focus and reduced-motion support.
- Original makeup-completion workflow and September 7 absence-warning suppression preserved.
- **Cross-page click bug fixed:** Home's `[data-vanessa]` shortcut selector matched the `<html data-vanessa>` animation attribute. A Home listener could also survive route changes. Shortcut buttons now use `data-vanessa-ask`; handlers are scoped to Home, aborted on teardown/remount, and the router tears down same-page refreshes.

## 2. Files added

- `css/operations.css`
- `docs/OPERATIONS-DEPLOYMENT.md`
- `docs/OPERATIONS-REPORT.md`
- `docs/OPERATIONS-TESTING.md`
- `docs/PLATFORM-AUDIT.md`
- `js/actions/registry.js`
- `js/actions/workspace-actions.js`
- `js/core/command-palette.js`
- `js/core/workspace-links.js`
- `js/modules/workspace-activity.js`
- `js/modules/workspace-analytics.js`
- `js/modules/workspace-command-center.js`
- `js/modules/workspace-memory.js`
- `js/modules/workspace-notifications.js`
- `js/modules/workspace-operations.js`
- `js/modules/workspace-reminders.js`
- `js/modules/workspace-shell.js`
- `js/modules/workspace.js`
- `js/services/evaluations.js`
- `js/services/memory.js`
- `js/services/operations.js`
- `js/services/workspace.js`
- `supabase/18-operations-platform.sql`
- `tests/browser-regression.test.cjs`
- `tests/click-isolation.test.cjs`
- `tests/operations-db.test.mjs`
- `tests/operations-test-results.txt`
- `tests/operations.test.html`
- `tests/platform-ui.test.cjs`

## 3. Files modified

- `index.html`
- `js/core/db.js`
- `js/core/icons.js`
- `js/core/router.js`
- `js/core/ui.js`
- `js/core/vanessa-data.js`
- `js/core/vanessa-exec.js`
- `js/core/vanessa-os.js`
- `js/core/vanessa-work.js`
- `js/core/vanessa.js`
- `js/main.js`
- `js/modules/desks.js`
- `js/modules/directory.js`
- `js/modules/evals.js`
- `js/modules/health.js`
- `js/modules/interviews.js`
- `js/modules/people.js`
- `js/modules/schedule.js`
- `js/modules/today.js`
- `js/modules/training.js`
- `tests/vanessa.test.mjs`

## 4. Database migrations added

`supabase/18-operations-platform.sql` adds private reminders, server-created notifications, an immutable audit table, indexes, owner/role-aware RLS, narrowly scoped notification RPCs and database triggers. Training activity bridges the existing training history; it does not duplicate attendance writes. A protected-column evaluation trigger preserves valid submission RPC transactions while rejecting unauthorized direct edits. The migration is tested twice for repeatability.

Deployment prerequisites, staged rollout, limitations and rollback guidance are in `docs/OPERATIONS-DEPLOYMENT.md`. The repository lacks historical role migrations between 04 and 08; their real deployed definitions must be recovered for a clean installation. Test-only helper definitions must never replace production authorization.

## 5. Major architecture changes

The new path is intent matching → entity resolution → action registry → current permission check → review where required → shared service → database → saved result. Every registered action has a description, kind, required fields, permission function, confirmation behavior, handler, success formatter and failure states. Model output is not authorization.

Workspace pages are separate modules sharing a small rendering shell. `js/services` owns new data operations and projections. Existing submission, training and conversational systems remain in place rather than being rewritten. The registry incrementally extends those systems; not every legacy conversational branch has been migrated into it.

## 6. Vanessa actions now supported

Examples:

- “Claim Alex’s eval.” Ambiguous matches produce a choice.
- “Release my Tuesday evaluation.” Review required; database state is rechecked.
- “Release this.” Uses the open evaluation context.
- “Show me tours Wednesday after 3 PM.” Date and time filters use the shared schedule.
- “Assign me the 3 PM tour on Wednesday.” Claims an eligible guide evaluation for that tour; does not alter upstream guide staffing.
- “Create a reminder for me to evaluate Xander tomorrow at 3 PM.” Reviews the title and explicit time; a date-only request proposes 9 AM in the device time zone.
- “Mark this reminder complete.” Uses the selected reminder, or requests a specific match.
- “Delete reminder Prepare notes.” Requires confirmation.
- “What notifications do I have?” / “Mark those as read.” / “Open the first notification.”
- “What changed today?” / “What happened with that evaluation?” Access remains database scoped.
- “When is their next tour?” Uses the current guide or an unambiguous retained entity ID.
- “What problems do we have tomorrow?” / “Show me evaluation analytics.”
- “Open reminders,” “Open tour operations,” and the existing navigation/makeup/evaluation-drafting workflows.

The system does not promise unrestricted understanding of arbitrary phrasing. Missing dates, ambiguous people and unsupported operations receive targeted clarification or an honest limitation.

## 7. Tests added

- `operations.test.html`: action metadata, confirmation/cancellation, account and role changes, ambiguous names, failure reporting, reminder/date parsing, context, tour filters, analytics, memory boundaries and cache behavior.
- `operations-db.test.mjs`: actual local SQL RLS, write restrictions, audit creation, notification deduplication/read state, evaluation races/submission retries, training/admin visibility and anonymous/inactive/non-training access.
- `platform-ui.test.cjs`: desktop/mobile audit of all major pages, reminder and notification interactions, palette keys, real Vanessa review/write flow and cross-page click isolation.
- `click-isolation.test.cjs`: independently runs against the original project; covers the exact Training controls reported and other pages, even with a deliberately retained Home handler, plus repeated Home visits.
- `browser-regression.test.cjs`: reproducible runner for all browser suites with nonzero exit on failed assertions.

## 8. Test results

| Suite | Passed | Failed |
|---|---:|---:|
| Existing browser suites | 183 | 0 |
| New operations browser suite | 34 | 0 |
| Node Vanessa regressions | 89 | 0 |
| Existing database suite | 31 | 0 |
| New operations database suite | 15 | 0 |
| Email-worker suite | 9 | 0 |
| Full platform UI suite | 88 | 0 |
| Original-project click-isolation suite | 26 | 0 |
| **Total checks** | **475** | **0** |

All 77 JavaScript source files passed syntax and relative-import checks. Desktop and mobile screenshots were visually inspected. Tests use local fixtures; no production records were changed. The Node harness was repaired for circular linking and current browser teardown APIs. Its saved-draft test exposed a real response-routing bug, which was fixed in application code. No access assertion was removed to obtain a pass.

This does not certify production schema compatibility, real devices, full screen-reader behavior or every data-dependent UI state. Staging validation remains necessary.

## 9. Security considerations

New tables use RLS; sensitive writes are not entrusted to Vanessa or UI visibility. Notifications cannot be forged through the client, audit rows are client-immutable, and personal reminder activity is private even from other administrators. Evaluation activity also checks current evaluation visibility. Events exclude evaluation feedback and private absence reasons. Confirmations bind the current account/session and recheck role; stale or failed writes are not announced as saved.

The browser continues to use the existing public Supabase key. No service-role key or external AI credential was added. Local structured memory stores IDs/timestamps, not chat transcripts. Historical role migrations are a deployment prerequisite, and local tests explicitly disclose their simplified committee fixtures.

## 10. Performance improvements

Concurrent workspace reads share one promise and a 30-second bounded cache. Failed reads can retry; mutations and session changes invalidate cached data. Roster loads are deduplicated within a session. Shared data reset now clears every kind, including training, and an old in-flight request cannot delete a newer request's cache entry. Outgoing view observers disconnect. Home handlers are aborted on unmount/remount; the palette's document shortcut is initialized once. No realtime subscriptions, large frontend framework or remote AI dependency was added.

The tests verify deduplication and retry behavior. No unsupported page-load speed percentage is claimed.

## 11. Remaining technical debt

- Missing historical role migrations prevent fully reproducible production bootstrap from this repository alone.
- Large existing Eval Tracker/Vanessa modules retain legacy code paths; new functionality is modular, but a broad rewrite was intentionally avoided.
- History lists have disclosed bounds rather than full pagination; persistent memory is browser-local and stores recency rather than sophisticated frequency ranking.
- External workbook loading and the existing name-matching model remain constraints. Changes made directly in those workbooks cannot currently produce reliable audit events.
- The project still lacks a committed package manifest/CI dependency lock for local test engines. Setup commands and dependency paths are documented.
- Mobile overflow and key flows were tested; a dedicated screen-reader and broader real-device audit would add confidence.

## 12. Intentionally not implemented, and why

- Writing actual guide staffing into the schedule: the repository exposes only a read-only workbook source, with no authoritative write API or durable tour assignment IDs. “Assign me” explicitly assigns an evaluation.
- Historical tour comparisons, causal explanations for trends, minimum staffing estimates and reminder-effectiveness claims: source snapshots, duration/capacity requirements or outcome data are missing. The UI states these limits.
- Monitoring other users' private unfinished reminders: violates the private owner model; leadership workload analytics uses authorized evaluation records instead.
- Email sending, staffing outreach, background push delivery or a new worker: these require delivery configuration and separate product rules. Existing email timing is reused where applicable, and outgoing delivery stays unchanged.
- Trusted “Vanessa versus button” origin attribution in the database: ordinary clients cannot prove their UI origin. Database audit records the authenticated actor and actual mutation; local memory records successful Vanessa action IDs.
- Cross-device memory sync, arbitrary conversation retention and new AI-provider secrets: unnecessary for safe structured context and outside the supported foundation.
- Production deployment/migration: not performed from this local development session.

## 13. Recommended next development steps

1. Deploy the standalone two-file click hotfix first; it requires no migration.
2. Recover the missing role migration history and apply migration 18 to staging. Validate real role accounts and existing admin workflows before deploying the full package.
3. Add durable tour IDs, explicit staffing requirements and a permission-checked scheduling API before enabling real guide assignment changes.
4. Retain authorized historical snapshots and define evaluation deadlines to support reliable trends and overdue semantics.
5. Add pagination, CI with pinned test dependencies, screen-reader testing and optional cross-device structured memory as usage grows.
