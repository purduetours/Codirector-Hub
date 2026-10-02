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

  const real = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf('stub.invalid/auth/v1/user') > -1) return json({ id: 'u1' });
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
