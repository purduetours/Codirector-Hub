import { esc } from '../core/ui.js';
import { activity } from '../services/workspace.js';
import { workspacePage, hero, empty } from './workspace-shell.js';

export const activityPage=workspacePage('activity','Activity',null,async(root,alive)=>{
 const rows=await activity();if(!alive())return;root.innerHTML=hero('What changed.','An immutable record of actions you’re permitted to see. Personal reminder activity remains private.')+`<div class="op-toolbar"><label>Filter activity<input type="search" placeholder="Search names or actions" data-search></label></div><section class="op-list" data-list></section><p class="op-muted">Latest 100 recorded events. History begins when migration 18 is applied.</p>`;
 const list=root.querySelector('[data-list]');const paint=()=>{const q=root.querySelector('[data-search]').value.toLowerCase();list.innerHTML=rows.filter(r=>r.summary.toLowerCase().includes(q)).map(r=>`<article class="op-row"><div><b>${esc(r.summary)}</b><p class="op-muted">${esc(r.category)}</p><time>${esc(new Date(r.created_at).toLocaleString())}</time></div></article>`).join('')||empty('No recorded activity matches this view.');};root.querySelector('[data-search]').oninput=paint;paint();
});
