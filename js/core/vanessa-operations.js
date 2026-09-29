/* A small catalog of executable, permission-checked workflows. Models may
   select a read-only workflow; only the app resolves records and runs writes. */
import { state, isAdmin, inTraining } from './state.js';
import { select } from './db.js';
import { todayISO, prettyDate, prettyTime } from './ui.js';
import { dateRange } from './vanessa-dates.js';
import * as facts from './vanessa-facts.js';
import { matchingNames } from './vanessa-makeup.js';
import { outstandingMakeups } from '../modules/training.js';
import { go, denied } from './vanessa-exec.js';
import { startEvaluation } from './vanessa-flow-eval.js';
import { completeMakeup, undoTraining } from './vanessa-training-flow.js';
import { conversationContext, rememberConversation, recentReceipts, currentDraft, rememberDraft, pendingReview, clearReview } from './vanessa-conversation.js';

export const WORKFLOWS = [
  {id:'briefing',description:'Summarize current priorities, training and upcoming evaluation work.'},
  {id:'meeting',description:'Prepare a meeting agenda from loaded training and evaluation records.'},
  {id:'profile',description:'Show one named guide’s training status, evaluation and upcoming tours.'},
  {id:'makeups',description:'List people who still owe makeup training and their sessions.'},
  {id:'training_reason',description:'Explain why a named guide owes makeup, using their attendance records.'},
  {id:'history',description:'Show recent training changes for a named guide.'},
  {id:'reminder',description:'Draft makeup reminders for review; never send messages.'},
  {id:'eval_plan',description:'Suggest unclaimed evaluation opportunities from scheduled tours and priority.'}
];
const reply = text => ({type:'reply',text});
const unavailable = (what,retry) => ({type:'reply',kind:'alert',text:`I couldn’t load ${what}. Try again before relying on this summary.`,retry});
const word = (n,s) => `${n} ${n !== 1 && s === 'person' ? 'people' : s + (n===1?'':'s')}`;
const namesFrom = q => q.replace(/^(?:please\s+)?(?:show me |show |open |pull up |tell me about |how is |how’s |how's |what about |and |check on )/i,'')
  .replace(/(?:’s|'s)?\s+(?:guide )?(?:profile|overview|training history|history|training|record|doing|status)[?.!]*$/i,'').replace(/[?.!]+$/,'').trim();
export function operationIntent(raw) {
  const q = String(raw || '').trim().replace(/^(?:hey[, ]+)?vanessa[, ]+/i,'');
  if (/^(?:undo|revert)(?: (?:that|it|the last (?:change|update)|my last (?:change|update)))?[.!]?$/i.test(q)) return {id:'undo'};
  if (/^(?:what did you (?:change|update|do)|show (?:my |your )?recent (?:changes|actions)|recent actions)[?.!]*$/i.test(q)) return {id:'receipts'};
  if (/\b(?:brief(?:ing| me)|catch me up|bring me up to speed|what (?:needs my attention|should i (?:do|focus on))|my priorities|plan my day)\b/i.test(q)) return {id:'briefing'};
  if (/\b(?:meeting|agenda)\b/i.test(q) && /\b(?:prep|prepare|plan|agenda|summary|brief)\b/i.test(q)) return {id:'meeting'};
  if (/\b(?:draft|write|prepare)\b/i.test(q) && /\b(?:reminders?|follow[ -]?ups?|message)\b/i.test(q) && /\b(?:makeup|training|them|her|him|everyone)\b/i.test(q)) {
    const named = /\b(?:for|to)\s+(.+?)(?:\s+about\b.*)?[.!?]*$/i.exec(q)?.[1];
    const person = named && !/^(?:everyone|everybody|all|all of them)$/i.test(named) ? named : /\b(?:them|her|him)\b/i.test(q) ? conversationContext()?.person : null;
    return {id:'reminder',person};
  }
  if (/\b(?:who (?:still )?(?:owes|needs)|outstanding|overdue)\b.*\bmake[ -]?up|\bmake[ -]?ups? (?:owed|outstanding)\b/i.test(q)) return {id:'makeups'};
  let m = /^(?:why (?:does|is)|explain (?:why )?)\s+(.+?)\s+(?:still )?(?:owe|owing|need|behind|have)\b.*(?:makeup|training)/i.exec(q);
  if (m) return {id:'training_reason',person:m[1]};
  m = /^(?:who (?:changed|updated)|(?:show|check)(?: me)?(?: the)? (?:history|changes)(?: for| of)?)\s+(.+?)(?:’s|'s)?(?:\s+(?:training|record|attendance))?[?.!]*$/i.exec(q);
  if (m) return {id:'history',person:m[1]};
  if (/\b(?:suggest|recommend|plan|prioriti[sz]e)\b.*\beval|\bwho should (?:i|we) evaluat/i.test(q)) return {id:'eval_plan'};
  if (/^(?:make (?:it|that|this) )?(?:shorter|warmer|more direct|more formal)[.!]*$/i.test(q) && currentDraft()) return {id:'refine_draft',style:q.toLowerCase()};
  if (/^(?:actually[, ]+)?(?:no[, ]+)?(?:i meant|i mean)\s+/i.test(q) && conversationContext()) return {id:'profile',person:q.replace(/^(?:actually[, ]+)?(?:no[, ]+)?(?:i meant|i mean)\s+/i,'').replace(/[?.!]+$/,'')};
  if (/^(?:what about|and)\s+[\p{L} .’'-]+[?.!]*$/iu.test(q) && conversationContext()) return {id:conversationContext().topic==='history'?'history':conversationContext().topic==='training'?'training_reason':'profile',person:namesFrom(q)};
  if (/^(?:tell me about|show me|show|open|pull up|how is|check on)\s+/i.test(q) && (/\bprofile\b|\boverview\b|\bdoing\b/i.test(q) || /^tell me about\s+/i.test(q))) return {id:'profile',person:namesFrom(q)};
  return null;
}

function sourceSummary(parts) { return parts.filter(p=>p?.ok).map(p=>p.source).filter(Boolean).join(' and '); }
async function overview() {
  const [r,t] = await Promise.all([inTraining()?facts.roster():null,isAdmin()?facts.training():null]);
  const missing = [];
  if (inTraining() && !r?.ok) missing.push('evaluation roster');
  if (isAdmin() && !t?.ok) missing.push('training records');
  return {r,t,missing};
}
async function briefing(meeting=false) {
  const {r,t,missing} = await overview();
  const rows=[],steps=[],actions=[];
  if(r?.ok) {
    const needed=r.guides.filter(g=>!g.skip && g.status!=='skip'), open=needed.filter(g=>g.status==='open');
    const mine=needed.filter(g=>g.status==='claimed' && g.evaluatorId===state.me?.id);
    rows.push(['Your evaluations',`${mine.length} in progress · ${mine.filter(g=>!g.date).length} need a tour date`]);
    rows.push(['Evaluation progress',`${needed.filter(g=>['submitted','reviewed'].includes(g.status)).length} of ${needed.length} submitted or reviewed`]);
    rows.push(['Waiting for an evaluator',word(open.length,'guide')]);
    const urgent=open.filter(g=>g.rank<=2);
    if(urgent.length) steps.push(`Prioritize ${urgent.map(g=>g.name).slice(0,5).join(', ')}${urgent.length>5?` and ${urgent.length-5} others`:''} for evaluation.`);
    if(mine.some(g=>!g.date)) steps.push('Set tour dates for your claimed evaluations before arranging coverage.');
    if(isAdmin()) {const n=needed.filter(g=>g.status==='submitted').length; rows.push(['Waiting for review',word(n,'evaluation')]);}
    actions.push({label:'Find evaluation opportunities',run:()=>evalPlan('this week')});
  }
  if(t?.ok) {
    const owing=[...t.perPerson].filter(([,v])=>v.owed);
    rows.push(['Makeup training',`${word(owing.length,'person')} · ${owing.reduce((sum,[,v])=>sum+v.owed,0)} sessions outstanding`]);
    if(owing.length) steps.push(`Follow up on makeup training with ${owing.slice(0,5).map(([name])=>name).join(', ')}${owing.length>5?` and ${owing.length-5} others`:''}.`);
    actions.push({label:'Work through makeups',run:()=>makeups()},{label:'Draft reminders',run:()=>reminders()});
  }
  rememberConversation(meeting?'meeting':'briefing');
  const text=missing.length?`This is a partial briefing: I couldn’t load ${missing.join(' or ')}.`:rows.length?'Here’s where things stand and what I’d tackle next.':'Your account can use Vanessa for the tour schedule and handbook.';
  const plan={type:'summary',title:meeting?'Your meeting brief':'Let’s get you caught up',text,rows,steps,source:sourceSummary([r,t]),at:new Date(),actions:actions.concat({label:meeting?'Rebuild brief':'Prepare meeting agenda',run:()=>briefing(true)})};
  if(meeting) {
    const agenda=[`Codirector meeting · ${prettyDate(todayISO())}`,text,'',...rows.map(([k,v])=>`${k}: ${v}`),'','Discussion',...(steps.length?steps:['Review current priorities and agree on next steps.']).map((s,i)=>`${i+1}. ${s}`),'','Decisions and owners','• Decision:','• Owner:','• Follow-up date:'].join('\n');
    plan.actions.unshift({label:'Open editable agenda',run:()=>draftPlan('Meeting agenda',agenda)});
  }
  return plan;
}
async function makeups() {
  if(!isAdmin())return denied();
  const t=await facts.training();if(!t.ok)return unavailable('training records',makeups);
  const owed=[...t.perPerson].filter(([,v])=>v.owed).sort((a,b)=>b[1].owed-a[1].owed||a[0].localeCompare(b[0]));
  rememberConversation('training');
  return {type:'summary',title:owed.length?'Let’s work through makeup training':'Everyone is caught up',text:owed.length?`${word(owed.length,'person')} ${owed.length===1?'owes':'owe'} makeup training. Choose a person to see their sessions, or tell me who finished.`:'No outstanding makeups in the current training records.',
    items:owed.map(([name,v])=>({label:name,sub:word(v.owed,'session'),kind:'person',run:()=>profile(name)})),source:t.source,at:t.at,
    actions:owed.length?[{label:'Draft reminders for everyone',run:()=>reminders()}]:[]};
}
async function withPerson(query, topic, next) {
  if(!inTraining() && !isAdmin())return denied();
  const ctx=conversationContext();
  if(!query || /^(?:him|her|them|he|she|they|that person)$/i.test(query))query=ctx?.person;
  if(!query)return reply('Who should I look up? Try “show Ella’s profile” with their name.');
  const {r,t,missing}=await overview();
  const names=[...new Set([...(r?.ok?r.guides.map(g=>g.name):[]),...(t?.ok?[...t.perPerson.keys()]:[])])];
  const hits=matchingNames(query,names);
  if(!hits.length)return reply(missing.length?`I couldn’t load ${missing.join(' or ')}. Retry before looking up ${query}.`:`I couldn’t find “${query}”. Try their full name as it appears in the hub.`);
  const choose=name=>{rememberConversation(topic,name);return next(name,r,t,missing);};
  if(hits.length>1)return {type:'select',title:'Which person do you mean?',options:hits.map(name=>({label:name,run:()=>choose(name)}))};
  return choose(hits[0]);
}
export async function profile(query) {
  return withPerson(query,'profile',(name,r,t,missing)=>{
    const g=r?.guides?.find(g=>g.name===name),tr=t?.perPerson?.get(name);
    const rows=[];
    if(g) {
      const labels={open:'Needs an evaluator',claimed:'Evaluation in progress',submitted:'Submitted for review',reviewed:'Reviewed',skip:'No evaluation needed'};
      rows.push(['Evaluation',labels[g.status]||g.status||'Not recorded']);
      if(g.priority)rows.push(['Priority',g.priority]);
      if(g.evaluator)rows.push(['Evaluator',g.evaluator]);
      const upcoming=(g.tours||[]).filter(x=>x.date>=todayISO()).sort((a,b)=>a.date.localeCompare(b.date)||(a.start||'').localeCompare(b.start||''));
      rows.push(['Upcoming tours',upcoming.length?upcoming.slice(0,4).map(x=>`${prettyDate(x.date)} · ${prettyTime(x.start)||x.slot||'time not set'}`).join('\n'):'None in the loaded schedule']);
    }
    if(tr)rows.push(['Training',`${tr.attended} attended · ${tr.makeup} made up · ${tr.owed} outstanding`]);
    const actions=[];
    if(tr?.owed)actions.push({label:'Why do they owe makeup?',run:()=>trainingReason(name)}, {label:'Record makeup completion',run:()=>completeMakeup({raw:`${name} completed makeup training`})},{label:'Draft a reminder',run:()=>reminders(name)});
    if(isAdmin())actions.push({label:'Training change history',run:()=>history(name)});
    if(g && inTraining() && !g.skip)actions.push({label:'Work on evaluation',run:()=>startEvaluation({raw:`evaluate ${name}`,names:name.toLowerCase().split(/\s+/)})});
    return {type:'summary',title:name,text:missing.length?`I couldn’t load ${missing.join(' or ')}; those details are missing.`:'Their current picture, all in one place.',rows,source:sourceSummary([r,t]),at:new Date(),actions};
  });
}
async function trainingReason(query) {
  if(!isAdmin())return denied();
  return withPerson(query,'training',(name,r,t)=>{
    if(!t?.ok)return unavailable('training records',()=>trainingReason(name));
    const owed=outstandingMakeups(name);
    return {type:'summary',title:`Why ${name} ${owed.length?'owes makeup':'is caught up'}`,text:owed.length?'These sessions are still outstanding. An absence-form inference is shown separately from a saved absence.':'There are no outstanding makeups in the current records.',
      rows:owed.map(row=>[t.sessions.find(s=>s.id===row.session_id)?.label||'Training',/absent/i.test(row.actual||'')?`Saved attendance: ${row.actual}`:'Absence inferred from a filed response; no completion is recorded']),
      source:t.source,at:t.at,actions:owed.length?[{label:'They completed a makeup',run:()=>completeMakeup({raw:`${name} completed makeup training`})},{label:'Draft a reminder',run:()=>reminders(name)}]:[]};
  });
}
async function history(query) {
  if(!isAdmin())return denied();
  return withPerson(query,'history',async(name,r,t)=>{
    if(!t?.ok)return unavailable('training records',()=>history(name));
    const ids=t.attendance.filter(a=>a.person_name===name).map(a=>a.id);
    if(!ids.length)return reply(`There are no training records for ${name} in this term.`);
    try {
      const rows=await select('training_history',`select=*&attendance_id=in.(${ids.map(encodeURIComponent).join(',')})&order=changed_at.desc&limit=30`);
      const editors=[...new Set(rows.map(x=>x.changed_by).filter(Boolean))];let people=[];
      if(editors.length)try{people=await select('members',`select=id,full_name&id=in.(${editors.map(encodeURIComponent).join(',')})`);}catch{}
      return {type:'summary',title:`${name} · training history`,text:rows.length?'Most recent changes first.':'No recorded training changes for this person.',rows:rows.map(x=>[
        `${t.sessions.find(s=>s.id===x.session_id)?.label||'Training'} · ${new Date(x.changed_at).toLocaleString()}`,
        `${x.field}: ${x.was||'blank'} → ${x.became||'blank'}\n${people.find(p=>p.id===x.changed_by)?.full_name||'Editor unavailable'}`]),source:'Training change history',at:new Date()};
    }catch{return reply('The training history could not be loaded. The history migration must be installed and your account must have access; attendance itself is unchanged.');}
  });
}
function draftPlan(title,text,meta={}) {
  rememberDraft({title,text,...meta});
  return {type:'draft',title,text:'Here’s a draft you can edit and copy. It hasn’t been sent.',draft:text,filename:meta.kind==='reminder'?'makeup-reminders.txt':'meeting-agenda.txt',source:meta.source,
    onEdit:text=>rememberDraft({title,text,...meta})};
}
async function reminders(query=null,style='friendly') {
  if(!isAdmin())return denied();
  const t=await facts.training();if(!t.ok)return unavailable('training records',()=>reminders(query,style));
  let names=[...t.perPerson].filter(([,v])=>v.owed).map(([name])=>name);
  if(query) {
    const hits=matchingNames(query,[...t.perPerson.keys()]);
    if(hits.length!==1)return withPerson(query,'training',name=>reminders(name,style));
    names=hits;
  }
  names=names.filter(name=>t.perPerson.get(name)?.owed);
  if(!names.length)return reply('No outstanding makeup training to send a reminder about.');
  const text=names.map(name=>{
    const sessions=outstandingMakeups(name).map(row=>t.sessions.find(s=>s.id===row.session_id)?.label||'training').join(', ');
    if(style.includes('short'))return `To: ${name}\nHi ${name.split(' ')[0]}, please follow up on makeup training for ${sessions}. If you’ve completed it, let us know the date so we can update your record. Thanks!`;
    if(style.includes('direct')||style.includes('formal'))return `To: ${name}\nSubject: Outstanding makeup training\n\nOur records show outstanding makeup training for ${sessions}. Please contact the codirectors to arrange completion. If you have already completed it, reply with the completion date and details so we can update your record.\n\nThank you.`;
    return `To: ${name}\nSubject: Checking in on makeup training\n\nHi ${name.split(' ')[0]},\n\nJust checking in about makeup training for ${sessions}. When you have a chance, please let us know your plan for completing it. If you’ve already taken care of it, send us the date and a quick note about what you completed so we can get your record up to date.\n\nThanks for following up!`;
  }).join('\n\n────────────────────\n\n');
  rememberConversation('training',names.length===1?names[0]:null);
  return draftPlan(names.length===1?`Reminder for ${names[0]}`:`${names.length} makeup reminders`,text,{kind:'reminder',query,style,source:t.source});
}
async function evalPlan(q) {
  if(!inTraining())return denied();
  const r=await facts.roster();if(!r.ok)return unavailable('the evaluation roster',()=>evalPlan(q));
  const range=dateRange(q)||dateRange('this week');if(range.error)return reply(range.error);
  if(state.guideToursLoaded===false)return reply('The guide schedule could not be loaded. Refresh before planning evaluations.');
  const hits=r.guides.filter(g=>!g.skip&&g.status==='open').map(g=>({g,tours:(g.tours||[]).filter(t=>t.date>=range.from&&t.date<=range.to)})).filter(x=>x.tours.length)
    .sort((a,b)=>(a.g.rank??99)-(b.g.rank??99)||a.g.name.localeCompare(b.g.name));
  rememberConversation('evaluations');
  return {type:'summary',title:'Evaluation opportunities',text:`${range.from} through ${range.to}. Ordered by recorded priority. These are opportunities, not confirmed evaluator availability or assignments.`,
    items:hits.slice(0,20).map(({g,tours})=>({label:g.name,sub:`${g.priority||'Priority not set'} · ${tours.slice(0,2).map(t=>`${prettyDate(t.date)} at ${prettyTime(t.start)}`).join('; ')}`,kind:'person',run:()=>profile(g.name)})),
    more:hits.length>20?`${hits.length-20} more matching guides in Eval Tracker.`:!hits.length?'No unclaimed guides have a matching tour in the loaded schedule.':null,source:r.source,at:r.at,actions:[go('evals','Open Eval Tracker')]};
}
export async function runWorkflow(id,{person=null,question=''}={}) {
  switch(id) {
    case 'briefing':return briefing(); case 'meeting':return briefing(true);case 'profile':return profile(person);
    case 'makeups':return makeups();case 'training_reason':return trainingReason(person);case 'history':return history(person);
    case 'reminder':return reminders(person);case 'eval_plan':return evalPlan(question);
    default:return null;
  }
}
export async function handleOperations(raw) {
  const pending=pendingReview();
  if(pending && /^(?:yes|yep|yeah|confirm|save(?: it| them)?|go ahead|do it|looks good)[.!]*$/i.test(raw.trim())) {return pending.confirm.run();}
  if(pending && /^(?:no|nope|cancel|never mind|not now)[.!]*$/i.test(raw.trim()))return pending.cancel.run();
  if(pending)clearReview();
  const intent=operationIntent(raw);if(!intent)return null;
  if(intent.id==='undo')return undoTraining();
  if(intent.id==='receipts') {
    if(!isAdmin())return denied();const receipts=recentReceipts();
    return {type:'summary',title:'Changes in this conversation',text:receipts.length?'These updates were saved through Vanessa in this sign-in session.':'No active training changes to show from this conversation.',items:receipts.map(r=>({label:r.label,sub:`${word(r.changes.length,'record')} · ${new Date(r.at).toLocaleTimeString()}`,run:()=>({type:'summary',title:r.label,rows:r.changes.map(c=>[c.after.person_name,`${c.session}: ${c.before.actual||'blank'} → ${c.after.actual}`]),actions:[{label:'Undo this update',run:()=>undoTraining(r)}]})}))};
  }
  if(intent.id==='refine_draft') {const draft=currentDraft();return draft?.kind==='reminder'?reminders(draft.query,intent.style):reply('You can edit the agenda directly in its draft box; I’ll keep your changes while this conversation is open.');}
  return runWorkflow(intent.id,{person:intent.person,question:raw});
}
