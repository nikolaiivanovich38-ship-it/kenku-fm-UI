/* Round 10 fixes (R10-FIX.md §3): nothing drawn on top of anything else (styles in r10fix.css).

   Nik, 18 Nov 13:00: "there are a lot of overlapping features in the visual design" (panels, menus or buttons
   covering or cutting off other parts of the screen).

   Side panels sit beside the screen in #work (index.html): Help, the Track panel, the queue, Add music docked left or
   right (r9guide.js) and, here, Find's results in Live. This file:
     - moves Find's results out of Live's top strip into a side panel at the right, so they no longer lie over On air;
     - draws the screen again when a panel changes its width, so Live's columns and the menu's labels follow the
       width the screen really has (they are chosen from #app's width when the screen is drawn);
     - keeps the screen at least 600 px wide: when a second panel would leave it less, the panel opened first closes
       (below 760 px of window one panel takes the whole window, so a second one closes the first). */
(function () {
  var MIN_SCREEN = 600, NARROW = 760;
  function work() { return document.getElementById('work'); }
  function appWidth() { var a = document.getElementById('app'); return a ? a.getBoundingClientRect().width : 0; }

  /* ---------- Find's results in a side panel ---------- */
  function findPanel(results) {
    var side = document.getElementById('r10-find'), w = work();
    if (!results) { if (side) side.remove(); return; }
    if (!w) return;
    if (!side) { side = document.createElement('div'); side.id = 'r10-find'; side.className = 'r10-side'; w.appendChild(side); }
    results.removeAttribute('style');
    side.replaceChildren(results);
  }

  /* ---------- which side panels are open, in the order they opened ---------- */
  var PANELS = [
    { id: 'help', open: function () { var h = document.getElementById('lyre-help'); return !!h && !h.hidden; }, close: function () { if (L.acts.helpclose) L.acts.helpclose(); } },
    { id: 'track', open: function () { var t = document.getElementById('r9-tp'); return !!t && !t.hidden; }, close: function () { if (L.acts.r9tpclose) L.acts.r9tpclose(); } },
    { id: 'queue', open: function () { return !!document.getElementById('r9-queue'); }, close: function () { if (L.acts.r9qclose) L.acts.r9qclose(); } },
    { id: 'find', open: function () { return !!document.getElementById('r10-find'); }, close: function () { if (L.acts.lvfindclose) L.acts.lvfindclose(); } },
    { id: 'music', open: function () { return !!document.querySelector('#work > .sheet.r10-docked'); }, close: function () { L.closeSheet(); } }
  ];
  var opened = [];
  function keepRoom() {
    var now = PANELS.filter(function (p) { return p.open(); }).map(function (p) { return p.id; });
    opened = opened.filter(function (id) { return now.indexOf(id) > -1; });
    now.forEach(function (id) { if (opened.indexOf(id) < 0) opened.push(id); });
    var w = work(), narrow = w && w.getBoundingClientRect().width < NARROW;
    // 0.6.0 review M10 (the app's SidePanel host): below 760 px a panel covers the screen, so the screen is inert then
    // and Tab and a screen reader stay in the panel.
    var app = document.getElementById('app'); if (app) app.inert = !!(narrow && opened.length);
    if (opened.length < 2 || (!narrow && appWidth() >= MIN_SCREEN)) return;
    // The panel opened first gives way; focus stays where Nik is working.
    var first = opened.shift(), a = document.activeElement;
    PANELS.filter(function (p) { return p.id === first; })[0].close();
    if (a && document.contains(a) && a !== document.body) a.focus({ preventScroll: true });
    else focusAfterClose();
    // 0.6.0 usability test F-P11: a short line, shown and read out, says why the first panel went.
    if (L.panelGaveWay) L.panelGaveWay(first, opened[opened.length - 1]);
    if (app) app.inert = !!(narrow && opened.length);
  }
  // 0.6.0 review M9 (the app's SidePanel host): a panel that closes with the focus in it gives the focus to the panel
  // still open, else to the screen's heading, never to nothing.
  function focusAfterClose() {
    var a = document.activeElement; if (a && a !== document.body && document.contains(a)) return;
    var open = document.querySelector('#lyre-help:not([hidden]) h2, #r9-tp:not([hidden]) h2, #r9-queue button, #r10-find button');
    var h = open || document.querySelector('#view h1'); if (!h) return;
    if (!open) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true });
  }

  /* ---------- after every render ---------- */
  var render0 = L.render, again = false;
  L.render = function () {
    var f = document.getElementById('r10-find'), ak = f && f.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.k : '';
    var before = appWidth();
    render0.apply(L, arguments);
    findPanel(document.querySelector('#view .lv-found'));
    if (ak) { var n = document.querySelector('#r10-find [data-k="' + ak + '"]'); if (n) n.focus({ preventScroll: true }); }
    keepRoom();
    // A panel that opened or closed in this render changed the screen's width: draw it again once for that width.
    if (!again && Math.abs(appWidth() - before) > 1) { again = true; try { L.render(); } finally { again = false; } }
  };

  // Closing a docked Add music gives the screen its width back.
  var close0 = L.closeSheet;
  L.closeSheet = function () {
    var docked = !!document.querySelector('#work > .sheet.r10-docked');
    close0.apply(L, arguments);
    if (docked) L.render();
  };
  window.addEventListener('resize', function () { keepRoom(); });
})();
