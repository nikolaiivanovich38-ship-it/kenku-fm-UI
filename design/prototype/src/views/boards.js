/* Pad boards: the list of boards (#/boards) and the board editor (#/board/<id>).
   A board has cols × rows slots (null = empty) and a spare tray. Resizing (round 5, SFX-11) fills the new grid left to
   right, top to bottom, with the pads in their order, then the spare pads; only pads that do not fit go to Spare pads
   (never deleted), with Undo. The rule is reflowBoard in src/common/domain/round5.ts.
   Try pads (round 5, SFX-12): while on, pressing a pad or its key plays it as it will play in Live (one-shot, toggle
   loop, hold to play, restart on press), but only in Nik's headphones. */
(function () {
  var esc = L.esc, D = L.data;
  var MAX = 8, QUICK = [[2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [6, 4]];
  var ui = { sel: null, focus: {}, msg: null, capture: false, last: { pid: null, t: 0 }, menuPad: null, menuAnchor: null, pendingFocus: null, nb: null, trying: false, tries: {}, held: null };
  var MODE_HELP = {
    oneshot: 'Plays once from the start on each press. Quick presses overlap.',
    toggle: 'First press starts a loop; the next press fades it out.',
    hold: 'Plays while you hold the key or button, and fades when you let go.',
    retrigger: 'Each press stops the last one and starts again, so it never overlaps.'
  };
  var COLOUR_NAMES = { steel: 'Steel', ember: 'Ember', gold: 'Gold', moss: 'Moss', violet: 'Violet', plum: 'Plum', sea: 'Sea', bone: 'Bone' };
  var ICON_NAMES = { swords: 'Crossed swords', arrow: 'Arrow', shield: 'Shield', flame: 'Flame', bolt: 'Lightning', skull: 'Skull', heart: 'Heart', bell: 'Bell',
    drop: 'Drop', wind: 'Wind', rain: 'Rain', tree: 'Tree', door: 'Door', note: 'Music note', horn: 'Horn', ghost: 'Ghost', chain: 'Chain', wave: 'Waves', mug: 'Mug',
    eye: 'Eye', star: 'Star', drum: 'Drum', moon: 'Moon', claw: 'Claw marks', organ: 'Organ pipes', book: 'Book', users: 'People', map: 'Map', scroll: 'Scroll', crown: 'Crown' };
  // Pad icons: the core icon set without the icons that mean app controls (play, close, chevrons and so on).
  var PAD_ICONS = L.iconNames.filter(function (n) { return ICON_NAMES[n]; });
  var FX_FOLDER = 'H:\\Audio\\Effects';

  /* ---------- helpers ---------- */
  function useLabel(u) { return u.label; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function norm(b) {
    var n = b.cols * b.rows; b.spare = b.spare || [];
    while (b.slots.length < n) b.slots.push(null);
    if (b.slots.length > n) { b.slots.slice(n).forEach(function (p) { if (p) b.spare.push(p); }); b.slots.length = n; }
    return b;
  }
  function padCount(b) { return b.slots.filter(Boolean).length; }
  function emptyCount(b) { return b.slots.filter(function (p) { return !p; }).length; }
  function find(b, pid) {
    for (var i = 0; i < b.slots.length; i++) if (b.slots[i] && b.slots[i].id === pid) return { where: 'slot', i: i, pad: b.slots[i] };
    for (var j = 0; j < b.spare.length; j++) if (b.spare[j].id === pid) return { where: 'spare', i: j, pad: b.spare[j] };
    return null;
  }
  function place(b, i) { return 'row ' + (Math.floor(i / b.cols) + 1) + ', column ' + (i % b.cols + 1); }
  function sizeText(b) {
    var n = padCount(b), e = emptyCount(b);
    return b.cols + ' × ' + b.rows + ', ' + plural(n, 'pad') + (e ? ', ' + e + ' empty' : '') + (b.spare.length ? ', ' + b.spare.length + ' spare' : '');
  }
  function soundFiles(p) {
    var s = p.sound || { kind: 'single', files: [] };
    if (s.kind === 'tag') return tagFiles(s.tag);
    return s.kind === 'single' ? s.files.slice(0, 1) : s.files;
  }
  function allFxFiles() {
    var out = [];
    D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (p) { if (p && p.sound && p.sound.files) p.sound.files.forEach(function (f) { if (out.indexOf(f) < 0) out.push(f); }); }); });
    D.tracks.forEach(function (t) { if (t.kind === 'fx' && out.indexOf(t.file) < 0) out.push(t.file); });
    return out.sort();
  }
  function fxTrackByFile(f) { return D.tracks.filter(function (t) { return t.kind === 'fx' && t.file === f; })[0] || null; }
  function tagFiles(tag) { tag = (tag || '').trim().toLowerCase(); return tag ? allFxFiles().filter(function (f) { return f.toLowerCase().indexOf(tag) > -1; }) : []; }
  var TAG_SUGGEST = ['bell', 'door', 'water', 'ghost', 'chain', 'thunder', 'wind', 'glass', 'heartbeat', 'sword', 'roar', 'fire'];
  function slug(s) { return String(s || 'pad').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'pad'; }
  function keyOwner(b, key, notId) {
    if (!key) return null;
    return b.slots.concat(b.spare).filter(function (p) { return p && p.id !== notId && String(p.key).toLowerCase() === String(key).toLowerCase(); })[0] || null;
  }
  function board() { var r = L.current(); return r.name === 'board' ? L.board(r.p.bid) : null; }
  function selPad(b) { return ui.sel && ui.sel.bid === b.id ? find(b, ui.sel.pid) : null; }
  function select(b, pid) { ui.sel = pid ? { bid: b.id, pid: pid } : null; ui.capture = false; }
  function newPad(b) {
    return { id: L.uid('pad'), label: 'New pad', icon: 'star', color: 'gold', key: '', mode: 'oneshot', sound: { kind: 'single', files: [] }, vol: 80, fade: 1.5 };
  }
  function clonePad(p) { var c = JSON.parse(JSON.stringify(p)); c.id = L.uid('pad'); return c; }
  function swatch(p) { return 'style="--pc:' + (L.colors[p.color] || L.colors.bone) + '"'; }

  /* ---------- changes to a board ---------- */
  function resize(b, nc, nr) {
    nc = Math.max(1, Math.min(MAX, nc)); nr = Math.max(1, Math.min(MAX, nr));
    if (nc === b.cols && nr === b.rows) return;
    var snap = { cols: b.cols, rows: b.rows, slots: b.slots.slice(), spare: b.spare.slice() };
    var r = reflow(b.slots, b.spare, nc, nr), back = b.spare.filter(function (p) { return r.slots.indexOf(p) > -1; }), moved = r.spilled;
    b.slots = r.slots; b.cols = nc; b.rows = nr; b.spare = r.spare;
    var text = 'Grid is now ' + nc + ' × ' + nr + '. Pads fill it left to right, top to bottom.';
    if (moved.length) {
      text = 'Grid is now ' + nc + ' × ' + nr + ' and full. ' + plural(moved.length, 'pad') + ' moved to Spare pads: ' + moved.map(function (x) { return x.label; }).join(', ') + '. Nothing was deleted.';
      L.state.panes['pb-spare'] = 'o';
    } else if (back.length) {
      text = 'Grid is now ' + nc + ' × ' + nr + '. ' + plural(back.length, 'spare pad') + ' came back onto it: ' + back.map(function (x) { return x.label; }).join(', ') + '.';
    } else if (emptyCount(b)) {
      text = 'Grid is now ' + nc + ' × ' + nr + ': ' + plural(emptyCount(b), 'empty slot') + ' to fill.';
    }
    ui.msg = { bid: b.id, text: text, undo: snap };
    var f = ui.focus[b.id] || 0; if (f >= nc * nr) ui.focus[b.id] = 0;
    L.say(text); L.render();
  }
  // SFX-11, the same rule as reflowBoard in src/common/domain/round5.ts: the grid's pads in reading order, then the spare
  // pads, fill the new grid; what does not fit goes to Spare pads. The old lists are left as they are, for Undo.
  function reflow(slots, spare, cols, rows) {
    var size = Math.max(1, cols) * Math.max(1, rows), onGrid = slots.filter(Boolean), all = onGrid.concat(spare), next = all.slice(0, size);
    while (next.length < size) next.push(null);
    var rest = all.slice(size);
    return { slots: next, spare: rest, spilled: rest.filter(function (p) { return onGrid.indexOf(p) > -1; }) };
  }
  // to: 'spare' or 'slot:<i>'. Moving onto a pad swaps the two.
  function moveTo(b, pid, to) {
    var at = find(b, pid); if (!at) return;
    var p = at.pad, msg;
    if (to === 'spare') {
      if (at.where === 'spare') return;
      b.slots[at.i] = null; b.spare.push(p); msg = p.label + ' moved to Spare pads';
      L.state.panes['pb-spare'] = 'o';
    } else {
      var j = +to.split(':')[1], other = b.slots[j];
      if (at.where === 'slot') {
        if (at.i === j) return;
        b.slots[j] = p; b.slots[at.i] = other;
        ui.focus[b.id] = j;
      } else {
        b.spare.splice(at.i, 1); b.slots[j] = p;
        if (other) b.spare.splice(at.i, 0, other);
        ui.focus[b.id] = j;
      }
      msg = p.label + ' moved to ' + place(b, j) + (other ? ', swapped with ' + other.label + (at.where === 'spare' ? ', which went to Spare pads' : '') : '');
    }
    L.say(msg); L.render();
  }
  function putBack(b, pid) {
    var j = b.slots.indexOf(null); if (j < 0) { L.toast('No empty slot. Make the grid bigger first.'); return; }
    moveTo(b, pid, 'slot:' + j);
  }
  // Preview: only Nik hears it (core L.previewPad). Play on air: the players hear it.
  function previewPad(b, p) { L.previewPad(b.id, p.id); }
  function previewing(b, p) { return L.previewing('pad:' + b.id + '/' + p.id); }
  // Core does not re-render when a preview runs out, so the violet state is cleared here.
  function watchPreview() {
    clearTimeout(ui.pvTimer); var c = L.pb.preview;
    if (c && String(c.key).indexOf('pad:') === 0) ui.pvTimer = setTimeout(function () { if (!L.pb.preview || L.pb.preview.key !== c.key) L.render(); else watchPreview(); }, Math.max(200, (c.dur - c.pos) * 1000 + 300));
  }
  /* SFX-12 Try pads: a private test of a pad as it will play in Live. One-shot plays once (presses overlap), restart on
     press starts it again, toggle loop starts and stops, hold to play sounds while held. Only Nik hears it. */
  var TRY_LEN = 2.5;
  function tryKey(b, p) { return b.id + '/' + p.id; }
  function trying(b, p) { var x = ui.tries[tryKey(b, p)]; return !!(x && (x.loop || x.until > Date.now())); }
  function tryPad(b, p, phase) {
    var k = tryKey(b, p), on = trying(b, p), say = '';
    if (p.mode === 'toggle') { if (phase === 'up') return; if (on) { delete ui.tries[k]; say = p.label + ': loop stopped'; } else { ui.tries[k] = { loop: true }; say = p.label + ': loop playing in your headphones. Press again to stop it.'; } }
    else if (p.mode === 'hold') { if (phase === 'up') { if (!on) return; delete ui.tries[k]; say = p.label + ': let go, fading'; } else { if (on) return; ui.tries[k] = { loop: true }; say = p.label + ': playing while held'; } }
    else { if (phase === 'up') return; var again = on; ui.tries[k] = { until: Date.now() + TRY_LEN * 1000, n: (again ? (ui.tries[k].n || 1) + 1 : 1) }; say = p.label + (p.mode === 'retrigger' ? (again ? ': started again from the beginning' : ': playing') : again ? ': playing again over itself' : ': playing once'); }
    L.say(say + (say.indexOf('headphones') > -1 ? '' : ' (only you hear it)')); L.render(); watchTries();
  }
  function watchTries() { clearTimeout(ui.tryTimer); var soon = Object.keys(ui.tries).map(function (k) { return ui.tries[k].until; }).filter(Boolean); if (!soon.length) return;
    ui.tryTimer = setTimeout(function () { var now = Date.now(); Object.keys(ui.tries).forEach(function (k) { if (ui.tries[k].until && ui.tries[k].until <= now) delete ui.tries[k]; }); if (L.current().name === 'board') L.render(); watchTries(); }, Math.max(100, Math.min.apply(null, soon) - Date.now() + 30)); }
  function stopTries() { ui.tries = {}; ui.held = null; clearTimeout(ui.tryTimer); }
  function firePad(b, p) {
    if (p.mode === 'hold') { L.firePad(b.id, p.id, 'down'); setTimeout(function () { L.firePad(b.id, p.id, 'up'); }, 1500); }
    else L.firePad(b.id, p.id);
    L.say((p.mode === 'toggle' && L.padActive(b.id, p.id) ? 'Started on air: ' : 'On air: ') + p.label);
  }

  /* ---------- all pad boards ---------- */
  function mini(b) {
    var cells = b.slots.map(function (p) { return p ? '<i class="pb-cell on" ' + swatch(p) + '></i>' : '<i class="pb-cell"></i>'; }).join('');
    return '<span class="pb-mini" style="grid-template-columns:repeat(' + b.cols + ',10px)" aria-hidden="true">' + cells + '</span>';
  }
  var bf = { q: '', used: 'all', cid: 'all' };
  function padHits(b) { var q = bf.q.trim().toLowerCase(); return q ? b.slots.concat(b.spare).filter(function (p) { return p && p.label.toLowerCase().indexOf(q) > -1; }) : []; }
  function shown() {
    var q = bf.q.trim().toLowerCase();
    return D.boards.filter(function (b) {
      norm(b); var uses = L.usesOfBoard(b.id);
      if (bf.used === 'used' && !uses.length) return false;
      if (bf.used === 'unused' && uses.length) return false;
      if (bf.cid !== 'all' && !uses.some(function (u) { return u.campaign.id === bf.cid; })) return false;
      return !q || b.name.toLowerCase().indexOf(q) > -1 || padHits(b).length > 0;
    });
  }
  function filtSeg() {
    return '<div class="seg s" role="group" aria-label="Used or not">' + [['all', 'All'], ['used', 'Used'], ['unused', 'Not used yet']].map(function (o) {
      return '<button type="button" data-act="pbfilt" data-v="' + o[0] + '" data-k="pbf-' + o[0] + '" aria-pressed="' + (bf.used === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  L.inputs.pbq = function (el) { bf.q = el.value; L.render(); };
  L.acts.pbfilt = function (el) { bf.used = el.dataset.v; L.render(); L.say(shown().length + ' pad boards shown'); };
  L.inputs.pbcamp = function (el) { bf.cid = el.value; L.render(); L.say(shown().length + ' pad boards shown'); };
  L.acts.pbclear = function () { bf = { q: '', used: 'all', cid: 'all' }; ui.pendingFocus = 'pbq'; L.render(); };
  function card(b) {
    norm(b); var uses = L.usesOfBoard(b.id), hits = padHits(b);
    return '<li class="pb-card">' +
      '<a class="pb-card-main" href="#/board/' + b.id + '" data-k="card-' + b.id + '" tabindex="-1">' + mini(b) +
      '<span class="pb-card-text"><span class="pb-card-name ellipsis">' + esc(b.name) + '</span><span class="pb-card-size">' + esc(sizeText(b)) + '</span></span></a>' +
      (hits.length ? '<div class="pb-card-used"><span class="pb-lbl">Pads</span> <span class="pb-used-text">' + esc(hits.map(function (p) { return p.label; }).join(', ')) + '</span></div>' : '') +
      '<div class="pb-card-used" title="' + esc(uses.map(useLabel).join('\n')) + '"><span class="pb-used-text">' + (uses.length ? 'Used in ' + plural(uses.length, 'place') : '<span class="faint">Not used yet</span>') + '</span></div>' +
      '<div class="pb-card-acts">' +
      '<a class="btn s" href="#/board/' + b.id + '" data-k="edit-' + b.id + '" aria-label="Open ' + esc(b.name) + '">Open</a><span class="grow"></span>' +
      L.previewButton('board', b.id) +
      '<button class="btn s icon" data-act="pbcardmenu" data-id="' + b.id + '" data-k="more-' + b.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(b.name) + '">' + L.icon('more', 's') + '</button>' +
      '</div></li>';
  }
  L.view('boards', {
    nav: 'boards',
    title: function () { return 'Pad boards'; },
    notes: boardNotes(),
    render: function () {
      var list = shown(), all = D.boards.length, any = bf.q || bf.used !== 'all' || bf.cid !== 'all';
      return '<div class="viewhead"><h1>Pad boards</h1><span class="muted grow pb-sub">' + (any ? 'Showing ' + list.length + ' of ' + all : plural(all, 'board')) + '</span>' +
        '<button class="btn primary" data-act="pbnew" data-k="pb-new">' + L.icon('plus', 's') + 'New board</button></div>' +
        '<div class="viewbody"><div class="pb-ltools"><div class="search pb-lsearch">' + L.icon('search') + '<input class="input" type="search" placeholder="Search boards and pads" aria-label="Search pad boards by board name or pad label" data-input="pbq" data-k="pbq" value="' + esc(bf.q) + '"></div>' +
        filtSeg() + '<label class="pb-camp"><span>Campaign</span><select class="input" data-input="pbcamp" data-k="pbcamp">' +
        '<option value="all">All campaigns</option>' + D.campaigns.map(function (c) { return '<option value="' + c.id + '"' + (bf.cid === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label></div>' +
        (list.length ? '<ul class="pb-cards" aria-label="Pad boards">' + list.map(card).join('') + '</ul>'
          : all ? '<div class="empty">No pad boards match. <button class="btn s" data-act="pbclear" data-k="pbclear">Show all boards</button></div>' : '<p class="empty"><b>No pad boards yet.</b> A pad board is a grid of buttons for sound effects you play during a game, each with its own key. Start with <b>New board</b>.</p>') + '</div>';
    },
    after: function (root) { if (ui.pendingFocus) { var n = root.querySelector('[data-k="' + ui.pendingFocus + '"]'); ui.pendingFocus = null; if (n) n.focus(); } }
  });

  /* New board */
  function nbBody() {
    return '<div class="stack"><div class="field"><label for="pb-nb-name">Name</label><input id="pb-nb-name" class="input" data-input="pbnbname" value="' + esc(ui.nb.name) + '" placeholder="For example: Harbour at night"></div>' +
      '<fieldset class="pb-fs"><legend>Starting size (columns × rows)</legend><div class="pb-qs" role="radiogroup" aria-label="Starting size">' +
      QUICK.map(function (q) { var on = ui.nb.cols === q[0] && ui.nb.rows === q[1]; return '<label class="pb-qs-opt"><input type="radio" name="pb-nb-size" value="' + q[0] + 'x' + q[1] + '" data-input="pbnbsize"' + (on ? ' checked' : '') + '><span>' + q[0] + ' × ' + q[1] + '</span><span class="hint">' + q[0] * q[1] + ' pads</span></label>'; }).join('') +
      '<label class="pb-qs-opt"><input type="radio" name="pb-nb-size" value="custom" data-input="pbnbsize"' + (QUICK.some(function (q) { return ui.nb.cols === q[0] && ui.nb.rows === q[1]; }) ? '' : ' checked') + '><span>Custom</span><span class="hint">1 to 8 each</span></label></div>' +
      '<div class="row-flex pb-nb-custom"><div class="field"><label for="pb-nb-c">Columns</label><input id="pb-nb-c" class="input num" type="number" min="1" max="8" value="' + ui.nb.cols + '" data-input="pbnbnum"></div>' +
      '<span class="pb-x" aria-hidden="true">×</span><div class="field"><label for="pb-nb-r">Rows</label><input id="pb-nb-r" class="input num" type="number" min="1" max="8" value="' + ui.nb.rows + '" data-input="pbnbnum"></div></div></fieldset>' +
      '<p class="hint">You can make it bigger or smaller at any time. Pads never get deleted when you make it smaller.</p></div>';
  }
  L.acts.pbnew = function () {
    ui.nb = { name: '', cols: 4, rows: 3 };
    L.sheet({ title: 'New pad board', body: nbBody(), footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="pbnbcreate">Make board</button>' });
  };
  L.inputs.pbnbname = function (el) { ui.nb.name = el.value; };
  L.inputs.pbnbsize = function (el) {
    if (el.value === 'custom') { document.getElementById('pb-nb-c').focus(); return; }
    var q = el.value.split('x'); ui.nb.cols = +q[0]; ui.nb.rows = +q[1];
    document.getElementById('pb-nb-c').value = ui.nb.cols; document.getElementById('pb-nb-r').value = ui.nb.rows;
  };
  L.inputs.pbnbnum = function () {
    var c = Math.max(1, Math.min(MAX, +document.getElementById('pb-nb-c').value || 1)), r = Math.max(1, Math.min(MAX, +document.getElementById('pb-nb-r').value || 1));
    ui.nb.cols = c; ui.nb.rows = r;
    var v = c + 'x' + r, radios = document.querySelectorAll('input[name="pb-nb-size"]'), hit = false;
    radios.forEach(function (x) { x.checked = x.value === v; if (x.checked) hit = true; });
    if (!hit) radios[radios.length - 1].checked = true;
  };
  L.acts.pbnbcreate = function () {
    var name = (ui.nb.name || '').trim() || 'Untitled board', id = slug(name), n = 2;
    while (L.board(id)) id = slug(name) + '-' + n++;
    var slots = []; for (var i = 0; i < ui.nb.cols * ui.nb.rows; i++) slots.push(null);
    D.boards.push({ id: id, name: name, cols: ui.nb.cols, rows: ui.nb.rows, spare: [], slots: slots });
    L.closeSheet(); ui.sel = null; L.toast('Made "' + name + '". Click an empty slot to add a pad.'); L.route('#/board/' + id);
  };
  L.acts.pbuse = function (el) { L.assignSheet('board', el.dataset.id); };
  L.acts.pbdupboard = function (el) {
    var b = L.board(el.dataset.id), c = JSON.parse(JSON.stringify(b)), id = b.id + '-copy', n = 2;
    while (L.board(id)) id = b.id + '-copy' + n++;
    c.id = id; c.name = b.name + ' (copy)'; D.boards.splice(D.boards.indexOf(b) + 1, 0, c);
    L.toast('Made "' + c.name + '". It is not used anywhere yet.'); L.render();
  };
  L.acts.pbdelboard = function (el) {
    var b = L.board(el.dataset.id), uses = L.usesOfBoard(b.id);
    L.sheet({ title: 'Delete "' + b.name + '"?',
      body: '<div class="stack">' + (uses.length ? '<p>This board is used in:</p><ul class="pb-uselist">' + uses.map(function (u) { return '<li>' + esc(useLabel(u)) + '</li>'; }).join('') + '</ul><p>Those places will have no pad board until you choose another.</p>' : '<p>This board is not used anywhere.</p>') +
        '<p class="muted">Its ' + plural(padCount(b) + b.spare.length, 'pad') + ' go with it. The sound files stay in your library.</p></div>',
      footer: '<button class="btn" data-act="closesheet">Keep it</button><button class="btn danger" data-act="pbdelboardok" data-id="' + b.id + '">Delete board</button>' });
  };
  L.acts.pbdelboardok = function (el) {
    var id = el.dataset.id, b = L.board(id), restore = L.snapshot(['boards', 'campaigns']);
    L.undoNote('Deleted the pad board "' + b.name + '" and took it out of the places that used it.', restore);
    D.campaigns.forEach(function (c) {
      c.boards = c.boards.filter(function (x) { return x !== id; });
      c.sessions.forEach(function (s) { s.boards = s.boards.filter(function (x) { return x !== id; }); s.scenes.forEach(function (sc) { sc.boards = L.sceneBoards(sc).filter(function (x) { return x !== id; }); if (sc.board === id) sc.board = ''; }); });
    });
    D.boards.splice(D.boards.indexOf(b), 1); L.closeSheet();

    if (L.current().name === 'board') L.route('#/boards'); else L.render();
  };

  /* ---------- board editor ---------- */
  function slotHTML(b, p, i, sel, fi) {
    var tab = i === fi ? '0' : '-1', rc = place(b, i);
    if (!p) {
      return '<div class="pb-slot" data-drop="slot:' + i + '"><button class="pb-empty" data-act="pbadd" data-i="' + i + '" data-k="slot-' + i + '" data-slot="' + i + '" tabindex="' + tab + '" aria-label="Empty slot, ' + rc + '. Add a pad">' + L.icon('plus', 's') + '<span class="pb-empty-t">Add pad</span></button></div>';
    }
    var on = L.padActive(b.id, p.id), pv = previewing(b, p), isSel = sel && sel.pad.id === p.id, tr = trying(b, p);
    // While trying, the tile is the pad as in Live: pressing it plays it (aria-pressed shows a toggle loop or a held pad sounding).
    var pressed = ui.trying ? (p.mode === 'toggle' || p.mode === 'hold' ? tr : false) : !!isSel;
    return '<div class="pb-slot pb-has' + (isSel ? ' sel' : '') + (on ? ' on' : '') + (pv ? ' pv' : '') + (tr ? ' trying' : '') + '" ' + swatch(p) + ' data-drop="slot:' + i + '"><button class="pb-pad' + (isSel ? ' sel' : '') + '" draggable="' + !ui.trying + '" data-drag="' + p.id + '" data-act="' + (ui.trying ? (p.mode === 'hold' ? 'pbnoop' : 'pbtry') : 'pbpad') + '" data-mode="' + p.mode + '" data-pid="' + p.id + '" data-k="slot-' + i + '" data-slot="' + i + '" tabindex="' + tab + '" aria-pressed="' + pressed + '"' +
      ' aria-label="' + esc(p.label) + (p.key ? ' ' + esc(String(p.key).toUpperCase()) : '') + ': ' + L.modeName[p.mode] + ', ' + rc + (on ? ', on air' : tr ? ', trying' : pv ? ', previewing' : '') + '">' +
      '<span class="pb-pad-label">' + esc(p.label) + '</span> ' +
      '<span class="pb-pad-meta">' + (p.key ? '<span class="kbd">' + esc(String(p.key).toUpperCase()) + '</span>' : '') + '<span class="pb-mode" title="' + L.modeName[p.mode] + '">' + L.icon(L.modeIcon[p.mode], 's') + '</span>' +
      (on ? '<span class="pb-playing">On air</span>' : tr ? '<span class="pb-trying">' + (p.mode === 'toggle' || p.mode === 'hold' ? 'Sounding' : 'Playing') + '</span>' : '') + '</span></button><span class="pb-tile-pv">' + L.previewButton('pad', b.id + '/' + p.id).replace('<button ', '<button tabindex="-1" ').replace(L.icon('headphones', 's'), L.icon('play', 's')) + '</span></div>';
  }
  function stepper(label, axis, val) {
    var lo = val <= 1, hi = val >= MAX;
    return '<div class="pb-step" role="group" aria-label="' + label + '"><span class="pb-step-l">' + label + '</span>' +
      '<button class="btn s icon" data-act="pbsize" data-axis="' + axis + '" data-d="-1" data-k="pb-' + axis + '-dn" aria-label="Fewer ' + label.toLowerCase() + '" title="Fewer ' + label.toLowerCase() + '"' + (lo ? ' aria-disabled="true"' : '') + '>' + L.icon('minus', 's') + '</button>' +
      '<span class="pb-step-v num" aria-live="polite">' + val + '</span>' +
      '<button class="btn s icon" data-act="pbsize" data-axis="' + axis + '" data-d="1" data-k="pb-' + axis + '-up" aria-label="More ' + label.toLowerCase() + '" title="More ' + label.toLowerCase() + '"' + (hi ? ' aria-disabled="true"' : '') + '>' + L.icon('plus', 's') + '</button></div>';
  }
  function gridPane(b, sel) {
    var fi = Math.min(ui.focus[b.id] || 0, b.slots.length - 1), n = padCount(b), slots = b.slots.length;
    var msg = ui.msg && ui.msg.bid === b.id ? '<div class="pb-msg" role="status">' + L.icon('check', 's') + '<span class="grow">' + esc(ui.msg.text) + '</span>' +
      '<button class="btn s" data-act="pbundo" data-k="pb-undo">Undo</button><button class="closer" data-act="pbmsgx" data-k="pb-msgx" title="Dismiss" aria-label="Dismiss message">' + L.icon('close') + '</button></div>' : '';
    var body = '<div class="pb-tools">' +
      '<div class="field pb-name"><label for="pb-name">Board name</label><input id="pb-name" class="input" data-input="pbname" data-k="pb-name" value="' + esc(b.name) + '"></div>' +
      '<div class="pb-sizes">' + stepper('Columns', 'c', b.cols) + stepper('Rows', 'r', b.rows) +
      '<div class="seg s" role="group" aria-label="Quick sizes">' + QUICK.map(function (q) {
        var on = b.cols === q[0] && b.rows === q[1];
        return '<button data-act="pbquick" data-c="' + q[0] + '" data-r="' + q[1] + '" data-k="pb-q' + q[0] + q[1] + '" aria-pressed="' + on + '" aria-label="' + q[0] + '×' + q[1] + ', ' + q[0] + ' columns by ' + q[1] + ' rows">' + q[0] + '×' + q[1] + '</button>';
      }).join('') + '</div>' +
      '<span class="pb-count"><b class="num">' + n + '</b> of <b class="num">' + slots + '</b> slots used</span></div></div>' + msg +
      '<div class="pb-grid" role="group" aria-label="Pads, ' + b.cols + ' columns by ' + b.rows + ' rows" aria-describedby="pb-gridhelp" style="grid-template-columns:repeat(' + b.cols + ',minmax(0,1fr))">' +
      b.slots.map(function (p, i) { return slotHTML(b, p, i, sel, fi); }).join('') + '</div>' +
      '<p class="hint pb-help" id="pb-gridhelp">Drag to swap pads. Keys: arrows move, P previews, Alt+arrow moves the pad.</p>';
    var sounding = b.slots.filter(function (p) { return p && L.padActive(b.id, p.id); }).length;
    if (ui.trying) body = body.replace('<div class="pb-grid"', '<p class="pb-tryhint" role="note">' + L.icon('headphones', 's') + '<span>Trying: pads play as they will in Live, keys too, but only you hear them. Click a pad, or press its key; hold a Hold to play pad.</span></p><div class="pb-grid"');
    return L.pane({ id: 'pb-grid', title: 'Pads', icon: 'grid', kind: 'fx', size: 'auto', scroll: 'pb-grid', summary: esc(b.cols + ' × ' + b.rows),
      actions: '<button class="btn s pb-trybtn" data-act="pbtrymode" data-k="pb-trymode" aria-pressed="' + ui.trying + '" title="Press pads and their keys to hear how they play, in your headphones only">' + L.icon(ui.trying ? 'check' : 'headphones', 's') + 'Try pads</button>',
      status: sounding ? { text: sounding + ' sounding', tone: 'live' } : ui.trying ? { text: 'Trying', tone: 'on' } : n ? { text: plural(n, 'pad'), tone: 'idle' } : { text: 'Empty', tone: 'idle' }, body: body });
  }
  function sparePane(b, sel) {
    var empty = b.slots.indexOf(null) > -1, n = b.spare.length;
    var body = '<p class="pb-spare-intro">Pads that are not on the grid wait here; their keys do nothing until you put them back.</p>' +
      '<div class="pb-spare" data-drop="spare">' + (n ? '<ul class="list">' + b.spare.map(function (p) {
      var isSel = sel && sel.pad.id === p.id;
      return '<li class="lrow pb-sp' + (isSel ? ' selected' : '') + '" ' + swatch(p) + '>' +
        '<button class="pb-sp-pick" draggable="true" data-drag="' + p.id + '" data-act="pbpick" data-pid="' + p.id + '" data-k="sp-' + p.id + '" aria-pressed="' + !!isSel + '"><span class="ellipsis">' + esc(p.label) + '</span>' + (p.key ? '<span class="kbd pb-kbd-off" title="Does nothing while the pad is spare">' + esc(String(p.key).toUpperCase()) + '<span class="sr-only"> (key does nothing while spare)</span></span>' : '') + '</button>' +
        L.previewButton('pad', b.id + '/' + p.id) +
        '<button class="btn s icon" data-act="pbsparemenu" data-pid="' + p.id + '" data-k="spm-' + p.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(p.label) + '">' + L.icon('more', 's') + '</button></li>';
    }).join('') + '</ul>' : '<p class="pb-spare-empty">None. Drag a pad here to put it aside.</p>') + '</div>';
    return L.pane({ id: 'pb-spare', title: 'Spare pads', icon: 'queue', kind: 'fx', size: 'auto', collapsed: !n,
      summary: n ? esc(b.spare.map(function (p) { return p.label; }).join(', ')) : '',
      status: n ? { text: plural(n, 'pad'), tone: 'idle' } : { text: 'Empty', tone: 'idle' },
      actions: n && empty ? '<button class="btn s" data-act="pbputall" data-k="pb-putall">Put all back</button>' : '', body: body });
  }
  L.acts.pbsparemenu = function (el) {
    var b = board(), pid = el.dataset.pid, p = find(b, pid).pad, empty = b.slots.indexOf(null) > -1;
    ui.menuPad = pid; ui.menuAnchor = el;
    L.menu(el, '<div class="group">' + esc(p.label) + '</div>' +
      '<button role="menuitem" data-act="pbputback" data-pid="' + pid + '"' + (empty ? '' : ' disabled title="No empty slot: make the grid bigger first"') + '>' + L.icon('left', 's') + 'Put back in the grid</button>' +
      '<button role="menuitem" data-act="pbmovemenu2">Move to…</button><div class="sep"></div>' +
      '<button role="menuitem" data-act="pbdelpad" data-pid="' + pid + '">' + L.icon('trash', 's') + 'Delete pad…</button>', 'Spare pad');
  };
  function fieldset(legend, inner, cls) { return '<fieldset class="pb-fs' + (cls ? ' ' + cls : '') + '"><legend>' + legend + '</legend>' + inner + '</fieldset>'; }
  function soundEditor(p) {
    var s = p.sound, kinds = [['single', 'One file'], ['variants', 'Several variants'], ['tag', 'Any with a tag']];
    var h = '<div class="seg s pb-seg-wide" role="group" aria-label="Sound comes from">' + kinds.map(function (k) {
      return '<button data-act="pbsoundkind" data-v="' + k[0] + '" data-k="pbsk-' + k[0] + '" aria-pressed="' + (s.kind === k[0]) + '">' + k[1] + '</button>';
    }).join('') + '</div>';
    if (s.kind === 'tag') {
      var files = tagFiles(s.tag);
      h += '<div class="field"><label for="pb-tag">Tag</label><input id="pb-tag" class="input" list="pb-tags" data-input="pbtag" data-k="pb-tag" value="' + esc(s.tag || '') + '" placeholder="For example: door"><datalist id="pb-tags">' + TAG_SUGGEST.map(function (t) { return '<option value="' + t + '">'; }).join('') + '</datalist></div>' +
        '<p class="hint">Each press picks one of these ' + plural(files.length, 'effect') + '.</p>' +
        (files.length ? '<ul class="pb-files">' + files.map(function (f) { var t = fxTrackByFile(f); return '<li>' + L.icon('file', 's') + '<span class="ellipsis grow">' + (t ? esc(L.title(t)) + ' <span class="faint">' + esc(f) + '</span>' : esc(f)) + '</span>' + (t ? L.previewButton('track', t.id) : '') + '</li>'; }).join('') + '</ul>' : '<p class="pb-none">No effects have this tag yet.</p>');
    } else {
      var list = s.kind === 'single' ? s.files.slice(0, 1) : s.files;
      h += (list.length ? '<ul class="pb-files">' + list.map(function (f, i) {
        var t = fxTrackByFile(f);
        return '<li>' + L.icon('file', 's') + '<span class="ellipsis grow" title="' + esc(FX_FOLDER + '\\' + f) + '">' + (t ? esc(L.title(t)) + ' <span class="faint">' + esc(f) + '</span>' : esc(f)) + '</span>' + (t ? L.previewButton('track', t.id) : '') +
          (s.kind === 'variants' && s.files.length > 1 ? '<button class="closer" data-act="pbrmfile" data-i="' + i + '" data-k="pbrm-' + i + '" title="Remove from this pad" aria-label="Remove ' + esc(f) + ' from this pad">' + L.icon('close') + '</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="pb-none">No file yet.</p>') +
        '<div class="row-flex pb-filerow"><button class="btn s" data-act="pbpicklib" data-k="pb-picklib">' + L.icon('library', 's') + 'Choose from library…</button>' +
        '<button class="btn s ghost" data-act="pbaddfile" data-k="pb-addfile">' + L.icon('file', 's') + (s.kind === 'single' ? (list.length ? 'Replace with a file…' : 'Choose a file…') : 'Add a file…') + '</button>' +
        (s.kind === 'variants' ? '<span class="pb-order"><span class="pb-order-l">Order</span><div class="seg s" role="group" aria-label="Order of variants"><button data-act="pborder" data-v="random" data-k="pbo-r" aria-pressed="' + (s.order !== 'roundrobin') + '">' + L.icon('shuffle', 's') + 'Random</button><button data-act="pborder" data-v="roundrobin" data-k="pbo-t" aria-pressed="' + (s.order === 'roundrobin') + '">In turn</button></div></span>' : '') +
        '</div>';
    }
    return fieldset('Sound', h, 'pb-sound');
  }
  function editorPane(b, sel) {
    if (!sel) {
      return L.pane({ id: 'pb-pad', title: 'Pad', icon: 'edit', kind: 'plain', status: { text: 'Ready', tone: 'idle' }, summary: 'No pad selected',
        body: '<p class="empty">Select a pad to change it, or click an empty slot to add one.</p>' });
    }
    var p = sel.pad, other = keyOwner(b, p.key, p.id), on = L.padActive(b.id, p.id);
    var body = '<div class="pb-ed-body" ' + swatch(p) + '>' +
      '<div class="pb-testrow"><button class="btn pb-prev" data-act="pbpreview" data-k="pb-prev" aria-pressed="' + previewing(b, p) + '" title="Only you hear it">' + L.icon(previewing(b, p) ? 'stop' : 'headphones', 's') + (previewing(b, p) ? 'Stop preview' : 'Preview') + '</button>' +
      '<button class="btn" data-act="pbtest" data-k="pb-test" aria-pressed="' + on + '" title="The players hear it">' + L.icon(on && p.mode === 'toggle' ? 'stop' : 'broadcast', 's') + (on && p.mode === 'toggle' ? 'Stop on air' : 'Play on air') + '</button>' +
      (on ? '<span class="badge onair">On air</span>' : '') + '</div>' +
      '<div class="field"><label for="pb-label">Label</label><input id="pb-label" class="input" data-input="pblabel" data-k="pb-label" value="' + esc(p.label) + '"></div>' +
      soundEditor(p) +
      fieldset('Play mode', '<div class="pb-modes" role="group" aria-label="Play mode">' + ['oneshot', 'toggle', 'hold', 'retrigger'].map(function (m) {
        return '<button class="btn s" data-act="pbmode" data-v="' + m + '" data-k="pbm-' + m + '" aria-pressed="' + (p.mode === m) + '" aria-describedby="pb-modehelp">' + L.icon(L.modeIcon[m], 's') + L.modeName[m] + '</button>';
      }).join('') + '</div><p class="pb-modehelp" id="pb-modehelp">' + MODE_HELP[p.mode] + '</p>') +
      '<div class="field"><span class="label" id="pb-key-l">Hotkey</span><div class="row-flex"><button class="pb-keycap' + (ui.capture ? ' capturing' : '') + '" data-act="pbkeycap" data-k="pb-keycap" aria-labelledby="pb-key-l pb-keycap-t"' + (ui.capture || sel.where === 'spare' ? ' aria-describedby="pb-key-h"' : '') + '>' +
      '<span id="pb-keycap-t">' + (ui.capture ? 'Press a key…' : p.key ? '<span class="kbd">' + esc(String(p.key).toUpperCase()) + '</span> Change' : 'None. Click, then press a key') + '</span></button>' +
      (p.key && !ui.capture ? '<button class="btn s ghost" data-act="pbkeyclear" data-k="pb-keyclear">Clear</button>' : '') + '</div>' +
      (ui.capture || sel.where === 'spare' ? '<p class="hint" id="pb-key-h">' + (ui.capture ? 'Esc cancels, Backspace removes the key.' : 'This pad is spare, so its key does nothing until it is back on the grid.') + '</p>' : '') +
      (other ? '<p class="pb-warn" role="alert">' + L.icon('bolt', 's') + '<span class="grow">' + esc(String(p.key).toUpperCase()) + ' is also the key for "' + esc(other.label) + '" on this board.</span><button class="btn s" data-act="pbkeyswap" data-other="' + other.id + '" data-k="pb-keyswap">Take it from that pad</button></p>' : '') + '</div>' +
      fieldset('Colour <span class="pb-cur">' + COLOUR_NAMES[p.color] + '</span>', '<div class="pb-swatches">' + Object.keys(L.colors).map(function (c) {
        return '<label class="pb-sw" title="' + COLOUR_NAMES[c] + '" style="--pc:' + L.colors[c] + '"><input type="radio" class="pb-vh" name="pb-colour" value="' + c + '" data-input="pbcolour" data-k="pbc-' + c + '"' + (p.color === c ? ' checked' : '') + '><span class="pb-sw-dot"></span><span class="sr-only">' + COLOUR_NAMES[c] + '</span></label>';
      }).join('') + '</div>') +
      fieldset('Icon <span class="pb-cur">' + esc(ICON_NAMES[p.icon] || p.icon) + '</span>', '<div class="pb-icons">' + PAD_ICONS.map(function (n) {
        return '<label class="pb-ic" title="' + ICON_NAMES[n] + '"><input type="radio" class="pb-vh" name="pb-icon" value="' + n + '" data-input="pbicon" data-k="pbi-' + n + '"' + (p.icon === n ? ' checked' : '') + '>' + L.icon(n) + '<span class="sr-only">' + ICON_NAMES[n] + '</span></label>';
      }).join('') + '</div>') +
      '<div class="pb-levels"><div class="field grow"><label for="pb-vol">Volume <output id="pb-vol-o" class="num">' + p.vol + '</output></label><input id="pb-vol" type="range" min="0" max="100" step="5" value="' + p.vol + '" data-input="pbvol" data-k="pb-vol"></div>' +
      '<div class="field pb-fade"><label for="pb-fadein">Fade out (seconds)</label><input id="pb-fadein" class="input num" type="number" min="0" max="10" step="0.5" value="' + p.fade + '" data-input="pbfade" data-k="pb-fade"></div></div>' +
      '</div>';
    return L.pane({ id: 'pb-pad', title: 'Pad: ' + p.label, icon: 'edit', kind: 'plain', scroll: 'pb-pad',
      status: on ? { text: 'Playing', tone: 'live' } : previewing(b, p) ? { text: 'Preview', tone: 'on' } : { text: 'Saved', tone: 'idle' },
      actions: '<button class="btn s icon" data-act="pbpadmenu" data-k="pb-padmenu" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for this pad">' + L.icon('more', 's') + '</button>', body: body });
  }
  function usedPane(b) {
    var uses = L.usesOfBoard(b.id), lvl = { campaign: 'Campaign', session: 'Session', scene: 'Scene' };
    var body = (uses.length ? '<ul class="list">' + uses.map(function (u, i) {
      var href = u.level === 'campaign' ? '#/campaign/' + u.campaign.id : '#/session/' + u.campaign.id + '/' + u.session.id;
      return '<li class="lrow"><span class="pb-lvl">' + lvl[u.level] + '</span><a class="pb-uselink ellipsis grow" href="' + href + '" data-k="use-' + i + '">' + esc(u.label) + '</a></li>';
    }).join('') + '</ul>' : '<p class="pb-spare-empty">Not used yet.</p>');
    return L.pane({ id: 'pb-used', title: 'Used in', icon: 'link', kind: 'scenes', size: 'auto', flush: true,
      status: { text: uses.length ? plural(uses.length, 'place') : 'Not used yet', tone: 'idle' },
      actions: '<button class="btn s" data-act="pbuse" data-id="' + b.id + '" data-k="pb-usein">Use in…</button>', body: body });
  }
  function col(ids, html, cls) { return '<div class="col ' + cls + (ids.indexOf(L.state.maxed) > -1 ? ' has-max' : '') + '">' + html + '</div>'; }

  L.view('board', {
    nav: 'boards',
    title: function (p) { var b = L.board(p.bid); return b ? b.name : 'Pad board'; },
    notes: boardNotes(),
    render: function (prm) {
      var b = L.board(prm.bid);
      if (!b) return '<div class="viewhead"><h1>Pad board not found</h1></div><div class="viewbody"><p class="empty">This board was deleted. <a href="#/boards">Back to Pad boards</a></p></div>';
      norm(b);
      // First visit to a board selects its first pad; after a delete (pid null) nothing stays selected.
      if (!ui.sel || ui.sel.bid !== b.id || (ui.sel.pid && !find(b, ui.sel.pid))) { var first = b.slots.filter(Boolean)[0] || b.spare[0]; select(b, first ? first.id : null); }
      var sel = selPad(b);
      return '<div class="viewhead"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/boards" data-k="pb-crumb">Pad boards</a><span class="sep" aria-hidden="true">›</span></nav><h1>' + esc(b.name) + '</h1>' +
        '<span class="grow"></span>' +
        '<button class="btn" data-act="pbuse" data-id="' + b.id + '" data-k="pb-usehead">' + L.icon('link', 's') + 'Use in…</button>' +
        '<button class="btn icon" data-act="pbboardmenu" data-k="pb-bmenu" title="More for this board" aria-label="More for this board" aria-haspopup="menu" aria-expanded="false">' + L.icon('more') + '</button></div>' +
        '<div class="pb-body"><div class="pb-ed">' +
        col(['pb-grid', 'pb-spare', 'pb-used'], gridPane(b, sel) + sparePane(b, sel) + usedPane(b), 'pb-left') +
        col(['pb-pad'], editorPane(b, sel), 'pb-right') + '</div></div>';
    },
    after: function (root) {
      if (ui.pendingFocus) { var n = root.querySelector('[data-k="' + ui.pendingFocus + '"]'); ui.pendingFocus = null; if (n) n.focus(); }
      watchPreview();
    }
  });

  /* ---------- editor actions ---------- */
  function withPad(fn) { return function (el, ev) { var b = board(); if (!b) return; var s = selPad(b); if (!s) return; fn(b, s.pad, el, ev, s); }; }
  L.acts.pbsize = function (el) {
    if (el.getAttribute('aria-disabled') === 'true') { L.say(el.dataset.d > 0 ? 'Already at the largest size, 8' : 'Already at the smallest size, 1'); return; }
    var b = board(), d = +el.dataset.d; if (el.dataset.axis === 'c') resize(b, b.cols + d, b.rows); else resize(b, b.cols, b.rows + d);
  };
  L.acts.pbquick = function (el) { var b = board(); resize(b, +el.dataset.c, +el.dataset.r); };
  L.acts.pbundo = function () {
    var b = board(); if (!ui.msg || !ui.msg.undo) return; var u = ui.msg.undo;
    b.cols = u.cols; b.rows = u.rows; b.slots = u.slots; b.spare = u.spare; ui.msg = null;
    L.say('Undone. Grid is ' + b.cols + ' × ' + b.rows + ' again.'); ui.pendingFocus = 'pb-name'; L.render();
  };
  L.acts.pbmsgx = function () { ui.msg = null; ui.pendingFocus = 'pb-name'; L.render(); };
  L.inputs.pbname = function (el) { var b = board(); b.name = el.value; L.render(); };
  L.acts.pbpad = function (el, ev) {
    var b = board(), pid = el.dataset.pid, now = Date.now(), same = ui.sel && ui.sel.pid === pid;
    ui.focus[b.id] = +el.dataset.slot;
    if (ev && ev.detail > 0 && same && ui.last.pid === pid && now - ui.last.t < 450) { ui.last = { pid: null, t: 0 }; previewPad(b, find(b, pid).pad); return; }
    ui.last = { pid: pid, t: now };
    if (!same) { select(b, pid); L.say(find(b, pid).pad.label + ' selected for editing'); L.render(); }
  };
  L.acts.pbpick = function (el) { var b = board(); select(b, el.dataset.pid); L.render(); };
  L.acts.pbadd = function (el) {
    var b = board(), i = +el.dataset.i, p = newPad(b); b.slots[i] = p; select(b, p.id); ui.focus[b.id] = i;
    L.state.panes['pb-pad'] = 'o'; ui.pendingFocus = 'pb-label'; L.say('New pad added at ' + place(b, i) + '. Give it a label.'); L.render();
    var lbl = document.getElementById('pb-label'); if (lbl) lbl.select();
  };
  L.acts.pbputback = function (el) { if (el.getAttribute('aria-disabled') === 'true') { L.toast('No empty slot. Make the grid bigger first.'); return; } putBack(board(), el.dataset.pid); };
  L.acts.pbputall = function () {
    var b = board(), n = 0;
    while (b.spare.length && b.slots.indexOf(null) > -1) { b.slots[b.slots.indexOf(null)] = b.spare.shift(); n++; }
    L.say(plural(n, 'pad') + ' put back in the grid' + (b.spare.length ? '; ' + b.spare.length + ' still spare' : '')); L.render();
  };
  L.acts.pbtest = withPad(function (b, p) { firePad(b, p); });
  L.acts.pbtrymode = function () { ui.trying = !ui.trying; if (!ui.trying) stopTries(); ui.pendingFocus = 'pb-trymode'; L.render(); L.say(ui.trying ? 'Trying pads: press a pad or its key to hear it as it will play. Only you hear it.' : 'Stopped trying pads'); };
  L.acts.pbtry = function (el) { var b = board(), p = b && find(b, el.dataset.pid); if (!p) return; ui.focus[b.id] = +el.dataset.slot; ui.pendingFocus = el.dataset.k; tryPad(b, p.pad, 'down'); };
  L.acts.pbnoop = function () {};
  // Hold to play while trying: sounds while the pointer, Space or Enter is held on the pad.
  function holdStart(el) { var b = board(), f = b && find(b, el.dataset.pid); if (!f) return; ui.held = f.pad.id; ui.focus[b.id] = +el.dataset.slot; ui.pendingFocus = el.dataset.k; tryPad(b, f.pad, 'down'); }
  function holdEnd() { var b = board(); if (!b || !ui.held) return; var f = find(b, ui.held); ui.held = null; if (f) tryPad(b, f.pad, 'up'); }
  document.addEventListener('pointerdown', function (e) { var el = ui.trying && e.target.closest && e.target.closest('.pb-pad[data-act="pbnoop"]'); if (el) { e.preventDefault(); holdStart(el); } });
  document.addEventListener('pointerup', holdEnd); document.addEventListener('pointercancel', holdEnd);
  document.addEventListener('keydown', function (e) { var el = ui.trying && e.target.closest && e.target.closest('.pb-pad[data-act="pbnoop"]'); if (el && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); holdStart(el); } });
  document.addEventListener('keyup', function (e) { if (ui.held && (e.key === ' ' || e.key === 'Enter' || (ui.heldKey && e.key.toLowerCase() === ui.heldKey))) { ui.heldKey = null; holdEnd(); } });
  window.addEventListener('lyre:route', function () { if (L.current().name !== 'board') { ui.trying = false; stopTries(); } });
  L.acts.pbpreview = withPad(function (b, p) { previewPad(b, p); });
  L.inputs.pblabel = withPad(function (b, p, el) { p.label = el.value; L.render(); });
  L.acts.pbsoundkind = withPad(function (b, p, el) {
    var k = el.dataset.v; if (p.sound.kind === k) return;
    p.sound.kind = k; p.sound.files = p.sound.files || []; if (k === 'variants' && !p.sound.order) p.sound.order = 'random';
    if (k === 'tag' && !p.sound.tag) p.sound.tag = (p.sound.files[0] || '').split(/[_.]/)[0] || '';
    L.render();
  });
  L.acts.pbaddfile = withPad(function (b, p) {
    var s = p.sound, base = s.files[0] ? s.files[0].replace(/(_\d+)?\.wav$/i, '') : slug(p.label), name;
    if (s.kind === 'single') { name = base + (s.files[0] ? '_alt' : '') + '.wav'; if (s.files.length) s.files[0] = name; else s.files.push(name); L.say('File chosen: ' + name); }
    if (p.label === 'New pad' && name) p.label = name.replace(/\.wav$/i, '').replace(/_/g, ' ');
    else { var i = s.files.length + 1; do { name = base + '_' + String(i++).padStart(2, '0') + '.wav'; } while (s.files.indexOf(name) > -1); s.files.push(name); L.say('Added ' + name + '. ' + s.files.length + ' variants.'); }
    L.render();
  });
  L.acts.pbpicklib = withPad(function (b, p) {
    var s = p.sound, cur = D.tracks.filter(function (t) { return t.kind === 'fx' && s.files.indexOf(t.file) > -1; }).map(function (t) { return t.id; });
    L.pickTracks({ title: 'Sounds for "' + p.label + '"', kinds: ['fx'], selected: cur, multi: true,
      intro: 'Tick one effect, or several to play them as variants. Preview lets you hear each one first; the players hear nothing.',
      onDone: function (ids) {
        if (!ids.length) return;
        var files = ids.map(function (id) { return L.track(id).file; }), own = s.files.filter(function (f) { return !fxTrackByFile(f); });
        s.files = files.concat(own);
        // A new pad takes the name of its first sound, so two new pads never share the name "New pad".
        if (p.label === 'New pad') p.label = L.title(L.track(ids[0]));
        if (s.files.length > 1 && s.kind !== 'variants') { s.kind = 'variants'; s.order = s.order || 'random'; L.toast(plural(s.files.length, 'sound') + ' chosen, so the pad plays them as variants'); }
        else if (s.kind === 'tag') s.kind = 'single';
        L.say(plural(files.length, 'sound') + ' from the library on ' + p.label);
      } });
  });
  L.acts.pbrmfile = withPad(function (b, p, el) { var f = p.sound.files.splice(+el.dataset.i, 1)[0]; L.say('Removed ' + f); ui.pendingFocus = 'pb-addfile'; L.render(); });
  L.acts.pborder = withPad(function (b, p, el) { p.sound.order = el.dataset.v; L.render(); });
  L.inputs.pbtag = withPad(function (b, p, el) { p.sound.tag = el.value; L.render(); });
  L.acts.pbmode = withPad(function (b, p, el) { p.mode = el.dataset.v; L.say(L.modeName[p.mode] + '. ' + MODE_HELP[p.mode]); L.render(); });
  L.acts.pbkeycap = function () { ui.capture = !ui.capture; L.render(); };
  L.acts.pbkeyclear = withPad(function (b, p) { p.key = ''; L.say('Hotkey removed'); ui.pendingFocus = 'pb-keycap'; L.render(); });
  L.acts.pbkeyswap = withPad(function (b, p, el) {
    var o = find(b, el.dataset.other); if (!o) return; o.pad.key = ''; L.say(String(p.key).toUpperCase() + ' now belongs to ' + p.label + ' only. ' + o.pad.label + ' has no key.'); ui.pendingFocus = 'pb-keycap'; L.render();
  });
  L.inputs.pbcolour = withPad(function (b, p, el) { p.color = el.value; L.render(); });
  L.inputs.pbicon = withPad(function (b, p, el) { p.icon = el.value; L.render(); });
  L.inputs.pbvol = withPad(function (b, p, el, ev) { p.vol = +el.value; var o = document.getElementById('pb-vol-o'); if (o) o.textContent = p.vol; if (ev.type === 'change') L.render(); });
  L.inputs.pbfade = withPad(function (b, p, el, ev) { var v = parseFloat(el.value); if (!isNaN(v)) p.fade = Math.max(0, Math.min(10, v)); if (ev.type === 'change') L.render(); });
  L.acts.pbduppad = withPad(function (b, p, el, ev, s) {
    var c = clonePad(p); c.label = p.label + ' (copy)'; c.key = '';
    var start = s.where === 'slot' ? s.i + 1 : 0, j = -1;
    for (var k = 0; k < b.slots.length; k++) { var x = (start + k) % b.slots.length; if (!b.slots[x]) { j = x; break; } }
    if (j > -1) { b.slots[j] = c; ui.focus[b.id] = j; L.say('Copy added at ' + place(b, j) + ' and selected'); }
    else { b.spare.push(c); L.state.panes['pb-spare'] = 'o'; L.toast('No empty slot, so the copy went to Spare pads'); }
    select(b, c.id); ui.pendingFocus = 'pb-label'; L.render();
  });
  L.acts.pbdelpad = function (el) {
    var b = board(), at = find(b, el.dataset.pid); if (!at) return;
    L.sheet({ title: 'Delete the pad "' + at.pad.label + '"?', body: '<p>The pad goes from ' + esc(b.name) + '. Its sound files stay in your library.</p>',
      footer: '<button class="btn" data-act="closesheet">Keep it</button><button class="btn danger" data-act="pbdelpadok" data-pid="' + at.pad.id + '">Delete pad</button>' });
  };
  L.acts.pbdelpadok = function (el) {
    var b = board(), at = find(b, el.dataset.pid); if (!at) return;
    if (at.where === 'slot') b.slots[at.i] = null; else b.spare.splice(at.i, 1);
    L.closeSheet(); if (ui.sel && ui.sel.pid === at.pad.id) ui.sel = { bid: b.id, pid: null };
    if (at.where === 'slot') { ui.focus[b.id] = at.i; ui.pendingFocus = 'slot-' + at.i; }
    L.toast('Deleted the pad "' + at.pad.label + '"'); L.render();
  };
  /* Menus */
  function moveMenu(b, pid) {
    var at = find(b, pid); if (!at) return '';
    var h = '<div class="group">Move "' + esc(at.pad.label) + '" to</div>';
    if (at.where === 'slot') h += '<button role="menuitem" data-act="pbmoveto" data-to="spare">' + L.icon('queue', 's') + 'Spare pads</button><div class="sep"></div>';
    b.slots.forEach(function (p, i) {
      if (at.where === 'slot' && at.i === i) return;
      h += '<button role="menuitem" data-act="pbmoveto" data-to="slot:' + i + '">' + (p ? L.icon('shuffle', 's') : L.icon('plus', 's')) + '<span class="grow">Row ' + (Math.floor(i / b.cols) + 1) + ', column ' + (i % b.cols + 1) + '</span><span class="hint">' + (p ? 'swap with ' + esc(p.label) : 'empty') + '</span></button>';
    });
    return h;
  }
  L.acts.pbmovemenu = function (el) { var b = board(); ui.menuPad = el.dataset.pid; ui.menuAnchor = el; L.menu(el, moveMenu(b, ui.menuPad), 'Move to'); };
  L.acts.pbmoveto = function (el) { var b = board(); var pid = ui.menuPad; ui.pendingFocus = el.dataset.to === 'spare' ? 'sp-' + pid : el.dataset.to.replace(':', '-'); moveTo(b, pid, el.dataset.to); };
  function boardMenuHTML(b, inEditor) {
    return (inEditor ? '<a role="menuitem" class="item" href="#/live">' + L.icon('broadcast', 's') + 'See it in the live view</a>' : '<button role="menuitem" data-act="pbuse" data-id="' + b.id + '">' + L.icon('link', 's') + 'Use in…</button>') +
      '<button role="menuitem" data-act="pbdupboard" data-id="' + b.id + '">Duplicate board</button><div class="sep"></div><button role="menuitem" data-act="pbdelboard" data-id="' + b.id + '">' + L.icon('trash', 's') + 'Delete board…</button>';
  }
  L.acts.pbcardmenu = function (el) { L.menu(el, boardMenuHTML(L.board(el.dataset.id), false), 'Board'); };
  L.acts.pbboardmenu = function (el) {
    var b = board();
    L.menu(el, boardMenuHTML(b, true), 'Board');
  };
  function padMenu(b, p) {
    return '<div class="group">' + esc(p.label) + '</div><button role="menuitem" data-act="pbpreview">' + L.icon('headphones', 's') + 'Preview</button><button role="menuitem" data-act="pbtest">' + L.icon('broadcast', 's') + 'Play on air</button>' +
      '<button role="menuitem" data-act="pbduppad">Duplicate pad</button><button role="menuitem" data-act="pbmovemenu2">Move to…</button>' +
      '<button role="menuitem" data-act="pbdelpad" data-pid="' + p.id + '">' + L.icon('trash', 's') + 'Delete pad…</button>';
  }
  L.acts.pbpadmenu = withPad(function (b, p, el) {
    ui.menuPad = p.id; ui.menuAnchor = el;
    L.menu(el, '<button role="menuitem" data-act="pbduppad">Duplicate pad</button><button role="menuitem" data-act="pbmovemenu2">Move to…</button><div class="sep"></div>' +
      '<button role="menuitem" data-act="pbdelpad" data-pid="' + p.id + '">' + L.icon('trash', 's') + 'Delete pad…</button>', 'Pad');
  });
  L.acts.pbmovemenu2 = function () { var b = board(), a = ui.menuAnchor && document.contains(ui.menuAnchor) ? ui.menuAnchor : document.querySelector('.pb-pad.sel'); if (a) L.menu(a, moveMenu(b, ui.menuPad), 'Move to'); };

  /* ---------- pointer and keyboard ---------- */
  document.addEventListener('contextmenu', function (e) {
    var el = e.target.closest && e.target.closest('.pb-pad'); if (!el) return; var b = board(); if (!b) return;
    e.preventDefault(); var pid = el.dataset.pid; if (!ui.sel || ui.sel.pid !== pid) { select(b, pid); ui.focus[b.id] = +el.dataset.slot; L.render(); }
    var a = document.querySelector('.pb-pad[data-pid="' + pid + '"]'); ui.menuPad = pid; ui.menuAnchor = a; L.menu(a, padMenu(b, find(b, pid).pad), 'Pad');
  });
  var dragId = null;
  document.addEventListener('dragstart', function (e) {
    var el = e.target.closest && e.target.closest('[data-drag]'); if (!el || !board()) return;
    dragId = el.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); el.classList.add('dragging');
  });
  document.addEventListener('dragover', function (e) {
    if (!dragId) return; var t = e.target.closest && e.target.closest('[data-drop]'); if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.pb-over').forEach(function (x) { if (x !== t) x.classList.remove('pb-over'); }); t.classList.add('pb-over');
  });
  document.addEventListener('drop', function (e) {
    if (!dragId) return; var t = e.target.closest && e.target.closest('[data-drop]'); if (!t) return;
    e.preventDefault(); var b = board(), pid = dragId; dragId = null;
    var to = t.dataset.drop; if (to !== 'spare') ui.pendingFocus = to.replace(':', '-'); select(b, pid); moveTo(b, pid, to);
  });
  document.addEventListener('dragend', function () { dragId = null; document.querySelectorAll('.pb-over,.dragging').forEach(function (x) { x.classList.remove('pb-over', 'dragging'); }); });

  var ARROWS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  function neighbour(b, i, k) { var r = Math.floor(i / b.cols) + ARROWS[k][0], c = i % b.cols + ARROWS[k][1]; return r < 0 || c < 0 || r >= b.rows || c >= b.cols ? -1 : r * b.cols + c; }
  L.onKey(function (e) {
    var b = board(); if (!b) return false;
    // Trying: a pad's own key plays it privately, as in Live (P still previews the focused pad).
    if (ui.trying && !L.typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !ui.capture) {
      var kp = L.boardPads(b).filter(function (x) { return x && x.key && String(x.key).toLowerCase() === e.key.toLowerCase(); })[0];
      if (kp) { if (kp.mode === 'hold') { ui.held = kp.id; ui.heldKey = e.key.toLowerCase(); } tryPad(b, kp, 'down'); return true; }
    }
    var inGrid = e.target.closest && e.target.closest('.pb-grid');
    if (inGrid && (e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var pp = b.slots[+e.target.dataset.slot]; if (pp) { ui.pendingFocus = e.target.dataset.k; previewPad(b, pp); } return !!pp;
    }
    if (!ARROWS[e.key] || e.ctrlKey || e.metaKey) return false;
    if (e.altKey) {
      var s = selPad(b); if (!s || s.where !== 'slot') { if (s) L.say(s.pad.label + ' is in Spare pads. Use Put back or Move to.'); return !!s; }
      var j = neighbour(b, s.i, e.key); if (j < 0) { L.say(s.pad.label + ' is already at the edge'); return true; }
      if (inGrid) ui.pendingFocus = 'slot-' + j;
      moveTo(b, s.pad.id, 'slot:' + j); return true;
    }
    if (!inGrid || e.shiftKey) return false;
    var i = +e.target.dataset.slot, n = neighbour(b, i, e.key); if (n < 0) return true;
    ui.focus[b.id] = n; if (b.slots[n]) select(b, b.slots[n].id);
    ui.pendingFocus = 'slot-' + n; L.render(); return true;
  });
  // Hotkey capture: the next key pressed on the capture button becomes the pad's key.
  document.addEventListener('keydown', function (e) {
    if (!ui.capture || !e.target.dataset || e.target.dataset.k !== 'pb-keycap') return;
    if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    e.preventDefault(); e.stopPropagation();
    var b = board(), s = selPad(b); if (!s) return;
    if (e.key === 'Escape') { ui.capture = false; L.say('Hotkey unchanged'); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { s.pad.key = ''; ui.capture = false; L.say('Hotkey removed'); }
    else if (e.key.length === 1 && e.key !== ' ' || /^F([1-9]|1[0-2])$/.test(e.key)) {
      s.pad.key = e.key.length === 1 ? e.key.toLowerCase() : e.key; ui.capture = false;
      var o = keyOwner(b, s.pad.key, s.pad.id); L.say('Hotkey ' + e.key.toUpperCase() + (o ? '. Warning: ' + o.label + ' uses it too' : ''));
    } else { L.say('That key cannot be used. Try a letter, a number or F1 to F12.'); return; }
    L.render();
  }, true);
  document.addEventListener('focusout', function (e) { if (ui.capture && e.target.dataset && e.target.dataset.k === 'pb-keycap') setTimeout(function () { if (ui.capture && (!document.activeElement || document.activeElement.dataset.k !== 'pb-keycap')) { ui.capture = false; L.render(); } }, 0); });

  function boardNotes() {
    return [
      '<b>Round 5:</b> <b>resizing fills the grid</b> left to right, top to bottom, in pad order; pads go to Spare pads only when the grid is full, and spare pads come back when it grows (Undo puts the old layout back). Try Weather and places: Fewer rows, then More rows.',
      '<b>Round 5:</b> each pad has a violet <b>▶ Preview</b> on its tile, and <b>Try pads</b> (in the Pads header) lets you press pads and their keys to hear them play as in Live (one-shot, toggle loop, hold to play, restart on press) in your headphones only.',
      '<b>Less on screen.</b> Each box has one job and one status pill in its header: <b>Pads</b> (12 pads, or n sounding), <b>Spare pads</b> (Empty or n pads), <b>Pad</b> (Saved, Preview or Playing) and <b>Used in</b>. Effects boxes share the FX edge colour used across Lyre.',
      '<b>Quieter pads:</b> a tile shows the label, the key and a small mode icon; the colour stripe is the pad\'s identity. Everything else is in the Pad box when you select it. The headphones button on a tile (or P, or a double-click) previews it to you only.',
      '<b>Same buttons everywhere:</b> Preview, then Play on air, then ⋯ for the rest (Duplicate, Move to…, Delete, Use in…). Right-click a pad for its menu.',
      '<b>Spare pads</b> hold pads that are not on the grid. Make a board smaller and the pads that no longer fit go there, with an Undo; put them back when it grows. Their keys do nothing while spare. Try 3×3 on Drowned Abbey, then 5×3 and <b>Put all back</b>.',
      '<b>Finding boards:</b> search by board name or pad label, filter by Used, Not used yet or campaign. <b>Choose from library…</b> in the Pad box picks FX sounds with Preview.'
    ];
  }
})();
