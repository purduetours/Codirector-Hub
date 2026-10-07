/* ================================================================ Vanessa's engine
   For administrators: how Vanessa is running (Standard mode, or Enhanced with an
   optional local model), a one-click test, the local-model settings for THIS computer,
   how she is doing, what she can do and for whom, and the phrasings she missed.

   Standard Vanessa needs nothing: no AI model, no key, no account. Everything on
   this page about a local model is optional. Shows no secrets (there are none) and
   never what anyone asked.
============================================================================ */
import { state, setting } from '../core/state.js';
import { $, esc, toast, injectStyle } from '../core/ui.js';
import { admin, setupMissing, fail } from './admin-kit.js';
import { localAI, engineMetrics } from '../core/agent/index.js';
import { describeTools } from '../core/agent/registry.js';
import { can } from '../core/agent/capabilities.js';
import { createDeps } from '../core/agent/deps.js';
import { newConversation } from '../core/agent/state.js';
import { makeCtx, executeTool } from '../core/agent/runtime.js';
import { readConfig, writeConfig, checkEndpoint, PROVIDERS } from '../core/agent/local/config.js';
import { INTENTS } from '../core/agent/engine/intents.js';
import { missed, clearMissed, forget, snippet } from '../core/agent/engine/learn.js';

injectStyle('assistant-css', `
.as-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px; }
.as-stat { border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--bg-elev); padding:12px 14px; } .as-stat b { display:block; font-size:1.4rem; letter-spacing:-.03em; } .as-stat span { font-size:.78rem; color:var(--text-faint); }
.as-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); padding:16px 18px; margin-bottom:14px; display:grid; gap:10px; } .as-card h3 { font-size:1rem; margin:0; }
.as-row { display:flex; justify-content:space-between; gap:12px; padding:7px 0; border-bottom:1px solid var(--line); font-size:.88rem; } .as-row:last-child { border-bottom:0; } .as-row em { font-style:normal; color:var(--text-faint); }
.as-ok { color:var(--good); } .as-bad { color:var(--warn); }
.as-table { width:100%; border-collapse:collapse; font-size:.84rem; } .as-table th, .as-table td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); } .as-table th { color:var(--text-faint); font-weight:600; }
.as-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; } .as-fields label { display:grid; gap:4px; font-size:.84rem; }
.as-note { font-size:.84rem; color:var(--text-dim); margin:0; } .as-result { padding:10px 12px; border-radius:var(--radius-sm); border:1px solid var(--line); font-size:.9rem; }
.as-result.ok { border-color:var(--good); } .as-result.bad { border-color:var(--warn); } .as-pre { font:12px/1.5 ui-monospace,Menlo,monospace; background:rgba(255,255,255,.04); border-radius:8px; padding:10px; overflow:auto; white-space:pre-wrap; margin:0; }
`);

const TEST_CALLS = [['get_tours', { when: 'today' }], ['get_next_tour', {}], ['get_eval_status', {}], ['list_eval_roster', { filter: 'needs_eval', limit: 1 }], ['find_eval_opportunities', { when: 'this week', limit: 1 }],
  ['get_training_overview', {}], ['get_training_sessions', { limit: 1 }], ['get_training_gaps', { kind: 'needs_makeup', limit: 1 }], ['get_announcements', { limit: 1 }], ['get_action_center', { limit: 1 }],
  ['get_data_health', {}], ['get_unmatched_identities', { limit: 1 }], ['get_schedule_conflicts', { when: 'this week' }], ['get_coverage_gaps', {}], ['list_people', { filter: 'all_active', limit: 1 }], ['get_briefing', { kind: 'operations' }]];

const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const save = async (key, value) => { await admin('admin_set_setting', { p_key: key, p_value: value }); state.settings = { ...(state.settings || {}), [key]: value }; };
const STATE_WORDS = { available: 'Connected', off: 'Not set up (optional)', offline: 'Offline', model_missing: 'Model not installed', no_model: 'No model chosen', misconfigured: 'Address not allowed', unsupported: 'Not supported in this browser', unknown: 'Not checked yet' };

async function paint(view, hours) {
  const ai = localAI(), cfg = readConfig();
  if (cfg.enabled) await ai.check({ force: true }).catch(() => {});
  const st = ai.status(), mode = setting('vanessa.mode', 'auto') === 'standard' ? 'standard' : 'auto';
  let stats = null, missing = false;
  try { stats = await admin('admin_vanessa_stats', { p_hours: hours }); } catch (e) { if (setupMissing(e) || e.setup) missing = true; else throw e; }
  const m = engineMetrics(), phrases = missed();
  const roles = [['Member', { admin: false, training: false, recruitment: false }], ['Training / recruitment', { admin: false, training: true, recruitment: true }], ['Admin', { admin: true, training: true, recruitment: true }]];
  const tools = describeTools();
  const effective = mode === 'standard' ? 'Standard' : st.mode === 'enhanced' ? 'Enhanced (local AI)' : 'Standard';
  const localLine = !cfg.enabled ? '<span class="as-bad">Not set up</span> — optional' : st.ok ? '<span class="as-ok">Connected</span>' : `<span class="as-bad">Offline</span> — Vanessa is using standard mode`;
  const p = PROVIDERS[cfg.provider] || PROVIDERS.ollama;
  const modelsOpt = (st.models || []).map(x => `<option value="${esc(x)}"${x === cfg.model ? ' selected' : ''}>${esc(x)}</option>`).join('');

  view.innerHTML = `${missing ? `<div class="callout setup-note"><strong>One-time setup needed for the numbers below.</strong> Run supabase/21-vanessa-agent.sql (see DEVELOPERS.md). Vanessa works meanwhile; only her usage numbers are missing.</div>` : ''}
  <div class="as-card"><h3>Vanessa Engine</h3>
    <div class="as-row"><span>Mode</span><b>${mode === 'standard' ? 'Standard only' : 'Automatic'}</b></div>
    <div class="as-row"><span>Right now</span><b>${esc(effective)}</b></div>
    <div class="as-row"><span>Local AI (this computer)</span><b>${localLine}</b></div>
    <div class="as-row"><span>Fallback</span><b>Codirector Standard Mode</b></div>
    <div class="as-row"><span>Model</span><b>${cfg.enabled ? esc(cfg.provider === 'browser' ? 'in-browser model' : cfg.model || '— none chosen —') : '—'}</b></div>
    <p class="as-note">${mode === 'standard' ? 'An administrator has set Vanessa to Standard only for everyone.' : st.ok ? 'Standard Vanessa answers everyday requests instantly. When wording is unusual she asks the local model to interpret it, then answers from the Hub’s own data.' : 'Standard Vanessa already handles schedule, evaluations, training, people, coverage, briefs and data questions with no AI model. A local model is an optional extra that makes her more flexible with unusual wording.'} Nothing is ever sent to an outside AI service, and there is no AI account or key to pay for.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="test-engine">Test Vanessa Engine</button><button class="btn btn-sm" data-act="tools">Test the tools</button></div>
    <div id="as-result"></div><div id="as-selfcheck"></div></div>

  <div class="as-card"><h3>Local AI — optional, this computer only</h3>
    <p class="as-note">Needs a model running on this computer (or on your network). Setup takes a few minutes and is explained in <b>LOCAL_AI_SETUP.md</b>. These settings are saved in this browser and are not shared; each computer that should use Enhanced mode is set up once.</p>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="as-local-on" ${cfg.enabled ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)"> Use a local AI model on this computer</label>
    <div class="as-fields">
      <label>Runtime <select id="as-provider" class="select">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}"${k === cfg.provider ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <label ${cfg.provider === 'browser' ? 'hidden' : ''} id="as-ep-wrap">Address <input id="as-endpoint" class="select" value="${esc(cfg.endpoint)}" placeholder="${esc(p.endpoint)}" autocomplete="off" spellcheck="false"></label>
      <label ${cfg.provider === 'browser' ? 'hidden' : ''} id="as-model-wrap">Model ${modelsOpt ? `<select id="as-model" class="select"><option value="">— choose —</option>${modelsOpt}</select>` : `<input id="as-model" class="select" value="${esc(cfg.model)}" placeholder="llama3.2:3b" autocomplete="off" spellcheck="false">`}</label>
    </div>
    <p class="as-note" id="as-hint">${esc(p.hint)}</p>
    <p class="as-note" id="as-ep-err" style="color:var(--warn)" hidden></p>
    <div class="as-row"><span>Health</span><b>${cfg.enabled ? `<span class="${st.ok ? 'as-ok' : 'as-bad'}">${esc(STATE_WORDS[st.state] || st.state)}</span>` : '—'}</b></div>
    ${cfg.enabled && st.message && !st.ok ? `<p class="as-note">${esc(st.message)}</p>` : ''}
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="as-rephrase" ${cfg.rephrase ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)"> Let the local model reword her answers (adds a second model call; a reworded answer is thrown away if it changes any name, number or time)</label>
    ${cfg.provider === 'browser' ? '<div><button class="btn btn-sm" data-act="load-browser">Download and start the in-browser model</button> <span class="as-note" id="as-browser-note"></span></div>' : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="save-local">Save</button><button class="btn btn-sm" data-act="ping">Check connection</button></div></div>

  <div class="as-card"><h3>For everyone</h3>
    <label>Which engine should Vanessa use? <select id="as-mode" class="select"><option value="auto"${mode === 'auto' ? ' selected' : ''}>Automatic — Standard, plus a local model where one is set up</option><option value="standard"${mode === 'standard' ? ' selected' : ''}>Standard only — never use a local model</option></select></label>
    <label>Default test mode for administrators <select id="as-testmode" class="select"><option value="live">Off — real changes, always confirmed</option><option value="mock">Rehearse — confirmations work but nothing is saved</option><option value="read_only">Read-only — no changes can be prepared</option></select></label>
    <div><button class="btn btn-primary btn-sm" data-act="save-shared">Save</button></div></div>

  <div class="as-card"><h3>This session (this browser)</h3>
    <div class="as-grid"><div class="as-stat"><b>${m.turns}</b><span>requests</span></div><div class="as-stat"><b>${m.byEngine.standard}</b><span>answered by Standard</span></div><div class="as-stat"><b>${m.byEngine.enhanced}</b><span>helped by the local model</span></div>
      <div class="as-stat"><b>${m.notUnderstood}</b><span>not understood</span></div><div class="as-stat"><b>${m.providerFailures}</b><span>local model unavailable</span></div><div class="as-stat"><b>${m.latencyP50 != null ? m.latencyP50 + ' ms' : '—'}</b><span>typical response${m.latencyP95 != null ? ` (95% under ${m.latencyP95} ms)` : ''}</span></div></div></div>

  ${stats ? `<div class="as-card"><h3>Everyone, last ${hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'} <select id="as-hours" class="select" style="margin-left:8px">${[24, 168, 720].map(h => `<option value="${h}"${h === hours ? ' selected' : ''}>${h === 24 ? '24 hours' : h === 168 ? '7 days' : '30 days'}</option>`).join('')}</select></h3>
    <div class="as-grid"><div class="as-stat"><b>${stats.turns}</b><span>requests</span></div><div class="as-stat"><b>${stats.turns ? Math.round(100 * stats.ok / stats.turns) : 0}%</b><span>completed without error</span></div>
      <div class="as-stat"><b>${stats.by_engine?.standard || 0}</b><span>Standard</span></div><div class="as-stat"><b>${stats.by_engine?.enhanced || 0}</b><span>Enhanced (local model)</span></div><div class="as-stat"><b>${stats.not_understood || 0}</b><span>not understood</span></div>
      <div class="as-stat"><b>${stats.provider_failures || 0}</b><span>times the local model was unavailable</span></div>
      <div class="as-stat"><b>${stats.avg_latency_ms != null ? stats.avg_latency_ms + ' ms' : '—'}</b><span>average response (95% under ${stats.p95_latency_ms != null ? stats.p95_latency_ms + ' ms' : '—'})</span></div><div class="as-stat"><b>${stats.people}</b><span>people used her</span></div></div>
    ${stats.by_intent?.length ? `<div>${stats.by_intent.slice(0, 12).map(i => `<div class="as-row"><span>${esc(i.intent)}</span><em>${i.n} · ${i.ok === i.n ? 'all ok' : i.ok + ' ok'} · ${i.avg_ms != null ? i.avg_ms + ' ms' : ''} · confidence ${i.avg_confidence ?? '—'}</em></div>`).join('')}</div>` : '<p class="as-note">No requests recorded yet.</p>'}</div>
  <div class="as-card"><h3>Changes she was asked to make</h3>
    <div class="as-grid">${['executed', 'failed', 'cancelled', 'expired', 'pending'].map(k => `<div class="as-stat"><b>${stats.actions[k] || 0}</b><span>${k}</span></div>`).join('')}</div>
    ${stats.recent_actions.length ? stats.recent_actions.map(a => `<div class="as-row"><span>${esc(a.person || 'Someone')} · ${esc(String(a.kind).replace(/_/g, ' '))}${a.mode === 'mock' ? ' (test)' : ''}</span><em>${esc(a.status)} · ${esc(ago(a.at))}</em></div>`).join('') : '<p class="as-note">No changes proposed yet.</p>'}
    <p class="as-note">Confirmed changes also appear in Admin → Activity, labelled “Vanessa on behalf of …”.</p></div>
  <div class="as-card"><h3>Tools that are failing</h3>${stats.failing_tools.length ? stats.failing_tools.map(t => `<div class="as-row"><span>${esc(t.tool)}</span><em class="as-bad">${t.failures} failures</em></div>`).join('') : '<p class="as-note">None in this period.</p>'}
    ${stats.recent_failures.length ? `<h4 style="margin:6px 0 0;font-size:.85rem">Recent problems</h4>${stats.recent_failures.map(f => `<div class="as-row"><span>${esc(f.intent || f.error_code || 'tool error')} ${f.failed_tools?.length ? '· ' + esc(f.failed_tools.join(', ')) : ''}</span><em>${esc(ago(f.at))}${f.route ? ' · ' + esc(f.route) : ''}</em></div>`).join('')}` : ''}</div>` : ''}

  <div class="as-card"><h3>Phrasings she didn’t understand (this browser)</h3>
    <p class="as-note">When Standard Vanessa can’t tell what was asked, the sentence is kept here, on this computer only, with recognised names removed. A developer can teach her by adding it to <b>js/core/agent/engine/phrasebook.js</b> under the right intent; nothing changes by itself.</p>
    ${phrases.length ? `${phrases.slice(0, 15).map(x => `<div class="as-row"><span>${esc(x.text)}</span><em>asked ${x.n}× · ${esc(ago(new Date(x.at).toISOString()))} <button class="btn btn-sm btn-ghost" data-forget="${esc(x.text)}">remove</button></em></div>`).join('')}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm" data-act="copy-phrases">Copy for the developer</button><button class="btn btn-sm btn-ghost" data-act="clear-phrases">Clear the list</button></div>` : '<p class="as-note">Nothing missed so far.</p>'}</div>

  <div class="as-card"><h3>What she can do, and for whom</h3>
    <p class="as-note">Every ability is a typed function in the Hub: ${INTENTS.length} things she recognises and ${tools.length} tools behind them. There is no way for her to run SQL. “Changes” prepare a card and wait for confirmation. Access follows each person’s role, and the database re-checks every change.</p>
    <div style="overflow:auto"><table class="as-table"><thead><tr><th>Tool</th><th>Type</th><th>Needs</th>${roles.map(r => `<th>${r[0]}</th>`).join('')}</tr></thead><tbody>
      ${tools.map(t => `<tr><td><code>${esc(t.name)}</code></td><td>${t.kind === 'write' ? 'Change' : 'Read'}</td><td>${esc(t.label)}</td>${roles.map(r => `<td>${can(t.capability, { ...r[1], noPeopleEdits: false }) ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;

  $('#as-testmode', view).value = setting('vanessa.testMode', 'live');
}

export default {
  id: 'assistant', needs: 'admin', title: 'Vanessa', crumb: 'How Vanessa is running', icon: '✨', section: 'Tools', quiet: true,
  async mount(view) {
    let hours = 24;
    view.innerHTML = '<p class="muted">Checking Vanessa…</p>';
    try { await paint(view, hours); } catch (e) { view.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    const readLocal = () => ({ enabled: $('#as-local-on', view).checked, provider: $('#as-provider', view).value, endpoint: ($('#as-endpoint', view)?.value || '').trim(), model: ($('#as-model', view)?.value || '').trim(), rephrase: $('#as-rephrase', view).checked });
    view.addEventListener('input', e => {
      if (e.target.id === 'as-endpoint') { const c = checkEndpoint(e.target.value), err = $('#as-ep-err', view); err.hidden = c.ok; err.textContent = c.ok ? '' : c.reason; }
    });
    view.addEventListener('change', async e => {
      if (e.target.id === 'as-hours') { hours = Number(e.target.value); await paint(view, hours); }
      if (e.target.id === 'as-provider') { const pr = PROVIDERS[e.target.value]; $('#as-endpoint', view).value = pr.endpoint; $('#as-hint', view).textContent = pr.hint; const b = e.target.value === 'browser'; $('#as-ep-wrap', view).hidden = b; $('#as-model-wrap', view).hidden = b; }
    });
    view.addEventListener('click', async e => {
      const f = e.target.closest('[data-forget]'); if (f) { forget(f.dataset.forget); await paint(view, hours); return; }
      const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
      try {
        if (a === 'ping') { e.target.disabled = true; const l = readLocal(); if (l.provider !== 'browser') { const c = checkEndpoint(l.endpoint); if (!c.ok) { toast(c.reason, 'err'); e.target.disabled = false; return; } } writeConfig(l); await paint(view, hours); toast('Checked.'); }
        else if (a === 'save-local') {
          const l = readLocal();
          if (l.enabled && l.provider !== 'browser') { const c = checkEndpoint(l.endpoint); if (!c.ok) { toast(c.reason, 'err'); return; } }
          writeConfig(l); localAI().check({ force: true }).catch(() => {}); toast('Saved on this computer.'); await paint(view, hours);
        } else if (a === 'save-shared') {
          await save('vanessa.mode', $('#as-mode', view).value); await save('vanessa.testMode', $('#as-testmode', view).value);
          toast('Saved.'); await paint(view, hours);
        } else if (a === 'test-engine') {
          const out = $('#as-result', view); e.target.disabled = true; out.innerHTML = '<p class="as-note">Testing…</p>';
          const l = readLocal(); writeConfig(l);
          const r = await localAI().test();
          out.innerHTML = `<div class="as-result ${r.ok ? 'ok' : 'bad'}"><b>${esc(r.message)}</b>${r.latency ? ` <span class="as-note">(${r.latency} ms${r.model ? ' · ' + esc(r.model) : ''})</span>` : ''}${r.detail ? `<div class="as-note">${esc(r.detail)}</div>` : ''}</div>`;
          e.target.disabled = false;
        } else if (a === 'load-browser') {
          const note = $('#as-browser-note', view); note.textContent = 'Starting…';
          const m = await import('../core/vanessa-llm.js'); const ok = await m.loadLlm(); note.textContent = ok ? 'Ready.' : (m.llmStatus().message || 'Not available here.');
        } else if (a === 'tools') {
          const out = $('#as-selfcheck', view); out.innerHTML = '<p class="as-note">Testing each read tool against the live Hub…</p>';
          const deps = createDeps(), conv = newConversation('check'), ctx = makeCtx({ deps, conv });
          const rows = [];
          for (const [name, args] of TEST_CALLS) { const t0 = performance.now(); const r = await executeTool(name, args, ctx); rows.push([name, r.ok, Math.round(performance.now() - t0), r.ok ? '' : r.message]); }
          const good = rows.filter(r => r[1]).length;
          out.innerHTML = `<p><b class="${good === rows.length ? 'as-ok' : 'as-bad'}">${good} of ${rows.length} tools worked.</b> Nothing was changed; these only read.</p>${rows.map(r => `<div class="as-row"><span>${esc(r[0])}</span><em class="${r[1] ? 'as-ok' : 'as-bad'}">${r[1] ? `ok · ${r[2]} ms` : esc(r[3])}</em></div>`).join('')}`;
        } else if (a === 'copy-phrases') {
          const text = snippet(missed());
          try { await navigator.clipboard.writeText(text); toast('Copied. Paste under the right intent in phrasebook.js.'); } catch { const o = document.createElement('pre'); o.className = 'as-pre'; o.textContent = text; e.target.after(o); }
        } else if (a === 'clear-phrases') { clearMissed(); await paint(view, hours); }
      } catch (err) { fail(err); }
    });
  }
};
