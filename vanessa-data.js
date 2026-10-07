/* ============================================================ data context
   What the hub has ALREADY loaded, in one place Vanessa can read.

   Screens share what they assemble (the tour schedule, desk rota, training
   records, majors) the moment they have it — the same rows that are on show,
   so she can never disagree with the page. The roster lives on state.guides
   and presence on its own heartbeat; both are read where they are.

   When she needs something nobody has loaded yet, she asks the module that
   owns it to load it — ensure('tours') calls the Tour Schedule's own
   prefetch. One request per kind per session, shared by everyone asking at
   once. Nothing here queries the database itself.

   No imports on purpose: modules and Vanessa can both depend on it freely.
============================================================================ */
export const shared = { tours: null, desks: null, training: null, majors: null };
const at = {};

export function share(kind, value) {
  shared[kind] = value;
  at[kind] = value == null ? null : new Date();
}
/** When a kind last arrived, for "from the tour schedule, loaded 2:14 PM". */
export const loadedAt = kind => at[kind] || null;

let loaders = {};
const inflight = new Map();
/** main.js hands over each module's own loader: { tours: () => schedule.prefetch(), … } */
export function registerLoaders(map) { loaders = { ...loaders, ...map }; }

/**
 * Make sure a kind is loaded, through its owner's loader. Resolves true when
 * the data is there, false when it could not be loaded — the caller says so
 * rather than answering from nothing.
 */
export async function ensure(kind) {
  const have = () => kind === 'roster' ? null : shared[kind];
  if (kind !== 'roster' && have()) return true;
  const load = loaders[kind];
  if (!load) return !!have();
  if (!inflight.has(kind)) {
    inflight.set(kind, Promise.resolve().then(load).then(() => true, err => {
      console.warn(`[Vanessa] could not load ${kind}`, err);
      return false;
    }).finally(() => inflight.delete(kind)));
  }
  const ok = await inflight.get(kind);
  return kind === 'roster' ? ok : ok && !!have();
}

export function resetData() {
  inflight.clear();
  shared.tours = shared.desks = null;
}
