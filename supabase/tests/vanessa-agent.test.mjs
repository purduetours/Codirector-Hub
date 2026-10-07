// Tests for supabase/21-vanessa-agent.sql against an in-memory Postgres.
// Covers: the pending-action lifecycle (single use, expiry,
// tamper check, ownership, replacement), the audit "via Vanessa" tag (and that a
// header cannot be used to mislabel someone else's changes), metrics, and the
// admin-only diagnostics.
//   npm install @electric-sql/pglite ; node supabase/tests/vanessa-agent.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const R = new URL('../', import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  -> ' + d)); };
const as = async id => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id || ''}',false);` + (id ? 'set role authenticated;' : '')); };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const fails = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
const H = 'a'.repeat(32), H2 = 'b'.repeat(32);

await db.exec(`
 create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon; grant usage on schema public to authenticated, anon;`);
await db.exec(fs.readFileSync(R + '01-schema.sql', 'utf8').replace(/create extension[^;]*;/, ''));
await db.exec(`
 alter table members add column role text;
 create table roles (name text primary key, is_admin boolean default false, in_training boolean default false, in_recruitment boolean default false, sort_order int default 0);
 create function is_member() returns boolean language sql stable security definer as $$ select exists(select 1 from members where id=auth.uid() and active) $$;
 create function is_codirector() returns boolean language sql stable security definer as $$ select exists(select 1 from members m join roles r on r.name=m.role where m.id=auth.uid() and m.active and r.is_admin) $$;
 create function in_training() returns boolean language sql stable as $$ select true $$;
 create table member_roster (email text primary key, full_name text not null, role text);
 create table tour_reminder_settings (singleton boolean primary key default true, enabled boolean default false, owner_id uuid, from_email text, hub_url text, hours_before int default 24);
 insert into tour_reminder_settings(singleton) values (true);`);
await db.exec(fs.readFileSync(R + '02-views.sql', 'utf8'));
await db.exec(fs.readFileSync(R + '13-training.sql', 'utf8').replace(/create policy[\s\S]*?;\n/g, '').replace(/drop policy[^;]*;/g, '').replace(/alter table training_\w+\s+enable row level security;/g, ''));
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', X = '00000000-0000-0000-0000-0000000000ee';
await db.exec(`
 insert into roles values ('Codirector',true,true,true,1),('Training Committee',false,true,false,2);
 insert into auth.users(id,email) values ('${A}','alice@purdue.edu'),('${B}','bob@purdue.edu'),('${X}','ex@purdue.edu');
 insert into members(id,full_name,email,role,active) values ('${A}','Alice A','alice@purdue.edu','Codirector',true),('${B}','Bob B','bob@purdue.edu','Training Committee',true),('${X}','Ex X','ex@purdue.edu','Training Committee',false);
 insert into member_roster values ('alice@purdue.edu','Alice A','Codirector'),('bob@purdue.edu','Bob B','Training Committee');
 insert into terms(id,label,is_current) values ('fall-2026','Fall 2026',true);`);
await db.exec(fs.readFileSync(R + '18-admin-operations.sql', 'utf8'));
const mig = fs.readFileSync(R + '21-vanessa-agent.sql', 'utf8');
await db.exec(mig); ok('migration runs', true);
await db.exec(mig); ok('migration is re-runnable', true);
await db.exec('grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;');
await db.exec(`revoke all on vanessa_actions, vanessa_turns from authenticated; grant select on vanessa_actions to authenticated;`);
const ids = await q(`select proname from pg_proc where proname like 'vanessa\\_%' or proname = 'admin_vanessa_stats'`);
ok('six functions are installed (and no rate limiter: there is no paid service to protect)', ids.length === 6 && !ids.some(x => x.proname === 'vanessa_gate'), JSON.stringify(ids));
ok('the old request table is gone', (await q(`select to_regclass('public.vanessa_requests') r`))[0].r === null);

console.log('\npending actions');
await as(A);
const begin = async (kind = 'assign_evaluation', hash = H, risk = 'meaningful', mode = 'live') =>
  (await q(`select vanessa_begin_action($1,$2,$3,$4,$5) id`, [kind, hash, 'Assign Taylor to evaluate Jordan', risk, mode]))[0].id;
let id1 = await begin();
ok('begin returns an id and a pending row', !!id1 && (await q(`select status from vanessa_actions where id=$1`, [id1]))[0].status === 'pending');
ok('bad kind refused', /kind of action/.test(await fails(`select vanessa_begin_action('DROP TABLE x', '${H}', 's', 'low')`) || ''));
ok('bad hash refused', /not valid/.test(await fails(`select vanessa_begin_action('x_y', 'zz', 's', 'low')`) || ''));
ok('bad risk refused', /not valid/.test(await fails(`select vanessa_begin_action('x_y', '${H}', 's', 'whatever')`) || ''));
ok('a different hash cannot confirm it (tamper check)', /details changed/.test(await fails(`select vanessa_confirm_action('${id1}', '${H2}')`) || ''));
ok('...and it is still pending afterwards', (await q(`select status from vanessa_actions where id=$1`, [id1]))[0].status === 'pending');
await as(B);
ok('another person cannot confirm it', /could not find/.test(await fails(`select vanessa_confirm_action('${id1}', '${H}')`) || ''));
ok('another person cannot see it', (await q(`select * from vanessa_actions`)).length === 0);
await as(A);
ok('the right hash confirms it', (await q(`select vanessa_confirm_action($1,$2) r`, [id1, H]))[0].r.ok === true);
ok('it cannot be confirmed twice', /already used/.test(await fails(`select vanessa_confirm_action('${id1}', '${H}')`) || ''));
await db.query(`select vanessa_finish_action($1, true, '{"assigned":1}'::jsonb)`, [id1]);
ok('finish records success', (await q(`select status from vanessa_actions where id=$1`, [id1]))[0].status === 'executed');
await db.query(`select vanessa_finish_action($1, false, null)`, [id1]);
ok('a finished action cannot be flipped to failed', (await q(`select status from vanessa_actions where id=$1`, [id1]))[0].status === 'executed');

let id2 = await begin('archive_people', H, 'high');
let id3 = await begin('change_priority', H2, 'meaningful');
ok('a new proposal replaces the one waiting', (await q(`select status from vanessa_actions where id=$1`, [id2]))[0].status === 'cancelled');
ok('...and the replaced one cannot be confirmed', /cancelled/.test(await fails(`select vanessa_confirm_action('${id2}', '${H}')`) || ''));
await as(null); await db.exec(`reset role; update vanessa_actions set expires_at = now() - interval '1 second' where id = '${id3}'`); await as(A);
ok('an expired request refuses to run', /expired/.test(await fails(`select vanessa_confirm_action('${id3}', '${H2}')`) || ''));
ok('...and the next proposal sweeps it to expired', await (async () => { const n = await begin('x_y', H, 'low'); await db.query(`select vanessa_cancel_action($1)`, [n]); return (await q(`select status from vanessa_actions where id=$1`, [id3]))[0].status === 'expired'; })());
let id4 = await begin('x_y', H, 'low');
await db.query(`select vanessa_cancel_action($1)`, [id4]);
ok('cancel works', (await q(`select status from vanessa_actions where id=$1`, [id4]))[0].status === 'cancelled');
let hi = await begin('archive_people', H, 'high');
const exp = (await q(`select expires_at - created_at d from vanessa_actions where id=$1`, [hi]))[0].d;
ok('high-impact actions expire sooner', String(exp.minutes !== undefined ? '00:0' + exp.minutes + ':00' : exp) === '00:05:00', JSON.stringify(exp));
await as(X);
ok('an archived member cannot begin an action', /signed in/.test(await fails(`select vanessa_begin_action('x_y','${H}','s','low')`) || ''));

console.log('\nthe audit log says who really did it');
await as(A);
const idLive = await begin('save_person', H, 'meaningful');
await db.query(`select vanessa_confirm_action($1,$2)`, [idLive, H]);
const withHeader = async (aid, sql) => { await db.exec(`select set_config('request.headers', '${JSON.stringify(aid ? { 'x-vanessa-action': aid } : {})}', false)`); await db.query(sql); await db.exec(`select set_config('request.headers','',false)`); };
await withHeader(idLive, `select admin_save_person('c1@purdue.edu','Via Vanessa','Training Committee')`);
await withHeader(null, `select admin_save_person('c2@purdue.edu','By Hand','Training Committee')`);
await as(A);
const au = await q(`select target_label, via, actor_name from admin_audit where action = 'person.added' order by id`);
ok('a confirmed Vanessa action is tagged', au[0]?.via === 'vanessa' && au[0].actor_name === 'Alice A', JSON.stringify(au));
ok('an ordinary change is not', au[1]?.via === null, JSON.stringify(au));
// a pending (not confirmed) id must not count
const idPending = await begin('save_person', H, 'meaningful');
await withHeader(idPending, `select admin_save_person('c3@purdue.edu','Pending','Training Committee')`);
ok('an unconfirmed action id does not count', (await q(`select via from admin_audit where target_label like '%Pending%' or target_label like '%c3@%'`))[0]?.via === null);
// someone else's confirmed id must not count
await as(B);
await withHeader(idLive, `select 1`);
await as(A);
const idMock = await begin('save_person', H, 'meaningful', 'mock');
await db.query(`select vanessa_confirm_action($1,$2)`, [idMock, H]);
await withHeader(idMock, `select admin_save_person('c4@purdue.edu','Mock One','Training Committee')`);
ok('a mock-mode action is never tagged as real', (await q(`select via from admin_audit where target_label like '%c4@%' or target_label like '%Mock%'`))[0]?.via === null);
await as(null); await db.exec(`reset role; update members set role='Codirector' where id='${B}'`); await as(B);
await withHeader(idLive, `select admin_save_person('c5@purdue.edu','Borrowed','Training Committee')`);
ok("a header naming someone else's action is ignored", (await q(`select via from admin_audit where target_label like '%c5@%' or target_label like '%Borrowed%'`))[0]?.via === null);
await as(null); await db.exec(`reset role; update members set role='Training Committee' where id='${B}'`);
await as(A);
ok('a garbage header cannot break auditing', await (async () => { await db.exec(`select set_config('request.headers','not json',false)`); const r = await fails(`select admin_save_person('c6@purdue.edu','Garbage','Training Committee')`); await db.exec(`select set_config('request.headers','',false)`); return r === null; })());

console.log('\nmetrics and diagnostics');
await as(B);
await db.query(`select vanessa_log_turn('standard','evaluation.needs',0.92,0,false,35,array['list_eval_roster'],array[]::text[],true,null,'today')`);
await db.query(`select vanessa_log_turn('standard','schedule.next',0.93,0,false,20,array['get_next_tour','get_tours'],array[]::text[],true,null,'today')`);
await db.query(`select vanessa_log_turn('enhanced','evaluation.opportunities',0.80,1,false,2400,array['find_eval_opportunities'],array['find_eval_opportunities'],false,'tool_error','evalroster')`);
await db.query(`select vanessa_log_turn('standard',null,null,1,true,3000,array[]::text[],array[]::text[],true,null,'today')`);
await db.query(`select vanessa_log_turn('legacy',null,null,0,false,50,array[]::text[],array[]::text[],true,null,'today')`);
await db.query(`select vanessa_log_turn('standard','DROP TABLE x',5,999,false,-5,array[]::text[],array[]::text[],true,null,'today')`);
await as(X);
await db.query(`select vanessa_log_turn('standard','a.b',0.5,0,false,1,array[]::text[],array[]::text[],true,null,'x')`);
await as(A);
const st = (await q(`select admin_vanessa_stats(24) s`))[0].s;
ok('stats count turns', st.turns === 6 && st.ok === 5, JSON.stringify(st));
ok('archived members are not logged', st.people === 1);
ok('stats split Standard, Enhanced and her older answers', st.by_engine.standard === 4 && st.by_engine.enhanced === 1 && st.by_engine.legacy === 1, JSON.stringify(st.by_engine));
ok('stats count local-model calls (an absurd value is clamped) and provider failures', st.local_calls === 22 && st.provider_failures === 1, JSON.stringify([st.local_calls, st.provider_failures]));
ok('stats count what she did not understand', st.not_understood === 1);
ok('stats list intents with confidence and speed', st.by_intent.length === 3 && st.by_intent[0].n === 1 && st.avg_confidence > 0.8, JSON.stringify(st.by_intent));
ok('a made-up intent or out-of-range value is stored as nothing, not as text', !st.by_intent.some(i => /DROP/.test(i.intent)));
ok('stats list tools and failures', st.by_tool.length === 4 && st.failing_tools[0].tool === 'find_eval_opportunities');
ok('stats list recent failures with no content', st.recent_failures.length === 1 && !('question' in st.recent_failures[0]) && st.recent_failures[0].intent === 'evaluation.opportunities');
ok('stats list actions by status', st.actions.executed === 1 && st.actions.cancelled >= 1);
ok('there are no token or model fields any more', !('input_tokens' in st) && !('by_model' in st));
await as(B);
ok('non-admins cannot read diagnostics', /administrator/.test(await fails(`select admin_vanessa_stats(24)`) || ''));
ok('non-admins cannot read the turn log directly', /permission/i.test(await fails(`select * from vanessa_turns`) || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
