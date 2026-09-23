/* ============================================================ shared state
   Deliberately tiny, same as the old hub. Modules read from here.
============================================================================ */
const LS_SESSION = 'hub2.session';

export const state = {
  sessionVersion: 0,
  token: '',
  refreshToken: '',
  expiresAt: 0,

  me: null,          // { id, full_name, email, role }
  role: null,        // { name, is_admin, in_recruitment, in_training }

  guides: [],
  counts: {},
  neededTotal: 0,
  loadedAt: null
};

/* The old app asked people to type their own name, which is how "Sam" and
   "sam" became two different evaluators. The name now comes from the account
   and cannot drift. */
export const myName    = () => state.me?.full_name || '';
export const isAdmin   = () => !!state.role?.is_admin;
export const inTraining    = () => !!state.role?.in_training;
export const inRecruitment = () => !!state.role?.in_recruitment;

export function saveSession(s) {
  state.token        = s.access_token || '';
  state.refreshToken = s.refresh_token || '';
  state.expiresAt    = Date.now() + ((s.expires_in || 3600) * 1000);
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify({
      access_token: state.token,
      refresh_token: state.refreshToken,
      expiresAt: state.expiresAt
    }));
  } catch { /* private window: stay signed in for this tab only */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return false;
    const s = JSON.parse(raw);
    state.token = s.access_token || '';
    state.refreshToken = s.refresh_token || '';
    state.expiresAt = s.expiresAt || 0;
    return !!state.token;
  } catch { return false; }
}

const sessionListeners = new Set();
export function onSessionReset(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); }

export function clearSession() {
  state.sessionVersion++;
  state.token = state.refreshToken = '';
  state.expiresAt = 0;
  state.me = state.role = null;
  state.guides = [];
  state.loadedAt = null;
  state.guideToursLoaded = false;
  state.counts = {}; state.neededTotal = 0; state.unmatchedSchedule = [];
  sessionListeners.forEach(fn => fn());
  try { localStorage.removeItem(LS_SESSION); } catch { /* ignore */ }
}

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange() { listeners.forEach(fn => fn()); }
