/* Round 7, playback (ROUND7.md): one model for every trigger (PLY-8), tracks behave as tagged (PLY-4), markers
   (DAT-3), automatic hand-overs (SHW-3) and what played (PLY-1).

   PLY-8 steps. A scene's start and a pad are a list of steps, run in order. Out of sight until wanted: the usual
   steps are not stored or shown; the scene's ⋯ › What it does when it starts… and the pad's What it does… open them.
     { do: 'music', what }        the scene's music from item `what` on (then the rest of its music)
     { do: 'amb', what }          the scene's ambience
     { do: 'pads', what }         show that pad board
     { do: 'sound' }              a pad's own sound, in its play mode
     { do: 'play', what }         play a track or playlist ('pl:<id>' or a track id)
     { do: 'stop', what }         'music' | 'amb' | 'all'
     { do: 'fade', level, secs }  the music to level % over secs
     { do: 'wait', secs }
     { do: 'pad', what }          fire '<board>/<pad>'
     { do: 'scene', what }        start '<cid>/<sid>/<index>'
   Play steps (music, play) also have how ('xfade' with the Settings crossfade, 'cut', 'end' when the current track
   ends, 'mixout' at its mix-out marker, 'loop' after the current loop), queue ('replace' what plays, 'next' Play next,
   'end' Add to queue) and from (a marker's time, or the start). A scene has then: 'stay' (until Next), 'end' (start the
   next scene when its music ends) or 'after' (start it after `afterMin` minutes). Data: scene.steps, scene.then,
   scene.afterMin; pad.steps. Cue lists (SHW-1), shortcuts and remote control later store the same steps.

   PLY-4: a Sting never loops; a Loop bed always loops (between its Loop and End handles, the loop in and loop out);
   Ending "Fades out" fades before the end (the Audio profile's fade out, 4 s unless set there); "Pick up where it
   stopped" starts it again where it was last stopped. Data: track.ending, track.resume, D.resumeAt[trackId].
   SHW-3: track.follow (a playlist id or a track id) plays when the track ends, unless something is already waiting:
   inside a scene the scene's next item comes first; in Live, Play next and the queue come first.
   DAT-3: a marker can be the mix-out point (marker.mix); Play on air from a marker; markers show on the Now playing
   bar's progress line.
   PLY-1: every room keeps what played tonight (D.played[room], newest first), with Play again and Play next; the
   Now playing bar's What played button shows it (Live's On air gets the same button after the merge). */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- PLY-8 the steps ---------- */
  function scOf(ref) { var a = ref.split('/'), s = L.session(a[0], a[1]), i = s ? s.scenes.map(function (x) { return x.id; }).indexOf(a[2]) : -1; return i < 0 ? null : { c: a[0], s: s, sc: s.scenes[i], i: i }; }
  function padOf(ref) { var a = ref.split('/'), b = L.board(a[0]), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === a[1]; })[0]; return p ? { b: b, p: p } : null; }
  function usual(what, ref) {
    if (what === 'pad') return [{ do: 'sound' }];
    var sc = scOf(ref).sc, out = [];
    if (sc.music[0]) out.push({ do: 'music', what: sc.music[0], how: 'xfade', queue: 'replace', from: '' });
    if (sc.amb) out.push({ do: 'amb', what: sc.amb });
    if (L.sceneBoards(sc)[0]) out.push({ do: 'pads', what: L.sceneBoards(sc)[0] });
    return out;
  }
  L.stepsOf = function (what, ref) { var o = what === 'pad' ? padOf(ref).p : scOf(ref).sc; return o.steps || usual(what, ref); };
  function itemName(id) { if (!id) return ''; var p = L.playlist(id); if (p) return p.name; var t = L.track(id); return t ? L.title(t) : ''; }
  function padName(ref) { var x = ref && padOf(ref); return x ? x.b.name + ' › ' + x.p.label : ''; }
  function sceneName(ref) { var a = (ref || '').split('/'), s = L.session(a[0], a[1]), sc = s && s.scenes[+a[2]]; return sc ? sc.name : ''; }
  var HOW = [['xfade', 'Crossfade (Settings)'], ['cut', 'Cut'], ['end', 'When the current track ends'], ['mixout', 'At the mix-out marker'], ['loop', 'After the current loop']];
  var QUEUE = [['replace', 'Replace what plays'], ['next', 'Play next'], ['end', 'Add to queue']];
  function sentence(st) {
    switch (st.do) {
      case 'music': return 'Play the music: ' + itemName(st.what);
      case 'amb': return 'Play the ambience: ' + itemName(st.what);
      case 'pads': return 'Show the pads: ' + ((L.board(st.what) || {}).name || '');
      case 'sound': return 'Play its sound';
      case 'play': return 'Play ' + (itemName(st.what) || '…');
      case 'stop': return { music: 'Stop the music', amb: 'Stop the ambience', all: 'Stop everything' }[st.what || 'music'];
      case 'fade': return 'Fade the music to ' + st.level + '% over ' + st.secs + ' s';
      case 'wait': return 'Wait ' + st.secs + ' s';
      case 'pad': return 'Fire a pad: ' + (padName(st.what) || '…');
      case 'scene': return 'Start the scene: ' + (sceneName(st.what) || '…');
    }
    return '';
  }
  function words(steps) { return steps.map(sentence).join(', then '); }
  function sel(i, f, label, opts, cur) {
    var id = 'stp-' + i + '-' + f;
    return '<span class="stp-f"><label for="' + id + '">' + label + '</label><select class="input" id="' + id + '" data-input="stpf" data-i="' + i + '" data-f="' + f + '" data-k="' + id + '">' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></span>';
  }
  function playables() {
    return D.playlists.filter(function (p) { return p.lane === 'music'; }).map(function (p) { return [p.id, p.name + ' (playlist)']; })
      .concat(D.tracks.filter(function (t) { return t.kind !== 'amb'; }).map(function (t) { return [t.id, L.title(t)]; }));
  }
  function pads() { var o = []; D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (p) { if (p) o.push([b.id + '/' + p.id, b.name + ' › ' + p.label]); }); }); return o; }
  function scenes() { var o = []; D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc, i) { o.push([c.id + '/' + s.id + '/' + i, 'Session ' + s.n + ' › ' + sc.name]); }); }); }); return o; }
  function markersOf(id) { var t = L.track(id); return t ? L.profileOf(t).markers : []; }
  function controls(st, i) {
    var h = '';
    if (st.do === 'play') h += sel(i, 'what', 'What', [['', 'Choose…']].concat(playables()), st.what || '');
    if (st.do === 'music' || st.do === 'play') {
      h += sel(i, 'how', 'How it comes in', HOW, st.how || 'xfade') + sel(i, 'queue', 'Up next', QUEUE, st.queue || 'replace');
      var ms = markersOf(st.what); if (ms.length) h += sel(i, 'from', 'From', [['', 'The start']].concat(ms.map(function (m) { return [m.at, m.label + ' (' + L.fmt(m.at) + ')']; })), st.from || '');
    }
    if (st.do === 'stop') h += sel(i, 'what', 'What', [['music', 'The music'], ['amb', 'The ambience'], ['all', 'Everything']], st.what || 'music');
    if (st.do === 'fade') h += sel(i, 'level', 'Level', [[0, '0%'], [10, '10%'], [20, '20%'], [30, '30%'], [50, '50%'], [70, '70%'], [100, '100%']], st.level) + sel(i, 'secs', 'Over', [[1, '1 s'], [2, '2 s'], [3, '3 s'], [5, '5 s'], [8, '8 s']], st.secs);
    if (st.do === 'wait') h += sel(i, 'secs', 'Wait', [[1, '1 s'], [2, '2 s'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min']], st.secs);
    if (st.do === 'pad') h += sel(i, 'what', 'Pad', [['', 'Choose…']].concat(pads()), st.what || '');
    if (st.do === 'scene') h += sel(i, 'what', 'Scene', [['', 'Choose…']].concat(scenes()), st.what || '');
    return h ? '<div class="stp-ctl">' + h + '</div>' : '';
  }
  var ED = null;
  function edBody() {
    var n = ED.steps.length;
    var list = '<ol class="stp-list" aria-label="Steps">' + ED.steps.map(function (st, i) {
      return '<li class="stp"><div class="stp-1"><span class="num stp-n" aria-hidden="true">' + (i + 1) + '</span><span class="grow stp-s">' + esc(sentence(st)) + '</span>' +
        '<button class="btn s icon ghost" data-act="stpmove" data-i="' + i + '" data-by="-1" data-k="stp-up-' + i + '" aria-label="Move up" title="Move up"' + (i ? '' : ' disabled') + '>' + L.icon('chevup', 's') + '</button>' +
        '<button class="btn s icon ghost" data-act="stpmove" data-i="' + i + '" data-by="1" data-k="stp-dn-' + i + '" aria-label="Move down" title="Move down"' + (i < n - 1 ? '' : ' disabled') + '>' + L.icon('chevdown', 's') + '</button>' +
        '<button class="btn s icon ghost" data-act="stprm" data-i="' + i + '" data-k="stp-rm-' + i + '" aria-label="Remove" title="Remove this step">' + L.icon('close', 's') + '</button></div>' + controls(st, i) + '</li>';
    }).join('') + '</ol>';
    var add = '<button class="btn s" data-act="stpadd" data-k="stp-add" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add a step</button>';
    var then = ED.what === 'scene' ? '<div class="field stp-then"><label for="stp-then">Then</label><select class="input" id="stp-then" data-input="stpthen" data-k="stp-then">' +
      [['stay', 'Stay on this scene until you press Next'], ['end', 'Start the next scene when its music ends'], ['after', 'Start the next scene after 5 minutes']].map(function (o) {
        return '<option value="' + o[0] + '"' + (ED.then === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' : '';
    return list + '<div class="row-flex stp-tools">' + add + '<button class="btn s ghost" data-act="stpusual" data-k="stp-usual">' + L.icon('restart', 's') + 'Put back the usual</button></div>' + then;
  }
  function repaint(k) {
    var b = document.querySelector('#lyre-sheet .body'); if (!b) return;
    var a = document.activeElement, keep = k || (a && a.dataset && a.dataset.k); b.innerHTML = edBody();
    var f = keep && b.querySelector('[data-k="' + keep + '"]'); if (f && !f.disabled) f.focus(); else { var g = b.querySelector('[data-k="stp-add"]'); if (g) g.focus(); }
  }
  L.stepsItem = function (what, ref) { return '<button role="menuitem" data-act="stepsopen" data-what="' + what + '" data-ref="' + esc(ref) + '">' + L.icon('list', 's') + 'What it does…</button>'; };
  L.sceneMarks = function (sc) {
    var m = '';
    if (sc.then && sc.then !== 'stay') m += '<span class="badge r7-mark" title="' + (sc.then === 'end' ? 'Starts the next scene when its music ends' : 'Starts the next scene after ' + (sc.afterMin || 5) + ' minutes') + '">' + L.icon('next', 's') + 'Moves on by itself</span>';
    if (sc.steps) m += '<span class="badge r7-mark" title="' + esc(words(sc.steps)) + '">' + L.icon('list', 's') + 'Own start</span>';
    return m;
  };
  L.acts.stepsopen = function (el) {
    var what = el.dataset.what, ref = el.dataset.ref, o = what === 'pad' ? padOf(ref).p : scOf(ref).sc;
    ED = { what: what, ref: ref, steps: JSON.parse(JSON.stringify(L.stepsOf(what, ref))), then: o.then || 'stay' };
    var title = what === 'pad' ? 'When ' + o.label + ' is pressed' : 'When ' + o.name + ' starts';
    L.sheet({ title: title, describe: 'Lyre does these in order. Each play step says how it comes in and what happens to Up next.', body: edBody(), wide: true,
      footer: '<button class="btn" data-act="stptry" data-k="stp-try">' + L.icon('headphones', 's') + 'Try in headphones</button><span class="grow"></span><button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="stpdone" data-k="stp-done">Done</button>' });
  };
  L.inputs.stpf = function (el) { var st = ED.steps[+el.dataset.i], f = el.dataset.f; st[f] = /^(level|secs)$/.test(f) ? +el.value : el.value; repaint(el.dataset.k); };
  L.inputs.stpthen = function (el) { ED.then = el.value; };
  L.acts.stpmove = function (el) { var i = +el.dataset.i, j = i + +el.dataset.by, s = ED.steps; if (j < 0 || j >= s.length) return; var x = s.splice(i, 1)[0]; s.splice(j, 0, x); repaint('stp-' + (+el.dataset.by < 0 ? 'up-' : 'dn-') + j); L.say('Step moved to ' + (j + 1)); };
  L.acts.stprm = function (el) { ED.steps.splice(+el.dataset.i, 1); repaint('stp-add'); L.say('Step removed'); };
  L.acts.stpusual = function () { ED.steps = usual(ED.what, ED.ref); ED.then = 'stay'; repaint('stp-usual'); L.say('The usual steps are back'); };
  var NEW = { play: { do: 'play', what: '', how: 'xfade', queue: 'replace', from: '' }, stop: { do: 'stop', what: 'music' }, fade: { do: 'fade', level: 30, secs: 2 }, wait: { do: 'wait', secs: 5 }, pad: { do: 'pad', what: '' }, scene: { do: 'scene', what: '' } };
  L.acts.stpadd = function (el) {
    L.menu(el, [['play', 'Play…', 'play'], ['stop', 'Stop…', 'stop'], ['fade', 'Fade the music…', 'fade'], ['wait', 'Wait…', 'restart'], ['pad', 'Fire a pad…', 'grid'], ['scene', 'Start a scene…', 'next']].map(function (x) {
      return '<button role="menuitem" data-act="stpnew" data-v="' + x[0] + '">' + L.icon(x[2], 's') + x[1] + '</button>'; }).join(''), 'Add a step');
  };
  L.acts.stpnew = function (el) { ED.steps.push(JSON.parse(JSON.stringify(NEW[el.dataset.v]))); var i = ED.steps.length - 1; setTimeout(function () { repaint(document.querySelector('#lyre-sheet [data-k="stp-' + i + '-what"]') ? 'stp-' + i + '-what' : 'stp-rm-' + i); }, 0); L.say('Step ' + (i + 1) + ' added: ' + sentence(ED.steps[i])); };
  L.acts.stptry = function () {
    var st = ED.steps.filter(function (x) { return (x.do === 'music' || x.do === 'play') && x.what; })[0];
    if (ED.what === 'pad' && !st) { var x = padOf(ED.ref); L.previewPad(x.b.id, x.p.id); return; }
    if (!st) { L.toast('No step plays anything yet'); return; }
    if (L.playlist(st.what)) L.previewPlaylist(st.what); else L.preview(st.what);
  };
  L.acts.stpdone = function () {
    var e = ED, o = e.what === 'pad' ? padOf(e.ref).p : scOf(e.ref).sc, same = JSON.stringify(e.steps) === JSON.stringify(usual(e.what, e.ref));
    if (same) delete o.steps; else o.steps = e.steps;
    if (e.what === 'scene') { if (e.then === 'stay') delete o.then; else { o.then = e.then; o.afterMin = 5; } }
    ED = null; L.closeSheet(); L.render();
    L.saved(e.what === 'pad' ? 'what ' + o.label + ' does' : 'what ' + o.name + ' does when it starts');
  };

  // Running the steps. The prototype simulates what it cannot play (a fade's level is said and shown, not heard).
  function run(steps, i, target) {
    for (; i < steps.length; i++) {
      var st = steps[i];
      if (st.do === 'wait') { setTimeout(function (k) { run(steps, k, target); }.bind(null, i + 1), (st.secs || 1) * 1000); return; }
      if (st.do === 'play' && st.what) {
        var p = L.playlist(st.what), from = st.from === '' || st.from == null ? '' : String(+st.from);
        // Play next and Add to queue go to the room's list in Live (round 7 part 2); a track may start from a marker.
        if (st.queue === 'next' || st.queue === 'end') L.acts[st.queue === 'next' ? 'lvplaynext' : 'lvqueue']({ dataset: p ? { whole: p.id, box: 'music' } : { id: st.what, box: 'music', from: from } });
        else if (p) L.acts.onair({ dataset: { kind: 'playlist', id: p.id } });
        else L.play(st.what, { fade: st.how === 'cut' ? 0 : L.defaultCrossfade, r7from: from === '' ? null : +from });
      }
      if (st.do === 'stop') { if (st.what === 'all') L.fadeAll(1); else L.stopLane(st.what || 'music', 1, target); }
      if (st.do === 'fade') { L.toast('Music down to ' + st.level + '% over ' + st.secs + ' s'); L.say('Music down to ' + st.level + '%'); }
      if (st.do === 'pad' && st.what) { var a = st.what.split('/'); firePad0(a[0], a[1], undefined, target); }
      if (st.do === 'scene' && st.what) { var b = st.what.split('/'); L.startScene(b[0], b[1], +b[2]); return; }
    }
  }
  var start0 = L.startScene, timer = null;
  L.startScene = function (cid, sid, idx) {
    start0.apply(L, arguments);
    var s = L.session(cid, sid), sc = s && s.scenes[idx]; clearTimeout(timer); if (!sc) return;
    // The usual steps (music, ambience, pads) are what Lyre's start already does; the others run after them in order.
    if (sc.steps) {
      var room = L.firstRoom(), mu = sc.steps.filter(function (x) { return x.do === 'music'; })[0], m = L.mix(room);
      // A start without its music or ambience step leaves them silent; a music step may start from a marker.
      if (!mu) L.stopLane('music', 0.3, room); else if (mu.from !== '' && mu.from != null && m.music) m.music.pos = +mu.from;
      if (!sc.steps.some(function (x) { return x.do === 'amb'; })) L.stopLane('amb', 0.3, room);
      run(sc.steps.filter(function (x) { return !/^(music|amb|pads)$/.test(x.do); }), 0, room);
    }
    if (sc.then === 'after' && idx + 1 < s.scenes.length) timer = setTimeout(function () { L.startScene(cid, sid, idx + 1); }, (sc.afterMin || 5) * 60000);
    lastScene = { cid: cid, sid: sid, idx: idx, playing: true };
  };
  var firePad0 = L.firePad;
  L.firePad = function (bid, pid, phase, target) {
    var was = L.padActive(bid, pid); firePad0.apply(L, arguments);
    var x = padOf(bid + '/' + pid); if (!x || !x.p.steps || phase === 'up' || was) return;
    run(x.p.steps.filter(function (st) { return st.do !== 'sound'; }), 0, target);
  };
  // SHW-3: a scene set to move on when its music ends starts the next one.
  var lastScene = null;
  setInterval(function () {
    var ls = lastScene; if (!ls) return; var s = L.session(ls.cid, ls.sid), sc = s && s.scenes[ls.idx]; if (!sc) return;
    var m = L.mix(L.firstRoom()), on = !!(m && m.music);
    if (ls.playing && !on && sc.then === 'end' && ls.idx + 1 < s.scenes.length && L.state.live.scene === ls.idx) { lastScene = null; L.startScene(ls.cid, ls.sid, ls.idx + 1); L.toast('Next scene by itself: ' + s.scenes[ls.idx + 1].name); return; }
    ls.playing = on;
  }, 500);

  /* ---------- PLY-4 how a track behaves; SHW-3 follow with ---------- */
  var profileOf0 = L.profileOf;
  L.profileOf = function (t, ctx) {
    var p = profileOf0.apply(L, arguments); if (!t) return p;
    // The role is the default; what the Audio profile says for the track or the place wins, except that a sting
    // never loops.
    var explicit = (ctx && L.profileWhere(t, ctx) !== 'track') || !!(t.profile && t.profile.after);
    if (t.role === 'Sting' && p.after === 'loop') p.after = 'stop';
    if (t.role === 'Loop bed' && !explicit) p.after = 'loop';
    return p;
  };
  D.resumeAt = D.resumeAt || {};
  D.played = D.played || {};
  function laneOf(t, o) { return o.lane === 'fx' ? 'music' : o.lane || (t.kind === 'amb' ? 'amb' : 'music'); }
  function roomKey(target) { return L.mix(target) === L.mix('table') ? 'table' : target; }
  var play0 = L.play;
  L.play = function (id, o) {
    o = o || {}; var t = L.track(id); play0.apply(L, arguments);
    if (!t || o.target == null || (t.kind === 'fx' && !o.lane)) return;
    var ln = laneOf(t, o), m = L.mix(o.target), c = m && m[ln]; if (!c || c.id !== id) return;
    var from = o.r7from != null ? o.r7from : t.resume && D.resumeAt[id] != null ? D.resumeAt[id] : null;
    if (from != null) c.pos = Math.max(0, Math.min(c.dur - 1, from));
    // PLY-1: what played, per room, newest first.
    if (ln === 'music') { var k = roomKey(o.target), h = D.played[k] || (D.played[k] = []); h.unshift({ id: id, at: Date.now(), playlistId: o.playlistId || '', place: o.place || '', seq: o.seq || null }); if (h.length > 40) h.pop(); }
  };
  L.playFrom = function (id, at) { L.play(id, { fade: 1, r7from: at }); var t = L.track(id); L.say('On air from ' + L.fmt(at) + ': ' + L.title(t)); };
  // Follow with, and where a track that picks up where it stopped was stopped.
  var seen = {};
  setInterval(function () {
    var rooms = L.rooms(), list = rooms.length ? rooms.map(function (r) { return r.main ? 'table' : r.id; }) : ['table'], now = {};
    list.forEach(function (target) {
      var m = L.mix(target); ['music', 'amb'].forEach(function (ln) {
        var c = m[ln]; if (!c) return; var t = L.track(c.id); if (!t) return;
        now[target + ln] = { id: c.id, pos: c.pos, dur: c.dur };
        // Something already waiting wins: a scene's next item, or Play next and the queue in Live (L.carriesOn).
        if (t.follow && !c.seq && !(L.carriesOn && L.carriesOn(target)) && !c.r7followed && !c.paused && c.pos >= c.dur - 0.6 && L.profileOf(t).after !== 'loop') {
          c.r7followed = true; var p = L.playlist(t.follow), first = p && L.orderedTracks(p.id, '')[0];
          if (p && first) L.play(first.id, { lane: 'music', playlistId: p.id, fade: 2, target: target }); else if (L.track(t.follow)) L.play(t.follow, { fade: 2, target: target });
          L.say('Then: ' + itemName(t.follow));
        }
      });
    });
    Object.keys(seen).forEach(function (k) { var s = seen[k], n = now[k]; if ((!n || n.id !== s.id) && L.track(s.id) && L.track(s.id).resume) D.resumeAt[s.id] = s.pos < s.dur - 2 ? s.pos : null; });
    seen = now;
  }, 250);

  // The rows in the Library's details (How it plays).
  L.loopRow = function (t, row) {
    if (t.role !== 'Sting') return row;
    return row.replace('role="group" aria-label="Loop advice"', 'role="group" aria-label="Loop advice" aria-describedby="r7-sting"').replace(/<button class="chip lb-pick"/g, '<button disabled class="chip lb-pick"') +
      '<p class="sr-only" id="r7-sting">A sting plays once; it never loops.</p>';
  };
  // Only the choices that fit the track's role show (less to read): an underscore can fade out at its end, pick up
  // where it stopped and hand over; a loop bed picks up; a sting or a transition hands over (and a transition can
  // fade). A track with no role yet shows none of them.
  var ROWS = { Underscore: ['ending', 'resume', 'then'], 'Loop bed': ['resume'], Sting: ['then'], Transition: ['ending', 'then'] };
  L.playRows = function (t) {
    var rows = (t.kind !== 'fx' || t.role === 'Sting') && ROWS[t.role] || []; if (!rows.length) return '';
    var fades = t.ending === 'fades', f = t.follow, has = function (x) { return rows.indexOf(x) > -1; };
    return (has('ending') ? '<div class="lb-tg"><div class="lb-tgl">Ending</div><div class="chips" role="group" aria-label="Ending">' +
      // One chip: pressed, it fades out before its end; not pressed (the usual), it plays to its last second.
      '<button class="chip lb-pick" data-act="r7ending" data-v="' + (fades ? 'hard' : 'fades') + '" data-k="lb-end-fades" aria-pressed="' + fades + '" title="Lyre fades it out before its end (the length is in the Audio profile); not pressed, it plays to its last second">' + (fades ? L.icon('check', 's') : '') + 'Fades out</button></div></div>' : '') +
      (has('resume') ? '<label class="lv-switch lb-resume" title="A long underscore or bed starts again where it was last stopped"><input type="checkbox" role="switch" data-input="r7resume" data-k="lb-resume"' + (t.resume ? ' checked' : '') + '><span class="lv-switch-t"><b>Pick up where it stopped</b></span></label>' : '') +
      (!has('then') ? '' : '<div class="lb-tg"><div class="lb-tgl" id="lb-then-l">Then</div><div class="chips" role="group" aria-labelledby="lb-then-l">' +
      (f ? '<span class="chip"><span class="lane-dot music" aria-hidden="true"></span>' + esc(itemName(f)) + '<button class="x" data-act="r7follownone" data-k="lb-follow-x" title="Remove" aria-label="Stop following with ' + esc(itemName(f)) + '">' + L.icon('close') + '</button></span><button class="btn s ghost" data-act="r7follow" data-k="lb-follow">Change…</button>'
        : '<button class="btn s ghost" data-act="r7follow" data-k="lb-follow" title="When it ends, play a playlist or a track">' + L.icon('next', 's') + 'Follow with…</button>') + '</div></div>');
  };
  function curTrack() { var r = L.current(); return r.name === 'library' && L.track(r.p.tid); }
  L.acts.r7ending = function (el) {
    var t = curTrack(); if (!t) return; t.ending = el.dataset.v;
    var p = L.profileStore(t, '', true); p.fadeOut = { dur: t.ending === 'fades' ? (p.fadeOut && p.fadeOut.dur) || 4 : 0, shape: (p.fadeOut && p.fadeOut.shape) || 50 };
    L.render(); L.saved(L.title(t) + ' ending: ' + (t.ending === 'fades' ? 'fades out' : 'hard end'));
  };
  L.inputs.r7resume = function (el) { var t = curTrack(); if (!t) return; t.resume = el.checked; if (!t.resume) delete D.resumeAt[t.id]; L.saved(L.title(t) + (t.resume ? ' picks up where it stopped' : ' starts from the top')); };
  L.acts.r7follow = function () {
    var t = curTrack(); if (!t) return;
    var opts = D.playlists.filter(function (p) { return p.lane === 'music'; }).map(function (p) { return [p.id, p.name + ' (playlist)']; }).concat(D.tracks.filter(function (x) { return x.kind === 'music' && x.id !== t.id; }).map(function (x) { return [x.id, L.title(x)]; }));
    L.sheet({ title: 'Follow ' + L.title(t) + ' with', body: '<div class="field"><label for="r7-follow">When it ends, play</label><select class="input" id="r7-follow">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (t.follow === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' +
      '<p class="hint">Unless something is waiting in Play next.</p>', footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="r7followok">Done</button>' });
  };
  L.acts.r7followok = function () { var t = curTrack(), v = document.getElementById('r7-follow').value; t.follow = v; L.closeSheet(); L.render(); L.saved(L.title(t) + ' follows with ' + itemName(v)); };
  L.acts.r7follownone = function () { var t = curTrack(); delete t.follow; L.render(); L.saved(L.title(t) + ' follows with nothing'); var b = document.querySelector('[data-k="lb-follow"]'); if (b) b.focus(); };

  /* ---------- PLY-1 what played ---------- */
  L.historyButton = function (target, name, k) {
    // Shown on pointer hover or keyboard focus in the row (round 6 rule 5: hide the rare, show the frequent).
    return '<button class="btn s icon r7-hov" data-act="r7played" data-room="' + esc(target) + '" data-name="' + esc(name || '') + '" data-k="' + k + '-played" aria-label="What played" title="What played' + (name ? ' in ' + esc(name) : '') + ', with Play again">' + L.icon('queue', 's') + '</button>';
  };
  function ago(at) { var m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'Now' : m + ' min ago'; }
  L.acts.r7played = function (el) {
    var room = roomKey(el.dataset.room), h = D.played[room] || [];
    L.sheet({ title: 'What played' + (L.rooms().length > 1 && el.dataset.name ? ' in ' + el.dataset.name : ''), body: h.length ? '<ol class="list r7-played" aria-label="Played, newest first">' + h.map(function (x, i) {
      var t = L.track(x.id), nm = L.nameIn(t, x.seq ? '' : x.place) || L.title(t);
      return '<li class="lrow"><span class="grow ellipsis" title="' + esc(L.title(t)) + '">' + esc(nm) + '</span><span class="faint num">' + ago(x.at) + '</span>' +
        '<button class="btn s" data-act="r7again" data-room="' + esc(el.dataset.room) + '" data-i="' + i + '" aria-label="Play again: ' + esc(nm) + '">' + L.icon('playair', 's') + 'Play again</button>' +
        '<button class="btn s ghost" data-act="r7next" data-i="' + i + '" data-room="' + esc(el.dataset.room) + '" aria-label="Play next: ' + esc(nm) + '">' + L.icon('next', 's') + 'Play next</button></li>';
    }).join('') + '</ol>' : '<p class="empty">Nothing has played here yet.</p>', footer: '<button class="btn" data-act="closesheet">Close</button>' });
  };
  L.acts.r7again = function (el) {
    var x = (D.played[roomKey(el.dataset.room)] || [])[+el.dataset.i]; L.closeSheet(); if (!x) return;
    L.play(x.id, { lane: 'music', playlistId: x.playlistId, place: x.place, seq: x.seq, fade: L.defaultCrossfade, target: el.dataset.room });
  };
  L.acts.r7next = function (el) { var x = (D.played[roomKey(el.dataset.room)] || [])[+el.dataset.i]; L.closeSheet(); if (x) { L.acts.lvplaynext({ dataset: { id: x.id, box: 'music' } }); L.toast('Plays next: ' + L.title(L.track(x.id))); } };

  /* ---------- DAT-3 markers on the Now playing bar ---------- */
  var render0 = L.render;
  L.render = function () {
    render0.apply(L, arguments);
    document.querySelectorAll('.onairbar [data-progress]').forEach(function (el) {
      var a = el.dataset.progress.split('@'); if (a[0] === 'preview') return;
      var c = L.mix(a[1] || 'table')[a[0]], t = c && L.track(c.id); if (!t) return;
      var p = L.profileOf(t), bar = el.parentNode; bar.classList.add('r7-mkbar');
      p.markers.forEach(function (m) { if (m.at <= 0 || m.at >= c.dur) return; var i = document.createElement('i'); i.className = 'r7-mk' + (m.mix ? ' mix' : ''); i.style.left = (m.at / c.dur * 100) + '%'; i.title = m.label + ' ' + L.fmt(m.at); i.setAttribute('aria-hidden', 'true'); bar.appendChild(i); });
    });
  };
})();
