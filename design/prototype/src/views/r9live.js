/* Round 9 (ROUND9.md §2, §5, §6, §11): rooms and bots, Live's own layout, the queue, dipping the music.

   §2 Rooms in Live, bots in Settings (item 56: "have all of the live joining of rooms and such done just from the live
     view, and all of the configuration stuff done from bot settings"). Live's On air names each room first: its name is
     the button that moves it (live.js), Kick is Leave, + Room lists voice channels and takes a free bot itself. The
     Rooms screen is gone from the menu (#/outputs opens Live). Settings › Discord bots gains, per bot, Joins when Lyre
     starts (a voice channel or No) and Starting volume (L.botStartHTML).
   §5 Arrange (item 44: "I need to be able to dynamically move panes around by dragging and dropping and resize them on
     the live view"). Arrange in Live's strip turns on Arrange mode: each box gets a bar with a grip (drag it to another
     place; a line shows exactly where it lands) and buttons for the same moves (up, down, column left, column right),
     and Shorter / Taller / Fit for its height; between columns a splitter, dragged or with Narrower / Wider. The box
     contents cannot be clicked while arranging. Done ends it; Put back the usual layout returns 0.5.1's. Layouts are
     kept on this computer, one per width (whole window, half screen, narrow). On air stays at the top, the whole width
     (Nik, 6 Nov); it can be given a fixed height. Alt+1…7 and F6 follow the boxes in their new order.
   §6 The queue (item 31: "see the now playing queue, select any track in it to play, and have back and forward buttons
     on the now playing bar"). The bar has Back and Forward (core.js) and Queue (n): a panel above the bar with what
     played, what plays now and what comes next, each with Play. Live's Up next rows have Play now (live.js).
   §11 Dip the music (item 47: "Let's definitely build dip music for sound effects (pad effects)"). Settings › Sound to
     Discord: Dip the music under effects (Off / A little / A lot), Comes back (Quickly / Gently / Slowly), Ambience dips
     too. Each pad: While it plays, Dip the music or Don't dip (the usual: one-shot and Restart on press dip; Toggle loop
     and Hold to play don't). While a dipping effect sounds, the room's music line says Dipped. */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- §2 bots: where they join when Lyre starts, their starting volume ---------- */
  L.botStartHTML = function (b, k) {
    var opts = '<option value="">No, I put it in a room myself</option>' + D.discord.servers.map(function (g) {
      return '<optgroup label="' + esc(g.name) + '">' + g.channels.map(function (c) { var v = g.id + '/' + c.id; return '<option value="' + v + '"' + (b.startServer === g.id && b.startChannel === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    var vol = b.startVolume != null ? b.startVolume : 85;
    return '<div class="st-bot-2 r9-botstart"><label class="st-l" for="' + k + '-start">Joins when Lyre starts</label><select class="input" id="' + k + '-start" data-input="r9botstart" data-id="' + b.id + '" data-k="' + k + '-start">' + opts + '</select></div>' +
      '<div class="st-bot-2 r9-botstart"><label class="st-l" for="' + k + '-svol">Starting volume</label><input type="range" min="0" max="100" step="5" id="' + k + '-svol" value="' + vol + '" data-input="r9botvol" data-id="' + b.id + '" data-k="' + k + '-svol" aria-valuetext="' + vol + ' percent"><span class="num faint">' + vol + '%</span></div>';
  };
  L.inputs.r9botstart = function (el) {
    var b = L.bot(el.dataset.id); if (!b) return; var v = el.value.split('/');
    b.startServer = v[0] || ''; b.startChannel = v[1] || '';
    L.saved(b.name + (v[0] ? ' joins ' + L.channel(v[0], v[1]).name + ' when Lyre starts' : ' waits for you when Lyre starts'), { key: 'r9bs-' + b.id });
  };
  L.inputs.r9botvol = function (el, ev) {
    var b = L.bot(el.dataset.id); if (!b) return; b.startVolume = +el.value; el.setAttribute('aria-valuetext', el.value + ' percent');
    var n = el.nextElementSibling; if (n) n.textContent = el.value + '%';
    if (ev.type === 'change') L.saved(b.name + ' starting volume ' + el.value + '%', { key: 'r9bv-' + b.id });
  };
  // The Rooms screen is retired: its address opens Live.
  var route0 = L.route;
  L.route = function (h, o) { return route0.call(L, h === '#/outputs' ? '#/live' : h, o); };

  /* ---------- §11 dipping the music ---------- */
  D.dip = D.dip || { amount: 'little', back: 'gentle', amb: false };
  var AMOUNTS = [['off', 'Off'], ['little', 'A little'], ['lot', 'A lot']], BACKS = [['quick', 'Quickly'], ['gentle', 'Gently'], ['slow', 'Slowly']];
  var USUAL_DIP = { oneshot: true, retrigger: true, toggle: false, hold: false };
  L.padDips = function (p) { return D.dip.amount !== 'off' && (p.dip != null ? p.dip : USUAL_DIP[p.mode]); };
  function padOf(ref) { var a = String(ref || '').split('/'), b = L.board(a[0]); return b ? b.slots.concat(b.spare).filter(function (x) { return x && x.id === a[1]; })[0] : null; }
  L.dippedIn = function (tg, ln) {
    if (D.dip.amount === 'off' || (ln === 'amb' && !D.dip.amb)) return false;
    return L.fxFor(tg).some(function (f) { if (f.fadeOut) return false; var p = padOf(f.ref); if (p) return L.padDips(p); var t = f.ref && f.ref.indexOf('track/') === 0 && L.track(f.ref.slice(6)); return !!(t && t.role === 'Sting'); });
  };
  function seg(name, list, cur, act) {
    return '<div class="seg s" role="radiogroup" aria-label="' + esc(name) + '">' + list.map(function (x) { return '<button role="radio" aria-checked="' + (cur === x[0]) + '" data-act="' + act + '" data-v="' + x[0] + '" data-k="' + act + '-' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  L.dipSettingsHTML = function () {
    return '<fieldset class="r9-dip"><legend>Dip the music under effects</legend>' +
      '<div class="r9-dip-row"><span class="r9-dip-l" id="r9-dip-a">How far</span>' + seg('How far the music dips', AMOUNTS, D.dip.amount, 'r9dipamt') + '</div>' +
      '<div class="r9-dip-row"><span class="r9-dip-l">Comes back</span>' + seg('How fast the music comes back', BACKS, D.dip.back, 'r9dipback') + '</div>' +
      '<label class="r9-dip-row"><input type="checkbox" data-input="r9dipamb" data-k="r9-dipamb"' + (D.dip.amb ? ' checked' : '') + '>Ambience dips too</label>' +
      '<p class="hint">Effects with Dip the music on make the music quieter while they play.</p></fieldset>';
  };
  L.acts.r9dipamt = function (el) { D.dip.amount = el.dataset.v; L.render(); L.saved('dip the music: ' + el.textContent.toLowerCase(), { key: 'r9dip' }); var b = document.querySelector('[data-k="r9dipamt-' + el.dataset.v + '"]'); if (b) b.focus(); };
  L.acts.r9dipback = function (el) { D.dip.back = el.dataset.v; L.render(); L.saved('the music comes back ' + el.textContent.toLowerCase(), { key: 'r9dipb' }); var b = document.querySelector('[data-k="r9dipback-' + el.dataset.v + '"]'); if (b) b.focus(); };
  L.inputs.r9dipamb = function (el) { D.dip.amb = el.checked; L.saved(el.checked ? 'ambience dips too' : 'ambience keeps its level', { key: 'r9dipamb' }); };
  L.padDipHTML = function (p) {
    var usual = USUAL_DIP[p.mode], cur = p.dip == null ? 'usual' : p.dip ? 'dip' : 'no';
    var opts = [['usual', 'The usual (' + (usual ? 'dip' : 'don’t dip') + ')'], ['dip', 'Dip the music'], ['no', 'Don’t dip']];
    return '<fieldset class="pb-fs r9-paddip"><legend>While it plays</legend><div class="seg s" role="radiogroup" aria-label="While it plays">' + opts.map(function (x) {
      return '<button role="radio" aria-checked="' + (cur === x[0]) + '" data-act="r9paddip" data-pid="' + p.id + '" data-v="' + x[0] + '" data-k="r9pd-' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>' + (D.dip.amount === 'off' ? '<p class="hint">Dipping is off in Settings › Sound to Discord.</p>' : '') + '</fieldset>';
  };
  L.acts.r9paddip = function (el) {
    var p = null; D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (x) { if (x && x.id === el.dataset.pid) p = x; }); }); if (!p) return;
    if (el.dataset.v === 'usual') delete p.dip; else p.dip = el.dataset.v === 'dip';
    L.render(); L.saved(p.label + (L.padDips(p) ? ' dips the music' : ' leaves the music as it is')); var b = document.querySelector('[data-k="r9pd-' + el.dataset.v + '"]'); if (b) b.focus();
  };

  /* ---------- §6 the queue ---------- */
  var Q = { open: null };
  function roomLane(tg) { var m = L.mix(tg); return m && m.music; }
  function queueOf(kind, tg) {
    if (kind === 'preview') { var p = L.pb.preview; return p && p.queue ? { name: p.qname, ids: p.queue, at: p.qi, kind: kind } : null; }
    var c = roomLane(tg); if (!c) return null;
    if (c.seq) { var s = L.session(c.seq.cid, c.seq.sid), sc = s && s.scenes[c.seq.scene], q = sc ? L.sceneSequence(sc) : []; return { name: sc ? sc.name : '', ids: q.map(function (x) { return x.trackId; }), pls: q.map(function (x) { return x.playlistId; }), at: c.seq.at, kind: kind, seq: c.seq }; }
    if (c.playlistId) { var ts = L.orderedTracks(c.playlistId, c.place); return { name: L.playlist(c.playlistId).name, ids: ts.map(function (t) { return t.id; }), at: ts.map(function (t) { return t.id; }).indexOf(c.id), kind: kind, pl: c.playlistId, place: c.place }; }
    return { name: '', ids: [c.id], at: 0, kind: kind };
  }
  L.queueButton = function (kind, tg, k) {
    var q = queueOf(kind, tg); if (!q || q.ids.length < 2) return '';
    var key = kind + ':' + tg, open = Q.open === key, left = q.ids.length - q.at - 1;
    return '<button class="btn s r9-qbtn" data-act="r9queue" data-kind="' + kind + '" data-tg="' + esc(tg) + '" data-k="' + k + '-queue" aria-expanded="' + open + '" aria-controls="r9-queue" title="The queue: what played, what plays now, what comes next">' + L.icon('queue', 's') + 'Queue <span class="num">' + left + '</span></button>';
  };
  L.acts.r9queue = function (el) { var key = el.dataset.kind + ':' + el.dataset.tg; Q.open = Q.open === key ? null : key; Q.back = el.dataset.k; L.render(); var f = document.querySelector('#r9-queue .r9-q-now button, #r9-queue button'); if (Q.open && f) f.focus(); };
  function queueHTML() {
    if (!Q.open) return '';
    var a = Q.open.split(':'), q = queueOf(a[0], a.slice(1).join(':')); if (!q) { Q.open = null; return ''; }
    var pl = q.pl && L.playlist(q.pl), divs = pl && L.dividersBefore ? L.dividersBefore(pl) : {};
    var rows = q.ids.map(function (id, i) {
      var t = L.track(id); if (!t) return '';
      var cls = i < q.at ? 'played' : i === q.at ? 'now' : 'next';
      var head = i === 0 && q.at > 0 ? '<li class="r9-q-h">Played</li>' : i === q.at ? '<li class="r9-q-h">Now playing</li>' : i === q.at + 1 ? '<li class="r9-q-h">Up next</li>' : '';
      return head + (divs[id] ? divs[id].map(function (d) { return L.dividerHeading(d); }).join('') : '') +
        '<li class="r9-q-' + cls + '"' + (i === q.at ? ' aria-current="true"' : '') + '><span class="num faint">' + (i + 1) + '</span><span class="ellipsis grow" title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</span><span class="num faint">' + L.fmt(t.dur) + '</span>' +
        (i === q.at ? '<span class="badge">Now</span>' : '<button class="btn s icon" data-act="r9qplay" data-i="' + i + '" data-k="r9q-' + i + '" aria-label="Play ' + esc(L.title(t)) + ' now" title="Play it now; the queue carries on from there">' + L.icon('play', 's') + '</button>') + '</li>';
    }).join('');
    return '<section id="r9-queue" class="r9-queue" aria-label="Queue: ' + esc(q.name) + '"><header><b>Queue</b><span class="faint ellipsis">' + esc(q.name) + (a[0] === 'preview' ? ' · only you' : '') + '</span><span class="grow"></span>' +
      '<button class="closer" data-act="r9qclose" data-k="r9q-x" title="Close (Esc)" aria-label="Close the queue">' + L.icon('close') + '</button></header><ol class="r9-q-list">' + rows + '</ol></section>';
  }
  L.acts.r9qclose = function () { Q.open = null; L.render(); var b = Q.back && document.querySelector('[data-k="' + Q.back + '"]'); if (b) b.focus(); };
  L.acts.r9qplay = function (el) {
    var a = Q.open.split(':'), kind = a[0], tg = a.slice(1).join(':'), q = queueOf(kind, tg), i = +el.dataset.i; if (!q) return;
    if (kind === 'preview') L.previewAt(i);
    else if (q.seq) L.play(q.ids[i], { lane: 'music', playlistId: q.pls[i], fade: 3, seq: { cid: q.seq.cid, sid: q.seq.sid, scene: q.seq.scene, at: i }, target: tg });
    else L.play(q.ids[i], { lane: 'music', playlistId: q.pl, place: q.place, fade: 3, target: tg });
    L.say('Playing now: ' + L.title(L.track(q.ids[i])));
    var b = document.querySelector('[data-k="r9q-' + i + '"]') || document.querySelector('#r9-queue [aria-current] ~ li button, #r9-queue button'); if (b) b.focus();
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && Q.open && e.target.closest && e.target.closest('#r9-queue')) { e.preventDefault(); e.stopPropagation(); L.acts.r9qclose(); } }, true);

  /* ---------- §5 Arrange ---------- */
  var MODES = { 1: 'narrow', 2: 'half', 3: 'wide' };
  var ALL = ['scenes', 'current', 'ssp', 'ssd', 'cpp', 'cpd'];
  var NAMES = { scenes: 'Scenes', current: 'Current scene', ssp: 'Session playlists', ssd: 'Session pads', cpp: 'Campaign playlists', cpd: 'Campaign pads', onair: 'On air' };
  var A = { on: false, saved: {} };
  try { A.saved = JSON.parse(localStorage.getItem('lyre-r9-layout') || '{}') || {}; } catch (e) { A.saved = {}; }
  function save() { try { localStorage.setItem('lyre-r9-layout', JSON.stringify(A.saved)); } catch (e) { /* storage unavailable */ } }
  function lay(mode, def) {
    var s = A.saved[MODES[mode]];
    var cols = s && s.cols ? s.cols.map(function (c) { return c.filter(function (id) { return ALL.indexOf(id) > -1; }); }) : def.map(function (c) { return c.slice(); });
    ALL.forEach(function (id) { if (!cols.some(function (c) { return c.indexOf(id) > -1; })) cols[cols.length - 1].push(id); });
    if (A.on && mode > 1 && cols.length < 4) cols.push([]);            // a spare column to drop into while arranging
    if (!A.on) cols = cols.filter(function (c) { return c.length; });
    return { cols: cols, widths: s && s.widths, heights: (s && s.heights) || {} };
  }
  function current(mode) { var c = lay(mode, DEFAULT[mode]); return c; }
  var DEFAULT = { 1: [ALL.slice()], 2: [['scenes', 'ssp', 'ssd', 'cpp', 'cpd'], ['current']], 3: [['scenes'], ['current'], ['ssp', 'ssd', 'cpp', 'cpd']] };
  L.arranging = function () { return A.on && L.current().name === 'live'; };
  L.liveLayout = function (mode, def) {
    DEFAULT[mode] = def;
    var c = lay(mode, def), out = c.cols;
    if (mode > 1) {
      var w = out.map(function (col, i) { return (c.widths && c.widths[i]) || (col.length || !A.on ? (mode === 3 ? [27, 43, 30, 25][i] : [38, 62, 30][i]) || 30 : 18); });
      out.widths = out.map(function (col, i) { return 'minmax(0,' + w[i] + 'fr)' + (A.on && i < out.length - 1 ? ' 20px' : ''); }).join(' ');
    }
    return out;
  };
  L.arrangeButton = function () {
    return '<button class="btn s" data-act="r9arrange" data-k="lv-arrange" aria-pressed="' + A.on + '" title="' + (A.on ? 'Done arranging' : 'Move and size the boxes on this screen') + '">' + L.icon('grid', 's') + '<span class="lv-btxt">' + (A.on ? 'Done' : 'Arrange') + '</span></button>';
  };
  L.arrangeBar = function (mode) {
    if (!A.on) return '';
    var oh = (current(mode).heights || {}).onair;
    return '<div class="r9-arrbar" role="region" aria-label="Arrange"><span class="grow"><b>Arrange the boxes</b> <span class="faint">· drag a box by its grip, or use its arrows. Saved for ' + (mode === 3 ? 'a whole window' : mode === 2 ? 'half a screen' : 'a narrow window') + '.</span></span>' +
      '<span class="r9-arr-oa">On air ' + sizeBtns('onair', oh) + '</span>' +
      '<button class="btn s ghost" data-act="r9arrreset" data-k="r9-arr-reset">' + L.icon('restart', 's') + 'Put back the usual layout</button><button class="btn s primary" data-act="r9arrange" data-k="r9-arr-done">Done</button></div>';
  };
  function sizeBtns(id, h) {
    return '<span class="r9-arr-size" role="group" aria-label="Height of ' + NAMES[id] + '"><span class="faint r9-arr-hl" aria-hidden="true">Height</span>' +
      '<button class="btn s icon r9-hbtn" data-act="r9arrh" data-box="' + id + '" data-d="-1" data-k="r9h-' + id + '-s" aria-label="Shorter: ' + NAMES[id] + '" title="Shorter (it scrolls inside)">−</button>' +
      '<button class="btn s icon r9-hbtn" data-act="r9arrh" data-box="' + id + '" data-d="1" data-k="r9h-' + id + '-t" aria-label="Taller: ' + NAMES[id] + '" title="Taller">+</button>' +
      (h ? '<button class="btn s ghost" data-act="r9arrh" data-box="' + id + '" data-d="0" data-k="r9h-' + id + '-f" title="As tall as what it holds">Fit</button><span class="num faint">' + h + ' px</span>' : '') + '</span>';
  }
  L.arrangeWrap = function (id, html, ci, mode) {
    var c = current(mode), h = c.heights[id];
    if (!A.on) return h ? '<div class="r9-fixed" style="--r9h:' + h + 'px">' + html + '</div>' : html;
    var col = c.cols[ci], i = col.indexOf(id), n = c.cols.filter(function (x) { return x.length; }).length;
    var btn = function (dir, icon, label, dis) { return '<button class="btn s icon" data-act="r9arrmove" data-box="' + id + '" data-dir="' + dir + '" data-k="r9m-' + id + '-' + dir + '" aria-label="' + label + ': ' + NAMES[id] + '" title="' + label + '"' + (dis ? ' disabled' : '') + '>' + L.icon(icon, 's') + '</button>'; };
    return '<div class="r9-box" data-box="' + id + '" data-col="' + ci + '"' + (h ? ' style="--r9h:' + h + 'px"' : '') + '><div class="r9-boxbar" role="group" aria-label="Arrange ' + NAMES[id] + '">' +
      '<span class="r9-grip" draggable="true" data-r9grip="' + id + '" title="Drag to move ' + NAMES[id] + '" aria-hidden="true">' + L.icon('drag', 's') + '</span><b class="ellipsis grow">' + NAMES[id] + '</b>' +
      btn('up', 'chevup', 'Move up', i === 0) + btn('down', 'chevdown', 'Move down', i === col.length - 1) + (mode > 1 ? btn('left', 'left', 'Move to the column on the left', ci === 0) + btn('right', 'right', 'Move to the column on the right', ci >= c.cols.length - 1) : '') +
      sizeBtns(id, h) + '</div><div class="r9-boxin" inert>' + html + '</div></div>';
  };
  L.arrangeSplit = function (ci, n, mode) {
    if (!A.on || mode < 2 || ci >= n - 1) return '';
    return '<div class="r9-split" role="group" aria-label="Width between column ' + (ci + 1) + ' and ' + (ci + 2) + '" data-split="' + ci + '"><span class="r9-split-bar" aria-hidden="true"></span>' +
      '<button class="btn s icon" data-act="r9arrw" data-c="' + ci + '" data-d="-1" data-k="r9w-' + ci + '-n" aria-label="Column ' + (ci + 1) + ' narrower" title="Left column narrower">' + L.icon('chevleft', 's') + '</button>' +
      '<button class="btn s icon" data-act="r9arrw" data-c="' + ci + '" data-d="1" data-k="r9w-' + ci + '-w" aria-label="Column ' + (ci + 1) + ' wider" title="Left column wider">' + L.icon('chevright', 's') + '</button></div>';
  };
  function mode() { var app = document.getElementById('app'), w = app ? app.getBoundingClientRect().width : 960; return w >= 1200 ? 3 : w >= 820 ? 2 : 1; }
  function edit(fn) {
    var m = mode(), key = MODES[m], c = lay(m, DEFAULT[m]);
    var s = { cols: c.cols.map(function (x) { return x.slice(); }), widths: c.widths ? c.widths.slice() : null, heights: Object.assign({}, c.heights) };
    fn(s, m); s.cols = s.cols.filter(function (x) { return x.length; }); if (s.widths) s.widths = s.widths.slice(0, s.cols.length);
    A.saved[key] = s; save(); L.render();
  }
  function where(s, id) { for (var ci = 0; ci < s.cols.length; ci++) { var i = s.cols[ci].indexOf(id); if (i > -1) return { ci: ci, i: i }; } return null; }
  L.acts.r9arrange = function () { A.on = !A.on; L.render(); var b = document.querySelector('[data-k="lv-arrange"]'); if (b) b.focus(); L.say(A.on ? 'Arranging the boxes. Each box has a grip and arrow buttons; press Done when finished.' : 'Layout saved'); if (!A.on) L.saved('layout of Live for this window size'); };
  L.acts.r9arrreset = function () { delete A.saved[MODES[mode()]]; save(); L.render(); L.say('The usual layout is back'); var b = document.querySelector('[data-k="r9-arr-done"]'); if (b) b.focus(); };
  L.acts.r9arrmove = function (el) {
    var id = el.dataset.box, dir = el.dataset.dir;
    edit(function (s) {
      var p = where(s, id); if (!p) return; var col = s.cols[p.ci];
      if (dir === 'up' && p.i > 0) { col.splice(p.i, 1); col.splice(p.i - 1, 0, id); }
      if (dir === 'down' && p.i < col.length - 1) { col.splice(p.i, 1); col.splice(p.i + 1, 0, id); }
      if ((dir === 'left' && p.ci > 0) || (dir === 'right' && p.ci < s.cols.length - 1)) { col.splice(p.i, 1); s.cols[p.ci + (dir === 'left' ? -1 : 1)].push(id); }
    });
    var b = document.querySelector('[data-k="r9m-' + id + '-' + dir + '"]'); if (!b || b.disabled) b = document.querySelector('[data-box="' + id + '"] .r9-boxbar button:not([disabled])'); if (b) b.focus();
    L.say(NAMES[id] + ' moved');
  };
  L.acts.r9arrh = function (el) {
    var id = el.dataset.box, d = +el.dataset.d;
    edit(function (s) {
      var box = document.querySelector(id === 'onair' ? '.lv-dock' : '[data-box="' + id + '"] .r9-boxin'), now = s.heights[id] || (box ? Math.round(box.getBoundingClientRect().height) : 300);
      if (!d) delete s.heights[id]; else s.heights[id] = Math.max(120, Math.min(900, Math.round((now + d * 60) / 10) * 10));
    });
    var b = document.querySelector('[data-k="' + el.dataset.k + '"]') || document.querySelector('[data-k="r9h-' + id + '-t"]'); if (b) b.focus();
  };
  L.acts.r9arrw = function (el) {
    var ci = +el.dataset.c, d = +el.dataset.d;
    edit(function (s, m) {
      var n = s.cols.length, base = s.widths || s.cols.map(function (x, i) { return (m === 3 ? [27, 43, 30, 25][i] : [38, 62, 30][i]) || 30; });
      base = base.slice(0, n); while (base.length < n) base.push(25);
      var step = 4; if (base[ci] + d * step < 12 || base[ci + 1] - d * step < 12) return;
      base[ci] += d * step; base[ci + 1] -= d * step; s.widths = base;
    });
    var b = document.querySelector('[data-k="' + el.dataset.k + '"]'); if (b) b.focus();
  };
  // Dragging a box by its grip: a line shows where it lands (above or below the box under the pointer, or at the end of
  // an empty column); dropping puts it there.
  var drag = null;
  function clearMarks() { document.querySelectorAll('.r9-before, .r9-after, .r9-colover').forEach(function (n) { n.classList.remove('r9-before', 'r9-after', 'r9-colover'); }); }
  document.addEventListener('dragstart', function (e) {
    var g = e.target.closest && e.target.closest('[data-r9grip]'); if (!g) return;
    drag = { id: g.dataset.r9grip }; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.id); } catch (x) { /* older engines */ }
    e.stopPropagation();
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!drag) return; var box = e.target.closest && e.target.closest('.r9-box'), col = e.target.closest && e.target.closest('.lv-cols > .col'); if (!col) return;
    e.preventDefault(); e.stopPropagation(); clearMarks();
    if (box && box.dataset.box !== drag.id) { var r = box.getBoundingClientRect(); box.classList.add(e.clientY > r.top + r.height / 2 ? 'r9-after' : 'r9-before'); }
    else if (!box) col.classList.add('r9-colover');
  }, true);
  document.addEventListener('drop', function (e) {
    if (!drag) return; var d = drag; drag = null; var box = e.target.closest && e.target.closest('.r9-box'), col = e.target.closest && e.target.closest('.lv-cols > .col'); clearMarks(); if (!col) return;
    e.preventDefault(); e.stopPropagation();
    var after = box ? e.clientY > box.getBoundingClientRect().top + box.getBoundingClientRect().height / 2 : true;
    edit(function (s) {
      var p = where(s, d.id); if (!p) return; s.cols[p.ci].splice(p.i, 1);
      var ci = +col.dataset.col; while (s.cols.length <= ci) s.cols.push([]);
      var target = s.cols[ci], at = box && box.dataset.box !== d.id ? target.indexOf(box.dataset.box) + (after ? 1 : 0) : target.length;
      target.splice(Math.max(0, at), 0, d.id);
    });
    L.say(NAMES[d.id] + ' moved');
  }, true);
  document.addEventListener('dragend', function () { if (drag) { drag = null; clearMarks(); } }, true);
  // Dragging a splitter changes the two columns' widths.
  document.addEventListener('pointerdown', function (e) {
    var bar = e.target.closest && e.target.closest('.r9-split-bar'); if (!bar) return;
    var sp = bar.parentNode, ci = +sp.dataset.split, grid = sp.parentNode, cols = [].slice.call(grid.querySelectorAll(':scope > .col'));
    var a = cols[ci].getBoundingClientRect().width, b = cols[ci + 1].getBoundingClientRect().width, x0 = e.clientX;
    e.preventDefault();
    function move(ev) { var dx = ev.clientX - x0; cols[ci].dataset.w = Math.max(80, a + dx); cols[ci + 1].dataset.w = Math.max(80, b - dx); sp.classList.add('on'); sp.style.transform = 'translateX(' + Math.max(80 - a, Math.min(b - 80, dx)) + 'px)'; }
    function up() {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); sp.classList.remove('on'); sp.style.transform = '';
      var wa = +cols[ci].dataset.w || a, wb = +cols[ci + 1].dataset.w || b;
      edit(function (s, m) {
        var n = s.cols.length, base = (s.widths || cols.map(function (c) { return c.getBoundingClientRect().width; })).slice(0, n);
        var total = base[ci] + base[ci + 1]; base[ci] = total * wa / (wa + wb); base[ci + 1] = total * wb / (wa + wb); s.widths = base.map(function (x) { return Math.round(x * 10) / 10; });
      });
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  /* ---------- painting what lives outside the view ---------- */
  var render0 = L.render;
  L.render = function () {
    render0.apply(L, arguments);
    var r = L.current();
    // The queue panel sits just above the Now playing bar.
    var bar = document.querySelector('#view .onairbar'), old = document.getElementById('r9-queue');
    if (old) old.remove();
    if (Q.open && bar) bar.insertAdjacentHTML('beforebegin', queueHTML()); else if (Q.open && !bar) Q.open = null;
    if (L.placeToasts) L.placeToasts();
    // A fixed-height On air (Arrange).
    var dock = document.querySelector('.lv-dock'), m = mode(), h = r.name === 'live' && lay(m, DEFAULT[m]).heights.onair;
    if (dock) dock.style.maxHeight = h ? h + 'px' : '';
    // Pads that dip the music carry a small mark (their names say it too).
    document.querySelectorAll('.lv-pad[data-bid], .pb-pad[data-bid]').forEach(function (el) { var b = L.board(el.dataset.bid), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === el.dataset.pid; })[0]; el.classList.toggle('r9-dips', !!(p && L.padDips(p))); });
  };
})();
