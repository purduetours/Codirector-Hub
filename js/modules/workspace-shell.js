import { state } from '../core/state.js';
import { esc } from '../core/ui.js';
import { clearWorkContext } from '../core/vanessa-work.js';
import { workspaceError, invalidateWorkspace } from '../services/workspace.js';
export const empty=text=>`<div class="op-empty">${esc(text)}</div>`;
export const card=(label,value)=>`<article class="op-card"><span class="op-stat">${esc(String(value))}</span><span>${esc(label)}</span></article>`;
export const ask=q=>document.dispatchEvent(new CustomEvent('hub:ask',{detail:{question:q}}));
export const hero=(title,text)=>`<header class="op-hero"><span class="op-eyebrow">Vanessa · Your operations partner</span><h2>${esc(title)}</h2><p class="op-muted">${esc(text)}</p></header>`;
let generation=0;
export function workspacePage(id,title,needs,draw){return {id,title,crumb:title,section:({'command-center':'Hub',operations:'Operations',notifications:'Hub',activity:'Hub',analytics:'Leadership'})[id]||'Workspace',needs,icon:'spark',unmount(){generation++;clearWorkContext();},bust:invalidateWorkspace,async mount(view){const token=++generation,version=state.sessionVersion;const root=document.createElement('section');root.className='op-shell';root.innerHTML=hero(title,'Loading your workspace…')+'<div class="op-grid" role="status" aria-label="Loading"><div class="op-skeleton"></div><div class="op-skeleton"></div></div>';view.replaceChildren(root);const alive=()=>token===generation&&version===state.sessionVersion&&root.isConnected;const paint=async()=>{try{await draw(root,alive,paint);}catch(error){if(alive()){root.innerHTML=hero(title,'This view could not load.')+`<div class="op-error" role="alert"><p>${esc(workspaceError(error))}</p><button class="btn" data-retry>Try again</button></div>`;root.querySelector('[data-retry]').onclick=()=>{invalidateWorkspace();paint();};}}};await paint();}};}
