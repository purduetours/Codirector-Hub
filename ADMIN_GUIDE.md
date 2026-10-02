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
| **Team** | Announcements, evaluations, guide directory, interviews, training |
| **Admin** | People, Guides, Semester, Activity, Settings, Health (Codirectors only) |
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

## Guides (the tour guide roster)

**Admin → Guides**

This is the list of guides who are evaluated and trained. They are separate from committee accounts.

- **Add a guide:** *Add guide*. They appear on this semester's Eval Tracker.
- **Edit:** change their name, email or priority.
- **A guide graduated or left:** **Archive**. They come off the tracker and next semester's list; their history is kept. **Restore** brings them back.
- **Import / export CSV:** same safe preview-then-confirm flow as People. Columns: `First name, Last name, Email, Priority`.

---

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

> **After starting:** open **Admin → Settings** and check the tour schedule link still points at this semester's spreadsheet (see below).

---

## Training

**Team → Training** (Codirectors only)

- Pick a session, set each person's attendance in the grid.
- **Makeups owed** lists who still owes one. Mark it done when they finish.
- **Absence form** shows responses people filed ahead of time.
- Add or remove sessions from the Training screen too. Removing a session removes its attendance — download a CSV first if unsure.

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

- **Shared spreadsheets** — paste a Google Sheets link for the tour schedule, the training absence form responses, and the majors list. Leave blank to use the built-in link. The sheet must be shared so the Hub can read it.
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

Open her from the sidebar, the top bar, or press the orb on Home. Some things to say:

- "Brief me" — what needs attention
- "What is overdue?"
- "Who owes makeup?" / "Who hasn't completed training?"
- "Show Ella's profile"
- "Deactivate John" — she tells you what will be kept, then asks you to confirm
- "Bring back Ella"
- "Add Alex Kim, alex@purdue.edu as Training Committee"
- "Add guide Alex Kim, alex@purdue.edu"

She follows the same permissions as everyone else, never deletes anything, and can't do more than the screens can.

---

## When something looks wrong

| You see | Do this |
|---|---|
| **Admin → Health** shows a red ✕ | Read the line; it says what to do. |
| Someone says they can't get in | People → search them. *Not signed up yet*: they need to press **Make a password** with the exact email. *Archived*: Restore them. If the sign-in page says new passwords are switched off, see below. |
| Someone sees an empty Hub | They have no role, an unrecognised role, or were never added. Fix on People. |
| A guide is missing from the tracker | Admin → Guides, filter *Archived* → Restore. |
| The schedule is empty | Admin → Settings → check the tour schedule link; check the spreadsheet still has this semester's month tabs and is shared. |
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

- **People → Export CSV**, **Guides → Export CSV**, **Training** CSV download, and **Activity → Export CSV** — do these when you start each semester and keep the files somewhere safe.
- The database lives in Supabase. Whether automatic restorable backups exist depends on the Supabase plan this project is on (free plans have historically not included them). A developer can check this and upgrade if needed.
