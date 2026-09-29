import { state, inTraining, isAdmin } from '../core/state.js';
import { shared, ensure, loadedAt } from '../core/vanessa-data.js';
import { todayISO } from '../core/ui.js';
import { reminders, notifications, activity } from './workspace.js';

export function summarizeOperations(tours, guides, {from=todayISO(),to=from}={}) {
 const selected=tours.filter(t=>t.date>=from && t.date<=to).sort((a,b)=>(a.date+(a.start||a.slot)).localeCompare(b.date+(b.start||b.slot)));
 const pending=guides.filter(g=>!g.skip && !g.submitted);
 const sameSlot=(g,t)=>g.date===t.date && g.time && g.time===(t.start||'').slice(0,5);
 const timeline=selected.map(t=>{
  const matches=guides.filter(g=>g.name.toLowerCase()===String(t.guide).toLowerCase() || g.tours?.some(x=>x.date===t.date && x.start===t.start && x.guide===t.guide));
  const g=matches.length===1?matches[0]:null;
  return {...t,evalId:g?.id,evaluator:g && sameSlot(g,t)?g.evaluator:'',needsEval:!!g && !g.skip && !g.submitted,matchUnknown:!g};
 });
 const conflicts=[];const seen=new Map();
 for(const t of timeline) {
  // The source has start times, not durations. Only assert exact-slot collisions.
  if(!t.start)continue;
  const key=`${t.date}:${t.start}:${String(t.guide).toLowerCase()}`;
  if(seen.has(key))conflicts.push(`${t.guide} has duplicate assignments on ${t.date} at ${t.start}.`);else seen.set(key,true);
 }
 const evalSlots=new Map();
 for(const g of pending.filter(g=>g.evaluatorId && g.date>=from && g.date<=to && g.time)) {
  const key=`${g.evaluatorId}:${g.date}:${g.time}`;
  if(evalSlots.has(key))conflicts.push(`${g.evaluator || 'An evaluator'} has evaluations at the same time on ${g.date} at ${g.time}.`);else evalSlots.set(key,g.id);
 }
 return {timeline,conflicts,unclaimed:pending.filter(g=>!g.evaluatorId),overdue:pending.filter(g=>g.date && g.date<todayISO()),unevaluatedTours:timeline.filter(t=>t.needsEval && !t.evaluator),days:[...new Set(selected.map(t=>t.date))].map(date=>({date,count:selected.filter(t=>t.date===date).length}))};
}
export async function operations(range={}) {
 if(!state.me)throw new Error('Sign in to view operations.');
 const version=state.sessionVersion;
 const results=await Promise.all([ensure('tours'),inTraining()?ensure('roster'):Promise.resolve(false),inTraining()?ensure('desks'):Promise.resolve(false)]);
 if(version!==state.sessionVersion)throw new Error('The signed-in account changed.');
 if(!results[0])throw new Error('The tour schedule could not be loaded.');
 const deskGaps=[];const start=range.from||todayISO(),end=range.to||start;
 if(results[2]){const date=new Date(start+'T12:00:00');for(let i=0;i<31;i++){const iso=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;if(iso>end)break;const day=date.toLocaleDateString('en-US',{weekday:'long'});for(const row of shared.desks||[])if(!String(row.person||'').trim()&&String(row.day).slice(0,3).toLowerCase()===day.slice(0,3).toLowerCase())deskGaps.push({...row,date:iso});date.setDate(date.getDate()+1);}}
 const result=summarizeOperations(shared.tours||[],results[1]?state.guides:[],range);
 return {...result,deskGaps,desksAvailable:results[2],evalsAvailable:results[1],loadedAt:loadedAt('tours'),coverageNote:'The workbook lists assigned guides. Expected staffing and empty tour slots are unavailable; guide coverage cannot be measured. Exact start-time collisions are shown; durations are unavailable.'};
}
export function analytics(guides,{from='',to=''}={}) {
 if(!isAdmin())throw new Error('Leadership access required.');
 const filtered=guides.filter(g=>!g.skip && (!from || g.date>=from) && (!to || (g.date && g.date<=to)));
 const completed=filtered.filter(g=>g.submitted);
 const durations=completed.filter(g=>g.claimedAt && g.submittedAt && Date.parse(g.submittedAt)>=Date.parse(g.claimedAt)).map(g=>(Date.parse(g.submittedAt)-Date.parse(g.claimedAt))/86400000);
 const workloads=new Map();for(const g of filtered){const key=g.evaluatorId||'unclaimed';const w=workloads.get(key)||{name:g.evaluator||'Unclaimed',total:0,open:0};w.total++;if(!g.submitted)w.open++;workloads.set(key,w);}
 return {total:filtered.length,completed:completed.length,rate:filtered.length?Math.round(completed.length/filtered.length*100):null,overdue:filtered.filter(g=>!g.submitted && g.date && g.date<todayISO()).length,averageDays:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,durationSamples:durations.length,workloads:[...workloads.values()].sort((a,b)=>b.open-a.open)};
}
export async function briefing(since) {
 const result=await Promise.allSettled([operations(),reminders(),notifications(),activity(since?{since}:{})]);
 return {operations:result[0].status==='fulfilled'?result[0].value:null,reminders:result[1].status==='fulfilled'?result[1].value:null,notifications:result[2].status==='fulfilled'?result[2].value:null,activity:result[3].status==='fulfilled'?result[3].value:null,unavailable:[...result.flatMap((r,i)=>r.status==='rejected'?[['schedule','reminders','notifications','activity'][i]]:[]),...(inTraining() && (result[0].status==='rejected'||!result[0].value.evalsAvailable)?['evaluations']:[])]};
}
