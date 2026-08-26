/* ==================================================================
   Tour Guide Eval Tracker — front end
   Talks to a Google Apps Script web app that owns the Google Sheet.
================================================================== */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var LS_NAME = 'eval.name';
  var LS_CODE = 'eval.code';

  var state = {
    me: '',
    code: '',
    guides: [],
    committee: [],
    isAdmin: false,
    counts: {},
    neededTotal: 0,
    tab: 'open',
    search: '',
    priority: '',
    loading: false,
    lastSync: null
  };

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------------------------------------------------------------- api

  function api(action, payload) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_YOUR') === 0) {
      return Promise.reject(new Error('config.js still has the placeholder API_URL. Paste your Apps Script /exec URL into it.'));
    }
    var body = Object.assign({ action: action, code: state.code, evaluator: state.me }, payload || {});

    return fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain keeps this a "simple" request so the browser skips the
      // CORS preflight that Apps Script cannot answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status + '. Check that the web app is deployed to "Anyone".');
        return res.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('Got a non-JSON reply. Make sure the deployment access is set to "Anyone".');
        }
        if (!data.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
      });
  }

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function sameName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function isMine(g) { return sameName(g.evaluator, state.me); }

  // The server decides this from the code that was entered.
  function amAdmin() { return state.isAdmin === true; }

  function prettyDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function prettyTime(t) {
    if (!t) return '';
    var m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return t;
    var h = +m[1], min = m[2], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + min + ' ' + ap;
  }

  function whenText(g) {
    var d = prettyDate(g.date), t = prettyTime(g.time);
    if (d && t) return d + ' · ' + t;
    return d || t || '';
  }

  function tourLabel(t) {
    var d = prettyDate(t.date);
    return d + (t.slot ? ' · ' + t.slot : (t.start ? ' · ' + prettyTime(t.start) : ''));
  }

  var STATUS_LABEL = {
    open: 'Open', claimed: 'Claimed', submitted: 'Submitted',
    reviewed: 'Reviewed', skip: 'No eval'
  };

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok');
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 220);
    }, kind === 'err' ? 5200 : 3200);
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    // The modal body scrolls, so an error pinned at the bottom can land out of
    // sight and make the button look dead. Pull it into view.
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- gate

  function showGate(message) {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    $('#gate-code-field').hidden = CFG.REQUIRE_CODE === false;
    var err = $('#gate-error');
    if (message) { err.textContent = message; err.hidden = false; }
    else { err.hidden = true; }
    $('#gate-name').value = state.me || localStorage.getItem(LS_NAME) || '';
    setTimeout(function () { $('#gate-name').focus(); }, 50);
  }

  function hideGate() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
  }

  $('#gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#gate-name').value.trim();
    var code = $('#gate-code').value.trim();
    if (!name) return;

    state.me = name;
    state.code = code;

    var btn = $('#gate-submit');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    load()
      .then(function () {
        localStorage.setItem(LS_NAME, state.me);
        localStorage.setItem(LS_CODE, state.code);
        hideGate();
      })
      .catch(function (err) {
        showGate(err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Continue';
      });
  });

  $('#btn-signout').addEventListener('click', function () {
    localStorage.removeItem(LS_NAME);
    state.me = '';
    showGate();
  });

  $('#btn-who').addEventListener('click', function () { showGate(); });

  // ---------------------------------------------------------------- load

  function load() {
    state.loading = true;
    $('#btn-refresh').classList.add('is-busy');

    return api('list').then(function (data) {
      state.guides = data.guides || [];
      state.committee = data.committee || [];
      state.isAdmin = data.isAdmin === true;
      state.counts = data.counts || {};
      state.neededTotal = data.neededTotal || 0;
      state.lastSync = new Date();
      fillCommittee();
      fillPriorities();
      render();
      return data;
    }).finally(function () {
      state.loading = false;
      $('#loading').hidden = true;
      $('#btn-refresh').classList.remove('is-busy');
    });
  }

  function fillCommittee() {
    var dl = $('#committee-list');
    dl.innerHTML = state.committee.map(function (n) {
      return '<option value="' + esc(n) + '"></option>';
    }).join('');
  }

  function fillPriorities() {
    var sel = $('#filter-priority');
    var seen = [];
    state.guides.forEach(function (g) {
      if (g.priority && seen.indexOf(g.priority) === -1) seen.push(g.priority);
    });
    var current = sel.value;
    sel.innerHTML = '<option value="">All priorities</option>' + seen.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');
    if (seen.indexOf(current) !== -1) sel.value = current;
  }

  // ---------------------------------------------------------------- filtering

  function inTab(g) {
    switch (state.tab) {
      case 'open':    return g.status === 'open';
      case 'mine':    return isMine(g);
      case 'claimed': return g.status === 'claimed';
      case 'done':    return g.status === 'submitted' || g.status === 'reviewed';
      default:        return true;
    }
  }

  function visible() {
    var q = state.search.trim().toLowerCase();
    return state.guides.filter(function (g) {
      if (!inTab(g)) return false;
      if (state.priority && g.priority !== state.priority) return false;
      if (q) {
        var hay = (g.name + ' ' + g.priority + ' ' + g.evaluator).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- render

  function render() {
    renderChrome();   // sets tab visibility first, so the list respects it
    renderStats();
    renderList();
  }

  function renderChrome() {
    $('#term-label').textContent = CFG.TERM_LABEL || '';
    $('#who-name').textContent = state.me;
    $('#who-avatar').textContent = initials(state.me);
    $('#foot-sync').textContent = state.lastSync
      ? 'Synced ' + state.lastSync.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : '';
    var admin = amAdmin();
    $('#btn-rollover').hidden = !admin;

    // The Done tab lists completed evals, which only admins receive.
    var doneTab = $$('.tab').filter(function (t) { return t.dataset.tab === 'done'; })[0];
    if (doneTab) doneTab.hidden = !admin;
    if (!admin && state.tab === 'done') {
      state.tab = 'open';
      $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.tab === 'open'); });
    }

    // The Submitted tile still shows the total, but a non-admin can't drill into it.
    var doneStat = $$('.stat').filter(function (x) { return x.dataset.jump === 'done'; })[0];
    if (doneStat) {
      doneStat.style.cursor = admin ? 'pointer' : 'default';
      doneStat.title = admin ? '' : 'Only committee admins can see which evals are done';
    }
  }

  function renderStats() {
    // Non-admins don't receive other people's completed evals, so the totals come
    // from the server's whole-roster counts rather than from the cards on screen.
    var c = state.counts || {};
    var open = c.open || 0;
    var claimed = c.claimed || 0;
    var done = (c.submitted || 0) + (c.reviewed || 0);
    var neededCount = state.neededTotal || (open + claimed + done);
    var mine = state.guides.filter(isMine).length;

    $('#stat-open').textContent = open;
    $('#stat-mine').textContent = mine;
    $('#stat-claimed').textContent = claimed;
    $('#stat-done').textContent = done;

    var badge = $('#badge-mine');
    badge.textContent = mine;
    badge.hidden = mine === 0;

    var pct = Math.round((done / (neededCount || 1)) * 100);
    $('#progress-fill').style.width = pct + '%';
    $('#progress-label').textContent = done + ' of ' + neededCount + ' evals submitted';
    $('#progress-pct').textContent = pct + '%';

    // Gentle nudge when someone is holding a claim with no date set.
    var undated = state.guides.filter(function (g) {
      return isMine(g) && g.status === 'claimed' && !g.date;
    });
    var banner = $('#banner');
    if (undated.length) {
      banner.innerHTML = 'You have <strong>' + undated.length + '</strong> claimed eval' +
        (undated.length > 1 ? 's' : '') + ' with no tour date yet — add one so the committee knows it is scheduled.';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  function cardHTML(g) {
    var mine = isMine(g);
    var when = whenText(g);
    var admin = amAdmin();

    var meta = [];
    if (g.evaluator) {
      meta.push('<div class="meta-row"><span class="k">Evaluator</span><span class="v' +
        (mine ? ' you' : '') + '">' + esc(mine ? 'You' : g.evaluator) + '</span></div>');
    }
    if (when) {
      meta.push('<div class="meta-row"><span class="k">Tour</span><span class="v">' + esc(when) + '</span></div>');
    }
    if (g.notes) {
      meta.push('<div class="meta-row"><span class="k">Notes</span><span class="v">' + esc(g.notes) + '</span></div>');
    }
    if (g.status === 'reviewed') {
      meta.push('<div class="meta-row"><span class="k">Feedback</span><span class="v">Reviewed ✓</span></div>');
    }

    var actions = [];
    if (g.status === 'open') {
      actions.push(btn('claim', g.id, 'Claim', 'btn-primary'));
    } else if (g.status === 'claimed' && mine) {
      actions.push(btn('submit', g.id, 'Submit eval', 'btn-primary'));
      actions.push(btn('edit', g.id, 'Edit', 'btn-ghost'));
      actions.push(btn('unclaim', g.id, '✕', 'btn-quiet', 'Release this claim'));
    } else if (g.status === 'claimed' && admin) {
      actions.push(btn('unclaim', g.id, 'Release', 'btn-ghost'));
      actions.push(btn('submit', g.id, 'Submit eval', 'btn-ghost'));
    }
    if ((g.status === 'submitted' || g.status === 'reviewed') && admin) {
      actions.push(btn('review', g.id, g.status === 'reviewed' ? 'Undo reviewed' : 'Mark reviewed', 'btn-ghost'));
    }

    return '' +
      '<article class="card' + (mine ? ' is-mine' : '') + '" data-status="' + esc(g.status) + '">' +
        '<div class="card-top">' +
          '<div>' +
            '<div class="card-name">' + esc(g.name) + '</div>' +
            '<div class="card-prio">' + esc(g.priority || '—') + '</div>' +
          '</div>' +
          '<span class="pill">' + esc(STATUS_LABEL[g.status] || g.status) + '</span>' +
        '</div>' +
        (meta.length ? '<div class="card-meta">' + meta.join('') + '</div>' : '') +
        (actions.length ? '<div class="card-actions">' + actions.join('') + '</div>' : '') +
      '</article>';
  }

  function btn(act, id, label, cls, title) {
    return '<button class="btn ' + cls + '" data-act="' + act + '" data-id="' + esc(id) + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
  }

  var EMPTY_TEXT = {
    open:    'Every guide has been claimed. Nice.',
    mine:    'You have not claimed anyone yet — check the Available tab.',
    claimed: 'Nothing is currently claimed and waiting.',
    done:    'No evals have been submitted yet.',
    all:     'No guides match that search.'
  };

  function renderList() {
    var rows = visible();
    var list = $('#list');
    list.innerHTML = rows.map(cardHTML).join('');
    var empty = $('#empty');
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      $('#empty-text').textContent = state.search || state.priority
        ? 'No guides match those filters.'
        : (EMPTY_TEXT[state.tab] || 'Nothing here.');
    }
  }

  function guideById(id) {
    return state.guides.filter(function (g) { return g.id === id; })[0];
  }

  // ---------------------------------------------------------------- events

  $('#tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (!t) return;
    state.tab = t.dataset.tab;
    $$('.tab').forEach(function (x) { x.classList.toggle('is-active', x === t); });
    renderList();
  });

  $('#stats').addEventListener('click', function (e) {
    var s = e.target.closest('.stat');
    if (!s) return;
    var tab = s.dataset.jump;
    if (tab === 'done' && !amAdmin()) return;
    var target = $$('.tab').filter(function (x) { return x.dataset.tab === tab; })[0];
    if (target) target.click();
  });

  var searchTimer;
  $('#search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    var v = e.target.value;
    searchTimer = setTimeout(function () { state.search = v; renderList(); }, 130);
  });

  $('#filter-priority').addEventListener('change', function (e) {
    state.priority = e.target.value;
    renderList();
  });

  $('#btn-refresh').addEventListener('click', function () {
    if (state.loading) return;
    load().then(function () { toast('Up to date.'); })
          .catch(function (err) { toast(err.message, 'err'); });
  });

  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var g = guideById(b.dataset.id);
    if (!g) return;

    switch (b.dataset.act) {
      case 'claim':   return openClaim(g, false);
      case 'edit':    return openClaim(g, true);
      case 'submit':  return openEval(g);
      case 'unclaim': return doUnclaim(g, b);
      case 'review':  return doReview(g, b);
    }
  });

  function doUnclaim(g, b) {
    if (!confirm('Release ' + g.name + ' back to the open list?')) return;
    b.disabled = true;
    api('unclaim', { id: g.id })
      .then(function (r) { toast(r.message); return load(); })
      .catch(function (err) { toast(err.message, 'err'); b.disabled = false; });
  }

  function doReview(g, b) {
    b.disabled = true;
    api('markReviewed', { id: g.id, value: g.status !== 'reviewed' })
      .then(function (r) { toast(r.message); return load(); })
      .catch(function (err) { toast(err.message, 'err'); b.disabled = false; });
  }

  // ---------------------------------------------------------------- modals

  function openModal(root) {
    root.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(root) {
    root.hidden = true;
    document.body.style.overflow = '';
  }

  $$('.modal-root').forEach(function (root) {
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal(root);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('.modal-root').forEach(function (r) { if (!r.hidden) closeModal(r); });
  });

  // ---- claim / schedule

  var claimTarget = null;
  var toursExpanded = false;
  var TOUR_PREVIEW = 5;

  function renderTours() {
    var tours = (claimTarget && claimTarget.tours) || [];
    var wrap = $('#tourpick-wrap');
    var more = $('#tourpick-more');

    if (!tours.length) {
      wrap.hidden = true;
      more.hidden = true;
      $('#manual-wrap').classList.remove('is-collapsed');
      $('#claim-hint').textContent =
        'No scheduled tours found for them — enter the date yourself.';
      return;
    }

    wrap.hidden = false;
    var shown = toursExpanded ? tours : tours.slice(0, TOUR_PREVIEW);
    var picked = $('#claim-date').value;
    var pickedTime = $('#claim-time').value;

    $('#tourpick').innerHTML = shown.map(function (t, i) {
      var on = t.date === picked && (!pickedTime || t.start === pickedTime);
      return '<button type="button" class="tour-opt' + (on ? ' is-picked' : '') +
        '" data-i="' + i + '">' +
        '<span class="tour-when">' + esc(prettyDate(t.date)) + '</span>' +
        '<span class="tour-slot">' + esc(t.slot || prettyTime(t.start)) + '</span>' +
        '<span class="tour-check">✓</span></button>';
    }).join('');

    if (tours.length > TOUR_PREVIEW) {
      more.hidden = false;
      more.textContent = toursExpanded
        ? 'Show fewer'
        : 'Show all ' + tours.length + ' tours';
    } else {
      more.hidden = true;
    }

    $('#manual-wrap').classList.toggle('is-collapsed', !toursExpanded && !picked);
    $('#claim-hint').textContent = picked
      ? 'Tour selected. You can still adjust the date or time by hand.'
      : 'Pick one above, or ' + (tours.length ? 'scroll for more' : 'enter a date yourself') + '.';
  }

  $('#tourpick').addEventListener('click', function (e) {
    var b = e.target.closest('.tour-opt');
    if (!b || !claimTarget) return;
    var tours = toursExpanded ? claimTarget.tours : claimTarget.tours.slice(0, TOUR_PREVIEW);
    var t = tours[+b.dataset.i];
    if (!t) return;
    $('#claim-date').value = t.date;
    $('#claim-time').value = t.start || '';
    renderTours();
  });

  $('#tourpick-more').addEventListener('click', function () {
    toursExpanded = !toursExpanded;
    renderTours();
  });

  function openClaim(g, editing) {
    claimTarget = g;
    toursExpanded = false;
    $('#claim-title').textContent = editing ? 'Edit schedule' : 'Claim eval';
    $('#claim-sub').textContent = g.name + ' · ' + (g.priority || '');
    $('#claim-date').value = g.date || '';
    $('#claim-time').value = g.time || '';
    $('#claim-notes').value = g.notes || '';
    $('#claim-submit').textContent = editing ? 'Save' : 'Claim it';
    $('#claim-submit').dataset.mode = editing ? 'schedule' : 'claim';
    $('#claim-error').hidden = true;
    renderTours();
    openModal($('#modal-claim'));
  }

  $('#claim-date').addEventListener('change', renderTours);
  $('#claim-time').addEventListener('change', renderTours);

  $('#claim-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!claimTarget) return;
    var btn = $('#claim-submit');
    var mode = btn.dataset.mode === 'schedule' ? 'schedule' : 'claim';
    var err = $('#claim-error');

    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'Saving…';
    err.hidden = true;

    api(mode, {
      id: claimTarget.id,
      date: $('#claim-date').value,
      time: $('#claim-time').value,
      notes: $('#claim-notes').value
    })
      .then(function (r) {
        closeModal($('#modal-claim'));
        toast(r.message);
        return load();
      })
      .catch(function (e2) {
        showError(err, e2.message);
        load().catch(function () {});
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  });

  // ---- eval submission

  var evalTarget = null;

  function buildRatings() {
    var opts = CFG.RATING_OPTIONS || ['1', '2', '3', '4', '5'];
    $('#eval-rating').innerHTML = opts.map(function (o, i) {
      var id = 'rating-' + i;
      return '<input type="radio" name="rating" id="' + id + '" value="' + esc(o) + '">' +
             '<label for="' + id + '">' + esc(o) + '</label>';
    }).join('');
  }

  function openEval(g) {
    evalTarget = g;
    $('#eval-sub').textContent = g.name + ' · ' + (g.priority || '');
    $('#eval-date').value = g.date || '';
    $('#eval-time').value = g.time || '';
    $('#eval-well').value = '';
    $('#eval-improve').value = '';
    $('#eval-notes').value = '';
    $$('#eval-rating input').forEach(function (i) { i.checked = false; });
    $('#eval-error').hidden = true;
    openModal($('#modal-eval'));
    setTimeout(function () { $('#eval-well').focus(); }, 60);
  }

  $('#eval-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!evalTarget) return;
    var btn = $('#eval-submit');
    var err = $('#eval-error');
    var checked = $('#eval-rating input:checked');

    if (!$('#eval-well').value.trim() && !$('#eval-improve').value.trim()) {
      showError(err, 'Add at least a little feedback before submitting.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting…';
    err.hidden = true;

    api('submit', {
      id: evalTarget.id,
      date: $('#eval-date').value,
      time: $('#eval-time').value,
      rating: checked ? checked.value : '',
      wentWell: $('#eval-well').value,
      improve: $('#eval-improve').value,
      notes: $('#eval-notes').value
    })
      .then(function (r) {
        closeModal($('#modal-eval'));
        toast(r.priorityChanged
          ? r.message + ' Priority moved to ' + r.priorityChanged.split(' -> ')[1] + '.'
          : r.message);
        return load();
      })
      .catch(function (e2) {
        showError(err, e2.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Submit eval';
      });
  });

  // ---------------------------------------------------------------- rollover

  function resetRollover() {
    $('#rollover-preview').hidden = true;
    $('#rollover-preview').innerHTML = '';
    $('#rollover-error').hidden = true;
    var go = $('#rollover-submit');
    go.disabled = true;
    go.textContent = 'Preview first';
  }

  $('#btn-rollover').addEventListener('click', function () {
    resetRollover();
    $('#rollover-clear').checked = true;
    openModal($('#modal-rollover'));
  });

  // Changing the option invalidates the preview it was based on.
  $('#rollover-clear').addEventListener('change', resetRollover);

  function renderPreview(sum) {
    var moves = Object.keys(sum.moves || {}).sort();
    var html = '<h4>What will happen</h4>';

    if (moves.length) {
      html += moves.map(function (k) {
        return '<div class="preview-row"><span>' + esc(k) + '</span>' +
               '<span class="n">' + sum.moves[k] + '</span></div>';
      }).join('');
    } else {
      html += '<div class="preview-row"><span>No priority changes</span><span class="n">0</span></div>';
    }

    html += '<div class="preview-note">' +
      '<strong>' + sum.promoted + '</strong> moved up · ' +
      '<strong>' + sum.alreadyTop + '</strong> already at First Priority · ' +
      '<strong>' + sum.untouched + '</strong> left alone (no eval needed)' +
      (sum.clearProgress ? ' · <strong>' + sum.cleared + '</strong> records cleared' : '') +
      '</div>';

    var box = $('#rollover-preview');
    box.innerHTML = html;
    box.hidden = false;
    // The modal body scrolls; without this the result of pressing Preview lands
    // below the fold and looks like nothing happened.
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('#rollover-preview-btn').addEventListener('click', function () {
    var btn = this;
    var err = $('#rollover-error');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    err.hidden = true;

    api('rollover', { clearProgress: $('#rollover-clear').checked, dryRun: true })
      .then(function (r) {
        renderPreview(r.summary);
        var go = $('#rollover-submit');
        go.disabled = false;
        go.textContent = 'Run rollover';
      })
      .catch(function (e2) { showError(err, e2.message); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Preview';
      });
  });

  $('#rollover-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var clearProgress = $('#rollover-clear').checked;
    var warning = clearProgress
      ? 'This moves every guide up a tier AND clears this semester\'s evaluators, dates, and checkboxes.\n\nSubmitted feedback is kept. Continue?'
      : 'This moves every guide up one priority tier. Continue?';
    if (!confirm(warning)) return;

    var go = $('#rollover-submit');
    var err = $('#rollover-error');
    go.disabled = true;
    go.textContent = 'Running…';
    err.hidden = true;

    api('rollover', { clearProgress: clearProgress, dryRun: false })
      .then(function (r) {
        closeModal($('#modal-rollover'));
        toast(r.message);
        return load();
      })
      .catch(function (e2) {
        showError(err, e2.message);
        go.disabled = false;
        go.textContent = 'Run rollover';
      });
  });

  // ---------------------------------------------------------------- boot

  function boot() {
    buildRatings();
    $('#term-label').textContent = CFG.TERM_LABEL || '';

    var savedName = localStorage.getItem(LS_NAME);
    var savedCode = localStorage.getItem(LS_CODE) || '';

    if (!savedName) { $('#loading').hidden = true; return showGate(); }

    state.me = savedName;
    state.code = savedCode;
    hideGate();

    load()
      .catch(function (err) {
        $('#loading').hidden = true;
        showGate(err.message);
      });
  }

  boot();
})();
