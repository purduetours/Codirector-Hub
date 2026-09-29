import { state, onSessionReset } from '../core/state.js';
import { rememberEntity } from '../services/memory.js';
const registry=new Map();let pending=null;
export function registerAction(action){for(const field of ['id','description','kind','required','permission','confirmation','execute','success','failures'])if(action[field]===undefined)throw new Error('Action missing '+field);registry.set(action.id,action);}
export const actionCatalog=()=>[...registry.values()];
export function clearActionReview(){pending=null;}
onSessionReset(clearActionReview);
const reply=text=>({type:'reply',text});
export async function runAction(id,params={}) {
 const action=registry.get(id);if(!action || !state.me || !action.permission())return reply('Your account cannot perform that action.');
 const missing=action.required.filter(k=>params[k]===undefined || params[k]===null || params[k]==='');
 if(missing.length)return reply(`I need ${missing.join(' and ')} first.`);
 const version=state.sessionVersion,owner=state.me.id;let used=false;
 const execute=async()=>{
  if(used)return reply('That action has already been sent. Refresh the record to check its status.');
  if(version!==state.sessionVersion || owner!==state.me?.id || !action.permission())return reply('Your account or permissions changed. Please start again.');
  used=true;pending=null;
  try{const saved=await action.execute(params);rememberEntity('action',id);return action.success(saved,params);}catch(error){console.warn('[Action '+id+']',error);return reply(action.failure? action.failure(error):'I could not confirm that change. Refresh the record and try again.');}
 };
 if(action.confirmation){const token={execute};pending=token;return {type:'confirm',title:action.description,text:typeof action.confirmation==='function'?action.confirmation(params):'Confirm this change?',confirm:{label:'Confirm',run:()=>pending===token?execute():reply('That review is no longer active. Please ask again.')},cancel:{label:'Cancel',run:()=>{if(pending===token)pending=null;return reply('Cancelled. Nothing changed.');}}};}
 return execute();
}
export function actionFollowup(text){if(!pending)return null;if(/^(?:yes|confirm|do it|go ahead)[.!]*$/i.test(text))return pending.execute();if(/^(?:no|cancel|never mind|nevermind)[.!]*$/i.test(text)){pending=null;return reply('Cancelled. Nothing changed.');}return null;}
