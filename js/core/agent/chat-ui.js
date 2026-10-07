/* ============================================================ the conversation, drawn
   Renders one agent turn into Vanessa's log: a status line while she works, data
   cards from the tools she used, her streamed words, then (if she prepared a
   change) a confirmation card, and later a receipt.

   It only builds DOM from structured events; it never interprets text as markup
   (see format.js) and never decides anything. Deciding is the runtime's job.
*/
import { esc, toHtml } from './format.js';

const ICON = { check: '✓', warn: '!', dot: '•', arrow: '→' };
const mins = ms => Math.max(1, Math.round(ms / 60000));
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function createChatUi({ log, announce, onLink, onConfirm, onCancel, onAsk, onSpeak }) {
  const scroll = () => { if (log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTo({ top: log.scrollHeight, behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; };

  const link = l => `<a class="va-chip" href="${esc(l.route)}" data-va-link>${esc(l.label)}<span aria-hidden="true">${ICON.arrow}</span></a>`;
  const links = list => (list && list.length ? `<div class="va-links">${list.map(link).join('')}</div>` : '');

  /* ------------------------------------------------------------------ cards */
  function cardHtml(c) {
    const head = c.title ? `<div class="va-card-h${c.tone ? ' is-' + c.tone : ''}">${esc(c.title)}</div>` : '';
    let body = '';
    if (c.kind === 'rows') body = `<dl class="va-rows">${(c.rows || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    else if (c.kind === 'person') body = `<div class="va-person"><span class="va-avatar" aria-hidden="true">${esc(initials(c.title))}</span><span class="va-person-main"><b>${esc(c.title)}</b>${c.sub ? `<span>${esc(c.sub)}</span>` : ''}</span></div>${c.badges?.length ? `<div class="va-badges">${c.badges.map(b => `<em class="va-badge${b.tone ? ' is-' + b.tone : ''}">${esc(b.text)}</em>`).join('')}</div>` : ''}<dl class="va-rows">${(c.rows || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    else if (c.kind === 'list') body = `<ul class="va-list">${(c.items || []).map(i => {
      const inner = `<span class="va-li-main"><b>${esc(i.label)}</b>${i.sub ? `<span>${esc(i.sub)}</span>` : ''}</span>${i.badge ? `<em class="va-badge">${esc(i.badge)}</em>` : ''}`;
      const act = i.ask ? `<button type="button" class="va-mini" data-va-ask="${esc(i.ask)}">${esc(i.askLabel || 'Choose')}</button>` : '';
      return `<li${act ? ' class="has-act"' : ''}>${i.href && /^(#\/|https:\/\/)/.test(i.href) ? `<a href="${esc(i.href)}" ${i.href.startsWith('#') ? 'data-va-link' : 'target="_blank" rel="noopener noreferrer"'}>${inner}</a>` : inner}${act}</li>`;
    }).join('')}</ul>${c.more ? `<div class="va-more">…and ${esc(c.more.count)} more · ${c.more.link ? `<a href="${esc(c.more.link.route)}" data-va-link>${esc(c.more.link.label)}</a>` : ''}</div>` : ''}`;
    else if (c.kind === 'checklist') body = `<ul class="va-check">${(c.items || []).map(i => `<li class="${i.ok ? 'is-ok' : 'is-bad'}"><span class="va-mark" aria-hidden="true">${i.ok ? ICON.check : ICON.warn}</span><span><b>${esc(i.label)}</b>${i.sub ? `<em>${esc(i.sub)}</em>` : ''}</span><span class="va-sr">${i.ok ? 'done' : 'needs attention'}</span></li>`).join('')}</ul>`;
    else if (c.kind === 'brief') body = (c.sections || []).map(s => `<section class="va-bsec${s.tone ? ' is-' + s.tone : ''}"><h4>${esc(s.title)}</h4><ul>${s.items.map(i => `<li class="lv-${esc(i.level || 'info')}">${i.link ? `<a href="${esc(i.link.route)}" data-va-link>${esc(i.text)}</a>` : esc(i.text)}</li>`).join('')}</ul></section>`).join('');
    else if (c.kind === 'draft') body = `<pre class="va-draft" tabindex="0">${esc(c.text)}</pre><div class="va-links"><button type="button" class="va-chip" data-va-copy>Copy draft</button></div>${c.sub ? `<div class="va-more">${esc(c.sub)}</div>` : ''}`;
    const asks = c.asks?.length ? `<div class="va-links">${c.asks.map(a => `<button type="button" class="va-chip" data-va-ask="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : '';
    return `${head}${body}${links(c.links)}${asks}`;
  }
  function addCard(turn, card, extraLinks) {
    const c = el('va-card', cardHtml({ ...card, links: card.links || extraLinks }));
    if (card.kind === 'draft') c.querySelector('[data-va-copy]')?.addEventListener('click', e => { navigator.clipboard?.writeText(card.copy || card.text).then(() => { e.target.textContent = 'Copied'; }, () => { e.target.textContent = 'Copy failed'; }); });
    turn.cards.appendChild(c); scroll();
  }

  /* ------------------------------------------------------------------- turn */
  function beginTurn() {
    const root = el('v-msg her va-turn');
    root.innerHTML = '<div class="va-cards"></div><div class="va-text" aria-live="off"></div><div class="va-typing" aria-hidden="true"><i></i><i></i><i></i></div><div class="va-statusline" hidden></div><div class="va-after"></div>';
    log.appendChild(root); scroll();
    const t = { root, cards: root.querySelector('.va-cards'), text: root.querySelector('.va-text'), typing: root.querySelector('.va-typing'), status: root.querySelector('.va-statusline'), after: root.querySelector('.va-after'), raw: '', pending: null };
    root.setAttribute('aria-busy', 'true');
    return t;
  }

  function onEvent(t, ev) {
    if (ev.type === 'thinking') { t.typing.hidden = false; }
    else if (ev.type === 'status') { t.status.hidden = false; t.status.textContent = ev.text; announce?.(ev.text); }
    else if (ev.type === 'delta') { t.typing.hidden = true; t.status.hidden = true; t.raw += ev.text; t.text.textContent = t.raw; scroll(); }
    else if (ev.type === 'card') addCard(t, ev.card, ev.links);
    else if (ev.type === 'pending') t.pending = ev.pending;
    else if (ev.type === 'suggest') t.suggest = ev.items;
    else if (ev.type === 'navigate') onLink?.(ev.route, { silent: true });
    else if (ev.type === 'done' || ev.type === 'error') finish(t, ev);
  }

  function finish(t, ev) {
    t.typing.hidden = true; t.status.hidden = true; t.root.removeAttribute('aria-busy');
    const text = ev.type === 'error' ? ev.text : (t.raw || ev.text);
    if (ev.type === 'error') t.root.classList.add('va-err');
    t.text.innerHTML = toHtml(text);
    if (!text && !t.cards.children.length && !t.pending) t.root.remove();
    if (t.pending) addConfirm(t, t.pending);
    else if (t.suggest?.length && ev.type === 'done') t.after.appendChild(el('va-links va-suggest', t.suggest.slice(0, 4).map(a => `<button type="button" class="va-chip" data-va-ask="${esc(a)}">${esc(a)}</button>`).join('')));
    if (ev.type === 'done' && ev.aborted) t.root.remove();
    if (text) announce?.(text);
    scroll();
  }

  /* ------------------------------------------------------------ confirmation */
  function addConfirm(t, p) {
    const c = el(`va-confirm is-${p.risk}${p.mode === 'mock' ? ' is-test' : ''}`); c.dataset.pid = p.id;
    const badge = p.risk === 'high' ? '<span class="va-risk is-high">High impact</span>' : '';
    c.innerHTML = `<div class="va-card-h">${p.mode === 'mock' ? 'Test mode — nothing will be saved' : 'Please confirm'} ${badge}</div>
      <p class="va-sum">${esc(p.summary)}</p>
      ${p.rows?.length ? `<dl class="va-rows">${p.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${p.warnings?.length ? `<ul class="va-warn">${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${p.reasons?.length ? `<details class="va-why"><summary>Why this match</summary><ul>${p.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
      <div class="va-acts"><button type="button" class="btn btn-primary btn-sm" data-va-confirm>Confirm</button><button type="button" class="btn btn-sm btn-ghost" data-va-cancel>Cancel</button>
        <span class="va-expiry">${p.risk === 'high' ? 'Type “confirm” or press Confirm · ' : 'Say “yes” or press Confirm · '}expires in ${mins(p.expires - Date.now())} min</span></div>`;
    t.after.appendChild(c);
    const lock = (msg) => { c.classList.add('is-settled'); c.querySelectorAll('button').forEach(b => { b.disabled = true; }); if (msg) c.querySelector('.va-expiry').textContent = msg; };
    c.querySelector('[data-va-confirm]').addEventListener('click', async () => { lock('Working…'); const r = await onConfirm(); lock(r?.ok ? 'Confirmed' : 'Not completed'); });
    c.querySelector('[data-va-cancel]').addEventListener('click', async () => { lock('Cancelled'); await onCancel(); });
    t.confirmEl = c; c.lock = lock;
    announce?.(`Confirmation needed. ${p.summary}`);          // announced, not focused: typing "yes" must still work
    scroll();
  }
  /** Retire every confirmation card except the one still waiting (if any). */
  function syncConfirms(currentId, msg = 'No longer waiting') {
    log.querySelectorAll('.va-confirm:not(.is-settled)').forEach(c => {
      if (currentId && c.dataset.pid === currentId) return;
      c.classList.add('is-settled'); c.querySelectorAll('button').forEach(b => { b.disabled = true; });
      const e = c.querySelector('.va-expiry'); if (e) e.textContent = msg;
    });
  }

  /* ----------------------------------------------------------- receipts & notes */
  function receipt(r) {
    if (r.code !== 'needs_explicit') syncConfirms(null, r.ok ? 'Confirmed' : 'Not completed');
    const tone = r.ok ? (r.mock ? 'test' : 'ok') : r.partial ? 'partial' : 'bad';
    const c = el(`v-msg her va-receipt is-${tone}`, `<div class="va-card-h">${r.ok ? (r.mock ? 'Test only' : 'Done') : r.partial ? 'Partly done' : r.code === 'needs_explicit' ? 'One more step' : 'Not done'}</div><p>${esc(r.text)}</p>${links(r.ok || r.partial ? r.links : [])}${!r.ok && r.retryable ? '<div class="va-links"><button type="button" class="va-chip" data-va-retry>Try again</button></div>' : r.partial ? '<div class="va-links"><button type="button" class="va-chip" data-va-retry>Retry the rest</button></div>' : ''}`);
    c.querySelector('[data-va-retry]')?.addEventListener('click', e => { e.target.disabled = true; onAsk('Try that again.'); });
    log.appendChild(c); announce?.(r.text); scroll();
    if (r.ok) onSpeak?.(r.mock ? 'Test mode. Nothing was saved.' : r.text);
  }
  const note = (text, cls = '') => { const c = el(`v-msg her va-note ${cls}`, `<p>${esc(text)}</p>`); log.appendChild(c); scroll(); return c; };

  /* --------------------------------------------------------------- home state */
  function home({ greeting, glance = [], prompts = [], testBanner = '' }) {
    const h = el('va-home');
    h.innerHTML = `<div class="va-greet"><span class="va-hi">${esc(greeting)}</span></div>
      ${testBanner ? `<div class="va-testbar" role="status">${esc(testBanner)}</div>` : ''}
      ${glance.length ? `<ul class="va-glance">${glance.map(g => `<li class="${g.tone ? 'is-' + g.tone : ''}">${g.link ? `<a href="${esc(g.link)}" data-va-link>${esc(g.text)}</a>` : esc(g.text)}</li>`).join('')}</ul>` : ''}
      <div class="va-prompts" role="group" aria-label="Suggested questions">${prompts.map(p => `<button type="button" class="va-prompt" data-va-ask="${esc(p)}">${esc(p)}</button>`).join('')}</div>`;
    log.appendChild(h); return h;
  }

  log.addEventListener('click', e => {
    const a = e.target.closest('[data-va-link]');
    if (a) { onLink?.(a.getAttribute('href')); return; }
    const q = e.target.closest('[data-va-ask]');
    if (q) { q.closest('.va-home')?.classList.add('is-used'); onAsk(q.dataset.vaAsk); }
  });

  return { beginTurn, onEvent, receipt, note, home, syncConfirms };
}
