import { state, isAdmin } from './state.js';
import * as facts from './vanessa-facts.js';
import { makeupRequest, matchingNames } from './vanessa-makeup.js';
import { activeFlow, startFlow, endFlow } from './vanessa-memory.js';
import { conversationContext, rememberConversation, rememberReceipt, recentReceipts, ownsReceipt, waitForReview, pendingReview, clearReview } from './vanessa-conversation.js';
import { markMakeupDone, outstandingMakeups, undoMakeupChanges } from '../modules/training.js';
import { go, denied } from './vanessa-exec.js';
import { explainError } from './vanessa-errors.js';

export async function undoTraining(receipt = recentReceipts()[0]) {
  if (!isAdmin()) return denied();
  if (!receipt || !ownsReceipt(receipt)) return { type:'reply', text:'There isn’t a training change from this conversation to undo.' };
  if (receipt.undone) return { type:'reply', text:'That change has already been undone.' };
  try {
    const result = await undoMakeupChanges(receipt.changes);
    receipt.undone = receipt.changes.every(c => c.undone);
    return { type:'reply', kind: result.conflicts ? 'alert' : 'confirm', text: `Restored ${result.restored} training record${result.restored === 1 ? '' : 's'}.` +
      (result.conflicts ? ` ${result.conflicts} changed since my update, so I left those alone. Refresh Training to review them.` : ''), actions:[go('training','View training')] };
  } catch (err) { return { type:'reply', kind:'error', text:'I couldn’t finish undoing that change. Some records may already have been restored; retry to finish.', retry:()=>undoTraining(receipt) }; }
}

function resultPlan(changes, error = null) {
  const receipt = changes.length ? rememberReceipt({ changes, label: [...new Set(changes.map(c => c.after.person_name))].join(', ') }) : null;
  return { type:'summary', kind: error ? 'error' : 'confirm', title:error ? 'Some records need another look' : 'Makeup training updated',
    text:error || `All set — I marked ${changes.length} makeup${changes.length === 1 ? '' : 's'} complete.`,
    rows:changes.map(c => [c.after.person_name, `${c.session} · Makeup Completed${c.after.makeup_on ? ` · ${c.after.makeup_on}` : ''}${c.after.makeup_note ? `\n${c.after.makeup_note}` : ''}`]),
    source:'Training records', at:new Date(), actions:[
      ...(receipt ? [{label:'Undo this update', run:()=>undoTraining(receipt)}] : []),
      go('training','View training')
    ].filter(Boolean) };
}

/** Resolve all names and sessions before a batch is offered for review. */
export async function completeMakeup(u, followup = false) {
  if (!isAdmin()) return denied();
  const previous = followup ? activeFlow('makeup')?.data?.request : null;
  let request = followup ? { ...previous, name:u.text, names:u.text.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean) } : makeupRequest(u.raw);
  if (!request) return null;
  if (request.error) return {type:'reply',kind:'alert',text:request.error};
  const ctx = conversationContext();
  if (/^(he|she|they|them|him|her|that person)$/.test(request.name) && ctx?.person) request = {...request,name:ctx.person,names:[ctx.person]};
  const actor = state.me?.id, version = state.sessionVersion;
  const valid = () => isAdmin() && state.me?.id === actor && state.sessionVersion === version;
  const t = await facts.training();
  if (!valid()) return denied();
  if (!t.ok) return {type:'reply',kind:'alert',text:'I couldn’t load training records. Try again in a moment.', retry:()=>completeMakeup(u,followup)};
  if (!request.name || /^(someone|somebody|he|she|they|them|him|her)$/.test(request.name)) {
    startFlow('makeup','person',{request});
    return {type:'reply',text:'Absolutely — who completed the makeup? You can give me their name.'};
  }

  const names = [...t.perPerson.keys()], chosen = [], namesToResolve = request.names || [request.name];
  const selections = [];
  const execute = async () => {
    clearReview();
    if (!valid()) return denied();
    const changes = [];
    for (const selection of selections) {
      try {
        const receipt = await markMakeupDone(selection.name, {sessionIds:selection.ids, completedOn:request.completedOn, note:request.note, receipt:true});
        if (!valid()) return denied();
        changes.push(...receipt.changes);
      } catch (err) {
        if (!valid()) return denied();
        changes.push(...(err.changes || []));
        return resultPlan(changes, `I saved ${changes.length} of ${selections.reduce((sum,s)=>sum+s.ids.length,0)} sessions. The rest couldn’t be saved. Refresh Training before retrying.`);
      }
    }
    endFlow('completed');
    if (chosen.length === 1) rememberConversation('training',chosen[0]);
    return changes.length ? resultPlan(changes) : {type:'reply',text:'Those makeups are already marked complete. No records needed changing.'};
  };
  const review = () => {
    if (!selections.length) return {type:'reply',text:`${chosen.join(' and ')} ${chosen.length === 1 ? 'has' : 'have'} no outstanding makeups — already caught up.`};
    if (chosen.length === 1 && !request.completedOn && !request.note) return execute();
    const plan = {type:'confirm',flow:'makeup',title:'Here’s what I’ll record',text:'Check the people, sessions, and completion details before I save.',
      rows:selections.map(s=>[s.name,s.ids.map(id=>t.sessions.find(x=>x.id===id)?.label || 'Training').join(', ')]).concat(
        request.completedOn ? [['Completed on',request.completedOn]] : [], request.note ? [['Note',request.note]] : []),
      confirm:{label:'Save completion',run:()=>{if(pendingReview()!==plan)return {type:'reply',text:'That review is no longer active. Ask me to prepare the update again.'};clearReview();return execute();}},cancel:{label:'Cancel',run:()=>{clearReview();endFlow('cancelled');return {type:'reply',text:'Okay — I left those records as they were.',cancelled:true};}}};
    return waitForReview(plan);
  };
  const resolveSessions = index => {
    if (!valid()) return denied();
    if (index === chosen.length) { endFlow('completed'); return review(); }
    const name = chosen[index]; let rows = outstandingMakeups(name);
    if (request.session) {
      const key = s => String(s || '').toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g,'$1').replace(/[^a-z0-9]/g,'');
      rows = rows.filter(r=>t.sessions.some(s=>s.id===r.session_id && [s.label,s.held_on].some(v=>key(v)===key(request.session))));
      if (!rows.length) return {type:'reply',text:`I don’t see an outstanding makeup for ${name} for “${request.session}”. Check the session in Training.`,actions:[go('training','View training')]};
    }
    const use = ids => {selections.push({name,ids});return resolveSessions(index+1);};
    if (rows.length > 1) return {type:'select',flow:'makeup',title:`Which makeup did ${name} complete?`,text:'Pick the session, or choose all if they completed every outstanding makeup.',
      options:rows.map(r=>({label:t.sessions.find(s=>s.id===r.session_id)?.label || 'Training',run:()=>use([r.session_id])})).concat({label:'All outstanding makeups',run:()=>use(rows.map(r=>r.session_id))})};
    if (rows.length) return use([rows[0].session_id]);
    return resolveSessions(index+1);
  };
  const resolvePeople = index => {
    if (!valid()) return denied();
    if (index === namesToResolve.length) return resolveSessions(0);
    const query = namesToResolve[index], hits = matchingNames(query,names);
    const use = name => {if (!chosen.includes(name)) chosen.push(name);return resolvePeople(index+1);};
    if (!hits.length) {
      startFlow('makeup','person',{request});
      return {type:'reply',text:`I couldn’t find “${query}” in the training records. Please give me the full name${namesToResolve.length > 1 ? 's for the batch again' : ''}. No records have changed.`};
    }
    if (hits.length > 1) return {type:'select',flow:'makeup',title:`Which ${query} do you mean?`,options:hits.map(name=>({label:name,run:()=>use(name)}))};
    return use(hits[0]);
  };
  return resolvePeople(0);
}
