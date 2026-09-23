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
await test('disabled reminders enqueue nothing',async()=>assert.equal((await one('select queue_tour_reminders() n')).n,0));
await sql(`update tour_reminder_settings set enabled=true,owner_id='${owner}',from_email='vanessa@example.invalid',hub_url='https://example.invalid';`);
await test('queues evaluator and owner using verified emails',async()=>{assert.equal((await one('select queue_tour_reminders() n')).n,1);const d=await one('select * from tour_reminder_deliveries');assert.deepEqual(d.payload.to,['evaluator@example.invalid']);assert.deepEqual(d.payload.cc,['owner@example.invalid']);assert.match(d.payload.text,/Purdue local time/);});
await test('repeated queue calls deduplicate',async()=>assert.equal((await one('select queue_tour_reminders() n')).n,0));
let job;
await test('leased reminder cannot be claimed twice',async()=>{job=(await one('select claim_tour_reminder() job')).job;assert.ok(job.lease_id);assert.equal((await one('select claim_tour_reminder() job')).job,null);});
await test('wrong lease cannot acknowledge acceptance',async()=>assert.equal((await one("select finish_tour_reminder($1,$2,'accepted','fake-provider') ok",[job.id,owner])).ok,false));
await test('provider acceptance is durable and not resent',async()=>{assert.equal((await one("select finish_tour_reminder($1,$2,'accepted','fake-provider') ok",[job.id,job.lease_id])).ok,true);assert.ok((await one('select accepted_at from tour_reminder_deliveries')).accepted_at);assert.equal((await one('select claim_tour_reminder() job')).job,null);});
async function reset(){await sql(`truncate tour_reminder_deliveries;update tour_reminder_settings set enabled=true,owner_id='${owner}';update evals set evaluator_id='${evaluator}',submitted_at=null,priority='First Priority to Eval',tour_date=(now() at time zone 'America/Indiana/Indianapolis'+interval '12 hours')::date,tour_time=(now() at time zone 'America/Indiana/Indianapolis'+interval '12 hours')::time;update auth.users set email_confirmed_at=now();update members set active=true;update terms set is_current=(id='current');`);}
await test('past tours and tours beyond window are excluded',async()=>{for(const days of [-2,3]){await reset();await sql('update evals set tour_date=current_date+'+days);assert.equal((await one('select queue_tour_reminders() n')).n,0);}});
await test('undated, submitted, skipped and old-term evals are excluded',async()=>{for(const change of ['tour_time=null','tour_date=null','submitted_at=now()',"priority='No Need to Eval'"]){await reset();await sql('update evals set '+change);assert.equal((await one('select queue_tour_reminders() n')).n,0);}await reset();await sql('update terms set is_current=false');assert.equal((await one('select queue_tour_reminders() n')).n,0);});
await test('inactive or unverified recipients are excluded',async()=>{await reset();await sql(`update members set active=false where id='${owner}'`);assert.equal((await one('select queue_tour_reminders() n')).n,0);await reset();await sql(`update auth.users set email_confirmed_at=null where id='${evaluator}'`);assert.equal((await one('select queue_tour_reminders() n')).n,0);});
await test('owner evaluating gets one email instead of duplicate CC',async()=>{await reset();await sql(`update evals set evaluator_id='${owner}'`);await one('select queue_tour_reminders()');assert.deepEqual((await one('select payload from tour_reminder_deliveries')).payload.cc,[]);});
await test('reassignment cancels old job and queues correct evaluator',async()=>{await reset();await one('select queue_tour_reminders()');await sql(`update evals set evaluator_id='${other}'`);assert.equal((await one('select claim_tour_reminder() job')).job,null);assert.equal((await one('select status from tour_reminder_deliveries')).status,'cancelled');assert.equal((await one('select queue_tour_reminders() n')).n,1);assert.equal((await one('select claim_tour_reminder() job')).job.evaluator_id,other);});
await test('disabling reminders prevents queued sends',async()=>{await reset();await one('select queue_tour_reminders()');await sql('update tour_reminder_settings set enabled=false');assert.equal((await one('select claim_tour_reminder() job')).job,null);});
await test('expired leases retry same payload and idempotency identity',async()=>{await reset();await one('select queue_tour_reminders()');const a=(await one('select claim_tour_reminder() job')).job;await sql("update tour_reminder_deliveries set lease_until=now()-interval '1 minute'");const b=(await one('select claim_tour_reminder() job')).job;assert.equal(a.id,b.id);assert.deepEqual(a.payload,b.payload);assert.notEqual(a.lease_id,b.lease_id);});
await test('retry cutoff precedes provider idempotency expiry',async()=>{await reset();await one('select queue_tour_reminders()');await sql("update tour_reminder_deliveries set first_attempt_at=now()-interval '23 hours 1 minute'");assert.equal((await one('select claim_tour_reminder() job')).job,null);assert.equal((await one('select status from tour_reminder_deliveries')).status,'failed');});
await test('Purdue timezone handles summer and winter',async()=>{const r=await one("select ('2026-07-01 10:00'::timestamp at time zone 'America/Indiana/Indianapolis')::text summer,('2026-12-01 10:00'::timestamp at time zone 'America/Indiana/Indianapolis')::text winter");assert.match(r.summer,/14:00/);assert.match(r.winter,/15:00/);});
await test('members cannot inspect or invoke reminder backend',async()=>{await sql('set role authenticated');for(const q of ['select * from tour_reminder_candidates','select * from tour_reminder_deliveries','select queue_tour_reminders()','select claim_tour_reminder()'])await assert.rejects(sql(q),/permission denied/);await sql('reset role');});
await reset();
await test('presence requires active authenticated membership',async()=>{await assert.rejects(one('select hub_active_users()'),/Active hub account/);await assert.rejects(one('select hub_heartbeat($1)',[owner]),/Active hub account/);});
await sql(`set request.jwt.claim.sub='${owner}';set role authenticated;`);
await test('presence derives identity and deduplicates multiple tabs',async()=>{await one('select hub_heartbeat($1)',[owner]);await one('select hub_heartbeat($1)',[evaluator]);const rows=(await db.query('select * from hub_active_users()')).rows;assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['member_id','full_name']);assert.equal(rows[0].member_id,owner);});
await test('every active member can see names only',async()=>{await sql(`set request.jwt.claim.sub='${other}'`);assert.equal((await db.query('select * from hub_active_users()')).rows.length,1);});
await test('one account cannot clear another account presence',async()=>{await one('select hub_heartbeat($1,false)',[owner]);assert.equal((await db.query('select * from hub_active_users()')).rows.length,1);});
await test('raw presence table is private',async()=>{await assert.rejects(sql('select * from hub_presence'),/permission denied/);await assert.rejects(sql('delete from hub_presence'),/permission denied/);});
await test('one closing tab does not hide another active tab',async()=>{await sql(`set request.jwt.claim.sub='${owner}'`);await one('select hub_heartbeat($1,false)',[owner]);assert.equal((await db.query('select * from hub_active_users()')).rows.length,1);});
await test('stale heartbeats expire after 90 seconds',async()=>{await sql("reset role;update hub_presence set seen_at=now()-interval '91 seconds';set role authenticated");assert.equal((await db.query('select * from hub_active_users()')).rows.length,0);});
await test('deactivated accounts are excluded and denied access',async()=>{await one('select hub_heartbeat($1)',[owner]);await sql(`reset role;update members set active=false where id='${owner}';set role authenticated;`);await assert.rejects(one('select hub_active_users()'),/Active hub account/);await sql(`set request.jwt.claim.sub='${other}'`);assert.equal((await db.query('select * from hub_active_users()')).rows.length,0);});
await sql('reset role');await reset();
const evaluation=(await one('select id from evals')).id;let receipt;
await sql(`set request.jwt.claim.sub='${evaluator}';set role authenticated`);
await test('atomic submission returns authoritative saved receipt',async()=>{const r=(await one("select submit_own_eval($1,4::smallint,'Exact feedback','Speak up','Notes','2026-09-12','10:00') result",[evaluation])).result;receipt=r.receipt;assert.equal(receipt.went_well,'Exact feedback');assert.equal(receipt.submitted_by,evaluator);assert.equal(receipt.tour_date,'2026-09-12');assert.ok(receipt.id);assert.ok(receipt.created_at);});
await test('identical retry returns same receipt and timestamp',async()=>{const r=(await one("select submit_own_eval($1,4::smallint,'Exact feedback','Speak up','Notes','2026-09-12','10:00') result",[evaluation])).result;assert.equal(r.already,true);assert.deepEqual(r.receipt,receipt);});
await test('different feedback cannot overwrite an existing submission',async()=>{await assert.rejects(one("select submit_own_eval($1,4::smallint,'Changed','Speak up','Notes','2026-09-12','10:00')",[evaluation]),/already saved/);});
await test('other account cannot obtain receipt or submit claim',async()=>{await sql(`set request.jwt.claim.sub='${other}'`);await assert.rejects(one("select submit_own_eval($1,4::smallint,'Exact feedback','Speak up','Notes','2026-09-12','10:00')",[evaluation]),/no longer claimed/);});
// Hosted Cron/pg_net/Vault are not available in PGlite. These narrow stubs
// validate the activation script and scheduled SQL; they never make HTTP calls.
await sql(`reset role;create schema cron;create schema net;create schema vault;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create table cron.test_jobs(name text primary key,schedule text,command text);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.test_jobs values($1,$2,$3) on conflict(name) do update set schedule=$2,command=$3;return 1;end$$;
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 2000) returns bigint language sql as $$select 1::bigint$$;
update tour_reminder_settings set enabled=false,owner_id=null;`);
const activation=read('12-enable-reminders.sql').replace(/create extension if not exists pg_(?:cron|net);/g,'');
await test('activation refuses missing owner configuration',async()=>{await assert.rejects(sql(activation),/Configure the verified owner/);await sql('rollback');assert.equal((await one('select enabled from tour_reminder_settings')).enabled,false);});
await sql(`update tour_reminder_settings set owner_id='${owner}'`);
await test('activation refuses missing scheduler secrets',async()=>{await assert.rejects(sql(activation),/Vault secrets/);await sql('rollback');assert.equal((await one('select enabled from tour_reminder_settings')).enabled,false);});
await sql("insert into vault.decrypted_secrets values('hub_reminder_project_url','https://example.invalid'),('hub_reminder_cron_secret','fictional-32-character-secret-never-real')");
await test('activation schedules one repeatable job with valid request SQL',async()=>{await sql(activation);await sql(activation);assert.equal((await one('select count(*)::integer n from cron.test_jobs')).n,1);const job=await one('select * from cron.test_jobs');assert.equal(job.schedule,'*/5 * * * *');assert.equal((await one('select enabled from tour_reminder_settings')).enabled,true);await sql(job.command);});
await db.close();console.log(`\n${checks} database checks passed.`);
