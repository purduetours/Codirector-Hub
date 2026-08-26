# Tour Guide Eval Tracker

A small web app for the eval committee. Committee members **claim** a tour guide to
evaluate, schedule the tour, and submit written feedback — all of it writing straight
back into the existing Google Sheet.

Front end is static (GitHub Pages). The Google Sheet is reached through a Google
Apps Script web app, so there are no API keys in the browser and no server to run.

**→ [SETUP.md](SETUP.md) has the step-by-step install.**

## What it does

- **Claiming with no double-booking.** Claims are written under a script lock, so if
  two people tap Claim at the same moment, one gets it and the other gets told who.
- **Roster views.** Available / My evals / Claimed / Done / Everyone, plus search and
  a priority filter that follows your existing First → Last Priority tiers.
- **Real tour slots.** Claiming shows the guide's actual upcoming tours pulled from
  the semester schedule — tap one and the date/time fill themselves in. Falls back to
  manual entry for guides with nothing scheduled. Schedule shorthand (`Marie P.`) is
  resolved against the roster at read time, so fixing a name or adding a guide is
  enough to reconnect their tours.
- **Eval submission.** Rating plus what-went-well / areas-to-improve, appended to the
  `Submissions` tab; ticks `Evaluation Form Submitted?` on the roster automatically.
- **Priority self-manages.** Submitting an eval drops that guide to `Last Priority`,
  so whoever still needs evaluating stays at the top of the list.
- **Two access levels.** A committee code and an admin code. Completed evals are
  admin-only — filtered server-side, so other people's submissions never reach a
  committee member's browser, though they still see their own and the overall
  progress count. The admin code also unlocks releasing an abandoned claim, checking
  off `Feedback Reviewed?`, and the end-of-semester rollover.
- **One-click semester rollover.** Bumps every guide up a priority tier and clears
  the term's tracking columns, with a dry-run preview before anything is written.
- **Audit trail.** Every action is logged with a timestamp on a `Log` tab.
- Works on a phone, follows light/dark mode.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure |
| `styles.css` | All styling |
| `app.js` | Front-end logic and API calls |
| `config.js` | **The one file you edit** — API URL, term label, rating scale |
| `apps-script/Code.gs` | The backend; paste into a new project at script.google.com |
| `Schedule.csv` | 1,014 tour slots, ready to import as a `Schedule` tab |
| `new-guides.csv` | Three guides on the schedule but missing from the roster |
| `SETUP.md` | Install instructions |

## Sheet columns

Your `Tracker` tab keeps every column it already has. `setup()` adds three:

| Column | Purpose |
|---|---|
| `Eval ID` | A stable per-guide id so deleting, adding, or re-sorting rows can't misroute a claim; assigned automatically (hidden) |
| `Claimed At` | Timestamp of the claim |
| `Scheduling Notes` | Free text from the evaluator |
