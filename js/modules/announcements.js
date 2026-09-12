/* ============================================================ Announcements
   Notices codirectors post for the committee. Everyone reads; admins write.
   Backed by an `Announcements` tab that setup() creates.
============================================================================ */
import { select, insert, remove } from '../core/db.js';
import { state, isAdmin } from '../core/state.js';
import { paintNav } from '../core/router.js';
import {
  $, esc, prettyDate, toast, showError, injectStyle,
  openModal, closeModal, wireModal
} from '../core/ui.js';

injectStyle('ann-css', `
.ann { border-left:3px solid var(--accent); }
.ann + .ann { margin-top:11px; }
.ann-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:6px; }
.ann-title { font-size:.98rem; font-weight:650; }
.ann-meta { font-size:.75rem; color:var(--text-faint); margin-top:2px; }
.ann-body { font-size:.88rem; color:var(--text-soft); white-space:pre-wrap; }
.ann.pinned { border-left-color:var(--warn); background:var(--warn-bg); }
.ann.pinned .ann-body { color:var(--warn); }
`);

let items = null;      // null = never loaded; [] = loaded and empty

function card(a) {
  return `<article class="card ann ${a.pinned ? 'pinned' : ''}">
    <div class="ann-head">
      <div>
        <div class="ann-title">${a.pinned ? '📌 ' : ''}${esc(a.title)}</div>
        <div class="ann-meta">${esc(a.author || 'Committee')} · ${esc(prettyDate(a.date) || a.date || '')}</div>
      </div>
      ${isAdmin() ? `<button class="icon-btn" data-del="${esc(a.id)}" title="Delete">✕</button>` : ''}
    </div>
    <div class="ann-body">${esc(a.body)}</div>
  </article>`;
}

/* -------------------------------------------------------------- unread
   An announcement nobody notices is the same as one nobody posted.

   The badge used to count PINNED notices, which never changes and so stops
   meaning anything within a day. It now counts what THIS person has not yet
   seen: the newest announcement they have looked at is remembered on their
   device, and anything newer than that is unread. Opening the tab marks them
   read, which is the moment they actually appear on screen.

   Kept on the device rather than in the database on purpose — a per-person
   read receipt for every notice is a table, a policy and a write on every page
   view, to solve a problem a timestamp in localStorage solves.
-------------------------------------------------------------------------- */
const SEEN_KEY = () => `hub2.ann.seen.${state.me?.id || 'anon'}`;

const lastSeen = () => { try { return localStorage.getItem(SEEN_KEY()) || ''; } catch { return ''; } };

/** Announcements posted since this person last opened the tab. */
export const unreadCount = () =>
  (items || []).filter(a => (a.at || '') > lastSeen()).length;

function markAllRead() {
  const newest = (items || []).reduce((max, a) => (a.at || '') > max ? a.at : max, '');
  if (!newest) return;
  try { localStorage.setItem(SEEN_KEY(), newest); } catch { /* private window */ }
  paintNav();
}

async function prime() {
  const rows = await select('announcements',
    'select=id,title,body,pinned,created_at,author:members(full_name)&order=pinned.desc,created_at.desc');
  items = (rows || []).map(r => ({
    id: r.id, title: r.title, body: r.body, pinned: r.pinned,
    date: (r.created_at || '').slice(0, 10),
    at:   r.created_at || '',        // full stamp: two on one day must not tie
    author: r.author?.full_name || 'Committee'
  }));
}

async function load() {
  await prime();
  paint();
}

function paint() {
  $('#ann-list').innerHTML = (items || []).length
    ? items.map(card).join('')
    : `<div class="empty"><div class="empty-mark">📣</div><p>Nothing posted yet.</p></div>`;
}

export default {
  id: 'announcements',
  // Everyone signed in can read these — that is the point of posting them. Writing
  // is admin-only, enforced by the New/Delete buttons below and again on the server.
  title: 'Announcements',
  crumb: 'Notices for the committee',
  icon: '📣',
  section: 'Hub',
  badge: () => unreadCount() || null,
  prefetch: prime,
  bust: () => { items = null; },

  async mount(view) {
    // Seen means on screen, so this happens on mount rather than on load.
    setTimeout(markAllRead, 400);
    view.innerHTML = `
      ${isAdmin() ? `<div style="margin-bottom:16px"><button class="btn btn-primary" id="ann-new">＋ New announcement</button></div>` : ''}
      <div id="ann-list"></div>

      <div class="modal-root" id="ann-modal" hidden>
        <div class="modal-scrim" data-close></div>
        <form class="modal" id="ann-form">
          <header class="modal-head">
            <div><h2>New announcement</h2><p class="muted">The whole committee sees this when they sign in.</p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
          </header>
          <div class="modal-body">
            <label class="field"><span>Title</span><input id="ann-title" maxlength="120" required></label>
            <label class="field"><span>Message</span><textarea id="ann-body" rows="5" required></textarea></label>
            <label class="checkline" style="border:1px solid var(--line-strong);border-radius:var(--radius-sm);padding:12px 14px;display:flex;gap:10px;align-items:flex-start;cursor:pointer">
              <input type="checkbox" id="ann-pin" style="width:17px;height:17px;margin-top:2px;accent-color:var(--accent)">
              <span><strong style="display:block;font-size:.875rem">Pin this</strong>
              <em style="display:block;font-style:normal;font-size:.8rem;color:var(--text-soft);margin-top:3px">Pinned notices sit at the top and are highlighted.</em></span>
            </label>
            <p class="form-error" id="ann-error" hidden></p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="ann-post">Post</button>
          </footer>
        </form>
      </div>`;

    if (items === null) await prime();
    paint();

    if (!isAdmin()) return;
    wireModal($('#ann-modal'));

    $('#ann-new').addEventListener('click', () => {
      $('#ann-title').value = '';
      $('#ann-body').value = '';
      $('#ann-pin').checked = false;
      $('#ann-error').hidden = true;
      openModal($('#ann-modal'));
      setTimeout(() => $('#ann-title').focus(), 60);
    });

    $('#ann-form').addEventListener('submit', async e => {
      e.preventDefault();
      const go = $('#ann-post'), err = $('#ann-error');
      go.disabled = true; go.textContent = 'Posting…'; err.hidden = true;
      try {
        await insert('announcements', {
          title:  $('#ann-title').value,
          body:   $('#ann-body').value,
          pinned: $('#ann-pin').checked,
          author_id: state.me.id
        });
        closeModal($('#ann-modal'));
        toast('Announcement posted.');
        await load();
      } catch (e2) { showError(err, e2.message); }
      finally { go.disabled = false; go.textContent = 'Post'; }
    });

    $('#ann-list').addEventListener('click', async e => {
      const b = e.target.closest('[data-del]');
      if (!b || !confirm('Delete this announcement?')) return;
      b.disabled = true;
      try { await remove('announcements', `id=eq.${b.dataset.del}`); toast('Deleted.'); await load(); }
      catch (e2) { toast(e2.message, 'err'); b.disabled = false; }
    });
  }
};
