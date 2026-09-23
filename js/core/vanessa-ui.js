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
import { go, onRoute, currentModule } from './router.js';
import { actionsFor } from './vanessa-context.js';
import { ICONS } from './icons.js';
import { handleEvalMessage, evalDraft, resetEvalFlow, editEvalDraft, savedEvalSummary, bufferEvalDraft } from './vanessa-eval.js';
import { handleAction, resetActions } from './vanessa-actions.js';
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
.v-head::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; opacity:0;
  background:linear-gradient(90deg, transparent, var(--v-1), var(--v-2), var(--v-3), transparent);
  background-size:200% 100%; transition:opacity .3s; }
:root[data-vanessa="thinking"] .v-head::after, :root[data-vanessa="speaking"] .v-head::after { opacity:1; animation:v-sweep 1.4s linear infinite; }
@keyframes v-sweep { to { background-position:-200% 0; } }
.v-wave { display:inline-flex; align-items:center; gap:3px; height:18px; margin-left:auto; margin-right:4px; opacity:.25; transition:opacity .3s; }
.v-wave i { width:3px; height:5px; border-radius:3px; background:var(--gold-deep); transition:height .2s; }
:root[data-vanessa="thinking"] .v-wave, :root[data-vanessa="speaking"] .v-wave, :root[data-vanessa="listening"] .v-wave { opacity:1; }
:root[data-vanessa="thinking"] .v-wave i { animation:v-bar 1s ease-in-out infinite; }
:root[data-vanessa="speaking"] .v-wave i { animation:v-bar .6s ease-in-out infinite; }
:root[data-vanessa="listening"] .v-wave i { animation:v-bar .45s ease-in-out infinite; background:var(--good); }
.v-wave i:nth-child(2) { animation-delay:.12s !important; } .v-wave i:nth-child(3) { animation-delay:.24s !important; } .v-wave i:nth-child(4) { animation-delay:.36s !important; }
@keyframes v-bar { 50% { height:16px; } }

.v-log { padding-left:46px; scroll-behavior:smooth; }
.v-msg { transform-origin:left bottom; animation:v-msg-in .42s var(--ease-out) both; }
.v-msg.you { transform-origin:right bottom; }
@keyframes v-msg-in { from { opacity:0; transform:translateY(8px) scale(.97); } }
.v-msg.her { position:relative; border:1px solid color-mix(in srgb, var(--line) 70%, transparent);
  background:linear-gradient(180deg, color-mix(in srgb, var(--gold-wash) 55%, var(--bg-sunken)), var(--bg-sunken)); }
.v-msg.her::before { content:""; position:absolute; left:-32px; bottom:2px; width:22px; height:22px; border-radius:50%;
  background:radial-gradient(circle at 32% 30%, #fff8e0 0 10%, transparent 34%), conic-gradient(var(--v-1), #f3cf6a, var(--v-2), var(--gold-deep), var(--v-1));
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
/* On a wide screen she docks beside the workspace instead of covering it. */
@media (min-width:1280px){
  .v-panel { top:10px; bottom:10px; right:10px; width:420px; }
  body.v-open .main { padding-right:432px; }
  body.v-open .topbar .sync, body.v-open .au-lbl, body.v-open .v-top-lbl, body.v-open .qs-wrap::after { display:none; }
  body.v-open .qs-input { width:150px !important; }
  body.v-open .v-float { opacity:0; pointer-events:none; transform:translateY(12px) scale(.9); }
}
@media (max-width:860px){
  .v-panel { inset:0; width:auto; border-radius:0; border:0; padding-top:env(safe-area-inset-top);
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
  if (who === 'her') collapse(el);
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
let moodTimer = null;
function setMood(mood) {
  clearTimeout(moodTimer);
  document.documentElement.dataset.vanessa = mood;
  if (mood === 'speaking') moodTimer = setTimeout(() => setMood('idle'), 1400);
}

/* ------------------------------------------------------- context & actions */
const routeId = () => currentModule()?.id || 'today';
const routeTitle = () => currentModule()?.title || 'Home';

function actionButton(a) {
  const go_ = a.kind === 'go';
  return `<button type="button" class="v-chip ${go_ ? 'is-go' : ''}" ${go_ ? `data-go="${esc(a.to)}"` : `data-question="${esc(a.q)}"`}>` +
    `${esc(a.label)}${go_ ? ICONS.arrow : ''}</button>`;
}

function paintContext() {
  const sub = $('#v-sub');
  if (sub) sub.textContent = routeId() === 'today' ? 'Here with you on Home' : `Here with you on ${routeTitle()}`;
  const box = $('[data-suggestions]');
  if (box) box.innerHTML = actionsFor(routeId()).slice(0, 6).map(actionButton).join('');
}

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
onVoiceChange(() => { const st = voiceState(); if (st.phase === 'recording') setMood('listening'); else if (document.documentElement.dataset.vanessa === 'listening') setMood('idle'); });
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
      const failures = await warmUp();
      if (ticket !== epoch || user !== appState.me?.id) return;
      /* Doing something comes before answering: "claim Noah" is a request,
         not a question, and must not be routed to the roster matcher. */
      const acted = await handleAction(q);
      if (acted) {
        note?.remove();
        say('her', acted.text);
        if (acted.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) go(acted.go); }, 500);
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
      if (failures.length) say('her', `Could not load ${failures.join(', ')}. I will retry on your next question; answers may be limited until it loads.`);

      /* With the model loaded she writes the reply herself, from the numbers
         the hub just worked out. The deterministic text stays as the safety
         net: if the model fails, stalls or produces nothing usable, that is
         what gets shown, so turning this on can never make her worse. */
      if (llmReady() && !evalFlowHandled) {
        const shown = await generate(q, r, ticket, user);
        if (shown) {
          if (r.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) go(r.go); }, 400);
          return;
        }
      }

      say('her', r.text);
      if (r.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) go(r.go); }, 400);
    } catch (err) {
      note?.remove();
      if (ticket === epoch) say('her', 'I could not finish that question. Please try again.')?.classList.add('is-error');
    } finally {
      note?.remove();
      if (ticket === epoch && user === appState.me?.id) { setMood('speaking'); if (!inFlow) paintFollowups(q); }
    }
  });
}

/* What she offers to help with, by committee. The same list feeds her panel
   and the home screen, so the two can never disagree about what she can do
   for this person. */
export function vanessaSuggestions() {
  return [
    ...(inTraining() ? ['Help me write an eval', 'What do I need to do?'] : []),
    ...(inRecruitment() ? ['Who is worth discussing?', 'Who has not checked in?'] : []),
    ...(inTraining() ? ['Who needs an eval and has a tour tomorrow?'] : ['Who is leading tours tomorrow?']),
    'What should I wear on tour?'
  ];
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
  $('#v-launch')?.remove(); $('#v-panel')?.remove(); document.body.classList.remove('v-open');
  document.documentElement.dataset.vanessa = 'idle'; tellToggle();
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
      <span><strong>Vanessa</strong><span class="sub" id="v-sub">Here with you</span></span></span>
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
    const dest = e.target.closest('[data-go]');
    if (dest) {
      // On a narrow screen she is in the way of the tool she just opened.
      if (!matchMedia('(min-width: 1280px)').matches) close();
      go(dest.dataset.go);
      return;
    }
    const chip = e.target.closest('[data-question]');
    if (chip) send(chip.dataset.question);
  });
  paintContext();
}

/* She always knows which screen you are on: her header, suggestions and
   follow-ups are redrawn whenever the route changes, open or not. */
onRoute(() => {
  paintContext();
  const log = $('#v-log');
  if (log?.querySelector('.v-follow')) paintFollowups('');
});
