/* ============================================================ what page they're on
   Safe, structured, small: the route, its title, the tab, and the one thing
   selected if a module has said so. Never DOM, never page text.

   Modules publish a selection with setPageEntity({kind, id, name}) when a person
   opens a profile or a session, and clear it when they close it. Vanessa reads
   it so "when's their next tour?" means the person on screen.
*/
let entity = null, entityRoute = '';
const route = () => (typeof location === 'undefined' ? '' : (location.hash || '').replace(/^#\/?/, '').split('?')[0]);
export function setPageEntity(e) { entity = e && e.id ? { kind: String(e.kind || ''), id: String(e.id), name: String(e.name || '').slice(0, 80) } : null; entityRoute = route(); }
export const clearPageEntity = () => setPageEntity(null);

export function pageContext(titleOf = id => id) {
  const r = route();
  if (!r) return null;
  const q = typeof location === 'undefined' ? '' : (location.hash.split('?')[1] || '');
  const p = Object.fromEntries(new URLSearchParams(q));
  const out = { route: r, title: titleOf(r) };
  if (p.tab) out.tab = String(p.tab).slice(0, 20);
  if (entity && entityRoute === r) out.selected = entity;
  else if (p.session) out.selected = { kind: 'training_session', id: String(p.session).slice(0, 40) };
  return out;
}

/** Contextual starters: different on every page, different for every role. */
export function suggestionsFor(route, who) {
  const staff = who.admin || who.training || who.recruitment;
  const map = {
    today: who.admin ? ['Give me today’s brief', 'What needs attention today?', 'Any schedule issues this week?'] : staff ? ['What needs my attention?', 'When is my next tour?', 'Any announcements?'] : ['When is my next tour?', 'What training do I still need?', 'Do I have any announcements?'],
    schedule: ['Who tours tomorrow?', 'Any conflicts Friday?', 'When is my next tour?'],
    evals: ['Who still needs evaluated?', 'Find eval opportunities this week', 'What are my evaluations?'],
    evalroster: ['Who is high priority?', 'Find eval opportunities this week', 'Who still needs evaluated?'],
    trainhub: who.admin ? ['Who still needs training?', 'Any makeup issues?', 'Are we ready for the next training session?'] : ['What training do I still need?', 'When is the next session?'],
    guides: ['Who are the leadership guides?', 'Which guides have no major?', 'Who isn’t on the schedule?'],
    reconcile: ['Which names still don’t match?', 'Is everything synced?'],
    sources: ['Did the schedule sync?', 'What’s broken?'],
    health: ['Is everything synced?', 'What’s broken?'],
    announcements: ['Any announcements?'],
    desks: ['Which desk slots are uncovered?'],
    people: ['Who is leadership?'],
    audit: ['Show recent activity']
  };
  return (map[route] || map.today).slice(0, 3);
}
export const starters = who => (who.admin ? ['What needs attention today?', 'Who still needs evaluated?', 'Any schedule issues this week?'] : who.training || who.recruitment ? ['What needs my attention?', 'When is my next tour?', 'Who still needs evaluated?'] : ['When is my next tour?', 'What training do I still need?', 'Do I have any announcements?']);
