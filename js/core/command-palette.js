import { state, onSessionReset, inTraining } from './state.js';
import { esc } from './ui.js';
import { visibleModules, go } from './router.js';
import { setJumpTarget } from './quicksearch.js';
import { notifications, reminders } from '../services/workspace.js';
import { shared } from './vanessa-data.js';
import { rememberEntity } from '../services/memory.js';
let dialog=null,items=[],cursor=0,extra=[],version=0;
const ask=q=>document.dispatchEvent(new CustomEvent('hub:ask',{detail:{question:q}}));
function close(){dialog?.close();}
onSessionReset(()=>{version++;extra=[];items=[];close();dialog?.remove();dialog=null;});
function paint(){
 const q=dialog.querySelector('input').value.trim(),words=q.toLowerCase().split(/\s+/);
 const entries=[...visibleModules().map(m=>({label:m.title,sub:'Page',run:()=>go(m.id)})),
 ...(inTraining()?state.guides:[]).map(g=>({label:g.name,sub:'Guide · '+g.priority,run:()=>{rememberEntity('guide',g.guideId||g.id);setJumpTarget(g.name);go('directory');}})),
 ...(shared.tours||[]).slice(0,500).map(t=>({label:`${t.guide} ${t.date} ${t.start||t.slot}`,sub:'Tour · Ask Vanessa',run:()=>ask(`When is ${t.guide}'s next tour?`)})),...extra];
 items=entries.filter(x=>!q||words.every(w=>(x.label+' '+x.sub).toLowerCase().includes(w))).slice(0,15);
 if(q)items.unshift({label:`Ask Vanessa: ${q}`,sub:'Understand a request or perform an action',run:()=>ask(q.replace(/^ask vanessa\s*/i,''))});
 cursor=Math.min(cursor,Math.max(0,items.length-1));
 dialog.querySelector('.cp-list').innerHTML=items.map((x,i)=>`<button type="button" class="cp-hit" role="option" id="cp-${i}" aria-selected="${i===cursor}" data-index="${i}" tabindex="-1">${esc(x.label)}<small>${esc(x.sub)}</small></button>`).join('')||'<p>No matching pages or records.</p>';
 dialog.querySelector('input').setAttribute('aria-activedescendant',items.length?'cp-'+cursor:'');
}
export async function openPalette(){
 if(!state.me)return;
 if(!dialog){dialog=document.createElement('dialog');dialog.className='cp-dialog';dialog.setAttribute('aria-labelledby','cp-title');dialog.innerHTML=`<div class="cp-heading"><b id="cp-title">Find it. Ask Vanessa. Get it done.</b><button type="button" class="btn btn-ghost" data-close aria-label="Close command palette">×</button></div><input type="search" aria-label="Search the Hub or ask Vanessa" role="combobox" aria-controls="cp-results" aria-expanded="true" aria-autocomplete="list" autocomplete="off" placeholder="Search or ask Vanessa…"><div id="cp-results" class="cp-list" role="listbox" aria-label="Commands"></div>`;document.body.append(dialog);
 dialog.querySelector('[data-close]').onclick=close;dialog.querySelector('input').oninput=()=>{cursor=0;paint();};dialog.onclick=e=>{const hit=e.target.closest('[data-index]');if(hit){const item=items[+hit.dataset.index];close();item?.run();}};
 dialog.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();cursor=(cursor+(e.key==='ArrowDown'?1:-1)+items.length)%Math.max(items.length,1);paint();dialog.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&e.target.matches('input')){e.preventDefault();const item=items[cursor];close();item?.run();}});
 }
 dialog.querySelector('input').value='';cursor=0;paint();if(!dialog.open)dialog.showModal();dialog.querySelector('input').focus();
 const token=++version,session=state.sessionVersion;
 const data=await Promise.allSettled([reminders(),notifications()]);if(token!==version||session!==state.sessionVersion||!dialog)return;
 extra=data.flatMap((result,index)=>result.status==='fulfilled'?result.value.map(r=>({label:r.title,sub:index?'Notification':'Reminder',run:()=>go(index?r.route:`reminders?item=${encodeURIComponent(r.id)}`)})):[]);if(dialog.open)paint();
}
let initialized=false;
export function initCommandPalette(){
 if(initialized)return;initialized=true;
 const host=document.querySelector('.topbar-actions');if(host){const button=document.createElement('button');button.className='btn cp-launch';button.type='button';button.innerHTML='Search <kbd>⌘ / Ctrl K</kbd>';button.setAttribute('aria-label','Search the Hub or ask Vanessa');button.onclick=openPalette;host.prepend(button);}
 document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){if(!state.me)return;e.preventDefault();openPalette();}else if(e.key==='/'&&!e.target.matches?.('input,textarea,select,[contenteditable]')&&state.me){e.preventDefault();openPalette();}});
}
