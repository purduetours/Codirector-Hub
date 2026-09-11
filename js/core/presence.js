import {state} from './state.js';
import {rpc} from './db.js';
import {refreshIfStale} from './auth.js';
export function createPresence({call,draw,visible,now=Date.now,schedule=setInterval,unschedule=clearInterval,tabId}){
 let lastActivity=now(),timer=null,stopped=false,busy=false;
 const active=()=>visible()&&now()-lastActivity<300000;
 async function tick(){
  if(stopped||busy)return;busy=true;
  try{await call('hub_heartbeat',{p_tab:tabId,p_active:active()});if(stopped)return;
   const rows=await call('hub_active_users');if(!stopped)draw({users:rows,error:false});
  }catch{if(!stopped)draw({users:[],error:true});}finally{busy=false;}
 }
 return {
  start(){if(timer!==null)return;stopped=false;timer=schedule(tick,30000);void tick();},
  activity(){const was=active();lastActivity=now();if(!was)void tick();},
  visibility(){if(visible())lastActivity=now();void tick();},tick,
  stop(){stopped=true;if(timer!==null)unschedule(timer);timer=null;draw({users:[],error:false});}
 };
}
let cleanup=null;
export function resetPresence(){cleanup?.();cleanup=null;}
export function initPresence(){
 resetPresence();if(!state.me)return;
 const host=document.querySelector('.topbar-actions');if(!host)return;
 const panel=document.createElement('details');panel.className='active-users';
 const summary=document.createElement('summary');summary.textContent='Active now';
 const body=document.createElement('div');body.className='active-users-body';body.textContent='Loading active members…';
 panel.append(summary,body);host.prepend(panel);
 const owner=state.me.id,version=state.sessionVersion;
 const current=()=>state.me?.id===owner&&state.sessionVersion===version;
 const tracker=createPresence({tabId:crypto.randomUUID(),visible:()=>document.visibilityState==='visible',
  call:async(name,args)=>{
   if(!current())throw Error('Account changed');
   if(state.refreshToken&&!(await refreshIfStale()))throw Error('Sign-in expired');
   if(!current())throw Error('Account changed');return rpc(name,args);
  },
  draw:({users,error})=>{
   if(!current())return;
   summary.textContent=error?'Active now · unavailable':`Active now · ${users.length}`;body.replaceChildren();
   const note=document.createElement('p');note.textContent=error?'Active members could not load. Retrying automatically.':'Members with a visible tab and activity in the last five minutes. Updates about every 30 seconds.';body.append(note);
   if(!error){const list=document.createElement('ul');for(const user of users){const row=document.createElement('li');row.textContent=user.full_name+(user.member_id===owner?' (you)':'');list.append(row);}body.append(list);if(!users.length){const empty=document.createElement('p');empty.textContent='No active members right now.';body.append(empty);}}
  }
 });
 const events=['pointerdown','keydown','scroll'];
 events.forEach(event=>document.addEventListener(event,tracker.activity,{passive:true}));
 document.addEventListener('visibilitychange',tracker.visibility);
 const hide=()=>tracker.stop(),show=()=>{if(current()){tracker.activity();tracker.start();}};
 window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
 cleanup=()=>{tracker.stop();events.forEach(event=>document.removeEventListener(event,tracker.activity));document.removeEventListener('visibilitychange',tracker.visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);panel.remove();};
 tracker.start();
}
