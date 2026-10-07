/* ============================================================ people lookup
   Finds a person from what is already loaded; the command palette (palette.js)
   is the box that uses it. Also holds the jump hand-off the Directory and
   Interviews read when they open on somebody.

   Deliberately people only; pages and actions are ranked separately.
============================================================================ */
import { state, inTraining, inRecruitment } from './state.js';
import { go } from './router.js';
import { interviewData } from '../modules/interviews.js';

/** Guides and, in recruitment, interview candidates. */
export function people(q) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const words = t.split(/\s+/).filter(Boolean);
  const out = [];

  const score = name => {
    const low = String(name || '').toLowerCase();
    if (!words.every(w => low.includes(w))) return 0;
    return low.startsWith(words[0]) ? 3 : 1;      // a leading match ranks first
  };

  if (inTraining()) {
    for (const g of state.guides || []) {
      const s = score(g.name);
      if (s) out.push({ s, name: g.name, sub: g.priority || 'guide', go: 'directory', kind: 'guide' });
    }
  }
  if (inRecruitment()) {
    for (const c of interviewData()?.candidates || []) {
      const s = score(c.name);
      if (s) out.push({ s, name: c.name, sub: `candidate${c.group ? ' · ' + c.group : ''}`, go: 'interviews', kind: 'candidate' });
    }
  }
  return out.sort((a, b) => b.s - a.s || a.name.localeCompare(b.name)).slice(0, 7);
}

/** Open whoever was chosen, on the screen that knows them best, pre-filled. */
export function jumpTo(hit) {
  if (!hit) return;
  setJumpTarget(hit.name);
  go(hit.go);
}

/** Set the person the next screen should open on — Vanessa uses the same hand-off. */
export function setJumpTarget(name) {
  try { sessionStorage.setItem('hub2.qs.jump', name); } catch { /* the screen just opens unfiltered */ }
}

/** Consumed by whichever screen was opened, so it can jump to the person. */
export function takeJumpTarget() {
  const v = sessionStorage.getItem('hub2.qs.jump');
  if (v) sessionStorage.removeItem('hub2.qs.jump');
  return v;
}
