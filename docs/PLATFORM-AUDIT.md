# Architecture audit before the platform upgrade

Baseline: GitHub main 172016094ff4c4a270706baa7b5ff01d997c9d16. Static ES modules with hash routing, Supabase REST/RPC and row-level security. Existing Vanessa includes deterministic intents, optional local models, reviewed evaluation submission, makeup actions, contextual forms and conversational follow-ups. Preserve those paths.

Reuse: module loaders, shared roster/workbook data, `db.js`, training history, atomic evaluation submission, existing modal/focus system, notification timing from the email settings (without enabling email delivery).

Identified gaps: tracker claim/release writes duplicated across UI; release lacked stale/submitted checks; shared cache reset left training data; browser VM test loader recursively linked cycles. No persistent in-app reminders/notifications/audit feed or command palette. Public workbook provides upcoming named tours, not expected staffing, historical snapshots or a supported write endpoint. Do not claim missing guide coverage or historical trends from absent data.

Database source omits migrations between 04 and 08, although production uses roles and committee helpers. New migration requires the existing deployed role helpers; local fixtures explicitly model these missing prerequisites. Never apply source migrations blindly to production. Local verification does not prove the production deployment schema matches.

Implementation boundaries: new UI and Vanessa call shared services; PostgreSQL independently authorizes writes. Store structured IDs rather than chat history. No production credentials, external sends, deployments or schedule writes are part of local implementation.
