# Codirector Hub — developer notes

Everything a developer needs. **Administrators do not need this file** — see `ADMIN_GUIDE.md`.

## Architecture in one paragraph

A static site (no build step): `index.html` + ES modules in `js/`, hosted on GitHub Pages. Data and auth are **Supabase** (Postgres + Row Level Security + Auth); the browser talks to Supabase's REST API directly with the publishable key in `config.js`. The tour schedule, desk rota, absence form and majors list are **Google Sheets** read live as CSV (`js/core/sheets.js`). There is no Cloudflare/D1 and no server of our own. Optional reminder emails run from a Supabase Edge Function (`supabase/functions/tour-reminders`).

Security lives in the database: RLS policies + `security definer` functions. Hiding a tab is cosmetic. Anything an admin screen does goes through an `admin_*` function that checks the caller itself.

## Layout

```
index.html            shell (sidebar, top bar, dock)
config.js             Supabase URL + publishable key (public by design)
css/                  tokens, shell, components, home, hubs (navigation/admin), perf
js/core/              router, nav model, auth, state, db, sheets, palette, bell, Action Center, Vanessa
js/modules/           pages: today, evals, interviews, training, schedule, directory, desks,
                      announcements, people, guides, semester, settings, audit, health, hubs, more
supabase/             SQL migrations, functions, SQL tests
tests/                browser test pages (open via a static server)
```

Navigation is data: `js/core/nav.js` (hubs, groups, quick actions). Adding a page = register the module in `js/main.js`, add its id to a hub's `children` (and `groups`) in `nav.js`. Visibility comes from the module's `needs` (`'admin' | 'training' | 'recruitment'`).

## Setting up a new Supabase project

Run the SQL in this order in the Supabase SQL editor:

`01-schema` → `02-views` → `03-policies` → `04-functions` → `08-access` → `09-vanessa-submit` → `10-tour-reminders` → `11-active-users` → `12-enable-reminders` (optional) → `13-training` → `14-makeup-notes` → `15-training-history` → `16-training-codirectors-only` → `17-developer-reads-evals` → **`18-admin-operations`** → **`19-data-management`** → **`20-training-management`** → **`21-vanessa-agent`** (the assistant's confirmation records and usage numbers; nothing to deploy and no key to set — see `VANESSA_ARCHITECTURE.md`).

Then: Authentication → Sign In / Providers → allow new users to sign up (uninvited sign-ups land inactive and see nothing). Create the first administrator by inserting your email into `member_roster` with an admin role (the only SQL step ever needed), sign up in the app, done. From then on everything is in the UI.

### Known drift between the repo and production — read this

Production has things no earlier migration created (they were made by hand):

- tables `roles` and `member_roster`, and the `members.role` column;
- the sign-up trigger that copies name/role from `member_roster` into `members` on first sign-up;
- the live definitions of `is_codirector()`, `in_training()`, `in_recruitment()` (the repo's `03-policies.sql` says `is_codirector` is a column on `members`; production does not have that column).

`18-admin-operations.sql` declares the first two with `create table if not exists` (no-op in production) and **does not** replace `is_codirector()`. Its own gate is `hub_is_admin()` = active member whose role has `is_admin`, matching what the front end uses. **To close the drift, export the live definitions** (`select pg_get_functiondef(oid) from pg_proc where proname in ('is_codirector','in_training','in_recruitment','handle_new_user')` and the trigger on `auth.users`) **and commit them as a migration.** Until then a fresh project cannot be rebuilt from the repo alone.

## 18-admin-operations.sql — what it adds

Idempotent; never deletes. Tables: `app_settings`, `admin_audit`, `action_states`. Columns: archive fields on `members`/`guides`, term dates, `roles.description`. `eval_roster` gains `guide_active` (the app falls back if the view could not be replaced). Functions (all `admin_*`, `security definer`, gated by `hub_is_admin()`): save/archive/restore/import people, change role, update role, save/archive/restore/import guides, save term, **start semester (preview = real run, rolled back)**, set setting (refuses secret-like names), reminders get/set, health, pending sign-ups, log. Guards: last administrator, self-demote/archive, duplicate/started semester, valid roles/priorities, 500-row import cap. Every action writes `admin_audit`.

Tests: `supabase/tests/admin-operations.test.mjs` runs the migration (twice) against in-memory Postgres (PGlite) with stubs for the hand-made pieces.

## Front-end tests

Serve the folder (`python3 -m http.server`) and open:

- `tests/permissions.test.html` — what each role sees (nav, hubs, Vanessa) and cannot reach
- `tests/admin-ops.test.html` — CSV, settings parsing, Vanessa's admin requests and who may make them, Action Center per role
- `tests/vanessa.test.html`, `tests/vanessa-workspace.test.html` — Vanessa
- `tests/preview.html?role=admin|training|recruit|developer|guide` — the whole app against an in-memory stub (`tests/preview-stub.js`); for looking at screens, not for security. Add `&agent=local` for a pretend healthy local model, `&agent=down` for a configured one that isn't running (Vanessa must carry on in Standard mode); the default is Standard only
- `tests/click-isolation.test.cjs` — needs Playwright

Node tests (no dependencies, Node 20+):

- `npm test` (= `node --test tests/node/*.test.mjs`) — Vanessa: the intent corpus, Standard mode end to end, Enhanced mode against a fake local model, the typed tools, permissions, confirmation, time parsing, voice and formatting (279 tests, under a second)
- `npm run check` (= `node tests/tools/check.mjs`) — parses every JS file, resolves every import and named export, and enforces safety rules (no secrets, no eval, and **no paid-AI host, SDK or key anywhere** — Vanessa must run with no paid dependency)
- `node supabase/tests/<name>.test.mjs` — SQL tests against in-memory Postgres (`npm install @electric-sql/pglite` somewhere first)

There is no build step and no bundler; `package.json` exists only so Node treats the files as ES modules and to name the two scripts above. There is no separate linter or type checker: `npm run check` is the substitute.

## Configuration

- **Operational** (editable in Admin → Settings, stored in `app_settings`): sheet links, alert thresholds, contact, Vanessa admin toggle, reminder switch. Read via `setting(key, default)`.
- **Infrastructure** (never in the UI, never in `app_settings`): Supabase URL/key (`config.js`), Edge Function secrets (email provider key), sign-up switch. `admin_set_setting` rejects names containing secret/token/password/key.
- `config.js` `TERM_LABEL` is now only a fallback; the label comes from the current `terms` row.

## Deploying

Upload the repo to the GitHub Pages branch. Pages caches ~10 minutes; the sidebar footer shows the build time and says when a reload is needed.

## 19-data-management.sql — one identity, many sources

`guides` is the single canonical Tour Guide (new columns: `major`, `member_id`, `is_leadership`, `evaluator_eligible`, `tour_eligible`, `notes`). Everything external maps onto it.

```
Google Sheet -> adapter (table | grid) -> column mapping -> identity matching (browser: suggestions only)
             -> admin_sync_source (re-validates, stores once) -> source_records
             -> issues (sync_issues) -> a person resolves them -> identity mapping remembered
```

Tables: `external_sources` (one active per kind: `majors`, `tour_schedule`, `roster`), `column_templates` (mapping remembered by header signature), `source_records` (normalised rows, upserted on `(source_id, external_key)` so repeated syncs never duplicate), `external_identity_mappings` (one table for every source and alias; keyed by `(source_kind, external_key)` where the key is `name:…`, `email:…` or `id:…`; a confirmed mapping for another source acts as an alias), `sync_runs`, `sync_issues` (unique per issue per semester, so a decision is never re-asked), `field_ownership`, `guide_overrides` (a hand-set value, with the source value kept), `major_mappings`, `guide_terms` (person exists vs active this semester; `eval_roster.guide_active` honours it).

Server rules worth knowing: `hub_sync_source` **never stores a fuzzy link** (only bases `id|email|saved|exact|alias|confirmed`, and a saved decision beats whatever the browser inferred); the previewed sync is the real one rolled back (`D0002` exception trick); a source never overwrites a hand override or a Hub-owned field — it raises `conflicting_major` / `conflicting_email` instead; absent rows are marked inactive, never deleted; replacing a source retires the old rows. Roster-like sources raise `roster_missing_in_source` for guides the sheet lacks (inactive-this-semester is one click, never an archive).

Front end: `js/core/identity.js` (matching, pure), `js/core/sources.js` (adapters, column detection/templates, dates/times, matching + sync orchestration), `js/core/evalmatch.js` (pure auto-match), `js/modules/{guides,evalroster,sources,reconcile,datarules,datatable}.js`. `sheets.js` `loadTours()` prefers the stored schedule rows (one query, each already tied to a `guideId`) and falls back to reading the workbook when no schedule source is connected or synced yet; `evals.js attachTours` uses `guideId` when present.

Tests: `supabase/tests/data-management.test.mjs` (70 checks on in-memory Postgres) and `tests/admin-ops.test.html` (matching order, column recognition, date/time parsing, duplicate handling, auto-match rules, Vanessa).

Known limits: Google Sheets offers no key-less way to list a workbook's tabs, so the admin pastes the tab's link (or types its name). Syncing runs in the browser of whoever clicks Sync now (no server of our own); other users read the stored rows. `guides.email` is readable by all signed-in members, as `guides` already is. Merging two duplicate guides is deliberately not automated.

## 20-training-management.sql — training as sessions, requirements and computed completion

Reuses `training_sessions` / `training_attendance` / `training_history` unchanged (existing rows and their free-text statuses are understood as they are) and extends sessions into events (type, times, location, required, capacity, `status` draft/scheduled/completed/cancelled, `makeup_for`, `attendance_submitted_at`).

New: `training_requirements` (term, deadline, `rule` any|all, `audience` jsonb), `requirement_sessions` (approved sessions), `training_groups`/`_members` (cohorts), `training_overrides` (hand-set complete/waived/excused/incomplete with reason), `training_speakers` + `session_speakers` (name copied onto the session so guides see who, never contact details), `training_materials` (https-only), `training_templates`.

**Completion is computed, never stored twice.** `hub_requirement_rows(requirement)` resolves the audience (`hub_training_audience`: all / new = no earlier-term participation / leadership / evaluators / cohorts / chosen people) and returns each person's state from attendance: `complete`, `scheduled`, `makeup_needed`, `incomplete`, or a manual `waived`/`excused`/`complete`/`incomplete`. `hub_att_class` maps statuses to present / excused / absent / pending (so "Late" counts as present, and the old "Absent, Need Makeup" and "Makeup Completed" still work). A cancelled session drops out of a requirement; its attendance is kept.

Functions (`admin_*`, all audited, administrators only): session save/status/duplicate/delete-if-empty, `admin_make_makeup` (same requirements, seeded with who still owes it), `admin_set_attendance` / `admin_mark_all` / `admin_seed_attendance`, requirement save/sessions/archive/people/`from_sessions`, `admin_set_completion`, groups, speakers, materials, templates, `admin_create_from_template`, `admin_copy_training_setup` (previewed by rollback; copies requirements, audience *rules* — not chosen people — materials, and optionally draft sessions; never attendance, overrides or history). Read functions: `training_overview` (counts and sessions, no names — the committee may call it), `admin_training_matrix`, `admin_training_report`, `my_training` (the signed-in user's own state, via `guides.member_id`).

RLS: a member can read non-draft sessions, requirements, session speakers and materials; a Tour Guide linked to an account can read only their own attendance and overrides; speakers' contact details, groups, overrides of others and templates are administrators-only.

Front end: `js/modules/trainhub.js` (shell, overview, reports, "My training"), `train-sessions.js`, `train-people.js` (requirements, cohorts, people), `train-attendance.js`, `train-materials.js`, `train-data.js`; `js/core/vanessa-training.js`; Action Center items in `actioncenter.js` (`trainingItems`). Email is deliberately not wired: reminders open the user's own mail app; sending from the Hub would need the existing reminder Edge Function extended.

Tests: `supabase/tests/training-management.test.mjs` (87 checks, in-memory Postgres) and the training section of `tests/admin-ops.test.html`.


## 21-vanessa-agent.sql — the assistant

Adds `vanessa_actions` (every proposed change with the hash of what was shown, expiry, status), `vanessa_turns` (usage/failure metrics: which engine answered, which intent, how confident, how long — no text), `vanessa_begin_action` / `_confirm_action` / `_finish_action` / `_cancel_action`, `vanessa_log_turn`, `admin_vanessa_stats`, and replaces `hub_audit` so a change made through a confirmed Vanessa action is recorded with `admin_audit.via = 'vanessa'` (the Activity page shows "Vanessa on behalf of …"). Nothing existing changes meaning; nothing widens anyone's access. It lists **6 functions** at the end.

**Vanessa needs no AI service, no Edge Function and no secrets.** There is nothing to deploy and no key to set. (An earlier version of this file rate-limited a paid model; running this one on top of it removes those leftovers — `vanessa_gate`, `vanessa_requests`, token columns and their settings — and is safe to run twice.)

Optional: a model running on a Co-Director's own computer makes Vanessa more flexible with unusual wording. That is per-computer, set up in Admin → Vanessa, and documented in **`LOCAL_AI_SETUP.md`**. Shared setting: `vanessa.mode` (`auto` or `standard`), plus `vanessa.testMode`. Full details, security model, adding intents and tools, and debugging: **`VANESSA_ARCHITECTURE.md`**.

Tests: `supabase/tests/vanessa-agent.test.mjs` (42 checks, including that metrics store no content and nothing can be tagged "via Vanessa" without a real confirmation).
