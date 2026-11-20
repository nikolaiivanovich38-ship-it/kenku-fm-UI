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
  // Round 10 (Nik, 18 Nov 03:14: "I should make bots join manually and they shouldn't auto join without my telling them
  // to and taking them which room, unless they are fixing themselves after a connection interruption"): no "Joins when
  // Lyre starts". The starting volume stays: it is the volume a bot has when Nik joins it to a room.
  L.botStartHTML = function (b, k) {
    var vol = b.startVolume != null ? b.startVolume : 85;
    return '<div class="st-bot-2 r9-botstart"><label class="st-l" for="' + k + '-svol">Starting volume</label><input type="range" min="0" max="100" step="5" id="' + k + '-svol" value="' + vol + '" data-input="r9botvol" data-id="' + b.id + '" data-k="' + k + '-svol" aria-valuetext="' + vol + ' percent" title="The bot’s volume when it joins a room"><span class="num faint">' + vol + '%</span></div>';
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
  // Round 10 (Nik, 18 Nov 03:14, answer 2): the Rooms screen stays, as it was, under Settings (core.js rail, r10.js).

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
  function pick(id, label, list, cur, input) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><select class="input" id="' + id + '" data-input="' + input + '" data-k="' + id + '">' + list.map(function (x) { return '<option value="' + x[0] + '"' + (cur === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>';
  }
  L.dipSettingsHTML = function () {
    return '<fieldset class="r9-dip"><legend>Dip the music under effects</legend><div class="st-xf">' +
      pick('r9-dipamt', 'How far', AMOUNTS, D.dip.amount, 'r9dipamt') + pick('r9-dipback', 'Comes back', BACKS, D.dip.back, 'r9dipback') + '</div>' +
      '<label class="r9-dip-row"><input type="checkbox" data-input="r9dipamb" data-k="r9-dipamb"' + (D.dip.amb ? ' checked' : '') + '>Ambience dips too</label>' +
      '<p class="hint">The music gets quieter while an effect with Dip the music on is playing.</p></fieldset>';
  };
  L.inputs.r9dipamt = function (el) { D.dip.amount = el.value; L.saved('dip the music: ' + el.options[el.selectedIndex].text.toLowerCase(), { key: 'r9dip' }); };
  L.inputs.r9dipback = function (el) { D.dip.back = el.value; L.saved('the music comes back ' + el.options[el.selectedIndex].text.toLowerCase(), { key: 'r9dipb' }); };
  L.inputs.r9dipamb = function (el) { D.dip.amb = el.checked; L.saved(el.checked ? 'ambience dips too' : 'ambience keeps its level', { key: 'r9dipamb' }); };
  L.padDipHTML = function (p) {
    var usual = USUAL_DIP[p.mode], cur = p.dip == null ? 'usual' : p.dip ? 'dip' : 'no';
    var opts = [['usual', 'The usual (' + (usual ? 'dip' : 'don’t dip') + ')'], ['dip', 'Dip the music'], ['no', 'Don’t dip']];
    return '<fieldset class="pb-fs r9-paddip"><legend>While it plays</legend><div class="seg s" role="radiogroup" aria-label="While it plays">' + opts.map(function (x) {
      return '<button role="radio" aria-checked="' + (cur === x[0]) + '" tabindex="' + (cur === x[0] ? 0 : -1) + '" data-act="r9paddip" data-pid="' + p.id + '" data-v="' + x[0] + '" data-k="r9pd-' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>' + (D.dip.amount === 'off' ? '<p class="hint">Dipping is off in Settings › Sound to Discord.</p>' : '') + '</fieldset>';
  };
  L.acts.r9paddip = function (el) {
    var p = null; D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (x) { if (x && x.id === el.dataset.pid) p = x; }); }); if (!p) return;
    if (el.dataset.v === 'usual') delete p.dip; else p.dip = el.dataset.v === 'dip';
    L.render(); L.saved(p.label + (L.padDips(p) ? ' dips the music' : ' leaves the music as it is')); var b = document.querySelector('[data-k="r9pd-' + el.dataset.v + '"]'); if (b) b.focus();
  };

  // 0.6.0 (f-live, as the app): a group of radio buttons: Tab reaches the chosen one, the arrow keys choose another.
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="r9paddip"]'); if (!b) return;
    var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (!step) return;
    e.preventDefault(); e.stopPropagation();
    var all = [].slice.call(b.parentNode.querySelectorAll('[data-act="r9paddip"]')), next = all[(all.indexOf(b) + step + all.length) % all.length];
    L.acts.r9paddip(next);
  }, true);

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
        (i === q.at ? '<span class="badge">Now</span>' : '<button class="btn s icon" data-act="r9qplay" data-i="' + i + '" data-k="r9q-' + i + '" aria-label="Play ' + esc(L.title(t)) + ' now" title="Play it now. The queue continues from there.">' + L.icon('play', 's') + '</button>') + '</li>';
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

  /* ---------- §5 Arrange (round 10: grips, edges and one Move… menu per box; On air moves too) ----------
     Nik, 18 Nov 03:14, answer 6: "dynamic" (a layout per window size), On air "movable, top by default. And the boxes
     shouldn't just be movable but also resizable." Round 10 (the three reviewers): round 9's bar of six to eight small
     buttons per box, its second name and the ‹ › pairs between columns are gone. In Arrange each box shows a grip over
     its own head (drag the head to move it; a line shows where it lands), an edge at its foot (drag to make it taller or
     shorter) and one Move… button (WCAG 2.5.7: Up, Down, Column left, Column right, Taller, Shorter, Fit, Narrower,
     Wider; On air also To the top, or Into a column). Between columns a bar to drag for widths. */
  var MODES = { 1: 'narrow', 2: 'half', 3: 'wide' };
  var ALL = ['scenes', 'current', 'ssp', 'ssd', 'cpp', 'cpd'];
  var NAMES = { scenes: 'Scenes', current: 'Current scene', ssp: 'Session playlists', ssd: 'Session pads', cpp: 'Campaign playlists', cpd: 'Campaign pads', onair: 'On air' };
  var A = { on: false, saved: {} };
  try { A.saved = JSON.parse(localStorage.getItem('lyre-r9-layout') || '{}') || {}; } catch (e) { A.saved = {}; }
  function save() { try { localStorage.setItem('lyre-r9-layout', JSON.stringify(A.saved)); } catch (e) { /* storage unavailable */ } }
  var DEFAULT = { 1: [ALL.slice()], 2: [['scenes', 'ssp', 'ssd', 'cpp', 'cpd'], ['current']], 3: [['scenes'], ['current'], ['ssp', 'ssd', 'cpp', 'cpd']] };
  function lay(mode, def) {
    var s = A.saved[MODES[mode]], ok = ALL.concat(['onair']);
    var cols = s && s.cols ? s.cols.map(function (c) { return c.filter(function (id) { return ok.indexOf(id) > -1; }); }) : (def || DEFAULT[mode]).map(function (c) { return c.slice(); });
    if (!cols.length) cols = [[]];
    ALL.forEach(function (id) { if (!cols.some(function (c) { return c.indexOf(id) > -1; })) cols[cols.length - 1].push(id); });
    if (A.on && mode > 1 && cols.length < 4) cols.push([]);            // a spare column to drop into while arranging
    if (!A.on) cols = cols.filter(function (c) { return c.length; });
    return { cols: cols, widths: s && s.widths, heights: (s && s.heights) || {} };
  }
  function current(mode) { return lay(mode, DEFAULT[mode]); }
  L.arranging = function () { return A.on && L.current().name === 'live'; };
  // 0.6.0 review M3 (f-live, as the app's arrangedKeyOrder): F6 and Alt+1 to 7 follow the boxes on screen only once a
  // box has moved for this window size; a box made taller or a column wider keeps the usual order.
  L.liveArranged = function () {
    var m = mode(), s = A.saved[MODES[m]]; if (!s || !s.cols) return false;
    var cols = s.cols.filter(function (c) { return c.length; });
    return JSON.stringify(cols) !== JSON.stringify(DEFAULT[m]);
  };
  L.liveLayout = function (mode, def) {
    DEFAULT[mode] = def;
    var c = lay(mode, def), out = c.cols;
    if (mode > 1) {
      var w = out.map(function (col, i) { return (c.widths && c.widths[i]) || (col.length || !A.on ? (mode === 3 ? [27, 43, 30, 25][i] : [38, 62, 30][i]) || 30 : 18); });
      out.widths = out.map(function (col, i) { return 'minmax(0,' + w[i] + 'fr)' + (A.on && i < out.length - 1 ? ' 12px' : ''); }).join(' ');
    }
    return out;
  };
  L.arrangeButton = function () {
    return '<button class="btn s" data-act="r9arrange" data-k="lv-arrange" aria-pressed="' + A.on + '" title="' + (A.on ? 'Done arranging' : 'Move and size the boxes on this screen') + '">' + L.icon('grid', 's') + '<span class="lv-btxt">' + (A.on ? 'Done' : 'Arrange') + '</span></button>';
  };
  L.arrangeBar = function (mode) {
    if (!A.on) return '';
    return '<div class="r9-arrbar" role="region" aria-label="Arrange"><span class="grow"><b>Arrange the boxes</b> <span class="faint">· drag a box by its header to move it, drag its bottom edge to resize it, or use Move…. The layout is kept for ' + (mode === 3 ? 'a whole window' : mode === 2 ? 'half a screen' : 'a narrow window') + '.</span></span>' +
      '<button class="btn s ghost" data-act="r9arrreset" data-k="r9-arr-reset">' + L.icon('restart', 's') + 'Put back the usual layout</button><button class="btn s primary" data-act="r9arrange" data-k="r9-arr-done">Done</button></div>';
  };
  L.arrangeWrap = function (id, html, ci, mode) {
    var c = current(mode), h = c.heights[id];
    if (!A.on) return h ? '<div class="r9-fixed' + (id === 'onair' ? ' r10-fixed-air' : '') + '" data-box="' + id + '" style="--r9h:' + h + 'px">' + html + '</div>' : html;
    return '<div class="r9-box r10-box' + (id === 'onair' && ci < 0 ? ' r10-box-top' : '') + '" data-box="' + id + '" data-col="' + ci + '"' + (h ? ' style="--r9h:' + h + 'px"' : '') + '>' +
      '<div class="r10-arr" role="group" aria-label="Arrange ' + NAMES[id] + '"><span class="r10-arr-grip" draggable="true" data-r9grip="' + id + '" title="Drag to move ' + NAMES[id] + '" aria-hidden="true">' + L.icon('drag', 's') + '</span>' +
      '<button class="btn s r10-arr-move" data-act="r10move" data-box="' + id + '" data-k="r10m-' + id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Move or size: ' + NAMES[id] + '" title="Move or size ' + NAMES[id] + ' with the keyboard">Move…</button></div>' +
      '<div class="r9-boxin" inert>' + html + '</div>' +
      '<span class="r10-edge-b" data-r10edge="' + id + '" title="Drag to make ' + NAMES[id] + ' taller or shorter" aria-hidden="true"></span></div>';
  };
  L.arrangeSplit = function (ci, n, mode) {
    if (!A.on || mode < 2 || ci >= n - 1) return '';
    return '<div class="r9-split r10-split" data-split="' + ci + '" title="Drag to change the widths" aria-hidden="true"><span class="r9-split-bar"></span></div>';
  };
  function mode() { var app = document.getElementById('app'), w = app ? app.getBoundingClientRect().width : 960; return w >= 1200 ? 3 : w >= 820 ? 2 : 1; }
  function edit(fn) {
    var m = mode(), key = MODES[m], c = lay(m, DEFAULT[m]);
    var s = { cols: c.cols.map(function (x) { return x.slice(); }), widths: c.widths ? c.widths.slice() : null, heights: Object.assign({}, c.heights) };
    fn(s, m); s.cols = s.cols.filter(function (x) { return x.length; }); if (!s.cols.length) s.cols = [[]]; if (s.widths) s.widths = s.widths.slice(0, s.cols.length);
    A.saved[key] = s; save(); L.render();
  }
  function where(s, id) { for (var ci = 0; ci < s.cols.length; ci++) { var i = s.cols[ci].indexOf(id); if (i > -1) return { ci: ci, i: i }; } return null; }
  function boxEl(id) { return document.querySelector('.r10-box[data-box="' + id + '"] .r9-boxin') || document.querySelector('[data-box="' + id + '"]'); }
  function focusMove(id) { var b = document.querySelector('[data-k="r10m-' + id + '"]'); if (b) b.focus(); }
  L.acts.r9arrange = function () { A.on = !A.on; L.render(); var b = document.querySelector('[data-k="lv-arrange"]'); if (b) b.focus(); L.say(A.on ? 'Arranging the boxes. Drag a box by its header, or use its Move… button. Press Done when you have finished.' : 'Layout kept'); if (!A.on) L.saved('layout of Live for this window size'); };
  L.acts.r9arrreset = function () { delete A.saved[MODES[mode()]]; save(); L.render(); L.say('The usual layout is back'); var b = document.querySelector('[data-k="r9-arr-done"]'); if (b) b.focus(); };
  L.acts.r10move = function (el) {
    var id = el.dataset.box, m = mode(), c = current(m), p = where(c, id), cols = c.cols.filter(function (x) { return x.length; }), real = p ? p.ci : -1;
    function it(act, label, icon, dis) { return '<button role="menuitem" data-act="r10do" data-box="' + id + '" data-do="' + act + '"' + (dis ? ' disabled' : '') + '>' + L.icon(icon, 's') + label + '</button>'; }
    var col = p ? c.cols[p.ci] : null, h = '';
    if (id === 'onair' && !p) h += cols.map(function (x, i) { return it('into' + i, 'Into column ' + (i + 1), 'right'); }).join('');
    else {
      h += it('up', 'Up', 'chevup', !p || p.i === 0) + it('down', 'Down', 'chevdown', !p || p.i === col.length - 1);
      if (m > 1) h += it('left', 'Column left', 'left', real <= 0) + it('right', 'Column right', 'right', real < 0 || real >= c.cols.length - 1);
      if (id === 'onair') h += it('top', 'To the top, the whole width', 'chevup');
    }
    h += '<div class="sep" role="separator"></div>' + it('taller', 'Taller', 'plus') + it('shorter', 'Shorter (it scrolls inside)', 'minus') + it('fit', 'Fit to its contents', 'restart', !c.heights[id]);
    if (m > 1 && p) h += it('narrower', 'Narrower', 'chevleft', cols.length < 2) + it('wider', 'Wider', 'chevright', cols.length < 2);
    L.menu(el, h, 'Move or size ' + NAMES[id]);
  };
  L.acts.r10do = function (el) {
    var id = el.dataset.box, d = el.dataset.do, said = NAMES[id] + ' moved';
    edit(function (s, m) {
      var p = where(s, id), col = p && s.cols[p.ci];
      if (d === 'up' && p && p.i > 0) { col.splice(p.i, 1); col.splice(p.i - 1, 0, id); }
      if (d === 'down' && p && p.i < col.length - 1) { col.splice(p.i, 1); col.splice(p.i + 1, 0, id); }
      if ((d === 'left' && p && p.ci > 0) || (d === 'right' && p && p.ci < s.cols.length - 1)) { col.splice(p.i, 1); s.cols[p.ci + (d === 'left' ? -1 : 1)].push(id); }
      if (d === 'top' && p) { col.splice(p.i, 1); said = 'On air is at the top again'; }
      if (/^into/.test(d)) { var ci = +d.slice(4); while (s.cols.length <= ci) s.cols.push([]); s.cols[ci].unshift(id); said = 'On air moved into column ' + (ci + 1); }
      if (d === 'taller' || d === 'shorter') { var box = boxEl(id), now = s.heights[id] || (box ? Math.round(box.getBoundingClientRect().height) : 300); s.heights[id] = Math.max(120, Math.min(1200, Math.round((now + (d === 'taller' ? 60 : -60)) / 10) * 10)); said = NAMES[id] + ' ' + s.heights[id] + ' pixels high'; }
      if (d === 'fit') { delete s.heights[id]; said = NAMES[id] + ' now fits its contents'; }
      if ((d === 'narrower' || d === 'wider') && p) {
        var n = s.cols.length, base = (s.widths || s.cols.map(function (x, i) { return (m === 3 ? [27, 43, 30, 25][i] : [38, 62, 30][i]) || 30; })).slice(0, n); while (base.length < n) base.push(25);
        var nb = p.ci < n - 1 ? p.ci + 1 : p.ci - 1, step = (d === 'wider' ? 4 : -4);
        if (nb >= 0 && base[p.ci] + step >= 12 && base[nb] - step >= 12) { base[p.ci] += step; base[nb] -= step; s.widths = base; }
        said = NAMES[id] + (d === 'wider' ? ' wider' : ' narrower');
      }
    });
    focusMove(id); L.say(said);
  };
  // Dragging a box by its head: a line shows where it lands (above or below the box under the pointer, at the end of
  // an empty column, or back at the top for On air); dropping puts it there.
  var drag = null;
  function clearMarks() { document.querySelectorAll('.r9-before, .r9-after, .r9-colover, .r10-topover').forEach(function (n) { n.classList.remove('r9-before', 'r9-after', 'r9-colover', 'r10-topover'); }); }
  document.addEventListener('dragstart', function (e) {
    var g = e.target.closest && e.target.closest('[data-r9grip]'); if (!g) return;
    drag = { id: g.dataset.r9grip }; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.id); } catch (x) { /* older engines */ }
    e.stopPropagation();
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!drag) return; var box = e.target.closest && e.target.closest('.r9-box'), col = e.target.closest && e.target.closest('.lv-cols > .col'), top = e.target.closest && e.target.closest('.r10-box-top, .r9-arrbar');
    if (!col && !(top && drag.id === 'onair')) return;
    e.preventDefault(); e.stopPropagation(); clearMarks();
    if (top && !col) { (document.querySelector('.r9-arrbar') || top).classList.add('r10-topover'); return; }
    if (box && box.dataset.box !== drag.id) { var r = box.getBoundingClientRect(); box.classList.add(e.clientY > r.top + r.height / 2 ? 'r9-after' : 'r9-before'); }
    else if (!box) col.classList.add('r9-colover');
  }, true);
  document.addEventListener('drop', function (e) {
    if (!drag) return; var d = drag; drag = null; var box = e.target.closest && e.target.closest('.r9-box'), col = e.target.closest && e.target.closest('.lv-cols > .col'), top = e.target.closest && e.target.closest('.r10-box-top, .r9-arrbar'); clearMarks();
    if (!col && !(top && d.id === 'onair')) return;
    e.preventDefault(); e.stopPropagation();
    var after = box ? e.clientY > box.getBoundingClientRect().top + box.getBoundingClientRect().height / 2 : true;
    edit(function (s) {
      var p = where(s, d.id); if (p) s.cols[p.ci].splice(p.i, 1);
      if (!col) return;                                               // On air dropped at the top
      var ci = +col.dataset.col; while (s.cols.length <= ci) s.cols.push([]);
      var target = s.cols[ci], at = box && box.dataset.box !== d.id && target.indexOf(box.dataset.box) > -1 ? target.indexOf(box.dataset.box) + (after ? 1 : 0) : target.length;
      target.splice(Math.max(0, at), 0, d.id);
    });
    L.say(NAMES[d.id] + ' moved');
  }, true);
  document.addEventListener('dragend', function () { if (drag) { drag = null; clearMarks(); } }, true);
  // Dragging a box's foot changes its height; dragging the bar between columns changes their widths.
  document.addEventListener('pointerdown', function (e) {
    var edge = e.target.closest && e.target.closest('[data-r10edge]');
    if (edge) {
      var id = edge.dataset.r10edge, inner = edge.parentNode.querySelector('.r9-boxin'), h0 = inner.getBoundingClientRect().height, y0 = e.clientY, hNow = h0; e.preventDefault();
      var mv = function (ev) { hNow = Math.max(120, Math.min(1200, h0 + ev.clientY - y0)); edge.parentNode.style.setProperty('--r9h', hNow + 'px'); edge.parentNode.classList.add('r10-sizing'); };
      var upE = function () { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', upE); edit(function (s) { s.heights[id] = Math.round(hNow / 10) * 10; }); L.say(NAMES[id] + ' ' + Math.round(hNow / 10) * 10 + ' pixels high'); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', upE); return;
    }
    var bar = e.target.closest && e.target.closest('.r9-split'); if (!bar) return;
    var sp = bar, ci = +sp.dataset.split, grid = sp.parentNode, cols = [].slice.call(grid.querySelectorAll(':scope > .col'));
    var a = cols[ci].getBoundingClientRect().width, b = cols[ci + 1].getBoundingClientRect().width, x0 = e.clientX;
    e.preventDefault();
    function move(ev) { var dx = ev.clientX - x0; cols[ci].dataset.w = Math.max(80, a + dx); cols[ci + 1].dataset.w = Math.max(80, b - dx); sp.classList.add('on'); sp.style.transform = 'translateX(' + Math.max(80 - a, Math.min(b - 80, dx)) + 'px)'; }
    function up() {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); sp.classList.remove('on'); sp.style.transform = '';
      var wa = +cols[ci].dataset.w || a, wb = +cols[ci + 1].dataset.w || b;
      edit(function (s) {
        var n = s.cols.length, base = (s.widths || cols.map(function (c) { return c.getBoundingClientRect().width; })).slice(0, n);
        // 0.6.0 review M4 (f-live): the bar before the empty column to drop into (drawn only while arranging) changes
        // the last real column's width; the empty column keeps none.
        if (base[ci + 1] == null || !s.cols[ci + 1].length) base[ci] = base[ci] * wa / a;
        else { var total = base[ci] + base[ci + 1]; base[ci] = total * wa / (wa + wb); base[ci + 1] = total * wb / (wa + wb); }
        s.widths = base.map(function (x) { return Math.round(x * 10) / 10; });
      });
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });

  /* ---------- painting what lives outside the view ---------- */
  var render0 = L.render;
  L.render = function () {
    // Round 10 (R10-FIX §3): the queue is a side panel beside the screen (r10fix.css), no longer over its lists; a
    // redraw keeps focus on the queue's control that had it.
    var was = document.getElementById('r9-queue'), ak = was && was.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.k : '';
    render0.apply(L, arguments);
    var r = L.current();
    var bar = document.querySelector('#view .onairbar'), old = document.getElementById('r9-queue'), work = document.getElementById('work');
    if (old) old.remove();
    if (Q.open && bar) {
      if (work) work.insertAdjacentHTML('beforeend', queueHTML()); else bar.insertAdjacentHTML('beforebegin', queueHTML());
      var back = ak && document.querySelector('#r9-queue [data-k="' + ak + '"]'); if (back) back.focus({ preventScroll: true });
    } else if (Q.open && !bar) Q.open = null;
    if (L.placeToasts) L.placeToasts();
    // Round 10 (look D6, table D-S9): no mark on a pad's face for dipping; its name and hover say it (live.js, boards.js).
  };
})();
