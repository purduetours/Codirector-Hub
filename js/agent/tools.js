import { state, inTraining, isAdmin } from '../core/state.js';
import { field as f, validate, ToolError } from './schema.js';
import { evaluationPage, tourPage, personalReminderPage, agentAnalytics } from '../services/agent-data.js';
import { agentAction, agentHistory } from '../services/agent-actions.js';
import { notifications, activity } from '../services/workspace.js';
import { go, visibleModules } from '../core/router.js';
import { queueOpenEval } from '../modules/evals.js';
import { rememberEntity } from '../services/memory.js';
const tools=new Map(),grants=new WeakMap();
const member=()=>!!state.me,training=()=>member()&&inTraining(),admin=()=>member()&&isAdmin();
const required=spec=>({...spec,required:true});
const time={...f.string(5),pattern:/^(?:[01]\d|2[0-3]):[0-5]\d$/};
const paging={limit:f.integer(1,100),offset:f.integer(0,10000)};
export function registerTool(tool){if(!tool.name||!tool.parameters||!tool.permission||!tool.run)throw Error('Incomplete tool definition');tools.set(tool.name,tool);}
const define=(name,description,parameters,permission,run,kind='read')=>registerTool({name,description,parameters,permission,run,kind});
export const toolCatalog=()=>[...tools.values()].map(({run,permission,...t})=>({...t,available:permission()}));
// This capability is created by a clicked/typed confirmation, never model JSON.
export function approveTool(name,args,requestId){const token={};grants.set(token,{name,args:JSON.stringify(args),requestId,owner:state.me?.id,version:state.sessionVersion,at:Date.now()});return token;}
export async function callTool(name,args={},options={}){
 const tool=tools.get(name),owner=state.me?.id,version=state.sessionVersion;
 try{
  if(!tool||!member()||!tool.permission())throw new ToolError('permission','Your account cannot use this tool.');
  validate(tool.parameters,args);
  if(tool.kind==='write'){
   const grant=grants.get(options.approval);
   if(!grant||grant.name!==name||grant.args!==JSON.stringify(args)||grant.requestId!==options.requestId||grant.owner!==owner||grant.version!==version||Date.now()-grant.at>120000)throw new ToolError('confirmation','Review and confirm this action first.');
  }
  const data=await tool.run(args,options);
  if(owner!==state.me?.id||version!==state.sessionVersion||!tool.permission())throw new ToolError('session','Your account or permissions changed.');
  return {ok:true,data};
 }catch(error){
  let code=error.code||'unavailable',message=error.message||'This tool could not complete.';
  if(/hub_agent|schema cache|does not exist/i.test(message)){code='setup';message='Vanessa’s action tools need database migration 19. No fallback write was attempted.';}
  else if(/changed since review|just claimed|evaluation changed/i.test(message)){code='conflict';message='That evaluation changed or was claimed by someone else. Refresh the available evaluations before choosing another.';}
  else if(!['permission','confirmation','input','session'].includes(code)&&!/required|unavailable|submitted|own evaluation|schedule could not|Sign in/i.test(message)){code='unavailable';message='I could not confirm the result. Retry this task to check it safely; I won’t repeat a confirmed change.';}
  return {ok:false,error:{code,message}};
 }
}
define('currentUser','Read authenticated account and granted role',{},member,()=>({id:state.me.id,name:state.me.full_name,training:inTraining(),leadership:isAdmin()}));
define('evaluations','Read a filtered page of current-term evaluations',{...paging,status:f.enum(['outstanding','available','overdue','all']),mine:f.bool(),after:time,before:time,at:time,from:f.date(),to:f.date(),claimedOn:f.date(),notSince:f.date(),ids:f.array(f.id(),100),name:f.string(100)},training,evaluationPage);
define('tours','Read upcoming tours in a date/time window',{...paging,from:f.date(),to:f.date(),after:{...f.string(5),pattern:/^(?:[01]\d|2[0-3]):[0-5]\d$/},before:{...f.string(5),pattern:/^(?:[01]\d|2[0-3]):[0-5]\d$/},at:{...f.string(5),pattern:/^(?:[01]\d|2[0-3]):[0-5]\d$/}},member,tourPage);
define('reminders','Read your incomplete reminders',{...paging,overdue:f.bool()},member,personalReminderPage);
define('notifications','Read your notification history',{},member,async()=>({items:(await notifications()).slice(0,50),limit:50}));
define('activity','Read accessible recorded activity',{evalId:f.id(),since:{...f.string(40),pattern:/^\d{4}-\d{2}-\d{2}T/}},member,async args=>({items:await activity(args)}));
define('analytics','Read leadership workload summary',{},admin,agentAnalytics);
define('actionHistory','Read your durable tool-action receipts',paging,member,async args=>({items:await agentHistory(args)}));
define('navigate','Open an authorized page',{id:required(f.id())},member,({id})=>{if(!visibleModules().some(m=>m.id===id))throw new ToolError('permission','That page is not available for your account.');go(id);return {opened:id};},'navigation');
define('openEvaluation','Open a currently accessible evaluation',{id:required(f.id())},training,async({id})=>{const page=await evaluationPage({ids:[id],status:'all',limit:1});if(!page.items.length)throw Error('This evaluation is unavailable.');rememberEntity('evaluation',id);queueOpenEval(id);go('evals');return {opened:id,name:page.items[0].name};},'navigation');
const snapshot={id:required(f.id()),expectedOwner:{...f.id(),required:true,nullable:true},expectedDate:{...f.date(),required:true,nullable:true},expectedTime:{...f.string(8),required:true,nullable:true}};
for(const action of ['claim','release'])define('evaluation.'+action,action==='claim'?'Claim a reviewed evaluation':'Release a reviewed evaluation',{...snapshot,...(action==='claim'?{date:{...f.date(),nullable:true},time:{...f.string(5),nullable:true}}:{})},training,async(p,o)=>{
 const params={eval_id:p.id,expected_owner:p.expectedOwner,expected_date:p.expectedDate,expected_time:p.expectedTime};if(action==='claim')Object.assign(params,{date:p.date||null,time:p.time||null});
 const receipt=await agentAction('evaluation.'+action,params,o.requestId);rememberEntity('evaluation',p.id);return receipt;
},'write');
define('reminder.create','Create a reviewed personal reminder',{title:required(f.string(240)),dueAt:required({...f.string(40),pattern:/^\d{4}-\d{2}-\d{2}T/})},member,(p,o)=>{if(!Number.isFinite(Date.parse(p.dueAt)))throw new ToolError('input','Invalid reminder date.');return agentAction('reminder.create',{title:p.title,due_at:p.dueAt},o.requestId);},'write');
define('reminder.complete','Complete your selected reminder',{id:required(f.id())},member,(p,o)=>agentAction('reminder.complete',p,o.requestId),'write');
define('notifications.read','Mark selected notifications as read',{ids:required(f.array(f.id(),100))},member,(p,o)=>agentAction('notifications.read',p,o.requestId),'write');
