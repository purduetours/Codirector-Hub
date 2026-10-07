/* ============================================================ Vanessa and training
   Questions and a few actions over the NORMALISED training data — the same
   tables, the same completion rules (computed in the database from attendance)
   and the same permissions as the Training screens. She never reads the sheet
   or invents a status.

   Questions     who still needs training · what Jordan still needs · who missed
                 last night / Tuesday · when is the next makeup · who has training
                 this week · how many new guides finished orientation
   Actions       "mark Jordan excused" · "create a makeup training next Thursday"
                 Both ask first, name exactly who and what, and go through the
                 admin_* functions (administrators only, audited, validated).

   Names of people who missed or owe training are administrator-only, exactly as
   on screen; a Tour Guide asking about themselves gets their own page's answer.
============================================================================ */
import { state, isAdmin, inTraining, setting } from './state.js';
import { select, rpc } from './db.js';
import { admin } from '../modules/admin-kit.js';
import { matchingNames } from './vanessa-makeup.js';
import { go, denied } from './vanessa-exec.js';
import { dayISO, DAY_NAMES, dateRange } from './vanessa-dates.js';
import { prettyDate, prettyTime, todayISO } from './ui.js';
import { refreshActions } from './actioncenter.js';

const reply = text => ({ type: 'reply', text });
const allowed = () => isAdmin() && setting('vanessa.adminActions', true) !== false;
const plural = (n, a, b = a + 's') => `${n} ${n === 1 ? a : b}`;
const STATE = { complete: 'complete', waived: 'waived', excused: 'excused', scheduled: 'scheduled', makeup_needed: 'needs a makeup', incomplete: 'not done yet' };

const WHO = /\bwho (?:still )?(?:needs?|owes?|has(?:n['’]?t| not) (?:completed|finished|done)|is behind on)\b.*\b(?:training|orientation|requirements?)\b/i;
const PERSON = /\bwhat (?:training|requirements?) (?:does|do|is left for|has)\s+(.+?)\s+(?:still\s+)?(?:need|owe|have left|left|to do)\b/i;
const ME = /\bwhat (?:training|requirements?) do i (?:still )?(?:need|owe|have left)\b|\bmy training\b/i;
const MISSED = /\bwho missed\b(.*)$/i;
const NEXTMAKEUP = /\bnext make[- ]?up\b/i;
const WEEK = /\b(?:who has|what(?:'s| is)|any) training (?:this|next) week\b|\btraining this week\b/i;
const NEWORIENT = /\bhow many new (?:tour )?guides (?:have )?(?:completed|finished|done)\s+(.+?)[?.!]*$/i;
const EXCUSE = /^(?:please\s+)?mark\s+(.+?)\s+(?:as\s+)?excused[.!?]*$/i;
const MAKEUP = /\bcreate (?:a )?make[- ]?up(?: training| session)?\s*(.*)$/i;

export function trainingIntent(raw) {
  const q = String(raw || '').trim().replace(/^(?:hey[, ]+)?vanessa[, ]+/i, ''); let m;
  if (NEXTMAKEUP.test(q)) return { id: 'next_makeup' };
  if (WEEK.test(q)) return { id: 'week' };
  if ((m = NEWORIENT.exec(q))) return { id: 'new_orient', what: m[1] };
  if ((m = EXCUSE.exec(q))) return { id: 'excuse', who: m[1].trim() };
  if ((m = MAKEUP.exec(q)) && /\b(next|this|on|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d\d-\d\d)\b/i.test(m[1])) return { id: 'make_makeup', when: m[1] };
  if ((m = MISSED.exec(q)) && /\b(training|session|last night|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|orientation|safety)\b/i.test(m[1] || 'training')) return { id: 'missed', when: m[1] };
  if (ME.test(q)) return { id: 'me' };
  if ((m = PERSON.exec(q))) return { id: 'person', who: m[1].trim() };
  if (WHO.test(q)) return { id: 'who' };
  return null;
}

/** "last night" / "yesterday" / "Tuesday" -> an ISO date no later than today. */
export function pastDay(text, now = new Date()) {
  const q = String(text || '').toLowerCase(), d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\b(last night|yesterday)\b/.test(q)) { d.setDate(d.getDate() - 1); return dayISO(d); }
  if (/\btoday|tonight\b/.test(q)) return dayISO(d);
  const wd = DAY_NAMES.findIndex(n => new RegExp(`\\b${n}\\b`, 'i').test(q));
  if (wd >= 0) { let back = (d.getDay() - wd + 7) % 7; if (back === 0 && !/\btoday\b/.test(q)) back = 7; d.setDate(d.getDate() - back); return dayISO(d); }
  return null;
}

const loadTerm = () => select('training_sessions', 'select=id,label,held_on,start_time,location,status,required,makeup_for,term_id&order=held_on.asc').then(rows => rows);
async function matrix() { return admin('admin_training_matrix', {}); }
const reqs = () => select('training_requirements', 'select=id,name,deadline,active&active=eq.true');
const guideName = async id => (await select('guides', `select=full_name&id=eq.${id}`))[0]?.full_name || 'Someone';

async function who() {
  if (!isAdmin()) return denied();
  const [rs, mx, gs] = await Promise.all([reqs(), matrix(), select('guides', 'select=id,full_name')]);
  if (!rs.length) return { run: 'makeups' };                       // no requirements yet: the older makeups answer
  const name = new Map(gs.map(g => [g.id, g.full_name])), rn = new Map(rs.map(r => [r.id, r.name]));
  const owe = new Map();
  mx.filter(m => !['complete', 'waived', 'excused'].includes(m.state)).forEach(m => { (owe.get(m.guide_id) || owe.set(m.guide_id, []).get(m.guide_id)).push(`${rn.get(m.requirement_id)} (${STATE[m.state]})`); });
  return { type: 'summary', title: owe.size ? `${plural(owe.size, 'person', 'people')} still owe training` : 'Everyone is caught up',
    text: owe.size ? 'From the requirements this semester; makeups are flagged.' : 'Every requirement is complete, waived or excused for everyone it applies to.',
    items: [...owe].sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([id, list]) => ({ label: name.get(id), sub: list.slice(0, 3).join(' · ') + (list.length > 3 ? ` · +${list.length - 3}` : '') })),
    more: owe.size > 12 ? `${owe.size - 12} more in Training → People.` : null, actions: [go('trainhub', 'Open Training')], source: 'Training requirements', at: new Date() };
}

async function person(whoText) {
  if (!isAdmin()) return denied();
  const gs = await select('guides', 'select=id,full_name&active=eq.true');
  const hits = matchingNames(whoText, gs.map(g => g.full_name));
  if (!hits.length) return reply(`I couldn’t find “${whoText}” on the Tour Guide list.`);
  const show = async name => {
    const g = gs.find(x => x.full_name === name), [rs, mx] = await Promise.all([reqs(), matrix()]);
    const rows = mx.filter(m => m.guide_id === g.id).map(m => [rs.find(r => r.id === m.requirement_id)?.name || 'Requirement', STATE[m.state] + (m.next_on ? ` · ${prettyDate(m.next_on)}` : '')]);
    return { type: 'summary', title: `${name}’s training`, text: rows.length ? `${rows.filter(r => /complete|waived|excused/.test(r[1])).length} of ${rows.length} done.` : 'No requirements apply to them this semester.', rows,
      actions: [go('trainhub', 'Open Training')], source: 'Training requirements', at: new Date() };
  };
  if (hits.length > 1) return { type: 'select', title: 'Which one do you mean?', options: hits.map(n => ({ label: n, run: () => show(n) })) };
  return show(hits[0]);
}

async function me() {
  try {
    const my = await rpc('my_training');
    if (!my?.linked) return reply('Your account isn’t linked to a Tour Guide record, so I can’t see your training. A codirector can link it in Admin → Tour Guides.');
    const left = my.requirements.filter(r => !['complete', 'waived', 'excused'].includes(r.state));
    return { type: 'summary', title: 'Your training', text: left.length ? `${plural(left.length, 'item')} still to do.` : 'You’re all caught up.',
      rows: my.requirements.map(r => [r.name, STATE[r.state] + (r.deadline && left.includes(r) ? ` · due ${prettyDate(r.deadline)}` : '')]), actions: [go('trainhub', 'Open my training')], source: 'My training', at: new Date() };
  } catch { return reply('I couldn’t load your training just now.'); }
}

async function missed(when) {
  if (!isAdmin()) return denied();
  const day = pastDay(when) || dayISO(new Date(Date.now() - 864e5));
  const ses = (await loadTerm()).filter(s => s.held_on === day && s.status !== 'cancelled');
  if (!ses.length) return reply(`There was no training on ${prettyDate(day)}.`);
  const rows = await select('training_attendance', `select=session_id,person_name,actual&session_id=in.(${ses.map(s => s.id).join(',')})`);
  const absent = rows.filter(r => /(absent|missed|no.?show|makeup needed)/i.test(r.actual || ''));
  const blank = rows.filter(r => !(r.actual || '').trim());
  return { type: 'summary', title: `Who missed training on ${prettyDate(day)}`, text: absent.length ? `${plural(absent.length, 'person', 'people')} marked absent.` : blank.length === rows.length ? 'Attendance has not been entered for that day yet.' : 'Nobody was marked absent.',
    items: absent.slice(0, 15).map(r => ({ label: r.person_name, sub: ses.find(s => s.id === r.session_id)?.label })), more: blank.length && blank.length < rows.length ? `${blank.length} not marked yet.` : null,
    actions: [go('trainhub', 'Take attendance')], source: 'Training attendance', at: new Date() };
}

async function nextMakeup() {
  const ses = (await loadTerm()).filter(s => s.makeup_for && s.status === 'scheduled' && s.held_on >= todayISO());
  if (!ses.length) return reply('There’s no makeup session scheduled. A codirector can create one from a session in Training → Sessions.');
  const s = ses[0];
  return reply(`The next makeup is ${s.label} on ${prettyDate(s.held_on)}${s.start_time ? ' at ' + prettyTime(s.start_time.slice(0, 5)) : ''}${s.location ? ', ' + s.location : ''}.${ses.length > 1 ? ` ${ses.length - 1} more after it.` : ''}`);
}

async function week() {
  const r = dateRange('this week'), from = todayISO(), to = r.to;
  const ses = (await loadTerm()).filter(s => s.status === 'scheduled' && s.held_on >= from && s.held_on <= to);
  return ses.length ? { type: 'summary', title: 'Training this week', text: `${plural(ses.length, 'session')} through ${prettyDate(to)}.`,
      items: ses.map(s => ({ label: s.label, sub: `${prettyDate(s.held_on)}${s.start_time ? ' · ' + prettyTime(s.start_time.slice(0, 5)) : ''}${s.location ? ' · ' + s.location : ''}${s.required ? ' · required' : ''}` })), actions: [go('trainhub', 'Open Training')], source: 'Training sessions', at: new Date() }
    : reply('There’s no training scheduled for the rest of this week.');
}

async function newOrient(what) {
  if (!isAdmin()) return denied();
  const rs = await reqs(), hit = rs.find(r => matchingNames(what, [r.name]).length) || rs.find(r => r.name.toLowerCase().includes(String(what).toLowerCase().split(/\s+/)[0]));
  if (!hit) return reply(`I couldn’t find a requirement matching “${what}”.`);
  const [mx, gt] = await Promise.all([matrix(), select('guide_terms', 'select=guide_id,term_id').catch(() => [])]);
  const cur = (await select('training_requirements', `select=term_id&id=eq.${hit.id}`))[0]?.term_id, old = new Set(gt.filter(x => x.term_id !== cur).map(x => x.guide_id));
  const rows = mx.filter(m => m.requirement_id === hit.id && !old.has(m.guide_id)), done = rows.filter(m => ['complete', 'waived', 'excused'].includes(m.state)).length;
  return reply(`${done} of ${rows.length} new Tour Guides have completed ${hit.name}.`);
}

async function excuse(whoText) {
  if (!isAdmin()) return denied();
  if (setting('vanessa.adminActions', true) === false) return reply('Administrative actions through me are switched off in Settings.');
  const gs = await select('guides', 'select=id,full_name&active=eq.true');
  const hits = matchingNames(whoText, gs.map(g => g.full_name));
  if (!hits.length) return reply(`I couldn’t find “${whoText}” on the Tour Guide list.`);
  const go1 = async name => {
    const g = gs.find(x => x.full_name === name), [rs, mx] = await Promise.all([reqs(), matrix()]);
    const open = mx.filter(m => m.guide_id === g.id && ['makeup_needed', 'incomplete'].includes(m.state));
    if (!open.length) return reply(`${name} has nothing outstanding to excuse.`);
    const confirm = m => ({ type: 'confirm', title: `Mark ${name} excused?`, text: `This marks “${rs.find(r => r.id === m.requirement_id)?.name}” as excused for ${name}. It is recorded as a manual override you can undo.`,
      rows: [['Person', name], ['Requirement', rs.find(r => r.id === m.requirement_id)?.name || ''], ['Now', STATE[m.state]]],
      confirm: { label: 'Mark excused', run: async () => { if (!allowed()) return denied();
        try { await admin('admin_set_completion', { p_req: m.requirement_id, p_guides: [g.id], p_status: 'excused', p_reason: 'Marked via Vanessa' }); refreshActions({ force: true }); return { type: 'reply', kind: 'confirm', text: `Done — ${name} is excused.` };
        } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } });
    return open.length === 1 ? confirm(open[0]) : { type: 'select', title: `Which requirement for ${name}?`, options: open.map(m => ({ label: `${rs.find(r => r.id === m.requirement_id)?.name} (${STATE[m.state]})`, run: () => confirm(m) })) };
  };
  return hits.length > 1 ? { type: 'select', title: 'Which one do you mean?', options: hits.map(n => ({ label: n, run: () => go1(n) })) } : go1(hits[0]);
}

async function makeMakeup(whenText) {
  if (!isAdmin()) return denied();
  if (setting('vanessa.adminActions', true) === false) return reply('Administrative actions through me are switched off in Settings.');
  const r = dateRange(whenText);
  if (!r || r.error) return reply(r?.error || 'Which date? Try “next Thursday” or a date like 2026-10-15.');
  const ses = (await loadTerm()).filter(s => !s.makeup_for && s.required && s.status !== 'cancelled' && s.held_on && s.held_on < todayISO());
  const rows = ses.length ? await select('training_attendance', `select=session_id,actual&session_id=in.(${ses.map(s => s.id).join(',')})`) : [];
  const withMiss = ses.filter(s => rows.some(x => x.session_id === s.id && /(absent|missed|makeup needed|excused)/i.test(x.actual || ''))).sort((a, b) => b.held_on.localeCompare(a.held_on));
  if (!withMiss.length) return reply('Nobody has missed a required session, so there’s nothing to make up yet.');
  const confirm = s => ({ type: 'confirm', title: `Create a makeup for ${s.label}?`, text: `A makeup on ${prettyDate(r.from)} that counts toward the same requirements, starting with the people who still owe it. You can set the time and room afterwards.`,
    rows: [['Makeup for', s.label], ['Date', prettyDate(r.from)]],
    confirm: { label: 'Create makeup', run: async () => { if (!allowed()) return denied();
      try { const out = await admin('admin_make_makeup', { p_original: s.id, p_date: r.from, p_start: null, p_end: null, p_location: null, p_guides: null }); refreshActions({ force: true });
        return { type: 'reply', kind: 'confirm', text: `Done — makeup created for ${plural(out.assigned, 'person', 'people')}. Add the time and room in Training → Sessions.` };
      } catch (e) { return { type: 'reply', kind: 'error', text: `I couldn’t do that: ${e.message}` }; } } }, cancel: { label: 'Cancel' } });
  return withMiss.length === 1 ? confirm(withMiss[0]) : { type: 'select', title: 'A makeup for which session?', options: withMiss.slice(0, 6).map(s => ({ label: `${s.label} · ${prettyDate(s.held_on)}`, run: () => confirm(s) })) };
}

export async function runTraining(i) {
  switch (i.id) {
    case 'who': return who(); case 'person': return person(i.who); case 'me': return me(); case 'missed': return missed(i.when);
    case 'next_makeup': return nextMakeup(); case 'week': return week(); case 'new_orient': return newOrient(i.what);
    case 'excuse': return excuse(i.who); case 'make_makeup': return makeMakeup(i.when);
    default: return null;
  }
}
