/* ============================================================ training data
   One place that loads and shapes a semester's training so every tab (and the
   Action Center and Vanessa) sees the same thing.

   Only ONE semester is ever loaded at a time, by the filtered queries below;
   switching to Spring 2027 or Fall 2026 is a different `term`, so history is
   always there without any page paying for it until it is asked for.

   Completion is never computed here. It comes from the database
   (admin_training_matrix / my_training), which is the single definition of
   "complete", "scheduled", "makeup needed" — see supabase/20-training-management.sql.
============================================================================ */
import { select } from '../core/db.js';
import { termId } from '../core/state.js';
import { admin } from './admin-kit.js';
import { prettyDate, prettyTime, todayISO } from '../core/ui.js';

export const STATE_LABEL = { complete: 'Complete', waived: 'Waived', excused: 'Excused', scheduled: 'Scheduled', makeup_needed: 'Makeup needed', incomplete: 'Not done yet' };
export const STATE_TONE = { complete: 'is-good', waived: 'is-mute', excused: 'is-mute', scheduled: '', makeup_needed: 'is-warn', incomplete: 'is-warn' };
export const SESSION_STATUS = { draft: 'Draft', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };
export const TYPES = ['General', 'Orientation', 'Safety', 'Skills', 'Leadership', 'Evaluation', 'Social'];
/** The five things you can mark someone, and what is stored for each. */
export const ATTENDANCE = [['Attended', 'Present', 'good'], ['Late', 'Late', 'good'], ['Excused', 'Excused', 'mute'], ['Absent', 'Absent', 'warn'], ['Absent, Need Makeup', 'Makeup needed', 'warn']];
export const attClass = a => !a || !String(a).trim() ? 'pending' : /^(attended|present|late|makeup complete)/i.test(a) ? 'present' : /^excused/i.test(a) ? 'excused' : /(absent|missed|no.?show|makeup needed)/i.test(a) ? 'absent' : 'pending';

export const whenText = s => [s.held_on ? prettyDate(s.held_on) : 'No date', s.start_time ? prettyTime(s.start_time.slice(0, 5)) + (s.end_time ? '–' + prettyTime(s.end_time.slice(0, 5)) : '') : ''].filter(Boolean).join(' · ');
export const isPast = s => !!s.held_on && s.held_on < todayISO();

/** Every semester, newest first, for the term picker. */
export async function loadTerms() {
  const t = await select('terms', 'select=id,label,is_current,starts_on&order=id.desc').catch(() => select('terms', 'select=id,label,is_current'));
  return t.sort((a, b) => (b.starts_on || b.id).localeCompare(a.starts_on || a.id));
}

/** The semester's sessions, requirements and what links them. */
export async function loadTerm(term = termId()) {
  const [sessions, reqs, links, speakers, mats] = await Promise.all([
    select('training_sessions', `select=id,label,held_on,start_time,end_time,location,training_type,required,status,capacity,description,notes,makeup_for,makeup_eligible,attendance_submitted_at&term_id=eq.${term}&order=held_on.asc.nullslast,sort_order.asc`),
    select('training_requirements', `select=id,name,description,deadline,rule,audience,active,sort_order&term_id=eq.${term}&order=sort_order.asc`),
    select('requirement_sessions', 'select=requirement_id,session_id'),
    select('session_speakers', 'select=session_id,speaker_id,speaker_name,role'),
    select('training_materials', 'select=id,title,kind,url,description,session_id,requirement_id&order=sort_order.asc')
  ]);
  const sIds = new Set(sessions.map(s => s.id)), rIds = new Set(reqs.map(r => r.id));
  return {
    term, sessions,
    requirements: reqs,
    links: links.filter(l => rIds.has(l.requirement_id)),
    speakers: speakers.filter(x => sIds.has(x.session_id)),
    materials: mats.filter(m => sIds.has(m.session_id) || rIds.has(m.requirement_id))
  };
}

/** Admin only: where every person stands on every requirement. */
export const loadMatrix = (term = termId()) => admin('admin_training_matrix', { p_term: term });
export const loadOverview = (term = termId()) => admin('training_overview', { p_term: term });
export const loadReport = (term = termId()) => admin('admin_training_report', { p_term: term });

/** Slim canonical Tour Guides, with the fields training cares about. */
export function loadGuides() {
  return select('guides', 'select=id,first_name,last_name,full_name,email,active,is_leadership,evaluator_eligible&order=last_name.asc,first_name.asc')
    .catch(() => select('guides', 'select=id,first_name,last_name,full_name,active&order=last_name.asc'));
}

export const loadSpeakers = () => select('training_speakers', 'select=id,name,email,phone,affiliation,notes,active&order=name.asc');
export const loadTemplates = () => select('training_templates', 'select=*&order=name.asc');
export const loadGroups = async () => {
  const [g, m] = await Promise.all([select('training_groups', 'select=id,name,description&order=name.asc'), select('training_group_members', 'select=group_id,guide_id')]);
  return g.map(x => ({ ...x, members: m.filter(y => y.group_id === x.id).map(y => y.guide_id) }));
};

/** A short sentence for who a requirement applies to. */
export function audienceText(a, groups = [], guides = []) {
  const x = a || {}, bits = [];
  if (x.all) bits.push('All Tour Guides');
  if (x.new) bits.push('New guides');
  if (x.leadership) bits.push('Leadership');
  if (x.evaluators) bits.push('Evaluators');
  (x.group_ids || []).forEach(id => { const g = groups.find(y => y.id === id); if (g) bits.push(g.name); });
  if ((x.guide_ids || []).length) bits.push(`${x.guide_ids.length} chosen ${x.guide_ids.length === 1 ? 'person' : 'people'}`);
  return bits.join(' · ') || 'Nobody yet';
}

/** Summarise a matrix per person: how many done, what is missing, what is next. */
export function byPerson(matrix, requirements) {
  const name = new Map(requirements.map(r => [r.id, r.name]));
  const out = new Map();
  for (const m of matrix) {
    if (!name.has(m.requirement_id)) continue;
    const p = out.get(m.guide_id) || { guide_id: m.guide_id, rows: [], done: 0, makeup: 0, missing: [], next: null };
    p.rows.push(m);
    if (['complete', 'waived', 'excused'].includes(m.state)) p.done++;
    else p.missing.push({ name: name.get(m.requirement_id), state: m.state });
    if (m.state === 'makeup_needed') p.makeup++;
    if (m.next_on && (!p.next || m.next_on < p.next)) p.next = m.next_on;
    out.set(m.guide_id, p);
  }
  return out;
}
