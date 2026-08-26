# Setup — start to finish

About 20 minutes, done once. This version starts from
[script.google.com](https://script.google.com) rather than the sheet's
Extensions menu.

---

## Step 1 — Sign in as the account that owns the sheet

**This is the step that will bite you if you skip it.**

Your tracker is owned by **`purduetours@gmail.com`**, and that's the *only* account
with edit access on it. Your personal account (`logannt04@gmail.com`) can currently
only read it.

`setup()` has to write to the sheet — it adds columns and tabs — so the script must
run as an account that can edit. **Build the whole thing while signed in as
`purduetours@gmail.com`.**

That's also the right long-term call: the eval committee role turns over, and a
script living in your personal account breaks the moment you hand off. In the shared
account it just keeps working for whoever comes next.

> **Don't have that password?** Two options: ask whoever does to sit down with you
> for ten minutes, or have them share the sheet to your account **as an Editor**
> (Share → add `logannt04@gmail.com` → Editor) and build it under your own account
> instead. Everything else below is identical either way.

Go to [drive.google.com](https://drive.google.com), check the account avatar in the
top right, and switch accounts if it isn't `purduetours`.

---

## Step 2 — (already done) The sheet is converted

Nothing to do here. Your tracker is already a real Google Sheet with the `Tracker`
and `Submissions` tabs — I verified it. Moving on.

---

## Step 3 — Create the script

1. Go to **[script.google.com](https://script.google.com)** — signed in as the
   account from Step 1.
2. Click **＋ New project** (top left).
3. Rename it: click **"Untitled project"** at the top, type `Eval Tracker API`,
   press OK.
4. Delete the sample `function myFunction() {}` in the editor.
5. Open `apps-script/Code.gs` from this folder, select **all** of it, copy, and
   paste it into the editor.
6. Click the 💾 **Save** icon.

---

## Step 4 — (already done) The spreadsheet ID is filled in

Line 15 of the code you just pasted already has your sheet's ID in it:

```js
var SPREADSHEET_ID = '1B39Y_xfBQtjl4NyFRoVz60E6CohYoEDVaxQc8XI082o';
```

Just confirm it looks like that — nothing to type.

---

## Step 5 — Run `setup()` once

1. In the toolbar above the editor, the function dropdown probably says `doGet`.
   Change it to **`setup`**.
2. Click **▶ Run**.
3. Google asks for permission the first time:
   **Review permissions → pick your account → Advanced →
   Go to Eval Tracker API (unsafe) → Allow.**

   The "Google hasn't verified this app" warning is expected — it's your own script,
   and it's unverified because you just wrote it.

4. Watch the **Execution log** at the bottom. You want `Execution completed`.

This adds three columns to `Tracker` (`Eval ID`, `Claimed At`, `Scheduling Notes`)
and creates two tabs (`Committee`, `Log`). Flip back to the sheet and confirm you see
them.

Re-run `setup()` any time you add guides to the roster — it only fills in what's
missing, so it's safe to run repeatedly.

**If it errors:** see the troubleshooting table at the bottom.

---

## Step 6 — Set the two codes

The app lives on a public URL, so the codes are what gate it. There are two:
one for the committee, one that also unlocks admin powers.

1. In the Apps Script editor, click **⚙ Project Settings** (left sidebar).
2. Scroll to **Script Properties → Add script property**.
3. Add both of these, then click **Save script properties**:

   | Property | Value |
   |---|---|
   | `ACCESS_CODE` | `1869` |
   | `ADMIN_CODE` | `1159` |

Both are typed into the same box on the sign-in screen — the app works out which one
you used. Anyone entering `1159` gets the admin buttons; anyone entering `1869` gets
the normal committee view.

**Admin powers are exactly two things:**

- **Release** someone else's claim (for when a member drops off and their claim is
  stuck)
- **Mark reviewed** — checking off `Feedback Reviewed?` once you've read a
  submission

Everything else — claiming, scheduling, submitting evals — works the same for
everyone. Give `1869` to the committee and keep `1159` to yourself.

> Since both codes go in the same box, don't paste `1159` into a group chat by
> accident. If it leaks, change the `ADMIN_CODE` property to something else — it
> takes effect immediately, no redeploy needed.

*(There's also an optional `ADMINS` property that takes a comma-separated list of
names, if you'd rather grant admin by person than by code. You don't need it.)*

---

## Step 6.5 — Add three missing guides

Three people appear on the tour schedule but were missing from the eval roster. Open
the **Tracker** tab and add these rows at the bottom (or import `new-guides.csv`):

| First Name | Last Name | Eval Priority |
|---|---|---|
| Norah | Wills | Second Priority |
| Risha | P. | First Priority to Eval |
| Trinav | S. | Last Priority |

> **I don't know Risha's or Trinav's surnames** — the schedule only ever writes the
> initial. `P.` and `S.` work as-is, and you can replace them with the real names any
> time: matching only needs the surname to *start* with that letter, so nothing
> breaks when you fix them.

Then re-run **`setup()`** so the new rows get an Eval ID.

---

## Step 6.6 — Import the tour schedule

This is what lets people claim a *real tour slot* instead of typing a date.

1. In your Google Sheet: **File → Import**.
2. **Upload** tab → drag in `Schedule.csv` from this folder.
3. Import location: **Insert new sheet(s)**. Separator: **Comma**. → **Import data**.
4. The new tab will be called `Schedule` — if it arrives as `Schedule.csv` or
   similar, **rename it to exactly `Schedule`**.

It holds **1,014 tour slots** pulled out of `Fall 2026 Official Tour Schedule.xlsx`,
covering **92 guides from 2026-09-08 through 2026-12-04**. Columns are `Date`,
`Start`, `Slot`, `Guide` — don't rename them.

**About the `Guide` column:** it keeps the schedule's own shorthand (`Marie P.`,
`Nick Str.`) rather than full names. The script matches shorthand to the roster on
every read — first name plus however many letters of the surname are given. That
means the link repairs itself: fix a surname on the Tracker, or add a guide who was
missing, and the tours connect with no re-import.

Two labels the initials can't resolve are handled by name in `Code.gs`:

```js
var SCHEDULE_ALIASES = {
  'nick s.': 'Nicholas (Nick) Steingraeber',   // "Nick Str." is Stromberg
  'myelei c.': 'Myelei Whitaker'
};
```

**When the tour schedule changes:** re-import and replace this tab. The app reads it
live and filters out past tours automatically.

**If you skip this step** the app still works — the claim screen just asks for a date
and time by hand.

---

## Step 7 — Fill in the committee list

Open the new **Committee** tab in your sheet. Type your committee members' names down
column A, one per row. Column B (`Active`) takes `TRUE`/`FALSE` if you want to hide
someone without deleting them.

These become the autocomplete suggestions on the sign-in screen. People can still
type a name that isn't listed, so treat it as convenience, not security.

---

## Step 8 — Deploy the web app

1. Top right of the editor: **Deploy → New deployment**.
2. Click the ⚙ gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** `eval tracker api`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`

   ⚠️ It must be **`Anyone`** — *not* "Anyone with a Google account". The wrong one
   sends a login page instead of data, and the app will say it got a non-JSON reply.
4. **Deploy** → approve if asked → **copy the Web app URL**. It ends in `/exec`.

> **Every time you edit `Code.gs` afterward:** save, then
> **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.**
> Saving alone does not update the live URL. This catches everyone at least once.

---

## Step 9 — (already done) The app points at your script

`config.js` already has your deployment URL, and I've tested it end to end against
your live sheet:

| Check | Result |
|---|---|
| Roster loads | 104 guides ✓ |
| Tour schedule resolves | 92 guides with tours, **0 unmatched labels** ✓ |
| Code `1869` | works, no admin buttons ✓ |
| Code `1159` | works, admin buttons shown ✓ |
| Wrong code | rejected ✓ |
| Rollover as non-admin | refused by the server ✓ |
| Rollover preview as admin | 49 move up, 11 already top, 44 left alone ✓ |

Nothing was written to your sheet during testing — reads and dry-runs only.

To run it locally any time:

```bash
cd ~/Downloads/tour-eval-app && python3 -m http.server 8000
```

Then open <http://localhost:8000>.

---

## Step 10 — Publish to GitHub Pages

Create an empty repo on GitHub (e.g. `tour-eval-tracker`) — no README, no
`.gitignore`. Then from this folder:

```bash
cd ~/Downloads/tour-eval-app && git init && git add -A && git commit -m "Tour guide eval tracker"
```

```bash
git branch -M main && git remote add origin https://github.com/YOUR-USERNAME/tour-eval-tracker.git && git push -u origin main
```

On GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main`,
folder: `/ (root)` → Save.**

A minute later it's live at:

```
https://YOUR-USERNAME.github.io/tour-eval-tracker/
```

Send that link and the code `1869` to your committee.

---

## Everyday use

**Committee members:** open the link, enter their name + `1869` once (it's
remembered on their device), **Claim** a guide from the Available tab, **pick which
of their scheduled tours** they'll sit in on, then **Submit eval** afterward. It all
works on a phone.

**You:** the sheet fills itself in — `Name of Evaluater`, `Tour Eval Date/Time`, and
`Evaluation Form Submitted?`. Written feedback lands on `Submissions`. Every action
is timestamped on the `Log` tab. Hit **Mark reviewed** in the app once you've read
someone's feedback.

---

## Auto-lowering priority after an eval

When someone submits an eval, that guide's **`Eval Priority` drops to `Last Priority`
automatically**, so the roster keeps sorting whoever still needs evaluating to the
top. The change is timestamped on the `Log` tab, and the app tells the evaluator it
happened.

Two deliberate exceptions:

- Guides already marked `No Need to Eval` / `Not Needed to be Evaled` are left alone
  — moving them to `Last Priority` would *promote* them back into the queue.
- They still show as **Submitted** (not "No eval") in the app, so your Done tab and
  the progress bar stay accurate.

**To change this behaviour**, edit the line near the top of `Code.gs`:

```js
var PRIORITY_AFTER_EVAL = 'Last Priority';
```

Set it to `'No Need to Eval'` to pull evaluated guides out of rotation completely, or
to `''` to leave priorities untouched. Redeploy a new version after editing.

---

## End of semester

When the term is over, sign in with the **admin code** and click **End of semester…**
at the bottom of the page.

It does two things:

1. **Moves everyone up one priority tier** — Last → Fifth → Fourth → Third → Second →
   First. Guides who never got evaluated this term become the most urgent next term,
   which is the whole point. Anyone already at First Priority stays there, and
   `No Need to Eval` / `Not Needed to be Evaled` guides are left alone so they don't
   get pulled back into rotation.
2. **Optionally clears this semester's progress** (checkbox, on by default) — wipes
   evaluator names, tour dates/times, and both checkboxes so the new term starts
   clean. **Submitted feedback on the `Submissions` tab is never touched**, so your
   written eval history survives.

**Always hit Preview first.** It runs the whole thing without writing anything and
shows you exactly how many guides move and where. The Run button stays disabled until
you've previewed, and changing the checkbox invalidates the preview so you can't
approve one thing and run another.

On your roster today that means **47 guides move up, 10 are already at First
Priority, and 44 are left alone.**

The action is admin-only (enforced on the server, not just hidden in the UI) and is
recorded on the `Log` tab. If something goes wrong, Google Sheets **File → Version
history** can restore the sheet.

**Don't forget:** re-import a fresh `Schedule` tab for the new semester's tours.

---

## Who sees what

Both codes load the same app. The difference is four powers and one visibility rule.

### Completed evals are admin-only

A committee member **cannot see evals other people have submitted**. Those guides are
filtered out of the response on the server — the data never reaches their browser, so
it can't be dug out of devtools either.

They *do* still see:

- guides they evaluated **themselves**, on their **My evals** tab, as their own record
- the overall progress bar (*"12 of 60 evals submitted"*) — the number, never the names

The **Done** tab is hidden entirely for committee members.

### Admin-only actions

| Action | Committee (`1869`) | Admin (`1159`) |
|---|---|---|
| Claim, schedule, submit own evals | ✅ | ✅ |
| See own submitted evals | ✅ | ✅ |
| **See everyone's submitted evals / Done tab** | ❌ | ✅ |
| **Release someone else's claim** | ❌ | ✅ |
| **Submit on someone else's claim** | ❌ | ✅ |
| **Mark feedback reviewed** | ❌ | ✅ |
| **End-of-semester rollover** | ❌ | ✅ |

Every one of these is checked in `Code.gs` before anything is written or returned —
hiding buttons is only cosmetic, so the server enforces it independently.

---

## Editing the roster (adding / deleting guides)

**Yes, you can delete rows on the Tracker whenever you like.** Guides are identified
by a hidden `Eval ID` column, not by row position, and the script re-reads row
numbers on every request inside a lock — so deleting, inserting, and re-sorting are
all safe, even while people are using the app.

| Action | What to do |
|---|---|
| **Remove a guide** | Right-click the row number → **Delete row**. Nothing else needed. |
| **Add a guide** | Type their name and priority on a new row. The app stamps an Eval ID on its own the next time someone loads it. |
| **Rename / fix a surname** | Just edit it. Their tours re-link automatically, as long as the surname still starts with the letter the schedule uses. |
| **Re-sort the roster** | Safe. The app sorts by priority for display anyway. |

Two things to know:

- **Don't delete row 1** — that's the header, and the script matches columns by
  header name.
- If someone has the app open when you delete a guide they were about to claim, they
  get *"That guide is no longer on the tracker. Refresh and try again."* — which is
  the correct outcome, not a bug.

**Deleting a guide does not delete their feedback.** The `Submissions` tab is
independent, so any evals already written about them stay there.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| **Extensions** menu greyed out | The file is still `.xlsx`. Do Step 1. |
| `No spreadsheet is connected` | Line 15 lost its ID. See Step 4. |
| `Could not open spreadsheet "..."` | You're signed in as an account without access. See Step 1. |
| `You do not have permission to call setValue` | Same thing — the account can read the sheet but not edit it. Step 1. |
| `No sheet named "Tracker" was found` | The tab got renamed, or the ID points at the wrong file. |
| "config.js still has the placeholder API_URL" | Step 9 — paste the `/exec` URL. |
| "Got a non-JSON reply" | Deployment access isn't `Anyone`. Redo Step 8. |
| "Incorrect access code" | Neither `ACCESS_CODE` nor `ADMIN_CODE` matches what was typed. Check for stray spaces in the property value. |
| Code edits don't take effect | You saved but didn't deploy a **new version**. See the note in Step 8. |
| A new guide doesn't appear in the app | Hit Refresh — new rows get an Eval ID automatically on the next load. |
| No tours listed when claiming someone | Either they have none on the schedule, or the `Schedule` tab name/headers are off. Manual date entry still works. |
| A guide on the schedule shows no tours | Their roster surname probably doesn't start with the letter the schedule uses. Fix the Tracker spelling, or add them to `SCHEDULE_ALIASES` in `Code.gs`. |
| Someone claimed a guide and vanished | As an admin, hit **Release** on their card. |
