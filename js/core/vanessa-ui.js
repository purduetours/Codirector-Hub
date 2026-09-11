/* Vanessa panel, model controls, and session-scoped data loading. */
import { ask, greeting, shareInterviews, shareOther, resetVanessaData } from './vanessa.js';
import { modelStatus, onModelChange, checkAvailability, enableModel, cancelModel, disableModel, resetModel, interpret, resumeIfEnabled } from './vanessa-model.js';
import { state as appState, inTraining, inRecruitment } from './state.js';
import { $, esc, injectStyle } from './ui.js';
import { go } from './router.js';
import { handleEvalMessage, evalDraft, resetEvalFlow, editEvalDraft } from './vanessa-eval.js';
export { shareInterviews };
export const shareData = (kind, rows) => shareOther(kind, rows);
injectStyle('vanessa-css', `
.v-launch { position:fixed; right:18px; bottom:18px; z-index:60;
  width:52px; height:52px; border-radius:50%; border:0; cursor:pointer;
  background:var(--accent); color:#fff; font-size:22px; line-height:1;
  box-shadow:var(--shadow-lg); transition:transform .15s; }
.v-launch:hover { transform:scale(1.06); }
.v-panel { position:fixed; right:18px; bottom:80px; z-index:61; width:min(380px, calc(100vw - 36px));
  max-height:min(560px, calc(100dvh - 120px)); display:flex; flex-direction:column;
  background:var(--bg-elev); border:1px solid var(--line); border-radius:16px;
  box-shadow:var(--shadow-lg); overflow:hidden; }
.v-head { display:flex; align-items:center; justify-content:space-between;
  padding:12px 14px; border-bottom:1px solid var(--line); background:var(--bg-sunken); }
.v-head strong { font-size:.92rem; }
.v-head .sub { font-size:.7rem; color:var(--text-faint); display:block; }
.v-log { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
.v-msg { font-size:.85rem; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere;
  padding:9px 12px; border-radius:12px; max-width:92%; }
.v-msg.her { background:var(--bg-sunken); color:var(--text); align-self:flex-start; border-bottom-left-radius:4px; }
.v-msg.you { background:var(--accent); color:#fff; align-self:flex-end; border-bottom-right-radius:4px; }
.v-chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 10px; }
.v-chip { font:inherit; font-size:.74rem; cursor:pointer; padding:5px 10px; border-radius:999px;
  border:1px solid var(--line-strong); background:var(--bg-elev); color:var(--text-soft); }
.v-chip:hover { border-color:var(--accent); color:var(--text); }
.v-model-on { font-size:.74rem; color:var(--good); align-self:center; }
.v-ask { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--line); }
.v-ask input { flex:1; min-width:0; }
.v-log { min-height:60px; }
#v-eval-draft { max-height:280px; flex-shrink:1; overflow-y:auto; border-top:1px solid var(--line); }
.v-eval-fields { padding:10px 14px; font-size:.8rem; display:grid; gap:8px; }
.v-eval-fields label { display:grid; gap:4px; }
.v-eval-fields textarea { width:100%; min-height:50px; resize:vertical; }
.v-eval-fields .row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.v-eval-actions { display:flex; gap:6px; flex-wrap:wrap; }
.v-panel > details { max-height:45%; overflow-y:auto; flex-shrink:0; }
.v-panel > .v-chips { max-height:100px; overflow-y:auto; flex-shrink:0; }
@media (max-width:520px){ .v-panel { right:10px; left:10px; width:auto; bottom:76px; } }
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
  const el = document.createElement('div');
  el.className = 'v-msg ' + who; el.textContent = text;
  log.appendChild(el); log.scrollTop = log.scrollHeight;
  return el;
}
function paintModelRow() {
  const row = $('#v-model');
  if (!row || !appState.me) return;
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
  const suggestions = $('[data-suggestions]', panel);
  if (suggestions) suggestions.hidden = !!draft;
  if (!draft?.evalId) return;
  const root = document.createElement('details');
  root.id='v-eval-draft'; root.open=true;
  root.dataset.draftId=String(draft.draftId); root.dataset.revision=String(draft.revision);
  root.innerHTML=`<summary style="padding:8px 14px;cursor:pointer;font-size:.8rem">Eval draft: ${esc(draft.name)}</summary>
    <div class="v-eval-fields"><p style="margin:0">${draft.phase==='submitting'?'Submitting…':'Not submitted — review your feedback below.'}</p>
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
    try {
      const failures = await warmUp();
      if (ticket !== epoch || user !== appState.me?.id) return;
      const reply = handleEvalMessage(q);
      paintEvalDraft();
      let r = await reply;
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
      say('her', r.text);
      if (r.go) setTimeout(() => { if (ticket === epoch && user === appState.me?.id) go(r.go); }, 400);
    } catch (err) {
      note?.remove();
      if (ticket === epoch) say('her', 'I could not finish that question. Please try again.');
    } finally { note?.remove(); }
  });
}

export function resetVanessa() {
  resetWarmup(); resetVanessaData(); resetModel(); resetEvalFlow(); sendQueue = Promise.resolve(); open = false;
  $('#v-launch')?.remove(); $('#v-panel')?.remove();
}
export function initVanessa() {
  if ($('#v-launch') || !appState.me) return;
  const launch = document.createElement('button');
  launch.id = 'v-launch'; launch.className = 'v-launch'; launch.title = 'Ask Vanessa';
  launch.setAttribute('aria-label', 'Ask Vanessa'); launch.setAttribute('aria-expanded', 'false'); launch.textContent = '💬';
  document.body.appendChild(launch);
  const panel = document.createElement('div');
  panel.id = 'v-panel'; panel.className = 'v-panel'; panel.hidden = true;
  const suggestions = [
    ...(inTraining() ? ['Help me write an eval', 'What are my evals?'] : []),
    ...(inRecruitment() ? ['Who is worth discussing?', 'Who has not checked in?'] : []),
    'Who is leading tours tomorrow?', 'What should I wear on tour?'
  ];
  panel.innerHTML = `<div class="v-head"><span><strong>Vanessa</strong><span class="sub">Answers from your loaded hub data</span></span>
    <button type="button" class="icon-btn" id="v-close" aria-label="Close">✕</button></div>
    <div class="v-log" id="v-log" role="log" aria-live="polite"></div>
    <div class="v-chips" data-suggestions>${suggestions.map(s => `<button type="button" class="v-chip" data-question="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <details><summary style="padding:8px 14px;cursor:pointer;font-size:.8rem">Optional model</summary><div class="v-chips" id="v-model"></div></details>
    <form class="v-ask" id="v-form"><input id="v-input" aria-label="Question for Vanessa" placeholder="Ask about the hub…" autocomplete="off">
    <button class="btn btn-primary btn-sm" type="submit">Ask</button></form>`;
  document.body.appendChild(panel);
  const ticket = epoch;
  paintModelRow();
  checkAvailability().then(() => { if (ticket === epoch && appState.me) resumeIfEnabled(); });
  const close = () => { open = false; panel.hidden = true; launch.setAttribute('aria-expanded','false'); };
  launch.addEventListener('click', async () => {
    if (!appState.me) return;
    open = !open; panel.hidden = !open; launch.setAttribute('aria-expanded', String(open));
    if (open) {
      $('#v-input')?.focus();
      await warmUp();
      if (ticket !== epoch || !open) return;
      if (!$('#v-log').children.length) say('her', greeting());
    }
  });
  $('#v-close').addEventListener('click', close);
  $('#v-form').addEventListener('submit', e => { e.preventDefault(); send($('#v-input').value); });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); launch.focus(); } });
  panel.addEventListener('click', e => {
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
    if (e.target.id === 'v-model-on') { enableModel().catch(() => {}); return; }
    if (e.target.id === 'v-model-cancel') { cancelModel(); return; }
    if (e.target.id === 'v-model-off') { disableModel(); return; }
    if (e.target.id === 'v-model-check') { checkAvailability(); return; }
    const chip = e.target.closest('[data-question]');
    if (chip) send(chip.dataset.question);
  });
}
