# Codirector Hub — Interviews implementation report

October 7, 2026. Implemented against the supplied repository snapshot. This package contains the Interviews work and requested sample-data feature. The earlier unfinished security/Vanessa hardening work remains separate and is not represented as completed or bundled here. No production database or deployment was accessed.

## Existing Interview Flow

The six existing concepts remain: Check in makes candidates available to interviewers; Grade is now **Evaluate**; Results shows aggregate scores and details; Decisions records Yes/Maybe/No; Roster is now **Applicants**; Setup handles imports, groups, and panel configuration. Applicants and Setup remain admin-only. There is no new dashboard, scheduling system, or interview pipeline.

The audit found manual-only saves, partial evaluations counted as complete, scores keyed by display names, dropped inactive-interviewer scores, current and historical cycles loaded together, and all active members incorrectly treated as the expected panel. Setup still described a spreadsheet and offered settings that did not actually save. The “clear another interviewer” action wrote to the signed-in person’s row despite its label.

## UX Changes

Evaluate is the default entry tab; the last tab is remembered during the session. Candidate rows show completion and remaining scores. Search handles accents and words in either order. The All / Not Started / In Progress / Complete filter is intentionally small. Previous/Next retains the sequence from the chosen list while scores save. Tabs have keyboard navigation and selection semantics; rubric controls have visible keyboard focus. Comments have more space, and the modal footer wraps on small screens. The existing Signal Noir appearance is retained with a solid, readable evaluation surface.

## Evaluation

The existing Speaking skill, Personable, and Overall impression criteria, 1–5 scale, and rubric labels are unchanged. Comments remain optional and are explicitly labeled as shared with Recruitment. Evaluations are keyed internally by candidate ID and member ID; identical names no longer merge people. Inactive and off-panel interviewers’ scores/comments remain available in the breakdown. The Today/Vanessa snapshot retains its existing public shape.

## Autosave

Changes update locally immediately and debounce for 450 ms. Each candidate has a serialized save queue; changes made during an in-flight request are sent afterward. Confirmed data updates in place rather than reloading the roster on every edit. Saved is shown only after the write response matches the intended candidate, interviewer, criteria, and comment. Empty responses and errors cannot report success.

Errors retain input and offer Retry save without exposing raw database details. Candidate switching, modal closure, and in-app navigation flush pending work. Browser departure warns about unsaved work. Session-scoped recovery is separated by account and interview cycle; recovered drafts require review and an explicit retry or new edit. Signing out stops the old account’s queue. Other accounts cannot see or submit its drafts through the UI.

## Completion

Complete requires all three valid scores to have saved. Missing criteria are named. Notes-only and partial evaluations show In Progress. Results distinguishes the number of scored evaluations from the number completed. Expected counts use the actual configured panel. An empty panel is labeled “panel not set”; the app does not invent an expected count.

## Results

The mathematical method is unchanged: average each criterion over nonblank scores, then average the available criterion means. Partial scores still contribute, as before, and the interface says so. Sorting remains transparent and introduces no hidden tie-breaker. Results includes completion counts, missing evaluator names, criterion breakdowns, authorized comments, manual refresh, and the existing CSV export with completion columns. Sample data is visibly flagged when present.

## Permissions

The established Recruitment boundary remains: Recruitment can read interview scores/comments, check candidates in, and record decisions. A score row belongs to its interviewer; even administrators cannot overwrite or clear another interviewer’s row. Database tests run under actual non-owner roles to verify this behavior. Administrators retain applicant/setup operations. Panel assignment is only a completion-count setting, not a permission grant.

## Sample Data

**Interviews → Setup → Load sample data** imports three clearly labeled fictional, checked-in applicants. The importing administrator gets one unstarted, one partial, and one complete example evaluation. No other interviewer is impersonated. Repeating the import preserves the existing samples and edits.

Samples are visible to Recruitment and included in results/exports until removed. **Remove sample data** explicitly confirms permanent removal of those samples and their evaluations. A protected database registry identifies the generated records; matching a name never makes a real applicant disposable. Both actions are admin-only, transactional, current-cycle scoped, and covered by permission/idempotency/data-preservation tests. Other interviewers start with their own empty evaluations on the same samples.

## Code Cleanup

Two focused modules separate completion/search/aggregate math and autosave state from the existing view module. The view keeps its public route and exports. Stale spreadsheet text was removed; cycle label is read-only instead of pretending to save. Groups and the actual panel save atomically. Check-in and decision updates now verify returned rows and prevent overlapping writes to the same candidate. No framework, build step, language migration, or additional service was introduced.

## Data Safety

The migrations do not rewrite existing applicants, scores, comments, identities, or aggregate views. Loading is scoped to the current cycle; old cycles remain stored. A database trigger prevents deleting a candidate with any recorded evaluation. Replacing an unscored roster is atomic: invalid input leaves the old roster intact. Panel changes never delete scores. Your own evaluation can still be explicitly cleared with confirmation. Sample cleanup is the narrow, registry-backed exception and cannot remove real applicants or their evaluations.

## Testing

The unchanged baseline passed **853 tests/checks**, plus 154 parsed files with no static problems. Initial file-read timeouts were resolved using a fresh unchanged snapshot and temporary test dependencies; they were infrastructure failures, not application test failures.

Final results:

| Suite | Passed | Failed |
|---|---:|---:|
| Node (`npm test`) | 291 | 0 |
| SQL — admin operations | 60 | 0 |
| SQL — data management | 70 | 0 |
| SQL — training management | 87 | 0 |
| SQL — Vanessa | 42 | 0 |
| SQL — Interviews and sample data | 41 | 0 |
| Browser — permissions | 76 | 0 |
| Browser — admin operations | 76 | 0 |
| Browser — Vanessa | 89 | 0 |
| Browser — Vanessa workspace | 47 | 0 |
| Browser — click isolation | 26 | 0 |
| Browser — Interviews and sample data | 43 | 0 |
| **Total** | **948** | **0** |

`npm run check`: **158 files parsed; 0 problems**.

The new tests cover validation, scoring arithmetic, partial and missing evaluations, rapid edits, pending writes, failed/empty responses, retry, candidate switching, comments, keyboard scoring, filtering, account isolation, recovery, sample imports, repeated imports, sample cleanup, history safety, and database authorization. SQL uses disposable PGlite/Postgres fixtures; browser network calls are isolated synthetic responses.

The scripted Chrome walkthrough exercised the full interview flow at 1440×1000 and 390×844, including failures and retries. Screenshots were visually reviewed. A separate interactive in-app browser walkthrough entered partial scores/comments, switched away and back, finished the evaluation, checked the saved breakdown and missing evaluator, and imported samples to verify all three completion states. This was local synthetic data, not a production smoke test or physical-device Safari test.

## Remaining Issues

- Deploy both new migrations before the static files: `22-interview-safety.sql`, then `23-interview-samples.sql`. Deployment instructions are included in `docs/INTERVIEWS.md` inside the ZIP.
- No production schema export is available. Fresh-install/disaster-recovery verification still requires the authoritative role/member/auth helper and signup-trigger definitions. The precise prerequisite is documented; test fixtures are not substitutes.
- Two devices editing the same interviewer’s same candidate row still have the existing last-write-wins behavior. Different interviewer IDs are isolated. This phase does not add multi-device conflict resolution.
- Session storage is not a backup. Closing a tab, blocked storage, or a browser suppressing exit warnings can defeat local recovery. Keep the tab open until Saved appears.
- Other interviewers’ results refresh manually. Physical mobile browsers, virtual keyboards, and the real deployment’s permissions still need the documented production smoke test.
