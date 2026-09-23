# Vanessa update

## Install

This ZIP contains the complete project from this conversation, including `index.html`, `config.js`, all JavaScript and CSS, database scripts, setup instructions, and tests. Extract the ZIP and place its contents at the root of your repository, keeping `index.html` at the root. If you have changed your configuration or code since the original upload, preserve those newer changes when merging. Deploy through your existing GitHub workflow. No application code changed in this full-project repackaging.

Read **REMINDERS-SETUP.md** for the exact setup order. Rerun the updated `09-vanessa-submit.sql`, then run `10-tour-reminders.sql` and `11-active-users.sql` in your existing Supabase project. The active-user list and new Vanessa features can be used independently of email activation. Email additionally needs the server function, provider credentials, your verified account for CC, and the final `12-enable-reminders.sql` step.

This package has not been committed, deployed, or activated on your behalf. Reload the site after deploying the changed files.

## New in this package

- **Personal tasks:** Ask “What do I need to do?” or “my tasks” for your pending claimed evals, tour dates, missing dates/times, and how to resume your saved draft. The summary uses loaded data and Purdue local dates.
- **Follow-up questions:** Short vague feedback such as “good” or “good but quiet” prompts one targeted question. Your original wording is retained. Say “keep it” to skip the extra detail. Vanessa does not invent ratings or observations. A follow-up is optional and may be skipped when a saved draft is resumed.
- **Submission receipts:** After a confirmed save, Vanessa shows the database receipt ID, actual saved timestamp, tour date/time, rating, and saved comments. Exact retries return the original receipt. The chat clears on sign-out; the saved evaluation remains available in Eval Tracker.
- **Active now:** Every signed-in active hub member can open the header list. Names only, with multiple tabs deduplicated. See REMINDERS-SETUP.md for timing and expiry.
- **Automatic reminders:** One email to the evaluator, copied to your configured verified account, normally about 24 hours before the claimed tour. Requires backend setup; no open browser is needed.

## Write an evaluation in chat

Tell Vanessa “Help me write an eval” or “I have an eval to do.” She loads your current claims and asks which guide if you have more than one. She then collects:

- An explicit rating from 1 to 5, or skip. “Good” is kept as a comment rather than converted to an invented score.
- What went well, in your own words.
- Areas to improve, or none.
- Other comments, or none.

Your scheduled tour date/time prefill the draft. An editable draft appears inside the chat; change fields there and press **Update draft**. Once the draft is complete, press **Submit eval** or say **“submit it.”** You can also say “change rating to 4,” “notes: your revised comments,” or “cancel draft.” A general “yes” does not submit an evaluation.

To supply several fields in one message, separate labels with semicolons or newlines:

> Draft an eval for Avery Sample
> rating: 4; strengths: Clear explanations and good answers to questions.; improvements: Slow down at the final stop.; notes: none

The guided flow and labeled notes work without the optional model. This version records your supplied wording; it does not automatically rewrite or infer field categories from arbitrary mixed prose. You can review and move comments in the draft.

Only your own claimed evaluations can be submitted in chat. The new SQL function checks ownership under a row lock and saves date/time and feedback in one transaction. Repeating the same successful submission returns the saved result; different feedback cannot overwrite an existing evaluation. Errors retain the draft for review/retry. One selected unfinished draft is saved for your account on this browser. It survives reloads and sign-out; signing out clears the visible chat and in-memory draft. Resume with “continue my eval” after signing in. Cancellation or successful submission removes the saved draft. Storage failures are shown in the draft panel; drafts do not sync to another device.

## Saved drafts, tour matching, and voice notes

These additions need no further SQL beyond the existing `09-vanessa-submit.sql` for submitting evaluations.

**Saved drafts:** A draft starts saving after you select a guide. Text typed directly into its fields saves as you type. Vanessa shows “Draft saved on this browser” or a storage-failure message. Return on the same browser/account and click **Continue** or say **“continue my eval.”** She reloads your claims before restoring it. If the guide is reassigned or already submitted, she retains the saved copy and directs you to Eval Tracker. Say **“discard saved draft”** to remove it. Starting another draft prompts you to resume or discard the existing one first. Browser storage is device-local and can be cleared by browser settings; use one editing tab for a draft. This is not cloud backup or encrypted storage.

**Find a tour to evaluate:** Try **“Who needs an eval and has a tour Tuesday?”** or **“Find first priority eval tours tomorrow after 1 pm.”** Results list unclaimed guides with matching attached tours, ordered by priority. Include **“my evals”** to search your own claims instead. Dates, supported weekdays/ranges, priorities, and optional time filters are applied together. This search only reads the loaded schedule; it does not claim or reserve anything. Use Refresh if the workbook has changed.

**Voice notes:** Expand **Voice notes**, read the speech-service notice, and press **Start microphone**. Press **Stop**, edit the transcript, choose **Chat message** or a draft feedback field, then press **Use transcript**. Copying to chat does not send the message; press Ask yourself. Adding speech to a draft does not submit it. If the draft changes while dictating, Vanessa does not apply the recording to a different revision. Closing the panel or signing out stops dictation and clears its transcript. Raw audio is not stored by the hub.

Browser speech recognition has limited availability and can use a server-based speech service. Microphone permission, network conditions, and browser support can prevent dictation. The typed workflow remains available. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

## Optional model setup

Vanessa's standard answers work without the optional model. Model controls are visible to signed-in members.

- **Download model / Continue download:** Click inside the open hub tab. Unfinished downloads need user activation; automatic resume now occurs only when the model is already available.
- **Retry:** The last attempt failed or stopped making progress. Read the displayed reason, resolve it, and click Retry.
- **Cancel / Turn off:** Stop this site's model work. These controls do not promise to delete browser-managed model files.
- **Check again:** Recheck support after updating your browser or changing the environment.

Chrome's documentation lists web support from Chrome 148. It requires a supported desktop OS, at least 22 GB free on the Chrome-profile volume, and either more than 4 GB GPU VRAM or a CPU with at least 16 GB RAM and four cores. Initial download requires an unmetered connection. Mobile Chrome is not supported. Open the site directly over HTTPS; embedding can restrict access. `chrome://on-device-internals` provides model information. Browser/device requirements and permissions cannot be fixed by this repository.

Source checked September 11, 2026: https://developer.chrome.com/docs/ai/prompt-api

If setup still fails, capture the full text under **Optional model**, your browser version, and whether the site is open directly or inside a preview. That identifies the remaining browser-specific issue without sharing passwords or tokens.

## Changes

- Explicit English input/output settings for model availability and creation.
- Download creation starts immediately in the click handler. Pending downloads are not resumed without a fresh click.
- Visible browser/support errors, real progress, retry/cancel, a two-minute inactivity timeout, and retained opt-in after a transient failure.
- Isolated interpretation sessions and a prompt timeout; accepted model output is restricted to supported questions and user-supplied names.
- Phrase matching retains word boundaries and phrase structure. Dress-code and handbook topics receive priority over operational tour queries.
- Queries for ungraded candidates answer in chat. Explicit commands such as “open interviews” still navigate.
- Negative check-in queries list candidates who have not arrived.
- Guide lookup, ambiguous names, and “yes” to offered greeting details resolve correctly.
- Tour/desk queries respect supported dates and weekdays. “This week” covers the remaining week because the workbook loader supplies upcoming tours. Desk answers explicitly describe the recurring weekly template.
- Failed data warm-ups retry; workbook failures are reported instead of silently caching empty results. Empty desk rows retain their slot information for gap detection.
- Sign-out clears Vanessa's UI, cached data, conversation references, and model session. Late authenticated responses cannot populate the next user's session.
- Refresh invalidates Vanessa's loading cache and schedules a new warm-up.

## Verification

The included test report records the completed checks and their limits. To run the browser-logic and email-worker suites from the repository folder:

```sh
node --experimental-vm-modules tests/vanessa.test.mjs
node tests/reminder-worker.test.mjs
```

For the database tests, install the test-only PostgreSQL engine outside your app (Mac/Linux example):

```sh
npm install --prefix /tmp/codirector-test-deps @electric-sql/pglite@0.5.8 --no-audit --no-fund
PGLITE_PATH=/tmp/codirector-test-deps/node_modules/@electric-sql/pglite/dist/index.js node tests/reminders-db.test.mjs
```

No new browser dependency is required. The database suite executes the original schema, existing submission function and eval access policies, plus the new migrations, in local PostgreSQL via PGlite. Its committee helper stands in for the role migrations omitted from the uploaded repository. Cron, pg_net, and Vault are represented by narrow test stubs to validate the activation script without network requests. This is not a live Supabase deployment test.

The earlier `tests/vanessa-preview.html` fixture still provides fictional eval/model data for manual checks. It does not connect to Supabase and does not simulate active users or email. Real browser layout, microphone operation, browser model download, hosted scheduling, and inbox delivery remain unverified. No real evaluations or emails were sent.

Vanessa uses a finite set of rules and handbook topics. The optional model maps unfamiliar wording to supported questions; it does not generate operational facts.
