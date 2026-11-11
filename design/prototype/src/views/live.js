/* Live view (#/live): the screen Nik runs a game from.
   Round 6, part 3 (Nik, 6 Nov 12:24: "In live I need several boxes …"): seven boxes, each with one job, a plain
   name and a place that never moves during play:
     On air · Scenes · Current scene · Session playlists · Session pads · Campaign playlists · Campaign pads.
   Round 6, part 6 (Nik, 6 Nov 17:14): On air is at the top, the whole width, under the top strip, and always in view;
   Scenes and Current scene take the height of their contents. Find (the old Off script box) is a search field in the
   top strip that finds tracks and playlists; its results open under it.
   Columns come from the width of #app: one below 820 px, two up to 1200 px, three above (LAYOUT).
   Each room keeps its own running list for the evening (Play next, Add to queue, Up next) and a Repeat for what plays
   there now (never saved). */
(function () {
  var esc = L.esc, D = L.data, pb = L.pb;
  var S = {
    booted: false, notStarted: false, sceneKey: '', q: '', tags: [], lane: 'all', moreTags: false, findOpen: false,
    board: null, bdss: null, bdcp: null, notesOpen: false, keyNav: false, holding: null, keyHeld: {},
    keys1: true, keysOpen: false, playedOpen: {}, lastNextKey: 0, undo: null, undo2: null, rmOpen: {}, sel: null, allScenes: false, scOpen: {}, rm: {}, upOpen: {}, to: {}, lastM: {}
  };
  // Single-key shortcuts (Space, / and pad keys) can be switched off (WCAG 2.1.4); remembered in this browser only.
  try { S.keys1 = localStorage.getItem('lyre-r2-live-keys1') !== 'off'; } catch (e) { S.keys1 = true; }
  function saveKeys1() { try { localStorage.setItem('lyre-r2-live-keys1', S.keys1 ? 'on' : 'off'); } catch (e) { /* storage unavailable: lasts for this visit */ } }

  /* ---------- rooms and their mixes ---------- */
  // A room is 'table' (L.pb, the first room) or the id of a bot with its own mix (core's L.mix(target)).
  var coreNext = L.next, corePrev = L.prev, coreUpNext = L.upNext;
  function tgOf(target) { var b = target && target !== 'table' && L.bot(target); return b && b.status !== 'idle' && b.id !== L.bots()[0].id ? b.id : 'table'; }
  function M(tg) { return tg === 'table' ? pb : L.mix(tg); }

  /* ---------- each room's running list (Nik, 6 Nov 12:14) ----------
     A room plays a plan (a scene's music in order, a playlist, or one track) and keeps, for this evening only:
       pn    Play next: items that play right after the current track (the newest first)
       q     Add to queue: the bottom of the list, in the order added; with Repeat all they come round again
       skip  planned tracks taken out of Up next ('s:<cid>:<sid>:<scene>:<at>' in a scene, 'p:<playlist>:<track>')
     now is 'plan' while the plan plays, 'pn' or 'q' while an added item plays; ret is the plan position to carry on
     from. An item is { ids, at, pl, place, name }: a track has one id, a playlist all its tracks in that place's order.
     None of this is saved: it is gone when another session is loaded. */
  function RM(tg) { return S.rm[tg] || (S.rm[tg] = { pn: [], pnCur: null, q: [], qAt: -1, now: 'plan', ret: null, skip: {}, playing: '', aq: [] }); }
  /* Round 6, part 6: ambience has Play next and Add to queue too (Nik, 17:14: "I need all of them"). An ambience loops
     until it is changed, so what waits is kept apart from the music's list: aq, the room's ambience to come. Next on
     the room's ambience plays the first of it (Play next puts an ambience first, Add to queue at the end). It is shown
     at the bottom of Up next, marked with the ambience colour and read out as "Ambience next:". */
  function aqOf(tg) { var rm = RM(tg); return rm.aq || (rm.aq = []); }
  function nextAmb(tg) {
    var it = aqOf(tg).shift(); if (!it) return false;
    L.play(it.ids[0], { lane: 'amb', playlistId: it.pl || '', place: it.place || '', fade: 3, target: tg });
    return true;
  }
  function copySeq(q) { return q ? { cid: q.cid, sid: q.sid, scene: q.scene, at: q.at } : null; }
  function posOf(c) { return c ? { id: c.id, pl: c.playlistId || '', place: c.place || '', seq: copySeq(c.seq) } : null; }
  function seqList(q) { var s0 = L.session(q.cid, q.sid), sc0 = s0 && s0.scenes[q.scene]; return sc0 ? L.sceneSequence(sc0) : []; }
  function skKey(pos, x) { return pos.seq ? 's:' + pos.seq.cid + ':' + pos.seq.sid + ':' + pos.seq.scene + ':' + x : 'p:' + pos.pl + ':' + x; }
  // The planned tracks after a position, to the end of the plan. A track never plays twice in a row.
  function planAhead(pos, tg) {
    var rm = RM(tg), out = [];
    if (!pos) return out;
    if (pos.seq) {
      var q = seqList(pos.seq), last = pos.id;
      for (var at = pos.seq.at + 1; at < q.length; at++) {
        if (rm.skip[skKey(pos, at)] || q[at].trackId === last) continue;
        out.push({ id: q[at].trackId, pl: q[at].playlistId, place: '', seq: { cid: pos.seq.cid, sid: pos.seq.sid, scene: pos.seq.scene, at: at }, key: skKey(pos, at) });
        last = q[at].trackId;
      }
      return out;
    }
    if (pos.pl) {
      var list = L.orderedTracks(pos.pl, pos.place), i = list.map(function (t) { return t.id; }).indexOf(pos.id);
      list.slice(i + 1).forEach(function (t) { if (!rm.skip[skKey(pos, t.id)]) out.push({ id: t.id, pl: pos.pl, place: pos.place, seq: null, key: skKey(pos, t.id) }); });
    }
    return out;
  }
  function planTop(pos, tg) {
    if (!pos) return null; var rm = RM(tg);
    if (pos.seq) {
      var q = seqList(pos.seq);
      for (var at = 0; at < q.length; at++) if (!rm.skip[skKey(pos, at)]) return { id: q[at].trackId, pl: q[at].playlistId, place: '', seq: { cid: pos.seq.cid, sid: pos.seq.sid, scene: pos.seq.scene, at: at } };
      return null;
    }
    if (pos.pl) { var t = L.orderedTracks(pos.pl, pos.place).filter(function (x) { return !rm.skip[skKey(pos, x.id)]; })[0]; return t ? { id: t.id, pl: pos.pl, place: pos.place, seq: null } : null; }
    return { id: pos.id, pl: '', place: pos.place, seq: null };
  }
  // The room's Repeat for the list: chosen now (On air or the bar), else a playlist's own repeat where it plays from.
  function listRep(tg, pos) { var m = M(tg); if (m.rep) return m.rep; return pos && pos.pl && !pos.seq ? L.orderOf(pos.pl, pos.place).repeat : 'off'; }
  // At the end of the plan, with nothing added: a scene's music starts again from its top (as it always has); a
  // playlist does with Repeat all; otherwise the music stops.
  function planEnd(pos, tg) { if (!pos) return null; return pos.seq || listRep(tg, pos) === 'all' ? planTop(pos, tg) : null; }
  function itemEntry(it) { return { id: it.ids[it.at], pl: '', place: it.place || '', seq: null, item: it }; }
  // What a room plays next, with the bookkeeping. cur: the track that is ending (or skipped with Next).
  function pickNext(cur, tg) {
    var rm = RM(tg);
    // Something else started the music (a scene, Play on air): the plan is what plays now.
    if (rm.now !== 'plan' && (!cur || cur.id !== rm.playing)) { rm.now = 'plan'; rm.ret = null; rm.pnCur = null; rm.qAt = -1; }
    // 1. Play next, right after the current track (the rest of a Play next playlist first).
    if (rm.pnCur && rm.pnCur.at < rm.pnCur.ids.length - 1) { rm.pnCur.at++; return itemEntry(rm.pnCur); }
    rm.pnCur = null;
    if (rm.pn.length) {
      if (rm.now === 'plan') rm.ret = posOf(cur); else if (rm.now === 'q') rm.ret = { q: true };
      rm.now = 'pn'; rm.pnCur = rm.pn.shift(); rm.pnCur.at = 0; return itemEntry(rm.pnCur);
    }
    // 2. After Play next, back to where the list was.
    var pos = rm.now === 'plan' ? posOf(cur) : null;
    if (rm.now === 'pn') { var r = rm.ret; rm.ret = null; if (r && r.q) { rm.now = 'q'; rm.ret = rm.qRet; return nextAdded(rm, tg); } rm.now = 'plan'; pos = r; }
    if (rm.now === 'q') return nextAdded(rm, tg);
    // 3. The plan's next track; at its bottom, what was added, then round again (or stop).
    var ahead = planAhead(pos, tg); if (ahead.length) return ahead[0];
    if (rm.q.length) { rm.ret = rm.qRet = pos; rm.now = 'q'; rm.qAt = -1; return nextAdded(rm, tg); }
    return listRep(tg, pos) === 'all' ? planTop(pos, tg) : planEnd(pos, tg);
  }
  function nextAdded(rm, tg) {
    var it = rm.q[rm.qAt], keep = listRep(tg, rm.qRet) === 'all';
    if (it && it.at < it.ids.length - 1) { it.at++; return itemEntry(it); }
    if (it) { it.at = 0; if (!keep) { rm.q.splice(rm.qAt, 1); rm.qAt--; } }
    rm.qAt++;
    if (rm.qAt < rm.q.length) { rm.q[rm.qAt].at = 0; return itemEntry(rm.q[rm.qAt]); }
    var pos = rm.qRet; rm.now = 'plan'; rm.ret = rm.qRet = null; rm.qAt = -1;
    return keep ? planTop(pos, tg) : planEnd(pos, tg);
  }
  function startEntry(e, tg) {
    if (!e) return false; var rm = RM(tg);
    if (S.undo2 && S.undo2.items && e.item && S.undo2.items.indexOf(e.item) > -1) S.undo2 = null;   // nothing left to take back
    // What plays is marked before core draws the screen (L.play renders), so Up next is right at once.
    rm.playing = e.id;
    // Round 7 part 2 (DAT-3, PLY-8): an added single track can start from a marker (item.from, seconds).
    var from = e.item && e.item.from != null && e.item.ids.length === 1 ? e.item.from : null;
    L.play(e.id, { lane: 'music', playlistId: e.pl || '', place: e.seq ? '' : (e.place || (e.pl ? placeOfPl(e.pl) : '')), fade: 3, seq: e.seq || null, target: tg, r7from: from });
    // An added playlist names itself under the track ("Added: Wistful with some warmth"); a single added track is its
    // own title already.
    var c = M(tg).music; if (c && e.item && e.item.ids.length > 1) { c.added = e.item.name; L.render(); }
    return true;
  }
  function advance(cur, tg) { return startEntry(pickNext(cur, tg), tg); }
  // Up next, top to bottom: Play next items, the planned tracks still to come, then what was added to the queue.
  function upcoming(tg) {
    var rm = RM(tg), c = M(tg).music, out = []; if (!c) return out;
    var now = rm.now !== 'plan' && c.id !== rm.playing ? 'plan' : rm.now, inQ = now === 'q' || (now === 'pn' && rm.ret && rm.ret.q);
    if (now === 'pn' && rm.pnCur && rm.pnCur.at < rm.pnCur.ids.length - 1) out.push({ kind: 'pncur', it: rm.pnCur });
    rm.pn.forEach(function (it, i) { out.push({ kind: 'pn', it: it, i: i }); });
    var pos = now === 'plan' ? posOf(c) : now === 'pn' && rm.ret && !rm.ret.q ? rm.ret : null;
    planAhead(pos, tg).forEach(function (e) { out.push({ kind: 'plan', e: e }); });
    rm.q.forEach(function (it, i) {
      if (inQ && i < rm.qAt) return;
      if (inQ && i === rm.qAt) { if (it.at < it.ids.length - 1) out.push({ kind: 'qcur', it: it, i: i }); return; }
      out.push({ kind: 'q', it: it, i: i });
    });
    return out;
  }
  L.next = function (ln, target) { var tg = tgOf(target); if (ln === 'music' && advance(M(tg).music, tg)) return; if (ln === 'amb' && nextAmb(tg)) return; coreNext(ln, target); };
  L.prev = function (ln, target) {
    var tg = tgOf(target), c = M(tg).music, rm = RM(tg);
    if (ln === 'music' && c && rm.now !== 'plan' && c.id === rm.playing && rm.ret && !rm.ret.q) { var r = rm.ret; rm.now = 'plan'; rm.ret = null; rm.pnCur = null; startEntry(r, tg); return; }
    if (ln === 'music' && c && c.seq) { var q = seqList(c.seq), at = (c.seq.at - 1 + q.length) % q.length; startEntry({ id: q[at].trackId, pl: q[at].playlistId, seq: { cid: c.seq.cid, sid: c.seq.sid, scene: c.seq.scene, at: at } }, tg); return; }
    corePrev(ln, target);
  };
  L.upNext = function (ln, target) {
    var tg = tgOf(target);
    if ((ln || 'music') === 'music') { var u = upcoming(tg)[0]; if (u) return L.track(u.e ? u.e.id : u.it.ids[u.kind.slice(-3) === 'cur' ? u.it.at + 1 : 0]); }
    return coreUpNext(ln, target);
  };
  // Core asks before it stops a playlist at its end, or loops it: the room's list may go on (added items, Repeat).
  L.carriesOn = function (target) { var rm = RM(tgOf(target)); return rm.q.length > 0 || rm.pn.length > 0 || rm.now !== 'plan'; };

  // Undo countdowns, and a track with no playlist that stops at its end in core: play what the room has next.
  setInterval(function () {
    [['undo', 'lv-undo'], ['undo2', 'lv-undo2']].forEach(function (u) {
      var x = S[u[0]]; if (!x) return; var a = document.activeElement, on = a && a.dataset && a.dataset.k === u[1];
      // The countdown waits while the pointer or focus is on the strip.
      if (document.querySelector('.' + u[1] + ':hover') || on) x.until = Math.max(x.until, Date.now() + 1500);
      if (Date.now() >= x.until) { S[u[0]] = null; L.render(); if (on) focusK(x.focus || 'lv-nextsc'); }
      else document.querySelectorAll('[data-' + u[0] + '-left]').forEach(function (el) { el.style.width = Math.max(0, Math.min(100, (x.until - Date.now()) / UNDO_MS * 100)) + '%'; });
    });
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
  function boardsOf(ids) { return (ids || []).filter(function (id) { return L.board(id); }); }
  function sceneBoards(sc) { return sc ? boardsOf(L.sceneBoards(sc)) : []; }
  // The board shown in Current scene: its pad keys are the live keys.
  function keysBoard() { var bs = sceneBoards(scene()); return bs.length ? L.board(bs.indexOf(S.board) > -1 ? S.board : bs[0]) : null; }
  // PLY-13: a session or campaign playlist plays in its order for that place ('ss:…' or 'cp:…').
  function placeOfPl(pl) {
    var lv = live(), s = L.session(lv.cid, lv.sid), c = L.campaign(lv.cid);
    if (!pl) return ''; if (s && s.playlists.indexOf(pl) > -1) return 'ss:' + lv.cid + ':' + lv.sid; if (c && c.playlists.indexOf(pl) > -1) return 'cp:' + lv.cid; return '';
  }
  function seqHere(c) { var lv = live(); return c && c.seq && c.seq.cid === lv.cid && c.seq.sid === lv.sid ? c.seq : null; }
  function seqItem(c) { var q = c && c.seq, list = q ? seqList(q) : [], s0 = q && L.session(q.cid, q.sid); return list[q ? q.at : -1] ? { item: list[q.at].item, n: L.sceneItems(s0.scenes[q.scene]).length } : null; }
  function ambName(id) { var p = L.playlist(id), t = !p && L.track(id); return p ? p.name : t ? L.title(t) : ''; }
  function sounding() { return pb.fx.filter(function (f) { return !f.fadeOut; }); }
  function moodChips(t, prefer) {
    var m = L.tagsOn(t, 'mood');
    if (prefer && prefer.length) m.sort(function (a, b) { return (prefer.indexOf(b) > -1) - (prefer.indexOf(a) > -1); });
    return m.slice(0, 1).map(function (v) { return '<span class="chip lv-mood" title="Mood">' + esc(v) + '</span>'; }).join('');
  }
  function focusK(k) { var el = document.querySelector('[data-k="' + k + '"]'); if (el) el.focus({ preventScroll: true }); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function quiet(fn) { var say = L.say; L.say = function () {}; try { fn(); } finally { L.say = say; } }

  /* ---------- Undo: scene changes, and (round 6 part 2) the queue, Up next and Kick, 8 s each ---------- */
  var UNDO_MS = 8000;
  function laneCopy(c) { return c ? { id: c.id, playlistId: c.playlistId, place: c.place, pos: c.pos, paused: !!c.paused, seq: copySeq(c.seq), added: c.added } : null; }
  function changeScene(idx) {
    var lv = live(), s = sess(); if (!s.scenes[idx]) return;
    var prevName = S.notStarted ? 'before the first scene' : (s.scenes[lv.scene] ? s.scenes[lv.scene].name : 'the previous scene');
    var tgs = ['table'].concat(Object.keys(pb.own || {}).filter(function (id) { return tgOf(id) === id; }));
    var snap = { cid: lv.cid, sid: lv.sid, scene: lv.scene, standby: lv.standby, notStarted: S.notStarted, rm: clone(S.rm),
      rooms: tgs.map(function (tg) { return { tg: tg, music: laneCopy(M(tg).music), amb: laneCopy(M(tg).amb), rep: M(tg).rep || null }; }), at: Date.now() };
    S.notStarted = false; S.undo2 = null;
    S.undo = { snap: snap, label: prevName, started: s.scenes[idx].name, until: Date.now() + UNDO_MS, focus: 'lv-nextsc' }; S.board = null;
    // A new scene is a new plan in the first room, and (Nik, 6 Nov 13:55) it clears what was added to every room's
    // list: a new scene is a change of mood. The scene's Undo brings the lists back (snap.rm).
    Object.keys(S.rm).forEach(function (tg) { var r = S.rm[tg]; r.pn = []; r.q = []; r.aq = []; r.pnCur = null; r.qAt = -1; if (r.now !== 'plan') { r.now = 'plan'; r.ret = null; } });
    var first = tgOf(L.firstRoom()), rm = RM(first); rm.now = 'plan'; rm.ret = null; rm.pnCur = null; rm.qAt = -1; M(first).rep = null;
    var sceneUndo = S.undo;
    L.startScene(lv.cid, lv.sid, idx);
    // Round 7 part 2: a scene's own steps may add to Up next; the scene's Undo (which takes those back too) stays.
    S.undo = sceneUndo; S.undo2 = null;
    rm.playing = M(first).music ? M(first).music.id : '';
    L.say('Started ' + s.scenes[idx].name + '. Undo is available for 8 seconds, or press Ctrl+Z.');
  }
  function restoreLane(ln, c, elapsed, tg) {
    if (!c) { L.stopLane(ln, 1.5, tg); return; }
    L.play(c.id, { lane: ln, playlistId: c.playlistId, place: c.place, fade: 1.5, seq: c.seq, target: tg });
    var m = M(tg); if (m[ln]) { m[ln].pos = Math.min(m[ln].dur - 1, c.pos + (c.paused ? 0 : elapsed)); m[ln].paused = c.paused; if (c.added) m[ln].added = c.added; }
  }
  /* Must 1 of the round 6 review: Ctrl+Z (and an Undo strip) takes back only the most recent Live action. Anything
     that changes what a room plays or who hears it (pause, next, previous, fade, a pad, Repeat, mute, volume, moving or
     kicking a bot, Play on air, Fade all, Stop all) ends the Undo strips that were showing, so Ctrl+Z never reaches
     past it to an older scene change. A new Undo replaces the one before. */
  function touched() { if (S.undo || S.undo2) { S.undo = null; S.undo2 = null; } }
  L.liveTouched = touched;
  function softUndo(text, restore, where, focus, items) { S.undo = null; S.undo2 = { text: text, restore: restore, where: where, focus: focus || '', at: Date.now(), until: Date.now() + UNDO_MS, items: items || null }; }
  function undoStrip(where) {
    var u = S.undo2; if (!u || u.where !== where) return '';
    return '<div class="lv-undo lv-undo2" role="group" aria-label="Undo"><span class="ellipsis grow">' + esc(u.text) + '</span>' +
      '<button class="btn s" data-act="lvundo2" data-k="lv-undo2" aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)">' + L.icon('undo', 's') + '<span class="ellipsis">Undo</span></button>' +
      '<span class="lv-undo-bar" aria-hidden="true"><span data-undo2-left style="width:100%"></span></span></div>';
  }
  function undo2() { var u = S.undo2; if (!u) return false; S.undo2 = null; u.restore(); L.render(); focusK(u.focus || 'lv-nextsc'); L.say('Undone: ' + u.text); return true; }
  function undo() {
    if (S.undo2) return undo2();
    var u = S.undo; if (!u) return false; S.undo = null;
    var s = u.snap, lv = live(), elapsed = (Date.now() - s.at) / 1000;
    lv.cid = s.cid; lv.sid = s.sid; lv.scene = s.scene; lv.standby = s.standby; S.notStarted = s.notStarted;
    quiet(function () { s.rooms.forEach(function (r) { if (r.tg === 'table' || tgOf(r.tg) === r.tg) { restoreLane('music', r.music, elapsed, r.tg); restoreLane('amb', r.amb, elapsed, r.tg); M(r.tg).rep = r.rep; } }); });
    S.rm = s.rm;
    Object.keys(S.rm).forEach(function (tg) { var c = M(tg).music; if (c) S.rm[tg].playing = S.rm[tg].now === 'plan' ? c.id : S.rm[tg].playing; });
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
  // The room most players are in: the one-click fix when nobody hears anything.
  // except: a bot whose own channel does not count, and channels where another bot plays are left out (Must 2).
  function busiestChannel(except) {
    var best = null;
    D.discord.servers.forEach(function (g) { g.channels.forEach(function (c) {
      if (except && L.bots().some(function (x) { return x !== except && x.status !== 'idle' && x.server === g.id && x.channel === c.id; })) return;
      if (except && except.server === g.id && except.channel === c.id) return;
      // With except (the fix for an empty room), a channel of one person (someone away) is not where the players are.
      if (c.members.length > (except ? 1 : 0) && (!best || c.members.length > best.c.members.length)) best = { g: g, c: c };
    }); });
    return best;
  }
  // Must 2: a room whose voice channel has nobody in it (bots apart): the players hear nothing there.
  function nobodyThere(b) { return !!b && b.status === 'connected' && !L.botListeners(b).length; }
  function people(n) { return n === 1 ? '1 person' : n + ' people'; }
  function keysOf(b) { return b ? L.boardPads(b).filter(function (p) { return p && p.key; }).map(function (p) { return String(p.key).toUpperCase(); }) : []; }

  /* ---------- standby: load a session with nothing started (Run, and Prep | Live) ---------- */
  // Core and the Campaigns view call this. The same session already running is left as it is; anything playing from
  // another session fades out over 3 s.
  L.liveStandby = function (cid, sid) {
    var lv = live(), s = L.session(cid, sid); if (!s) return;
    S.booted = true;
    if (lv.cid === cid && lv.sid === sid && !S.notStarted && (pb.music || pb.amb)) return;
    lv.cid = cid; lv.sid = sid; lv.scene = 0; lv.standby = 0; S.notStarted = true;
    S.rm = {}; S.undo = null; S.undo2 = null; S.board = S.bdss = S.bdcp = null; S.allScenes = false; S.sel = null; S.scOpen = {}; S.upOpen = {};
    quiet(function () {
      if (pb.music && !(pb.music.seq && pb.music.seq.cid === cid && pb.music.seq.sid === sid)) L.stopLane('music', 3);
      if (pb.amb) L.stopLane('amb', 3);
    });
    L.say('Loaded ' + L.campaign(cid).name + ', session ' + s.n + '. Nothing is playing yet; press Next scene to start ' + s.scenes[0].name + '.');
  };

  /* ---------- boot: a believable mid-session state (only when Live is the first page opened) ---------- */
  var firstLive = /^#\/live\b/.test(location.hash || '');
  function boot() {
    if (S.booted) return; S.booted = true;
    if (pb.music || pb.amb) return;
    // Reached from another page without Run: show the loaded session on standby rather than a half-started one.
    if (!firstLive) { var lv = live(); lv.scene = 0; lv.standby = 0; S.notStarted = true; return; }
    quiet(function () { L.startScene(live().cid, live().sid, 1); });
    if (pb.music) { pb.music.pos = 74; pb.music.vol = 1; pb.music.fadeIn = 0; RM('table').playing = pb.music.id; }
    if (pb.amb) { pb.amb.pos = 131; pb.amb.vol = 1; pb.amb.fadeIn = 0; }
    pb.musicOut = []; pb.ambOut = [];
  }

  /* ---------- top strip: Back and the trail, the session, Prep | Live, Find, Fade all, Stop all, Keys ---------- */
  function top() {
    var c = camp(), s = sess();
    // BUG-21: F2 on the session, or Rename session in its menu, renames it in place (only the name, not the number).
    // Round 6 part 6: Back and the trail come first (core.js: the campaign, a link to its page); the session is the
    // trail's last part, and its button chooses another one. The button still reads out the campaign's name, as it is
    // read on its own when it has focus.
    var sessBox = L.renaming('sess-' + s.id) ? '<span class="lv-sess lv-sess-edit">' + L.icon('crown', 's') + '<span class="sr-only">' + esc(c.name) + ' </span><span class="lv-sess-s">Session ' + s.n + ':</span>' +
        L.renameBox('sess-' + s.id, s.name, 'Name of Session ' + s.n, 'lv-sess-rename') + '</span>' :
      '<button class="lv-sess" data-act="lvsessmenu" data-k="lv-sess" data-f2="lvsessrename" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(c.name + ' Session ' + s.n + ': ' + s.name) + '" title="Loaded: ' + esc(c.name + ' › Session ' + s.n + ': ' + s.name) + '. Choose another session, or press F2 to rename it">' +
        L.icon('crown', 's') + '<span class="sr-only">' + esc(c.name) + ' </span><span class="lv-sess-s">Session ' + s.n + '<span class="lv-sess-nm sr-only">: ' + esc(s.name) + '</span></span>' + L.icon('chevdown', 's') + '</button>';
    return '<div class="lv-top"><h1 class="sr-only">Live</h1><!--lead-->' + sessBox + L.modeSwitch(c.id) + find() +
      '<button class="btn s" data-act="lvfade" data-k="lv-fade" title="Fade all: everything fades out over 3 seconds (Shift+Esc)" aria-keyshortcuts="Shift+Escape" aria-label="Fade all">' + L.icon('fade', 's') + '<span class="lv-btxt">Fade all</span></button>' +
      '<button class="btn s danger" data-act="lvstop" data-k="lv-stop" title="Stop everything at once" aria-label="Stop all">' + L.icon('stop', 's') + '<span class="lv-btxt">Stop all</span></button>' +
      '<span class="lv-keyswrap"><button class="btn s" data-act="lvkeys" data-k="lv-keys" aria-expanded="' + S.keysOpen + '" aria-controls="lv-keys-pop" title="Keyboard keys for the live screen">Keys' + L.icon(S.keysOpen ? 'chevup' : 'chevdown', 's') + '</button>' +
      (S.keysOpen ? keysPop() : '') + '</span></div>';
  }
  function keysPop() {
    var b = keysBoard(), pk = keysOf(b).join(' ') || 'none', off = S.keys1 ? '' : ' class="lv-off"';
    // Round 7 part 2: the keys as Settings › Keyboard shortcuts has them.
    function kf(id, def) { return esc(L.keyFor ? L.keyFor(id) : def); }
    function k(key, what, single) { return '<li' + (single ? off : '') + '><span class="kbd">' + key + '</span><span>' + what + '</span></li>'; }
    return '<div class="lv-pop" id="lv-keys-pop" role="group" aria-label="Keys on the live screen">' +
      '<label class="lv-switch"><input type="checkbox" role="switch" data-input="lvkeys1" data-k="lv-keys1"' + (S.keys1 ? ' checked' : '') + '><span class="lv-switch-t"><b>Single-key shortcuts</b><span class="hint">Space, / and the pad keys. Turn off if they get in the way.</span></span></label>' +
      '<ul class="lv-keylist">' + k(kf('nextScene', 'Space'), 'Start the next scene', singleKey('nextScene')) + k(kf('find', '/'), 'Find a track or playlist', singleKey('find')) + k(esc(pk), b ? 'Pads on ' + esc(b.name) + ' (Current scene)' : 'Pads of the current scene', 1) +
      k('Alt+1…7', 'Go to a box: On air, Scenes, Current scene, Session playlists, Session pads, Campaign playlists, Campaign pads') + k('F6', 'Next box (Shift+F6: the one before)') +
      k(kf('palette', 'Ctrl+K'), 'Find and play anything') + k(kf('fadeAll', 'Shift+Esc'), 'Fade all (3 s)') + k(kf('undo', 'Ctrl+Z'), 'Undo the last change (for 8 s)') + k('Esc', 'Close a menu or clear the search') + '</ul>' +
      '<p class="hint">' + (S.keys1 ? 'Keys do nothing while you type in a box.' : 'Single-key shortcuts are off. Shift+Esc and Ctrl+Z still work.') + '</p>' +
      // Should 12 of the round 6 review: what left the screen in round 6 is in Help (the rail's Help, or F1).
      '<button class="btn s ghost lv-keyshelp" data-act="lvhelp" data-k="lv-keyshelp" aria-keyshortcuts="F1">' + L.icon('help', 's') + 'Help</button></div>';
  }

  /* ---------- To: which room a box plays in (shown only with two rooms or more). Scenes always start in the first. ---------- */
  var BOXNAMES = { music: 'Current scene', off: 'Find', ss: 'Session playlists', cp: 'Campaign playlists', ssd: 'Session pads', cpd: 'Campaign pads' };
  function rooms() { return L.rooms ? L.rooms() : []; }
  function roomName(tg) { var b = tg === 'table' ? L.bots()[0] : L.bot(tg); return b ? L.outputName(b) : 'Table'; }
  function roomTg(b) { return b.id === L.bots()[0].id ? 'table' : b.id; }
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
    return '<button class="lv-to" data-act="lvto" data-box="' + box + '" data-k="lv-to-' + box + '" aria-haspopup="menu" aria-expanded="false" title="Where ' + esc(BOXNAMES[box]) + ' plays: ' + esc(n) + '" aria-label="To: ' + esc(n) + ', choose a room">' +
      '<span class="faint">To:</span><b class="ellipsis">' + esc(n.charAt(0).toUpperCase() + n.slice(1)) + '</b>' + L.icon('chevdown', 's') + '</button>';
  }
  function eachTo(box, fn) { targetsOf(box).forEach(fn); }
  function airBadge(t) {
    var rs = rooms(), where = rs.filter(function (r) { var m = r.mix; return (m.music && m.music.id === t.id) || (m.amb && m.amb.id === t.id); });
    // Should 10 of the round 6 review: the tag never says the players hear it when nobody can.
    if (!rs.length) return L.destTag('air', 'no room', false, 'Nobody hears it: no bot is in a voice channel');
    if (where.length && where.every(function (r) { return nobodyThere(r.bots[0]); })) return L.destTag('air', 'nobody there', false, 'Nobody hears it: nobody is in ' + where.map(function (r) { return r.name; }).join(' or '));
    return L.destTag('air', rs.length > 1 ? where.map(function (r) { return r.name; }).join(' and ') : '');
  }

  /* ---------- On air: one box along the bottom, a part per room ---------- */
  function roomStatus(tg, b) {
    var m = M(tg), on = (m.music && !m.music.paused) || (m.amb && !m.amb.paused) || L.fxFor(tg).some(function (f) { return !f.fadeOut; });
    if (!b) return on || m.music || m.amb ? { text: 'Nobody hears it', tone: 'warn' } : { text: 'Silent', tone: 'idle' };
    if (b.status === 'connecting') return { text: 'Joining', tone: 'warn' };
    if (nobodyThere(b)) return { text: 'Nobody there', tone: 'warn' };
    if (b.muted) return { text: 'Muted', tone: 'idle' };
    if (on) return { text: 'Playing', tone: 'live' };
    if (m.music && m.music.paused) return { text: 'Paused', tone: 'idle' };
    return { text: 'Silent', tone: 'idle' };
  }
  // Round 7 part 2 (DAT-3): the track's markers as ticks on its progress line (the mix-out one in the accent colour);
  // their names are hover text, the list itself is in the Audio profile.
  function markTicks(t, c, ln, tg) {
    var ctx = L.laneContext ? L.laneContext(ln, tg) : null, ms = t && L.profileOf ? L.profileOf(t, ctx).markers : [];
    return ms.filter(function (m) { return m.at > 0 && m.at < c.dur; }).map(function (m) {
      return '<i class="lv-mk' + (m.mix ? ' mix' : '') + '" style="left:' + (m.at / c.dur * 100) + '%" title="' + esc(m.label + ' ' + L.fmt(m.at)) + '" aria-hidden="true"></i>';
    }).join('');
  }
  function laneBlock(ln, tg, name) {
    var m = M(tg), c = m[ln], t = c && L.track(c.id), isM = ln === 'music', word = isM ? 'Music' : 'Ambience', at = tg === 'table' ? '' : '@' + tg, kx = tg === 'table' ? '' : '-' + tg, tga = ' data-tg="' + tg + '"';
    if (!c) return '';
    var shown = L.nameIn(t, L.lanePlace(c)), si = isM && seqItem(c), pos = si ? 'Item ' + (si.item + 1) + ' of ' + si.n : '';
    var h = '<div class="lv-lane ' + (isM ? 'lv-m' : 'lv-a') + '">' +
      '<div class="lv-lane-l"><span class="lv-lane-n"><span class="lane-dot ' + ln + '"></span>' + word + '</span>' + (c.paused ? '<span class="badge">Paused</span>' : '') + '</div>' +
      // The scene position and the end rule are hover text (and read out); the track list shows where it is.
      '<div class="lv-lane-m"><div class="lv-lane-t ellipsis" title="' + esc([shown !== L.title(t) ? 'Its own name: ' + L.title(t) : L.title(t), pos, isM ? endText(t, tg) : '', L.normHover(t, c.playlistId)].filter(Boolean).join(' · ')) + '">' + esc(shown) + (shown !== L.title(t) ? '<span class="sr-only"> (its own name: ' + esc(L.title(t)) + ')</span>' : '') + (pos ? '<span class="sr-only">, ' + pos + '</span>' : '') + '</div>' +
        '<div class="lv-lane-pr"><div class="progress lv-mkbar ' + ln + '"><span data-progress="' + ln + at + '"></span>' + markTicks(t, c, ln, tg) + '</div><span class="num lv-time" data-time="' + ln + at + '"></span></div>';
    if (isM) {
      // Where the music comes from, when it is a playlist or something added. What comes next is Up next, beside it.
      var vis = c.added ? 'Added: ' + c.added : c.playlistId ? plName(c.playlistId) : '';
      if (vis) h += '<div class="lv-lane-sub ellipsis" title="' + esc(vis) + '">' + esc(vis) + '</div>';
    }
    h += '</div><div class="lv-lane-c" role="group" aria-label="' + word + ' in ' + esc(name) + '">';
    if (isM) h += '<button class="btn s icon" data-act="lvprevt" data-lane="music"' + tga + ' data-k="lv-prev-m' + kx + '" title="Previous track" aria-label="Previous music track"' + (c.playlistId || c.seq || c.added || (RM(tg).now !== 'plan' && RM(tg).ret) ? '' : ' disabled') + '>' + L.icon('prev', 's') + '</button>';
    h += '<button class="btn s icon" data-act="lvpause" data-lane="' + ln + '"' + tga + ' data-k="lv-pause-' + ln + kx + '" title="' + (c.paused ? 'Resume' : 'Pause') + ' ' + word.toLowerCase() + '" aria-label="' + (c.paused ? 'Resume' : 'Pause') + ' ' + word.toLowerCase() + '">' + L.icon(c.paused ? 'play' : 'pause', 's') + '</button>' +
      '<button class="btn s icon" data-act="lvnextt" data-lane="' + ln + '"' + tga + ' data-k="lv-next-' + ln + kx + '" title="Next ' + (isM ? 'track' : 'ambience') + ' (crossfade)" aria-label="Next ' + word.toLowerCase() + ' track"' + (c.playlistId || c.seq || (isM && upcoming(tg).length) || (!isM && aqOf(tg).length) ? '' : ' disabled') + '>' + L.icon('next', 's') + '</button>' +
      // Round 6 part 3: Repeat here is the room's, for what plays now; never saved (core's L.repeatButton).
      (isM ? L.repeatButton('music', tg, 'lv-rep' + kx) : '') +
      '<button class="btn s icon" data-act="lvfadeout" data-lane="' + ln + '"' + tga + ' data-k="lv-fo-' + ln + kx + '" title="Fade ' + word.toLowerCase() + ' out over 3 seconds" aria-label="Fade ' + word.toLowerCase() + ' out">' + L.icon('fade', 's') + '</button></div></div>';
    return h;
  }
  /* Up next: the room's running list from the next track to the bottom, then the ambience waiting (aq). Folded, the
     planned part shows only its first track; what you added shows, each with ×. Round 6 part 6: On air is at the top, so
     it must stay short: past four lines Up next folds to one line, its first entry and "n more" (UPNEXT_LINES). */
  var UPNEXT_LINES = 4;
  function upNextBlock(tg) {
    var list = upcoming(tg), kx = tg === 'table' ? '' : '-' + tg, open = !!S.upOpen[tg], shownPlans = 1, tga = ' data-tg="' + tg + '"', plans = 0, hidden = 0, rows = [], amb = aqOf(tg);
    if (!list.length && !amb.length) return '';
    function entry(u, i, tail) {
      var label, more = '', added = u.kind !== 'plan', icon = u.kind === 'aq' ? '<span class="lane-dot amb" aria-hidden="true"></span>' : L.icon(u.kind.indexOf('pn') === 0 ? 'next' : 'queue', 's');
      if (u.e) { var t = L.track(u.e.id), key = u.e.seq ? L.sceneKeyOf(L.session(u.e.seq.cid, u.e.seq.sid).scenes[u.e.seq.scene]) : u.e.place; label = L.nameIn(t, key); }
      else { label = u.it.name; var left = u.it.ids.length - (u.kind.slice(-3) === 'cur' ? u.it.at + 1 : 0); if (u.it.ids.length > 1 && u.kind !== 'aq') more = left + ' left'; }
      return '<li class="lv-up-i' + (added ? ' added' : '') + (u.kind === 'aq' ? ' amb' : '') + '">' + (added ? icon + '<span class="sr-only">' + (u.kind === 'aq' ? 'Ambience next: ' : u.kind.indexOf('pn') === 0 ? 'Play next: ' : 'Added: ') + '</span>' : '') +
        '<span class="ellipsis grow" title="' + esc(label + (more ? ' (' + more + ')' : '')) + '">' + esc(label) + '</span>' + (more ? '<span class="faint num">' + more + '</span>' : '') +
        '<button class="x" data-act="lvupx" data-kind="' + u.kind + '"' + tga + ' data-i="' + (u.i != null ? u.i : '') + '" data-key="' + esc(u.e ? u.e.key : '') + '" data-k="lv-upx-' + i + kx + '" title="Take out of Up next (this evening only)" aria-label="Remove ' + esc(label) + ' from Up next">' + L.icon('close', 's') + '</button>' + (tail || '') + '</li>';
    }
    var all = list.concat(amb.map(function (it, i) { return { kind: 'aq', it: it, i: i }; }));
    all.forEach(function (u, i) {
      // The planned part shows its next track only: the rest is Current scene's list, in the same order, just below.
      if (u.kind === 'plan') { plans++; if (plans > shownPlans && !open) { hidden++; return; } }
      if (u.kind !== 'plan' && hidden && !open && !rows.gap) { rows.push(gapRow(hidden, tg)); rows.gap = true; }
      rows.push(entry(u, i));
    });
    if (hidden && !open && !rows.gap) rows.push(gapRow(hidden, tg));
    var one = !open && rows.length > UPNEXT_LINES;
    if (one) rows = [entry(all[0], 0, moreButton(all.length - 1, tg, false))];
    if (open && (plans > shownPlans || rows.length > UPNEXT_LINES)) rows.push('<li class="lv-up-gap"><button class="lv-more" data-act="lvupopen"' + tga + ' data-k="lv-upopen' + kx + '" aria-expanded="true">Show fewer</button></li>');
    var nAdded = RM(tg).q.length + RM(tg).pn.length + amb.length;
    return '<div class="lv-up"><span class="lv-q-l" id="lv-up-l' + kx + '">Up next</span><ol aria-labelledby="lv-up-l' + kx + '">' + rows.join('') + '</ol>' +
      (nAdded > 1 && !one ? '<button class="btn s ghost lv-qclear" data-act="lvqclear"' + tga + ' data-k="lv-qclear' + kx + '" title="Take out everything you added this evening">Clear added</button>' : '') + '</div>';
  }
  function moreButton(n, tg, open) { return '<button class="lv-more" data-act="lvupopen" data-tg="' + tg + '" data-k="lv-upopen' + (tg === 'table' ? '' : '-' + tg) + '" aria-expanded="' + open + '">' + n + ' more</button>'; }
  function gapRow(n, tg) { return '<li class="lv-up-gap">' + moreButton(n, tg, false) + '</li>'; }
  /* Must 4: in a window under 480 px high (1280×800 at 200 %), each room is one line (its name, status, what it plays
     and Pause) and opens on demand, so the boxes above keep the height. */
  function short() { return window.innerHeight < 480; }
  function roomLine(tg, b, name) {
    var m = M(tg), c = m.music || m.amb, st = roomStatus(tg, b), kx = tg === 'table' ? '' : '-' + tg, hid = 'lv-rm-h' + kx, ln = m.music ? 'music' : 'amb';
    return '<div class="lv-rm lv-rm-1' + (st.text === 'Playing' ? '' : ' is-silent') + '" role="group" aria-labelledby="' + hid + '" data-room="' + tg + '"><div class="lv-rm-h">' +
      '<button class="xp-btn" data-act="lvrmopen" data-tg="' + tg + '" data-k="lv-rmopen' + kx + '" aria-expanded="false" title="Show everything in ' + esc(name) + '" aria-label="Show everything in ' + esc(name) + '">' + L.icon('chevdown', 's') + '</button>' +
      '<h3 id="' + hid + '" class="lv-rm-n ellipsis">' + esc(name) + '</h3><span class="pane-status s-' + st.tone + '">' + esc(st.text) + '</span>' +
      '<span class="ellipsis grow lv-rm-t">' + (c ? esc(L.nameIn(L.track(c.id), L.lanePlace(c))) : '') + '</span>' +
      (c ? '<button class="btn s icon" data-act="lvpause" data-lane="' + ln + '" data-tg="' + tg + '" data-k="lv-pause-' + ln + kx + '" aria-label="' + (c.paused ? 'Resume ' : 'Pause ') + (ln === 'music' ? 'music' : 'ambience') + '" title="' + (c.paused ? 'Resume' : 'Pause') + '">' + L.icon(c.paused ? 'play' : 'pause', 's') + '</button>' : '') + '</div>' + undoStrip('room:' + tg) + '</div>';
  }
  L.acts.lvrmopen = function (el) { var tg = el.dataset.tg; S.rmOpen[tg] = !S.rmOpen[tg]; L.render(); focusK(el.dataset.k); };
  function roomPart(tg, b, name) {
    if (short() && !S.rmOpen[tg]) return roomLine(tg, b, name);
    var m = M(tg), fx = L.fxFor(tg).filter(function (f) { return !f.fadeOut; }), st = roomStatus(tg, b), kx = tg === 'table' ? '' : '-' + tg, hid = 'lv-rm-h' + kx;
    var ctl = b ? '<button class="btn s icon lv-mute" data-act="lvbotmute" data-id="' + b.id + '" data-k="lv-mute-' + b.id + '" aria-pressed="' + !!b.muted + '" title="' + (b.muted ? 'Unmute ' : 'Mute ') + esc(name) + '" aria-label="Mute ' + esc(name) + '">' + L.icon(b.muted ? 'mute' : 'horn', 's') + '</button>' +
      '<input type="range" class="lv-vol" min="0" max="100" step="5" value="' + b.volume + '" data-input="lvvol" data-id="' + b.id + '" data-k="lv-vol-' + b.id + '" aria-label="Volume in ' + esc(name) + '" aria-valuetext="' + b.volume + ' percent" title="Volume ' + b.volume + '%">' +
      // OUT-7: the bot that plays here, as a button that changes its channel (or the bot) on the page, and Kick.
      '<button class="btn s lv-botpick" data-act="lvroommenu" data-id="' + b.id + '" data-k="lv-room-' + b.id + '" aria-haspopup="menu" aria-expanded="false" title="' + esc(b.name) + ' plays in ' + esc(name) + ': change the channel or the bot" aria-label="' + esc(b.name) + ' in ' + esc(name) + ': change">' + L.icon('users', 's') + '<span class="ellipsis">' + esc(b.name) + '</span>' + L.icon('chevdown', 's') + '</button>' +
      '<button class="btn s lv-kick" data-act="lvkick" data-id="' + b.id + '" data-k="lv-kick-' + b.id + '" title="Kick ' + esc(b.name) + ' from ' + esc(name) + '" aria-label="Kick ' + esc(b.name) + ' from ' + esc(name) + '">' + L.icon('leave', 's') + '<span class="lv-kick-t">Kick</span></button>' : '';
    // BUG-19: with no bot in a voice channel what plays goes nowhere; the one-click fix is right here.
    var none = '';
    if (nobodyThere(b)) {
      // The same one-click fix as "No room": move this bot to where the players are.
      var to = busiestChannel(b);
      none = '<div class="lv-noroom" role="status">' + L.icon('warn', 's') + '<span class="grow">Players hear nothing</span>' +
        (to ? '<button class="btn s lv-fix" data-act="lvbotjoin" data-id="' + b.id + '" data-g="' + to.g.id + '" data-c="' + to.c.id + '" data-k="lv-fix-' + b.id + '" title="' + esc(b.name + ' moves to ' + to.g.name + ' › ' + to.c.name + ' (' + people(to.c.members.length) + ')') + '">Move to ' + esc(to.c.name) + '</button>' : '') + '</div>';
    }
    if (!b) {
      var bot = L.bots().filter(function (x) { return x.status !== 'connecting'; })[0] || L.bots()[0], best = busiestChannel(), joining = L.bots().some(function (x) { return x.status === 'connecting'; });
      none = '<div class="lv-noroom" role="status">' + L.icon('broadcast', 's') + '<span class="grow">' + (joining ? 'Joining…' : 'No bot is in a voice channel: players hear nothing') + '</span>' +
        (bot && best && !joining ? '<button class="btn s lv-fix" data-act="lvbotjoin" data-id="' + bot.id + '" data-g="' + best.g.id + '" data-c="' + best.c.id + '" data-k="lv-fix" title="' + esc(bot.name + ' joins ' + best.g.name + ' › ' + best.c.name + ' (' + best.c.members.length + ' there)') + '">Join ' + esc(best.c.name) + '</button>' : '') + '</div>';
    }
    var fxLine = fx.length ? '<div class="lv-line lv-fx"><span class="lv-line-l"><span class="lane-dot fx"></span>Effects</span><span class="ellipsis grow"><b>' + fx.length + ' sounding</b>: ' + esc(fx.map(function (f) { return f.label; }).join(', ')) + '</span>' +
      '<button class="btn s icon" data-act="lvfxstop" data-tg="' + tg + '" data-k="lv-fxstop' + kx + '" title="Stop effects in ' + esc(name) + '" aria-label="Stop effects in ' + esc(name) + '">' + L.icon('stop', 's') + '</button></div>' : '';
    var lanes = laneBlock('music', tg, name) + laneBlock('amb', tg, name) + fxLine, up = m.music || aqOf(tg).length ? upNextBlock(tg) : '';
    return '<div class="lv-rm' + (st.text === 'Playing' ? '' : ' is-silent') + '" role="group" aria-labelledby="' + hid + '" data-room="' + tg + '"' + (rooms().length > 1 ? ' title="To play in ' + esc(name) + ', choose To: ' + esc(name) + ' in a box"' : '') + '>' +
      '<div class="lv-rm-h">' + (short() ? '<button class="xp-btn" data-act="lvrmopen" data-tg="' + tg + '" data-k="lv-rmopen' + kx + '" aria-expanded="true" title="Show one line for ' + esc(name) + '" aria-label="Show everything in ' + esc(name) + '">' + L.icon('chevdown', 's') + '</button>' : '') + '<h3 id="' + hid + '" class="lv-rm-n ellipsis">' + esc(name) + '</h3><span class="pane-status s-' + st.tone + '">' + esc(st.text) + '</span><span class="grow"></span>' + playedButton(tg, name) + ctl + '</div>' + none + playedList(tg, name) +
      (lanes || up ? '<div class="lv-rm-b"><div class="lv-rm-lanes">' + lanes + '</div>' + (up ? '<div class="lv-rm-up">' + up + '</div>' : '') + '</div>' : '') + undoStrip('room:' + tg) + '</div>';
  }
  /* Round 7 part 2 (PLY-1): What played in each room, newest first, opened in the room itself (Live never covers
     its controls), each with Play again and Play next. The button shows on hover and keyboard focus in the room's
     header (it is rare mid-game); open, it stays. The record is core's (r7play.js, L.data.played). */
  var PLAYED_SHOWN = 6;
  function playedOf(tg) { return (D.played && D.played[tg]) || []; }
  function playedButton(tg, name) {
    var kx = tg === 'table' ? '' : '-' + tg, open = !!S.playedOpen[tg];
    return '<button class="btn s icon lv-rm-played' + (open ? ' on' : '') + '" data-act="lvplayed" data-tg="' + tg + '" data-k="lv-played' + kx + '" aria-expanded="' + open + '" aria-label="What played" title="What played in ' + esc(name) + ', with Play again">' + L.icon('history', 's') + '</button>';
  }
  function playedList(tg, name) {
    if (!S.playedOpen[tg]) return '';
    var h = playedOf(tg).slice(0, PLAYED_SHOWN), kx = tg === 'table' ? '' : '-' + tg;
    return '<div class="lv-played"><ol class="lv-played-l" aria-label="What played in ' + esc(name) + '">' + (h.length ? h.map(function (x, i) {
      var t = L.track(x.id), nm = t ? L.nameIn(t, x.seq ? L.sceneKeyOf(L.session(x.seq.cid, x.seq.sid).scenes[x.seq.scene]) : x.place) : '';
      return '<li class="lv-trk-r"><span class="ellipsis grow" title="' + esc(t ? L.title(t) : '') + '">' + esc(nm) + '</span><span class="lv-trk-acts">' +
        '<button class="btn s icon lv-hov" data-act="lvplayedagain" data-tg="' + tg + '" data-i="' + i + '" data-k="lv-pa-' + i + kx + '" aria-label="Play again: ' + esc(nm) + '" title="Play again now">' + L.icon('playair', 's') + '</button>' +
        '<button class="btn s icon lv-hov" data-act="lvplayednext" data-tg="' + tg + '" data-i="' + i + '" data-k="lv-pn-' + i + kx + '" aria-label="Play next: ' + esc(nm) + '" title="Play next, after the current track">' + L.icon('next', 's') + '</button></span></li>';
    }).join('') : '<li class="lv-in-none">Nothing yet</li>') + '</ol></div>';
  }
  L.acts.lvplayed = function (el) { var tg = el.dataset.tg; S.playedOpen[tg] = !S.playedOpen[tg]; L.render(); focusK(el.dataset.k); };
  L.acts.lvplayedagain = function (el) {
    var tg = el.dataset.tg, x = playedOf(tg)[+el.dataset.i]; if (!x) return; touched();
    S.playedOpen[tg] = false; var rm = RM(tg); rm.now = 'plan'; rm.ret = null; rm.pnCur = null;
    rm.playing = x.id; L.play(x.id, { lane: 'music', playlistId: x.playlistId, place: x.place, seq: x.seq, fade: 3, target: tg });
    focusK('lv-played' + (tg === 'table' ? '' : '-' + tg));
  };
  L.acts.lvplayednext = function (el) {
    var tg = el.dataset.tg, x = playedOf(tg)[+el.dataset.i]; if (!x) return;
    S.playedOpen[tg] = false; addItem({ dataset: { id: x.id, box: 'music', k: 'lv-played' + (tg === 'table' ? '' : '-' + tg) } }, 'next');
  };
  function onAir() {
    var rs = rooms(), idle = L.freeBots ? L.freeBots() : L.bots().filter(function (b) { return b.status === 'idle'; });
    var parts = rs.length ? rs.map(function (r) { return roomPart(roomTg(r.bots[0]), r.bots[0], r.name); }) : [roomPart('table', null, 'No room')];
    var add = idle.length ? '<button class="btn s icon" data-act="lvaddroom" data-k="lv-addroom" aria-haspopup="menu" aria-expanded="false" aria-label="Add a room" title="Add a room: put another bot in a voice channel">' + L.icon('plus', 's') + '</button>' : '';
    var sum = collapsed('lv-onair') ? (rs.length ? rs : [{ name: 'No room', mix: pb }]).map(function (r) { var c = r.mix.music; return esc(r.name) + ': ' + (c ? esc(L.title(L.track(c.id))) : 'silent'); }).join(' · ') : '';
    return '<div class="lv-dock">' + L.pane({ id: 'lv-onair', title: 'On air', icon: 'broadcast', kind: 'onair', size: 'auto', flush: true, noMax: true, keys: 'Alt+1', actions: add, summary: sum,
      body: undoStrip('onair') + '<div class="lv-rooms' + (parts.length > 1 ? ' many' : '') + '">' + parts.join('') + '</div>' }) + '</div>';
  }

  /* ---------- rows: tracks and playlists, the same in every box ---------- */
  // o: { pl, place (its place key: scene, session or campaign), seq: {cid, sid, scene, at}, num, box, rep (scene key for
  // Repeat one), noPlay (a scene that is not running: Start plays it), inner, prefer (moods to show first) }
  function seqAttrs(q) { return q ? ' data-sc="' + q.scene + '" data-at="' + q.at + '"' : ''; }
  function profileKey(o) {
    if (o.seq) { var s0 = L.session(o.seq.cid, o.seq.sid), sc0 = s0 && s0.scenes[o.seq.scene]; if (sc0) return 'sc:' + o.seq.cid + ':' + o.seq.sid + ':' + sc0.id; }
    return o.place || (o.pl ? 'pl:' + o.pl : '');
  }
  /* PLY-16 Add to queue (the bottom of the room's list) and Play next (right after the current track), side by side on
     every track and playlist in Live (Nik, 6 Nov 12:14). They show on the row on air, on hover and on keyboard focus,
     so a list of rows reads as names with Preview and Play on air. */
  // amb: an ambience (round 6 part 6): it waits for Next on the room's ambience instead of following a track.
  function addBtns(box, data, k, nm, amb) {
    var where = inWhere(box), ln = amb ? ' data-lane="amb"' : '';
    return '<button class="closer lv-hov" data-act="lvplaynext" data-box="' + box + '" ' + data + ln + ' data-k="' + k + '-n" title="Play next' + where + (amb ? ': the next ambience, when you press Next on the ambience' : ': right after the track playing now') + '" aria-label="Play next' + where + ': ' + esc(nm) + '">' + L.icon('next') + '</button>' +
      '<button class="closer lv-hov" data-act="lvqueue" data-box="' + box + '" ' + data + ln + ' data-k="' + k + '-q" title="Add to queue' + where + (amb ? ': after the ambience waiting in Up next' : ': at the bottom of Up next') + '" aria-label="Add to queue' + where + ': ' + esc(nm) + '">' + L.icon('queue') + '</button>';
  }
  function playBtn(box, data, k, nm, extra) {
    var where = inWhere(box);
    return '<button class="closer" data-act="lvplay" data-box="' + box + '" ' + data + ' data-k="' + k + '-p" title="Play on air' + where + (extra || '') + '" aria-label="Play on air' + where + ': ' + esc(nm) + '">' + L.icon('playair') + '</button>';
  }
  function trackRow(t, src, o) {
    o = o || {};
    var isAmb = t.kind === 'amb', isFx = t.kind === 'fx', here = seqHere(pb.music), box = o.box || 'music', queued = false;
    var inRoom = rooms().some(function (r) { var m = r.mix; return (m.music && m.music.id === t.id) || (m.amb && m.amb.id === t.id); }) || (pb.music && pb.music.id === t.id) || (pb.amb && pb.amb.id === t.id);
    // A row in a scene's list is on air only at its own place in the sequence.
    var onAirNow = o.seq ? !!(here && here.scene === o.seq.scene && here.at === o.seq.at) : inRoom || pb.fx.some(function (f) { return f.ref === 'track/' + t.id && !f.fadeOut; });
    targetsOf(box).forEach(function (tg) { var rm = RM(tg); rm.q.concat(rm.pn).forEach(function (x) { if (x.ids.length === 1 && x.ids[0] === t.id) queued = true; }); });
    // DAT-14: in a scene's list the track shows the scene's name for it; its own name is on hover and in its details.
    var pk = profileKey(o), nm = L.nameIn(t, o.seq ? pk : o.place || ''), ownNm = L.title(t), len = playLen(t, pk);
    var pv = L.previewing(t.id), k = 'lv-' + src + '-' + t.id, open = S.sel === src + ':' + t.id, did = 'lv-d-' + src + '-' + t.id;
    var data = 'data-id="' + t.id + '" data-pl="' + (o.pl || '') + '" data-place="' + esc(o.seq ? pk : o.place || '') + '"' + seqAttrs(o.seq);
    var details = open ? '<div class="lv-trk-d" id="' + did + '">' +
      '<dl>' + (nm !== ownNm ? '<dt>Name in this scene</dt><dd>' + esc(nm) + '</dd>' : '') + '<dt>Your title</dt><dd>' + (t.title ? esc(t.title) : '<span class="faint">none yet</span>') + '</dd><dt>Title in the file</dt><dd>' + esc(t.metaTitle || '–') + '</dd>' +
      '<dt>File name</dt><dd>' + esc(t.file) + '</dd><dt>From</dt><dd>' + esc(t.artist + ', ' + t.album) + '</dd></dl>' +
      (L.profileLink ? '<div class="lv-trk-ap">' + L.profileLink(t.id, pk, true) + '<span class="hint">Audio profile' + (pk ? (o.seq ? ' in this scene' : ' here') : '') + '</span></div>' : '') +
      '<div class="chips">' + D.tagGroups.map(function (g) { return L.tagsOn(t, g.id).map(function (v) { return '<span class="chip lv-mood" title="' + esc(g.name) + '">' + esc(v) + '</span>'; }).join(''); }).join('') + (t.role ? '<span class="chip">' + esc(t.role) + '</span>' : '') + '</div></div>' : '';
    return '<li class="lv-trk' + (onAirNow ? ' on' : '') + (isAmb ? ' amb' : '') + (open ? ' open' : '') + (o.inner ? ' inner' : '') + '"><div class="lv-trk-r">' +
      (o.num ? '<span class="num lv-num" aria-hidden="true">' + o.num + '</span>' : '') +
      (onAirNow ? airBadge(t) : queued ? '<span class="badge lv-qb">Queued</span>' : '') +
      (isAmb || isFx ? '<span class="lane-dot ' + (isAmb ? 'amb' : 'fx') + '" title="' + L.kindName[t.kind] + '"></span><span class="sr-only">' + L.kindName[t.kind] + ':</span>' : '') +
      '<button class="lv-trk-t" data-act="lvsel" data-sel="' + src + ':' + t.id + '" data-k="' + k + '-t" aria-expanded="' + open + '"' + (open ? ' aria-controls="' + did + '"' : '') + ' title="' + esc(nm !== ownNm ? nm + ' (its own name: ' + ownNm + ')' : nm) + ' (click for details)"><span>' + esc(nm) + '</span></button>' +
      // Round 6 part 3: moods and energy are in the row's details (and Find's results), not on the row on air.
      (open || o.box === 'off' ? '<span class="chips lv-trk-chips">' + moodChips(t, o.prefer) + '</span>' + (isAmb || isFx ? '' : L.energy(t.energy)) : '') +
      '<span class="num lv-dur" title="' + (Math.round(len) !== Math.round(t.dur) ? 'Plays ' + L.fmt(len) + ' of the file\'s ' + L.fmt(t.dur) : 'Length ' + L.fmt(t.dur)) + '">' + L.fmt(len) + '</span>' +
      '<span class="lv-trk-acts' + (onAirNow ? ' shown' : '') + '">' +
        '<button class="closer lv-pvb' + (pv || o.noPlay ? '' : ' lv-hov') + '" data-act="lvpv" data-id="' + t.id + '" data-k="' + k + '-v" aria-pressed="' + pv + '" title="' + (pv ? 'Stop the preview' : 'Preview in your headphones (players do not hear it)') + '" aria-label="Preview: ' + esc(nm) + '">' + L.icon('headphones') + '</button>' +
        (isFx ? '' : addBtns(box, data, k, nm, isAmb)) +
        // Decision 4 (Nik, 6 Nov 12:30): Repeat one on a scene's track is saved with the scene (L.repeatOneButton).
        (o.rep && !isAmb && !isFx ? L.repeatOneButton(o.rep, t.id, k + '-r', nm, onAirNow) : '') +
        (o.noPlay ? '' : playBtn(box, data, k, nm, isFx ? ', over the music' : ', crossfading from what is playing')) +
      '</span></div>' + details + '</li>';
  }
  // A playlist row: unfolds to its tracks in this place's order; Play on air plays it from its first track.
  function plRow(p, o) {
    var ts = L.orderedTracks(p.id, o.place), xk = 'lv-' + o.src + '-' + p.id, open = L.expanded(xk), pv = L.previewing('pl:' + p.id), k = 'lv-' + o.src + '-' + p.id, box = o.box;
    var air = o.on || rooms().some(function (r) { return r.mix.music && r.mix.music.playlistId === p.id && L.lanePlace(r.mix.music) === o.place; }) || (pb.music && pb.music.playlistId === p.id && L.lanePlace(pb.music) === o.place);
    var at = o.playingAt != null ? ts.map(function (t) { return t.id; }).indexOf(o.playingAt) + 1 : 0;
    var whole = 'data-whole="' + p.id + '" data-place="' + esc(o.place) + '"';
    return '<li class="lv-pli' + (air ? ' on' : '') + '"><div class="lv-trk-r">' +
      (o.num ? '<span class="num lv-num" aria-hidden="true">' + o.num + '</span>' : '') + L.expanderButton(xk, p.name, open) +
      (air ? L.destTag('air', '') : '') + L.icon('playlist', 's lv-pli-i') +
      // Round 6: mid-game the track count matters, not how the playlist was made (that is hover text).
      // Round 6 part 3: the count and how it was made are hover text (and read out); playing, it says which track.
      '<span class="lv-pli-n"><b class="ellipsis" title="' + esc(p.name + ' · ' + ts.length + ' tracks · ' + (p.kind === 'dynamic' ? 'Dynamic' : 'Manual')) + '">' + esc(p.name) + '</b>' + (at ? '<span class="faint ellipsis">' + at + ' of ' + ts.length + '</span>' : '<span class="sr-only">, ' + ts.length + ' tracks</span>') + '</span>' +
      '<span class="lv-ord' + (air || (o.place && L.orderOf(p.id, o.place).source === 'place') ? ' shown' : '') + '">' + L.orderButton(p.id, o.place) + '</span>' +
      '<span class="lv-trk-acts' + (air ? ' shown' : '') + '">' +
        '<button class="closer lv-pvb' + (pv || o.noPlay ? '' : ' lv-hov') + '" data-act="lvpvpl" data-id="' + p.id + '" data-k="' + k + '-v" aria-pressed="' + pv + '" title="' + (pv ? 'Stop the preview' : 'Preview in your headphones') + '" aria-label="Preview: ' + esc(p.name) + '">' + L.icon('headphones') + '</button>' +
        (p.lane === 'fx' ? '' : addBtns(box, whole, k, p.name, p.lane === 'amb')) +
        (o.noPlay ? '' : playBtn(box, 'data-id="' + (o.firstId || (ts[0] ? ts[0].id : '')) + '" data-pl="' + p.id + '" data-place="' + esc(o.place) + '"' + seqAttrs(o.firstSeq), k, p.name, ', from its first track')) +
      '</span></div>' +
      (open ? '<ol class="lv-list lv-sub" aria-label="Tracks in ' + esc(p.name) + '">' + ts.map(function (t) { return trackRow(t, o.src, o.trackOpts(t)); }).join('') + '</ol>' : '') + '</li>';
  }

  /* ---------- Scenes ---------- */
  function scenesBox(compact) {
    var s = sess(), lv = live(), now = S.notStarted ? -1 : lv.scene, nx = lv.standby, n = s.scenes[nx];
    var short = compact && !S.allScenes && s.scenes.length > 2, u = S.undo;
    var body = '<div class="lv-sc-top"><button class="btn primary lv-nextsc" data-act="lvnext" data-k="lv-nextsc"' + (n ? '' : ' aria-disabled="true"') + (n && S.keys1 ? ' aria-keyshortcuts="Space"' : '') + ' title="' + (n ? 'Start ' + esc(n.name) + (S.keys1 ? ' (Space)' : '') + (rooms().length > 1 ? '. Scenes always play in ' + esc(rooms()[0].name) : '') : 'That was the last scene') + '">' +
      L.icon('next', 's') + '<span class="ellipsis">' + (n ? (S.notStarted ? 'Start: ' : 'Next scene: ') + esc(n.name) : 'No more scenes') + '</span>' + (n && S.keys1 ? '<span class="kbd" aria-hidden="true">Space</span>' : '') + '</button>' +
      (u ? '<div class="lv-undo" role="group" aria-label="Undo"><span class="ellipsis grow">Started <b>' + esc(u.started) + '</b></span>' +
        '<button class="btn s" data-act="lvundo" data-k="lv-undo" aria-keyshortcuts="Control+Z" title="Go back to ' + esc(u.label) + ', with its music and ambience (Ctrl+Z)">' + L.icon('undo', 's') + '<span class="ellipsis">Undo</span></button>' +
        '<span class="lv-undo-bar" aria-hidden="true"><span data-undo-left style="width:100%"></span></span></div>' : '') + '</div>' +
      '<ol class="lv-scenes">' + s.scenes.map(function (sc, i) {
        var isNow = i === now, isNext = i === nx;
        if (short && !isNow && !isNext && !S.scOpen[i]) return '';
        return '<li class="lv-sc' + (isNow ? ' now' : '') + (isNext ? ' next' : '') + (i < now ? ' done' : '') + (S.scOpen[i] ? ' open' : '') + '"' + (isNow ? ' aria-current="step"' : '') + '>' +
          '<div class="lv-sc-1">' +
            (isNow ? '<span class="badge lv-nowb">Now</span>' : isNext ? '<span class="badge lv-nextb">Next</span>' : '') +
            // Round 7 part 2 (SHW-3, PLY-8): only a scene that differs from the usual is marked.
            (L.sceneMarks ? L.sceneMarks(sc) : '') +
            // SHW-7: the name unfolds the scene in place (Enter, or Right; Left folds), without touching what plays.
            '<button class="lv-sc-name" data-act="lvscopen" data-i="' + i + '" data-k="lv-scn-' + i + '" aria-expanded="' + !!S.scOpen[i] + '"' + (S.scOpen[i] ? ' aria-controls="lv-scb-' + i + '"' : '') + ' title="' + esc(sc.name) + ': ' + (S.scOpen[i] ? 'fold' : 'see what it plays') + '">' + L.icon('chevdown', 's lv-sc-chev') + '<span class="sr-only">Scene ' + (i + 1) + ': </span><span class="ellipsis">' + esc(sc.name) + '</span></button>' +
            '<button class="btn s icon lv-sc-go" data-act="lvstart" data-i="' + i + '" data-k="lv-start-' + i + '" title="' + (isNow ? 'Restart' : 'Start') + ' this scene" aria-label="' + (isNow ? 'Restart' : 'Start') + ' scene ' + (i + 1) + ': ' + esc(sc.name) + '">' + L.icon(isNow ? 'restart' : 'play', 's') + '</button></div>' +
          // The cue for the next change of scene; the running scene's details are in Current scene.
          (isNext && sc.when && !S.scOpen[i] ? '<div class="lv-sc-when ellipsis" title="Starts when: ' + esc(sc.when) + '"><span class="faint">Starts when:</span> ' + esc(sc.when) + '</div>' : '') +
          (S.scOpen[i] ? sceneInside(sc, i) : '') + '</li>';
      }).join('') + '</ol>' +
      (compact && s.scenes.length > 2 ? '<button class="lv-more lv-allsc" data-act="lvallsc" data-k="lv-allsc" aria-expanded="' + !!S.allScenes + '">' + (S.allScenes ? 'Show only Now and Next' : 'Show all ' + s.scenes.length + ' scenes') + '</button>' : '');
    var cur = s.scenes[now];
    // Round 6, part 5 (Nik, 6 Nov 16:14: "Let's kill ready, seems dumb. Kill the scene count, unnecessary."): no status;
    // the list's Now and Next say where the evening is, and the folded box says them in its summary.
    return L.pane({ id: 'lv-scenes', title: 'Scenes', icon: 'scroll', kind: 'scenes', size: 'auto', flush: true, noMax: true, keys: 'Alt+2', body: body,
      summary: collapsed('lv-scenes') ? (cur ? 'Now: ' + esc(cur.name) : '') + (n ? (cur ? ' · ' : '') + 'Next: ' + esc(n.name) : '') : '' });
  }
  /* SHW-7, round 6 part 3 (Nik, 6 Nov 12:24: "expand each scene, and choose to play it or not, and see its details,
     pads, playlists and tracks, and do any live adjustments"): when it starts, its notes, its music in the order it
     will play, its ambience and its pad boards (each unfolds to its pads). Unfolding never changes what plays.
     Round 6 part 6 (Nik, 17:14: "I need a play now button on tracks and playlists in the live -> scenes pane for all of
     them"): every track, playlist and the ambience has the row's buttons of Current scene, in its order: Preview, Play
     next, Add to queue, (Repeat one, a playlist's play order), Play on air. In a scene that is not running, Play on air
     plays that item in the room and does not start the scene: a track plays now and the room's list carries on after
     it (as from Find); a playlist plays from its first track, in the scene's order for it. Start plays the scene. */
  function sceneInside(sc, i) {
    var amb = sc.amb && ambName(sc.amb), bds = sceneBoards(sc), running = !S.notStarted && i === live().scene;
    return '<div class="lv-sc-in" id="lv-scb-' + i + '">' +
      (sc.when ? '<div class="lv-sc-when"><span class="faint">Starts when:</span> ' + esc(sc.when) + '</div>' : '') +
      (sc.notes ? '<div class="lv-sc-notes"><span class="lv-sc-notes-t">' + esc(sc.notes) + '</span></div>' : '') +
      (L.sceneItems(sc).length ? sceneList(sc, i, { src: 'in' + i, label: sc.name + ': music in play order', loose: !running }) : '<p class="lv-in-none">No music</p>') +
      ambLine(sc, 'lv-in' + i) +
      '<div class="lv-in-line lv-in-bds"><span class="lane-dot fx" aria-hidden="true"></span><span class="sr-only">Pad boards: </span>' + (bds.length ? bds.map(function (id) {
        var xk = 'lv-scbd-' + sc.id + '-' + id, open = L.expanded(xk);
        return '<span class="lv-in-bd">' + L.expanderButton(xk, L.board(id).name, open) + '<span class="ellipsis">' + esc(L.board(id).name) + '</span></span>';
      }).join('') : '<span class="faint">No pad boards</span>') + '</div>' +
      bds.filter(function (id) { return L.expanded('lv-scbd-' + sc.id + '-' + id); }).map(function (id) { return padGrid(L.board(id), 'music', false); }).join('') + '</div>';
  }
  // A scene's ambience, as a row with the row's buttons (round 6 part 6): Preview, Play next, Add to queue (the room's
  // next ambience, played on Next), Play on air (the room's ambience now, crossfading).
  function ambLine(sc, k) {
    var amb = sc.amb && ambName(sc.amb), p = amb && L.playlist(sc.amb), first = amb ? L.ambTracks(sc.amb)[0] : null, key = L.sceneKeyOf(sc);
    if (!amb) return '<div class="lv-in-line"><span class="lane-dot amb" aria-hidden="true"></span><span class="sr-only">Ambience: </span><span class="grow ellipsis"><span class="faint">No ambience</span></span></div>';
    var on = rooms().some(function (r) { var a = r.mix.amb; return a && (p ? a.playlistId === p.id : a.id === sc.amb); }) || (pb.amb && (p ? pb.amb.playlistId === p.id : pb.amb.id === sc.amb));
    var data = p ? 'data-whole="' + p.id + '" data-place="' + esc(key) + '"' : 'data-id="' + sc.amb + '" data-place="' + esc(key) + '"', pv = L.previewing(p ? 'pl:' + sc.amb : sc.amb);
    return '<div class="lv-in-line lv-trk-r lv-amb-r' + (on ? ' on' : '') + '" role="group" aria-label="Ambience: ' + esc(amb) + '"><span class="lane-dot amb" aria-hidden="true"></span><span class="sr-only">Ambience: </span><span class="grow ellipsis" title="' + esc(amb) + '">' + esc(amb) + '</span>' +
      '<span class="lv-trk-acts' + (on ? ' shown' : '') + '">' +
        '<button class="closer lv-pvb' + (pv ? '' : ' lv-hov') + '" data-act="' + (p ? 'lvpvpl' : 'lvpv') + '" data-id="' + sc.amb + '" data-k="' + k + '-amb" aria-pressed="' + pv + '" title="' + (pv ? 'Stop the preview' : 'Preview in your headphones (players do not hear it)') + '" aria-label="Preview: ' + esc(amb) + '">' + L.icon('headphones') + '</button>' +
        addBtns('music', data, k + '-amb', amb, true) +
        (first ? playBtn('music', 'data-id="' + first.id + '" data-pl="' + (p ? p.id : '') + '" data-place="' + esc(key) + '"', k + '-amb', amb, ', as the ambience now (crossfading)') : '') +
      '</span></div>';
  }
  L.acts.lvscopen = function (el) { var i = +el.dataset.i; S.scOpen[i] = !S.scOpen[i]; L.render(); focusK('lv-scn-' + i); };

  // A scene's music in its order: track items as track rows, playlist items as rows that unfold (folded at first).
  // o: { src, label, loose (a scene that is not running: its items play on their own, outside the scene's order) }
  function sceneList(sc, idx, o) {
    var items = L.sceneItems(sc), q = L.sceneSequence(sc), here = seqHere(pb.music), key = L.sceneKeyOf(sc);
    var cur = here && here.scene === idx && q[here.at] ? q[here.at].item : -1;
    function pos(at) { return { cid: live().cid, sid: live().sid, scene: idx, at: at }; }
    if (o.loose) return '<ol class="lv-list lv-items" aria-label="' + esc(o.label) + '">' + items.map(function (it, i) {
      if (it.kind === 'track') return trackRow(it.obj, o.src + '-' + i, { place: key, rep: key });
      var ts = L.orderedTracks(it.id, key);
      return plRow(it.obj, { src: o.src + '-' + i, place: key, box: 'music', firstId: ts[0] ? ts[0].id : '', trackOpts: function () { return { pl: it.obj.id, place: key, inner: true, rep: key }; } });
    }).join('') + '</ol>';
    return '<ol class="lv-list lv-items" aria-label="' + esc(o.label) + '">' + items.map(function (it, i) {
      var first = -1; q.forEach(function (x, j) { if (x.item === i && first < 0) first = j; });
      if (it.kind === 'track') return trackRow(it.obj, o.src + '-' + i, { seq: pos(first), rep: key, noPlay: o.noPlay });
      return plRow(it.obj, { src: o.src + '-' + i, place: key, box: 'music', noPlay: o.noPlay, on: cur === i, playingAt: cur === i ? q[here.at].trackId : null,
        firstId: q[first] ? q[first].trackId : '', firstSeq: first > -1 ? pos(first) : null,
        trackOpts: function (t) { var j = -1; q.forEach(function (x, n) { if (x.item === i && x.trackId === t.id && j < 0) j = n; }); return { pl: it.obj.id, seq: pos(j), inner: true, rep: key, noPlay: o.noPlay }; } });
    }).join('') + '</ol>';
  }

  /* ---------- Current scene: the running scene, all of it ---------- */
  function currentScene() {
    var sc = scene(), idx = live().scene, body;
    if (!sc) body = '<p class="lv-none">No scene yet</p>';
    else {
      var bs = sceneBoards(sc), b = keysBoard(), padsOn = L.padSounds().length;
      body = (sc.notes ? '<div class="lv-sc-notes lv-cur-notes' + (S.notesOpen ? ' open' : '') + '" id="lv-notes"><span class="lv-sc-notes-t">' + esc(sc.notes) + '</span>' +
          (sc.notes.length > 70 ? '<button class="lv-more" data-act="lvnotes" data-k="lv-notes" aria-expanded="' + S.notesOpen + '" aria-controls="lv-notes">' + (S.notesOpen ? 'Less' : 'More') + '</button>' : '') + '</div>' : '') +
        (L.sceneItems(sc).length ? sceneList(sc, idx, { src: 'sc', label: sc.name + ': music in the order it plays' }) : '<p class="lv-in-none">No music</p>') +
        ambLine(sc, 'lv-cur') +
        (bs.length ? '<div class="lv-cur-pads"><div class="lv-pads-bar">' + (bs.length > 1 ? '<div class="seg s lv-bseg" role="group" aria-label="This scene\'s pad boards">' + bs.map(function (id) {
            return '<button data-act="lvboard" data-scope="sc" data-id="' + id + '" data-k="lv-bd-' + id + '" aria-pressed="' + (id === b.id) + '" title="' + esc(L.board(id).name) + '"><span class="ellipsis">' + esc(L.board(id).name) + '</span></button>';
          }).join('') + '</div>' : '<span class="lv-bd1"><span class="lane-dot fx" aria-hidden="true"></span>' + esc(b.name) + '</span>') + '<span class="grow"></span>' + (S.keys1 ? '' : '<span class="hint">Pad keys are off</span>') +
          // BUG-20: Stop pads stops every pad sound, in every room; music and ambience go on. It shows while a pad sounds.
          (padsOn ? '<button class="btn s" data-act="lvpadstop" data-k="lv-padstop" title="Stop every pad, in every room (music and ambience go on)">' + L.icon('stop', 's') + 'Stop pads</button>' : '') + '</div>' +
          padGrid(b, 'music', true) + '</div>' : '');
    }
    var more = sc ? '<button class="closer" data-act="lvcurmenu" data-k="lv-curmenu" aria-haspopup="menu" aria-expanded="false" aria-label="More for ' + esc(sc.name) + '" title="More">' + L.icon('more') + '</button>' : '';
    return L.pane({ id: 'lv-current', title: 'Current scene', icon: 'play', kind: 'current', size: 'auto', flush: true, noMax: true, keys: 'Alt+3', actions: toChip('music') + more, body: body,
      summary: sc ? '<b class="lv-cur-n" title="' + esc(sc.name + (sc.when ? '. Started when: ' + sc.when : '')) + '">' + esc(sc.name) + '</b>' : '' });
  }

  /* ---------- Session playlists and Campaign playlists ---------- */
  function playlistsBox(scope) {
    var s = sess(), c = camp(), lv = live(), own = scope === 'ss' ? s : c, ids = musicOnly(own.playlists), tr = (own.tracks || []).filter(L.track);
    var place = scope === 'ss' ? 'ss:' + lv.cid + ':' + lv.sid : 'cp:' + lv.cid, id = 'lv-' + scope + 'p', title = (scope === 'ss' ? 'Session' : 'Campaign') + ' playlists';
    var rows = ids.map(function (pid) {
      return plRow(L.playlist(pid), { src: scope + 'p', place: place, box: scope, trackOpts: function () { return { pl: pid, place: place, inner: true, box: scope }; } });
    }).concat(tr.map(function (tid) { return trackRow(L.track(tid), scope + 't', { place: place, box: scope }); }));
    // Round 6 part 7 (Nik, 21:59): the trays' boxes grow with what they hold and the page scrolls (live.css).
    // Round 6 part 6 (Nik, 17:14: "Session playlists should start closed"): every box in the trays starts folded; once
    // unfolded, a box stays unfolded (L.state.panes, kept on this computer). Should 6: the session's and the campaign's
    // boxes sit under "This session" and "Whole campaign" (scopeHidden: the word is read out with the box's name, not
    // shown again in its header).
    return L.pane({ id: id, title: title, scope: scope === 'ss' ? 'Session' : 'Campaign', scopeHidden: true, label: 'Playlists', icon: 'playlist', kind: 'music', size: 'auto', collapsed: true, flush: true, noMax: true, keys: scope === 'ss' ? 'Alt+4' : 'Alt+6',
      actions: toChip(scope), body: rows.length ? '<ol class="lv-list" aria-label="' + esc(title) + '">' + rows.join('') + '</ol>' : '<p class="lv-in-none">None</p>',
      status: { text: String(rows.length), tone: 'idle' }, summary: '' });
  }

  /* ---------- pads: Current scene's board (with its keys), Session pads and Campaign pads (click only) ---------- */
  function padGrid(b, box, keysOn) {
    var many = rooms().length > 1;
    return '<div class="lv-grid" style="grid-template-columns:repeat(' + b.cols + ',minmax(0,1fr))" role="group" aria-label="Pads on ' + esc(b.name) + '">' + L.boardPads(b).map(function (p, i) {
      // Round 7 part 2 (ORG-4): a board's divider names the row of pads under it.
      var dv = i % b.cols === 0 && b.dividers && b.dividers[i / b.cols + 1];
      return (dv ? '<h3 class="lv-pad-div ellipsis" style="grid-column:1/-1" title="' + esc(dv) + '">' + esc(dv) + '</h3>' : '') + padHTML(b, p, box, keysOn, many);
    }).join('') + '</div>';
  }
  function padHTML(b, p, box, keysOn, many) {
      if (!p) return '<span class="lv-pad-empty" aria-hidden="true"></span>';
      var on = L.padActive(b.id, p.id), ref = b.id + '/' + p.id, key = keysOn && S.keys1 && p.key;
      // Which rooms a sounding pad is in, when there is more than one room.
      var inRooms = many ? rooms().filter(function (r) { return L.fxFor(tgOf(r.bots[0].id)).some(function (f) { return f.ref === ref && !f.fadeOut; }); }).map(function (r) { return r.name; }) : [];
      var onHere = targetsOf(box).some(function (tg) { return L.fxFor(tg).some(function (f) { return f.ref === ref && !f.fadeOut; }); });
      // BUG-20: every pad says whether it plays (pressed), since pressing a playing pad stops it.
      return '<button class="lv-pad' + (on ? ' on' : '') + '" data-bid="' + b.id + '" data-pid="' + p.id + '" data-mode="' + p.mode + '" data-box="' + box + '"' + (p.mode === 'hold' ? '' : ' data-act="lvpad"') +
        ' data-k="lv-pad-' + box + '-' + b.id + '-' + p.id + '" style="--pad:' + (L.colors[p.color] || L.colors.bone) + '" aria-pressed="' + (many ? onHere : on) + '"' +
        ' title="' + esc(p.label) + (key ? ' (key ' + String(p.key).toUpperCase() + ')' : '') + ': ' + L.modeName[p.mode] + inWhere(box) + (inRooms.length ? '. Sounding in ' + esc(inRooms.join(' and ')) : '') + '"' + (key ? ' aria-keyshortcuts="' + esc(p.key) + '"' : '') + '>' +
        L.icon(p.icon, 's') + '<span class="lv-pad-l ellipsis">' + esc(p.label) + '</span>' +
        (inRooms.length ? '<span class="lv-pad-rm" aria-hidden="true">' + inRooms.map(function (n) { return esc(n.charAt(0)); }).join('') + '</span><span class="sr-only">, sounding in ' + esc(inRooms.join(' and ')) + '</span>' : '') +
        (on && !many ? '<span class="lv-pad-on">On</span>' : p.mode === 'oneshot' || on ? '' : '<span class="lv-pad-mode" title="' + L.modeName[p.mode] + '">' + L.icon(L.modeIcon[p.mode], 's') + '<span class="sr-only">' + L.modeName[p.mode] + '</span></span>') +
        (key ? '<span class="kbd" aria-hidden="true">' + esc(String(p.key).toUpperCase()) + '</span>' : '') + '</button>';
  }
  function padsBox(scope) {
    var own = scope === 'ss' ? sess() : camp(), bs = boardsOf(own.boards), cur = S['bd' + scope], b = L.board(bs.indexOf(cur) > -1 ? cur : bs[0]), box = scope + 'd', id = 'lv-' + scope + 'd';
    var title = (scope === 'ss' ? 'Session' : 'Campaign') + ' pads', padsOn = L.padSounds().length, kb = keysBoard();
    // The board Current scene shows is not drawn a second time here: the same pads twice is only more to read.
    var grid = b && kb && kb.id === b.id ? '<p class="lv-in-none lv-bd-there">' + esc(b.name) + ': in Current scene</p>' : b ? padGrid(b, box, false) : '';
    var body = !b ? '<p class="lv-in-none">None</p>' : bs.length === 1 && kb && kb.id === b.id ? grid : '<div class="lv-pads-bar">' + (bs.length > 1 ? '<div class="seg s lv-bseg" role="group" aria-label="' + esc(title) + ': boards">' + bs.map(function (x) {
        return '<button data-act="lvboard" data-scope="' + scope + '" data-id="' + x + '" data-k="lv-bd' + scope + '-' + x + '" aria-pressed="' + (x === b.id) + '" title="' + esc(L.board(x).name) + '"><span class="ellipsis">' + esc(L.board(x).name) + '</span></button>';
      }).join('') + '</div>' : '<span class="lv-bd1"><span class="lane-dot fx" aria-hidden="true"></span>' + esc(b.name) + '</span>') + '</div>' + grid;
    var stop = padsOn ? '<button class="btn s icon" data-act="lvpadstop" data-k="lv-padstop-' + scope + '" aria-label="Stop pads" title="Stop every pad, in every room (music and ambience go on)">' + L.icon('stop', 's') + '</button>' : '';
    return L.pane({ id: id, title: title, scope: scope === 'ss' ? 'Session' : 'Campaign', scopeHidden: true, label: 'Pads', icon: 'grid', kind: 'fx', size: 'auto', collapsed: true, flush: true, noMax: true, keys: scope === 'ss' ? 'Alt+5' : 'Alt+7',
      actions: b ? toChip(box) + stop : '', body: body });
  }

  /* ---------- Find a track (was Off script): a search field in the top strip, results under it ---------- */
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
    var pls = searchPlaylists(words);
    if (!S.tags.length) return { list: base, pls: pls, any: false };
    var all = base.filter(function (t) { return S.tags.every(function (x) { return hasTag(t, x); }); });
    if (all.length || S.tags.length < 2) return { list: all, pls: pls, any: false };
    var some = base.filter(function (t) { return S.tags.some(function (x) { return hasTag(t, x); }); });
    some.sort(function (a, b) { return S.tags.filter(function (x) { return hasTag(b, x); }).length - S.tags.filter(function (x) { return hasTag(a, x); }).length; });
    return { list: some, pls: pls, any: true };
  }
  /* Round 6 part 6 (Nik, 17:14: "The search bar should be able to find a track or a playlist"): a playlist is found by
     its name (and notes); with tags picked, it is found when one of its tracks has all of them. The Music, Ambience and
     FX filter applies to playlists too. */
  function searchPlaylists(words) {
    return D.playlists.filter(function (p) {
      if (S.lane !== 'all' && p.lane !== S.lane) return false;
      if (!words.length && !S.tags.length) return false;
      var hay = (p.name + ' ' + (p.notes || '')).toLowerCase();
      if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return false;
      return !S.tags.length || L.playlistTracks(p).some(function (t) { return S.tags.every(function (x) { return hasTag(t, x); }); });
    });
  }
  function tagChip(g, v) { var gn = D.tagGroups.filter(function (x) { return x.id === g; })[0]; return '<button class="chip lv-mood" data-act="lvtag" data-g="' + g + '" data-v="' + esc(v) + '" data-k="lv-tag-' + g + '-' + esc(v) + '" aria-pressed="' + tagOn(g, v) + '" title="' + esc(gn ? gn.name : '') + '">' + (tagOn(g, v) ? L.icon('check', 's') : '') + esc(v) + '</button>'; }
  function find() {
    var field = '<div class="search lv-find-f">' + L.icon('search') + '<input class="input" type="search" data-input="lvq" data-k="lv-q" value="' + esc(S.q) + '" placeholder="Find a track or playlist" aria-label="Find a track or playlist in the whole library"' + (S.findOpen ? ' aria-controls="lv-found"' : '') + '' + (S.keys1 ? ' aria-keyshortcuts="/"><span class="kbd" aria-hidden="true">/</span>' : '>') + '</div>';
    return '<div class="lv-find">' + field + (S.findOpen ? found() : '') + '</div>';
  }
  function found() {
    var active = S.q || S.tags.length, r = active ? search() : null, moods = moodsByUse(), shown = S.moreTags ? moods : moods.slice(0, 8);
    var extra = S.tags.filter(function (x) { return x.g !== 'mood' ? !S.moreTags : shown.indexOf(x.v) < 0; });
    var chips = '<div class="chips lv-tagrow" role="group" aria-label="Moods">' + shown.map(function (v) { return tagChip('mood', v); }).join('') +
      extra.map(function (x) { return tagChip(x.g, x.v); }).join('') +
      '<button class="lv-more" data-act="lvmoretags" data-k="lv-moretags" aria-expanded="' + S.moreTags + '">' + (S.moreTags ? 'Fewer tags' : 'All tags') + '</button>' +
      (S.tags.length ? '<button class="closer lv-tagx" data-act="lvtagclear" data-k="lv-tagx" title="Clear selected tags" aria-label="Clear selected tags">' + L.icon('close') + '</button>' : '') + '</div>';
    if (S.moreTags) chips += D.tagGroups.filter(function (g) { return g.id !== 'mood'; }).map(function (g) {
      return '<div class="lv-taggrp"><span class="lv-taggrp-l">' + esc(g.name) + '</span><div class="chips" role="group" aria-label="' + esc(g.name) + '">' + D.tagValues[g.id].map(function (v) { return tagChip(g.id, v); }).join('') + '</div></div>';
    }).join('');
    var prefer = S.tags.filter(function (x) { return x.g === 'mood'; }).map(function (x) { return x.v; });
    // Results: Playlists first (each unfolds to its tracks, as in the playlist boxes), then Tracks; each row has the
    // buttons it has everywhere in Live.
    var n = active ? r.list.length + r.pls.length : 0;
    var countText = active ? (n ? n + ' found' : 'Nothing found') + (r.any ? ': none has all these tags, so tracks with some of them' : '') : '';
    L.sayWhenSettled(active ? countText : '');
    var res = !active ? '' : '<div class="lv-off-count"><span>' + countText + '</span>' +
        '<button class="lv-more" data-act="lvclear" data-k="lv-clear">Clear</button></div>' +
      (r.pls.length ? '<h3 class="lv-found-h" id="lv-found-p">Playlists</h3><ol class="lv-list" aria-labelledby="lv-found-p">' + r.pls.map(function (p) {
        var place = placeOfPl(p.id); return plRow(p, { src: 'offp', place: place, box: 'off', trackOpts: function () { return { pl: p.id, place: place, inner: true, box: 'off' }; } });
      }).join('') + '</ol>' : '') +
      (r.list.length ? '<h3 class="lv-found-h" id="lv-found-t">Tracks</h3><ol class="lv-list" aria-labelledby="lv-found-t">' + r.list.map(function (t) { return trackRow(t, 'off', { prefer: prefer, box: 'off' }); }).join('') + '</ol>' : '');
    return '<section class="lv-found" id="lv-found" aria-label="Find a track or playlist"><div class="lv-off-f"><div class="seg s" role="group" aria-label="Show">' + [['all', 'All'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']].map(function (x) {
        return '<button data-act="lvlane" data-v="' + x[0] + '" data-k="lv-lane-' + x[0] + '" aria-pressed="' + (S.lane === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div><span class="grow"></span>' + toChip('off') +
      '<button class="closer" data-act="lvfindclose" data-k="lv-findclose" title="Close (Esc)" aria-label="Close Find">' + L.icon('close') + '</button></div>' + chips + res + '</section>';
  }
  function openFind() { if (!S.findOpen) { S.findOpen = true; L.render(); } }
  function closeFind(refocus) { if (!S.findOpen) return false; S.findOpen = false; L.render(); if (refocus) focusK('lv-q'); return true; }
  L.acts.lvfindclose = function () { closeFind(true); };
  // The results open on a click in the field, on / and on typing (not on Tab, which only passes through), and close
  // when focus or a click goes elsewhere.
  document.addEventListener('focusin', function (e) {
    if (!onLive() || !S.findOpen) return;
    var t = e.target; if (!(t.closest && (t.closest('.lv-find') || t.closest('.menu')))) closeFind(false);
  });
  document.addEventListener('pointerdown', function (e) {
    if (!onLive() || !e.target.closest) return;
    if (e.target.closest('[data-k="lv-q"]')) { setTimeout(openFind, 0); return; }
    if (S.findOpen && !(e.target.closest('.lv-find') || e.target.closest('.menu'))) closeFind(false);
  });

  /* ---------- layout ---------- */
  var PANES = { scenes: scenesBox, current: currentScene, ssp: function () { return playlistsBox('ss'); }, ssd: function () { return padsBox('ss'); }, cpp: function () { return playlistsBox('cp'); }, cpd: function () { return padsBox('cp'); } };
  // On air at the top, the whole width (round 6 part 6); under it Scenes and Current scene where the eye starts, then
  // the session's things, then the campaign's.
  var LAYOUT = { 1: [['scenes', 'current', 'ssp', 'ssd', 'cpp', 'cpd']], 2: [['scenes', 'ssp', 'ssd', 'cpp', 'cpd'], ['current']], 3: [['scenes'], ['current'], ['ssp', 'ssd', 'cpp', 'cpd']] };
  // The boxes in the order of Alt+1 to Alt+7 and of F6: top to bottom, left to right, the same in every layout.
  var BOXES = ['lv-onair', 'lv-scenes', 'lv-current', 'lv-ssp', 'lv-ssd', 'lv-cpp', 'lv-cpd'];
  L.f6Order = function () { return onLive() ? BOXES.map(function (id) { return document.querySelector('[data-k="pane-' + id + '"]'); }).filter(Boolean) : null; };
  function groups(ids) {
    var out = [];
    ids.forEach(function (id) { var sc = /^ss/.test(id) ? 'ss' : /^cp/.test(id) ? 'cp' : ''; var last = out[out.length - 1]; if (sc && last && last.scope === sc) last.ids.push(id); else out.push({ scope: sc, ids: [id] }); });
    return out;
  }
  function layoutFor() { var app = document.getElementById('app'), w = app ? app.getBoundingClientRect().width : 960; return w >= 1200 ? 3 : w >= 820 ? 2 : 1; }

  L.view('live', {
    nav: 'live',
    // Round 6 part 6: the trail is the campaign (a link to its page) › the session (the session button, last).
    crumbs: function () { var c = camp(), s = sess(); return c && s ? [{ href: '#/campaign/' + c.id, label: c.name }, { label: 'Session ' + s.n + ': ' + s.name }] : null; },
    notesTitle: 'Live: what changed since round 1',
    notes: [
      '<b>Round 6, part 6:</b> <b>On air</b> at the top, the whole width; <b>Scenes</b> and <b>Current scene</b> under it, as tall as what they hold; <b>Back</b> and the trail (campaign › session) first in the strip; <b>Find a track or playlist</b> (/); every row of an unfolded scene, and its ambience, has Preview, Play next, Add to queue and Play on air. Session playlists start folded.',
      '<b>Round 6, part 3:</b> seven boxes, each with one job. <b>Scenes</b> and <b>Current scene</b>; <b>Session</b> and <b>Campaign</b> playlists and pads beside them; <b>On air</b> always in view. <b>Find</b> is in the top strip (/).',
      '<b>Play next</b> plays right after the current track; <b>Add to queue</b> goes to the bottom of the room\'s list. Both are on every row, greyed until you point at them. <b>Up next</b> in On air lists the room\'s list top to bottom, each with ×.',
      '<b>Repeat</b> in On air and on the Now playing bar is for what plays now in that room, never saved. <b>Repeat one</b> on a scene\'s track is saved with the scene, and shows in the planner too.',
      '<b>Round 6 review:</b> Ctrl+Z takes back only the last thing done; a room in an empty channel says <b>Nobody there</b>; the session\'s and the campaign\'s boxes sit under <b>This session</b> and <b>Whole campaign</b>; row buttons are greyed, not hidden; a new scene clears what was added (Undo brings it back); <b>Help</b> (F1) holds what left the screen.',
      'Keys: <span class="kbd">Space</span> next scene, <span class="kbd">Ctrl+Z</span> undo (8 s), <span class="kbd">Alt+1</span> (On air)…<span class="kbd">7</span> or <span class="kbd">F6</span> move between boxes, <span class="kbd">Shift+Esc</span> fade all, <span class="kbd">/</span> find, pad keys (the Current scene\'s board).'
    ],
    // Find's results stay inside the window: under the field, moved left when the field is near the right edge.
    after: function (view) {
      var f = view.querySelector('.lv-found'); if (!f) return;
      var r = f.parentElement.getBoundingClientRect(), w = Math.min(680, window.innerWidth - 24);
      f.style.width = w + 'px'; f.style.left = Math.min(0, window.innerWidth - 12 - w - r.left) + 'px';
    },
    render: function () {
      boot();
      var lv = live(), key = lv.cid + '/' + lv.sid + '/' + (S.notStarted ? '-' : lv.scene);
      if (key !== S.sceneKey) { S.sceneKey = key; S.board = null; S.notesOpen = false; }
      var mode = layoutFor();
      return '<div class="lv">' + top() + onAir() + '<div class="lv-cols c' + mode + '" data-scroll="lv-page">' + LAYOUT[mode].map(function (ids) {
        var trays = mode === 3 && /^(ss|cp)/.test(ids[0]);
        return '<div class="col' + (trays ? ' lv-c-trays' : '') + '">' + groups(ids).map(function (g) {
          if (!g.scope) return PANES[g.ids[0]](mode === 1);
          // A tray per scope: the session's boxes on a filled tray, the campaign's on an outlined one (Should 6).
          return '<div class="lv-grp lv-grp-' + g.scope + '"><p class="lv-grp-h" aria-hidden="true">' + (g.scope === 'ss' ? 'This session' : 'Whole campaign') + '</p>' + g.ids.map(function (id) { return PANES[id](mode === 1); }).join('') + '</div>';
        }).join('') + '</div>';
      }).join('') + '</div></div>';
    }
  });

  /* ---------- menus ---------- */
  L.acts.lvsessrename = function () { L.renameSession(sess(), 'lv-sess'); };
  L.acts.lvsessmenu = function (el) {
    L.menu(el, '<button role="menuitem" data-act="lvsessrename">' + L.icon('edit', 's') + '<span class="grow">Rename session</span></button><div class="sep" role="separator"></div>' + D.campaigns.map(function (c) {
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
  // Current scene's ⋯: the rare things (play its music from the top, open it in the planner, edit its pad board).
  L.acts.lvcurmenu = function (el) {
    var sc = scene(), b = keysBoard(); if (!sc) return;
    L.menu(el, '<button role="menuitem" data-act="lvsctop">' + L.icon('playair', 's') + '<span class="grow">Play its music from the top' + esc(inWhere('music')) + '</span></button>' +
      '<a role="menuitem" class="item" href="#/session/' + live().cid + '/' + live().sid + '">' + L.icon('edit', 's') + 'Open in the session planner</a>' +
      (b ? '<a role="menuitem" class="item" href="#/board/' + b.id + '">' + L.icon('grid', 's') + 'Edit the pad board ' + esc(b.name) + '</a>' : ''), sc.name);
  };
  L.acts.lvbotjoin = function (el) { moveBot(el.dataset.id, el.dataset.g, el.dataset.c); };
  L.acts.lvbotmute = function (el) { touched(); L.botMute(el.dataset.id); };
  L.acts.lvkeys = function () { S.keysOpen = !S.keysOpen; L.render(); focusK(S.keysOpen ? 'lv-keys1' : 'lv-keys'); };
  L.acts.lvhelp = function () { closeKeys(false); if (L.openHelp) L.openHelp(); };
  function closeKeys(refocus) { if (!S.keysOpen) return false; S.keysOpen = false; L.render(); if (refocus) focusK('lv-keys'); return true; }
  document.addEventListener('pointerdown', function (e) { if (S.keysOpen && !(e.target.closest && e.target.closest('.lv-keyswrap'))) closeKeys(false); });
  L.inputs.lvkeys1 = function (el) { S.keys1 = el.checked; saveKeys1(); L.render(); focusK('lv-keys1'); L.say('Single-key shortcuts ' + (S.keys1 ? 'on' : 'off')); };
  // Core's Repeat (On air) and Repeat one (a scene's track) change what a room plays: they end older Undo strips too.
  var coreRepeat = L.acts.lanerepeat, coreRep1 = L.acts.rep1, coreJoin = L.botJoin, coreLeave = L.botLeave;
  L.acts.lanerepeat = function (el) { touched(); coreRepeat(el); };
  L.acts.rep1 = function (el) { touched(); coreRep1(el); };
  L.botJoin = function () { touched(); return coreJoin.apply(null, arguments); };
  L.botLeave = function () { touched(); return coreLeave.apply(null, arguments); };
  L.acts.lvboard = function (el) { var sc = el.dataset.scope; if (sc === 'sc') S.board = el.dataset.id; else S['bd' + sc] = el.dataset.id; L.say('Pad board: ' + L.board(el.dataset.id).name); L.render(); };

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
  L.acts.lvundo2 = function () { undo2(); };
  L.acts.lvallsc = function () { S.allScenes = !S.allScenes; L.render(); };
  L.acts.lvsel = function (el) { S.sel = S.sel === el.dataset.sel ? null : el.dataset.sel; L.render(); };
  L.acts.lvnotes = function () { S.notesOpen = !S.notesOpen; L.render(); };
  L.acts.lvfade = function () { touched(); L.fadeAll(3); };
  L.acts.lvstop = function () { touched(); L.stopAll(); };
  function tgArg(el) { return tgOf(el.dataset.tg); }
  L.acts.lvprevt = function (el) { touched(); L.prev(el.dataset.lane, tgArg(el)); };
  L.acts.lvnextt = function (el) { touched(); L.next(el.dataset.lane, tgArg(el)); };
  L.acts.lvpause = function (el) { touched(); var ln = el.dataset.lane, tg = tgArg(el), c = M(tg)[ln]; L.pauseLane(ln, tg); L.say((ln === 'music' ? 'Music ' : 'Ambience ') + (c && c.paused ? 'paused' : 'playing')); };
  L.acts.lvfadeout = function (el) { touched(); L.stopLane(el.dataset.lane, 3, tgArg(el)); L.say((el.dataset.lane === 'music' ? 'Music' : 'Ambience') + ' fading out'); };
  // Up next: × takes one entry out for this evening (a planned track is skipped, an added one goes), with Undo.
  L.acts.lvupx = function (el) {
    var tg = tgArg(el), rm = RM(tg), snap = clone(rm), kind = el.dataset.kind, i = +el.dataset.i, label = el.getAttribute('aria-label').replace(/^Remove /, '').replace(/ from Up next$/, '');
    if (kind === 'plan') rm.skip[el.dataset.key] = true;
    else if (kind === 'pn') rm.pn.splice(i, 1);
    else if (kind === 'pncur') rm.pnCur.ids = rm.pnCur.ids.slice(0, rm.pnCur.at + 1);
    else if (kind === 'qcur') rm.q[i].ids = rm.q[i].ids.slice(0, rm.q[i].at + 1);
    else if (kind === 'aq') aqOf(tg).splice(i, 1);
    else { rm.q.splice(i, 1); if (i < rm.qAt) rm.qAt--; }
    softUndo('Taken out of Up next: ' + label, function () { snap.playing = RM(tg).playing; S.rm[tg] = snap; }, 'room:' + tg, 'lv-upx-0' + (tg === 'table' ? '' : '-' + tg));
    L.render(); focusK(document.querySelector('[data-k="' + el.dataset.k + '"]') ? el.dataset.k : 'lv-undo2');
    L.say('Taken out of Up next: ' + label + '. Undo is available for 8 seconds, or press Ctrl+Z.');
  };
  L.acts.lvupopen = function (el) { var tg = tgArg(el); S.upOpen[tg] = !S.upOpen[tg]; L.render(); focusK(el.dataset.k); };
  L.acts.lvqclear = function (el) {
    var tg = tgArg(el), rm = RM(tg), snap = clone(rm); rm.q = []; rm.pn = []; rm.aq = []; rm.qAt = -1;
    softUndo('Cleared what you added', function () { snap.playing = RM(tg).playing; S.rm[tg] = snap; }, 'room:' + tg, 'lv-qclear' + (tg === 'table' ? '' : '-' + tg));
    L.render(); focusK('lv-undo2'); L.say('Cleared what you added. Undo is available for 8 seconds, or press Ctrl+Z.');
  };
  L.acts.lvto = function (el) {
    var box = el.dataset.box, cur = boxTo(box);
    L.menu(el, '<div class="group">' + esc(BOXNAMES[box]) + ' plays in</div>' + rooms().map(function (r) {
      var id = r.bots[0].id; return '<button role="menuitemradio" aria-checked="' + (cur === id) + '" data-act="lvtoset" data-box="' + box + '" data-v="' + id + '">' + (cur === id ? L.icon('check', 's') : '<span style="width:14px"></span>') + esc(r.name) + '</button>';
    }).join('') + '<button role="menuitemradio" aria-checked="' + (cur === 'all') + '" data-act="lvtoset" data-box="' + box + '" data-v="all">' + (cur === 'all' ? L.icon('check', 's') : '<span style="width:14px"></span>') + 'All rooms</button>', 'Where ' + BOXNAMES[box] + ' plays');
  };
  L.acts.lvtoset = function (el) { S.to[el.dataset.box] = el.dataset.v; L.say(BOXNAMES[el.dataset.box] + ' now plays in ' + toName(el.dataset.box)); L.render(); };
  L.inputs.lvvol = function (el, ev) {
    var b = L.bot(el.dataset.id); if (!b) return;
    if (ev && ev.type === 'input') { b.volume = +el.value; el.setAttribute('aria-valuetext', el.value + ' percent'); el.title = 'Volume ' + el.value + '%'; return; }
    touched(); L.botVolume(b.id, el.value);
  };
  function channelItems(b, act) {
    var best = busiestChannel();
    return D.discord.servers.map(function (g) {
      return '<div class="group">' + esc(g.name) + '</div>' + g.channels.map(function (c) {
        var here = b.status !== 'idle' && b.server === g.id && b.channel === c.id, taken = L.bots().some(function (x) { return x !== b && x.status !== 'idle' && x.server === g.id && x.channel === c.id; });
        return '<button role="menuitemradio" aria-checked="' + here + '" data-act="' + act + '" data-id="' + b.id + '" data-g="' + g.id + '" data-c="' + c.id + '"' + (here || taken ? ' disabled' : '') + '>' +
          (here ? L.icon('check', 's') : '<span style="width:14px"></span>') + '<span class="grow ellipsis">' + esc(c.name) + '</span>' +
          // Must 2 (c): where the players are is marked, and a channel with nobody in it says so.
          (taken ? '<span class="faint">a room already</span>' : !c.members.length ? '<span class="faint">empty</span>' : '<span class="faint">' + people(c.members.length) + (best && best.c === c ? ' · players' : '') + '</span>') + '</button>';
      }).join('');
    }).join('');
  }
  // OUT-7: the room's bot button: the channel it plays in (one click moves it), another bot for this channel, copy what
  // another room plays, the Rooms screen, and Settings for tokens and new bots.
  L.acts.lvroommenu = function (el) {
    var b = L.bot(el.dataset.id); if (!b) return; var name = L.outputName(b);
    var others = rooms().filter(function (r) { return r.bots[0] !== b && (r.mix.music || r.mix.amb); }), free = L.freeBots ? L.freeBots() : [];
    L.menu(el, '<div class="group">' + esc(b.name) + ' plays in</div>' + channelItems(b, 'lvbotjoin') +
      (free.length ? '<div class="sep"></div><div class="group">Another bot for ' + esc(name) + '</div>' + free.map(function (f) { return '<button role="menuitem" data-act="lvbotswap" data-from="' + b.id + '" data-to="' + f.id + '">' + L.icon('users', 's') + esc(f.name) + '</button>'; }).join('') : '') +
      '<div class="sep"></div>' + others.map(function (r) { return '<button role="menuitem" data-act="lvcopyroom" data-from="' + r.bots[0].id + '" data-to="' + b.id + '">' + L.icon('loop', 's') + 'Copy what ' + esc(r.name) + ' is playing</button>'; }).join('') +
      '<a role="menuitem" class="item" href="#/outputs">' + L.icon('users', 's') + 'Rooms</a><a role="menuitem" class="item" href="#/settings">' + L.icon('gear', 's') + 'Bots and tokens</a>', 'Room ' + name);
  };
  /* Must 2 (b): moving a bot from the room menu takes one click and asks nothing, so it gets the same 8-second Undo
     as Kick when the players there were hearing something. */
  function moveBot(id, g, cid) {
    var b = L.bot(id), c = L.channel(g, cid); if (!b || !c) return;
    var tg = tgOf(b.id), m = M(tg), from = { server: b.server, channel: b.channel, status: b.status }, wasName = b.status !== 'idle' ? L.outputName(b) : '';
    var lost = b.status !== 'idle' && L.botListeners(b).length > 0 && ((m.music && !m.music.paused) || (m.amb && !m.amb.paused));
    L.botJoin(b.id, g, cid);
    if (lost) {
      softUndo(b.name + ' moved from ' + wasName + ' to ' + c.name, function () { L.botJoin(b.id, from.server, from.channel); }, 'room:' + tg, 'lv-room-' + b.id);
      L.render(); L.say(b.name + ' is joining ' + c.name + '. Undo is available for 8 seconds, or press Ctrl+Z.');
    }
  }
  // Kick at once; if the players there were hearing something, Undo (8 s, or Ctrl+Z) puts the bot back with it.
  L.acts.lvkick = function (el) {
    var b = L.bot(el.dataset.id); if (!b) return; touched(); var room = L.outputName(b), k = L.botKick(b.id); if (!k) return;
    if (k.lost) softUndo(b.name + ' left ' + room, function () { k.restore(); }, 'onair', 'lv-room-' + b.id);
    L.render(); L.say(b.name + ' left ' + room + (k.lost ? '. Undo is available for 8 seconds, or press Ctrl+Z.' : ''));
    focusK(k.lost ? 'lv-undo2' : rooms().length ? 'lv-room-' + rooms()[0].bots[0].id : 'lv-addroom');
  };
  // Another bot takes over this channel: the new one joins, the old one leaves, and what played here goes on.
  L.acts.lvbotswap = function (el) {
    var a = L.bot(el.dataset.from), f = L.bot(el.dataset.to); if (!a || !f) return; touched(); var sid = a.server, cid = a.channel, from = M(tgOf(a.id)), keep = ['music', 'amb'].map(function (ln) { var c = from[ln]; return c ? { ln: ln, c: laneCopy(c) } : null; }).filter(Boolean);
    quiet(function () { L.botLeave(a.id); L.botJoin(f.id, sid, cid); keep.forEach(function (x) { L.play(x.c.id, { lane: x.ln, playlistId: x.c.playlistId, place: x.c.place, seq: x.c.seq, fade: 1, target: f.id }); var d = M(tgOf(f.id))[x.ln]; if (d) d.pos = x.c.pos; }); });
    L.say(f.name + ' now plays in ' + L.channel(sid, cid).name);
  };
  L.acts.lvcopyroom = function (el) {
    var from = tgOf(el.dataset.from), to = tgOf(el.dataset.to), src = M(from); touched();
    quiet(function () { ['music', 'amb'].forEach(function (ln) { var c = src[ln]; if (c) { L.play(c.id, { lane: ln, playlistId: c.playlistId, place: c.place, fade: 2, seq: c.seq, target: to }); var d = M(to)[ln]; if (d) d.pos = c.pos; } else L.stopLane(ln, 2, to); }); });
    L.say(roomName(to) + ' now plays what ' + roomName(from) + ' plays'); L.render();
  };
  L.acts.lvaddroom = function (el) {
    var idle = L.bots().filter(function (b) { return b.status === 'idle'; });
    // OUT-8: a new bot is made in Settings (the menu's last item).
    L.menu(el, (idle.map(function (b) { return '<div class="group">' + esc(b.name) + ' joins…</div>' + channelItems(b, 'lvaddjoin'); }).join('') || '<div class="item muted">Every bot is in a room.</div>') +
      '<div class="sep"></div><a role="menuitem" class="item" href="#/settings">' + L.icon('plus', 's') + 'New bot…</a>', 'Add a room');
  };
  L.acts.lvaddjoin = function (el) {
    var b = L.bot(el.dataset.id), c = L.channel(el.dataset.g, el.dataset.c); if (!b || !c) return;
    L.botJoin(b.id, el.dataset.g, el.dataset.c);
    // UX-R9: a channel nobody is in says so in the room's own words.
    var msg = c.members.length ? c.name + ' is joining. It starts silent: choose To: ' + c.name + ' in a box to play there.' : c.name + ' is joining: nobody there.'; L.say(msg); L.toast(msg);
  };
  L.acts.lvfxstop = function (el) { touched(); var tg = el && el.dataset.tg; if (!tg) { L.stopFx(); return; } L.fxFor(tg).forEach(function (f) { f.fadeOut = .8; }); L.changed(); L.say('Effects stopped in ' + roomName(tg)); };
  L.acts.lvpvstop = function () { L.stopPreview(); L.say('Preview stopped'); };
  function seqOf(el) { return el.dataset.at != null && +el.dataset.at > -1 ? { cid: live().cid, sid: live().sid, scene: +el.dataset.sc, at: +el.dataset.at } : null; }
  /* Play on air: a playlist, a scene's track or a track from a list is a new plan for the room; a single track on its
     own (Find, a session's single tracks) plays now and the list carries on after it, as Play next would. */
  function playMusic(id, pl, seq, tg, place, name) {
    var rm = RM(tg), c = M(tg).music;
    if (!pl && !seq && c) {
      if (rm.now === 'plan') rm.ret = posOf(c); else if (rm.now === 'q') rm.ret = { q: true };
      rm.now = 'pn'; rm.pnCur = { ids: [id], at: 0, pl: '', place: place || '', name: name || L.title(L.track(id)) };
      startEntry(itemEntry(rm.pnCur), tg); return;
    }
    rm.now = 'plan'; rm.ret = null; rm.pnCur = null; rm.qAt = -1; M(tg).rep = null;
    startEntry({ id: id, pl: pl || '', place: place || '', seq: seq }, tg);
  }
  L.acts.lvplay = function (el) {
    var t = L.track(el.dataset.id); if (!t) return; touched();
    eachTo(el.dataset.box || 'music', function (tg) {
      if (t.kind === 'fx') L.play(t.id, { target: tg }); // layers over the music, like a pad
      else if (t.kind === 'amb') L.play(t.id, { lane: 'amb', playlistId: el.dataset.pl || '', fade: 3, target: tg });
      else playMusic(t.id, el.dataset.pl, seqOf(el), tg, el.dataset.place || '');
    });
  };
  L.acts.lvsctop = function () { touched(); var sc = scene(), q = sc ? L.sceneSequence(sc) : []; if (q[0]) eachTo('music', function (tg) { playMusic(q[0].trackId, q[0].playlistId, { cid: live().cid, sid: live().sid, scene: sess().scenes.indexOf(sc), at: 0 }, tg); }); };
  L.acts.lvpvpl = function (el) { L.previewPlaylist(el.dataset.id); };
  L.acts.lvtagclear = function () { S.tags = []; L.render(); focusK('lv-q'); L.say('Selected tags cleared'); };
  // Add to queue (the bottom) or Play next (right after the current track) in the box's room(s). A room with nothing
  // playing plays it now.
  function addItem(el, how) {
    var whole = el.dataset.whole && L.playlist(el.dataset.whole), t = !whole && L.track(el.dataset.id); if (!whole && !t) return;
    var place = el.dataset.place || (whole ? placeOfPl(whole.id) : ''), ids = whole ? L.orderedTracks(whole.id, place).map(function (x) { return x.id; }) : [t.id];
    if (!ids.length) { L.toast('This playlist has no tracks yet'); return; }
    var name = whole ? whole.name : L.nameIn(t, place), added = [], items = [], started = false, box = el.dataset.box || 'music';
    if (el.dataset.lane === 'amb') { addAmb(el, how, { ids: ids.slice(0, 1), at: 0, pl: whole ? whole.id : el.dataset.pl || '', place: place, name: name }, box); return; }
    eachTo(box, function (tg) {
      if (!M(tg).music) { playMusic(ids[0], whole ? whole.id : el.dataset.pl, whole ? null : seqOf(el), tg, place, name); started = true; return; }
      var rm = RM(tg), snap = clone(rm), it = { ids: ids.slice(), at: 0, pl: whole ? whole.id : '', place: place, name: name };
      if (!whole && el.dataset.from != null && el.dataset.from !== '') it.from = +el.dataset.from;
      if (how === 'next') {
        // While a Play next playlist plays, the new item goes before the rest of it.
        if (rm.now === 'pn' && rm.pnCur && rm.pnCur.at < rm.pnCur.ids.length - 1) { var p = rm.pnCur; rm.pn.unshift({ ids: p.ids.slice(p.at + 1), at: 0, pl: p.pl, place: p.place, name: p.name }); p.ids = p.ids.slice(0, p.at + 1); }
        // Play next of the track the plan would play next anyway: it plays once, not twice (taken out of the plan there).
        var nextPlan = upcoming(tg).filter(function (u) { return u.kind === 'plan'; })[0];
        if (nextPlan && ids.length === 1 && nextPlan.e.id === ids[0] && !rm.pn.length) rm.skip[nextPlan.e.key] = true;
        rm.pn.unshift(it);
      } else rm.q.push(it);
      added.push({ tg: tg, snap: snap }); items.push(it);
    });
    var verb = how === 'next' ? 'Plays next' : 'Added to the queue';
    if (added.length) {
      softUndo(verb + ': ' + name, function () { added.forEach(function (a) { a.snap.playing = RM(a.tg).playing; S.rm[a.tg] = a.snap; }); }, 'room:' + added[0].tg, el.dataset.k, items);
      L.say(verb + (rooms().length > 1 ? ' in ' + toName(box) : '') + ': ' + name + '. Undo is available for 8 seconds, or press Ctrl+Z.');
    } else if (started) L.say('Playing now: ' + name);
    L.render();
  }
  // An ambience waits for Next on the room's ambience (aq); with no ambience playing it plays now.
  function addAmb(el, how, item, box) {
    var added = [], started = false;
    touched();
    eachTo(box, function (tg) {
      if (!M(tg).amb) { L.play(item.ids[0], { lane: 'amb', playlistId: item.pl, place: item.place, fade: 3, target: tg }); started = true; return; }
      var rm = RM(tg), snap = clone(rm), it = clone(item);
      if (how === 'next') aqOf(tg).unshift(it); else aqOf(tg).push(it);
      added.push({ tg: tg, snap: snap });
    });
    if (added.length) {
      var verb = how === 'next' ? 'Ambience next' : 'Ambience added to the queue';
      softUndo(verb + ': ' + item.name, function () { added.forEach(function (a) { a.snap.playing = RM(a.tg).playing; S.rm[a.tg] = a.snap; }); }, 'room:' + added[0].tg, el.dataset.k);
      L.say(verb + (rooms().length > 1 ? ' in ' + toName(box) : '') + ': ' + item.name + '. It plays when you press Next on the ambience. Undo is available for 8 seconds, or press Ctrl+Z.');
    } else if (started) L.say('Ambience now: ' + item.name);
    L.render();
  }
  L.acts.lvqueue = function (el) { addItem(el, 'queue'); };
  L.acts.lvplaynext = function (el) { addItem(el, 'next'); };
  L.acts.lvpv = function (el) { L.preview(el.dataset.id); };
  L.inputs.lvq = function (el) { S.q = el.value; S.findOpen = true; L.render(); };
  L.acts.lvtag = function (el) {
    var g = el.dataset.g, v = el.dataset.v;
    if (tagOn(g, v)) S.tags = S.tags.filter(function (x) { return !(x.g === g && x.v === v); }); else S.tags.push({ g: g, v: v });
    L.render(); // UX-R7: the count is read out by L.sayWhenSettled once the picking pauses
  };
  L.acts.lvmoretags = function () { S.moreTags = !S.moreTags; L.render(); };
  L.acts.lvlane = function (el) { S.lane = el.dataset.v; L.render(); };
  L.acts.lvclear = function () { S.q = ''; S.tags = []; L.render(); focusK('lv-q'); L.say('Search cleared'); };
  // Pads go to their box's room. With "All rooms", a pad that sounds anywhere stops everywhere.
  function firePads(bid, pid, phase, box) {
    var b = L.board(bid), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === pid; })[0]; if (!p) return;
    var tgs = targetsOf(box || 'music'), ref = bid + '/' + pid; if (phase !== 'up') touched();
    function onIn(tg) { return L.fxFor(tg).some(function (f) { return f.ref === ref && !f.fadeOut; }); }
    if (tgs.length > 1 && phase !== 'up') { var any = tgs.some(onIn); tgs.forEach(function (tg) { if (!any || onIn(tg)) L.firePad(bid, pid, phase, tg); }); return; }
    tgs.forEach(function (tg) { L.firePad(bid, pid, phase, tg); });
  }
  L.acts.lvpad = function (el) { firePads(el.dataset.bid, el.dataset.pid, undefined, el.dataset.box); };
  L.acts.lvpadstop = function (el) { var k = el.dataset.k; touched(); L.stopPads(); L.say('Pads stopped'); if (k === 'lv-padstop') focusK(document.querySelector('.lv-cur-pads .lv-pad') ? document.querySelector('.lv-cur-pads .lv-pad').dataset.k : 'pane-lv-current'); };

  /* ---------- keys and hold-to-play ---------- */
  function onLive() { return L.current().name === 'live'; }
  function keyName(e) { return e.key.length === 1 ? e.key.toLowerCase() : /^F([1-9]|1[0-2])$/.test(e.key) ? e.key.toLowerCase() : ''; }
  function padFor(key) { var b = keysBoard(); var p = b && L.boardPads(b).filter(function (x) { return x && x.key && String(x.key).toLowerCase() === key; })[0]; return p ? { b: b.id, p: p } : null; }
  // F6 moves between boxes unless a pad of the Current scene's board has F6 as its key (pad keys F1 to F12 win in Live).
  L.f6Taken = function () { return onLive() && S.keys1 && !!padFor('f6'); };
  function focusSearch() { S.findOpen = true; L.render(); var q = document.querySelector('[data-k="lv-q"]'); if (q) { q.focus(); q.select(); } }
  function goBox(n) {
    var id = BOXES[n], t = document.querySelector('[data-k="pane-' + id + '"]'); if (!t) return false;
    t.focus(); t.scrollIntoView({ block: 'nearest' }); L.say(t.textContent.trim() + (t.getAttribute('aria-expanded') === 'false' ? ', folded' : ''));
    return true;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab') S.keyNav = true; }, true);
  document.addEventListener('pointerdown', function () { S.keyNav = false; }, true);
  /* Round 7 part 2 (UX-12): Next scene, Fade everything out, Undo and Find a track use the keys in Settings › Keyboard
     shortcuts (r7shell.js L.keyFor; Lyre's keys are Space, Shift+Esc, Ctrl+Z and /). With the guard on (the default),
     a second Next scene key within a second is ignored, so a double press or a bouncing key never skips a scene. */
  function isKey(e, id) { return L.keyFor && L.keyName ? L.keyName(e) === L.keyFor(id) : false; }
  function singleKey(id) { var k = L.keyFor ? L.keyFor(id) : ''; return !/^(Ctrl|Alt)\+/.test(k) && !/^F\d/.test(k); }
  function nextSceneKey() {
    var now = Date.now();
    if (L.keyGuard !== false && now - S.lastNextKey < 1000) { L.say('A second Next scene within a second: ignored'); return; }
    S.lastNextKey = now; nextScene();
  }
  L.onKey(function (e) {
    if (!onLive()) return false;
    var t = e.target, a = document.activeElement, typing = L.typing(t);
    // Alt+1 … Alt+7: straight to a box, in the order the boxes are named in Keys.
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-7]$/.test(e.code)) return goBox(+e.code.slice(5) - 1);
    if (e.altKey) return false;
    // Shift+Esc fades everything, even from a text box: two keys, so it is never pressed by accident.
    if (isKey(e, 'fadeAll')) { closeKeys(false); L.fadeAll(3); return true; }
    if (e.key === 'Escape' && S.keysOpen) { closeKeys(true); return true; }
    if (isKey(e, 'undo') && !typing) return undo();
    if (isKey(e, 'nextScene') && !singleKey('nextScene')) { if (!e.repeat) nextSceneKey(); return true; }
    if (e.ctrlKey || e.metaKey) return false;
    if (typing) {
      // Esc in Find a track clears it; with nothing typed, it closes the results.
      if (e.key === 'Escape' && t.dataset.k === 'lv-q') { if (t.value || S.tags.length) { S.q = ''; S.tags = []; L.render(); } else { closeFind(false); /* UX-R4: focus stays in the field */ } return true; }
      return false;
    }
    if (e.key === 'Escape') { if (S.findOpen) { closeFind(true); return true; } if (S.q || S.tags.length) { S.q = ''; S.tags = []; L.render(); L.say('Search cleared'); return true; } return false; }
    // SHW-7: Right unfolds the scene whose name has focus, Left folds it.
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && a && a.matches && a.matches('.lv-sc-name')) {
      var si = +a.dataset.i, want = e.key === 'ArrowRight'; if (!!S.scOpen[si] !== want) { S.scOpen[si] = want; L.render(); focusK('lv-scn-' + si); } return true;
    }
    var onControl = a && a !== document.body && a.matches('button, a, [role="menuitem"]');
    if (e.key === ' ' || e.key === 'Enter') {
      // A hold pad reached with the keyboard: play while the key is down.
      if (a && a.matches('.lv-pad[data-mode="hold"]') && (e.key === 'Enter' || S.keyNav)) { if (!e.repeat) { S.keyHeld[e.key] = { b: a.dataset.bid, p: a.dataset.pid, box: a.dataset.box }; firePads(a.dataset.bid, a.dataset.pid, 'down', a.dataset.box); } return true; }
      if (e.key === 'Enter' || !S.keys1 || !isKey(e, 'nextScene')) { if (e.key === 'Enter' || !S.keys1) return false; }
      else { if (onControl && S.keyNav) return false; if (!e.repeat) nextSceneKey(); return true; } // Space presses a button you tabbed to
    }
    if (!S.keys1) return false;
    if (isKey(e, 'nextScene')) { if (onControl && S.keyNav && e.key === ' ') return false; if (!e.repeat) nextSceneKey(); return true; }
    if (isKey(e, 'find')) { focusSearch(); return true; }
    var kn = keyName(e);
    if (kn) {
      var hit = padFor(kn); if (!hit) return false;
      if (!e.repeat) { S.keyHeld[kn] = { b: hit.b, p: hit.p.id, box: 'music' }; firePads(hit.b, hit.p.id, 'down', 'music'); }
      return true;
    }
    return false;
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key === ' ' || e.key === 'Enter' ? e.key : keyName(e), h = S.keyHeld[k];
    if (!h) return; delete S.keyHeld[k];
    var b = L.board(h.b), p = b && b.slots.filter(function (x) { return x && x.id === h.p; })[0];
    if (p && p.mode === 'hold') { e.preventDefault(); firePads(h.b, h.p, 'up', h.box); }
  });
  document.addEventListener('pointerdown', function (e) {
    var p = e.target.closest && e.target.closest('.lv-pad[data-mode="hold"]'); if (!p || e.button > 0) return;
    e.preventDefault(); S.holding = { b: p.dataset.bid, p: p.dataset.pid, box: p.dataset.box, k: p.dataset.k }; firePads(S.holding.b, S.holding.p, 'down', S.holding.box);
    focusK(S.holding.k);
  });
  function release() { if (S.holding) { var h = S.holding; S.holding = null; firePads(h.b, h.p, 'up', h.box); } }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  window.addEventListener('blur', function () {
    release();
    Object.keys(S.keyHeld).forEach(function (k) { var h = S.keyHeld[k], b = L.board(h.b), p = b && b.slots.filter(function (x) { return x && x.id === h.p; })[0]; delete S.keyHeld[k]; if (p && p.mode === 'hold') firePads(h.b, h.p, 'up', h.box); });
  });
})();
