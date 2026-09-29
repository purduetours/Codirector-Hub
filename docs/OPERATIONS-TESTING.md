# Local verification

No suite in this upgrade needs production credentials or sends email. Fixtures are explicitly test-only and are never loaded by the frontend entry point.

Run from the repository root with Node 24 or a compatible version:

```sh
node --experimental-vm-modules tests/vanessa.test.mjs
node tests/reminder-worker.test.mjs
PGLITE_PATH=/absolute/path/to/@electric-sql/pglite/dist/index.js node tests/reminders-db.test.mjs
PGLITE_PATH=/absolute/path/to/@electric-sql/pglite/dist/index.js node tests/operations-db.test.mjs
PLAYWRIGHT_PATH=/absolute/path/to/playwright BROWSER_CHANNEL=chrome node tests/platform-ui.test.cjs
PLAYWRIGHT_PATH=/absolute/path/to/playwright BROWSER_CHANNEL=chrome node tests/browser-regression.test.cjs
HUB_TEST_ROOT=/absolute/path/to/Hub PLAYWRIGHT_PATH=/absolute/path/to/playwright node tests/click-isolation.test.cjs
```

PGlite is a local PostgreSQL-compatible engine. It exercises actual SQL RLS, triggers and RPC behavior. It does not emulate Supabase Auth infrastructure, hosted deployment privileges, PostgREST, pg_cron or real email delivery. The omitted historical committee migration is modeled explicitly in the fixtures, so staging role checks are still required.

The browser runner intercepts local files and aborts all other network requests. The UI suite tests 1440px desktop and 390px mobile layouts, personal reminder creation/completion, notification read state, Cmd/Ctrl+K search, arrow/Enter/Escape navigation, and a real Vanessa review/confirmation path. Optional `UI_SCREENSHOT_DIR` saves test-fixture screenshots for visual review. Screen-width checks and screenshots are useful evidence, not a complete accessibility or device certification.

The Node Vanessa harness now links cached modules once to handle circular ES-module imports and supplies the browser state accessed by current teardown code. Two outdated response-wording expectations were updated without removing their access/ownership assertions. The task-summary ordering bug that hid a saved draft behind a generic answer was fixed in application code.
