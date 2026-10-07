/* ============================================================ the real wiring
   Connects the agent's tools to the Hub as it already exists: the same loaders,
   the same RPCs, the same Action Center, the same router. Nothing in here is new
   business logic. It is the only agent file that imports application modules,
   which is what keeps the rest testable on fake data.

   Reads are cached for a short time (directory 60 s, term data 30 s, ...). The
   cache is dropped after any confirmed change.
*/
import { state, termId, termLabel, setting } from '../state.js';
import { select, rpc, insert } from '../db.js';
import { whoFrom } from './capabilities.js';
import { DEFAULT_TZ } from './time.js';
import * as facts from '../vanessa-facts.js';
import { loadRoster } from '../../modules/evals.js';
import { loadEvaluators } from '../evaldata.js';
import { loadTerm, loadOverview, loadMatrix } from '../../modules/train-data.js';
import { getActions } from '../actioncenter.js';
import { loadDesks } from '../sheets.js';
import { visibleModules, visibleHubs } from '../router.js';

const memo = new Map();
const NK = () => `hub2.vanessa.nick.${state.me?.id || 'anon'}`;
const readNicks = () => { try { return JSON.parse(localStorage.getItem(NK()) || '{}'); } catch { return {}; } };
const writeNicks = m => { try { localStorage.setItem(NK(), JSON.stringify(m)); return true; } catch { return false; } };
const cached = (key, ttl, force, fn) => {
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.p;
  const p = fn().catch(e => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), p });
  return p;
};

const GUIDE_COLS = ['id,first_name,last_name,active,major,member_id,is_leadership,tour_eligible,evaluator_eligible', 'id,first_name,last_name,active,member_id', 'id,first_name,last_name,active'];

export function createDeps() {
  const who = () => whoFrom(state);
  const deps = {
    who,
    now: () => new Date(),
    get tz() { return setting('timezone', '') || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '') || DEFAULT_TZ; },
    term: () => ({ id: termId(), label: termLabel() }),
    rpc: (name, args, o) => rpc(name, args, o),
    insert: (table, row, o) => insert(table, row, o),
    invalidate: () => memo.clear(),
    route: (page, params) => { const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString() : ''; return `#/${page}${q ? '?' + q : ''}`; },
    navigate: route => { location.hash = route; },
    pages: () => [...visibleHubs().map(h => ({ id: h.id, title: h.title })), ...visibleModules().map(m => ({ id: m.id, title: m.title }))].filter((p, i, a) => a.findIndex(x => x.id === p.id) === i),

    /* ---- people */
    directory: ({ force = false } = {}) => cached('dir', 60e3, force, async () => {
      const admin = state.role?.is_admin;
      let rows;
      for (const cols of GUIDE_COLS) { try { rows = await select('guides', `select=${cols}${admin ? ',email,notes' : ''}&order=last_name.asc`).catch(() => select('guides', `select=${cols}&order=last_name.asc`)); break; } catch { /* try fewer columns */ } }
      let aliases = new Map(), newOnes = new Set();
      if (admin) { try { (await select('external_identity_mappings', 'select=guide_id,external_name&active=eq.true&ignored=eq.false&guide_id=not.is.null')).forEach(m => { if (m.external_name) (aliases.get(m.guide_id) || aliases.set(m.guide_id, []).get(m.guide_id)).push(m.external_name); }); } catch { /* optional */ } }
      try { const gt = await select('guide_terms', 'select=guide_id,term_id'); const earlier = new Set(gt.filter(x => x.term_id !== termId()).map(x => x.guide_id)); (rows || []).forEach(g => { if (g.active && !earlier.has(g.id)) newOnes.add(g.id); }); } catch { /* optional */ }
      const nicks = Object.entries(readNicks());
      return { people: (rows || []).map(g => ({ id: g.id, first: g.first_name, last: g.last_name, active: g.active !== false, major: g.major || '', memberId: g.member_id || null, leadership: !!g.is_leadership, tourEligible: g.tour_eligible, evaluatorEligible: g.evaluator_eligible, email: g.email || '', notes: g.notes || '', aliases: [...(aliases.get(g.id) || []), ...nicks.filter(([, id]) => id === g.id).map(([n]) => n)], newThisTerm: newOnes.has(g.id) })) };
    }),
    setNickname: (nick, id) => { const m = readNicks(); if (Object.keys(m).length >= 30 && !(nick.toLowerCase() in m)) return { ok: false, message: 'That’s a lot of nicknames already. Ask me to forget one first.' }; m[nick.toLowerCase()] = id; memo.delete('dir'); return writeNicks(m) ? { ok: true } : { ok: false, message: 'This browser is blocking storage, so I can’t remember that.' }; },
    removeNickname: nick => { const m = readNicks(), had = nick.toLowerCase() in m; delete m[nick.toLowerCase()]; writeNicks(m); memo.delete('dir'); return had; },
    members: ({ force = false } = {}) => cached('members', 30e3, force, () => select('members', 'select=id,full_name,email,role,active&active=eq.true&order=full_name.asc')),
    roles: () => cached('roles', 300e3, false, () => select('roles', 'select=name,is_admin,in_training,in_recruitment&order=sort_order.asc')),

    /* ---- schedule + evaluations */
    tours: (from, to) => facts.tours(from, to),
    myUpcoming: () => facts.myUpcoming(),
    roster: async ({ force = false } = {}) => { try { if (force || !(state.guides || []).length) await loadRoster(); return await facts.roster(); } catch { return { ok: false }; } },
    evaluators: guides => cached('evaluators', 30e3, false, () => loadEvaluators(guides)),
    priorities: () => cached('prios', 300e3, false, () => select('priorities', 'select=name,sort_order,needs_eval&order=sort_order.asc')),
    desks: async () => { try { return { ok: true, rows: await loadDesks() }; } catch { return { ok: false }; } },

    /* ---- training */
    trainingTerm: (term, { force = false } = {}) => cached(`tt:${term || termId()}`, 30e3, force, () => loadTerm(term || termId())),
    trainingOverview: term => cached(`to:${term || termId()}`, 30e3, false, () => loadOverview(term || termId()).then(r => r || rpc('training_overview', { p_term: term || termId() }))),
    trainingMatrix: term => cached(`tm:${term || termId()}`, 30e3, false, () => loadMatrix(term || termId())),
    myTraining: () => cached('mytraining', 30e3, false, () => rpc('my_training', { p_term: termId() })),
    trainingFor: async guideId => {
      const [t, m] = await Promise.all([deps.trainingTerm(), deps.trainingMatrix()]);
      const rows = m.filter(x => x.guide_id === guideId);
      return { requirements: rows.map(r => ({ ...r, name: t.requirements.find(q => q.id === r.requirement_id)?.name || 'Requirement', missed_title: t.sessions.find(s => s.id === r.missed_session)?.label })) };
    },
    firstSessionOn: async date => (await deps.trainingTerm()).sessions.filter(s => s.held_on === date && s.status === 'scheduled').sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))[0] || null,
    attendance: async ids => { if (!ids.length) return []; return select('training_attendance', `select=session_id,guide_id,person_name,actual,expectation&session_id=in.(${ids.join(',')})&limit=2000`); },

    /* ---- announcements, actions, admin views */
    announcements: (limit = 10, { force = false } = {}) => cached(`ann:${limit}`, 30e3, force, async () => (await select('announcements', `select=id,title,body,pinned,created_at,author:members(full_name)&order=pinned.desc,created_at.desc&limit=${limit}`)).map(r => ({ id: r.id, title: r.title, body: r.body, pinned: r.pinned, date: (r.created_at || '').slice(0, 10), author: r.author?.full_name || 'Committee' }))),
    markAnnouncementsRead: async () => { try { localStorage.setItem(`hub2.ann.seen.${state.me?.id || 'anon'}`, new Date().toISOString()); } catch { /* storage blocked */ } document.dispatchEvent(new CustomEvent('hub:actions')); return { ok: true }; },
    actions: async () => getActions(),
    health: () => cached('health', 30e3, false, () => rpc('admin_health')),
    dataStatus: () => cached('datastatus', 30e3, false, () => rpc('admin_data_status')),
    unmatched: ({ force = false } = {}) => cached('unmatched', 20e3, force, () => select('sync_issues', 'select=id,kind,external_name,suggested&status=eq.open&kind=in.(unmatched_person,schedule_unmatched)&order=created_at.desc&limit=60')),
    audit: limit => select('admin_audit', `select=at,actor_name,action,target_label,via&order=at.desc&limit=${Math.min(limit || 8, 20)}`),

    /* ---- Vanessa's own bookkeeping */
    logTurn: m => rpc('vanessa_log_turn', { p_engine: m.engine || 'standard', p_intent: m.intent || null, p_confidence: m.confidence ?? null, p_local_calls: m.localCalls || 0, p_provider_failed: !!m.providerFailed, p_latency_ms: Math.round(m.latency || 0), p_tools: m.tools || [], p_failed: m.failed || [], p_ok: m.ok !== false, p_error: m.error || null, p_route: m.route || null }).catch(() => {})
  };
  return deps;
}

export const resetDepsCache = () => memo.clear();
