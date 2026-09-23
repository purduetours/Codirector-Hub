/* ============================================================ Vanessa hints
   One thing she can answer about the page you are on, shown as a single chip
   under the title. The point is that she turns up where she is useful and
   stays out of the way everywhere else — so most pages have one question, a
   few have none, and none of them get a chat box.

   Every question here is one her matcher already answers (see vanessa.js).
   Each is gated on the same role checks the router uses, which matters less
   than it sounds: a page's hint only renders on that page, and the router
   will not show a page the role cannot reach. The check is belt and braces.
============================================================================ */
import { isAdmin, inTraining, inRecruitment } from './state.js';

const HINTS = {
  evals:      () => inTraining()    && ['Who needs an eval and has a tour tomorrow?', 'What are my evals?'],
  interviews: () => inRecruitment() && ['Who is worth discussing?', 'Who is ungraded?'],
  training:   () => isAdmin()       && ['Who owes a makeup?'],
  schedule:   () =>                    ['Who is leading tours tomorrow?'],
  desks:      () => inTraining()    && ['Which desk slots are uncovered?'],
  directory:  () => inTraining()    && ['Who still needs an eval?']
};

export function hintsFor(id) {
  const pick = HINTS[id];
  return (pick && pick()) || [];
}
