/* ============================================================ Vanessa's panel
   A launcher in the corner and a slide-out conversation. Uses the hub's own
   tokens so it looks like part of the app rather than a bolted-on widget.
============================================================================ */
import { ask, greeting, shareInterviews, shareOther } from './vanessa.js';
import { modelSupported, modelState, checkAvailability, enableModel, disableModel, interpret, resumeIfEnabled, wasEnabled } from './vanessa-model.js';
import { state as appState } from './state.js';
import { $, esc, injectStyle } from './ui.js';
import { go } from './router.js';

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
.v-ask input { flex:1; }
@media (max-width:520px){ .v-panel { right:10px; left:10px; width:auto; bottom:76px; } }
`);

const SUGGESTIONS = [
  'Who still needs an eval?',
  'Who is worth discussing?',
  'What are my evals?',
  'How is the final score worked out?'
];

let open = false;

function say(who, text) {
  const log = $('#v-log');
  const el = document.createElement('div');
  el.className = 'v-msg ' + who;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

/* Only the Developer sees this while we find out whether it is actually better
   than the keyword matcher. */
const canSeeModelToggle = () => appState.role?.name === 'Developer' && modelSupported();

async function paintModelRow() {
  const row = $('#v-model');
  if (!row) return;
  if (!canSeeModelToggle()) { row.hidden = true; return; }
  row.hidden = false;
  const on = modelState() === 'ready';
  row.innerHTML = on
    ? `<span class="v-model-on">Smarter answers on</span> <button class="v-chip" id="v-model-off">turn off</button>`
    : `<button class="v-chip" id="v-model-on">Try smarter answers</button>`;
}

async function send(q) {
  if (!q.trim()) return;
  say('you', q);
  $('#v-input').value = '';

  const r = ask(q);

  /* The model only gets a turn when the keyword matcher has already failed.
     It cannot replace a good answer with a bad one — only an "I did not follow
     that" with something. If it also has no idea, the original reply stands. */
  if (r.stuck && modelState() === 'ready') {
    const thinking = say('her', 'Let me think about that…');
    const canonical = await interpret(q);
    thinking?.remove();
    if (canonical) {
      const second = ask(canonical);
      if (!second.stuck) {
        say('her', second.text);
        if (second.go) setTimeout(() => go(second.go), 400);
        return;
      }
    }
  }

  say('her', r.text);
  if (r.go) setTimeout(() => go(r.go), 400);
}

export function initVanessa() {
  if ($('#v-launch')) return;

  const launch = document.createElement('button');
  launch.id = 'v-launch';
  launch.className = 'v-launch';
  launch.title = 'Ask Vanessa';
  launch.setAttribute('aria-label', 'Ask Vanessa');
  launch.textContent = '💬';
  document.body.appendChild(launch);

  const panel = document.createElement('div');
  panel.className = 'v-panel';
  panel.id = 'v-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="v-head">
      <span><strong>Vanessa</strong><span class="sub">Answers from what is on your screen</span></span>
      <button class="icon-btn" id="v-close" aria-label="Close">✕</button>
    </div>
    <div class="v-log" id="v-log"></div>
    <div class="v-chips">${SUGGESTIONS.map(s => `<button class="v-chip">${esc(s)}</button>`).join('')}</div>
    <div class="v-chips" id="v-model" hidden></div>
    <form class="v-ask" id="v-form">
      <input id="v-input" placeholder="Ask about the hub…" autocomplete="off">
      <button class="btn btn-primary btn-sm" type="submit">Ask</button>
    </form>`;
  document.body.appendChild(panel);

  checkAvailability().then(async () => {
    paintModelRow();
    // Already downloaded on a previous visit: switch it on with no click and no
    // wait, which is what "on when you open the app" looks like after the first
    // time. If Chrome still wants a gesture, the button stays and nothing stalls.
    if (wasEnabled()) { await resumeIfEnabled(); paintModelRow(); }
  });

  launch.addEventListener('click', () => {
    open = !open;
    panel.hidden = !open;
    if (open) {
      paintModelRow();
      if (!$('#v-log').children.length) say('her', greeting());
      setTimeout(() => $('#v-input').focus(), 60);
    }
  });
  $('#v-close').addEventListener('click', () => { open = false; panel.hidden = true; });
  $('#v-form').addEventListener('submit', e => { e.preventDefault(); send($('#v-input').value); });
  panel.addEventListener('click', async e => {
    if (e.target.id === 'v-model-on') {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Starting…';

      /* This is a multi-gigabyte download the first time, and a button reading
         "Starting…" for ten minutes looks broken. Say what is happening, keep
         the number moving, and make clear she still works meanwhile. */
      const note = say('her',
        'Chrome is downloading its language model now — a few gigabytes, once, ' +
        'and it keeps it afterwards so this never happens again. It can take a ' +
        'while on a slow connection.\n\nCarry on asking me things; I will say ' +
        'when it is ready.');

      let pct = 0, ticks = 0;
      const beat = setInterval(() => {
        ticks++;
        const shown = pct ? `${Math.round(pct * 100)}%` : 'still going';
        note.textContent = `Downloading Chrome's model — ${shown}. ` +
          (ticks > 12 ? 'This one is taking a while; it is safe to close this panel and come back.' : 'Carry on asking me things meanwhile.');
      }, 5000);

      try {
        // Must happen inside this click: Chrome will not begin the download
        // from a script that a person did not trigger.
        await enableModel(p => { pct = p; btn.textContent = `Downloading ${Math.round(p * 100)}%`; });
        clearInterval(beat);
        note.textContent = 'Smarter answers are on. Ask me something in your own words and I will work harder to understand it. Next time you open the hub it will already be on.';
      } catch (err) {
        clearInterval(beat);
        note.textContent = err.message;
      }
      paintModelRow();
      return;
    }
    if (e.target.id === 'v-model-off') { disableModel(); paintModelRow(); return; }
    const chip = e.target.closest('.v-chip');
    if (chip) send(chip.textContent);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { open = false; panel.hidden = true; }
  });
}
