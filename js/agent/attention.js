import { state } from '../core/state.js';
const key=()=>`hub2.attention.v1.${encodeURIComponent(window.CONFIG?.SUPABASE_URL||'hub')}.${state.me?.id}`;
function load(){try{return JSON.parse(localStorage.getItem(key())||'{}');}catch{return {};}}
export function visibleAttention(id){const rows=load();return !(Number(rows[id])>Date.now());}
export function muteAttention(id,hours=24){if(!state.me)return;const rows=load();for(const [k,v] of Object.entries(rows))if(!Number.isFinite(v)||v<Date.now())delete rows[k];rows[id]=Date.now()+hours*3600000;try{localStorage.setItem(key(),JSON.stringify(Object.fromEntries(Object.entries(rows).slice(-100))));}catch{}}
