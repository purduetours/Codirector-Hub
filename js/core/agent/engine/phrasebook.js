/* ============================================================ phrasing Vanessa has been taught
   Extra ways of asking for something, per intent. This is the ONLY place to add a
   phrasing she didn't understand: Admin > Vanessa lists the phrases she missed on
   this device and has a "Copy for the developer" button that prints entries for here.

   Rules of the road:
     - plain sentences, as a person would type them
     - leave names, dates and numbers out ("who needs evaluated", not "does Jordan need an eval Friday");
       she finds those separately
     - one idea per sentence
   Every entry here is checked by the tests (tests/node/engine.test.mjs): each phrase must resolve to
   the intent it is filed under, so a typo or an overlap with another intent fails loudly instead of
   quietly changing how she behaves. Nothing in the app edits this file.
*/
export const PHRASEBOOK = {
  'evaluation.needs': ['who is still unevaluated', 'who has yet to be evaluated', 'which tour guides are waiting on an eval', 'who do we still owe an evaluation'],
  'evaluation.opportunities': ['who can we get evaluated this week', 'any good eval matches', 'who is the most urgent person we can evaluate tomorrow'],
  'schedule.conflicts': ['is anyone scheduled twice at the same time', 'any overlaps in the schedule'],
  'training.missing': ['who is behind on required training', 'who hasn’t finished orientation'],
  'operations.brief': ['give me the rundown', 'what is the state of things', 'what is on deck today'],
  'operations.problems': ['is there anything i should be worried about', 'any fires i need to put out'],
  'data.sync_status': ['is the schedule feed working', 'is the data fresh']
};
