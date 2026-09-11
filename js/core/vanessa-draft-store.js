/* One unfinished evaluation per account and hub, on this browser. No tokens. */
import { state } from './state.js';
const prefix = () => 'hub2.vanessa.draft.' + encodeURIComponent(globalThis.window?.CONFIG?.SUPABASE_URL || 'hub') + '.';
const key = owner => prefix() + encodeURIComponent(owner);
const fields = ['evalId','name','date','time','wentWell','improve','notes'];
export function loadSavedDraft() {
  if (!state.me?.id) return null;
  try {
    const data = JSON.parse(localStorage.getItem(key(state.me.id)) || 'null');
    if (!data || data.schema!==1 || data.owner!==state.me.id || !data.draft || !Array.isArray(data.answered)) return null;
    if (fields.some(k => typeof data.draft[k]!=='string' || data.draft[k].length>12000)) return null;
    if (!data.draft.evalId || data.draft.owner!==state.me.id) return null;
    if (data.draft.rating!==null && (!Number.isInteger(data.draft.rating) || data.draft.rating<1 || data.draft.rating>5)) return null;
    return data;
  } catch { return null; }
}
export function storeDraft(flow) {
  if (!flow?.draft.evalId || flow.owner!==state.me?.id || flow.version!==state.sessionVersion) return false;
  if(fields.some(k=>typeof flow.draft[k]!=='string'||flow.draft[k].length>12000))return false;
  try {
    localStorage.setItem(key(flow.owner),JSON.stringify({schema:1,owner:flow.owner,draft:flow.draft,answered:[...flow.answered],savedAt:new Date().toISOString()}));
    return true;
  } catch { return false; }
}
export function removeSavedDraft(owner=state.me?.id) {
  if(!owner)return false;
  try { localStorage.removeItem(key(owner));return true; } catch {return false;}
}
