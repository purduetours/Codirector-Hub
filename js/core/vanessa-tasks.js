import { state, inTraining } from './state.js';
import { loadSavedDraft } from './vanessa-draft-store.js';
export function taskSummary(question, now=new Date()) {
  if(!/\bwhat (?:do i need|should i|have i got|is left for me)\b|\b(?:my tasks|my to.?do|task summary)\b/i.test(question))return null;
  if(!inTraining())return {text:'Your evaluation task summary is available to training members.'};
  if(!state.loadedAt)return {text:'Your evaluations have not loaded. Use Refresh to see your tasks.'};
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=k=>parts.find(p=>p.type===k).value;
  const today=`${part('year')}-${part('month')}-${part('day')}`;
  const mine=(state.guides||[]).filter(g=>g.evaluatorId===state.me?.id&&g.status==='claimed');
  const dated=mine.filter(g=>g.date).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const undated=mine.filter(g=>!g.date), saved=loadSavedDraft();
  return {text:`You have ${mine.length} claimed evaluation${mine.length===1?'':'s'} awaiting submission.`+
    (saved?`\nSaved draft: ${saved.draft.name}. Say “continue my eval” to resume.`:'')+
    (dated.length?'\n\nScheduled evaluations (Purdue local time):\n'+dated.map(g=>`- ${g.name} — ${g.date} ${g.time||'(time needed)'}${g.date<today?' — past date; check whether feedback is still due':g.date===today?' — today':''}`).join('\n'):'')+
    (undated.length?'\n\nChoose a tour date in Eval Tracker:\n'+undated.map(g=>`- ${g.name}`).join('\n'):'')+
    '\n\nBased on your loaded Eval Tracker data. Use Refresh for recent changes.'};
}
