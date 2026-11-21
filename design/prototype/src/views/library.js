/* Library view: every track in one place, in three panes: Filters | Tracks | Details.
   Routes: #/library (the list) and #/library/<trackId> (a track open in Details).
   Flows:
     - filter by All / Music / Ambience / FX (effects and stings), "New, not tagged yet", tag values, energy and folder; search all three names,
       artist, album and tags; sort.
     - select rows (box, Space, Shift-click for a range), then Tag… (bulk add or remove, create values) or
       Add to playlist… / New playlist from these.
     - open a track: edit Your title, see Title in the file, File name and Folder; tags per group with a type-ahead
       combobox; energy, role, loop advice, notes; playlists it is in and the scenes it reaches.
     - Add tracks: files, a folder, a watched folder, or drop files anywhere on the page (all simulated).
   Layout: wide (app >= 1200 px) three columns, collapsed side panes fold into 34 px strips;
   mid (>= 820 px) Filters above Tracks, Details on the right at about 40 %; narrow: one column, Details
   replaces the list and has a Back button.
   Candidates for core: a way for a view to keep focus after a route change (the lyre:route listener below). */
(function () {
  var D = L.data, esc = L.esc;
  D.watched = D.watched || [];
  // 0.5.2 items 20 and 40 (the app's FolderActions; 0.6.0 sync): what kind a library folder's new tracks are (none:
  // guessed from the folder name), and the folders listed only because tracks sit outside every library folder.
  D.folderKinds = D.folderKinds || {};
  D.autoFolders = D.autoFolders || [];
  var ROLES = ['Loop bed', 'Underscore', 'Sting', 'Transition'];
  var LOOPS = [['yes', 'Loops well'], ['crossfade', 'Crossfade the loop'], ['no', 'Do not loop']];
  var SORTS = [['title', 'Title A to Z'], ['title-d', 'Title Z to A'], ['artist', 'Artist A to Z'], ['artist-d', 'Artist Z to A'], ['short', 'Shortest first'], ['long', 'Longest first'], ['new', 'Newest first'], ['old', 'Oldest first']];
  var st = { kind: 'all', newOnly: false, missing: false, shapes: [], tags: { mood: [], motif: [], scene: [] }, emin: 1, emax: 5, folder: '', q: '', sort: 'title', sel: [], cursor: null, anchor: null, guide: null,
    // Round 9 (§7, items 26, 27, 34): the columns shown, the order of the filter chips, and what is left out (hidden).
    cols: ['tags', 'energy', 'len'], forder: 'vocab', hide: { mood: [], motif: [], scene: [] }, hideShapes: [], hideFolders: [] };
  // Round 9 (§7, item 26): the columns Nik can show. Title is always there; the rest fold into the row's hover text
  // when the pane is too narrow (as Energy did).
  var COLS = [['artist', 'Artist'], ['album', 'Album'], ['type', 'Type'], ['use', 'Use it for'], ['tags', 'Tags'], ['shape', 'Shape'], ['energy', 'Energy'], ['len', 'Length'], ['plays', 'Plays for'], ['added', 'Added'], ['folder', 'Folder']];
  var USUAL_COLS = ['tags', 'energy', 'len'];
  // A header sorts by its column: first press A to Z (or shortest, lowest, oldest first), second Z to A (item 25).
  var COL_SORT = { title: 'title', artist: 'artist', album: 'album', type: 'type', use: 'use', energy: 'energy', len: 'short', plays: 'plays', added: 'old', shape: 'shape', folder: 'folder' };
  try { var savedCols = JSON.parse(localStorage.getItem('lyre-r9-cols') || 'null'); if (Array.isArray(savedCols)) st.cols = savedCols; st.forder = localStorage.getItem('lyre-r9-forder') || 'vocab'; } catch (e) { /* storage unavailable */ }
  var cbx = { g: null, q: '', act: 0, open: false };
  var ts = null; // bulk tag sheet state
  var pendingFocus = null, mode = 'wide', scrolledFor = null;

  /* ---------- small helpers ---------- */
  function tagsOf(t) { return D.tagGroups.reduce(function (a, g) { return a.concat(t.tags[g.id] || []); }, []); }
  function untagged(t) { return tagsOf(t).length === 0; }
  function newish(t) { return t.isNew || untagged(t); }
  // 0.5.2 item 10 (the app since 0.5.2; 0.6.0 sync): a New track the game master tags is no longer New, title or not.
  function settle(t) { if (t.isNew && !untagged(t)) t.isNew = false; }
  function addedAt(t) { return t.addedAt || (t.added === 'Today' ? Date.now() - 1e6 : Date.parse(t.added) || 0); }
  function cap(s) { s = s.trim().replace(/\s+/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function groupName(g) { return D.tagGroups.filter(function (x) { return x.id === g; })[0].name; }
  function shortPath(p) { var parts = p.split('\\'); return parts[parts.length - 1]; }
  function inFolder(t, f) { return !f || t.folder === f || t.folder.indexOf(f + '\\') === 0; }
  function kindOk(t, k) { k = k || st.kind; return k === 'all' || (k === 'fx' ? L.isFx(t) : t.kind === k); }
  function isLib() { return L.current().name === 'library'; }

  function matches(t, skipNew) {
    if (!kindOk(t)) return false;
    if (st.newOnly && !skipNew && !newish(t)) return false;
    if (st.missing && !t.missing) return false;
    if (st.shapes.length && st.shapes.indexOf(L.shapeOf(t)) < 0) return false;
    if (!inFolder(t, st.folder)) return false;
    if (!(st.emin <= 1 && st.emax >= 5) && (t.energy < st.emin || t.energy > st.emax)) return false;
    if (!D.tagGroups.every(function (g) { var w = want(g.id); return !w.length || w.some(function (v) { return L.trackHasTag(t, g.id, v); }); })) return false;
    // Round 9 (item 34): a hidden value leaves out every track that has it; Hide wins over Show.
    if (D.tagGroups.some(function (g) { return hid(g.id).some(function (v) { return L.trackHasTag(t, g.id, v); }); })) return false;
    if (st.hideShapes.indexOf(L.shapeOf(t)) > -1) return false;
    if (st.hideFolders.some(function (f) { return inFolder(t, f); })) return false;
    var words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      var hay = [t.title, t.metaTitle, t.file, t.artist, t.album].concat(tagsOf(t)).join(' ').toLowerCase();
      if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return false;
    }
    return true;
  }
  function visible() {
    var list = D.tracks.filter(function (t) { return matches(t); });
    var byTitle = function (a, b) { return L.title(a).localeCompare(L.title(b)); };
    var f = {
      title: byTitle,
      artist: function (a, b) { return a.artist.localeCompare(b.artist) || byTitle(a, b); },
      short: function (a, b) { return a.dur - b.dur; }, long: function (a, b) { return b.dur - a.dur; },
      'new': function (a, b) { return addedAt(b) - addedAt(a) || byTitle(a, b); }, old: function (a, b) { return addedAt(a) - addedAt(b) || byTitle(a, b); },
      album: function (a, b) { return (a.album || '').localeCompare(b.album || '') || byTitle(a, b); },
      type: function (a, b) { return typeWord(a).localeCompare(typeWord(b)) || byTitle(a, b); },
      use: function (a, b) { return useWord(a).localeCompare(useWord(b)) || byTitle(a, b); },
      energy: function (a, b) { return (a.energy || 0) - (b.energy || 0) || byTitle(a, b); },
      plays: function (a, b) { return playsFor(a) - playsFor(b) || byTitle(a, b); },
      shape: function (a, b) { return (L.shapeName[L.shapeOf(a)] || '').localeCompare(L.shapeName[L.shapeOf(b)] || '') || byTitle(a, b); },
      folder: function (a, b) { return a.folder.localeCompare(b.folder) || byTitle(a, b); }
    };
    var key = st.sort.replace(/-d$/, ''), g = f[key] || f.title;
    list.sort(g);
    return /-d$/.test(st.sort) ? list.reverse() : list;
  }
  function nFilters() { return (st.kind !== 'all') + st.newOnly + st.missing + st.shapes.length + st.hideShapes.length + st.hideFolders.length + !!st.folder + (st.emin > 1 || st.emax < 5) + D.tagGroups.reduce(function (a, g) { return a + want(g.id).length + hid(g.id).length; }, 0); }
  function filtersOn() { return nFilters() > 0; }
  function clearFilters() { st.kind = 'all'; st.newOnly = false; st.missing = false; st.shapes = []; st.hideShapes = []; st.hideFolders = []; st.folder = ''; st.emin = 1; st.emax = 5; D.tagGroups.forEach(function (g) { st.tags[g.id] = []; st.hide[g.id] = []; }); }
  // Round 7 (DAT-10): groups come and go on the Tags screen; a group's filter list is made when first needed.
  function want(id) { return st.tags[id] || (st.tags[id] = []); }
  function hid(id) { return st.hide[id] || (st.hide[id] = []); }
  function typeWord(t) { return L.isFx(t) ? 'FX' : t.kind === 'amb' ? 'Ambience' : 'Music'; }
  function useWord(t) { return t.role ? ((L.roleWord && L.roleWord[t.role]) || t.role) : ''; }
  function playsFor(t) { var p = L.profileOf ? L.profileOf(t) : null; return p ? Math.max(0, p.end - p.start) : t.dur; }
  L.libTagFilters = function () { return st.tags; };
  // Kind marker in the list: text as well as colour.
  function kindMark(t) {
    var k = t.kind === 'fx' ? ['fx', 'FX', 'Sound effect'] : t.kind === 'amb' ? ['amb', 'Amb', 'Ambience'] : L.isFx(t) ? ['fx', 'FX · Short cue', 'FX: a short music cue'] : null;
    return k ? '<span class="lb-km ' + k[0] + '" title="' + k[2] + '"><span class="lane-dot ' + k[0] + '"></span>' + k[1] + '</span>' : '';
  }
  // What the players hear now: the music or ambience lane, or a sound effect still playing.
  function onAirNow(t) { var pb = L.pb; return !!((pb.music && pb.music.id === t.id) || (pb.amb && pb.amb.id === t.id) || pb.fx.some(function (f) { return f.ref === 'track/' + t.id && !f.fadeOut; })); }
  // Row buttons stay out of the Tab order: the list is one Tab stop (P previews, A plays on air).
  function rowBtn(html) { return html.replace('<button ', '<button tabindex="-1" '); }
  function chip(g, v, extra) { return '<span class="chip lb-chip" title="' + esc(groupName(g)) + '"><span class="ellipsis">' + esc(v) + '</span>' + (extra || '') + '</span>'; }
  function GROUPCLS(g) { return D.tagGroups.filter(function (x) { return x.id === g; })[0].cls; }
  function rowChips(t, max) {
    var all = []; D.tagGroups.forEach(function (g) { L.tagsOn(t, g.id).forEach(function (v) { all.push([g.id, v]); }); });
    if (!all.length) return '<span class="lb-none">No tags yet</span>';
    return all.slice(0, max).map(function (x) { return chip(x[0], x[1]); }).join('') + (all.length > max ? '<span class="lb-more" title="' + esc(all.slice(max).map(function (x) { return x[1]; }).join(', ')) + '">+' + (all.length - max) + '</span>' : '');
  }

  /* ---------- Filters pane ---------- */
  // Round 9 (item 27): chips in tag list order, A to Z, Z to A, or most tracks first (x = [value, count, words]).
  function orderVals(vals) {
    if (st.forder === 'az') return vals.slice().sort(function (a, b) { return String(a[2]).localeCompare(String(b[2])); });
    if (st.forder === 'za') return vals.slice().sort(function (a, b) { return String(b[2]).localeCompare(String(a[2])); });
    if (st.forder === 'count') return vals.slice().sort(function (a, b) { return b[1] - a[1] || String(a[2]).localeCompare(String(b[2])); });
    return vals;
  }
  // Round 9 (item 34): a filter chip with three states, in words for screen readers as well as the look.
  function chip3(act, attrs, state, words, n, glyph) {
    var said = state === 'show' ? ', shown' : state === 'hide' ? ', hidden' : '';
    return '<button class="chip lb-fchip r9-c3' + (state === 'hide' ? ' is-hide' : '') + '" data-act="' + act + '" ' + attrs + ' data-state="' + state + '" aria-label="' + esc(words + said + ', ' + n) + '" aria-pressed="' + (state === 'show') + '" aria-describedby="r9-fhint"' +
      ' title="' + esc(words) + ': ' + (state === 'off' ? 'click to show only these' : state === 'show' ? 'click to hide these instead' : 'click to clear') + '">' +
      (state === 'show' ? L.icon('check', 's') : state === 'hide' ? L.icon('close', 's') : glyph || '') + '<span class="r9-c3-w">' + esc(words) + '</span><span class="lb-n num">' + n + '</span></button>';
  }
  var FORDERS = [['vocab', 'Tag list order'], ['az', 'A to Z'], ['za', 'Z to A'], ['count', 'Most tracks first']];
  function filterSummary() {
    var parts = [];
    if (st.kind !== 'all') parts.push(L.kindName[st.kind]);
    if (st.newOnly) parts.push('New, not tagged yet');
    if (st.missing) parts.push('Missing files');
    if (st.shapes.length) parts.push(st.shapes.map(function (x) { return L.shapeName[x]; }).join(', '));
    if (st.hideShapes.length) parts.push('not ' + st.hideShapes.map(function (x) { return L.shapeName[x]; }).join(', not '));
    D.tagGroups.forEach(function (g) { if (want(g.id).length) parts.push(want(g.id).join(', ')); if (hid(g.id).length) parts.push('not ' + hid(g.id).join(', not ')); });
    if (st.hideFolders.length) parts.push('not ' + st.hideFolders.map(shortPath).join(', not '));
    if (st.emin > 1 || st.emax < 5) parts.push('energy ' + st.emin + ' to ' + st.emax);
    if (st.folder) parts.push(shortPath(st.folder));
    return parts.length ? esc(parts.join(' · ')) : '';
  }
  // 0.5.2 item 21 (the app's FilterHeading): a filter's heading, with Clear beside it while something is chosen there.
  function fHead(id, name, on, what, g, label) {
    return '<div class="lb-fhrow"><h3 class="lb-fh"' + (id ? ' id="' + id + '"' : '') + '>' + esc(name) + '</h3>' +
      (on ? '<button class="btn s ghost lb-fclear" data-act="lbfclear" data-what="' + what + '"' + (g ? ' data-g="' + g + '"' : '') + ' data-k="lb-fclear-' + (g || what) + '" aria-label="' + esc(label || 'Clear ' + name) + '" title="' + esc(label || 'Clear ' + name) + '">Clear</button>' : '') + '</div>';
  }
  function filtersBody() {
    var base = D.tracks.filter(function (t) { return kindOk(t); });
    var nNew = base.filter(newish).length, nMissing = D.tracks.filter(function (t) { return t.missing; }).length;
    var h = '<div class="lb-f">';
    h += '<div class="lb-fg"><div class="seg s lb-seg24 lb-kind" role="group" aria-label="Kind of track">' + [['all', 'All'], ['music', 'Music'], ['amb', 'Ambience'], ['fx', 'FX']].map(function (k) {
      return '<button data-act="lbkind" data-v="' + k[0] + '" data-k="lb-kind-' + k[0] + '" aria-pressed="' + (st.kind === k[0]) + '"' + (k[0] === 'fx' ? ' title="Sound effects and stings"' : '') + '>' + k[1] + '</button>';
    }).join('') + '</div>' +
      '<button class="btn s lb-newbtn" data-act="lbnew" data-k="lb-new" aria-pressed="' + st.newOnly + '">' + (st.newOnly ? L.icon('check', 's') : L.icon('tag', 's')) + '<span class="grow lb-l">New, not tagged yet</span><span class="badge' + (nNew ? ' accent' : '') + '">' + nNew + '</span></button>' +
      // DAT-8: files Lyre cannot find; relink them in one go.
      (nMissing ? '<button class="btn s lb-newbtn lb-missbtn" data-act="lbmissing" data-k="lb-missing" aria-pressed="' + st.missing + '">' + (st.missing ? L.icon('check', 's') : L.icon('warn', 's')) + '<span class="grow lb-l">Missing</span><span class="badge warn">' + nMissing + '</span></button>' : '') + '</div>';
    // DAT-13: shape, the GM's choice or else the suggestion.
    // Round 9 (items 27, 34): one line says how the chips work; each chip is off, Show (✓) or Hide (struck out).
    h += '<p class="hint r9-fhint" id="r9-fhint">Click a filter once to show only those tracks, and again to hide them.</p>';
    var shapes = orderVals(L.SHAPES.map(function (x) { return [x[0], base.filter(function (t) { return L.shapeOf(t) === x[0]; }).length, x[1]]; }));
    h += '<div class="lb-fg" role="group" aria-labelledby="lb-fh-shape">' + fHead('lb-fh-shape', 'Shape', st.shapes.length || st.hideShapes.length, 'shape') + '<div class="chips">' + shapes.map(function (x) {
      var state = st.shapes.indexOf(x[0]) > -1 ? 'show' : st.hideShapes.indexOf(x[0]) > -1 ? 'hide' : 'off';
      return chip3('lbfshape', 'data-v="' + x[0] + '" data-k="lb-fs-' + x[0] + '"', state, x[2], x[1], L.shapeGlyph(x[0]));
    }).join('') + '</div></div>';
    D.tagGroups.forEach(function (g) {
      var vals = orderVals(D.tagValues[g.id].map(function (v) { return [v, base.filter(function (t) { return L.trackHasTag(t, g.id, v); }).length, v]; })
        .filter(function (x) { return x[1] || want(g.id).indexOf(x[0]) > -1 || hid(g.id).indexOf(x[0]) > -1; }));
      h += '<div class="lb-fg" role="group" aria-labelledby="lb-fh-' + g.id + '">' + fHead('lb-fh-' + g.id, g.name, want(g.id).length || hid(g.id).length, 'tag', g.id) + '<div class="chips">' +
        (vals.length ? vals.map(function (x, i) {
          var state = want(g.id).indexOf(x[0]) > -1 ? 'show' : hid(g.id).indexOf(x[0]) > -1 ? 'hide' : 'off';
          return chip3('lbftag', 'data-g="' + g.id + '" data-v="' + esc(x[0]) + '" data-k="lb-ft-' + g.id + '-' + esc(x[0]).replace(/\W/g, '_') + '"', state, x[0], x[1], '');
        }).join('') : '<span class="hint">No values used yet</span>') + '</div></div>';
    });
    var opts = function (sel) { var o = ''; for (var i = 1; i <= 5; i++) o += '<option' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return o; };
    h += '<div class="lb-fg">' + fHead('', 'Energy', st.emin > 1 || st.emax < 5, 'energy', '', 'Clear energy') + '<div class="lb-erange"><label>From <select class="input lb-sel" data-input="lbemin" data-k="lb-emin" aria-label="Lowest energy">' + opts(st.emin) + '</select></label>' +
      '<label>to <select class="input lb-sel" data-input="lbemax" data-k="lb-emax" aria-label="Highest energy">' + opts(st.emax) + '</select></label></div></div>';
    // A folder Lyre adds for tracks outside every library folder is listed, but has no ⋯ (it is not one of Lyre's folders).
    D.tracks.forEach(function (t) { var root = t.folder.split('\\').slice(0, 3).join('\\'); if (!D.folders.some(function (f) { return inFolder(t, f); })) { D.folders.push(root); D.autoFolders.push(root); } });
    var cnt = function (f) { return base.filter(function (t) { return inFolder(t, f); }).length; };
    h += '<div class="lb-fg">' + fHead('', 'Folders', st.folder || st.hideFolders.length, 'folder', '', 'Clear folder') + '<ul class="lb-folders">' + folderBtn('', 'All folders', base.length, 0);
    D.folders.forEach(function (f) {
      h += folderBtn(f, f, cnt(f), 0);
      if (st.folder && inFolder({ folder: st.folder }, f)) {
        var subs = {}; base.forEach(function (t) { if (t.folder.indexOf(f + '\\') === 0) subs[f + '\\' + t.folder.slice(f.length + 1).split('\\')[0]] = 1; });
        Object.keys(subs).sort().forEach(function (s) { h += folderBtn(s, shortPath(s), cnt(s), 1); });
      }
    });
    return h + '</ul></div></div>';
  }
  function folderBtn(f, label, n, sub) {
    var watched = D.watched.indexOf(f) > -1, hidden = st.hideFolders.indexOf(f) > -1, fk = f.replace(/\W/g, '_');
    return '<li class="r9-fo' + (sub ? ' sub' : '') + (hidden ? ' is-hide' : '') + '"><button data-act="lbfolder" data-f="' + esc(f) + '" data-k="lb-fo-' + fk + '" aria-pressed="' + (st.folder === f) + '" title="' + esc(f || 'Every folder') + (f ? (st.folder === f ? ': click again to hide its tracks' : hidden ? ': hidden. Click to show it again' : '') : '') + '">' +
      (hidden ? L.icon('close', 's') : L.icon(watched ? 'eye' : 'folder', 's')) + '<span class="ellipsis grow">' + esc(label) + (hidden ? '<span class="sr-only">, hidden</span>' : '') + '</span>' + (watched ? '<span class="hint">watched</span>' : '') + (D.folderKinds[f] ? '<span class="hint">' + L.kindName[D.folderKinds[f]] + '</span>' : '') + '<span class="num lb-n">' + n + '</span></button>' +
      // 0.5.2 items 20 and 40 (the app's FolderActions): one of Lyre's folders has a ⋯.
      (f && !sub && D.autoFolders.indexOf(f) < 0 ? '<button class="btn s icon ghost lb-fmore" data-act="lbfomenu" data-f="' + esc(f) + '" data-k="lb-fomore-' + fk + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for the folder ' + esc(f) + '">' + L.icon('more', 's') + '</button>' : '') +
      '</li>';
  }

  /* ---------- Tracks pane ---------- */
  function tracksBody(list, openId) {
    var shownSel = list.filter(function (t) { return st.sel.indexOf(t.id) > -1; }).length;
    if (!st.cursor || !list.some(function (t) { return t.id === st.cursor; })) st.cursor = openId && list.some(function (t) { return t.id === openId; }) ? openId : (list[0] && list[0].id);
    var h = '<div class="lb-tools"><div class="search grow">' + L.icon('search') + '<input class="input" type="search" placeholder="Search titles, file names, artists, tags" aria-label="Search tracks" data-input="lbq" data-k="lb-q" value="' + esc(st.q) + '"></div>' +
      '<label class="lb-sortl"><span class="sr-only">Sort</span><select class="input lb-sel" data-input="lbsort" data-k="lb-sort" aria-label="Sort tracks">' + (SORTS.some(function (x) { return x[0] === st.sort; }) ? '' : '<option value="' + st.sort + '" selected>By a column</option>') + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>' +
      // Round 9 (item 26): which columns show.
      '<button class="btn s" data-act="r9cols" data-k="lb-cols" aria-haspopup="menu" aria-expanded="false" title="Choose the columns">' + L.icon('list', 's') + 'Columns</button></div>';
    if (st.guide) h += '<div class="lb-guide" role="status">' + L.icon(st.guide.icon || 'check', 's') + '<span class="grow">' + st.guide.html + '</span>' +
      (st.guide.act ? '<button class="btn s" data-act="' + st.guide.act + '" data-k="lb-guide-act">' + esc(st.guide.actLabel) + '</button>' : '') +
      '<button class="closer" data-act="lbguideclose" data-k="lb-guide-x" title="Dismiss" aria-label="Dismiss this message">' + L.icon('close') + '</button></div>';
    if (st.sel.length) h += '<div class="lb-bulk" role="toolbar" aria-label="Selected tracks"><b class="lb-bn">' + st.sel.length + ' selected</b>' +
      (shownSel < st.sel.length ? '<span class="hint">(' + (st.sel.length - shownSel) + ' not shown)</span>' : '') +
      '<button class="btn s primary" data-act="lbbtag" data-k="lb-btag">' + L.icon('tag', 's') + 'Tag…</button>' +
      '<button class="btn s" data-act="lbbpl" data-k="lb-bpl">' + L.icon('playlist', 's') + 'Add to playlist…</button>' +
      '<button class="btn s" data-act="lbbnew" data-k="lb-bnew">' + L.icon('plus', 's') + 'New playlist from these</button>' +
      // Round 10 fixes (R10-FIX §1): Remove from library for the selection, in words; Delete files from disk… in its ⋯.
      '<button class="btn s" data-act="r10rmask" data-how="remove" data-ids="' + st.sel.join(',') + '" data-k="lb-brm">' + L.icon('close', 's') + 'Remove from library…</button>' +
      // 0.6.0 sync (the app's selection bar): Clear selection, then the ⋯ last (Type, Remove from library, Delete files).
      '<button class="btn s ghost" data-act="lbbclear" data-k="lb-bclear">Clear selection</button>' +
      '<button class="btn s icon ghost" data-act="r10selmore" data-k="lb-bmore" aria-haspopup="menu" aria-expanded="false" aria-label="More for the selected tracks" title="More">' + L.icon('more', 's') + '</button></div>';
    var allOn = list.length && shownSel === list.length;
    var cols = COLS.filter(function (c) { return st.cols.indexOf(c[0]) > -1; });
    // Round 9 (item 25): a header sorts by its column, A to Z first, then Z to A; aria-sort says which.
    function th(key, label, cls) {
      var asc = COL_SORT[key], desc = asc === 'short' ? 'long' : asc === 'old' ? 'new' : asc + '-d';
      var dir = st.sort === asc ? 'ascending' : st.sort === desc ? 'descending' : null;
      return '<th class="' + cls + '"' + (dir ? ' aria-sort="' + dir + '"' : '') + '><button class="r9-th" data-act="r9sort" data-c="' + key + '" data-k="lb-th-' + key + '" title="Sort by ' + label.toLowerCase() + (dir === 'ascending' ? ', then press again for the other way' : '') + '">' + label +
        (dir ? L.icon(dir === 'ascending' ? 'chevup' : 'chevdown', 's') : '') + '</button></th>';
    }
    h += '<div class="lb-scroll" data-scroll="lb-list"><table class="grid lb-table" role="grid" aria-multiselectable="true" aria-label="Tracks" aria-describedby="lb-keys" aria-rowcount="' + (list.length + 1) + '"><thead><tr>' +
      '<th class="lb-c-ck"><label class="lb-ckl"><input type="checkbox" data-act="lbselall" data-k="lb-selall" aria-label="Select all ' + list.length + ' shown"' + (allOn ? ' checked' : '') + '></label></th>' +
      th('title', 'Title', 'lb-c-title') + cols.map(function (c) { return COL_SORT[c[0]] ? th(c[0], c[1], 'lb-c-' + c[0] + ' r9-col') : '<th class="lb-c-' + c[0] + ' r9-col">' + c[1] + '</th>'; }).join('') +
      '<th class="lb-c-pv"><span class="sr-only">Preview, play on air, more</span></th></tr></thead><tbody>';
    if (!list.length) h += '<tr class="lb-emptyrow"><td colspan="' + (cols.length + 3) + '"><div class="empty">' + (st.q || filtersOn() ? 'No track matches. <button class="btn s" data-act="lbclearall" data-k="lb-clearall2">Clear search and filters</button>' : '<b>Your library is empty.</b> Add music, ambience and sound effects with <b>Add tracks</b>, or drop audio files or a folder here.') + '</div></td></tr>';
    // 0.6.0 usability test (F-P18): one row is always in the Tab order, the cursor's or else the first, so Tab from the
    // search field lands on the list (as in the app).
    var tabRow = list.some(function (x) { return x.id === st.cursor; }) ? st.cursor : (list[0] && list[0].id);
    list.forEach(function (t) {
      var sel = st.sel.indexOf(t.id) > -1, open = t.id === openId;
      var own = t.title, meta = t.metaTitle, shown = own || meta || t.file;
      var air = (onAirNow(t) ? L.destTag('air', '') : '') + (L.previewing(t.id) ? L.destTag('you', '') : '');
      var tip = (own ? '' : 'No title of your own yet. ') + (meta && meta !== own ? 'In the file: ' + meta + '. ' : '') + t.artist + (t.album ? ', ' + t.album : '');
      h += '<tr data-tid="' + t.id + '" data-act="lbopen" data-k="lbrow-' + t.id + '" tabindex="' + (t.id === tabRow ? 0 : -1) + '" aria-selected="' + sel + '"' + (open ? ' class="lb-open" aria-current="true"' : '') + '>' +
        '<td class="lb-c-ck" data-act="lbsel" data-tid="' + t.id + '"><span class="lb-ckl"><input type="checkbox" tabindex="-1" aria-label="Select ' + esc(L.title(t)) + '"' + (sel ? ' checked' : '') + '></span></td>' +
        '<td class="lb-c-title" title="' + esc(shown + ' — ' + tip) + '"><div class="lb-tl" ' + dragAttrs(t) + '>' + kindMark(t) + '<span class="lb-t1' + (own ? '' : ' untitled') + '">' + esc(shown) + '</span>' +
          (own && meta && meta !== own && open ? '<span class="lb-t2">' + esc(meta) + '</span>' : '') + air + (t.isNew ? '<span class="badge lb-newb">New</span>' : '') +
          (t.missing ? '<span class="badge warn lb-miss" title="Lyre cannot find this file at ' + esc(t.folder) + '">' + L.icon('warn', 's') + 'Missing</span>' : '') + '</div></td>' +
        cols.map(function (c) { return cellOf(t, c[0]); }).join('') +
        '<td class="lb-c-pv"><div class="lb-rowbtns">' + rowBtn(L.previewButton('track', t.id)) + rowBtn(L.playOnAirButton('track', t.id)) +
          '<button class="btn s icon ghost" tabindex="-1" data-act="lbrowmenu" data-tid="' + t.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(L.title(t)) + '">' + L.icon('more', 's') + '</button></div></td></tr>';
    });
    h += '</tbody></table></div><div class="lb-foot hint keys-on-focus" id="lb-keys">Keys: <span class="kbd">↑</span> <span class="kbd">↓</span> move · <span class="kbd">Enter</span> open · <span class="kbd">Space</span> select · <span class="kbd">P</span> preview · <span class="kbd">A</span> play on air</div>';
    return h;
  }

  // Round 9 (item 26): one cell per chosen column.
  function cellOf(t, c) {
    var pf = playsFor(t);
    switch (c) {
      case 'tags': return '<td class="lb-c-tags"><span class="lb-tagcell">' + (st.cols.indexOf('shape') > -1 ? '' : L.shapeTag(t, true)) + rowChips(t, st.cols.indexOf('shape') > -1 ? 2 : 1) + '</span></td>';
      case 'energy': return '<td class="lb-c-energy">' + (t.energy ? L.energy(t.energy) : '<span class="lb-none" aria-label="No energy yet">–</span>') + '</td>';
      // 0.5.2 item 7 (in the app since 0.5.2; 0.6.0 sync): the file's length, and under it the length its Audio profile
      // plays when the two differ, unless the Plays for column already says it.
      case 'len': return '<td class="lb-c-len lb-c-dur num">' + (st.cols.indexOf('plays') > -1 || L.fmt(pf) === L.fmt(t.dur) ? L.fmt(t.dur) :
        '<span class="lb-len"><span>' + L.fmt(t.dur) + '</span><span class="lb-played" title="Plays ' + L.fmt(pf) + ' with its Audio profile (file ' + L.fmt(t.dur) + ')"><span class="sr-only">, plays </span>' + L.fmt(pf) + '</span></span>') + '</td>';
      case 'plays': return '<td class="lb-c-plays num"' + (Math.round(pf) !== Math.round(t.dur) ? ' title="Plays ' + L.fmt(pf) + ' of the file\'s ' + L.fmt(t.dur) + ' (its Audio profile)"' : '') + '>' + (Math.round(pf) !== Math.round(t.dur) ? '<b>' + L.fmt(pf) + '</b>' : L.fmt(pf)) + '</td>';
      case 'artist': return '<td class="lb-c-artist"><span class="ellipsis">' + esc(t.artist || '') + '</span></td>';
      case 'album': return '<td class="lb-c-album"><span class="ellipsis">' + esc(t.album || '') + '</span></td>';
      case 'type': return '<td class="lb-c-type">' + typeWord(t) + '</td>';
      case 'use': return '<td class="lb-c-use">' + esc(useWord(t)) + '</td>';
      case 'shape': return '<td class="lb-c-shape"><span class="lb-tagcell">' + L.shapeGlyph(L.shapeOf(t)) + '<span class="ellipsis">' + esc(L.shapeName[L.shapeOf(t)] || '') + '</span></span></td>';
      case 'added': return '<td class="lb-c-added">' + esc(t.added || '') + '</td>';
      case 'folder': return '<td class="lb-c-folder"><span class="ellipsis" title="' + esc(t.folder) + '">' + esc(shortPath(t.folder)) + '</span></td>';
    }
    return '<td></td>';
  }
  L.acts.r9sort = function (el) {
    var asc = COL_SORT[el.dataset.c], desc = asc === 'short' ? 'long' : asc === 'old' ? 'new' : asc + '-d';
    st.sort = st.sort === asc ? desc : asc; L.render();
    var b = document.querySelector('[data-k="lb-th-' + el.dataset.c + '"]'); if (b) b.focus();
    L.say('Sorted by ' + el.textContent.trim().toLowerCase() + (st.sort === asc ? ', A to Z' : ', Z to A'));
  };
  L.acts.r9cols = function (el) {
    L.menu(el, colsMenu(), 'Columns');
  };
  function colsMenu() {
    return '<div class="group">Columns</div><button role="menuitemcheckbox" aria-checked="true" aria-disabled="true" class="r9-colrow">' + L.icon('check', 's') + 'Title (always)</button>' + COLS.map(function (c) {
      var on = st.cols.indexOf(c[0]) > -1;
      return '<button role="menuitemcheckbox" aria-checked="' + on + '" class="r9-colrow" data-act="r9col" data-keep-menu="1" data-c="' + c[0] + '">' + (on ? L.icon('check', 's') : '<span style="width:14px"></span>') + c[1] + (c[0] === 'plays' ? '<span class="hint">&nbsp;after the Audio profile</span>' : '') + '</button>';
    }).join('') + '<div class="sep"></div><button role="menuitem" data-act="r9colsreset">' + L.icon('restart', 's') + 'Put back the usual columns</button>';
  }
  function saveCols() { try { localStorage.setItem('lyre-r9-cols', JSON.stringify(st.cols)); } catch (e) { /* storage unavailable */ } }
  // The menu stays open while columns are ticked, so several can be changed at once.
  L.acts.r9col = function (el) {
    var c = el.dataset.c, i = st.cols.indexOf(c), on = i < 0; if (on) st.cols.push(c); else st.cols.splice(i, 1);
    saveCols(); L.render();
    var m = document.querySelector('.menu'); if (m) { m.innerHTML = colsMenu(); var b = m.querySelector('[data-c="' + c + '"]'); if (b) b.focus(); }
    L.say(COLS.filter(function (x) { return x[0] === c; })[0][1] + (on ? ' shown' : ' hidden'));
  };
  L.acts.r9colsreset = function () { st.cols = USUAL_COLS.slice(); saveCols(); L.closeMenu(); L.render(); var b = document.querySelector('[data-k="lb-cols"]'); if (b) b.focus(); L.say('The usual columns are back'); };

  /* ---------- Details pane ---------- */
  // Round 7 (ORG-5): a row's title is dragged to another list; with ticked rows, all of them go.
  function dragAttrs(t) { return L.orgItem('track', st.sel.indexOf(t.id) > -1 ? st.sel.join(',') : t.id); }
  function cbxOptions(t, g) {
    if (cbx.g !== g) return [];
    var q = cbx.q.trim().toLowerCase(), have = t.tags[g] || [];
    // Round 7 (DAT-10): another word for a tag ("sad" for Melancholy) offers the tag itself, never a new one.
    function via(v) { return q ? L.tagAlso(g, v).filter(function (a) { return a.toLowerCase().indexOf(q) === 0; })[0] || '' : ''; }
    var vals = D.tagValues[g].filter(function (v) { return have.indexOf(v) < 0 && (!q || v.toLowerCase().indexOf(q) > -1 || via(v)); });
    vals.sort(function (a, b) { return (b.toLowerCase().indexOf(q) === 0) - (a.toLowerCase().indexOf(q) === 0); });
    var opts = vals.slice(0, 8).map(function (v) { return { v: v, via: v.toLowerCase().indexOf(q) > -1 ? '' : via(v) }; });
    if (q && !D.tagValues[g].some(function (v) { return v.toLowerCase() === q || L.tagAlso(g, v).some(function (a) { return a.toLowerCase() === q; }); })) opts.push({ v: cap(cbx.q), isNew: true });
    return opts;
  }
  function tagRow(t, g) {
    var mine = L.tagsOn(t, g.id), open = cbx.g === g.id && cbx.open, opts = open ? cbxOptions(t, g.id) : [];
    if (open && cbx.act >= opts.length) cbx.act = Math.max(0, opts.length - 1);
    var lbx = '<ul class="lb-lbx" id="lb-lbx-' + g.id + '" role="listbox" aria-label="' + esc(g.name) + ' values"' + (open && opts.length ? '' : ' hidden') + '>' +
      opts.map(function (o, i) {
        return '<li role="option" id="lb-opt-' + g.id + '-' + i + '" aria-selected="' + (i === cbx.act) + '" data-act="lbcbxpick" data-g="' + g.id + '" data-v="' + esc(o.v) + '"' + (o.isNew ? ' data-new="1"' : '') + '>' +
          (o.isNew ? L.icon('plus', 's') + '<span>Create <b>' + esc(o.v) + '</b> in ' + esc(g.name) + '</span>' : esc(o.v) + (o.via ? ' <span class="hint">(' + esc(o.via) + ')</span>' : '')) + '</li>';
      }).join('') + '</ul>';
    return '<div class="lb-tg"><div class="lb-tgl" id="lb-tgl-' + g.id + '">' + esc(g.name) + '</div><div class="chips">' +
      mine.map(function (v) { return chip(g.id, v, '<button class="x" data-act="lbuntag" data-g="' + g.id + '" data-v="' + esc(v) + '" data-k="lb-x-' + g.id + '-' + v.replace(/\W/g, '_') + '" title="Remove" aria-label="Remove ' + esc(v) + ' from ' + esc(g.name) + '">' + L.icon('close') + '</button>'); }).join('') +
      '<div class="lb-cbx' + (open && opts.length ? ' open' : '') + '"><input class="input lb-cbxin" type="text" role="combobox" autocomplete="off" aria-autocomplete="list" aria-expanded="' + !!(open && opts.length) + '" aria-controls="lb-lbx-' + g.id + '"' +
      (open && opts.length ? ' aria-activedescendant="lb-opt-' + g.id + '-' + cbx.act + '"' : '') + ' aria-label="Add a ' + esc(g.name.toLowerCase()) + ' tag" placeholder="+ Add ' + esc(g.name.toLowerCase()) + '" data-input="lbcbx" data-act="lbcbxopen" data-g="' + g.id + '" data-k="lb-cbx-' + g.id + '" value="' + (cbx.g === g.id ? esc(cbx.q) : '') + '">' + lbx + '</div></div></div>';
  }
  function choiceChips(act, list, cur, label) {
    return '<div class="chips" role="group" aria-label="' + label + '">' + list.map(function (x) {
      var v = x[0], on = cur === v;
      return '<button class="chip lb-pick" data-act="' + act + '" data-v="' + v + '" data-k="lb-' + act + '-' + v.replace(/\s/g, '') + '" aria-pressed="' + on + '">' + (on ? L.icon('check', 's') : '') + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function detailsBody(t) {
    var pls = L.playlistsOfTrack(t.id), prev = L.previewing(t.id);
    var onAir = onAirNow(t);
    var h = '<div class="lb-d">';
    if (t.missing) h += '<p class="lb-missing" role="note">' + L.icon('warn', 's') + '<span class="grow">Lyre cannot find this file where it was.</span><a class="btn s" href="#/relink" data-k="lb-relink1" title="Point Lyre at the folder it moved to">Relink…</a></p>';
    h += '<div class="field"><label for="lb-title">Your title</label><input id="lb-title" class="input" data-input="lbtitle" data-k="lb-title" data-save="title {v}" value="' + esc(t.title) + '" placeholder="A title you will recognise at the table"></div>';
    if (!t.title && t.metaTitle) h += '<p class="lb-warn"><button class="btn s ghost" data-act="lbusemeta" data-k="lb-usemeta">' + L.icon('edit', 's') + 'Use the title in the file</button></p>';
    h += '<dl class="lb-names">' +
      '<dt>Title in the file</dt><dd>' + (t.metaTitle ? esc(t.metaTitle) : '<span class="lb-none">The file has no title</span>') + '</dd>' +
      '<dt>File name</dt><dd class="lb-file">' + esc(t.file) + '</dd>' +
      '<dt>Folder</dt><dd><span class="lb-path">' + esc(t.folder) + '</span><span class="lb-pathbtns"><button class="btn s" data-act="lbcopy" data-k="lb-copy">' + L.icon('file', 's') + 'Copy path</button><button class="btn s" data-act="lbshow" data-k="lb-show">' + L.icon('folder', 's') + 'Show in folder</button></span></dd>' +
      '<dt>Artist</dt><dd>' + esc(t.artist) + '</dd><dt>Album</dt><dd>' + esc(t.album) + '</dd>' +
      '<dt>Length</dt><dd class="num">' + L.fmt(t.dur) + '</dd><dt>Added</dt><dd>' + esc(t.added) + (t.isNew ? ' <span class="badge lb-newb">New</span>' : '') + '</dd>' +
      // DAT-14: the names it has in scenes, beside its own, the file's title, the file name and the folder.
      (L.partLine ? L.partLine(t) : '') +
      (L.namesOfTrack(t).length ? '<dt>Names in scenes</dt><dd><ul class="lb-scnames">' + L.namesOfTrack(t).map(function (x) { return '<li><b>' + esc(x.name) + '</b> <span class="hint">in ' + esc(x.label) + '</span></li>'; }).join('') + '</ul></dd>' : '') + '</dl>';
    h += '<div class="lb-acts"><button class="btn s lb-pvbtn" data-act="lbprev" data-tid="' + t.id + '" data-k="lb-dprev" aria-pressed="' + !!prev + '">' + L.icon(prev ? 'stop' : 'headphones', 's') + (prev ? 'Stop preview' : 'Preview') + '</button>' +
      '<button class="btn s" data-act="lbonair" data-k="lb-onair">' + L.icon('broadcast', 's') + 'Play on air</button>' + (L.profileLink ? L.profileLink(t.id) : '')  +
      '<button class="btn s" data-act="lbusein" data-k="lb-usein">' + L.icon('link', 's') + 'Use in…</button>' +
      // Round 10 fixes (R10-FIX §1): Remove from library in a track's details too (its file stays; Undo).
      '<button class="btn s" data-act="r10rmask" data-how="remove" data-ids="' + t.id + '" data-k="lb-drm">' + L.icon('close', 's') + 'Remove from library…</button></div>' +
      (profileSummary(t) ? '<p class="lb-prof">' + L.icon('fade', 's') + '<span>' + profileSummary(t) + '</span></p>' : '');
    h += '<section class="lb-sec" aria-labelledby="lb-h-tags"><h3 class="lb-h" id="lb-h-tags">Tags</h3>' + D.tagGroups.map(function (g) { return tagRow(t, g); }).join('') + '</section>';
    h += '<section class="lb-sec" aria-labelledby="lb-h-play"><h3 class="lb-h" id="lb-h-play">How it plays</h3>' +
      '<div class="lb-tg"><div class="lb-tgl">Energy</div><div class="seg s lb-seg24" role="group" aria-label="Energy, 1 calm to 5 intense">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button data-act="lbenergy" data-v="' + n + '" data-k="lb-en-' + n + '" aria-pressed="' + (t.energy === n) + '" title="' + ['Calm', 'Low', 'Moderate', 'High', 'Intense'][n - 1] + '">' + n + '</button>';
      }).join('') + '</div></div>' +
      // DAT-13: how the track moves; Lyre suggests one from its loudness, the GM's choice wins.
      '<div class="lb-tg"><div class="lb-tgl" id="lb-shape-l">Shape</div><div class="lb-shapebox"><div class="chips" role="group" aria-labelledby="lb-shape-l">' + L.SHAPES.map(function (x) {
        var on = L.shapeOf(t) === x[0];
        return '<button class="chip lb-pick" data-act="lbshape" data-v="' + x[0] + '" data-k="lb-shape-' + x[0] + '" aria-pressed="' + on + '">' + L.shapeGlyph(x[0]) + esc(x[1]) + '</button>';
      // Round 6: two words for Lyre's suggestion (the why on hover); the GM's own choice needs no words unless it differs.
      }).join('') + '</div>' + (t.shape ? (L.suggestedShape(t) && L.suggestedShape(t) !== t.shape ? '<p class="hint">Lyre suggested ' + L.shapeName[L.suggestedShape(t)].toLowerCase() + '. <button class="btn s ghost" data-act="lbshapeauto" data-k="lb-shapeauto">Use the suggestion</button></p>' : '')
        : '<p class="hint" title="From the track\'s loudness. Choose another to change it.">Suggested by Lyre<span class="sr-only"> from the track\'s loudness. Choose another to change it.</span></p>') + '</div></div>' +
      // PLY-15, DAT-15: normalise this track (Library setting / On / Off), with what Lyre measured and the gain it gets.
      '<div class="lb-tg lb-normrow">' + L.normChoice({ id: 'lb-norm', value: t.norm, act: 'lbnorm', line: L.normLine(t), hint: normHint(t) }) + '</div>' +
      // Round 9 (r9track.js, item 18): Use it for and At its end replace Role, Looping, Ending and Then.
      (L.r9UseFor ? L.r9UseFor(t) + L.r9AtEnd(t) : '<div class="lb-tg"><div class="lb-tgl">Role</div>' + choiceChips('lbrole', (t.kind === 'fx' ? ['Effect'].concat(ROLES) : ROLES).map(function (r) { return [r, r]; }), t.role, 'Role') + '</div>' +
      // Round 7 (PLY-4, SHW-3): a sting never loops; the ending, resume and follow-with rows (r7play.js).
      L.loopRow(t, '<div class="lb-tg"><div class="lb-tgl">Looping</div>' + choiceChips('lbloop', LOOPS, t.loop, 'Loop advice') + '</div>')) +
      '<div class="lb-tg"><label class="lb-tgl" for="lb-notes">Notes</label><textarea id="lb-notes" class="input" rows="2" data-input="lbnotes" data-k="lb-notes" data-save="' + esc(L.title(t)) + ' notes" placeholder="Cues, where it fades, what it reminds you of">' + esc(t.notes) + '</textarea></div>' +
      // The rarer choices that follow from the role (ending, pick up, follow with) come last.
      (L.r9UseFor ? '' : L.playRows(t)) + '</section>';
    var man = pls.filter(function (p) { return p.kind === 'manual'; }), dyn = pls.filter(function (p) { return p.kind === 'dynamic'; });
    h += '<section class="lb-sec" aria-labelledby="lb-h-pl"><div class="lb-hrow"><h3 class="lb-h" id="lb-h-pl">In playlists</h3><button class="btn s" data-act="lbpladdmenu" data-k="lb-pladd" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add to playlist</button></div>';
    h += pls.length ? '<ul class="lb-pls">' + man.map(function (p) {
      return '<li><span class="lane-dot ' + p.lane + '"></span><a href="#/playlist/' + p.id + '" class="ellipsis" data-k="lb-pl-' + p.id + '">' + esc(p.name) + '</a>' +
        '<button class="closer" data-act="lbplrm" data-pid="' + p.id + '" data-k="lb-plrm-' + p.id + '" title="Remove from this playlist" aria-label="Remove from ' + esc(p.name) + '">' + L.icon('close') + '</button></li>';
    }).join('') + dyn.map(function (p) {
      return '<li><span class="lane-dot ' + p.lane + '"></span><a href="#/playlist/' + p.id + '" class="ellipsis" data-k="lb-pl-' + p.id + '">' + esc(p.name) + '</a><span class="hint lb-plk" title="Matches its tag rules: ' + esc(L.ruleText(p.rule)) + '">Dynamic</span></li>';
    }).join('') + '</ul>' : '<p class="hint">Not in any playlist yet.</p>';
    h += '</section>';
    // Used in: scenes that list the track itself, and scenes that reach it through one of its playlists.
    var seen = {}, scenes = [], wider = 0;
    function at(u) { if (!seen[u.scene.id]) { seen[u.scene.id] = { u: u, direct: false, via: [] }; scenes.push(seen[u.scene.id]); } return seen[u.scene.id]; }
    L.usesOfTrack(t.id).forEach(function (u) { at(u).direct = true; });
    pls.forEach(function (p) {
      L.usesOfPlaylist(p.id).forEach(function (u) {
        if (u.level !== 'scene') { wider++; return; }
        var e = at(u); if (e.via.indexOf(p.name) < 0) e.via.push(p.name);
      });
    });
    var nDirect = scenes.filter(function (x) { return x.direct; }).length, onHand = L.usesOfTrackAll(t.id).filter(function (u) { return u.level !== 'scene'; });
    h += '<section class="lb-sec" aria-labelledby="lb-h-used"><div class="lb-hrow"><h3 class="lb-h" id="lb-h-used">Used in</h3><button class="btn s" data-act="lbusein" data-k="lb-usein2">' + L.icon('link', 's') + 'Use in…</button></div>' +
      (scenes.length ? '<ul class="lb-pls lb-used">' + scenes.map(function (x) {
        var u = x.u, how = [];
        if (x.direct) how.push('<span class="lb-how direct">' + L.icon('note', 's') + 'Directly in the scene</span>');
        if (x.via.length) how.push('<span class="lb-how">' + L.icon('playlist', 's') + 'Through ' + esc(x.via.join(', ')) + '</span>');
        return '<li><a href="#/session/' + u.campaign.id + '/' + u.session.id + '" data-k="lb-use-' + u.scene.id + '"><span class="ellipsis">' + esc(u.scene.name) + '</span></a><span class="hint ellipsis grow">' + esc(u.campaign.name) + ' › Session ' + u.session.n + '</span>' + how.join('') + '</li>';
      }).join('') + '</ul>' : '<p class="hint" title="Add it to a scene directly, or to a playlist a scene plays">Not in any scene yet.</p>') +
      (wider ? '<p class="hint">Also available in ' + plural(wider, 'campaign or session', 'campaigns or sessions') + ' through its playlists.</p>' : '') +
      (onHand.length ? '<p class="hint lb-onhand">' + L.icon('link', 's') + 'On hand in ' + esc(onHand.map(function (u) { return u.label; }).join('; ')) + '</p>' : '') + '</section>';
    return h + '</div>';
  }
  // Where the track's normalising choice comes from, and its true peak once measured.
  function normHint(t) {
    var peak = t.loud ? 'True peak ' + t.loud.peak.toFixed(1) + ' dBTP. ' : '';
    return peak + (t.norm ? 'This track\'s own choice, wherever it plays.' : 'Follows the library (' + L.libraryNormWords() + '), or the playlist it plays from when that has its own choice.');
  }
  L.acts.lbnorm = function (el) {
    var t = cur(); if (!t) return;
    if (el.dataset.v === 'library') delete t.norm; else t.norm = el.dataset.v;
    L.render(); var b = document.querySelector('[data-k="lb-norm-' + el.dataset.v + '"]'); if (b) b.focus(); L.saved(L.title(t) + ' volume setting');
    L.say('Normalise volume: ' + L.normLine(t));
  };
  // One line describing the track's audio profile, e.g. "Ends at 5:18, then loops from 1:04".
  function profileSummary(t) {
    if (!L.profileOf) return '';
    var p = L.profileOf(t), f = L.fmt, parts = [];
    var cut = p.start > 0 || p.end < t.dur;
    var range = !cut ? 'Whole track' : p.start > 0 && p.end < t.dur ? 'Starts at ' + f(p.start) + ', ends at ' + f(p.end) : p.start > 0 ? 'Starts at ' + f(p.start) : 'Ends at ' + f(p.end);
    var after = p.after === 'loop' ? 'then loops from ' + (p.loopStart > p.start ? f(p.loopStart) : 'the start') : p.after === 'stop' ? 'then stops' : 'then the next one';
    parts.push(range + ', ' + after);
    var fades = []; if (p.fadeIn.dur) fades.push('in ' + p.fadeIn.dur + ' s'); if (p.fadeOut.dur) fades.push('out ' + p.fadeOut.dur + ' s');
    if (fades.length) parts.push('fades ' + fades.join(', '));
    var n = L.profileKeys ? L.profileKeys(t).length : 0;
    // Round 6: the usual (whole track, then the next one, no fades, no own settings) goes without saying.
    if (!cut && p.after !== 'loop' && p.after !== 'stop' && !fades.length && !n) return '';
    return esc(parts.join(' · ')) + '.' + (n ? ' <span class="muted">Has its own settings in ' + (n === 1 ? '1 playlist or scene' : n + ' playlists and scenes') + '.</span>' : '');
  }
  function emptyDetails() {
    var nNew = D.tracks.filter(newish).length;
    return '<div class="lb-d lb-dempty"><p>Open a track to see its names, file and tags.</p>' +
      (nNew ? '<p><button class="btn s" data-act="lbshownew" data-k="lb-shownew">' + L.icon('tag', 's') + 'Show the ' + plural(nNew, 'track') + ' not tagged yet</button></p>' : '') + '</div>';
  }

  /* ---------- the view ---------- */
  L.view('library', {
    nav: 'library',
    title: function () { return 'Track library'; },
    notesTitle: 'Library: what changed',
    notes: [
      '<b>Round 5:</b> a track\'s <b>Shape</b> (Steady, Builds, Falls away, Peaks then falls, Rises and falls) is suggested from its loudness and can be changed in its details; filter by shape. <b>Names in scenes</b> sit with its other names. <b>Use in…</b> adds it to campaigns, sessions and scenes. Files Lyre cannot find show <b>Missing</b> and have a filter; ⋯ beside Add tracks has <b>Back up, move or share</b>, <b>Find missing files</b> and <b>What came across from Kenku FM</b>.',
      'Less on screen: one line per track (your title, then the file\'s title in small type when it differs), one tag, then Preview, Play on air and ⋯ for the rest. Artist, album and the other tags are in the details and on hover. Each box shows at most one status: the track count or <i>n selected</i>, and <i>Playing</i> for the open track. Changes show in the Saved pop-up (round 6 part 5).',
      'Every row now has <b>Preview</b> (headphones: only you hear it) and <b>Play on air</b> (the players hear it). With a row focused, <b>P</b> previews and <b>A</b> plays on air.',
      'Filters: <b>All / Music / Ambience / FX</b>. FX lists sound effects and stings; rows show a small Amb, FX or Sting marker.',
      '<b>Used in</b> (in a track\'s details) lists scenes that use the track <i>directly</i> as well as scenes that reach it <i>through</i> a playlist, and says which.',
      'Playlists are now called <b>Manual</b> and <b>Dynamic</b> everywhere in the Library.',
      'Unchanged from round 2: <b>Add tracks</b> (files, a folder, a watched folder, or drop them on the page), bulk <b>Tag…</b> on ticked rows, and the <b>+ Add</b> tag boxes in details. Try <i>Memories of Mother</i>, which has no title or tags yet.'
    ],
    render: function (p) {
      var app = document.getElementById('app'), w = app.getBoundingClientRect().width;
      mode = w >= 1200 ? 'wide' : w >= 820 ? 'mid' : 'narrow';
      var t = p.tid ? L.track(p.tid) : null, list = visible();
      var nShown = list.length, nAll = D.tracks.length;
      var P = L.state.panes, maxed = L.state.maxed;
      function collapsed(id, def) { return P[id] == null ? def : P[id] === 'c'; }
      var fC = collapsed('lb-filters', mode !== 'wide'), tC = collapsed('lb-tracks', false), dC = collapsed('lb-details', false);

      var head = '<div class="viewhead lb-head">' +
        (mode === 'narrow' && t ? '<button class="btn s" data-act="lbback" data-k="lb-back">' + L.icon('chevleft', 's') + 'Tracks</button>' : '') +
        '<h1>Track library</h1><span class="muted lb-count">' + plural(nAll, 'track') + '</span><span class="grow"></span>' +
        // Round 8 (Nik, 11 Nov: "In library view I still need the Prep and Live toggle we have elsewhere"): Live goes to
        // the session loaded in Live, as from Rooms.
        (L.campaign(L.state.live.cid) ? L.modeSwitch(L.state.live.cid) : '') +
        '<button class="btn primary" data-act="lbaddmenu" data-k="lb-add" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add tracks' + L.icon('chevdown', 's') + '</button>' +
        '<button class="btn icon" data-act="lbmore" data-k="lb-more" aria-haspopup="menu" aria-expanded="false" title="Back up, move and find files" aria-label="More for the library">' + L.icon('more') + '</button></div>';

      function fPane(strip) {
        return L.pane({ id: 'lb-filters', title: 'Filters', icon: 'rule', cls: 'lb-filters' + (strip ? ' lb-strip' : ''), collapsed: mode !== 'wide', kind: 'search', summary: filterSummary(), scroll: 'lb-filters', status: nFilters() ? { text: nFilters() + (nFilters() > 1 ? ' filters on' : ' filter on'), tone: 'on' } : null,
          actions: '<button class="btn s icon ghost" data-act="r9forder" data-k="lb-forder" aria-haspopup="menu" aria-expanded="false" aria-label="Order the filters" title="Order the filters (now ' + FORDERS.filter(function (x) { return x[0] === st.forder; })[0][1] + ')">' + L.icon('inorder', 's') + '</button>' +
            // 0.5.2 item 21 (the app since 0.5.2; 0.6.0 sync): every filter, shown or hidden, and not the search.
            (filtersOn() ? '<button class="btn s ghost" data-act="lbclearfilters" data-k="lb-clearall">Clear all filters</button>' : ''), body: filtersBody() });
      }
      function tPane(strip) {
        return L.pane({ id: 'lb-tracks', title: 'Tracks', icon: 'library', cls: 'lb-tracks' + (strip ? ' lb-strip' : ''), flush: true, kind: 'music',
          status: st.sel.length ? { text: st.sel.length + ' selected', tone: 'on' } : { text: nShown === nAll ? String(nAll) : nShown + ' of ' + nAll }, body: tracksBody(list, t && t.id) });
      }
      function dPane(strip) {
        return L.pane({ id: 'lb-details', title: 'Details', icon: 'file', cls: 'lb-details' + (strip ? ' lb-strip' : ''), scroll: 'lb-details-' + (t ? t.id : 'none'),
          kind: 'plain', summary: t && dC ? esc(L.title(t)) : '',
          // Round 6, part 5: no Saved status; changes show in the Saved pop-up.
          status: t ? (onAirNow(t) ? { text: 'Playing', tone: 'live' } : null) : { text: 'Empty' },
          actions: t && mode !== 'narrow' ? '<button class="closer" data-act="lbclose" data-k="lb-close" title="Close details" aria-label="Close details">' + L.icon('close') + '</button>' : '',
          body: t ? detailsBody(t) : emptyDetails() });
      }

      var body;
      if (maxed === 'lb-filters' || maxed === 'lb-tracks' || (maxed === 'lb-details' && t)) {
        body = '<div class="lb-grid" style="grid-template-columns:minmax(0,1fr)">' + (maxed === 'lb-filters' ? fPane() : maxed === 'lb-tracks' ? tPane() : dPane()) + '</div>';
      } else if (mode === 'narrow') {
        body = '<div class="lb-grid lb-narrow" style="grid-template-columns:minmax(0,1fr)"><div class="col">' + (t ? dPane() : fPane() + tPane()) + '</div></div>';
      } else if (mode === 'mid') {
        var cols = [tC ? '34px' : 'minmax(0,1fr)'];
        if (t) cols.push(dC ? '34px' : tC ? 'minmax(0,1fr)' : 'minmax(0,.66fr)');
        if (tC && (!t || dC)) cols[0] = 'minmax(0,1fr)';
        body = '<div class="lb-grid lb-mid" style="grid-template-columns:' + cols.join(' ') + '"><div class="col lb-maincol">' + fPane() + tPane() + '</div>' + (t ? dPane(dC) : '') + '</div>';
      } else {
        var exp = [!fC, !tC, !dC].filter(Boolean).length;
        var c = [fC ? '34px' : exp === 1 ? 'minmax(0,1fr)' : '220px', tC ? '34px' : 'minmax(0,1fr)', dC ? '34px' : tC ? 'minmax(0,1fr)' : (t ? 'minmax(320px,.62fr)' : '250px')];
        body = '<div class="lb-grid lb-wide" style="grid-template-columns:' + c.join(' ') + '">' + fPane(fC) + tPane(tC) + dPane(dC) + '</div>';
      }
      return head + '<div class="viewbody fill lb-body">' + body + '</div>';
    },
    after: function (root, p) {
      if (p.tid && scrolledFor !== p.tid) {
        var row = root.querySelector('tr[data-tid="' + p.tid + '"]'), box = root.querySelector('.lb-scroll');
        if (row && box) {
          var head = box.querySelector('thead'), top = row.offsetTop - (head ? head.offsetHeight : 0);
          if (top < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
          scrolledFor = p.tid;
        }
      }
      if (!p.tid) scrolledFor = null;
      var all = root.querySelector('[data-act="lbselall"]');
      if (all) { var n = visible().filter(function (t) { return st.sel.indexOf(t.id) > -1; }).length; all.indeterminate = n > 0 && !all.checked; }
    }
  });

  /* ---------- filter actions ---------- */
  L.acts.lbkind = function (el) { st.kind = el.dataset.v; L.render(); };
  L.acts.lbmissing = function () { st.missing = !st.missing; L.render(); L.say(st.missing ? 'Showing files Lyre cannot find' : 'Showing all tracks'); };
  // Round 9 (item 34): off → Show → Hide → off.
  function cycle(show, hide, v) { var i = show.indexOf(v), j = hide.indexOf(v); if (i > -1) { show.splice(i, 1); hide.push(v); return 'hidden'; } if (j > -1) { hide.splice(j, 1); return 'cleared'; } show.push(v); return 'shown'; }
  L.acts.lbfshape = function (el) { var w = cycle(st.shapes, st.hideShapes, el.dataset.v); L.render(); L.say(L.shapeName[el.dataset.v] + ' ' + w); };
  L.acts.r9forder = function (el) {
    L.menu(el, '<div class="group">Order the filters</div>' + FORDERS.map(function (x) { return '<button role="menuitemradio" aria-checked="' + (st.forder === x[0]) + '" data-act="r9fordset" data-v="' + x[0] + '">' + (st.forder === x[0] ? L.icon('check', 's') : '<span style="width:14px"></span>') + x[1] + '</button>'; }).join(''), 'Order the filters');
  };
  L.acts.r9fordset = function (el) { st.forder = el.dataset.v; try { localStorage.setItem('lyre-r9-forder', st.forder); } catch (e) { /* storage unavailable */ } L.closeMenu(); L.render(); var b = document.querySelector('[data-k="lb-forder"]'); if (b) b.focus(); L.say('Filters ordered ' + FORDERS.filter(function (x) { return x[0] === st.forder; })[0][1]); };
  L.acts.lbnew = function () { st.newOnly = !st.newOnly; L.render(); L.say(st.newOnly ? 'Showing new tracks not tagged yet' : 'Showing all tracks'); };
  L.acts.lbftag = function (el) { var w = cycle(want(el.dataset.g), hid(el.dataset.g), el.dataset.v); L.render(); L.say(el.dataset.v + ' ' + w); };
  // Round 9 (item 34): a folder works like a filter chip: once shows only it, again hides it, again clears it.
  L.acts.lbfolder = function (el) {
    var f = el.dataset.f, i = st.hideFolders.indexOf(f);
    if (!f) { st.folder = ''; st.hideFolders = []; }
    else if (st.folder === f) { st.folder = ''; st.hideFolders.push(f); L.say(shortPath(f) + ' hidden'); }
    else if (i > -1) { st.hideFolders.splice(i, 1); L.say(shortPath(f) + ' shown again'); }
    else st.folder = f;
    L.render();
  };
  L.inputs.lbemin = function (el) { st.emin = +el.value; if (st.emax < st.emin) st.emax = st.emin; L.render(); };
  L.inputs.lbemax = function (el) { st.emax = +el.value; if (st.emin > st.emax) st.emin = st.emax; L.render(); };
  L.acts.lbclearfilters = function () { clearFilters(); L.render(); L.say('Filters cleared'); };
  // 0.5.2 item 21 (the app's FilterHeading): Clear beside a filter's heading takes off that filter only.
  var CLEARS = {
    shape: ['Shape', function () { st.shapes = []; st.hideShapes = []; }, '[aria-labelledby="lb-fh-shape"] .chips button'],
    energy: ['energy', function () { st.emin = 1; st.emax = 5; }, '[data-k="lb-emin"]'],
    folder: ['folder', function () { st.folder = ''; st.hideFolders = []; }, '.lb-folders button']
  };
  L.acts.lbfclear = function (el) {
    var w = el.dataset.what, g = el.dataset.g, c = CLEARS[w];
    var name = c ? c[0] : groupName(g), focus = c ? c[2] : '[aria-labelledby="lb-fh-' + g + '"] .chips button';
    if (c) c[1](); else { st.tags[g] = []; st.hide[g] = []; }
    L.render(); L.say(name + ' filter cleared. ' + visible().length + ' tracks shown');
    var f = document.querySelector(focus); if (f) f.focus();
  };
  L.acts.lbclearall = function () { clearFilters(); st.q = ''; L.render(); L.say('Filters cleared'); };
  L.acts.lbshownew = function () { clearFilters(); st.newOnly = true; st.q = ''; if (mode === 'narrow') L.route('#/library'); L.render(); };
  L.inputs.lbq = function (el) { st.q = el.value; L.render(); };
  L.inputs.lbsort = function (el) { st.sort = el.value; L.render(); };
  L.acts.lbguideclose = function () { st.guide = null; L.render(); var q = document.querySelector('[data-k="lb-q"]'); if (q) q.focus(); };

  /* ---------- a library folder's ⋯ (0.5.2 items 20 and 40, the app's FolderActions; 0.6.0 sync) ---------- */
  L.acts.lbfomenu = function (el) {
    var f = el.dataset.f, k = D.folderKinds[f] || '';
    var radio = function (v, words) { return '<button role="menuitemradio" aria-checked="' + (k === v) + '" data-act="lbfokind" data-f="' + esc(f) + '" data-v="' + v + '">' + (k === v ? L.icon('check', 's') : '<span style="width:14px"></span>') + words + '</button>'; };
    L.menu(el, '<div class="group">New tracks here are</div>' + radio('', 'Guessed from the folder name') + ['music', 'amb', 'fx'].map(function (x) { return radio(x, 'Always ' + L.kindName[x]); }).join('') +
      '<div class="sep"></div><button role="menuitem" data-act="lbforemove" data-f="' + esc(f) + '">' + L.icon('close', 's') + 'Remove folder…</button>', 'More for ' + shortPath(f));
  };
  L.acts.lbfokind = function (el) {
    var f = el.dataset.f, v = el.dataset.v, restore = L.snapshot(['folderKinds']);
    if (v) D.folderKinds[f] = v; else delete D.folderKinds[f];
    var text = v ? 'New tracks in ' + shortPath(f) + ' are ' + L.kindName[v] + '.' : 'New tracks in ' + shortPath(f) + ' are guessed from their folder names.';
    L.undoNote(text, restore); L.render(); L.say(text);
    var b = document.querySelector('[data-k="lb-fomore-' + f.replace(/\W/g, '_') + '"]'); if (b) b.focus();
  };
  var removingFolder = null;
  L.acts.lbforemove = function (el) {
    var f = el.dataset.f, under = D.tracks.filter(function (t) { return inFolder(t, f); }), n = under.length, watched = D.watched.indexOf(f) > -1;
    removingFolder = f;
    L.sheet({ title: 'Remove ' + shortPath(f) + '?', body: '<p>Lyre ' + (watched ? 'stops watching' : 'forgets') + ' <b>' + esc(f) + '</b>. Nothing is deleted from your computer.</p>' +
      (n ? '<label class="lb-check"><input type="checkbox" id="lb-fo-with" data-k="lb-fo-with"><span>Also remove its ' + plural(n, 'track') + ' from the library</span></label>' +
        '<p class="hint">The ' + plural(n, 'track') + ' stay in your library, where they are.</p>' : '<p class="hint">No track in your library is in it.</p>'),
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="lbforemovedo">Remove folder</button>' });
  };
  L.acts.lbforemovedo = function () {
    var f = removingFolder; if (!f) return; removingFolder = null;
    var w = document.getElementById('lb-fo-with'), withTracks = !!(w && w.checked);
    var restore = L.snapshot(['folders', 'watched', 'folderKinds', 'autoFolders', 'tracks', 'playlists', 'campaigns']);
    var gone = withTracks ? D.tracks.filter(function (t) { return inFolder(t, f); }).map(function (t) { return t.id; }) : [];
    [D.folders, D.watched].forEach(function (a) { var i = a.indexOf(f); if (i > -1) a.splice(i, 1); });
    delete D.folderKinds[f];
    if (gone.length) {
      var out = function (a) { for (var i = a.length - 1; i >= 0; i--) if (gone.indexOf(a[i]) > -1) a.splice(i, 1); };
      for (var i = D.tracks.length - 1; i >= 0; i--) if (gone.indexOf(D.tracks[i].id) > -1) D.tracks.splice(i, 1);
      D.playlists.forEach(function (p) { if (p.items) out(p.items); });
      D.campaigns.forEach(function (c) { out(c.tracks || []); c.sessions.forEach(function (s) { out(s.tracks || []); s.scenes.forEach(function (sc) { out(sc.music || []); if (gone.indexOf(sc.amb) > -1) sc.amb = ''; }); }); });
      st.sel = st.sel.filter(function (x) { return gone.indexOf(x) < 0; });
    }
    if (st.folder && inFolder({ folder: st.folder }, f)) st.folder = '';
    L.closeSheet();
    var text = withTracks ? 'Removed ' + f + ' and its ' + plural(gone.length, 'track') + ' from the library. The files are still on your computer.' : 'Removed ' + f + " from Lyre's folders. Its tracks stay in your library.";
    L.undoNote(text, restore); L.render(); L.say(text);
    var q = document.querySelector('[data-k="lb-q"]'); if (q) q.focus();
  };

  /* ---------- rows: open, select, preview, keys ---------- */
  function openTrack(id, keepRow) {
    st.cursor = id;
    pendingFocus = mode === 'narrow' ? 'lb-back' : keepRow ? 'lbrow-' + id : null;
    L.route('#/library/' + id);
  }
  L.acts.lbopen = function (el) { openTrack(el.dataset.tid, true); };
  // 0.5.2 item 6 (in the app since 0.5.2; 0.6.0 sync): Preview or Play on air on a row opens that track's details too.
  ['pv', 'onair'].forEach(function (a) {
    var f0 = L.acts[a];
    L.acts[a] = function (el) {
      var r = isLib() && el.dataset.kind === 'track' && el.closest('.lb-table tr[data-tid]');
      f0.apply(this, arguments);
      if (r && L.current().p.tid !== r.dataset.tid) openTrack(r.dataset.tid, true);
    };
  });
  L.acts.lbclose = function () { pendingFocus = st.cursor ? 'lbrow-' + st.cursor : null; L.route('#/library'); };
  L.acts.lbback = L.acts.lbclose;
  function toggleSel(id, range) {
    if (range && st.anchor) {
      var ids = visible().map(function (t) { return t.id; }), a = ids.indexOf(st.anchor), b = ids.indexOf(id);
      if (a > -1 && b > -1) { ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { if (st.sel.indexOf(x) < 0) st.sel.push(x); }); st.anchor = id; L.render(); L.say(st.sel.length + ' selected'); return; }
    }
    var i = st.sel.indexOf(id); if (i > -1) st.sel.splice(i, 1); else st.sel.push(id);
    st.anchor = id; st.cursor = id; L.render(); L.say(st.sel.length + ' selected');
  }
  L.acts.lbsel = function (el, ev) { toggleSel(el.dataset.tid, ev && ev.shiftKey); var r = document.querySelector('[data-k="lbrow-' + el.dataset.tid + '"]'); if (r) r.focus({ preventScroll: true }); };
  L.acts.lbselall = function () {
    var ids = visible().map(function (t) { return t.id; }), allOn = ids.length && ids.every(function (x) { return st.sel.indexOf(x) > -1; });
    if (allOn) st.sel = st.sel.filter(function (x) { return ids.indexOf(x) < 0; }); else ids.forEach(function (x) { if (st.sel.indexOf(x) < 0) st.sel.push(x); });
    L.render(); L.say(st.sel.length + ' selected');
  };
  L.acts.lbrowmenu = function (el) {
    var id = el.dataset.tid, t = L.track(id), sel = st.sel.indexOf(id) > -1;
    L.menu(el, '<button role="menuitem" data-act="lbrmopen" data-tid="' + id + '">' + L.icon('file', 's') + 'Open details</button>' +
      '<button role="menuitem" data-act="lbrmsel" data-tid="' + id + '">' + L.icon('check', 's') + (sel ? 'Deselect' : 'Select') + '</button>' +
      '<button role="menuitem" data-act="lbrmpl" data-tid="' + id + '">' + L.icon('playlist', 's') + 'Add to playlist…</button>' +
      '<button role="menuitem" data-act="addto" data-ids="' + (sel ? st.sel.join(',') : id) + '">' + L.icon('plus', 's') + 'Add to…</button>' +
      '<button role="menuitem" data-act="lbusein" data-tid="' + id + '">' + L.icon('link', 's') + 'Use in…</button>' +
      (L.profileLink ? '<button role="menuitem" data-act="lbrmprof" data-tid="' + id + '">' + L.icon('fade', 's') + 'Audio profile</button>' : '') +
      // Round 10 fixes (R10-FIX §1; 0.5.2 items 1 and 50): a ticked row takes the other ticked rows along, as Add to… does.
      // Delete file from disk… is last, apart and plain, with a confirmation that names the files.
      '<div class="sep"></div><button role="menuitem" data-act="r10rmask" data-how="remove" data-ids="' + (sel ? st.sel.join(',') : id) + '">' + L.icon('close', 's') + 'Remove from library…' + (sel && st.sel.length > 1 ? ' (' + st.sel.length + ')' : '') + '</button>' +
      '<div class="sep"></div><button role="menuitem" class="r10-mi-quiet" data-act="r10rmask" data-how="delete" data-ids="' + (sel ? st.sel.join(',') : id) + '">' + L.icon('warn', 's') + 'Delete file from disk' + (sel && st.sel.length > 1 ? ' (' + st.sel.length + ')' : '') + '…</button>', 'More for ' + L.title(t));
  };
  L.acts.lbrmopen = function (el) { openTrack(el.dataset.tid, true); };
  L.acts.lbusein = function (el) { L.assignSheet('track', el.dataset.tid || cur().id); };
  L.acts.lbrmsel = function (el) { toggleSel(el.dataset.tid); };
  L.acts.lbrmprof = function (el) { L.route('#/profile/' + el.dataset.tid); };
  L.acts.lbrmpl = function (el) {
    var id = el.dataset.tid;
    L.pickerSheet({ title: 'Add "' + L.title(L.track(id)) + '" to playlists', multi: true, okLabel: 'Add',
      items: D.playlists.filter(function (p) { return p.kind === 'manual' && p.items.indexOf(id) < 0; }).map(function (p) { return { id: p.id, label: p.name, sub: plural(p.items.length, 'track'), group: L.kindName[p.lane] }; }),
      saved: 'playlists of ' + L.title(L.track(id)),
      onDone: function (ids) { ids.forEach(function (pid) { L.playlist(pid).items.push(id); }); } });
  };
  L.acts.lbbclear = function () { st.sel = []; L.render(); L.say('Selection cleared'); var q = document.querySelector('[data-k="lb-q"]'); if (q) q.focus(); };
  L.acts.lbprev = function (el) { L.preview(el.dataset.tid); };
  function rowKey(e, row) {
    var id = row.dataset.tid, k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      var rows = [].slice.call(row.parentNode.querySelectorAll('tr[data-tid]')), i = rows.indexOf(row);
      var j = k === 'Home' ? 0 : k === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (k === 'ArrowDown' ? 1 : -1)));
      rows.forEach(function (r) { r.tabIndex = -1; }); rows[j].tabIndex = 0; rows[j].focus(); rows[j].scrollIntoView({ block: 'nearest' }); st.cursor = rows[j].dataset.tid;
      if (e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) { [id, st.cursor].forEach(function (x) { if (st.sel.indexOf(x) < 0) st.sel.push(x); }); st.anchor = st.cursor; L.render(); L.say(st.sel.length + ' selected'); }
      return true;
    }
    if (k === 'Enter') { openTrack(id, true); return true; }
    if (k === ' ') { toggleSel(id, e.shiftKey); return true; }
    if ((k === 'p' || k === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) { L.preview(id); return true; }
    if ((k === 'a' || k === 'A') && !e.ctrlKey && !e.metaKey && !e.altKey) { onAir(L.track(id)); return true; }
    // Round 10 fixes (R10-FIX §1): Delete asks to remove the track (the ticked tracks, when this row is ticked).
    if (k === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey) { askRemove('remove', st.sel.indexOf(id) > -1 ? st.sel.slice() : [id]); return true; }
    return false;
  }

  /* ---------- Round 10 fixes (R10-FIX §1): taking tracks out of the Track library ----------
     Nik, 18 Nov 13:00: "There's still no way to remove tracks". As 0.5.2 built it in the app (items 1 and 50,
     src/lyre/screens/library/RemoveTracks.tsx), with the app's words:
       Remove from library     the tracks leave Lyre, and every playlist, pad and scene; their files stay. It asks
                               first and names where they are used; Undo puts them back.
       Delete file from disk…  the files go to the Recycle Bin and their tracks leave Lyre. The confirmation names the
                               files; Undo brings the tracks back (missing until the files are restored). */
  var NAMED_FILES = 10, removal = null;
  // 0.6.0 sync (the app's trackUses.ts usesLines): one line per kind of place, the five first and then "and n more":
  // manual playlists, scenes ("The abbey ruins (Session 14)") and pads ("Thunder (Weather)").
  function usesOf(ids) {
    var on = function (id) { return ids.indexOf(id) > -1; }, pls = [], scenes = [], pads = [], out = [];
    var few = function (names) { return names.length > 5 ? names.slice(0, 5).join(', ') + ' and ' + (names.length - 5) + ' more' : names.join(', '); };
    D.playlists.forEach(function (p) { if (p.kind === 'manual' && p.items.some(on)) pls.push(p.name); });
    D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc) { if ((sc.music || []).some(on) || on(sc.amb)) scenes.push(sc.name + ' (Session ' + s.n + ')'); }); }); });
    // A pad names its sounds by file.
    var files = ids.map(function (id) { var t = L.track(id); return t ? t.file : ''; }).filter(Boolean);
    D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (x) { if (x && x.sound && (x.sound.files || []).some(function (f) { return files.indexOf(f) > -1; })) pads.push((x.label || 'A pad') + ' (' + b.name + ')'); }); });
    if (pls.length) out.push('Playlists: ' + few(pls));
    if (scenes.length) out.push('Scenes: ' + few(scenes));
    if (pads.length) out.push('Pads: ' + few(pads));
    return out;
  }
  function askRemove(how, ids, shown) {
    var list = ids.map(L.track).filter(Boolean), n = list.length; if (!n) return;
    var one = n === 1 ? list[0] : null, deleting = how === 'delete', uses = usesOf(list.map(function (t) { return t.id; }));
    var what = one ? '“' + L.title(one) + '”' : shown ? 'all ' + n + ' shown tracks' : plural(n, 'track');
    removal = { how: how, ids: list.map(function (t) { return t.id; }) };
    var files = list.map(function (t) { return t.file; });
    var body = deleting
      ? '<p>' + (one ? 'This file goes' : 'These files go') + ' to the Recycle Bin, and ' + (one ? 'its track leaves' : 'their tracks leave') + ' the library. <b>This can\'t be undone in Lyre.</b> To get ' + (one ? 'it' : 'them') + ' back, restore ' + (one ? 'it' : 'them') + ' from the Recycle Bin.</p>' +
        '<ul class="r10-files">' + files.slice(0, NAMED_FILES).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + (files.length > NAMED_FILES ? '<li class="hint">and ' + plural(files.length - NAMED_FILES, 'more file') + '</li>' : '') + '</ul>'
      : '<p>' + (one ? 'It leaves' : 'They leave') + ' Lyre, and every playlist, pad and scene. ' + (one ? 'Its file stays' : 'Their files stay') + ' on your computer, and you can bring ' + (one ? 'it' : 'them') + ' back with Undo.</p>';
    if (uses.length) body += '<div class="r10-uses" role="note"><p>' + (one ? 'It is' : 'They are') + ' used in:</p><ul>' + uses.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>';
    L.sheet({ title: deleting ? 'Delete ' + (one ? 'its file' : plural(n, 'file')) + ' from disk?' : 'Remove ' + what + ' from the library?', body: body,
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn ' + (deleting ? 'danger' : 'primary') + '" data-act="r10rmdo">' + (deleting ? (one ? 'Delete file' : 'Delete ' + plural(n, 'file')) : one ? 'Remove' : 'Remove ' + plural(n, 'track')) + '</button>' });
  }
  L.acts.r10rmask = function (el) { if (el.disabled) return; askRemove(el.dataset.how, (el.dataset.ids || '').split(',').filter(Boolean), !!el.dataset.shown); };
  L.acts.r10selmore = function (el) {
    // 0.5.2 items 4 and 39 (the app's selection menu; 0.6.0 sync): Type first, for every ticked track at once.
    L.menu(el, (L.r60typeMenu ? L.r60typeMenu(st.sel) : '') + '<button role="menuitem" data-act="r10rmask" data-how="remove" data-ids="' + st.sel.join(',') + '">' + L.icon('close', 's') + 'Remove from library…</button>' +
      '<div class="sep"></div><button role="menuitem" class="r10-mi-quiet" data-act="r10rmask" data-how="delete" data-ids="' + st.sel.join(',') + '">' + L.icon('warn', 's') + (st.sel.length === 1 ? 'Delete file from disk…' : 'Delete files from disk…') + '</button>', 'More for the selected tracks');
  };
  L.acts.r10rmdo = function () {
    var r = removal; if (!r) return; removal = null;
    var gone = r.ids, list = gone.map(L.track), one = gone.length === 1 ? list[0] : null, restore = L.snapshot(['tracks', 'playlists', 'campaigns']);
    var out = function (a) { for (var i = a.length - 1; i >= 0; i--) if (gone.indexOf(a[i]) > -1) a.splice(i, 1); };
    for (var i = D.tracks.length - 1; i >= 0; i--) if (gone.indexOf(D.tracks[i].id) > -1) D.tracks.splice(i, 1);
    D.playlists.forEach(function (p) { if (p.items) out(p.items); });
    D.campaigns.forEach(function (c) { out(c.tracks || []); c.sessions.forEach(function (s) { out(s.tracks || []); s.scenes.forEach(function (sc) { out(sc.music || []); if (gone.indexOf(sc.amb) > -1) sc.amb = ''; }); }); });
    st.sel = st.sel.filter(function (x) { return gone.indexOf(x) < 0; }); if (gone.indexOf(st.cursor) > -1) st.cursor = null;
    var text = r.how === 'delete'
      ? plural(gone.length, 'file') + ' sent to the Recycle Bin, and ' + (one ? 'its track' : 'their tracks') + ' removed from the library. Undo brings ' + (one ? 'the track' : 'the tracks') + ' back; ' + (one ? 'the file stays' : 'the files stay') + ' in the Recycle Bin.'
      : 'Removed ' + (one ? '“' + L.title(one) + '”' : plural(gone.length, 'track')) + ' from the library. ' + (one ? 'Its file is' : 'Their files are') + ' still on your computer.';
    L.undoNote(text, function () { restore(); if (r.how === 'delete') gone.forEach(function (id) { var t = L.track(id); if (t) t.missing = true; }); });
    L.closeSheet();
    var open = L.current().name === 'library' && L.current().p.tid;
    if (open && gone.indexOf(open) > -1) L.route('#/library'); else L.render();
    L.say(text + ' To undo this, press Undo, at the bottom of the screen, or Ctrl+Z.');
    var q = document.querySelector('[data-k="lb-q"]'); if (q && L.current().name === 'library') q.focus();
  };

  /* ---------- details actions ---------- */
  // Round 9 (r9nav.js): outside the Library the Track panel shows these same details, for L.panelTrack().
  function cur() { var p = L.current().p, id = L.current().name === 'library' ? p.tid : (L.panelTrack && L.panelTrack()); return id ? L.track(id) : null; }
  L.trackDetailsHTML = function (t) { return detailsBody(t); };
  L.inputs.lbtitle = function (el) { var t = cur(); if (!t) return; t.title = el.value; settle(t); L.render(); };
  L.acts.lbusemeta = function () { var t = cur(); if (!t) return; t.title = t.metaTitle; settle(t); L.render(); var f = document.querySelector('[data-k="lb-title"]'); if (f) { f.focus(); f.select(); } L.say('Your title is now ' + t.title + '. Type to change it.'); L.saved('title “' + t.title + '”', { key: 'lb-title' }); };
  L.inputs.lbnotes = function (el) { var t = cur(); if (t) t.notes = el.value; };
  L.acts.lbenergy = function (el) { var t = cur(), v = +el.dataset.v; t.energy = t.energy === v ? 0 : v; L.render(); L.say(t.energy ? 'Energy ' + v : 'Energy cleared'); L.saved(L.title(t) + ' energy'); };
  // Choosing the shape Lyre suggests is the same as no choice of your own: it keeps following the suggestion.
  L.acts.lbshape = function (el) { var t = cur(), v = el.dataset.v; t.shape = v === L.suggestedShape(t) ? null : v; L.render(); L.say('Shape: ' + L.shapeName[L.shapeOf(t)] + (t.shape ? '' : ', as Lyre suggests')); L.saved(L.title(t) + ' shape'); };
  L.acts.lbshapeauto = function () { var t = cur(); t.shape = null; L.render(); L.say('Shape: ' + L.shapeName[L.shapeOf(t)] + ', as Lyre suggests'); L.saved(L.title(t) + ' shape'); };
  L.acts.lbrole = function (el) { var t = cur(); t.role = t.role === el.dataset.v ? '' : el.dataset.v; L.render(); L.saved(L.title(t) + ' role'); };
  L.acts.lbloop = function (el) { var t = cur(); t.loop = t.loop === el.dataset.v ? '' : el.dataset.v; L.render(); L.saved(L.title(t) + ' loop advice'); };
  L.acts.lbcopy = function () { var t = cur(), p = t.folder + '\\' + t.file; try { navigator.clipboard.writeText(p).catch(function () {}); } catch (e) { /* clipboard unavailable in the prototype */ } L.toast('Path copied: ' + p); };
  L.acts.lbshow = function () { L.toast('Lyre would open ' + cur().folder + ' in File Explorer'); };
  function onAir(t) { L.play(t.id, { fade: 3 }); L.toast('On air: ' + L.title(t)); }
  L.acts.lbonair = function () { onAir(cur()); };
  L.acts.lbuntag = function (el) {
    var t = cur(), g = el.dataset.g, v = el.dataset.v; t.tags[g] = t.tags[g].filter(function (x) { return x !== v; });
    L.render(); L.say('Removed ' + v + ' from ' + groupName(g)); var f = document.querySelector('[data-k="lb-cbx-' + g + '"]'); if (f) f.focus(); L.saved(L.title(t) + ' tags', { key: 'lb-tags' });
  };
  L.acts.lbplrm = function (el) { var t = cur(), p = L.playlist(el.dataset.pid); p.items = p.items.filter(function (x) { return x !== t.id; }); L.render(); L.saved(p.name, { detail: 'removed ' + L.title(t) }); var b = document.querySelector('[data-k="lb-pladd"]'); if (b) b.focus(); };
  L.acts.lbpladdmenu = function (el) {
    var t = cur(), opts = D.playlists.filter(function (p) { return p.kind === 'manual' && (p.lane === t.kind || (p.lane === 'fx' && L.isFx(t))) && p.items.indexOf(t.id) < 0; });
    L.menu(el, '<div class="group">Manual playlists: ' + L.kindName[t.kind] + (t.kind !== 'fx' && L.isFx(t) ? ' and FX' : '') + '</div>' +
      (opts.length ? opts.map(function (p) { return '<button role="menuitem" data-act="lbpladd" data-pid="' + p.id + '">' + L.icon('playlist', 's') + '<span class="ellipsis grow">' + esc(p.name) + '</span><span class="hint">' + p.items.length + '</span></button>'; }).join('') : '<div class="group">It is already in all of them.</div>') +
      '<div class="sep"></div><button role="menuitem" data-act="lbplnew1">' + L.icon('plus', 's') + 'New playlist with this track</button>', 'Add to playlist');
  };
  L.acts.lbpladd = function (el) { var t = cur(), p = L.playlist(el.dataset.pid); p.items.push(t.id); L.render(); L.saved(p.name, { detail: 'added ' + L.title(t) }); var b = document.querySelector('[data-k="lb-pladd"]'); if (b) b.focus(); };
  function newPlaylist(ids) {
    var tracks = ids.map(L.track).filter(Boolean), count = { music: 0, amb: 0, fx: 0 }; tracks.forEach(function (t) { count[t.kind]++; });
    var n = 1; while (D.playlists.some(function (p) { return p.name === 'New playlist ' + n; })) n++;
    var p = { id: L.uid('p-'), name: 'New playlist ' + n, kind: 'manual', lane: Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0], items: ids.slice(), notes: '' };
    D.playlists.push(p);
    st.guide = { icon: 'playlist', html: '<b>' + esc(p.name) + '</b> made with ' + plural(ids.length, 'track') + '. <a href="#/playlist/' + p.id + '">Open it</a> to name it and choose where it is used.' };
    L.render(); L.say(p.name + ' made with ' + plural(ids.length, 'track'));
    return p;
  }
  L.acts.lbplnew1 = function () { newPlaylist([cur().id]); };

  /* ---------- tag combobox (details) ---------- */
  function pick(t, g, v) {
    v = cap(v); if (!v) return;
    var known = D.tagValues[g].filter(function (x) { return x.toLowerCase() === v.toLowerCase(); })[0];
    if (!known) D.tagValues[g].push(v); else v = known;
    if (t.tags[g].indexOf(v) < 0) t.tags[g].push(v);
    settle(t); cbx = { g: g, q: '', act: 0, open: false };
    L.render(); L.say((known ? 'Added ' : 'Created and added ') + v + ' to ' + groupName(g)); L.saved(L.title(t) + ' tags', { key: 'lb-tags' });
  }
  L.inputs.lbcbx = function (el) { cbx = { g: el.dataset.g, q: el.value, act: 0, open: true }; L.render(); };
  L.acts.lbcbxopen = function (el) { if (cbx.g !== el.dataset.g || !cbx.open) { cbx = { g: el.dataset.g, q: el.value, act: 0, open: true }; L.render(); } };
  L.acts.lbcbxpick = function (el) { var t = cur(); if (t) pick(t, el.dataset.g, el.dataset.v); var f = document.querySelector('[data-k="lb-cbx-' + el.dataset.g + '"]'); if (f) f.focus(); };
  function cbxKey(e, el) {
    var t = cur(), g = el.dataset.g; if (!t) return false;
    var opts = cbx.g === g ? cbxOptions(t, g) : [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!cbx.open || cbx.g !== g) { cbx = { g: g, q: el.value, act: 0, open: true }; }
      else if (opts.length) cbx.act = (cbx.act + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      L.render(); return true;
    }
    if (e.key === 'Enter') {
      if (cbx.open && cbx.g === g && opts[cbx.act]) pick(t, g, opts[cbx.act].v);
      else if (el.value.trim()) pick(t, g, el.value);
      return true;
    }
    if (e.key === 'Escape' && (cbx.open || el.value)) { cbx = { g: null, q: '', act: 0, open: false }; L.render(); L.say('Cancelled'); return true; }
    return false;
  }
  // Close the list when focus leaves a combobox, without a re-render (a re-render here would swallow the click that moved focus).
  document.addEventListener('focusout', function (e) {
    var el = e.target; if (!el.classList || !el.classList.contains('lb-cbxin')) return;
    setTimeout(function () {
      if (document.activeElement === el || !document.contains(el)) return; // a re-render replaced the field: not a real blur
      var box = el.parentNode, lbx = box && box.querySelector('.lb-lbx');
      if (lbx) lbx.hidden = true; if (box) box.classList.remove('open');
      el.setAttribute('aria-expanded', 'false'); el.removeAttribute('aria-activedescendant'); el.value = '';
      if (cbx.g === el.dataset.g) cbx = { g: null, q: '', act: 0, open: false };
    }, 0);
  });
  document.addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('.lb-lbx')) e.preventDefault(); });

  /* ---------- bulk: Tag… sheet ---------- */
  function selTracks() { return st.sel.map(L.track).filter(Boolean); }
  function tsBody() {
    var tr = selTracks(), n = tr.length;
    // The line explains the counts on the tags, so it shows only when a tag has one.
    var counted = D.tagGroups.some(function (g) { return D.tagValues[g.id].some(function (v) { return tr.some(function (t) { return (t.tags[g.id] || []).indexOf(v) > -1; }); }); });
    var h = '<p class="muted lb-tsintro">' + (counted ? '"All" or "2 of 3" on a tag: how many of the ' + plural(n, 'selected track') + ' have it already.' : 'None of the ' + plural(n, 'selected track') + ' has a tag yet.') + '</p>' +
      '<div class="seg s lb-seg24" role="group" aria-label="Add or remove"><button data-act="lbtsmode" data-v="add" data-k="lb-ts-add" aria-pressed="' + (ts.mode === 'add') + '">' + L.icon('plus', 's') + 'Add tags</button>' +
      '<button data-act="lbtsmode" data-v="remove" data-k="lb-ts-rm" aria-pressed="' + (ts.mode === 'remove') + '">' + L.icon('minus', 's') + 'Remove tags</button></div>';
    D.tagGroups.forEach(function (g) {
      h += '<fieldset class="lb-tsg"><legend>' + esc(g.name) + '</legend><div class="chips">' + D.tagValues[g.id].map(function (v, i) {
        var have = tr.filter(function (t) { return (t.tags[g.id] || []).indexOf(v) > -1; }).length, on = ts.pick[g.id].indexOf(v) > -1;
        var off = ts.mode === 'remove' && !have;
        var cov = have === n ? 'all' : have ? have + ' of ' + n : '';
        return '<button class="chip lb-tsc" data-act="lbtspick" data-g="' + g.id + '" data-v="' + esc(v) + '" data-k="lb-ts-' + g.id + '-' + i + '" aria-pressed="' + on + '"' + (off ? ' disabled' : '') +
          ' aria-label="' + esc(v) + (cov ? ', ' + (cov === 'all' ? 'all have it' : cov + ' have it') : ', none have it') + '">' + (on ? L.icon('check', 's') : '') + esc(v) + (cov ? '<span class="lb-cov">' + cov + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
        (ts.mode === 'add' ? '<div class="lb-tsnew"><input class="input" data-lbtnew="1" data-g="' + g.id + '" data-input="lbtsq" data-k="lb-tsq-' + g.id + '" value="' + esc(ts.newq[g.id]) + '" placeholder="New ' + esc(g.name.toLowerCase()) + ' value" aria-label="New ' + esc(g.name) + ' value">' +
          '<button class="btn s" data-act="lbtsnew" data-g="' + g.id + '" data-k="lb-tsnew-' + g.id + '">Create</button></div>' : '') + '</fieldset>';
    });
    return h;
  }
  function tsCount() { return D.tagGroups.reduce(function (a, g) { return a + ts.pick[g.id].length; }, 0); }
  function tsApplyLabel() { var k = tsCount(), n = st.sel.length; return k ? (ts.mode === 'add' ? 'Add ' + plural(k, 'tag') + ' to ' + plural(n, 'track') : 'Remove ' + plural(k, 'tag') + ' from ' + plural(n, 'track')) : 'Tick a tag first'; }
  function tsPaint() {
    var box = document.getElementById('lb-ts'); if (!box) return;
    var a = document.activeElement, k = a && a.dataset ? a.dataset.k : null;
    box.innerHTML = tsBody();
    if (k) { var el = box.querySelector('[data-k="' + k + '"]'); if (el) el.focus(); }
    var b = document.getElementById('lb-ts-apply'); if (b) { b.textContent = tsApplyLabel(); b.disabled = !tsCount(); b.className = 'btn ' + (ts.mode === 'remove' ? 'danger' : 'primary'); }
  }
  L.acts.lbbtag = function () {
    ts = { mode: 'add', pick: {}, newq: {} }; D.tagGroups.forEach(function (g) { ts.pick[g.id] = []; ts.newq[g.id] = ''; });
    L.sheet({ title: 'Tag ' + plural(st.sel.length, 'track'), body: '<div id="lb-ts">' + tsBody() + '</div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" id="lb-ts-apply" data-act="lbtsapply" disabled>' + tsApplyLabel() + '</button>' });
  };
  L.acts.lbtsmode = function (el) { ts.mode = el.dataset.v; if (ts.mode === 'remove') { var tr = selTracks(); D.tagGroups.forEach(function (g) { ts.pick[g.id] = ts.pick[g.id].filter(function (v) { return tr.some(function (t) { return t.tags[g.id].indexOf(v) > -1; }); }); }); } tsPaint(); };
  L.acts.lbtspick = function (el) { var a = ts.pick[el.dataset.g], v = el.dataset.v, i = a.indexOf(v); if (i > -1) a.splice(i, 1); else a.push(v); tsPaint(); };
  L.inputs.lbtsq = function (el) { ts.newq[el.dataset.g] = el.value; };
  function tsCreate(g) {
    var v = cap(ts.newq[g] || ''); if (!v) return;
    var known = D.tagValues[g].filter(function (x) { return x.toLowerCase() === v.toLowerCase(); })[0];
    if (!known) D.tagValues[g].push(v); else v = known;
    if (ts.pick[g].indexOf(v) < 0) ts.pick[g].push(v); ts.newq[g] = '';
    tsPaint(); L.say((known ? v + ' ticked' : 'Created ' + v + ' in ' + groupName(g) + ' and ticked it'));
    var f = document.querySelector('[data-k="lb-tsq-' + g + '"]'); if (f) f.focus();
  }
  L.acts.lbtsnew = function (el) { tsCreate(el.dataset.g); };
  L.acts.lbtsapply = function () {
    var tr = selTracks(), add = ts.mode === 'add', names = [], restore = L.snapshot(['tracks', 'tagValues']);
    D.tagGroups.forEach(function (g) {
      ts.pick[g.id].forEach(function (v) {
        names.push(v);
        tr.forEach(function (t) { var a = t.tags[g.id], i = a.indexOf(v); if (add && i < 0) a.push(v); if (!add && i > -1) a.splice(i, 1); });
      });
    });
    tr.forEach(settle);
    var msg = (add ? 'Added ' : 'Removed ') + names.join(', ') + (add ? ' to ' : ' from ') + plural(tr.length, 'track') + '.';
    var stillNew = tr.filter(function (t) { return t.isNew; }).length;
    st.guide = { icon: 'tag', html: esc(msg) + (stillNew ? ' ' + plural(stillNew, 'track') + (stillNew === 1 ? ' still needs' : ' still need') + ' a title of your own: open ' + (stillNew === 1 ? 'it' : 'each one') + ' to type it.' : '') };
    L.undoNote(msg, restore);
    L.closeSheet(); L.render(); L.say(msg);
  };

  /* ---------- bulk: playlists ---------- */
  L.acts.lbbpl = function () {
    var n = st.sel.length;
    L.pickerSheet({ title: 'Add ' + plural(n, 'track') + ' to playlists', multi: true, okLabel: 'Add',
      intro: 'Only manual playlists are listed. Dynamic playlists pick up tracks by their tags, so tag the tracks instead.',
      items: D.playlists.filter(function (p) { return p.kind === 'manual'; }).map(function (p) { return { id: p.id, label: p.name, sub: plural(p.items.length, 'track'), group: L.kindName[p.lane] }; }),
      onDone: function (ids) {
        if (!ids.length) return;
        ids.forEach(function (pid) { var p = L.playlist(pid); st.sel.forEach(function (tid) { if (p.items.indexOf(tid) < 0) p.items.push(tid); }); });
        st.guide = { icon: 'playlist', html: 'Added ' + plural(n, 'track') + ' to ' + ids.map(function (pid) { var p = L.playlist(pid); return '<a href="#/playlist/' + p.id + '">' + esc(p.name) + '</a>'; }).join(', ') + '.' };
        L.say('Added ' + plural(n, 'track') + ' to ' + plural(ids.length, 'playlist'));
      } });
  };
  L.acts.lbbnew = function () { newPlaylist(st.sel); };

  /* ---------- adding tracks (simulated) ---------- */
  function meta(file) { return file.replace(/\.[a-z0-9]+$/i, '').replace(/^[\d-]+\s+/, ''); }
  var S = 'H:\\Audio\\Scores\\';
  var POOL = {
    files: [
      [['Ramin Djawadi', 'Game of Thrones, Season 8', '03 The Night King.flac', 528], ['Howard Shore', 'The Hobbit: An Unexpected Journey', '1-07 Misty Mountains.flac', 102], ['Harry Gregson-Williams', 'The Chronicles of Narnia', '11 The Battle.flac', 245]],
      [['Hans Zimmer', 'Interstellar', '04 Day One.flac', 199], ['John Williams', 'Harry Potter and the Prisoner of Azkaban', '05 Double Trouble.flac', 97], ['Jeremy Soule', 'The Elder Scrolls IV: Oblivion', '07 Wings of Kynareth.flac', 155], ['Lorne Balfe', 'His Dark Materials', '01 Main Titles.flac', 104]]
    ],
    folders: [
      { artist: 'Bear McCreary', album: 'The Rings of Power', items: [['01 Galadriel.flac', 211], ['04 Khazad-dum.flac', 188], ['09 Sauron.flac', 246], ['12 Numenor.flac', 203], ['17 Elendil and Isildur.flac', 176]] },
      { artist: 'Hans Zimmer', album: 'Dune', items: [['02 Leaving Caladan.flac', 132], ['05 Ripples in the Sand.flac', 205], ['08 Herald of the Change.flac', 191], ['11 Dream of Arrakis.flac', 177]] }
    ],
    watch: [['Jeremy Soule', 'The Elder Scrolls III: Morrowind', '02 Peaceful Waters.flac', 168], ['Gustavo Santaolalla', 'The Last of Us', '06 The Path.flac', 254]]
  };
  var used = { files: 0, folders: 0, watch: 0 };
  function make(artist, album, file, dur, folder, i) {
    return { id: L.uid('t'), kind: /ambience/i.test(folder) ? 'amb' : /effects/i.test(folder) ? 'fx' : 'music', title: '', metaTitle: meta(file), artist: artist || 'Unknown artist', album: album || '', file: file,
      folder: folder || S + artist + '\\' + album, dur: dur || 180, tags: { mood: [], motif: [], scene: [] }, energy: 0, role: '', loop: '', notes: '', added: 'Today', addedAt: Date.now() - (i || 0), isNew: true };
  }
  function arrive(tracks, how, inLibrary) {
    if (!inLibrary) tracks.forEach(function (t) { D.tracks.push(t); });
    clearFilters(); st.newOnly = true; st.q = ''; st.sort = 'new'; st.sel = tracks.map(function (t) { return t.id; }); st.cursor = tracks[0].id; st.anchor = null;
    var n = tracks.length, one = n === 1;
    st.guide = { icon: 'plus', html: '<b>' + plural(n, 'track') + ' added' + (how ? ' ' + esc(how) : '') + '.</b> Give ' + (one ? 'it' : 'them') + ' a title and tags: ' + (one ? 'choose' : 'select them and choose') + ' <b>Tag…</b>, or open ' + (one ? 'it' : 'one') + ' to edit it.' };
    if (mode === 'narrow' && L.current().p.tid) L.route('#/library'); else L.render();
    L.say(plural(n, 'track') + ' added and selected. Choose Tag to tag them, or open one to edit it.');
    var b = document.querySelector('[data-k="lb-btag"]'); if (b) b.focus();
  }
  function nothingNew() { L.toast('Nothing new there: those files are already in your library'); }
  // DAT-7 / DAT-8: the library as a file (back up, move to another PC, share), what came across from Kenku FM, missing files.
  L.acts.lbmore = function (el) {
    var n = D.tracks.filter(function (t) { return t.missing; }).length;
    L.menu(el, '<button role="menuitem" data-act="lbgo" data-href="#/backup">' + L.icon('download', 's') + 'Back up, move or share…</button>' +
      '<button role="menuitem" data-act="lbgo" data-href="#/relink">' + L.icon('folder', 's') + 'Find missing files' + (n ? ' (' + n + ')' : '') + '…</button>' +
      '<button role="menuitem" data-act="lbgo" data-href="#/moved">' + L.icon('file', 's') + 'What came across from Kenku FM</button>' +
      // PLY-15: the library's normalisation setting (off until turned on), in a small dialog.
      '<div class="sep"></div><button role="menuitem" data-act="normopen">' + L.icon('volume', 's') + 'Normalise volume…</button>' +
      // Round 7 (DAT-10): the tag vocabulary has its own screen.
      '<button role="menuitem" data-act="lbgo" data-href="#/tags">' + L.icon('tag', 's') + 'Tags and groups…</button>' +
      // Round 10 fixes (R10-FIX §1, item 50): with a search or a filter on, every track the list shows, counted.
      (st.q || filtersOn() ? '<div class="sep"></div><button role="menuitem" data-act="r10rmask" data-how="remove" data-shown="1" data-ids="' + visible().map(function (t) { return t.id; }).join(',') + '"' + (visible().length ? '' : ' disabled') + '>' + L.icon('close', 's') + 'Remove the ' + plural(visible().length, 'track') + ' shown from the library…</button>' : ''), 'More for the library');
  };
  L.acts.lbgo = function (el) { L.route(el.dataset.href); };
  L.acts.lbaddmenu = function (el) {
    L.menu(el, '<button role="menuitem" data-act="lbaddfiles" class="lb-mi">' + L.icon('file') + '<span class="grow"><b>Add files…</b><span class="hint">Choose one or more audio files</span></span></button>' +
      '<button role="menuitem" data-act="lbaddfolder" class="lb-mi">' + L.icon('folder') + '<span class="grow"><b>Add a folder…</b><span class="hint">Everything in it, subfolders too</span></span></button>' +
      '<button role="menuitem" data-act="lbwatch" class="lb-mi">' + L.icon('eye') + '<span class="grow"><b>Watch a folder…</b><span class="hint">New files appear by themselves</span></span></button>' +
      '<div class="sep"></div><div class="group">Or drop files and folders anywhere on this page</div>', 'Add tracks');
  };
  L.acts.lbaddfiles = function () {
    var b = POOL.files[used.files]; if (!b) return nothingNew(); used.files++;
    arrive(b.map(function (r, i) { return make(r[0], r[1], r[2], r[3], null, i); }));
  };
  L.acts.lbaddfolder = function () {
    var f = POOL.folders[used.folders]; if (!f) return nothingNew(); used.folders++;
    arrive(f.items.map(function (r, i) { return make(f.artist, f.album, r[0], r[1], null, i); }), 'from ' + f.artist + '\\' + f.album);
  };
  L.acts.lbwatch = function () {
    var f = 'H:\\Audio\\Incoming';
    if (D.watched.indexOf(f) > -1) { L.toast('Lyre is already watching ' + f); return; }
    D.watched.push(f); if (D.folders.indexOf(f) < 0) D.folders.push(f);
    st.guide = { icon: 'eye', html: 'Watching <b>' + esc(f) + '</b>. Audio files you put there will appear here by themselves, marked New.' };
    L.render(); L.say('Watching ' + f);
    setTimeout(function () {
      var r = POOL.watch[used.watch]; if (!r) return; used.watch++;
      var t = make(r[0], r[1], r[2], r[3], f); D.tracks.push(t);
      st.guide = { icon: 'eye', html: '<b>1 new file appeared</b> in ' + esc(f) + ': ' + esc(t.metaTitle) + '.', act: 'lbshownew', actLabel: 'Show new tracks' };
      if (isLib()) L.render(); L.say('A new file appeared in the watched folder: ' + t.metaTitle);
    }, 3500);
  };
  // Drop files or folders anywhere on the page (simulated import of what was dropped).
  var depth = 0;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') > -1; }
  function dropUI(on) { var v = document.getElementById('view'); if (v) v.classList.toggle('lb-drop', on); }
  document.addEventListener('dragenter', function (e) { if (!isLib() || !hasFiles(e)) return; e.preventDefault(); depth++; dropUI(true); });
  document.addEventListener('dragover', function (e) { if (!isLib() || !hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragleave', function (e) { if (!isLib() || !hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) dropUI(false); });
  document.addEventListener('drop', function (e) {
    if (!isLib()) return; e.preventDefault(); depth = 0; dropUI(false);
    // Core reads the dropped files and walks dropped folders, so drops behave the same in every view.
    L.filesFromDrop(e, function (files) {
      if (!files.length) { L.toast('Lyre plays audio files (FLAC, MP3, WAV, OGG). Nothing was added.'); return; }
      var before = {}; D.tracks.forEach(function (t) { before[t.id] = 1; });
      var ids = L.importFiles(files), now = Date.now(), fresh = ids.filter(function (id, i) { if (before[id]) return false; L.track(id).addedAt = now - i; return true; }).length;
      arrive(ids.map(L.track).filter(Boolean), 'by dropping' + (fresh < ids.length ? ' (' + (ids.length - fresh) + ' already in the Track library)' : ''), true);
    });
  });

  /* ---------- keys and focus ---------- */
  document.addEventListener('keydown', function (e) {
    if (!isLib()) return;
    var t = e.target;
    if (t.classList && t.classList.contains('lb-cbxin')) { if (cbxKey(e, t)) { e.preventDefault(); e.stopPropagation(); } return; }
    if (t.dataset && t.dataset.lbtnew && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tsCreate(t.dataset.g); return; }
    if (document.getElementById('lyre-sheet') || document.querySelector('body > .menu')) return;
    var row = t.matches && t.matches('tr[data-tid]') ? t : null;
    if (row && rowKey(e, row)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Core moves focus to the heading after a route change; when a row opened a track, keep focus where the user is.
  window.addEventListener('lyre:route', function () {
    if (!pendingFocus) return; var k = pendingFocus; pendingFocus = null;
    var el = document.querySelector('[data-k="' + k + '"]'); if (el) el.focus({ preventScroll: true });
  });
})();
