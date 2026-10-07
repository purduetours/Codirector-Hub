# Codirector Hub — Administrator's Guide

For whoever runs the program. **You do not need to know how to code, use SQL, or touch a terminal.**
Everything in this guide is done by clicking in the Hub, signed in as a Codirector.

If something here sends you to a developer, it says so clearly under [When you do need a developer](#when-you-do-need-a-developer). That list is short.

---

## What the Hub does

Codirector Hub is where the committee runs the tour guide program:

- **Evaluations** — committee members claim a guide, evaluate a tour, and submit feedback. Codirectors review.
- **Training** — attendance for each training session, who owes a makeup, and absences filed ahead of time.
- **Interviews** — check-in, grading and decisions on recruitment day.
- **Tours & desks** — the tour schedule and desk rota (read live from the shared Google Sheets).
- **Announcements** — notices for the committee.
- **Vanessa** — an assistant that answers questions and does routine jobs for you. She always asks before changing anything.

### Finding your way

Along the left (or the bottom, on a phone):

| Area | What's in it |
|---|---|
| **Home** | What needs you today. Start here. |
| **Tours** | Tour schedule, desk coverage |
| **Team** | Announcements, evaluations, guide directory, interviews, the old training grid |
| **Training** | Sessions, requirements, attendance, people, resources, reports — and each guide's own status |
| **Admin** | People, Tour Guides, Evaluation Roster, Semester, Data Sources, Reconciliation, Data Rules, Activity, Settings, Health (Codirectors only) |
| **More** | Your profile, appearance, who to ask for help |

Press **⌘K** (Mac) or **Ctrl K** to search for any page, person or action. The **bell** shows what needs attention; the **+** button has quick actions.

---

## Your first day

1. Sign in and open **Admin → Health**. Every line should be a green tick. Anything else says what to do.
2. Open **Admin → People**. Make sure at least **two** people have the Codirector role, so you can never be locked out.
3. Open **Admin → Settings** and fill in **Who to ask for help**, so everyone knows who to contact.

---

## People (the committee)

**Admin → People**

A person gets in with two steps: **you** add them, then **they** press **Make a password** on the sign-in page using the same email.

- **Add someone:** open *Add someone*, enter their name, Purdue email and role.
- **Find someone:** search by name or email; filter by *Active*, *Not signed up yet*, *Archived*, or role.
- **Change a role:** pick a new role from the dropdown on their row. Roles that carry administrator access ask you to confirm.
- **Someone left:** click **Archive**. They lose access immediately. **Nothing they did is deleted** — their evaluations, scores and attendance stay. You can **Restore** them any time (filter by *Archived*).
- **Several at once:** tick the boxes, then use the bar that appears (archive, restore, or change role for everyone ticked).
- **Import / export:** **Export CSV** saves the list. **Import CSV** takes a file with `Name, Email, Role` columns, shows you exactly what will happen row by row, and only saves when you confirm. Rows with problems are explained and nothing is imported until they're fixed.

### Roles

The **Roles** tab explains each role in plain words and who holds it.

- **Training tools** — evaluations, desk coverage, guide directory.
- **Recruitment tools** — interviews.
- **Administrator** — everything, including this Admin area.

The Hub will **not** let you remove the last administrator, demote or archive yourself, or give someone a role that doesn't exist.

> **Note:** "Tour Guide" in the role list is for someone who only needs to read the schedule and announcements. Tour guides on the *roster* (below) are a different list: they don't sign in.

---

## Tour Guides (the Master Tour Guide List)

**Admin → Tour Guides**

One record per person. Everything else — the tour schedule, the Tour Guides by Major sheet, evaluations, training — is matched back to *this* list, so a guide is never duplicated.

- **Add / edit:** name, email, major, leadership, whether they can evaluate others, whether they're eligible for tours, a linked committee account, notes.
- **Archive** when someone leaves — they drop off every list and next semester; all history is kept. **Restore** brings them back.
- **Inactive this semester** keeps them on the list but out of this semester's tracker — reversible, history untouched.
- **Priority / needs evaluation** can be set here too (or in bulk), the same fields as the Evaluation Roster.
- **Also known as:** the other spellings the schedule or a sheet uses for them. Add one by hand, or they appear automatically whenever you confirm a match.
- **Search, sort, filter, select several** and act on them at once; export or import CSV.
- A small badge shows when a field (like Major) is filled in by a spreadsheet. If you change it by hand it is recorded as an **override** you can see, and **Return to source value** undoes it. Nothing is silently overwritten later.

## Evaluation Roster

**Admin → Evaluation Roster** — who needs evaluating this semester and who will do it. Same people as the master list.

- **Priority** uses the Hub's existing tiers, shown as **High** (first and second), **Normal** (third and fourth), **Low** (fifth and below), or **None** (no evaluation needed). Change one person or many; sort and filter by band, status, or whether they need an evaluation. Priority is always set by you — no spreadsheet changes it.
- **Suggestions:** if active guides aren't on the roster, a box offers **Add all** (or review individually). Nothing is added without your click.
- **Auto-match:** *Build suggestions* pairs each guide who still needs an evaluator with an upcoming tour and a free evaluator — High priority first, the earliest usable tour, the evaluator with the lightest load who isn't already booked, never the guide themselves. You see each pairing with the reasons, can change the evaluator, untick any, and **Approve selected**. Nothing is assigned until you approve; each assignment is re-checked as it's saved and any problem is listed.
- **Evaluators** tab: who can evaluate (anyone with the Training Committee role or an admin) and their workload. Untick someone to keep them out of auto-match without changing their role. *The Hub doesn't know evaluators' personal availability — only that they're not already booked at that time and haven't been paused.*

## Data Sources and the January schedule

**Admin → Data Sources**

Shows what's connected, when it last synced, how many rows, and how many people are matched. Three sources: **Tour Guides by Major**, **Tour Schedule**, and an optional **master roster sheet**.

- **Sync now** reads the sheet, matches people, and **shows you what would change before saving** ("87 rows, 83 matched, 2 from saved matches, 2 need review; 3 new people, 4 major updates"). Nobody is ever added, removed or archived automatically.
- **Change source** (use this when Purdue gives you a new schedule in January, or the majors list moves):
  1. **Connect** — paste the Google Sheets link (open the right tab first so the link remembers it). It must be shared "Anyone with the link can view".
  2. **Columns** — check which column is which. A layout you've used before is recognised.
  3. **Preview** — what was read, who matched, what would change. Nothing saved.
  4. **Review** — place anyone the Hub couldn't match. Your answers are remembered, so you won't be asked again, this semester or next.
  5. **Start** — the new sheet becomes current and the first sync runs. The old sheet's rows are kept as history.
- The current weekly-grid schedule is supported as-is; a plain one-row-per-tour table works too, with any column headings.

## Reconciliation

**Admin → Reconciliation** — everywhere the sources disagree, grouped by type:

- **People not matched** — in a sheet but not on your list. **Confirm match** (pick who), **Create new person**, or **Ignore**.
- **Schedule names not matched** — same, for the tour schedule.
- **On your list but not in the sheet** — **Keep active**, or **Make inactive this semester**. They are never deleted.
- **Conflicting information** — **Use the spreadsheet's** value or **Keep the Hub's**.
- **Possible duplicates** — shown for you to check; nothing is merged automatically.

A decision isn't asked again. Name matching follows a fixed order — stable ID, email, a match you confirmed before, exact name, a spelling confirmed for another sheet — and anything fuzzier (like "Logan" vs "Logann", or "Nick S.") is only ever a **suggestion** that you confirm.

## Data Rules

**Admin → Data Rules**

- **Field ownership** — which source is trusted for which field (e.g. Major from Tour Guides by Major; Evaluation priority always the Hub).
- **Major names** — map "CS", "Comp Sci", "Computer Science" onto one name. Only what you list is changed.
- **Remembered matches** — every "this spelling is that person" answer, with **Forget** if one was wrong.

## Starting a new semester

**Admin → Semester → Start the next semester**

A guided checklist. **Nothing changes until the very last step**, and the "Review" step shows exactly what will happen.

1. **Semester** — season, year, first and last day. (The name, e.g. *Spring 2027*, is built for you.)
2. **Guides** — tick anyone leaving. Everyone else carries over, moved up one priority tier (you can turn that off). You can also paste new guides.
3. **Committee** — change roles, tick anyone leaving, add new hires.
4. **Training** — add the training sessions (or generate a weekly series). Each one gets a blank attendance row for every guide.
5. **Review** — a rehearsal of the real thing, with numbers. Nothing is saved.
6. **Start** — type **START** to confirm.

What is carried forward: returning guides, who still has access, their roles.
What is **not** copied: evaluations, attendance, scores and announcements. They stay with the semester they happened in and remain readable.

Leavers are **archived, never deleted**. If you made a mistake, restore them from People or Guides.

> **After starting:** open **Admin → Data Sources** and connect this semester's tour schedule and Tour Guides by Major sheet, review anyone it couldn't match in **Reconciliation**, then run **Auto-match** on the **Evaluation Roster**.

---

## Training

**Training** (its own entry in the sidebar). Everything about training is here, shaped to who you are: administrators see all of it, the committee sees upcoming sessions and counts, and Tour Guides see **My training**.

**The two ideas.** A **session** is an event (a date, a room, a speaker). A **requirement** is what people must complete ("New Tour Guide Orientation") and which sessions count toward it. Attending *any* approved session completes it (or every one, if you choose). You never update completion by hand after taking attendance — it follows automatically.

- **Overview** — upcoming training with room and speaker, **Needs attention** (attendance not entered, a session with no room or speaker, people who need a makeup, deadlines close), and required-training completion ("82 / 95 complete").
- **Sessions** — create, edit, duplicate, cancel and re-open sessions, as a list or a month-by-month timeline; filter by type, status and requirement. One drawer per session: details, which requirements it counts toward, speakers, materials, **Announce** (opens a pre-filled announcement), **Duplicate**, **Make a makeup**. A cancelled session keeps all its history; a session nobody has been marked at can be deleted.
- **Requirements** — name, deadline, completion rule, **who it applies to** (all guides, new guides, leadership, evaluators, named **cohorts**, or hand-picked people), and the approved sessions. **Copy setup from another semester** brings requirements, audiences and materials forward (and sessions as drafts) — never attendance or history. If you already have sessions and no requirements, **Make a requirement from each existing session** turns each into one.
- **Attendance** — built for a phone in the room. Pick the session; each expected person is a card with big buttons: **Present, Late, Excused, Absent, Makeup needed**. **Mark everyone still blank as present** is one tap, so you only touch the exceptions. Nothing saves until you press **Save** (or **Save & submit attendance**, which closes the session out). You can also **import a CSV** — you preview it, match each name to a Tour Guide, and only then does anything save. The older full grid is still there as **Classic grid**.
- **People** — who still owes training. Per person: completion, what's missing, next training, makeup needed. Filter by status, requirement, new guides, leadership, evaluators. Click a name for their full picture and to **mark a requirement complete, waived, excused or incomplete** (with a reason) or **return to automatic**. Select several people to mark a requirement, **assign them to a session** (use this for makeups), add them to a cohort, **send a reminder**, or export.
- **Resources** — **materials** (shown as friendly cards: document, slides, PDF, video…), **speakers** (they don't need accounts; contact details are for administrators only), and **templates** for a training you run every semester, so you can create each semester's session in one step.
- **Reports** — completion by requirement and by group, attendance by session, makeup totals; export any of it.

**When someone misses a required session** they automatically show as *needs a makeup* (on People, in your Action Center, and on their own page). **Make a makeup** from the missed session creates a session that counts toward the *same* requirement, starting with exactly the people who still owe it. Attending it completes the original requirement, and the original absence stays on record.

**Reminders.** The Hub shows the right nudges in each person's bell (a session tomorrow, a deadline within two weeks, a makeup they owe) and in yours (what needs running). **Send reminder** opens your own email app with everyone in BCC, or copies the text; the Hub does not send email by itself.

**History.** The **semester picker** at the top switches the whole Training center to any past or future semester. Old semesters are never overwritten.

**Starting a new semester:** the wizard's Training step offers **Copy last semester's training setup**, with a date shift (about 182 days fall → spring) and an option to bring sessions as drafts. Review the drafts afterwards and fix the dates.

The older **Training grid** (Team → Training grid) still works for the full attendance table and the absence-form view.

## Evaluations

**Team → Evaluations**

Committee members claim and submit; Codirectors can see all submitted evaluations, mark them reviewed, and release or reassign claims. The **Action Center** (the bell) flags overdue evaluations and top-priority guides nobody has claimed.

## Announcements

**Team → Announcements.** Codirectors can post, pin and delete. Everyone else reads. Pinned announcements show on Home until read.

## Interviews

**Team → Interviews** (recruitment day). Check people in, grade, and see results. Import candidates from a spreadsheet; the Hub previews before saving.

---

## Settings

**Admin → Settings**

- **Shared spreadsheets** — the training absence form responses and the older majors workbook. (The tour schedule and Tour Guides by Major sheets are connected under **Data Sources**.)
- **Dashboard & alerts** — how many days ahead to show evaluations, which priorities count as "top", and how early to warn that the semester is ending.
- **Who to ask for help** — shown to everyone on the More page.
- **Vanessa** — switch on/off her ability to archive, restore and invite when you ask.
- **Tour reminders** — turn email reminders on and set when they go out. (The email service itself is set up once by a developer.)

**Passwords, keys and the database address are never shown or edited here.** That is on purpose.

---

## Activity (audit log)

**Admin → Activity** shows who did what and when: people added or archived, roles changed, semesters started, settings edited. You can search, filter and export it. It cannot be edited.

---

## Using Vanessa

Vanessa is the assistant built into the Hub. Open her from the sidebar, the top bar, or the orb on Home (on a phone she opens full-screen). Ask in your own words; you don't need exact phrases. She looks up the real, current Hub data every time, so her answers are never out of date, and she only sees and does what **your account** is allowed to.

**She costs nothing to run.** Vanessa is part of the Hub itself: there is no AI subscription, no API key and no account to set up, and nothing you ask is sent to an outside AI service. She works the day the Hub is installed and will keep working indefinitely.

When you open her she greets you, shows what matters right now (your next tour, how many things need attention) and offers a few questions that fit the page you are on. **Admin → Vanessa** shows how she is running.

### Standard and Enhanced (you never have to choose)

- **Standard Vanessa** is what everyone gets. She recognises what you ask (schedule, evaluations, training, people, coverage, briefs, data), runs the Hub's own tools and answers in plain sentences with cards. It is instant and needs nothing.
- **Enhanced Vanessa** is an optional extra. If a Co-Director or developer sets up a small AI model **on their own computer** (see `LOCAL_AI_SETUP.md`), she uses it only when your wording is unusual, to work out what you mean. The answer still comes from the Hub's data. If that model isn't running she simply carries on in Standard mode: you won't see an error.

You can ignore Enhanced entirely. Nothing in your day-to-day needs it.

### What you can ask

**Schedule** — "What's my next tour?", "Who is touring Friday?", "Who is on the 2 PM tour tomorrow?", "Any conflicts this week?", "Who tours after 3 PM?", "When is Jordan's next tour?"

**Evaluations** (training team and Co-Directors) — "Who still needs evaluated?", "Who is high priority?", "Who needs an eval and is touring Thursday afternoon?", "Who can evaluate Jordan?", "Find me a high-priority eval Thursday." She uses the same auto-match as Admin → Evaluation Roster and explains each match. She is clear that availability beyond existing bookings isn't tracked.

**Training** — "What training do I still need?" (everyone), "Who missed training this week?", "Who still needs orientation?", "Who needs a makeup?", "Are we ready for training tomorrow?", "Where's the Campus Safety deck?"

**People** — "Who are the CS majors?", "Who is leadership?", "Which guides don't have a major?", "Who isn't on the schedule?", "Tell me about Jordan."

**Coverage** — "Who could cover Casey tomorrow?" She suggests who is free and why. She **can't change the schedule** (it lives in the spreadsheet), so make the change there.

**Data** (Co-Directors) — "Is everything synced?", "Which names still don't match?", "What's going wrong this week?"

**Briefs** — "What's going on today?", "Give me the brief", "Anything I need to worry about?", "Weekly plan", "Training brief". Short, most important first.

**Pages** — "Open the evaluation roster" takes you there.

### Follow-ups work the way you'd talk

After "Who still needs evaluated?" you can say "What about Thursday?", "Show me high priority", "The first one", "What about Jordan?", "Who's the best one?" and then "Set it up." She remembers what you were just talking about. If a name could mean two people she asks which ("Jordan Smith or Jordan Lee?"). You can also ask two things at once: "Who is touring tomorrow and who still needs evaluated?"

### What she can change (Co-Directors)

Evaluation priority and assignments ("Assign Taylor to evaluate Jordan Thursday", "Set it up", "Mark Jordan high priority"), training sessions, attendance, makeups ("Assign them to a makeup"), completion ("Excuse Jordan from Safety"), Tour Guides ("Add Alex Smith as a tour guide", "Archive Jordan", "Change Jordan's major to biology"), notes, matching spreadsheet names ("Match Jordy S. to Jordan Smith"), announcements, and roles.

### When she asks you to confirm

She **never changes anything without showing you first**.

- She tells you exactly what she's about to do and shows a card: **Confirm** or **Cancel**. Say "yes" if you like. Nothing is saved until you do.
- **High-impact** actions — archiving several people, changing someone's role, posting an announcement, copying a semester's training, large assignments, overwriting attendance — need an explicit **Confirm** (the button or the word "confirm"); a plain "yes" isn't enough.
- A request waits 10 minutes (5 for high-impact), then expires. Ask again.
- If you carry on talking about something else, a plain "yes" won't confirm the old request; she'll check first.
- Afterwards she **checks the change actually saved** and gives a short receipt. If something fails she says exactly what didn't happen, and if only part worked she tells you how much ("saved 8 of 10; two people are no longer active") and offers to retry. She never says "done" unless it was.
- Changes she makes appear in **Admin → Activity** as "Vanessa on behalf of *you*".

### What she won't do

- Anything your role doesn't allow ("make me an admin", "show me everyone's evaluations"). Changing your own role is blocked for everyone.
- Start or end a semester, or anything that needs the dedicated screens — she'll point you to them.
- Send emails or messages. She can draft a reminder for you to copy.
- Run database commands. She can't; she only uses the same controls the screens use.
- Follow instructions hidden in spreadsheets, announcements or notes. Text in your data is just information to her.

### Voice

Tap the microphone, speak, and she answers (turn on "Read answers aloud" under *Voice and options* to hear her; "Keep listening" makes it a back-and-forth). Say "cancel" or press Esc to stop listening. Typing always works and needs nothing. Speech uses your browser's own features, which are free and need no account; the Hub records nothing. One thing to know: in Chrome and Edge the audio goes to the browser's speech service (Safari does it on your device). If your browser offers it you'll see **Keep speech on this device**, which avoids that. If your browser has no speech support the buttons simply don't appear.

### Trying her out safely

*Voice and options → Test mode*: **Rehearse** lets you go through a whole confirmation with nothing saved; **Read-only** lets her answer but not prepare changes. (Co-Directors only; the default is under Admin → Vanessa.)

### Admin → Vanessa

Shows **Vanessa Engine** (Mode: Automatic; whether a local AI is connected or offline; the fallback, Standard Mode), a **Test Vanessa Engine** button ("Local conversational engine connected successfully", or "…unavailable. Vanessa will continue using Standard Mode."), the settings for a local model *on that computer*, how many requests Standard and Enhanced answered, which things she was asked and how quickly, the changes she was asked to make, and a list of **phrasings she didn't understand** (kept on that computer only, with names removed). You can set Vanessa to **Standard only** for everyone there.

If she ever says she didn't understand something, that is normal: she'll try her older answers or ask you to rephrase. Everything in the Hub works as normal: every screen can do everything she can.

## When something looks wrong

| You see | Do this |
|---|---|
| **Admin → Health** shows a red ✕ | Read the line; it says what to do. |
| Someone says they can't get in | People → search them. *Not signed up yet*: they need to press **Make a password** with the exact email. *Archived*: Restore them. If the sign-in page says new passwords are switched off, see below. |
| Someone sees an empty Hub | They have no role, an unrecognised role, or were never added. Fix on People. |
| A guide is missing from the tracker | Admin → Tour Guides, filter *Archived* or *Inactive this semester* → Restore / make active. |
| The schedule is empty or someone is missing from it | Admin → Data Sources → the schedule card. *Sync now*, or *Change source* if there's a new sheet. Unmatched names are in Reconciliation. |
| "One-time admin setup has not been run" | Needs a developer — see below. |
| Numbers look stale | Click the refresh button (More → Refresh everything on a phone). |

## What NOT to touch

- Don't delete things in the Supabase dashboard "to clean up". Use **Archive** — it keeps history intact.
- Don't share your login. Add people instead.
- Don't edit the shared spreadsheets' structure (renaming month tabs, moving columns) without telling whoever maintains the Hub; the schedule is read from them.
- Don't paste anything that looks like a password or key into Settings. The Hub refuses it, and it doesn't belong there.

## When you do need a developer

Only for these, and they're rare:

1. **First-time setup** of the admin tools (run once) — see `DEVELOPERS.md`.
2. **Turning on new sign-ups** in Supabase, if the sign-in page says passwords are switched off (one switch; People shows the instructions).
3. **Email reminders** — first-time setup of the email provider and its key.
4. **Changing the Hub's code** (new features, fixes) and publishing it.
5. **Recovering from a disaster** — e.g. the Supabase project was deleted.

You do **not** need a developer to add or remove people, add or retire guides, change roles, start a semester, change settings, or read the audit log.

## Backups

The Hub keeps history by archiving instead of deleting, which protects against most mistakes. For real disasters, **export** regularly:

- **People → Export CSV**, **Tour Guides → Export CSV**, **Training** CSV download, and **Activity → Export CSV** — do these when you start each semester and keep the files somewhere safe.
- The database lives in Supabase. Whether automatic restorable backups exist depends on the Supabase plan this project is on (free plans have historically not included them). A developer can check this and upgrade if needed.
