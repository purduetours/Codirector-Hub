// Verifies the standalone fix against either this checkout or HUB_TEST_ROOT.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(process.env.HUB_TEST_ROOT||path.join(__dirname,'..'));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='hub.test')return route.abort();const file=path.resolve(root,u.pathname.slice(1)||'index.html');if(!file.startsWith(root+path.sep))return route.abort();try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('<script type="module" src="js/main.js"></script>','').replace('<script src="config.js"></script>','');await route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{await route.fulfill({status:404,body:''});}});
 await page.goto('http://hub.test/index.html');
 await page.evaluate(async()=>{
 window.CONFIG={SUPABASE_URL:'https://example.invalid',SUPABASE_KEY:'fixture'};
 const {state}=await import('/js/core/state.js');state.me={id:'fixture',full_name:'Fixture Owner'};state.role={is_admin:true,in_training:true,in_recruitment:true};state.loadedAt=new Date();state.term={id:'test'};
 state.guides=[{id:'eval-fixture',guideId:'guide-fixture',name:'Avery Fictional',first:'Avery',last:'Fictional',priority:'First Priority',rank:1,status:'open',evaluatorId:null,submitted:false,skip:false,date:'',time:'',tours:[]}];state.counts={open:1};state.neededTotal=1;
 window.fetch=async url=>{const table=new URL(url).pathname.split('/').at(-1);return new Response(JSON.stringify(table==='training_sessions'?[{id:'session-fixture',term_id:'test',label:'September 21st',held_on:'2026-09-21'}]:table==='training_attendance'?[{id:'attendance-fixture',session_id:'session-fixture',person_name:'Avery Fictional',actual:'Attended',expectation:''}]:[]));};
 document.querySelector('#gate').hidden=true;document.querySelector('#app').hidden=false;
 const router=await import('/js/core/router.js');const modules=[];for(const id of ['today','training','evals','interviews','directory','schedule','desks','announcements','people','health']){const mod=(await import('/js/modules/'+id+'.js')).default;modules.push(mod);router.register(mod);}router.buildNav();
 window.__asks=0;document.addEventListener('hub:ask',()=>window.__asks++);
 let current=null;window.__mount=async(id,teardown=true)=>{if(teardown)current?.unmount?.();current=modules.find(m=>m.id===id);document.body.dataset.route=id;await current.mount(document.querySelector('#view'));};
 });
 let checks=0;
 // Without teardown, route/selector scoping alone must prevent leakage.
 await page.evaluate(()=>window.__mount('today'));
 await page.locator('#hm-ask-input').click();assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
 await page.evaluate(()=>window.__mount('training',false));
 for(const name of ['Absence form','Attendance','Makeups owed','Attendance']){await page.locator('#tr-tabs').getByRole('button',{name,exact:true}).click();assert.equal(await page.evaluate(()=>window.__asks),0,name);checks++;}
 await page.getByLabel('Show one session',{exact:true}).selectOption('session-fixture');assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
 await page.getByLabel('Attendance',{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
 await page.getByRole('button',{name:'＋ Session',exact:true}).click();assert.equal(await page.evaluate(()=>window.__asks),0);checks++;
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});for(const id of ['evals','interviews','directory','schedule','desks','announcements','people','health']){await page.evaluate(()=>window.__mount('today'));await page.evaluate(id=>window.__mount(id),id);await page.locator('#view').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.__asks),0,`${id} ordinary click`);checks++;}}
 for(let i=0;i<3;i++)await page.evaluate(()=>window.__mount('today'));
 await page.locator('button[data-vanessa-ask]').first().click();assert.equal(await page.evaluate(()=>window.__asks),1);checks++;
 assert.deepEqual(errors,[]);checks++;
 console.log(`${checks} click-isolation checks passed against ${root}.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
