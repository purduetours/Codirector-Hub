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
await sql(read('02-views.sql'));
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
await sql(read('19-vanessa-agent.sql'));
await sql(read('19-vanessa-agent.sql'));
await asUser(evaluator);
let seq=0;const request=()=>`10000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
const run=async(action,params,id=request())=>(await one('select hub_agent_action($1,$2,$3) receipt',[id,action,JSON.stringify(params)])).receipt;
const snapshot=async()=>{const e=await one('select * from evals where id=$1',[evalId]);return {eval_id:evalId,expected_owner:e.evaluator_id,expected_date:e.tour_date?.toISOString?.().slice(0,10)||e.tour_date,expected_time:e.tour_time};};
await test('client cannot forge or truncate action receipts',async()=>{await assert.rejects(sql('truncate hub_agent_actions'),/permission denied/);await assert.rejects(sql("insert into hub_agent_actions(owner_id,request_id,action,parameters,result,summary) values(auth.uid(),gen_random_uuid(),'reminder.create','{}','{}','fake')"),/permission denied/);});
let created,id=request();
await test('reminder and authoritative receipt save together',async()=>{created=await run('reminder.create',{title:'Follow up with guide',due_at:'2026-10-02T13:00:00Z'},id);assert.ok(created.id&&created.created_at);assert.equal(created.result.owner_id,evaluator);assert.equal((await one('select count(*)::int n from hub_agent_actions')).n,1);});
await test('retry replays receipt without duplicate reminder',async()=>{const again=await run('reminder.create',{title:'Follow up with guide',due_at:'2026-10-02T13:00:00Z'},id);assert.equal(again.id,created.id);assert.equal(again.replayed,true);assert.equal((await one('select count(*)::int n from hub_reminders')).n,1);});
await test('request identity cannot change parameters',async()=>{await assert.rejects(run('reminder.create',{title:'Different',due_at:'2026-10-02T13:00:00Z'},id),/different action/);});
await test('caller cannot set owner or inject unknown parameters',async()=>{await assert.rejects(run('reminder.create',{title:'Fake',due_at:'2026-10-02',owner_id:other}),/Unsupported/);await assert.rejects(run('delete.everything',{}),/Unsupported/);await assert.rejects(run('reminder.create',{title:' ',due_at:'infinity'}),/required/);});
await test('cross-account receipts and reminder completion remain private',async()=>{await asUser(other);assert.equal((await one('select count(*)::int n from hub_agent_actions')).n,0);await assert.rejects(run('reminder.complete',{id:created.result.id}),/unavailable/);await asUser(evaluator);});
let releaseSnapshot;
await test('reviewed release creates receipt and underlying audit',async()=>{releaseSnapshot=await snapshot();const r=await run('evaluation.release',releaseSnapshot);assert.equal(r.result.evaluator_id,null);assert.match(r.summary,/Released/);assert.ok((await one("select count(*)::int n from hub_activity where action like '%release%' ")).n);});
await test('stale snapshot fails without a success receipt',async()=>{const before=(await one('select count(*)::int n from hub_agent_actions')).n;await assert.rejects(run('evaluation.release',releaseSnapshot),/changed since review/);assert.equal((await one('select count(*)::int n from hub_agent_actions')).n,before);});
await test('claim uses authenticated identity and reviewed snapshot',async()=>{const r=await run('evaluation.claim',{...await snapshot(),date:'2026-10-02',time:'14:00'});assert.equal(r.result.evaluator_id,evaluator);});
await test('backend rejects invalid date and time even from a direct caller',async()=>{await assert.rejects(run('evaluation.claim',{...await snapshot(),date:'infinity',time:'14:00'}),/Valid evaluation date/);await assert.rejects(run('evaluation.claim',{...await snapshot(),date:'2026-10-02',time:'24:00'}),/Valid evaluation time/);});
await test('another evaluator cannot release owned evaluation',async()=>{await asUser(other);await assert.rejects(run('evaluation.release',await snapshot()),/own evaluation/);await asUser(evaluator);});
await test('complete reminder is durable and audited',async()=>{const r=await run('reminder.complete',{id:created.result.id});assert.ok(r.result.completed_at);assert.equal((await one("select count(*)::int n from hub_activity where action='reminder.completed'")).n,1);});
await test('notification IDs validated and affected count is authoritative',async()=>{await assert.rejects(run('notifications.read',{ids:[]}),/between 1 and 100/);assert.equal((await run('notifications.read',{ids:[other]})).result.count,0);});
await test('receipt failure rolls back the actual mutation',async()=>{
 await sql("reset role;create function reject_agent_receipt() returns trigger language plpgsql as $$begin raise exception 'test receipt failure';end$$;create trigger reject_agent_receipt before insert on hub_agent_actions for each row execute function reject_agent_receipt()");
 await asUser(evaluator);const before=(await one('select count(*)::int n from hub_reminders')).n;
 await assert.rejects(run('reminder.create',{title:'Must roll back',due_at:'2026-10-02T13:00:00Z'}),/test receipt failure/);
 assert.equal((await one('select count(*)::int n from hub_reminders')).n,before);
 await sql('reset role;drop trigger reject_agent_receipt on hub_agent_actions;drop function reject_agent_receipt()');await asUser(evaluator);
});
await test('analytics independently requires leadership',async()=>{await assert.rejects(one('select hub_agent_analytics()'),/Leadership access required/);});
await test('server aggregation reports current accessible workload',async()=>{await sql("reset role;update members set is_codirector=true where id='"+owner+"'");await asUser(owner);const stats=(await one('select hub_agent_analytics() stats')).stats;assert.equal(stats.sampleSize,1);assert.equal(stats.workload[0].outstanding,1);await asUser(evaluator);});
await test('lost training role blocks writes independently of client',async()=>{await sql('reset role;create or replace function in_training() returns boolean language sql as $$select false$$');await asUser(evaluator);await assert.rejects(run('evaluation.release',releaseSnapshot),/Evaluation access required/);});
await test('signed-out callers cannot invoke writes',async()=>{await sql("reset role;set request.jwt.claim.sub='';set role authenticated");await assert.rejects(run('reminder.create',{title:'No account',due_at:'2026-10-02T13:00:00Z'}),/Active hub account/);});
console.log(`${checks} agent database checks passed.`);await db.close();
