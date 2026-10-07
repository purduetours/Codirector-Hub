# Interviews: operation and handoff

The application remains a static site using JavaScript ES modules and Supabase. No build, language migration, additional server, or realtime subscription was added.

## Deployment

1. Back up the existing Supabase database and verify the deployment already has the repository’s existing schema and access policies.
2. Apply `supabase/22-interview-safety.sql`, then `supabase/23-interview-samples.sql` to that existing database before publishing the changed static files. It is rerunnable, changes no stored scores or aggregate formulas, protects candidates with recorded evaluations from deletion, and adds two administrator-only transactional functions for panel/groups and replacement of an unscored roster.
3. Publish the static files through the existing deployment process.
4. In Interviews → Setup, check the expected panel. The panel controls completion denominators; it does not grant Recruitment permission. An unconfigured panel is explicitly labeled instead of guessing that every active member is an interviewer.
5. Smoke-test with an authorized test account and a disposable candidate. Confirm score autosave, result visibility, and panel settings under actual deployed roles.

This change has not been deployed or connected to production.

## Production schema recovery prerequisite

No production schema export is available. A fresh deployment cannot be certified from this repository alone. Before a fresh installation or disaster recovery, recover the authoritative definitions of `roles`, `member_roster`, `members.role`, `is_codirector()`, `in_training()`, `in_recruitment()`, `handle_new_user()`, and the `auth.users` sign-up trigger from an authorized backup/export or the project’s database administrator. Reconcile their grants and RLS with the migration chain in a disposable database first. Do not invent these definitions from the tests: their fixtures are deliberately synthetic and prove local behavior, not production equivalence.

## Interview day

Check in makes applicants available for Evaluate. Evaluate opens directly and remembers the last tab within this browser session. Choose a candidate, score each of the three existing criteria from 1–5, and enter optional comments. Previous/Next keeps the candidate sequence from the chosen list, even when a completed evaluation leaves the current status filter.

All three valid scores are required for Complete. Comments are optional. Partial scores remain valid saved work, and, as before, they contribute to results. Results explains the unchanged formula: average each criterion across recorded scores, then average those available criterion means. Equal scores remain tied. Refresh results reads other interviewers’ latest saved work.

Recruitment can read interview scores/comments, check candidates in, and record decisions, as established by existing policies. Comments are shared with Recruitment, not private interviewer notes. An interviewer can edit only their own score row, including when they are an administrator. Administrators also have Applicants and Setup.

## Saving and recovery

Each candidate has an independent, serialized save queue. Input updates immediately; writes debounce for 450 ms. Edits arriving during an in-flight write are sent afterward. Saved appears only after the response contains the expected candidate, interviewer, scores, and comment. Empty responses, errors, and account changes cannot report success.

Failed writes retain the local values, explain the failure without displaying database details, and offer Retry save. Switching candidates and normal in-app navigation flush pending work. Network restoration retries pending work. Dirty evaluations warn before browser navigation/closing.

Drafts also use sessionStorage, scoped by signed-in member and interview cycle. Recovered drafts are shown for review and require an explicit retry (or a new edit); simply opening or leaving a recovered draft never applies it. Signing out stops the old account’s queue. Another account does not render those drafts.

Limits: sessionStorage is not a server backup; closing a tab may discard it, browsers may suppress exit prompts, and blocked storage leaves only in-memory protection. Keep the tab open until Saved appears. Two devices editing the *same interviewer’s same candidate row* still use the existing last-write-wins database behavior. Different interviewer IDs cannot overwrite each other. This phase adds no multi-device conflict-resolution protocol.

## History safeguards

Panel changes preserve scores and evaluator IDs, including inactive or off-panel raters. Identical display names do not merge records. Candidate loading is scoped to the current cycle; prior cycles remain stored. Applicant deletion and roster replacement cannot remove a candidate that has any evaluation row, including a notes-only or cleared evaluation. Replacement imports are atomic: invalid input leaves the existing roster intact.

Clearing your own evaluation is an explicit, confirmed action. Administrators cannot clear somebody else’s evaluation; the previous UI incorrectly offered that action while actually writing to the administrator’s own row. Normal users do not see applicant/setup controls.

## Tests

- `npm test`: existing Node tests plus interview math, validation, search, queue/race, failure/retry, recovery, identity isolation, and storage failure tests.
- `npm run check`: static source checks.
- `node supabase/tests/interviews.test.mjs`: real disposable Postgres via the same optional `@electric-sql/pglite` test dependency used by other SQL suites. Includes actual RLS checks under non-owner roles, migration rerun, aggregate compatibility, permissions, history protection, and transactional rollback.
- `PLAYWRIGHT_PATH=/path/to/playwright QA_OUTPUT=/path/to/screenshots node tests/interviews.test.cjs`: Chrome integration walkthrough with synthetic data and all external requests blocked. Set QA_OUTPUT to an existing writable directory. Covers switching, comments, autosave, pending writes, failed/empty responses, retries, completion, keyboard interaction, roles, account changes, recovery, and 1440/390 px layouts.
- Existing browser HTML suites and `tests/click-isolation.test.cjs` remain applicable.

The browser walkthrough uses the real rendered UI and controlled database responses; database permissions are separately checked in Postgres. Neither substitutes for the production smoke test above or testing actual mobile Safari/virtual keyboards.

## Sample data

Administrators can use Setup → Load sample data to add three fictional, checked-in applicants. The importer records a partial and complete example evaluation under the importing administrator’s own identity; it never impersonates another interviewer. Repeating the action preserves existing samples and edits. The first import demonstrates Not Started, In Progress, and Complete for that administrator. Other interviewers begin with their own empty evaluations.

Samples are stored in the current cycle and visible to Recruitment. Their names and Results notice identify them as sample data; they contribute to results and exports until removed. Setup → Remove sample data explicitly confirms permanent removal of those sample applicants and their evaluations. A protected database registry determines which records qualify; a name match never qualifies a real applicant for deletion. Non-admins cannot import, remove, or forge that registry. Real applicants, comments, and past cycles stay untouched.
