// Isolated browser integration QA. No requests can reach Supabase or other hosts.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({headless:true,channel:'chrome'});
 let checks=0;const ok=(value,label)=>{assert.ok(value,label);checks++;console.log('ok',label)};
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='hub.test')return route.abort();const file=path.resolve(root,u.pathname.slice(1)||'index.html');if(!file.startsWith(root+path.sep))return route.abort();try{let body=fs.readFileSync(file);if(file.endsWith('index.html'))body=body.toString().replace('<script type="module" src="js/main.js"></script>','').replace('<script src="config.js"></script>','');await route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{await route.fulfill({status:404,body:''})}});
 await page.goto('http://hub.test/index.html',{waitUntil:'commit'});
 await page.evaluate(async()=>{
  window.CONFIG={SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'fixture'};
  const {state}=await import('/js/core/state.js');window.__state=state;state.me={id:'alice',full_name:'Alex Same'};state.role={is_admin:true,in_recruitment:true};
  const candidate=(id,name)=>({id,cycle_id:'cycle',name,checked_in:true,checked_in_at:'2026-10-07',group_name:'A'});
  window.__cands=[candidate('a','Avery Fictional'),candidate('b','Blair Fictional'),candidate('c','Casey Fictional')];window.__samples=[];
  window.__rows=[{candidate_id:'a',interviewer_id:'bob',speaking:5,personable:5,impression:5,note:'Other interviewer'}];
  window.__writes=[];window.__fail=false;window.__delay=0;window.__empty=false;
  window.fetch=async(url,opts={})=>{
   const table=new URL(url).pathname.split('/').at(-1);let result=[];
   if(table==='interview_cycles')result=[{id:'cycle',label:'Fall 2026'}];
   if(table==='candidate_results')result=window.__cands;
   if(table==='interview_samples')result=window.__samples;
   if(table==='members')result=[{id:'alice',full_name:'Alex Same',active:true},{id:'bob',full_name:'Alex Same',active:false},{id:'carol',full_name:'Carol Panel',active:true}];
   if(table==='interview_panel')result=[{member_id:'alice'},{member_id:'bob'},{member_id:'carol'}];
   if(table==='interview_groups')result=[{name:'A'}];
   if(table==='interview_load_samples'){
    let added=0;
    for(const [id,name,n] of [['sample-a','Sample — Avery Example',0],['sample-b','Sample — Blair Example',1],['sample-c','Sample — Casey Example',3]]){
     if(window.__samples.some(s=>s.candidate_id===id))continue;
     window.__samples.push({candidate_id:id});window.__cands.push(candidate(id,name));added++;
     if(n)window.__rows.push({candidate_id:id,interviewer_id:state.me.id,speaking:4,personable:n===3?3:null,impression:n===3?5:null,note:'Fictional example'});
    }
    result={added,total:window.__samples.length};
   }
   if(table==='interview_remove_samples'){
    const ids=window.__samples.map(s=>s.candidate_id);result=ids.length;
    window.__cands=window.__cands.filter(c=>!ids.includes(c.id));window.__rows=window.__rows.filter(r=>!ids.includes(r.candidate_id));window.__samples=[];
   }
   if(table==='interview_scores'){
    if(opts.method==='POST'){
     const row=JSON.parse(opts.body)[0];window.__writes.push({...row});await new Promise(r=>setTimeout(r,window.__delay));
     if(window.__fail)return new Response(JSON.stringify({message:'secret raw database detail'}),{status:500});
     if(window.__empty)return new Response('[]');
     const idx=window.__rows.findIndex(r=>r.candidate_id===row.candidate_id&&r.interviewer_id===row.interviewer_id);
     if(idx<0)window.__rows.push(row);else window.__rows[idx]=row;result=[row];
    }else result=window.__rows;
   }
   return new Response(JSON.stringify(result),{status:200});
  };
  document.querySelector('#gate').hidden=true;document.querySelector('#app').hidden=false;
  window.__mod=(await import('/js/modules/interviews.js')).default;await window.__mod.mount(document.querySelector('#view'));
 });
 const tab=name=>page.getByRole('tab',{name,exact:true});
 ok(await tab('Evaluate').getAttribute('aria-selected')==='true','useful default tab');
 ok(await page.locator('[data-grade]').count()===3,'applicant loading');
 await page.locator('[data-grade="a"]').click();
 ok((await page.locator('#gr-completion').textContent()).includes('3 criteria'),'required criteria shown');
 await page.locator('label[for="gr-spk-4"]').click();
 await page.locator('#gr-note').fill('Detailed notes survive switching');
 await page.locator('#gr-next-candidate').click();
 ok(await page.locator('#gr-g-name').textContent()==='Blair Fictional','next candidate');
 await page.locator('#gr-prev-candidate').click();
 ok(await page.locator('#gr-note').inputValue()==='Detailed notes survive switching','draft preserved when switching');
 await page.waitForFunction(()=>window.__rows.some(r=>r.candidate_id==='a'&&r.interviewer_id==='alice'&&r.note.includes('survive')));
 await page.locator('label[for="gr-per-3"]').click();await page.locator('label[for="gr-imp-5"]').click();
 await page.waitForFunction(()=>document.querySelector('#gr-completion').textContent.startsWith('Complete'));
 ok((await page.locator('#gr-save-state').textContent())==='Saved','verified autosave');
 ok(await page.evaluate(async()=>{const {interviewData}=await import('/js/modules/interviews.js');return interviewData().candidates[0].scores['Alex Same']?.spk===4 && interviewData().candidates[0].raters===2}),'overview and Vanessa compatibility snapshot updates');
 ok(await page.evaluate(()=>window.__rows.find(r=>r.interviewer_id==='bob').note)==='Other interviewer','other interviewer isolated despite identical names');
 await page.evaluate(()=>{window.__delay=600});
 await page.locator('label[for="gr-spk-1"]').click();await page.locator('#gr-g-save').click();
 await page.locator('label[for="gr-spk-2"]').click();await page.locator('label[for="gr-spk-5"]').click();
 await page.locator('#gr-next-candidate').click();await page.locator('#gr-note').fill('Blair note');
 await page.waitForFunction(()=>window.__rows.find(r=>r.candidate_id==='a'&&r.interviewer_id==='alice')?.speaking===5);
 ok(true,'rapid changes during pending write serialize latest score');
 await page.waitForFunction(()=>window.__rows.find(r=>r.candidate_id==='b'&&r.interviewer_id==='alice')?.note==='Blair note');
 ok(true,'candidate switch during pending save preserves both rows');
 await page.evaluate(()=>{window.__fail=true;window.__delay=0});
 await page.locator('#gr-note').fill('Offline draft');await page.locator('label[for="gr-spk-2"]').click();
 await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent.includes('couldn’t'));
 ok(await page.locator('#gr-note').inputValue()==='Offline draft','failed save retains comments');
 ok(!(await page.locator('#gr-save-state').textContent()).includes('secret'),'raw error hidden');
 ok(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}),'unsaved navigation warns');
 await page.evaluate(()=>window.__fail=false);await page.locator('#gr-g-save').click();
 await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent==='Saved');ok(true,'retry succeeds');
 await page.evaluate(()=>window.__empty=true);await page.locator('#gr-note').fill('Empty response');
 await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent.includes('couldn’t'));ok(true,'empty write response never reports Saved');
 await page.evaluate(()=>window.__empty=false);await page.locator('#gr-g-save').click();await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent==='Saved');
 await page.locator('#gr-modal [data-close]').last().click();
 ok((await page.locator('#gr-body').textContent()).includes('1 / 3 complete'),'completion excludes partial evaluations');
 await page.locator('#gr-status').selectOption('Complete');ok(await page.locator('[data-grade]').count()===1,'completion filter');await page.locator('#gr-status').selectOption('');
 await page.locator('#gr-search').fill('fictional avery');await page.waitForFunction(()=>document.querySelectorAll('[data-grade]').length===1);ok(true,'instant forgiving search');await page.locator('#gr-search').fill('');
 await tab('Results').click();ok((await page.locator('#gr-body').textContent()).includes('2 / 3 complete'),'results expected panel count');
 ok((await page.locator('#gr-body').textContent()).includes('Final = mean'),'ranking method explained');
 await page.locator('button[data-open="a"]').click();ok((await page.locator('#gr-d-body').textContent()).includes('Other interviewer'),'inactive member comments preserved');
 ok((await page.locator('#gr-d-body').textContent()).includes('Carol Panel'),'missing evaluator named');
 ok(await page.locator('[data-clear]').count()===1,'admin cannot clear another evaluator');await page.locator('#gr-detail [data-close]').last().click();
 await tab('Setup').click();ok(await page.locator('[data-panel]').count()===3,'admin panel configuration');
 await tab('Check in').click();await page.evaluate(async()=>{window.__mod.unmount();await window.__mod.mount(document.querySelector('#view'))});ok(await tab('Check in').getAttribute('aria-selected')==='true','last tab remembered');
 await tab('Evaluate').click();await page.locator('[data-grade="a"]').click();
 await page.locator('#gr-spk-1').focus();await page.keyboard.press('ArrowRight');ok(await page.locator('#gr-spk-2').isChecked(),'keyboard scoring');
 await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent==='Saved');
 await page.screenshot({path:process.env.QA_OUTPUT+'/interviews-laptop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile no page overflow');
 ok(await page.locator('#gr-note').isVisible(),'mobile comments visible');
 await page.locator('#gr-next-candidate').click();ok(await page.locator('#gr-g-name').textContent()==='Blair Fictional','mobile candidate navigation');
 await page.screenshot({path:process.env.QA_OUTPUT+'/interviews-mobile.png',fullPage:true});
 await page.locator('#gr-modal [data-close]').last().click();
 await page.evaluate(async()=>{window.__mod.unmount();window.__state.role.is_admin=false;await window.__mod.mount(document.querySelector('#view'))});
 ok(await tab('Setup').count()===0 && await tab('Applicants').count()===0,'normal interviewer has no admin tabs');
 await tab('Evaluate').click();await page.locator('[data-grade="c"]').click();
 await page.evaluate(()=>window.__fail=true);await page.locator('#gr-note').fill('Recovery belongs to Alice');
 await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent.includes('couldn’t'));
 await page.evaluate(async()=>{
  window.__mod.unmount();const {clearSession}=await import('/js/core/state.js');clearSession();
  window.__state.me={id:'bob',full_name:'Alex Same'};window.__state.role={in_recruitment:true,is_admin:false};window.__fail=false;
  await window.__mod.mount(document.querySelector('#view'));
 });
 await page.locator('[data-grade="c"]').click();ok(await page.locator('#gr-note').inputValue()==='','account switch does not expose another draft');
 await page.locator('#gr-modal [data-close]').last().click();
 await page.evaluate(async()=>{
  window.__mod.unmount();const {clearSession}=await import('/js/core/state.js');clearSession();
  window.__state.me={id:'alice',full_name:'Alex Same'};window.__state.role={in_recruitment:true,is_admin:false};
  await window.__mod.mount(document.querySelector('#view'));window.__beforeRecovery=window.__writes.length;
 });
 await page.locator('[data-grade="c"]').click();ok(await page.locator('#gr-note').inputValue()==='Recovery belongs to Alice','same account recovers unsaved draft');
 ok((await page.locator('#gr-save-state').textContent()).includes('Recovered'),'recovered draft shown as unsaved');
 await page.locator('#gr-prev-candidate').click();await page.locator('#gr-next-candidate').click();
 ok(await page.evaluate(()=>window.__writes.length===window.__beforeRecovery),'navigation never auto-applies recovered draft');
 await page.locator('#gr-g-save').click();await page.waitForFunction(()=>document.querySelector('#gr-save-state').textContent==='Saved');
 ok(await page.evaluate(()=>window.__rows.find(r=>r.candidate_id==='c'&&r.interviewer_id==='alice').note)==='Recovery belongs to Alice','explicit recovery retry saves exact draft');
 await page.locator('#gr-modal [data-close]').last().click();
 await tab('Results').click();await page.locator('#gr-refresh-results').click();ok((await page.locator('#gr-body').textContent()).includes('2 / 3 complete'),'manual results refresh');
 await page.evaluate(async()=>{window.__mod.unmount();window.__state.role.is_admin=true;await window.__mod.mount(document.querySelector('#view'))});
 await tab('Setup').click();await page.getByRole('button',{name:'Load sample data',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#gr-body').textContent.includes('3 sample applicants currently loaded'));
 ok(true,'admin can import fictional sample data');
 await page.getByRole('button',{name:'Load sample data',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#gr-load-samples').disabled);
 ok(await page.evaluate(()=>window.__samples.length===3),'repeat sample import creates no duplicates');
 await tab('Evaluate').click();ok(await page.locator('[data-grade]').count()===6,'sample candidates available for scoring');
 ok((await page.locator('[data-grade="sample-b"]').textContent()).includes('In Progress')&&(await page.locator('[data-grade="sample-c"]').textContent()).includes('Complete'),'sample data demonstrates completion states');
 await page.waitForFunction(()=>document.querySelectorAll('#toasts .toast').length===0);
 await page.screenshot({path:process.env.QA_OUTPUT+'/interviews-sample-data.png',fullPage:true});
 await tab('Results').click();ok((await page.locator('#gr-body').textContent()).includes('fictional sample data'),'results identify sample data');
 await tab('Setup').click();await page.getByRole('button',{name:'Remove sample data',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#gr-body').textContent.includes('0 sample applicants currently loaded'));
 ok(await page.evaluate(()=>window.__cands.length===3&&window.__rows.some(r=>r.candidate_id==='a'&&r.interviewer_id==='alice')),'sample cleanup retains original candidates and evaluations');
 ok(errors.length===0,`no browser errors: ${errors}`);
 console.log(`${checks} interview browser checks passed.`);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
