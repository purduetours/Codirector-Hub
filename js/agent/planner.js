import { visibleAttention, muteAttention } from './attention.js';
import { state, inTraining, isAdmin, onSessionReset } from '../core/state.js';
import { workContext } from '../core/vanessa-work.js';
import { inspectMemory } from '../services/memory.js';
import { attachOpportunities } from '../services/agent-data.js';
import { callTool, approveTool } from './tools.js';
import { parseTimeWindow, zonedParts, localInstant, addDays } from './time.js';
import { agentContext, setAgentContext, clearAgentContext, progress } from './context.js';
const reply=text=>({type:'reply',text});
let pending=null,lastTask=null,clarification=null;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
export function resetAgent(){if(pending)pending.cancelled=true;pending=null;lastTask=null;clarification=null;clearAgentContext();}
onSessionReset(resetAgent);
export const taskSnapshot=()=>lastTask?{goal:lastTask.goal,status:lastTask.status,steps:lastTask.steps.map(s=>({tool:s.tool,status:s.status})),confirmation:lastTask.confirmed}:null;
async function read(name,args,label){progress(label);const r=await callTool(name,args);if(!r.ok){const e=new Error(r.error.message);e.code=r.error.code;throw e;}return r.data;}
const shortTime=value=>value?new Date(value).toLocaleString(undefined,{timeZone:'America/Indiana/Indianapolis'}):'Not scheduled';
const snapshot=g=>({id:g.id,expectedOwner:g.evaluatorId||null,expectedDate:g.date||null,expectedTime:g.time||null});
function choice(items,title,select){if(!items.length)return reply('I couldn’t find a matching record you can act on.');if(items.length===1)return select(items[0]);return {type:'select',title,options:items.slice(0,20).map(x=>({label:x.name||x.title,sub:[x.date,x.time].filter(Boolean).join(' '),run:safeCallback(()=>select(x))}))};}
function safeCallback(run){const owner=state.me?.id,version=state.sessionVersion;return async()=>{if(owner!==state.me?.id||version!==state.sessionVersion)return reply('Your account changed. Ask again from the current account.');const result=await run();if(owner!==state.me?.id||version!==state.sessionVersion){clearAgentContext();return reply('Your account changed. Ask again from the current account.');}return result;};}
function failure(error,successful=[]){return {type:'summary',title:successful.length?'Partly completed':'I couldn’t complete that',text:[...successful,error.message].join('\n'),actions:error.code==='conflict'?[{label:'Show remaining evaluations',run:()=>opportunities('Find available evaluations this week')}]:[]};}
export function reviewTask(goal,steps,summary){
 if(pending)pending.cancelled=true;
 const task={id:uuid(),goal,owner:state.me?.id,version:state.sessionVersion,steps:steps.map(s=>({...s,requestId:uuid(),status:'pending'})),confirmed:false,status:'review',cancelled:false,running:false};
 pending=lastTask=task;
 return {type:'confirm',title:'Review this task',text:summary,rows:steps.map((s,i)=>[String(i+1),s.label]),confirm:{label:steps.length>1?'Confirm task':'Confirm',run:()=>{
  if(pending!==task||task.cancelled)return reply('That review is no longer active. Ask again.');task.confirmed=true;return executeTask(task);
 }},cancel:{label:'Cancel',run:()=>cancelTask(task)}};
}
function cancelTask(task){task.cancelled=true;if(pending===task)pending=null;return reply(task.running?'I’ll stop after the current request finishes. A request already sent cannot be cancelled.':task.steps.some(s=>s.status==='completed')?'Stopped. Changes already completed remain saved.':'Cancelled. Nothing changed.');}
async function executeTask(task){
 if(task.running)return reply('This task is already running.');
 if(!task.confirmed||task.cancelled)return reply('Review this task again before continuing.');
 if(task.owner!==state.me?.id||task.version!==state.sessionVersion)return reply('Your account changed. Start a new task.');
 task.running=true;task.status='running';
 try{
  for(const step of task.steps){
   if(step.status==='completed')continue;
   if(task.cancelled){task.status='stopped';break;}
   step.status='running';progress(step.label+'…');
   const approval=approveTool(step.tool,step.args,step.requestId);
   const result=await callTool(step.tool,step.args,{requestId:step.requestId,approval});
   if(!result.ok){step.status='failed';task.status='failed';
    const completed=task.steps.filter(s=>s.status==='completed').map(s=>s.receipt.summary);
    return {type:'summary',title:completed.length?'Partly completed':'Task needs attention',text:[...completed,result.error.message,'Later dependent steps were not run.'].join('\n'),actions:[...(result.error.code==='conflict'?[{label:'Find available evaluations',run:()=>opportunities('Find available evaluations this week')}]:[]),...(result.error.code!=='conflict'?[{label:'Retry unfinished step',run:()=>executeTask(task)}]:[]),{label:'Stop task',run:()=>cancelTask(task)}]};
   }
   step.receipt=result.data;step.status='completed';
  }
  task.status=task.cancelled?'stopped':'completed';if(pending===task)pending=null;
  return {type:'summary',title:task.cancelled?'Stopped after saving the current change':'Done',text:task.steps.filter(s=>s.status==='completed').map(s=>s.receipt.summary).join('\n'),rows:task.steps.filter(s=>s.status==='completed').map(s=>['Saved',shortTime(s.receipt.created_at)]),actions:[{label:'View action history',run:showHistory}]};
 }finally{task.running=false;progress(null);}
}
async function prepareEvaluation(id,action,schedule){
 const page=await read('evaluations',{ids:[id],status:'all',limit:1},'Checking the latest evaluation');const g=page.items[0];
 if(!g||g.submitted)return reply('This evaluation is unavailable or already submitted.');
 if(action==='claim'&&g.evaluatorId)return {type:'reply',text:'That evaluation was just claimed by someone else.',actions:[{label:'Show available evaluations',run:()=>opportunities('Find available evaluations this week')}]};
 if(action==='release'&&g.evaluatorId!==state.me.id&&!isAdmin())return reply('You can only release your own evaluation.');
 const args={...snapshot(g),...(action==='claim'?{date:schedule?.date||g.date||null,time:schedule?.time||g.time||null}:{})};
 return reviewTask(action+' evaluation',[{tool:'evaluation.'+action,args,label:`${action==='claim'?'Claim':'Release'} ${g.name}’s evaluation`}],`${action==='claim'?'Claim':'Release'} ${g.name}’s evaluation${args.date?' on '+args.date+' at '+(args.time||'an unset time'):g.date?' on '+g.date:''}?`);
}
function evalCard(g,tour){return {kind:'evaluation',title:g.name,fields:[['Status',g.submitted?'Submitted':g.evaluatorId?'Claimed':'Available'],['Tour',tour?`${tour.date} ${tour.start}`:[g.date,g.time].filter(Boolean).join(' ')||'Choose a tour']],actions:[{label:'Open',run:safeCallback(async()=>{const r=await callTool('openEvaluation',{id:g.id});return reply(r.ok?'Opened '+g.name+'’s evaluation.':r.error.message);})},...(!g.evaluatorId&&!g.submitted?[{label:'Claim',run:safeCallback(()=>prepareEvaluation(g.id,'claim',tour?{date:tour.date,time:tour.start}:null))}]:[])]};}
function tourCard(t){return {kind:'tour',title:t.guide,fields:[['Tour',`${t.date} ${t.start||t.slot}`],['Evaluation',t.evaluation?(!t.evaluation.evaluatorId?'Available':t.evaluation.evaluator||'Claimed'):'No confident match']],actions:t.evaluation?evalCard(t.evaluation,t).actions:[{label:'Open schedule',run:safeCallback(async()=>{const r=await callTool('navigate',{id:'schedule'});return reply(r.ok?'Opened the schedule.':r.error.message);})}]};}
function windowArgs(w){return Object.fromEntries(['from','to','after','before','at'].filter(k=>w[k]).map(k=>[k,w[k]]));}
async function evaluations(q,openOldest=false){
 const w=parseTimeWindow(q);if(w.error)return reply(w.error);
 const args={status:/overdue/i.test(q)?'overdue':'outstanding',mine:/\bmy\b/i.test(q),limit:50,...(w.explicit?windowArgs(w):Object.fromEntries(['after','before','at'].filter(k=>w[k]).map(k=>[k,w[k]])))};
 const data=await read('evaluations',args,'Checking evaluations');
 setAgentContext('evaluations',data.items,{query:args});
 const result={type:'summary',title:'Evaluations needing attention',text:`${data.items.length}${data.nextOffset!==null?'+':''} matching evaluations in this page.`,cards:data.items.slice(0,12).map(g=>evalCard(g)),more:[w.convention,'Current-term records you are authorized to view.',data.nextOffset!==null?'There are more results; narrow the date range or load another page.':''].filter(Boolean).join(' '),actions:data.nextOffset!==null?[{label:'More evaluations',run:()=>evaluationNext(args,data.nextOffset)}]:[]};
 if(openOldest&&data.items.length){if(data.nextOffset!==null)return {...result,more:'Narrow the results before opening the oldest; this page is not the full result set.'};const sorted=[...data.items].filter(g=>g.date).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99').localeCompare(b.time||'99'));if(!sorted.length)return {...result,more:'None of these has a scheduled date, so there is no reliable oldest one.'};const r=await callTool('openEvaluation',{id:sorted[0].id});result.text+=r.ok?` Opened ${sorted[0].name}’s earliest scheduled evaluation.`:' '+r.error.message;}
 return result;
}
async function evaluationNext(args,offset){const data=await read('evaluations',{...args,offset},'Loading more evaluations');setAgentContext('evaluations',data.items,{query:{...args,offset}});return {type:'summary',title:'More evaluations',cards:data.items.map(g=>evalCard(g)),actions:data.nextOffset!==null?[{label:'More evaluations',run:()=>evaluationNext(args,data.nextOffset)}]:[]};}
async function opportunities(q,contextIds=null,earliest=false,savedRange=null){
 const w=savedRange||parseTimeWindow(q);if(w.error)return reply(w.error);
 const tourArgs=windowArgs(w),evalArgs={status:contextIds?'all':'available',limit:100,...(contextIds?{ids:contextIds}:{})};
 const evals=await read('evaluations',evalArgs,'Finding eligible evaluations');
 const tours=await read('tours',{...tourArgs,limit:100},'Checking the tour schedule');
 const mine=await read('evaluations',{mine:true,from:w.from,to:w.to,limit:100},'Checking your evaluation schedule');
 const joined=(await attachOpportunities(evals.items,tours.items)).filter(t=>t.evaluation);
 for(const t of joined)t.conflict=mine.items.some(g=>g.date===t.date&&g.time===t.start);
 const view=earliest?joined.slice(0,1):joined;
 setAgentContext('tours',view,{evaluationIds:evals.items.map(g=>g.id),range:tourArgs,tourIds:view.map(t=>t.id)});
 return {type:'summary',title:earliest?'Earliest matching tour':'Evaluation opportunities',text:joined.length?`${joined.length} matching guide assignments; ${joined.filter(t=>t.conflict).length} collide with one of your evaluations.`:'No matching scheduled opportunities were found in the records checked.',cards:view.slice(0,12).map(t=>({...tourCard(t),fields:[...tourCard(t).fields,['Your schedule',t.conflict?'Same-time evaluation conflict':'No same-time evaluation found']]})),more:[evals.nextOffset!==null||tours.nextOffset!==null||mine.nextOffset!==null?'Results are partial (100-record page limits). Narrow the date range.':'',w.convention,'Availability checks cover evaluation start times only, not personal calendars, travel time or tour duration.'].filter(Boolean).join(' ')};
}
async function scheduleReview(q){
 const w=parseTimeWindow(q);if(w.error)return reply(w.error);
 const tours=await read('tours',{...windowArgs(w),limit:100},'Checking the schedule');
 let rows=tours.items,notes=[tours.limitation];
 if(inTraining()){
  const evals=await read('evaluations',{status:'outstanding',limit:100},'Checking evaluation coverage');
  rows=await attachOpportunities(evals.items,tours.items);
  notes.push(`${rows.filter(t=>t.evaluation&&!t.evaluation.evaluatorId).length} guide assignments have an outstanding, unclaimed evaluation.`);
  if(evals.nextOffset!==null)notes.push('Evaluation matching is partial; narrow the query for more precise coverage.');
 }
 if(tours.nextOffset!==null)notes.push('Only the first 100 assignments were checked.');
 setAgentContext('tours',rows,{range:windowArgs(w),tourIds:rows.map(t=>t.id)});
 return {type:'summary',title:`Tours ${w.from===w.to?'on '+w.from:w.from+' through '+w.to}`,text:`${rows.length}${tours.nextOffset!==null?'+':''} guide assignments.`,cards:rows.slice(0,12).map(tourCard),more:notes.join(' ')};
}
async function overdueTasks(){
 const reminders=await read('reminders',{overdue:true,limit:50},'Checking your due reminders');
 const evals=inTraining()?await read('evaluations',{status:'overdue',mine:true,limit:50},'Checking overdue evaluations'):{items:[]};
 const items=[...evals.items.map(g=>({id:g.id,kind:'evaluation',name:g.name})),...reminders.items.map(r=>({id:r.id,kind:'reminder',title:r.title}))];setAgentContext('tasks',items,{items:items.map(({id,kind})=>({id,kind}))});
 return {type:'summary',title:'Your unfinished work',text:items.length?`${items.length} items in the records checked. I can open an evaluation for your feedback or complete a reminder after review.`:'No overdue work was found in the records checked.',cards:[...evals.items.map(g=>evalCard(g)),...reminders.items.map(r=>({kind:'reminder',title:r.title,fields:[['Due',shortTime(r.due_at)]],actions:[{label:'Mark complete',run:safeCallback(()=>completeReminder(r))}]}))].slice(0,12),more:'An overdue evaluation means its scheduled tour date has passed; I won’t invent feedback or submit it for you.'};
}
function completeReminder(r){return reviewTask('Complete reminder',[{tool:'reminder.complete',args:{id:r.id},label:'Complete “'+r.title+'”'}],'Mark this reminder complete?');}
async function resolveEvaluation(q,run){
 let range=parseTimeWindow(q);if(range.error)return reply(range.error);
 let args={status:/^(?:please )?claim\b/i.test(q)?'available':'outstanding',mine:/\bmy\b/i.test(q)||(/^release\b/i.test(q)&&!isAdmin()),limit:50};
 if(/claimed yesterday/i.test(q)){args.claimedOn=addDays(zonedParts().date,-1);args.mine=true;}
 else if(range.explicit){args.from=range.from;args.to=range.to;}
 for(const k of ['after','before','at'])if(range[k])args[k]=range[k];
 const context=workContext()?.data;
 if(/\b(this|that|it|earlier)\b/i.test(q)){
  const mem=inspectMemory().items.filter(x=>['evaluation','guide'].includes(x.kind));const ids=context?.evalId||context?.id?[context.evalId||context.id]:mem.filter(x=>x.kind==='evaluation').map(x=>x.id);
  if(!ids.length)return reply('Which evaluation do you mean? Open it or give the guide’s name.');args.ids=ids;
 }else{
  const name=q.replace(/^(?:please )?(?:release|claim|open|show me)\s+/i,'').replace(/(?:['’]s)?\s+eval(?:uation)?s?\b.*$/i,'').replace(/\b(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\b(?:today|tomorrow)|\d{4}-\d{2}-\d{2}/ig,'').trim();
  if(!/^(?:my|the|an?|oldest|first)\b/i.test(name)&&name)args.name=name;
 }
 const page=await read('evaluations',args,'Finding the right evaluation');
 if(page.nextOffset!==null)return reply('There are more than 50 matches. Add a guide name or a specific date.');
 return choice(page.items,'Which evaluation?',run);
}
function reminderClause(raw){
 const q=raw.replace(/^(?:and\s+)?/i,'');const m=/^(?:remind me\s+(.+?)\s+to\s+(.+)|remind me to\s+(.+))$/i.exec(q);
 if(!m)return {error:'Say “remind me tomorrow to pick another evaluation,” with a task and date.'};
 const phrase=m[1]||m[3],w=parseTimeWindow(phrase);if(w.error)return w;
 if(!w.explicit||w.from!==w.to)return {error:'Which day should I remind you? Include tomorrow, a weekday, or YYYY-MM-DD.'};
 let title=m[2]||m[3].replace(/\b(?:today|tomorrow|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2})\b/ig,'').replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/ig,'').trim();
 if(!title)return {error:'What should the reminder say?'};
 return {title,dueAt:localInstant(w.from,w.at||'09:00'),date:w.from,time:w.at||'09:00'};
}
async function releaseAndRemind(q){
 const parts=q.split(/\s+and\s+(?=remind me\b)/i);if(parts.length!==2)return reply('Give one release request followed by “and remind me [day] to [task].”');
 const reminder=reminderClause(parts[1]);if(reminder.error)return reply(reminder.error);
 return resolveEvaluation(parts[0],g=>reviewTask('Release evaluation and create reminder',[
  {tool:'evaluation.release',args:snapshot(g),label:`Release ${g.name}’s evaluation`},
  {tool:'reminder.create',args:{title:reminder.title,dueAt:reminder.dueAt},label:`Create “${reminder.title}” for ${reminder.date} at ${reminder.time} (Purdue time)`}
 ],'I’ll release this evaluation first, then create the reminder only if the release succeeds.'));
}
async function tourReference(q){
 const c=agentContext();const w=parseTimeWindow(q.replace(/\b(?:that|the)\s+(?=\d)/i,'at '));if(w.error)return reply(w.error);
 if(!w.explicit&&!c?.range)return reply('Which day is that tour? Include a date or ask for a schedule first.');
 const args={...(w.explicit?windowArgs(w):c.range),...(w.at?{at:w.at}:{}),limit:100};
 const data=await read('tours',args,'Finding the selected tour');const rows=data.items.filter(t=>w.explicit||!c.tourIds||c.tourIds.includes(t.id));
 if(data.nextOffset!==null)return reply('There are more than 100 matching assignments. Add a date and time.');
 return choice(rows.map(t=>({...t,name:t.guide,time:t.start})),'Which tour?',async t=>{
  setAgentContext('tours',[t],{range:args,tourIds:[t.id]});
  if(/^claim/i.test(q))return takeFirst();
  return {type:'summary',title:'Selected tour',cards:[tourCard(t)]};
 });
}
async function takeFirst(){
 const c=agentContext();if(!c)return reply('Which item do you mean? Ask for your tasks or evaluations first.');
 if(c.kind==='tasks'||c.kind==='briefing'){
  const first=c.items[0];if(!first)return reply('That list is empty.');
  if(first.kind==='evaluation'){const r=await callTool('openEvaluation',{id:first.id});return reply(r.ok?'Opened the evaluation. Add your actual tour feedback, then review and submit it.':r.error.message);}
  if(first.kind==='tour')return prepareEvaluation(first.evalId,'claim',{date:first.date,time:first.time});
  if(first.kind==='notification')return reviewTask('Mark notification read',[{tool:'notifications.read',args:{ids:[first.id]},label:'Mark the first notification read'}],'Mark the first notification read?');
  const rows=await read('reminders',{limit:100},'Checking your reminder');const r=rows.items.find(r=>r.id===first.id);return r?completeReminder(r):reply('That reminder is no longer in your open reminders. Refresh the list.');
 }
 if(c.kind==='evaluations'&&c.ids.length){
  const rows=await read('evaluations',{ids:[c.ids[0]],status:'all',limit:1},'Checking the first evaluation');const g=rows.items[0];
  if(!g)return reply('That evaluation is no longer available.');
  if(!g.evaluatorId)return prepareEvaluation(g.id,'claim');
  const r=await callTool('openEvaluation',{id:g.id});return reply(r.ok?'Opened the first evaluation.':r.error.message);
 }
 if(c.kind==='tours'){
  const tours=await read('tours',{...c.range,limit:100},'Refreshing the selected tour');
  const first=tours.items.find(t=>t.id===c.tourIds?.[0]);if(!first)return reply('That tour is no longer in this schedule. Refresh the list.');
  if(!inTraining())return {type:'summary',title:'First tour',cards:[tourCard(first)]};
  const evals=await read('evaluations',{status:'outstanding',limit:100},'Checking its evaluation');
  const [match]=await attachOpportunities(evals.items,[first]);
  if(!match.evaluation)return reply('There is no confidently matched outstanding evaluation for this tour. I can’t infer a staffing change from this workbook.');
  if(!match.evaluation.evaluatorId)return prepareEvaluation(match.evaluation.id,'claim',{date:first.date,time:first.start});
  const result=await callTool('openEvaluation',{id:match.evaluation.id});return reply(result.ok?'Opened the evaluation for the first tour.':result.error.message);
 }
 return reply('Tell me which action you want for that item.');
}
export async function showHistory(){const data=await read('actionHistory',{limit:20},'Loading your saved action history');return {type:'summary',title:'Actions performed for you',text:data.items.length?'These tool actions were confirmed by the database.':'No saved tool actions yet.',cards:data.items.map(r=>({kind:'receipt',title:r.summary,fields:[['Saved',shortTime(r.created_at)]],actions:r.eval_id?[{label:'Open evaluation',run:safeCallback(async()=>{const x=await callTool('openEvaluation',{id:r.eval_id});return reply(x.ok?'Opened the evaluation.':x.error.message);})}]:[]})),more:'Latest 20 receipts. No undo is offered when intervening backend changes could make it unsafe.'};}
const recipes=[
 {id:'daily-briefing',match:q=>/^(?:my daily briefing|give me (?:a |my )?daily briefing)$/i.test(q),run:dailyBriefing},
 {id:'release-reminder',match:q=>/^release\b.+\band remind me\b/i.test(q),run:releaseAndRemind},
 {id:'oldest',match:q=>/\bmy evaluations?\b.*\band open the oldest\b/i.test(q),run:q=>evaluations(q,true)},
 {id:'unsupported-chain',match:q=>/^(?:claim|release|unclaim|remind me|create.*reminder)\b.+\band\s+(?:claim|release|delete|remove|create|remind|mark|submit|send)\b/i.test(q),run:()=>reply('I can combine releasing an evaluation with creating a reminder. For this combination, ask for one change at a time so every action can be reviewed.')},
 {id:'tour-reference',match:q=>/^(?:claim|show|open)(?: me)? (?:that|the) (?:\d{1,2}(?::\d{2})?\s*(?:am|pm)? )?tour\b/i.test(q),run:tourReference},
 {id:'evaluation-change',match:q=>/^(?:please )?(?:claim|release)\b/i.test(q),run:q=>resolveEvaluation(q,g=>prepareEvaluation(g.id,/^(?:please )?claim/i.test(q)?'claim':'release'))},
 {id:'reminder-create',match:q=>/^remind me\b/i.test(q),run:q=>{const r=reminderClause(q);return r.error?reply(r.error):reviewTask('Create reminder',[{tool:'reminder.create',args:{title:r.title,dueAt:r.dueAt},label:`Create “${r.title}” for ${r.date} at ${r.time} (Purdue time)`}],'Save this reminder?');}},
 {id:'leadership',match:q=>/^(?:show me |show |inspect |view )?(?:organization workload|evaluation backlog|workload distribution)$/i.test(q),run:async()=>{const r=await read('analytics',{},'Checking organization workload');return {type:'summary',title:'Evaluation workload',rows:r.workload.map(g=>[g.name,`${g.outstanding} outstanding / ${g.total} total`]),more:r.limitation};}},
 {id:'claimed-ref',match:q=>/^release\b.*\bclaimed yesterday\b/i.test(q),run:q=>resolveEvaluation(q,g=>prepareEvaluation(g.id,'release'))},
 {id:'take-first',match:q=>/^(?:take care of|handle|finish) the first (?:one|item)[.!]*$/i.test(q),run:takeFirst},
 {id:'context-tours',match:q=>/^(?:which ones|which of (?:those|them))\b.*\b(?:working|tour|tomorrow|today)\b/i.test(q),run:q=>{const c=agentContext();return c?.kind==='evaluations'?opportunities(q,c.ids):reply('Which group do you mean? Ask for the evaluation list first.');}},
 {id:'earliest-tour',match:q=>/^(?:show me|open|show) the earliest tour[.!]*$/i.test(q),run:async()=>{const c=agentContext();if(c?.kind!=='tours')return reply('Which day or group should I search?');if(c.evaluationIds)return opportunities(`${c.range.from} ${c.range.to}`,c.evaluationIds,true,c.range);const t=await read('tours',{...c.range,limit:100},'Finding the earliest tour');const rows=t.items.filter(x=>c.tourIds.includes(x.id));return {type:'summary',title:'Earliest tour',cards:rows.slice(0,1).map(tourCard),text:rows.length?'Earliest in your current selection.':'No tour remains in that selection.'};}},
 {id:'opportunities',match:q=>/\b(?:could (?:i|take)|i could take|available evaluations?|unclaimed evaluations?)\b/i.test(q),run:q=>opportunities(q)},
 {id:'overdue-tasks',match:q=>/\b(?:my overdue tasks|overdue work|help me finish|everything i need to finish)\b/i.test(q),run:overdueTasks},
 {id:'schedule-review',match:q=>/\b(?:worry about|check the schedule|coverage problems|tours still need attention|tomorrow.?s tours.*(?:coverage|problems))\b/i.test(q),run:q=>/worry about/i.test(q)?dailyBriefing(q):scheduleReview(q)},
 {id:'recent-evals',match:q=>/\b(?:hasn.t|haven.t|not) been evaluated recently\b/i.test(q),run:()=>{clarification={kind:'recency',owner:state.me.id,version:state.sessionVersion,at:Date.now()};return reply('What counts as recently—14 days, 4 weeks, or since a YYYY-MM-DD date? I can check current-term records; missing older history does not prove someone has never been evaluated.');}},
 {id:'outstanding',match:q=>/^(?:who|find everyone|show me|show|find)\b.*\b(?:needs? evaluated|needs? (?:an? )?evaluation|still needs? evaluat|my evaluations? due)\b/i.test(q),run:evaluations},
 {id:'history',match:q=>/\b(?:your action history|vanessa action history|actions (?:you.ve|you have) (?:done|performed)|what have you done for me)\b/i.test(q),run:showHistory}
];
export const recipeCatalog=()=>recipes.map(({id})=>id);
export async function handleAgent(raw){
 const q=String(raw).trim();if(!state.me)return null;
 if(pending&&/^(?:yes|confirm|confirm task|do it|go ahead)[.!]*$/i.test(q)){pending.confirmed=true;return executeTask(pending);}
 if(pending&&/^(?:cancel|stop|never mind|no)[.!]*$/i.test(q))return cancelTask(pending);
 if(lastTask?.status==='failed'&&/^(?:retry|retry task|try again)[.!]*$/i.test(q))return executeTask(lastTask);
 if(clarification){
  const c=clarification;clarification=null;
  if(c.owner===state.me.id&&c.version===state.sessionVersion&&Date.now()-c.at<20*60000){
   const duration=/^(?:(?:last|past) )?(\d{1,3}) (days?|weeks?)[.!]*$/i.exec(q),date=/^(?:since )?(\d{4}-\d{2}-\d{2})[.!]*$/.exec(q);
   const cutoff=duration?addDays(zonedParts().date,-Number(duration[1])*(duration[2].toLowerCase().startsWith('week')?7:1)):date?.[1];
   if(cutoff){try{const data=await read('evaluations',{status:'all',notSince:cutoff,limit:50},'Checking recorded evaluation dates');setAgentContext('evaluations',data.items,{query:{status:'all',notSince:cutoff}});return {type:'summary',title:'No recent current-term submission',text:`${data.items.length}${data.nextOffset!==null?'+':''} records have no current-term submission on or after ${cutoff}.`,cards:data.items.slice(0,12).map(g=>evalCard(g)),more:'This describes visible current-term records only. It does not establish the absence of earlier or inaccessible evaluations.'};}catch(error){return failure(error);}finally{progress(null);}}
  }
 }
 const recipe=recipes.find(r=>r.match(q));
 if(pending){pending.cancelled=true;pending=null;}
 if(!recipe)return null;
 const owner=state.me.id,version=state.sessionVersion;
 try{const result=await recipe.run(q);if(owner!==state.me?.id||version!==state.sessionVersion){clearAgentContext();return reply('Your account changed. Ask again from the current account.');}return result;}catch(error){return failure(error);}finally{progress(null);}
}

// Briefings summarize live, permission-scoped reads. Only dismissal IDs persist.
export async function dailyBriefing(question='today'){
 try{
  const w=parseTimeWindow(question);if(w.error)return reply(w.error);
  const today=w.from,tomorrow=question==='today'?addDays(today,1):w.to;
  const reminders=await read('reminders',{limit:50},'Checking your reminders');
  const notifications=await read('notifications',{},'Checking your notifications');
  const evals=inTraining()?await read('evaluations',{mine:true,status:'outstanding',limit:100},'Checking your evaluations'):{items:[],nextOffset:null};
  const tours=await read('tours',{from:today,to:tomorrow,limit:100},'Checking upcoming tours');
  const items=[];
  for(const g of evals.items)if(g.date&&g.date<=tomorrow){const overdue=g.date<today;items.push({id:'eval:'+g.id+':'+g.date,kind:'evaluation',recordId:g.id,priority:overdue?'critical':'important',card:evalCard(g),why:overdue?'Scheduled tour has passed':'Evaluation scheduled '+g.date});}
  for(const r of reminders.items)if(Date.parse(r.due_at)<=Date.parse(localInstant(addDays(tomorrow,1),'00:00'))){const overdue=Date.parse(r.due_at)<Date.now();items.push({id:'reminder:'+r.id+':'+r.due_at,kind:'reminder',recordId:r.id,priority:overdue?'important':'informational',why:overdue?'Reminder overdue':'Upcoming reminder',card:{kind:'reminder',title:r.title,fields:[['Due',shortTime(r.due_at)]],actions:[{label:'Mark complete',run:safeCallback(()=>completeReminder(r))}]}});}
  for(const n of notifications.items.filter(n=>!n.read_at).slice(0,5))items.push({id:'notification:'+n.id,kind:'notification',recordId:n.id,priority:'informational',why:'Unread notification',card:{kind:'notification',title:n.title,fields:[['Received',shortTime(n.created_at)]],actions:[{label:'Open',run:safeCallback(async()=>{const r=await callTool('navigate',{id:n.route||'notifications'});return reply(r.ok?'Opened notifications.':r.error.message);})},{label:'Mark read',run:safeCallback(()=>reviewTask('Mark notification read',[{tool:'notifications.read',args:{ids:[n.id]},label:'Mark this notification read'}],'Mark this notification as read?'))}]}});
  let leadership='';if(isAdmin()&&inTraining()){
   const open=await read('evaluations',{status:'available',limit:100},'Checking unclaimed evaluation opportunities');
   const matched=await attachOpportunities(open.items,tours.items);
   for(const t of matched.filter(t=>t.evaluation).slice(0,8))items.push({id:'tour:'+t.id,kind:'tour',recordId:t.id,evalId:t.evaluation.id,date:t.date,time:t.start,priority:'important',why:'Scheduled guide has an unclaimed evaluation',card:tourCard(t)});
  }
  if(isAdmin()){ const stats=await read('analytics',{},'Checking leadership workload');leadership=` ${stats.workload.reduce((n,g)=>n+g.outstanding,0)} outstanding evaluations in ${stats.truncated?'the first '+stats.sampleSize:'the '+stats.sampleSize} current-term records checked.`;}
  const order={critical:0,important:1,informational:2};const visible=items.filter(x=>visibleAttention(x.id)).sort((a,b)=>order[a.priority]-order[b.priority]).slice(0,8);
  setAgentContext('briefing',visible,{items:visible.map(({kind,recordId,evalId,date,time})=>({kind,id:recordId,evalId,date,time}))});
  return {type:'summary',title:'Your daily briefing',text:`${tours.items.length}${tours.nextOffset!==null?'+':''} tour guide assignments from ${today} through ${tomorrow}. ${visible.length} attention items shown.${leadership}`,cards:visible.map(x=>({...x.card,fields:[['Priority',x.priority],['Why',x.why],...x.card.fields],actions:[...x.card.actions,{label:'Snooze 1 hour',run:safeCallback(()=>{muteAttention(x.id,1);return dailyBriefing(question);})},{label:'Dismiss 24 hours',run:safeCallback(()=>{muteAttention(x.id,24);return dailyBriefing(question);})}]})),more:'Purdue time. Up to 100 evaluations, 100 tour assignments, 50 reminders and 50 notifications checked. Snoozing hides attention cards only; it does not change your responsibilities.',actions:[...(inTraining()?[{label:'Available evaluations',run:()=>opportunities('available evaluations this week')},{label:'My overdue work',run:overdueTasks}]:[]),{label:'Today’s tours',run:()=>scheduleReview('today')},{label:'Action history',run:showHistory}]};
 }catch(error){return failure(error);}finally{progress(null);}
}
