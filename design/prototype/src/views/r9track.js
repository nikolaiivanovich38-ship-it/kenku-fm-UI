/* Round 9 (ROUND9.md §3, §9, §10): a track's use and end in plain words, the Follow with picker, parts from markers.

   §3 Use it for and At its end (item 18: "Need to be have more intuitive roles than we currently do.")
     Two rows replace Role, Looping, Ending and Then in a track's details (the Library's Details and the Track panel):
       Use it for   Background · Scene music · Short cue · Lead-in (Sound effect for FX tracks), each with a short line
                    on hover and for screen readers. The stored values stay the old ones ('Loop bed', 'Underscore',
                    'Sting', 'Transition'), so playback, dynamic rules and the FX filter are unchanged; only the words are
                    new (L.roleWord).
       At its end   Loop · Loop with a crossfade · Next track · Fade out · Stop · Play… (Follow with). One choice, the
                    same words as the Audio profile's At the end. Choosing Use it for picks the usual end (Background:
                    Loop with a crossfade; Scene music: Next track; Short cue: Stop; Lead-in: Fade out) until Nik picks
                    an end himself; ambience starts at Loop. Under them: "Next time, start where it stopped" and one
                    summary line.
   §9 Follow with (item 5: "Better interface (inc. search and splits by playlist, fx, ambience, ordinary track) for
     follow with picker"): a picker with search, All · Playlists · Music · Ambience · FX (with counts), results grouped
     under those headings with Preview, and Nothing at the top. Double-click chooses at once.
   §10 Split into parts (item 8: "Split tracks into multiple at split points in audio profile using markers"): the
     Markers box's Split into parts… makes a track for each part between markers. Each part plays its section of the
     same file; the file is never changed and the whole track stays. */
(function () {
  var esc = L.esc, D = L.data;
  L.roleWord = { 'Loop bed': 'Background', Underscore: 'Scene music', Sting: 'Short cue', Transition: 'Lead-in', Effect: 'Sound effect' };
  var USE = [
    ['Loop bed', 'Background', 'Sits under the scene and keeps going', 'loop'],
    ['Underscore', 'Scene music', 'Plays through, then the next track', 'note'],
    ['Sting', 'Short cue', 'A few seconds for a moment, then stops', 'bolt'],
    ['Transition', 'Lead-in', 'Leads into the next scene or track', 'right']
  ];
  var ENDS = [['loop', 'Loop'], ['xloop', 'Loop with a crossfade'], ['next', 'Next track'], ['fade', 'Fade out'], ['stop', 'Stop'], ['follow', 'Play…']];
  var USUAL = { 'Loop bed': 'xloop', Underscore: 'next', Sting: 'stop', Transition: 'fade' };
  var END_WORDS = { loop: 'loops', xloop: 'loops with a crossfade', next: 'then the next track', fade: 'fades out', stop: 'stops', follow: 'then plays something' };

  function cur() { var r = L.current(), id = r.name === 'library' || r.name === 'profile' ? r.p.tid : (L.panelTrack && L.panelTrack()); return id ? L.track(id) : null; } // Round 10: the Audio profile's Play… too
  function itemName(id) { var p = L.playlist(id); if (p) return p.name; var t = L.track(id); return t ? L.title(t) : ''; }
  L.endOf = function (t) {
    if (t.end) return t.end;
    if (t.follow) return 'follow';
    if (t.ending === 'fades') return 'fade';
    if (t.loop === 'crossfade') return 'xloop';
    if (t.loop === 'yes') return 'loop';
    var p = t.profile || {};
    if (p.after === 'stop') return 'stop';
    if (p.after === 'loop') return 'loop';
    return t.kind === 'amb' ? 'loop' : t.role ? USUAL[t.role] || 'next' : 'next';
  };
  // Keeps the old fields in step, so playback (core.js, r7play.js) does what the one choice says.
  function setEnd(t, v) {
    t.end = v; t.loop = v === 'loop' ? 'yes' : v === 'xloop' ? 'crossfade' : 'no'; t.ending = v === 'fade' ? 'fades' : 'hard';
    var p = L.profileStore(t, '', true), fo = p.fadeOut || { dur: 0, shape: 50 };
    p.after = v === 'loop' || v === 'xloop' ? 'loop' : v === 'stop' ? 'stop' : 'next';
    if (v === 'xloop' && !p.loopXfade) p.loopXfade = 3;
    if (v === 'loop') p.loopXfade = 0;
    p.fadeOut = { dur: v === 'fade' ? fo.dur || 4 : 0, shape: fo.shape || 50 };
    if (v !== 'follow') delete t.follow;
  }
  L.endWords = function (t) {
    var e = L.endOf(t), p = t.profile || {};
    return e === 'follow' && t.follow ? 'then plays ' + itemName(t.follow) : e === 'xloop' ? 'loops with a ' + (p.loopXfade || 3) + ' s crossfade' : END_WORDS[e];
  };

  L.r9UseFor = function (t) {
    var list = t.kind === 'fx' ? [['Effect', 'Sound effect', 'A sound over the music', 'sfx']].concat(USE.slice(2, 3)) : USE;
    return '<div class="lb-tg"><div class="lb-tgl" id="r9-use-l">Use it for</div><div class="chips r9-use" role="group" aria-labelledby="r9-use-l">' + list.map(function (u) {
      var on = t.role === u[0], key = u[0].replace(/\s/g, '');
      return '<button class="chip lb-pick r9-usechip" data-act="r9use" data-v="' + esc(u[0]) + '" data-k="r9-use-' + key + '" aria-pressed="' + on + '" aria-describedby="r9-use-d-' + key + '" title="' + esc(u[2]) + '">' +
        (on ? L.icon('check', 's') : L.icon(u[3], 's')) + esc(u[1]) + '<span class="sr-only" id="r9-use-d-' + key + '">' + esc(u[2]) + '</span></button>';
    }).join('') + '</div></div>';
  };
  L.r9AtEnd = function (t) {
    var e = L.endOf(t), f = t.follow, sting = t.role === 'Sting';
    var chips = ENDS.filter(function (x) { return !(sting && (x[0] === 'loop' || x[0] === 'xloop')); }).map(function (x) {
      var on = e === x[0];
      if (x[0] === 'follow' && f) return '<span class="chip r9-follow-on">' + L.icon('check', 's') + '<span>Play: ' + esc(itemName(f)) + '</span>' +
        '<button class="x" data-act="r7follownone" data-k="lb-follow-x" title="Remove" aria-label="Stop playing ' + esc(itemName(f)) + ' after it">' + L.icon('close') + '</button></span>' +
        '<button class="btn s ghost" data-act="r7follow" data-k="lb-follow">Change…</button>';
      return '<button class="chip lb-pick" data-act="' + (x[0] === 'follow' ? 'r7follow' : 'r9end') + '" data-v="' + x[0] + '" data-k="' + (x[0] === 'follow' ? 'lb-follow' : 'r9-end-' + x[0]) + '" aria-pressed="' + on + '"' +
        (x[0] === 'follow' ? ' title="When it ends, play a playlist or a track"' : '') + '>' + (on ? L.icon('check', 's') : '') + esc(x[1]) + '</button>';
    }).join('');
    var resume = t.kind !== 'fx' && !sting;
    var sum = [t.role ? L.roleWord[t.role] : '', L.endWords(t), resume && t.resume ? 'starts where it stopped' : ''].filter(Boolean).join(' · ');
    return '<div class="lb-tg"><div class="lb-tgl" id="r9-end-l">At its end</div><div class="chips r9-end" role="group" aria-labelledby="r9-end-l">' + chips + '</div></div>' +
      (resume ? '<label class="r9-resume"><input type="checkbox" data-input="r7resume" data-k="lb-resume"' + (t.resume ? ' checked' : '') + '>Next time, start where it stopped</label>' : '') +
      '<p class="r9-sum">' + L.icon('fade', 's') + '<span>' + esc(sum.charAt(0).toUpperCase() + sum.slice(1)) + '.</span></p>';
  };
  L.acts.r9use = function (el) {
    var t = cur(); if (!t) return; var v = el.dataset.v;
    t.role = t.role === v ? '' : v;
    if (t.role && USUAL[t.role] && !t.endChosen) setEnd(t, USUAL[t.role]);
    L.render(); L.saved(L.title(t) + ': ' + (t.role ? L.roleWord[t.role] : 'no use chosen'));
  };
  L.acts.r9end = function (el) {
    var t = cur(); if (!t) return; setEnd(t, el.dataset.v); t.endChosen = true;
    L.render(); L.saved(L.title(t) + ' at its end: ' + L.endWords(t));
  };

  /* ---------- §9 the Follow with picker ---------- */
  var FP = { q: '', tab: 'all', pick: null };
  var TABS = [['all', 'All'], ['pl', 'Playlists'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']];
  function pool(t) {
    var pls = D.playlists.map(function (p) { return { g: 'pl', id: p.id, name: p.name, sub: (p.kind === 'dynamic' ? 'Dynamic' : 'Manual') + ' · ' + L.kindName[p.lane] + ' · ' + L.playlistTracks(p).length + ' tracks', lane: p.lane }; });
    var trs = D.tracks.filter(function (x) { return x.id !== t.id; }).map(function (x) { var g = L.isFx(x) ? 'fx' : x.kind === 'amb' ? 'amb' : 'music'; return { g: g, id: x.id, name: L.title(x), sub: (x.artist ? x.artist + ' · ' : '') + L.fmt(x.dur), lane: g }; });
    return pls.concat(trs);
  }
  function hits(t) {
    var w = FP.q.toLowerCase().split(/\s+/).filter(Boolean);
    return pool(t).filter(function (x) {
      if (!w.length) return true;
      var tr = L.track(x.id), hay = (x.name + ' ' + x.sub + ' ' + (tr ? D.tagGroups.map(function (g) { return L.tagsOn(tr, g.id).join(' '); }).join(' ') : '')).toLowerCase();
      return w.every(function (y) { return hay.indexOf(y) > -1; });
    });
  }
  function pickerBody(t) {
    var all = hits(t), n = {}; TABS.forEach(function (x) { n[x[0]] = x[0] === 'all' ? all.length : all.filter(function (y) { return y.g === x[0]; }).length; });
    var shown = FP.tab === 'all' ? all : all.filter(function (y) { return y.g === FP.tab; });
    var groups = [['pl', 'Playlists'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX and short cues']];
    var sel = FP.pick == null ? (t.follow || '') : FP.pick;
    var rows = '<li><label class="r9-fp-row r9-fp-none' + (!sel ? ' on' : '') + '"><input type="radio" name="r9fp" value="" data-input="r9fppick" data-k="r9fp-none"' + (!sel ? ' checked' : '') + '><span class="grow"><b>Nothing</b><span class="hint"> · it ends as set</span></span></label></li>';
    groups.forEach(function (gr) {
      var list = shown.filter(function (y) { return y.g === gr[0]; }); if (!list.length) return;
      rows += '<li class="r9-fp-h">' + gr[1] + ' <span class="faint num">' + list.length + '</span></li>' + list.slice(0, 40).map(function (y) {
        return '<li class="r9-fp-li"><label class="r9-fp-row' + (sel === y.id ? ' on' : '') + '"><input type="radio" name="r9fp" value="' + y.id + '" data-input="r9fppick" data-k="r9fp-' + y.id + '"' + (sel === y.id ? ' checked' : '') + '>' +
          '<span class="lane-dot ' + (y.g === 'pl' ? (y.lane === 'fx' ? 'fx' : y.lane) : y.lane) + '" aria-hidden="true"></span>' +
          '<span class="grow r9-fp-t"><span class="ellipsis">' + esc(y.name) + '</span><span class="hint ellipsis">' + esc(y.sub) + '</span></span></label>' +
          (y.g === 'pl' ? L.previewButton('playlist', y.id) : L.previewButton('track', y.id)) + '</li>';
      }).join('');
    });
    if (!shown.length) rows += '<li class="hint r9-fp-h">Nothing matches "' + esc(FP.q) + '".</li>';
    return '<p class="hint r9-fp-for">After <b>' + esc(L.title(t)) + '</b></p>' +
      '<div class="r9-fp-tools"><div class="search grow">' + L.icon('search') + '<input class="input" type="search" placeholder="Any word of a title, artist or tag" aria-label="Search playlists and tracks" data-input="r9fpq" data-k="r9fp-q" value="' + esc(FP.q) + '"></div>' +
      '<div class="seg s r9-fp-tabs" role="group" aria-label="Show">' + TABS.map(function (x) { return '<button data-act="r9fptab" data-v="' + x[0] + '" data-k="r9fp-tab-' + x[0] + '" aria-pressed="' + (FP.tab === x[0]) + '">' + x[1] + ' <span class="num faint">' + n[x[0]] + '</span></button>'; }).join('') + '</div></div>' +
      '<ul class="r9-fp-list" aria-label="When it ends, play" data-scroll="r9fp">' + rows + '</ul>';
  }
  function repaint(k) {
    var t = cur(), b = document.querySelector('#lyre-sheet .body'); if (!t || !b) return;
    L.paint(b, pickerBody(t)); var el = k && document.querySelector('[data-k="' + k + '"]'); if (el) el.focus();
  }
  L.acts.r7follow = function () {
    var t = cur(); if (!t) return; FP = { q: '', tab: 'all', pick: null };
    L.sheet({ title: 'When it ends, play', wide: true, body: pickerBody(t), describe: 'Choose a playlist or a track to play when ' + esc(L.title(t)) + ' ends. Something waiting in Play next goes first.',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="r9fpok" data-k="r9fp-ok">Done</button>' });
    var q = document.querySelector('[data-k="r9fp-q"]'); if (q) q.focus();
  };
  L.inputs.r9fpq = function (el) { FP.q = el.value; repaint('r9fp-q'); };
  L.acts.r9fptab = function (el) { FP.tab = el.dataset.v; repaint('r9fp-tab-' + FP.tab); };
  L.inputs.r9fppick = function (el) { FP.pick = el.value; document.querySelectorAll('.r9-fp-row').forEach(function (r) { r.classList.toggle('on', r.querySelector('input').checked); }); };
  L.acts.r9fpok = function () {
    var t = cur(); if (!t) return; var v = FP.pick == null ? (t.follow || '') : FP.pick;
    if (v) { t.follow = v; t.end = 'follow'; t.endChosen = true; var p = L.profileStore(t, '', true); p.after = 'next'; } else { delete t.follow; if (t.end === 'follow') t.end = 'next'; }
    L.closeSheet(); L.render(); L.saved(L.title(t) + (v ? ' then plays ' + itemName(v) : ' plays nothing after it'));
    var b = document.querySelector('[data-k="lb-follow"]'); if (b) b.focus();
  };
  L.acts.r7follownone = function () { var t = cur(); if (!t) return; delete t.follow; t.end = 'next'; L.render(); L.saved(L.title(t) + ' plays nothing after it'); var b = document.querySelector('[data-k="lb-follow"]'); if (b) b.focus(); };
  document.addEventListener('dblclick', function (e) { var r = e.target.closest && e.target.closest('.r9-fp-row'); if (r) { FP.pick = r.querySelector('input').value; L.acts.r9fpok(); } });

  /* ---------- §10 split into parts ---------- */
  var SP = null;
  function profTrack() { var r = L.current(); return r.name === 'profile' ? L.track(r.p.tid) : null; }
  L.splitButton = function (t, p) {
    var n = p.markers.filter(function (m) { return m.at > 0 && m.at < t.dur; }).length;
    return '<button class="btn s" data-act="r9split" data-k="r9-split"' + (n ? '' : ' aria-disabled="true"') + ' title="' + (n ? 'Make a track for each part between markers. Your file is not changed.' : 'Add a marker first: each marker starts a new part') + '">' + L.icon('list', 's') + 'Split into parts…</button>';
  };
  function parts(t) {
    var cuts = SP.cuts.filter(function (c) { return c.on; }), out = [], from = 0, label = 'opening', base = t.metaTitle || L.title(t);
    cuts.forEach(function (c, i) { out.push({ from: from, to: c.at, name: SP.names[i] != null ? SP.names[i] : base + ' – ' + label }); from = c.at; label = c.label.toLowerCase(); });
    out.push({ from: from, to: t.dur, name: SP.names[cuts.length] != null ? SP.names[cuts.length] : base + ' – ' + label });
    return out;
  }
  function splitBody(t) {
    var ps = parts(t);
    return '<p>Each part becomes a track that plays its part of the same file. Your file is not changed, and the whole track stays in your library.</p>' +
      '<fieldset class="r9-sp-cuts"><legend>Split at</legend>' + SP.cuts.map(function (c, i) {
        return '<label class="r9-sp-cut"><input type="checkbox" data-input="r9spcut" data-i="' + i + '" data-k="r9sp-cut-' + i + '"' + (c.on ? ' checked' : '') + '>' + esc(c.label) + ' <span class="num faint">' + L.fmt(c.at) + '</span></label>';
      }).join('') + '</fieldset>' +
      '<table class="r9-sp-table"><caption class="sr-only">The parts</caption><thead><tr><th scope="col">Part name</th><th scope="col">From – to</th><th scope="col">Length</th><th scope="col"><span class="sr-only">Preview</span></th></tr></thead><tbody>' + ps.map(function (x, i) {
        return '<tr><td><input class="input" data-input="r9spname" data-i="' + i + '" data-k="r9sp-name-' + i + '" aria-label="Name of part ' + (i + 1) + '" value="' + esc(x.name) + '"></td><td class="num">' + L.fmt(x.from) + ' – ' + L.fmt(x.to) + '</td><td class="num">' + L.fmt(x.to - x.from) + '</td>' +
          '<td><button class="btn s icon" data-act="r9sppv" data-from="' + x.from + '" data-k="r9sp-pv-' + i + '" title="Preview from ' + L.fmt(x.from) + '" aria-label="Preview part ' + (i + 1) + '">' + L.icon('headphones', 's') + '</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<label class="r9-sp-opt"><input type="checkbox" data-input="r9spopt" data-o="tags" data-k="r9sp-tags"' + (SP.tags ? ' checked' : '') + '>Copy its tags, Type and Use it for to each part</label>' +
      '<label class="r9-sp-opt"><input type="checkbox" data-input="r9spopt" data-o="lists" data-k="r9sp-lists"' + (SP.lists ? ' checked' : '') + '>Add the parts beside it in its manual playlists</label>';
  }
  function spRepaint(k) { var t = profTrack(), b = document.querySelector('#lyre-sheet .body'); if (!t || !b) return; L.paint(b, splitBody(t)); var f = document.querySelector('#lyre-sheet [data-act="r9spok"]'); if (f) f.textContent = 'Make ' + parts(t).length + ' tracks'; var el = k && document.querySelector('[data-k="' + k + '"]'); if (el) el.focus(); }
  L.acts.r9split = function (el) {
    var t = profTrack(); if (!t) return;
    if (el.getAttribute('aria-disabled') === 'true') { L.toast('Add a marker first: each marker starts a new part'); return; }
    var p = L.profileOf(t);
    SP = { cuts: p.markers.filter(function (m) { return m.at > 0 && m.at < t.dur; }).sort(function (a, b) { return a.at - b.at; }).map(function (m) { return { at: m.at, label: m.label, on: true }; }), names: {}, tags: true, lists: false };
    L.sheet({ title: 'Split into parts', wide: true, describe: esc(L.title(t)), body: splitBody(t), footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="r9spok" data-k="r9sp-ok">Make ' + parts(t).length + ' tracks</button>' });
  };
  L.inputs.r9spcut = function (el) { SP.cuts[+el.dataset.i].on = el.checked; SP.names = {}; spRepaint(el.dataset.k); };
  L.inputs.r9spname = function (el) { SP.names[+el.dataset.i] = el.value; };
  L.inputs.r9spopt = function (el) { SP[el.dataset.o] = el.checked; };
  L.acts.r9sppv = function (el) { var t = profTrack(); if (!L.previewing(t.id)) L.preview(t.id); if (L.pb.preview) L.pb.preview.pos = +el.dataset.from; };
  L.acts.r9spok = function () {
    var t = profTrack(); if (!t) return; var ps = parts(t), made = [];
    ps.forEach(function (x, i) {
      var n = JSON.parse(JSON.stringify(t)); n.id = t.id + 'p' + (i + 1) + Date.now().toString(36).slice(-3);
      n.title = x.name; n.isNew = false; n.partOf = { tid: t.id, from: x.from, to: x.to }; n.dur = Math.max(1, Math.round(x.to - x.from)); delete n.profile; delete n.end; delete n.parts;
      if (!SP.tags) { n.tags = {}; D.tagGroups.forEach(function (g) { n.tags[g.id] = []; }); n.role = ''; }
      D.tracks.push(n); made.push(n.id);
    });
    t.parts = (t.parts || []).concat(made);
    if (SP.lists) D.playlists.forEach(function (p) { if (p.kind !== 'manual') return; var i = p.items.indexOf(t.id); if (i > -1) p.items.splice.apply(p.items, [i + 1, 0].concat(made)); });
    L.closeSheet();
    L.undoNote('Made ' + made.length + ' parts of ' + L.title(t), function () {
      for (var i = D.tracks.length - 1; i >= 0; i--) if (made.indexOf(D.tracks[i].id) > -1) D.tracks.splice(i, 1);
      t.parts = (t.parts || []).filter(function (x) { return made.indexOf(x) < 0; });
      D.playlists.forEach(function (p) { if (p.items) p.items = p.items.filter(function (x) { return made.indexOf(x) < 0; }); });
    });
    L.render(); L.saved(made.length + ' parts of ' + L.title(t) + ' in the Track library');
  };
  // A part's details say what it is part of; the whole track's list its parts.
  L.partLine = function (t) {
    var w = t.partOf && L.track(t.partOf.tid);
    if (w) return '<dt>Part of</dt><dd><a href="#/library/' + w.id + '" data-r9-keep="1" data-k="lb-partof">' + esc(L.title(w)) + '</a> <span class="num faint">' + L.fmt(t.partOf.from) + '–' + L.fmt(t.partOf.to) + '</span><br><span class="hint">Plays this part of the same file.</span></dd>';
    var ps = (t.parts || []).map(L.track).filter(Boolean);
    return ps.length ? '<dt>Parts</dt><dd><ul class="lb-scnames">' + ps.map(function (x) { return '<li><a href="#/library/' + x.id + '" data-r9-keep="1">' + esc(L.title(x)) + '</a> <span class="num faint">' + L.fmt(x.partOf.from) + '–' + L.fmt(x.partOf.to) + '</span></li>'; }).join('') + '</ul></dd>' : '';
  };
})();
