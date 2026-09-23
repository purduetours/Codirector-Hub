import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../supabase/functions/tour-reminders/worker.js',import.meta.url),'utf8');
const {createReminderHandler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
const secret='fictional-test-secret-at-least-32-characters';
const env={REMINDER_CRON_SECRET:secret,SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake-service',RESEND_API_KEY:'fake-email'};
const req=(token=secret,method='POST')=>new Request('https://example.invalid/reminders',{method,headers:{Authorization:`Bearer ${token}`}});
function setup({emailStatus=200,network=false,finish=true,alwaysJob=false,config=env}={}){
 const calls=[];let claimed=0;
 const handler=createReminderHandler({env:k=>config[k],fetcher:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('queue_tour_reminders'))return Response.json(1);
  if(url.endsWith('claim_tour_reminder'))return Response.json(claimed++===0||alwaysJob?{id:'stable-job',lease_id:'lease',payload:{from:'sender@example.invalid',to:['evaluator@example.invalid'],cc:['owner@example.invalid'],subject:'Reminder',text:'Fictional reminder'}}:null);
  if(url.endsWith('finish_tour_reminder'))return Response.json(finish);
  if(network)throw Error('timeout');
  return Response.json(emailStatus===200?{id:'fake-provider-id'}:{message:'error'},{status:emailStatus});
 }});return {handler,calls};
}
await test('unauthorized callers cannot enqueue or send',async()=>{const b=setup();assert.equal((await b.handler(req('bad'))).status,401);assert.equal(b.calls.length,0);});
await test('GET cannot trigger reminders',async()=>{const b=setup();assert.equal((await b.handler(req(secret,'GET'))).status,405);assert.equal(b.calls.length,0);});
await test('missing secrets fail before network access',async()=>{const b=setup({config:{...env,RESEND_API_KEY:''}});assert.equal((await b.handler(req())).status,503);assert.equal(b.calls.length,0);});
await test('queued recipients use stable idempotency key',async()=>{const b=setup();assert.equal((await (await b.handler(req())).json()).accepted,1);const send=b.calls.find(c=>c.url.includes('api.resend'));const body=JSON.parse(send.options.body);assert.deepEqual(body.to,['evaluator@example.invalid']);assert.deepEqual(body.cc,['owner@example.invalid']);assert.equal(send.options.headers['Idempotency-Key'],'tour-reminder/stable-job');const ack=JSON.parse(b.calls.find(c=>c.url.endsWith('finish_tour_reminder')).options.body);assert.equal(ack.p_status,'accepted');assert.equal(ack.p_provider,'fake-provider-id');});
await test('email timeout schedules retry without reporting accepted',async()=>{const b=setup({network:true});const r=await (await b.handler(req())).json();assert.equal(r.accepted,0);assert.equal(r.retrying,1);});
await test('rate limits and server errors retry, invalid requests fail',async()=>{for(const code of [429,500,422,401]){const b=setup({emailStatus:code});const r=await (await b.handler(req())).json();assert.equal(code===429||code===500?r.retrying:r.failed,1);assert.equal(r.accepted,0);}});
await test('failed database acknowledgement reports incomplete processing',async()=>{const b=setup({finish:false});assert.equal((await b.handler(req())).status,503);});
await test('bounded batch limits execution time',async()=>{const b=setup({alwaysJob:true});assert.equal((await (await b.handler(req())).json()).accepted,3);});
await test('request body cannot override recipients',async()=>{const b=setup();await b.handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({to:'intruder@example.invalid'})}));assert.doesNotMatch(b.calls.find(c=>c.url.includes('api.resend')).options.body,/intruder/);});
console.log(`\n${checks} email-worker checks passed.`);
