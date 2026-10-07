/* ============================================================ what people can ask for
   THE catalogue of intents. One place. Each entry says how an intent is recognised;
   what it DOES lives in capabilities/<capability>.js under the same id, and a
   test fails if the two lists ever disagree.

   An intent is recognised by RULES over tags (see lexicon.js) and by EXAMPLES.

     rule  { all: [...], none: [...], c }
           every item in `all` must hold, no item in `none` may, and the rule is worth `c`
           (0..1). An item is:
             'EVAL'          a concept the sentence expresses (lexicon.js)
             ['NEED','LEFT'] any one of these
             '@date'         an entity was found (extract.js): @date @today @time @person @people
                             @priority @major @session @requirement @count @ordinal @ref @mine
                             @page @quoted @attendance
             '$evaluation'   the conversation is already about this (dialog state)
             '$short'        the message is four words or fewer
             '#have'         the literal word

     examples  ordinary sentences that mean this. A new message is compared to them too
               (so a phrasing a rule never anticipated can still land), and tests check that
               every example resolves to its own intent.

   Where two rules both fit, the higher `c` wins; on a tie, the rule with more conditions
   (the more specific one). To teach Vanessa a new phrasing, add it to phrasebook.js.
============================================================================ */
import { PHRASEBOOK } from './phrasebook.js';

const R = (all, c, none = []) => ({ all, c, none });

export const SUBJECTS = ['schedule', 'evaluation', 'training', 'coverage', 'people', 'operations', 'data', 'assistant'];

/** @type {{id:string, capability:string, subject:string, label:string, rules:object[], examples:string[], none?:any[]}[]} */
const defs = [];
const def = (id, label, rules, examples = []) => defs.push({ id, capability: id.split('.')[0], subject: id.split('.')[0], label, rules, examples });

const NOT_ELSE = ['EVAL', 'TRAIN', 'COVER', 'CONFLICT', 'GAP', 'ANNOUNCE', 'BRIEF', 'PROBLEM'];

/* ------------------------------------------------------------------ schedule */
def('schedule.next', 'Someone’s next tour', [
  R(['NEXT', 'TOUR'], 0.93, ['EVAL', 'TRAIN', 'CONFLICT', 'COVER', 'GAP', 'WHO', '@date']),
  R(['WHEN', 'TOUR', ['@mine', '@person']], 0.88, ['EVAL', 'TRAIN', 'CONFLICT', 'COVER', '@date']),
  R(['NEXT', 'TOUR', '@person'], 0.94, ['EVAL', 'TRAIN', 'COVER', '@date'])
], ['when is my next tour', 'what is my next tour', 'when do i tour next', 'when is jordan’s next tour', 'when is the next tour i am on', 'when do i give a tour next']);

def('schedule.today', 'Who is touring today', [
  R(['TOUR', '@today'], 0.9, [...NOT_ELSE, '@person', 'NEXT']),
  R(['WHO', 'TOUR'], 0.84, [...NOT_ELSE, '@person', '@date', 'NEXT', 'MINE']),
  R(['SCHEDULE', '@today'], 0.88, [...NOT_ELSE, '@person'])
], ['who is touring today', 'who is on tour', 'who is giving tours today', 'what tours are today', 'today’s tours', 'who is leading tours today']);

def('schedule.date', 'Tours on a day or time', [
  R(['TOUR', '@date'], 0.9, [...NOT_ELSE, '@person', 'NEXT', '@today']),
  R(['SCHEDULE', '@date'], 0.88, [...NOT_ELSE, '@person', '@today']),
  R(['WHO', 'TOUR', '@date'], 0.92, [...NOT_ELSE, '@person', '@today']),
  R(['TOUR', '@time'], 0.86, [...NOT_ELSE, '@person']),
  R(['WHO', 'TOUR', '$schedule'], 0.7, [...NOT_ELSE, '@person'])
], ['who is touring tomorrow', 'who is on the schedule friday', 'what tours are on thursday afternoon', 'who is giving the 2 pm tour friday', 'show me next week’s tours', 'who tours on oct 12']);

def('schedule.person', 'One person’s tours', [
  R(['@person', 'TOUR'], 0.9, ['EVAL', 'TRAIN', 'COVER', 'CONFLICT', 'ANNOUNCE', 'NEXT', 'whocan', 'ADD', 'ARCHIVE', 'RESTORE', 'ASSIGN', 'SETITUP', 'WRITE', 'NOTE']),
  R(['SCHEDULE', '@person'], 0.88, ['EVAL', 'TRAIN', 'COVER', 'CONFLICT', 'ANNOUNCE', 'NEXT', 'ADD', 'ARCHIVE', 'RESTORE', 'ASSIGN', 'SETITUP', 'WRITE', 'NOTE']),
  R(['TOUR', '@ref'], 0.7, ['EVAL', 'TRAIN', 'COVER', 'CONFLICT', 'NEXT'])
], ['when does jordan tour this week', 'jordan’s schedule', 'is jordan touring friday', 'what tours does jordan have', 'show me jordan’s tours']);

def('schedule.conflicts', 'Schedule conflicts', [
  R(['CONFLICT'], 0.93),
  R(['PROBLEM', 'SCHEDULE'], 0.88),
  R(['PROBLEM', 'TOUR'], 0.84, ['EVAL', 'TRAIN']),
  R(['CONFLICT', '@date'], 0.95)
], ['any conflicts friday', 'is anyone double booked', 'any schedule issues this week', 'are there overlapping tours', 'any scheduling problems']);

/* --------------------------------------------------------------- evaluations */
def('evaluation.needs', 'Who still needs an evaluation', [
  R(['EVAL', 'OUTSTANDING'], 0.92, ['ASSIGN', 'SETITUP', 'CHANGE', 'WRITE', 'OPPORTUNITY', 'whocan', 'BEST', 'EVALUATOR', 'ADD', 'NOTNEED']),
  R(['EVAL', 'WHO'], 0.74, ['ASSIGN', 'SETITUP', 'CHANGE', 'WRITE', 'OPPORTUNITY', 'whocan', 'BEST', 'AVAILABLE', 'EVALUATOR', '@mine', 'HOWMANY', 'ADD', 'PRIO']),
  R(['EVAL', '@person'], 0.86, ['ASSIGN', 'SETITUP', 'CHANGE', 'WRITE', 'OPPORTUNITY', 'whocan', 'BEST', 'AVAILABLE', 'EVALUATOR', '@people', 'ADD', 'TRAIN', 'TOUR', 'SKIP', 'PRIORITY', 'ARCHIVE', 'RESTORE', 'NOTNEED']),
  R(['EVAL', 'DONE'], 0.82, ['ASSIGN', 'SETITUP', 'WRITE', 'OUTSTANDING', 'whocan', 'BEST', '@mine']),
  R(['EVAL', 'ALREADY'], 0.82, ['ASSIGN', 'SETITUP', 'WRITE', 'OUTSTANDING', 'whocan', 'BEST', '@mine']),
  R(['$evaluation', 'OUTSTANDING', 'WHO'], 0.82, ['ASSIGN', 'CHANGE', 'TRAIN', 'TOUR']),
  R(['EVAL', 'OUTSTANDING', '@major'], 0.94, ['ASSIGN', 'SETITUP', 'CHANGE', 'WRITE', 'OPPORTUNITY', 'whocan', 'BEST'])
], ['who needs evaluated', 'who still needs an eval', 'who hasn’t been evaled', 'which guides still need evaluations', 'who has not had an evaluation yet', 'who is left to evaluate', 'who still needs evaluated this week', 'the comp sci guy that needs evaluated', 'does jordan still need an eval']);

def('evaluation.priority', 'Who is high priority for evaluation', [
  R(['PRIO', 'EVAL'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE', 'OPPORTUNITY', 'whocan', 'BEST', 'FIND', '@person', 'TOUR']),
  R(['PRIO', 'WHO'], 0.8, ['ASSIGN', 'CHANGE', 'TRAIN', 'TOUR', 'COVER', '@person', 'ATTENTION', 'PROBLEM']),
  R(['PRIO', '$evaluation'], 0.88, ['ASSIGN', 'CHANGE', 'TRAIN', '@person']),
  R(['PRIO', 'GUIDE'], 0.82, ['ASSIGN', 'CHANGE', 'TRAIN', '@person', 'TOUR'])
], ['who is high priority', 'which guides are top priority for evals', 'show me the high priority evaluations', 'who is urgent to evaluate']);

def('evaluation.status', 'How evaluations are going', [
  R(['EVAL', 'HOWMANY'], 0.88, ['ASSIGN', 'CHANGE', 'OPPORTUNITY', 'whocan', '@person']),
  R(['EVAL', 'how'], 0.88, ['ASSIGN', 'CHANGE', 'OPPORTUNITY', 'whocan', '@person', 'WHO']),
  R(['EVAL', 'BRIEF'], 0.76, ['@person']),
  R(['EVAL', 'PROGRESS'], 0.88)
], ['how are evaluations going', 'how are the evals coming along', 'evaluation progress', 'how are evals looking this semester', 'how many guides have been evaluated']);

def('evaluation.opportunities', 'Evaluation opportunities', [
  R(['EVAL', 'OPPORTUNITY'], 0.93),
  R(['EVAL', 'MATCH'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE', 'EVALUATOR']),
  R(['EVAL', 'whocan'], 0.92, ['ASSIGN', 'SETITUP']),
  R(['FIND', 'EVAL'], 0.88, ['ASSIGN', 'SETITUP', 'WRITE', 'CHANGE']),
  R(['EVAL', 'BEST'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE']),
  R(['EVAL', 'OUTSTANDING', 'TOUR', '@date'], 0.95, ['ASSIGN', 'SETITUP', 'CHANGE']),
  R(['EVAL', 'OUTSTANDING', '@time'], 0.94, ['ASSIGN', 'SETITUP', 'CHANGE']),
  R(['EVAL', 'AVAILABLE'], 0.86, ['ASSIGN', 'SETITUP', 'EVALUATOR']),
  R(['BEST', '$evaluation'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE', 'TRAIN', 'COVER']),
  R(['BEST', 'WHO', '@date', '$evaluation'], 0.93, ['ASSIGN', 'SETITUP']),
  R(['EVAL', 'WHO', 'TOUR', '@date'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE']),
  R(['WHO', '#should', 'EVAL'], 0.9, ['ASSIGN', 'SETITUP', 'CHANGE', 'OUTSTANDING'])
], ['find eval opportunities this week', 'who can evaluate jordan', 'find me a high priority eval thursday', 'who should i evaluate this week', 'who is the best one to evaluate thursday', 'do we have anybody that really needs an eval and is touring thursday afternoon', 'any evaluation matches tomorrow']);

def('evaluation.assign', 'Assign an evaluator (confirmation needed)', [
  R(['ASSIGN', 'EVAL', '@person'], 0.94, ['WHO']),
  R(['ASSIGN', '@people'], 0.9, ['TRAIN', 'MAKEUP', 'COVER', 'ARCHIVE']),
  R([['#have', '#let', '#get', '#make', '#put', '#send', '#book'], 'EVAL', '@people'], 0.9, ['WHO', 'OUTSTANDING', 'TRAIN', 'MAKEUP']),
  R(['SETITUP', '$proposals'], 0.94, ['TRAIN', 'MAKEUP']),
  R(['ASSIGN', ['BEST', '@ordinal', '@count', 'SETITUP', 'MATCH', 'OPPORTUNITY'], '$proposals'], 0.94, ['TRAIN', 'MAKEUP']),
  R(['ASSIGN', 'EVAL', '$proposals'], 0.9, ['TRAIN', 'MAKEUP', 'WHO'])
], ['assign taylor to jordan thursday', 'have taylor evaluate jordan', 'assign the best one', 'set it up', 'book taylor to evaluate jordan on thursday']);

def('evaluation.set_priority', 'Change evaluation priority (confirmation needed)', [
  R(['CHANGE', 'PRIORITY', '@person'], 0.94),
  R(['CHANGE', '@person', 'PRIO'], 0.94),
  R(['PRIORITY', '@person', 'PRIO'], 0.92),
  R(['PRIORITY', '@person'], 0.9, ['WHO', 'WHAT', 'how', 'AVAILABLE']),
  R(['CHANGE', 'EVAL', 'PRIORITY'], 0.8, ['WHO'])
], ['make jordan high priority', 'set jordan’s evaluation priority to low', 'prioritize jordan for evaluation', 'mark alex as normal priority']);

def('evaluation.set_need', 'Mark whether someone needs an evaluation (confirmation needed)', [
  R(['EVAL', '@person', 'SKIP'], 0.9, ['WHO']),
  R(['EVAL', '@person', 'NOTNEED'], 0.93, ['WHO']),
  R(['CHANGE', 'EVAL', '@person', ['#needs', '#need']], 0.88),
  R(['ADD', 'EVAL', '@person', 'ROSTER'], 0.9)
], ['skip jordan’s evaluation this semester', 'jordan does not need an eval', 'add jordan to the evaluation roster', 'mark alex as needing an eval']);

def('evaluation.mine', 'My own evaluations', [
  R(['EVAL', '@mine'], 0.88, ['@person', 'OUTSTANDING', 'ASSIGN']),
  R(['EVALUATOR', '@mine'], 0.82, ['ASSIGN'])
], ['what are my evaluations', 'am i evaluating anyone', 'when am i being evaluated', 'who am i evaluating']);

def('evaluation.evaluators', 'The evaluators and who is free', [
  R(['EVALUATOR'], 0.9, ['ASSIGN', 'WRITE', 'CHANGE']),
  R(['AVAILABLE', 'EVAL', 'WHO'], 0.82, ['ASSIGN', 'OUTSTANDING', 'whocan'])
], ['who are the evaluators', 'which evaluators are free thursday', 'how many evaluations does each evaluator have']);

/* ------------------------------------------------------------------ training */
const TRAINISH = ['TRAIN', '@requirement', '@session'];
def('training.upcoming', 'Upcoming training sessions', [
  R(['TRAIN', ['NEXT', 'WHEN', '@date']], 0.9, ['MISSED', 'OUTSTANDING', 'MAKEUP', 'ATTEND', 'READY', 'ADD', 'MATERIALS', 'REMIND', '@person']),
  R(['TRAIN', 'SCHEDULE'], 0.88, ['MISSED', 'OUTSTANDING', 'MAKEUP', 'ATTEND', 'READY', 'ADD', '@person']),
  R(['TRAIN', 'WHAT'], 0.78, ['MISSED', 'OUTSTANDING', 'MAKEUP', 'ATTEND', 'READY', 'ADD', '@person', 'WHO', 'MATERIALS']),
  R(['@session', ['WHEN', 'NEXT']], 0.86, ['MISSED', 'MAKEUP', 'ATTEND', 'READY', '@person'])
], ['when is the next training', 'upcoming training sessions', 'is there training this week', 'what training sessions do we have', 'when is campus safety training']);

def('training.missing', 'Who missed or hasn’t done training', [
  R(['TRAIN', 'MISSED'], 0.93, ['@person', 'CHANGE', 'ASSIGN', 'MAKEUP', 'REMIND']),
  R(['MISSED', 'WHO'], 0.8, ['@person', 'CHANGE', 'ASSIGN', 'MAKEUP', 'EVAL', 'TOUR']),
  R([TRAINISH, 'OUTSTANDING', 'WHO'], 0.92, ['@person', 'CHANGE', 'MAKEUP', 'ASSIGN', 'EVAL']),
  R(['@requirement', 'OUTSTANDING'], 0.88, ['@person', 'CHANGE', 'MAKEUP', 'ASSIGN']),
  R(['TRAIN', 'WHO', 'NEG'], 0.86, ['@person', 'CHANGE', 'MAKEUP', 'ASSIGN']),
  R(['$training', 'MISSED', 'WHO'], 0.88, ['@person', 'CHANGE', 'ASSIGN'])
], ['who missed training', 'who missed training this week', 'who still needs training', 'who hasn’t done orientation', 'who is behind on training', 'who didn’t show up to campus safety']);

def('training.makeup', 'Who needs a makeup', [
  R(['MAKEUP'], 0.92, ['ASSIGN', 'SETITUP', 'CHANGE', 'ADD', 'REMIND', 'WRITE', '@person']),
  R(['MAKEUP', 'WHO'], 0.94, ['ASSIGN', 'SETITUP', 'REMIND', 'WRITE'])
], ['who needs a makeup', 'who owes makeup training', 'any makeup issues', 'how many makeups are outstanding']);

def('training.assign_makeup', 'Set up a makeup session (confirmation needed)', [
  R([['ASSIGN', 'SETITUP', 'ADD', '#schedule', '#set', '#book', '#create', '#put'], 'MAKEUP'], 0.94),
  R(['SETITUP', '$training'], 0.84, ['EVAL']),
  R([['ASSIGN', '#put', '#send'], '@ref', ['MAKEUP']], 0.95)
], ['assign them to a makeup', 'set up a makeup thursday for them', 'schedule a makeup for jordan', 'put them on a makeup friday']);

def('training.person', 'One person’s training', [
  R(['@person', TRAINISH], 0.92, ['CHANGE', 'ASSIGN', 'MAKEUP', 'ADD', 'REMIND', 'ATTEND', 'EVAL', 'TOUR']),
  R(['@person', 'MAKEUP'], 0.9, ['ASSIGN', 'SETITUP', 'REMIND']),
  R(['TRAIN', '@ref'], 0.78, ['CHANGE', 'ASSIGN', 'MAKEUP', 'ADD', 'REMIND', 'ATTEND', 'EVAL', 'TOUR'])
], ['what training does jordan still need', 'is jordan done with orientation', 'did jordan miss training', 'jordan’s training status']);

def('training.mine', 'My own training', [
  R(['TRAIN', '@mine'], 0.9, ['@person', 'ASSIGN', 'ADD', 'MATERIALS']),
  R(['TRAIN', '#caught', '@mine'], 0.93),
  R(['TRAIN', 'NEED', 'WHAT'], 0.74, ['@person', 'WHO', 'ASSIGN', 'ADD']),
  R(['@requirement', '@mine'], 0.88)
], ['what training do i still need', 'what training do i have left', 'am i caught up on training', 'did i complete orientation']);

def('training.attendance', 'Attendance at a session', [
  R(['ATTEND', TRAINISH], 0.93, ['CHANGE', 'ASSIGN', '@attendance']),
  R(['ATTEND', 'WHO'], 0.82, ['CHANGE', 'ASSIGN', '@attendance']),
  R(['WHO', 'ATTEND'], 0.82, ['CHANGE', 'ASSIGN'])
], ['who attended campus safety', 'attendance for the last training', 'how was attendance at orientation', 'who showed up to new guide training']);

def('training.mark_attendance', 'Record attendance (confirmation needed)', [
  R(['CHANGE', '@person', '@attendance'], 0.94),
  R([['#mark', '#record', '#put', '#log'], '@person', '@attendance'], 0.94),
  R([['#mark', '#record', '#log'], 'ATTEND'], 0.86),
  R(['@person', '@attendance', ['@session', 'TRAIN']], 0.93, ['WHO', 'WHEN', '@question'])
], ['mark jordan absent for new guide training', 'record taylor as late', 'mark everyone attended', 'jordan was excused from campus safety']);

def('training.readiness', 'Is a session ready', [
  R(['READY', TRAINISH], 0.94),
  R(['READY', '@date', 'TRAIN'], 0.94),
  R(['READY', '$training'], 0.86)
], ['are we ready for training tomorrow', 'is the next training ready', 'is new guide training good to go', 'what is missing for the next session']);

def('training.overview', 'How training is going', [
  R(['TRAIN', ['how', 'HOWMANY', 'BRIEF', 'PROGRESS']], 0.88, ['@person', 'MISSED', 'MAKEUP', 'ATTEND', 'READY', 'ADD', '@mine']),
  R(['TRAIN', 'PROBLEM'], 0.86, ['@person'])
], ['how is training going', 'how is training coming along', 'how many people are done with training', 'any training problems']);

def('training.materials', 'Training materials', [
  R(['MATERIALS'], 0.9, ['ADD', 'WRITE'])
], ['where are the training slides', 'training materials for campus safety', 'any handouts for orientation']);

def('training.remind', 'Draft a reminder', [
  R(['REMIND', [...TRAINISH, 'MAKEUP', 'OUTSTANDING', '@ref']], 0.92),
  R([['#draft', '#write', '#compose'], ['#reminder', '#reminders', '#message', '#email', '#nudge'], ['@ref', 'OUTSTANDING', 'MISSED']], 0.9)
], ['draft a reminder for them', 'write a reminder to the people who missed training', 'remind everyone about makeups']);

def('training.create_session', 'Create a training session (confirmation needed)', [
  R(['TRAIN', [...['ADD', '#schedule', '#set', '#plan', '#host', '#create', '#put']], '@date'], 0.93, ['MAKEUP', 'WHO', 'MISSED']),
  R([['ADD', '#schedule', '#create', '#plan'], 'TRAIN', ['#called', '#titled', '@quoted']], 0.94, ['MAKEUP'])
], ['schedule a training called leadership skills on friday at 6', 'create a training session next tuesday', 'add a training session october 20']);

def('training.copy_setup', 'Copy a semester’s training setup (confirmation needed)', [
  R(['TRAIN', ['#copy', '#duplicate', '#clone'], 'SEMESTER'], 0.92),
  R([['#copy', '#duplicate', '#clone'], 'TRAIN'], 0.86)
], ['copy fall 2026 training to spring 2027', 'duplicate last semester’s training setup']);

def('training.set_completion', 'Mark training complete or excused (confirmation needed)', [
  R(['@person', ['#excuse', '#waive', '#exempt', '#complete', '#completed'], ['@requirement', 'TRAIN']], 0.94, ['WHO', '@question']),
  R([['#excuse', '#waive', '#exempt'], '@person'], 0.8, ['WHO', 'EVAL', '@question'])
], ['excuse jordan from orientation', 'mark taylor complete for campus safety', 'waive accessibility training for alex']);

/* ------------------------------------------------------------------ coverage */
def('coverage.open', 'Uncovered desk slots', [
  R(['GAP', ['DESK', 'COVER', 'SCHEDULE']], 0.92, ['@person', '@page']),
  R(['DESK', 'COVER'], 0.92, ['@person']),
  R(['DESK', ['@date', 'GAP', 'NEG']], 0.84, ['@person']),
  R(['COVER', 'WHO', 'NEG'], 0.7, ['@person', 'TOUR', '@mine']),
  R(['GAP', 'WHAT'], 0.7, ['@person', 'EVAL', 'TRAIN'])
], ['which desk slots are uncovered', 'is the front desk covered this week', 'any coverage gaps', 'what desks have nobody on them', 'do we have open desk shifts']);

def('coverage.suggest', 'Who could cover', [
  R(['COVER', '@person'], 0.92, ['DESK', '@question']),
  R(['COVER', '@person', 'NEG'], 0.93, ['DESK']),
  R(['COVER', '@mine'], 0.9, ['DESK', '@question']),
  R(['whocan', 'TOUR', '@person'], 0.92, ['EVAL', 'DESK']),
  R(['whocan', 'COVER'], 0.93, ['DESK', 'EVAL']),
  R(['COVER', 'TOUR', '$coverage'], 0.88, ['DESK']),
  R(['COVER', '@ref'], 0.84, ['DESK'])
], ['who could cover casey tomorrow', 'casey can’t make her friday tour', 'i can’t make my tour thursday', 'who can take jordan’s tour', 'who is free to cover for alex']);

def('coverage.person', 'Whether someone’s tour has company', [
  R(['COVER', '@person', '@question'], 0.9, ['DESK', 'whocan', 'NEG', 'FIND', 'BEST'])
], ['is casey’s tour covered', 'is casey’s friday tour covered', 'is jordan’s tour covered tomorrow']);

/* -------------------------------------------------------------------- people */
def('people.search', 'Find or count Tour Guides', [
  R(['@major', ['WHO', 'SHOW', 'FIND', 'GUIDE', 'HOWMANY', 'PEOPLEWORD']], 0.9, ['EVAL', 'TRAIN', 'TOUR', 'COVER', '@person', 'MAJOR']),
  R(['MAJOR', '@major'], 0.9, ['EVAL', 'TRAIN', 'TOUR', 'COVER', '@person', 'CHANGE']),
  R(['LEADERSHIP'], 0.9, ['EVAL', 'TRAIN', 'TOUR', 'ANNOUNCE', 'ADD', 'CHANGE']),
  R(['CODIRECTOR', 'WHO'], 0.9, ['EVAL', 'TRAIN', 'TOUR', 'ANNOUNCE', 'ADD', 'CHANGE', 'ROLE_CHANGE']),
  R(['NOMAJOR'], 0.92, ['CHANGE', 'ADD']),
  R(['NOTONSCHEDULE'], 0.9, ['EVAL', 'TRAIN', 'COVER']),
  R(['NEWGUIDE'], 0.9, ['EVAL', 'TRAIN', 'ADD', 'ANNOUNCE', 'ASSIGN']),
  R(['HOWMANY', 'GUIDE'], 0.86, ['EVAL', 'TRAIN', 'TOUR', 'COVER', 'CONFLICT', 'OUTSTANDING', 'MISSED', '@person']),
  R(['GUIDE', 'ROSTER'], 0.82, ['EVAL', 'TRAIN', 'ADD', 'CHANGE', '@person'])
], ['who are the cs majors', 'who is on leadership', 'which guides have no major', 'who isn’t on the schedule', 'who is new this semester']);

def('people.active', 'Who is active, inactive or new', [
  R(['ACTIVE', ['WHO', 'HOWMANY', 'GUIDE', 'PEOPLEWORD', 'ROSTER']], 0.9, ['EVAL', 'TRAIN', 'TOUR', 'ARCHIVE', 'RESTORE', 'CHANGE', '@person', 'CONFLICT', 'SYNC', 'LEADERSHIP', 'NEWGUIDE', 'NOMAJOR', 'NOTONSCHEDULE', '@major'])
], ['how many active guides do we have', 'who is inactive', 'who are the archived guides', 'list the active tour guides']);

def('people.profile', 'About one person', [
  R(['PROFILE', '@person'], 0.94, ['EVAL', 'TRAIN', 'TOUR', 'COVER']),
  R(['FIND', '@person'], 0.86, ['EVAL', 'TRAIN', 'TOUR', 'COVER', 'ADD']),
  R(['WHO', '@person'], 0.8, ['EVAL', 'TRAIN', 'TOUR', 'COVER', 'ATTEND', 'MISSED', 'OUTSTANDING', 'NEED', 'MAJOR', 'ASSIGN', 'CHANGE', 'MAKEUP', 'NEXT']),
  R(['@person', '$short'], 0.74, ['EVAL', 'TRAIN', 'TOUR', 'COVER', 'ATTEND', 'MISSED', 'MAJOR', 'ASSIGN', 'CHANGE', 'NEXT', '@people', 'OUTSTANDING']),
  R(['PROFILE', '@ref'], 0.86),
  R(['@ordinal', '$people'], 0.8, ['EVAL', 'TRAIN', 'TOUR'])
], ['tell me about jordan', 'pull up taylor brown', 'who is alex green', 'show me jordan’s profile', 'look up casey']);

def('people.major', 'Majors', [
  R(['MAJOR', '@person'], 0.94, ['CHANGE', 'EVAL']),
  R(['MAJOR', '@ref'], 0.86, ['CHANGE']),
  R(['MAJOR', ['WHAT', 'HOWMANY', 'how']], 0.8, ['@major', 'CHANGE', 'EVAL', 'TRAIN']),
  R(['MAJOR'], 0.66, ['@major', 'CHANGE'])
], ['what is jordan’s major', 'what majors do we have', 'how many different majors are there', 'what does jordan study']);

def('people.add', 'Add a Tour Guide (confirmation needed)', [
  R(['ADD', ['GUIDE', 'ROSTER', 'PEOPLEWORD']], 0.93, ['EVAL', 'TRAIN', 'ANNOUNCE', 'MAKEUP', 'NOTE']),
  R([['#add', '#create', '#register', '#invite'], ['#new'], ['GUIDE']], 0.92, ['EVAL', 'TRAIN'])
], ['add alex smith as a tour guide', 'add a new tour guide casey lee', 'create a guide named sam rivera']);

def('people.archive', 'Archive or restore a Tour Guide (confirmation needed)', [
  R(['ARCHIVE', '@person'], 0.94, ['TRAIN', 'EVAL', 'ANNOUNCE', 'NOTE']),
  R(['RESTORE', '@person'], 0.94),
  R([['#deactivate', '#reactivate'], '@person'], 0.94)
], ['archive dana', 'restore dana reyes', 'deactivate jordan lee', 'reactivate casey']);

def('people.note', 'Add a note to a Tour Guide (confirmation needed)', [
  R(['NOTE', '@person', ['ADD', 'WRITE', 'CHANGE', '#put', '#leave', '#make']], 0.92)
], ['add a note to jordan: follow up about schedule', 'leave a note on casey that she is out friday']);

def('people.update', 'Change a Tour Guide’s details (confirmation needed)', [
  R(['CHANGE', 'MAJOR', '@person'], 0.92),
  R(['CHANGE', '@person', ['#email', '#leadership', '#evaluator', '#eligible']], 0.9)
], ['change jordan’s major to biology', 'update casey’s email to casey@purdue.edu', 'make alex leadership']);

def('people.role', 'Change someone’s role (confirmation needed)', [
  R([['CHANGE', '#make', '#give', '#set', '#promote', '#demote'], 'ROLE'], 0.93, ['@question', 'WHO', 'EVAL', 'TRAIN', 'ANNOUNCE', 'SEMESTER']),
  R([['#make', '#promote', '#demote'], '@person', 'CODIRECTOR'], 0.94, ['@question', 'WHO'])
], ['make jordan an admin', 'change taylor’s role to training committee', 'give casey admin access']);

def('people.semester', 'Mark someone active or not active this semester (confirmation needed)', [
  R(['SEMESTER', '@person', ['ACTIVE', '#inactive']], 0.88, ['WHO', '@question', 'ARCHIVE', 'RESTORE'])
], ['mark jordan not active this semester', 'jordan is active this semester']);

def('people.nickname', 'Remember a nickname', [
  R([['#say', '#call', '#calls'], ['#mean', '#means', '#is', '#as'], '@person'], 0.92),
  R(['#nickname', '@person'], 0.9)
], ['when i say jd i mean jordan smith', 'call jordan jd', 'forget the nickname jd']);

/* ---------------------------------------------------------------- operations */
def('operations.brief', 'The operations brief', [
  R(['BRIEF'], 0.93, ['@person', 'WRITE', 'ANNOUNCE']),
  R(['BRIEF', ['TRAIN', 'EVAL', '@range', '@date']], 0.94, ['@person'])
], ['what is going on today', 'give me the brief', 'brief me', 'catch me up', 'give me the weekly plan', 'what is happening this week', 'morning brief']);

def('operations.problems', 'What needs attention', [
  R(['WORRY'], 0.95),
  R(['ATTENTION'], 0.9, ['@mine', '@person']),
  R(['PROBLEM'], 0.84, ['SCHEDULE', 'CONFLICT', 'SYNC', 'SOURCE', 'UNMATCHED', 'TRAIN', 'EVAL', '@person']),
  R(['PRIO', 'ASK', '$operations'], 0.78, ['EVAL', 'TRAIN', '@person']),
  R(['PRIO', 'WHAT'], 0.74, ['EVAL', 'GUIDE', 'WHO', 'TRAIN', '@person', 'TOUR'])
], ['anything i need to worry about', 'what needs attention today', 'what is going wrong this week', 'any problems', 'is anything on fire']);

def('operations.actions', 'My Action Center', [
  R([['#action', '#actions'], ['#center', '#centre', '#items', '#list']], 0.94),
  R(['ATTENTION', '@mine'], 0.93),
  R([['#todo', '#todos']], 0.8)
], ['show my action center', 'what is in my action center', 'what is on my plate']);

def('operations.announcements', 'Recent announcements', [
  R(['ANNOUNCE'], 0.9, ['ADD', 'WRITE', '#post', '#send', '#broadcast', '#announce', 'CHANGE', 'TRAIN', '@quoted']),
  R(['ANNOUNCE', 'NEW'], 0.92, ['ADD', 'WRITE', '#post', '#send']),
  R(['ANNOUNCE', 'WHAT'], 0.92, ['ADD', 'WRITE', '#post', '#send', '@quoted'])
], ['any announcements', 'what are the latest announcements', 'summarize recent announcements', 'anything new posted']);

def('operations.announce', 'Post an announcement (confirmation needed)', [
  R(['ANNOUNCE', ['ADD', 'WRITE', '#post', '#send', '#broadcast', '#announce', '#tell', '#let']], 0.92, ['WHAT', 'WHEN']),
  R([['#announce', '#broadcast'], '@quoted'], 0.95),
  R([['#tell', '#let', '#message', '#notify'], ['#team', '#committee', '#all', 'WHO'], '@quoted'], 0.9),
  R([['#tell', '#let', '#notify'], 'WHO', '#that'], 0.93, ['@question'])
], ['post an announcement that training is moved to friday', 'announce “new guide training moves to 7 pm”', 'tell everyone that tours are cancelled monday']);

def('operations.mark_read', 'Mark announcements as read', [
  R(['ANNOUNCE', ['#read', '#seen', '#clear', '#dismiss']], 0.9, ['WHAT', '@question'])
], ['mark announcements as read', 'clear my announcements']);

def('operations.semester', 'The current semester', [
  R(['SEMESTER', ['WHAT', 'WHEN', 'how']], 0.86, ['TRAIN', 'EVAL', 'ADD', '@major', '@person', 'ACTIVE']),
  R(['SEMESTER', ['#dates', '#start', '#end', '#starts', '#ends']], 0.9)
], ['what semester is it', 'when does the semester end', 'what is the current semester']);

def('operations.activity', 'Recent activity', [
  R(['ACTIVITY', ['WHAT', 'WHO', 'how', '#recent', '#recently', '#lately', '#today', '#yesterday', '#show', 'SHOW']], 0.86, ['@person', 'ADD', 'ASSIGN', 'SETITUP', 'MAJOR', 'PRIORITY', 'EVAL', 'TRAIN', 'PROFILE']),
  R(['#audit'], 0.9),
  R(['#recent', 'ACTIVITY'], 0.9, ['@person'])
], ['what changed recently', 'show recent activity', 'what did vanessa change', 'show the audit log']);

def('operations.open', 'Open a page', [
  R(['OPEN', '@page'], 0.95, ['@person'])
], ['open the evaluation roster', 'take me to the schedule', 'go to training', 'open reconciliation']);

/* ---------------------------------------------------------------------- data */
def('data.sync_status', 'Is everything synced', [
  R(['SYNC'], 0.9, ['@person', 'UNMATCHED']),
  R(['SYNC', '#data'], 0.92, ['@person', 'UNMATCHED']),
  R(['SOURCE', ['how', 'WHAT', 'NEG', 'PROBLEM', '#working', '#ok', '#fine', '#healthy', '#connected']], 0.86, ['UNMATCHED']),
  R(['PROBLEM', ['SOURCE', 'SYNC']], 0.9)
], ['is everything synced', 'did the schedule sync', 'is the data up to date', 'when did the spreadsheet last sync', 'are the sources working']);

def('data.unmatched', 'Names that don’t match', [
  R(['UNMATCHED'], 0.94, ['MATCH', '@person', '@page']),
  R(['MATCH', 'NEED'], 0.84, ['EVAL', 'TRAIN']),
  R(['UNMATCHED', 'WHAT'], 0.95)
], ['which names don’t match', 'any unmatched names', 'what still needs matching', 'any unknown names on the schedule']);

def('data.match', 'Match a spreadsheet name to a Tour Guide (confirmation needed)', [
  R(['MATCH', '@person', ['$data', 'SOURCE', 'SCHEDULE', '#name', '#names', '#spreadsheet']], 0.9, ['EVAL', 'OPPORTUNITY']),
  R(['MATCH', '@person', '@quoted'], 0.94, ['EVAL', 'OPPORTUNITY']),
  R(['UNMATCHED', '@person', ['#is', '#means', '#as', '#to']], 0.9)
], ['match jordy s to jordan smith', 'jordy s is jordan smith', 'the schedule name jordy is jordan smith']);

/* ----------------------------------------------------------------- the assistant */
def('assistant.help', 'What Vanessa can do', [R(['HELP'], 0.95)], ['what can you do', 'help', 'how do you work', 'what can i ask you']);
def('assistant.greet', 'Hello', [R(['GREET', '$short'], 0.92)], ['hi', 'hello vanessa', 'good morning']);
def('assistant.thanks', 'Thanks', [R(['THANKS', '$short'], 0.92)], ['thanks', 'thank you', 'great, thanks', 'perfect']);
def('assistant.engine', 'How Vanessa is running', [
  R([['#ai', '#llm', '#model', '#brain', '#mode'], ['WHAT', 'WHO', 'how', 'NEG', '#you', '#are', '#using']], 0.82),
  R([['#local'], ['#ai', '#model']], 0.9)
], ['are you using ai', 'which mode are you in', 'is the local model on', 'what model are you running']);

export const INTENTS = defs.map(d => ({ ...d, examples: [...d.examples, ...(PHRASEBOOK[d.id] || [])] }));
export const INTENT_IDS = INTENTS.map(d => d.id);
export const byId = new Map(INTENTS.map(d => [d.id, d]));
