/* ============================================================ Vanessa hints
   The one or two questions shown under a page title. They come from the same
   list as everything else Vanessa offers (vanessa-context.js), which already
   filters by role, so the hint on a page can never promise something the
   panel on that page would not.
============================================================================ */
import { questionsFor } from './vanessa-context.js';

// Home is Vanessa herself, so it needs no hint about her.
export const hintsFor = id => (id === 'today' ? [] : questionsFor(id, 2));
