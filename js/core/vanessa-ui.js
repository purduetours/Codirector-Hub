/* Vanessa panel, model controls, and session-scoped data loading. */
import { handbookContext, topicNote } from './vanessa.js';
import {
  llmReady, llmSupported, llmStatus, llmWanted, loadLlm, unloadLlm,
  resumeLlmIfWanted, buildMessages, splitThinking, askLlm, onLlmChange, numbersCheckOut, usableLeadIn
} from './vanessa-llm.js';
import { ask, greeting, shareInterviews, shareOther, resetVanessaData } from './vanessa.js';
import { modelStatus, onModelChange, checkAvailability, enableModel, cancelModel, disableModel, resetModel, interpret, resumeIfEnabled } from './vanessa-model.js';
import { state as appState, inTraining, inRecruitment, myName } from './state.js';
import { $, esc, injectStyle } from './ui.js';
import { onRoute, currentModule } from './router.js';
import { actionsFor, explainTool } from './vanessa-context.js';
import { interpret as interpretIntent, performAction, actionById, openAction, understand } from './vanessa-os.js';
import { rememberList, noteRoute, resetMemory, activeFlow, endFlow, onFlowChange } from './vanessa-memory.js';
import { explainError } from './vanessa-errors.js';
import { review as reviewEval } from './vanessa-flow-eval.js';
import { presenceSnapshot } from './presence.js';
import { visibleModules } from './router.js';
import { setVanessaState } from './vanessa-state.js';
import { ICONS } from './icons.js';
import { handleEvalMessage, evalDraft, resetEvalFlow, editEvalDraft, savedEvalSummary, bufferEvalDraft } from './vanessa-eval.js';
import { handleAction, resetActions, pendingConfirmation } from './vanessa-actions.js';
import { voiceSupported, voiceState, onVoiceChange, startVoice, stopVoice, resetVoice, setVoiceText } from './vanessa-voice.js';
let voiceDraftRef=null;
export { shareInterviews };
export const shareData = (kind, rows) => shareOther(kind, rows);
injectStyle('vanessa-css', `
/* The bubble is kept as the single source of open/closed truth, but the
   hub never shows it: Vanessa is opened from the rail, the top bar, the home
   screen or the phone dock. A floating chat bubble is exactly the "website
   with a chatbot in the corner" feel this redesign exists to remove. */
.v-launch { position:fixed; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
  clip:rect(0 0 0 0); border:0; }
.v-panel { position:fixed; top:12px; right:12px; bottom:12px; z-index:70;
  width:min(440px, calc(100vw - 24px)); display:flex; flex-direction:column;
  background:var(--bg-elev); border:1px solid var(--line); border-radius:var(--radius-lg);
  box-shadow:var(--shadow-lg); overflow:hidden; animation:v-in var(--dur-3) var(--ease-out); }
@keyframes v-in { from { opacity:0; transform:translateX(24px) scale(.985); } }
.v-head { position:relative; display:flex; align-items:center; gap:12px; justify-content:space-between;
  padding:16px 16px 14px; border-bottom:1px solid var(--line); overflow:hidden;
  background:radial-gradient(420px 140px at 0% 0%, color-mix(in srgb, var(--gold) 22%, transparent), transparent 70%), var(--bg-elev); }
.v-head-id { display:flex; align-items:center; gap:12px; min-width:0; }
.v-head strong { font-size:1.02rem; font-weight:780; letter-spacing:-.02em; display:block; }
.v-head .sub { font-size:var(--fs-xs); color:var(--text-faint); display:block; font-weight:550; }
.v-log { flex:1; overflow-y:auto; padding:18px 16px; display:flex; flex-direction:column; gap:12px; min-height:60px;
  scrollbar-width:thin; }
.v-msg { font-size:var(--fs-md); line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere;
  padding:11px 14px; border-radius:18px; max-width:90%; animation:fade-up var(--dur-3) var(--ease-out); }
.v-msg.her { background:var(--bg-sunken); color:var(--text); align-self:flex-start; border-bottom-left-radius:6px; }
.v-msg.you { background:var(--accent); color:var(--accent-text); align-self:flex-end; border-bottom-right-radius:6px; }
.v-chips { display:flex; flex-wrap:wrap; gap:7px; padding:0 16px 12px; }
.v-chip { font:inherit; font-size:var(--fs-xs); font-weight:650; cursor:pointer; padding:7px 12px; border-radius:999px;
  border:1px solid var(--line-strong); background:var(--bg-elev); color:var(--text-soft); text-decoration:none;
  transition:border-color var(--dur-2), color var(--dur-2), background var(--dur-2); }
.v-chip:hover { border-color:var(--gold); color:var(--text); background:var(--gold-wash); }
.v-model-on { font-size:var(--fs-xs); color:var(--good); align-self:center; font-weight:650; }
.v-model-note { font-size:var(--fs-xs); color:var(--text-faint); line-height:1.5; flex-basis:100%; }
.v-msg.her.streaming::after { content:'▍'; opacity:.5; }
.v-ask { display:flex; gap:8px; padding:12px; border-top:1px solid var(--line); background:var(--bg-elev); }
.v-ask input { flex:1; min-width:0; border-radius:999px; padding-left:16px; }
.v-ask .btn { flex:none; }
#v-eval-draft { max-height:320px; flex-shrink:1; overflow-y:auto; border-top:1px solid var(--line);
  background:color-mix(in srgb, var(--gold-wash) 50%, var(--bg-elev)); }
.v-panel details > summary { padding:10px 16px; cursor:pointer; font-size:var(--fs-sm); font-weight:650;
  color:var(--text-soft); list-style:none; display:flex; align-items:center; gap:8px; }
.v-panel details > summary::-webkit-details-marker { display:none; }
.v-panel details > summary::before { content:'›'; font-size:1.1em; transition:transform var(--dur-2); display:inline-block; }
.v-panel details[open] > summary::before { transform:rotate(90deg); }
.v-eval-fields { padding:4px 16px 14px; font-size:var(--fs-sm); display:grid; gap:10px; }
.v-eval-fields label { display:grid; gap:5px; font-weight:600; color:var(--text-soft); font-size:var(--fs-xs); }
.v-eval-fields textarea { width:100%; min-height:54px; resize:vertical; }
.v-eval-fields .row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.v-voice-body { padding:4px 16px 14px; display:grid; gap:9px; font-size:var(--fs-sm); color:var(--text-soft); }
#v-voice { max-height:260px; overflow:auto; flex-shrink:1; border-top:1px solid var(--line); }
#v-voice textarea { width:100%; min-height:70px; }
.v-saved { padding:10px 16px; font-size:var(--fs-sm); border-bottom:1px solid var(--line);
  background:var(--gold-wash); color:var(--text); }
.v-eval-actions { display:flex; gap:6px; flex-wrap:wrap; }
.v-panel > details { max-height:45%; overflow-y:auto; flex-shrink:0; }
.v-panel > details:not(#v-eval-draft):not(#v-voice) { border-top:1px solid var(--line); }
.v-panel > .v-chips { max-height:120px; overflow-y:auto; flex-shrink:0; }
/* ---- 2.0: presence, motion, conversation ---- */
.v-panel { transform-origin:calc(100% - 40px) 24px; }
.v-panel.is-closing { animation:v-out .19s var(--ease) forwards; }
@keyframes v-out { to { opacity:0; transform:translateX(18px) scale(.985); } }
/* A light sweeps her top edge while she works: a transform on a 2px line,
   so it never repaints the panel. */
.v-head::after { content:""; position:absolute; left:-50%; width:200%; bottom:-1px; height:2px; opacity:0;
  background:linear-gradient(90deg, transparent, var(--v-1), var(--v-2), var(--v-3), transparent);
  transition:opacity .25s; }
:root[data-vanessa="thinking"] .v-head::after, :root[data-vanessa="responding"] .v-head::after { opacity:1; animation:v-sweep 1.2s linear infinite; }
@keyframes v-sweep { from { transform:translateX(-25%); } to { transform:translateX(25%); } }
.v-wave { display:inline-flex; align-items:center; gap:3px; height:18px; margin-left:auto; margin-right:4px; opacity:.25; transition:opacity .3s; }
.v-wave i { width:3px; height:16px; border-radius:3px; background:var(--gold-deep); transform:scaleY(.3); transform-origin:center; }
:root[data-vanessa="thinking"] .v-wave, :root[data-vanessa="responding"] .v-wave, :root[data-vanessa="listening"] .v-wave { opacity:1; }
:root[data-vanessa="thinking"] .v-wave i { animation:v-bar 1s ease-in-out infinite; }
:root[data-vanessa="responding"] .v-wave i { animation:v-bar .6s ease-in-out infinite; }
:root[data-vanessa="listening"] .v-wave i { animation:v-bar .45s ease-in-out infinite; background:var(--good); }
.v-wave i:nth-child(2) { animation-delay:.12s !important; } .v-wave i:nth-child(3) { animation-delay:.24s !important; } .v-wave i:nth-child(4) { animation-delay:.36s !important; }
@keyframes v-bar { 50% { transform:scaleY(1); } }

.v-log { padding-left:46px; scroll-behavior:smooth; }
.v-msg { transform-origin:left bottom; animation:v-msg-in .42s var(--ease-out) both; }
.v-msg.you { transform-origin:right bottom; }
@keyframes v-msg-in { from { opacity:0; transform:translateY(8px) scale(.97); } }
.v-msg.her { position:relative; border:1px solid color-mix(in srgb, var(--line) 70%, transparent);
  background:linear-gradient(180deg, color-mix(in srgb, var(--gold-wash) 55%, var(--bg-sunken)), var(--bg-sunken)); }
.v-msg.her::before { content:""; position:absolute; left:-32px; bottom:2px; width:22px; height:22px; border-radius:50%;
  background:radial-gradient(circle at 32% 30%, var(--orb-hi) 0 10%, transparent 34%), conic-gradient(var(--v-1), var(--v-3), var(--v-2), var(--gold-deep), var(--v-1));
  box-shadow:0 0 0 1px color-mix(in srgb, var(--gold-deep) 30%, transparent), 0 3px 10px -3px color-mix(in srgb, var(--v-1) 70%, transparent); }
.v-msg.her:has(+ .v-msg.her)::before { opacity:0; }
.v-msg.is-typing { color:transparent; font-size:0; padding:13px 16px; min-width:58px; }
.v-msg.is-typing::after { content:""; display:block; width:34px; height:8px;
  background:radial-gradient(circle 3.5px, var(--gold-deep) 98%, transparent) 0 50%/11px 8px repeat-x;
  animation:v-dots 1s linear infinite; font-size:var(--fs-md); }
@keyframes v-dots { 50% { opacity:.35; } }
.v-msg.is-error { background:var(--danger-bg); color:var(--danger); border-color:color-mix(in srgb, var(--danger) 25%, transparent); }
.v-msg.is-long:not(.is-open) { max-height:12.5em; overflow:hidden;
  -webkit-mask:linear-gradient(#000 60%, transparent); mask:linear-gradient(#000 60%, transparent); padding-bottom:26px; }
.v-msg.is-long { position:relative; }
.v-more { position:absolute; left:12px; bottom:6px; font:inherit; font-size:var(--fs-xs); font-weight:750; cursor:pointer;
  border:0; background:var(--bg-elev); color:var(--gold-deep); padding:3px 10px; border-radius:999px; box-shadow:var(--shadow);
  -webkit-mask:none; mask:none; }
.v-msg.is-long:not(.is-open) .v-more { bottom:6px; }
.v-msg.is-long.is-open .v-more { position:static; display:inline-block; margin-top:8px; }
.v-follow { display:flex; flex-wrap:wrap; gap:6px; margin:-2px 0 4px; animation:v-msg-in .42s .08s var(--ease-out) both; }
.v-chip.is-go { display:inline-flex; align-items:center; gap:5px; color:var(--text); border-style:solid;
  background:color-mix(in srgb, var(--gold-wash) 60%, var(--bg-elev)); }
.v-chip.is-go svg { width:13px; height:13px; }
.v-chip { animation:v-msg-in .35s var(--ease-out) both; }
.v-chips .v-chip:nth-child(2) { animation-delay:.03s; } .v-chips .v-chip:nth-child(3) { animation-delay:.06s; }
.v-chips .v-chip:nth-child(4) { animation-delay:.09s; } .v-chips .v-chip:nth-child(n+5) { animation-delay:.12s; }
.v-panel.has-chat [data-suggestions] { display:none; }
.v-ask:focus-within { box-shadow:inset 0 1px 0 var(--line), 0 -10px 30px -20px color-mix(in srgb, var(--v-1) 60%, transparent); }
/* ---- 3.0: reply types ---- */
.v-msg.her p { margin:0; white-space:pre-wrap; }
.v-kind { display:flex; align-items:center; gap:6px; margin:-1px 0 7px; font-size:var(--fs-2xs); font-weight:800;
  letter-spacing:.07em; text-transform:uppercase; color:var(--gold-deep); }
.v-kind svg { width:13px; height:13px; }
.v-lead { font-weight:600; margin-bottom:8px !important; }
.v-list { list-style:none; margin:0; padding:0; display:grid; gap:4px; }
.v-list li { display:flex; justify-content:space-between; align-items:baseline; gap:12px; padding:7px 10px; border-radius:10px;
  background:color-mix(in srgb, var(--bg-elev) 70%, transparent); animation:v-msg-in .4s var(--ease-out) both; }
.v-list li:nth-child(2) { animation-delay:.03s; } .v-list li:nth-child(3) { animation-delay:.06s; } .v-list li:nth-child(n+4) { animation-delay:.09s; }
.v-list b { font-weight:650; font-size:var(--fs-sm); min-width:0; overflow-wrap:anywhere; }
.v-list span { font-size:var(--fs-xs); color:var(--text-faint); text-align:right; flex:none; max-width:55%; }
.v-tail { margin-top:8px !important; color:var(--text-soft); font-size:var(--fs-sm); }
.v-inline-acts { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.v-msg.v-k-confirm { background:linear-gradient(180deg, color-mix(in srgb, var(--good-bg) 80%, var(--bg-sunken)), var(--bg-sunken));
  border-color:color-mix(in srgb, var(--good) 25%, transparent); }
.v-msg.v-k-confirm .v-kind { color:var(--good); }
.v-msg.v-k-alert { background:linear-gradient(180deg, var(--warn-bg), color-mix(in srgb, var(--warn-bg) 50%, var(--bg-sunken)));
  border-color:color-mix(in srgb, var(--warn) 25%, transparent); }
.v-msg.v-k-alert .v-kind { color:var(--warn); }
.v-msg.v-k-error { background:var(--danger-bg); border-color:color-mix(in srgb, var(--danger) 25%, transparent); }
.v-msg.v-k-error .v-kind { color:var(--danger); }
.v-msg.v-k-nav { border-style:dashed; border-color:color-mix(in srgb, var(--gold) 55%, transparent); }
.v-msg.v-k-nav .v-kind svg { animation:nav-nudge .9s var(--ease-out) 2; }
@keyframes nav-nudge { 50% { transform:translateX(3px); } }
.v-msg.v-k-explain { background:linear-gradient(180deg, var(--gold-wash), color-mix(in srgb, var(--gold-wash) 40%, var(--bg-sunken))); }
.v-head .v-live { font-size:var(--fs-2xs); font-weight:700; color:var(--text-faint); display:inline-flex; gap:5px; align-items:center; margin-left:8px; }
.v-head .v-live::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--good); }
/* On a wide screen she docks beside the workspace instead of covering it. */
@media (min-width:1280px){
  .v-panel { top:10px; bottom:10px; right:10px; width:420px; }
  body.v-open .main { padding-right:432px; }
  body.v-open .topbar .sync, body.v-open .au-lbl, body.v-open .v-top-lbl, body.v-open .qs-wrap::after { display:none; }
  body.v-open .qs-input { width:150px !important; }
  body.v-open .v-float { opacity:0; pointer-events:none; transform:translateY(12px) scale(.9); }
}
@media (max-width:860px){
  /* Full screen, and above an open form: the conversation carries on here;
     "Show the form" or Edit steps her aside to reveal it. */
  .v-panel { z-index:85; inset:0; width:auto; border-radius:0; border:0; padding-top:env(safe-area-inset-top);
    padding-bottom:env(safe-area-inset-bottom); animation:v-up var(--dur-3) var(--ease-out); }
  @keyframes v-up { from { opacity:0; transform:translateY(30px); } }
}
`);


let open = false, warmers = [], warming = null, epoch = 0, sendQueue = Promise.resolve();
const warmed = new Set();
export function registerWarmers(list) { warmers = list; }
export function resetWarmup() { epoch++; warmed.clear(); warming = null; }
export function warmUp() {
  if (!appState.me) return Promise.resolve([]);
  if (warming) return warming;
  const ticket = epoch;
  const allowed = warmers.filter(w => !warmed.has(w) &&
    (w.needs === 'training' ? inTraining() : w.needs === 'recruitment' ? inRecruitment() : true));
  const job = Promise.all(allowed.map(async w => {
    try { await w.load(); if (ticket === epoch) warmed.add(w); return null; }
    catch { return w.label || w.needs; }
  })).then(results => results.filter(Boolean)).finally(() => { if (warming === job) warming = null; });
  warming = job;
  return job;
}
export function prewarm() {
  const ticket = epoch;
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 400));
  idle(() => { if (ticket === epoch) warmUp().catch(() => {}); }, { timeout: 3000 });
}
function say(who, text) {
  const log = $('#v-log');
  if (!log || !appState.me) return null;
  if (who === 'you') {
    log.querySelector('.v-follow')?.remove();   // the old follow-ups are stale now
    $('#v-panel')?.classList.add('has-chat');    // her follow-ups take over from the opening chips
  }
  const el = document.createElement('div');
  el.className = 'v-msg ' + who; el.textContent = text;
  log.appendChild(el);
  if (who === 'her') {
    collapse(el);
    pendingSelect = null;   // a newer message retires any choice still open above it
  }
  scrollLog();
  return el;
}
const scrollLog = () => { const log = $('#v-log'); if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }); };

/* Compact by default. A long answer — a list of twenty guides, a handbook
   passage — shows its first few lines with the rest a click away, so the
   conversation stays readable and the detail is still all there. */
function collapse(el) {
  if (!el || el.classList.contains('is-typing')) return;
  el.querySelector('.v-more')?.remove();
  const text = el.textContent || '';
  if (text.length < 460 && text.split('\n').length <= 8) { el.classList.remove('is-long'); return; }
  el.classList.add('is-long');
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'v-more'; more.textContent = 'Show more';
  more.addEventListener('click', () => {
    const openNow = el.classList.toggle('is-open');
    more.textContent = openNow ? 'Show less' : 'Show more';
  });
  el.appendChild(more);
}

/* Her mood, shared by every orb in the hub — the rail, the top bar, the dock,
   the home stage and her own. Idle drifts; thinking turns quickly; speaking
   glows; listening pulses. One attribute on <html>, so they all agree. */
// Her panel speaks in the older mood words; the state module owns the rest.
const MOOD = { speaking: 'responding' };
const setMood = mood => setVanessaState(MOOD[mood] || mood);

/* ------------------------------------------------------- context & actions */
const routeId = () => currentModule()?.id || 'today';
const routeTitle = () => currentModule()?.title || 'Home';

/* ------------------------------------------------------------ reply types
   Not everything she says is a chat bubble. A reply is one of:

     message   an ordinary answer
     result    data from one of her existing lookups — a lead line and a list
     alert     something that needs attention (a refusal, a partial load)
     confirm   an action she carried out
     nav       she is opening a tool for you
     explain   what a tool is, with the way in
     error     it went wrong

   Every type is the same bubble underneath, so collapse, avatars and
   follow-ups keep working. Only the head, the body layout and any buttons
   inside it change. */
const NO_ACCESS = "That tool isn't available for your account.";
const KIND_HEAD = { result: ['spark', 'Here is what I found'], alert: ['spark', 'Heads up'], confirm: ['check', 'Done'], review: ['check', 'Please confirm'],
  nav: ['arrow', 'Opening'], explain: ['spark', 'About'], error: ['close', 'Something went wrong'] };

function classify(r, { acted } = {}) {
  const text = String(r?.text || '');
  if (r?.kind) return r.kind;
  if (text === NO_ACCESS) return 'alert';
  if (acted) {
    if (pendingConfirmation()) return 'review';                       // she is asking, not done
    if (/^\s*(left it alone|okay|no problem)/i.test(text)) return 'message';
    return /could ?n.?t|cannot|can't|not available|failed|error|sorry|isn't|no longer|already|which one|who\?|give me a name/i.test(text) ? 'alert' : 'confirm';
  }
  if (r?.go) return 'nav';
  if (/^\s*[-•]\s/m.test(text)) return 'result';
  return 'message';
}

function sayRich(r, opts = {}) {
  const kind = classify(r, opts);
  const text = String(r?.text || '');
  const el = say('her', '');
  if (!el) return null;
  el.classList.add('v-k-' + kind);
  const head = KIND_HEAD[kind];
  const toolTitle = r?.go || r?.to ? visibleModules().find(m => m.id === (r.go || r.to))?.title : '';
  let html = '';
  if (head && kind !== 'message') {
    const label = kind === 'nav' ? `Opening ${r.title || toolTitle || 'that'}` : kind === 'explain' ? (r.title || toolTitle || 'About') : head[1];
    html += `<span class="v-kind">${ICONS[head[0]] || ''}<span>${esc(label)}</span></span>`;
  }
  const lines = text.split('\n');
  const listStart = lines.findIndex(l => /^\s*[-•]\s/.test(l));
  if (kind === 'result' && listStart >= 0) {
    const lead = lines.slice(0, listStart).join('\n').trim();
    const items = [], tail = [];
    lines.slice(listStart).forEach(l => (/^\s*[-•]\s/.test(l) ? items.push(l.replace(/^\s*[-•]\s/, '')) : l.trim() && tail.push(l)));
    html += (lead ? `<p class="v-lead">${esc(lead)}</p>` : '') +
      `<ul class="v-list">${items.map(i => {
        const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(i);
        return m ? `<li><b>${esc(m[1])}</b><span>${esc(m[2])}</span></li>` : `<li><b>${esc(i)}</b></li>`;
      }).join('')}</ul>` +
      (tail.length ? `<p class="v-tail">${esc(tail.join('\n'))}</p>` : '');
  } else {
    html += `<p class="v-text">${esc(text)}</p>`;
  }
  const dest = r?.go || r?.to;
  if (dest && (kind === 'nav' || kind === 'explain') && visibleModules().some(m => m.id === dest)) {
    html += `<div class="v-inline-acts"><button type="button" class="v-chip is-go" data-go="${esc(dest)}">Open ${esc(toolTitle)}${ICONS.arrow}</button></div>`;
  }
  el.innerHTML = html;
  collapse(el);
  if (kind === 'confirm') setVanessaState('success');
  else if (kind === 'error') setVanessaState('error');
  else if (kind === 'nav') setVanessaState('opening');
  return el;
}

/* "Who is active?" — the same heartbeat the top bar shows, names only. */
function presenceAnswer(q) {
  if (!/\b(who(?:'s| is)? (?:online|active|on|around|here)|active (?:now|users|members|people)|how many (?:people )?(?:are )?(?:online|active|on))\b/i.test(q)) return null;
  const snap = presenceSnapshot();
  if (!snap || snap.error) return { text: 'I cannot see who is active right now. It retries on its own every half minute.', kind: 'alert' };
  const users = snap.users || [];
  if (!users.length) return { text: 'Nobody else is active right now.' };
  return { text: `${users.length} ${users.length === 1 ? 'person is' : 'people are'} active now:\n` +
    users.map(u => `- ${u.full_name}${u.member_id === appState.me?.id ? ' — you' : ''}`).join('\n') };
}

/* Every action button carries its registry id, so clicking it and typing it
   run the same action through the same permission check. */
function actionButton(a) {
  const go_ = a.kind === 'go';
  return `<button type="button" class="v-chip ${go_ ? 'is-go' : ''}" data-action="${esc(a.id)}">` +
    `${esc(a.label)}${go_ ? ICONS.arrow : ''}</button>`;
}

/* ------------------------------------------------------------ components
   What vanessa-os.js hands back, drawn as native parts of her conversation:
   selection, confirmation, suggestion, summary and handoff. Buttons keep the
   plan's own run() functions, so choosing one can return the next step —
   that is how a workflow chains without anybody typing. */
const plans = new Map();
let planSeq = 0, pendingSelect = null, closePanel = () => {};
const narrow = () => !matchMedia('(min-width: 1280px)').matches;

/* Where a fact came from, under the card: facts and her own words never look alike. */
const sourceLine = plan => plan.source
  ? `<p class="v-src">From the ${esc(plan.source.charAt(0).toLowerCase() + plan.source.slice(1))}${plan.at instanceof Date ? ` · ${esc(plan.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}` : ''}</p>` : '';
const actRow = (list, attr = 'data-pact') => (list || []).filter(Boolean).length
  ? `<div class="v-inline-acts">${list.filter(Boolean).map((a, i) => `<button type="button" class="v-chip ${a.go ? 'is-go' : ''}" ${attr}="${i}">${esc(a.label)}${a.go ? ICONS.arrow : ''}</button>`).join('')}</div>` : '';

function renderPlan(plan) {
  if (!plan) return null;
  if (plan.cancelled) settleFlowCards();
  if (plan.type === 'reply' && !plan.actions?.filter(Boolean).length && !plan.retry && !plan.source) {
    const el = sayRich({ text: plan.text, kind: plan.kind });
    if (plan.closeOnNarrow && narrow()) setTimeout(() => closePanel(), 600);
    return el;
  }
  if (plan.type === 'handoff') {
    const el = plan.text ? sayRich({ text: plan.text, kind: 'nav', title: visibleModules().find(m => m.id === plan.to)?.title }) : null;
    const next = typeof plan.next === 'function' ? plan.next() : plan.next;
    if (next) setTimeout(() => Promise.resolve(next).then(p => p && renderPlan(p)), 260);
    // On a phone she steps aside for the workspace — unless the task carries on here.
    if (narrow() && !plan.stay && !next) setTimeout(() => closePanel(), 700);
    if (narrow() && plan.stay && el) addShowChip(el);
    return el;
  }
  const id = ++planSeq;
  plans.set(id, plan);
  const el = say('her', '');
  if (!el) return null;
  const kind = plan.type === 'reply' ? (plan.kind || 'message') : plan.type;
  el.classList.add('v-plan', 'v-k-' + kind);
  if (plan.kind === 'explain') el.classList.add('v-k-explain');
  if (plan.flow) el.dataset.flow = plan.flow;
  el.dataset.plan = String(id);
  const HEAD = { select: ['spark', 'Choose one'], confirm: ['check', 'Please review'], suggest: ['spark', 'Suggested wording'],
    summary: ['spark', plan.kind === 'explain' ? 'About' : 'Here’s what I found'], alert: ['spark', 'Heads up'], error: ['close', 'Something went wrong'], confirmReply: ['check', 'Done'] };
  const [ico, label] = HEAD[plan.type === 'reply' ? (plan.kind === 'confirm' ? 'confirmReply' : plan.kind) : plan.type] || [];
  let html = label ? `<span class="v-kind">${ICONS[ico] || ''}<span>${esc(label)}</span></span>` : '';
  if (plan.title) html += `<p class="v-lead">${esc(plan.title)}</p>`;
  if (plan.text) html += `<p class="v-text">${esc(plan.text)}</p>`;

  if (plan.type === 'select') {
    html += `<div class="v-opts">${(plan.options || []).map((o, i) =>
      `<button type="button" class="v-opt" data-opt="${i}"><b>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</button>`).join('')}</div>`;
    plan.extra = (plan.extra || []).filter(Boolean);
    html += actRow(plan.extra, 'data-extra');
    pendingSelect = { id, plan };
    rememberList('choice', (plan.options || []).map(o => ({ label: o.label, sub: o.sub, run: o.run })));
  }
  if (plan.type === 'confirm') {
    if (plan.rows?.length) html += `<dl class="v-rows v-rows-wide">${plan.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    if (plan.rate) html += `<div class="v-rate" role="group" aria-label="Overall rating"><span>${esc(plan.rate.label || 'Rating')}</span>${[1, 2, 3, 4, 5].map(k => `<button type="button" class="v-chip" data-rate="${k}">${k}</button>`).join('')}</div>`;
    html += `<div class="v-confirm-acts"><button type="button" class="btn btn-primary btn-sm" data-confirm>${esc(plan.confirm?.label || 'Confirm')}</button>` +
      (plan.secondary || []).map((x, i) => `<button type="button" class="btn btn-sm" data-sec="${i}">${esc(x.label)}</button>`).join('') +
      `<button type="button" class="btn btn-ghost btn-sm" data-cancel>${esc(plan.cancel?.label || 'Cancel')}</button></div>`;
  }
  if (plan.type === 'suggest') {
    html += (plan.parts || []).map(p => `<div class="v-suggest-part"><span class="v-suggest-label">${esc(p.label)}</span><p>${esc(p.text)}</p></div>`).join('');
    if (plan.rating) html += `<p class="v-tail">Rating you gave: <b>${esc(String(plan.rating))} / 5</b></p>`;
    html += `<div class="v-confirm-acts"><button type="button" class="btn btn-primary btn-sm" data-sug="use">Use this</button>
      <button type="button" class="btn btn-sm" data-sug="edit">Edit</button></div>
      <div class="v-inline-acts v-tone"><button type="button" class="v-chip" data-sug="short">Make it shorter</button>
      <button type="button" class="v-chip" data-sug="direct">More direct</button><button type="button" class="v-chip" data-sug="soft">Softer</button>
      <button type="button" class="v-chip" data-sug="restart">Start over</button></div>
      <p class="v-gen">${ICONS.spark || ''}Written by Vanessa from your notes</p>`;
  }
  if (plan.type === 'summary') {
    if (plan.rows?.length) html += `<dl class="v-rows v-rows-wide">${plan.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    if (plan.items?.length) {
      html += `<div class="v-opts v-items">${plan.items.map((o, i) => `<button type="button" class="v-opt" data-item="${i}"><b>${esc(o.label)}</b>${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</button>`).join('')}</div>`;
      rememberList(plan.items[0]?.kind || 'item', plan.items);
    }
    if (plan.more) html += `<p class="v-tail">${esc(plan.more)}</p>`;
    if (plan.steps?.length) html += `<ol class="v-steps">${plan.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
  }
  if (plan.type === 'summary' || plan.type === 'reply') html += actRow(plan.actions);
  if (plan.retry) html += `<div class="v-inline-acts"><button type="button" class="v-chip" data-retry>Try again</button></div>`;
  if (plan.flow && plan.type !== 'confirm') html += `<button type="button" class="v-flow-cancel" data-flowcancel>Cancel</button>`;
  html += sourceLine(plan);
  // Only the newest suggestion can be used; older ones stay readable.
  if (plan.type === 'suggest') document.querySelectorAll('#v-log .v-k-suggest:not(.is-settled)').forEach(c => { if (c !== el) { c.classList.add('is-settled'); c.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
  el.innerHTML = html.replace(/>\s+</g, '><');         // the bubble keeps whitespace; markup must not add any
  if (plan.type === 'reply' || (plan.type === 'summary' && !plan.items?.length)) collapse(el);
  if (plan.kind === 'confirm') setVanessaState('success');
  else if (plan.kind === 'error') setVanessaState('error');
  scrollLog();
  return el;
}

/* On a phone the task can carry on in the chat; this steps her aside to look at the form. */
function addShowChip(el) {
  const row = document.createElement('div');
  row.className = 'v-inline-acts';
  row.innerHTML = '<button type="button" class="v-chip is-go" data-peek>Show the form</button>';
  el.appendChild(row);
}

/* A cancelled task leaves its cards readable but inert. */
function settleFlowCards() {
  pendingSelect = null;
  document.querySelectorAll('#v-log [data-flow]:not(.is-settled), #v-log .v-k-select:not(.is-settled)').forEach(c => {
    c.classList.add('is-settled');
    c.querySelectorAll('button').forEach(b => { b.disabled = true; });
  });
}

/* A step chosen: settle the card, run it, show whatever comes next. */
async function runStep(el, fn) {
  if (!fn) return;
  el?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  el?.classList.add('is-settled');
  setMood('thinking');
  try {
    const next = await fn();
    if (next) renderPlan(next);
  } catch (err) {
    renderPlan({ type: 'reply', kind: 'error', text: explainError(err, 'that step'), retry: fn });
  }
  setMood('speaking');
}

/* A summary row or next-step button: run it, leave the card live. */
async function runLoose(fn) {
  if (!fn) return;
  setMood('thinking');
  try { const next = await fn(); if (next) renderPlan(next); }
  catch (err) { renderPlan({ type: 'reply', kind: 'error', text: explainError(err, 'that step'), retry: fn }); }
  setMood('speaking');
}

/* Typing "2" or "Alex" while she is waiting on a choice picks it. */
function typedChoice(q) {
  if (!pendingSelect) return false;
  const { id, plan } = pendingSelect;
  const opts = plan.options || [];
  const t = q.trim().toLowerCase();
  const ord = t.split(/\s+/).length <= 5 ? understand(t).ordinal : null;
  let idx = /^\d+$/.test(t) ? Number(t) - 1 : ord !== null ? (ord < 0 ? opts.length - 1 : ord)
    : opts.findIndex(o => `${o.label} ${o.sub || ''}`.toLowerCase().split(/[\s—·,-]+/).includes(t));
  if (idx < 0 || idx >= opts.length) return false;
  pendingSelect = null;
  const el = document.querySelector(`[data-plan="${id}"]`);
  el?.querySelector(`[data-opt="${idx}"]`)?.classList.add('is-chosen');
  runStep(el, opts[idx].run);
  return true;
}

/* Quick answers for her existing flows, so they can be clicked too. */
function addQuick(el, items) {
  if (!el || !items.length) return;
  const row = document.createElement('div');
  row.className = items.some(i => i.confirm) ? 'v-confirm-acts' : 'v-inline-acts';
  row.innerHTML = items.map(i => i.confirm !== undefined
    ? `<button type="button" class="btn ${i.confirm ? 'btn-primary' : 'btn-ghost'} btn-sm" data-say="${esc(i.say)}">${esc(i.label)}</button>`
    : `<button type="button" class="v-chip" data-say="${esc(i.say)}">${esc(i.label)}</button>`).join('');
  el.appendChild(row);
}
function evalQuick(el) {
  const d = evalDraft();
  if (d?.phase === 'rating') return addQuick(el, [1, 2, 3, 4, 5].map(n => ({ label: String(n), say: String(n) })).concat({ label: 'Skip', say: 'skip' }));
  const polish = { label: 'Polish my wording', say: 'help me polish this feedback' };
  if (d?.phase === 'review') {
    addQuick(el, [{ label: 'Submit evaluation', say: 'submit it', confirm: true }, { label: 'Keep editing', say: '', confirm: false }]);
    return addQuick(el, [polish]);
  }
  if (d?.phase === 'improve' || d?.phase === 'notes') return addQuick(el, [{ label: 'None', say: 'none' }, polish]);
  // Choosing which claimed guide: her numbered list becomes buttons.
  const lines = String(el.textContent || '').split('\n').map(l => /^(\d+)\.\s+(.+)$/.exec(l.trim())).filter(Boolean);
  if (lines.length) addQuick(el, lines.map(m => ({ label: m[2], say: m[1] })));
}

function paintContext() {
  const sub = $('#v-sub');
  if (sub) sub.textContent = routeId() === 'today' ? 'Here with you on Home' : `Here with you on ${routeTitle()}`;
  const box = $('[data-suggestions]');
  if (!box) return;
  // A task under way is the first thing offered, so it is never lost.
  const f = activeFlow('evaluate');
  const resume = f?.data.evalId ? `<button type="button" class="v-chip is-go is-resume" data-resume>Continue ${esc(f.data.name.split(' ')[0])}’s evaluation${ICONS.arrow}</button>` : '';
  box.innerHTML = resume + actionsFor(routeId()).slice(0, resume ? 5 : 6).map(actionButton).join('');
  $('#v-panel')?.classList.toggle('has-task', !!resume);
}
onFlowChange(() => paintContext());

/* A few next steps after each answer: things she can do from where you are,
   minus whatever you just asked. Replaced by the next answer's own. */
function paintFollowups(asked) {
  const log = $('#v-log');
  if (!log) return;
  log.querySelector('.v-follow')?.remove();
  const low = String(asked || '').trim().toLowerCase();
  const next = actionsFor(routeId()).filter(a => a.kind === 'go' || a.q.toLowerCase() !== low).slice(0, 3);
  if (!next.length) return;
  const row = document.createElement('div');
  row.className = 'v-follow';
  row.innerHTML = next.map(actionButton).join('');
  log.appendChild(row);
  scrollLog();
}
function paintLlmRow() {
  const row = $('#v-llm');
  if (!row || !appState.me) return;

  if (!llmSupported()) {
    row.innerHTML = '<span class="v-model-note">This browser cannot run a model in the tab (no WebGPU). Chrome or Edge on a laptop can.</span>';
    return;
  }
  const st = llmStatus();
  if (st.phase === 'loading') {
    const pct = st.progress ? ` ${Math.round(st.progress * 100)}%` : '';
    row.innerHTML = `<span class="v-model-note">Downloading Vanessa's model${pct} — once only, then it stays on this laptop. ` +
      `${esc(st.message || '')}</span><button type="button" class="v-chip" id="v-llm-off">Cancel</button>`;
    return;
  }
  if (st.phase === 'ready') {
    row.innerHTML = '<span class="v-model-on">Vanessa is writing her own answers</span>' +
      '<button type="button" class="v-chip" id="v-llm-off">Turn off</button>';
    return;
  }
  const failed = st.phase === 'failed';
  row.innerHTML =
    `<button type="button" class="v-chip" id="v-llm-on">${failed ? 'Retry' : 'Let Vanessa write her own answers'}</button>` +
    `<span class="v-model-note">${failed ? esc(st.message) :
      'A one-time download of about a gigabyte. It then runs on this laptop — no student data ever leaves it.'}</span>`;
}

onLlmChange(() => paintLlmRow());

function paintModelRow() {
  const row = $('#v-model');
  if (!row || !appState.me) return;

  /* Two model systems in one drawer, each reporting its own download failure,
     read as one broken feature. WebLLM does the actual answering; the Chrome
     tier only ever maps a question onto a phrase the matcher already knows. So
     where WebLLM can run, it is the only control on show. The Chrome one keeps
     working underneath and reappears on machines without WebGPU. */
  if (llmSupported()) { row.hidden = true; return; }
  row.hidden = false;
  const status = modelStatus();
  let button;
  if (status.state === 'loading') button = '<button type="button" class="v-chip" id="v-model-cancel">Cancel</button>';
  else if (status.state === 'ready') button = '<button type="button" class="v-chip" id="v-model-off">Turn off</button>';
  else if (status.state === 'unavailable') button = '<button type="button" class="v-chip" id="v-model-check">Check again</button>';
  else {
    const label = status.state === 'failed' ? 'Retry' : status.availability === 'downloadable' ? 'Download model' : status.availability === 'downloading' ? 'Continue download' : 'Enable model';
    button = `<button type="button" class="v-chip" id="v-model-on">${label}</button>`;
  }
  row.innerHTML = `<p style="margin:0;width:100%;font-size:.75rem" role="status">${esc(status.message)}</p>${button}
    <a class="v-chip" href="https://developer.chrome.com/docs/ai/prompt-api#review_the_hardware_requirements" target="_blank" rel="noopener noreferrer">Setup help</a>`;
}
onModelChange(paintModelRow);

function paintEvalDraft() {
  const panel = $('#v-panel');
  if (!panel) return;
  const old = $('#v-eval-draft'); old?.remove();
  const draft = evalDraft();
  paintSavedDraft();
  const suggestions = $('[data-suggestions]', panel);
  if (suggestions) suggestions.hidden = !!draft;
  if (!draft?.evalId) return;
  const root = document.createElement('details');
  root.id='v-eval-draft'; root.open=true;
  root.dataset.draftId=String(draft.draftId); root.dataset.revision=String(draft.revision);
  root.innerHTML=`<summary style="padding:8px 14px;cursor:pointer;font-size:.8rem">Eval draft: ${esc(draft.name)}</summary>
    <div class="v-eval-fields"><p style="margin:0">${draft.phase==='submitting'?'Submitting…':draft.saved?'Draft saved on this browser. Not submitted.':'Draft not saved to browser storage. Keep this tab open.'}</p>
    <fieldset ${draft.phase==='submitting'?'disabled':''} style="border:0;padding:0;margin:0;display:grid;gap:8px">
      <div class="row2"><label>Tour date<input type="date" data-eval-field="date" value="${esc(draft.date)}"></label>
      <label>Tour time<input type="time" data-eval-field="time" value="${esc(draft.time)}"></label></div>
      <label>Overall rating<select data-eval-field="rating"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${draft.rating===n?'selected':''}>${n} / 5</option>`).join('')}</select></label>
      <label>What went well<textarea rows="2" data-eval-field="wentWell" maxlength="12000">${esc(draft.wentWell)}</textarea></label>
      <label>Areas to improve<textarea rows="2" data-eval-field="improve" maxlength="12000">${esc(draft.improve)}</textarea></label>
      <label>Other notes<textarea rows="2" data-eval-field="notes" maxlength="12000">${esc(draft.notes)}</textarea></label>
      <div class="v-eval-actions"><button type="button" class="btn btn-sm" data-eval-action="update">Update draft</button>
      <button type="button" class="btn btn-primary btn-sm" data-eval-action="submit" ${draft.phase!=='review'?'disabled':''}>Submit eval</button>
      <button type="button" class="btn btn-ghost btn-sm" data-eval-action="cancel">Cancel draft</button></div>
    </fieldset></div>`;
  panel.insertBefore(root, $('#v-form'));
}
function paintSavedDraft(){
  const banner=$('#v-saved');if(!banner)return;
  const saved=inTraining()?savedEvalSummary():null;
  banner.hidden=!saved || !!evalDraft();
  banner.innerHTML=saved?`Saved draft: ${esc(saved.name)} <button type="button" class="linkish" data-question="continue my eval">Continue</button> · <button type="button" class="linkish" data-question="discard saved draft">Discard</button>`:'';
}
function paintVoice(){
  const root=$('#v-voice-body');if(!root || !appState.me)return;
  const status=voiceState(),busy=['recording','stopping'].includes(status.phase);
  const text=root.querySelector('textarea');
  // Do not recreate the textarea: preserve cursor and edits while status changes.
  if(text && document.activeElement!==text)text.value=status.text;
  if(text)text.disabled=busy;
  const message=$('#v-voice-status');if(message)message.textContent=status.message;
  const start=$('#v-voice-start'),stop=$('#v-voice-stop'),use=$('#v-voice-use');
  if(start)start.disabled=busy || !voiceSupported();
  if(stop)stop.disabled=status.phase!=='recording';
  if(use)use.disabled=busy || !status.text.trim();
}
onVoiceChange(paintVoice);
onVoiceChange(() => { const st = voiceState(); if (st.phase === 'recording') setMood('listening'); else if (document.documentElement.dataset.vanessa === 'listening') setVanessaState('idle'); });
function useTranscript(){
  if(['recording','stopping'].includes(voiceState().phase))return;
  const transcript=$('#v-transcript')?.value.trim();if(!transcript)return;
  setVoiceText(transcript);
  const target=$('#v-voice-target').value;
  if(target==='chat'){
    // Copy only. Even a transcript saying "submit it" needs a separate Ask click.
    $('#v-input').value=[$('#v-input').value.trim(),transcript].filter(Boolean).join(' ');
    $('#v-input').focus();
    $('#v-voice-status').textContent='Transcript copied to the message box. Review it, then press Ask.';
  }else{
    const draft=evalDraft();
    if(!draft || !voiceDraftRef || draft.draftId!==voiceDraftRef.id || draft.revision!==voiceDraftRef.revision){
      $('#v-voice-status').textContent='The draft changed while you were dictating. Copy the transcript into the current field after reviewing it.';return;
    }
    const result=editEvalDraft(draft.draftId,draft.revision,{[target]:[draft[target],transcript].filter(Boolean).join('\n')});
    say('her',result.text);paintEvalDraft();
    $('#v-voice-status').textContent='Transcript added to the draft. Nothing was submitted.';
    voiceDraftRef=null;
  }
  $('#v-voice-use').disabled=true;
}

function readEvalEdits(all=false) {
  const draft=evalDraft(), root=$('#v-eval-draft');
  if(!draft || !root)return null;
  const patch={};
  for(const node of root.querySelectorAll('[data-eval-field]')) {
    const key=node.dataset.evalField;
    const value=key==='rating'?(node.value?Number(node.value):null):node.value;
    if(all || value!==draft[key])patch[key]=value;
  }
  if(!Object.keys(patch).length)return null;
  return editEvalDraft(Number(root.dataset.draftId),Number(root.dataset.revision),patch);
}

/* The last few turns, so "what about her?" works for the model too. */
let llmHistory = [];
export function resetLlmHistory() { llmHistory = []; }

/**
 * Let the model write the answer. Returns true if it actually said something.
 *
 * It is handed the figures the hub already computed and told not to do
 * arithmetic, the handbook passage if the question is a handbook one, and the
 * written note on how the relevant part of the hub works. Anything it cannot
 * support from those it is told to decline rather than invent.
 */
async function generate(q, deterministic, ticket, user) {
  const bubble = say('her', '');
  if (!bubble) return false;
  bubble.classList.add('streaming');

  /* Frame only what is worth framing.
     
     A computed answer full of counts and names reads like a printout and is
     better for an opening line. A written answer -- the dress code, how
     claiming works, a hello -- is already good prose, and putting the model in
     front of it only invites trouble: asked about a hoodie it opened with
     "Don't wear your university hoodie, or any hoodie at all", and asked about
     the weather it invented "it's a cloudy day". Both sailed past the digit
     and name guards because the problem was not a figure, it was an assertion.
     
     So prose answers are shown exactly as written and the model never sees
     them. It frames figures, and it answers questions nothing else could. */
  /* A count leads the answer: "52 guides are unclaimed", "0 of 59 evals are
     submitted", "7 guide assignments for Saturday". Prose answers open with
     words. Looking only at the opening keeps the dress code out of framing —
     it is a bulleted list with a page number at the bottom, so anything
     looser counted it as data and let the model editorialise over it
     ("Don't show up without your name tag, or you'll be out"). */
  const looksLikeData = /\d/.test(deterministic.text.slice(0, 80));
  const hasFacts = !deterministic.stuck && looksLikeData;
  if (!deterministic.stuck && !looksLikeData) { bubble.remove(); return false; }
  const book  = hasFacts ? null : handbookContext(q);   // framing needs no passage
  const notes = topicNote(q);

  const messages = buildMessages(q, {
    facts: hasFacts ? deterministic.text : null,
    book,
    notes,
    who:   { name: myName(), role: appState.role?.name || 'member' },
    history: llmHistory
  });

  let raw = '';
  try {
    await askLlm(messages, delta => {
      if (ticket !== epoch || user !== appState.me?.id) return;
      raw += delta;
      const { answer } = splitThinking(raw);
      // While framing, the sentence is short and lands at once; streaming a
      // half-written lead-in above figures that are not there yet reads oddly.
      if (answer) setMood('speaking');
      if (answer && !hasFacts) { bubble.textContent = answer; $('#v-log').scrollTop = $('#v-log').scrollHeight; }
    });
  } catch {
    /* fall through to the deterministic answer below */
  }
  bubble.classList.remove('streaming');
  if (ticket !== epoch || user !== appState.me?.id) { bubble.remove(); return false; }

  const answer = splitThinking(raw).answer.trim();
  if (!answer) { bubble.remove(); return false; }

  if (hasFacts) {
    /* She introduced the computed answer; the figures themselves are shown
       untouched underneath. A lead-in carrying any digit is thrown away — see
       usableLeadIn — and the computed answer stands on its own. */
    if (!usableLeadIn(answer, deterministic.text)) { bubble.remove(); return false; }
    bubble.textContent = `${answer}\n\n${deterministic.text}`;
    collapse(bubble);
  } else {
    /* Nothing computed, so nothing to contradict — but it still may not invent
       a figure that was in neither the handbook nor the question. */
    if (!numbersCheckOut(answer, book?.text, notes, q)) { bubble.remove(); return false; }
    bubble.textContent = answer;
  }
  collapse(bubble);

  llmHistory.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
  llmHistory = llmHistory.slice(-6);
  return true;
}

function send(question) {
  const q = question.trim();
  if (!q || !appState.me) return;
  const ticket = epoch, user = appState.me.id;
  readEvalEdits();
  say('you', q); $('#v-input').value = '';
  // Keep follow-up memory and displayed answers in submission order.
  sendQueue = sendQueue.then(async () => {
    if (ticket !== epoch || user !== appState.me?.id) return;
    const note = say('her', 'Checking…');
    note?.classList.add('is-typing');
    note?.setAttribute('aria-label', 'Vanessa is thinking');
    setMood('thinking');
    let inFlow = false;   // mid eval write-up: no side-quests offered
    try {
      /* Answering a choice she offered, by typing it. */
      if (typedChoice(q)) { note?.remove(); inFlow = true; return; }

      /* The fast path, before anything is warmed: tasks, navigation, help,
         references and the workflow under way. Each intent loads only the
         data it needs, through the module that owns it — "open attendance"
         never waits on the interview roster. */
      const plan = await interpretIntent(q);
      if (ticket !== epoch || user !== appState.me?.id) return;
      if (plan) { note?.remove(); inFlow = plan.type !== 'reply' || !!plan.actions?.length || !!activeFlow(); renderPlan(plan); return; }

      /* Everything else is a question for her ordinary answering, which
         reads from whatever the screens have loaded. */
      const failures = await warmUp();
      if (ticket !== epoch || user !== appState.me?.id) return;

      /* A tool explained in a line, with the way in — or a polite no. */
      const ex = explainTool(q);
      if (ex) {
        note?.remove();
        sayRich(ex.denied ? { text: ex.text } : { text: ex.text, to: ex.to, title: ex.title, kind: 'explain' });
        return;
      }
      const here = presenceAnswer(q);
      if (here) { note?.remove(); sayRich(here); return; }

      const acted = await handleAction(q);
      if (acted) {
        note?.remove();
        const el = sayRich(acted, { acted: true });
        const wait = pendingConfirmation();
        if (wait) { inFlow = true; addQuick(el, [{ label: wait.kind === 'makeup' ? 'Yes, mark it done' : 'Yes, claim', say: 'yes', confirm: true }, { label: 'Cancel', say: 'no', confirm: false }]); }
        if (acted.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) performAction(openAction(acted.go)); }, 500);
        return;
      }

      const reply = handleEvalMessage(q);
      paintEvalDraft();
      let r = await reply;
      // `reply` is a promise, so it is always truthy — test what it resolved to.
      const evalFlowHandled = !!r;
      inFlow = evalFlowHandled || !!evalDraft();
      if (ticket !== epoch || user !== appState.me?.id) return;
      if (!r) r = ask(q);
      paintEvalDraft();
      if (r.stuck && modelStatus().state === 'ready') {
        if (note) note.textContent = 'Let me think about that…';
        const canonical = await interpret(q);
        if (ticket !== epoch || user !== appState.me?.id) return;
        if (canonical) { const second = ask(canonical); if (!second.stuck) r = second; }
      }
      note?.remove();
      if (failures.length) sayRich({ kind: 'alert', text: `I could not load ${failures.join(', ')} just now, so this answer may be missing something. I will try again on your next question.` });

      /* With the model loaded she writes the reply herself, from the numbers
         the hub just worked out. The deterministic text stays as the safety
         net: if the model fails, stalls or produces nothing usable, that is
         what gets shown, so turning this on can never make her worse. */
      if (llmReady() && !evalFlowHandled) {
        const shown = await generate(q, r, ticket, user);
        if (shown) {
          if (r.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) performAction(openAction(r.go)); }, 400);
          return;
        }
      }

      const el = sayRich(r);
      if (evalFlowHandled) evalQuick(el);
      if (r.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) performAction(openAction(r.go)); }, 400);
    } catch (err) {
      note?.remove();
      if (ticket === epoch) renderPlan({ type: 'reply', kind: 'error', text: explainError(err, 'answering'), retry: () => { send(q); return null; } });
    } finally {
      note?.remove();
      if (ticket === epoch && user === appState.me?.id) { setMood('speaking'); if (!inFlow) paintFollowups(q); }
    }
  });
}

/* Open her from anywhere — the rail, the top bar, the home screen, a hint
   under a page title. With a question, she is asked it straight away; with
   none, she opens and greets as she always has. Routed through the same
   launcher click, so there is still exactly one way she opens. */
export function openVanessa(question) {
  const launch = $('#v-launch');
  if (!launch || !appState.me) return;
  if (!open) launch.click();
  if (question && question.trim()) send(question);
  else setTimeout(() => $('#v-input')?.focus(), 60);
}
export function toggleVanessa() { $('#v-launch')?.click(); }
const vanessaListeners = new Set();
export function onVanessaToggle(fn) { vanessaListeners.add(fn); return () => vanessaListeners.delete(fn); }
const tellToggle = () => vanessaListeners.forEach(fn => { try { fn(open); } catch {} });

export function resetVanessa() {
  resetLlmHistory();
  resetActions();
  resetWarmup(); resetVanessaData(); resetModel(); resetEvalFlow(); resetVoice(); voiceDraftRef=null; sendQueue = Promise.resolve(); open = false;
  plans.clear(); pendingSelect = null; resetMemory(null);
  $('#v-launch')?.remove(); $('#v-panel')?.remove(); document.body.classList.remove('v-open');
  setVanessaState('idle'); tellToggle();
}
export function initVanessa() {
  if ($('#v-launch') || !appState.me) return;
  const launch = document.createElement('button');
  launch.id = 'v-launch'; launch.className = 'v-launch'; launch.title = 'Ask Vanessa';
  launch.setAttribute('aria-label', 'Ask Vanessa'); launch.setAttribute('aria-expanded', 'false'); launch.textContent = '💬';
  document.body.appendChild(launch);
  const panel = document.createElement('div');
  panel.id = 'v-panel'; panel.className = 'v-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Vanessa');
  panel.innerHTML = `<div class="v-head"><span class="v-head-id"><span class="orb orb-sm" id="v-orb"><i></i></span>
      <span><strong>Vanessa<span class="v-live" id="v-live" hidden></span></strong><span class="sub" id="v-sub">Here with you</span></span></span>
    <span class="v-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <button type="button" class="icon-btn" id="v-close" aria-label="Close">✕</button></div>
    <div id="v-saved" class="v-saved" hidden></div>
    <div class="v-log" id="v-log" role="log" aria-live="polite"></div>
    <div class="v-chips" data-suggestions></div>
    <details><summary style="padding:8px 14px;cursor:pointer;font-size:.8rem">Smarter answers (optional)</summary>
      <div class="v-chips" id="v-llm"></div>
      <div class="v-chips" id="v-model"></div></details>
    <details id="v-voice"><summary style="padding:8px 14px;cursor:pointer;font-size:.875rem">Voice notes</summary>
    <div id="v-voice-body" class="v-voice-body"><p style="margin:0">Your browser may send audio to its speech service. Review the transcript before using it.</p>
      <p id="v-voice-status" role="status" style="margin:0"></p>
      <div class="v-eval-actions"><button type="button" class="btn btn-sm" id="v-voice-start">Start microphone</button><button type="button" class="btn btn-sm" id="v-voice-stop" disabled>Stop</button></div>
      <label for="v-transcript">Review transcript</label><textarea id="v-transcript" rows="3" maxlength="12000"></textarea>
      <label for="v-voice-target">Use transcript in</label><select id="v-voice-target"><option value="chat">Chat message</option><option value="wentWell">What went well</option><option value="improve">Areas to improve</option><option value="notes">Other notes</option></select>
      <button type="button" class="btn btn-sm" id="v-voice-use" disabled>Use transcript</button>
    </div></details>
    <form class="v-ask" id="v-form"><input id="v-input" aria-label="Question for Vanessa" placeholder="Ask about the hub…" autocomplete="off">
    <button class="btn btn-primary btn-sm" type="submit">Ask</button></form>`;
  document.body.appendChild(panel);
  const ticket = epoch;
  paintLlmRow();paintModelRow();paintSavedDraft();paintVoice();
  // Weights are cached after the first time, so this needs no click.
  resumeLlmIfWanted().catch(() => {});
  if(!voiceSupported())$('#v-voice-status').textContent='Dictation is not supported in this browser. You can still type.';
  checkAvailability().then(() => { if (ticket === epoch && appState.me) resumeIfEnabled(); });
  /* Closing plays her exit before the panel is hidden. A reopen during that
     moment cancels it, so a quick double-click never leaves her hidden. */
  let closing = null;
  const close = () => {
    readEvalEdits(); resetVoice(); voiceDraftRef=null; open = false;
    launch.setAttribute('aria-expanded','false'); document.body.classList.remove('v-open'); tellToggle();
    panel.classList.add('is-closing');
    clearTimeout(closing);
    closing = setTimeout(() => { panel.hidden = true; panel.classList.remove('is-closing'); }, 190);
  };
  launch.addEventListener('click', async () => {
    if (!appState.me) return;
    if(open){close();return;}
    open = !open; clearTimeout(closing); panel.classList.remove('is-closing');
    panel.hidden = !open; launch.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('v-open', open); tellToggle();
    if (open) {
      paintContext();
      $('#v-input')?.focus();
      await warmUp();
      if (ticket !== epoch || !open) return;
      paintSavedDraft();
      if (!$('#v-log').children.length) say('her', greeting());
    }
  });
  $('#v-close').addEventListener('click', close);
  $('#v-form').addEventListener('submit', e => { e.preventDefault(); send($('#v-input').value); });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); launch.focus(); } });
  closePanel = () => { if (open) close(); };
  panel.addEventListener('input', e=>{
    if(e.target.id==='v-transcript'){setVoiceText(e.target.value);$('#v-voice-use').disabled=!e.target.value.trim();return;}
    const node=e.target.closest('[data-eval-field]');
    if(node){
      const root=$('#v-eval-draft'),key=node.dataset.evalField;
      const value=key==='rating'?(node.value?Number(node.value):null):node.value;
      if(bufferEvalDraft(Number(root.dataset.draftId),Number(root.dataset.revision),{[key]:value})){
        const draft=evalDraft();root.dataset.revision=String(draft.revision);
        root.querySelector('.v-eval-fields > p').textContent=draft.saved?'Draft saved on this browser. Not submitted.':'Draft could not be saved. Keep this tab open.';
      }
    }
  });
  panel.addEventListener('click', e => {
    if(e.target.id==='v-voice-start'){
      readEvalEdits();const draft=evalDraft();voiceDraftRef=draft?{id:draft.draftId,revision:draft.revision}:null;
      startVoice();return;
    }
    if(e.target.id==='v-voice-stop'){stopVoice();return;}
    if(e.target.id==='v-voice-use'){useTranscript();return;}
    const action=e.target.closest('[data-eval-action]');
    if(action) {
      if(action.dataset.evalAction==='cancel') {send('cancel draft');return;}
      if(action.dataset.evalAction==='update') {
        const result=readEvalEdits(true);
        if(result)say('her',result.text);
        paintEvalDraft();return;
      }
      if(action.dataset.evalAction==='submit') {send('submit it');return;}
    }
    if (e.target.id === 'v-llm-on')  { loadLlm().catch(() => {}); return; }
    if (e.target.id === 'v-llm-off') { unloadLlm(); return; }
    if (e.target.id === 'v-model-on') { enableModel().catch(() => {}); return; }
    if (e.target.id === 'v-model-cancel') { cancelModel(); return; }
    if (e.target.id === 'v-model-off') { disableModel(); return; }
    if (e.target.id === 'v-model-check') { checkAvailability(); return; }
    /* Plan components: choices, confirmations, suggestions, summaries. */
    if (e.target.closest('[data-peek]')) { close(); return; }
    const card = e.target.closest('[data-plan]');
    const plan = card && plans.get(Number(card.dataset.plan));
    if (plan) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.opt !== undefined) { pendingSelect = null; b.classList.add('is-chosen'); runStep(card, plan.options[Number(b.dataset.opt)].run); return; }
      if (b.dataset.item !== undefined) { b.classList.add('is-chosen'); runLoose(plan.items[Number(b.dataset.item)].run); return; }
      if (b.dataset.extra !== undefined) { pendingSelect = null; runStep(card, plan.extra[Number(b.dataset.extra)].run); return; }
      if (b.dataset.pact !== undefined) { const a = plan.actions.filter(Boolean)[Number(b.dataset.pact)]; if (a.go && narrow()) close(); runLoose(a.run); return; }
      if (b.dataset.rate !== undefined) { runStep(card, () => plan.rate.run(Number(b.dataset.rate))); return; }
      if (b.hasAttribute('data-confirm')) { runStep(card, plan.confirm?.run); return; }
      if (b.dataset.sec !== undefined) { runStep(card, plan.secondary[Number(b.dataset.sec)].run); return; }
      if (b.hasAttribute('data-cancel')) { runStep(card, plan.cancel?.run || (() => ({ type: 'reply', text: 'Okay — nothing was changed.' }))); return; }
      if (b.hasAttribute('data-retry')) { runStep(card, plan.retry); return; }
      if (b.hasAttribute('data-flowcancel')) { runStep(card, () => { const f = endFlow('cancelled'); settleFlowCards();
        return { type: 'reply', text: f ? 'Okay — stopped. Nothing was submitted.' : 'Okay.' }; }); return; }
      if (b.dataset.sug) {
        const fn = plan.actions?.[b.dataset.sug];
        if (b.dataset.sug === 'edit' && narrow()) setTimeout(() => close(), 400);
        runStep(card, fn);
        return;
      }
      if (b.dataset.sact !== undefined) { runStep(card, plan.actions[Number(b.dataset.sact)].run); return; }
    }
    if (e.target.closest('[data-resume]')) {
      const f = activeFlow('evaluate');
      if (f) runLoose(() => f.step === 'review' || f.step === 'suggest' ? reviewEval() : ({ type: 'reply', text: `Tell me how ${f.data.name.split(' ')[0]}’s tour went — rough notes are fine.` }));
      return;
    }
    /* Quick answers to her existing flows. */
    const quick = e.target.closest('[data-say]');
    if (quick) {
      quick.closest('.v-inline-acts, .v-confirm-acts')?.querySelectorAll('button').forEach(x => { x.disabled = true; });
      if (quick.dataset.say) send(quick.dataset.say); else $('#v-eval-draft textarea')?.focus();
      return;
    }
    /* Registry actions — the same ones the home screen draws. */
    const act = e.target.closest('[data-action]');
    if (act) {
      const out = performAction(actionById(act.dataset.action));
      if (out?.type === 'handoff' && narrow()) close();
      else if (out && out.type !== 'handoff') renderPlan(out);
      return;
    }
    const dest = e.target.closest('[data-go]');
    if (dest) {
      if (narrow()) close();
      const out = performAction(openAction(dest.dataset.go));
      if (out && out.type !== 'handoff') renderPlan(out);
      return;
    }
    const chip = e.target.closest('[data-question]');
    if (chip) send(chip.dataset.question);
  });
  paintContext();
}

/* Ambient: how many teammates are here, beside her name. */
document.addEventListener('hub:presence', e => {
  const el = $('#v-live'); if (!el) return;
  const k = e.detail && !e.detail.error ? (e.detail.users || []).length : 0;
  el.hidden = k < 2; el.textContent = `${k} active`;
});

/* She always knows which screen you are on: her header, suggestions and
   follow-ups are redrawn whenever the route changes, open or not. */
onRoute(() => {
  noteRoute(routeId());
  paintContext();
  const log = $('#v-log');
  if (log?.querySelector('.v-follow')) paintFollowups('');
});
