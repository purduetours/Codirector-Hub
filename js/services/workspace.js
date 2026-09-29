import { select, insert, update, remove, rpc } from '../core/db.js';
import { state, onSessionReset } from '../core/state.js';
const cache = new Map();
export function invalidateWorkspace() { cache.clear(); }
onSessionReset(invalidateWorkspace);
export function cached(key, load, ttl=30000) {
  const full = `${state.sessionVersion}:${state.me?.id}:${key}`;
  const found=cache.get(full);
  if(found && found.until>Date.now()) return found.promise;
  const entry={until:Date.now()+ttl};
  entry.promise=Promise.resolve().then(load).catch(error=>{if(cache.get(full)===entry)cache.delete(full);throw error;});
  cache.set(full,entry);return entry.promise;
}
function requireUser() { if(!state.me)throw new Error('Sign in to use your workspace.');return state.me.id; }
export function reminders() {requireUser();return cached('reminders',()=>select('hub_reminders','select=*&order=due_at.asc&limit=500'));}
export async function saveReminder({id,title,dueAt,completed}) {
 const owner=requireUser();let rows;
 if(id) {
  const patch=completed!==undefined?{completed_at:completed?new Date().toISOString():null}:{title:String(title||'').trim(),due_at:dueAt};
  rows=await update('hub_reminders',`id=eq.${encodeURIComponent(id)}&owner_id=eq.${owner}`,patch);
 } else {
  if(!title?.trim() || title.trim().length>240 || !Number.isFinite(Date.parse(dueAt)))throw new Error('Add a reminder title and a valid due date.');
  rows=await insert('hub_reminders',{owner_id:owner,title:title.trim(),due_at:dueAt});
 }
 if(!rows?.length)throw new Error('The reminder changed or is no longer available.');
 invalidateWorkspace();return rows[0];
}
export async function deleteReminder(id) {const owner=requireUser();const rows=await remove('hub_reminders',`id=eq.${encodeURIComponent(id)}&owner_id=eq.${owner}`,{returning:true});if(!rows?.length)throw new Error('The reminder is no longer available.');invalidateWorkspace();return rows[0];}
export function notifications() {requireUser();return cached('notifications',async()=>{await rpc('hub_sync_notifications');return select('hub_notifications','select=*&order=created_at.desc&limit=200');});}
export async function readNotifications(ids=null) {requireUser();const count=await rpc('hub_read_notifications',{p_ids:ids});invalidateWorkspace();return count;}
export function activity({evalId,since}={}) {requireUser();const q='select=*&order=created_at.desc&limit=100'+(evalId?`&eval_id=eq.${encodeURIComponent(evalId)}`:'')+(since?`&created_at=gte.${encodeURIComponent(since)}`:'');return cached('activity:'+q,()=>select('hub_activity',q));}
export function workspaceError(error) {
 console.warn('[Workspace]',error);
 if(/hub_(reminders|notifications|activity)|schema cache|function.*does not exist/i.test(error?.message||''))return 'This workspace needs database migration 18. Ask the Hub administrator to finish setup.';
 if(/network|reach|fetch|offline/i.test(error?.message||''))return 'The Hub could not connect. Check your connection and try again.';
 return 'This request could not be completed. Refresh and try again; your permissions or the record may have changed.';
}
