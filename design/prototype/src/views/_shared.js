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
   L.assignSheet(kind 'playlist'|'board'|'track', id)  "Use in…": campaigns, sessions and scenes that use it
   L.orderButton(pid, placeKey)     PLY-13: the play order of a playlist where it is shown (its own when placeKey is ''),
                                    a button showing shuffle and repeat that opens a menu to change them for that place only

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
  // place (optional): the session or campaign list it is played from ('ss:…' / 'cp:…'), for its play order and audio settings.
  L.playOnAirButton = function (kind, id, place) {
    var name = kind === 'track' ? L.title(L.track(id)) : (L.playlist(id) || {}).name;
    return '<button type="button" class="btn s icon" data-act="onair" data-kind="' + kind + '" data-id="' + esc(id) + '"' + (place ? ' data-place="' + esc(place) + '"' : '') + ' data-k="air-' + kind + '-' + esc(id) + '" title="Play on air (the players hear it)" aria-label="Play on air: ' + esc(name) + '">' + L.icon('broadcast', 's') + '</button>';
  };
  L.acts.onair = function (el) {
    var k = el.dataset.kind, id = el.dataset.id, place = el.dataset.place || '';
    if (k === 'track') { var t = L.track(id); L.play(id, { fade: 3, place: place }); if (t && t.kind === 'fx') L.toast('Effect on air: ' + L.title(t)); }
    else { var p = L.playlist(id), t0 = L.orderedTracks(id, place)[0]; if (t0) L.play(t0.id, { lane: p.lane, playlistId: id, place: place, fade: 3 }); else L.toast('This playlist has no tracks yet'); }
  };

  /* ---------- PLY-13 play order: one button, one menu, the same everywhere a playlist is shown ---------- */
  function orderIcons(o) { return L.icon(o.shuffle ? 'shuffle' : 'inorder', 's') + L.icon(o.repeat === 'one' ? 'repeat1' : 'loop', 's ord-rep' + (o.repeat === 'off' ? ' off' : '')); }
  function whereWords(key) { var k = L.placeKind(key); return !key ? 'everywhere it has no order of its own' : k === 'scene' ? 'in the scene ' + L.placeLabel(key).replace(/ \(Session \d+\)$/, '') : 'in ' + L.placeLabel(key); }
  L.orderButton = function (pid, key) {
    var p = L.playlist(pid); if (!p) return ''; key = key || '';
    var o = L.orderOf(pid, key), own = key && o.source === 'place', words = L.orderWords(o);
    return '<button type="button" class="btn s ord' + (own ? ' own' : '') + '" data-act="ordmenu" data-pid="' + esc(pid) + '" data-key="' + esc(key) + '" data-keep-menu="1" data-k="ord-' + esc(pid) + '-' + esc(key.replace(/:/g, '_') || 'own') + '"' +
      ' aria-haspopup="menu" aria-expanded="false" title="Play order ' + esc(whereWords(key)) + ': ' + esc(words) + (key && !own ? ' (the playlist\'s own)' : '') + '" aria-label="Play order of ' + esc(p.name) + ': ' + esc(words) + '">' + orderIcons(o) +
      (own ? '<span class="ord-dot" aria-hidden="true"></span><span class="sr-only">, chosen ' + esc(whereWords(key)) + '</span>' : '') + '</button>';
  };
  function orderMenu(pid, key) {
    var o = L.orderOf(pid, key), kind = L.placeKind(key), d = 'data-pid="' + esc(pid) + '" data-key="' + esc(key) + '" data-keep-menu="1"';
    function radio(v, label, hint, icon) { return '<button role="menuitemradio" aria-checked="' + (o.repeat === v) + '" data-act="ordset" data-repeat="' + v + '" ' + d + '>' + L.icon(o.repeat === v ? 'check' : icon, 's') + '<span class="grow"><span style="display:block">' + label + '</span><span class="hint" style="display:block">' + hint + '</span></span></button>'; }
    var ownO = L.orderOf(pid, '');
    return '<div class="group">' + (key ? 'Play order ' + esc(whereWords(key)) : 'Play order of this playlist') + '</div>' +
      '<button role="menuitemcheckbox" aria-checked="' + o.shuffle + '" data-act="ordset" data-shuffle="1" ' + d + '>' + L.icon(o.shuffle ? 'check' : 'shuffle', 's') + 'Shuffle</button><div class="sep"></div>' +
      radio('off', 'No repeat', kind === 'scene' ? 'After its last track the scene moves on' : 'Stops after its last track', 'right') +
      radio('all', 'Repeat all', 'Starts again after its last track', 'loop') +
      radio('one', 'Repeat one', 'The track playing repeats until you press Next', 'repeat1') +
      '<div class="sep"></div>' + (key ? '<div class="item hint ord-note">' + (o.source === 'place' ? 'Only ' + esc(whereWords(key)) + '. Elsewhere: ' + esc(L.orderWords(ownO)) + '.' : 'Uses the playlist\'s own order. A change here applies only ' + esc(whereWords(key)) + '.') + '</div>' +
        (o.source === 'place' ? '<button role="menuitem" data-act="ordclear" ' + d.replace(' data-keep-menu="1"', '') + '>' + L.icon('restart', 's') + 'Use the playlist\'s own order here</button>' : '')
        : '<div class="item hint ord-note">Scenes, sessions and campaigns can have their own.</div>');
  }
  L.acts.ordmenu = function (el) { L.menu(el, orderMenu(el.dataset.pid, el.dataset.key || ''), 'Play order'); };
  L.acts.ordset = function (el) {
    var pid = el.dataset.pid, key = el.dataset.key || '', o = L.orderOf(pid, key), anchorK = 'ord-' + pid + '-' + (key.replace(/:/g, '_') || 'own'), which = el.dataset.shuffle ? 'shuffle' : el.dataset.repeat;
    L.setOrder(pid, key, el.dataset.shuffle ? { shuffle: !o.shuffle } : { repeat: el.dataset.repeat });
    L.state.shuffleRound++;
    L.say(L.orderWords(L.orderOf(pid, key)) + ' ' + whereWords(key));
    // Keep the menu open on the same item so shuffle and repeat can both be changed; the button behind it is redrawn.
    L.closeMenu(); L.render(); if (pk) paintList();
    var a = document.querySelector('[data-k="' + anchorK + '"]'); if (!a) return;
    L.acts.ordmenu(a);
    var item = document.querySelector('.menu [data-act="ordset"][' + (which === 'shuffle' ? 'data-shuffle' : 'data-repeat="' + which + '"') + ']'); if (item) item.focus();
  };
  L.acts.ordclear = function (el) { L.clearOrder(el.dataset.pid, el.dataset.key); L.say('Uses the playlist\'s own order here: ' + L.orderWords(L.orderOf(el.dataset.pid, el.dataset.key))); L.render(); if (pk) paintList(); };
  L.expanded = function (key) { return !!L.state.xp[key]; };
  L.expanderButton = function (key, label, open) {
    open = open == null ? L.expanded(key) : open;
    return '<button type="button" class="xp-btn" data-act="xp" data-key="' + esc(key) + '" data-keep-menu="1" data-k="xp-' + esc(key) + '" aria-expanded="' + open + '" title="' + (open ? 'Hide' : 'Show') + ' what is in ' + esc(label) + '" aria-label="' + (open ? 'Hide' : 'Show') + ' contents of ' + esc(label) + '">' + L.icon('chevdown', 's') + '</button>';
  };
  L.acts.xp = function (el) { var k = el.dataset.key; L.state.xp[k] = !L.state.xp[k]; if (pk && document.getElementById('pk-list') && document.getElementById('pk-list').contains(el)) { paintList(); var b = document.querySelector('#pk-list [data-key="' + k + '"]'); if (b) b.focus(); } else L.render(); };
  // profileKey (optional): the place each track's Audio profile link opens (default: this playlist).
  // orderKey (optional, ORG-13): the place ('sc:…', 'ss:…', 'cp:…') whose own track order this list shows and changes:
  // rows can be dragged, or moved with Alt+Up / Alt+Down, and "Back to the playlist's order" shows once it differs.
  L.contentsHTML = function (kind, id, profileKey, orderKey) {
    if (kind === 'playlist') {
      var p = L.playlist(id), ts = orderKey ? L.placeTracks(id, orderKey) : L.playlistTracks(p), own = orderKey && L.hasPlaceOrder(id, orderKey);
      if (!ts.length) return '<p class="hint">No tracks yet' + (p && p.kind === 'dynamic' ? ': no track matches its tags.' : '.') + '</p>';
      // In a scene, each track shows the scene's name for it (DAT-14) and its tags (ORG-11); its waveform, end and fades
      // open on the scene's or session's own settings (PLY-14).
      var inScene = profileKey && String(profileKey).indexOf('sc:') === 0 ? profileKey : '', where = orderKey ? placeWords(orderKey) : '';
      var grp = orderKey ? 'tro|' + orderKey + '|' + id : '', did = orderKey ? 'ro-d-' + (orderKey + '-' + id).replace(/[^\w-]/g, '_') : '';
      return (own ? '<div class="ro-own"><span class="ro-own-t">' + L.icon('drag', 's') + 'Order ' + esc(where) + '</span><button type="button" class="btn s ghost" data-act="roclear" data-key="' + esc(orderKey) + '" data-pid="' + esc(id) + '" data-k="roclear-' + esc(did) + '">' + L.icon('restart', 's') + 'Back to the playlist\'s order</button></div>' : '') +
        (orderKey ? '<p class="sr-only" id="' + did + '">Drag a track, or press Alt+Up or Alt+Down on it, to change the order ' + esc(where) + ' only.</p>' : '') +
        '<ol class="list' + (orderKey ? ' ro-list' : '') + '" aria-label="Tracks in ' + esc(p.name) + (orderKey ? ', in the order ' + esc(where) : '') + '"' + (orderKey ? ' aria-describedby="' + did + '"' : '') + '>' + ts.map(function (t, i) {
        var nm = L.nameIn(t, inScene);
        return '<li class="xp-row"' + (orderKey ? ' data-ro="' + esc(grp) + '" data-ri="' + i + '"' : '') + '>' + (orderKey ? '<span class="ro-handle" title="Drag to change the order ' + esc(where) + ' (or Alt+Up / Alt+Down)" aria-hidden="true">' + L.icon('drag', 's') + '</span>' : '') +
          '<span class="faint num">' + (i + 1) + '</span><span class="grow ellipsis" title="' + esc(nm !== L.title(t) ? 'Its own name: ' + L.title(t) : L.title(t)) + '">' + esc(nm) + '</span>' + L.tagStrip(t, 2) + '<span class="num faint">' + L.fmt(t.dur) + '</span>' + (L.profileLink && profileKey !== false ? L.profileLink(t.id, profileKey || 'pl:' + id, true) : '') + L.previewButton('track', t.id) +
          // Round 6 part 3 (decision 4): a scene's Repeat one, saved with the scene, shows and changes here as in Live.
          (inScene && p.lane === 'music' ? L.repeatOneButton(inScene, t.id, 'r1-' + (did || id) + '-' + t.id, nm) : '') + '</li>';
      }).join('') + '</ol>';
    }
    var b = L.board(id); if (!b) return '';
    var pads = L.boardPads(b).filter(Boolean);
    return '<p class="hint">' + b.cols + ' × ' + b.rows + ' grid, ' + pads.length + ' pads' + (b.spare.length ? ', ' + b.spare.length + ' spare' : '') + '</p><ul class="list" aria-label="Pads on ' + esc(b.name) + '">' + pads.map(function (p) {
      return '<li class="xp-row"><span class="lane-dot" style="background:' + (L.colors[p.color] || 'var(--fx)') + '"></span>' + L.icon(p.icon, 's') + '<span class="grow">' + esc(p.label) + '</span>' + (p.key ? '<span class="kbd">' + esc(p.key.toUpperCase()) + '</span>' : '') + '<span class="hint">' + esc(L.modeName[p.mode]) + '</span>' + L.previewButton('pad', b.id + '/' + p.id) + '</li>';
    }).join('') + '</ul>';
  };

  /* ---------- ORG-13: reorder rows by drag or Alt+Up / Alt+Down, kept only in their place ----------
     A row is <li data-ro="<group>" data-ri="<index>"> with a .ro-handle; L.reorder[<group kind>](group, from, to) moves
     it and returns true. Kinds: 'tro' a playlist's tracks in a place (tro|<placeKey>|<playlistId>); views add their own
     (the session's and campaign's playlists: 'apl'). Focus stays on the same control of the moved row. */
  function placeWords(key) { var k = L.placeKind(key); return k === 'scene' ? 'in this scene' : k === 'session' ? 'in this session' : k === 'campaign' ? 'in this campaign' : 'here'; }
  L.placeWords = placeWords;
  L.reorder = L.reorder || {};
  L.reorder.tro = function (group, from, to) {
    var a = group.split('|'), key = a[1], pid = a[2], ids = L.placeTracks(pid, key).map(function (t) { return t.id; });
    if (to < 0 || to >= ids.length || from === to) return false;
    var x = ids.splice(from, 1)[0]; ids.splice(to, 0, x); L.setPlaceOrder(pid, key, ids);
    L.say(L.title(L.track(x)) + ' is now ' + (to + 1) + ' of ' + ids.length + ' ' + placeWords(key)); return true;
  };
  L.acts.roclear = function (el) { var p = L.playlist(el.dataset.pid); L.clearPlaceOrder(el.dataset.pid, el.dataset.key); L.say((p ? p.name : 'The playlist') + ' plays in its own order ' + placeWords(el.dataset.key) + ' again'); L.render(); };
  function roMove(row, to) {
    var group = row.dataset.ro, kind = group.split('|')[0], from = +row.dataset.ri, f = L.reorder[kind]; if (!f) return false;
    var a = document.activeElement, k = a && row.contains(a) && a.dataset ? a.dataset.k : null;
    if (!f(group, from, to)) return false;
    L.render();
    // The same control, in the row at its new place (a track can have the same control elsewhere on the page).
    var moved = [].slice.call(document.querySelectorAll('[data-ro]')).filter(function (r) { return r.dataset.ro === group && +r.dataset.ri === to; })[0];
    var n = moved && k ? moved.querySelector('[data-k="' + k + '"]') : null; if (n) n.focus();
    return true;
  }
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.metaKey) return;
    var row = e.target && e.target.closest && e.target.closest('[data-ro]'); if (!row || L.typing(e.target)) return;
    e.preventDefault(); e.stopPropagation(); roMove(row, +row.dataset.ri + (e.key === 'ArrowUp' ? -1 : 1));
  }, true);
  var roDrag = null;
  function roClear() { document.querySelectorAll('.ro-before, .ro-after, .ro-dragging').forEach(function (n) { n.classList.remove('ro-before', 'ro-after', 'ro-dragging'); }); }
  document.addEventListener('pointerdown', function (e) { var h = e.target.closest && e.target.closest('.ro-handle'); if (h) { var r = h.closest('[data-ro]'); if (r) r.setAttribute('draggable', 'true'); } });
  document.addEventListener('pointerup', function () { if (!roDrag) document.querySelectorAll('[data-ro][draggable="true"]').forEach(function (n) { n.removeAttribute('draggable'); }); });
  document.addEventListener('dragstart', function (e) {
    var r = e.target.closest && e.target.closest('[data-ro]'); if (!r || r.getAttribute('draggable') !== 'true') return;
    roDrag = { group: r.dataset.ro, from: +r.dataset.ri }; e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', r.dataset.ri); } catch (err) { /* some browsers refuse custom data */ }
    r.classList.add('ro-dragging'); e.stopPropagation();
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!roDrag) return; var r = e.target.closest && e.target.closest('[data-ro]'); if (!r || r.dataset.ro !== roDrag.group) return;
    e.preventDefault(); e.stopPropagation(); var b = r.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
    document.querySelectorAll('.ro-before, .ro-after').forEach(function (n) { n.classList.remove('ro-before', 'ro-after'); });
    if (+r.dataset.ri !== roDrag.from) r.classList.add(after ? 'ro-after' : 'ro-before');
  }, true);
  document.addEventListener('drop', function (e) {
    if (!roDrag) return; var r = e.target.closest && e.target.closest('[data-ro]'); if (!r || r.dataset.ro !== roDrag.group) return;
    e.preventDefault(); e.stopPropagation(); var b = r.getBoundingClientRect(), to = +r.dataset.ri + (e.clientY > b.top + b.height / 2 ? 1 : 0), d = roDrag;
    if (to > d.from) to--; roDrag = null; roClear();
    var src = document.querySelector('[data-ro="' + d.group.replace(/"/g, '\\"') + '"][data-ri="' + d.from + '"]'); if (src) roMove(src, to);
  }, true);
  document.addEventListener('dragend', function () { if (!roDrag) return; roDrag = null; roClear(); document.querySelectorAll('[data-ro][draggable="true"]').forEach(function (n) { n.removeAttribute('draggable'); }); }, true);

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
      '<span class="grow"' + (it.tip ? ' title="' + esc(it.tip) + '"' : '') + '><span class="ellipsis" style="display:block">' + esc(it.label) + '</span>' + (it.sub ? '<span class="hint ellipsis" style="display:block">' + esc(it.sub) + '</span>' : '') + '</span></label>' +
      (it.track ? L.tagStrip(it.track, 3) : '') + (it.preview ? L.previewButton(it.preview.kind, it.preview.id) : '') + '</div>';
    if (!(it.contents && L.expanded(xk))) return row;
    // ORG-10: in a picker that takes single tracks, an open playlist lists its tracks with a box each, to add only those.
    if (pk.inside && it.isPlaylist) return row + '<div class="xp-body pk-inside">' + insideHTML(it) + '</div>';
    return row + '<div class="xp-body">' + L.contentsHTML(it.contents.kind, it.contents.id, false) + '</div>';
  }
  function insideHTML(it) {
    var ts = L.playlistTracks(L.playlist(it.id));
    if (!ts.length) return '<p class="hint">No tracks yet.</p>';
    return '<ul class="list" aria-label="Tracks in ' + esc(it.label) + '" title="Tick single tracks to add only those, or tick the playlist to add all of it">' + ts.map(function (t) {
      var on = pk.sel.indexOf(t.id) > -1;
      return '<li class="pk-row pk-inrow"><label class="pk-item"><input type="checkbox" data-input="pkpick" value="' + esc(t.id) + '" data-k="pki-' + esc(it.id) + '-' + esc(t.id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="grow ellipsis">' + esc(L.title(t)) + '</span></label>' + L.tagStrip(t, 2) + '<span class="num faint">' + L.fmt(t.dur) + '</span>' + L.previewButton('track', t.id) + '</li>';
    }).join('') + '</ul>';
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
    pk = { items: o.items, sel: (o.selected || []).slice(), multi: !!o.multi, inside: !!o.inside, onDone: o.onDone, q: '', fold: !!o.fold, open: {}, filters: o.filters || null, filter: o.filters ? o.filters[0].id : '' };
    if (pk.fold) { (o.openGroups || []).forEach(function (g) { pk.open[g] = true; }); o.items.forEach(function (it) { if (pk.sel.indexOf(it.id) > -1) pk.open[it.group] = true; }); }
    L.sheet({ title: o.title, wide: !!o.wide,
      // Round 6: the intro is read out with the dialog (its description) and is the list's hover text; on screen the
      // title, the boxes and the count say enough.
      describe: o.intro || '',
      body: '' +
        '<div class="row-flex" style="margin-bottom:8px;flex-wrap:wrap"><div class="search grow" style="min-width:180px">' + L.icon('search') + '<input class="input" type="search" placeholder="Search" aria-label="Search the list" data-input="pkq"></div>' +
        (pk.filters ? '<div class="seg" role="group" aria-label="Show">' + pk.filters.map(function (f) { return '<button type="button" data-act="pkfilter" data-keep-menu="1" data-f="' + f.id + '" aria-pressed="' + (pk.filter === f.id) + '">' + esc(f.label) + '</button>'; }).join('') + '</div>' : '') + '</div>' +
        '<div id="pk-list" class="pk-list" role="group" aria-label="' + esc(o.title) + '"' + (o.intro ? ' title="' + esc(o.intro) + '"' : '') + '>' + list() + '</div>',
      footer: '<span id="pk-count" class="muted grow">' + count() + '</span><button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="pkdone">' + esc(o.okLabel || 'Done') + '</button>' });
  };
  L.inputs.pkq = function (el) { pk.q = el.value; paintList(); };
  L.acts.pkfilter = function (el) { pk.filter = el.dataset.f; document.querySelectorAll('[data-act="pkfilter"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); }); paintList(); };
  L.acts.pkgroup = function (el) { var g = el.dataset.g; pk.open[g] = !pk.open[g]; paintList(); var b = document.querySelector('.pk-groupbtn[data-g="' + g.replace(/"/g, '\\"') + '"]'); if (b) b.focus(); };
  L.inputs.pkpick = function (el) {
    if (!pk.multi) pk.sel = [el.value];
    else if (el.checked) { if (pk.sel.indexOf(el.value) < 0) pk.sel.push(el.value); } else pk.sel = pk.sel.filter(function (x) { return x !== el.value; });
    var c = document.getElementById('pk-count'); if (c) c.textContent = count();
    // The same track can be ticked inside its playlist and in the Tracks list: redraw so both boxes agree.
    if (pk.inside) paintList();
  };
  L.acts.pkdone = function () { var f = pk.onDone, s = pk.sel.slice(); L.closeSheet(); if (f) f(s); L.render(); };
  // Closing a picker stops its preview, so nothing keeps playing in your headphones after you leave it.
  var closeSheet = L.closeSheet; L.closeSheet = function () { var had = document.getElementById('pk-list'); closeSheet(); if (had && L.pb.preview) L.stopPreview(); };

  /* ---------- item builders ---------- */
  function kindLabel(p) { return p.kind === 'dynamic' ? 'Dynamic' : 'Manual'; }
  function playlistItem(p, group) {
    // Round 6: the second line says only what differs from the usual manual music playlist; the rule is hover text.
    var n = L.playlistTracks(p).length;
    return { id: p.id, label: p.name, group: group, search: L.playlistTracks(p).map(L.title).join(' ') + (p.kind === 'dynamic' ? ' ' + L.ruleText(p.rule) : ''),
      sub: (p.kind === 'dynamic' ? 'Dynamic · ' : '') + (p.lane !== 'music' ? L.kindName[p.lane] + ' · ' : '') + n + (n === 1 ? ' track' : ' tracks'),
      tip: kindLabel(p) + ' · ' + L.kindName[p.lane] + (p.kind === 'dynamic' ? ' · ' + L.ruleText(p.rule) : ''),
      preview: { kind: 'playlist', id: p.id }, contents: { kind: 'playlist', id: p.id }, lane: p.lane, isPlaylist: true };
  }
  function trackItem(t, group) {
    return { id: t.id, label: L.title(t), group: group, search: [t.metaTitle, t.file, t.artist, t.album].concat(t.tags.mood, t.tags.motif, t.tags.scene).join(' '),
      sub: (L.isFx(t) ? 'FX' + (t.role === 'Sting' ? ' · Sting' : '') : L.kindName[t.kind] + (t.role && t.kind === 'music' ? ' · ' + t.role : '')) + ' · ' + L.fmt(t.dur),
      tip: t.metaTitle && t.metaTitle !== t.title ? 'In the file: ' + t.metaTitle : '',
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
    L.pickerSheet({ title: o.title || 'Add music to the scene', items: items, selected: o.selected, multi: true, inside: true, onDone: o.onDone, wide: true,
      intro: o.intro || 'Tick playlists, single tracks or both; open a playlist to tick only some of its tracks. They play in the scene in the order you tick them; you can reorder them afterwards.',
      filters: [{ id: 'all', label: 'All', test: function () { return true; } }, { id: 'pl', label: 'Playlists', test: function (it) { return it.isPlaylist; } },
        { id: 'music', label: 'Tracks', test: function (it) { return !it.isPlaylist && it.kind === 'music' && !L.isFx(it.track); } }, { id: 'fx', label: 'FX', test: function (it) { return it.isPlaylist ? it.lane === 'fx' : L.isFx(it.track); } }] });
  };
  L.pickAmbience = function (o) {
    var items = D.playlists.filter(function (p) { return p.lane === 'amb'; }).map(function (p) { return playlistItem(p, 'Ambience playlists'); })
      .concat(D.tracks.filter(function (t) { return t.kind === 'amb'; }).map(function (t) { return trackItem(t, 'Ambience tracks'); }));
    L.pickerSheet({ title: o.title || 'Choose the ambience', items: items, selected: o.selected, multi: false, onDone: o.onDone, intro: o.intro || 'One ambience track, or an ambience playlist that moves from bed to bed.' });
  };

  /* ---------- Use in… ---------- */
  // kind 'playlist', 'board' or 'track' (ORG-12): a track is kept on hand in a campaign or session (c.tracks, s.tracks)
  // and plays in a scene's music (or is its ambience, for an ambience track).
  function listOf(kind, x) { return kind === 'board' ? x.boards : kind === 'track' ? (x.tracks || (x.tracks = [])) : x.playlists; }
  function targets(kind, id) {
    var items = [], sel = [];
    D.campaigns.forEach(function (c) {
      var list = listOf(kind, c);
      items.push({ id: 'c:' + c.id, label: c.name + ': whole campaign', tip: 'Available in every session', group: c.name }); if (list.indexOf(id) > -1) sel.push('c:' + c.id);
      c.sessions.forEach(function (s) {
        var sl = listOf(kind, s);
        items.push({ id: 's:' + c.id + ':' + s.id, label: 'Session ' + s.n + ': ' + s.name, tip: 'Available in every scene of this session', group: c.name }); if (sl.indexOf(id) > -1) sel.push('s:' + c.id + ':' + s.id);
        s.scenes.forEach(function (sc) {
          var obj = kind === 'track' ? L.track(id) : L.playlist(id), isAmb = kind !== 'board' && obj && (kind === 'track' ? obj.kind === 'amb' : obj.lane === 'amb'), cur = isAmb ? sc.amb : '';
          var curName = cur && cur !== id ? ((L.playlist(cur) || L.track(cur) || {}).name || L.title(L.track(cur))) : '';
          // Round 6: the scene row's second line only when ticking it replaces something.
          items.push({ id: 'x:' + c.id + ':' + s.id + ':' + sc.id, label: 'Scene: ' + sc.name, indent: true, group: c.name,
            tip: 'Session ' + s.n + ' · ' + (kind === 'board' ? 'one of the pad boards in this scene' : isAmb ? 'ambience for this scene' : 'music for this scene'),
            sub: curName ? 'Replaces ' + curName : '' });
          if (kind === 'board' ? L.sceneBoards(sc).indexOf(id) > -1 : sc.music.indexOf(id) > -1 || sc.amb === id) sel.push('x:' + c.id + ':' + s.id + ':' + sc.id);
        });
      });
    });
    return { items: items, sel: sel };
  }
  L.assignSheet = function (kind, id) {
    var t = targets(kind, id), obj = kind === 'board' ? L.board(id) : kind === 'track' ? L.track(id) : L.playlist(id), name = kind === 'track' ? L.title(obj) : obj.name;
    var isAmb = kind === 'track' ? obj.kind === 'amb' : obj.lane === 'amb';
    L.pickerSheet({ title: 'Use "' + name + '" in…', multi: true, items: t.items, selected: t.sel, okLabel: 'Save', fold: true,
      openGroups: [(L.campaign(L.state.ctx.cid) || {}).name],
      intro: 'Tick a campaign to make it available all campaign long, a session for that evening, or a scene to ' + (kind === 'board' ? 'add this board to that scene.' : 'play it in that scene.'),
      onDone: function (ids) {
        D.campaigns.forEach(function (c) {
          function setIn(arr, on) { var i = arr.indexOf(id); if (on && i < 0) arr.push(id); if (!on && i > -1) arr.splice(i, 1); }
          setIn(listOf(kind, c), ids.indexOf('c:' + c.id) > -1);
          c.sessions.forEach(function (s) {
            setIn(listOf(kind, s), ids.indexOf('s:' + c.id + ':' + s.id) > -1);
            s.scenes.forEach(function (sc) {
              var on = ids.indexOf('x:' + c.id + ':' + s.id + ':' + sc.id) > -1;
              if (kind === 'board') { if (!sc.boards) sc.boards = L.sceneBoards(sc).slice(); setIn(sc.boards, on); }
              else if (isAmb) { if (on) sc.amb = id; else if (sc.amb === id) sc.amb = ''; }
              else setIn(sc.music, on);
            });
          });
        });
        L.toast('Saved where "' + name + '" is used');
      } });
  };
})();
