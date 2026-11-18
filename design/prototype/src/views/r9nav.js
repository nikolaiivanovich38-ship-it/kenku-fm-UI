/* Round 9 (design round 8 of 0.6.0, ROUND9.md §1): one rule for names, the Track panel, a trail that follows the route.

   Nik, 18 Nov (item 16): "Let's make the navigation from playlists to tracks to scenes easier and more intuitive".
   Item 22: "I want to be able to see and edit track details in the playlist view".

   The Track panel
     A track title anywhere outside the Library (a playlist page, the Playlists list, the session planner, Add music,
     Live's row details) opens the Track panel at the right of the work area, beside what Nik is doing, instead of
     leaving for the Library. It shows the Library's own Details (L.trackDetailsHTML, the same words and controls), so
     editing is the same. Its header has Open in Library and Close (Esc). Focus goes into the panel and back to the
     title that opened it. Below 1000 px of app it lies over the screen's right side, like Help.
     L.openTrackPanel(tid, backK)   open it (backK: the data-k to focus when it closes)
     L.panelTrack()                 the track it shows ('' when closed); the Library's actions use it (library.js cur())
   Used in
     A scene in a track's Used in opens the session with that scene unfolded and focused.
   The trail
     The Audio profile's trail follows the route: Playlists › Crypt ambush › <track> › Audio profile from a playlist,
     Campaigns › The Sunken Crown › Session 14 › Crypt ambush › <track> › Audio profile from a scene. The track's part
     opens the place with the Track panel open (#/playlist/<pid>/<tid>, #/session/<cid>/<sid>/<tid>). */
(function () {
  var esc = L.esc;
  var TP = { tid: '', back: '' };
  var NO_PANEL = { library: 1, profile: 1 };
  L.panelTrack = function () { return NO_PANEL[L.current().name] ? '' : TP.tid; };
  L.openTrackPanel = function (tid, backK) {
    if (!L.track(tid)) return;
    var a = document.activeElement;
    TP.tid = tid; TP.back = backK || (a && a.dataset && a.dataset.k) || '';
    L.render();
    var h = document.getElementById('r9-tp-title'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    L.say('Track details: ' + L.title(L.track(tid)));
  };
  function closePanel() {
    var back = TP.back; TP.tid = ''; TP.back = ''; L.render();
    var b = back && document.querySelector('[data-k="' + back + '"]'); if (b) b.focus();
  }
  L.acts.r9tpclose = closePanel;
  L.acts.r9tp = function (el) { L.openTrackPanel(el.dataset.tid, el.dataset.back || el.dataset.k); };

  function aside() {
    var a = document.getElementById('r9-tp');
    if (!a) {
      a = document.createElement('aside'); a.id = 'r9-tp'; a.className = 'r9-tp'; a.hidden = true; a.setAttribute('aria-labelledby', 'r9-tp-title');
      var app = document.getElementById('app'), view = document.getElementById('view');
      app.insertBefore(a, view.nextSibling);
      a.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.menu')) { e.preventDefault(); e.stopPropagation(); closePanel(); } });
    }
    return a;
  }
  function paintPanel() {
    var a = aside(), id = L.panelTrack(), t = id && L.track(id);
    if (!t || !L.trackDetailsHTML) { a.hidden = true; a.innerHTML = ''; return; }
    a.hidden = false;
    L.paint(a, '<header class="r9-tp-head"><div class="r9-tp-bar"><span class="r9-tp-kicker">Track</span><span class="grow"></span>' +
      '<a class="btn s" href="#/library/' + t.id + '" data-r9-keep="1" data-k="r9-tp-lib" title="Open it in the Track library, with its filters and the whole list">' + L.icon('library', 's') + 'Open in Track library</a>' +
      '<button class="closer" data-act="r9tpclose" data-k="r9-tp-x" title="Close (Esc)" aria-label="Close the track details">' + L.icon('close') + '</button></div>' +
      '<h2 id="r9-tp-title" title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</h2></header>' +
      '<div class="r9-tp-body" data-scroll="r9-tp-' + t.id + '">' + L.trackDetailsHTML(t) + '</div>');
    // Over the screen (narrow windows), the panel stops above the Now playing bar, which stays in view.
    var bar = document.querySelector('#view .onairbar'); a.style.setProperty('--r9-bar', bar ? bar.offsetHeight + 'px' : '0px');
  }

  /* A track title that links to the Library opens the panel instead, outside the Library. "Open in Library" and the
     row menus' "Open in the Library" still go there. */
  document.addEventListener('click', function (e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#/library/"]');
    if (a && !a.dataset.r9Keep && !NO_PANEL[L.current().name] && !a.closest('#lyre-help')) {
      var tid = a.getAttribute('href').split('/')[2];
      if (L.track(tid)) { e.preventDefault(); e.stopImmediatePropagation(); L.openTrackPanel(tid, a.dataset.k); return; }
    }
    // Used in: the session opens with that scene unfolded and focused.
    var u = e.target.closest && e.target.closest('a[data-k^="lb-use-"]');
    if (u) { var sc = u.dataset.k.slice(7); L.state.openScene = { sc: sc, k: 'sct-' + sc }; }
  }, true);

  /* Routes with the panel open: #/playlist/<pid>/<tid> and #/session/<cid>/<sid>/<tid> (the trail's track part). */
  var lastRoute = '';
  function fromRoute() {
    var r = L.current(), key = location.hash;
    if (key === lastRoute) return; lastRoute = key;
    if ((r.name === 'playlist' || r.name === 'session') && r.p.tid && L.track(r.p.tid)) TP.tid = r.p.tid;
    else if (NO_PANEL[r.name]) TP.tid = '';
  }

  /* The Audio profile's trail follows the place it shows (p.ctx: pl:<pid>, sc:<cid>:<sid>:<scene>, ss:…, cp:…). */
  var prof = L.views.profile;
  // The track's own page for a place: the playlist or session with the Track panel open, else its Library details.
  L.trackHrefFor = function (tid, ctx) {
    var a = (ctx || '').split(':');
    if (a[0] === 'pl' && L.playlist(a[1])) return '#/playlist/' + a[1] + '/' + tid;
    if ((a[0] === 'sc' || a[0] === 'ss') && L.session(a[1], a[2])) return '#/session/' + a[1] + '/' + a[2] + '/' + tid;
    return '#/library/' + tid;
  };
  if (prof) prof.crumbs = function (p) {
    var t = L.track(p.tid); if (!t) return null;
    var me = { label: L.title(t) + ' › Audio profile' }, a = (p.ctx || '').split(':');
    if (a[0] === 'pl' && L.playlist(a[1])) return [{ href: '#/playlists', label: 'Playlists' }, { href: '#/playlist/' + a[1], label: L.playlist(a[1]).name }, { href: L.trackHrefFor(t.id, p.ctx), label: 'Track details' }, me];
    var s = (a[0] === 'sc' || a[0] === 'ss') && L.session(a[1], a[2]), c = s && L.campaign(a[1]);
    if (s) {
      var sc = a[0] === 'sc' && s.scenes.filter(function (x) { return x.id === a[3]; })[0];
      return [{ href: '#/campaign/' + c.id, label: c.name }, { href: '#/session/' + c.id + '/' + s.id, label: 'Session ' + s.n }]
        .concat(sc ? [{ href: '#/session/' + c.id + '/' + s.id, label: sc.name }] : []).concat([{ href: L.trackHrefFor(t.id, p.ctx), label: 'Track details' }, me]);
    }
    return [{ href: '#/library', label: 'Track library' }, { href: '#/library/' + t.id, label: 'Track details' }, me];
  };

  var render0 = L.render;
  L.render = function () {
    fromRoute(); render0.apply(L, arguments); paintPanel();
    // The row of the track the panel shows is marked where it is listed (words for screen readers in the row's title).
    var id = L.panelTrack(); document.querySelectorAll('#view .r9-tp-on').forEach(function (x) { x.classList.remove('r9-tp-on'); });
    if (id) document.querySelectorAll('#view li[data-tid="' + id + '"], #view tr[data-tid="' + id + '"]').forEach(function (x) { x.classList.add('r9-tp-on'); x.setAttribute('aria-current', 'true'); });
  };
})();
