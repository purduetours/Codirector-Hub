/* ============================================================ what Vanessa knows
   Hand-written answers about how the hub works, matched on keywords. No model
   involved, so these work on every phone, offline, instantly.

   This is the part that does the onboarding a codirector currently does by
   hand: "how do I claim someone", "why can't I see the other evals".
============================================================================ */
export const TOPICS = [
  { k: ['claim', 'claiming', 'claim someone', 'claim a guide', 'take', 'sign up', 'pick a guide'],
    a: 'Open Eval Tracker, find them on the Available tab and press Claim. If the schedule knows when they are leading a tour you can pick one from the list; otherwise type the date yourself. Claiming is first come first served — if two people go for the same guide at once, one gets them and the other is told.' },
  { k: ['release', 'unclaim', 'give back', 'drop', 'cancel'],
    a: 'On a guide you have claimed, the ✕ button puts them back on the Available list. Codirectors can release anybody\'s claim.' },
  { k: ['submit', 'submitting', 'feedback', 'form', 'write up'],
    a: 'Press Submit eval on a guide you have claimed. You need at least something in "what went well" or "areas to improve". Once submitted it cannot be edited from here — ask a codirector.' },
  { k: ['see', 'cannot see', 'hidden', 'others', 'other people', 'why can', 'missing evals'],
    a: 'Committee members see evals that are open or claimed, plus their own submitted ones. Somebody else\'s completed eval is invisible, and that is enforced by the database rather than by the app hiding it. Codirectors see everything.' },
  { k: ['priority', 'first priority', 'last priority', 'order', 'rank'],
    a: 'Priority is how urgently a guide needs evaluating, first through last. Guides marked "No Need to Eval" or "Not Needed to be Evaled" are out of rotation this term. The roster sorts by priority so the most urgent are at the top.' },
  { k: ['rollover', 'end of semester', 'new semester', 'promote', 'next term'],
    a: 'End of semester moves every guide up one priority tier and starts a fresh term. Preview it first — it shows exactly what will change. It cannot be run twice for the same pair of terms, so a stuck connection cannot promote everybody twice.' },
  { k: ['grade', 'grading', 'score', 'scores', 'rubric', 'interview day'],
    a: 'On Interviews, the Grade tab lists everyone checked in. Score each candidate 1 to 5 on speaking, personable and overall impression. You are scoring as whoever you signed in as — there is no name to pick — and nobody can write over your scores.' },
  { k: ['blank', 'skip', 'leave empty', 'leave a score blank', 'score blank', 'not sure', 'did not judge', 'ok to leave'],
    a: 'Leaving a score blank is fine. A blank is skipped, never counted as a zero, so it does not drag the candidate down. Their average is worked out from whoever actually scored that criterion.' },
  { k: ['final', 'average', 'how is', 'calculated', 'worked out', 'maths', 'math'],
    a: 'Each of the three criteria is averaged across the interviewers who scored it, and the final is the average of those three numbers. It is deliberately not the average of every individual score — averaging each criterion first stops one person skipping one box from skewing the result.' },
  { k: ['check in', 'checkin', 'arrive', 'front desk', 'door'],
    a: 'On Interviews, the Check in tab has a tick next to every candidate. Tick them as they arrive; only checked-in candidates appear on the Grade tab.' },
  { k: ['decision', 'yes', 'maybe', 'no', 'hire', 'decide'],
    a: 'The Decisions tab records Yes, Maybe or No for each candidate. Pressing the answer that is already selected clears it, so a misclick is one tap to undo.' },
  { k: ['email', 'emails', 'copy', 'contact'],
    a: 'Results and Decisions both have a Copy emails button, which copies the addresses of whoever is currently listed so you can paste them into Gmail.' },
  { k: ['desk', 'desks', 'welcome desk', 'coverage', 'uncovered'],
    a: 'Desk Coverage shows the recurring weekly grid for the Front and Welcome desks, read live from the shared schedule workbook. Slots nobody is covering are flagged.' },
  { k: ['schedule', 'tour', 'tours', 'when', 'leading'],
    a: 'Tour Schedule is read straight out of the shared workbook, so it is never a stale copy. It shows from today onward.' },
  { k: ['password', 'sign in', 'login', 'log in', 'account', 'cannot get in'],
    a: 'Sign in with your Purdue email and password. If you have no account, a codirector adds you — there is no shared code any more.' },
  { k: ['who', 'what are you', 'vanessa', 'help', 'what can you do'],
    a: 'I am Vanessa. I can answer questions about how the hub works, count things up for you, point out candidates worth discussing, and jump you to the right tab. Try "who still needs an eval", "who is worth discussing" or "show me ungraded".' }
];
