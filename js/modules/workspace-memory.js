import { esc } from '../core/ui.js';
import { inspectMemory, clearMemory } from '../services/memory.js';
import { workspacePage, hero, empty } from './workspace-shell.js';

export const memoryPage=workspacePage('memory','Vanessa Memory',null,async(root,alive,paint)=>{
 const memory=inspectMemory();if(!alive())return;root.innerHTML=hero('Useful context. Under your control.','Stored on this device for this account: entity IDs, action names, shortcut IDs and timestamps. No conversation transcript, feedback or reminder text.')+`<p class="op-muted">Recent items expire after 30 days; at most 30 are retained. Records must still pass current access checks when used.</p><button class="btn" data-clear>Clear stored context</button><div class="op-list">${memory.items.map(x=>`<article class="op-row"><div><b>${esc(x.kind)}</b><p>${esc(x.id)}</p><time>${esc(new Date(x.at).toLocaleString())}</time></div></article>`).join('')||empty('No stored context on this device.')}</div>`;root.querySelector('[data-clear]').onclick=()=>{clearMemory();paint();};
});
