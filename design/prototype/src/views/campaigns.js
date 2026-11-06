/* Campaigns, Campaign and Session views (prefix cp-).
   #/campaigns            the top level: one card per campaign, each shown in its own table theme
   #/campaign/<cid>       one campaign: details, theme, sessions, campaign playlists and pad boards, notes
   #/session/<cid>/<sid>  the session planner: scenes (Starts when, music: tracks and playlists in any mix,
                          ambience: a track or ambience playlist, pad boards: several, notes),
                          session playlists and pad boards, and a reminder of the campaign's playlists.
   Playlists and pad boards are never made here, only assigned (they live on the Playlists and Pad boards pages). */
(function () {
  var esc = L.esc, D = L.data;
  var STATUS = { played: 'Played', next: 'Next', draft: 'Draft' };
  var SYSTEMS = ['D&D 5e', 'D&D 2024', 'Pathfinder 2e', 'Fate Core', 'Fate Accelerated', 'Vampire: the Masquerade V5', 'Call of Cthulhu 7e', 'Blades in the Dark', 'Warhammer Fantasy Roleplay', 'Mothership', 'Daggerheart'];
  var open = {};          // scene id -> true when its card is expanded
  var current = null;     // scene id last worked on: "Add scene" goes after it
  var focusK = null;      // data-k to focus after the next render
  var nc = null;          // new-campaign draft

  /* ---------- helpers ---------- */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return 'No date yet';
    var d = new Date(iso + 'T12:00:00'); if (isNaN(d)) return iso;
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function themeName(id) { var t = L.THEMES.filter(function (x) { return x[0] === id; })[0]; return t ? t[1].replace(/\s*\(.*\)$/, '') : id; }
  function defTheme() { return D.defaultTheme || 'candle'; }
  function themeFor(id) { return L.state.theme === 'campaign' ? (id || defTheme()) : L.state.theme; }
  function nextSession(c) { return c.sessions.filter(function (s) { return s.status === 'next'; })[0] || c.sessions.filter(function (s) { return s.status === 'draft'; })[0] || null; }
  function sLabel(s) { return 'Session ' + s.n + (s.name ? ': ' + s.name : ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function usedPlaylists(c) {
    var seen = {};
    function add(id) { if (id) seen[id] = 1; }
    c.playlists.forEach(add);
    c.sessions.forEach(function (s) { s.playlists.forEach(add); s.scenes.forEach(function (sc) { sc.music.forEach(add); add(sc.amb); }); });
    return Object.keys(seen).length;
  }
  function usedBoards(c) {
    var seen = {};
    c.boards.forEach(function (b) { seen[b] = 1; });
    c.sessions.forEach(function (s) { s.boards.forEach(function (b) { seen[b] = 1; }); s.scenes.forEach(function (sc) { L.sceneBoards(sc).forEach(function (b) { seen[b] = 1; }); }); });
    return Object.keys(seen).length;
  }
  function slug(name) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'campaign', id = base, i = 2;
    while (L.campaign(id)) id = base + '-' + i++;
    return id;
  }
  function blankScene(name) { return { id: L.uid('sc'), name: name || 'New scene', when: '', music: [], amb: '', boards: [], notes: '', noteLink: '' }; }
  // Run: load the session in Live with nothing started (the live view's L.liveStandby also fades leftover music from another session).
  function run(cid, sid) {
    if (typeof L.liveStandby === 'function') L.liveStandby(cid, sid); else L.state.live = { cid: cid, sid: sid, scene: 0, standby: 1 };
    L.route('#/live');
  }
  function ctx() { var p = L.current().p; var c = L.campaign(p.cid); return { c: c, s: c && p.sid ? L.session(p.cid, p.sid) : null }; }
  function colClass(ids) { return 'col' + (ids.indexOf(L.state.maxed) > -1 ? ' has-max' : ''); }
  function statusBadge(st) {
    return '<span class="cp-status ' + st + '">' + (st === 'played' ? L.icon('check', 's') : '') + STATUS[st] + '</span>';
  }
  function plKind(p) { return p.kind === 'dynamic' ? 'Dynamic' : 'Manual'; }
  function plSub(p) { return L.kindName[p.lane] + ' · ' + plKind(p) + ' · ' + plural(L.playlistTracks(p).length, 'track'); }
  // Any item a scene can hold: a track, a playlist or a pad board. -> { kind, id, obj, name, href, icon, cls, label (kind word), sub }
  function info(id, asBoard) {
    if (asBoard) { var b = L.board(id); return b && { kind: 'board', id: id, obj: b, name: b.name, href: '#/board/' + id, icon: 'grid', cls: 'fx', label: 'Pad board',
      sub: b.cols + ' × ' + b.rows + ' grid · ' + plural(L.boardPads(b).filter(Boolean).length, 'pad') + (b.spare.length ? ' · ' + b.spare.length + ' spare' : '') }; }
    var p = L.playlist(id);
    if (p) return { kind: 'playlist', id: id, obj: p, name: p.name, href: '#/playlist/' + id, icon: 'playlist', cls: p.lane === 'amb' ? 'amb' : p.lane === 'fx' ? 'fx' : 'music',
      label: 'Playlist · ' + plKind(p), sub: L.kindName[p.lane] + ' · ' + plural(L.playlistTracks(p).length, 'track') };
    var t = L.track(id); if (!t) return null;
    var fx = L.isFx(t);
    return { kind: 'track', id: id, obj: t, name: L.title(t), href: '#/library/' + id, icon: fx ? 'sfx' : t.kind === 'amb' ? 'ambience' : 'music', cls: fx ? 'fx' : t.kind === 'amb' ? 'amb' : 'music',
      label: fx ? (t.role === 'Sting' ? 'FX · Sting' : 'FX') : t.kind === 'amb' ? 'Ambience track' : 'Track', sub: (t.role && t.kind === 'music' && !fx ? t.role + ' · ' : '') + L.fmt(t.dur) };
  }
  // Preview, optional expander and contents for a playlist or board row. xk: expander key unique to this place on the page.
  function xpBody(it, xk, pkey) { return (it.kind === 'playlist' || it.kind === 'board') && L.expanded(xk) ? '<div class="xp-body cp-xp">' + L.contentsHTML(it.kind, it.id, pkey) + '</div>' : ''; }
  function xpBtn(it, xk) { return it.kind === 'playlist' || it.kind === 'board' ? L.expanderButton(xk, it.name) : '<span class="cp-xpgap" aria-hidden="true"></span>'; }

  /* ---------- shared: assigned playlists and pad boards as compact rows ---------- */
  // scope 'c' (campaign) or 's' (session); kind 'pl' or 'bd'; readonly for the reminder on the session page.
  function moreBtn(k, label, data) { return '<button class="closer cp-more-btn" data-act="cprowmenu" ' + data + ' data-k="' + k + '" title="More for ' + label + '" aria-label="More for ' + label + '" aria-haspopup="menu" aria-expanded="false">' + L.icon('more') + '</button>'; }
  // The place key of a campaign ('cp:…') or session ('ss:…') list: its play order (PLY-13) and, for a session, its own
  // audio settings (PLY-14) apply when a playlist or track is played from it.
  function scopeKey(scope) { var x = ctx(); return scope === 'c' || scope === 'r' ? 'cp:' + x.c.id : 'ss:' + x.c.id + ':' + x.s.id; }
  // tracks (ORG-12): single tracks kept on hand here, listed after the playlists.
  function assigned(ids, kind, scope, readonly, tracks) {
    tracks = (tracks || []).filter(function (id) { return L.track(id); });
    if (!ids.length && !tracks.length) return '<p class="cp-none">' + (kind === 'pl' ? 'No playlists yet.' : 'No pad boards yet.') + '</p>';
    var key = scopeKey(scope);
    return '<ul class="list cp-alist">' + ids.map(function (id) {
      var it = info(id, kind === 'bd'); if (!it) return ''; var o = it.obj, xk = 'cp-' + scope + ':' + id, nm = esc(o.name);
      var sub = kind === 'pl' ? plSub(o) : it.label + ' · ' + it.sub;
      return '<li class="cp-arow-wrap"><div class="cp-arow">' + xpBtn(it, xk) + '<span class="lane-dot ' + it.cls + '" aria-hidden="true"></span>' +
        '<a class="ellipsis grow cp-aname" href="' + it.href + '" data-k="open-' + scope + kind + id + '" title="' + esc(o.name + ' · ' + sub) + '">' + nm + '</a>' +
        L.previewButton(it.kind, id) + (kind === 'pl' ? L.playOnAirButton('playlist', id, key) + L.orderButton(id, key) : '') +
        (readonly ? '' : moreBtn('more-' + scope + kind + id, nm, 'data-menu="assigned" data-scope="' + scope + '" data-kind="' + kind + '" data-id="' + id + '"')) + '</div>' + xpBody(it, xk, scope === 's' ? key : '') + '</li>';
    }).join('') + tracks.map(function (id) {
      var it = info(id), t = it.obj, nm = esc(it.name);
      return '<li class="cp-arow-wrap"><div class="cp-arow"><span class="cp-xpgap" aria-hidden="true"></span><span class="lane-dot ' + it.cls + '" aria-hidden="true"></span>' +
        '<span class="cp-it-main"><a class="ellipsis grow cp-aname" href="' + it.href + '" data-k="open-' + scope + 'tr' + id + '" title="' + esc(it.name + ' · ' + it.label + ' · ' + it.sub) + '">' + nm + '<span class="sr-only"> (single track)</span></a><span class="cp-it-sub"><span class="faint">Single track</span>' + L.tagStrip(t, 2) + '</span></span>' +
        L.previewButton('track', id) + L.playOnAirButton('track', id, key) +
        (readonly ? '' : moreBtn('more-' + scope + 'tr' + id, nm, 'data-menu="assigned" data-scope="' + scope + '" data-kind="tr" data-id="' + id + '"')) + '</div></li>';
    }).join('') + '</ul>';
  }
  function assignedPane(o) {
    var kindWord = o.kind === 'pl' ? 'playlists' : 'pad boards', n = o.ids.length + (o.tracks || []).length;
    return L.pane({ id: o.id, title: o.title, icon: o.kind === 'pl' ? 'playlist' : 'grid', size: 'auto', kind: o.kind === 'pl' ? 'music' : 'fx',
      status: n ? { text: String(n), tone: 'idle' } : { text: 'Empty', tone: 'idle' },
      actions: '<button class="btn s icon" data-act="cpadd" data-scope="' + o.scope + '" data-kind="' + o.kind + '" data-k="add-' + o.scope + o.kind + '" aria-label="Add ' + kindWord + '…" title="Add ' + kindWord + ' from your library (' + o.why.replace(/\.$/, '').toLowerCase() + ')">' + L.icon('plus', 's') + '</button>',
      // Round 6: "In every session." is read out, not shown (the title says Campaign or Session); new ones are made from the rail.
      describe: o.why, body: assigned(o.ids, o.kind, o.scope, false, o.tracks) });
  }

  L.acts.cpadd = function (el) {
    var x = ctx(), target = el.dataset.scope === 'c' ? x.c : x.s, kind = el.dataset.kind, list = kind === 'pl' ? target.playlists : target.boards;
    var where = el.dataset.scope === 'c' ? 'every session of ' + x.c.name : 'every scene of Session ' + x.s.n;
    var o = { title: (kind === 'pl' ? 'Playlists' : 'Pad boards') + ' on hand in ' + where, selected: list, multi: true, okLabel: 'Save',
      intro: 'Tick the ' + (kind === 'pl' ? 'playlists' : 'pad boards') + ' to keep on hand in ' + esc(where) + '.',
      onDone: function (ids) {
        var keep = list.filter(function (id) { return ids.indexOf(id) > -1; }), added = ids.filter(function (id) { return list.indexOf(id) < 0; });
        list.length = 0; keep.concat(added).forEach(function (id) { list.push(id); }); focusK = el.dataset.k;
        L.say(plural(list.length, kind === 'pl' ? 'playlist' : 'pad board') + ' now on hand in ' + where);
      } };
    if (kind === 'pl') L.pickPlaylists(o); else L.pickBoards(o);
  };
  L.acts.cprm = function (el) {
    var x = ctx(), target = el.dataset.scope === 'c' ? x.c : x.s, kind = el.dataset.kind, list = kind === 'pl' ? target.playlists : kind === 'tr' ? target.tracks : target.boards, id = el.dataset.id;
    var i = list.indexOf(id); if (i < 0) return; list.splice(i, 1);
    if (kind === 'tr') { focusK = 'add-' + el.dataset.scope + 'pl'; L.render(); L.toast('Removed "' + L.title(L.track(id)) + '" from this ' + (el.dataset.scope === 'c' ? 'campaign' : 'session') + '. It is still in the Library.'); return; }
    var o = kind === 'pl' ? L.playlist(id) : L.board(id);
    focusK = list.length ? 'more-' + el.dataset.scope + kind + list[Math.min(i, list.length - 1)] : 'add-' + el.dataset.scope + kind;
    L.render();
    L.toast('Removed "' + o.name + '" from this ' + (el.dataset.scope === 'c' ? 'campaign' : 'session') + '. It is still on the ' + (kind === 'pl' ? 'Playlists' : 'Pad boards') + ' page.');
  };

  /* ---------- reordering (buttons and drag and drop) ---------- */
  function renumber(c) { if (!c.sessions.length) return; var base = Math.min.apply(null, c.sessions.map(function (s) { return s.n; })); c.sessions.forEach(function (s, i) { s.n = base + i; }); }
  function moveItem(list, from, to) {
    var x = ctx(), arr = list === 'sessions' ? x.c.sessions : x.s.scenes;
    if (to < 0 || to >= arr.length || from === to) return false;
    var item = arr.splice(from, 1)[0]; arr.splice(to, 0, item);
    if (list === 'sessions') { renumber(x.c); L.say((item.name || 'That session') + ' is now Session ' + item.n + ', ' + (to + 1) + ' of ' + arr.length); }
    else L.say('Scene ' + item.name + ' moved to position ' + (to + 1) + ' of ' + arr.length);
    return true;
  }
  L.acts.cpmove = function (el) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    var i = +el.dataset.idx; if (el.dataset.fk) focusK = el.dataset.fk; if (moveItem(el.dataset.list, i, i + +el.dataset.dir)) L.render();
  };
  var drag = null;
  function clearMarks() { document.querySelectorAll('.cp-drop-before, .cp-drop-after, .cp-dragging').forEach(function (n) { n.classList.remove('cp-drop-before', 'cp-drop-after', 'cp-dragging'); }); }
  document.addEventListener('pointerdown', function (e) { var h = e.target.closest && e.target.closest('.cp-handle'); if (h) { var it = h.closest('[data-drag]'); if (it) it.setAttribute('draggable', 'true'); } });
  document.addEventListener('pointerup', function () { if (!drag) document.querySelectorAll('[data-drag][draggable="true"]').forEach(function (n) { n.removeAttribute('draggable'); }); });
  document.addEventListener('dragstart', function (e) {
    var it = e.target.closest && e.target.closest('[data-drag]'); if (!it || it.getAttribute('draggable') !== 'true') return;
    drag = { list: it.dataset.drag, idx: +it.dataset.idx }; e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', it.dataset.idx); } catch (err) { /* some browsers refuse custom data */ }
    it.classList.add('cp-dragging');
  });
  document.addEventListener('dragover', function (e) {
    if (!drag) return; var it = e.target.closest && e.target.closest('[data-drag="' + drag.list + '"]'); if (!it) return;
    e.preventDefault(); var r = it.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    document.querySelectorAll('.cp-drop-before, .cp-drop-after').forEach(function (n) { n.classList.remove('cp-drop-before', 'cp-drop-after'); });
    if (+it.dataset.idx !== drag.idx) it.classList.add(after ? 'cp-drop-after' : 'cp-drop-before');
  });
  document.addEventListener('drop', function (e) {
    if (!drag) return; var it = e.target.closest && e.target.closest('[data-drag="' + drag.list + '"]'); if (!it) return;
    e.preventDefault(); var r = it.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, to = +it.dataset.idx + (after ? 1 : 0);
    if (to > drag.idx) to--;
    var d = drag; drag = null; clearMarks(); if (moveItem(d.list, d.idx, to)) L.render();
  });
  document.addEventListener('dragend', function () { drag = null; clearMarks(); document.querySelectorAll('[data-drag][draggable="true"]').forEach(function (n) { n.removeAttribute('draggable'); }); });

  /* ---------- dropping audio files and folders from the PC (session planner) ----------
     A scene's Music list (open or folded card) and its Ambience slot take dropped files: they are added to the Library
     (L.importFiles) and placed in the scene. Only drags that carry Files are handled; reordering drags are left alone. */
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, 'Files') > -1; }
  function clearDrop() { document.querySelectorAll('.cp-fdrop, .cp-ins-before, .cp-ins-end').forEach(function (n) { n.classList.remove('cp-fdrop', 'cp-ins-before', 'cp-ins-end'); }); }
  // Where in the music list the drop lands: before the row under the pointer's upper half, else after it.
  function dropIndex(box, y) {
    var rows = [].slice.call(box.querySelectorAll('.cp-items > .cp-it'));
    for (var i = 0; i < rows.length; i++) { var r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return { i: i, row: rows[i] }; }
    return { i: rows.length, row: null };
  }
  document.addEventListener('dragover', function (e) {
    if (drag || !hasFiles(e)) return; var box = e.target.closest && e.target.closest('[data-filedrop]');
    clearDrop(); if (!box) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; box.classList.add('cp-fdrop');
    if (box.dataset.filedrop === 'music' && box.classList.contains('cp-box')) { var d = dropIndex(box, e.clientY); if (d.row) d.row.classList.add('cp-ins-before'); else box.classList.add('cp-ins-end'); }
  });
  document.addEventListener('dragleave', function (e) { if (!drag && hasFiles(e) && !e.relatedTarget) clearDrop(); });
  document.addEventListener('drop', function (e) {
    if (drag || !hasFiles(e)) return; var box = e.target.closest && e.target.closest('[data-filedrop]'); clearDrop(); if (!box) return;
    e.preventDefault();
    var x = findScene(box.dataset.sc); if (!x) return;
    var where = box.dataset.filedrop, at = where === 'music' && box.classList.contains('cp-box') ? dropIndex(box, e.clientY).i : x.sc.music.length;
    L.filesFromDrop(e, function (files) {
      if (!files.length) { L.toast('No audio files in what you dropped'); return; }
      var before = D.tracks.length, ids = L.importFiles(files), created = D.tracks.slice(before).map(function (t) { return t.id; }), name = x.sc.name || 'this scene';
      var lib = created.length ? plural(created.length, 'new track') + ' added to the Library. ' : '';
      current = x.sc.id;
      if (where === 'amb') {
        created.forEach(function (id) { L.track(id).kind = 'amb'; });   // dropped on Ambience: new files are ambience beds
        x.sc.amb = ids[0]; focusK = 'pa-' + x.sc.id; L.render();
        L.toast(lib + 'Ambience of "' + name + '": ' + L.title(L.track(ids[0])) + (ids.length > 1 ? ' (one ambience per scene; the others are in the Library)' : ''));
        return;
      }
      [].splice.apply(x.sc.music, [at, 0].concat(ids)); focusK = 'in-' + x.sc.id + '-music-' + ids[0]; L.render();
      L.toast(lib + plural(ids.length, 'track') + ' placed in the music of "' + name + '" at position ' + (at + 1) + '.');
    });
  });

  /* ======================================================================
     1. Campaigns: the top level
     ====================================================================== */
  function card(c) {
    var nx = nextSession(c), th = themeFor(c.theme);
    // Round 6: the card is drawn in its theme, so the theme's name is hover text.
    return '<article class="cp-card" data-theme="' + th + '" aria-labelledby="cph-' + c.id + '" title="' + esc(plural(c.sessions.length, 'session') + ' · ' + plural(usedPlaylists(c), 'playlist') + ' · ' + plural(usedBoards(c), 'pad board') + ' · theme: ' + themeName(c.theme || defTheme())) + '">' +
      '<div class="cp-card-top"><span class="cp-sys">' + esc(c.system || 'No game system') + '</span></div>' +
      '<h2 class="display cp-card-name" id="cph-' + c.id + '">' + esc(c.name) + '</h2>' +
      '<p class="cp-blurb ellipsis" title="' + esc(c.blurb) + '">' + (c.blurb ? esc(c.blurb) : '<span class="faint">No description</span>') + '</p>' +
      '<p class="cp-next">' + (nx ? '<span class="cp-next-lbl">Next</span><span class="cp-next-name ellipsis">' + esc(sLabel(nx)) + '</span><span class="cp-next-date">' + esc(fmtDate(nx.date)) + '</span>'
        : '<span class="cp-next-lbl">Next</span><span class="faint">Nothing planned yet</span>') + '</p>' +
      '<div class="cp-card-btns"><a class="btn cp-btnlink" href="#/campaign/' + c.id + '" data-k="copen-' + c.id + '" aria-label="Open ' + esc(c.name) + '">Open</a>' +
      (nx ? '<button class="btn primary" data-act="cprun" data-cid="' + c.id + '" data-sid="' + nx.id + '" data-k="crun-' + c.id + '" aria-label="Run next session of ' + esc(c.name) + ': Session ' + nx.n + '">' + L.icon('broadcast', 's') + 'Run next session</button>'
        : '<button class="btn primary" aria-disabled="true" title="No session planned yet" data-k="crun-' + c.id + '">' + L.icon('broadcast', 's') + 'Run next session</button>') + '</div></article>';
  }
  L.acts.cprun = function (el) { if (el.getAttribute('aria-disabled') === 'true') return; run(el.dataset.cid, el.dataset.sid); };

  L.view('campaigns', {
    nav: 'campaigns',
    title: function () { return 'Campaigns'; },
    notesTitle: 'Campaigns: the new top level',
    notes: [
      '<b>Start here.</b> Open <b>The Sunken Crown</b>, then <b>Session 14</b> to see a planned evening, then <b>Run this session</b> to go live. The rail on the left reaches Library, Playlists, Pad boards and Look and feel.',
      'Every campaign has a card in <b>its own table theme</b>, with its next session and how many sessions, playlists and pad boards it uses. <b>Run next session</b> goes straight to Live; <b>Open</b> goes to the campaign page.',
      '<b>New campaign</b> now starts on <b>Candlelit Library</b>, the new house default; pick another from the five previews if you like.',
      'New: an <b>Obsidian</b> section (folded, marked "coming later") in New campaign for your vault, campaign note and session notes folder. These are placeholders; nothing connects yet.'
    ],
    render: function () {
      return '<div class="viewhead"><h1>Campaigns</h1><span class="grow"></span>' +
        '<button class="btn primary" data-act="cpnew" data-k="cpnew">' + L.icon('plus', 's') + 'New campaign</button></div>' +
        '<div class="viewbody" data-scroll="cp-grid">' + (D.campaigns.length ? '<div class="cp-grid">' + D.campaigns.map(card).join('') + '</div>'
          // A first-time user: what a campaign is and what to do first (w3-ux 9).
          : '<div class="empty"><b>No campaigns yet.</b> A campaign holds your sessions, the scenes in each, and the music, ambience and pad boards you use in them. Start with <b>New campaign</b>.</div>') + '</div>';
    },
    after: afterRender
  });

  /* Obsidian placeholders (not working yet): stored on the campaign, the session and each scene for a later version. */
  var OBS_REASON = 'Lyre will open these notes in a later version.';
  function obsFields(pre, o, input) {
    function f(key, label, ph) { return '<div class="field"><label for="' + pre + key + '">' + label + '</label><input class="input" id="' + pre + key + '" data-input="' + input + '" data-f="' + key + '" data-k="' + pre + key + '" value="' + esc(o[key] || '') + '" placeholder="' + ph + '" autocomplete="off"></div>'; }
    return '<div class="cp-obs-grid">' + f('vault', 'Vault', 'Name of your Obsidian vault') + f('note', 'Campaign note', 'e.g. Campaigns/The Sunken Crown/Overview.md') + f('sessions', 'Session notes folder', 'e.g. Campaigns/The Sunken Crown/Sessions') + '</div>' + obsButton(pre);
  }
  function obsButton(pre) { return '<div class="cp-obs-btn"><button class="btn s" disabled aria-describedby="' + pre + 'why">' + L.icon('link', 's') + 'Open in Obsidian</button><span class="hint" id="' + pre + 'why">Not working yet: ' + OBS_REASON + '</span></div>'; }

  /* New campaign sheet */
  function themeOption(id, checked) {
    var t = L.THEMES.filter(function (x) { return x[0] === id; })[0], sub = (t[1].match(/\((.*)\)/) || [])[1] || '';
    return '<label class="cp-th" data-theme="' + id + '"><span class="cp-th-prev" aria-hidden="true"><span class="cp-th-h">Aa</span><span class="cp-th-row"><i class="m"></i><i class="a"></i></span><span class="cp-th-btn"></span></span>' +
      '<span class="cp-th-name"><input type="radio" name="cp-theme" value="' + id + '" data-input="cpnewtheme"' + (checked ? ' checked' : '') + '>' + esc(themeName(id)) + '</span>' +
      '<span class="cp-th-sub">' + esc(sub) + (id === defTheme() && !/default/i.test(sub) ? ' · default' : '') + '</span></label>';
  }
  L.acts.cpnew = function () {
    nc = { name: '', system: '', blurb: '', theme: defTheme(), obsidian: { vault: '', note: '', sessions: '' } };
    L.sheet({ title: 'New campaign',
      body: '<div class="cp-form">' +
        '<div class="field"><label for="cp-n-name">Name</label><input class="input" id="cp-n-name" data-input="cpnew" data-f="name" autocomplete="off" placeholder="For example: The Sunken Crown" aria-describedby="cp-n-err"><p class="cp-err" id="cp-n-err" hidden>Give the campaign a name.</p></div>' +
        '<div class="field"><label for="cp-n-sys">Game system</label><input class="input" id="cp-n-sys" list="cp-systems" data-input="cpnew" data-f="system" autocomplete="off" placeholder="Type or pick one">' +
        '<datalist id="cp-systems">' + SYSTEMS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>' +
        '<div class="field cp-wide"><label for="cp-n-blurb">Description <span class="faint">(one line)</span></label><input class="input" id="cp-n-blurb" data-input="cpnew" data-f="blurb" autocomplete="off" placeholder="One line about the story"></div>' +
        '<fieldset class="cp-themes cp-wide"><legend>Theme</legend><p class="hint">How Lyre looks while this campaign is open. You can change it later.</p>' +
        '<div class="cp-th-grid" role="radiogroup" aria-label="Theme">' + L.THEMES.slice(1).map(function (t) { return themeOption(t[0], t[0] === nc.theme); }).join('') + '</div></fieldset>' +
        '<details class="cp-obs cp-wide"><summary>' + L.icon('chevdown', 's') + 'Obsidian <span class="cp-later">coming later</span></summary>' +
        '<p class="hint">Where this campaign\'s notes live in Obsidian. Lyre keeps these for a later version; nothing connects yet.</p>' + obsFields('cp-n-o-', nc.obsidian, 'cpnewobs') + '</details></div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="cpcreate">' + L.icon('plus', 's') + 'Create campaign</button>' });
    var panel = document.querySelector('#lyre-sheet .panel'); if (panel) panel.dataset.theme = nc.theme;
  };
  L.inputs.cpnew = function (el) {
    nc[el.dataset.f] = el.value;
    if (el.dataset.f === 'name' && el.value.trim()) { el.removeAttribute('aria-invalid'); document.getElementById('cp-n-err').hidden = true; }
  };
  L.inputs.cpnewobs = function (el) { nc.obsidian[el.dataset.f] = el.value; };
  L.inputs.cpobs = function (el) { var c = ctx().c; c.obsidian = c.obsidian || {}; c.obsidian[el.dataset.f] = el.value; };
  L.inputs.cpnewtheme = function (el) {
    nc.theme = el.value; var panel = document.querySelector('#lyre-sheet .panel'); if (panel) panel.dataset.theme = el.value;
    L.say('Theme: ' + themeName(el.value));
  };
  L.acts.cpcreate = function () {
    if (!nc.name.trim()) {
      var f = document.getElementById('cp-n-name'); f.setAttribute('aria-invalid', 'true'); document.getElementById('cp-n-err').hidden = false; f.focus(); L.say('Give the campaign a name.'); return;
    }
    var c = { id: slug(nc.name), name: nc.name.trim(), system: nc.system.trim(), theme: nc.theme, blurb: nc.blurb.trim(), notes: '', obsidian: nc.obsidian, playlists: [], boards: [],
      sessions: [{ id: 's1', n: 1, name: '', date: '', status: 'draft', playlists: [], boards: [], scenes: [blankScene('Opening scene')] }] };
    D.campaigns.push(c); L.closeSheet(); L.route('#/campaign/' + c.id);
    L.toast('Made "' + c.name + '" with a first draft session');
  };

  /* ======================================================================
     2. Campaign page
     ====================================================================== */
  function sessionRow(c, s, i) {
    var last = c.sessions.length - 1;
    return '<li class="lrow cp-srow" data-drag="sessions" data-idx="' + i + '">' +
      '<span class="cp-handle" title="Drag to reorder" aria-hidden="true">' + L.icon('drag', 's') + '</span>' +
      '<span class="num cp-sn" aria-hidden="true">' + s.n + '</span>' +
      '<a class="grow ellipsis cp-sname" href="#/session/' + c.id + '/' + s.id + '" data-k="sopen-' + s.id + '" title="' + esc(sLabel(s) + ' · ' + plural(s.scenes.length, 'scene')) + '"><span class="sr-only">Session ' + s.n + ': </span>' + (s.name ? esc(s.name) : '<span class="faint">No name yet</span>') + '</a>' +
      '<span class="cp-sdate">' + esc(fmtDate(s.date)) + '</span>' + statusBadge(s.status) +
      '<button class="btn s' + (s.status === 'next' ? ' primary' : '') + '" data-act="cprun" data-cid="' + c.id + '" data-sid="' + s.id + '" data-k="srun-' + s.id + '" aria-label="Run ' + esc(sLabel(s)) + (s.status === 'played' ? ' again' : '') + '" title="' + (s.status === 'next' ? 'Run the next session' : s.status === 'played' ? 'Run this session again' : 'Run this session') + '">' + L.icon('broadcast', 's') + 'Run</button>' +
      '<button class="closer" data-act="cpsessmenu" data-idx="' + i + '" data-k="sm-' + s.id + '" title="More for ' + esc(sLabel(s)) + '" aria-label="More for ' + esc(sLabel(s)) + '" aria-haspopup="menu" aria-expanded="false">' + L.icon('more') + '</button></li>';
  }
  L.acts.cpsessmenu = function (el) {
    var c = ctx().c, i = +el.dataset.idx, s = c.sessions[i], mv = 'data-list="sessions" data-idx="' + i + '" data-fk="sm-' + s.id + '"';
    L.menu(el, '<button role="menuitem" data-act="cpgo" data-href="#/session/' + c.id + '/' + s.id + '">' + L.icon('right') + 'Open</button>' +
      (i > 0 ? '<button role="menuitem" data-act="cpmove" data-dir="-1" ' + mv + '>' + L.icon('chevup') + 'Move up</button>' : '') +
      (i < c.sessions.length - 1 ? '<button role="menuitem" data-act="cpmove" data-dir="1" ' + mv + '>' + L.icon('chevdown') + 'Move down</button>' : ''), 'Session actions');
  };
  L.acts.cpnewsession = function () {
    var c = ctx().c, last = c.sessions[c.sessions.length - 1], n = last ? last.n + 1 : 1, id = 's' + n;
    while (L.session(c.id, id)) id = L.uid('s');
    var s = { id: id, n: n, name: '', date: '', status: c.sessions.some(function (x) { return x.status === 'next'; }) ? 'draft' : 'next', playlists: [], boards: [], scenes: [blankScene('Opening scene')] };
    c.sessions.push(s); L.route('#/session/' + c.id + '/' + s.id); L.toast('Added Session ' + n);
  };
  L.inputs.cpcamp = function (el) {
    var c = ctx().c; if (!c) return; var f = el.dataset.f;
    c[f] = el.value;
    if (f === 'theme') L.say('Theme: ' + themeName(el.value));
    L.render();
  };

  L.view('campaign', {
    nav: 'campaigns',
    title: function (p) { var c = L.campaign(p.cid); return c ? c.name : 'Campaign'; },
    notesTitle: 'Campaign page: sessions and what stays on hand',
    notes: [
      '<b>Round 5:</b> each campaign playlist has its <b>play order</b> button (shuffle, repeat all, repeat one); a choice made here applies only when it plays from this campaign. Single tracks kept on hand for the whole campaign (<b>Use in…</b> on a track) are listed under the playlists. Anything playing shows in the <b>Now playing</b> bar at the bottom, one row for each room the players hear (tagged <b>On air</b>, with Pause, Stop, Next, the play order and the room\'s volume) and one for your preview (tagged <b>Only you</b>, with its own volume). Try Preview and Play on air together.',
      '<b>Prep | Live</b> sits next to Run in the header: switch to Live and back without leaving the campaign. <b>Run next session</b> is still there.',
      'Every session now has a <b>Run</b> button, so you can run a played session again. The next session\'s is the coloured one; the others are plain grey.',
      '<b>Campaign playlists</b> and <b>Campaign pad boards</b>: each row has Preview (only you hear it), Play on air for playlists, and an arrow that shows the tracks or pads inside (closed until you open it). Pickers have the same.',
      '<b>Cleaner:</b> one line per row, one status pill per box, and a ⋯ menu on each row for Open, Remove and moving. Hover a playlist or session name for its details.',
      '<b>Obsidian</b> (folded, at the bottom right) keeps a vault, campaign note and session notes folder for later. Open in Obsidian is greyed out until Lyre can do it.'
    ],
    render: function (p) {
      var c = L.campaign(p.cid);
      if (!c) return '<div class="viewhead"><h1>Campaign not found</h1></div><div class="empty"><a href="#/campaigns">Back to Campaigns</a></div>';
      var nx = nextSession(c), forced = L.state.theme !== 'campaign';
      var head = '<div class="viewhead"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/campaigns" data-k="crumb-c">Campaigns</a><span class="sep" aria-hidden="true">›</span></nav>' +
        '<h1>' + esc(c.name || 'Untitled campaign') + '</h1><span class="grow"></span>' +
        L.modeSwitch(c.id) + (nx ? '<button class="btn primary" data-act="cprun" data-cid="' + c.id + '" data-sid="' + nx.id + '" data-k="hrun">' + L.icon('broadcast', 's') + 'Run next session <span class="cp-btnsub">S' + nx.n + '</span></button>' : '') + '</div>';
      var details = '<div class="cp-details">' +
        '<div class="field cp-f-name"><label for="cp-c-name">Name</label><input class="input" id="cp-c-name" data-input="cpcamp" data-f="name" data-k="c-name" value="' + esc(c.name) + '" autocomplete="off"></div>' +
        '<div class="field cp-f-sys"><label for="cp-c-sys">Game system</label><input class="input" id="cp-c-sys" list="cp-systems-c" data-input="cpcamp" data-f="system" data-k="c-sys" value="' + esc(c.system) + '" autocomplete="off">' +
        '<datalist id="cp-systems-c">' + SYSTEMS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>' +
        '<div class="field cp-f-theme"><label for="cp-c-theme">Theme</label><select class="input" id="cp-c-theme" data-input="cpcamp" data-f="theme" data-k="c-theme"' + (forced ? ' aria-describedby="cp-forced"' : '') + '>' +
        L.THEMES.slice(1).map(function (t) { return '<option value="' + t[0] + '"' + (c.theme === t[0] ? ' selected' : '') + '>' + esc(themeName(t[0])) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field cp-f-blurb"><label for="cp-c-blurb">Description</label><input class="input" id="cp-c-blurb" data-input="cpcamp" data-f="blurb" data-k="c-blurb" value="' + esc(c.blurb) + '" autocomplete="off"></div>' +
        (forced ? '<p class="hint cp-forced" id="cp-forced">The prototype strip is showing every page in ' + esc(themeName(L.state.theme)) + '. Choose "Each campaign\'s own" there to see this campaign\'s theme.</p>' : '') + '</div>';

      var played = c.sessions.filter(function (s) { return s.status === 'played'; }).length;
      var sessions = L.pane({ id: 'cp-sessions', title: 'Sessions', icon: 'scroll', kind: 'scenes',
        status: { text: c.sessions.length ? plural(c.sessions.length, 'session') : 'Empty', tone: 'idle' },
        actions: '<button class="btn s" data-act="cpnewsession" data-k="newsession">' + L.icon('plus', 's') + 'New session</button>',
        body: c.sessions.length ? '<ol class="list cp-slist" aria-label="Sessions in order">' + c.sessions.map(function (s, i) { return sessionRow(c, s, i); }).join('') + '</ol>' : '<p class="cp-none">No sessions yet.</p>', flush: true, scroll: 'cp-sessions' });
      var notes = L.pane({ id: 'cp-notes', title: 'Notes', icon: 'edit', size: 'auto', kind: 'plain',
        status: { text: c.notes ? 'Saved' : 'Empty', tone: 'idle' },
        body: '<label class="sr-only" for="cp-c-notes">Campaign notes</label><textarea class="input cp-notes" id="cp-c-notes" data-input="cpcampnotes" data-k="c-notes" rows="4" placeholder="Anything to remember across sessions">' + esc(c.notes || '') + '</textarea>' });
      var cpl = assignedPane({ id: 'cp-cpl', title: 'Campaign playlists', kind: 'pl', scope: 'c', ids: c.playlists, tracks: c.tracks, why: 'In every session.' });
      var cbd = assignedPane({ id: 'cp-cbd', title: 'Campaign pad boards', kind: 'bd', scope: 'c', ids: c.boards, why: 'In every session.' });
      var ob = c.obsidian || {};
      var obs = L.pane({ id: 'cp-obs', title: 'Obsidian', icon: 'link', size: 'auto', collapsed: true, kind: 'plain', status: { text: 'Coming later', tone: 'idle' },
        body: '<p class="hint cp-why">Placeholders; nothing connects yet.</p>' + obsFields('cp-c-o-', ob, 'cpobs') });
      return head + '<div class="viewbody fill cp-body">' + details +
        '<div class="cp-split"><div class="' + colClass(['cp-sessions', 'cp-notes']) + '">' + sessions + notes + '</div>' +
        '<div class="' + colClass(['cp-cpl', 'cp-cbd', 'cp-obs']) + ' cp-side">' + cpl + cbd + obs + '</div></div></div>';
    },
    after: afterRender
  });
  L.inputs.cpcampnotes = function (el) { ctx().c.notes = el.value; var st = el.closest('.pane').querySelector('.pane-status'); if (st) st.textContent = el.value ? 'Saved' : 'Empty'; };

  /* ======================================================================
     3. Session page: the planner
     ====================================================================== */
  function chipLink(it, ks) {
    if (!it) return '';
    return '<a class="chip cp-chip" href="' + it.href + '" data-k="ch-' + it.id + ks + '" title="' + esc(it.label + ': ' + it.name) + '"><span class="lane-dot ' + it.cls + '" aria-hidden="true"></span><span class="ellipsis">' + esc(it.name) + '</span></a>';
  }
  // Folded card: one chip only (what starts the scene). The rest is in the card's tooltip and in the open scene.
  function sceneTip(sc) {
    var items = L.sceneItems(sc), bds = L.sceneBoards(sc), amb = sc.amb && info(sc.amb);
    return [sc.when ? 'Starts when: ' + sc.when : 'No Starts when line yet',
      'Music: ' + (items.length ? items.map(function (x) { return info(x.id).name; }).join(', ') : 'none'),
      'Ambience: ' + (amb ? amb.name : 'none'),
      'Pad boards: ' + (bds.length ? bds.map(function (b) { return (L.board(b) || {}).name; }).join(', ') : 'none')].join('\n');
  }
  function sceneChip(sc) {
    var items = L.sceneItems(sc);
    if (!items.length) return '<span class="cp-empty-chip">No music</span>';
    var first = info(items[0].id); if (first.kind === 'track') first.name = L.nameIn(first.obj, sceneKey(sc));
    return chipLink(first, '-' + sc.id + '-s') + (items.length > 1 ? '<span class="cp-more" title="' + plural(items.length - 1, 'more music item') + '">+' + (items.length - 1) + ' more</span>' : '');
  }
  // One row in an ordered list of a scene: music items (list 'music') or pad boards (list 'boards').
  // One line: number, kind dot, name; Preview, Play on air, then ⋯ (move, audio profile, open, remove).
  // A track shows the scene's name for it (DAT-14; its own name on hover), its tags (ORG-11) and a button to its waveform,
  // end and fades in this scene (PLY-14); a playlist shows its play order in this scene (PLY-13).
  function itemRow(sc, list, it, i, n, firstTag) {
    var xk = 'cp-' + sc.id + ':' + list + ':' + it.id, k = sc.id + '-' + list + '-' + it.id, key = sceneKey(sc);
    var isTrack = list === 'music' && it.kind === 'track', own = isTrack ? L.title(it.obj) : it.name, shown = isTrack ? L.nameIn(it.obj, key) : it.name, nm = esc(shown);
    return '<li class="cp-it' + (i === 0 ? ' first' : '') + '"><div class="cp-it-row">' + xpBtn(it, xk) +
      '<span class="num cp-it-n" aria-hidden="true">' + (i + 1) + '</span>' +
      '<span class="lane-dot ' + it.cls + '" aria-hidden="true"></span>' +
      (isTrack ? '<span class="cp-it-main">' : '') +
      '<a class="ellipsis grow cp-it-name" href="' + it.href + '" data-k="in-' + k + '" title="' + esc((shown !== own ? shown + ' (in this scene) · its own name: ' + own : shown) + ' · ' + it.label + ' · ' + it.sub) + '">' + nm + '<span class="sr-only"> (' + esc(it.label) + ')</span></a>' +
      (isTrack ? '<span class="cp-it-sub">' + (shown !== own ? '<span class="cp-scname-mark" title="Named for this scene">' + L.icon('tag', 's') + '<span class="ellipsis">' + esc(own) + '</span><span class="sr-only">: its own name</span></span>' : '') + L.tagStrip(it.obj, 3) + '</span></span>' : '') +
      (i === 0 ? '<span class="cp-firsttag">' + firstTag + '</span>' : '') + ownMark(sc, list, it) +
      L.previewButton(it.kind, it.id) + (it.kind !== 'board' ? L.playOnAirButton(it.kind, it.id) : '') +
      (it.kind === 'playlist' && list === 'music' ? L.orderButton(it.id, key) : '') +
      (isTrack && L.profileLink ? '<a class="btn s icon cp-prof" href="#/profile/' + it.id + '/' + key + '" data-k="prof-' + k + '" title="Waveform, end and fades of ' + esc(shown) + ' in this scene" aria-label="Waveform, end and fades in this scene: ' + nm + '">' + L.icon('wave', 's') + '</a>' : '') +
      moreBtn('im-' + k, nm, 'data-menu="item" data-list="' + list + '" data-sc="' + sc.id + '" data-idx="' + i + '"') +
      '</div>' + xpBody(it, xk, list === 'music' ? sceneKey(sc) : '') + '</li>';
  }
  function sceneKey(sc) { var x = ctx(); return 'sc:' + x.c.id + ':' + x.s.id + ':' + sc.id; }
  // A small marker when a track has its own audio settings in this scene; the Audio profile link is in the row's ⋯ menu.
  function ownMark(sc, list, it) {
    if (list !== 'music' || it.kind !== 'track' || !L.profileWhere || L.profileWhere(it.obj, sceneKey(sc)) !== 'scene') return '';
    return '<span class="cp-own" title="Has its own audio settings in this scene">' + L.icon('wave', 's') + '<span class="sr-only">Own audio settings in this scene</span></span>';
  }
  function musicList(sc) {
    var items = L.sceneItems(sc);
    return '<div class="cp-box" data-filedrop="music" data-sc="' + sc.id + '" title="Drop audio files or folders here to add them">' +
      (items.length ? '<ol class="cp-items" aria-label="Music in order">' + items.map(function (x, i) { return itemRow(sc, 'music', info(x.id), i, items.length, 'Starts the scene'); }).join('') + '</ol>'
        : '<p class="faint cp-mnone">No music yet. The first item you add starts the scene.</p>') +
      '<div class="cp-boxbtns"><button class="btn s" data-act="cpaddmusic" data-sc="' + sc.id + '" data-k="am-' + sc.id + '" title="Plays in order; drop audio files on the box to add them">' + L.icon('plus', 's') + 'Add tracks or playlists…</button></div></div>';
  }
  function boardList(sc) {
    var bds = L.sceneBoards(sc).filter(function (b) { return L.board(b); });
    return '<div class="cp-box">' +
      (bds.length ? '<ol class="cp-items" aria-label="Pad boards in order">' + bds.map(function (b, i) { return itemRow(sc, 'boards', info(b, true), i, bds.length, 'Shown first'); }).join('') + '</ol>'
        : '<p class="faint cp-mnone">No pad boards yet.</p>') +
      '<div class="cp-boxbtns"><button class="btn s" data-act="cpaddboards" data-sc="' + sc.id + '" data-k="ab-' + sc.id + '" aria-label="Add pad boards… to ' + esc(sc.name) + '" title="The first board shows when the scene starts">' + L.icon('plus', 's') + 'Add pad boards…</button></div></div>';
  }
  function ambSlot(sc) {
    var it = sc.amb ? info(sc.amb) : null, xk = 'cp-' + sc.id + ':amb:' + (it ? it.id : '');
    if (!it) return '<div class="cp-box cp-amb" data-filedrop="amb" data-sc="' + sc.id + '" title="Choose, or drop an audio file here"><div class="cp-it-row"><span class="faint grow">No ambience</span><button class="btn s" data-act="cppickamb" data-sc="' + sc.id + '" data-k="pa-' + sc.id + '">' + L.icon('plus', 's') + 'Choose…</button></div></div>';
    return '<div class="cp-box cp-amb" data-filedrop="amb" data-sc="' + sc.id + '" title="Change, or drop an audio file here"><div class="cp-it-row">' + xpBtn(it, xk) + '<span class="lane-dot ' + it.cls + '" aria-hidden="true"></span>' +
      '<a class="ellipsis grow cp-it-name" href="' + it.href + '" data-k="an-' + sc.id + '" title="' + esc(it.name + ' · ' + it.label + ' · ' + it.sub) + '">' + esc(it.name) + '</a>' +
      '<button class="btn s" data-act="cppickamb" data-sc="' + sc.id + '" data-k="pa-' + sc.id + '">Change…</button>' +
      L.previewButton(it.kind, it.id) + L.playOnAirButton(it.kind, it.id) +
      moreBtn('ma-' + sc.id, esc(it.name), 'data-menu="amb" data-sc="' + sc.id + '"') + '</div>' + xpBody(it, xk) + '</div>';
  }
  function sceneCard(s, sc, i) {
    var isOpen = !!open[sc.id], nm = esc(sc.name || 'Untitled scene');
    var head = '<div class="cp-scene-head">' +
      '<span class="cp-handle" title="Drag to reorder" aria-hidden="true">' + L.icon('drag', 's') + '</span>' +
      '<button class="cp-scene-toggle" data-act="cpscene" data-id="' + sc.id + '" data-k="sct-' + sc.id + '" aria-expanded="' + isOpen + '" aria-controls="scb-' + sc.id + '"' + (isOpen ? '' : ' title="' + esc(sceneTip(sc)) + '"') + '>' +
      L.icon('chevdown', 's chev') + '<span class="num cp-scn" aria-hidden="true">' + (i + 1) + '</span><span class="ellipsis cp-scname"><span class="sr-only">Scene ' + (i + 1) + ': </span>' + nm + '</span></button>' +
      (isOpen ? '' : '<span class="cp-scchip">' + sceneChip(sc) + '</span>') +
      '<button class="closer" data-act="cpscmenu" data-id="' + sc.id + '" data-idx="' + i + '" data-k="scm-' + sc.id + '" title="More for this scene" aria-label="More for ' + nm + '" aria-haspopup="menu" aria-expanded="false">' + L.icon('more') + '</button></div>';
    if (!isOpen) return '<li class="cp-scene" data-drag="scenes" data-filedrop="music" data-sc="' + sc.id + '" data-idx="' + i + '" aria-label="Scene ' + (i + 1) + ': ' + nm + '">' + head + '</li>';
    var f = 'sc' + sc.id;
    var body = '<div class="cp-scene-body" id="scb-' + sc.id + '">' +
      '<div class="field"><label for="' + f + 'n">Name</label><input class="input" id="' + f + 'n" data-input="cpscf" data-f="name" data-sc="' + sc.id + '" data-k="scname-' + sc.id + '" value="' + esc(sc.name) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="' + f + 'w">Starts when</label><input class="input" id="' + f + 'w" data-input="cpscf" data-f="when" data-sc="' + sc.id + '" data-k="scwhen-' + sc.id + '" value="' + esc(sc.when) + '" placeholder="The moment in the story" autocomplete="off"></div>' +
      '<div class="field cp-span" role="group" aria-labelledby="' + f + 'm"><span class="label" id="' + f + 'm">Music</span>' + musicList(sc) + '</div>' +
      '<div class="field cp-span" role="group" aria-labelledby="' + f + 'a"><span class="label" id="' + f + 'a">Ambience</span>' + ambSlot(sc) + '</div>' +
      '<div class="field cp-span" role="group" aria-labelledby="' + f + 'b"><span class="label" id="' + f + 'b">Pad boards</span>' + boardList(sc) + '</div>' +
      '<div class="field"><label for="' + f + 'x">Notes</label><textarea class="input" id="' + f + 'x" rows="2" data-input="cpscf" data-f="notes" data-sc="' + sc.id + '" data-k="scnotes-' + sc.id + '" placeholder="Reminders for this scene">' + esc(sc.notes) + '</textarea></div>' +
      '<div class="field cp-obsfield"><label for="' + f + 'o">Note link <span class="cp-later">Coming later</span></label><input class="input" id="' + f + 'o" data-input="cpscf" data-f="noteLink" data-sc="' + sc.id + '" data-k="scnote-' + sc.id + '" value="' + esc(sc.noteLink || '') + '" placeholder="Optional: an Obsidian note" title="Kept for later; Lyre does not open Obsidian notes yet" autocomplete="off"></div></div>';
    return '<li class="cp-scene open" data-drag="scenes" data-idx="' + i + '" aria-label="Scene ' + (i + 1) + ': ' + nm + '">' + head + body + '</li>';
  }
  /* ⋯ menus for rows: assigned playlists and boards, scene music and board items, the ambience slot. */
  L.acts.cprowmenu = function (el) {
    var d = el.dataset, h = '';
    function item(act, label, icon, extra) { return '<button role="menuitem" data-act="' + act + '" ' + (extra || '') + '>' + L.icon(icon) + label + '</button>'; }
    if (d.menu === 'assigned') {
      var where = d.scope === 'c' ? 'campaign' : 'session';
      h = item('cpgo', 'Open', 'right', 'data-href="' + (d.kind === 'pl' ? '#/playlist/' : d.kind === 'tr' ? '#/library/' : '#/board/') + d.id + '"') +
        (d.kind === 'tr' && d.scope === 's' ? item('cpgo', 'Waveform, end and fades in this session', 'wave', 'data-href="#/profile/' + d.id + '/' + scopeKey('s') + '"') : '') +
        (d.kind === 'tr' ? item('cpusein', 'Use in…', 'link', 'data-id="' + d.id + '"') : '') + '<div class="sep"></div>' +
        item('cprm', 'Remove from this ' + where, 'close', 'data-scope="' + d.scope + '" data-kind="' + d.kind + '" data-id="' + d.id + '" data-k="rm-' + d.scope + d.kind + d.id + '"');
    } else if (d.menu === 'item') {
      var x = findScene(d.sc), arr = d.list === 'boards' ? L.sceneBoards(x.sc) : x.sc.music, i = +d.idx, it = info(arr[i], d.list === 'boards');
      var data = 'data-list="' + d.list + '" data-sc="' + d.sc + '" data-idx="' + i + '"';
      h = (i > 0 ? item('cpitem', d.list === 'boards' ? 'Show it first' : 'Start the scene with it', 'play', 'data-op="first" ' + data) : '') +
        (i > 0 ? item('cpitem', 'Move up', 'chevup', 'data-op="up" ' + data) : '') + (i < arr.length - 1 ? item('cpitem', 'Move down', 'chevdown', 'data-op="down" ' + data) : '') +
        (d.list === 'music' && it.kind === 'track' && L.profileLink ? item('cpgo', 'Audio profile in this scene', 'wave', 'data-href="#/profile/' + it.id + '/' + sceneKey(x.sc) + '"') : '') +
        (d.list === 'music' && it.kind === 'track' ? item('cpname', 'Name in this scene…', 'tag', 'data-sc="' + d.sc + '" data-id="' + it.id + '"') + item('cpusein', 'Use in…', 'link', 'data-id="' + it.id + '"') : '') +
        item('cpgo', 'Open', 'right', 'data-href="' + it.href + '"') + '<div class="sep"></div>' +
        item('cpitem', 'Remove from this scene', 'close', 'data-op="remove" ' + data);
    } else if (d.menu === 'amb') {
      var y = findScene(d.sc), a = info(y.sc.amb);
      h = item('cppickamb', 'Change…', 'edit', 'data-sc="' + d.sc + '"') + item('cpgo', 'Open', 'right', 'data-href="' + a.href + '"') + '<div class="sep"></div>' +
        item('cpclearamb', 'Remove from this scene', 'close', 'data-sc="' + d.sc + '"');
    }
    L.menu(el, h, 'Actions');
  };
  L.acts.cpgo = function (el) { L.route(el.dataset.href); };
  L.acts.cpusein = function (el) { L.assignSheet('track', el.dataset.id); };
  // DAT-14: a name for a track in this scene only ("Strahd's entrance"); empty uses its own name.
  L.acts.cpname = function (el) {
    var x = findScene(el.dataset.sc), t = L.track(el.dataset.id); if (!x || !t) return; var key = sceneKey(x.sc);
    L.sheet({ title: 'Name in this scene', body: '<div class="field"><label for="cp-nmin">Name in "' + esc(x.sc.name) + '"</label><input class="input" id="cp-nmin" data-k="cp-nmin" value="' + esc(L.sceneNameOf(t, key)) + '" placeholder="' + esc(L.title(t)) + '" autocomplete="off"></div>' +
      '<p class="hint" style="margin-top:6px">Shown in this scene, in Live and in the Now playing bar. Everywhere else it keeps its own name: <b>' + esc(L.title(t)) + '</b>. Leave it empty to use its own name here too.</p>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="cpnamesave" data-sc="' + x.sc.id + '" data-id="' + t.id + '">Save</button>' });
  };
  L.acts.cpnamesave = function (el) {
    var x = findScene(el.dataset.sc), t = L.track(el.dataset.id), v = (document.getElementById('cp-nmin') || {}).value || '';
    L.setNameIn(t, sceneKey(x.sc), v); focusK = 'in-' + x.sc.id + '-music-' + t.id; L.closeSheet(); L.render();
    L.say(v.trim() ? 'In this scene it is now called ' + v.trim() : 'It uses its own name in this scene');
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'cp-nmin') { e.preventDefault(); var b = document.querySelector('[data-act="cpnamesave"]'); if (b) b.click(); } });
  function findScene(id) { var s = ctx().s; for (var i = 0; i < s.scenes.length; i++) if (s.scenes[i].id === id) return { s: s, sc: s.scenes[i], i: i }; return null; }

  L.acts.cpscene = function (el) { var id = el.dataset.id; open[id] = !open[id]; current = id; L.render(); };
  L.acts.cpallscenes = function () { var s = ctx().s, any = s.scenes.some(function (sc) { return !open[sc.id]; }); s.scenes.forEach(function (sc) { open[sc.id] = any; }); L.render(); L.say(any ? 'All scenes open' : 'All scenes folded'); };
  L.inputs.cpscf = function (el) { var x = findScene(el.dataset.sc); if (!x) return; x.sc[el.dataset.f] = el.value; current = x.sc.id; if (el.dataset.f === 'name') L.render(); };
  function itemName(id, list) { var it = info(id, list === 'boards'); return it ? it.name : 'item'; }
  L.acts.cpitem = function (el) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    var x = findScene(el.dataset.sc), list = el.dataset.list; if (!x) return; current = x.sc.id;
    if (list === 'boards' && !x.sc.boards) x.sc.boards = L.sceneBoards(x.sc).slice();
    var arr = x.sc[list], i = +el.dataset.idx, id = arr[i], nm = itemName(id, list), lead = list === 'boards' ? ' now shows first' : ' now starts the scene';
    if (el.dataset.op === 'remove') {
      arr.splice(i, 1);
      focusK = arr.length ? 'im-' + x.sc.id + '-' + list + '-' + arr[Math.min(i, arr.length - 1)] : (list === 'boards' ? 'ab-' : 'am-') + x.sc.id;
      L.render(); L.say('Removed ' + nm + ' from this scene' + (i === 0 && arr.length ? '. ' + itemName(arr[0], list) + lead : '')); return;
    }
    var to = el.dataset.op === 'first' ? 0 : el.dataset.op === 'up' ? i - 1 : i + 1; if (to < 0 || to >= arr.length) return;
    arr.splice(i, 1); arr.splice(to, 0, id); focusK = 'im-' + x.sc.id + '-' + list + '-' + id; L.render();
    L.say(to === 0 ? nm + lead : nm + ' moved to position ' + (to + 1) + ' of ' + arr.length + (i === 0 ? '. ' + itemName(arr[0], list) + lead : ''));
  };
  L.acts.cpaddmusic = function (el) {
    var x = findScene(el.dataset.sc), m = x.sc.music; current = x.sc.id;
    L.pickSceneMusic({ title: 'Music for "' + (x.sc.name || 'this scene') + '"', selected: m,
      onDone: function (ids) {
        m.length = 0; ids.forEach(function (id) { m.push(id); }); focusK = 'am-' + x.sc.id;
        L.say(plural(m.length, 'music item') + ' in this scene' + (m.length ? '; ' + itemName(m[0]) + ' starts it' : ''));
      } });
  };
  L.acts.cpaddboards = function (el) {
    var x = findScene(el.dataset.sc); current = x.sc.id; if (!x.sc.boards) x.sc.boards = L.sceneBoards(x.sc).slice();
    var b = x.sc.boards;
    L.pickBoards({ title: 'Pad boards for "' + (x.sc.name || 'this scene') + '"', selected: b, multi: true,
      intro: 'Tick the boards to have in this scene. New ones are added at the end; the first one shows when the scene starts.',
      onDone: function (ids) {
        var keep = b.filter(function (id) { return ids.indexOf(id) > -1; }), added = ids.filter(function (id) { return b.indexOf(id) < 0; });
        b.length = 0; keep.concat(added).forEach(function (id) { b.push(id); }); focusK = 'ab-' + x.sc.id;
        L.say(plural(b.length, 'pad board') + ' in this scene' + (b.length ? '; ' + L.board(b[0]).name + ' shows first' : ''));
      } });
  };
  L.acts.cppickamb = function (el) {
    var x = findScene(el.dataset.sc); current = x.sc.id;
    L.pickAmbience({ title: 'Ambience for "' + (x.sc.name || 'this scene') + '"', selected: x.sc.amb ? [x.sc.amb] : [],
      onDone: function (ids) { focusK = 'pa-' + x.sc.id; if (ids[0]) { x.sc.amb = ids[0]; L.say('Ambience for this scene: ' + itemName(ids[0])); } } });
  };
  L.acts.cpclearamb = function (el) { var x = findScene(el.dataset.sc); x.sc.amb = ''; focusK = 'pa-' + x.sc.id; L.render(); L.say('No ambience in this scene'); };
  function addSceneAfter(afterId) {
    var s = ctx().s, at = s.scenes.length;
    if (afterId) for (var i = 0; i < s.scenes.length; i++) if (s.scenes[i].id === afterId) at = i + 1;
    var sc = blankScene(); s.scenes.splice(at, 0, sc); open[sc.id] = true; current = sc.id; focusK = 'scname-' + sc.id;
    L.render(); var f = document.querySelector('[data-k="scname-' + sc.id + '"]'); if (f) f.select();
    L.say('New scene added as scene ' + (at + 1) + ' of ' + s.scenes.length);
  }
  L.acts.cpaddscene = function (el) { addSceneAfter(el.dataset.id || (current && findScene(current) ? current : null)); };
  L.acts.cpscmenu = function (el) {
    var id = el.dataset.id, i = +el.dataset.idx, n = ctx().s.scenes.length, mv = 'data-list="scenes" data-idx="' + i + '" data-fk="scm-' + id + '"';
    L.menu(el, (i > 0 ? '<button role="menuitem" data-act="cpmove" data-dir="-1" ' + mv + '>' + L.icon('chevup') + 'Move up</button>' : '') +
      (i < n - 1 ? '<button role="menuitem" data-act="cpmove" data-dir="1" ' + mv + '>' + L.icon('chevdown') + 'Move down</button>' : '') +
      '<button role="menuitem" data-act="cpaddscene" data-id="' + id + '">' + L.icon('plus') + 'Add a scene after this one</button>' +
      '<button role="menuitem" data-act="cpdup" data-id="' + id + '">' + L.icon('queue') + 'Duplicate</button><div class="sep"></div>' +
      '<button role="menuitem" data-act="cpdelask" data-id="' + id + '" class="cp-danger">' + L.icon('trash') + 'Delete…</button>', 'Scene actions');
  };
  L.acts.cpdup = function (el) {
    var x = findScene(el.dataset.id); if (!x) return;
    var c = JSON.parse(JSON.stringify(x.sc)); c.id = L.uid('sc'); c.name = (x.sc.name || 'Scene') + ' (copy)';
    x.s.scenes.splice(x.i + 1, 0, c); current = c.id; focusK = 'sct-' + c.id; L.render(); L.say('Duplicated as scene ' + (x.i + 2) + ': ' + c.name);
  };
  L.acts.cpdelask = function (el) {
    var x = findScene(el.dataset.id); if (!x) return;
    L.sheet({ title: 'Delete this scene?', body: '<p>Delete scene ' + (x.i + 1) + ', <b>' + esc(x.sc.name || 'Untitled scene') + '</b>, and its notes? Its tracks, playlists and pad boards stay in your library.</p>',
      footer: '<button class="btn" data-act="closesheet">Keep it</button><button class="btn danger" data-act="cpdel" data-id="' + x.sc.id + '">' + L.icon('trash', 's') + 'Delete scene</button>' });
  };
  L.acts.cpdel = function (el) {
    var x = findScene(el.dataset.id); L.closeSheet(); if (!x) return;
    L.undoNote('Deleted scene "' + (x.sc.name || 'Untitled scene') + '" and its notes.', L.snapshot(['campaigns']));
    x.s.scenes.splice(x.i, 1); delete open[x.sc.id];
    var nb = x.s.scenes[Math.max(0, x.i - 1)]; focusK = nb ? 'sct-' + nb.id : 'addscene'; current = nb ? nb.id : null;
    L.render();
  };
  L.inputs.cpsess = function (el) {
    var x = ctx(), s = x.s, f = el.dataset.f;
    if (f === 'status') {
      var idx = x.c.sessions.indexOf(s);
      if (el.value === 'next') x.c.sessions.forEach(function (o, j) { if (o !== s && o.status === 'next') o.status = j < idx ? 'played' : 'draft'; });
      s.status = el.value; L.say('Session ' + s.n + ' is now ' + STATUS[s.status]);
    } else s[f] = el.value;
    L.render();
  };
  L.acts.cprunthis = function () { var x = ctx(); run(x.c.id, x.s.id); };

  L.view('session', {
    nav: 'campaigns',
    title: function (p) { var s = L.session(p.cid, p.sid); return s ? 'Session ' + s.n : 'Session'; },
    notesTitle: 'Session planner: scenes and playlists',
    notes: [
      '<b>Round 5</b>, open <b>The abbey ruins</b> and <b>Aftermath</b>: tracks show their <b>tags</b> and <b>shape</b> under the name; a track can have a <b>name in this scene</b> (⋯ › Name in this scene…; Aftermath calls t07 "Dawn over the abbey"); the wave button opens its <b>waveform, end and fades for this scene</b>, and Back returns here. Playlists have a <b>play order</b> button that applies only in this scene (Abbey: eerie is shuffled here). <b>Add tracks or playlists…</b>: open a playlist to tick single tracks.',
      'A scene\'s <b>Music</b> is now one ordered list of <b>tracks and playlists in any mix</b>: slot a track between playlists, or use only one kind. It plays from the top and loops; the first item starts the scene, and in play you can start any item. Open <b>The abbey ruins</b> to see one.',
      '<b>Add tracks or playlists…</b> opens a picker with Preview on every row and an arrow to see a playlist\'s tracks before you add it. Move, remove, open and the Audio profile are in each row\'s ⋯ menu.',
      '<b>Ambience</b> can be one track or an ambience playlist, with Preview. <b>Pad boards</b>: a scene can have several; the first shows when the scene starts, and each one can be previewed and opened to see its pads.',
      '<b>Cleaner:</b> every box has a coloured top edge for its purpose (blue music, lime pads, accent for plans) and one status pill (e.g. "6 scenes", "Coming later"). Folded scenes show one line and one chip; hover the scene name for its Starts when, ambience and boards. Rows show Preview and Play on air, then ⋯ for the rest.',
      '<b>Prep | Live</b> and <b>Run this session</b> are both in the header.',
      'Obsidian placeholders (coming later): a <b>Session note</b> in the folded Obsidian pane, and an optional <b>Note link</b> per scene.'
    ],
    render: function (p) {
      var c = L.campaign(p.cid), s = c && L.session(p.cid, p.sid);
      // Back from a track's audio settings in a scene opens that scene again, with focus on the track.
      if (L.state.openScene && s) { var back = L.state.openScene; L.state.openScene = null; if (s.scenes.some(function (x) { return x.id === back.sc; })) { open[back.sc] = true; current = back.sc; focusK = back.k || 'sct-' + back.sc; } }
      if (!s) return '<div class="viewhead"><h1>Session not found</h1></div><div class="empty"><a href="#/campaigns">Back to Campaigns</a></div>';
      var head = '<div class="viewhead"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/campaigns" data-k="crumb-c">Campaigns</a><span class="sep" aria-hidden="true">›</span>' +
        '<a href="#/campaign/' + c.id + '" data-k="crumb-cp">' + esc(c.name) + '</a><span class="sep" aria-hidden="true">›</span></nav>' +
        '<h1>' + esc(sLabel(s)) + '</h1>' + statusBadge(s.status) + '<span class="grow"></span>' + L.modeSwitch(c.id) +
        '<button class="btn' + (s.status === 'next' ? ' primary' : '') + '" data-act="cprunthis" data-k="runthis">' + L.icon('broadcast', 's') + 'Run this session</button></div>';
      var details = '<div class="cp-details cp-sdetails">' +
        '<div class="field cp-f-name"><label for="cp-s-name">Session name</label><input class="input" id="cp-s-name" data-input="cpsess" data-f="name" data-k="s-name" value="' + esc(s.name) + '" placeholder="Name this session" autocomplete="off"></div>' +
        '<div class="field cp-f-date"><label for="cp-s-date">Date</label><input class="input" type="date" id="cp-s-date" data-input="cpsess" data-f="date" data-k="s-date" value="' + esc(s.date) + '"></div>' +
        '<div class="field cp-f-status"><label for="cp-s-status">Status</label><select class="input" id="cp-s-status" data-input="cpsess" data-f="status" data-k="s-status">' +
        ['played', 'next', 'draft'].map(function (k) { return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select></div>' +
        // Round 6: how Live's lists are ordered is read out here and lives in the guide; it is not needed while planning.
        '<p class="sr-only">In play: this scene\'s music first, then this session\'s, then the campaign\'s, then the whole library.</p></div>';
      var allOpen = s.scenes.length && s.scenes.every(function (sc) { return open[sc.id]; });
      var scenes = L.pane({ id: 'ss-scenes', title: 'Scenes', icon: 'map', kind: 'scenes',
        status: { text: s.scenes.length ? plural(s.scenes.length, 'scene') : 'Empty', tone: 'idle' },
        actions: (s.scenes.length ? '<button class="closer" data-act="cpallscenes" data-k="allscenes" title="' + (allOpen ? 'Fold all scenes' : 'Open all scenes') + '" aria-label="' + (allOpen ? 'Fold all scenes' : 'Open all scenes') + '">' + L.icon(allOpen ? 'chevup' : 'chevdown') + '</button>' : '') +
          '<button class="btn s" data-act="cpaddscene" data-k="addscene">' + L.icon('plus', 's') + 'Add scene</button>',
        body: s.scenes.length ? '<ol class="cp-scenes" aria-label="Scenes in order">' + s.scenes.map(function (sc, i) { return sceneCard(s, sc, i); }).join('') + '</ol>' : '<p class="cp-none">No scenes yet. Use Add scene.</p>',
        scroll: 'ss-scenes' });
      var spl = assignedPane({ id: 'ss-spl', title: 'Session playlists', kind: 'pl', scope: 's', ids: s.playlists, tracks: s.tracks, why: 'In every scene tonight.' });
      var sbd = assignedPane({ id: 'ss-sbd', title: 'Session pad boards', kind: 'bd', scope: 's', ids: s.boards, why: 'In every scene tonight.' });
      var obs = L.pane({ id: 'ss-obs', title: 'Obsidian', icon: 'link', size: 'auto', collapsed: true, kind: 'plain', status: { text: 'Coming later', tone: 'idle' },
        body: '<div class="field"><label for="cp-s-obs">Session note</label><input class="input" id="cp-s-obs" data-input="cpsess" data-f="obsidianNote" data-k="s-obs" value="' + esc(s.obsidianNote || '') + '" placeholder="' + esc(((c.obsidian || {}).sessions || 'Sessions') + '/Session ' + s.n + '.md') + '" autocomplete="off"></div>' + obsButton('cp-s-o-') });
      var cbNames = c.boards.map(function (b) { var x = L.board(b); return x ? x.name : ''; }).filter(Boolean);
      // Round 6: Change sits where the other boxes have Add, as an icon link to the campaign.
      var cpl = L.pane({ id: 'ss-cpl', title: 'Campaign playlists', icon: 'crown', size: 'auto', kind: 'music',
        status: { text: c.playlists.length ? String(c.playlists.length) : 'Empty', tone: 'idle' },
        actions: '<a class="btn s icon" href="#/campaign/' + c.id + '" data-k="tocamp" aria-label="Change the campaign\'s playlists" title="From the campaign: change them there">' + L.icon('edit', 's') + '</a>',
        body: '' +
          assigned(c.playlists, 'pl', 'r', true, c.tracks) +
          '<p class="hint cp-make">Campaign pad boards: ' + (cbNames.length ? esc(cbNames.join(', ')) : 'none') + '.</p>' });
      return head + '<div class="viewbody fill cp-body">' + details +
        '<div class="cp-split cp-ssplit"><div class="' + colClass(['ss-scenes']) + '">' + scenes + '</div>' +
        '<div class="' + colClass(['ss-spl', 'ss-sbd', 'ss-cpl', 'ss-obs']) + ' cp-side">' + spl + sbd + cpl + obs + '</div></div></div>';
    },
    after: afterRender
  });

  function afterRender(root) {
    if (focusK) { var n = root.querySelector('[data-k="' + focusK + '"]'); focusK = null; if (n) n.focus({ preventScroll: false }); }
  }
})();
