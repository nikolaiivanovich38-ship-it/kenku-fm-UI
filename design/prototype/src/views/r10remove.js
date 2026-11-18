/* Round 10 fixes (R10-FIX.md §1 and §2): taking things out, and deleting in line, with Undo.

   Nik, 18 Nov 13:00: "There's still no way to remove tracks, or to delete playlists in line".
   The Track library's Remove from library and Delete file from disk… are in library.js; a playlist deleted from its
   row is in playlists.js. This file:
     - Remove from this playlist in the ⋯ of a manual playlist's track wherever the playlist is shown unfolded
       (the Playlists page, a scene, the session and campaign lists: _shared.js draws the button);
     - Undo for taking a track or playlist out of a scene, a session or a campaign (the ⋯ items were there; they had
       no Undo);
     - the Delete key on a focused row (a control in the row has focus): it does what the row's ⋯ does to take the
       row out, or asks first where the row's ⋯ asks (a playlist, a pad board, a library track). "Remove from this
       playlist / scene / session / campaign" keeps the track or playlist itself; only Delete … asks. */
(function () {
  var esc = L.esc, D = L.data;
  function title(id) { var t = L.track(id); return t ? L.title(t) : ''; }

  /* ---------- a manual playlist's track, wherever the playlist is shown unfolded ---------- */
  L.acts.r10xpmore = function (el) {
    var p = L.playlist(el.dataset.pid), id = el.dataset.tid; if (!p || !L.track(id)) return;
    L.menu(el, '<button role="menuitem" data-act="r10xprm" data-pid="' + esc(p.id) + '" data-tid="' + esc(id) + '">' + L.icon('close', 's') + 'Remove from this playlist</button>' +
      '<div class="sep"></div><button role="menuitem" data-act="r10xplib" data-tid="' + esc(id) + '">' + L.icon('library', 's') + 'Open in Track library</button>', 'More for ' + title(id));
  };
  L.acts.r10xplib = function (el) { L.route('#/library/' + el.dataset.tid); };
  L.acts.r10xprm = function (el) {
    var p = L.playlist(el.dataset.pid), id = el.dataset.tid, i = p ? p.items.indexOf(id) : -1; if (i < 0) return;
    var text = 'Removed “' + title(id) + '” from the playlist "' + p.name + '". It is still in the Track library.';
    L.undoNote(text, L.snapshot(['playlists']));
    p.items.splice(i, 1);
    L.render(); L.say(text + ' To undo this, press Undo, at the bottom of the screen, or Ctrl+Z.'); L.saved(p.name, { detail: 'removed ' + title(id), key: 'pl-' + p.id });
    var next = p.items[i] || p.items[i - 1], row = next && document.querySelector('[data-act="r10xpmore"][data-pid="' + p.id + '"][data-tid="' + next + '"]');
    if (row) row.focus(); else { var h = document.querySelector('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }
  };

  /* ---------- Undo for taking things out of a scene, a session or a campaign ---------- */
  function withUndo(act, text) {
    var f0 = L.acts[act]; if (!f0) return;
    L.acts[act] = function (el) {
      var words = text(el); if (!words) return f0.apply(this, arguments);
      var restore = L.snapshot(['campaigns']), r = f0.apply(this, arguments);
      L.undoNote(words, restore); L.render();
      return r;
    };
  }
  function scene(id) { var out = null; D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc) { if (sc.id === id) out = sc; }); }); }); return out; }
  function itemName(id) { var p = L.playlist(id) || L.board(id); return p ? p.name : title(id); }
  withUndo('cpitem', function (el) {
    if (el.dataset.op !== 'remove') return '';
    var sc = scene(el.dataset.sc), arr = sc && (el.dataset.list === 'boards' ? L.sceneBoards(sc) : sc[el.dataset.list]), id = arr && arr[+el.dataset.idx];
    return id ? 'Removed “' + itemName(id) + '” from this scene.' : '';
  });
  withUndo('cpclearamb', function (el) { var sc = scene(el.dataset.sc); return sc && sc.amb ? 'Removed “' + itemName(sc.amb) + '” from this scene.' : ''; });
  withUndo('cprm', function (el) {
    var where = el.dataset.scope === 'c' ? 'campaign' : 'session', kind = el.dataset.kind;
    return 'Removed “' + itemName(el.dataset.id) + '” from this ' + where + '. ' + (kind === 'tr' ? 'It is still in the Track library.' : kind === 'pl' ? 'It is still on the Playlists page.' : 'It is still in Pad boards.');
  });

  /* ---------- the Delete key on a focused row ---------- */
  // Each kind of row is known by the ⋯ (or ×) it has; Delete does what that row's taking-out item does.
  function as(b, extra) { var d = Object.assign({}, b.dataset, extra || {}); return { dataset: d, getAttribute: function () { return null; } }; }
  var RULES = [
    ['[data-act="pltmore"][data-manual]', function (b) { L.acts.plrm(b); }],
    ['[data-act="r10xpmore"]', function (b) { L.acts.r10xprm(b); }],
    ['[data-act="plrowmore"]', function (b) { L.acts.r10pldelask(b); }],
    ['[data-act="cprowmenu"][data-menu="item"]', function (b) { L.acts.cpitem(as(b, { op: 'remove' })); }],
    ['[data-act="cprowmenu"][data-menu="amb"]', function (b) { L.acts.cpclearamb(b); }],
    ['[data-act="cprowmenu"][data-menu="assigned"]', function (b) { L.acts.cprm(b); }],
    ['[data-act="pbcardmenu"]', function (b) { L.acts.pbdelboard(b); }],
    ['[data-act="lvupx"]', function (b) { b.click(); }],
    ['[data-act="r10lvmore"]', function (b) { L.acts.r10lvplrm(b); }],
    ['[data-act="lbrowmenu"]', function (b) { L.acts.r10rmask(as(b, { how: 'remove', ids: b.dataset.tid })); }]
  ];
  // The row's own control: not one in a list folded open inside the row.
  function own(row, sel) { var all = row.querySelectorAll(sel); for (var i = 0; i < all.length; i++) if (all[i].closest('li, tr') === row) return all[i]; return null; }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Delete' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    var a = document.activeElement; if (!a || L.typing(a) || document.getElementById('lyre-sheet') || document.querySelector('.menu')) return;
    for (var row = a.closest && a.closest('li, tr'); row; row = row.parentElement && row.parentElement.closest('li, tr')) {
      for (var i = 0; i < RULES.length; i++) {
        var b = own(row, RULES[i][0]);
        if (b && !b.disabled) { e.preventDefault(); RULES[i][1](b); return; }
      }
    }
  });
})();
