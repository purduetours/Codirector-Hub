/* Conversational form entry. Feedback remains the user's own words. */
import { state, inTraining } from './state.js';
import { loadSavedDraft, storeDraft, removeSavedDraft } from './vanessa-draft-store.js';
import { validateEvalDraft } from './vanessa-eval-submit.js';
let actions = {}, flow = null, sequence = 0, loading = null;
export function registerEvalActions(value) { actions = value; }
export function resetEvalFlow() { sequence++; flow = null; loading = null; }
export function evalDraft() {
  if (!flow || flow.owner !== state.me?.id || flow.version !== state.sessionVersion) return null;
  return { ...flow.draft, saved: !!flow.saved, phase: flow.phase, revision: flow.revision, draftId: flow.id };
}
export const savedEvalSummary = () => { const d=loadSavedDraft(); return d ? {name:d.draft.name,savedAt:d.savedAt} : null; };
function saveFlow(){if(flow?.draft.evalId)flow.saved=storeDraft(flow);}
export const hasEvalFlow = () => !!evalDraft();
const trim = value => String(value || '').trim();
const skip = value => /^(?:skip|none|no|nothing|nope|n\/a|leave (?:it )?blank)[.!]?$/i.test(trim(value));
const norm = value => trim(value).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function ownClaims() { return (state.guides || []).filter(g => g.status === 'claimed' && g.evaluatorId === state.me?.id); }
function choicesText(choices) { return choices.map((g,i) => `${i+1}. ${g.name}${g.date ? ' — ' + g.date : ''}`).join('\n'); }
function findChoice(text, choices) {
  const q = norm(text);
  if (/^\d+$/.test(q)) return choices[Number(q)-1] || null;
  const full = choices.filter(g => (` ${q} `).includes(` ${norm(g.name)} `));
  if (full.length === 1) return full[0];
  const short = q.replace(/^(?:the eval for|eval for|for) /,'');
  const first = choices.filter(g => norm(g.name).split(' ')[0] === short);
  return first.length === 1 ? first[0] : null;
}
export function wantsEvalFlow(q) {
  if (/^how (?:do|can|should|would)\b/i.test(q)) return false;
  return /\b(?:write|draft|fill(?: out)?|complete|finish|submit|start|record|log|do)\b.{0,45}\b(?:an? |my |the )?eval(?:uation)?\b/i.test(q) ||
    /\bi (?:have|need|want|would like|got|have got)\b.{0,50}\beval(?:uation)?\b/i.test(q);
}
const labels = {
  rating:'rating', 'overall rating':'rating', strengths:'wentWell', 'went well':'wentWell', 'what went well':'wentWell',
  improve:'improve', improvements:'improve', 'areas to improve':'improve', notes:'notes', 'other notes':'notes',
  date:'date', 'tour date':'date', time:'time', 'tour time':'time'
};
function fieldsFrom(text) {
  const matches = [...text.matchAll(/(?:^|[\n;])\s*(overall rating|rating|what went well|went well|strengths|areas to improve|improvements|improve|other notes|notes|tour date|date|tour time|time)\s*:\s*/gi)];
  const fields = {};
  matches.forEach((m,i) => { fields[labels[m[1].toLowerCase()]] = text.slice(m.index+m[0].length, matches[i+1]?.index ?? text.length).trim(); });
  return fields;
}
function setField(key, value) {
  let text = trim(value);
  if(text.length>12000)return 'Keep each feedback field under 12,000 characters.';
  if(key==='rating'){const words={one:'1',two:'2',three:'3',four:'4',five:'5'};text=words[text.toLowerCase().replace(/[.!]$/,'')]||text;}
  if (key === 'rating') {
    const m = /^(?:rating\s*(?:of|is|to)?\s*)?([1-5])(?:\s*(?:\/|out of)\s*5)?[.!]?$/i.exec(text);
    if (!m && !skip(text)) return 'What number should I use for the rating: 1, 2, 3, 4, or 5? You can also say skip.';
    flow.draft.rating = m ? Number(m[1]) : null;
  } else flow.draft[key] = skip(text) ? '' : text;
  flow.answered.add(key); flow.revision++;
  return null;
}
function next() {
  for (const key of ['rating','wentWell','improve','notes']) {
    if (flow.answered.has(key)) continue;
    flow.phase = key;
    const prompts = {
      rating: 'What overall rating should I use, from 1 to 5? Say skip to leave the rating blank.',
      wentWell: 'What went well? Tell me in your own words, or say skip.',
      improve: 'What could they improve? Say none if you have nothing to add.',
      notes: 'Any other comments? Say none if that is everything.'
    };
    return { text: prompts[key], evalDraft: true };
  }
  if (!trim(flow.draft.wentWell) && !trim(flow.draft.improve)) {
    flow.answered.delete('wentWell'); flow.phase='wentWell';
    return { text: 'The form needs some feedback under strengths or improvements. What would you like recorded?', evalDraft: true };
  }
  try { validateEvalDraft(flow.draft); }
  catch (err) { flow.phase='review'; return { text: err.message + ' You can correct the draft below.', evalDraft:true }; }
  flow.phase='review';
  return { text: `Here is the draft for ${flow.draft.name}. Check the fields below, make any changes, then press Submit eval or tell me “submit it”. Nothing has been submitted yet.`, evalDraft:true };
}
function choose(guide) {
  flow.draft={ ...flow.draft, evalId:guide.id, name:guide.name, date:flow.answered.has('date') ? flow.draft.date : guide.date || '', time:flow.answered.has('time') ? flow.draft.time : String(guide.time || '').slice(0,5) };
  flow.phase='rating'; flow.revision++;
}
export async function handleEvalMessage(question) {
  try { return await handleMessage(question); } finally { saveFlow(); }
}
async function handleMessage(question) {
  const q=trim(question);
  const resume=/^(?:resume|continue|finish)(?: my| the)? (?:eval|evaluation|draft)[.!]?$/i.test(q);
  const discard=/^discard (?:my |the )?saved draft[.!]?$/i.test(q);
  if (!flow && !wantsEvalFlow(q) && !resume && !discard) return null;
  if (!state.me || !inTraining()) return {text:"That tool isn't available for your account."};
  if (flow && (flow.owner !== state.me.id || flow.version !== state.sessionVersion)) resetEvalFlow();
  if (flow?.phase === 'submitting') return {text:'Submission has started. Please wait for the server result; it cannot be cancelled now.',evalDraft:true};
  if(discard){
    if(!removeSavedDraft())return {text:'I could not remove the saved draft from this browser. Try again.',evalDraft:true};
    resetEvalFlow();return {text:'Saved draft removed. Nothing was submitted.',evalDraft:true};
  }
  if(resume && flow){delete flow.clarify;return next();}
  if(!flow && loadSavedDraft()) {
    const saved=loadSavedDraft();
    if(!resume)return {text:`You have a saved draft for ${saved.draft.name}. Say “continue my eval” to resume it, or “discard saved draft” to start over.`,evalDraft:true};
    const ticket=sequence,owner=state.me.id,version=state.sessionVersion;
    try{await actions.load?.();}catch{return {text:'I could not check your current claims. Your saved draft is still on this browser. Try continuing again.'};}
    if(ticket!==sequence || owner!==state.me?.id || version!==state.sessionVersion)return {text:'Your account changed. Resume the draft after signing in.'};
    const guide=ownClaims().find(g=>g.id===saved.draft.evalId);
    if(!guide)return {text:'That saved evaluation is no longer claimed by you or is already submitted. Check Eval Tracker. The saved draft has been retained; say “discard saved draft” to remove it.',evalDraft:true};
    flow={id:++sequence,owner,version,choices:[guide],phase:'review',answered:new Set(saved.answered.filter(k=>['rating','wentWell','improve','notes','date','time'].includes(k))),revision:0,draft:{...saved.draft,name:guide.name,owner},saved:true};
    const reply=next();return {...reply,text:`Resumed your draft for ${guide.name}.\n\n${reply.text}`};
  }
  if(resume && !flow)return {text:'There is no saved draft for your account on this browser. Say “help me write an eval” to start one.'};
  if (/^(?:cancel|cancel (?:this |the )?(?:eval|draft)|discard (?:this |the )?draft|stop)[.!]?$/i.test(q)) {
    if(!removeSavedDraft())return {text:'I could not remove the saved draft. Please try again.',evalDraft:true};
    resetEvalFlow(); return {text:'Draft discarded. Nothing was submitted.',evalDraft:true};
  }
  if (/^(?:who|which|when|find|how do i|what do i need|what should i|my tasks|my to.?do|task summary|what are my|open|go to)\b/i.test(q)) return null;
  if (flow && /^(?:submit|submit it|submit (?:this|the|my) eval|submit evaluation|confirm submission)[.!]?$/i.test(q)) {
    if (flow.phase==='review') return submitEvalDraft(flow.id, flow.revision);
    return {text:'Finish the missing fields and review the draft before submitting. Your feedback has not been changed.',evalDraft:true};
  }
  if (flow && /^(?:show|review|preview)(?: (?:my|the|this))? (?:draft|eval)[.!]?$/i.test(q)) {
    return {text:'Here is your current draft. You can edit the fields below.',evalDraft:true};
  }
  if (!flow) {
    if (loading) return {text:'I am loading your claimed evaluations.'};
    const ticket=sequence, owner=state.me.id, version=state.sessionVersion;
    try { loading=Promise.resolve(actions.load?.()); await loading; }
    catch { return {text:'I could not load your evaluations. Please try again; no draft was started.'}; }
    finally { loading=null; }
    if (ticket !== sequence || owner !== state.me?.id || version !== state.sessionVersion) return {text:'Your account changed. Start the draft again.'};
    const choices=ownClaims();
    if (!choices.length) return {text:'You have no claimed evaluations ready to submit. Claim the guide in Eval Tracker first.',go:'evals'};
    flow={id:++sequence,owner,version,choices,phase:'choose',answered:new Set(),revision:0,draft:{owner,evalId:'',name:'',date:'',time:'',rating:null,wentWell:'',improve:'',notes:''}};
    const fields=fieldsFrom(q);
    for(const [key,value] of Object.entries(fields)) setField(key,value);
    const named=findChoice(q,choices);
    // Only auto-select a sole claim when no different person was named.
    const explicit=/\b(?:for|about)\s+([^\n:;.]+)/i.exec(q)?.[1];
    if (named) choose(named);
    else if (choices.length===1 && !explicit) choose(choices[0]);
    if (!flow.draft.evalId) return {text:'Which of your claimed guides is this evaluation for? Reply with a name or number.\n'+choicesText(choices),evalDraft:true};
    if (!Object.keys(fields).length) {
      const extra = q.includes(':') ? q.slice(q.indexOf(':')+1).trim() : q.split(/\.\s+/).slice(1).join('. ').trim();
      if (extra) { flow.draft.notes=extra; flow.answered.add('notes'); }
    }
    const r=next();return {...r,text:`Let’s write ${flow.draft.name}’s evaluation. I’ll keep your feedback in your own words.\n\n${r.text}`};
  }
  if (flow.phase==='choose') {
    const chosen=findChoice(q,flow.choices);
    if(!chosen)return {text:'Please choose one of your claimed guides by name or number.\n'+choicesText(flow.choices),evalDraft:true};
    choose(chosen);const r=next();return {...r,text:`Selected ${chosen.name}.\n\n${r.text}`};
  }
  const fields=fieldsFrom(q);
  if (Object.keys(fields).length) {
    delete flow.clarify;
    for(const [key,value] of Object.entries(fields)) {const err=setField(key,value);if(err)return {text:err,evalDraft:true};}
    return next();
  }
  const change=/^(?:change|set|replace)\s+(rating|strengths|what went well|improvements|areas to improve|notes|date|time)\s+(?:to|with)\s+([\s\S]+)$/i.exec(q);
  if(change){delete flow.clarify;const err=setField(labels[change[1].toLowerCase()],change[2]);return err ? {text:err,evalDraft:true} : next();}
  if(flow.phase==='review') return {text:'To change a field, say “change rating to 4” or “notes: your comments”, or edit the draft below. Say “submit it” when it is ready, or “cancel draft”.',evalDraft:true};
  if(flow.clarify){
    const key=flow.clarify;delete flow.clarify;
    if(!/^(?:keep (?:it|that)|skip)[.!]?$/i.test(q)){
      const err=setField(key,[flow.draft[key],q].filter(Boolean).join('\n'));
      if(err){flow.clarify=key;return {text:err,evalDraft:true};}
    }
    return next();
  }
  const feedbackKey=flow.phase;
  const err=setField(flow.phase,q);
  if(!err && ['wentWell','improve'].includes(feedbackKey) && !skip(q) && /^(?:(?:it|they|the tour) (?:was|were) )?(?:good|great|fine|bad|okay|quiet|too quiet|good,? but quiet)[.!]?$/i.test(q)){
    flow.clarify=feedbackKey;
    return {text:`I kept “${q}”. ${/quiet/i.test(q)?'Was their voice hard to hear, or do you mean something else?':feedbackKey==='wentWell'?'What is one example of what they did well?':'What is one specific thing they could do differently?'} Say “keep it” to use your original wording without adding detail.`,evalDraft:true};
  }
  if (err && flow.phase==='rating' && q.split(/\s+/).length>=3 && !/\d/.test(q)) {
    flow.draft.notes=[flow.draft.notes,q].filter(Boolean).join('\n');
    flow.answered.add('notes');flow.revision++;
    return {text:'I kept that comment in Other notes. '+err,evalDraft:true};
  }
  return err ? {text:err,evalDraft:true} : next();
}
export function editEvalDraft(id, revision, patch) {
  if (!flow || id!==flow.id || revision!==flow.revision || flow.phase==='submitting' || !evalDraft()) return {text:'This draft changed. Review the current draft before continuing.',evalDraft:true};
  delete flow.clarify;
  for(const key of ['rating','wentWell','improve','notes','date','time']) {
    if(!(key in patch))continue;
    const err=setField(key,key==='rating' && patch[key]===null?'skip':patch[key]);
    if(err)return {text:err,evalDraft:true};
  }
  const reply=next();saveFlow();return reply;
}
export function bufferEvalDraft(id,revision,patch){
  if(!flow || !evalDraft() || id!==flow.id || revision!==flow.revision || flow.phase==='submitting')return false;
  for(const key of ['rating','wentWell','improve','notes','date','time'])if(key in patch)setField(key,patch[key]===null?'skip':patch[key]);
  saveFlow();return true;
}
export async function submitEvalDraft(id,revision) {
  if (!flow || id!==flow.id || revision!==flow.revision || !evalDraft()) return {text:'This draft changed. Please review it again.',evalDraft:true};
  if(flow.phase==='submitting')return {text:'The evaluation is already being submitted.',evalDraft:true};
  if(flow.phase!=='review')return {text:'Finish the draft and review it before submitting.',evalDraft:true};
  try {validateEvalDraft(flow.draft);}catch(err){return {text:err.message,evalDraft:true};}
  const current=flow;
  if(!actions.submit)return {text:'Evaluation submission is not connected. Your draft is still here.',evalDraft:true};
  flow.phase='submitting';
  try {
    const result=await actions.submit({...current.draft});
    if(flow!==current || !evalDraft())return {text:'Your account changed. Check Eval Tracker for the submission status.'};
    const removed=removeSavedDraft(current.owner);
    resetEvalFlow();
    // Mark the loaded card immediately; refresh failure must never turn a saved
    // evaluation into a reported submission failure.
    const guide=(state.guides||[]).find(g=>g.id===current.draft.evalId);
    if(guide){guide.status='submitted';guide.submitted=true;}
    let refreshed=true;
    try{await actions.load?.();}catch{refreshed=false;}
    return {text:`${result?.already ? 'Already saved' : 'Submitted'}: ${current.draft.name}’s evaluation.${result?.receipt ? '\n\n'+result.receipt : ''}${refreshed?'':' The tracker could not refresh; use Refresh to update it.'}${removed?'':' The saved draft could not be removed from this browser; it cannot be resubmitted as a new eval.'}`,evalDraft:true};
  } catch(err) {
    if(flow===current)flow.phase='review';
    return {text:`I could not confirm submission: ${err.message} Your draft is still here. Check Eval Tracker before retrying if the connection dropped.`,evalDraft:true};
  }
}
