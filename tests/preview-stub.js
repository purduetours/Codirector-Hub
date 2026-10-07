/* Test fixture, not shipped. Stands in for Supabase so the real app can be
   driven in a browser as any role, with working admin screens:

     tests/preview.html?role=guide|training|recruit|developer|admin

   It keeps a small in-memory database and answers just enough of PostgREST
   (simple eq filters, insert/patch/upsert) and of the admin_* functions to let
   the screens be exercised. It does NOT reproduce the database's safety rules;
   those are tested against a real Postgres (supabase/tests/). */
(function () {
  const ROLES = { guide: ['Tour Guide', 0, 0, 0], training: ['Training Committee', 0, 1, 0], recruit: ['Recruitment Committee', 0, 0, 1], developer: ['Developer', 1, 1, 1], admin: ['Codirector', 1, 1, 1] };
  const key = new URLSearchParams(location.search).get('role') || 'admin', r = ROLES[key] || ROLES.admin;
  window.CONFIG = { SUPABASE_URL: 'https://stub.invalid', SUPABASE_KEY: 'stub', TERM_LABEL: 'Fall 2026' };
  localStorage.setItem('hub2.session', JSON.stringify({ access_token: 't', refresh_token: 'r', expiresAt: Date.now() + 36e5 }));

  const today = new Date(); const iso = d => { const x = new Date(today); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  const db = {
    roles: [
      { name: 'Developer', is_admin: true, in_training: true, in_recruitment: true, sort_order: 0, description: 'Maintains the hub.' },
      { name: 'Codirector', is_admin: true, in_training: true, in_recruitment: true, sort_order: 1, description: null },
      { name: 'Training Committee', is_admin: false, in_training: true, in_recruitment: false, sort_order: 2, description: null },
      { name: 'Recruitment Committee', is_admin: false, in_training: false, in_recruitment: true, sort_order: 3, description: null },
      { name: 'Tour Guide', is_admin: false, in_training: false, in_recruitment: false, sort_order: 4, description: null }],
    members: [
      { id: 'u1', full_name: 'Test Person', email: 'test@purdue.edu', role: r[0], active: true },
      { id: 'u2', full_name: 'Alex Rivera', email: 'alex@purdue.edu', role: 'Codirector', active: true },
      { id: 'u3', full_name: 'Sam Lee', email: 'sam@purdue.edu', role: 'Training Committee', active: true },
      { id: 'u4', full_name: 'Jordan Poe', email: 'jordan@purdue.edu', role: 'Recruitment Committee', active: false, archived_at: iso(-30), archive_reason: 'Graduated' }],
    member_roster: [
      { email: 'test@purdue.edu', full_name: 'Test Person', role: r[0] }, { email: 'alex@purdue.edu', full_name: 'Alex Rivera', role: 'Codirector' },
      { email: 'sam@purdue.edu', full_name: 'Sam Lee', role: 'Training Committee' }, { email: 'new@purdue.edu', full_name: 'Nia New', role: 'Training Committee' }],
    terms: [{ id: 'fall-2026', label: 'Fall 2026', academic_year: '2026–27', starts_on: iso(-40), ends_on: iso(9), is_current: true },
            { id: 'spring-2026', label: 'Spring 2026', academic_year: '2025–26', starts_on: '2026-01-12', ends_on: '2026-05-02', is_current: false }],
    guides: [['Hunter', 'Lipinski', 'hlipinsk@purdue.edu'], ['Zachary', 'Detlaff', ''], ['Joey', 'Pelletier', ''], ['Anna', 'Stubbington', ''], ['Ella', 'Herr', ''], ['Retired', 'Guide', '']]
      .map((n, i) => ({ id: 'g' + i, first_name: n[0], last_name: n[1], full_name: n[0] + ' ' + n[1], email: n[2] || null, active: true, major: i === 4 ? 'Industrial Engineering' : null, is_leadership: i === 0, evaluator_eligible: true, tour_eligible: true, notes: null, member_id: null })),
    priorities: ['First Priority to Eval', 'Second Priority', 'Third Priority', 'No Need to Eval'].map((n, i) => ({ name: n, sort_order: i + 1, needs_eval: i < 3 })),
    app_settings: [{ key: 'contact.email', value: 'tours@purdue.edu' }, { key: 'contact.name', value: 'The Codirectors' }],
    admin_audit: [{ id: 1, at: new Date().toISOString(), actor_name: 'Alex Rivera', action: 'person.archived', target_label: 'Jordan Poe', before: { role: 'Recruitment Committee' }, after: { active: false }, note: 'Graduated' }],
    announcements: [{ id: 1, title: 'Welcome back, committee', body: 'Fall training starts Tuesday. Bring your handbook.', pinned: true, created_at: new Date().toISOString(), author: { full_name: 'Logan' } }],
    evals: [],
    external_sources: [], source_records: [], sync_issues: [], external_identity_mappings: [], column_templates: [], sync_runs: [],
    field_ownership: [{ field: 'major', owner: 'majors' }, { field: 'email', owner: 'hub' }, { field: 'eval_priority', owner: 'hub' }, { field: 'tour_assignment', owner: 'tour_schedule' }],
    major_mappings: [{ raw: 'ece', canonical: 'Electrical and Computer Engineering' }], guide_terms: [], guide_overrides: []
  };

  /* ---- training fixtures ---- */
  const T = n => iso(n);
  db.training_sessions = [
    { id: 's1', term_id: 'fall-2026', label: 'New Guide Orientation · Aug 20', held_on: T(-20), start_time: '18:00:00', end_time: '19:00:00', location: 'Union 214', training_type: 'Orientation', required: true, status: 'completed', capacity: null, description: null, notes: null, makeup_for: null, makeup_eligible: true, attendance_submitted_at: new Date().toISOString() },
    { id: 's2', term_id: 'fall-2026', label: 'New Guide Orientation · Aug 22', held_on: T(-18), start_time: '18:00:00', end_time: '19:00:00', location: 'Union 214', training_type: 'Orientation', required: true, status: 'scheduled', capacity: null, description: null, notes: null, makeup_for: null, makeup_eligible: true, attendance_submitted_at: null },
    { id: 's3', term_id: 'fall-2026', label: 'Campus Safety', held_on: T(1), start_time: '18:00:00', end_time: '19:00:00', location: null, training_type: 'Safety', required: true, status: 'scheduled', capacity: null, description: 'Annual safety briefing', notes: null, makeup_for: null, makeup_eligible: true, attendance_submitted_at: null },
    { id: 's4', term_id: 'fall-2026', label: 'Advanced Tour Skills', held_on: T(9), start_time: '19:00:00', end_time: '20:00:00', location: 'Union 301', training_type: 'Skills', required: false, status: 'scheduled', capacity: 40, description: null, notes: null, makeup_for: null, makeup_eligible: true, attendance_submitted_at: null }];
  db.training_requirements = [
    { id: 'q1', term_id: 'fall-2026', name: 'New Tour Guide Orientation', description: 'Required before your first tour.', deadline: T(14), rule: 'any', audience: { all: true }, active: true, sort_order: 0 },
    { id: 'q2', term_id: 'fall-2026', name: 'Campus Safety', description: null, deadline: T(20), rule: 'any', audience: { all: true }, active: true, sort_order: 1 }];
  db.requirement_sessions = [{ requirement_id: 'q1', session_id: 's1' }, { requirement_id: 'q1', session_id: 's2' }, { requirement_id: 'q2', session_id: 's3' }];
  db.training_attendance = [];
  ['s1', 's2', 's3'].forEach(sid => db.guides.forEach((g, i) => db.training_attendance.push({ id: sid + g.id, session_id: sid, guide_id: g.id, person_name: g.full_name, actual: sid === 's1' ? (i === 1 ? 'Absent, Need Makeup' : i === 5 ? null : 'Attended') : sid === 's2' ? null : null })));
  db.session_speakers = [{ session_id: 's1', speaker_id: 'sp1', speaker_name: 'Dr. Rivera', role: 'Lead' }];
  db.training_speakers = [{ id: 'sp1', name: 'Dr. Rivera', email: 'rivera@purdue.edu', phone: '555-1234', affiliation: 'Campus Safety', notes: null, active: true }];
  db.training_materials = [{ id: 'm1', title: 'Guide Handbook', kind: 'pdf', url: 'https://example.edu/handbook.pdf', description: 'Read before orientation', session_id: null, requirement_id: 'q1' }];
  db.training_templates = [{ id: 'tp1', name: 'Campus Safety', description: 'Annual', training_type: 'Safety', duration_minutes: 60, default_location: 'Union 214', required: true, audience: { all: true }, materials: [], speaker_role: 'Safety officer', completion_rule: 'any', active: true }];
  db.training_groups = []; db.training_group_members = []; db.training_overrides = [];
  const cls = a => !a || !String(a).trim() ? 'pending' : /^(attended|present|late|makeup complete)/i.test(a) ? 'present' : /^excused/i.test(a) ? 'excused' : /(absent|missed|makeup needed)/i.test(a) ? 'absent' : 'pending';
  const activeGuides = () => db.guides.filter(g => g.active);
  const rowsFor = reqId => { const r = db.training_requirements.find(x => x.id === reqId), links = db.requirement_sessions.filter(l => l.requirement_id === reqId).map(l => db.training_sessions.find(s => s.id === l.session_id)).filter(s => s && ['scheduled', 'completed'].includes(s.status));
    return activeGuides().map(g => { const o = db.training_overrides.find(x => x.requirement_id === reqId && x.guide_id === g.id); const at = db.training_attendance.filter(a => a.guide_id === g.id && links.some(s => s.id === a.session_id));
      const done = at.filter(a => cls(a.actual) === 'present').length, next = at.find(a => cls(a.actual) === 'pending' && links.find(s => s.id === a.session_id).held_on >= T(0)), missed = at.some(a => ['absent', 'excused'].includes(cls(a.actual)));
      let state = o && o.status !== 'incomplete' ? o.status : o ? 'incomplete' : (r.rule === 'all' ? done >= links.length && links.length : done >= 1) ? 'complete' : next ? 'scheduled' : missed ? 'makeup_needed' : 'incomplete';
      return { guide_id: g.id, state, via: o ? 'manual' : 'automatic', session_id: null, done_on: state === 'complete' ? T(-20) : null, next_session: next?.session_id || null, next_on: next ? links.find(s => s.id === next.session_id).held_on : null, missed_session: null, reason: o?.reason || null }; }); };
  const seedAtt = sid => { db.guides.filter(g => g.active).forEach(g => { if (!db.training_attendance.some(a => a.session_id === sid && a.guide_id === g.id)) db.training_attendance.push({ id: sid + g.id, session_id: sid, guide_id: g.id, person_name: g.full_name, actual: null }); }); };

  db.evals = db.guides.map((g, i) => ({ id: 'e' + i, term_id: 'fall-2026', guide_id: g.id, priority: db.priorities[i % 3].name }));
  const roster = () => db.evals.map((e, i) => { const g = db.guides.find(x => x.id === e.guide_id), p = db.priorities.find(x => x.name === e.priority);
    return { id: e.id, term_id: e.term_id, guide_id: g.id, first_name: g.first_name, last_name: g.last_name, full_name: g.full_name, priority: e.priority, priority_rank: p.sort_order, needs_eval: p.needs_eval,
      evaluator_id: e.evaluator_id || (i === 1 ? 'u1' : null), evaluator_name: e.evaluator_id ? (db.members.find(m => m.id === e.evaluator_id)?.full_name) : (i === 1 ? 'Test Person' : null), tour_date: e.tour_date || (i === 1 ? iso(2) : null), tour_time: e.tour_time ? e.tour_time + ':00' : (i === 1 ? '14:00:00' : null), status: (e.evaluator_id || i === 1) ? 'claimed' : p.needs_eval ? 'open' : 'skip', guide_active: g.active }; });


  /* ---- Google Sheets fixtures: the real Tour Guides by Major sheet, and a small table-style schedule ---- */
  const MAJORS_CSV = "\"First Name\",\"Last Name\",\"Major(s)\",\"Email\"\n\"Hunter\",\"Lipinski\",\"Aeronautical and Astronautical Engineering\",\"hlipinsk@purdue.edu\"\n\"Zach\",\"Detlaff\",\"Aeronautical and Astronautical Engineering (Astrodynamics and Space Applications)\",\"zdetlaff@purdue.edu\"\n\"Joey\",\"Pelletier\",\"Aerospace Engineering\",\"pelleti0@purdue.edu\"\n\"Anna\",\"Stubbington\",\"Aerospace Engineering (Design and Systems), Communication (Interpersonal)\",\"astubbin@purdue.edu\"\n\"Risha\",\"Pathak\",\"Biological Engineering\",\"pathak25@purdue.edu\"\n\"Joanne\",\"Gaastra\",\"Biomedical Engineering\",\"jaastra@purdue.edu\"\n\"Hailey\",\"Moskalik\",\"Chemical Engineering\",\"hmoskali@purdue.edu\"\n\"Jack\",\"Marro\",\"Chemical Engineering\",\"marro@purdue.edu\"\n\"Korbin\",\"Nigg\",\"Chemical Engineering\",\"knigg@purdue.edu\"\n\"Saandiya\",\"KPS Mohan\",\"ECE\",\"mohan76@purdue.edu\"\n\"Maya\",\"Labonte\",\"Electrical Engineering\",\"mlabont@purdue.edu\"\n\"Nancy\",\"Pei\",\"Electrical Engineering\",\"npei@purdue.edu\"\n\"Natalie\",\"Silverio\",\"Electrical Engineering\",\"nsilveri@purdue.edu\"\n\"Trevor\",\"Kates\",\"Engineering Management\",\"katest@purdue.edu\"\n\"Nick\",\"Steingraeber\",\"Environmental and Ecological Engineering\",\"nsteing@purdue.edu\"\n\"Audrey\",\"Pulley\",\"Industrial Engineering\",\"pulley0@purdue.edu\"\n\"Ayush\",\"Golagani\",\"Industrial Engineering\",\"agolagan@purdue.edu\"\n\"Ella\",\"Herr\",\"Industrial Engineering\",\"herr21@purdue.edu\"\n\"Jacob\",\"Lavra\",\"Industrial Engineering\",\"jlavra@purdue.edu\"\n\"Konark\",\"Nangia\",\"Industrial Engineering\",\"nangiak@purdue.edu\"\n\"Trinav\",\"Singh\",\"Industrial Engineering\",\"sing1767@purdue.edu\"\n\"Abigail\",\"Chi\",\"Mechanical Engineering\",\"chi93@purdue.edu\"\n\"Alexa\",\"Risk\",\"Mechanical Engineering\",\"risk2@purdue.edu\"\n\"Elise\",\"Sheehe\",\"Mechanical Engineering\",\"esheehe@purdue.edu\"\n\"Kelly\",\"Fulk\",\"Mechanical Engineering\",\"fulk3@purdue.edu\"\n\"Mya\",\"Reardon\",\"Mechanical Engineering\",\"reardon9@purdue.edu\"\n\"Srivalli\",\"Katkuri\",\"Mechanical Engineering\",\"skatkur@purdue.edu\"\n\"Kavyaa\",\"Parmar\",\"Mechanical Engineering \",\"parmark@purdue.edu\"";
  const dayOf = n => { const x = new Date(today); x.setDate(x.getDate() + n); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + x.getFullYear(); };
  const SCHEDULE_CSV = ['Tour Guide,Tour Date,Start Time,Evaluator', 'Zach D.,' + dayOf(3) + ',10:00 AM,', 'Zach D.,' + dayOf(5) + ',10:00 AM,', 'Joey P.,' + dayOf(4) + ',2:00 PM,', 'Hunter Lipinski,' + dayOf(3) + ',10:00 AM,', 'Mystery Person,' + dayOf(6) + ',10:00 AM,'].join('\n');
  const csvResp = t => Promise.resolve(new Response(t, { status: 200, headers: { 'content-type': 'text/csv' } }));

  const json = (o, st) => Promise.resolve(new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } }));
  const audit = (action, label, extra) => db.admin_audit.unshift({ id: Date.now(), at: new Date().toISOString(), actor_name: 'Test Person', action, target_label: label, ...(extra || {}) });
  const em = e => String(e || '').trim().toLowerCase();

  const rpcs = {
    admin_health: () => ({ current_term: { id: 'fall-2026', label: 'Fall 2026', starts_on: iso(-40), ends_on: iso(9) }, current_terms: 1, admins: db.members.filter(m => m.active && db.roles.find(x => x.name === m.role)?.is_admin).length,
      active_people: 3, people_bad_role: 0, active_guides: db.guides.filter(g => g.active).length, guides_missing_eval: 0, evals_for_archived_guides: 0, training_sessions: 2, pending_signups: 1, reminders_enabled: false }),
    admin_save_person: a => { const e = em(a.p_email); const had = db.member_roster.find(x => x.email === e); db.member_roster = db.member_roster.filter(x => x.email !== e).concat({ email: e, full_name: a.p_name, role: a.p_role });
      const m = db.members.find(x => em(x.email) === e); if (m) Object.assign(m, { full_name: a.p_name, role: a.p_role, active: true }); audit('person.added', a.p_name); return { result: m ? 'restored' : had ? 'updated' : 'added' }; },
    admin_change_role: a => { const m = db.members.find(x => em(x.email) === em(a.p_email)); if (m) m.role = a.p_role; const q = db.member_roster.find(x => x.email === em(a.p_email)); if (q) q.role = a.p_role; audit('person.role_changed', m?.full_name || a.p_email, { after: { role: a.p_role } }); return { result: 'changed' }; },
    admin_archive_people: a => { let n = 0; a.p_emails.forEach(e => { db.member_roster = db.member_roster.filter(x => x.email !== em(e)); const m = db.members.find(x => em(x.email) === em(e)); if (m && m.active) { m.active = false; m.archived_at = iso(0); m.archive_reason = a.p_reason; n++; audit('person.archived', m.full_name); } }); return { archived: n }; },
    admin_restore_people: a => { a.p_emails.forEach(e => { const m = db.members.find(x => em(x.email) === em(e)); if (m) { m.active = true; m.archived_at = null; db.member_roster.push({ email: em(e), full_name: m.full_name, role: m.role }); audit('person.restored', m.full_name); } }); return { restored: a.p_emails.length }; },
    admin_import_people: a => { const rows = a.p_rows.map((x, i) => { const bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email || '') ? 'Not a valid email address.' : !x.name ? 'Name is missing.' : !db.roles.some(rl => rl.name === x.role) ? `Unknown role "${x.role}".` : null;
        return { row: i + 1, email: em(x.email), name: x.name, role: x.role, status: bad ? 'error' : 'new', message: bad || 'Will be invited.' }; });
      const errors = rows.filter(x => x.status === 'error').length; if (a.p_apply && !errors) rows.forEach(x => db.member_roster.push({ email: x.email, full_name: x.name, role: x.role })); return { applied: !!a.p_apply, ok: rows.length - errors, errors, rows }; },
    admin_update_role: a => { Object.assign(db.roles.find(x => x.name === a.p_name), { description: a.p_description, in_training: a.p_in_training, in_recruitment: a.p_in_recruitment, is_admin: a.p_is_admin }); audit('role.updated', a.p_name); return { result: 'saved' }; },
    admin_save_guide: a => { if (a.p_id) { const g = db.guides.find(x => x.id === a.p_id); Object.assign(g, { first_name: a.p_first, last_name: a.p_last, full_name: a.p_first + ' ' + a.p_last, email: a.p_email }); return { result: 'updated' }; }
      const id = 'g' + Date.now(); db.guides.push({ id, first_name: a.p_first, last_name: a.p_last, full_name: a.p_first + ' ' + a.p_last, email: a.p_email, active: true }); db.evals.push({ id: 'e' + id, term_id: 'fall-2026', guide_id: id, priority: a.p_priority || db.priorities[0].name }); audit('guide.added', a.p_first + ' ' + a.p_last); return { result: 'added' }; },
    admin_set_guides_active: a => { a.p_ids.forEach(id => { const g = db.guides.find(x => x.id === id); if (g) { g.active = a.p_active; g.archive_reason = a.p_reason; audit(a.p_active ? 'guide.restored' : 'guide.archived', g.full_name); } }); return { changed: a.p_ids.length }; },
    admin_import_guides: a => { const rows = a.p_rows.map((x, i) => ({ row: i + 1, name: `${x.first} ${x.last}`, email: x.email, priority: x.priority, status: x.first && x.last ? 'new' : 'error', message: x.first && x.last ? 'Will be added.' : 'First and last name are both required.' }));
      const errors = rows.filter(x => x.status === 'error').length; return { applied: !!a.p_apply, ok: rows.length - errors, errors, rows }; },
    admin_save_term: a => { Object.assign(db.terms.find(x => x.id === a.p_id), { label: a.p_label, academic_year: a.p_year, starts_on: a.p_starts, ends_on: a.p_ends }); audit('term.saved', a.p_label); return { result: 'saved' }; },
    admin_start_semester: a => { const guides = db.guides.filter(g => g.active && !a.p_leaving_guides.includes(g.id)); const out = { dry_run: !a.p_apply, from_term: 'fall-2026', to_term: a.p_to, new_term: !db.terms.some(t => t.id === a.p_to),
        guides_carried: guides.length + a.p_new_guides.length, guides_promoted: 2, guides_archived: a.p_leaving_guides.length, new_guides: a.p_new_guides.length, people_archived: a.p_leaving_people.length,
        new_people: a.p_new_people.length, role_changes: a.p_role_changes.length, sessions: a.p_sessions.length, warnings: a.p_sessions.length ? [] : ['No training sessions were created. Add them under Training.'] };
      if (a.p_apply) { db.terms.forEach(t => (t.is_current = false)); db.terms.unshift({ id: a.p_to, label: a.p_label, academic_year: a.p_year, starts_on: a.p_starts, ends_on: a.p_ends, is_current: true }); audit('semester.started', a.p_label); } return out; },
    admin_set_setting: a => { const s = db.app_settings.find(x => x.key === a.p_key); s ? (s.value = a.p_value) : db.app_settings.push({ key: a.p_key, value: a.p_value }); audit('setting.changed', a.p_key); return { result: 'saved' }; },
    admin_get_reminders: () => ({ enabled: false, owner_id: null, from_email: '', hub_url: '', hours_before: 24 }),
    admin_set_reminders: () => ({ result: 'saved' }),
    admin_pending_signups: () => [],
    /* ---- training ---- */
    training_overview: a => { const t = a.p_term || 'fall-2026'; const reqs = db.training_requirements.filter(r => r.term_id === t && r.active).map(r => { const rows = rowsFor(r.id), c = k => rows.filter(x => x.state === k).length;
        return { id: r.id, name: r.name, deadline: r.deadline, rule: r.rule, total: rows.length, complete: c('complete'), waived: c('waived'), excused: c('excused'), scheduled: c('scheduled'), makeup_needed: c('makeup_needed'), incomplete: c('incomplete'), sessions: db.requirement_sessions.filter(l => l.requirement_id === r.id).length }; });
      const ups = db.training_sessions.filter(s => s.term_id === t && s.status === 'scheduled' && s.held_on >= T(0)).map(s => ({ id: s.id, title: s.label, held_on: s.held_on, start_time: s.start_time, end_time: s.end_time, location: s.location, type: s.training_type, required: s.required, status: s.status, makeup: !!s.makeup_for,
        speakers: db.session_speakers.filter(x => x.session_id === s.id).map(x => x.speaker_name), expected: db.training_attendance.filter(x => x.session_id === s.id).length, materials: 0 }));
      const att = []; db.training_sessions.filter(s => s.term_id === t).forEach(s => { if (s.held_on < T(0) && !s.attendance_submitted_at && s.status !== 'cancelled' && db.training_attendance.some(x => x.session_id === s.id)) att.push({ kind: 'attendance_missing', session_id: s.id, title: s.label, date: s.held_on });
        if (s.status === 'scheduled' && s.held_on >= T(0) && s.held_on <= T(7)) { if (!s.location) att.push({ kind: 'no_location', session_id: s.id, title: s.label, date: s.held_on }); if (s.required && !db.session_speakers.some(x => x.session_id === s.id)) att.push({ kind: 'no_speaker', session_id: s.id, title: s.label, date: s.held_on }); } });
      return { term: t, requirements: reqs, upcoming: ups, attention: att }; },
    admin_training_matrix: () => db.training_requirements.filter(r => r.active).flatMap(r => rowsFor(r.id).map(x => ({ requirement_id: r.id, ...x }))),
    admin_training_report: () => ({ sessions: db.training_sessions.map(s => { const at = db.training_attendance.filter(a => a.session_id === s.id), n = k => at.filter(a => cls(a.actual) === k).length; return { id: s.id, title: s.label, held_on: s.held_on, status: s.status, required: s.required, expected: at.length, present: n('present'), excused: n('excused'), absent: n('absent'), pending: n('pending') }; }) }),
    my_training: () => key === 'guide' ? { linked: true, guide_id: 'g1', name: 'Zachary Detlaff', term: 'fall-2026', requirements: [
      { requirement_id: 'q1', name: 'New Tour Guide Orientation', description: 'Required before your first tour.', deadline: T(14), state: 'makeup_needed', via: 'automatic', done_on: null, next_on: null, upcoming: [{ id: 's9', title: 'Makeup', held_on: T(5), start_time: '18:00:00', location: 'Union 301', makeup: true }], materials: [{ title: 'Guide Handbook', kind: 'pdf', url: 'https://example.edu/handbook.pdf', description: 'Read first' }] },
      { requirement_id: 'q2', name: 'Campus Safety', description: null, deadline: T(20), state: 'scheduled', via: 'automatic', done_on: null, next_on: T(1), upcoming: [{ id: 's3', title: 'Campus Safety', held_on: T(1), start_time: '18:00:00', location: 'Union 214', makeup: false }], materials: [] },
      { requirement_id: 'q3', name: 'Handbook quiz', description: null, deadline: null, state: 'complete', via: 'automatic', done_on: T(-12), next_on: null, upcoming: [], materials: [] }] } : { linked: false },
    admin_save_training_session: a => { const f = a.p_f; if (!a.p_id && !String(f.title || '').trim()) throw new Error('A training session needs a title.'); let s = db.training_sessions.find(x => x.id === a.p_id);
      if (!s) { s = { id: 's' + Date.now(), term_id: f.term_id || 'fall-2026', makeup_for: null, attendance_submitted_at: null, description: null, notes: null }; db.training_sessions.push(s); }
      Object.entries(f).forEach(([k, v]) => { const m = { title: 'label' }[k] || k; s[m] = v === '' ? null : v; }); s.training_type ||= 'General'; audit(a.p_id ? 'training.session_changed' : 'training.session_created', s.label); return { id: s.id, created: !a.p_id }; },
    admin_set_session_status: a => { db.training_sessions.find(x => x.id === a.p_id).status = a.p_status; audit('training.session_' + a.p_status, 'session'); return { status: a.p_status }; },
    admin_delete_empty_session: a => { db.training_sessions = db.training_sessions.filter(x => x.id !== a.p_id); return { deleted: true }; },
    admin_duplicate_session: a => { const o = db.training_sessions.find(x => x.id === a.p_id), id = 's' + Date.now(); db.training_sessions.push({ ...o, id, label: a.p_title || o.label + ' (copy)', held_on: a.p_date || o.held_on, status: 'draft', attendance_submitted_at: null }); return { id, title: a.p_title }; },
    admin_make_makeup: a => { const o = db.training_sessions.find(x => x.id === a.p_original), id = 's' + Date.now(); db.training_sessions.push({ ...o, id, label: 'Makeup: ' + o.label, held_on: a.p_date, start_time: a.p_start || o.start_time, location: a.p_location || o.location, makeup_for: o.id, status: 'scheduled', attendance_submitted_at: null });
      db.requirement_sessions.filter(l => l.session_id === o.id).forEach(l => db.requirement_sessions.push({ requirement_id: l.requirement_id, session_id: id }));
      const owed = db.training_attendance.filter(x => x.session_id === o.id && ['absent', 'excused'].includes(cls(x.actual))); owed.forEach(x => db.training_attendance.push({ id: id + x.guide_id, session_id: id, guide_id: x.guide_id, person_name: x.person_name, actual: null })); audit('training.makeup_created', o.label); return { id, title: 'Makeup', assigned: owed.length }; },
    admin_seed_attendance: a => { seedAtt(a.p_session); return { added: 0 }; },
    admin_set_attendance: a => { let n = 0; a.p_entries.forEach(e => { let r = db.training_attendance.find(x => x.session_id === a.p_session && x.guide_id === e.guide_id); const g = db.guides.find(x => x.id === e.guide_id); if (!r) { r = { id: a.p_session + e.guide_id, session_id: a.p_session, guide_id: e.guide_id, person_name: g.full_name, actual: null }; db.training_attendance.push(r); } r.actual = e.status || null; n++; });
      if (a.p_submit) { const s = db.training_sessions.find(x => x.id === a.p_session); s.attendance_submitted_at = new Date().toISOString(); if (s.held_on <= T(0)) s.status = 'completed'; } audit(a.p_submit ? 'training.attendance_submitted' : 'training.attendance_edited', a.p_session); return { saved: n, counts: {}, submitted: !!a.p_submit }; },
    admin_mark_all: a => { seedAtt(a.p_session); let n = 0; db.training_attendance.filter(x => x.session_id === a.p_session).forEach(x => { if (!a.p_only_unmarked || cls(x.actual) === 'pending') { x.actual = a.p_status; n++; } }); return { marked: n }; },
    admin_save_requirement: a => { const f = a.p_f; let r = db.training_requirements.find(x => x.id === a.p_id); if (!r) { r = { id: 'q' + Date.now(), term_id: f.term_id || 'fall-2026', active: true, sort_order: db.training_requirements.length }; db.training_requirements.push(r); } Object.assign(r, f); audit('training.requirement_created', r.name); return { id: r.id }; },
    admin_set_requirement_sessions: a => { db.requirement_sessions = db.requirement_sessions.filter(l => l.requirement_id !== a.p_req); a.p_sessions.forEach(sid => { db.requirement_sessions.push({ requirement_id: a.p_req, session_id: sid }); seedAtt(sid); }); return { sessions: a.p_sessions.length, people_added: 0 }; },
    admin_archive_requirement: a => { db.training_requirements.find(x => x.id === a.p_id).active = !a.p_archived; return null; },
    admin_requirements_from_sessions: () => ({ created: 0 }),
    admin_add_requirement_people: () => ({ people: 0 }),
    admin_set_completion: a => { a.p_guides.forEach(g => { db.training_overrides = db.training_overrides.filter(o => !(o.requirement_id === a.p_req && o.guide_id === g)); if (a.p_status) db.training_overrides.push({ requirement_id: a.p_req, guide_id: g, status: a.p_status, reason: a.p_reason }); }); audit('training.completion_' + (a.p_status || 'auto'), 'guide'); return { changed: a.p_guides.length }; },
    admin_save_speaker: a => { const id = 'sp' + Date.now(); db.training_speakers.push({ id, name: a.p_name, email: a.p_email, phone: a.p_phone, affiliation: a.p_affiliation, active: true }); return id; },
    admin_set_session_speakers: a => { db.session_speakers = db.session_speakers.filter(x => x.session_id !== a.p_session); a.p_speakers.forEach(x => db.session_speakers.push({ session_id: a.p_session, speaker_id: x.speaker_id, speaker_name: db.training_speakers.find(y => y.id === x.speaker_id).name, role: x.role })); return { speakers: a.p_speakers.length }; },
    admin_save_material: a => { const id = 'm' + Date.now(); if (!/^https:\/\//.test(a.p_url)) throw new Error('The link must start with https:// and contain no spaces.'); db.training_materials.push({ id, title: a.p_title, kind: a.p_kind, url: a.p_url, description: a.p_description, session_id: a.p_session, requirement_id: a.p_requirement }); return id; },
    admin_delete_material: a => { db.training_materials = db.training_materials.filter(x => x.id !== a.p_id); return null; },
    admin_save_training_template: a => { db.training_templates.push({ id: 'tp' + Date.now(), active: true, audience: {}, materials: [], ...a.p_f, duration_minutes: a.p_f.duration_minutes, default_location: a.p_f.default_location, completion_rule: a.p_f.completion_rule }); return 'tp'; },
    admin_create_from_template: a => { const t = db.training_templates.find(x => x.id === a.p_template), id = 's' + Date.now(); db.training_sessions.push({ id, term_id: a.p_term, label: t.name + ' · ' + a.p_date, held_on: a.p_date, start_time: a.p_start, end_time: null, location: a.p_location || t.default_location, training_type: t.training_type, required: t.required, status: 'scheduled', makeup_for: null, makeup_eligible: true }); return { session_id: id, requirement_id: null }; },
    admin_copy_training_setup: a => { const reqs = db.training_requirements.filter(r => r.term_id === a.p_from), out = { dry_run: !a.p_apply, requirements: reqs.length, sessions: a.p_opts.sessions ? db.training_sessions.filter(s => s.term_id === a.p_from && !s.makeup_for).length : 0, materials: 1, from: a.p_from, to: a.p_to };
      if (a.p_apply) { reqs.forEach(r => db.training_requirements.push({ ...r, id: 'q' + Date.now() + r.id, term_id: a.p_to })); audit('training.setup_copied', a.p_to); } return out; },
    admin_save_training_group: a => { const id = 'tg' + Date.now(); db.training_groups.push({ id, name: a.p_name, description: a.p_description }); return id; },
    admin_set_group_members: a => { db.training_group_members = db.training_group_members.filter(m => m.group_id !== a.p_group).concat(a.p_guides.map(g => ({ group_id: a.p_group, guide_id: g }))); return { members: a.p_guides.length }; },
    /* ---- Vanessa (mirrors supabase/21-vanessa-agent.sql closely enough for the UI) ---- */
    vanessa_begin_action: a => { db.va = db.va || []; db.va.forEach(x => { if (x.status === 'pending') x.status = 'cancelled'; }); const id = 'va' + (db.va.length + 1); db.va.push({ id, kind: a.p_kind, hash: a.p_hash, status: 'pending', mode: a.p_mode, summary: a.p_summary, at: new Date().toISOString() }); return id; },
    vanessa_confirm_action: a => { const x = (db.va || []).find(y => y.id === a.p_id); if (!x) throw new Error('I could not find that request. Ask me again and I will set it up fresh.'); if (x.status !== 'pending') throw new Error('That request was already used. Ask me again if you want to repeat it.'); if (x.hash !== a.p_hash) throw new Error('The details changed after you reviewed them, so I did not run it.'); x.status = 'confirmed'; return { ok: true }; },
    vanessa_finish_action: a => { const x = (db.va || []).find(y => y.id === a.p_id); if (x && x.status === 'confirmed') x.status = a.p_ok ? 'executed' : 'failed'; return null; },
    vanessa_cancel_action: a => { const x = (db.va || []).find(y => y.id === a.p_id); if (x && x.status === 'pending') x.status = 'cancelled'; return null; },
    vanessa_log_turn: a => { (db.vt = db.vt || []).push(a); return null; },
    admin_vanessa_stats: () => { const t = db.vt || [], by = {}; t.forEach(x => { by[x.p_engine] = (by[x.p_engine] || 0) + 1; });
      return { hours: 24, turns: t.length, ok: t.filter(x => x.p_ok).length, avg_latency_ms: 40, p95_latency_ms: 90, people: 1, last_success_at: t.length ? new Date().toISOString() : null, by_engine: by, local_calls: t.reduce((n, x) => n + (x.p_local_calls || 0), 0),
        provider_failures: t.filter(x => x.p_provider_failed).length, not_understood: t.filter(x => x.p_engine === 'legacy').length, avg_confidence: 0.9, by_intent: [], by_tool: [], failing_tools: [], recent_failures: [],
        actions: (db.va || []).reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), {}), recent_actions: (db.va || []).slice(-5).map(x => ({ at: x.at, kind: x.kind, status: x.status, mode: x.mode, person: 'Test Person' })) }; },
    /* ---- data management (mirrors supabase/19 closely enough to exercise the screens) ---- */
    admin_data_status: () => ({ term: { id: 'fall-2026', label: 'Fall 2026' }, active_guides: db.guides.filter(g => g.active).length, archived_guides: 0, needing_eval: db.evals.length, awaiting_assignment: db.evals.length - 1, not_on_eval_roster: 0,
      issues: db.sync_issues.filter(i => i.status === 'open').reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {}), sources: db.external_sources.filter(x => x.active),
      schedule_records: db.source_records.filter(r => r.source_kind === 'tour_schedule' && r.active).length, schedule_unmatched: db.source_records.filter(r => r.source_kind === 'tour_schedule' && r.active && !r.guide_id).length, overrides: 0 }),
    admin_save_source: a => { let s = db.external_sources.find(x => x.id === a.p_id); if (!s) { s = { id: 'src' + (db.external_sources.length + 1), active: false, status: 'new' }; db.external_sources.push(s); }
      Object.assign(s, { kind: a.p_kind, name: a.p_name, sheet_id: a.p_sheet_id, sheet_title: a.p_sheet_title, tab: a.p_tab, gid: a.p_gid, adapter: a.p_adapter, column_map: a.p_column_map }); return s.id; },
    admin_save_template: a => { db.column_templates = db.column_templates.filter(t => !(t.kind === a.p_kind && t.signature === a.p_signature)).concat({ kind: a.p_kind, signature: a.p_signature, adapter: a.p_adapter, column_map: a.p_column_map }); return null; },
    admin_activate_source: a => { const s = db.external_sources.find(x => x.id === a.p_id); db.external_sources.forEach(x => { if (x.kind === s.kind && x.active) { x.active = false; db.source_records.forEach(r => { if (r.source_id === x.id) r.active = false; }); } }); s.active = true; audit('source.activated', s.name); return { result: 'activated' }; },
    admin_source_failed: a => { const s = db.external_sources.find(x => x.id === a.p_source); if (s) { s.status = 'error'; s.last_error = a.p_message; } return null; },
    admin_sync_source: a => { const s = db.external_sources.find(x => x.id === a.p_source), rows = a.p_rows, ok = new Set(['id', 'email', 'exact']);
      const matched = rows.filter(r => r.guide_id && r.basis), review = rows.filter(r => !r.guide_id && r.basis !== 'ignored');
      const out = { dry_run: !a.p_apply, rows: rows.length, matched_auto: matched.filter(r => ok.has(r.basis)).length, matched_saved: matched.filter(r => !ok.has(r.basis)).length, needs_review: rows.filter(r => !r.guide_id).length,
        new_people: new Set(review.map(r => r.identity)).size, major_updates: matched.filter(r => r.payload && r.payload.major && db.guides.find(g => g.id === r.guide_id)?.major !== r.payload.major).length, conflicts: 0,
        possible_inactive: s.kind === 'tour_schedule' ? 0 : db.guides.filter(g => g.active && !matched.some(r => r.guide_id === g.id)).length };
      if (!a.p_apply) return out;
      db.source_records = db.source_records.filter(r => r.source_id !== s.id);
      rows.forEach(r => { db.source_records.push({ id: 'r' + db.source_records.length, source_id: s.id, source_kind: s.kind, external_key: r.key, identity_key: r.identity, external_name: r.name, external_email: r.email, payload: r.payload, occurred_on: r.occurred_on, slot: r.slot, start_time: r.start_time, guide_id: r.guide_id, match_basis: r.basis, active: true });
        if (r.guide_id && s.kind !== 'tour_schedule' && r.payload?.major) { const g = db.guides.find(x => x.id === r.guide_id); g.major = r.payload.major; } });
      const seenId = new Set(db.sync_issues.map(i => i.kind + i.external_key));
      review.forEach(r => { const kind = s.kind === 'tour_schedule' ? 'schedule_unmatched' : 'unmatched_person'; if (!seenId.has(kind + r.identity)) { seenId.add(kind + r.identity); db.sync_issues.push({ id: db.sync_issues.length + 1, kind, source_kind: s.kind, external_key: r.identity, external_name: r.name, detail: { email: r.email, major: r.payload?.major }, suggested: r.candidates, status: 'open' }); } });
      if (s.kind !== 'tour_schedule') db.guides.filter(g => g.active && !matched.some(r => r.guide_id === g.id)).forEach(g => db.sync_issues.push({ id: db.sync_issues.length + 1, kind: 'roster_missing_in_source', source_kind: s.kind, external_name: g.full_name, guide_id: g.id, detail: { source: s.name }, status: 'open' }));
      Object.assign(s, { last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), status: 'ok', last_error: null, row_count: rows.length }); audit('source.synced', s.name); return out; },
    admin_confirm_match: a => { db.external_identity_mappings.push({ id: db.external_identity_mappings.length + 1, source_kind: a.p_kind, external_key: a.p_key, external_name: a.p_name, guide_id: a.p_guide, confirmed: true });
      db.source_records.forEach(r => { if (r.identity_key === a.p_key) { r.guide_id = a.p_guide; r.match_basis = 'confirmed'; } }); db.sync_issues.forEach(i => { if (i.external_key === a.p_key && i.status === 'open') i.status = 'resolved'; }); audit('identity.confirmed', a.p_name); return { linked: 1 }; },
    admin_forget_match: a => { db.external_identity_mappings = db.external_identity_mappings.filter(m => m.id !== a.p_id); return null; },
    admin_resolve_issue: a => { const i = db.sync_issues.find(x => x.id === a.p_issue); i.status = 'resolved';
      if (a.p_action === 'create_guide') { const id = 'g' + Date.now(); db.guides.push({ id, first_name: a.p_first, last_name: a.p_last, full_name: a.p_first + ' ' + a.p_last, email: i.detail?.email || null, active: true, major: i.detail?.major || null }); db.evals.push({ id: 'e' + id, term_id: 'fall-2026', guide_id: id, priority: db.priorities[0].name }); db.source_records.forEach(r => { if (r.identity_key === i.external_key) r.guide_id = id; }); }
      if (a.p_action === 'choose_person' || a.p_action === 'confirm_match') db.source_records.forEach(r => { if (r.identity_key === i.external_key) r.guide_id = a.p_guide; });
      audit('issue.' + a.p_action, i.external_name || i.kind); return { result: a.p_action }; },
    admin_update_guide: a => { Object.assign(db.guides.find(g => g.id === a.p_id), a.p_fields); if (a.p_fields.first_name || a.p_fields.last_name) { const g = db.guides.find(x => x.id === a.p_id); g.full_name = g.first_name + ' ' + g.last_name; } audit('guide.edited', db.guides.find(g => g.id === a.p_id).full_name); return { changed: Object.keys(a.p_fields) }; },
    admin_clear_override: () => ({ result: 'returned to source value' }),
    admin_set_field_owner: a => { db.field_ownership.find(f => f.field === a.p_field).owner = a.p_owner; audit('ownership.changed', a.p_field); return null; },
    admin_save_major_mapping: a => { db.major_mappings = db.major_mappings.filter(m => m.raw !== a.p_raw.toLowerCase()).concat({ raw: a.p_raw.toLowerCase(), canonical: a.p_canonical }); return null; },
    admin_delete_major_mapping: a => { db.major_mappings = db.major_mappings.filter(m => m.raw !== a.p_raw); return null; },
    admin_renormalize_majors: () => ({ updated: 0 }),
    admin_set_guide_term: a => { a.p_ids.forEach(id => { const t = db.guide_terms.find(x => x.guide_id === id); t ? (t.active = a.p_active) : db.guide_terms.push({ guide_id: id, term_id: a.p_term, active: a.p_active }); }); return { changed: a.p_ids.length }; },
    admin_add_to_eval_roster: a => { a.p_guide_ids.forEach(id => { if (!db.evals.some(e => e.guide_id === id)) db.evals.push({ id: 'e' + id, term_id: 'fall-2026', guide_id: id, priority: a.p_priority || db.priorities[0].name }); }); return { added: a.p_guide_ids.length }; },
    admin_set_eval_priority: a => { a.p_guide_ids.forEach(id => { const e = db.evals.find(x => x.guide_id === id); e ? (e.priority = a.p_priority) : db.evals.push({ id: 'e' + id, term_id: 'fall-2026', guide_id: id, priority: a.p_priority }); }); audit('evalpriority.changed', a.p_priority); return { changed: a.p_guide_ids.length }; },
    admin_set_eval_need: a => { a.p_guide_ids.forEach(id => { const e = db.evals.find(x => x.guide_id === id); if (e) e.priority = a.p_needs ? db.priorities[1].name : db.priorities[3].name; }); return { changed: a.p_guide_ids.length }; },
    admin_set_evaluator_available: a => { db.members.find(m => m.id === a.p_member).evaluator_available = a.p_available; return null; },
    admin_assign_evaluations: a => { let n = 0; a.p_assignments.forEach(x => { const e = db.evals.find(y => y.id === x.eval_id); if (e && !e.evaluator_id) { e.evaluator_id = x.evaluator_id; e.tour_date = x.date; e.tour_time = x.time; n++; audit('evaluation.assigned', x.eval_id); } }); return { assigned: n, failed: [] }; },
  };

  const filt = (rows, q) => { let out = rows; q.forEach((v, k) => { const m = /^(eq|is)\.(.*)$/.exec(v); if (!m || ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) return;
      out = out.filter(x => String(x[k]) === m[2] || (m[1] === 'is' && String(x[k]) === m[2])); }); return out; };


  /* ---- a pretend local model (Ollama), so the Enhanced path can be driven in a browser ----
     ?agent=local  : a healthy local model that understands a couple of unusual phrasings
     ?agent=down   : a configured local model that is not running (Vanessa must carry on in Standard mode)
     (default)     : no local model at all: Standard Vanessa only */
  const agentMode = new URLSearchParams(location.search).get('agent') || 'standard';
  if (agentMode === 'local' || agentMode === 'down') { try { localStorage.setItem('hub2.vanessa.local', JSON.stringify({ enabled: true, provider: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3.2:3b', rephrase: false, timeoutMs: 4000 })); } catch (e) { /* storage blocked */ } }
  else { try { localStorage.removeItem('hub2.vanessa.local'); } catch (e) { /* storage blocked */ } }
  window.__localCalls = [];
  function fakeOllama(u, o) {
    window.__localCalls.push(u);
    if (agentMode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    if (/\/api\/tags$/.test(u)) return json({ models: [{ name: 'llama3.2:3b' }] });
    if (/\/api\/chat$/.test(u)) {
      const b = JSON.parse(o.body), t = b.messages[1].content.toLowerCase();
      let q = { action: 'none' };
      if (/eyes|benefit|neglect/.test(t)) q = { action: 'query', queries: [{ intent: 'evaluation.opportunities', priority: 'High', when: 'this week' }] };
      else if (/somebody is out|someone is out/.test(t)) q = { action: 'clarify', question: 'Which tour do you want covered?' };
      return json({ message: { content: JSON.stringify(q) }, prompt_eval_count: 220, eval_count: 24 });
    }
    return json({}, 404);
  }

  const real = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf('stub.invalid/auth/v1/user') > -1) return json({ id: 'u1' });
    if (u.indexOf('localhost:11434') > -1) return fakeOllama(u, o || {});
    const rp = /stub\.invalid\/rest\/v1\/rpc\/([a-z_]+)/.exec(u);
    if (rp) { const body = o && o.body ? JSON.parse(o.body) : {}; return rpcs[rp[1]] ? json(rpcs[rp[1]](body)) : json({ message: 'Could not find the function public.' + rp[1] + ' in the schema cache' }, 404); }
    const m = /stub\.invalid\/rest\/v1\/([a-z_]+)(\?.*)?$/.exec(u);
    if (m) {
      const [, name, qs] = m, q = new URLSearchParams((qs || '').slice(1)), method = (o && o.method) || 'GET', body = o && o.body ? JSON.parse(o.body) : null;
      if (name === 'rpc') return json({});
      if (u.indexOf('/rpc/') > -1) { const fn = u.split('/rpc/')[1].split('?')[0]; return rpcs[fn] ? json(rpcs[fn](body || {})) : json({ message: 'Could not find the function public.' + fn + ' in the schema cache' }, 404); }
      if (name === 'eval_roster') { if (q.get('guide_active')) return json(roster().filter(x => x.guide_active)); return json(roster()); }
      if (name === 'members' && q.get('id') === 'eq.u1') return json([db.members[0]]);
      if (name === 'roles' && q.get('name')) return json(db.roles.filter(x => 'eq.' + x.name === q.get('name')));
      if (name === 'terms' && q.get('is_current')) return json(db.terms.filter(t => t.is_current).map(t => ({ id: t.id, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on })));
      if (name === 'member_roster' && method !== 'GET') return json(body);
      if (name === 'action_states') return json([]);
      if (db[name]) return json(filt(db[name], q));
      return json([]);
    }
    const gv = /docs\.google\.com\/spreadsheets\/d\/([^/]+)\/gviz\/tq/.exec(u);
    if (gv) { if (gv[1] === '1nwY1Dd1pGleZ8V7uGUOPuDGQCC6UPWX3FisTEd4wAuU') return csvResp(MAJORS_CSV); if (gv[1] === 'SCHEDULETABLEFIXTURE0000000000000000') return csvResp(SCHEDULE_CSV); return Promise.reject(new Error('offline')); }
    if (u.indexOf('stub.invalid') > -1) return json([]);
    if (u.indexOf('.invalid') > -1 || /docs.google|googleapis.com\/(?!css)/.test(u)) return Promise.reject(new Error('offline'));
    return real.apply(this, arguments);
  };
})();
