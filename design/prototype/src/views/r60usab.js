/* 0.6.0 usability test (/root/kenku-wt/R60-USABILITY.md): the prototype brought up with the fixes the app got in the
   same branch (x60-usab), so the prototype stays what ships or ahead of it (Nik, 20 Nov). Styles in r60usab.css.
   Loaded last (build.js), so it wraps what the earlier files define.

     F-C2  What played lies over the room's lines (On air keeps its height), focus goes into it, Esc closes it
     F-C3  Connection lost lies over the room's Effects line, so Music and Ambience stay where they were
     F-C5  after Try again, focus goes to the room's name
     F-C10 Add music starts with nothing ticked; Done adds what was ticked; a playlist made from it takes the ticked
           tracks, and when one of them was the scene's own, the playlist takes its place
     F-P7  Esc ends arranging, as Done does
     F-P11 a side panel that closes another says so (r10fix.js calls L.panelGaveWay)
     F-P13 F6 goes round the top bar, Live's boxes, the open side panels and the menu
     and the prototype-only differences: Fade all's Undo shows at once, and focus goes back to the opener when a
     docked Add music closes with Esc. */
(function () {
  var D = L.data;
  function onLive() { return L.current().name === 'live'; }
  function byK(k) { return k ? document.querySelector('[data-k="' + k + '"]') : null; }

  /* ---------- F-C2, F-C3: over the room's lines, not above them ---------- */
  function placeOverLines() {
    var a = document.activeElement;
    document.querySelectorAll('#view .lv-rm').forEach(function (rm) {
      var lines = rm.querySelector(':scope > .lv-rm-b'); if (!lines) return;
      var played = rm.querySelector(':scope > .lv-played');
      if (played) { played.classList.add('r60-over'); lines.appendChild(played); }
      var lost = rm.querySelector(':scope > .r10-lost-line'), lanes = lines.querySelector('.lv-rm-lanes');
      if (lost && lanes) { lost.classList.add('r60-lostover'); lanes.appendChild(lost); }
    });
    if (a && a !== document.activeElement && document.contains(a)) a.focus({ preventScroll: true });
  }
  var played0 = L.acts.lvplayed;
  L.acts.lvplayed = function (el) {
    var room = el.closest('.lv-rm'), tg = room && room.dataset.room;
    played0(el);
    // Open: focus goes to its first Play again (a popover), so Tab and Esc work in it at once.
    var box = tg && document.querySelector('#view .lv-rm[data-room="' + tg + '"] .lv-played');
    var first = box && box.querySelector('button');
    if (first) first.focus();
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.shiftKey || !onLive() || document.querySelector('.menu')) return;
    var a = document.activeElement, room = a && a.closest && a.closest('#view .lv-rm'), btn = room && room.querySelector('.lv-rm-played.on');
    if (!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    L.acts.lvplayed(btn);
  }, true);

  /* ---------- F-C5: focus after Try again ---------- */
  var retry0 = L.acts.r10retry;
  if (retry0) L.acts.r10retry = function (el) { var id = el.dataset.id; retry0(el); var n = byK('lv-room-' + id); if (n) n.focus(); };

  /* ---------- Fade all: Undo at once ---------- */
  var fade0 = L.liveFadeAll;
  if (fade0) L.liveFadeAll = function () { fade0.apply(L, arguments); L.render(); };

  /* ---------- F-P7: Esc while arranging ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.shiftKey || !L.arranging || !L.arranging() || document.querySelector('.menu') || document.getElementById('lyre-sheet')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    L.acts.r9arrange();
  }, true);

  /* ---------- F-P13: F6 round the whole window in Live ---------- */
  // The stops, in order: the top bar, each box (as Alt+1 to 7 go), each side panel that is open, the menu.
  function stops() {
    var out = [], top = document.querySelector('#view .lv-top');
    var first = function (root) { return root && [].slice.call(root.querySelectorAll('button, a[href], input, select, [tabindex="0"]')).filter(function (x) { return !x.disabled && x.offsetParent; })[0]; };
    var t = first(top); if (t) out.push({ root: top, el: t });
    ((L.f6Order && L.f6Order()) || []).filter(function (b) { return b.offsetParent; }).forEach(function (b) { out.push({ root: b.closest('.pane') || b, el: b }); });
    ['r10-find', 'r9-queue', 'r9-tp', 'lyre-help'].forEach(function (id) {
      var p = document.getElementById(id); if (!p || p.hidden || !p.offsetParent) return;
      var f = first(p); if (f) out.push({ root: p, el: f });
    });
    var rail = document.getElementById('rail'), cur = rail && (rail.querySelector('[aria-current="page"]') || first(rail));
    if (cur) out.push({ root: rail, el: cur });
    return out;
  }
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'F6' || e.ctrlKey || e.altKey || !onLive() || document.querySelector('.menu') || document.getElementById('lyre-sheet') || (L.f6Taken && L.f6Taken())) return;
    var all = stops(); if (!all.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var a = document.activeElement, at = -1;
    all.forEach(function (s, i) { if (a && s.root.contains(a)) at = i; });
    var next = all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length];
    next.el.focus(); next.el.scrollIntoView({ block: 'nearest' });
    L.say((next.el.getAttribute('aria-label') || next.el.textContent || '').trim());
  }, true);

  /* ---------- F-P11: one panel gave way to another ---------- */
  var PANEL_WORDS = { help: ['Help', 'Help'], track: ['The track details', 'the track details'], queue: ['The queue', 'the queue'], find: ['Find', 'Find'], music: ['Add music', 'Add music'] };
  L.panelGaveWay = function (closed, kept) {
    var c = PANEL_WORDS[closed], k = PANEL_WORDS[kept]; if (!c || !k) return;
    L.toast(c[0] + ' closed to make room for ' + k[1] + '.');
  };

  /* ---------- focus back to the opener when a sheet or docked panel closes ---------- */
  var openerK = '';
  var sheet0 = L.sheet;
  L.sheet = function () { var a = document.activeElement; openerK = a && a.dataset ? a.dataset.k || '' : ''; return sheet0.apply(L, arguments); };
  var close0 = L.closeSheet;
  L.closeSheet = function () {
    var had = !!document.getElementById('lyre-sheet'), k = openerK;
    close0.apply(L, arguments);
    if (!had) return;
    openerK = '';
    var a = document.activeElement;
    if ((!a || a === document.body) && byK(k)) byK(k).focus();
  };

  /* ---------- F-C10: Add music adds ---------- */
  var music0 = L.pickSceneMusic, sheetPick = L.pickerSheet;
  L.pickSceneMusic = function (o) {
    var had = (o.selected || []).slice(), before = D.playlists.map(function (p) { return p.id; });
    // The scene's own items say so in their second line; nothing is ticked at the start.
    L.pickerSheet = function (p) {
      L.pickerSheet = sheetPick;
      p.items.forEach(function (it) { if (had.indexOf(it.id) > -1) it.sub = (it.sub ? it.sub + ' · ' : '') + 'in this scene'; });
      return sheetPick.call(L, p);
    };
    try {
      return music0.call(L, Object.assign({}, o, {
        selected: [],
        intro: 'Tick playlists, single tracks or both. They are added at the end of the scene’s music, in the order you tick them. To tick only some of a playlist’s tracks, open the playlist.',
        onDone: function (ids) {
          var list = had.slice();
          ids.forEach(function (id) {
            var made = before.indexOf(id) < 0 && L.playlist(id);
            if (made) {
              // A playlist made here: the scene's own tracks in it leave the scene, and it takes the first one's place.
              var own = made.items.filter(function (t) { return list.indexOf(t) > -1; }), at = own.length ? Math.min.apply(null, own.map(function (t) { return list.indexOf(t); })) : list.length;
              list = list.filter(function (x) { return own.indexOf(x) < 0; });
              list.splice(Math.min(at, list.length), 0, id);
            } else if (list.indexOf(id) < 0) list.push(id);
          });
          o.onDone(list);
        }
      }));
    } finally { L.pickerSheet = sheetPick; }
  };

  /* ---------- after every render ---------- */
  var render0 = L.render;
  L.render = function () { render0.apply(L, arguments); placeOverLines(); };
})();
