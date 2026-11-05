/* Shared pickers and content helpers used by several views (owned by the lead).

   Listen and look before you add (Nik, round 3): every picker row for a track, playlist or pad board has a Preview
   button (only you hear it) and, for playlists and boards, an expander (closed by default) listing what is inside.

   L.pickerSheet({ title, intro, items: [{ id, label, sub, group, indent, preview, contents }], selected, multi, okLabel,
                   fold, openGroups, filters: [{ id, label, test(item) }], onDone(ids) })
     preview: { kind: 'track'|'playlist'|'board', id }   adds a Preview button
     contents: { kind: 'playlist'|'board', id }          adds an expander showing the tracks or pads
   L.pickPlaylists({ title, lane: 'music'|'amb'|null, selected, multi, onDone })
   L.pickBoards({ title, selected, multi, onDone })
   L.pickTracks({ title, kinds: ['music','amb','fx'], selected, multi, onDone })    individual tracks, filter Music/Ambience/FX
   L.pickSceneMusic({ title, selected, onDone })   tracks and playlists in one list (a scene's music mixes both)
   L.pickAmbience({ title, selected, onDone })     one ambience track or ambience playlist
   L.assignSheet(kind 'playlist'|'board', id)       "Use in…": campaigns, sessions and scenes that use it

   Building blocks for any view:
   L.previewButton(kind, id, size)  'track'|'playlist'|'pad' (id 'board/pad')|'board' (previews its first pad) -> button html
   L.playOnAirButton(kind, id)      'track'|'playlist' -> button html ("Play on air")
   L.contentsHTML(kind, id)         'playlist'|'board' -> the inside of an expander (track or pad rows with Preview)
   L.expanderButton(key, label, open) / L.expanded(key) / L.acts.xp   expander state kept per key in L.state.xp */
(function () {
  var esc = L.esc, D = L.data, pk = null;
  L.state.xp = L.state.xp || {};

  /* ---------- building blocks ---------- */
  function pvKey(kind, id) { return kind === 'track' ? id : kind === 'playlist' ? 'pl:' + id : kind === 'pad' ? 'pad:' + id : 'pad:' + id + '/' + firstPad(id); }
  function padLabel(ref) { var a = ref.split('/'), b = L.board(a[0]), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === a[1]; })[0]; return p ? p.label : ref; }
  function firstPad(bid) { var b = L.board(bid), p = b && L.boardPads(b).filter(Boolean)[0]; return p ? p.id : ''; }
  L.previewButton = function (kind, id, size) {
    var on = L.previewing(pvKey(kind, id)), name = kind === 'track' ? L.title(L.track(id)) : kind === 'playlist' ? (L.playlist(id) || {}).name : kind === 'board' ? (L.board(id) || {}).name : padLabel(id);
    return '<button type="button" class="btn s icon pv" data-act="pv" data-kind="' + kind + '" data-id="' + esc(id) + '" data-keep-menu="1" data-k="pv-' + kind + '-' + esc(id) + '" aria-pressed="' + on + '" title="' + (on ? 'Stop preview' : kind === 'board' ? 'Preview the first pad in your headphones' : 'Preview in your headphones') + '" aria-label="' + (on ? 'Stop preview of ' : kind === 'board' ? 'Preview the first pad of ' : 'Preview ') + esc(name) + '">' + L.icon(on ? 'stop' : 'headphones', 's') + '</button>';
  };
  L.acts.pv = function (el) {
    var k = el.dataset.kind, id = el.dataset.id;
    if (k === 'track') L.preview(id); else if (k === 'playlist') L.previewPlaylist(id);
    else if (k === 'pad') { var a = id.split('/'); L.previewPad(a[0], a[1]); } else if (k === 'board') L.previewPad(id, firstPad(id));
    if (pk) paintList();
    var c = document.getElementById('pk-count'); if (c && pk) c.textContent = count();
  };
  L.playOnAirButton = function (kind, id) {
    var name = kind === 'track' ? L.title(L.track(id)) : (L.playlist(id) || {}).name;
    return '<button type="button" class="btn s icon" data-act="onair" data-kind="' + kind + '" data-id="' + esc(id) + '" data-k="air-' + kind + '-' + esc(id) + '" title="Play on air (the players hear it)" aria-label="Play on air: ' + esc(name) + '">' + L.icon('broadcast', 's') + '</button>';
  };
  L.acts.onair = function (el) {
    var k = el.dataset.kind, id = el.dataset.id;
    if (k === 'track') L.play(id, { fade: 3 });
    else { var p = L.playlist(id), t0 = L.playlistTracks(p)[0]; if (t0) L.play(t0.id, { lane: p.lane, playlistId: id, fade: 3 }); else L.toast('This playlist has no tracks yet'); }
  };
  L.expanded = function (key) { return !!L.state.xp[key]; };
  L.expanderButton = function (key, label, open) {
    open = open == null ? L.expanded(key) : open;
    return '<button type="button" class="xp-btn" data-act="xp" data-key="' + esc(key) + '" data-keep-menu="1" data-k="xp-' + esc(key) + '" aria-expanded="' + open + '" title="' + (open ? 'Hide' : 'Show') + ' what is in ' + esc(label) + '" aria-label="' + (open ? 'Hide' : 'Show') + ' contents of ' + esc(label) + '">' + L.icon('chevdown', 's') + '</button>';
  };
  L.acts.xp = function (el) { var k = el.dataset.key; L.state.xp[k] = !L.state.xp[k]; if (pk && document.getElementById('pk-list') && document.getElementById('pk-list').contains(el)) { paintList(); var b = document.querySelector('#pk-list [data-key="' + k + '"]'); if (b) b.focus(); } else L.render(); };
  // profileKey (optional): the place each track's Audio profile link opens (default: this playlist).
  L.contentsHTML = function (kind, id, profileKey) {
    if (kind === 'playlist') {
      var p = L.playlist(id), ts = L.playlistTracks(p);
      if (!ts.length) return '<p class="hint">No tracks yet' + (p && p.kind === 'dynamic' ? ': no track matches its tags.' : '.') + '</p>';
      return '<ol class="list" aria-label="Tracks in ' + esc(p.name) + '">' + ts.map(function (t, i) {
        return '<li class="xp-row"><span class="faint num">' + (i + 1) + '</span><span class="grow" title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</span><span class="num faint">' + L.fmt(t.dur) + '</span>' + (L.profileLink && profileKey !== false ? L.profileLink(t.id, profileKey || 'pl:' + id, true) : '') + L.previewButton('track', t.id) + '</li>';
      }).join('') + '</ol>';
    }
    var b = L.board(id); if (!b) return '';
    var pads = L.boardPads(b).filter(Boolean);
    return '<p class="hint">' + b.cols + ' × ' + b.rows + ' grid, ' + pads.length + ' pads' + (b.spare.length ? ', ' + b.spare.length + ' spare' : '') + '</p><ul class="list" aria-label="Pads on ' + esc(b.name) + '">' + pads.map(function (p) {
      return '<li class="xp-row"><span class="lane-dot" style="background:' + (L.colors[p.color] || 'var(--fx)') + '"></span>' + L.icon(p.icon, 's') + '<span class="grow">' + esc(p.label) + '</span>' + (p.key ? '<span class="kbd">' + esc(p.key.toUpperCase()) + '</span>' : '') + '<span class="hint">' + esc(L.modeName[p.mode]) + '</span>' + L.previewButton('pad', b.id + '/' + p.id) + '</li>';
    }).join('') + '</ul>';
  };

  /* ---------- picker sheet ---------- */
  function visible(it) {
    var q = (pk.q || '').toLowerCase();
    if (q && (it.label + ' ' + (it.sub || '') + ' ' + (it.search || '')).toLowerCase().indexOf(q) < 0) return false;
    var f = pk.filters && pk.filters.filter(function (x) { return x.id === pk.filter; })[0];
    return !f || f.test(it);
  }
  function itemHTML(it) {
    var on = pk.sel.indexOf(it.id) > -1, xk = it.contents ? 'pk:' + it.contents.kind + ':' + it.contents.id : '';
    var row = '<div class="pk-row">' + (it.contents ? L.expanderButton(xk, it.label) : '<span style="width:24px;flex:none"></span>') +
      '<label class="pk-item' + (it.indent ? ' indent' : '') + '"><input type="' + (pk.multi ? 'checkbox' : 'radio') + '" name="pk" data-input="pkpick" value="' + esc(it.id) + '"' + (on ? ' checked' : '') + '>' +
      '<span class="grow"><span class="ellipsis" style="display:block">' + esc(it.label) + '</span>' + (it.sub ? '<span class="hint ellipsis" style="display:block">' + esc(it.sub) + '</span>' : '') + '</span></label>' +
      (it.preview ? L.previewButton(it.preview.kind, it.preview.id) : '') + '</div>';
    return row + (it.contents && L.expanded(xk) ? '<div class="xp-body">' + L.contentsHTML(it.contents.kind, it.contents.id, false) + '</div>' : '');
  }
  function list() {
    var groups = {}, order = [], q = pk.q;
    pk.items.forEach(function (it) { if (!visible(it)) return; var g = it.group || ''; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(it); });
    if (!order.length) return '<p class="empty">Nothing matches' + (q ? ' "' + esc(q) + '"' : ' this filter') + '.</p>';
    return order.map(function (g) {
      var open = !pk.fold || q || pk.open[g];
      var head = !g ? '' : pk.fold
        ? '<button type="button" class="pk-groupbtn" data-act="pkgroup" data-keep-menu="1" data-g="' + esc(g) + '" aria-expanded="' + !!open + '">' + L.icon('chevdown', 's') + esc(g) +
          '<span class="hint" style="margin-left:auto">' + groups[g].filter(function (it) { return pk.sel.indexOf(it.id) > -1; }).length + ' ticked</span></button>'
        : '<div class="pk-group">' + esc(g) + '</div>';
      return head + (!open ? '' : groups[g].map(itemHTML).join(''));
    }).join('');
  }
  function count() { var pv = L.previewLabel(); return (pk.multi ? pk.sel.length + ' chosen' : '') + (pv ? (pk.multi ? ' · ' : '') + 'Previewing: ' + pv : ''); }
  function paintList() {
    var el = document.getElementById('pk-list'); if (!el) return; var st = el.scrollTop, a = document.activeElement, k = a && el.contains(a) ? a.dataset.k : null;
    el.innerHTML = list(); el.scrollTop = st; if (k) { var n = el.querySelector('[data-k="' + k + '"]'); if (n) n.focus(); }
    var c = document.getElementById('pk-count'); if (c) c.textContent = count();
  }
  L.pickerSheet = function (o) {
    pk = { items: o.items, sel: (o.selected || []).slice(), multi: !!o.multi, onDone: o.onDone, q: '', fold: !!o.fold, open: {}, filters: o.filters || null, filter: o.filters ? o.filters[0].id : '' };
    if (pk.fold) { (o.openGroups || []).forEach(function (g) { pk.open[g] = true; }); o.items.forEach(function (it) { if (pk.sel.indexOf(it.id) > -1) pk.open[it.group] = true; }); }
    L.sheet({ title: o.title, wide: !!o.wide,
      body: (o.intro ? '<p class="muted" style="margin-bottom:8px">' + o.intro + '</p>' : '') +
        '<div class="row-flex" style="margin-bottom:8px;flex-wrap:wrap"><div class="search grow" style="min-width:180px">' + L.icon('search') + '<input class="input" type="search" placeholder="Search" aria-label="Search the list" data-input="pkq"></div>' +
        (pk.filters ? '<div class="seg" role="group" aria-label="Show">' + pk.filters.map(function (f) { return '<button type="button" data-act="pkfilter" data-keep-menu="1" data-f="' + f.id + '" aria-pressed="' + (pk.filter === f.id) + '">' + esc(f.label) + '</button>'; }).join('') + '</div>' : '') + '</div>' +
        '<div id="pk-list" class="pk-list" role="group" aria-label="' + esc(o.title) + '">' + list() + '</div>' +
        '<p class="hint" style="margin-top:6px">' + L.icon('headphones', 's') + ' Preview plays in your headphones only. The arrow ' + L.icon('chevdown', 's') + ' beside a name shows what is inside.</p>',
      footer: '<span id="pk-count" class="muted grow">' + count() + '</span><button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="pkdone">' + esc(o.okLabel || 'Done') + '</button>' });
  };
  L.inputs.pkq = function (el) { pk.q = el.value; paintList(); };
  L.acts.pkfilter = function (el) { pk.filter = el.dataset.f; document.querySelectorAll('[data-act="pkfilter"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); }); paintList(); };
  L.acts.pkgroup = function (el) { var g = el.dataset.g; pk.open[g] = !pk.open[g]; paintList(); var b = document.querySelector('.pk-groupbtn[data-g="' + g.replace(/"/g, '\\"') + '"]'); if (b) b.focus(); };
  L.inputs.pkpick = function (el) {
    if (!pk.multi) pk.sel = [el.value];
    else if (el.checked) { if (pk.sel.indexOf(el.value) < 0) pk.sel.push(el.value); } else pk.sel = pk.sel.filter(function (x) { return x !== el.value; });
    var c = document.getElementById('pk-count'); if (c) c.textContent = count();
  };
  L.acts.pkdone = function () { var f = pk.onDone, s = pk.sel.slice(); L.closeSheet(); if (f) f(s); L.render(); };
  // Closing a picker stops its preview, so nothing keeps playing in your headphones after you leave it.
  var closeSheet = L.closeSheet; L.closeSheet = function () { var had = document.getElementById('pk-list'); closeSheet(); if (had && L.pb.preview) L.stopPreview(); };

  /* ---------- item builders ---------- */
  function kindLabel(p) { return p.kind === 'dynamic' ? 'Dynamic' : 'Manual'; }
  function playlistItem(p, group) {
    return { id: p.id, label: p.name, group: group, search: L.playlistTracks(p).map(L.title).join(' '),
      sub: kindLabel(p) + ' · ' + L.kindName[p.lane] + ' · ' + L.playlistTracks(p).length + ' tracks' + (p.kind === 'dynamic' ? ' · ' + L.ruleText(p.rule) : ''),
      preview: { kind: 'playlist', id: p.id }, contents: { kind: 'playlist', id: p.id }, lane: p.lane, isPlaylist: true };
  }
  function trackItem(t, group) {
    return { id: t.id, label: L.title(t), group: group, search: [t.metaTitle, t.file, t.artist, t.album].concat(t.tags.mood, t.tags.motif, t.tags.scene).join(' '),
      sub: (L.isFx(t) ? 'FX' + (t.role === 'Sting' ? ' · Sting' : '') : L.kindName[t.kind] + (t.role && t.kind === 'music' ? ' · ' + t.role : '')) + ' · ' + L.fmt(t.dur) + (t.metaTitle && t.metaTitle !== t.title ? ' · in the file: ' + t.metaTitle : ''),
      preview: { kind: 'track', id: t.id }, kind: t.kind, track: t };
  }
  var laneFilters = [{ id: 'all', label: 'All', test: function () { return true; } },
    { id: 'music', label: 'Music', test: function (it) { return it.isPlaylist ? it.lane === 'music' : it.kind === 'music' && !L.isFx(it.track); } },
    { id: 'amb', label: 'Ambience', test: function (it) { return it.isPlaylist ? it.lane === 'amb' : it.kind === 'amb'; } },
    { id: 'fx', label: 'FX', test: function (it) { return it.isPlaylist ? it.lane === 'fx' : L.isFx(it.track); } }];

  L.pickPlaylists = function (o) {
    var items = D.playlists.filter(function (p) { return !o.lane || p.lane === o.lane; }).map(function (p) {
      return playlistItem(p, p.lane === 'amb' ? 'Ambience playlists' : p.lane === 'fx' ? 'FX playlists' : p.kind === 'dynamic' ? 'Music: dynamic' : 'Music: manual');
    });
    L.pickerSheet({ title: o.title || 'Choose playlists', items: items, selected: o.selected, multi: o.multi !== false, onDone: o.onDone, intro: o.intro });
  };
  L.pickBoards = function (o) {
    L.pickerSheet({ title: o.title || 'Choose pad boards', selected: o.selected, multi: o.multi !== false, onDone: o.onDone, intro: o.intro,
      items: D.boards.map(function (b) { return { id: b.id, label: b.name, sub: b.cols + ' × ' + b.rows + ' grid · ' + L.boardPads(b).filter(Boolean).length + ' pads', search: L.boardPads(b).filter(Boolean).map(function (p) { return p.label; }).join(' '), preview: { kind: 'board', id: b.id }, contents: { kind: 'board', id: b.id } }; }) });
  };
  L.pickTracks = function (o) {
    var kinds = o.kinds || ['music', 'amb', 'fx'];
    var items = D.tracks.filter(function (t) { return kinds.indexOf(t.kind) > -1; }).map(function (t) { return trackItem(t, ''); });
    L.pickerSheet({ title: o.title || 'Choose tracks', items: items, selected: o.selected, multi: o.multi !== false, onDone: o.onDone, intro: o.intro,
      filters: laneFilters.filter(function (f) { return f.id === 'all' || kinds.indexOf(f.id) > -1; }) });
  };
  // A scene's music: tracks and playlists in one list, ticked items added in the order ticked.
  L.pickSceneMusic = function (o) {
    var items = D.playlists.filter(function (p) { return p.lane !== 'amb'; }).map(function (p) { return playlistItem(p, 'Playlists'); })
      .concat(D.tracks.filter(function (t) { return t.kind !== 'amb'; }).map(function (t) { return trackItem(t, 'Tracks'); }));
    L.pickerSheet({ title: o.title || 'Add music to the scene', items: items, selected: o.selected, multi: true, onDone: o.onDone, wide: true,
      intro: o.intro || 'Tick playlists, single tracks or both. They play in the scene in the order you tick them; you can reorder them afterwards.',
      filters: [{ id: 'all', label: 'All', test: function () { return true; } }, { id: 'pl', label: 'Playlists', test: function (it) { return it.isPlaylist; } },
        { id: 'music', label: 'Tracks', test: function (it) { return !it.isPlaylist && it.kind === 'music' && !L.isFx(it.track); } }, { id: 'fx', label: 'FX', test: function (it) { return it.isPlaylist ? it.lane === 'fx' : L.isFx(it.track); } }] });
  };
  L.pickAmbience = function (o) {
    var items = D.playlists.filter(function (p) { return p.lane === 'amb'; }).map(function (p) { return playlistItem(p, 'Ambience playlists'); })
      .concat(D.tracks.filter(function (t) { return t.kind === 'amb'; }).map(function (t) { return trackItem(t, 'Ambience tracks'); }));
    L.pickerSheet({ title: o.title || 'Choose the ambience', items: items, selected: o.selected, multi: false, onDone: o.onDone, intro: o.intro || 'One ambience track, or an ambience playlist that moves from bed to bed.' });
  };

  /* ---------- Use in… ---------- */
  function targets(kind, id) {
    var items = [], sel = [];
    D.campaigns.forEach(function (c) {
      var list = kind === 'board' ? c.boards : c.playlists;
      items.push({ id: 'c:' + c.id, label: c.name + ': whole campaign', sub: 'Available in every session', group: c.name }); if (list.indexOf(id) > -1) sel.push('c:' + c.id);
      c.sessions.forEach(function (s) {
        var sl = kind === 'board' ? s.boards : s.playlists;
        items.push({ id: 's:' + c.id + ':' + s.id, label: 'Session ' + s.n + ': ' + s.name, sub: 'Available in every scene of this session', group: c.name }); if (sl.indexOf(id) > -1) sel.push('s:' + c.id + ':' + s.id);
        s.scenes.forEach(function (sc) {
          var isAmb = kind !== 'board' && L.playlist(id) && L.playlist(id).lane === 'amb', cur = isAmb ? sc.amb : '';
          var curName = cur && cur !== id ? ((L.playlist(cur) || L.track(cur) || {}).name || L.title(L.track(cur))) : '';
          items.push({ id: 'x:' + c.id + ':' + s.id + ':' + sc.id, label: 'Scene: ' + sc.name, indent: true, group: c.name,
            sub: 'Session ' + s.n + ' · ' + (kind === 'board' ? 'one of the pad boards in this scene' : isAmb ? 'ambience for this scene' : 'music for this scene') + (curName ? ' (replaces ' + curName + ')' : '') });
          if (kind === 'board' ? L.sceneBoards(sc).indexOf(id) > -1 : sc.music.indexOf(id) > -1 || sc.amb === id) sel.push('x:' + c.id + ':' + s.id + ':' + sc.id);
        });
      });
    });
    return { items: items, sel: sel };
  }
  L.assignSheet = function (kind, id) {
    var t = targets(kind, id), obj = kind === 'board' ? L.board(id) : L.playlist(id);
    L.pickerSheet({ title: 'Use "' + obj.name + '" in…', multi: true, items: t.items, selected: t.sel, okLabel: 'Save', fold: true,
      openGroups: [(L.campaign(L.state.ctx.cid) || {}).name],
      intro: 'Tick a campaign to make it available all campaign long, a session for that evening, or a scene to ' + (kind === 'board' ? 'add this board to that scene.' : 'play it in that scene.'),
      onDone: function (ids) {
        D.campaigns.forEach(function (c) {
          function setIn(arr, on) { var i = arr.indexOf(id); if (on && i < 0) arr.push(id); if (!on && i > -1) arr.splice(i, 1); }
          setIn(kind === 'board' ? c.boards : c.playlists, ids.indexOf('c:' + c.id) > -1);
          c.sessions.forEach(function (s) {
            setIn(kind === 'board' ? s.boards : s.playlists, ids.indexOf('s:' + c.id + ':' + s.id) > -1);
            s.scenes.forEach(function (sc) {
              var on = ids.indexOf('x:' + c.id + ':' + s.id + ':' + sc.id) > -1;
              if (kind === 'board') { if (!sc.boards) sc.boards = L.sceneBoards(sc).slice(); setIn(sc.boards, on); }
              else if (obj.lane === 'amb') { if (on) sc.amb = id; else if (sc.amb === id) sc.amb = ''; }
              else setIn(sc.music, on);
            });
          });
        });
        L.toast('Saved where "' + obj.name + '" is used');
      } });
  };
})();
