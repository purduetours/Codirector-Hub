import { state, inTraining } from './state.js';
import { dateRange } from './vanessa-dates.js';
export function matchEvalTours(question) {
  const q=question.toLowerCase();
  if(/^how (?:do|can|should|would)\b/.test(q))return null;
  if (!/\bevals?\b|\bevaluat(?:e|ion)s?\b/.test(q)) return null;
  const range=dateRange(q);
  if (!range && !/\btours?\b|\bavailable\b/.test(q)) return null;
  if (!inTraining())return {text:'Tour matching for evaluations is available to the training team.'};
  if(range?.error)return {text:range.error};
  if(!range)return {text:'Which day should I check? Include today, tomorrow, a weekday, this week, next week, or YYYY-MM-DD.'};
  if(state.guideToursLoaded===false || (!state.loadedAt && !state.guides.length))return {text:'The guide schedule has not loaded. Use Refresh before looking for an evaluation tour.'};
  let timeFilter=null;
  const time=/\b(at|after|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(q);
  if(time){
    let h=Number(time[2]);const m=Number(time[3]||0);
    if((time[4] && (h<1||h>12)) || (!time[4] && !time[3]) || h>23 || m>59)
      return {text:'For a time filter, use am/pm or a 24-hour time such as “after 2 pm” or “at 14:30”.'};
    if(time[4])h=h%12+(time[4]==='pm'?12:0);
    timeFilter={kind:time[1],minutes:h*60+m};
  }
  const priorities=['first','second','third','fourth','fifth','last'];
  const ranks=/\bpriority\b/.test(q)?priorities.map((p,i)=>new RegExp(`\\b${p}\\b`).test(q)?i+1:null).filter(Boolean):[];
  if(/\b(?:high|urgent) priority\b/.test(q))ranks.push(1,2);
  const mine=/\bmy\b|\bi claimed\b/.test(q);
  const candidates=(state.guides||[]).filter(g=>!g.skip && (mine ? g.status==='claimed' && g.evaluatorId===state.me?.id : g.status==='open') && (!ranks.length||ranks.includes(g.rank)));
  const hits=candidates.map(g=>({g,tours:(g.tours||[]).filter(t=>{
    if(t.date<range.from||t.date>range.to)return false;
    if(!timeFilter)return true;
    const m=/^(\d{1,2}):(\d{2})/.exec(t.start||'');if(!m)return false;
    const minutes=Number(m[1])*60+Number(m[2]);
    return timeFilter.kind==='after'?minutes>timeFilter.minutes:timeFilter.kind==='before'?minutes<timeFilter.minutes:minutes===timeFilter.minutes;
  }).sort((a,b)=>a.date.localeCompare(b.date)||(a.start||'').localeCompare(b.start||''))})).filter(x=>x.tours.length)
    .sort((a,b)=>(a.g.rank??99)-(b.g.rank??99)||a.g.name.localeCompare(b.g.name));
  const scope=range.from===range.to?range.from:`${range.from} through ${range.to}`;
  if(!hits.length)return {text:`No ${mine?'guides claimed by you':'unclaimed guides needing an eval'} match ${scope}${time?' and that time filter':''}${ranks.length?' at that priority':''} in the loaded schedule.`};
  const shown=hits.slice(0,10);
  return {names:shown.map(x=>x.g.name),text:`${hits.length} ${mine?'claimed':'unclaimed'} guide${hits.length===1?'':'s'} with tours for ${scope}, ordered by evaluation priority:\n`+
    shown.map(({g,tours})=>`- ${g.name} — ${g.priority || 'priority not set'}\n  ${tours.slice(0,3).map(t=>`${t.date} at ${t.start || t.slot}`).join('; ')}${tours.length>3?`; ${tours.length-3} more tours`:''}`).join('\n')+
    (hits.length>10?`\n…and ${hits.length-10} more matching guides.`:'')+'\n\nCheck Eval Tracker to claim a tour; this search does not reserve it.'};
}
