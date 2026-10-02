// Tests for supabase/19-data-management.sql against an in-memory Postgres.
// Covers: permissions, source connection and replacement, previewed and repeated
// syncs (no duplicates), fuzzy matches never auto-linked, remembered matches,
// reconciliation actions, field ownership and visible overrides, major
// normalisation, semester participation, evaluation priority and need, and
// evaluator assignment with per-item validation, plus audit coverage.
//   npm install @electric-sql/pglite ; node supabase/tests/data-management.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  -> ' + d)); };
const as = async id => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id || ''}',false);` + (id ? 'set role authenticated;' : '')); };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const fails = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
const j = o => JSON.stringify(o);

await db.exec(`
 create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated, anon;`);
await db.exec(fs.readFileSync(R + '01-schema.sql', 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`
 alter table members add column role text;
 create table roles (name text primary key, is_admin boolean default false, in_training boolean default false, in_recruitment boolean default false, sort_order int default 0);
 create table member_roster (email text primary key, full_name text not null, role text);
 create function is_member() returns boolean language sql stable security definer as $$ select exists(select 1 from members where id=auth.uid() and active) $$;
 create function is_codirector() returns boolean language sql stable security definer as $$ select exists(select 1 from members m join roles r on r.name=m.role where m.id=auth.uid() and m.active and r.is_admin) $$;
 create function in_training() returns boolean language sql stable as $$ select true $$;
 create table tour_reminder_settings (singleton boolean primary key default true, enabled boolean default false, owner_id uuid, from_email text, hub_url text, hours_before int default 24);
 insert into tour_reminder_settings(singleton) values (true);`);
await db.exec(fs.readFileSync(R + '02-views.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '13-training.sql', 'utf8').replace(/create policy[\s\S]*?;\n/g, '').replace(/drop policy[^;]*;/g, '').replace(/alter table training_\w+\s+enable row level security;/g, ''));
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`
 insert into roles values ('Codirector',true,true,true,1),('Training Committee',false,true,false,2),('Tour Guide',false,false,false,3);
 insert into auth.users(id,email) values ('${A}','alice@purdue.edu'),('${B}','bob@purdue.edu'),('${C}','cat@purdue.edu');
 insert into members(id,full_name,email,role,active) values ('${A}','Alice A','alice@purdue.edu','Codirector',true),('${B}','Bob B','bob@purdue.edu','Training Committee',true),('${C}','Cat C','cat@purdue.edu','Tour Guide',true);
 insert into terms(id,label,is_current) values ('fall-2026','Fall 2026',true);
 insert into guides(first_name,last_name) values ('Logann','Tuttle'),('Ben','Two'),('Cy','Three'),('Dee','Four'),('Ann','Old');
 insert into evals(term_id,guide_id,priority) select 'fall-2026', id, case first_name when 'Logann' then 'First Priority to Eval' when 'Ben' then 'Third Priority' when 'Cy' then 'No Need to Eval' else 'Second Priority' end from guides;`);
await db.exec(fs.readFileSync(R + '18-admin-operations.sql', 'utf8'));
await db.exec("update guides set email='logann@purdue.edu' where first_name='Logann'");
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
const mig = fs.readFileSync(R + '19-data-management.sql', 'utf8');
await db.exec(mig); ok('migration 19 runs', true);
await db.exec(mig); ok('migration 19 is re-runnable', true);
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
const id = async n => (await q(`select id from guides where first_name=$1`, [n]))[0].id;
const LOG = await id('Logann'), BEN = await id('Ben'), CY = await id('Cy'), DEE = await id('Dee'), ANN = await id('Ann');

ok('existing evals became semester participation', (await q(`select count(*)::int n from guide_terms`))[0].n === 5);
ok('tracker view still works and has guide_active', (await q(`select count(*)::int n from eval_roster where guide_active`))[0].n === 5);

console.log('\npermissions');
await as(B);
for (const sql of [`select admin_save_source(null,'majors','x','${'a'.repeat(30)}',null,null,null,'table','{"name":"A"}')`, `select admin_data_status()`, `select admin_set_field_owner('major','hub')`,
  `select admin_update_guide('${LOG}','{"notes":"x"}')`, `select admin_set_eval_priority(array['${LOG}']::uuid[],'Third Priority')`, `select admin_assign_evaluations('[{}]')`])
  ok('non-admin refused: ' + sql.slice(7, 40), /administrator/.test(await fails(sql) || ''));
ok('member cannot read issues or mappings', (await q(`select * from sync_issues`)).length === 0 && (await q(`select * from external_identity_mappings`)).length === 0);
await as(A);

console.log('\nsources');
const SHEET = 'A'.repeat(44);
ok('bad sheet id refused', /Google Sheets/.test(await fails(`select admin_save_source(null,'majors','x','nope',null,null,null,'table','{"name":"A"}')`) || ''));
ok('table source needs a person column', /Choose which column/.test(await fails(`select admin_save_source(null,'majors','x','${SHEET}',null,null,null,'table','{"major":"M"}')`) || ''));
ok('schedule table needs a date column', /tour date/.test(await fails(`select admin_save_source(null,'tour_schedule','x','${SHEET}',null,null,null,'table','{"name":"G"}')`) || ''));
const MAJ = (await q(`select admin_save_source(null,'majors','Tour Guides by Major','${SHEET}','Tour Guides by Major','Sheet1','0','table','{"first":"First Name","last":"Last Name","major":"Major(s)","email":"Email"}') id`))[0].id;
await q(`select admin_activate_source('${MAJ}')`);
ok('source activated', (await q(`select active from external_sources where id='${MAJ}'`))[0].active === true);

console.log('\nsync: majors');
await q(`select admin_save_major_mapping('ECE','Electrical and Computer Engineering')`);
const rows1 = [
  { key: 'logann@purdue.edu', identity: 'name:logann tuttle', name: 'Logann Tuttle', email: 'logann@purdue.edu', payload: { major: 'Data Science, Comp Sci (Honors), ECE' }, guide_id: LOG, basis: 'email' },
  { key: 'name:logan tuttle', identity: 'name:logan tuttle', name: 'Logan Tuttle', payload: { major: 'Data Science' }, guide_id: LOG, basis: 'fuzzy', candidates: [{ id: LOG, score: .9 }] },
  { key: 'name:jordan smith', identity: 'name:jordan smith', name: 'Jordan Smith', email: 'jsmith@purdue.edu', payload: { first: 'Jordan', last: 'Smith', major: 'Mechanical Engineering' } },
  { key: 'name:ben two', identity: 'name:ben two', name: 'Ben Two', payload: { major: 'Biology' }, guide_id: BEN, basis: 'exact' }];
const prev = (await q(`select admin_sync_source($1,$2::jsonb,false) r`, [MAJ, j(rows1)]))[0].r;
ok('preview counts', prev.dry_run && prev.rows === 4 && prev.needs_review === 2 && prev.new_people === 2 && prev.major_updates === 2, j(prev));
ok('preview wrote nothing', (await q(`select count(*)::int n from source_records`))[0].n === 0 && (await q(`select count(*)::int n from sync_issues`))[0].n === 0 && (await q(`select major from guides where id='${LOG}'`))[0].major === null);
const run1 = (await q(`select admin_sync_source($1,$2::jsonb,true) r`, [MAJ, j(rows1)]))[0].r;
ok('apply matches and updates', run1.matched_auto === 2 && run1.major_updates === 2, j(run1));
ok('major normalised through the mapping list', (await q(`select major from guides where id='${LOG}'`))[0].major === 'Data Science; Comp Sci (Honors); Electrical and Computer Engineering');
ok('commas inside brackets do not split', (await q(`select hub_normalize_majors('Aerospace Engineering (Design, Systems), Communication') m`))[0].m === 'Aerospace Engineering (Design, Systems); Communication');
ok('a fuzzy match is NEVER stored as a link', (await q(`select guide_id, match_basis from source_records where external_key='name:logan tuttle'`))[0].guide_id === null);
ok('unmatched people become issues, suggestions kept', (await q(`select count(*)::int n from sync_issues where kind='unmatched_person' and status='open'`))[0].n === 2 && (await q(`select suggested from sync_issues where external_name='Logan Tuttle'`))[0].suggested[0].id === LOG);
ok('guides missing from the source are flagged, not removed', (await q(`select count(*)::int n from sync_issues where kind='roster_missing_in_source'`))[0].n === 3 && (await q(`select count(*)::int n from guides where active`))[0].n === 5);

console.log('\nduplicate prevention');
const c1 = (await q(`select (select count(*) from source_records)::int r, (select count(*) from sync_issues)::int i, (select count(*) from external_identity_mappings)::int m`))[0];
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j(rows1)]); await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j(rows1)]);
const c2 = (await q(`select (select count(*) from source_records)::int r, (select count(*) from sync_issues)::int i, (select count(*) from external_identity_mappings)::int m`))[0];
ok('repeating a sync adds no records, issues or mappings', j(c1) === j(c2), j(c1) + ' vs ' + j(c2));
ok('syncs are recorded', (await q(`select count(*)::int n from sync_runs`))[0].n === 3);

console.log('\nreconciliation');
const iss = id => q(`select id from sync_issues where external_name=$1 and kind='unmatched_person'`, [id]).then(r => r[0].id);
const logan = await iss('Logan Tuttle');
ok('choose a person (confirm match)', (await q(`select admin_resolve_issue($1,'confirm_match',$2) r`, [logan, LOG]))[0].r.result === 'matched');
ok('the match is remembered, and linked', (await q(`select guide_id, match_basis from source_records where external_key='name:logan tuttle'`))[0].guide_id === LOG && (await q(`select confirmed from external_identity_mappings where external_key='name:logan tuttle'`))[0].confirmed);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j(rows1)]);
ok('next sync: remembered, no new question', (await q(`select count(*)::int n from sync_issues where external_name='Logan Tuttle' and status='open'`))[0].n === 0 && (await q(`select match_basis from source_records where external_key='name:logan tuttle'`))[0].match_basis === 'saved');
const jordan = await iss('Jordan Smith');
const cg = (await q(`select admin_resolve_issue($1,'create_guide') r`, [jordan]))[0].r;
ok('create a Tour Guide from the spreadsheet row', cg.result === 'created' && (await q(`select major, email from guides where id=$1`, [cg.guide_id]))[0].major === 'Mechanical Engineering' && (await q(`select email from guides where id=$1`, [cg.guide_id]))[0].email === 'jsmith@purdue.edu');
ok('created guide is on the evaluation roster by default', (await q(`select count(*)::int n from evals where guide_id=$1`, [cg.guide_id]))[0].n === 1);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j(rows1.map(r => r.name === 'Jordan Smith' ? { ...r, guide_id: cg.guide_id, basis: 'email' } : r))]);
ok('no duplicate person after another sync', (await q(`select count(*)::int n from guides where first_name='Jordan'`))[0].n === 1);
const miss = (await q(`select id from sync_issues where kind='roster_missing_in_source' and guide_id=$1`, [CY]))[0].id;
await q(`select admin_resolve_issue($1,'mark_inactive')`, [miss]);
ok('mark inactive = inactive THIS semester, person and history intact', (await q(`select active from guide_terms where guide_id=$1 and term_id='fall-2026'`, [CY]))[0].active === false && (await q(`select active from guides where id=$1`, [CY]))[0].active === true && (await q(`select count(*)::int n from eval_roster where guide_id=$1 and guide_active`, [CY]))[0].n === 0);
const keep = (await q(`select id from sync_issues where kind='roster_missing_in_source' and guide_id=$1`, [DEE]))[0].id;
await q(`select admin_resolve_issue($1,'keep_active')`, [keep]);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j(rows1)]);
ok('"keep active" is not asked again this semester', (await q(`select count(*)::int n from sync_issues where kind='roster_missing_in_source' and guide_id=$1 and status='open'`, [DEE]))[0].n === 0);
ok('a bad action is refused', /Unknown action|does not apply/.test(await fails(`select admin_resolve_issue($1,'explode')`, [(await q(`select id from sync_issues where status='open' limit 1`))[0].id]) || ''));

console.log('\nownership, conflicts, overrides');
await q(`select admin_set_field_owner('major','hub')`);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j([{ ...rows1[3], payload: { major: 'Chemistry' } }])]);
ok('hub-owned field: the spreadsheet does not overwrite, it raises a conflict', (await q(`select major from guides where id=$1`, [BEN]))[0].major === 'Biology' && (await q(`select count(*)::int n from sync_issues where kind='conflicting_major' and guide_id=$1 and status='open'`, [BEN]))[0].n === 1);
const cm = (await q(`select id from sync_issues where kind='conflicting_major' and guide_id=$1`, [BEN]))[0].id;
await q(`select admin_resolve_issue($1,'use_codirector')`, [cm]);
ok('use Codirector value = visible manual override remembering the source value', j((await q(`select value, source_value from guide_overrides where guide_id=$1 and field='major'`, [BEN]))[0]) === j({ value: 'Biology', source_value: 'Chemistry' }));
await q(`select admin_set_field_owner('major','majors')`);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [MAJ, j([{ ...rows1[3], payload: { major: 'Physics' } }])]);
ok('an override survives later syncs (source value kept up to date)', (await q(`select major from guides where id=$1`, [BEN]))[0].major === 'Biology' && (await q(`select source_value from guide_overrides where guide_id=$1`, [BEN]))[0].source_value === 'Physics');
await q(`select admin_clear_override($1,'major')`, [BEN]);
ok('"return to source value"', (await q(`select major from guides where id=$1`, [BEN]))[0].major === 'Physics' && (await q(`select count(*)::int n from guide_overrides where guide_id=$1`, [BEN]))[0].n === 0);
await q(`select admin_update_guide($1,'{"major":"Mathematics"}'::jsonb)`, [BEN]);
ok('editing a source-owned field by hand creates a visible override', (await q(`select source_value from guide_overrides where guide_id=$1 and field='major'`, [BEN]))[0].source_value === 'Physics');
ok('hub-owned eval priority cannot be given to a spreadsheet', /always set in the Hub/.test(await fails(`select admin_set_field_owner('eval_priority','majors')`) || ''));

console.log('\nTour Guide record');
ok('duplicate name refused', /already has that name/.test(await fails(`select admin_update_guide($1,'{"first_name":"Cy","last_name":"Three"}'::jsonb)`, [BEN]) || ''));
ok('unknown field refused', /cannot be changed/.test(await fails(`select admin_update_guide($1,'{"active":false}'::jsonb)`, [BEN]) || ''));
ok('bad email refused', /not an email/.test(await fails(`select admin_update_guide($1,'{"email":"nope"}'::jsonb)`, [BEN]) || ''));
await q(`select admin_update_guide($1,$2::jsonb)`, [BEN, j({ is_leadership: true, evaluator_eligible: false, notes: 'Leads fall tours', member_id: C })]);
ok('leadership, evaluator status, notes, linked account saved', j((await q(`select is_leadership, evaluator_eligible, notes, member_id from guides where id=$1`, [BEN]))[0]) === j({ is_leadership: true, evaluator_eligible: false, notes: 'Leads fall tours', member_id: C }));
ok('one account per Tour Guide', /already linked/.test(await fails(`select admin_update_guide($1,$2::jsonb)`, [DEE, j({ member_id: C })]) || ''));

console.log('\nschedule source');
const SCHED = (await q(`select admin_save_source(null,'tour_schedule','Spring schedule','${'B'.repeat(44)}','Spring','January','1','table','{"name":"Guide","date":"Date"}') id`))[0].id;
await q(`select admin_activate_source('${SCHED}')`);
ok('one active source per kind; both kinds active together', (await q(`select count(*)::int n from external_sources where active`))[0].n === 2);
const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const srows = [
  { key: `${d(3)}|10-11|alli s.`, identity: 'name:alli s.', name: 'Alli S.', occurred_on: d(3), slot: '10-11', start_time: '10:00', payload: {} },
  { key: `${d(5)}|10-11|alli s.`, identity: 'name:alli s.', name: 'Alli S.', occurred_on: d(5), slot: '10-11', start_time: '10:00', payload: {} },
  { key: `${d(4)}|2-3|logann tuttle`, identity: 'name:logann tuttle', name: 'Logann Tuttle', occurred_on: d(4), slot: '2-3', start_time: '14:00', payload: {}, guide_id: LOG, basis: 'exact' }];
const sp = (await q(`select admin_sync_source($1,$2::jsonb,true) r`, [SCHED, j(srows)]))[0].r;
ok('schedule rows stored; one question per PERSON not per tour', sp.rows === 3 && (await q(`select count(*)::int n from sync_issues where kind='schedule_unmatched' and status='open'`))[0].n === 1, j(sp));
const alli = (await q(`select id from sync_issues where kind='schedule_unmatched'`))[0].id;
await q(`select admin_resolve_issue($1,'choose_person',$2)`, [alli, DEE]);
ok('confirming links every one of that person\'s tours', (await q(`select count(*)::int n from source_records where source_kind='tour_schedule' and guide_id=$1`, [DEE]))[0].n === 2);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [SCHED, j(srows)]);
ok('re-syncing the schedule: no duplicate rows, alias remembered', (await q(`select count(*)::int n from source_records where source_kind='tour_schedule'`))[0].n === 3 && (await q(`select count(*)::int n from source_records where guide_id=$1`, [DEE]))[0].n === 2);
await q(`select admin_sync_source($1,$2::jsonb,true)`, [SCHED, j(srows.slice(0, 2))]);
ok('a row dropped from the sheet stops counting as current but is kept', (await q(`select active from source_records where external_key like '%logann tuttle'`))[0].active === false);
await as(B);
ok('any member can read schedule rows (they see the schedule anyway)', (await q(`select count(*)::int n from source_records`))[0].n >= 2);
ok('but not other sources\' rows', (await q(`select count(*)::int n from source_records where source_kind='majors'`))[0].n === 0);
await as(A);
const M2 = (await q(`select admin_save_source(null,'majors','New majors sheet','${'C'.repeat(44)}',null,null,null,'table','{"name":"Student"}') id`))[0].id;
await q(`select admin_activate_source('${M2}')`);
ok('replacing a source retires the old sheet\'s rows without deleting them', (await q(`select count(*)::int n from source_records where source_id='${MAJ}' and not active`))[0].n >= 3 && (await q(`select count(*)::int n from source_records where source_id='${MAJ}'`))[0].n >= 3 && !(await q(`select active from external_sources where id='${MAJ}'`))[0].active);

console.log('\nevaluation roster');
ok('priority change (bulk)', (await q(`select admin_set_eval_priority(array['${BEN}','${DEE}']::uuid[],'First Priority to Eval') r`))[0].r.changed === 2);
ok('unknown priority refused', /no priority called/.test(await fails(`select admin_set_eval_priority(array['${BEN}']::uuid[],'Urgent!!')`) || ''));
ok('needs evaluation: switch off', (await q(`select admin_set_eval_need(array['${BEN}']::uuid[],false) r`))[0].r.changed === 1 && (await q(`select p.needs_eval from evals e join priorities p on p.name=e.priority where guide_id='${BEN}'`))[0].needs_eval === false);
ok('needs evaluation: switch back on to a middle tier', (await q(`select admin_set_eval_need(array['${BEN}']::uuid[],true) r`))[0].r.changed === 1 && (await q(`select p.needs_eval from evals e join priorities p on p.name=e.priority where guide_id='${BEN}'`))[0].needs_eval === true);
ok('add people missing from the roster', (await q(`select admin_add_to_eval_roster(array['${ANN}']::uuid[]) r`))[0].r.added === 0);
await q(`delete from evals where guide_id='${ANN}'`);
ok('add people missing from the roster (really missing)', (await q(`select admin_add_to_eval_roster(array['${ANN}']::uuid[],'Fifth Priority') r`))[0].r.added === 1);
const ev = g => q(`select id from evals where guide_id=$1`, [g]).then(r => r[0].id);
const dt = d(6);
const asg = (await q(`select admin_assign_evaluations($1::jsonb) r`, [j([
  { eval_id: await ev(DEE), evaluator_id: B, date: dt, time: '10:00' },
  { eval_id: await ev(LOG), evaluator_id: B, date: dt, time: '10:00' },
  { eval_id: await ev(CY), evaluator_id: B, date: dt, time: '12:00' },
  { eval_id: await ev(ANN), evaluator_id: C, date: dt, time: '11:00' },
  { eval_id: await ev(BEN), evaluator_id: B, date: '2020-01-01', time: '09:00' }])]))[0].r;
ok('assign: valid saved, bad ones explained, none blocks the rest', asg.assigned === 1 && asg.failed.length === 4, j(asg));
const reasons = asg.failed.map(f => f.reason).join(' | ');
ok('reasons: double-booking, not evaluating, not on team, past date', /already has an evaluation at that time/.test(reasons) && /not active this semester/.test(reasons) && /not on the evaluation team/.test(reasons) && /already passed/.test(reasons), reasons);
ok('assignment recorded on the evaluation', (await q(`select evaluator_id, tour_date::text d from evals where guide_id=$1`, [DEE]))[0].evaluator_id === B);
ok('already-claimed refused', /Already claimed/.test((await q(`select admin_assign_evaluations($1::jsonb) r`, [j([{ eval_id: await ev(DEE), evaluator_id: B, date: dt, time: '13:00' }])]))[0].r.failed[0]?.reason || ''));
await q(`select admin_set_evaluator_available('${B}', false)`);
ok('evaluator can be paused without changing their role', (await q(`select evaluator_available from members where id='${B}'`))[0].evaluator_available === false);

console.log('\nsemester participation');
await q(`select admin_set_guide_term(array['${LOG}']::uuid[],'fall-2026',false)`);
ok('inactive this semester hides them from the tracker, not from the roster', (await q(`select count(*)::int n from eval_roster where guide_id='${LOG}' and guide_active`))[0].n === 0 && (await q(`select active from guides where id='${LOG}'`))[0].active === true);
ok('and they cannot be assigned an evaluation', /not active this semester/.test((await q(`select admin_assign_evaluations($1::jsonb) r`, [j([{ eval_id: await ev(LOG), evaluator_id: A, date: dt, time: '09:00' }])]))[0].r.failed[0]?.reason || ''));
await q(`select admin_set_guide_term(array['${LOG}']::uuid[],'fall-2026',true)`);

console.log('\nstatus, health, audit, majors');
const st = (await q(`select admin_data_status() s`))[0].s;
ok('status summarises the whole picture', st.active_guides > 0 && st.sources.length === 2 && st.schedule_records >= 2 && typeof st.issues === 'object', j(st).slice(0, 220));
ok('health reports open issues and connected sources', (await q(`select admin_health() h`))[0].h.sources_connected === 2);
ok('renormalising majors after the list changes', (await q(`select admin_save_major_mapping('Mathematics','Mathematics (B.S.)') x`)).length === 1 && (await q(`select admin_renormalize_majors() r`))[0].r.updated >= 1);
const actions = (await q(`select distinct action from admin_audit`)).map(r => r.action);
ok('every kind of change is audited', ['source.saved', 'source.activated', 'source.synced', 'identity.confirmed', 'guide.edited', 'evalpriority.changed', 'evaluation.assigned', 'ownership.changed', 'major.mapped', 'guide.inactive_this_term'].every(a => actions.includes(a)), actions.join());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
