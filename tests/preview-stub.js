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
    guides: [['Ann', 'One'], ['Ben', 'Two'], ['Cy', 'Three'], ['Dee', 'Four']].map((n, i) => ({ id: 'g' + i, first_name: n[0], last_name: n[1], full_name: n.join(' '), email: n[0].toLowerCase() + '@purdue.edu', active: true })),
    priorities: ['First Priority to Eval', 'Second Priority', 'Third Priority', 'No Need to Eval'].map((n, i) => ({ name: n, sort_order: i + 1, needs_eval: i < 3 })),
    app_settings: [{ key: 'contact.email', value: 'tours@purdue.edu' }, { key: 'contact.name', value: 'The Codirectors' }],
    admin_audit: [{ id: 1, at: new Date().toISOString(), actor_name: 'Alex Rivera', action: 'person.archived', target_label: 'Jordan Poe', before: { role: 'Recruitment Committee' }, after: { active: false }, note: 'Graduated' }],
    announcements: [{ id: 1, title: 'Welcome back, committee', body: 'Fall training starts Tuesday. Bring your handbook.', pinned: true, created_at: new Date().toISOString(), author: { full_name: 'Logan' } }],
    evals: []
  };
  db.evals = db.guides.map((g, i) => ({ id: 'e' + i, term_id: 'fall-2026', guide_id: g.id, priority: db.priorities[i % 3].name }));
  const roster = () => db.evals.map((e, i) => { const g = db.guides.find(x => x.id === e.guide_id), p = db.priorities.find(x => x.name === e.priority);
    return { id: e.id, term_id: e.term_id, guide_id: g.id, first_name: g.first_name, last_name: g.last_name, full_name: g.full_name, priority: e.priority, priority_rank: p.sort_order, needs_eval: p.needs_eval,
      evaluator_id: i === 1 ? 'u1' : null, evaluator_name: i === 1 ? 'Test Person' : null, tour_date: i === 1 ? iso(2) : null, tour_time: i === 1 ? '14:00:00' : null, status: i === 1 ? 'claimed' : p.needs_eval ? 'open' : 'skip', guide_active: g.active }; });

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
    admin_pending_signups: () => []
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
    if (u.indexOf('stub.invalid') > -1) return json([]);
    if (u.indexOf('.invalid') > -1 || /docs.google|googleapis.com\/(?!css)/.test(u)) return Promise.reject(new Error('offline'));
    return real.apply(this, arguments);
  };
})();
