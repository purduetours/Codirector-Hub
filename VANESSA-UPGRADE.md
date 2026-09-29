# Vanessa workspace upgrade

Vanessa is the main working surface: Home starts with her conversation, and her expanded chat supports briefings, record updates, guide profiles and editable drafts. Use Compact when working alongside a form; navigation also returns her to the compact layout.

## Things to try

- “Brief me.”
- “Prepare a meeting agenda.” Then choose **Open editable agenda**.
- “Show Ella’s profile.” Follow with “What about Noah?” or “No, I meant Noah.”
- “Who owes makeup?”
- “Why does Ella still owe makeup training?”
- “Ella completed makeup training.” A unique person with one outstanding session is saved immediately.
- “Ella and Noah completed makeup training.” Review the resolved people and sessions before saving.
- “Ella completed makeup training yesterday after meeting with Logan.” Review the completion date and note before saving.
- “Ella completed makeup training for September 21st.” Specify the outstanding session explicitly.
- “She completed her makeup training.” Uses the person currently in context. The context indicator shows who Vanessa is discussing.
- “Undo that.” Or use **Undo this update** on a saved result.
- “What did you change?” Shows saved training updates from this conversation.
- “Draft makeup reminders for everyone.” Drafts remain editable and can be copied or downloaded. Nothing is sent.
- “Draft makeup reminders for Ella.” Follow with “Make it shorter” or “Make it more direct.”
- “Show history for Ella.” Uses the existing training history table.
- “Suggest evaluations this week.” Uses unclaimed guides, recorded priority and scheduled tours. These suggestions do not establish evaluator availability or reserve assignments.

## Conversation and models

The supported workflows work without a model or a new API key. Under **Smarter answers**, the existing optional local model can interpret unfamiliar wording into an allow-listed read-only workflow. The app validates the proposed action and any named person, then uses the normal permissions and data loaders. It does not give the model direct database access.

Context is bound to the signed-in account and expires after inactivity. New conversation clears the context, action receipts and conversation. Undo is available for training changes made in this sign-in conversation; durable training history still comes from the database. This is not a persistent, cross-device chat archive.

## Training reliability

- Codirector permissions are checked before writes and undo.
- Only training records for the current term are loaded.
- Questions, negative statements, future plans and invalid completion dates do not record completion.
- Multiple matching people or multiple outstanding sessions require a choice.
- Batch updates and date/note details are reviewed before saving.
- Repeated completion requests do not create duplicate updates.
- Updates compare the prior status, completion details and timestamp. A changed record is not silently overwritten.
- Partial failures report saved progress and offer undo for the changes that succeeded.
- Undo restores status, completion date and note only if the record still matches Vanessa’s saved version. Intervening edits are preserved.
- The obsolete September 7th absence-form mismatch warning remains suppressed. Submitted form responses and the external Google Form are unchanged.

## Files and deployment

This remains the existing static JavaScript app. No new service, API key, package install or database migration is required for the new workflows. The original Training tables and makeup-date/note columns must already exist. The history view requires the existing `15-training-history.sql` and applicable read policies.

Deploy the updated project through your usual static hosting process. These changes do not deploy themselves and no live database records were changed during development.

## Validation

Browser regression pages (serve the project locally and open each page):

- `tests/vanessa.test.html`: 89 checks.
- `tests/permissions.test.html`: 47 checks.
- `tests/vanessa-workspace.test.html`: 47 checks covering batch completion, metadata, optimistic writes, undo conflicts, partial failures, account changes, conversational follow-ups, drafts, read permissions and model-proposal validation.

The real chat controls were exercised in an isolated Chrome session with sample records: briefing, typed confirmation, undo, draft editing, clipboard fallback and phone viewport containment. Desktop and phone screenshots were visually inspected. Tests use mocked database responses; they do not validate the live Supabase deployment or actual local-model generation on the user’s device.
