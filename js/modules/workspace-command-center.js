import { state, inTraining } from '../core/state.js';
import { esc, todayISO } from '../core/ui.js';
import { go } from '../core/router.js';
import { reminders, notifications, activity } from '../services/workspace.js';
import { operations, briefing } from '../services/operations.js';
import { previousVisit } from '../services/memory.js';
import { workspacePage, hero, card, empty, ask } from './workspace-shell.js';

export const commandCenter=workspacePage('command-center','Command Center',null,async(root,alive)=>{
 const data=await briefing(previousVisit());if(!alive())return;
 const myEvals=inTraining()?state.guides.filter(g=>!g.skip&&!g.submitted&&g.evaluatorId===state.me.id):[];
 const due=(data.reminders||[]).filter(r=>!r.completed_at&&Date.parse(r.due_at)<=Date.now());
 const changes=data.activity?.length;
 root.innerHTML=hero(`Here’s what needs you, ${(state.me.full_name||'there').split(' ')[0]}.`,'A focused view of your day. Ask Vanessa to handle the next step.')+
 `<form class="op-toolbar" data-ask-form><label>Ask Vanessa<input name="question" placeholder="Release my Tuesday eval…" required autocomplete="off"></label><button class="btn btn-primary">Ask Vanessa</button></form>`+
 `<div class="op-grid">${card('Your unfinished evaluations',inTraining()?(data.operations?.evalsAvailable?myEvals.length:'Unavailable'):'No training access')}${card('Due reminders',data.reminders?due.length:'Unavailable')}${card('Guide assignments today',data.operations?data.operations.timeline.length:'Unavailable')}${card('Unread notifications',data.notifications?data.notifications.filter(n=>!n.read_at).length:'Unavailable')}</div>`+
 `<div class="op-actions"><button class="btn" data-go="operations">Tour operations</button><button class="btn" data-go="reminders">Your reminders</button><button class="btn" data-go="notifications">Notifications</button><button class="btn" data-go="memory">Vanessa’s memory</button></div>`+
 `<section class="op-list"><h3>Start here</h3>${[...myEvals.filter(g=>g.date&&g.date<todayISO()).map(g=>({title:`Follow up on ${g.name}’s evaluation`,text:`Scheduled ${g.date}; not submitted.`,q:`Open ${g.name}'s evaluation`})),...due.map(r=>({title:r.title,text:'Your reminder is due.',q:`Complete reminder ${r.title}`})),...(data.operations?.conflicts||[]).map(text=>({title:'Schedule conflict',text,q:'What problems do we have today?'}))].slice(0,5).map(x=>`<article class="op-row"><div><b>${esc(x.title)}</b><p class="op-muted">${esc(x.text)}</p></div><button class="btn" data-ask="${esc(x.q)}">Ask Vanessa</button></article>`).join('')||empty(data.unavailable.length?'Nothing urgent in the data available so far. Some sources could not load.':'Nothing urgent right now. Ask Vanessa what’s coming up.')}</section>`+
 `<article class="op-card"><h3>Since your last visit</h3><p class="op-muted">${previousVisit()?esc(new Date(previousVisit()).toLocaleString()):'This is the first visit recorded on this device.'}</p><p>${changes===undefined?'Activity is unavailable.':`${changes}${changes===100?'+':''} recorded changes you can access.`}</p><button class="btn" data-go="activity">See activity</button></article>`+
 (data.unavailable.length?`<p class="op-note">Could not load ${esc(data.unavailable.join(', '))}. New workspace data requires database migration 18.</p>`:'');
 root.querySelector('form').onsubmit=e=>{e.preventDefault();ask(new FormData(e.target).get('question'));};root.onclick=e=>{const a=e.target.closest('[data-ask]'),b=e.target.closest('[data-go]');if(a)ask(a.dataset.ask);if(b)go(b.dataset.go);};
});
