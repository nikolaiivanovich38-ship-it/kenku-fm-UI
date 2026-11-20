/* 0.6.0 sync (Nik, 20 Nov: "We need our prototype to either be what ships or ahead of it"): what the app built
   without a prototype round (0.5.1, 0.5.2) or changed while building 0.6.0, brought into the prototype so that every
   check runs in both projects (R60-PROTO-SYNC.md lists each item, its app file and where it is here). What fits into
   an existing screen file is there, marked "0.6.0 sync"; this file holds what is added on top. */
(function () {
  var esc = L.esc, D = L.data;
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function curTrack() { var c = L.current(), id = c.name === 'library' ? c.p.tid : (L.panelTrack && L.panelTrack()); return id ? L.track(id) : null; }

  /* ---------- a track's Type (0.5.2 items 4, 12 and 39; the app's TypeChange.tsx) ----------
     Music, Ambience or FX, for one track in its details or for the selection (its ⋯ › Type). FX tracks are what a
     pad's sound chooser offers, ambience tracks what a scene's Ambience chooser offers. When the change affects
     something (a manual playlist of another type lists one; a scene's ambience stops being ambience) a confirmation
     says what first; otherwise it is done at once, with Undo. */
  var TYPES = [['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']];
  function fits(lane, t, kind) { return lane === 'fx' ? kind === 'fx' || t.role === 'Sting' : lane === kind; }
  function effects(tracks, kind) {
    var changing = tracks.filter(function (t) { return t.kind !== kind; }), out = [];
    D.playlists.forEach(function (p) {
      if (p.kind !== 'manual') return;
      var clash = changing.filter(function (t) { return p.items.indexOf(t.id) > -1 && !fits(p.lane, t, kind); });
      if (clash.length) out.push((clash.length === 1 ? '"' + L.title(clash[0]) + '" is' : clash.length + ' of them are') + ' in ' + p.name + ', a ' + L.kindName[p.lane] + ' playlist.');
    });
    if (kind !== 'amb') D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc) {
      var t = changing.filter(function (x) { return x.id === sc.amb; })[0];
      if (t) out.push('"' + L.title(t) + '" is the ambience of ' + sc.name + ' (Session ' + s.n + ').');
    }); }); });
    return out;
  }
  var asking = null;
  function apply(tracks, kind) {
    var restore = L.snapshot(['tracks']);
    tracks.forEach(function (t) { t.kind = kind; });
    var text = 'Type: ' + L.kindName[kind] + ', for ' + (tracks.length === 1 ? L.title(tracks[0]) : plural(tracks.length, 'track')) + '.';
    L.undoNote(text, restore); L.render(); L.say(text);
  }
  L.r60typeChange = function (tracks, kind) {
    if (!tracks.some(function (t) { return t.kind !== kind; })) return;
    var fx = effects(tracks, kind);
    if (!fx.length) { apply(tracks, kind); return; }
    asking = { ids: tracks.map(function (t) { return t.id; }), kind: kind };
    L.sheet({ title: 'Make ' + (tracks.length === 1 ? '“' + L.title(tracks[0]) + '”' : plural(tracks.length, 'track')) + ' ' + L.kindName[kind] + '?',
      body: '<p>This changes where ' + (tracks.length === 1 ? 'it is' : 'they are') + ' offered:</p><ul class="lb-effects">' + fx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '<p class="hint">' + (kind === 'fx' ? 'FX tracks are offered for pads.' : kind === 'amb' ? "Ambience tracks are offered as a scene's ambience." : "Music tracks are offered for a scene's music.") + '</p>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="r60typedo">Make ' + L.kindName[kind] + '</button>' });
  };
  L.acts.r60typedo = function () { var a = asking; asking = null; L.closeSheet(); if (a) apply(a.ids.map(L.track).filter(Boolean), a.kind); };
  L.acts.r60type = function (el) { var t = curTrack(); if (t) L.r60typeChange([t], el.dataset.v); var b = document.querySelector('[data-k="r60-type-' + el.dataset.v + '"]'); if (b) b.focus(); };
  L.acts.r60seltype = function (el) { L.r60typeChange((el.dataset.ids || '').split(',').map(L.track).filter(Boolean), el.dataset.v); };
  L.r60typeRow = function (t) {
    return '<div class="lb-tg"><div class="lb-tgl">Type</div><div class="chips" role="group" aria-label="Type">' + TYPES.map(function (x) {
      var on = t.kind === x[0];
      return '<button class="chip lb-pick" data-act="r60type" data-v="' + x[0] + '" data-k="r60-type-' + x[0] + '" aria-pressed="' + on + '">' + (on ? L.icon('check', 's') : '') + x[1] + '</button>';
    }).join('') + '</div></div>';
  };
  L.r60typeMenu = function (ids) {
    var list = ids.map(L.track).filter(Boolean);
    return '<div class="group">Type</div>' + TYPES.map(function (x) {
      var on = list.length > 0 && list.every(function (t) { return t.kind === x[0]; });
      return '<button role="menuitemradio" aria-checked="' + on + '" data-act="r60seltype" data-v="' + x[0] + '" data-ids="' + esc(ids.join(',')) + '">' + (on ? L.icon('check', 's') : '<span style="width:14px"></span>') + x[1] + '</button>';
    }).join('') + '<div class="sep"></div>';
  };
  // The details' How it plays starts with Type (round 9's Use it for follows).
  var useFor0 = L.r9UseFor;
  if (useFor0) L.r9UseFor = function (t) { return L.r60typeRow(t) + useFor0.apply(this, arguments); };
})();
