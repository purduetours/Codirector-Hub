/* ============================================================ Training: resources
   Three small libraries that make training repeatable:

     Materials   friendly resource cards (a doc, slides, a video…) attached to a
                 session or a requirement — never a bare URL
     Speakers    anyone who teaches, with or without an account. Contact details
                 are for administrators only; guides see just a name on a session
     Templates   a training you run every semester, so "Create session from
                 template" replaces rebuilding it

   Everything here is a screen over the admin_* functions in
   supabase/20-training-management.sql, which check the caller and the links.
============================================================================ */
import { $, esc, toast, injectStyle, prettyDate } from '../core/ui.js';
import { confirmDialog, formDialog } from '../core/dialog.js';
import { admin, emptyState, fail } from './admin-kit.js';
import { loadSpeakers, loadTemplates, TYPES, whenText } from './train-data.js';
import { ICONS } from '../core/icons.js';

injectStyle('train-res-css', `
.mat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
.mat-card { display:flex; gap:12px; padding:14px; border:1px solid var(--line); border-radius:var(--radius); background:var(--bg-elev); text-decoration:none; color:var(--text); transition:border-color var(--dur-2); }
.mat-card:hover { border-color:color-mix(in srgb, var(--pink) 45%, var(--line)); }
.mat-ico { width:38px; height:38px; border-radius:12px; flex:none; display:grid; place-items:center; background:var(--pink-wash); color:var(--pink-soft); font-size:1.1rem; }
.mat-body { min-width:0; display:grid; gap:2px; } .mat-body b { font-size:var(--fs-md); } .mat-body em { font-style:normal; font-size:var(--fs-xs); color:var(--text-soft); } .mat-body span { font-size:var(--fs-2xs); color:var(--text-faint); text-transform:uppercase; letter-spacing:.06em; }
.res-sec { margin:0 0 26px; } .res-sec h3 { font-size:var(--fs-md); margin-bottom:10px; display:flex; gap:10px; align-items:center; justify-content:space-between; }
`);

const KINDS = { doc: ['📄', 'Document'], slides: ['🖼️', 'Slides'], pdf: ['📕', 'PDF'], video: ['🎬', 'Video'], webpage: ['🌐', 'Web page'], internal: ['🔒', 'Internal'], other: ['📎', 'Resource'] };
export const kindIcon = k => (KINDS[k] || KINDS.other)[0];
export const kindLabel = k => (KINDS[k] || KINDS.other)[1];

/** A resource as a friendly card. The address shows as the site name, not a raw URL. */
export function materialCard(m) {
  let host = ''; try { host = new URL(m.url).hostname.replace(/^www\./, ''); } catch { /* shown without */ }
  return `<a class="mat-card" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><span class="mat-ico" aria-hidden="true">${kindIcon(m.kind)}</span>
    <span class="mat-body"><span>${esc(kindLabel(m.kind))}${host ? ' · ' + esc(host) : ''}</span><b>${esc(m.title)}</b>${m.description ? `<em>${esc(m.description)}</em>` : ''}</span></a>`;
}

const audienceFields = a => `
  <fieldset class="field"><span>Who it applies to</span>
    ${[['all', 'All Tour Guides'], ['new', 'New guides'], ['leadership', 'Leadership'], ['evaluators', 'Evaluators']].map(([k, l]) => `<label class="toggle-row"><input type="checkbox" name="aud_${k}" ${a?.[k] ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>`;

export async function mountResources(host, ctx) {
  const d = ctx.data;
  let speakers = [], templates = [];
  const load = async () => { [speakers, templates] = await Promise.all([loadSpeakers().catch(() => []), loadTemplates().catch(() => [])]); };
  await load();

  const paint = () => {
    const reqMats = d.requirements.map(r => ({ r, m: d.materials.filter(x => x.requirement_id === r.id) }));
    const sesMats = d.sessions.map(s => ({ s, m: d.materials.filter(x => x.session_id === s.id) })).filter(x => x.m.length);
    host.innerHTML = `
    <section class="res-sec"><h3>Materials <button class="btn btn-ghost btn-sm" data-add-mat>Add a resource</button></h3>
      ${reqMats.some(x => x.m.length) || sesMats.length ? `${reqMats.filter(x => x.m.length).map(({ r, m }) => `<p class="muted" style="font-size:.82rem;margin:8px 0 6px">${esc(r.name)} <span class="src-badge">requirement</span></p><div class="mat-grid">${m.map(materialCard).join('')}</div>`).join('')}
        ${sesMats.map(({ s, m }) => `<p class="muted" style="font-size:.82rem;margin:12px 0 6px">${esc(s.label)} <span class="src-badge">session</span></p><div class="mat-grid">${m.map(materialCard).join('')}</div>`).join('')}`
        : emptyState({ title: 'No materials yet', icon: 'directory', text: 'Attach the slides, handbook or video a session or requirement needs, and people will find them where they look.' })}</section>
    <section class="res-sec"><h3>Speakers <button class="btn btn-ghost btn-sm" data-add-spk>Add a speaker</button></h3>
      ${speakers.length ? `<div class="dt-wrap"><table class="dt"><thead><tr><th>Name</th><th>Contact</th><th>Upcoming sessions</th><th></th></tr></thead><tbody>${speakers.map(sp => {
        const up = d.speakers.filter(x => x.speaker_id === sp.id).map(x => d.sessions.find(s => s.id === x.session_id)).filter(s => s && s.status === 'scheduled');
        return `<tr><td><b>${esc(sp.name)}</b>${sp.affiliation ? `<span class="dt-sub">${esc(sp.affiliation)}</span>` : ''}${sp.active ? '' : '<span class="chip is-mute">Inactive</span>'}</td>
          <td>${sp.email ? `<a href="mailto:${esc(sp.email)}">${esc(sp.email)}</a>` : ''}${sp.phone ? `<span class="dt-sub">${esc(sp.phone)}</span>` : ''}${!sp.email && !sp.phone ? '—' : ''}</td>
          <td>${up.length ? up.map(s => esc(s.label) + ' · ' + esc(prettyDate(s.held_on))).join('<br>') : '<span class="muted">none</span>'}</td><td><button class="btn btn-quiet btn-sm" data-edit-spk="${esc(sp.id)}">Edit</button></td></tr>`; }).join('')}</tbody></table></div>`
        : emptyState({ title: 'No speakers yet', icon: 'users', text: 'Add the people who teach. They do not need an account.' })}</section>
    <section class="res-sec"><h3>Templates <button class="btn btn-ghost btn-sm" data-add-tpl>New template</button></h3>
      ${templates.length ? `<div class="dt-wrap"><table class="dt"><thead><tr><th>Template</th><th>Details</th><th>Audience</th><th></th></tr></thead><tbody>${templates.map(t => `<tr><td><b>${esc(t.name)}</b>${t.active ? '' : '<span class="chip is-mute">Archived</span>'}<span class="dt-sub">${esc(t.training_type)}${t.duration_minutes ? ' · ' + t.duration_minutes + ' min' : ''}</span></td>
          <td>${esc(t.default_location || '—')}${(t.materials || []).length ? `<span class="dt-sub">${t.materials.length} resource${t.materials.length === 1 ? '' : 's'}</span>` : ''}</td><td>${esc(Object.keys(t.audience || {}).filter(k => t.audience[k] === true).join(', ') || 'chosen later')}</td>
          <td><button class="btn btn-quiet btn-sm" data-edit-tpl="${esc(t.id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState({ title: 'No templates yet', icon: 'training', text: 'If you run the same training every semester, save it once as a template and create each semester’s session in one step.' })}</section>`;
  };
  paint();

  host.addEventListener('click', async e => {
    try {
      if (e.target.closest('[data-add-mat]')) {
        const v = await formDialog({ title: 'Add a resource', submitLabel: 'Add', fields: [
          { name: 'on', label: 'Attach to', options: [...d.requirements.map(r => `Requirement: ${r.name}`), ...d.sessions.map(s => `Session: ${s.label}`)], value: d.requirements[0] ? `Requirement: ${d.requirements[0].name}` : d.sessions[0] ? `Session: ${d.sessions[0].label}` : '' },
          { name: 'title', label: 'Title', required: true }, { name: 'kind', label: 'Type', options: Object.keys(KINDS), value: 'doc' }, { name: 'url', label: 'Link (https://…)', required: true }, { name: 'description', label: 'Short description' }] });
        if (!v) return;
        const req = d.requirements.find(r => `Requirement: ${r.name}` === v.on), ses = d.sessions.find(s => `Session: ${s.label}` === v.on);
        await admin('admin_save_material', { p_id: null, p_title: v.title, p_kind: v.kind, p_url: v.url, p_description: v.description, p_session: ses?.id || null, p_requirement: req?.id || null });
        await ctx.reload(); paint(); toast('Resource added.'); return;
      }
      const sp = e.target.closest('[data-add-spk],[data-edit-spk]');
      if (sp) {
        const cur = speakers.find(x => x.id === sp.dataset.editSpk);
        const v = await formDialog({ title: cur ? `Edit ${cur.name}` : 'Add a speaker', submitLabel: 'Save', intro: 'They do not need an account. Contact details are visible to administrators only.', fields: [
          { name: 'name', label: 'Name', value: cur?.name, required: true }, { name: 'email', label: 'Email', type: 'email', value: cur?.email || '' }, { name: 'phone', label: 'Phone', value: cur?.phone || '' }, { name: 'affiliation', label: 'Department or organisation', value: cur?.affiliation || '' }, { name: 'notes', label: 'Notes', value: cur?.notes || '' }] });
        if (!v) return;
        await admin('admin_save_speaker', { p_id: cur?.id || null, p_name: v.name, p_email: v.email, p_phone: v.phone, p_affiliation: v.affiliation, p_notes: v.notes });
        await load(); await ctx.reload(); paint(); toast('Saved.'); return;
      }
      const tp = e.target.closest('[data-add-tpl],[data-edit-tpl]');
      if (tp) { await templateEditor(templates.find(x => x.id === tp.dataset.editTpl)); await load(); paint(); }
    } catch (x) { fail(x); }
  });

  async function templateEditor(cur) {
    const v = await formDialog({ title: cur ? `Edit “${cur.name}”` : 'New template', submitLabel: 'Save template', intro: 'A training you run every semester. Materials: one per line as  Title | https://link', fields: [
      { name: 'name', label: 'Name', value: cur?.name, required: true }, { name: 'description', label: 'Description', value: cur?.description || '' },
      { name: 'training_type', label: 'Type', options: TYPES, value: cur?.training_type || 'General' }, { name: 'duration', label: 'Length (minutes)', type: 'number', value: cur?.duration_minutes || '' },
      { name: 'location', label: 'Usual location', value: cur?.default_location || '' }, { name: 'speaker_role', label: 'Who usually teaches it', value: cur?.speaker_role || '' },
      { name: 'rule', label: 'Completion rule', options: ['any', 'all'], value: cur?.completion_rule || 'any', hint: 'any = attending one session completes it; all = every session' },
      { name: 'audience', label: 'Audience', options: ['All Tour Guides', 'New guides', 'Leadership', 'Evaluators', 'Chosen later'], value: cur ? (cur.audience.all ? 'All Tour Guides' : cur.audience.new ? 'New guides' : cur.audience.leadership ? 'Leadership' : cur.audience.evaluators ? 'Evaluators' : 'Chosen later') : 'All Tour Guides' },
      { name: 'materials', label: 'Materials', multiline: true, value: (cur?.materials || []).map(m => `${m.title} | ${m.url}`).join('\n') }] });
    if (!v) return;
    const mats = String(v.materials || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [title, url] = l.split('|').map(x => x.trim()); return { title, url, kind: 'webpage' }; });
    const aud = { 'All Tour Guides': { all: true }, 'New guides': { new: true }, Leadership: { leadership: true }, Evaluators: { evaluators: true }, 'Chosen later': {} }[v.audience];
    await admin('admin_save_training_template', { p_id: cur?.id || null, p_f: { name: v.name, description: v.description, training_type: v.training_type, duration_minutes: v.duration || null, default_location: v.location, speaker_role: v.speaker_role, completion_rule: v.rule, audience: aud, materials: mats } });
    toast('Template saved.');
  }
}
