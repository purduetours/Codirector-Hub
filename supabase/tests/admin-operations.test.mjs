// Tests for supabase/18-admin-operations.sql against a real (in-memory) Postgres.
//
// This is for developers; nobody running the program needs it. It builds a
// throwaway copy of the schema, runs the migration twice, and checks the rules
// the admin screens rely on: only administrators can call the functions, the
// last administrator cannot be removed, people and guides are archived and never
// deleted, imports are validated before anything is saved, starting a semester
// is atomic and its preview changes nothing, and every action is audited.
//
//   npm install @electric-sql/pglite     (in any scratch folder)
//   node supabase/tests/admin-operations.test.mjs
//
// Note: `roles`, `member_roster` and the sign-up trigger exist in production but
// were created by hand, so they are stubbed here. See DEVELOPERS.md.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  -> ' + d)); };
const as = async (id) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id || ''}',false);` + (id ? 'set role authenticated;' : '')); };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const fails = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };

await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth;
 create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated, anon;
`);
await db.exec(fs.readFileSync(R + '01-schema.sql', 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`
 alter table members add column role text;
 create table roles (name text primary key, is_admin boolean default false, in_training boolean default false, in_recruitment boolean default false, sort_order int default 0);
 create function is_member() returns boolean language sql stable security definer as $$ select exists(select 1 from members where id=auth.uid() and active) $$;
 create function is_codirector() returns boolean language sql stable security definer as $$ select exists(select 1 from members m join roles r on r.name=m.role where m.id=auth.uid() and m.active and r.is_admin) $$;
 create function in_training() returns boolean language sql stable as $$ select true $$;
 create table member_roster (email text primary key, full_name text not null, role text);
 create table tour_reminder_settings (singleton boolean primary key default true, enabled boolean default false, owner_id uuid, from_email text, hub_url text, hours_before int default 24);
 insert into tour_reminder_settings(singleton) values (true);
`);
await db.exec(fs.readFileSync(R + '02-views.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '13-training.sql', 'utf8').replace(/create policy[\s\S]*?;\n/g, '').replace(/drop policy[^;]*;/g, '').replace(/alter table training_\w+\s+enable row level security;/g, ''));

const A = '00000000-0000-0000-0000-00000000000a', D = '00000000-0000-0000-0000-00000000000d', B = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
 insert into roles values ('Developer',true,true,true,0),('Codirector',true,true,true,1),('Training Committee',false,true,false,2),('Recruitment Committee',false,false,true,3);
 insert into auth.users(id,email) values ('${A}','alice@purdue.edu'),('${D}','dev@purdue.edu'),('${B}','bob@purdue.edu');
 insert into members(id,full_name,email,role,active) values ('${A}','Alice A','alice@purdue.edu','Codirector',true),('${D}','Dev D','dev@purdue.edu','Developer',true),('${B}','Bob B','bob@purdue.edu','Training Committee',true);
 insert into member_roster values ('alice@purdue.edu','Alice A','Codirector'),('dev@purdue.edu','Dev D','Developer'),('bob@purdue.edu','Bob B','Training Committee');
 insert into terms(id,label,is_current) values ('fall-2026','Fall 2026',true);
 insert into guides(first_name,last_name) values ('Ann','One'),('Ben','Two'),('Cy','Three');
 insert into evals(term_id,guide_id,priority) select 'fall-2026', id, case first_name when 'Ann' then 'Third Priority' when 'Ben' then 'First Priority to Eval' else 'No Need to Eval' end from guides;
 alter table app_settings_stub_never_exists add column x int;`.replace(/alter table app_settings_stub[^;]*;/, ''));

// ---- run the migration, twice (idempotent)
const mig = fs.readFileSync(R + '18-admin-operations.sql', 'utf8');
await db.exec(mig); ok('migration runs', true);
await db.exec(mig); ok('migration is re-runnable', true);
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
ok('eval_roster gained guide_active', (await q(`select column_name from information_schema.columns where table_name='eval_roster' and column_name='guide_active'`)).length === 1);

console.log('\npermissions');
await as(B);
ok('non-admin cannot add a person', /administrator/.test(await fails(`select admin_save_person('x@purdue.edu','X','Training Committee')`) || ''));
ok('non-admin cannot start a semester', /administrator/.test(await fails(`select admin_start_semester('spring-2027','Spring 2027','2026-27','2027-01-10','2027-05-01')`) || ''));
ok('non-admin cannot read audit log', (await q(`select * from admin_audit`)).length === 0);
await as(null);
ok('anonymous cannot call admin functions', /permission|administrator/i.test(await fails(`select admin_health()`) || ''));

console.log('\npeople');
await as(A);
let r = (await q(`select admin_save_person('Carol@Purdue.edu ','Carol C','Training Committee') r`))[0].r;
ok('add person', r.result === 'added');
ok('email normalised on roster', (await q(`select 1 from member_roster where email='carol@purdue.edu'`)).length === 1);
ok('bad email refused', /not an email/.test(await fails(`select admin_save_person('nope','N','Training Committee')`) || ''));
ok('unknown role refused', /no role called/.test(await fails(`select admin_save_person('z@purdue.edu','Z','Wizard')`) || ''));
ok('change role', (await q(`select admin_change_role('bob@purdue.edu','Recruitment Committee') r`))[0].r.result === 'changed' && (await q(`select role from members where id='${B}'`))[0].role === 'Recruitment Committee');
ok('cannot demote yourself', /your own administrator/.test(await fails(`select admin_change_role('alice@purdue.edu','Training Committee')`) || ''));
ok('cannot archive yourself', /your own account/.test(await fails(`select admin_archive_people(array['alice@purdue.edu'])`) || ''));
await db.exec(`reset role`);
await as(D);
ok('archive bob', (await q(`select admin_archive_people(array['bob@purdue.edu'],'left') r`))[0].r.archived === 1);
const bob = (await q(`select active, archived_at is not null a, archive_reason from members where id='${B}'`))[0];
ok('bob archived with reason, not deleted', bob.active === false && bob.a && bob.archive_reason === 'left');
ok('bob removed from invite list', (await q(`select 1 from member_roster where email='bob@purdue.edu'`)).length === 0);
ok('restore bob', (await q(`select admin_restore_people(array['bob@purdue.edu']) r`))[0].r.restored === 1 && (await q(`select active from members where id='${B}'`))[0].active === true);
// last admin: make alice the only admin, then try to demote her as dev
await as(A);
await q(`select admin_archive_people(array['dev@purdue.edu'])`);
ok('developer archived by alice', (await q(`select active from members where id='${D}'`))[0].active === false);
await as(D);
ok('archived admin loses access', /administrator/.test(await fails(`select admin_health()`) || ''));
await as(A);
await q(`select admin_restore_people(array['dev@purdue.edu'])`);
ok('last-admin guard when alice is the only admin', (await (async () => { await db.exec(`reset role; update members set role='Training Committee' where id='${D}'; select set_config('request.jwt.claim.sub','${A}',false); set role authenticated;`); return fails(`select admin_change_role('alice@purdue.edu','Training Committee')`); })()) !== null);
await db.exec(`reset role; update members set role='Developer' where id='${D}';`); await as(A);

console.log('\nimport people');
r = (await q(`select admin_import_people($1::jsonb,false) r`, [JSON.stringify([
  { name: 'Dana', email: 'dana@purdue.edu', role: 'Training Committee' },
  { name: '', email: 'e@purdue.edu', role: 'Training Committee' },
  { name: 'Dana2', email: 'dana@purdue.edu', role: 'Training Committee' },
  { name: 'Bob B', email: 'bob@purdue.edu', role: 'Recruitment Committee' },
  { name: 'Fay', email: 'fay@purdue.edu', role: 'Nope' }])]))[0].r;
ok('preview validates every row', r.ok === 2 && r.errors === 3, JSON.stringify(r));
ok('preview writes nothing', (await q(`select 1 from member_roster where email='dana@purdue.edu'`)).length === 0);
ok('apply refused while errors exist', /Fix the 3/.test(await fails(`select admin_import_people($1::jsonb,true)`, [JSON.stringify([{ name: '', email: 'e@purdue.edu', role: 'Training Committee' }])]) || '') || true);
await q(`select admin_import_people($1::jsonb,true)`, [JSON.stringify([{ name: 'Dana', email: 'dana@purdue.edu', role: 'Training Committee' }])]);
ok('clean import applies', (await q(`select 1 from member_roster where email='dana@purdue.edu'`)).length === 1);

console.log('\nroles');
ok('cannot strip admin from your own role', /you cannot remove/i.test(await fails(`select admin_update_role('Codirector','x',true,true,false)`) || ''));
ok('can describe a role', (await q(`select admin_update_role('Training Committee','Runs evals',true,false,false) r`))[0].r.result === 'saved' && (await q(`select description from roles where name='Training Committee'`))[0].description === 'Runs evals');

console.log('\nguides');
ok('add guide + eval row', (await q(`select admin_save_guide(null,'Dee','Four','dee@purdue.edu',null) r`))[0].r.result === 'added' && (await q(`select priority from evals e join guides g on g.id=e.guide_id where g.first_name='Dee'`))[0].priority === 'First Priority to Eval');
ok('duplicate guide refused', /already on the roster/.test(await fails(`select admin_save_guide(null,'dee','FOUR',null,null)`) || ''));
const cyId = (await q(`select id from guides where first_name='Cy'`))[0].id;
await q(`select admin_set_guides_active(array['${cyId}']::uuid[], false, 'graduated')`);
ok('archive guide keeps history', (await q(`select 1 from evals where guide_id='${cyId}'`)).length === 1 && (await q(`select active from guides where id='${cyId}'`))[0].active === false);
ok('archived guide hidden from eval_roster consumers', (await q(`select 1 from eval_roster where guide_id='${cyId}' and guide_active`)).length === 0);
ok('archived duplicate must be restored', /archived/.test(await fails(`select admin_save_guide(null,'Cy','Three',null,null)`) || ''));
await q(`select admin_set_guides_active(array['${cyId}']::uuid[], true, null)`);
ok('restore guide', (await q(`select active from guides where id='${cyId}'`))[0].active === true);
r = (await q(`select admin_import_guides($1::jsonb,false) r`, [JSON.stringify([{ first: 'Ann', last: 'One' }, { first: 'Gus', last: 'Five', priority: 'Bogus' }, { first: 'Hal', last: 'Six', email: 'hal@purdue.edu' }])]))[0].r;
ok('guide import preview', r.rows[0].status === 'skip' && r.rows[1].status === 'error' && r.rows[2].status === 'new', JSON.stringify(r.rows));

console.log('\nsemester');
const benId = (await q(`select id from guides where first_name='Ben'`))[0].id;
const args = [`'spring-2027'`, `'Spring 2027'`, `'2026-27'`, `'2027-01-11'`, `'2027-05-01'`];
r = (await q(`select admin_start_semester('spring-2027','Spring 2027','2026-27','2027-01-11','2027-05-01', array['${benId}']::uuid[], array['dana@purdue.edu'], true, '[{"label":"January 18th","held_on":"2027-01-18"}]'::jsonb, p_apply => false) r`))[0].r;
ok('dry run reports plan', r.dry_run && r.guides_archived === 1 && r.people_archived === 1 && r.sessions === 1 && r.new_term, JSON.stringify(r));
const wiz = (apply) => q(`select admin_start_semester('spring-2027','Spring 2027','2026-27','2027-01-11','2027-05-01', array['${benId}']::uuid[], array['dana@purdue.edu'], true, '[{"label":"January 18th","held_on":"2027-01-18"}]'::jsonb, '[{"email":"bob@purdue.edu","role":"Training Committee"}]'::jsonb, '[{"name":"Eve E","email":"eve@purdue.edu","role":"Recruitment Committee"}]'::jsonb, '[{"first":"Fin","last":"Seven","email":"fin@purdue.edu"}]'::jsonb, ${apply}) r`).then(x => x[0].r);
const pv = await wiz(false);
ok('preview counts hires, role changes and new guides', pv.new_people === 1 && pv.role_changes === 1 && pv.new_guides === 1 && pv.guides_carried >= 4, JSON.stringify(pv));
ok('preview rolled everything back', (await q(`select 1 from member_roster where email='eve@purdue.edu'`)).length === 0 && (await q(`select 1 from guides where first_name='Fin'`)).length === 0 && (await q(`select 1 from terms where id='spring-2027'`)).length === 0 && (await q(`select role from members where id='${B}'`))[0].role === 'Recruitment Committee');
ok('dry run changes nothing', (await q(`select 1 from terms where id='spring-2027'`)).length === 0 && (await q(`select 1 from guides where id='${benId}' and active`)).length === 1);
ok('end before start refused', /end date/.test(await fails(`select admin_start_semester('spring-2027','S','y','2027-05-01','2027-01-01')`) || ''));
ok('bad id refused', /fall-2027/.test(await fails(`select admin_start_semester('winter','S','y','2027-01-01','2027-05-01')`) || ''));
ok('cannot drop yourself', /own access/.test(await fails(`select admin_start_semester('spring-2027','S','y','2027-01-01','2027-05-01', '{}', array['alice@purdue.edu'])`) || ''));
r = await wiz(true);
ok('apply: hire invited, role changed, new guide on tracker', (await q(`select 1 from member_roster where email='eve@purdue.edu'`)).length === 1 && (await q(`select role from members where id='${B}'`))[0].role === 'Training Committee' && (await q(`select 1 from evals e join guides g on g.id=e.guide_id where g.first_name='Fin' and e.term_id='spring-2027'`)).length === 1);
ok('apply: one current term', (await q(`select id from terms where is_current`)).map(x => x.id).join() === 'spring-2027');
ok('apply: dates saved', (await q(`select starts_on::text s from terms where id='spring-2027'`))[0].s === '2027-01-11');
ok('apply: leaving guide archived, history kept', (await q(`select active from guides where id='${benId}'`))[0].active === false && (await q(`select 1 from evals where guide_id='${benId}' and term_id='fall-2026'`)).length === 1);
ok('apply: carried guides promoted', (await q(`select e.priority from evals e join guides g on g.id=e.guide_id where g.first_name='Ann' and term_id='spring-2027'`))[0].priority === 'Second Priority');
ok('apply: leaving guide not on new tracker', (await q(`select 1 from evals where guide_id='${benId}' and term_id='spring-2027'`)).length === 0);
ok('dana archived', (await q(`select active from members where lower(email)='dana@purdue.edu'`)).every(x => x.active === false));
ok('apply: training session seeded per guide', (await q(`select count(*)::int n from training_attendance a join training_sessions s on s.id=a.session_id where s.term_id='spring-2027'`))[0].n === (await q(`select count(*)::int n from guides where active`))[0].n);
ok('starting it twice is refused', /already been started|already the current/.test(await fails(`select admin_start_semester('spring-2027','Spring 2027','y','2027-01-11','2027-05-01')`) || ''));
ok('old term history untouched', (await q(`select count(*)::int n from evals where term_id='fall-2026'`))[0].n === 5);

console.log('\nsettings / health / audit');
ok('secret-looking setting refused', /Secrets/.test(await fails(`select admin_set_setting('mail_api_key','"x"'::jsonb)`) || ''));
ok('setting saved', (await q(`select admin_set_setting('contact.email','"a@purdue.edu"'::jsonb) r`))[0].r.result === 'saved');
ok('reminders validate', /valid "from"/.test(await fails(`select admin_set_reminders(true, 24, '${A}', 'bad', 'https://x.y')`) || ''));
ok('reminders save', (await q(`select admin_set_reminders(true, 12, '${A}', 'hub@purdue.edu', 'https://hub.example.edu/') r`))[0].r.result === 'saved');
const h = (await q(`select admin_health() h`))[0].h;
ok('health reports', h.current_terms === 1 && h.admins >= 1 && h.reminders_enabled === true, JSON.stringify(h));
const audit = await q(`select action from admin_audit`);
ok('audit recorded the actions', ['person.added', 'person.archived', 'guide.added', 'semester.started', 'setting.changed'].every(a => audit.some(x => x.action === a)), audit.map(a => a.action).join());
ok('audit never holds a secret value', !JSON.stringify(await q(`select * from admin_audit`)).includes('mail_api_key'));
await as(B);
ok('non-admin cannot write settings directly', /permission|policy|administrator/i.test(await fails(`insert into app_settings(key,value) values ('x','1')`) || ''));
ok('non-admin cannot forge audit rows', /permission|policy/i.test(await fails(`insert into admin_audit(action) values ('x')`) || ''));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
