/* ============================================================ quick actions
   The verbs of the hub: things you DO rather than places you go. They are
   offered by the "+" menu, the command palette and the Admin hub, so none of
   them needs a permanent spot in the navigation.

   Each action is permission-checked here as well as where it is listed, so a
   stale menu or a hand-typed call cannot run something the role lacks. The
   pages and database still make the real decision.
============================================================================ */
import { has } from './state.js';
import { go } from './router.js';
import { actionById } from './nav.js';
import { signOut } from './auth.js';
import { $ } from './ui.js';

const here = id => location.hash.replace(/^#\/?/, '').split('?')[0] === id;

/** Run `fn(el)` once the page has finished mounting and `sel` exists. */
function whenReady(sel, fn, ms = 5000) {
  const view = $('#view');
  const ready = () => view.classList.contains('is-entering') && $(sel, view);
  if (ready()) return fn($(sel, view));
  const mo = new MutationObserver(() => { const el = ready(); if (el) { mo.disconnect(); clearTimeout(t); fn(el); } });
  const t = setTimeout(() => mo.disconnect(), ms);
  mo.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

/** Open a page, then do something on it. */
function goThen(id, sel, fn) {
  if (!here(id)) go(id);
  whenReady(sel, fn);
}

const ask = q => document.dispatchEvent(new CustomEvent('hub:ask', { detail: { question: q } }));

export function runAction(id) {
  const a = actionById(id);
  if (!a || !has(a.needs)) return false;
  switch (id) {
    case 'announce':   goThen('announcements', '#ann-new', el => el.click()); break;
    case 'add-person': goThen('people', '#pp-name', el => el.focus()); break;
    case 'start-eval': ask('I need to do an evaluation'); break;
    case 'attendance': go('training'); break;
    case 'makeups':    ask('Draft makeup reminders for everyone'); break;
    case 'rollover':   go('semester'); break;
    case 'add-guide':  goThen('guides', '#gd-add', el => el.click()); break;
    case 'import-roster': goThen('guides', '#gd-import', el => el.click()); break;
    case 'brief':      ask('Brief me'); break;
    case 'theme':      document.dispatchEvent(new CustomEvent('hub:toggle-theme')); break;
    case 'refresh':    document.dispatchEvent(new CustomEvent('hub:refresh')); break;
    case 'signout':    signOut(); break;
    default: return false;
  }
  return true;
}
