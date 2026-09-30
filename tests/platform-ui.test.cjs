// Local browser fixtures only. PLAYWRIGHT_PATH may point to an installed package.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.dismiss());
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());if(url.hostname!=='hub.test')return route.abort();
 const file=path.resolve(root,url.pathname.slice(1)||'index.html');if(!file.startsWith(root+path.sep))return route.abort();
 try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('<script type="module" src="js/main.js"></script>','').replace('<script src="config.js"></script>','');await route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{await route.fulfill({status:404,body:''});}
});
console.log('Loading local fixture');await page.goto('http://hub.test/index.html');console.log('Initializing fixture modules');
await page.evaluate(async()=>{
 window.CONFIG={SUPABASE_URL:'https://example.invalid',SUPABASE_KEY:'fixture'};
 const {state}=await import('/js/core/state.js');const data=await import('/js/core/vanessa-data.js');
 state.me={id:'fixture-owner',full_name:'Morgan Example'};state.role={name:'Codirector',is_admin:true,in_training:true,in_recruitment:true};state.loadedAt=new Date();state.term={id:'fixture'};
 const day=new Date().toLocaleDateString('en-CA'),next=new Date(Date.now()+86400000).toLocaleDateString('en-CA');
 state.guides=[{id:'eval-one',guideId:'guide-one',name:'Avery Fictional',first:'Avery',last:'Fictional',priority:'First Priority',rank:1,skip:false,status:'claimed',evaluatorId:'fixture-owner',evaluator:'Morgan Example',date:day,time:'15:00',submitted:false,tours:[{date:day,start:'15:00',guide:'Avery Fictional'}]},{id:'eval-two',guideId:'guide-two',name:'Blake Fictional',first:'Blake',last:'Fictional',priority:'Second Priority',rank:2,skip:false,status:'open',evaluatorId:null,date:'',time:'',submitted:false,tours:[{date:next,start:'16:00',guide:'Blake Fictional'}]}];
 state.counts={claimed:1,open:1};state.neededTotal=2;
 data.registerLoaders({roster:async()=>{},tours:async()=>{},training:async()=>{}});data.share('tours',[{date:day,start:'15:00',slot:'3 PM',guide:'Avery Fictional'},{date:next,start:'16:00',slot:'4 PM',guide:'Blake Fictional'}]);data.share('desks',[]);
 const records=[{id:'reminder-one',owner_id:'fixture-owner',title:'Review the upcoming tours',due_at:new Date(Date.now()-3600000).toISOString(),completed_at:null}];
 const notices=[{id:'notification-one',owner_id:'fixture-owner',category:'reminder',title:'Review the upcoming tours',route:'reminders',reminder_id:'reminder-one',read_at:null,created_at:new Date().toISOString()}];
 window.__requests=[];window.__asks=0;document.addEventListener('hub:ask',()=>window.__asks++);
 window.fetch=async(url,opts={})=>{
 const u=new URL(url),table=u.pathname.split('/').at(-1),payload=opts.body?JSON.parse(opts.body):null;window.__requests.push({table,method:opts.method||'GET',payload});let result=[];
 if(table==='hub_reminders'){
  if(opts.method==='POST'){const row={id:'reminder-'+records.length,...payload[0],completed_at:null};records.push(row);result=[row];}
  else if(opts.method==='PATCH'){const row=records.find(r=>r.id===u.searchParams.get('id')?.slice(3));if(row)Object.assign(row,payload);result=row?[row]:[];}
  else if(opts.method==='DELETE'){const i=records.findIndex(r=>r.id===u.searchParams.get('id')?.slice(3));if(i>=0)records.splice(i,1);result=null;}
  else result=records;
 }
 if(table==='hub_agent_actions')result=[];
 if(table==='hub_agent_analytics')result={workload:[],sampleSize:2,truncated:false};
 if(table==='guides')result=state.guides.map(g=>({id:g.guideId,full_name:g.name,first_name:g.first,last_name:g.last}));
 if(table==='hub_agent_action')result={id:'receipt-one',action:payload.p_action,result:{id:payload.p_params.eval_id||'reminder-one'},summary:'Released the evaluation for Avery Fictional',created_at:new Date().toISOString()};
 if(table==='hub_notifications')result=notices;
 if(table==='hub_sync_notifications')result=0;
 if(table==='hub_read_notifications'){result=0;notices.forEach(n=>{if(!n.read_at&&(!payload.p_ids||payload.p_ids.includes(n.id))){n.read_at=new Date().toISOString();result++;}});}
 if(table==='training_sessions')result=[{id:'session-fixture',term_id:'fixture',label:'September 21st',held_on:'2026-09-21'}];
 if(table==='training_attendance')result=[{id:'attendance-fixture',session_id:'session-fixture',person_name:'Avery Fictional',actual:'Attended',expectation:'',makeup_on:null,makeup_note:null}];
 if(table==='hub_activity')result=[{id:1,summary:'Morgan Example claimed an evaluation for Avery Fictional',category:'evaluation',created_at:new Date().toISOString()}];
 if(table==='eval_roster')result=state.guides.filter(g=>(!u.searchParams.get('id')||u.searchParams.get('id').includes(g.id))&&(!u.searchParams.get('full_name')||g.name.toLowerCase().includes(u.searchParams.get('full_name').slice(7,-1).toLowerCase()))).map(g=>({id:g.id,guide_id:g.guideId,full_name:g.name,first_name:g.first,last_name:g.last,needs_eval:true,priority:g.priority,evaluator_id:g.evaluatorId,tour_date:g.date,tour_time:g.time,status:g.status}));
 if(table==='evals'&&opts.method==='PATCH')result=[{id:'eval-one',...payload}];
 return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const mods=(await import('/js/modules/workspace.js')).default;const router=await import('/js/core/router.js');mods.forEach(router.register);
 for(const id of ['today','evals','directory','schedule','training','interviews','desks','people','announcements','health']){const mod=(await import('/js/modules/'+id+'.js')).default;router.register(mod);}
 document.querySelector('#app').hidden=false;document.querySelector('#gate').hidden=true;document.documentElement.dataset.theme='dark';router.buildNav();
 const {initVanessa,openVanessa}=await import('/js/core/vanessa-ui.js');initVanessa();document.addEventListener('hub:ask',e=>openVanessa(e.detail.question));
 (await import('/js/core/command-palette.js')).initCommandPalette();
 let mounted=null;window.__mount=async id=>{mounted?.unmount?.();const mod=router.list().find(m=>m.id===id);mounted=mod;document.body.dataset.route=id;await mod.mount(document.querySelector('#view'));};
 await window.__mount('command-center');
});
console.log('Command center mounted');await page.getByText('Here’s what needs you, Morgan.').waitFor();
assert(await page.getByText('1 recorded changes you can access.').count());
if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'command-center-desktop.png'),fullPage:true,timeout:10000,animations:'disabled'});
let checks=2;
for(const width of [1440,390]){
 await page.setViewportSize({width,height:900});
 for(const id of ['command-center','operations','reminders','notifications','activity','analytics','memory','today','evals','directory','schedule','training','interviews','desks','people','announcements','health']){
  console.log('Audit',width,id);await page.evaluate(id=>window.__mount(id),id);
  await page.locator('#view').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.__asks),0,`${id}: ordinary click opened Vanessa`);checks++;
  const overflow=await page.locator('#view').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert(!overflow,`${id} overflow at ${width}`);checks++;
 }
}
await page.evaluate(()=>window.__mount('training'));
for(const name of ['Absence form','Attendance','Makeups owed','Attendance']){await page.locator('#tr-tabs').getByRole('button',{name,exact:true}).click();assert.equal(await page.evaluate(()=>window.__asks),0,`Training ${name} opened Vanessa`);checks++;}
await page.getByLabel('Show one session',{exact:true}).selectOption('session-fixture');assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
await page.getByLabel('Attendance',{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
await page.getByRole('button',{name:'＋ Session',exact:true}).click();assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
// Repeated Home visits must never multiply assistant handlers.
for(let i=0;i<3;i++)await page.evaluate(()=>window.__mount('today'));
await page.locator('button[data-vanessa-ask]').first().click();await page.waitForFunction(()=>window.__asks===1);checks++;
await page.locator('#v-close').click();
await page.evaluate(()=>window.__mount('reminders'));
await page.getByLabel('Remind me to',{exact:true}).fill('Prepare evaluation notes');await page.getByLabel('Due',{exact:true}).fill('2026-10-01T15:00');await page.getByRole('button',{name:'Create reminder',exact:true}).click();await page.getByText('Prepare evaluation notes',{exact:true}).waitFor();checks++;
await page.getByRole('button',{name:'Complete',exact:true}).last().click();await page.getByText('Prepare evaluation notes',{exact:true}).waitFor({state:'detached'});checks++;
await page.evaluate(()=>window.__mount('notifications'));await page.getByRole('button',{name:'Mark all as read',exact:true}).click();await page.getByText('reminder · Read',{exact:true}).waitFor();checks++;
await page.keyboard.press('Control+k');await page.getByRole('combobox',{name:'Search the Hub or ask Vanessa'}).fill('notifications');assert((await page.getByRole('option').allTextContents()).some(x=>x.startsWith('Notifications')));checks++;
await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForURL(/#\/notifications$/);await page.getByText('Stay in the loop.').waitFor();checks++;
await page.keyboard.press('Control+k');await page.keyboard.press('Escape');assert(!await page.locator('dialog').evaluate(el=>el.open));checks++;
await page.evaluate(()=>window.__mount('command-center'));await page.getByRole('textbox',{name:'Ask Vanessa',exact:true}).fill('Release Avery Fictional’s eval');await page.locator('#view form button').click();
console.log('Waiting for Vanessa review');await page.getByRole('button',{name:'Confirm',exact:true}).last().waitFor();const before=await page.evaluate(()=>window.__requests.filter(r=>r.table==='hub_agent_action').length);assert.equal(before,0);checks++;
await page.getByRole('button',{name:'Confirm',exact:true}).last().click();await page.getByText('Released the evaluation for Avery Fictional',{exact:true}).waitFor();checks++;
if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'vanessa-platform-mobile.png'),fullPage:true,timeout:10000,animations:'disabled'});
// Keep the conversation while navigating and render actual inline cards.
await page.setViewportSize({width:1440,height:1000});
await page.locator('#v-input').fill('Who needs evaluated?');await page.locator('#v-form button').click();
await page.locator('.v-agent-card').filter({has:page.getByRole('heading',{name:'Avery Fictional',exact:true})}).last().waitFor();checks++;
if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'vanessa-agent-desktop.png'),fullPage:true,animations:'disabled'});
const cardCount=await page.locator('.v-agent-card').count();await page.evaluate(()=>window.__mount('training'));
assert(await page.locator('#v-panel').isVisible());assert.equal(await page.locator('.v-agent-card').count(),cardCount);checks+=2;
const desktop=await page.locator('#v-panel').boundingBox();assert(desktop.width<500);checks++;
await page.locator('#v-size').click();await page.waitForFunction(()=>document.querySelector('#v-panel').getBoundingClientRect().width>600);assert((await page.locator('#v-panel').boundingBox()).width>600);checks++;
await page.locator('#v-size').click();
await page.locator('#v-close').click();await page.locator('#v-panel').waitFor({state:'hidden'});await page.locator('#v-launch').dispatchEvent('click');assert.equal(await page.locator('.v-agent-card').count(),cardCount);checks++;
await page.setViewportSize({width:390,height:900});
const bounds=await page.locator('#v-panel').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);checks++;
if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'vanessa-agent-mobile.png'),fullPage:true,animations:'disabled'});
assert.deepEqual(errors,[]);checks++;
console.log(`${checks} platform UI checks passed (desktop, mobile, reminders, notifications, keyboard palette, reviewed Vanessa release).`);
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
