import { state, onSessionReset } from '../core/state.js';
const allowed=new Set(['guide','evaluation','reminder','action','shortcut']);
let visit=null;
const key=()=>state.me?`hub2.context.v1.${encodeURIComponent(window.CONFIG?.SUPABASE_URL||'hub')}.${state.me.id}`:null;
export function inspectMemory() {
 try {const data=JSON.parse(localStorage.getItem(key())||'{}');return {lastVisit:typeof data.lastVisit==='string'&&Number.isFinite(Date.parse(data.lastVisit))?data.lastVisit:null,items:Array.isArray(data.items)?data.items.filter(x=>allowed.has(x.kind)&&typeof x.id==='string'&&typeof x.at==='string' && Date.parse(x.at)>Date.now()-30*86400000).slice(0,30):[]};}catch{return {items:[],lastVisit:null};}
}
function save(data){if(!key())return;try{localStorage.setItem(key(),JSON.stringify(data));}catch{/* Private mode: memory remains optional. */}}
export function rememberEntity(kind,id) {if(!allowed.has(kind)||!id||!state.me)return;const data=inspectMemory();data.items=[{kind,id:String(id).slice(0,100),at:new Date().toISOString()},...data.items.filter(x=>x.kind!==kind||x.id!==String(id))].slice(0,30);save(data);}
export function beginVisit(){const data=inspectMemory();visit=data.lastVisit;save({...data,lastVisit:new Date().toISOString()});}
export const previousVisit=()=>visit;
export function clearMemory(){try{if(key())localStorage.removeItem(key());}catch{}visit=null;}
onSessionReset(()=>{visit=null;});
