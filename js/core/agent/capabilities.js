/* ============================================================ what each role may ask Vanessa for
   One table. Every tool names the capability it needs; this says who has it.

   These are the SAME role flags the router and the database already use
   (is_admin / in_training / in_recruitment), so there is no second opinion on
   who may do what. And this is only the first gate: the data tools read through
   Supabase as the signed-in person, and every write goes through an admin_*
   function that checks hub_is_admin() again in the database. A mistake here
   can make Vanessa say no too often; it cannot make Postgres say yes.

   The model is never asked whether something is allowed. It is only shown the
   tools the person may use, and the runtime re-checks on every call anyway.
============================================================================ */
const all = () => true;
const admin = w => !!w.admin;
const team = w => !!(w.admin || w.training);
const staff = w => !!(w.admin || w.training || w.recruitment);

export const CAPABILITIES = {
  'self.read':             { label: 'Your own schedule, training and status',        test: all },
  'schedule.read':         { label: 'The tour schedule',                              test: all },
  'announcements.read':    { label: 'Announcements',                                  test: all },
  'actions.read':          { label: 'Your Action Center',                             test: all },
  'semester.read':         { label: 'The current semester',                           test: all },
  'coverage.read':         { label: 'Desk and tour coverage',                         test: all },
  'training.self':         { label: 'Your own training requirements',                 test: all },
  'training.read':         { label: 'Training sessions and overall completion',       test: team },
  'training.read.people':  { label: 'Who attended, who missed, who owes makeup',      test: admin },
  'training.write':        { label: 'Create sessions, take attendance, assign makeups', test: admin },
  'evaluations.read':      { label: 'The evaluation roster and opportunities',        test: team },
  'evaluations.write':     { label: 'Priorities, assignments and evaluation status',  test: admin },
  'people.read':           { label: 'Tour Guide names, majors and status',            test: staff },
  'people.read.detail':    { label: 'Contact details and notes',                      test: admin },
  'people.write':          { label: 'Add, edit and archive Tour Guides',              test: admin },
  'roles.write':           { label: 'Change people’s roles',                          test: admin },
  'announcements.write':   { label: 'Post announcements',                             test: admin },
  'data.read':             { label: 'Data health, syncs and unmatched names',         test: admin },
  'identity.write':        { label: 'Match names from spreadsheets to Tour Guides',   test: admin },
  'audit.read':            { label: 'The activity log',                               test: admin },
  'briefing.operations':   { label: 'The operations brief',                           test: staff },
  'diagnostics.read':      { label: 'Vanessa’s own status',                           test: admin }
};

/** The flags capabilities are judged on, from the hub's state object. */
export const whoFrom = st => ({
  admin: !!st?.role?.is_admin,
  training: !!st?.role?.in_training,
  recruitment: !!st?.role?.in_recruitment,
  id: st?.me?.id || null,
  name: st?.me?.full_name || '',
  email: st?.me?.email || '',
  noPeopleEdits: st?.settings?.['vanessa.adminActions'] === false,      // Admin > Settings: "let her archive, restore and invite people"
  role: st?.role?.name || ''
});

const SWITCHED = new Set(['people.write', 'roles.write']);
export const can = (cap, who) => !!(who && CAPABILITIES[cap] && CAPABILITIES[cap].test(who) && !(SWITCHED.has(cap) && who.noPeopleEdits));
export const capabilitiesOf = who => Object.keys(CAPABILITIES).filter(c => can(c, who));
