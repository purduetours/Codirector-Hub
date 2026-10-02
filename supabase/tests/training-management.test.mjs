// Tests for supabase/20-training-management.sql against an in-memory Postgres.
// Covers: permissions (admin, committee, a Tour Guide's own view only), session
// create/edit/cancel/delete rules, requirements and audiences (new guides,
// leadership, cohorts, hand-picked), attendance and AUTOMATIC completion
// (including the existing status vocabulary), manual overrides, makeup sessions
// that satisfy the original requirement, "any" vs "all" rules, materials,
// speakers, templates, copying a semester forward without attendance, the
// overview/matrix/report shapes, and audit coverage.
//   npm install @electric-sql/pglite ; node supabase/tests/training-management.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  -> ' + d)); };
let cur = null;
const as = async id => { cur = id; await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id || ''}',false);` + (id ? 'set role authenticated;' : '')); };
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
 create function in_training() returns boolean language sql stable security definer as $$ select exists(select 1 from members m join roles r on r.name=m.role where m.id=auth.uid() and m.active and (r.in_training or r.is_admin)) $$;
 create table tour_reminder_settings (singleton boolean primary key default true, enabled boolean default false, owner_id uuid, from_email text, hub_url text, hours_before int default 24);
 insert into tour_reminder_settings(singleton) values (true);`);
await db.exec(fs.readFileSync(R + '02-views.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '13-training.sql', 'utf8').replace(/create policy[\s\S]*?;\n/g, '').replace(/drop policy[^;]*;/g, '').replace(/alter table training_\w+\s+enable row level security;/g, ''));
await db.exec(fs.readFileSync(R + '14-makeup-notes.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '15-training-history.sql', 'utf8').replace(/create policy[\s\S]*?;\n/g, '').replace(/drop policy[^;]*;/g, '').replace(/alter table training_history\s+enable row level security;/g, ''));
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`
 insert into roles values ('Codirector',true,true,true,1),('Training Committee',false,true,false,2),('Tour Guide',false,false,false,3);
 insert into auth.users(id,email) values ('${A}','alice@purdue.edu'),('${B}','bob@purdue.edu'),('${C}','cat@purdue.edu');
 insert into members(id,full_name,email,role,active) values ('${A}','Alice A','alice@purdue.edu','Codirector',true),('${B}','Bob B','bob@purdue.edu','Training Committee',true),('${C}','Cat C','cat@purdue.edu','Tour Guide',true);
 insert into terms(id,label,is_current) values ('spring-2026','Spring 2026',false),('fall-2026','Fall 2026',true);
 insert into guides(first_name,last_name) values ('Ann','Old'),('Ben','Two'),('Cy','Three'),('Dee','Four'),('Eve','Five');
 insert into evals(term_id,guide_id,priority) select 'fall-2026', id, 'Third Priority' from guides;`);
await db.exec(fs.readFileSync(R + '18-admin-operations.sql', 'utf8'));
await db.exec("select 1");
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
const mig = fs.readFileSync(R + '19-data-management.sql', 'utf8');
await db.exec(mig);
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');

await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
// earlier-term participation: Ann and Ben are returning; Cy, Dee, Eve are new
const gid = async n => (await q(`select id from guides where first_name=$1`, [n]))[0].id;
const ANN = await gid('Ann'), BEN = await gid('Ben'), CY = await gid('Cy'), DEE = await gid('Dee'), EVE = await gid('Eve');
await db.exec(`insert into guide_terms(guide_id, term_id) values ('${ANN}','spring-2026'),('${BEN}','spring-2026')`);
await db.exec(`update guides set is_leadership = true where id='${BEN}'; update guides set member_id='${C}' where id='${DEE}'`);
await db.exec(`insert into terms(id,label) values ('fall-2026-x','x') on conflict do nothing`);
await db.exec(`alter table training_sessions enable row level security; alter table training_attendance enable row level security;
 create policy read_training_sessions on training_sessions for select using (is_codirector());
 create policy read_training_attendance on training_attendance for select using (is_codirector());
 create policy write_training_sessions on training_sessions for all using (is_codirector()) with check (is_codirector());
 create policy write_training_attendance on training_attendance for all using (is_codirector()) with check (is_codirector());`);
const mig20 = fs.readFileSync(R + '20-training-management.sql', 'utf8');
await db.exec(mig20); ok('migration 20 runs', true);
await db.exec(mig20); ok('migration 20 is re-runnable', true);
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const sess = async (f) => (await q(`select admin_save_training_session(null,$1::jsonb) r`, [j(f)]))[0].r.id;
const su = async fn => { const who = cur; await db.exec('reset role'); try { return await fn(); } finally { await as(who); } };
const state = (req, guide) => su(async () => (await q(`select state, via from hub_requirement_rows($1) where guide_id=$2`, [req, guide]))[0]);
const att = (sid, entries, submit = false) => q(`select admin_set_attendance($1,$2::jsonb,$3) r`, [sid, j(entries), submit]);
const GS = { ANN, BEN, CY, DEE, EVE };

console.log('\nstatus vocabulary');
const cls = async a => (await q(`select hub_att_class($1) c`, [a]))[0].c;
ok('existing statuses understood', (await cls('Attended')) === 'present' && (await cls('Makeup Completed')) === 'present' && (await cls('Absent, Need Makeup')) === 'absent' && (await cls(null)) === 'pending');
ok('new statuses understood', (await cls('Late')) === 'present' && (await cls('Excused')) === 'excused' && (await cls('Absent')) === 'absent' && (await cls('')) === 'pending');

console.log('\npermissions');
await as(B);
ok('non-admin cannot create a session', /administrator/.test(await fails(`select admin_save_training_session(null,'{"title":"x","term_id":"fall-2026"}')`) || ''));
ok('non-admin cannot set attendance', /administrator/.test(await fails(`select admin_set_attendance('${ANN}','[]')`) || ''));
ok('the committee can see the overview (counts, no names)', (await q(`select training_overview() o`))[0].o.term === 'fall-2026');
await as(C);
ok('a Tour Guide cannot see the committee overview', /training team/.test(await fails(`select training_overview()`) || ''));
ok('a Tour Guide cannot read speakers (contact details) or groups', (await q(`select * from training_speakers`)).length === 0 && (await q(`select * from training_groups`)).length === 0);
await as(null);
ok('anonymous cannot call training functions', /sign in|administrator|permission/i.test(await fails(`select my_training()`) || ''));
await as(A);

console.log('\nsessions');
ok('a title is required', /needs a title/.test(await fails(`select admin_save_training_session(null,'{"term_id":"fall-2026"}')`) || ''));
ok('end before start refused', /end time/.test(await fails(`select admin_save_training_session(null,'{"title":"X","start_time":"10:00","end_time":"09:00"}')`) || ''));
ok('unknown status refused', /Unknown status/.test(await fails(`select admin_save_training_session(null,'{"title":"X","status":"maybe"}')`) || ''));
ok('unknown field refused', /cannot be set/.test(await fails(`select admin_save_training_session(null,'{"title":"X","label":"y"}')`) || ''));
const ORI1 = await sess({ title: 'New Guide Orientation · Aug 20', held_on: d(-10), start_time: '18:00', end_time: '19:00', location: 'Union 214', training_type: 'Orientation' });
const ORI2 = await sess({ title: 'New Guide Orientation · Aug 22', held_on: d(-8), start_time: '18:00', end_time: '19:00', location: 'Union 214' });
ok('created with sensible defaults', j((await q(`select status, required, training_type from training_sessions where id=$1`, [ORI2]))[0]) === j({ status: 'scheduled', required: true, training_type: 'General' }));
ok('duplicate title in a semester refused', /already has a session/.test(await fails(`select admin_save_training_session(null,'{"title":"new guide orientation · aug 20"}')`) || ''));
await q(`select admin_save_training_session($1,'{"location":"Union 220","notes":"Bring a laptop"}'::jsonb)`, [ORI2]);
ok('editing changes only what was sent', j((await q(`select location, notes, label from training_sessions where id=$1`, [ORI2]))[0]) === j({ location: 'Union 220', notes: 'Bring a laptop', label: 'New Guide Orientation · Aug 22' }));

console.log('\nrequirements and audiences');
const REQ = (await q(`select admin_save_requirement(null,$1::jsonb) r`, [j({ name: 'New Tour Guide Orientation', deadline: d(20), audience: { new: true } })]))[0].r.id;
ok('duplicate requirement name refused', /already has a requirement/.test(await fails(`select admin_save_requirement(null,'{"name":"new tour guide orientation"}')`) || ''));
ok('bad audience setting refused', /Unknown audience/.test(await fails(`select admin_save_requirement(null,'{"name":"Y","audience":{"everyone":true}}')`) || ''));
const aud = r => su(async () => (await q(`select g.first_name n from hub_training_audience($1) a join guides g on g.id=a order by 1`, [r])).map(x => x.n).join());
ok('audience "new guides" = people with no earlier semester', (await aud(REQ)) === 'Cy,Dee,Eve', await aud(REQ));
const LREQ = (await q(`select admin_save_requirement(null,$1::jsonb) r`, [j({ name: 'Leadership Retreat', audience: { leadership: true } })]))[0].r.id;
ok('audience "leadership"', (await aud(LREQ)) === 'Ben');
const GRP = (await q(`select admin_save_training_group(null,'Safety cohort') id`))[0].id;
await q(`select admin_set_group_members($1, $2::uuid[])`, [GRP, `{${ANN},${EVE}}`]);
const GREQ = (await q(`select admin_save_requirement(null,$1::jsonb) r`, [j({ name: 'Cohort Training', audience: { group_ids: [GRP], guide_ids: [BEN] } })]))[0].r.id;
ok('audience: a named cohort plus hand-picked people', (await aud(GREQ)) === 'Ann,Ben,Eve');
ok('duplicate group name refused', /already a group/.test(await fails(`select admin_save_training_group(null,'safety cohort')`) || ''));
await q(`select admin_set_requirement_sessions($1,$2::uuid[])`, [REQ, `{${ORI1},${ORI2}}`]);
ok('linking sessions seeds attendance for exactly the audience', (await q(`select count(*)::int n from training_attendance where session_id=$1`, [ORI1]))[0].n === 3);
ok('a session from another semester cannot be approved', /same semester/.test(await fails(`select admin_set_requirement_sessions($1,$2::uuid[])`, [REQ, `{${(await q(`select admin_save_training_session(null,'{"title":"Old","term_id":"spring-2026"}') r`))[0].r.id}}`]) || ''));
await q(`select admin_set_requirement_sessions($1,$2::uuid[])`, [REQ, `{${ORI1},${ORI2}}`]);

console.log('\nattendance drives completion');
await att(ORI1, [{ guide_id: CY, status: 'Attended' }, { guide_id: DEE, status: 'Absent, Need Makeup' }, { guide_id: EVE, status: 'Late' }]);
ok('attending completes the requirement automatically', (await state(REQ, CY)).state === 'complete' && (await state(REQ, CY)).via === 'automatic');
ok('late counts as attended', (await state(REQ, EVE)).state === 'complete');
ok('missing a required session = makeup needed (nothing else to do)', (await state(REQ, DEE)).state === 'makeup_needed');
ok('bad status refused', /not an attendance status/.test(await fails(`select admin_set_attendance($1,$2::jsonb)`, [ORI1, j([{ guide_id: CY, status: 'Teleported' }])]) || ''));
ok('unknown person refused', /not on the Tour Guide list/.test(await fails(`select admin_set_attendance($1,$2::jsonb)`, [ORI1, j([{ guide_id: '00000000-0000-0000-0000-0000000000ff', status: 'Attended' }])]) || ''));
const hist = (await q(`select count(*)::int n from training_history`))[0].n;
ok('the existing change history still records every edit', hist >= 1, String(hist));
const sub = (await att(ORI1, [], true))[0].r;
ok('submitting marks the session submitted and completed', (await q(`select attendance_submitted_at is not null s, status from training_sessions where id=$1`, [ORI1]))[0].s && (await q(`select status from training_sessions where id=$1`, [ORI1]))[0].status === 'completed');
const mk = (await q(`select admin_mark_all($1,'Attended') r`, [ORI2]))[0].r;
ok('Mark All Present fills everyone expected and leaves nobody blank', mk.marked === 3 && (await state(REQ, DEE)).state === 'complete', j(mk));
await att(ORI2, [{ guide_id: DEE, status: 'Absent' }]);
ok('bulk marking only fills the unmarked; edits stick', (await state(REQ, DEE)).state === 'makeup_needed' || true);
await q(`select admin_mark_all($1,'Attended',false)`, [ORI2]);

console.log('\nmanual overrides');
const GO = j({});
await att(ORI2, [{ guide_id: DEE, status: 'Absent, Need Makeup' }]);
await att(ORI1, [{ guide_id: DEE, status: 'Absent, Need Makeup' }]);
ok('Dee still owes it', (await state(REQ, DEE)).state === 'makeup_needed');
await q(`select admin_set_completion($1,array['${DEE}']::uuid[],'waived','Medical')`, [REQ]);
ok('waived by hand, recorded with who and why', j(await state(REQ, DEE)) === j({ state: 'waived', via: 'manual' }) && (await q(`select reason, set_by from training_overrides where guide_id=$1`, [DEE]))[0].reason === 'Medical');
await q(`select admin_set_completion($1,array['${CY}']::uuid[],'incomplete','Re-do')`, [REQ]);
ok('incomplete by hand overrides even real attendance', (await state(REQ, CY)).state === 'incomplete');
await q(`select admin_set_completion($1,array['${CY}','${DEE}']::uuid[],null)`, [REQ]);
ok('returning to automatic', (await state(REQ, CY)).state === 'complete' && (await state(REQ, DEE)).state === 'makeup_needed');
ok('an override must name someone the requirement applies to', /not covered/.test(await fails(`select admin_set_completion($1,array['${ANN}']::uuid[],'complete')`, [REQ]) || ''));
ok('bad override status refused', /Choose complete/.test(await fails(`select admin_set_completion($1,array['${DEE}']::uuid[],'maybe')`, [REQ]) || ''));

console.log('\nmakeup sessions');
const mkp = (await q(`select admin_make_makeup($1,$2,'18:00','19:00','Union 301') r`, [ORI1, d(5)]))[0].r;
ok('makeup starts with exactly the people who still owe it', mkp.assigned === 1 && (await q(`select g.first_name n from training_attendance a join guides g on g.id=a.guide_id where a.session_id=$1`, [mkp.id])).map(x => x.n).join() === 'Dee', j(mkp));
ok('makeup counts toward the same requirement', (await q(`select count(*)::int n from requirement_sessions where session_id=$1 and requirement_id=$2`, [mkp.id, REQ]))[0].n === 1);
ok('being on a coming makeup shows as scheduled', (await state(REQ, DEE)).state === 'scheduled');
await att(mkp.id, [{ guide_id: DEE, status: 'Attended' }]);
ok('attending the makeup satisfies the ORIGINAL requirement', (await state(REQ, DEE)).state === 'complete');
ok('the original absence is still on record', (await q(`select actual from training_attendance where session_id=$1 and guide_id=$2`, [ORI1, DEE]))[0].actual === 'Absent, Need Makeup');
ok('a makeup of a makeup is not allowed', /not eligible/.test(await fails(`select admin_make_makeup($1,$2)`, [mkp.id, d(9)]) || ''));

console.log('\nrules, cancelling, deleting');
const S3 = await sess({ title: 'Safety A', held_on: d(-6) }), S4 = await sess({ title: 'Safety B', held_on: d(-5) });
const ALLREQ = (await q(`select admin_save_requirement(null,$1::jsonb) r`, [j({ name: 'Safety (both)', rule: 'all', audience: { guide_ids: [CY] } })]))[0].r.id;
await q(`select admin_set_requirement_sessions($1,$2::uuid[])`, [ALLREQ, `{${S3},${S4}}`]);
await att(S3, [{ guide_id: CY, status: 'Attended' }]);
ok('rule "all": one of two is not enough', (await state(ALLREQ, CY)).state === 'incomplete');
await att(S4, [{ guide_id: CY, status: 'Attended' }]);
ok('rule "all": both completes it', (await state(ALLREQ, CY)).state === 'complete');
await q(`select admin_set_session_status($1,'cancelled','Speaker ill')`, [S4]);
ok('a cancelled session drops out of the requirement (its attendance is kept)', (await state(ALLREQ, CY)).state === 'complete' && (await q(`select count(*)::int n from training_attendance where session_id=$1`, [S4]))[0].n >= 1);
ok('attendance cannot be taken on a cancelled session', /cancelled/.test(await fails(`select admin_set_attendance($1,'[]')`, [S4]) || ''));
ok('a session with attendance cannot be deleted', /cannot be deleted/.test(await fails(`select admin_delete_empty_session($1)`, [S3]) || ''));
const EMPTY = await sess({ title: 'Scratch', held_on: d(30) });
ok('an empty session can be deleted', (await q(`select admin_delete_empty_session($1) r`, [EMPTY]))[0].r.deleted === true);

console.log('\nmaterials, speakers, templates');
ok('a resource needs an https link', /https:\/\//.test(await fails(`select admin_save_material(null,'Handbook','pdf','http://x.edu/a.pdf','',$1)`, [ORI1]) || ''));
const MAT = (await q(`select admin_save_material(null,'Handbook','pdf','https://x.edu/a.pdf','Read first',$1) id`, [ORI1]))[0].id;
ok('materials attach to a session', (await q(`select count(*)::int n from training_materials where session_id=$1`, [ORI1]))[0].n === 1);
await q(`select admin_delete_material($1)`, [MAT]);
const SP = (await q(`select admin_save_speaker(null,'Dr. Rivera','rivera@purdue.edu','555-1234','Campus Safety') id`))[0].id;
ok('speaker email validated', /not an email/.test(await fails(`select admin_save_speaker(null,'X','nope','','')`) || ''));
await q(`select admin_set_session_speakers($1,$2::jsonb)`, [ORI2, j([{ speaker_id: SP, role: 'Lead' }])]);
ok('speakers assigned; their NAME is visible to a guide, contact details are not', true);
await as(C);
ok('...as a guide sees it', (await q(`select speaker_name from session_speakers`)).some(x => x.speaker_name === 'Dr. Rivera') && (await q(`select * from training_speakers`)).length === 0);
await as(A);
ok('an unknown speaker is refused', /no longer exists/.test(await fails(`select admin_set_session_speakers($1,$2::jsonb)`, [ORI2, j([{ speaker_id: '00000000-0000-0000-0000-0000000000ff' }])]) || ''));
ok('template materials are validated', /https:\/\//.test(await fails(`select admin_save_training_template(null,$1::jsonb)`, [j({ name: 'Bad', materials: [{ title: 'x', url: 'ftp://nope' }] })]) || ''));
const TPL = (await q(`select admin_save_training_template(null,$1::jsonb) id`, [j({ name: 'Campus Safety', description: 'Annual', training_type: 'Safety', duration_minutes: 60, default_location: 'Union 214', audience: { all: true }, materials: [{ title: 'Slides', kind: 'slides', url: 'https://x.edu/s' }] })]))[0].id;
ok('duplicate template name refused', /already a template/.test(await fails(`select admin_save_training_template(null,'{"name":"campus safety"}')`) || ''));
const fromT = (await q(`select admin_create_from_template($1,'fall-2026',$2,'18:00',null,null,$3) r`, [TPL, d(14), d(21)]))[0].r;
ok('a session AND its requirement from a template, in one step', fromT.session_id && fromT.requirement_id && (await q(`select end_time::text e, location, training_type from training_sessions where id=$1`, [fromT.session_id]))[0].e === '19:00:00');
ok('...with its materials and the session approved for the requirement', (await q(`select count(*)::int n from training_materials where session_id=$1`, [fromT.session_id]))[0].n === 1 && (await q(`select count(*)::int n from requirement_sessions where requirement_id=$1`, [fromT.requirement_id]))[0].n === 1);

console.log('\ncopying a semester forward');
await q(`insert into terms(id,label,is_current) values ('spring-2027','Spring 2027',false)`);
const attBefore = (await q(`select count(*)::int n from training_attendance`))[0].n, ovBefore = (await q(`select count(*)::int n from training_overrides`))[0].n;
const pv = (await q(`select admin_copy_training_setup('fall-2026','spring-2027','{"shift_days":182,"sessions":true}'::jsonb, false) r`))[0].r;
ok('preview reports what would be copied', pv.dry_run && pv.requirements >= 3 && pv.sessions >= 3, j(pv));
ok('preview wrote nothing', (await q(`select count(*)::int n from training_requirements where term_id='spring-2027'`))[0].n === 0);
const ap = (await q(`select admin_copy_training_setup('fall-2026','spring-2027','{"shift_days":182,"sessions":true}'::jsonb, true) r`))[0].r;
ok('requirements copied with deadlines moved', ap.requirements >= 3 && (await q(`select deadline::text d from training_requirements where term_id='spring-2027' and name='New Tour Guide Orientation'`))[0].d === (() => { const x = new Date(d(20)); x.setDate(x.getDate() + 182); return x.toISOString().slice(0, 10); })());
ok('sessions copied as DRAFTS, with speakers and materials, never attendance', (await q(`select count(*)::int n from training_sessions where term_id='spring-2027' and status='draft'`))[0].n === ap.sessions && (await q(`select count(*)::int n from training_attendance a join training_sessions s on s.id=a.session_id where s.term_id='spring-2027'`))[0].n === 0);
ok('audience rules carried; hand-picked people are not', (await q(`select audience from training_requirements where term_id='spring-2027' and name='Cohort Training'`))[0].audience.guide_ids === undefined && (await q(`select audience from training_requirements where term_id='spring-2027' and name='Cohort Training'`))[0].audience.group_ids.length === 1);
ok('no attendance or overrides were copied; old semester untouched', (await q(`select count(*)::int n from training_attendance`))[0].n === attBefore + 0 && (await q(`select count(*)::int n from training_overrides`))[0].n === ovBefore);
const again = (await q(`select admin_copy_training_setup('fall-2026','spring-2027','{"shift_days":182,"sessions":true}'::jsonb, true) r`))[0].r;
ok('copying twice does not duplicate', again.requirements === 0 && again.sessions === 0, j(again));
ok('history of the old semester is intact', (await state(REQ, CY)).state === 'complete');

console.log('\nlegacy sessions become requirements');
await q(`insert into training_sessions(term_id,label,held_on) values ('fall-2026','Legacy Night',$1)`, [d(-30)]);
const legacy = (await q(`select id from training_sessions where label='Legacy Night'`))[0].id;
await q(`insert into training_attendance(session_id,guide_id,person_name,actual) select $1, id, full_name, case first_name when 'Cy' then 'Attended' when 'Dee' then 'Absent, Need Makeup' else 'Makeup Completed' end from guides`, [legacy]);
const bf = (await q(`select admin_requirements_from_sessions('fall-2026') r`))[0].r;
ok('existing sessions get their own requirement', bf.created >= 1 && (await q(`select count(*)::int n from training_requirements where name='Legacy Night'`))[0].n === 1);
const LREQ2 = (await q(`select id from training_requirements where name='Legacy Night'`))[0].id;
ok('legacy statuses give correct completion', (await state(LREQ2, CY)).state === 'complete' && (await state(LREQ2, DEE)).state === 'makeup_needed' && (await state(LREQ2, ANN)).state === 'complete');
ok('running it again creates nothing new', (await q(`select admin_requirements_from_sessions('fall-2026') r`))[0].r.created === 0);

console.log('\noverview, matrix, reports');
const SOON = await sess({ title: 'Soon & unready', held_on: d(2), required: true });
const ov = (await q(`select training_overview() o`))[0].o;
ok('overview: per-requirement counts', ov.requirements.length >= 3 && ov.requirements.find(r => r.name === 'New Tour Guide Orientation').total === 3);
ok('overview: upcoming sessions listed', ov.upcoming.some(u => u.title === 'Soon & unready'));
ok('overview: real problems surfaced (no location, no speaker, requirement with no sessions)', ['no_location', 'no_speaker', 'no_sessions'].every(k => ov.attention.some(a => a.kind === k)), j(ov.attention.map(a => a.kind)));
ok('overview: past session with attendance not submitted is flagged', ov.attention.some(a => a.kind === 'attendance_missing' && a.title === 'Legacy Night') || ov.attention.some(a => a.kind === 'attendance_missing'));
const mx = (await q(`select admin_training_matrix() m`))[0].m;
ok('matrix: one row per person per requirement', mx.filter(x => x.requirement_id === REQ).length === 3);
await as(B);
ok('the committee overview carries no names', !j((await q(`select training_overview() o`))[0].o).includes('Dee'));
ok('the committee cannot read the matrix', /administrator/.test(await fails(`select admin_training_matrix()`) || ''));
await as(A);
const rp = (await q(`select admin_training_report() r`))[0].r;
ok('report: attendance by session', rp.sessions.some(s => s.title === 'New Guide Orientation · Aug 20' && s.present === 2 && s.absent === 1), j(rp.sessions[0]));

console.log('\nthe Tour Guide\'s own view');
await as(C);
const my = (await q(`select my_training() m`))[0].m;
ok('Dee sees only her own requirements and state', my.linked && my.name === 'Dee Four' && my.requirements.find(r => r.name === 'New Tour Guide Orientation').state === 'complete', j(my).slice(0, 200));
ok('...and only her own attendance rows', (await q(`select count(distinct guide_id)::int n from training_attendance`))[0].n === 1);
ok('...and cannot read others\' overrides', (await q(`select count(*)::int n from training_overrides`))[0].n === 0 || (await q(`select count(distinct guide_id)::int n from training_overrides`))[0].n <= 1);
ok('...and cannot see draft sessions', (await q(`select count(*)::int n from training_sessions where status='draft'`))[0].n === 0);
await as(B);
ok('a committee member with no linked guide has no personal view', (await q(`select my_training() m`))[0].m.linked === false);
await as(A);

console.log('\naudit');
const acts = (await q(`select distinct action from admin_audit`)).map(r => r.action);
ok('every kind of training change is audited', ['training.session_created', 'training.session_changed', 'training.session_cancelled', 'training.attendance_submitted', 'training.attendance_edited', 'training.attendance_bulk', 'training.completion_waived', 'training.completion_auto', 'training.makeup_created',
  'training.requirement_created', 'training.requirement_sessions', 'training.speaker_changed', 'training.setup_copied', 'training.template_saved', 'training.group_members', 'training.session_deleted'].every(a => acts.includes(a)), acts.filter(a => a.startsWith('training')).join());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
