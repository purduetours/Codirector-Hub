// Operations use Purdue's timezone; callers may supply a validated IANA override.
export const HUB_ZONE='America/Indiana/Indianapolis';
export function zonedParts(now=new Date(),zone=HUB_ZONE){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=k=>parts.find(x=>x.type===k).value;
 return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}
export function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value;}
export function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function localInstant(date,time,zone=HUB_ZONE){
 if(!validDate(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Use a valid date and time.');
 const target=Date.parse(`${date}T${time}:00Z`);let estimate=target;
 for(let i=0;i<4;i++){const p=zonedParts(new Date(estimate),zone);const delta=target-Date.parse(`${p.date}T${p.time}:00Z`);if(!delta)break;estimate+=delta;}
 const p=zonedParts(new Date(estimate),zone);
 if(p.date!==date||p.time!==time)throw Error('That local time does not exist because of the daylight-saving change. Choose another time.');
 // A repeated autumn clock hour has two valid instants: do not choose silently.
 for(const shift of [-3600000,3600000]){const other=zonedParts(new Date(estimate+shift),zone);if(other.date===date&&other.time===time)throw Error('That local time occurs twice because of the daylight-saving change. Choose a time outside that hour.');}
 return new Date(estimate).toISOString();
}
export function parseTimeWindow(raw,now=new Date(),zone=HUB_ZONE){
 const q=String(raw).toLowerCase(),p=zonedParts(now,zone);let from=p.date,to=p.date,explicit=false;
 const relative=q.match(/\b(?:today|tomorrow|yesterday|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:this|next) week)\b/g)||[];
 if(relative.length>1)return {error:'Which date should I use? Include one day or an explicit YYYY-MM-DD range.'};
 const exact=[...q.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(x=>x[0]);
 if(exact.length){if(exact.some(x=>!validDate(x))||exact.length>2)return {error:'Use one valid date or a start and end date (YYYY-MM-DD).'};[from,to]=[exact[0],exact[1]||exact[0]];explicit=true;}
 else if(/\bend of (?:the |this )?month\b/.test(q)){const d=new Date(p.date+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);to=d.toISOString().slice(0,10);from=/\b(?:by|through|until)\b/.test(q)?p.date:to;explicit=true;}
 else if(/\b(?:this|next) week\b/.test(q)){const dow=new Date(p.date+'T12:00:00Z').getUTCDay(),mon=addDays(p.date,-((dow+6)%7));from=/\bnext week\b/.test(q)?addDays(mon,7):p.date;to=addDays(/\bnext week\b/.test(q)?addDays(mon,7):mon,6);explicit=true;}
 else if(/\btomorrow\b/.test(q)){from=to=addDays(p.date,1);explicit=true;}
 else if(/\byesterday\b/.test(q)){from=to=addDays(p.date,-1);explicit=true;}
 else {
  const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const hits=names.filter(x=>new RegExp('\\b'+x+'\\b').test(q));
  if(hits.length>1)return {error:'Which day should I use? Give one date or an explicit YYYY-MM-DD range.'};
  if(hits.length){const day=names.indexOf(hits[0]),dow=new Date(p.date+'T12:00:00Z').getUTCDay();if(new RegExp('\\bnext '+hits[0]).test(q)){const mon=addDays(p.date,-((dow+6)%7));from=to=addDays(mon,7+(day+6)%7);}else from=to=addDays(p.date,(day-dow+7)%7);explicit=true;}
  else if(/\btoday\b/.test(q)){explicit=true;}
  else if(/\b(?:last|next month|recently|ago|weekend)\b|\d+\/\d+/.test(q))return {error:'Which date range do you mean? Give a start and end date so I don’t guess.'};
 }
 if(from>to)return {error:'The end date must be after the start date.'};
 let after=null,before=null,at=null;
 const matches=[...q.matchAll(/\b(after|before|at)\s+(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/g)];
 if(new Set(matches.map(m=>m[1])).size!==matches.length)return {error:'Give one start and one end time, or one exact time.'};
 for(const m of matches){let t=m[2].trim();if(t==='noon')t='12:00';else if(t==='midnight')t='00:00';else{const v=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);let h=+v[1],min=+(v[2]||0);if(h>23||min>59||(v[3]&&(h<1||h>12)))return {error:'Use a valid time, such as 2 PM or 14:00.'};if(v[3])h=h%12+(v[3]==='pm'?12:0);else if(h>=1&&h<=12&&!v[2])return {error:`Do you mean ${h} AM or ${h} PM? Include the time in your request.`};t=String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');}if(m[1]==='after')after=t;if(m[1]==='before')before=t;if(m[1]==='at')at=t;}
 if((after&&before&&after>=before)||(at&&((after&&at<=after)||(before&&at>=before))))return {error:'Those time limits conflict. Give a valid time window.'};
 if(/\blater today\b/.test(q))after=p.time;
 return {from,to,after,before,at,explicit,zone,convention:/\bnext (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(q)?'“Next weekday” means that day in the next calendar week.':null};
}
