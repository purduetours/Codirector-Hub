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
  { k: ['cannot see', 'hidden', 'others', 'other people', 'why can', 'missing evals'],
    a: 'Committee members see evals that are open or claimed, plus their own submitted ones. Somebody else\'s completed eval is invisible, and that is enforced by the database rather than by the app hiding it. Codirectors see everything.' },
  { k: ['priority', 'first priority', 'last priority', 'order', 'rank'],
    a: 'Priority is how urgently a guide needs evaluating, first through last. Guides marked "No Need to Eval" or "Not Needed to be Evaled" are out of rotation this term. The roster sorts by priority so the most urgent are at the top.' },
  { k: ['rollover', 'end of semester', 'new semester', 'promote', 'next term'],
    a: 'End of semester moves every guide up one priority tier and starts a fresh term. Preview it first — it shows exactly what will change. It cannot be run twice for the same pair of terms, so a stuck connection cannot promote everybody twice.' },
  { k: ['grade', 'grading', 'score', 'scores', 'rubric', 'interview day'],
    a: 'On Interviews, the Grade tab lists everyone checked in. Score each candidate 1 to 5 on speaking, personable and overall impression. You are scoring as whoever you signed in as — there is no name to pick — and nobody can write over your scores.' },
  { k: ['blank', 'skip', 'leave empty', 'leave a score blank', 'score blank', 'not sure', 'did not judge', 'ok to leave'],
    a: 'Leaving a score blank is fine. A blank is skipped, never counted as a zero, so it does not drag the candidate down. Their average is worked out from whoever actually scored that criterion.' },
  { k: ['final', 'average', 'calculated', 'worked out', 'maths', 'math'],
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
    a: 'Tour Schedule is read straight out of the shared workbook, and cached until Refresh. It shows from today onward.' },
  { k: ['password', 'sign in', 'login', 'log in', 'account', 'cannot get in'],
    a: 'Sign in with your Purdue email and password. If you have no account, a codirector adds you — there is no shared code any more.' },
  /* Written out by hand, unlike everything else she quotes.

     The handbook's do's-and-don'ts page is a two-column graphic, and the PDF
     extractor flattens it into one run of words with the "Do's:" and "Don'ts:"
     headings stranded on a different page entirely. Quoted raw it reads as a
     single list, so a guide would be told a name tag and flip flops are the
     same kind of thing. This is the same content, put back in the right order. */
  { book: true, k: ['wear', 'dress', 'dress code', 'attire', 'outfit', 'what to wear', 'clothes',
        'clothing', 'uniform', 'polo', 'jeans', 'shorts', 'shoes', 'sandals', 'flip flops',
        'sunglasses', 'look book', 'can i wear'],
    a: 'On tour, wear:\n' +
       '- Your name tag\n' +
       '- Your Admissions polo\n' +
       '- Jeans or khakis, no holes — or jean/khaki shorts, or a tennis skirt\n' +
       '- Close-toed shoes\n\n' +
       'Not allowed:\n' +
       '- Flip flops or sandals\n' +
       '- Athletic or leisure clothing\n' +
       '- Other university gear or merch\n' +
       '- Sunglasses\n' +
       '- Chewing gum or food\n\n' +
       'Turning up without a name tag or in the wrong clothes is a strike. (Handbook, Boilermaker Look Book, p. 10–11.)' },

  /* The rest of the handbook answers she advertises but could not reliably
     find. Each one is a straight rendering of the handbook page named at the
     end -- nothing here is invented. They live as topics rather than as
     retrieval hits because the extracted PDF text runs headings, tables and
     unrelated pages together, so the right paragraph regularly lost to the
     wrong one. Keywords are deliberately specific: a bare 'sub' would match
     'submitted', and a bare 'miss' would match 'dismiss'. */
  { book: true, k: ['absence', 'absences', 'absent', 'cant make', 'cannot make', 'miss my tour',
        'miss a tour', 'find a sub', 'tour sub', 'drop my tour', 'drop a tour',
        'call in sick', 'if i am sick', 'if im sick', 'cover my tour', 'swap my tour'],
    a: 'Tell them as early as you possibly can. If you know you cannot give a tour, drop it as soon as you know — and if nobody picks it up, message Todd or Amanda directly to be safe.\n\n' +
       'What it costs you if you do not:\n' +
       '- Failing to find a sub for an unexcused absence — 1 strike\n' +
       '- Not showing up without telling Amanda or Todd beforehand — 2 strikes\n\n' +
       'Excused absences go through Todd or Amanda. Strikes reset at the end of each academic year; 2 gets you a written warning, 3 or more and you are reviewed for termination. (Handbook, Absences and Expectations, p. 12.)' },

  { book: true, k: ['postcard', 'postcards', 'post card', 'thank you card', 'when are postcards due'],
    a: 'Postcards go to the families you toured, and they are due one week after your tour slot — a Monday tour means postcards by the following Monday.\n\n' +
       '- Make it personal: mention a moment from the tour, or a decent joke\n' +
       '- Keep it professional: check the spelling of the student\u2019s name, write legibly, keep the tone welcoming\n' +
       '- Point them at the admissions email for anything they still want to ask\n\n' +
       'They are one of the things that sets Purdue apart from other schools, which is why the deadline is taken seriously. (Handbook, Postcard Etiquette, p. 15.)' },

  { book: true, k: ['dont know an answer', 'do not know an answer', 'dont know the answer',
        'if i dont know', 'if i do not know', 'asked something i dont know',
        'myth', 'myths', 'legend has it', 'not sure on tour', 'unsure on tour',
        'make something up'],
    a: 'Do not make it up. Stick to the facts, and if you are not certain, say so plainly in the conversation — make clear it is a myth or that we are not positive it is true.\n\n' +
       '"Legend has it…" is the handbook\u2019s own phrasing for this. Myths are fun, but never let one be heard as fact.\n\n' +
       'For anything you genuinely cannot answer, give them the admissions email and let the office follow it up. (Handbook, Myth Busters, and About the Role.)' },

  { book: true, k: ['webclock', 'web clock', 'clock in', 'clock out', 'clocking in', 'timesheet',
        'forgot to clock', 'my hours', 'get paid', 'timekeeping'],
    a: 'WebClock lives at one.purdue.edu under "WebClock Timekeeping System". Sign in with your Purdue Career account and press the big circle to clock in; the same circle says Clock Out when you are done.\n\n' +
       'Forgot to clock in or out? Go to the History tab, click the time you need to change, pick a reason for the correction, adjust it and submit. (Handbook, Navigating WebClock.)' },

  { book: true, k: ['make it personal', 'personal story', 'personal stories', 'tour personal',
        'make my tour better', 'better tour', 'more interesting tour', 'trash talk',
        'other schools', 'acronym', 'acronyms'],
    a: 'Personal stories are what make a tour worth taking. Use your own, or borrow one from another Ambassador — do not be afraid to get personal.\n\n' +
       'Three things to avoid:\n' +
       '- The only school you mention is Purdue. Trash talking anywhere else is a bad look, however funny the joke\n' +
       '- Do not get into the weeds\n' +
       '- Say acronyms out in full — PMO, WALC, BGR, CODO — or families think we have a secret language\n\n' +
       'On a large group, check they can hear you: ask the people at the back for a thumbs up whenever you get outside. (Handbook, Make It Personal / Don\u2019t Be A Hater / Keep It.)' },

  { k: ['what are you', 'vanessa', 'help', 'what can you do'],
    a: 'I am Vanessa. I can answer questions about how the hub works, count things up for you, point out candidates worth discussing, and jump you to the right tab. Try "who still needs an eval", "who is worth discussing" or "show me ungraded".' }
];
