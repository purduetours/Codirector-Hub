// Local PostgreSQL engine; no live database or outgoing email.
// Install @electric-sql/pglite in a temporary directory and set PGLITE_PATH to its dist/index.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=process.env.PGLITE_PATH?await import(process.env.PGLITE_PATH):await import('@electric-sql/pglite');
const db=new PGlite();let checks=0;
const sql=s=>db.exec(s),one=async(s,args=[]) => (await db.query(s,args)).rows[0];
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
const owner='00000000-0000-4000-8000-000000000001',evaluator='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const read=name=>fs.readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8');
await sql(`set timezone='UTC';create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await sql(read('01-schema.sql').replace('create extension if not exists pgcrypto;',''));
await sql(read('03-policies.sql'));
await sql(read('04-functions.sql'));
// The uploaded source omits the intermediate role migrations. Stub only that
// existing committee helper so the actual 08 access policies can be exercised.
await sql(`create function in_training() returns boolean language sql as $$select is_member()$$;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.invalid',now()),('${evaluator}','evaluator@example.invalid',now()),('${other}','other@example.invalid',now());
update members set full_name=case id when '${owner}' then 'Owner Fictional' when '${evaluator}' then 'Evaluator Fictional' else 'Other Fictional' end;
insert into terms values('current','Current',true),('old','Old',false);
insert into guides(id,first_name,last_name) values('${owner}','Guide','Fictional');
insert into evals(term_id,guide_id,priority,evaluator_id,tour_date,tour_time) select 'current','${owner}','First Priority to Eval','${evaluator}',(now() at time zone 'America/Indiana/Indianapolis'+interval '12 hours')::date,(now() at time zone 'America/Indiana/Indianapolis'+interval '12 hours')::time;`);
const access=read('08-access.sql');
await sql(access.slice(access.indexOf('drop policy if exists read_evals'),access.indexOf('-- ------------------------------------------------------------- interviews')));
for(const name of ['09-vanessa-submit.sql','10-tour-reminders.sql','11-active-users.sql'])await sql(read(name));

await sql('alter default privileges in schema public grant all on tables to anon,authenticated');
for(const name of ['13-training.sql','14-makeup-notes.sql','15-training-history.sql','16-training-codirectors-only.sql'])await sql(read(name));
await sql(read('18-operations-platform.sql'));
await sql(read('18-operations-platform.sql'));
const evalId=(await one('select id from evals')).id;
const asUser=async id=>sql(`reset role;set request.jwt.claim.sub='${id}';set role authenticated`);
await asUser(evaluator);
let reminder;
await test('new tables remove unsafe inherited privileges',async()=>{for(const table of ['hub_reminders','hub_notifications','hub_activity'])await assert.rejects(sql('truncate '+table),/permission denied/);});
await test('personal reminder creates immutable owner-only activity',async()=>{
 reminder=(await one("insert into hub_reminders(owner_id,title,due_at) values(auth.uid(),'Follow up',now()-interval '1 hour') returning id")).id;
 assert.equal((await one("select count(*)::int n from hub_activity where category='reminder'")).n,1);
 await assert.rejects(sql("insert into hub_activity(category,action,summary) values('reminder','fake','fake')"),/permission denied/);
});
await test('notifications sync is idempotent and private',async()=>{
 assert.ok((await one('select hub_sync_notifications() n')).n>=1);
 assert.equal((await one('select hub_sync_notifications() n')).n,0);
 assert.equal((await one("select count(*)::int n from hub_notifications where reminder_id=$1",[reminder])).n,1);
 await assert.rejects(sql("insert into hub_notifications(owner_id,category,title,route,source_key) values(auth.uid(),'reminder','fake','reminders','fake')"),/permission denied/);
});
await test('cross-account reminder reads and edits are denied',async()=>{
 await asUser(other);assert.equal((await one('select count(*)::int n from hub_reminders')).n,0);
 assert.equal((await db.query("update hub_reminders set title='hijacked' where id=$1 returning id",[reminder])).rows.length,0);
 await assert.rejects(one("insert into hub_reminders(owner_id,title,due_at) values($1,'fake',now())",[evaluator]),/row-level security/);
 assert.equal((await one("select count(*)::int n from hub_activity where category='reminder'")).n,0);
 assert.equal((await one('select count(*)::int n from hub_notifications')).n,0);
 assert.equal((await one('select hub_read_notifications() n')).n,0);
});
await test('reminder identity cannot be reassigned',async()=>{await asUser(evaluator);await assert.rejects(one('update hub_reminders set owner_id=$1 where id=$2',[other,reminder]),/permission denied/);});
await test('completion audit and mark-all read return actual affected count',async()=>{
 await one('update hub_reminders set completed_at=now() where id=$1',[reminder]);
 assert.equal((await one("select count(*)::int n from hub_activity where action='reminder.completed'")).n,1);
 assert.ok((await one('select hub_read_notifications() n')).n>=1);assert.equal((await one('select hub_read_notifications() n')).n,0);
});
await test('protected evaluation fields reject ordinary direct writes',async()=>{
 for(const change of ["priority='No Need to Eval'","submitted_at=now()","reviewed_at=now()",`evaluator_id='${other}'`])await assert.rejects(sql('update evals set '+change+` where id='${evalId}'`));
});
await test('release is audited and two sequential claims have one winner',async()=>{
 await one('update evals set evaluator_id=null,claimed_at=null,tour_date=null,tour_time=null where id=$1',[evalId]);
 assert.equal((await one("select count(*)::int n from hub_activity where action='evaluation.released'")).n,1);
 await asUser(other);assert.equal((await db.query('update evals set evaluator_id=auth.uid(),claimed_at=now() where id=$1 and evaluator_id is null returning id',[evalId])).rows.length,1);
 await asUser(evaluator);assert.equal((await db.query('update evals set evaluator_id=auth.uid() where id=$1 and evaluator_id is null returning id',[evalId])).rows.length,0);
});
await test('submission RPC still succeeds with guard and audits once',async()=>{
 await asUser(other);
 const saved=(await one("select submit_own_eval($1,4::smallint,'Clear voice','Pace','',current_date,'10:00') result",[evalId])).result;
 assert.ok(saved.receipt);
 assert.equal((await one("select count(*)::int n from hub_activity where action='evaluation.submitted'")).n,1);
 const retry=(await one("select submit_own_eval($1,4::smallint,'Clear voice','Pace','',current_date,'10:00') result",[evalId])).result;
 assert.equal(retry.already,true);
 assert.equal((await one("select count(*)::int n from hub_activity where action='evaluation.submitted'")).n,1);
});
await test('submitted evaluation cannot be released and activity follows eval access',async()=>{
 assert.equal((await db.query('update evals set evaluator_id=null where id=$1 and submitted_at is null returning id',[evalId])).rows.length,0);
 await asUser(evaluator);assert.equal((await one("select count(*)::int n from hub_activity where category='evaluation'")).n,0);
});
await test('training history feeds leadership audit without absence details',async()=>{
 await sql(`reset role;update members set is_codirector=true where id='${owner}';grant select,insert,update,delete on training_sessions,training_attendance to authenticated;grant select on training_history to authenticated;`);
 await asUser(owner);
 const session=(await one("insert into training_sessions(term_id,label) values('current','Test session') returning id")).id;
 const attendance=(await one("insert into training_attendance(session_id,person_name,actual) values($1,'Guide Fictional','Absent') returning id",[session])).id;
 await one("update training_attendance set actual='Makeup Completed' where id=$1",[attendance]);
 const event=await one("select * from hub_activity where category='training' order by id desc limit 1");
 assert.match(event.summary,/updated training for Guide Fictional/);assert.equal(event.metadata.field,'actual');assert.equal(event.metadata.became,undefined);
 await asUser(other);assert.equal((await one("select count(*)::int n from hub_activity where category='training'")).n,0);
});
await test('leadership sees access changes but not other people’s private reminders',async()=>{
 await asUser(owner);assert.ok((await one("select count(*)::int n from hub_activity where category='administration'")).n>=1);
 assert.equal((await one("select count(*)::int n from hub_activity where category='reminder'")).n,0);
 assert.equal((await one('select count(*)::int n from hub_reminders')).n,0);
});
await test('inactive accounts cannot read or sync workspace data',async()=>{
 await sql(`reset role;update members set active=false where id='${evaluator}'`);await asUser(evaluator);
 assert.equal((await one('select count(*)::int n from hub_reminders')).n,0);
 assert.equal((await one('select count(*)::int n from hub_notifications')).n,0);
 await assert.rejects(sql('select hub_sync_notifications()'),/Active hub account/);
});
await test('non-training account cannot read or claim an evaluation through direct SQL',async()=>{
 const recruitment='00000000-0000-4000-8000-000000000004';
 await sql(`reset role;insert into auth.users(id,email,email_confirmed_at) values('${recruitment}','recruitment@example.invalid',now());
 create or replace function in_training() returns boolean language sql stable security definer set search_path=public as $$select is_member() and auth.uid()<>'${recruitment}'::uuid$$;
 insert into guides(id,first_name,last_name) values('${recruitment}','Another','Fixture');`);
 const open=(await one("insert into evals(term_id,guide_id,priority) values('current',$1,'First Priority to Eval') returning id",[recruitment])).id;
 await asUser(recruitment);
 assert.equal((await one('select count(*)::int n from evals')).n,0);
 assert.equal((await db.query('update evals set evaluator_id=auth.uid() where id=$1 returning id',[open])).rows.length,0);
 assert.equal((await one("select count(*)::int n from hub_activity where category='evaluation'")).n,0);
});
await test('anonymous role cannot use workspace endpoints',async()=>{
 await sql('reset role;set role anon');for(const q of ['select * from hub_activity','select * from hub_reminders','select * from hub_notifications','select hub_sync_notifications()','select hub_read_notifications()'])await assert.rejects(sql(q),/permission denied/);
});
await db.close();console.log(`\n${checks} operations database checks passed.`);
