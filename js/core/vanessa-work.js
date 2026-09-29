/* ============================================================ work context
   What the person is doing right now, in one shared place.

   A module that opens something worth knowing about — an evaluation form, a
   selected record — publishes it here; Vanessa reads it. So "can you help me
   write this comment?" means THIS evaluation, without the module having to
   know Vanessa exists or Vanessa having to reach into the module's DOM.

   A context carries:
     kind     e.g. 'eval-form'
     label    human name, e.g. "Alex Rivera's evaluation"
     data     plain facts (ids, names)
     isOpen() whether it is still on screen — closed forms stop counting
     read(key), write(key, value)   for form contexts: the module's own field
              access, so a suggestion lands through the form, not around it

   No imports on purpose: anything can depend on this without a cycle.
============================================================================ */
let current = null;
const listeners = new Set();

export function setWorkContext(ctx) {
  current = ctx || null;
  listeners.forEach(fn => { try { fn(current); } catch { /* never breaks the module */ } });
}
export function clearWorkContext(kind) {
  if (!kind || current?.kind === kind) setWorkContext(null);
}
/** The live context, or null once whatever it described has closed. */
export function workContext() {
  if (current && typeof current.isOpen === 'function' && !current.isOpen()) return null;
  return current;
}
export function onWorkContext(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Page providers return IDs and small filter values, never whole datasets or DOM.
const providers=new Map();let page=null;
export function registerContextProvider(id,read){providers.set(id,read);return ()=>providers.delete(id);}
export function setContextPage(id){page=id;}
export function structuredContext(){
 const active=workContext();const supplied=providers.get(page)?.()||{};
 const source={...supplied,...active?.data},data={};
 for(const key of ['id','evalId','guideId','name','date','time','from','to','filter'])if(typeof source[key]==='string')data[key]=source[key].slice(0,160);
 return {page,kind:active?.kind||'page',data};
}
