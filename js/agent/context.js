import { state, onSessionReset } from '../core/state.js';
let current=null;
export function setAgentContext(kind,items,extra={}){
 current={kind,ids:items.map(x=>x.id).filter(Boolean).slice(0,100),...extra,owner:state.me?.id,version:state.sessionVersion,at:Date.now()};
}
export function agentContext(){return current&&current.owner===state.me?.id&&current.version===state.sessionVersion&&Date.now()-current.at<20*60000?current:null;}
export function clearAgentContext(){current=null;}
onSessionReset(clearAgentContext);
const listeners=new Set();
export const onAgentProgress=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function progress(label){listeners.forEach(fn=>{try{fn(label);}catch{}});}
