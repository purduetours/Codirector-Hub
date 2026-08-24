/* ============================================================ shared state
   Deliberately tiny. Modules read from here and call refresh() when they've
   changed something the rest of the hub cares about.
============================================================================ */
const LS_NAME = 'hub.name';
const LS_CODE = 'hub.code';

export const state = {
  name: localStorage.getItem(LS_NAME) || '',
  code: localStorage.getItem(LS_CODE) || '',
  isAdmin: false,
  committee: [],

  // Populated by the evals payload, shared with directory + schedule so the
  // hub only asks the server once.
  guides: [],
  counts: {},
  neededTotal: 0,
  loadedAt: null
};

export function signIn(name, code) {
  state.name = name.trim();
  state.code = code.trim();
}

export function persistSession() {
  localStorage.setItem(LS_NAME, state.name);
  localStorage.setItem(LS_CODE, state.code);
}

export function signOut() {
  localStorage.removeItem(LS_NAME);
  state.name = '';
  state.isAdmin = false;
  state.guides = [];
  state.loadedAt = null;
}

/* --- subscribers ------------------------------------------------------- */
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange() { listeners.forEach(fn => fn()); }
