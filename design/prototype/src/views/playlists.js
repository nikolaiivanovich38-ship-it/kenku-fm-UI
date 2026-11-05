/* Playlists: every playlist on its own page (#/playlists) and one playlist (#/playlist/<id>).
   A playlist is Manual (kind 'manual': ordered track ids in pl.items) or Dynamic
   (kind 'dynamic': pl.rule = { conds: [{ group, match: 'any'|'all'|'none', values }], energy: [min, max]?, notRole: 'Sting'? }).
   Lanes: Music, Ambience, FX (sound effects and stings, L.isFx). Where it is used comes from L.usesOfPlaylist; changing that goes through L.assignSheet ("Use in…"). */
(function () {
  var esc = L.esc, D = L.data;
  var KIND = { manual: { name: 'Manual', icon: 'hand' }, dynamic: { name: 'Dynamic', icon: 'tag' } };
  var filt = { lane: 'all', kind: 'all', used: 'all', q: '' };   // All playlists filters
  var addQuery = '', addLimit = 20, addLane = {};                 // Add tracks: search text, how many results show, Music/Ambience/FX per playlist
  var dragId = null, focusAfter = null, valCond = -1;

  /* ---------- small helpers ---------- */
  function laneName(l) { return L.kindName[l] || 'Music'; }
  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }
  function totalOf(tracks) { return tracks.reduce(function (s, t) { return s + (t.dur || 0); }, 0); }
  function fmtLong(s) { s = Math.round(s); if (s < 3600) return L.fmt(s); var h = Math.floor(s / 3600); return h + ':' + L.fmt(s - h * 3600).padStart(5, '0'); }
  function group(id) { return D.tagGroups.filter(function (g) { return g.id === id; })[0] || D.tagGroups[0]; }
  function usedText(uses) {
    var n = { scene: 0, session: 0, campaign: 0 }; uses.forEach(function (u) { n[u.level]++; });
    return ['scene', 'session', 'campaign'].filter(function (k) { return n[k]; }).map(function (k) { return plural(n[k], k); }).join(', ');
  }
  // Kind and lane as quiet text: an icon for Manual/Dynamic and a small lane dot (colour only as a dot, never as text).
  function kindLane(pl) { var k = KIND[pl.kind]; return '<span class="pl-kl">' + L.icon(k.icon, 's') + esc(k.name) + '<span class="sep">·</span><span class="lane-dot ' + pl.lane + '"></span>' + laneName(pl.lane) + '</span>'; }
  function status(text, tone) { return { text: text, tone: tone }; }
  function moreBtn(k, label, act, attrs) { return '<button type="button" class="btn s icon ghost pl-more-btn" data-act="' + act + '" ' + attrs + ' data-k="' + k + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(label) + '">' + L.icon('more', 's') + '</button>'; }
  function trackTip(t) {
    var tags = []; D.tagGroups.forEach(function (g) { tags = tags.concat(t.tags[g.id] || []); });
    return L.title(t) + (t.title && t.metaTitle && t.metaTitle !== t.title ? '\nIn the file: ' + t.metaTitle : '') + (t.title ? '' : '\nNo title of your own yet') + '\nFile: ' + t.file +
      (tags.length ? '\nTags: ' + tags.join(', ') : '') + (t.energy ? '\nEnergy ' + t.energy + ' of 5' : '') + '\nClick to open in the Library';
  }
  function cur() { var r = L.current(); return r.name === 'playlist' ? L.playlist(r.p.pid) : null; }
  function haystack(t) {
    var tags = []; D.tagGroups.forEach(function (g) { tags = tags.concat(t.tags[g.id] || []); });
    return [t.title, t.metaTitle, t.file, t.album, t.artist, t.folder, t.role].concat(tags).join(' ').toLowerCase();
  }
  function matchesQuery(text, q) { return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return text.indexOf(w) > -1; }); }
  // On air right now: the music or ambience lane, or (for effects) a layer in pb.fx.
  function trackOnAir(t) { var pb = L.pb; return !!((pb.music && pb.music.id === t.id) || (pb.amb && pb.amb.id === t.id) || pb.fx.some(function (f) { return f.ref === 'track/' + t.id && !f.fadeOut; })); }
  function playlistOnAir(p) { var pb = L.pb; return !!((pb.music && pb.music.playlistId === p.id) || (pb.amb && pb.amb.playlistId === p.id)); }
  function onAirFrom(pl) { var c = L.pb[pl.lane === 'amb' ? 'amb' : 'music']; return c && c.playlistId === pl.id ? c : null; }
  // L.ruleText, leaving out conditions that have no values yet (they would read "Mood any of ;").
  function ruleWords(rule) { var r = { conds: rule.conds.filter(function (c) { return c.values.length; }), energy: rule.energy, notRole: rule.notRole }; return L.ruleText(r); }
  function blankRule() { return { conds: [], energy: [0, 5] }; }
  function cleanRule(rule) {   // keep the rule text plain: drop a full energy range and an unused stings flag
    if (rule.energy && rule.energy[0] <= 0 && rule.energy[1] >= 5) delete rule.energy;
    if (!rule.notRole) delete rule.notRole;
  }
  function copyOf(pl, name, kind) {
    var c = { id: L.uid('p-'), name: name, kind: kind || pl.kind, lane: pl.lane, notes: pl.notes || '' };
    if (c.kind === 'manual') c.items = pl.kind === 'manual' ? pl.items.slice() : L.playlistTracks(pl).map(function (t) { return t.id; });
    else c.rule = JSON.parse(JSON.stringify(pl.rule));
    D.playlists.splice(D.playlists.indexOf(pl) + 1, 0, c);
    return c;
  }
  function laneTest(lane) { return function (t) { return lane === 'fx' ? L.isFx(t) : t.kind === lane; }; }
  // Preview and Play on air for one track row. Own data-k prefixes, because the same track can show twice on a page.
  function pvBtn(t, p) {
    var on = L.previewing(t.id);
    return '<button type="button" class="btn s icon pv" data-act="plprev" data-tid="' + t.id + '" data-k="' + p + 'pv-' + t.id + '" aria-pressed="' + on + '" title="' + (on ? 'Stop preview' : 'Preview in your headphones') + '" aria-label="' + (on ? 'Stop preview of ' : 'Preview ') + esc(L.title(t)) + '">' + L.icon(on ? 'stop' : 'headphones', 's') + '</button>';
  }
  function airBtn(t, p) {
    return '<button type="button" class="btn s icon" data-act="pltair" data-tid="' + t.id + '" data-k="' + p + 'air-' + t.id + '" title="Play on air (the players hear it)' + (t.kind === 'fx' ? ', over the music' : '') + '" aria-label="Play on air: ' + esc(L.title(t)) + '">' + L.icon('broadcast', 's') + '</button>';
  }
  function focusK(k) { setTimeout(function () { var el = document.querySelector('[data-k="' + k + '"]'); if (el) { el.focus(); if (el.select && el.type === 'text') el.select(); } }, 40); }

  /* ---------- All playlists ---------- */
  function filtered() {
    return D.playlists.filter(function (p) {
      if (filt.lane !== 'all' && p.lane !== filt.lane) return false;
      if (filt.kind !== 'all' && p.kind !== filt.kind) return false;
      var used = L.usesOfPlaylist(p.id).length > 0;
      if (filt.used === 'used' && !used) return false;
      if (filt.used === 'unused' && used) return false;
      if (filt.q && !matchesQuery((p.name + ' ' + KIND[p.kind].name + ' ' + laneName(p.lane) + ' ' + (p.kind === 'dynamic' ? ruleWords(p.rule) : '')).toLowerCase(), filt.q)) return false;
      return true;
    });
  }
  function seg(name, label, opts) {
    return '<div class="seg s" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button type="button" data-act="plfilt" data-f="' + name + '" data-v="' + o[0] + '" data-k="f-' + name + '-' + o[0] + '" aria-pressed="' + (filt[name] === o[0]) + '">' + (o[2] ? L.icon(o[2], 's') : '') + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function listRow(p) {
    var tracks = L.playlistTracks(p), uses = L.usesOfPlaylist(p.id), k = KIND[p.kind], rule = p.kind === 'dynamic' ? ruleWords(p.rule) : '';
    var xk = 'pls:' + p.id, open = L.expanded(xk), len = fmtLong(totalOf(tracks));
    var tip = k.name + (rule ? ': ' + rule : '') + ' · ' + laneName(p.lane) + '\n' + (uses.length ? 'Used in ' + usedText(uses) : 'Not used yet') + '\nClick to open';
    return '<li class="pl-item' + (open ? ' pl-open' : '') + (flashPl === p.id ? ' pl-flash' : '') + '" data-pid="' + p.id + '"><div class="pl-grid pl-row" data-act="plrow" data-id="' + p.id + '" title="' + esc(tip) + '">' +
      '<div class="pl-namecell">' + L.expanderButton(xk, p.name) +
        '<span class="pl-kicon" aria-hidden="true">' + L.icon(k.icon, 's') + '</span><span class="lane-dot ' + p.lane + '" aria-hidden="true"></span>' +
        '<a href="#/playlist/' + p.id + '" data-k="open-' + p.id + '" class="ellipsis pl-nm">' + esc(p.name || 'Untitled playlist') + '<span class="sr-only">, ' + k.name + ', ' + laneName(p.lane) + ', ' + (uses.length ? 'used in ' + usedText(uses) : 'not used yet') + '</span></a>' +
        (playlistOnAir(p) ? '<span class="badge onair">On air</span>' : '') + '</div>' +
      '<div class="num pl-c" aria-label="' + plural(tracks.length, 'track') + '">' + tracks.length + '</div>' +
      '<div class="num pl-c muted" aria-label="Length ' + len + '">' + len + '</div>' +
      '<div class="pl-racts">' + L.previewButton('playlist', p.id) + L.playOnAirButton('playlist', p.id) + moreBtn('more-' + p.id, p.name, 'plrowmore', 'data-id="' + p.id + '"') + '</div></div>' +
      (open ? '<div class="xp-body pl-xp"><p class="pl-xpmeta">' + (rule ? '<span>' + L.icon('tag', 's') + esc(rule) + '</span>' : '') +
        '<span>' + L.icon('link', 's') + (uses.length ? esc(uses.map(function (u) { return u.label; }).join('; ')) : 'Not used yet') + '</span></p>' + L.contentsHTML('playlist', p.id) + '</div>' : '') + '</li>';
  }
  function renderList() {
    var rows = filtered(), all = D.playlists.length, anyFilter = filt.lane !== 'all' || filt.kind !== 'all' || filt.used !== 'all' || filt.q;
    var table = rows.length ? '<div class="pl-grid pl-colhead" aria-hidden="true"><span>Name</span><span class="pl-c">Tracks</span><span class="pl-c">Length</span><span></span></div>' +
      '<ul class="pl-list" aria-label="Playlists">' + rows.map(listRow).join('') + '</ul>'
      : !all ? '<div class="empty"><b>No playlists yet.</b> A playlist is music, ambience or effects that play together, in your order or picked by their tags. Start with <b>New playlist</b>, or tick tracks in the Library and choose <b>New playlist from these</b>.</div>'
      : '<div class="empty">No playlists match these filters. <button class="btn s" data-act="plclear" data-k="plclear">Show all playlists</button></div>';
    return '<div class="viewhead"><h1>Playlists</h1><span class="muted">' + plural(all, 'playlist') + '</span><span class="grow"></span>' +
      '<button class="btn primary" data-act="plnew" data-k="plnew" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'New playlist' + L.icon('chevdown', 's') + '</button></div>' +
      '<div class="viewbody fill pl-listbody">' + dropNotice('list') +
      '<div class="pl-tools"><div class="search pl-search">' + L.icon('search') + '<input class="input" type="search" placeholder="Search playlists" aria-label="Search playlists by name or tag" data-input="plfq" data-k="plfq" value="' + esc(filt.q) + '"></div>' +
      seg('lane', 'Music, ambience or FX', [['all', 'All'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']]) +
      seg('kind', 'Manual or dynamic', [['all', 'All'], ['manual', 'Manual', 'hand'], ['dynamic', 'Dynamic', 'tag']]) +
      seg('used', 'Used or not', [['all', 'All'], ['used', 'Used'], ['unused', 'Not used yet']]) + '</div>' +
      '<div class="col pl-listcol">' + L.pane({ id: 'pl-all', title: anyFilter ? 'Showing ' + rows.length + ' of ' + all : 'All playlists', icon: 'playlist', kind: 'music', noMax: true, flush: true, scroll: 'pl-all',
        status: D.playlists.some(playlistOnAir) ? status('Playing', 'live') : status('Ready'),
        summary: 'Drop audio files on a row to add them', body: table }) + '</div></div>' + dropZone();
  }

  L.acts.plfilt = function (el) { filt[el.dataset.f] = el.dataset.v; L.render(); L.say(filtered().length + ' playlists shown'); };
  L.inputs.plfq = function (el) { filt.q = el.value; L.render(); };
  L.acts.plclear = function () { filt = { lane: 'all', kind: 'all', used: 'all', q: '' }; L.render(); focusK('plfq'); };
  L.acts.pluse = function (el) { L.assignSheet('playlist', el.dataset.id); };
  L.acts.plrow = function (el) { L.route('#/playlist/' + el.dataset.id); };
  L.acts.plrowmore = function (el) {
    var p = L.playlist(el.dataset.id);
    L.menu(el, '<button role="menuitem" data-act="plrow" data-id="' + p.id + '">' + L.icon('right', 's') + 'Open</button>' +
      '<button role="menuitem" data-act="pluse" data-id="' + p.id + '">' + L.icon('link', 's') + 'Use in…</button>', 'More for ' + p.name);
  };
  L.acts.plnew = function (el) {
    function item(kind, lane, sub) { return '<button role="menuitem" data-act="plcreate" data-kind="' + kind + '" data-lane="' + lane + '">' + L.icon(KIND[kind].icon, 's') + '<span class="grow"><span style="display:block">' + KIND[kind].name + '</span><span class="hint" style="display:block">' + sub + '</span></span></button>'; }
    L.menu(el, '<div class="group">Music</div>' + item('manual', 'music', 'Pick tracks and put them in order') + item('dynamic', 'music', 'Every track that matches your tag rules') +
      '<div class="sep"></div><div class="group">Ambience</div>' + item('manual', 'amb', 'Pick ambience loops by hand') + item('dynamic', 'amb', 'Every ambience track that matches') +
      '<div class="sep"></div><div class="group">FX: sound effects and stings</div>' + item('manual', 'fx', 'Pick effects and stings by hand') + item('dynamic', 'fx', 'Every effect or sting that matches'), 'New playlist');
  };
  L.acts.plcreate = function (el) {
    var kind = el.dataset.kind, lane = el.dataset.lane;
    var p = { id: L.uid('p-'), name: 'New ' + (lane === 'fx' ? 'FX' : laneName(lane).toLowerCase()) + ' playlist', kind: kind, lane: lane, notes: '' };
    if (kind === 'manual') { p.items = []; L.state.panes['pl-add'] = 'o'; } else p.rule = blankRule();
    L.state.panes['pl-details'] = 'o';
    D.playlists.unshift(p); focusAfter = 'plname';
    L.route('#/playlist/' + p.id); L.toast('New playlist made. Give it a name.');
  };

  /* ---------- one track row (used by the manual list, the dynamic matches and the Add tracks search) ---------- */
  function trackRow(t, o) {
    var pv = L.previewing(t.id), p = o.prefix, air = trackOnAir(t), pl = cur(), own = !!(pl && !o.add && L.profileWhere && L.profileWhere(t, 'pl:' + pl.id) === 'playlist');
    var acts = pvBtn(t, p) + airBtn(t, p);
    if (o.add) acts += o.inList
      ? '<button class="btn s icon pl-added" data-act="pladd" data-tid="' + t.id + '" data-k="' + p + 'add-' + t.id + '" aria-disabled="true" title="Already in this playlist" aria-label="' + esc(L.title(t)) + ' is already in this playlist">' + L.icon('check', 's') + '</button>'
      : '<button class="btn s icon" data-act="pladd" data-tid="' + t.id + '" data-k="' + p + 'add-' + t.id + '" title="Add to this playlist" aria-label="Add ' + esc(L.title(t)) + '">' + L.icon('plus', 's') + '</button>';
    else acts += moreBtn(p + 'more-' + t.id, L.title(t), 'pltmore', 'data-tid="' + t.id + '"' + (o.manual ? ' data-manual="1"' : ''));
    return '<li class="pl-tr' + (pv ? ' pl-is-pv' : '') + (o.manual && flash.indexOf(t.id) > -1 ? ' pl-flash' : '') + '" data-tid="' + t.id + '"' + (o.manual ? ' draggable="true"' : '') + '>' +
      (o.manual ? '<span class="pl-grip" title="Drag to change the order" aria-hidden="true">' + L.icon('drag') + '</span><span class="pl-pos num">' + o.pos + '</span>' : '') +
      '<div class="pl-tline"><a class="pl-tname" href="#/library/' + t.id + '" data-k="' + p + 'tl-' + t.id + '" title="' + esc(trackTip(t)) + '">' + esc(L.title(t)) + '</a>' +
        (own ? '<span class="pl-own" title="Has its own audio profile in this playlist"><span class="pl-own-dot" aria-hidden="true"></span><span class="sr-only">Own audio profile in this playlist</span></span>' : '') +
        (air ? '<span class="badge onair">On air</span>' : '') +
        (L.isFx(t) ? '<span class="chip"><span class="lane-dot fx"></span>' + (t.kind === 'fx' ? 'FX' : 'FX · Sting') + '</span>' : '') + '</div>' +
      '<span class="num muted pl-dur">' + L.fmt(t.dur) + '</span><span class="pl-tacts">' + acts + '</span></li>';
  }
  // The ⋯ menu of a track row: reorder and remove (Manual), its audio profile here, open it in the Library.
  L.acts.pltmore = function (el) {
    var pl = cur(), t = L.track(el.dataset.tid); if (!pl || !t) return;
    var i = pl.kind === 'manual' ? pl.items.indexOf(t.id) : -1, n = pl.kind === 'manual' ? pl.items.length : 0, h = '';
    if (el.dataset.manual) h += '<button role="menuitem" data-act="plmove" data-d="-1" data-tid="' + t.id + '"' + (i === 0 ? ' disabled' : '') + '>' + L.icon('chevup', 's') + 'Move up<span class="kbd pl-mk">Alt+↑</span></button>' +
      '<button role="menuitem" data-act="plmove" data-d="1" data-tid="' + t.id + '"' + (i === n - 1 ? ' disabled' : '') + '>' + L.icon('chevdown', 's') + 'Move down<span class="kbd pl-mk">Alt+↓</span></button>' +
      '<button role="menuitem" data-act="plrm" data-tid="' + t.id + '">' + L.icon('close', 's') + 'Remove from this playlist</button><div class="sep"></div>';
    h += '<button role="menuitem" data-act="plprofile" data-tid="' + t.id + '">' + L.icon('wave', 's') + 'Audio profile in this playlist</button>' +
      '<button role="menuitem" data-act="pllib" data-tid="' + t.id + '">' + L.icon('library', 's') + 'Open in the Library</button>';
    L.menu(el, h, 'More for ' + L.title(t));
  };
  L.acts.plprofile = function (el) { L.route('#/profile/' + el.dataset.tid + '/pl:' + cur().id); };
  L.acts.pllib = function (el) { L.route('#/library/' + el.dataset.tid); };

  /* ---------- one playlist ---------- */
  function tracksPane(pl, tracks, air) {
    var body = tracks.length
      ? '<div class="pl-scroll" data-scroll="pl-tracks-n"><ol class="pl-tracks" aria-label="Tracks in order">' + tracks.map(function (t, i) { return trackRow(t, { prefix: 'm-', manual: true, pos: i + 1, n: tracks.length, air: air }); }).join('') + '</ol></div>' +
        '<p class="hint pl-foot">Drag rows, or press Alt+Up / Alt+Down, to change the order.</p>'
      : '<div class="empty">No tracks yet. Add them from <b>Add tracks</b>, or drop audio files or folders here.</div>';
    return L.pane({ id: 'pl-tracks', title: 'Tracks', icon: 'list', kind: 'music', flush: true, size: 'auto', scroll: 'pl-tracks',
      status: air ? status('Playing', 'live') : tracks.length ? status('Ready') : status('Empty'),
      summary: plural(tracks.length, 'track') + ' · ' + fmtLong(totalOf(tracks)),
      actions: '<button class="btn s" data-act="pladdopen" data-k="pladdopen">' + L.icon('plus', 's') + 'Add tracks</button>', body: body });
  }
  function addPane(pl) {
    var lane = addLane[pl.id] || pl.lane, q = addQuery.trim(), pool = D.tracks.filter(laneTest(lane));
    var hits = q ? pool.filter(function (t) { return matchesQuery(haystack(t), q); }) : pool;
    var list = hits.length ? '<ul class="pl-tracks">' + hits.slice(0, addLimit).map(function (t) { return trackRow(t, { prefix: 'a-', add: true, inList: pl.items.indexOf(t.id) > -1 }); }).join('') + '</ul>' +
        (hits.length > addLimit ? '<div class="pl-more"><button class="btn s" data-act="plmore" data-k="plmore">Show ' + Math.min(25, hits.length - addLimit) + ' more of ' + hits.length + '</button></div>' : '')
      : '<div class="empty">Nothing in the library matches "' + esc(q) + '".</div>';
    return L.pane({ id: 'pl-add', title: 'Add tracks', icon: 'search', kind: 'search', flush: true, scroll: 'pl-add', status: status('Ready'),
      summary: 'Search the library, or drop files here',
      body: '<div class="pl-addbar"><div class="search grow">' + L.icon('search') + '<input class="input" type="search" data-input="plq" data-k="plq" value="' + esc(addQuery) + '" placeholder="Any name or tag: Abbess, Eerie, Conan, Lothlorien…" aria-label="Search the library by any name or tag"></div>' +
        '<div class="seg s" role="group" aria-label="Search in">' + ['music', 'amb', 'fx'].map(function (l) { return '<button type="button" data-act="pladdlane" data-v="' + l + '" data-k="al-' + l + '" aria-pressed="' + (lane === l) + '">' + laneName(l) + '</button>'; }).join('') + '</div>' +
        '<span class="muted pl-count" aria-live="polite">' + (q ? hits.length + (hits.length === 1 ? ' match' : ' matches') : plural(hits.length, 'track')) + '</span></div>' +
        '<div class="pl-scroll" data-scroll="pl-add-n">' + list + '</div>' });
  }
  function condRow(c, i) {
    var g = group(c.group);
    return '<div class="pl-cond" role="group" aria-label="Condition ' + (i + 1) + '">' +
      '<span class="pl-and faint">' + (i ? 'and' : 'Where') + '</span>' +
      '<select class="input pl-sel" data-input="plcgroup" data-i="' + i + '" data-k="cg-' + i + '" aria-label="Tag group, condition ' + (i + 1) + '">' +
        D.tagGroups.map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.group ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<span class="faint">matches</span>' +
      '<select class="input pl-sel" data-input="plcmatch" data-i="' + i + '" data-k="cm-' + i + '" aria-label="How it matches, condition ' + (i + 1) + '">' +
        [['any', 'any of'], ['all', 'all of'], ['none', 'none of']].map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === c.match ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
      '<span class="chips pl-vals">' + c.values.map(function (v, j) {
        return '<span class="chip">' + esc(v) + '<button class="x" data-act="plvalrm" data-i="' + i + '" data-j="' + j + '" data-k="vr-' + i + '-' + esc(v) + '" title="Remove ' + esc(v) + '" aria-label="Remove ' + esc(v) + '">' + L.icon('close', 's') + '</button></span>';
      }).join('') +
      '<button class="btn s ghost" data-act="plvaladd" data-i="' + i + '" data-k="va-' + i + '" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add ' + esc(g.name.toLowerCase()) + '</button>' +
      (c.values.length ? '' : '<span class="hint pl-warn">Needs a value</span>') + '</span>' +
      '<button class="closer" data-act="plcrm" data-i="' + i + '" data-k="cr-' + i + '" title="Remove this condition" aria-label="Remove condition ' + (i + 1) + '">' + L.icon('trash') + '</button></div>';
  }
  function rulesPane(pl) {
    var r = pl.rule, en = r.energy || [0, 5], words = ruleWords(r), waiting = r.conds.some(function (c) { return !c.values.length; });
    function opts(sel) { var h = ''; for (var i = 0; i <= 5; i++) h += '<option' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return h; }
    var none = !L.playlistTracks(pl).length;
    return L.pane({ id: 'pl-rules', title: 'Rules', icon: 'rule', kind: 'search', size: 'auto', status: none ? status('Empty', 'warn') : status('Ready'), summary: esc(words || 'Every ' + laneName(pl.lane).toLowerCase() + ' track'),
      body: '<div class="pl-conds">' + (r.conds.length ? r.conds.map(condRow).join('') : '<p class="muted">No conditions yet, so every ' + laneName(pl.lane).toLowerCase() + ' track in the library matches.</p>') + '</div>' +
        '<div class="pl-rulebar"><button class="btn s" data-act="plcadd" data-k="plcadd">' + L.icon('plus', 's') + 'Add condition</button>' +
        '<span class="pl-energy"><span class="faint" id="pl-en-l">Energy from</span><select class="input pl-sel pl-num" data-input="plen" data-e="0" data-k="en0" aria-label="Lowest energy" aria-describedby="pl-en-hint">' + opts(en[0]) + '</select>' +
        '<span class="faint">to</span><select class="input pl-sel pl-num" data-input="plen" data-e="1" data-k="en1" aria-label="Highest energy" aria-describedby="pl-en-hint">' + opts(en[1]) + '</select></span>' +
        '<label class="pl-check"><input type="checkbox" data-input="plsting" data-k="plsting"' + (r.notRole === 'Sting' ? ' checked' : '') + '>Leave out stings</label></div>' +
        '<p class="pl-words"><span class="faint">In plain words:</span> ' + esc(laneName(pl.lane)) + ' tracks' + (words ? ' with ' + esc(words) : ', all of them') + '.' + (waiting ? ' <span class="pl-warn">A condition still needs a value, so nothing matches yet.</span>' : '') + '</p>' +
        // The energy lists start at 0, which is a track whose energy is not set.
        '<p class="hint pl-enhint" id="pl-en-hint">Energy 0 means a track with no energy set.</p>' });
  }
  function matchPane(pl, tracks, air) {
    return L.pane({ id: 'pl-match', title: 'Matching tracks', icon: 'list', kind: 'music', flush: true, scroll: 'pl-match',
      status: air ? status('Playing', 'live') : tracks.length ? status('Ready') : status('Empty'),
      summary: plural(tracks.length, 'track') + ' · ' + fmtLong(totalOf(tracks)),
      actions: '<button class="btn s" data-act="plcopyhand" data-k="plcopyhand" title="Freeze these tracks into a new Manual playlist you can reorder"' + (tracks.length ? '' : ' disabled') + '>' + L.icon('hand', 's') + 'Make a manual copy</button>',
      body: tracks.length ? '<div class="pl-scroll" data-scroll="pl-match-n"><ul class="pl-tracks" aria-label="Matching tracks">' + tracks.map(function (t) { return trackRow(t, { prefix: 'x-', air: air }); }).join('') + '</ul></div>'
        : '<div class="empty">No tracks match these rules yet. Loosen a condition or widen the energy range.</div>' });
  }
  function usesPane(pl, uses) {
    var LV = { campaign: 'Campaign', session: 'Session', scene: 'Scene' };
    var rows = uses.map(function (u, i) {
      var href = u.level === 'campaign' ? '#/campaign/' + u.campaign.id : '#/session/' + u.campaign.id + '/' + u.session.id;
      var main = u.level === 'campaign' ? u.campaign.name : u.level === 'session' ? 'Session ' + u.session.n + ': ' + u.session.name : u.scene.name;
      var sub = u.level === 'campaign' ? 'Whole campaign' : u.level === 'session' ? u.campaign.name + ' · that evening' :
        (u.scene.amb === pl.id ? 'Ambience in this scene' : 'Plays in this scene (' + (u.scene.music.indexOf(pl.id) + 1) + ' of ' + L.sceneItems(u.scene).length + ')') + ' · Session ' + u.session.n + ' · ' + u.campaign.name;
      return '<li class="lrow pl-use" title="' + esc(main + '\n' + sub) + '"><span class="pl-lv">' + LV[u.level] + '</span><a class="ellipsis pl-ulink grow" href="' + href + '" data-k="use-' + i + '">' + esc(main) + '<span class="sr-only">, ' + esc(sub) + '</span></a>' +
        (u.level === 'scene' ? '<span class="num muted pl-upos">' + (u.scene.amb === pl.id ? 'Amb.' : (u.scene.music.indexOf(pl.id) + 1) + ' of ' + L.sceneItems(u.scene).length) + '</span>' : '') + '</li>';
    }).join('');
    return L.pane({ id: 'pl-uses', title: 'Used in', icon: 'link', kind: 'scenes', size: 'auto', flush: true, status: uses.length ? status('Ready') : status('Empty'),
      actions: '<button class="btn s" data-act="pluse" data-id="' + pl.id + '" data-k="pluse2">Use in…</button>',
      body: (uses.length ? '<ul class="list">' + rows + '</ul>' : '<div class="empty">Not used yet.</div>') +
        '<p class="hint pl-levels">Campaign: every session. Session: that evening. Scene: plays in that scene, in its place in the list.</p>' });
  }
  function detailsPane(pl, tracks) {
    var k = KIND[pl.kind];
    return L.pane({ id: 'pl-details', title: 'Details', icon: 'edit', kind: 'plain', size: 'auto', status: status('Saved'), summary: pl.notes ? 'Has notes' : '',
      body: '<div class="stack pl-details"><div class="field"><label for="pl-name">Name</label><input id="pl-name" class="input" type="text" data-input="plname" data-k="plname" value="' + esc(pl.name) + '"></div>' +
        '<p class="pl-facts" title="' + (pl.kind === 'manual' ? 'Manual: you pick the tracks and their order.' : 'Dynamic: Lyre fills it with every track that matches the rules, including tracks you tag later.') + '">' + kindLane(pl) + '</p>' +
        '<div class="field"><label for="pl-notes">Notes</label><textarea id="pl-notes" class="input" rows="3" data-input="plnotes" data-k="plnotes" placeholder="When to use it, what to avoid…">' + esc(pl.notes || '') + '</textarea></div>' +
        '<div class="row-flex pl-danger"><span class="grow"></span>' +
        '<button class="btn s danger" data-act="pldel" data-k="pldel">' + L.icon('trash', 's') + 'Delete playlist…</button></div></div>' });
  }
  function renderOne(p) {
    var pl = L.playlist(p.pid);
    if (!pl) return '<div class="viewhead"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/playlists">Playlists</a></nav><h1>Playlist not found</h1></div><div class="empty">This playlist no longer exists. <a href="#/playlists">Back to all playlists</a></div>';
    var tracks = L.playlistTracks(pl), uses = L.usesOfPlaylist(pl.id), air = onAirFrom(pl), first = tracks[0];
    var pv = L.previewing('pl:' + pl.id) || tracks.some(function (t) { return L.previewing(t.id); });
    var main = pl.kind === 'manual' ? [tracksPane(pl, tracks, air), addPane(pl)] : [rulesPane(pl), matchPane(pl, tracks, air)];
    var side = [usesPane(pl, uses), detailsPane(pl, tracks)];
    function col(cls, panes, ids) { return '<div class="col ' + cls + (ids.indexOf(L.state.maxed) > -1 ? ' has-max' : '') + '">' + panes.join('') + '</div>'; }
    return '<div class="viewhead pl-head"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/playlists" data-k="crumb">Playlists</a><span class="sep">›</span></nav>' +
      '<h1 class="pl-h1" title="' + esc(pl.name) + '">' + esc(pl.name || 'Untitled playlist') + '</h1>' +
      '<button class="closer" data-act="plrename" data-k="plrename" title="Rename" aria-label="Rename this playlist">' + L.icon('edit') + '</button>' +
      '<span class="pl-headchips">' + kindLane(pl) + '</span>' +
      '<span class="grow"></span>' +
      (air ? '<span class="badge onair" title="Playing from this playlist">On air</span>' : '') +
      '<button class="btn pl-pvbtn" data-act="plpreview" data-k="plpreview" aria-pressed="' + !!pv + '"' + (first ? '' : ' disabled') + ' title="' + (pv ? 'Stop the preview' : 'Play the first track in your headphones only') + '">' + L.icon(pv ? 'stop' : 'headphones', 's') + (pv ? 'Stop preview' : 'Preview') + '</button>' +
      '<button class="btn" data-act="plair" data-k="plair"' + (first ? '' : ' disabled') + ' title="Start the first track for the players">' + L.icon('broadcast', 's') + 'Play on air</button>' +
      '<button class="btn" data-act="pluse" data-id="' + pl.id + '" data-k="pluse1">' + L.icon('link', 's') + 'Use in…</button></div>' +
      '<div class="viewbody pl-body">' + dropNotice('page:' + pl.id) + '<div class="pl-page">' + col('pl-main', main, ['pl-tracks', 'pl-add', 'pl-rules', 'pl-match']) + col('pl-side', side, ['pl-uses', 'pl-details']) + '</div></div>' + dropZone();
  }

  /* ---------- playlist actions ---------- */
  function moveTo(pl, tid, to) {
    var from = pl.items.indexOf(tid); if (from < 0) return;
    to = Math.max(0, Math.min(pl.items.length - 1, to)); if (to === from) return;
    pl.items.splice(from, 1); pl.items.splice(to, 0, tid); L.render();
    L.say('Moved ' + L.title(L.track(tid)) + ' to position ' + (to + 1) + ' of ' + pl.items.length);
  }
  L.acts.plmove = function (el) { var pl = cur(); if (pl) { moveTo(pl, el.dataset.tid, pl.items.indexOf(el.dataset.tid) + +el.dataset.d); focusK('m-more-' + el.dataset.tid); } };
  L.onKey(function (e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
    var pl = cur(), a = document.activeElement, row = a && a.closest && a.closest('.pl-tr[draggable]');
    if (!pl || !row || pl.kind !== 'manual') return false;
    moveTo(pl, row.dataset.tid, pl.items.indexOf(row.dataset.tid) + (e.key === 'ArrowUp' ? -1 : 1)); return true;
  });
  L.acts.plrm = function (el) {
    var pl = cur(), tid = el.dataset.tid, i = pl.items.indexOf(tid); if (i < 0) return;
    pl.items.splice(i, 1); var next = pl.items[i] || pl.items[i - 1];
    L.render(); focusK(next ? 'm-more-' + next : 'pladdopen');
    L.say('Removed ' + L.title(L.track(tid)) + '. ' + plural(pl.items.length, 'track') + ' left.');
  };
  L.acts.pladd = function (el) {
    var pl = cur(), tid = el.dataset.tid;
    if (pl.items.indexOf(tid) > -1) { L.toast('Already in this playlist'); return; }
    pl.items.push(tid); L.render(); L.say('Added ' + L.title(L.track(tid)) + ' at position ' + pl.items.length);
  };
  L.acts.pladdopen = function () { L.state.panes['pl-add'] = 'o'; if (L.state.maxed) L.state.maxed = null; L.render(); focusK('plq'); };
  L.inputs.plq = function (el) { addQuery = el.value; addLimit = 20; L.render(); };
  L.acts.pladdlane = function (el) { addLane[cur().id] = el.dataset.v; addLimit = 20; L.render(); L.say('Searching ' + laneName(el.dataset.v)); };
  // Play one track on air. An effect plays over the music (core layers kind 'fx'); music and ambience keep the playlist so Next follows it.
  L.acts.pltair = function (el) {
    var t = L.track(el.dataset.tid), pl = cur(); if (!t) return;
    if (t.kind === 'fx') L.play(t.id); else L.play(t.id, { lane: t.kind === 'amb' ? 'amb' : 'music', playlistId: pl && L.playlistTracks(pl).some(function (x) { return x.id === t.id; }) ? pl.id : '' });
  };
  L.acts.plmore = function () { var first = addLimit; addLimit += 25; L.render(); var rows = document.querySelectorAll('.pl-main [data-pane="pl-add"] .pl-tr'); if (rows[first]) { var a = rows[first].querySelector('a'); if (a) a.focus(); } };
  L.acts.plprev = function (el) { L.preview(el.dataset.tid); };
  L.acts.plpreview = function () {
    var pl = cur(), tracks = L.playlistTracks(pl);
    if (L.previewing('pl:' + pl.id) || tracks.some(function (t) { return L.previewing(t.id); })) { L.stopPreview(); L.say('Preview stopped'); }
    else L.previewPlaylist(pl.id);
  };
  L.acts.plair = function () { var pl = cur(), t = L.playlistTracks(pl)[0]; if (!t) return; if (t.kind === 'fx') L.play(t.id); else L.play(t.id, { lane: pl.lane === 'amb' ? 'amb' : 'music', playlistId: pl.id }); L.toast('On air: ' + L.title(t)); };
  L.acts.plrename = function () { L.state.panes['pl-details'] = 'o'; L.state.maxed = null; L.render(); focusK('plname'); };
  L.inputs.plname = function (el) { var pl = cur(); pl.name = el.value; var h = document.querySelector('.pl-h1'); if (h) h.textContent = el.value || 'Untitled playlist'; };
  L.inputs.plnotes = function (el) { cur().notes = el.value; };

  // Rule builder
  function ruleChanged(pl, msg) { cleanRule(pl.rule); L.render(); L.say((msg ? msg + '. ' : '') + plural(L.playlistTracks(pl).length, 'track') + ' match'); }
  L.acts.plcadd = function () {
    var pl = cur(), used = pl.rule.conds.map(function (c) { return c.group; });
    var g = D.tagGroups.filter(function (x) { return used.indexOf(x.id) < 0; })[0] || D.tagGroups[0];
    pl.rule.conds.push({ group: g.id, match: 'any', values: [] });
    ruleChanged(pl, 'Condition added'); focusK('va-' + (pl.rule.conds.length - 1));
  };
  L.acts.plcrm = function (el) { var pl = cur(); pl.rule.conds.splice(+el.dataset.i, 1); ruleChanged(pl, 'Condition removed'); focusK(pl.rule.conds.length ? 'cr-0' : 'plcadd'); };
  L.inputs.plcgroup = function (el) { var c = cur().rule.conds[+el.dataset.i]; if (c.group !== el.value) { c.group = el.value; c.values = []; ruleChanged(cur(), 'Tag group is now ' + group(c.group).name); } };
  L.inputs.plcmatch = function (el) { cur().rule.conds[+el.dataset.i].match = el.value; ruleChanged(cur()); };
  L.acts.plvalrm = function (el) {
    var pl = cur(), i = +el.dataset.i, c = pl.rule.conds[i], v = c.values.splice(+el.dataset.j, 1)[0];
    ruleChanged(pl, 'Removed ' + v); focusK('va-' + i);
  };
  L.acts.plvaladd = function (el) {
    var c = cur().rule.conds[+el.dataset.i], g = group(c.group); valCond = +el.dataset.i;
    var vals = D.tagValues[c.group].filter(function (v) { return c.values.indexOf(v) < 0; });
    L.menu(el, '<div class="pl-mq"><input class="input" type="search" data-input="plvalq" placeholder="Type to filter" aria-label="Filter ' + esc(g.name.toLowerCase()) + ' values"></div>' +
      (vals.length ? vals.map(function (v) { return '<button role="menuitem" data-act="plvalpick" data-v="' + esc(v) + '"><span class="chip">' + esc(v) + '</span></button>'; }).join('')
        : '<p class="hint" style="padding:6px 8px">Every ' + esc(g.name.toLowerCase()) + ' is already in this condition.</p>'), 'Add a ' + g.name.toLowerCase());
  };
  L.inputs.plvalq = function (el) {
    var q = el.value.toLowerCase(); el.closest('.menu').querySelectorAll('[data-act="plvalpick"]').forEach(function (b) { var off = b.dataset.v.toLowerCase().indexOf(q) < 0; b.hidden = off; b.disabled = off; });
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.dataset || e.target.dataset.input !== 'plvalq') return;
    var b = e.target.closest('.menu').querySelector('[data-act="plvalpick"]:not([disabled])'); if (b) { e.preventDefault(); b.click(); }
  });
  L.acts.plvalpick = function (el) {
    var pl = cur(), c = pl.rule.conds[valCond]; if (!c) return;
    if (c.values.indexOf(el.dataset.v) < 0) c.values.push(el.dataset.v);
    ruleChanged(pl, 'Added ' + el.dataset.v); focusK('va-' + valCond);
  };
  L.inputs.plen = function (el) {
    var pl = cur(), en = (pl.rule.energy || [0, 5]).slice(); en[+el.dataset.e] = +el.value;
    if (en[0] > en[1]) en = [en[1], en[0]];
    pl.rule.energy = en; ruleChanged(pl, 'Energy ' + en[0] + ' to ' + en[1]);
  };
  L.inputs.plsting = function (el) { var pl = cur(); pl.rule.notRole = el.checked ? 'Sting' : ''; ruleChanged(pl, el.checked ? 'Stings left out' : 'Stings included'); };
  L.acts.plcopyhand = function () {
    var pl = cur(), c = copyOf(pl, pl.name + ' (manual)', 'manual');
    L.route('#/playlist/' + c.id); L.toast('Manual copy with ' + plural(c.items.length, 'track') + '. It will not change when tags change.');
  };

  // Delete
  L.acts.pldel = function () {
    var pl = cur(), uses = L.usesOfPlaylist(pl.id);
    L.sheet({ title: 'Delete "' + (pl.name || 'Untitled playlist') + '"?',
      body: (uses.length ? '<p>It is used in ' + esc(usedText(uses)) + '. Deleting it takes it out of these:</p><ul class="pl-dellist">' + uses.map(function (u) { return '<li>' + esc(u.label) + '</li>'; }).join('') + '</ul>'
        : '<p>It is not used in any campaign, session or scene.</p>') +
        '<p class="muted" style="margin-top:8px">The tracks stay in your library.</p>',
      footer: '<button class="btn" data-act="closesheet">Keep it</button><button class="btn danger" data-act="pldeldo">' + L.icon('trash', 's') + 'Delete playlist</button>' });
  };
  L.acts.pldeldo = function () {
    var pl = cur(), id = pl.id;
    D.campaigns.forEach(function (c) {
      function out(a) { var i = a.indexOf(id); if (i > -1) a.splice(i, 1); }
      out(c.playlists); c.sessions.forEach(function (s) { out(s.playlists); s.scenes.forEach(function (sc) { out(sc.music); if (sc.amb === id) sc.amb = ''; }); });
    });
    D.playlists.splice(D.playlists.indexOf(pl), 1);
    L.closeSheet(); L.route('#/playlists'); L.toast('Deleted "' + pl.name + '"');
  };

  /* ---------- dropping files and folders from the computer ----------
     Uses core L.filesFromDrop (walks folders, keeps audio) and L.importFiles (adds to the Library, returns track ids).
     Only drags that carry Files are handled here; reordering rows uses its own drag events above. */
  var flash = [], flashPl = null, notice = null, pending = null, dragTimer = null;
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, 'Files') > -1; }
  function isMine() { var n = L.current().name; return n === 'playlist' || n === 'playlists'; }
  function clearMarks() { document.querySelectorAll('#view .pl-drop-before, #view .pl-drop-after, #view .pl-droptarget').forEach(function (x) { x.classList.remove('pl-drop-before', 'pl-drop-after', 'pl-droptarget'); }); }
  function dragUI(on) { var v = document.getElementById('view'); if (v) v.classList.toggle('pl-filedrag', on); if (!on) clearMarks(); }
  function dropMsg(text) { var m = document.querySelector('#view .pl-dropmsg span'); if (m && m.textContent !== text) m.textContent = text; }
  function dropZone() { return '<div class="pl-dropzone" aria-hidden="true"><div class="pl-dropmsg">' + L.icon('folder', 's') + '<span></span></div></div>'; }
  function tracksWord(n) { return n === 1 ? '1 track' : n + ' tracks'; }
  // The line under the head after a drop (role=status, so it is read out), or the question while a drop waits for an answer.
  function dropNotice(where) {
    if (pending && pending.where === where) {
      var n = pending.files.length, pl = pending.pid && L.playlist(pending.pid), lead = '<b>' + (n === 1 ? '1 audio file' : n + ' audio files') + '</b> dropped. ';
      if (pl) return '<div class="pl-notice pl-ask" role="group" aria-label="Dropped files">' + L.icon('tag', 's') + '<span class="grow">' + lead + '"' + esc(pl.name) + '" is a Dynamic playlist: tracks appear in it only when their tags match its rules, and new files have no tags yet.</span>' +
        '<button class="btn s primary" data-act="pldropdo" data-k="pldropdo">Add to the Library anyway</button><button class="btn s" data-act="pldropno" data-k="pldropno">Cancel</button></div>';
      var opts = ['music', 'amb', 'fx'].map(function (l) {
        var ps = D.playlists.filter(function (p) { return p.kind === 'manual' && p.lane === l; });
        return ps.length ? '<optgroup label="' + laneName(l) + '">' + ps.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</optgroup>' : '';
      }).join('');
      return '<div class="pl-notice pl-ask" role="group" aria-label="Dropped files">' + L.icon('folder', 's') + '<span class="pl-asktext">' + lead + 'Add them to</span>' +
        '<select class="input pl-asksel" data-k="pldropsel" aria-label="Playlist to add the dropped files to">' + opts + '</select>' +
        '<button class="btn s primary" data-act="pldropto" data-k="pldropto">Add</button><span class="faint">or</span>' +
        '<button class="btn s" data-act="pldropnew" data-k="pldropnew">' + L.icon('plus', 's') + 'New playlist from dropped files</button>' +
        '<button class="btn s ghost" data-act="pldropdo" data-k="pldroplib">Library only</button><button class="btn s ghost" data-act="pldropno" data-k="pldropno">Cancel</button></div>';
    }
    if (!notice || notice.where !== where) return '';
    return '<div class="pl-notice" role="status">' + L.icon('check', 's') + '<span class="grow">' + notice.text + '</span>' +
      (notice.open ? '<a class="btn s" href="#/playlist/' + notice.open + '" data-k="pldropopen">Open ' + esc((L.playlist(notice.open) || {}).name || 'playlist') + '</a>' : '') +
      '<button class="btn s" data-act="plshownew" data-k="plshownew">' + L.icon('library', 's') + 'Open new tracks in the Library</button>' +
      '<button class="closer" data-act="plnoticex" data-k="plnoticex" title="Dismiss" aria-label="Dismiss this message">' + L.icon('close') + '</button></div>';
  }
  function flashSoon() { setTimeout(function () { flash = []; flashPl = null; document.querySelectorAll('#view .pl-flash').forEach(function (x) { x.classList.remove('pl-flash'); }); }, 3200); }
  // Add imported ids to a manual playlist at index (or the end); returns the message for the notice line.
  function addToPlaylist(pl, ids, index) {
    var fresh = ids.filter(function (id, i) { return pl.items.indexOf(id) < 0 && ids.indexOf(id) === i; }), dup = ids.length - fresh.length;
    var at = index == null || index < 0 ? pl.items.length : Math.min(index, pl.items.length);
    pl.items.splice.apply(pl.items, [at, 0].concat(fresh));
    flash = fresh; flashSoon();
    var text = fresh.length ? '<b>' + tracksWord(fresh.length) + '</b> added to ' + esc(pl.name) + ' and your Library' + (index != null && index >= 0 && at < pl.items.length - fresh.length ? ', at position ' + (at + 1) : '') + '. Give them titles and tags in the Library.'
      : 'Those tracks are already in ' + esc(pl.name) + '.';
    if (fresh.length && dup) text += ' ' + (dup === 1 ? '1 was' : dup + ' were') + ' already in it.';
    return text;
  }
  function libraryOnly(ids, pl) {
    flashSoon();
    return '<b>' + tracksWord(ids.length) + '</b> added to your Library.' + (pl ? ' They appear in ' + esc(pl.name) + ' once their tags match its rules.' : '') + ' Give them titles and tags in the Library.';
  }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent; }
  function dropTarget(e) {
    var r = L.current(), el = e.target && e.target.closest ? e.target : null;
    if (r.name === 'playlist') {
      var pl = L.playlist(r.p.pid), row = el && el.closest('.pl-main [data-pane="pl-tracks"] .pl-tr[draggable]');
      if (!pl) return null;
      if (pl.kind !== 'manual') return { page: pl, dyn: true };
      if (!row) return { page: pl, index: -1 };
      var b = row.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2;
      return { page: pl, row: row, after: after, index: pl.items.indexOf(row.dataset.tid) + (after ? 1 : 0) };
    }
    var li = el && el.closest('.pl-item[data-pid]');
    return li ? { list: L.playlist(li.dataset.pid), li: li } : { list: null };
  }
  document.addEventListener('dragenter', function (e) { if (isMine() && hasFiles(e)) { e.preventDefault(); dragUI(true); } });
  document.addEventListener('dragover', function (e) {
    if (!isMine() || !hasFiles(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dragUI(true);
    clearTimeout(dragTimer); dragTimer = setTimeout(function () { dragUI(false); }, 400);   // dragover repeats while over the page
    var t = dropTarget(e); clearMarks(); if (!t) return;
    if (t.page) {
      if (t.dyn) dropMsg('Drop to add to your Library. They appear in ' + t.page.name + ' only when their tags match its rules.');
      else if (t.row) { t.row.classList.add(t.after ? 'pl-drop-after' : 'pl-drop-before'); dropMsg('Drop to add to ' + t.page.name + ' at position ' + (t.index + 1) + '. They also go into your Library.'); }
      else dropMsg('Drop to add to ' + t.page.name + ' (at the end). They also go into your Library.');
    } else if (t.li) { t.li.classList.add('pl-droptarget'); dropMsg(t.list.kind === 'manual' ? 'Drop to add to ' + t.list.name + '. They also go into your Library.' : t.list.name + ' is Dynamic: drop to choose what to do.'); }
    else dropMsg('Drop on a playlist to add the files to it, or here to choose one. They also go into your Library.');
  });
  document.addEventListener('dragleave', function (e) { if (isMine() && hasFiles(e) && !e.relatedTarget) dragUI(false); });
  document.addEventListener('drop', function (e) {
    if (!isMine() || !hasFiles(e)) return;
    e.preventDefault(); clearTimeout(dragTimer);
    var t = dropTarget(e); dragUI(false); if (!t) return;
    L.filesFromDrop(e, function (files) {
      if (!files.length) { L.toast('Nothing to add: there are no audio files in what you dropped'); return; }
      notice = null; pending = null;
      if (t.page && !t.dyn) { notice = { where: 'page:' + t.page.id, text: addToPlaylist(t.page, L.importFiles(files), t.index) }; L.render(); L.say(plain(notice.text)); return; }
      if (t.page) pending = { where: 'page:' + t.page.id, pid: t.page.id, files: files };
      else if (t.list && t.list.kind === 'manual') { notice = { where: 'list', open: t.list.id, text: addToPlaylist(t.list, L.importFiles(files)) }; flashPl = t.list.id; L.render(); L.say(plain(notice.text)); return; }
      else if (t.list) pending = { where: 'list', pid: t.list.id, files: files };
      else pending = { where: 'list', files: files };
      L.render(); L.say(files.length + ' audio files dropped. Choose what to do with them.'); focusK(pending.pid ? 'pldropdo' : 'pldropsel');
    });
  });
  L.acts.pldropno = function () { pending = null; L.render(); L.say('Nothing added'); };
  L.acts.pldropdo = function () {   // Library only (or "Add to the Library anyway" for a Dynamic playlist)
    var pd = pending; if (!pd) return; pending = null;
    var ids = L.importFiles(pd.files), pl = pd.pid && L.playlist(pd.pid);
    notice = { where: pd.where, text: libraryOnly(ids, pl) }; L.render(); L.say(plain(notice.text)); focusK('plshownew');
  };
  L.acts.pldropto = function () {
    var pd = pending, sel = document.querySelector('[data-k="pldropsel"]'), pl = sel && L.playlist(sel.value); if (!pd || !pl) return; pending = null;
    notice = { where: 'list', open: pl.id, text: addToPlaylist(pl, L.importFiles(pd.files)) }; flashPl = pl.id; L.render(); L.say(plain(notice.text)); focusK('pldropopen');
  };
  L.acts.pldropnew = function () {
    var pd = pending; if (!pd) return; pending = null;
    var ids = L.importFiles(pd.files), n = { music: 0, amb: 0, fx: 0 }; ids.forEach(function (id) { var t = L.track(id); if (t) n[t.kind]++; });
    var lane = n.amb > n.music && n.amb >= n.fx ? 'amb' : n.fx > n.music ? 'fx' : 'music';
    var p = { id: L.uid('p-'), name: 'New playlist from dropped files', kind: 'manual', lane: lane, items: [], notes: '' };
    D.playlists.unshift(p); L.state.panes['pl-details'] = 'o';
    notice = { where: 'page:' + p.id, text: addToPlaylist(p, ids) }; focusAfter = 'plname';
    L.route('#/playlist/' + p.id); L.say(plain(notice.text) + ' Give the playlist a name.');
  };
  L.acts.plnoticex = function () { notice = null; L.render(); };
  L.acts.plshownew = function () { notice = null; L.route('#/library'); if (L.acts.lbshownew) L.acts.lbshownew(); };

  /* ---------- views ---------- */
  L.view('playlists', {
    nav: 'playlists', title: function () { return 'Playlists'; },
    notesTitle: 'Playlists: what changed',
    notes: [
      'Round 4 clean-up: one line per playlist (kind icon, a small lane dot, name, tracks, length). The rule and where it is used show on hover and in the row\'s expander.',
      'Every row has the same three buttons: <b>Preview</b>, <b>Play on air</b>, then <b>⋯</b> for Open and Use in…. Clicking a row opens it.',
      'The box header says what it is doing: <b>Playing</b> (red, the players hear it) or <b>Ready</b>.',
      'Filters: Music / Ambience / FX, Manual / Dynamic, Used / Not used yet, and search.',
      'Drop audio files or folders from your computer on a row to add them to that playlist and your Library; drop anywhere else to choose.'
    ],
    render: renderList
  });
  L.view('playlist', {
    nav: 'playlists', title: function (p) { var pl = L.playlist(p.pid); return pl ? pl.name : 'Playlist'; },
    notesTitle: 'A playlist: what changed',
    notes: [
      'Round 4 clean-up: one line per track. Hover a title for the title in the file, file name, tags and energy; click it to open the track in the Library.',
      'Each row: <b>Preview</b>, <b>Play on air</b>, then <b>⋯</b> for Move up / Move down, Remove, Audio profile in this playlist and Open in the Library. Drag rows or press Alt+Up / Alt+Down to reorder.',
      'Each box shows one status: Tracks <b>Playing</b> (red) / Ready / Empty, Used in Ready / Empty, Details Saved.',
      '<b>Dynamic</b> (try "Abbey: eerie, low energy"): add conditions; the matches and the rule in plain words update as you go. <b>Make a manual copy</b> freezes them.',
      'Drop audio files or folders from your computer onto a Manual playlist: a line shows where they go, and they also go into your Library.'
    ],
    render: renderOne,
    after: function (root) {
      if (focusAfter) { focusK(focusAfter); focusAfter = null; }
      var pl = cur(); if (!pl || pl.kind !== 'manual') return;
      function clear() { root.querySelectorAll('.pl-drop-before,.pl-drop-after').forEach(function (x) { x.classList.remove('pl-drop-before', 'pl-drop-after'); }); }
      root.querySelectorAll('.pl-tr[draggable]').forEach(function (li) {
        li.addEventListener('dragstart', function (e) { dragId = li.dataset.tid; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* older engines */ } li.classList.add('pl-dragging'); });
        li.addEventListener('dragend', function () { dragId = null; li.classList.remove('pl-dragging'); clear(); });
        li.addEventListener('dragover', function (e) {
          if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; clear(); li.classList.add(after ? 'pl-drop-after' : 'pl-drop-before');
        });
        li.addEventListener('drop', function (e) {
          if (!dragId) return; e.preventDefault();
          var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, items = pl.items.filter(function (x) { return x !== dragId; });
          var to = items.indexOf(li.dataset.tid) + (after ? 1 : 0), id = dragId; dragId = null;
          if (li.dataset.tid === id) { clear(); return; }
          pl.items = items; pl.items.splice(to, 0, id); L.render();
          L.say('Moved ' + L.title(L.track(id)) + ' to position ' + (to + 1) + ' of ' + pl.items.length);
        });
      });
    }
  });
})();
