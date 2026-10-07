/* ============================================================ confirmation dialog
   One place for "are you sure?", so every destructive or far-reaching admin
   action says what will happen, in the same way, with the same escape hatch.
   Replaces window.confirm for the admin screens: it can explain several lines,
   mark an action as dangerous, and demand a typed word for the big ones.
============================================================================ */
import { esc, openModal, closeModal } from './ui.js';

/**
 * @param {object} o
 *   title         short question: "Archive 3 people?"
 *   lines         array of plain sentences explaining the effect
 *   confirmLabel  the button, named after the action ("Archive")
 *   danger        style the button as dangerous
 *   typeToConfirm a word the person must type for something large ("START")
 * @returns Promise<boolean>
 */
export function confirmDialog({ title, lines = [], confirmLabel = 'Confirm', danger = false, typeToConfirm = '' }) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.hidden = true;
    root.innerHTML = `<div class="modal-scrim" data-close></div>
      <form class="modal" autocomplete="off">
        <header class="modal-head"><div><h2>${esc(title)}</h2></div></header>
        <div class="modal-body">
          ${lines.map(l => `<p class="dlg-line">${esc(l)}</p>`).join('')}
          ${typeToConfirm ? `<label class="field"><span>Type <b>${esc(typeToConfirm)}</b> to continue</span><input id="dlg-type" autocapitalize="characters"></label>` : ''}
        </div>
        <footer class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="dlg-ok"${typeToConfirm ? ' disabled' : ''}>${esc(confirmLabel)}</button>
        </footer>
      </form>`;
    document.body.append(root);

    let answer = false;
    const done = () => {
      closeModal(root);
      setTimeout(() => root.remove(), 260);
      resolve(answer);
    };
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) done(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
    root.querySelector('form').addEventListener('submit', e => { e.preventDefault(); answer = true; done(); });
    const typed = root.querySelector('#dlg-type');
    typed?.addEventListener('input', () => {
      root.querySelector('#dlg-ok').disabled = typed.value.trim().toUpperCase() !== typeToConfirm.toUpperCase();
    });
    openModal(root);
  });
}

/**
 * A small form in a dialog. Fields: { name, label, type?, value?, options?, required?, hint? }.
 * Resolves to an object of values, or null if cancelled.
 */
export function formDialog({ title, intro = '', fields, submitLabel = 'Save' }) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.hidden = true;
    const control = f => f.multiline
      ? `<textarea name="${esc(f.name)}" rows="${f.rows || 4}" ${f.required ? 'required' : ''}>${esc(f.value ?? '')}</textarea>`
      : f.options
      ? `<select class="select" name="${esc(f.name)}">${f.options.map(o => `<option${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} autocomplete="off">`;
    root.innerHTML = `<div class="modal-scrim" data-close></div>
      <form class="modal" autocomplete="off">
        <header class="modal-head"><div><h2>${esc(title)}</h2>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}</div></header>
        <div class="modal-body">${fields.map(f => `<label class="field"><span>${esc(f.label)}</span>${control(f)}${f.hint ? `<em>${esc(f.hint)}</em>` : ''}</label>`).join('')}</div>
        <footer class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button></footer>
      </form>`;
    document.body.append(root);
    let out = null;
    const done = () => { closeModal(root); setTimeout(() => root.remove(), 260); resolve(out); };
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) done(); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(); });
    root.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      out = Object.fromEntries(new FormData(e.target));
      done();
    });
    openModal(root);
  });
}
