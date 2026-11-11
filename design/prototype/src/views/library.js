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
  var ROLES = ['Loop bed', 'Underscore', 'Sting', 'Transition'];
  var LOOPS = [['yes', 'Loops well'], ['crossfade', 'Crossfade the loop'], ['no', 'Do not loop']];
  var SORTS = [['title', 'Title A to Z'], ['artist', 'Artist A to Z'], ['short', 'Shortest first'], ['long', 'Longest first'], ['new', 'Newest first'], ['old', 'Oldest first']];
  var st = { kind: 'all', newOnly: false, missing: false, shapes: [], tags: { mood: [], motif: [], scene: [] }, emin: 1, emax: 5, folder: '', q: '', sort: 'title', sel: [], cursor: null, anchor: null, guide: null };
  var cbx = { g: null, q: '', act: 0, open: false };
  var ts = null; // bulk tag sheet state
  var pendingFocus = null, mode = 'wide', scrolledFor = null;

  /* ---------- small helpers ---------- */
  function tagsOf(t) { return D.tagGroups.reduce(function (a, g) { return a.concat(t.tags[g.id] || []); }, []); }
  function untagged(t) { return tagsOf(t).length === 0; }
  function newish(t) { return t.isNew || untagged(t); }
  function settle(t) { if (t.isNew && t.title && !untagged(t)) t.isNew = false; }
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
      'new': function (a, b) { return addedAt(b) - addedAt(a) || byTitle(a, b); }, old: function (a, b) { return addedAt(a) - addedAt(b) || byTitle(a, b); }
    }[st.sort];
    return list.sort(f);
  }
  function nFilters() { return (st.kind !== 'all') + st.newOnly + st.missing + st.shapes.length + !!st.folder + (st.emin > 1 || st.emax < 5) + D.tagGroups.reduce(function (a, g) { return a + want(g.id).length; }, 0); }
  function filtersOn() { return st.kind !== 'all' || st.newOnly || st.missing || st.shapes.length || st.folder || st.emin > 1 || st.emax < 5 || D.tagGroups.some(function (g) { return want(g.id).length; }); }
  function clearFilters() { st.kind = 'all'; st.newOnly = false; st.missing = false; st.shapes = []; st.folder = ''; st.emin = 1; st.emax = 5; D.tagGroups.forEach(function (g) { st.tags[g.id] = []; }); }
  // Round 7 (DAT-10): groups come and go on the Tags screen; a group's filter list is made when first needed.
  function want(id) { return st.tags[id] || (st.tags[id] = []); }
  L.libTagFilters = function () { return st.tags; };
  // Kind marker in the list: text as well as colour.
  function kindMark(t) {
    var k = t.kind === 'fx' ? ['fx', 'FX', 'Sound effect'] : t.kind === 'amb' ? ['amb', 'Amb', 'Ambience'] : L.isFx(t) ? ['fx', 'FX · Sting', 'FX: a sting (short music cue)'] : null;
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
  function filterSummary() {
    var parts = [];
    if (st.kind !== 'all') parts.push(L.kindName[st.kind]);
    if (st.newOnly) parts.push('New, not tagged yet');
    if (st.missing) parts.push('Missing files');
    if (st.shapes.length) parts.push(st.shapes.map(function (x) { return L.shapeName[x]; }).join(', '));
    D.tagGroups.forEach(function (g) { if (want(g.id).length) parts.push(want(g.id).join(', ')); });
    if (st.emin > 1 || st.emax < 5) parts.push('energy ' + st.emin + ' to ' + st.emax);
    if (st.folder) parts.push(shortPath(st.folder));
    return parts.length ? esc(parts.join(' · ')) : '';
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
    h += '<div class="lb-fg" role="group" aria-labelledby="lb-fh-shape"><h3 class="lb-fh" id="lb-fh-shape">Shape</h3><div class="chips">' + L.SHAPES.map(function (x) {
      var n = base.filter(function (t) { return L.shapeOf(t) === x[0]; }).length, on = st.shapes.indexOf(x[0]) > -1;
      return '<button class="chip lb-fchip" data-act="lbfshape" data-v="' + x[0] + '" data-k="lb-fs-' + x[0] + '" aria-pressed="' + on + '">' + (on ? L.icon('check', 's') : L.shapeGlyph(x[0])) + x[1] + '<span class="lb-n num">' + n + '</span></button>';
    }).join('') + '</div></div>';
    D.tagGroups.forEach(function (g) {
      var vals = D.tagValues[g.id].map(function (v) { return [v, base.filter(function (t) { return L.trackHasTag(t, g.id, v); }).length]; })
        .filter(function (x) { return x[1] || want(g.id).indexOf(x[0]) > -1; });
      h += '<div class="lb-fg" role="group" aria-labelledby="lb-fh-' + g.id + '"><h3 class="lb-fh" id="lb-fh-' + g.id + '">' + esc(g.name) + '' + '</h3><div class="chips">' +
        (vals.length ? vals.map(function (x, i) {
          var on = want(g.id).indexOf(x[0]) > -1;
          return '<button class="chip lb-fchip" data-act="lbftag" data-g="' + g.id + '" data-v="' + esc(x[0]) + '" data-k="lb-ft-' + g.id + '-' + i + '" aria-pressed="' + on + '">' + (on ? L.icon('check', 's') : '') + esc(x[0]) + '<span class="lb-n num">' + x[1] + '</span></button>';
        }).join('') : '<span class="hint">No values used yet</span>') + '</div></div>';
    });
    var opts = function (sel) { var o = ''; for (var i = 1; i <= 5; i++) o += '<option' + (i === sel ? ' selected' : '') + '>' + i + '</option>'; return o; };
    h += '<div class="lb-fg"><h3 class="lb-fh">Energy</h3><div class="lb-erange"><label>From <select class="input lb-sel" data-input="lbemin" data-k="lb-emin" aria-label="Lowest energy">' + opts(st.emin) + '</select></label>' +
      '<label>to <select class="input lb-sel" data-input="lbemax" data-k="lb-emax" aria-label="Highest energy">' + opts(st.emax) + '</select></label></div></div>';
    D.tracks.forEach(function (t) { var root = t.folder.split('\\').slice(0, 3).join('\\'); if (!D.folders.some(function (f) { return inFolder(t, f); })) D.folders.push(root); });
    var cnt = function (f) { return base.filter(function (t) { return inFolder(t, f); }).length; };
    h += '<div class="lb-fg"><h3 class="lb-fh">Folders</h3><ul class="lb-folders">' + folderBtn('', 'All folders', base.length, 0);
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
    var watched = D.watched.indexOf(f) > -1;
    return '<li' + (sub ? ' class="sub"' : '') + '><button data-act="lbfolder" data-f="' + esc(f) + '" data-k="lb-fo-' + f.replace(/\W/g, '_') + '" aria-pressed="' + (st.folder === f) + '" title="' + esc(f || 'Every folder') + '">' +
      L.icon(watched ? 'eye' : 'folder', 's') + '<span class="ellipsis grow">' + esc(label) + '</span>' + (watched ? '<span class="hint">watched</span>' : '') + '<span class="num lb-n">' + n + '</span></button></li>';
  }

  /* ---------- Tracks pane ---------- */
  function tracksBody(list, openId) {
    var shownSel = list.filter(function (t) { return st.sel.indexOf(t.id) > -1; }).length;
    if (!st.cursor || !list.some(function (t) { return t.id === st.cursor; })) st.cursor = openId && list.some(function (t) { return t.id === openId; }) ? openId : (list[0] && list[0].id);
    var h = '<div class="lb-tools"><div class="search grow">' + L.icon('search') + '<input class="input" type="search" placeholder="Search titles, file names, artists, tags" aria-label="Search tracks" data-input="lbq" data-k="lb-q" value="' + esc(st.q) + '"></div>' +
      '<label class="lb-sortl"><span class="sr-only">Sort</span><select class="input lb-sel" data-input="lbsort" data-k="lb-sort" aria-label="Sort tracks">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label></div>';
    if (st.guide) h += '<div class="lb-guide" role="status">' + L.icon(st.guide.icon || 'check', 's') + '<span class="grow">' + st.guide.html + '</span>' +
      (st.guide.act ? '<button class="btn s" data-act="' + st.guide.act + '" data-k="lb-guide-act">' + esc(st.guide.actLabel) + '</button>' : '') +
      '<button class="closer" data-act="lbguideclose" data-k="lb-guide-x" title="Dismiss" aria-label="Dismiss this message">' + L.icon('close') + '</button></div>';
    if (st.sel.length) h += '<div class="lb-bulk" role="toolbar" aria-label="Selected tracks"><b class="lb-bn">' + st.sel.length + ' selected</b>' +
      (shownSel < st.sel.length ? '<span class="hint">(' + (st.sel.length - shownSel) + ' not shown)</span>' : '') +
      '<button class="btn s primary" data-act="lbbtag" data-k="lb-btag">' + L.icon('tag', 's') + 'Tag…</button>' +
      '<button class="btn s" data-act="lbbpl" data-k="lb-bpl">' + L.icon('playlist', 's') + 'Add to playlist…</button>' +
      '<button class="btn s" data-act="lbbnew" data-k="lb-bnew">' + L.icon('plus', 's') + 'New playlist from these</button>' +
      '<button class="btn s ghost" data-act="lbbclear" data-k="lb-bclear">Clear selection</button></div>';
    var allOn = list.length && shownSel === list.length;
    var sortT = st.sort === 'title' ? 'ascending' : null, sortD = st.sort === 'short' ? 'ascending' : st.sort === 'long' ? 'descending' : null;
    h += '<div class="lb-scroll" data-scroll="lb-list"><table class="grid lb-table" role="grid" aria-multiselectable="true" aria-label="Tracks" aria-describedby="lb-keys" aria-rowcount="' + (list.length + 1) + '"><thead><tr>' +
      '<th class="lb-c-ck"><label class="lb-ckl"><input type="checkbox" data-act="lbselall" data-k="lb-selall" aria-label="Select all ' + list.length + ' shown"' + (allOn ? ' checked' : '') + '></label></th>' +
      '<th class="lb-c-title"' + (sortT ? ' aria-sort="' + sortT + '"' : '') + '>Title</th><th class="lb-c-tags">Tag</th><th class="lb-c-en">Energy</th>' +
      '<th class="lb-c-dur"' + (sortD ? ' aria-sort="' + sortD + '"' : '') + '>Length</th><th class="lb-c-pv"><span class="sr-only">Preview, play on air, more</span></th></tr></thead><tbody>';
    if (!list.length) h += '<tr class="lb-emptyrow"><td colspan="6"><div class="empty">' + (st.q || filtersOn() ? 'No track matches. <button class="btn s" data-act="lbclearall" data-k="lb-clearall2">Clear search and filters</button>' : '<b>Your library is empty.</b> Add music, ambience and sound effects with <b>Add tracks</b>, or drop audio files or a folder here.') + '</div></td></tr>';
    list.forEach(function (t) {
      var sel = st.sel.indexOf(t.id) > -1, open = t.id === openId;
      var own = t.title, meta = t.metaTitle, shown = own || meta || t.file;
      var air = (onAirNow(t) ? L.destTag('air', '') : '') + (L.previewing(t.id) ? L.destTag('you', '') : '');
      var tip = (own ? '' : 'No title of your own yet. ') + (meta && meta !== own ? 'In the file: ' + meta + '. ' : '') + t.artist + (t.album ? ', ' + t.album : '');
      h += '<tr data-tid="' + t.id + '" data-act="lbopen" data-k="lbrow-' + t.id + '" tabindex="' + (t.id === st.cursor ? 0 : -1) + '" aria-selected="' + sel + '"' + (open ? ' class="lb-open" aria-current="true"' : '') + '>' +
        '<td class="lb-c-ck" data-act="lbsel" data-tid="' + t.id + '"><span class="lb-ckl"><input type="checkbox" tabindex="-1" aria-label="Select ' + esc(L.title(t)) + '"' + (sel ? ' checked' : '') + '></span></td>' +
        '<td class="lb-c-title" title="' + esc(shown + ' — ' + tip) + '"><div class="lb-tl" ' + dragAttrs(t) + '>' + kindMark(t) + '<span class="lb-t1' + (own ? '' : ' untitled') + '">' + esc(shown) + '</span>' +
          (own && meta && meta !== own && open ? '<span class="lb-t2">' + esc(meta) + '</span>' : '') + air + (t.isNew ? '<span class="badge lb-newb">New</span>' : '') +
          (t.missing ? '<span class="badge warn lb-miss" title="Lyre cannot find this file at ' + esc(t.folder) + '">' + L.icon('warn', 's') + 'Missing</span>' : '') + '</div></td>' +
        '<td class="lb-c-tags"><span class="lb-tagcell">' + L.shapeTag(t, true) + rowChips(t, 1) + '</span></td>' +
        '<td class="lb-c-en">' + (t.energy ? L.energy(t.energy) : '<span class="lb-none" aria-label="No energy yet">–</span>') + '</td>' +
        '<td class="lb-c-dur num">' + L.fmt(t.dur) + '</td>' +
        '<td class="lb-c-pv"><div class="lb-rowbtns">' + rowBtn(L.previewButton('track', t.id)) + rowBtn(L.playOnAirButton('track', t.id)) +
          '<button class="btn s icon ghost" tabindex="-1" data-act="lbrowmenu" data-tid="' + t.id + '" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More for ' + esc(L.title(t)) + '">' + L.icon('more', 's') + '</button></div></td></tr>';
    });
    h += '</tbody></table></div><div class="lb-foot hint keys-on-focus" id="lb-keys">Keys: <span class="kbd">↑</span> <span class="kbd">↓</span> move · <span class="kbd">Enter</span> open · <span class="kbd">Space</span> select · <span class="kbd">P</span> preview · <span class="kbd">A</span> play on air</div>';
    return h;
  }

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
      (L.namesOfTrack(t).length ? '<dt>Names in scenes</dt><dd><ul class="lb-scnames">' + L.namesOfTrack(t).map(function (x) { return '<li><b>' + esc(x.name) + '</b> <span class="hint">in ' + esc(x.label) + '</span></li>'; }).join('') + '</ul></dd>' : '') + '</dl>';
    h += '<div class="lb-acts"><button class="btn s lb-pvbtn" data-act="lbprev" data-tid="' + t.id + '" data-k="lb-dprev" aria-pressed="' + !!prev + '">' + L.icon(prev ? 'stop' : 'headphones', 's') + (prev ? 'Stop preview' : 'Preview') + '</button>' +
      '<button class="btn s" data-act="lbonair" data-k="lb-onair">' + L.icon('broadcast', 's') + 'Play on air</button>' + (L.profileLink ? L.profileLink(t.id) : '')  +
      '<button class="btn s" data-act="lbusein" data-k="lb-usein">' + L.icon('link', 's') + 'Use in…</button></div>' +
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
      '<div class="lb-tg"><div class="lb-tgl">Role</div>' + choiceChips('lbrole', (t.kind === 'fx' ? ['Effect'].concat(ROLES) : ROLES).map(function (r) { return [r, r]; }), t.role, 'Role') + '</div>' +
      // Round 7 (PLY-4, SHW-3): a sting never loops; the ending, resume and follow-with rows (r7play.js).
      L.loopRow(t, '<div class="lb-tg"><div class="lb-tgl">Looping</div>' + choiceChips('lbloop', LOOPS, t.loop, 'Loop advice') + '</div>') +
      '<div class="lb-tg"><label class="lb-tgl" for="lb-notes">Notes</label><textarea id="lb-notes" class="input" rows="2" data-input="lbnotes" data-k="lb-notes" data-save="' + esc(L.title(t)) + ' notes" placeholder="Cues, where it fades, what it reminds you of">' + esc(t.notes) + '</textarea></div>' +
      // The rarer choices that follow from the role (ending, pick up, follow with) come last.
      L.playRows(t) + '</section>';
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
    var t = L.track(L.current().p.tid); if (!t) return;
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
    return esc(parts.join(' · ')) + '.' + (n ? ' <span class="muted">Has its own settings in ' + plural(n, 'place') + '.</span>' : '');
  }
  function emptyDetails() {
    var nNew = D.tracks.filter(newish).length;
    return '<div class="lb-d lb-dempty"><p>Open a track to see its names, file and tags.</p>' +
      (nNew ? '<p><button class="btn s" data-act="lbshownew" data-k="lb-shownew">' + L.icon('tag', 's') + 'Show the ' + plural(nNew, 'track') + ' not tagged yet</button></p>' : '') + '</div>';
  }

  /* ---------- the view ---------- */
  L.view('library', {
    nav: 'library',
    title: function () { return 'Library'; },
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
        '<h1>Library</h1><span class="muted lb-count">' + plural(nAll, 'track') + '</span><span class="grow"></span>' +
        '<button class="btn primary" data-act="lbaddmenu" data-k="lb-add" aria-haspopup="menu" aria-expanded="false">' + L.icon('plus', 's') + 'Add tracks' + L.icon('chevdown', 's') + '</button>' +
        '<button class="btn icon" data-act="lbmore" data-k="lb-more" aria-haspopup="menu" aria-expanded="false" title="Back up, move and find files" aria-label="More for the library">' + L.icon('more') + '</button></div>';

      function fPane(strip) {
        return L.pane({ id: 'lb-filters', title: 'Filters', icon: 'rule', cls: 'lb-filters' + (strip ? ' lb-strip' : ''), collapsed: mode !== 'wide', kind: 'search', summary: filterSummary(), scroll: 'lb-filters', status: nFilters() ? { text: nFilters() + (nFilters() > 1 ? ' filters on' : ' filter on'), tone: 'on' } : null,
          actions: filtersOn() ? '<button class="btn s ghost" data-act="lbclearall" data-k="lb-clearall">Clear all</button>' : '', body: filtersBody() });
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
  L.acts.lbfshape = function (el) { var v = el.dataset.v, i = st.shapes.indexOf(v); if (i > -1) st.shapes.splice(i, 1); else st.shapes.push(v); L.render(); L.say(visible().length + ' tracks shown'); };
  L.acts.lbnew = function () { st.newOnly = !st.newOnly; L.render(); L.say(st.newOnly ? 'Showing new tracks not tagged yet' : 'Showing all tracks'); };
  L.acts.lbftag = function (el) { var a = want(el.dataset.g), v = el.dataset.v, i = a.indexOf(v); if (i > -1) a.splice(i, 1); else a.push(v); L.render(); L.say(visible().length + ' tracks shown'); };
  L.acts.lbfolder = function (el) { st.folder = el.dataset.f; L.render(); };
  L.inputs.lbemin = function (el) { st.emin = +el.value; if (st.emax < st.emin) st.emax = st.emin; L.render(); };
  L.inputs.lbemax = function (el) { st.emax = +el.value; if (st.emin > st.emax) st.emin = st.emax; L.render(); };
  L.acts.lbclearall = function () { clearFilters(); st.q = ''; L.render(); L.say('Filters cleared'); };
  L.acts.lbshownew = function () { clearFilters(); st.newOnly = true; st.q = ''; if (mode === 'narrow') L.route('#/library'); L.render(); };
  L.inputs.lbq = function (el) { st.q = el.value; L.render(); };
  L.inputs.lbsort = function (el) { st.sort = el.value; L.render(); };
  L.acts.lbguideclose = function () { st.guide = null; L.render(); var q = document.querySelector('[data-k="lb-q"]'); if (q) q.focus(); };

  /* ---------- rows: open, select, preview, keys ---------- */
  function openTrack(id, keepRow) {
    st.cursor = id;
    pendingFocus = mode === 'narrow' ? 'lb-back' : keepRow ? 'lbrow-' + id : null;
    L.route('#/library/' + id);
  }
  L.acts.lbopen = function (el) { openTrack(el.dataset.tid, true); };
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
      (L.profileLink ? '<button role="menuitem" data-act="lbrmprof" data-tid="' + id + '">' + L.icon('fade', 's') + 'Audio profile</button>' : ''), 'More for ' + L.title(t));
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
    return false;
  }

  /* ---------- details actions ---------- */
  function cur() { var p = L.current().p; return p.tid ? L.track(p.tid) : null; }
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
      '<button role="menuitem" data-act="lbgo" data-href="#/tags">' + L.icon('tag', 's') + 'Tags and groups…</button>', 'More for the library');
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
      arrive(ids.map(L.track).filter(Boolean), 'by dropping' + (fresh < ids.length ? ' (' + (ids.length - fresh) + ' already in your Library)' : ''), true);
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
