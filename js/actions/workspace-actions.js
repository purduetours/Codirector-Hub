import { openNotification } from '../core/workspace-links.js';
import { registerAction, runAction, actionFollowup, clearActionReview } from './registry.js';
import { state, inTraining, isAdmin, onSessionReset } from '../core/state.js';
import { ensure } from '../core/vanessa-data.js';
import { workContext, structuredContext } from '../core/vanessa-work.js';
import { dateRange } from '../core/vanessa-dates.js';
import { go, visibleModules } from '../core/router.js';
import { changeEvaluation } from '../services/evaluations.js';
import { reminders, saveReminder, deleteReminder, notifications, readNotifications, activity, workspaceError, invalidateWorkspace } from '../services/workspace.js';
import { operations, analytics, briefing } from '../services/operations.js';
import { inspectMemory, rememberEntity, previousVisit } from '../services/memory.js';
const reply=text=>({type:'reply',text});
let notificationSnapshot=[];
onSessionReset(()=>{notificationSnapshot=[];});
const signedIn=()=>!!state.me;
const register=(id,description,kind,required,permission,confirmation,execute,success,failure=workspaceError)=>registerAction({id,description,kind,required,permission,confirmation,execute,success,failure,failures:['access denied','stale record','connection unavailable']});
for(const kind of ['claim','release'])register(`evaluation.${kind}`,`${kind==='claim'?'Claim':'Release'} evaluation`,'important',['evaluation'],()=>signedIn()&&inTraining(),p=>`${kind==='claim'?'Claim':'Release'} ${p.evaluation.name}’s evaluation${p.evaluation.date?' on '+p.evaluation.date:''}?`,async p=>{
 const saved=await changeEvaluation(kind,p.evaluation,p.schedule);rememberEntity('evaluation',p.evaluation.id);invalidateWorkspace();
 const g=state.guides.find(x=>x.id===saved.id);if(g)Object.assign(g,{evaluatorId:saved.evaluator_id,evaluator:kind==='claim'?state.me.full_name:'',date:saved.tour_date||'',time:(saved.tour_time||'').slice(0,5),status:kind==='claim'?'claimed':'open',claimedAt:saved.claimed_at||''});
 return saved;
},(_,p)=>reply(`Done. ${kind==='claim'?'You claimed':'I released'} ${p.evaluation.name}’s evaluation.`),error=>/changed|submitted|own|claimed/.test(error.message)?error.message:workspaceError(error));
register('reminder.create','Create reminder','reversible',['title','dueAt'],signedIn,p=>`Create “${p.title}” for ${new Date(p.dueAt).toLocaleString()}?`,saveReminder,r=>{rememberEntity('reminder',r.id);return reply(`Saved your reminder: ${r.title}.`);});
register('reminder.complete','Complete reminder','reversible',['id'],signedIn,false,p=>saveReminder({...p,completed:true}),r=>reply(`Done. Completed “${r.title}”.`));
register('reminder.delete','Delete reminder','important',['id','title'],signedIn,p=>`Delete “${p.title}”?`,p=>deleteReminder(p.id),(_,p)=>reply(`Deleted “${p.title}”.`));
register('notifications.read','Mark notifications as read','reversible',[],signedIn,false,p=>readNotifications(p.ids||null),n=>reply(`Marked ${n} notification${n===1?'':'s'} as read.`));
register('notifications.list','Read notifications','read',[],signedIn,false,async()=>{const rows=await notifications();notificationSnapshot=rows;return rows;},rows=>({type:'summary',title:'Your notifications',text:rows.length?`${rows.filter(n=>!n.read_at).length} unread in the latest ${rows.length}.`:'You’re caught up.',items:rows.slice(0,8).map(n=>({label:n.title,sub:new Date(n.created_at).toLocaleString(),run:()=>{openNotification(n);return reply('Opened '+n.route+'.');}}))}));
register('activity.list','Read recent activity','read',[],signedIn,false,p=>activity(p),rows=>({type:'summary',title:'Recent changes',text:rows.length?'Here are the most recent changes you can access.':'No recorded changes in this period.',rows:rows.slice(0,12).map(r=>[new Date(r.created_at).toLocaleString(),r.summary])}));
register('operations.read','Tour operations','read',[],signedIn,false,p=>operations(p),r=>({type:'summary',title:'Tour operations',text:`${r.timeline.length} guide assignments; ${r.conflicts.length} exact-time conflicts.${r.desksAvailable?' '+r.deskGaps.length+' open recurring desk slots.':''}`,rows:r.timeline.slice(0,12).map(t=>[`${t.date} ${t.start||t.slot}`,`${t.guide}${t.evaluator?' · Evaluator: '+t.evaluator:t.needsEval?' · Evaluation coverage needed':''}`]),more:[...r.conflicts,r.coverageNote,!r.evalsAvailable?'Evaluation data is unavailable for this account or could not load.':''].filter(Boolean).join(' ')}));
register('analytics.read','Leadership analytics','read',[],()=>signedIn()&&isAdmin(),false,async p=>{if(!await ensure('roster'))throw Error('Evaluation data unavailable');return analytics(state.guides,p);},r=>({type:'summary',title:'Evaluation progress',rows:[['Completion',r.rate===null?'No eligible evaluations':r.rate+'%'],['Past scheduled date',String(r.overdue)],['Average claim to submission',r.averageDays===null?'No timestamp pairs':r.averageDays.toFixed(1)+' days ('+r.durationSamples+' records)']],more:'Current accessible term only. Historical comparisons and causes of changes cannot be inferred without snapshots.'}));
register('briefing.read','Daily briefing','read',[],signedIn,false,()=>briefing(previousVisit()),r=>({type:'summary',title:'Your daily briefing',rows:[['Tours today',r.operations?String(r.operations.timeline.length):'Unavailable'],['Your unfinished evaluations',inTraining()?(r.operations?.evalsAvailable?String(state.guides.filter(g=>!g.skip&&!g.submitted&&g.evaluatorId===state.me.id).length):'Unavailable'):'No training access'],['Open reminders',r.reminders?String(r.reminders.filter(x=>!x.completed_at).length):'Unavailable'],['Unread notifications',r.notifications?String(r.notifications.filter(x=>!x.read_at).length):'Unavailable'],['Recorded changes since last visit',r.activity?String(r.activity.length)+(r.activity.length===100?'+':''):'Unavailable']],more:r.unavailable.length?'Could not load: '+r.unavailable.join(', ')+'.':'Overdue means a scheduled tour date has passed without a submitted evaluation.'}));
register('page.open','Open workspace','navigation',['id'],signedIn,false,p=>{if(!visibleModules().some(m=>m.id===p.id))throw Error('Access denied');go(p.id);rememberEntity('shortcut',p.id);return p.id;},id=>reply('Opened '+(visibleModules().find(m=>m.id===id)?.title||id)+'.'));

function choose(items,title,run){if(!items.length)return reply('I couldn’t find a matching record you can act on.');if(items.length===1)return run(items[0]);return {type:'select',title,options:items.slice(0,20).map(x=>({label:x.name||x.title,sub:x.date||x.due_at||'',run:()=>run(x)}))};}
async function evalIntent(q,kind) {
 if(!inTraining())return reply('Evaluation actions require training access.');
 if(!await ensure('roster'))return reply('I couldn’t load the evaluations. Please try again.');
 let candidates=state.guides.filter(g=>!g.skip&&!g.submitted&&(kind==='claim'?!g.evaluatorId:g.evaluatorId===state.me.id));
 const ctx=workContext()?.data;const ref=/\b(this|that|it)\b/i.test(q);
 if(ref){const remembered=inspectMemory().items.filter(x=>x.kind==='evaluation');const id=ctx?.evalId||ctx?.id||(remembered.length===1?remembered[0].id:null);if(id)candidates=candidates.filter(g=>g.id===id);else return reply('Which evaluation do you mean? Tell me the guide’s name.');}
 else {
  const name=q.replace(/^(?:please )?(?:claim|release|unclaim)\s+/i,'').replace(/(?:['’]s)?\s+(?:eval(?:uation)?)(?:\s+please)?[.!]?$/i,'').replace(/^(?:my|the|an?)\b\s*/i,'').trim();
  const range=dateRange(q);if(range?.error)return reply(range.error);
  if(range)candidates=candidates.filter(g=>g.date>=range.from&&g.date<=range.to);
  else if(name&&!/^(?:eval(?:uation)?|my)$/i.test(name))candidates=candidates.filter(g=>name.toLowerCase().split(/\s+/).every(w=>g.name.toLowerCase().split(/\s+/).some(part=>part===w)));
 }
 return choose(candidates,'Which evaluation?',g=>runAction('evaluation.'+kind,{evaluation:{...g},schedule:{date:g.date||null,time:g.time||null,notes:g.notes||null}}));
}
async function reminderIntent(q,kind){const list=(await reminders()).filter(r=>!r.completed_at);const ctx=workContext();const named=q.replace(/^(?:mark|complete|delete|remove)\s+(?:the\s+)?/i,'').replace(/^reminder\s+/i,'').replace(/(?:\s+(?:reminder|complete|done))+[.!]*$/i,'').trim();const matches=/^(?:this|that|it|reminder)$/i.test(named)&&ctx?.kind==='reminder'?list.filter(r=>r.id===ctx.data.id):list.filter(r=>r.title.toLowerCase().includes(named.toLowerCase()));return choose(matches,'Which reminder?',r=>runAction('reminder.'+kind,r));}
export function parseReminder(q,now=new Date()) {
 const match=/^(?:create|set|add)(?: a)? reminder(?: for me)?(?: to)?\s+(.+)$/i.exec(q)||/^remind me to\s+(.+)$/i.exec(q);if(!match)return null;
 const range=dateRange(match[1],now);if(!range||range.error||range.from!==range.to)return {error:range?.error||'What day should I remind you? Include today, tomorrow, a weekday, or YYYY-MM-DD.'};
 const time=/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(match[1]);let hour=9,minute=0;
 if(time){hour=+time[1];minute=+(time[2]||0);if(minute>59||hour>23|| (time[3]&&(hour<1||hour>12)))return {error:'Use a valid time, such as 3 PM or 15:00.'};if(time[3])hour=hour%12+(/pm/i.test(time[3])?12:0);}
 const title=match[1].replace(/\b(?:today|tomorrow|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2})\b/ig,'').replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/ig,'').replace(/\s+/g,' ').trim();
 const due=new Date(range.from+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00');
 if(!title)return {error:'What should the reminder say?'};return {title,dueAt:due.toISOString()};
}
function clockTime(q) {
 const m=/\b(?:at|after|the)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(q);
 if(!m)return null;let h=+m[1],min=+(m[2]||0);if(min>59||h>23||(m[3]&&(h<1||h>12)))return {error:'Use a valid time, such as 3 PM.'};
 if(m[3])h=h%12+(/pm/i.test(m[3])?12:0);else if(h<12 && !m[2])return {error:'Do you mean AM or PM? Include the time in your request.'};
 return {value:String(h).padStart(2,'0')+':'+String(min).padStart(2,'0')};
}
async function tourRequest(q,assign=false) {
 const range=dateRange(q);if(range?.error)return reply(range.error);if(assign&&!range)return reply('Which day is that tour? Include a date or weekday so I can find its evaluation.');
 const time=clockTime(q);if(time?.error)return reply(time.error);
 const data=await operations(range||{});const tours=data.timeline.filter(t=>!time || (/\bafter\b/i.test(q)?t.start>time.value:t.start===time.value));
 if(assign){if(!inTraining())return reply('Evaluation assignment requires training access.');
 const choices=tours.filter(t=>t.evalId).map(t=>({t,g:state.guides.find(g=>g.id===t.evalId)})).filter(x=>x.g&&!x.g.skip&&!x.g.submitted&&!x.g.evaluatorId);
 return choose(choices.map(x=>({...x.g,schedule:{date:x.t.date,time:x.t.start||null},date:x.t.date,time:x.t.start})), 'Which guide’s evaluation?',g=>runAction('evaluation.claim',{evaluation:g,schedule:g.schedule}));}
 return {type:'summary',title:'Matching tours',text:tours.length?`${tours.length} guide assignments.`:'No tours match this date and time.',rows:tours.slice(0,20).map(t=>[`${t.date} ${t.start||t.slot}`,t.guide]),more:'Current schedule workbook. Guide staffing changes are not writable from the Hub.'};
}
async function contextualTours() {
 const ctx=workContext()?.data;const remembered=inspectMemory().items.filter(x=>x.kind==='guide'||x.kind==='evaluation');
 if(!await ensure('roster')||!inTraining())return reply('Open a guide profile or name the person so I can find their schedule.');
 const id=ctx?.evalId||ctx?.id|| (remembered.length===1?remembered[0].id:null);
 const g=state.guides.find(g=>g.id===id||g.guideId===id);if(!g)return reply('Which guide do you mean?');
 return {type:'summary',title:g.name+'’s upcoming tours',rows:(g.tours||[]).slice(0,8).map(t=>[t.date,t.start||t.slot]),text:g.tours?.length?'Here’s their recorded schedule.':'No upcoming tours are recorded for this guide.'};
}
const intents=[
 {match:q=>/^(?:take me to|open) the first (?:one|notification)[.!]*$/i.test(q),run:()=>{if(!notificationSnapshot.length)return reply('Show your notifications first so I know which list you mean.');openNotification(notificationSnapshot[0]);return reply('Opened your first notification.');}},
 {match:q=>/^(?:when|show|what).*\b(?:their|his|her)\b.*\btour/i.test(q),run:contextualTours},
 {match:q=>/^assign me\b.*\btour/i.test(q),run:q=>tourRequest(q,true)},
 {match:q=>/\btours?\b.*\bafter\s+\d/i.test(q),run:q=>tourRequest(q)},
 {match:q=>/^what can you do with this reminder/i.test(q),run:()=>reply('I can complete or delete this reminder. Say “mark this reminder complete,” or edit its title and due date on this page.')},
 {match:q=>/^what happened with (?:that|this) evaluation/i.test(q),run:()=>{const ids=inspectMemory().items.filter(x=>x.kind==='evaluation');const id=workContext()?.data?.evalId||(ids.length===1?ids[0].id:null);return id?runAction('activity.list',{evalId:id}):reply('Which evaluation do you mean? Open it or tell me the guide’s name.');}},
 {match:q=>/^(?:please )?(claim|release|unclaim)\b.*(?:eval|this|that)/i.test(q),run:q=>evalIntent(q,/^(?:please )?claim\b/i.test(q)?'claim':'release')},
 {match:q=>/^(?:(create|set|add)( a)? reminder|remind me to)\b/i.test(q),run:q=>{const p=parseReminder(q);return p.error?reply(p.error):runAction('reminder.create',p);}},
 {match:q=>/^(?:mark|complete|delete|remove)\b.*\breminder\b/i.test(q),run:q=>reminderIntent(q,/^(delete|remove)/i.test(q)?'delete':'complete')},
 {match:q=>/^(?:mark .*notifications? .*read|mark (?:those|them|all) as read)[.!]*$/i.test(q),run:q=>/\b(?:those|them)\b/i.test(q)?(notificationSnapshot.length?runAction('notifications.read',{ids:notificationSnapshot.slice(0,8).map(n=>n.id)}):reply('Show your notifications first, or say “mark all notifications as read.”')):runAction('notifications.read')},
 {match:q=>/\bnotifications?\b/i.test(q)&&!/^open|^go to|^take me/i.test(q),run:()=>runAction('notifications.list')},
 {match:q=>/^(?:what changed|recent activity|what did I do|show.*activity)/i.test(q),run:q=>{const date=new Date();if(/yesterday/i.test(q))date.setDate(date.getDate()-1);date.setHours(0,0,0,0);return runAction('activity.list',{since:date.toISOString()});}},
 {match:q=>/\b(?:problems|conflicts|understaffed|without evaluators|busiest|tour operations)\b/i.test(q),run:q=>{const range=dateRange(q);return range?.error?reply(range.error):runAction('operations.read',range||(structuredContext().data.from?{from:structuredContext().data.from,to:structuredContext().data.from}:{}));}},
 {match:q=>/\b(?:analytics|completion rate|completion drop|workload distribution|most outstanding|compared with last month)\b/i.test(q),run:()=>runAction('analytics.read')},
 {match:q=>/^(?:daily briefing|what.*(?:finish|need to do) today|show me everything I need to finish today)/i.test(q),run:()=>runAction('briefing.read')},
 {match:q=>/^(?:open|take me to|go to|show me) (?:the |my )?(notifications|reminders|activity|analytics|tour operations|command center|memory)[.!]*$/i.test(q),run:q=>{const name=q.match(/(notifications|reminders|activity|analytics|tour operations|command center|memory)[.!]*$/i)[1].toLowerCase();return runAction('page.open',{id:({'tour operations':'operations','command center':'command-center'})[name]||name});}}
];
export async function handleWorkspace(q) {
 const follow=actionFollowup(q);if(follow)return follow;
 if(/^(?:cancel|never mind|go home|go back)[.!]*$/i.test(q)){clearActionReview();return null;}
 const intent=intents.find(x=>x.match(q));if(!intent){clearActionReview();return null;}
 clearActionReview();try{return await intent.run(q);}catch(error){return reply(workspaceError(error));}
}
