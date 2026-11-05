/* Live view (#/live): the screen Nik runs a game from, built to work in half of a 1920 screen.
   Order of importance: what is on air, the scenes, the scene's music, Off script search, then pads (folded by default).
   Layout is chosen from the width of #app: one column below 820 px, two columns up to 1200 px, three above.
   This file keeps a small "Play next" queue and an off-script return point; L.next and L.upNext are wrapped so
   the queue plays first (candidates to move into core). */
(function () {
  var esc = L.esc, D = L.data, pb = L.pb;
  var S = {
    booted: false, notStarted: false, sceneKey: '', plSel: null, queue: [], resume: null, lastMusic: null, 
    q: '', tags: [], lane: 'all', moreTags: false, board: null, notesOpen: false, keyNav: false, holding: null, keyHeld: {},
    keys1: true, keysOpen: false, undo: null, sel: null, allScenes: false,
  };
  // Single-key shortcuts (Space, / and pad keys) can be switched off (WCAG 2.1.4); remembered in this browser only.
  try { S.keys1 = localStorage.getItem('lyre-r2-live-keys1') !== 'off'; } catch (e) { S.keys1 = true; }
  function saveKeys1() { try { localStorage.setItem('lyre-r2-live-keys1', S.keys1 ? 'on' : 'off'); } catch (e) { /* storage unavailable: lasts for this visit */ } }

  /* ---------- queue and off-script return point, per mix ---------- */
  // A mix target is 'table' (L.pb, every output by default) or the id of a bot with its own mix (core's L.mix(target)).
  // Each mix keeps its own Play next queue and off-script return point; S.queue / S.resume are the table mix's.
  var coreNext = L.next, corePrev = L.prev, coreUpNext = L.upNext;
  S.oq = {}; S.ores = {}; S.lastM = {};
  function tgOf(target) { var b = target && target !== 'table' && L.bot(target); return b && b.status !== 'idle' && b.id !== L.bots()[0].id ? b.id : 'table'; }
  function M(tg) { return tg === 'table' ? pb : L.mix(tg); }
  function Q(tg) { return tg === 'table' ? S.queue : (S.oq[tg] || (S.oq[tg] = [])); }
  function getRes(tg) { return tg === 'table' ? S.resume : S.ores[tg] || null; }
  function setRes(tg, v) { if (tg === 'table') S.resume = v; else S.ores[tg] = v; }
  // What plays after the current music track, before the scene sequence or playlist moves on: the queue, then the way
  // back from an off-script detour. A position in a scene's sequence is {cid, sid, scene, at} (core's music.seq).
  function pending(cur, tg) {
    tg = tg || 'table'; var q = Q(tg), r = getRes(tg);
    if (q.length) return { id: q[0].id, pl: q[0].pl, seq: q[0].seq, queued: true };
    if (cur && r && cur.id === r.from) return { id: r.id, pl: r.pl, seq: r.seq, back: true };
    return null;
  }
  // Where the music would go next on its own (scene sequence or playlist), for returning after a detour.
  function naturalNext(cur) {
    if (!cur) return null;
    if (cur.seq) return seqStep(cur, 1);
    if (!cur.playlistId) return null;
    var list = L.orderedTracks(cur.playlistId, cur.place), i = list.map(function (t) { return t.id; }).indexOf(cur.id);
    return list.length ? { id: list[(i + 1) % list.length].id, pl: cur.playlistId } : null;
  }
  // One step through a scene's sequence. A track that would play twice in a row (a track item followed by a playlist
  // that starts with the same track) is skipped, so Next always changes the music. Candidate for core's step().
  function seqStep(cur, d) {
    var s0 = L.session(cur.seq.cid, cur.seq.sid), sc0 = s0 && s0.scenes[cur.seq.scene], q = sc0 ? L.sceneSequence(sc0) : [];
    for (var k = 1; k <= q.length; k++) {
      var at = ((cur.seq.at + d * k) % q.length + q.length) % q.length;
      if (q[at].trackId !== cur.id || q.length === 1) return { id: q[at].trackId, pl: q[at].playlistId, seq: { cid: cur.seq.cid, sid: cur.seq.sid, scene: cur.seq.scene, at: at } };
    }
    return null;
  }
  // PLY-13: a session or campaign playlist played in Live plays in its order for that place ('ss:…' or 'cp:…').
  function placeOfPl(pl) {
    var lv = live(), s = L.session(lv.cid, lv.sid), c = L.campaign(lv.cid);
    if (!pl) return ''; if (s && s.playlists.indexOf(pl) > -1) return 'ss:' + lv.cid + ':' + lv.sid; if (c && c.playlists.indexOf(pl) > -1) return 'cp:' + lv.cid; return '';
  }
  function playMusic(id, pl, cur, seq, tg) {
    tg = tg || 'table'; cur = cur === undefined ? M(tg).music : cur;
    if (!pl && !seq) {
      var r = getRes(tg), base = cur && r && cur.id === r.from ? r : naturalNext(cur);
      setRes(tg, base ? { from: id, id: base.id, pl: base.pl, seq: base.seq } : null);
    } else setRes(tg, null);
    L.play(id, { lane: 'music', playlistId: pl || '', place: seq ? '' : placeOfPl(pl), fade: 3, seq: seq ? { cid: seq.cid, sid: seq.sid, scene: seq.scene, at: seq.at } : null, target: tg });
  }
  function advance(cur, tg) { tg = tg || 'table'; var p = pending(cur, tg); if (!p) return false; if (p.queued) Q(tg).shift(); playMusic(p.id, p.pl, cur, p.seq, tg); return true; }
  function seqMove(d, tg) { var c = M(tg).music, n = c && c.seq ? seqStep(c, d) : null; if (!n) return false; playMusic(n.id, n.pl, c, n.seq, tg); return true; }
  L.next = function (ln, target) { var tg = tgOf(target); if (ln === 'music' && (advance(M(tg).music, tg) || seqMove(1, tg))) return; coreNext(ln, target); };
  L.prev = function (ln, target) { var tg = tgOf(target); if (ln === 'music' && seqMove(-1, tg)) return; corePrev(ln, target); };
  L.upNext = function (ln, target) {
    var tg = tgOf(target), c = M(tg).music;
    if ((ln || 'music') === 'music') { var p = pending(c, tg); if (p) return L.track(p.id); var n = c && c.seq ? seqStep(c, 1) : null; if (n) return L.track(n.id); }
    return coreUpNext(ln, target);
  };
  // A track with no playlist stops at its end in core; play whatever is pending for that mix instead.
  setInterval(function () {
    if (S.undo) {
      // The countdown waits while the pointer or focus is on the strip.
      var a = document.activeElement;
      if (document.querySelector('.lv-undo:hover') || (a && a.dataset && a.dataset.k === 'lv-undo')) S.undo.until = Math.max(S.undo.until, Date.now() + 1500);
      if (Date.now() >= S.undo.until) { var hadFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k === 'lv-undo'; S.undo = null; L.render(); if (hadFocus) focusK('lv-nextsc'); }
      else document.querySelectorAll('[data-undo-left]').forEach(function (el) { el.style.width = undoLeft() + '%'; });
    }
    ['table'].concat(Object.keys(pb.own || {})).forEach(function (tg) {
      var m = M(tg), last = S.lastM[tg];
      if (m && !m.music && last && last.pos >= last.dur - 0.3 && !last.fadeOut) { S.lastM[tg] = null; advance(last, tg); }
      S.lastM[tg] = m ? m.music : null;
    });
  }, 250);

  /* ---------- small helpers ---------- */
  function live() { return L.state.live; }
  function sess() { return L.session(live().cid, live().sid); }
  function camp() { return L.campaign(live().cid); }
  function scene() { var s = sess(); return s && !S.notStarted ? s.scenes[live().scene] : null; }
  function collapsed(id, def) { var st = L.state.panes[id]; return st == null ? !!def : st === 'c'; }
  function plName(id) { var p = L.playlist(id); return p ? p.name : ''; }
  function musicOnly(ids) { return (ids || []).filter(function (id) { var p = L.playlist(id); return p && p.lane === 'music'; }); }
  // Before the first scene starts, Scene music offers the scene on standby.
  function musicScene() { var s = sess(); return scene() || (S.notStarted && s ? s.scenes[live().standby] : null); }
  function plGroups() {
    var sc = musicScene(), s = sess(), c = camp(), seen = {};
    function uniq(ids) { return musicOnly(ids).filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }); }
    return { scene: uniq(sc ? sc.music : []), session: uniq(s ? s.playlists : []), campaign: uniq(c ? c.playlists : []),
      sessionTracks: ((s && s.tracks) || []).filter(L.track), campaignTracks: ((c && c.tracks) || []).filter(L.track) };
  }
  // What Scene music shows: 'scene' (the scene's ordered list) or a session/campaign playlist id.
  function selectedPl() {
    var g = plGroups(), sc = musicScene();
    if (S.plSel && S.plSel !== 'scene' && g.session.concat(g.campaign).indexOf(S.plSel) > -1) return S.plSel;
    if (sc && L.sceneItems(sc).length) return 'scene';
    return g.session[0] || g.campaign[0] || null;
  }
  function boardsOf(sc) { return sc ? L.sceneBoards(sc).filter(function (id) { return L.board(id); }) : []; }
  function boardId() { var sc = musicScene(), bs = boardsOf(sc); return S.board || bs[0] || D.boards[0].id; }
  // The scene whose sequence is on air now, if the music came from a scene.
  function seqHere(c) { var lv = live(); return c && c.seq && c.seq.cid === lv.cid && c.seq.sid === lv.sid && !S.notStarted && c.seq.scene === lv.scene ? c.seq : null; }
  function seqItem(c) { var q = c && c.seq, s0 = q && L.session(q.cid, q.sid), sc0 = s0 && s0.scenes[q.scene], list = sc0 ? L.sceneSequence(sc0) : []; return list[q ? q.at : -1] ? { sc: sc0, item: list[q.at].item, n: L.sceneItems(sc0).length } : null; }
  function ambName(id) { var p = L.playlist(id), t = !p && L.track(id); return p ? p.name : t ? L.title(t) : ''; }
  function sounding() { return pb.fx.filter(function (f) { return !f.fadeOut; }); }
  function moodChips(t, prefer) {
    var m = (t.tags.mood || []).slice();
    if (prefer && prefer.length) m.sort(function (a, b) { return (prefer.indexOf(b) > -1) - (prefer.indexOf(a) > -1); });
    return m.slice(0, 1).map(function (v) { return '<span class="chip lv-mood" title="Mood">' + esc(v) + '</span>'; }).join('');
  }
  function focusK(k) { var el = document.querySelector('[data-k="' + k + '"]'); if (el) el.focus({ preventScroll: true }); }

  /* ---------- undo for scene changes (8 s) ---------- */
  var UNDO_MS = 8000;
  function undoLeft() { return S.undo ? Math.max(0, Math.min(100, (S.undo.until - Date.now()) / UNDO_MS * 100)) : 0; }
  function laneCopy(c) { return c ? { id: c.id, playlistId: c.playlistId, pos: c.pos, paused: !!c.paused, seq: c.seq ? { cid: c.seq.cid, sid: c.seq.sid, scene: c.seq.scene, at: c.seq.at } : null } : null; }
  function changeScene(idx) {
    var lv = live(), s = sess(); if (!s.scenes[idx]) return;
    var prevName = S.notStarted ? 'before the first scene' : (s.scenes[lv.scene] ? s.scenes[lv.scene].name : 'the previous scene');
    var tgs = ['table'].concat(Object.keys(pb.own || {}).filter(function (id) { return tgOf(id) === id; }));
    var snap = { cid: lv.cid, sid: lv.sid, scene: lv.scene, standby: lv.standby, notStarted: S.notStarted,
      rooms: tgs.map(function (tg) { return { tg: tg, music: laneCopy(M(tg).music), amb: laneCopy(M(tg).amb) }; }), queue: S.queue.slice(), resume: S.resume, at: Date.now() };
    S.notStarted = false; S.queue = []; S.resume = null;
    S.undo = { snap: snap, label: prevName, started: s.scenes[idx].name, until: Date.now() + UNDO_MS }; S.board = null; S.plSel = null;
    L.startScene(lv.cid, lv.sid, idx);
    L.say('Started ' + s.scenes[idx].name + '. Undo is available for 8 seconds, or press Ctrl+Z.');
  }
  function restoreLane(ln, c, elapsed, tg) {
    if (!c) { L.stopLane(ln, 1.5, tg); return; }
    L.play(c.id, { lane: ln, playlistId: c.playlistId, fade: 1.5, seq: c.seq, target: tg });
    var m = M(tg); if (m[ln]) { m[ln].pos = Math.min(m[ln].dur - 1, c.pos + (c.paused ? 0 : elapsed)); m[ln].paused = c.paused; }
  }
  function undo() {
    var u = S.undo; if (!u) return false; S.undo = null;
    var s = u.snap, lv = live(), elapsed = (Date.now() - s.at) / 1000;
    lv.cid = s.cid; lv.sid = s.sid; lv.scene = s.scene; lv.standby = s.standby; S.notStarted = s.notStarted;
    var say = L.say; L.say = function () {};
    try { s.rooms.forEach(function (r) { if (r.tg === 'table' || tgOf(r.tg) === r.tg) { restoreLane('music', r.music, elapsed, r.tg); restoreLane('amb', r.amb, elapsed, r.tg); } }); } finally { L.say = say; }
    S.queue = s.queue; S.resume = s.resume;
    L.render(); focusK('lv-nextsc'); L.say('Back to ' + u.label + ', with its music and ambience');
    return true;
  }
  // What happens at the end of the music on air, from its audio profile here (shown as a tooltip).
  function endText(t, tg) {
    var ctx = L.laneContext && L.laneContext('music', tg), pf = L.profileOf ? L.profileOf(t, ctx) : null; if (!pf) return '';
    var where = L.profileWhere ? L.profileWhere(t, ctx) : 'track';
    return 'Ends ' + L.fmt(pf.end) + ', ' + (pf.after === 'loop' ? 'loops from ' + L.fmt(pf.loopStart) : pf.after === 'stop' ? 'then stops' : 'then next') + (where !== 'track' ? ' (' + where + ' setting)' : '');
  }
  // How long a track plays in a place: its audio profile there (end − start).
  function playLen(t, key) { var pf = L.profileOf ? L.profileOf(t, key || undefined) : null; return pf ? Math.max(0, pf.end - pf.start) : t.dur; }
  /* Discord: the bots and where they broadcast come from core (L.bots, L.botJoin ...). */
  function connected() { return L.bots().filter(function (b) { return b.status === 'connected' && !b.muted; }); }
  // The room most players are in: the one-click fix when nobody hears anything.
  function busiestChannel() {
    var best = null; D.discord.servers.forEach(function (g) { g.channels.forEach(function (c) { if (!best || c.members.length > best.c.members.length) best = { g: g, c: c }; }); });
    return best;
  }
  function botsMenu(only) {
    if (L.botsMenuHTML) return L.botsMenuHTML(only);
    return L.bots().filter(function (b) { return !only || b.id === only; }).map(function (b) {
      return '<div class="group">' + esc(b.name) + '</div><div class="item muted lv-dc-info">' + esc(L.botStatusText(b)) + (b.status === 'connected' ? ' (' + L.botListeners(b).length + ' listening)' : '') + '</div>' +
        (b.status !== 'idle' ? '<button role="menuitemcheckbox" aria-checked="' + !!b.muted + '" data-act="lvbotmute" data-id="' + b.id + '">' + L.icon(b.muted ? 'check' : 'minus', 's') + 'Mute</button>' : '') +
        '<div class="group lv-moveto">Move to…</div>' + D.discord.servers.map(function (g) {
          return g.channels.map(function (c) {
            var here = b.server === g.id && b.channel === c.id;
            return '<button role="menuitemradio" aria-checked="' + here + '" data-act="lvbotjoin" data-id="' + b.id + '" data-g="' + g.id + '" data-c="' + c.id + '"' + (here ? ' disabled' : '') + '>' + (here ? L.icon('check', 's') : '<span style="width:14px"></span>') +
              '<span class="grow ellipsis">' + esc(c.name) + ' <span class="faint">' + esc(g.name) + '</span></span><span class="faint">' + c.members.length + '</span></button>';
          }).join('');
        }).join('') +
        (b.status !== 'idle' ? '<button role="menuitem" data-act="lvbotleave" data-id="' + b.id + '">' + L.icon('close', 's') + 'Leave the voice channel</button>' : '') + '<div class="sep"></div>';
    }).join('') + '<a role="menuitem" class="item" href="#/outputs">' + L.icon('broadcast', 's') + 'All outputs…</a>';
  }
  function keysOf(b) { return L.boardPads(b).filter(function (p) { return p && p.key; }).map(function (p) { return p.key.toUpperCase(); }); }

  /* ---------- standby: load a session with nothing started (Run, and Prep | Live) ---------- */
  // Core and the Campaigns view call this. The same session already running is left as it is; anything playing from
  // another session fades out over 3 s, and the demo playback is not started.
  L.liveStandby = function (cid, sid) {
    var lv = live(), s = L.session(cid, sid); if (!s) return;
    S.booted = true;
    // Leave a session alone only if it is this one and something from it is playing; otherwise load it on standby.
    if (lv.cid === cid && lv.sid === sid && !S.notStarted && (pb.music || pb.amb)) return;
    lv.cid = cid; lv.sid = sid; lv.scene = 0; lv.standby = 0; S.notStarted = true;
    S.queue = []; S.resume = null; S.undo = null; S.plSel = null; S.board = null; S.allScenes = false; S.sel = null;
    var say = L.say; L.say = function () {};
    try {
      if (pb.music && !(pb.music.seq && pb.music.seq.cid === cid && pb.music.seq.sid === sid)) L.stopLane('music', 3);
      if (pb.amb) L.stopLane('amb', 3);
    } finally { L.say = say; }
    L.say('Loaded ' + L.campaign(cid).name + ', session ' + s.n + '. Nothing is playing yet; press Next scene to start ' + s.scenes[0].name + '.');
  };

  /* ---------- boot: a believable mid-session state (only when Live is the first page opened) ---------- */
  var firstLive = /^#\/live\b/.test(location.hash || '');
  function boot() {
    if (S.booted) return; S.booted = true;
    if (pb.music || pb.amb) return;
    // Reached from another page without Run: show the loaded session on standby rather than a half-started one.
    if (!firstLive) { var lv = live(); lv.scene = 0; lv.standby = 0; S.notStarted = true; return; }
    var say = L.say; L.say = function () {};
    try { L.startScene(live().cid, live().sid, 1); } finally { L.say = say; }
    if (pb.music) { pb.music.pos = 74; pb.music.vol = 1; pb.music.fadeIn = 0; }
    if (pb.amb) { pb.amb.pos = 131; pb.amb.vol = 1; pb.amb.fadeIn = 0; }
    pb.musicOut = []; pb.ambOut = [];
  }

  /* ---------- top strip ---------- */
  function top() {
    var c = camp(), s = sess();
    return '<div class="lv-top"><h1 class="sr-only">Live</h1>' + L.modeSwitch(c.id) +
      '<button class="lv-sess" data-act="lvsessmenu" data-k="lv-sess" aria-haspopup="menu" aria-expanded="false" title="Loaded: ' + esc(c.name + ' › Session ' + s.n + ': ' + s.name) + '. Choose another session">' +
        L.icon('crown', 's') + '<span class="lv-sess-c">' + esc(c.name) + '</span><span class="lv-sess-sep" aria-hidden="true">›</span><span class="lv-sess-s">Session ' + s.n + ': ' + esc(s.name) + '</span>' + L.icon('chevdown', 's') + '</button>' +
      (rooms().length ? '' : noBotWarning()) +
      '<span class="grow"></span>' +
      '<button class="btn s" data-act="lvfade" data-k="lv-fade" title="Fade everything out over 3 seconds (Shift+Esc)" aria-keyshortcuts="Shift+Escape" aria-label="Fade all">' + L.icon('fade', 's') + '<span class="lv-btxt">Fade all</span></button>' +
      '<button class="btn s danger" data-act="lvstop" data-k="lv-stop" title="Stop everything at once" aria-label="Stop all">' + L.icon('stop', 's') + '<span class="lv-btxt">Stop all</span></button>' +
      '<span class="lv-keyswrap"><button class="btn s" data-act="lvkeys" data-k="lv-keys" aria-expanded="' + S.keysOpen + '" aria-controls="lv-keys-pop" title="Keyboard keys for the live screen">Keys' + L.icon(S.keysOpen ? 'chevup' : 'chevdown', 's') + '</button>' +
      (S.keysOpen ? keysPop() : '') + '</span></div>';
  }
  function keysPop() {
    var b = L.board(boardId()), pk = keysOf(b).join(' ') || 'none', off = S.keys1 ? '' : ' class="lv-off"';
    function k(key, what, single) { return '<li' + (single ? off : '') + '><span class="kbd">' + key + '</span><span>' + what + '</span></li>'; }
    return '<div class="lv-pop" id="lv-keys-pop" role="group" aria-label="Keys on the live screen">' +
      '<label class="lv-switch"><input type="checkbox" role="switch" data-input="lvkeys1" data-k="lv-keys1"' + (S.keys1 ? ' checked' : '') + '><span class="lv-switch-t"><b>Single-key shortcuts</b><span class="hint">Space, / and the pad keys. Turn off if they get in the way.</span></span></label>' +
      '<ul class="lv-keylist">' + k('Space', 'Start the next scene', 1) + k('/', 'Search Off script', 1) + k(esc(pk), 'Pads on ' + esc(b.name), 1) +
      k('Shift+Esc', 'Fade everything out (3 s)') + k('Ctrl+Z', 'Undo the last scene change (for 8 s)') + k('Esc', 'Close a menu or clear the search') + '</ul>' +
      '<p class="hint">' + (S.keys1 ? 'Keys do nothing while you type in a box.' : 'Single-key shortcuts are off. Shift+Esc and Ctrl+Z still work.') + '</p></div>';
  }

  /* ---------- Rooms: one On air box per room; Send to picks the rooms that new sound goes to ---------- */
  function rooms() { return L.rooms ? L.rooms() : []; }
  function roomName(tg) { var b = tg === 'table' ? L.bots()[0] : L.bot(tg); return b ? L.outputName(b) : 'Table'; }
  function roomTg(b) { return b.id === L.bots()[0].id ? 'table' : b.id; }
  function roomStatus(b) {
    var m = M(roomTg(b)), on = (m.music && !m.music.paused) || (m.amb && !m.amb.paused) || L.fxFor(roomTg(b)).some(function (f) { return !f.fadeOut; });
    if (b.status === 'connecting') return { text: 'Joining', tone: 'warn' };
    if (b.muted) return { text: 'Muted', tone: 'idle' };
    if (on) return { text: 'Playing', tone: 'live' };
    if (m.music && m.music.paused) return { text: 'Paused', tone: 'idle' };
    return { text: 'Silent', tone: 'idle' };
  }
  /* Each box that starts sound (Scene music, Off script, Pads) has its own room: "To: Table ▾", shown only when there
     is more than one room. Scenes always go to the first room. */
  S.to = {};
  function roomTgs() { var r = rooms(); return r.length ? r.map(function (x) { return tgOf(x.bots[0].id); }) : ['table']; }
  function boxTo(box) {
    var v = S.to[box], r = rooms();
    if (v === 'all' && r.length > 1) return 'all';
    if (v && r.some(function (x) { return x.bots[0].id === v; })) return v;
    return r.length ? r[0].bots[0].id : 'table';
  }
  function targetsOf(box) { var v = boxTo(box); return v === 'all' ? roomTgs() : [tgOf(v)]; }
  function toName(box) { var v = boxTo(box); return v === 'all' ? 'all rooms' : roomName(tgOf(v)); }
  function inWhere(box) { return rooms().length > 1 ? ' in ' + toName(box) : ''; }
  function toChip(box) {
    if (rooms().length < 2) return '';
    var n = toName(box);
    return '<button class="lv-to" data-act="lvto" data-box="' + box + '" data-k="lv-to-' + box + '" aria-haspopup="menu" aria-expanded="false" title="Where this box plays: ' + esc(n) + '" aria-label="To: ' + esc(n) + ', choose a room">' +
      '<span class="faint">To:</span><b class="ellipsis">' + esc(n.charAt(0).toUpperCase() + n.slice(1)) + '</b>' + L.icon('chevdown', 's') + '</button>';
  }
  function eachTo(box, fn) { targetsOf(box).forEach(fn); }
  // A preview (only you hear it) shows in the Now playing bar at the bottom, the one place for it on every screen.
  function airBadge(t) {
    var where = rooms().filter(function (r) { var m = r.mix; return (m.music && m.music.id === t.id) || (m.amb && m.amb.id === t.id); }).map(function (r) { return r.name; });
    if (!where.length && pb.music && pb.music.id === t.id) where = ['Table'];
    return L.destTag('air', rooms().length > 1 ? where.join(' and ') : '');
  }
  function noBotWarning() {
    var b = L.bots().filter(function (x) { return x.status !== 'connecting'; })[0] || L.bots()[0], best = busiestChannel(), joining = L.bots().some(function (x) { return x.status === 'connecting'; });
    return '<span class="lv-warn" role="status" title="Players hear nothing: no bot is in a voice channel">' + L.icon('broadcast', 's') + '<span class="lv-warn-t">' + (joining ? 'Joining…' : 'No room: players hear nothing') + '</span></span>' +
      (b && best && !joining ? '<button class="btn s lv-fix" data-act="lvbotjoin" data-id="' + b.id + '" data-g="' + best.g.id + '" data-c="' + best.c.id + '" data-k="lv-fix" title="' + esc(b.name + ' joins ' + best.g.name + ' › ' + best.c.name + ' (' + best.c.members.length + ' there)') + '">Join ' + esc(best.c.name) + '</button>' : '');
  }
  function laneBlock(ln, tg) {
    var m = M(tg), c = m[ln], t = c && L.track(c.id), isM = ln === 'music', name = isM ? 'Music' : 'Ambience', at = tg === 'table' ? '' : '@' + tg, kx = tg === 'table' ? '' : '-' + tg, tga = ' data-tg="' + tg + '"';
    var shown = t ? L.nameIn(t, L.lanePlace(c)) : '';
    var dis = c ? '' : ' disabled';
    var h = '<div class="lv-lane ' + (isM ? 'lv-m' : 'lv-a') + (c ? '' : ' empty') + '">' +
      '<div class="lv-lane-l"><span class="lv-lane-n"><span class="lane-dot ' + ln + '"></span>' + name + '</span>' + (c && c.paused ? '<span class="badge">Paused</span>' : '') + '</div>' +
      '<div class="lv-lane-m">' +
        '<div class="lv-lane-t ellipsis"' + (t ? ' title="' + esc(shown !== L.title(t) ? 'Its own name: ' + L.title(t) : L.title(t)) + '"' : '') + '>' + (t ? esc(shown) + (shown !== L.title(t) ? '<span class="sr-only"> (its own name: ' + esc(L.title(t)) + ')</span>' : '') : '<span class="muted">Silent</span>') + '</div>' +
        (c ? '<div class="lv-lane-pr"><div class="progress ' + ln + '"><span data-progress="' + ln + at + '"></span></div><span class="num lv-time" data-time="' + ln + at + '"></span></div>' : '');
    if (isM && c) {
      var p = pending(c, tg), nt = L.upNext('music', tg), from = c.playlistId ? plName(c.playlistId) : '', si = seqItem(c);
      var src = si ? 'Item ' + (si.item + 1) + ' of ' + si.n + (from ? ' · ' + esc(from) : '') : from ? esc(from) : 'Off script';
      var why = p && p.queued ? ' (queued)' : p && p.back ? ' (back to ' + esc(plName(p.pl)) + ')' : '';
      h += '<div class="lv-lane-sub ellipsis" title="' + esc(endText(t, tg)) + '">' + src + ' · <span class="lv-upnext">up next ' + (nt ? '<b>' + esc(L.title(nt)) + '</b>' + why : 'nothing') + '</span></div>';
    }
    h += '</div>' + (c ? '<div class="lv-lane-c" role="group" aria-label="' + name + ' in ' + esc(roomName(tg)) + '">' : '<div hidden>');
    if (isM) h += '<button class="btn s icon" data-act="lvprevt" data-lane="music"' + tga + ' data-k="lv-prev-m' + kx + '" title="Previous track" aria-label="Previous music track"' + (c && (c.playlistId || c.seq) ? '' : ' disabled') + '>' + L.icon('prev', 's') + '</button>';
    h += '<button class="btn s icon" data-act="lvpause" data-lane="' + ln + '"' + tga + ' data-k="lv-pause-' + ln + kx + '" title="' + (c && c.paused ? 'Resume' : 'Pause') + ' ' + name.toLowerCase() + '" aria-label="' + (c && c.paused ? 'Resume' : 'Pause') + ' ' + name.toLowerCase() + '"' + dis + '>' + L.icon(c && c.paused ? 'play' : 'pause', 's') + '</button>' +
      '<button class="btn s icon" data-act="lvnextt" data-lane="' + ln + '"' + tga + ' data-k="lv-next-' + ln + kx + '" title="Next ' + (isM ? 'track' : 'ambience') + ' (crossfade)" aria-label="Next ' + name.toLowerCase() + ' track"' + (c && (c.playlistId || c.seq || (isM && pending(c, tg))) ? '' : ' disabled') + '>' + L.icon('next', 's') + '</button>' +
      '<button class="btn s icon" data-act="lvfadeout" data-lane="' + ln + '"' + tga + ' data-k="lv-fo-' + ln + kx + '" title="Fade ' + name.toLowerCase() + ' out over 3 seconds" aria-label="Fade ' + name.toLowerCase() + ' out"' + dis + '>' + L.icon('fade', 's') + '</button></div></div>';
    var q = Q(tg);
    if (isM && q.length) {
      h += '<div class="lv-queue"><span class="lv-q-l">Queued</span><ol class="chips">' + q.map(function (x, i) {
        var qt = L.track(x.id);
        return '<li class="chip lv-q-item" title="' + esc(L.title(qt)) + '"><span class="num">' + (i + 1) + '</span><span class="ellipsis">' + esc(L.title(qt)) + '</span><button class="x" data-act="lvunq"' + tga + ' data-i="' + i + '" data-k="lv-unq-' + i + kx + '" title="Remove from the queue" aria-label="Remove ' + esc(L.title(qt)) + ' from the queue">' + L.icon('close', 's') + '</button></li>';
      }).join('') + '</ol><button class="btn s ghost" data-act="lvqclear"' + tga + ' data-k="lv-qclear' + kx + '">Clear</button></div>';
    }
    return h;
  }
  function roomBox(r) {
    var b = r.bots[0], tg = roomTg(b), m = M(tg), fx = L.fxFor(tg).filter(function (f) { return !f.fadeOut; });
    var silent = !m.music && !m.amb && !fx.length, st = roomStatus(b);
    var actions = '<button class="btn s icon lv-mute" data-act="lvbotmute" data-id="' + b.id + '" data-k="lv-mute-' + b.id + '" aria-pressed="' + !!b.muted + '" title="' + (b.muted ? 'Unmute ' : 'Mute ') + esc(r.name) + '" aria-label="Mute ' + esc(r.name) + '">' + L.icon(b.muted ? 'close' : 'horn', 's') + '</button>' +
      '<input type="range" class="lv-vol" min="0" max="100" step="5" value="' + b.volume + '" data-input="lvvol" data-id="' + b.id + '" data-k="lv-vol-' + b.id + '" aria-label="Volume in ' + esc(r.name) + '" aria-valuetext="' + b.volume + ' percent" title="Volume ' + b.volume + '%">' +
      '<button class="btn s icon" data-act="lvroommenu" data-id="' + b.id + '" data-k="lv-room-' + b.id + '" aria-haspopup="menu" aria-expanded="false" title="More for ' + esc(r.name) + '" aria-label="More for ' + esc(r.name) + '">' + L.icon('more', 's') + '</button>';
    var body = silent ? '<p class="lv-room-hint">' + (rooms().length > 1 ? 'To play here, choose “To: ' + esc(r.name) + '” in Scene music, Off script or Pads.' : 'What you play next comes here.') + '</p>' :
      laneBlock('music', tg) + laneBlock('amb', tg) +
      '<div class="lv-line lv-fx"><span class="lv-line-l"><span class="lane-dot fx"></span>Effects</span><span class="ellipsis grow">' +
        (fx.length ? '<b>' + fx.length + ' sounding</b>: ' + esc(fx.map(function (f) { return f.label; }).join(', ')) : '<span class="muted">None</span>') + '</span>' +
        (fx.length ? '<button class="btn s icon" data-act="lvfxstop" data-tg="' + tg + '" data-k="lv-fxstop' + (tg === 'table' ? '' : '-' + tg) + '" title="Stop effects in ' + esc(r.name) + '" aria-label="Stop effects in ' + esc(r.name) + '">' + L.icon('stop', 's') + '</button>' : '') + '</div>';
    var mm = m.music && L.track(m.music.id);
    return L.pane({ id: 'lv-room-' + b.id, title: 'On air: ' + r.name, icon: 'broadcast', kind: 'onair', size: 'auto', flush: true, noMax: true, cls: 'lv-room' + (st.text !== 'Playing' ? ' is-silent' : ''), status: st, actions: actions,
      body: '<div class="lv-onair">' + body + '</div>', summary: collapsed('lv-room-' + b.id) && mm ? esc(L.title(mm)) : '' });
  }
  function onAir() {
    var rs = rooms(), idle = L.bots().filter(function (b) { return b.status === 'idle'; });
    var h = rs.length ? rs.map(roomBox).join('') : L.pane({ id: 'lv-room-none', title: 'On air: no room yet', icon: 'broadcast', kind: 'onair', size: 'auto', flush: true, noMax: true, status: { text: 'Silent', tone: 'idle' },
      body: '<div class="lv-onair">' + laneBlock('music', 'table') + laneBlock('amb', 'table') + '</div>' });
    return h + (idle.length ? '<div class="lv-addroom"><button class="btn s ghost" data-act="lvaddroom" data-k="lv-addroom" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add a room</button></div>' : '');
  }

  /* ---------- Scenes ---------- */
  function scenes(compact) {
    var s = sess(), lv = live(), now = S.notStarted ? -1 : lv.scene, nx = lv.standby, n = s.scenes[nx];
    var short = compact && !S.allScenes && s.scenes.length > 2, u = S.undo;
    var body = '<div class="lv-sc-top"><button class="btn primary lv-nextsc" data-act="lvnext" data-k="lv-nextsc"' + (n ? '' : ' aria-disabled="true"') + (n && S.keys1 ? ' aria-keyshortcuts="Space"' : '') + ' title="' + (n ? 'Start ' + esc(n.name) + (S.keys1 ? ' (Space)' : '') + (rooms().length > 1 ? '. Scenes always play in ' + esc(rooms()[0].name) : '') : 'That was the last scene') + '">' +
      L.icon('next', 's') + '<span class="ellipsis">' + (n ? (S.notStarted ? 'Start: ' : 'Next scene: ') + esc(n.name) : 'No more scenes') + '</span>' + (n && S.keys1 ? '<span class="kbd" aria-hidden="true">Space</span>' : '') + '</button>' +
      (u ? '<div class="lv-undo" role="status"><span class="ellipsis grow">Started <b>' + esc(u.started) + '</b></span>' +
        '<button class="btn s" data-act="lvundo" data-k="lv-undo" aria-keyshortcuts="Control+Z" title="Go back to ' + esc(u.label) + ', with its music and ambience (Ctrl+Z)">' + L.icon('restart', 's') + '<span class="ellipsis">Undo</span></button>' +
        '<span class="lv-undo-bar" aria-hidden="true"><span data-undo-left style="width:' + undoLeft() + '%"></span></span></div>' : '') + '</div>' +
      '<ol class="lv-scenes">' + s.scenes.map(function (sc, i) {
        var isNow = i === now, isNext = i === nx;
        if (short && !isNow && !isNext) return '';
        var notes = isNow && sc.notes ? '<div class="lv-sc-notes' + (S.notesOpen ? ' open' : '') + '" id="lv-notes"><span class="lv-sc-notes-t">' + esc(sc.notes) + '</span>' +
          (sc.notes.length > 70 ? '<button class="lv-more" data-act="lvnotes" data-k="lv-notes" aria-expanded="' + S.notesOpen + '" aria-controls="lv-notes">' + (S.notesOpen ? 'Less' : 'More') + '</button>' : '') + '</div>' : '';
        return '<li class="lv-sc' + (isNow ? ' now' : '') + (isNext ? ' next' : '') + (i < now ? ' done' : '') + '"' + (isNow ? ' aria-current="step"' : '') + '>' +
          '<div class="lv-sc-1"><span class="num lv-sc-n" aria-hidden="true">' + (i + 1) + '</span>' +
            (isNow ? '<span class="badge lv-nowb">Now</span>' : isNext ? '<span class="badge lv-nextb">Next</span>' : '') +
            '<span class="lv-sc-name ellipsis" title="' + esc(sc.name + (sc.when ? '. Starts when: ' + sc.when : '')) + '">' + esc(sc.name) + '</span>' +
            '<button class="btn s icon lv-sc-go" data-act="lvstart" data-i="' + i + '" data-k="lv-start-' + i + '" title="' + (isNow ? 'Restart' : 'Start') + ' this scene" aria-label="' + (isNow ? 'Restart' : 'Start') + ' scene ' + (i + 1) + ': ' + esc(sc.name) + '">' + L.icon(isNow ? 'restart' : 'play', 's') + '</button></div>' +
          ((isNow || isNext) && sc.when ? '<div class="lv-sc-when ellipsis" title="Starts when: ' + esc(sc.when) + '"><span class="faint">Starts when</span> ' + esc(sc.when) + '</div>' : '') + notes + '</li>';
      }).join('') + '</ol>' +
      (compact && s.scenes.length > 2 ? '<button class="lv-more lv-allsc" data-act="lvallsc" data-k="lv-allsc" aria-expanded="' + !!S.allScenes + '">' + (S.allScenes ? 'Show only Now and Next' : 'Show all ' + s.scenes.length + ' scenes') + '</button>' : '');
    var cur = s.scenes[now];
    return L.pane({ id: 'lv-scenes', title: 'Scenes', icon: 'scroll', kind: 'scenes', size: 'auto', flush: true, noMax: true, body: body,
      status: S.notStarted ? { text: 'Ready', tone: 'on' } : { text: 'Scene ' + (now + 1) + ' of ' + s.scenes.length, tone: 'on' },
      summary: collapsed('lv-scenes') ? (cur ? 'Now: ' + esc(cur.name) : '') + (n ? (cur ? ' · ' : '') + 'Next: ' + esc(n.name) : '') : '' });
  }

  /* ---------- track rows (Scene music and Off script) ---------- */
  // o: { pl: playlist id the row plays from, prefer: moods to show first, seq: {cid, sid, scene, at} position in a scene's sequence, num: item number }
  function seqAttrs(q) { return q ? ' data-sc="' + q.scene + '" data-at="' + q.at + '"' : ''; }
  function profileKey(o) {
    if (o.seq) { var s0 = L.session(o.seq.cid, o.seq.sid), sc0 = s0 && s0.scenes[o.seq.scene]; if (sc0) return 'sc:' + o.seq.cid + ':' + o.seq.sid + ':' + sc0.id; }
    return o.pl ? 'pl:' + o.pl : '';
  }
  function trackRow(t, src, o) {
    o = o || {};
    var isAmb = t.kind === 'amb', isFx = t.kind === 'fx', here = seqHere(pb.music), qi = -1;
    // On air in any room (the scene list matches the exact place in the scene's sequence).
    var inRoom = rooms().some(function (r) { var m = r.mix; return (m.music && m.music.id === t.id) || (m.amb && m.amb.id === t.id); }) || (pb.music && pb.music.id === t.id) || (pb.amb && pb.amb.id === t.id);
    var onAirNow = o.seq ? !!(here && here.scene === o.seq.scene && here.at === o.seq.at) || (inRoom && !here) : inRoom || pb.fx.some(function (f) { return f.ref === 'track/' + t.id && !f.fadeOut; });
    var box = o.box || 'music', where = inWhere(box), len = playLen(t, profileKey(o));
    targetsOf(box).forEach(function (tg) { Q(tg).forEach(function (q, i) { if (q.id === t.id && qi < 0) qi = i; }); });
    // DAT-14: in a scene's list the track shows the scene's name for it; its own name is on hover and in its details.
    var sk = o.seq ? profileKey({ seq: o.seq }) : '', nm = L.nameIn(t, sk), ownNm = L.title(t);
    var pv = L.previewing(t.id), k = 'lv-' + src + '-' + t.id, open = S.sel === src + ':' + t.id, did = 'lv-d-' + src + '-' + t.id, pl = o.pl || '';
    var details = open ? '<div class="lv-trk-d" id="' + did + '">' +
      '<dl>' + (nm !== ownNm ? '<dt>Name in this scene</dt><dd>' + esc(nm) + '</dd>' : '') + '<dt>Your title</dt><dd>' + (t.title ? esc(t.title) : '<span class="faint">none yet</span>') + '</dd><dt>Title in the file</dt><dd>' + esc(t.metaTitle || '–') + '</dd>' +
      '<dt>File name</dt><dd>' + esc(t.file) + '</dd><dt>From</dt><dd>' + esc(t.artist + ', ' + t.album) + '</dd></dl>' +
      (L.profileLink ? '<div class="lv-trk-ap">' + L.profileLink(t.id, profileKey(o), true) + '<span class="hint">Audio profile' + (profileKey(o) ? (o.seq ? ' in this scene' : ' in this playlist') : '') + '</span></div>' : '') +
      '<div class="chips">' + D.tagGroups.map(function (g) { return (t.tags[g.id] || []).map(function (v) { return '<span class="chip lv-mood" title="' + esc(g.name) + '">' + esc(v) + '</span>'; }).join(''); }).join('') + (t.role ? '<span class="chip">' + esc(t.role) + '</span>' : '') + '</div></div>' : '';
    return '<li class="lv-trk' + (onAirNow ? ' on' : '') + (isAmb ? ' amb' : '') + (open ? ' open' : '') + (o.inner ? ' inner' : '') + '"><div class="lv-trk-r">' +
      (o.num ? '<span class="num lv-num" aria-hidden="true">' + o.num + '</span>' : '') +
      (onAirNow ? airBadge(t) : qi > -1 ? '<span class="badge lv-qb">Queued ' + (qi + 1) + '</span>' : '') +
      (isAmb || isFx ? '<span class="lane-dot ' + (isAmb ? 'amb' : 'fx') + '" title="' + L.kindName[t.kind] + '"></span><span class="sr-only">' + L.kindName[t.kind] + ':</span>' : '') +
      '<button class="lv-trk-t" data-act="lvsel" data-sel="' + src + ':' + t.id + '" data-k="' + k + '-t" aria-expanded="' + open + '"' + (open ? ' aria-controls="' + did + '"' : '') + ' title="' + esc(nm !== ownNm ? nm + ' (its own name: ' + ownNm + ')' : nm) + ' (click for details)"><span>' + esc(nm) + '</span></button>' +
      (onAirNow || open ? '<span class="chips lv-trk-chips">' + moodChips(t, o.prefer) + '</span>' + (isAmb || isFx ? '' : L.energy(t.energy)) : '') +
      '<span class="num lv-dur" title="' + (Math.round(len) !== Math.round(t.dur) ? 'Plays ' + L.fmt(len) + ' of the file\'s ' + L.fmt(t.dur) : 'Length ' + L.fmt(t.dur)) + '">' + L.fmt(len) + '</span>' +
      '<span class="lv-trk-acts">' +
        '<button class="closer lv-pvb" data-act="lvpv" data-id="' + t.id + '" data-k="' + k + '-v" aria-pressed="' + pv + '" title="' + (pv ? 'Stop the preview' : 'Preview in your headphones (players do not hear it)') + '" aria-label="Preview: ' + esc(nm) + '">' + L.icon('headphones') + '</button>' +
        (isAmb || isFx ? '<span class="lv-gap" aria-hidden="true"></span>' : '<button class="closer" data-act="lvqueue" data-box="' + box + '" data-id="' + t.id + '" data-pl="' + pl + '"' + seqAttrs(o.seq) + ' data-k="' + k + '-q" title="Play next' + where + ', after the current track" aria-label="Play next' + where + ': ' + esc(nm) + '">' + L.icon('queue') + '</button>') +
        '<button class="closer" data-act="lvplay" data-box="' + box + '" data-id="' + t.id + '" data-pl="' + pl + '"' + seqAttrs(o.seq) + ' data-k="' + k + '-p" title="Play on air' + where + (isFx ? ', over the music' : ', crossfading from what is playing') + '" aria-label="Play on air' + where + ': ' + esc(nm) + '">' + L.icon('broadcast') + '</button>' +
      '</span></div>' + details + '</li>';
  }

  /* ---------- Scene music ---------- */
  // The scene's own list, in order: track items as track rows, playlist items as rows with an expander (closed by default).
  function sceneList(sc) {
    var s = sess(), idx = s.scenes.indexOf(sc), items = L.sceneItems(sc), q = L.sceneSequence(sc), here = seqHere(pb.music);
    var cur = here && here.scene === idx && q[here.at] ? q[here.at].item : -1;
    function pos(at) { return { cid: live().cid, sid: live().sid, scene: idx, at: at }; }
    return '<ol class="lv-list lv-items" aria-label="' + esc(sc.name) + ': music in the order it plays">' + items.map(function (it, i) {
      var first = -1; q.forEach(function (x, j) { if (x.item === i && first < 0) first = j; });
      if (it.kind === 'track') return trackRow(it.obj, 'sc' + i, { seq: pos(first), num: i + 1 });
      var p = it.obj, ts = L.playlistTracks(p), xk = 'lv-' + sc.id + '-' + i, open = L.expanded(xk), on = cur === i, pv = L.previewing('pl:' + p.id);
      var at = on ? q[here.at] : null, k = 'lv-sc' + i + '-' + p.id;
      return '<li class="lv-pli' + (on ? ' on' : '') + '"><div class="lv-trk-r">' +
        '<span class="num lv-num" aria-hidden="true">' + (i + 1) + '</span>' + L.expanderButton(xk, p.name, open) +
        (on || rooms().some(function (r) { return r.mix.music && r.mix.music.playlistId === p.id; }) ? L.destTag('air', '') : '') + L.icon('playlist', 's lv-pli-i') +
        // Round 6: mid-game the track count matters, not how the playlist was made (that is hover text).
        '<span class="lv-pli-n"><b class="ellipsis" title="' + esc(p.name + ' · ' + (p.kind === 'dynamic' ? 'Dynamic' : 'Manual')) + '">' + esc(p.name) + '</b><span class="faint ellipsis">' + ts.length + ' tracks' +
          (at ? ' · playing ' + (ts.map(function (t) { return t.id; }).indexOf(at.trackId) + 1) + ' of ' + ts.length : '') + '</span></span>' +
        '<span class="lv-trk-acts">' +
          '<button class="closer lv-pvb" data-act="lvpvpl" data-id="' + p.id + '" data-k="' + k + '-v" aria-pressed="' + pv + '" title="' + (pv ? 'Stop the preview' : 'Preview in your headphones') + '" aria-label="Preview: ' + esc(p.name) + '">' + L.icon('headphones') + '</button>' +
          L.orderButton(p.id, L.sceneKeyOf(sc)) +
          '<button class="closer" data-act="lvplay" data-id="' + (q[first] ? q[first].trackId : ts[0] ? ts[0].id : '') + '" data-pl="' + p.id + '"' + seqAttrs(first > -1 ? pos(first) : null) + ' data-box="music" data-k="' + k + '-p" title="Play on air' + inWhere('music') + ', from its first track" aria-label="Play on air' + inWhere('music') + ': ' + esc(p.name) + '"' + (ts.length ? '' : ' disabled') + '>' + L.icon('broadcast') + '</button>' +
        '</span></div>' +
        (open ? '<ol class="lv-list lv-sub" aria-label="Tracks in ' + esc(p.name) + '">' + L.orderedTracks(p.id, L.sceneKeyOf(sc)).map(function (t) {
          var j = -1; q.forEach(function (x, n) { if (x.item === i && x.trackId === t.id && j < 0) j = n; });
          return trackRow(t, 'sc' + i, { pl: p.id, seq: pos(j), inner: true });
        }).join('') + '</ol>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function sceneMusic() {
    var g = plGroups(), sel = selectedPl(), sc = musicScene(), isScene = sel === 'scene', pl = !isScene && L.playlist(sel), tracks = pl ? L.orderedTracks(pl.id, placeOfPl(pl.id)) : [];
    var nItems = sc ? L.sceneItems(sc).length : 0, label = scene() ? 'This scene' : 'First scene';
    function grpBtn(key, name) {
      var ids = g[key], inGroup = ids.indexOf(sel) > -1, tr = g[key + 'Tracks'] || [];
      if (!ids.length && !tr.length) return '<span class="lv-pick-none faint">' + name + ': none</span>';
      return '<button class="btn s lv-pick-menu" data-act="lvplmenu" data-g="' + key + '" data-k="lv-plm-' + key + '" aria-haspopup="menu" aria-expanded="false" aria-pressed="' + inGroup + '" title="' + name + ' playlists: ' + esc(ids.map(plName).join(', ')) + '">' +
        '<span class="faint">' + name + ':</span><span class="ellipsis">' + (inGroup ? esc(plName(sel)) : ids.length ? ids.length + ' playlist' + (ids.length > 1 ? 's' : '') : tr.length + ' track' + (tr.length > 1 ? 's' : '')) + '</span>' + L.icon('chevdown', 's') + '</button>';
    }
    var picker = '<div class="lv-pick" role="group" aria-label="What to play from">' +
      '<button class="lv-tab" data-act="lvpl" data-id="scene" data-k="lv-pl-scene" aria-pressed="' + isScene + '"' + (nItems ? '' : ' disabled') + ' title="' + label + ': its tracks and playlists in order"><span class="ellipsis">' + label + (nItems ? ' (' + nItems + ')' : ': nothing yet') + '</span></button>' +
      '<span class="lv-pick-more">' + grpBtn('session', 'Session') + grpBtn('campaign', 'Campaign') + '</span></div>';
    // The box's one text button: play what it shows from the top, in the rooms ticked in Send to.
    var action = isScene && sc ? '<button class="btn s" data-act="lvsctop" data-k="lv-plall" title="Play ' + esc(sc.name) + ' from its first item, in order' + inWhere('music') + '">' + L.icon('broadcast', 's') + 'Play from the top</button>' :
      pl ? L.orderButton(pl.id, placeOfPl(pl.id)) + '<button class="btn s" data-act="lvplall" data-id="' + pl.id + '" data-k="lv-plall" title="Play ' + esc(pl.name) + ' from its first track' + inWhere('music') + '">' + L.icon('broadcast', 's') + 'Play from the top</button>' : '';
    var playing = rooms().some(function (r) { var c = r.mix.music; return c && (isScene ? c.seq && c.seq.cid === live().cid && c.seq.sid === live().sid && sess().scenes[c.seq.scene] === sc : c.playlistId === sel); });
    var list = isScene && sc ? sceneList(sc) : pl ? '<ol class="lv-list" aria-label="Tracks in ' + esc(pl.name) + '">' + tracks.map(function (t) { return trackRow(t, 'pl', { pl: pl.id }); }).join('') + '</ol>' :
      '<p class="empty">Nothing is assigned to this scene, session or campaign. Use Off script to find a track.</p>';
    return L.pane({ id: 'lv-music', title: 'Scene music', icon: 'music', kind: 'music', size: 'auto', flush: true, noMax: true, actions: toChip('music') + action, body: picker + list,
      status: playing ? { text: 'On air', tone: 'live' } : null,
      summary: collapsed('lv-music') ? (isScene && sc ? esc(sc.name) + ', in order' : pl ? esc(pl.name) : 'Nothing to play') + (S.queue.length ? ' · ' + S.queue.length + ' queued' : '') : '' });
  }

  /* ---------- Off script ---------- */
  var moodOrder = null;
  function moodsByUse() {
    if (moodOrder) return moodOrder;
    var n = {}; D.tracks.forEach(function (t) { (t.tags.mood || []).forEach(function (m) { n[m] = (n[m] || 0) + 1; }); });
    moodOrder = D.tagValues.mood.slice().sort(function (a, b) { return (n[b] || 0) - (n[a] || 0); });
    return moodOrder;
  }
  function hasTag(t, tag) { return (t.tags[tag.g] || []).indexOf(tag.v) > -1; }
  function tagOn(g, v) { return S.tags.some(function (x) { return x.g === g && x.v === v; }); }
  function search() {
    var words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    var base = D.tracks.filter(function (t) {
      if (S.lane === 'fx' ? !L.isFx(t) : S.lane !== 'all' && t.kind !== S.lane) return false;
      if (!words.length) return true;
      var hay = [t.title, t.metaTitle, t.file, t.artist, t.album, t.role].concat(t.tags.mood, t.tags.motif, t.tags.scene).join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    });
    if (!S.tags.length) return { list: base, any: false };
    var all = base.filter(function (t) { return S.tags.every(function (x) { return hasTag(t, x); }); });
    if (all.length || S.tags.length < 2) return { list: all, any: false };
    var some = base.filter(function (t) { return S.tags.some(function (x) { return hasTag(t, x); }); });
    some.sort(function (a, b) { return S.tags.filter(function (x) { return hasTag(b, x); }).length - S.tags.filter(function (x) { return hasTag(a, x); }).length; });
    return { list: some, any: true };
  }
  function tagChip(g, v) { var gn = D.tagGroups.filter(function (x) { return x.id === g; })[0]; return '<button class="chip lv-mood" data-act="lvtag" data-g="' + g + '" data-v="' + esc(v) + '" data-k="lv-tag-' + g + '-' + esc(v) + '" aria-pressed="' + tagOn(g, v) + '" title="' + esc(gn ? gn.name : '') + '">' + (tagOn(g, v) ? L.icon('check', 's') : '') + esc(v) + '</button>'; }
  function offScript() {
    var active = S.q || S.tags.length, r = active ? search() : null, moods = moodsByUse();
    var shown = S.moreTags ? moods : moods.slice(0, 8);
    var extra = S.tags.filter(function (x) { return x.g !== 'mood' ? !S.moreTags : shown.indexOf(x.v) < 0; });
    var chips = '<div class="chips lv-tagrow" role="group" aria-label="Moods">' + shown.map(function (v) { return tagChip('mood', v); }).join('') +
      extra.map(function (x) { return tagChip(x.g, x.v); }).join('') +
      '<button class="lv-more" data-act="lvmoretags" data-k="lv-moretags" aria-expanded="' + S.moreTags + '">' + (S.moreTags ? 'Fewer tags' : 'All tags') + '</button>' +
      (S.tags.length ? '<button class="closer lv-tagx" data-act="lvtagclear" data-k="lv-tagx" title="Clear selected tags" aria-label="Clear selected tags">' + L.icon('close') + '</button>' : '') + '</div>';
    if (S.moreTags) {
      chips += D.tagGroups.filter(function (g) { return g.id !== 'mood'; }).map(function (g) {
        return '<div class="lv-taggrp"><span class="lv-taggrp-l">' + esc(g.name) + '</span><div class="chips" role="group" aria-label="' + esc(g.name) + '">' + D.tagValues[g.id].map(function (v) { return tagChip(g.id, v); }).join('') + '</div></div>';
      }).join('');
    }
    var prefer = S.tags.filter(function (x) { return x.g === 'mood'; }).map(function (x) { return x.v; });
    var res = !active ? '' :
      '<div class="lv-off-count" role="status"><span' + (r.list.length && !r.any ? ' class="sr-only"' : '') + '>' + (r.list.length ? r.list.length + ' found' : 'Nothing found') + (r.any ? ': none has all these tags, so tracks with some of them' : '') + '</span>' +
        '<button class="lv-more" data-act="lvclear" data-k="lv-clear">Clear</button></div>' +
      (r.list.length ? '<ol class="lv-list" aria-label="Off script results">' + r.list.map(function (t) { return trackRow(t, 'off', { prefer: prefer, box: 'off' }); }).join('') + '</ol>' : '');
    var body = '<div class="lv-off-f"><div class="search grow">' + L.icon('search') + '<input class="input" type="search" data-input="lvq" data-k="lv-q" value="' + esc(S.q) + '" placeholder="Name or mood" aria-label="Off script: search the whole library"' + (S.keys1 ? ' aria-keyshortcuts="/"><span class="kbd" aria-hidden="true">/</span>' : '>') + '</div>' +
      '<div class="seg s" role="group" aria-label="Show">' + [['all', 'All'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']].map(function (x) {
        return '<button data-act="lvlane" data-v="' + x[0] + '" data-k="lv-lane-' + x[0] + '" aria-pressed="' + (S.lane === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' + chips + res;
    return L.pane({ id: 'lv-off', title: 'Off script', icon: 'search', kind: 'search', flush: true, size: 'auto', noMax: true, body: body, actions: toChip('off'),
      status: active ? { text: r.list.length + ' found', tone: 'idle' } : null,
      summary: collapsed('lv-off') ? (active ? esc([S.q].concat(S.tags.map(function (x) { return x.v; })).filter(Boolean).join(', ')) + '' : '') : '' });
  }

  /* ---------- Pads ---------- */
  function pads() {
    var b = L.board(boardId()), sc = musicScene(), sb = boardsOf(sc), inScene = sb.indexOf(b.id) > -1, keys = keysOf(b);
    var grid = '<div class="lv-grid" style="grid-template-columns:repeat(' + b.cols + ',minmax(0,1fr))" role="group" aria-label="Pads on ' + esc(b.name) + '">' + L.boardPads(b).map(function (p, i) {
      if (!p) return '<span class="lv-pad-empty" aria-hidden="true"></span>';
      var on = L.padActive(b.id, p.id), tog = p.mode === 'toggle', ref = b.id + '/' + p.id, many = rooms().length > 1;
      // Which rooms a sounding pad is in, when there is more than one room.
      var inRooms = many ? rooms().filter(function (r) { return L.fxFor(tgOf(r.bots[0].id)).some(function (f) { return f.ref === ref && !f.fadeOut; }); }).map(function (r) { return r.name; }) : [];
      var onHere = targetsOf('pads').some(function (tg) { return L.fxFor(tg).some(function (f) { return f.ref === ref && !f.fadeOut; }); });
      return '<button class="lv-pad' + (on ? ' on' : '') + '" data-bid="' + b.id + '" data-pid="' + p.id + '" data-mode="' + p.mode + '"' + (p.mode === 'hold' ? '' : ' data-act="lvpad"') +
        ' data-k="lv-pad-' + b.id + '-' + p.id + '" style="--pad:' + (L.colors[p.color] || L.colors.bone) + '"' + (tog ? ' aria-pressed="' + (many ? onHere : on) + '"' : '') +
        ' title="' + esc(p.label) + (p.key ? ' (key ' + p.key.toUpperCase() + ')' : '') + ': ' + L.modeName[p.mode] + inWhere('pads') + (inRooms.length ? '. Sounding in ' + esc(inRooms.join(' and ')) : '') + '"' + (p.key && S.keys1 ? ' aria-keyshortcuts="' + esc(p.key) + '"' : '') + '>' +
        L.icon(p.icon, 's') + '<span class="lv-pad-l ellipsis">' + esc(p.label) + '</span>' +
        (inRooms.length ? '<span class="lv-pad-rm" aria-hidden="true">' + inRooms.map(function (n) { return esc(n.charAt(0)); }).join('') + '</span><span class="sr-only">, sounding in ' + esc(inRooms.join(' and ')) + '</span>' : '') +
        (tog && on && !many ? '<span class="lv-pad-on">On</span>' : p.mode === 'oneshot' || (tog && on) ? '' : '<span class="lv-pad-mode" title="' + L.modeName[p.mode] + '">' + L.icon(L.modeIcon[p.mode], 's') + '<span class="sr-only">' + L.modeName[p.mode] + '</span></span>') +
        (p.key && S.keys1 ? '<span class="kbd" aria-hidden="true">' + esc(p.key.toUpperCase()) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    // The scene's boards as a small switch (the first shows when the scene starts); everything else in a menu.
    var body = '<div class="lv-pads-bar">' + (sb.length ? '<div class="seg s lv-bseg" role="group" aria-label="This scene\'s pad boards">' + sb.map(function (id) {
        return '<button data-act="lvboard" data-id="' + id + '" data-k="lv-bd-' + id + '" aria-pressed="' + (id === b.id) + '" title="' + esc(L.board(id).name) + '"><span class="ellipsis">' + esc(L.board(id).name) + '</span></button>';
      }).join('') + '</div>' : '') +
      '<button class="btn s lv-boardbtn" data-act="lvboardmenu" data-k="lv-boardbtn" aria-haspopup="menu" aria-expanded="false" aria-pressed="' + !inScene + '" title="Session, campaign and other pad boards">' + L.icon('grid', 's') + '<span class="ellipsis">' + (inScene ? 'Other boards' : esc(b.name)) + '</span>' + L.icon('chevdown', 's') + '</button>' +
      '<span class="hint ellipsis grow">' + (S.keys1 ? '' : 'Single-key shortcuts are off') + '</span>' +
      '<a class="btn s ghost" href="#/board/' + b.id + '" data-k="lv-editboard">' + L.icon('edit', 's') + 'Edit board</a></div>' + grid;
    var n = sounding().length;
    return L.pane({ id: 'lv-pads', title: 'Pads', icon: 'grid', kind: 'fx', size: 'auto', collapsed: true, flush: true, noMax: true, body: body, actions: toChip('pads'),
      status: n ? { text: n + ' sounding', tone: 'live' } : null,
      summary: collapsed('lv-pads', true) ? '<span title="' + esc(S.keys1 && keys.length ? 'Pad keys ' + keys.join(' ') + ' work while this box is folded' : '') + '">' + esc(b.name) + '</span>' : '' });
  }

  /* ---------- layout ---------- */
  var PANES = { onair: onAir, scenes: scenes, music: sceneMusic, off: offScript, pads: pads };
  // The page scrolls as a whole; boxes take the height they need. Scene music sits above the On air boxes.
  var LAYOUT = { 1: [['music', 'onair', 'off', 'scenes', 'pads']], 2: [['scenes', 'off'], ['music', 'onair', 'pads']], 3: [['scenes'], ['music', 'onair'], ['off', 'pads']] };
  function layoutFor() { var app = document.getElementById('app'), w = app ? app.getBoundingClientRect().width : 960; return w >= 1200 ? 3 : w >= 820 ? 2 : 1; }

  L.view('live', {
    nav: 'live',
    notesTitle: 'Live: what changed since round 1',
    notes: [
      '<b>Round 5:</b> the On air boxes show what each room hears, so the <b>Now playing bar</b> at the bottom shows only your <b>preview</b> here (tagged <b>Only you</b>). On every other screen it also has a row for each room that is playing, tagged <b>On air</b> with the room\'s name. Scenes show their <b>names for tracks</b> (start Aftermath), each playlist has its <b>play order</b> for this scene, session or campaign, and the session\'s and campaign\'s <b>single tracks</b> are in their menus.',
      '<b>Rooms.</b> Every bot in a Discord voice channel is a room with its own On air box. When there is more than one room, Scene music, Off script and Pads each show <b>To: Table ▾</b> in their header: what you play from that box goes to that room (or all rooms); scenes always play in the first room.',
      '<b>Scene music is at the top</b>, above the On air boxes. Open a playlist with its arrow and the box grows; the whole page scrolls.',
      '<b>Less on screen.</b> Each box has one job, a coloured edge for its kind and at most one status in its header. Red “On air” marks what players hear, everywhere. Rows show one line and the length that will actually play; tags and energy appear on the playing or opened row.',
      'Row buttons are always Preview, Play next, Play on air, and their names say which room. <b>Add a room</b> under the On air boxes brings another bot in; a room’s ⋯ menu moves it, copies what another room plays, or makes it leave. A sounding pad shows the initial of its room.',
      'Keys: <span class="kbd">Space</span> next scene (Undo or <span class="kbd">Ctrl+Z</span> within 8 s), <span class="kbd">Shift+Esc</span> fade all, <span class="kbd">/</span> search, pad keys (they go where the Pads box sends). The <b>Keys</b> button switches the single-key ones off.'
    ],
    render: function () {
      boot();
      var lv = live(), key = lv.cid + '/' + lv.sid + '/' + (S.notStarted ? '-' : lv.scene);
      if (key !== S.sceneKey) { S.sceneKey = key; S.plSel = null; S.board = null; S.notesOpen = false; }
      var mode = layoutFor();
      return '<div class="lv">' + top() + '<div class="lv-cols c' + mode + '" data-scroll="lv-page">' + LAYOUT[mode].map(function (ids) {
        return '<div class="col">' + ids.map(function (id) { return PANES[id](mode === 1); }).join('') + '</div>';
      }).join('') + '</div></div>';
    }
  });

  /* ---------- menus ---------- */
  L.acts.lvsessmenu = function (el) {
    L.menu(el, D.campaigns.map(function (c) {
      return '<div class="group">' + esc(c.name) + '</div>' + c.sessions.map(function (s) {
        var cur = c.id === live().cid && s.id === live().sid;
        return '<button role="menuitemradio" aria-checked="' + cur + '" data-act="lvsess" data-cid="' + c.id + '" data-sid="' + s.id + '">' + (cur ? L.icon('check', 's') : '<span style="width:14px"></span>') +
          '<span class="grow ellipsis">Session ' + s.n + ': ' + esc(s.name) + '</span><span class="faint">' + (s.status === 'next' ? 'next' : s.status === 'played' ? 'played' : 'draft') + '</span></button>';
      }).join('');
    }).join(''), 'Load a session');
  };
  L.acts.lvsess = function (el) {
    var lv = live(); if (lv.cid === el.dataset.cid && lv.sid === el.dataset.sid) return;
    L.liveStandby(el.dataset.cid, el.dataset.sid);
    var s = sess(); L.toast('Loaded ' + camp().name + ', session ' + s.n + '. Press Space to start ' + s.scenes[0].name);
    L.render(); var b = document.querySelector('[data-k="lv-sess"]'); if (b) b.focus();
  };
  L.acts.lvdc = function (el) { var b = L.bot(el.dataset.id); if (b) L.menu(el, botsMenu(b.id), b.name); };
  L.acts.lvdcall = function (el) { L.menu(el, botsMenu(''), 'Discord bots'); };
  L.acts.lvbotjoin = function (el) { var b = L.bot(el.dataset.id), c = L.channel(el.dataset.g, el.dataset.c); L.botJoin(el.dataset.id, el.dataset.g, el.dataset.c); if (b && c) L.toast(b.name + ' is joining ' + c.name); };
  L.acts.lvbotmute = function (el) { L.botMute(el.dataset.id); };
  L.acts.lvbotleave = function (el) { L.botLeave(el.dataset.id); };
  L.acts.lvkeys = function () { S.keysOpen = !S.keysOpen; L.render(); focusK(S.keysOpen ? 'lv-keys1' : 'lv-keys'); };
  function closeKeys(refocus) { if (!S.keysOpen) return false; S.keysOpen = false; L.render(); if (refocus) focusK('lv-keys'); return true; }
  document.addEventListener('pointerdown', function (e) { if (S.keysOpen && !(e.target.closest && e.target.closest('.lv-keyswrap'))) closeKeys(false); });
  L.inputs.lvkeys1 = function (el) { S.keys1 = el.checked; saveKeys1(); L.render(); focusK('lv-keys1'); L.say('Single-key shortcuts ' + (S.keys1 ? 'on' : 'off')); };
  L.acts.lvplmenu = function (el) {
    var g = plGroups()[el.dataset.g], sel = selectedPl();
    var tr = plGroups()[el.dataset.g + 'Tracks'] || [];
    L.menu(el, '<div class="group">' + (el.dataset.g === 'session' ? 'This session' : 'This campaign') + '</div>' + g.map(function (id) {
      var p = L.playlist(id);
      return '<button role="menuitemradio" aria-checked="' + (id === sel) + '" data-act="lvpl" data-id="' + id + '">' + (id === sel ? L.icon('check', 's') : '<span style="width:14px"></span>') + '<span class="grow ellipsis">' + esc(p.name) + '</span><span class="faint">' + L.playlistTracks(p).length + '</span></button>';
    }).join('') + (tr.length ? '<div class="group">Single tracks</div>' + tr.map(function (id) {
      var t = L.track(id); return '<button role="menuitem" data-act="lvplay" data-box="music" data-id="' + id + '" data-pl="">' + L.icon('broadcast', 's') + '<span class="grow ellipsis">Play on air: ' + esc(L.title(t)) + '</span><span class="faint">' + L.fmt(t.dur) + '</span></button>';
    }).join('') : ''), 'Playlists');
  };
  L.acts.lvboardmenu = function (el) {
    var sc = musicScene(), s = sess(), c = camp(), seen = {}, cur = boardId(), h = '';
    function grp(label, ids) {
      ids = ids.filter(function (id) { return id && L.board(id) && !seen[id]; }); if (!ids.length) return;
      h += '<div class="group">' + label + '</div>' + ids.map(function (id) { seen[id] = 1; var b = L.board(id); return '<button role="menuitemradio" aria-checked="' + (id === cur) + '" data-act="lvboard" data-id="' + id + '">' + (id === cur ? L.icon('check', 's') : '<span style="width:14px"></span>') + '<span class="grow ellipsis">' + esc(b.name) + '</span><span class="faint">' + b.cols + ' × ' + b.rows + '</span></button>'; }).join('');
    }
    grp('This scene', boardsOf(sc)); grp('This session', s.boards); grp('This campaign', c.boards); grp('Other boards', D.boards.map(function (b) { return b.id; }));
    L.menu(el, h, 'Pad boards');
  };
  L.acts.lvboard = function (el) { S.board = el.dataset.id; L.say('Pad board: ' + L.board(S.board).name); L.render(); };

  /* ---------- actions ---------- */
  function nextScene() {
    var lv = live(), s = sess(), i = lv.standby, a = document.activeElement;
    var keep = !a || a === document.body || !document.getElementById('view').contains(a) || a.dataset.k === 'lv-nextsc';
    if (!s.scenes[i]) { L.toast('That was the last scene'); return; }
    changeScene(i);
    if (keep) focusK('lv-nextsc');
  }
  L.acts.lvnext = nextScene;
  L.acts.lvstart = function (el) { changeScene(+el.dataset.i); };
  L.acts.lvundo = function () { undo(); };
  L.acts.lvallsc = function () { S.allScenes = !S.allScenes; L.render(); };
  L.acts.lvsel = function (el) { S.sel = S.sel === el.dataset.sel ? null : el.dataset.sel; L.render(); };
  L.acts.lvnotes = function () { S.notesOpen = !S.notesOpen; L.render(); };
  L.acts.lvfade = function () { L.fadeAll(3); };
  L.acts.lvstop = function () { S.resume = null; L.stopAll(); };
  function tgArg(el) { return tgOf(el.dataset.tg); }
  // The rooms new sound goes to (Send to). Empty means nothing is ticked: core shows the warning.
  L.acts.lvprevt = function (el) { L.prev(el.dataset.lane, tgArg(el)); };
  L.acts.lvnextt = function (el) { L.next(el.dataset.lane, tgArg(el)); };
  L.acts.lvpause = function (el) { var ln = el.dataset.lane, tg = tgArg(el), c = M(tg)[ln]; L.pauseLane(ln, tg); L.say((ln === 'music' ? 'Music ' : 'Ambience ') + (c && c.paused ? 'paused' : 'playing')); };
  L.acts.lvfadeout = function (el) { L.stopLane(el.dataset.lane, 3, tgArg(el)); L.say((el.dataset.lane === 'music' ? 'Music' : 'Ambience') + ' fading out'); };
  L.acts.lvunq = function (el) { var q = Q(tgOf(el.dataset.tg)).splice(+el.dataset.i, 1)[0]; L.say('Removed from the queue: ' + L.title(L.track(q.id))); L.render(); };
  L.acts.lvqclear = function (el) { var q = Q(tgOf(el.dataset.tg)); q.length = 0; L.say('Queue cleared'); L.render(); };
  L.acts.lvto = function (el) {
    var box = el.dataset.box, cur = boxTo(box);
    L.menu(el, '<div class="group">' + ({ music: 'Scene music', off: 'Off script', pads: 'Pads' })[box] + ' plays in</div>' + rooms().map(function (r) {
      var id = r.bots[0].id; return '<button role="menuitemradio" aria-checked="' + (cur === id) + '" data-act="lvtoset" data-box="' + box + '" data-v="' + id + '">' + (cur === id ? L.icon('check', 's') : '<span style="width:14px"></span>') + esc(r.name) + '</button>';
    }).join('') + '<button role="menuitemradio" aria-checked="' + (cur === 'all') + '" data-act="lvtoset" data-box="' + box + '" data-v="all">' + (cur === 'all' ? L.icon('check', 's') : '<span style="width:14px"></span>') + 'All rooms</button>', 'Where ' + box + ' plays');
  };
  L.acts.lvtoset = function (el) { S.to[el.dataset.box] = el.dataset.v; L.say(({ music: 'Scene music', off: 'Off script', pads: 'Pads' })[el.dataset.box] + ' now plays in ' + toName(el.dataset.box)); L.render(); };
  // Rooms: volume, mute, ⋯ menu (move, copy, leave), add.
  L.inputs.lvvol = function (el, ev) {
    var b = L.bot(el.dataset.id); if (!b) return;
    if (ev && ev.type === 'input') { b.volume = +el.value; el.setAttribute('aria-valuetext', el.value + ' percent'); el.title = 'Volume ' + el.value + '%'; return; }
    L.botVolume(b.id, el.value);
  };
  function channelItems(b, act) {
    return D.discord.servers.map(function (g) {
      return '<div class="group">' + esc(g.name) + '</div>' + g.channels.map(function (c) {
        var here = b.status !== 'idle' && b.server === g.id && b.channel === c.id, taken = L.bots().some(function (x) { return x !== b && x.status !== 'idle' && x.server === g.id && x.channel === c.id; });
        return '<button role="menuitemradio" aria-checked="' + here + '" data-act="' + act + '" data-id="' + b.id + '" data-g="' + g.id + '" data-c="' + c.id + '"' + (here || taken ? ' disabled' : '') + '>' +
          (here ? L.icon('check', 's') : '<span style="width:14px"></span>') + '<span class="grow ellipsis">' + esc(c.name) + '</span><span class="faint">' + (taken ? 'a room already' : c.members.length + (c.members.length === 1 ? ' person' : ' people')) + '</span></button>';
      }).join('');
    }).join('');
  }
  L.acts.lvroommenu = function (el) {
    var b = L.bot(el.dataset.id); if (!b) return; var name = L.outputName(b);
    var others = rooms().filter(function (r) { return r.bots[0] !== b && (r.mix.music || r.mix.amb); });
    L.menu(el, '<div class="group">Move ' + esc(name) + ' to another channel</div>' + channelItems(b, 'lvbotjoin') + '<div class="sep"></div>' +
      others.map(function (r) { return '<button role="menuitem" data-act="lvcopyroom" data-from="' + r.bots[0].id + '" data-to="' + b.id + '">' + L.icon('loop', 's') + 'Copy what ' + esc(r.name) + ' is playing</button>'; }).join('') +
      '<button role="menuitem" data-act="lvbotleave" data-id="' + b.id + '">' + L.icon('close', 's') + 'Leave (' + esc(name) + ' goes silent)</button>' +
      '<a role="menuitem" class="item" href="#/outputs">' + L.icon('users', 's') + 'All outputs…</a>', 'Room ' + name);
  };
  L.acts.lvcopyroom = function (el) {
    var from = tgOf(el.dataset.from), to = tgOf(el.dataset.to), src = M(from), say = L.say; L.say = function () {};
    try { ['music', 'amb'].forEach(function (ln) { var c = src[ln]; if (c) { L.play(c.id, { lane: ln, playlistId: c.playlistId, fade: 2, seq: c.seq, target: to }); var d = M(to)[ln]; if (d) d.pos = c.pos; } else L.stopLane(ln, 2, to); }); } finally { L.say = say; }
    L.say(roomName(to) + ' now plays what ' + roomName(from) + ' plays'); L.render();
  };
  L.acts.lvaddroom = function (el) {
    var idle = L.bots().filter(function (b) { return b.status === 'idle'; });
    L.menu(el, idle.map(function (b) { return '<div class="group">' + esc(b.name) + ' joins…</div>' + channelItems(b, 'lvaddjoin'); }).join('') || '<div class="item muted">Every bot is in a room.</div>', 'Add a room');
  };
  L.acts.lvaddjoin = function (el) {
    var b = L.bot(el.dataset.id), c = L.channel(el.dataset.g, el.dataset.c); if (!b || !c) return;
    L.botJoin(b.id, el.dataset.g, el.dataset.c);
    L.toast(c.name + ' is joining. It starts silent: tick it in Send to to send sound there.');
  };
  L.acts.lvfxstop = function (el) { var tg = el && el.dataset.tg; if (!tg) { L.stopFx(); return; } L.fxFor(tg).forEach(function (f) { f.fadeOut = .8; }); L.changed(); L.say('Effects stopped in ' + roomName(tg)); };
  L.acts.lvpvstop = function () { L.stopPreview(); L.say('Preview stopped'); };
  L.acts.lvpl = function (el) { S.plSel = el.dataset.id; L.say(S.plSel === 'scene' ? 'Showing the scene\'s music in order' : 'Showing playlist ' + plName(S.plSel)); L.render(); };
  L.acts.lvplall = function (el) { var t = L.orderedTracks(el.dataset.id, placeOfPl(el.dataset.id))[0]; if (t) eachTo('music', function (tg) { playMusic(t.id, el.dataset.id, undefined, undefined, tg); }); };
  function seqOf(el) { return el.dataset.at != null && +el.dataset.at > -1 ? { cid: live().cid, sid: live().sid, scene: +el.dataset.sc, at: +el.dataset.at } : null; }
  L.acts.lvplay = function (el) {
    var t = L.track(el.dataset.id); if (!t) return;
    eachTo(el.dataset.box || 'music', function (tg) {
      if (t.kind === 'fx') L.play(t.id, { target: tg }); // layers over the music, like a pad
      else if (t.kind === 'amb') L.play(t.id, { lane: 'amb', playlistId: el.dataset.pl || '', fade: 3, target: tg });
      else playMusic(t.id, el.dataset.pl, undefined, seqOf(el), tg);
    });
  };
  L.acts.lvsctop = function () { var sc = musicScene(), q = sc ? L.sceneSequence(sc) : []; if (q[0]) eachTo('music', function (tg) { playMusic(q[0].trackId, q[0].playlistId, undefined, { cid: live().cid, sid: live().sid, scene: sess().scenes.indexOf(sc), at: 0 }, tg); }); };
  L.acts.lvpvpl = function (el) { L.previewPlaylist(el.dataset.id); };
  L.acts.lvtagclear = function () { S.tags = []; L.render(); focusK('lv-q'); L.say('Selected tags cleared'); };
  L.acts.lvqueue = function (el) {
    var t = L.track(el.dataset.id); if (!t) return;
    eachTo(el.dataset.box || 'music', function (tg) {
      var q = Q(tg);
      if (!M(tg).music) { playMusic(t.id, el.dataset.pl, undefined, seqOf(el), tg); return; }
      q.push({ id: t.id, pl: el.dataset.pl || '', seq: seqOf(el) });
    });
    L.say('Plays next: ' + L.title(t)); L.render();
  };
  L.acts.lvpv = function (el) { L.preview(el.dataset.id); };
  L.inputs.lvq = function (el) { S.q = el.value; L.render(); };
  L.acts.lvtag = function (el) {
    var g = el.dataset.g, v = el.dataset.v;
    if (tagOn(g, v)) S.tags = S.tags.filter(function (x) { return !(x.g === g && x.v === v); }); else S.tags.push({ g: g, v: v });
    L.render(); var r = search(); L.say(r.list.length + ' found');
  };
  L.acts.lvmoretags = function () { S.moreTags = !S.moreTags; L.render(); };
  L.acts.lvlane = function (el) { S.lane = el.dataset.v; L.render(); };
  L.acts.lvclear = function () { S.q = ''; S.tags = []; L.render(); var q = document.querySelector('[data-k="lv-q"]'); if (q) q.focus(); L.say('Search cleared'); };
  // Pads (clicks and keys) go to the Pads box's room. With "All rooms", a toggle pad that sounds anywhere stops everywhere.
  function firePads(bid, pid, phase) {
    var b = L.board(bid), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === pid; })[0]; if (!p) return;
    var tgs = targetsOf('pads'), ref = bid + '/' + pid;
    function onIn(tg) { return L.fxFor(tg).some(function (f) { return f.ref === ref && !f.fadeOut; }); }
    if (p.mode === 'toggle' && tgs.length > 1) { var any = tgs.some(onIn); tgs.forEach(function (tg) { if (!any || onIn(tg)) L.firePad(bid, pid, phase, tg); }); return; }
    tgs.forEach(function (tg) { L.firePad(bid, pid, phase, tg); });
  }
  L.acts.lvpad = function (el) { firePads(el.dataset.bid, el.dataset.pid); };

  /* ---------- keys and hold-to-play ---------- */
  function onLive() { return L.current().name === 'live'; }
  function padFor(key) { var b = L.board(boardId()); var p = L.boardPads(b).filter(function (x) { return x && x.key && x.key.toLowerCase() === key; })[0]; return p ? { b: b.id, p: p } : null; }
  function focusSearch() {
    if (collapsed('lv-off')) L.state.panes['lv-off'] = 'o';
    if (L.state.maxed && L.state.maxed !== 'lv-off') L.state.maxed = null;
    L.save(); L.render(); var q = document.querySelector('[data-k="lv-q"]'); if (q) { q.focus(); q.select(); }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab') S.keyNav = true; }, true);
  document.addEventListener('pointerdown', function () { S.keyNav = false; }, true);
  L.onKey(function (e) {
    if (!onLive() || e.altKey) return false;
    var t = e.target, a = document.activeElement, typing = L.typing(t);
    // Shift+Esc fades everything, even from a text box: two keys, so it is never pressed by accident.
    if (e.key === 'Escape' && e.shiftKey) { closeKeys(false); L.fadeAll(3); return true; }
    if (e.key === 'Escape' && S.keysOpen) { closeKeys(true); return true; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) return undo();
    if (e.ctrlKey || e.metaKey) return false;
    if (typing) {
      if (e.key === 'Escape' && t.dataset.k === 'lv-q') { if (t.value) { S.q = ''; L.render(); } else t.blur(); return true; }
      return false;
    }
    // Plain Esc only clears the Off script search (core closes menus first).
    if (e.key === 'Escape') { if (S.q || S.tags.length) { S.q = ''; S.tags = []; L.render(); L.say('Search cleared'); return true; } return false; }
    var onControl = a && a !== document.body && a.matches('button, a, [role="menuitem"]');
    if (e.key === ' ' || e.key === 'Enter') {
      // A hold pad reached with the keyboard: play while the key is down.
      if (a && a.matches('.lv-pad[data-mode="hold"]') && (e.key === 'Enter' || S.keyNav)) { if (!e.repeat) { S.keyHeld[e.key] = { b: a.dataset.bid, p: a.dataset.pid }; firePads(a.dataset.bid, a.dataset.pid, 'down'); } return true; }
      if (e.key === 'Enter' || !S.keys1) return false;
      if (onControl && S.keyNav) return false; // Space presses a button you tabbed to
      if (!e.repeat) nextScene(); return true;
    }
    if (!S.keys1) return false;
    if (e.key === '/') { focusSearch(); return true; }
    if (e.key.length === 1) {
      var hit = padFor(e.key.toLowerCase()); if (!hit) return false;
      if (!e.repeat) { S.keyHeld[e.key.toLowerCase()] = { b: hit.b, p: hit.p.id }; firePads(hit.b, hit.p.id, 'down'); }
      return true;
    }
    return false;
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key.length === 1 && e.key !== ' ' ? e.key.toLowerCase() : e.key, h = S.keyHeld[k];
    if (!h) return; delete S.keyHeld[k];
    var b = L.board(h.b), p = b && b.slots.filter(function (x) { return x && x.id === h.p; })[0];
    if (p && p.mode === 'hold') { e.preventDefault(); L.firePad(h.b, h.p, 'up'); }
  });
  document.addEventListener('pointerdown', function (e) {
    var p = e.target.closest && e.target.closest('.lv-pad[data-mode="hold"]'); if (!p || e.button > 0) return;
    e.preventDefault(); S.holding = { b: p.dataset.bid, p: p.dataset.pid }; firePads(S.holding.b, S.holding.p, 'down');
    var again = document.querySelector('[data-k="lv-pad-' + S.holding.b + '-' + S.holding.p + '"]'); if (again) again.focus({ preventScroll: true });
  });
  function release() { if (S.holding) { var h = S.holding; S.holding = null; L.firePad(h.b, h.p, 'up'); } }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  window.addEventListener('blur', function () {
    release();
    Object.keys(S.keyHeld).forEach(function (k) { var h = S.keyHeld[k], b = L.board(h.b), p = b && b.slots.filter(function (x) { return x && x.id === h.p; })[0]; delete S.keyHeld[k]; if (p && p.mode === 'hold') L.firePad(h.b, h.p, 'up'); });
  });
})();
