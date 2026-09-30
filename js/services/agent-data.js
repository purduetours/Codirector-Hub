import { select, toGuide, rpc } from '../core/db.js';
import { state, inTraining, isAdmin, termId } from '../core/state.js';
import { ensure, shared } from '../core/vanessa-data.js';
import { buildNameIndex, resolveGuide } from './tour-matching.js';
import { localInstant, addDays, zonedParts } from '../agent/time.js';
const enc=encodeURIComponent;
const columns='id,guide_id,first_name,last_name,full_name,priority,priority_rank,needs_eval,evaluator_id,evaluator_name,tour_date,tour_time,claimed_at,submitted_at,reviewed_at,status';
export async function evaluationPage({status='outstanding',mine=false,from,to,after,before,at,ids,name,claimedOn,notSince,limit=50,offset=0}={}){
 if(!state.me||!inTraining())throw Error('Evaluation access required.');
 let q=`select=${columns}&term_id=eq.${enc(termId())}&needs_eval=eq.true&order=tour_date.asc.nullslast,claimed_at.asc.nullslast,id.asc&limit=${limit+1}&offset=${offset}`;
 if(status!=='all')q+='&submitted_at=is.null';if(status==='available')q+='&evaluator_id=is.null';
 if(mine)q+=`&evaluator_id=eq.${enc(state.me.id)}`;
 if(status==='overdue')q+=`&tour_date=lt.${zonedParts().date}`;
 if(from)q+=`&tour_date=gte.${from}`;if(to)q+=`&tour_date=lte.${to}`;
 if(after)q+=`&tour_time=gt.${enc(after)}`;if(before)q+=`&tour_time=lt.${enc(before)}`;if(at)q+=`&tour_time=eq.${enc(at)}`;
 if(ids){if(!ids.length)return {items:[],nextOffset:null};q+=`&id=in.(${ids.map(enc).join(',')})`;}
 if(name){const clean=name.replace(/[%_*(),\\]/g,'').trim();if(!clean)throw Error('Give a guide name.');q+=`&full_name=ilike.${enc('*'+clean+'*')}`;}
 if(notSince)q+=`&or=(submitted_at.is.null,submitted_at.lt.${enc(localInstant(notSince,'00:00'))})`;
 if(claimedOn)q+=`&claimed_at=gte.${enc(localInstant(claimedOn,'00:00'))}&claimed_at=lt.${enc(localInstant(addDays(claimedOn,1),'00:00'))}`;
 const rows=await select('eval_roster',q)||[];
 return {items:rows.slice(0,limit).map(toGuide),nextOffset:rows.length>limit?offset+limit:null};
}
function tourId(t){let h=2166136261;for(const c of `${t.date}|${t.start}|${t.guide}`)h=Math.imul(h^c.charCodeAt(0),16777619);return `tour-${(h>>>0).toString(16)}-${t.date}-${(t.start||'').replace(':','')}`;}
export async function tourPage({from,to,after,before,at,limit=50,offset=0}={}){
 if(!state.me)throw Error('Sign in to read the schedule.');
 if(!await ensure('tours'))throw Error('The schedule could not load.');
 const rows=(shared.tours||[]).filter(t=>(!from||t.date>=from)&&(!to||t.date<=to)&&(!after||(t.start||'')>after)&&(!before||(t.start&&t.start<before))&&(!at||t.start===at)).sort((a,b)=>(a.date+a.start+a.guide).localeCompare(b.date+b.start+b.guide));
 return {items:rows.slice(offset,offset+limit).map(t=>({...t,id:tourId(t)})),nextOffset:rows.length>offset+limit?offset+limit:null,limitation:'The workbook contains upcoming assignments, not historical tours, durations or minimum staffing requirements.'};
}
export async function attachOpportunities(evaluations,tours){
 // Resolve abbreviations against the directory, never a filtered candidate set.
 const directory=await select('guides','select=id,first_name,last_name,full_name&order=id.asc&limit=1001')||[];
 const complete=directory.length<=1000;
 const guides=directory.slice(0,1000).map(g=>({id:g.id,first:g.first_name,last:g.last_name,name:g.full_name||[g.first_name,g.last_name].join(' ')}));
 const index=buildNameIndex(guides),names=new Map(guides.filter(g=>guides.filter(x=>x.name.toLowerCase()===g.name.toLowerCase()).length===1).map(g=>[g.name.toLowerCase(),g]));
 return tours.map(t=>{
  const exact=guides.filter(g=>g.name.toLowerCase()===t.guide.toLowerCase());
  const matched=complete?(exact.length===1?exact[0]:exact.length===0?resolveGuide(t.guide,index,names):null):null;
  const candidates=matched?evaluations.filter(e=>e.guideId===matched.id):[];
  return {...t,evaluation:candidates.length===1?candidates[0]:null};
 });
}

export async function personalReminderPage({overdue=false,limit=50,offset=0}={}){
 if(!state.me)throw Error('Sign in to read reminders.');
 const rows=await select('hub_reminders',`select=id,title,due_at,completed_at&completed_at=is.null&order=due_at.asc,id.asc&limit=${limit+1}&offset=${offset}`+(overdue?`&due_at=lte.${enc(new Date().toISOString())}`:''))||[];
 return {items:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
}
export async function agentAnalytics(){
 if(!state.me||!isAdmin())throw Error('Leadership access required.');
 return rpc('hub_agent_analytics');
}
