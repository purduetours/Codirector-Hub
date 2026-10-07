/* ============================================================ the hybrid router
   One message in, one answer out, with the same safety whichever way it was understood.

       message
         ├─ the answer to a question she asked ("the first one")      → continue that request
         ├─ clearly one of the things she knows (confidence ≥ 0.75)   → run it, no model involved
         ├─ a continuation ("what about Thursday?", "set it up")      → run it from the saved state
         ├─ unclear, and a local model is available                   → ask it for a structured request,
         │                                                               validate it, run it
         └─ unclear, and no model                                     → best guess, or one short question,
                                                                         or hand to her older built-in answers

   Every route ends in the same place: a validated Query, the capability router's permission
   check, typed tools, and (for changes) the confirmation card. The local model can never skip
   a step, and if it is unavailable or slow the route simply isn't taken. There is no paid
   fallback of any kind.
*/
import { makeCtx } from '../runtime.js';
import { can, CAPABILITIES } from '../capabilities.js';
import { handlerFor, allowedIntents } from '../capabilities/index.js';
import { byId } from './intents.js';
import { understand, buildQuery } from './compose.js';
import { HIGH, MEDIUM, understoodShare } from './match.js';
import { dialogOf, record, followUp, resolveAwaiting, fresh } from './dialog.js';
import { makeTurn, StopTurn } from './turn.js';
import { validateQuery } from './query.js';
import { chooseFrom } from './extract.js';
import { promise, or, join } from './respond.js';
import { friendly } from '../errors.js';
import { noteMissed } from './learn.js';
import { recordTurn } from './metrics.js';
import { suggestionsFor } from '../page.js';
import { splitCompound } from './split.js';

const PROPOSAL_MS = 15 * 60e3;
const SWITCHED = new Set(['people.write', 'roles.write']);

export const denial = (h, who) => (SWITCHED.has(h.permission) && who.noPeopleEdits
  ? 'An administrator has turned off changes to people by me (Admin → Settings). You can still do that from the Tour Guides page.'
  : `That needs access to “${CAPABILITIES[h.permission]?.label || h.permission}”, which your role doesn’t include. If you think you should have it, ask a Co-Director.`);

/* ------------------------------------------------------------- failures */
function failureOut(r, q, t) {
  const x = r.extra || {};
  if (r.error === 'ambiguous' && x.candidates?.length) {
    const opts = x.candidates.map(c => ({ label: c.name + (c.major ? ` (${c.major})` : ''), value: c.id }));
    return { text: `Which one do you mean — ${or(opts.map(o => o.label))}?`, ask: { question: '', options: opts, slot: 'person' } };
  }
  if (r.error === 'confirm_name' && x.candidates?.length) return { text: `Did you mean ${x.candidates[0].name}? Say “yes” to use them, or give me the full name.`, ask: { question: '', options: [{ label: x.candidates[0].name, value: x.candidates[0].id }], slot: 'person' } };
  if (r.error === 'not_permitted') return { text: denial(handlerFor(q.intent) || { permission: '' }, t.who) };
  if (r.error === 'test_mode') return { text: r.message };
  if (r.error === 'unknown_tool' || r.error === 'invalid_input') return { text: 'I couldn’t put that request together. Try rephrasing it, or give me a name or a day.' };
  if (['schedule_unavailable', 'roster_unavailable'].includes(r.error)) return { text: `${r.message} Everything else still works.` };
  return { text: String(r.message || friendly(r)).replace(/\s*(?:Tell them|Ask (?:the user|which)|Do not).*$/i, '').trim() || friendly(r) };
}

/** What she says when a write has been prepared and is waiting on a yes. */
function pendingOut(t) {
  const p = t.pending;
  const warn = (p.warnings || []).find(w => w && !/isn.t tracked/.test(w));
  const how = p.risk === 'high' ? 'This one is high-impact, so press Confirm or type “confirm”.' : 'Press Confirm, or just say “yes”.';
  return { text: join(p.mode === 'mock' ? 'Test mode — nothing will really be saved.' : '', promise(p.summary), warn ? `Heads up: ${warn}` : '', how), cards: 'drop' };
}

/* ------------------------------------------------------------ people */
/** Settle who the request is about before any capability runs. May throw a question. */
async function bindPeople(q, ent, t, h) {
  const f = q.filters;
  if (h.people === 'none') { delete f.people; return; }
  let people = (f.people || []).slice();
  const conv = t.ctx.conv, focus = conv.agent.focus?.person, last = conv.agent.lists?.last;
  if (!people.length && ent.reference) {
    const plural = /\b(?:them|those|these|they|their)\b/.test(ent.norm);
    if (plural && last?.kind === 'people' && last.items.length > 1 && h.people === 'many') people = last.items.slice(0, 12).map(i => ({ id: i.id, label: i.name, status: 'one', fuzzy: false, candidates: [] }));
    else if (focus) people = [{ id: focus.id, label: focus.name, status: 'one', fuzzy: false, candidates: [] }];
  }
  if (!people.length && h.people === 'required') {
    if (ent.mine) people = [{ id: 'me', label: 'You', status: 'one', fuzzy: false, memberId: t.who.id, candidates: [] }];
    else if (focus && !ent.people.length) people = [{ id: focus.id, label: focus.name, status: 'one', fuzzy: false, candidates: [] }];
    else throw t.ask('Who do you mean? Give me a name.', [], 'person');
  }
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (String(p.id || '').startsWith('ev:') && !h.ownsPeople) throw t.stop(`${p.label} is on the evaluation team but isn’t on the Tour Guide list, so I can’t look them up here.`);
    if (p.status === 'many' && !h.ownsPeople) {
      if (!p.candidates?.length) throw t.stop(`I couldn’t find anyone called “${p.label}” in the Tour Guide list.`);
      throw t.ask(`Which ${p.label} do you mean — ${or(p.candidates.map(c => c.label + (c.sub ? ` (${c.sub})` : '')))}?`, p.candidates.map(c => ({ label: c.label + (c.sub ? ` (${c.sub})` : ''), value: c.id })), 'person', i);
    }
    if (h.mode === 'write' && p.fuzzy && p.status === 'one') throw t.ask(`Did you mean ${p.label}? Say “yes” to use them, or give me the full name.`, [{ label: p.label, value: p.id }], 'person', i);
  }
  f.people = people;
}

/* ------------------------------------------------------------ the engine */
export function createEngine({ deps, local = null, isAdmin = () => false, mode = () => 'auto' }) {
  const localStatus = () => (local ? local.status() : { configured: false, state: 'off' });

  /** Run one Query. Returns an output the caller emits; never throws. */
  async function execute(q, ent, ctx, info) {
    const h = handlerFor(q.intent);
    const t = makeTurn({ ctx, q, dialog: dialogOf(ctx.conv), engine: { mode: info.engine, local: localStatus() } });
    let out;
    try {
      if (!h) throw t.stop('I don’t know how to do that yet.');
      if (!can(h.permission, ctx.who)) throw t.stop(denial(h, ctx.who));
      await bindPeople(q, ent || { norm: '', people: [], reference: false, mine: false }, t, h);
      const res = await h.run(q, t);
      if (res?.ask) throw t.ask(res.ask, [], 'text');
      out = t.pending ? pendingOut(t) : h.respond(res, q, t) || { text: '' };
      if (q.note && out.text) out.text = join(out.text, q.note);
    } catch (e) {
      if (e instanceof StopTurn) out = e.failure ? failureOut(e.failure, q, t) : { text: e.text, ask: e.ask };
      else { out = { text: friendly(e) }; info.ok = false; info.error = 'unexpected'; }
      out.cards = 'drop';
    }
    info.tools.push(...t.used); info.failed.push(...t.failed);
    if (t.failed.length && !t.pending && !out.ask) info.ok = false;
    return { out, t, q };
  }

  function emitOut({ out, t, q }, emit) {
    const cards = out.cards === 'drop' ? [] : Array.isArray(out.cards) ? out.cards.map(c => ({ card: c })) : t.cards;
    for (const c of cards) emit({ type: 'card', card: c.card, links: c.links, tool: c.tool });
    if (t.pending) emit({ type: 'pending', pending: t.pending });
    if (t.navigate) emit({ type: 'navigate', route: t.navigate });
    if (out.text) { out.text = out.text.replace(/(\w)\.\.(?=\s|$)/g, '$1.'); emit({ type: 'delta', text: out.text }); }
    const s = out.ask?.options?.length ? out.ask.options.map(o => o.label) : (out.suggest || []);
    if (s.length && !t.pending) emit({ type: 'suggest', items: s });
  }

  /** Remember the request, or the question she's now waiting on. */
  function remember({ out, t, q }, ent) {
    const conv = t.ctx.conv, d = dialogOf(conv);
    if (out.ask) {
      d.awaiting = { ...out.ask, question: out.text, query: { intent: q.intent, filters: q.filters, text: q.text, tags: q.tags, tokens: q.tokens, confidence: q.confidence, source: q.source }, at: Date.now() };
      d.at = Date.now(); return;
    }
    const ps = conv.agent.proposals;
    const resultSet = q.intent === 'evaluation.opportunities' && ps?.matches?.length ? { kind: 'matches', items: ps.matches.map(m => ({ id: m.mid, name: m.guideName })) }
      : t.list ? { kind: t.list.kind, items: t.list.items.map(i => ({ id: i.id, name: i.name || i.title })) } : undefined;
    record(conv, { query: q, resultSet, selected: out.dialog?.selected });
  }

  async function runLocal(text, ent, env, ctx, dialog, info) {
    info.localCalls++;
    const allowed = allowedIntents(ctx.who);
    let r;
    try { r = await local.interpret({ text, ctx, ent, env, dialog, allowed }); }
    catch (e) { r = { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'error' }; }
    if (!r.ok) { info.providerFailed = true; local.noteFailure?.(r.reason); return null; }
    return r;
  }

  /** The whole decision for one message. */
  async function handle(text, { conv, emit = () => {}, testMode = 'live', page = null } = {}) {
    const t0 = Date.now(), raw = String(text || '').slice(0, 2000);
    const ctx = makeCtx({ deps, conv, testMode }), dialog = dialogOf(conv);
    const info = { engine: 'standard', intent: null, confidence: null, source: null, localCalls: 0, providerFailed: false, tools: [], failed: [], ok: true, clarified: false, notUnderstood: false, latency: 0, route: page?.route };
    conv.at = Date.now(); conv.turns++;
    const done = (res = {}) => { info.latency = Date.now() - t0; recordTurn(info); const r = { handled: true, ok: info.ok, info, ...res }; emit({ type: 'done', text: r.text || '', ok: info.ok, tools: info.tools, failed: info.failed, latency: info.latency }); return r; };
    const say = (text, suggest) => { emit({ type: 'delta', text }); if (suggest?.length) emit({ type: 'suggest', items: suggest }); return done({ text }); };

    const proposals = !!(conv.agent.proposals && Date.now() - conv.agent.proposals.at < PROPOSAL_MS && conv.agent.proposals.matches?.length);
    const aw = dialog.awaiting && Date.now() - dialog.awaiting.at < 20 * 60e3 ? dialog.awaiting : null;
    let u;
    try { u = await understand(ctx, raw, { dialog: fresh(dialog) ? dialog : null, proposals, awaiting: !!aw }); }
    catch (e) { info.ok = false; info.error = 'understand'; return say(friendly(e)); }
    const { ent, decision } = u, top = decision.top;
    const strong = top && top.score >= HIGH;

    const run = async (q, via) => {
      info.intent = q.intent; info.confidence = q.confidence; info.source = q.source; if (via) info.via = via;
      const x = await execute(q, ent, ctx, info);
      if (local && x.out.text && !x.t.pending && !x.out.ask && x.out.text.length < 500 && local.status().rephrase) {
        const r = await local.rephrase(x.out.text).catch(() => null);
        if (r) { x.out.text = r; info.engine = 'enhanced'; info.localCalls++; }
      }
      emitOut(x, emit);
      if (x.out.ask) info.clarified = true;
      remember(x, ent);
      return done({ text: x.out.text, pending: !!x.t.pending, asked: !!x.out.ask, navigate: x.t.navigate || undefined });
    };

    /* 1. the answer to a question she asked */
    if (aw) {
      if (aw.slot === 'intent') {
        const pick = chooseFrom(raw, aw.options.map(o => ({ ...o, name: o.label })));
        dialog.awaiting = null;
        if (pick) return run(buildQuery(pick.value, aw.ent, { confidence: 0.9, source: 'followup' }), 'clarified');
      } else {
        const ans = resolveAwaiting({ text: raw, ent, norm: ent.norm, awaiting: aw });
        if (ans?.cancelled && !strong) { dialog.awaiting = null; return say('Okay — never mind. What would you like instead?'); }
        if (ans?.query && !(strong && !ans.query)) { dialog.awaiting = null; return run({ ...ans.query, confidence: 0.92 }, 'answered'); }
        if (!strong) { /* not an answer, not a request: carry on below with the awaiting question dropped */ }
        dialog.awaiting = null;
      }
    }

    /* 1b. two requests in one sentence, each clearly one of the things she knows */
    const halves = !aw ? splitCompound(raw) : null;
    if (halves) {
      const ps = [];
      for (const part of halves) ps.push(await understand(ctx, part, { dialog: fresh(dialog) ? dialog : null, proposals, env: u.env }));
      const tops = ps.map(p => p.decision.top);
      if (tops.every(t => t && t.score >= HIGH) && tops[0].id !== tops[1].id && handlerFor(tops[0].id).mode === 'read') {
        if (!ps[1].ent.when && ps[0].ent.when && tops[1].id.startsWith('schedule.')) ps[1].ent.when = ps[0].ent.when;
        const outs = [];
        for (let i = 0; i < 2; i++) {
          const q = buildQuery(tops[i].id, ps[i].ent, { confidence: tops[i].score, source: 'standard', via: tops[i].via });
          info.intent = info.intent || q.intent; info.confidence = info.confidence ?? q.confidence;
          const x = await execute(q, ps[i].ent, ctx, info);
          emitOut(x, emit); outs.push(x.out); remember(x, ps[i].ent);
        }
        return done({ text: outs.map(o => o.text).filter(Boolean).join('\n\n'), parts: 2 });
      }
    }

    /* 2. clearly one of the things she knows */
    if (strong && decision.margin >= 0 && top) return run(buildQuery(top.id, ent, { confidence: top.score, source: 'standard', via: top.via }), top.via);

    /* 3. a continuation of the last request */
    const short = ent.tokens.length <= 5 || /^(?:and|ok|okay|so|now|what about|how about|what if|same|just|only|also|then|for|on|in|at|the)\b/.test(ent.norm);
    const fu = short && ent.tokens.length <= 9 && understoodShare(ent) >= 0.6 ? followUp({ ent, norm: ent.norm, dialog }) : null;   // a rambling sentence isn't "what about Thursday?"
    if (fu) {
      if (fu.kind === 'why') {
        const ps = conv.agent.proposals, sel = dialog.selected;
        const m = ps?.matches?.find(x => x.mid === sel?.mid) || ps?.matches?.[0];
        return say(m ? `Here’s why ${m.guideName}: ${m.reasons.filter(r => !/not tracked/.test(r)).slice(0, 4).join('; ')}.` : 'I don’t have a reason to give for that one.');
      }
      if (fu.kind === 'out_of_range') return say(`There ${fu.count === 1 ? 'is only one' : `are only ${fu.count}`} on that list.`);
      if (fu.selected) dialog.selected = fu.selected;
      return run({ ...fu.query, confidence: 0.85, tags: fu.query.tags || [] }, `follow-up (${fu.kind})`);
    }

    /* 4. unclear: a local model may interpret it */
    const useLocal = local && mode() !== 'standard' && (!top || top.score < HIGH) && await local.ready().catch(() => false);
    if (useLocal) {
      const r = await runLocal(raw, ent, u.env, ctx, dialog, info);
      if (r) {
        if (r.clarify && !r.queries?.length) { info.engine = 'enhanced'; info.clarified = true; emit({ type: 'delta', text: r.clarify }); return done({ text: r.clarify, asked: true }); }
        const outs = [];
        const list = (r.queries || []).slice(0, 3);
        for (let i = 0; i < list.length; i++) {
          const flags = { reference: !!list[i].reference, mine: !!list[i].mine };
          const v = validateQuery(list[i], { who: ctx.who, today: ctx.today });
          if (!v.ok) { outs.push({ text: v.error === 'not_permitted' ? denial(handlerFor(list[i].intent), ctx.who) : v.message }); info.intent = list[i].intent; continue; }
          if (handlerFor(v.query.intent).mode === 'write' && i < list.length - 1) { outs.push({ text: 'I’ll do the change last, one thing at a time. Ask me for it again after this.' }); continue; }
          info.intent = v.query.intent; info.confidence = v.query.confidence; info.source = 'local';
          info.engine = 'enhanced';
          const x = await execute(v.query, { ...ent, reference: ent.reference || flags.reference, mine: ent.mine || flags.mine }, ctx, info);
          emitOut(x, emit); outs.push(x.out); remember(x, ent);
        }
        if (outs.length) return done({ text: outs.map(o => o.text).filter(Boolean).join('\n\n') });
        info.engine = 'standard';
      }
    }

    /* 5. best standard guess, one short question, or hand it on */
    if (top && top.score >= MEDIUM) {
      const second = decision.second;
      if (!second || decision.margin >= 0.1 || second.score < MEDIUM) return run(buildQuery(top.id, ent, { confidence: top.score, source: 'standard', via: top.via }), top.via);
      const options = [top, second, u.ranked[2]].filter(x => x && x.score >= MEDIUM).map(x => ({ label: byId.get(x.id).label, value: x.id }));
      const question = `I want to get this right — did you mean: ${or(options.map(o => o.label.toLowerCase()))}?`;
      dialog.awaiting = { question, options, slot: 'intent', ent, query: { intent: top.id, filters: {} }, at: Date.now() };
      info.clarified = true; info.intent = top.id; info.confidence = top.score;
      return say(question, options.map(o => o.label));
    }

    info.notUnderstood = true;
    if (isAdmin()) noteMissed(raw, ent);
    return done({ handled: false, reason: 'not_understood', suggestions: suggestionsFor(page?.route || 'today', ctx.who) });
  }

  return { handle, status: localStatus };
}
