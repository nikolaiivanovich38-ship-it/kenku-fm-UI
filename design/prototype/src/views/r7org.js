/* Round 7, ORG-4 folders and dividers, ORG-5 dragging between lists (ROUND7.md).

   Folders (Playlists page and Pad boards page; the same parts serve sessions and scene blocks later)
     A folder is made from a playlist's or board's ⋯ › Move to folder… › New folder… (it then holds that one), or with
     a folder's ⋯ › New folder inside…; a folder row folds and unfolds; ⋯: Rename…, New folder inside…,
     Colour…, Delete folder (what was in it moves up a level, nothing is deleted). A playlist or board goes in with
     its ⋯ › Move to folder…, or by dragging it onto the folder.
     Data: D.orgFolders[kind] = [{ id, name, parent, color, closed }], D.orgIn[kind][itemId] = folderId.

   Dividers
     In a manual playlist: a track's ⋯ › Add a divider above. A divider is a named line between tracks (it is not a
     track: counts, play order and playback skip it); ⋯ on it: Rename…, Remove. Data: an id 'div:<n>' in pl.items,
     its name in D.dividers.
     On a pad board: ⋯ (the board's) › Add a divider…, a name above a row of pads. Data: board.dividers[row] = name.

   Dragging between lists (Nik: "dragging is fine without clutter"): nothing shows until a drag starts. Then "Drop on"
   appears at the right with the places it can go: playlists, pad boards (effects), Up next in each room, and the
   scenes of the next session. Dropping copies; with Shift held it moves (out of the playlist it came from). The
   places light up under the pointer; Esc cancels. Ticked rows in the Library go together. The keyboard's way: Add to…
   in a row's ⋯ menu, the same places as a list. */
(function () {
  var esc = L.esc, D = L.data;
  D.orgFolders = D.orgFolders || { playlists: [], boards: [] };
  D.orgIn = D.orgIn || { playlists: {}, boards: {} };
  D.dividers = D.dividers || {};
  var WORD = { playlists: ['playlist', 'playlists'], boards: ['board', 'boards'] };
  function plural(n, k) { return n + ' ' + WORD[k][n === 1 ? 0 : 1]; }
  function folders(kind) { return D.orgFolders[kind]; }
  function folder(kind, id) { return folders(kind).filter(function (f) { return f.id === id; })[0]; }
  function pathOf(kind, f) { var p = f.parent && folder(kind, f.parent); return (p ? pathOf(kind, p) + ' › ' : '') + f.name; }

  /* ---------- folders ---------- */
  L.orgItem = function (kind, id) { return 'draggable="true" data-org="' + kind + ':' + esc(id) + '"'; };
  L.moveToFolderItem = function (kind, id, name) { return '<button role="menuitem" data-act="fomoveto" data-kind="' + kind + '" data-id="' + esc(id) + '" data-name="' + esc(name) + '">' + L.icon('folder', 's') + 'Move to folder…</button>'; };
  // items: what the screen shows now (after its search and filters), in its order; row(item) draws one.
  L.inFolders = function (kind, items, row) {
    var all = kind === 'playlists' ? D.playlists : D.boards, filtered = items.length < all.length, inn = D.orgIn[kind];
    function holds(fid) { return items.some(function (x) { var f = inn[x.id]; while (f) { if (f === fid) return true; f = (folder(kind, f) || {}).parent; } return false; }); }
    function level(parent) {
      var h = '';
      folders(kind).filter(function (f) { return (f.parent || '') === parent; }).forEach(function (f) {
        if (filtered && !holds(f.id)) return;
        var mine = items.filter(function (x) { return inn[x.id] === f.id; }), n = all.filter(function (x) { var g = inn[x.id]; while (g) { if (g === f.id) return true; g = (folder(kind, g) || {}).parent; } return false; }).length;
        var open = !f.closed || filtered;
        h += '<li class="fo' + (f.color ? ' fo-c' : '') + '"' + (f.color ? ' style="--fo:' + L.colors[f.color] + '"' : '') + '><div class="fo-row" data-orgdrop="' + kind + ':' + f.id + '">' +
          '<button class="fo-toggle" data-act="fotoggle" data-kind="' + kind + '" data-id="' + f.id + '" data-k="fo-' + f.id + '" aria-expanded="' + open + '" title="' + esc(pathOf(kind, f)) + ': drop ' + WORD[kind][1] + ' here">' +
            L.icon('chevdown', 's chev') + L.icon('folder', 's fo-i') + '<span class="sr-only">Folder </span><span class="ellipsis">' + esc(f.name) + '</span><span class="num faint fo-n"><span class="sr-only">, </span>' + plural(n, kind) + '</span></button>' +
          '<button class="closer" data-act="fomenu" data-kind="' + kind + '" data-id="' + f.id + '" data-k="fo-more-' + f.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for the folder ' + esc(f.name) + '">' + L.icon('more') + '</button></div>' +
          (open ? '<ul class="fo-in" aria-label="In ' + esc(f.name) + '">' + level(f.id) + mine.map(row).join('') + '</ul>' : '') + '</li>';
      });
      return h;
    }
    return level('') + items.filter(function (x) { return !inn[x.id] || !folder(kind, inn[x.id]); }).map(row).join('');
  };
  function nameSheet(title, value, ok, act, data) {
    L.sheet({ title: title, body: '<div class="field"><label for="fo-name">Name</label><input class="input" id="fo-name" value="' + esc(value || '') + '" autocomplete="off"></div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="' + act + '" ' + data + '>' + ok + '</button>' });
    var f = document.getElementById('fo-name'); if (f) { f.focus(); f.select(); }
  }
  function nameVal() { var f = document.getElementById('fo-name'); return f ? f.value.trim() : ''; }
  function focusK(k) { var n = document.querySelector('[data-k="' + k + '"]'); if (n) n.focus(); }
  // A folder is made from Move to folder… (it then holds what was being moved) or inside another folder.
  L.acts.fonew = function (el) { nameSheet('New folder', '', 'Add folder', 'fonewok', 'data-kind="' + el.dataset.kind + '" data-parent="' + (el.dataset.parent || '') + '" data-move="' + esc(el.dataset.move || '') + '"'); };
  L.acts.fonewok = function (el) {
    var kind = el.dataset.kind, name = nameVal(); if (!name) { L.toast('Give the folder a name'); return; }
    var f = { id: L.uid('fo'), name: name, parent: el.dataset.parent || '', color: '', closed: false }; folders(kind).push(f);
    if (f.parent) folder(kind, f.parent).closed = false;
    L.closeSheet();
    if (el.dataset.move) { moveInto(kind, el.dataset.move, f.id); focusK('fo-' + f.id); return; }
    L.render(); L.saved('folder “' + name + '”'); focusK('fo-' + f.id);
  };
  L.acts.fotoggle = function (el) { var f = folder(el.dataset.kind, el.dataset.id); f.closed = !f.closed; L.render(); L.say(f.name + (f.closed ? ' folded' : ' open')); focusK('fo-' + f.id); };
  L.acts.fomenu = function (el) {
    var d = 'data-kind="' + el.dataset.kind + '" data-id="' + el.dataset.id + '"', f = folder(el.dataset.kind, el.dataset.id);
    L.menu(el, '<button role="menuitem" data-act="forename" ' + d + '>' + L.icon('edit', 's') + 'Rename…</button>' +
      '<button role="menuitem" data-act="fonew" data-kind="' + el.dataset.kind + '" data-parent="' + f.id + '">' + L.icon('folder', 's') + 'New folder inside…</button>' +
      '<button role="menuitem" data-act="focolour" ' + d + '>' + L.icon('palette', 's') + 'Colour…</button><div class="sep"></div>' +
      '<button role="menuitem" data-act="fodel" ' + d + '>' + L.icon('trash', 's') + 'Delete folder</button>', 'More for the folder ' + f.name);
  };
  L.acts.forename = function (el) { var f = folder(el.dataset.kind, el.dataset.id); nameSheet('Rename ' + f.name, f.name, 'Rename', 'forenameok', 'data-kind="' + el.dataset.kind + '" data-id="' + f.id + '"'); };
  L.acts.forenameok = function (el) { var f = folder(el.dataset.kind, el.dataset.id), v = nameVal(); if (v) f.name = v; L.closeSheet(); L.render(); if (v) L.saved('folder name “' + v + '”'); focusK('fo-' + f.id); };
  L.acts.focolour = function (el) {
    var f = folder(el.dataset.kind, el.dataset.id);
    L.sheet({ title: 'Colour of ' + f.name, body: '<div class="tg-colours" role="radiogroup" aria-label="Colour">' + [''].concat(Object.keys(L.colors)).map(function (c) {
      return '<label class="lk-radio"><input type="radio" name="fo-col" value="' + c + '"' + ((f.color || '') === c ? ' checked' : '') + '><span class="tg-sw" style="background:' + (c ? L.colors[c] : 'transparent') + '" aria-hidden="true"></span><span>' + (c ? c[0].toUpperCase() + c.slice(1) : 'None') + '</span></label>';
    }).join('') + '</div>', footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="focolourok" data-kind="' + el.dataset.kind + '" data-id="' + f.id + '">Done</button>' });
  };
  L.acts.focolourok = function (el) { var f = folder(el.dataset.kind, el.dataset.id), c = document.querySelector('#lyre-sheet input[name=fo-col]:checked'); f.color = c ? c.value : ''; L.closeSheet(); L.render(); L.saved(f.name + ' colour'); };
  L.acts.fodel = function (el) {
    var kind = el.dataset.kind, f = folder(kind, el.dataset.id), list = folders(kind), inn = D.orgIn[kind], was = JSON.parse(JSON.stringify({ f: list, i: inn }));
    // What was inside moves up a level: its folders and its playlists or boards go where the folder was.
    list.forEach(function (x) { if (x.parent === f.id) x.parent = f.parent || ''; });
    Object.keys(inn).forEach(function (id) { if (inn[id] === f.id) { if (f.parent) inn[id] = f.parent; else delete inn[id]; } });
    list.splice(list.indexOf(f), 1);
    L.undoNote('Deleted the folder ' + f.name + '; what was in it moved up a level.', function () { list.splice.apply(list, [0, list.length].concat(was.f)); Object.keys(inn).forEach(function (k) { delete inn[k]; }); Object.assign(inn, was.i); });
    L.render(); L.say('Deleted the folder ' + f.name + '. What was in it moved up a level.');
  };
  L.acts.fomoveto = function (el) {
    var kind = el.dataset.kind, id = el.dataset.id, cur = D.orgIn[kind][id] || '';
    var opts = [['', 'No folder']].concat(folders(kind).map(function (f) { return [f.id, pathOf(kind, f)]; }));
    L.sheet({ title: 'Move ' + el.dataset.name + ' to', body: folders(kind).length ? '<div class="fo-pick" role="radiogroup" aria-label="Folder">' + opts.map(function (o) {
      return '<label class="lk-radio"><input type="radio" name="fo-to" value="' + o[0] + '"' + (cur === o[0] ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div>' : '<p>No folders yet.</p>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn" data-act="fonew" data-kind="' + kind + '" data-move="' + esc(id) + '">' + L.icon('folder', 's') + 'New folder…</button><button class="btn primary" data-act="fomovetook" data-kind="' + kind + '" data-id="' + esc(id) + '">Move</button>' });
    var f = document.querySelector('#lyre-sheet input:checked') || document.querySelector('#lyre-sheet input'); if (f) f.focus();
  };
  function moveInto(kind, id, fid) {
    if (fid) D.orgIn[kind][id] = fid; else delete D.orgIn[kind][id];
    var f = fid && folder(kind, fid); if (f) f.closed = false;
    var it = kind === 'playlists' ? L.playlist(id) : L.board(id);
    L.render(); L.saved((it ? it.name : 'it') + (f ? ' in ' + f.name : ' out of its folder'));
  }
  L.acts.fomovetook = function (el) { var c = document.querySelector('#lyre-sheet input[name=fo-to]:checked'); L.closeSheet(); moveInto(el.dataset.kind, el.dataset.id, c ? c.value : ''); };

  /* ---------- dividers ---------- */
  L.isDivider = function (id) { return String(id).indexOf('div:') === 0; };
  L.dividerRow = function (pl, id) {
    var name = D.dividers[id] || 'Section';
    return '<li class="pl-tr pl-div" data-tid="' + esc(id) + '" draggable="true" aria-label="Divider: ' + esc(name) + '"><span class="pl-grip" title="Drag to change the order" aria-hidden="true">' + L.icon('drag') + '</span>' +
      '<span class="pl-div-line" aria-hidden="true"></span><b class="ellipsis pl-div-name">' + esc(name) + '</b><span class="pl-div-line" aria-hidden="true"></span>' +
      '<button class="btn s icon ghost" data-act="divmenu" data-pid="' + pl.id + '" data-id="' + esc(id) + '" data-k="div-more-' + esc(id) + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for the divider ' + esc(name) + '">' + L.icon('more', 's') + '</button></li>';
  };
  L.acts.divadd = function (el) { nameSheet('Add a divider', '', 'Add divider', 'divaddok', 'data-pid="' + el.dataset.pid + '" data-before="' + el.dataset.before + '"'); };
  L.acts.divaddok = function (el) {
    var pl = L.playlist(el.dataset.pid), name = nameVal() || 'Section', id = 'div:' + L.uid('');
    D.dividers[id] = name; var i = pl.items.indexOf(el.dataset.before); pl.items.splice(i < 0 ? pl.items.length : i, 0, id);
    L.closeSheet(); L.render(); L.saved(pl.name, { detail: 'divider “' + name + '”', key: 'div-' + pl.id }); focusK('div-more-' + id);
  };
  L.acts.divmenu = function (el) {
    var d = 'data-pid="' + el.dataset.pid + '" data-id="' + esc(el.dataset.id) + '"';
    L.menu(el, '<button role="menuitem" data-act="divren" ' + d + '>' + L.icon('edit', 's') + 'Rename…</button><button role="menuitem" data-act="divrm" ' + d + '>' + L.icon('close', 's') + 'Remove the divider</button>', 'More for the divider ' + (D.dividers[el.dataset.id] || ''));
  };
  L.acts.divren = function (el) { nameSheet('Rename the divider', D.dividers[el.dataset.id], 'Rename', 'divrenok', 'data-pid="' + el.dataset.pid + '" data-id="' + esc(el.dataset.id) + '"'); };
  L.acts.divrenok = function (el) { var v = nameVal(); if (v) D.dividers[el.dataset.id] = v; L.closeSheet(); L.render(); if (v) L.saved('divider “' + v + '”'); };
  L.acts.divrm = function (el) { var pl = L.playlist(el.dataset.pid), i = pl.items.indexOf(el.dataset.id); if (i > -1) pl.items.splice(i, 1); L.render(); L.saved(pl.name, { detail: 'divider removed', key: 'div-' + pl.id }); };

  L.boardDividerHTML = function (b, row) {
    var name = b.dividers && b.dividers[row]; if (!name) return '';
    return '<div class="pb-div" style="grid-column:1/-1"><h3 class="pb-div-h ellipsis">' + esc(name) + '</h3><button class="btn s icon ghost" data-act="pbdivrm" data-bid="' + b.id + '" data-row="' + row + '" data-k="pbdiv-' + row + '" title="Remove this divider" aria-label="Remove the divider ' + esc(name) + '">' + L.icon('close', 's') + '</button></div>';
  };
  L.boardDividerItem = function (b) { return '<button role="menuitem" data-act="pbdivadd" data-bid="' + b.id + '">' + L.icon('list', 's') + 'Add a divider…</button>'; };
  L.acts.pbdivadd = function (el) {
    var b = L.board(el.dataset.bid), rows = ''; for (var r = 1; r <= b.rows; r++) rows += '<option value="' + r + '">' + r + '</option>';
    L.sheet({ title: 'Add a divider', body: '<div class="field"><label for="fo-name">Name</label><input class="input" id="fo-name" autocomplete="off" placeholder="For example Spells"></div>' +
      '<div class="field"><label for="pb-divrow">Above row</label><select class="input" id="pb-divrow">' + rows + '</select></div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="pbdivaddok" data-bid="' + b.id + '">Add divider</button>' });
    document.getElementById('fo-name').focus();
  };
  L.acts.pbdivaddok = function (el) {
    var b = L.board(el.dataset.bid), name = nameVal(), row = +document.getElementById('pb-divrow').value; if (!name) { L.toast('Give the divider a name'); return; }
    b.dividers = b.dividers || {}; b.dividers[row] = name; L.closeSheet(); L.render(); L.saved(b.name, { detail: 'divider “' + name + '” above row ' + row });
  };
  L.acts.pbdivrm = function (el) { var b = L.board(el.dataset.bid); delete b.dividers[el.dataset.row]; L.render(); L.saved(b.name, { detail: 'divider removed' }); };

  /* ---------- where things can go (the drop tray and Add to…) ---------- */
  function campaign() { return L.campaign(L.state.ctx && L.state.ctx.cid) || D.campaigns[0]; }
  function places(kind, ids, from) {
    var c = campaign(), s = L.nextSession(c), out = [];
    if (kind === 'track') {
      var ts = ids.map(L.track).filter(Boolean), lane = ts[0] ? (L.isFx(ts[0]) ? 'fx' : ts[0].kind) : 'music';
      var pls = D.playlists.filter(function (p) { return p.kind === 'manual' && p.id !== from && (p.lane === lane || (lane === 'fx' && p.lane === 'music' && ts.every(function (t) { return t.kind === 'music'; }))); });
      pls.sort(function (a, b) { return (c.playlists.indexOf(b.id) > -1) - (c.playlists.indexOf(a.id) > -1); });
      pls.forEach(function (p) { out.push({ g: 'Playlists', key: 'pl:' + p.id, name: p.name }); });
      if (ts.some(L.isFx)) D.boards.forEach(function (b) { out.push({ g: 'Pad boards', key: 'pb:' + b.id, name: b.name, label: b.name + ' (new pad)' }); });
    }
    if (kind !== 'boards') {
      var rs = L.rooms(); (rs.length ? rs : [{ id: 'table', name: 'Table' }]).forEach(function (r) { out.push({ g: 'Up next', key: 'q:' + r.id, name: 'Up next in ' + r.name }); });
    }
    if (s) s.scenes.forEach(function (sc) { out.push({ g: 'Scenes in Session ' + s.n, key: 'sc:' + c.id + ':' + s.id + ':' + sc.id, name: sc.name, label: 'Session ' + s.n + ' › ' + sc.name }); });
    return out;
  }
  function nameOf(kind, ids) {
    if (ids.length > 1) return ids.length + (kind === 'track' ? ' tracks' : kind === 'playlists' ? ' playlists' : ' boards');
    return kind === 'track' ? L.title(L.track(ids[0])) : kind === 'playlists' ? L.playlist(ids[0]).name : L.board(ids[0]).name;
  }
  // Puts ids (tracks, playlists or boards) in one place; move: out of the playlist they came from too.
  function put(key, kind, ids, from, move) {
    var a = key.split(':'), what = nameOf(kind, ids), detail = ids.length === 1 ? what : what + ' added', src = from && L.playlist(from);
    if (a[0] === 'pl') {
      var pl = L.playlist(a[1]), added = ids.filter(function (id) { return pl.items.indexOf(id) < 0; });
      pl.items = pl.items.concat(added);
      if (move && src) { src.items = src.items.filter(function (id) { return ids.indexOf(id) < 0; }); L.render(); L.saved(pl.name + ' and ' + src.name, { detail: 'Moved to ' + pl.name + ': ' + what }); return; }
      L.render(); if (!added.length) { L.toast('Already in ' + pl.name); return; }
      L.saved(pl.name, { detail: added.length === 1 ? L.title(L.track(added[0])) : added.length + ' tracks added' }); return;
    }
    if (a[0] === 'pb') {
      var b = L.board(a[1]);
      ids.forEach(function (id) {
        var t = L.track(id), pad = { id: L.uid('pad'), label: L.title(t).split(/[,(-]/)[0].trim().slice(0, 24), icon: 'note', color: 'bone', key: '', mode: 'oneshot', sound: { kind: 'single', files: [t.file] }, vol: 80, fade: 1.5 };
        var i = b.slots.indexOf(null); if (i > -1) b.slots[i] = pad; else b.spare.push(pad);
      });
      L.render(); L.saved(b.name, { detail: ids.length === 1 ? 'new pad ' + what : ids.length + ' new pads' }); return;
    }
    if (a[0] === 'q') {
      ids.forEach(function (id) { L.acts.lvqueue({ dataset: kind === 'playlists' ? { whole: id, box: 'music' } : { id: id, box: 'music' } }); });
      L.toast('Added to ' + (places(kind, ids, from).filter(function (p) { return p.key === key; })[0] || { name: 'Up next' }).name + ': ' + what); return;
    }
    if (a[0] === 'sc') {
      var s = L.session(a[1], a[2]), sc = s && s.scenes.filter(function (x) { return x.id === a[3]; })[0]; if (!sc) return;
      if (kind === 'boards') { sc.boards = (sc.boards || []).concat(ids.filter(function (id) { return (sc.boards || []).indexOf(id) < 0; })); L.render(); L.saved(sc.name + ' pad boards', { detail: detail }); return; }
      sc.music = sc.music.concat(ids.filter(function (id) { return sc.music.indexOf(id) < 0; })); L.render(); L.saved(sc.name + ' music', { detail: detail });
    }
  }

  /* The drop tray: shown from dragstart to dragend. */
  var drag = null, shiftDown = false;
  function trayHTML() {
    var ps = places(drag.kind, drag.ids, drag.from), groups = [];
    ps.forEach(function (p) { if (groups.indexOf(p.g) < 0) groups.push(p.g); });
    var canMove = drag.kind === 'track' && !!drag.from;
    return '<header class="dt-head"><b>' + esc(nameOf(drag.kind, drag.ids)) + '</b><span class="faint dt-how" id="dt-how">' + (canMove ? (shiftDown ? 'Moves it' : 'Copies it · Shift moves') : 'Adds it') + ' · Esc cancels</span></header>' +
      groups.map(function (g) {
        return '<div class="dt-g" role="group" aria-label="' + esc(g) + '"><h3 class="dt-gh">' + esc(g) + '</h3>' + ps.filter(function (p) { return p.g === g; }).map(function (p) {
          // Names are told apart by their group for screen readers (a scene and a playlist can share a name).
          return '<button class="dt-t" type="button" data-dropto="' + esc(p.key) + '" tabindex="-1">' + esc(p.name) + (p.g === 'Playlists' || p.g === 'Up next' ? '' : '<span class="sr-only">, ' + (p.g === 'Pad boards' ? 'new pad' : 'scene') + '</span>') + '</button>';
        }).join('') + '</div>';
      }).join('');
  }
  function showTray() {
    var t = document.getElementById('lyre-droptray'); if (!t) { t = document.createElement('section'); t.id = 'lyre-droptray'; t.className = 'droptray'; t.setAttribute('aria-label', 'Drop on'); document.body.appendChild(t); }
    t.innerHTML = trayHTML();
  }
  function hideTray() { var t = document.getElementById('lyre-droptray'); if (t) t.remove(); }
  function marks(off) { document.querySelectorAll('.dt-over').forEach(function (n) { n.classList.remove('dt-over'); }); return off; }
  document.addEventListener('dragstart', function (e) {
    var it = e.target.closest && e.target.closest('[data-org], .pl-tr[data-tid]'); if (!it) return;
    var kind, ids, from = '';
    if (it.dataset.org) { var a = it.dataset.org.split(':'); kind = a[0]; ids = a.slice(1).join(':').split(','); }
    else { if (L.isDivider(it.dataset.tid)) return; kind = 'track'; ids = [it.dataset.tid]; var r = L.current(); if (r.name === 'playlist') { var pl = L.playlist(r.p.pid); if (pl && pl.kind === 'manual') from = pl.id; } }
    drag = { kind: kind, ids: ids, from: from, cancelled: false };
    shiftDown = e.shiftKey || shiftDown;
    try { e.dataTransfer.effectAllowed = 'copyMove'; if (!e.dataTransfer.getData('text/plain')) e.dataTransfer.setData('text/plain', ids.join(',')); } catch (x) { /* older engines */ }
    setTimeout(showTray, 0);
  });
  document.addEventListener('dragover', function (e) {
    if (!drag || drag.cancelled) return;
    var t = e.target.closest && e.target.closest('[data-dropto], [data-orgdrop]');
    if (e.shiftKey !== shiftDown && drag.kind === 'track') { shiftDown = e.shiftKey || shiftDown; var h = document.getElementById('dt-how'); if (h && drag.from) h.textContent = (shiftDown ? 'Moves it' : 'Copies it · Shift moves') + ' · Esc cancels'; }
    if (!t) return;
    if (t.dataset.orgdrop && t.dataset.orgdrop.split(':')[0] !== drag.kind) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = shiftDown && drag.from ? 'move' : 'copy'; } catch (x) { /* read-only in some engines */ }
    if (!t.classList.contains('dt-over')) { marks(); t.classList.add('dt-over'); }
  });
  document.addEventListener('dragleave', function (e) { var t = e.target.closest && e.target.closest('[data-dropto], [data-orgdrop]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('dt-over'); });
  document.addEventListener('drop', function (e) {
    if (!drag) return;
    if (drag.cancelled) { e.preventDefault(); e.stopPropagation(); return; }
    var t = e.target.closest && e.target.closest('[data-dropto], [data-orgdrop]'); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    var d = drag; drag = null; hideTray(); marks();
    if (t.dataset.orgdrop) { var a = t.dataset.orgdrop.split(':'); if (a[0] === d.kind) d.ids.forEach(function (id) { moveInto(d.kind, id, a[1]); }); return; }
    put(t.dataset.dropto, d.kind, d.ids, d.from, (e.shiftKey || shiftDown) && !!d.from);
  }, true);
  document.addEventListener('dragend', function () { drag = null; shiftDown = false; hideTray(); marks(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Shift') shiftDown = true;
    if (drag && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); drag.cancelled = true; hideTray(); marks(); L.say('Drag cancelled'); }
  }, true);
  document.addEventListener('keyup', function (e) { if (e.key === 'Shift') shiftDown = false; }, true);

  /* Add to… (the keyboard's way): the same places, as a list. */
  L.acts.addto = function (el) {
    var ids = el.dataset.ids.split(','), from = el.dataset.from || '', kind = el.dataset.kind || 'track', ps = places(kind, ids, from), groups = [];
    ps.forEach(function (p) { if (groups.indexOf(p.g) < 0) groups.push(p.g); });
    var src = from && L.playlist(from);
    L.sheet({ title: 'Add ' + nameOf(kind, ids) + ' to', body: '<div class="addto">' + groups.map(function (g) {
      return '<fieldset class="addto-g"><legend>' + esc(g) + '</legend>' + ps.filter(function (p) { return p.g === g; }).map(function (p) {
        return '<label class="lk-radio"><input type="radio" name="addto" value="' + esc(p.key) + '"><span>' + esc(p.label || p.name) + '</span></label>';
      }).join('') + '</fieldset>';
    }).join('') + '</div>' + (src ? '<label class="lv-switch addto-move"><input type="checkbox" role="switch" id="addto-move"><span class="lv-switch-t"><b>Move it out of ' + esc(src.name) + '</b></span></label>' : ''),
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="addtook" data-ids="' + esc(ids.join(',')) + '" data-from="' + esc(from) + '" data-kind="' + kind + '">Add</button>' });
    var f = document.querySelector('#lyre-sheet input[name=addto]'); if (f) f.focus();
  };
  L.acts.addtook = function (el) {
    var c = document.querySelector('#lyre-sheet input[name=addto]:checked'); if (!c) { L.toast('Choose where it goes'); return; }
    var mv = document.getElementById('addto-move'), move = !!(mv && mv.checked);
    L.closeSheet(); put(c.value, el.dataset.kind, el.dataset.ids.split(','), el.dataset.from, move);
  };
})();
