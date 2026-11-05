/* Round 5: the library as a file, what came across from Kenku FM, and finding missing files (prefix tf-).
   #/backup   Back up, move or share (DAT-7): save the whole library, or one campaign, session, scene, playlist, pad
              board or the tags, to one file, with or without the audio files; open a file from another PC or another
              GM, see what is in it, and choose for each duplicate: skip, merge or keep both. A file that is not a Lyre
              file, or is damaged, is refused with a plain message and nothing changes.
   #/moved    What came across from Kenku FM: what Lyre copied on its first start, the files it cannot find, and what
              it could not bring across.
   #/relink   Find missing files (DAT-8): point Lyre at the folder the files moved to; it matches them by file name and
              size and shows a table to confirm before relinking, with Undo.
   Everything is simulated: no file is read or written. */
(function () {
  var esc = L.esc, D = L.data;
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function crumbs() { return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/library" data-k="tf-crumb">Library</a><span class="sep" aria-hidden="true">›</span></nav>'; }
  function missing() { return D.tracks.filter(function (t) { return t.missing; }); }
  // Called after L.render(), which paints at once, so the control is there to focus.
  function focusSoon(k) { var el = document.querySelector('[data-k="' + k + '"]'); if (el) el.focus(); }

  /* ======================================================================
     DAT-7 Back up, move or share
     ====================================================================== */
  var ex = { what: 'all', pick: { campaign: 'crown', session: 'crown/s14', scene: 'crown/s14/sc3', playlist: 'p-abbess', board: 'abbey' }, audio: false, saved: null };
  var im = null;   // { file, state: 'preview'|'done'|'refused', reason, choices: { id: 'skip'|'merge'|'both' } }
  var WHAT = [
    ['all', 'The whole library', 'Tracks with their names, tags and shapes; playlists; pad boards; campaigns, sessions and scenes; audio settings'],
    ['campaign', 'One campaign', 'Its sessions and scenes, and the playlists, boards and tracks they use'],
    ['session', 'One session', 'Its scenes and cue list, and what they use'],
    ['scene', 'One scene', 'Its music, ambience and pad boards'],
    ['playlist', 'One playlist', 'Its tracks, in order (a dynamic one: its rules and the tracks they match now)'],
    ['board', 'One pad board', 'Its pads, keys and sounds'],
    ['tags', 'The tags only', 'Your tag groups and their values, to tag the same way on another PC']];
  function options(kind) {
    var out = [];
    if (kind === 'campaign') D.campaigns.forEach(function (c) { out.push([c.id, c.name]); });
    if (kind === 'session') D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { out.push([c.id + '/' + s.id, c.name + ' › Session ' + s.n + (s.name ? ': ' + s.name : '')]); }); });
    if (kind === 'scene') D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc) { out.push([c.id + '/' + s.id + '/' + sc.id, 'Session ' + s.n + ' › ' + sc.name]); }); }); });
    if (kind === 'playlist') D.playlists.forEach(function (p) { out.push([p.id, p.name]); });
    if (kind === 'board') D.boards.forEach(function (b) { out.push([b.id, b.name]); });
    return out;
  }
  function exportName() {
    var o = options(ex.what).filter(function (x) { return x[0] === ex.pick[ex.what]; })[0];
    return ex.what === 'all' ? 'Lyre library 2026-11-05.lyre' : ex.what === 'tags' ? 'Lyre tags 2026-11-05.lyre' : (o ? o[1].split(' › ').pop().replace(/[:\\/]/g, '') : 'Lyre') + '.lyre';
  }
  // A rough size: the audio files are what make a file big.
  function audioSize() { var n = ex.what === 'all' ? D.tracks.length : ex.what === 'tags' ? 0 : ex.what === 'board' ? 12 : ex.what === 'playlist' ? 5 : ex.what === 'scene' ? 9 : 30; return n; }
  function exportPane() {
    var n = audioSize();
    var body = '<fieldset class="tf-what"><legend>What to save</legend>' + WHAT.map(function (w) {
      var on = ex.what === w[0], sel = '';
      if (on && w[0] !== 'all' && w[0] !== 'tags') sel = '<select class="input tf-pick" data-input="tfpick" data-k="tf-pick" aria-label="Which ' + w[1].replace('One ', '') + '">' + options(w[0]).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === ex.pick[w[0]] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      return '<div class="tf-opt' + (on ? ' on' : '') + '"><label><input type="radio" name="tf-what" value="' + w[0] + '" data-input="tfwhat" data-k="tf-w-' + w[0] + '"' + (on ? ' checked' : '') + '><span><b>' + w[1] + '</b><span class="hint tf-sub">' + w[2] + '</span></span></label>' + sel + '</div>';
    }).join('') + '</fieldset>' +
      '<label class="tf-check"><input type="checkbox" data-input="tfaudio" data-k="tf-audio"' + (ex.audio ? ' checked' : '') + (ex.what === 'tags' ? ' disabled' : '') + '><span><b>Include the audio files</b><span class="hint tf-sub">' +
        (ex.what === 'tags' ? 'Tags have no audio files.' : ex.audio ? 'About ' + (n * 9) + ' MB: ' + plural(n, 'audio file') + ' go into the file, so it works on a PC that has none of them.' : 'Without them the file stays small. The other PC needs the same files; Lyre finds them there with Find missing files.') + '</span></span></label>' +
      '<div class="tf-actrow"><button class="btn primary" data-act="tfsave" data-k="tf-save">' + L.icon('download', 's') + 'Save to a file…</button><span class="hint">Saves ' + esc(exportName()) + '</span></div>' +
      (ex.saved ? '<p class="tf-done" role="status">' + L.icon('check', 's') + '<span class="grow">Saved <b>' + esc(ex.saved.name) + '</b> (' + esc(ex.saved.size) + ') in Documents\\Lyre.</span><button class="btn s" data-act="tfshow" data-k="tf-show">' + L.icon('folder', 's') + 'Show in folder</button></p>' : '');
    return L.pane({ id: 'tf-export', title: 'Save to a file', icon: 'download', kind: 'plain', noMax: true, size: 'auto',
      status: ex.saved ? { text: 'Saved', tone: 'idle' } : { text: 'Ready', tone: 'idle' }, body: body });
  }
  L.inputs.tfwhat = function (el) { ex.what = el.value; ex.saved = null; L.render(); focusSoon('tf-w-' + ex.what); };
  L.inputs.tfpick = function (el) { ex.pick[ex.what] = el.value; ex.saved = null; L.render(); };
  L.inputs.tfaudio = function (el) { ex.audio = el.checked; ex.saved = null; L.render(); };
  L.acts.tfsave = function () { var n = audioSize(); ex.saved = { name: exportName(), size: ex.audio && n ? (n * 9) + ' MB' : ex.what === 'all' ? '2 MB' : '40 KB' }; L.render(); L.say('Saved ' + ex.saved.name); focusSoon('tf-show'); };
  L.acts.tfshow = function () { L.toast('Lyre would open Documents\\Lyre in File Explorer'); };

  // A shared file from another GM: what it holds, and which items you already have.
  var SAMPLE = { file: 'Curse of Strahd from Sam.lyre', audio: false, made: 'Lyre 0.4, 2 Nov 2026', items: [
    { id: 'c', kind: 'Campaign', name: 'Curse of Strahd', sub: '2 sessions, 9 scenes' },
    { id: 'p1', kind: 'Playlist', name: 'Barovia mist', sub: '6 tracks' },
    { id: 'p2', kind: 'Playlist', name: 'Gothic dread', sub: 'Dynamic · yours has the same name', dup: true },
    { id: 'p3', kind: 'Playlist', name: 'Castle corridors', sub: '4 tracks · yours has the same name and 4 tracks', dup: true },
    { id: 'b1', kind: 'Pad board', name: 'Ravenloft', sub: '9 pads' },
    { id: 't', kind: 'Tracks', name: '38 tracks', sub: '8 are already in your library (same file name and length)', dup: true },
    { id: 'g', kind: 'Tags', name: '3 new tag values', sub: 'Mood: Gothic · Leitmotif: Strahd, Ireena' }] };
  var CHOICES = [['skip', 'Skip', 'Keep yours as it is'], ['merge', 'Merge', 'Add what is new in theirs to yours'], ['both', 'Keep both', 'Add theirs as a copy, "(from Sam)"']];
  function readFile(name) {
    if (!/\.lyre$/i.test(name)) return { file: name, state: 'refused', reason: '"' + name + '" is not a Lyre file. Lyre opens files saved with Save to a file (they end in .lyre).' };
    if (/broken|damaged/i.test(name)) return { file: name, state: 'refused', reason: '"' + name + '" is damaged: it stops part-way, so Lyre cannot tell what is in it. Nothing was brought in. Ask for the file again.' };
    var choices = {}; SAMPLE.items.forEach(function (x) { if (x.dup) choices[x.id] = 'skip'; });
    return { file: name, state: 'preview', choices: choices };
  }
  function importPane() {
    var body;
    if (!im || im.state === 'refused') {
      body = '<div class="tf-drop" data-tfdrop="1"><p>' + L.icon('upload', 's') + '<span>Drop a Lyre file here, or</span></p>' +
        '<button class="btn" data-act="tfchoose" data-k="tf-choose">' + L.icon('file', 's') + 'Choose a file…</button></div>' +
        (im ? '<p class="tf-refused" role="alert">' + L.icon('warn', 's') + '<span>' + esc(im.reason) + '</span></p>' : '') +
        '<p class="hint">Open a file you saved on another PC, or one another GM shared with you. You see what is in it before anything changes.</p>';
    } else if (im.state === 'preview') {
      body = '<p class="tf-file">' + L.icon('file', 's') + '<b>' + esc(im.file) + '</b><span class="hint">Made with ' + esc(SAMPLE.made) + ' · audio files not included</span></p>' +
        '<ul class="list tf-items" aria-label="What is in the file">' + SAMPLE.items.map(function (x) {
          return '<li class="tf-item' + (x.dup ? ' dup' : '') + '"><span class="tf-kind">' + esc(x.kind) + '</span><span class="tf-iname grow"><b class="ellipsis">' + esc(x.name) + '</b><span class="hint ellipsis">' + esc(x.sub) + '</span></span>' +
            (x.dup ? '<span class="seg s" role="radiogroup" aria-label="' + esc(x.kind + ' ' + x.name) + ': you have this already">' + CHOICES.map(function (c) {
              var on = im.choices[x.id] === c[0];
              return '<button type="button" role="radio" aria-checked="' + on + '" data-act="tfchoice" data-id="' + x.id + '" data-v="' + c[0] + '" data-k="tf-c-' + x.id + '-' + c[0] + '" title="' + esc(c[2]) + '">' + c[1] + '</button>';
            }).join('') + '</span>' : '<span class="badge">New</span>') + '</li>';
        }).join('') + '</ul>' +
        '<div class="tf-actrow"><span class="hint">For every item you have already:</span>' + CHOICES.map(function (c) { return '<button class="btn s" data-act="tfall" data-v="' + c[0] + '" data-k="tf-all-' + c[0] + '" aria-label="' + c[1] + ' for every item you have already">' + c[1] + '</button>'; }).join('') + '</div>' +
        '<p class="hint">The 38 tracks come without their audio files: Lyre lists them under Find missing files until you point it at a folder that has them.</p>' +
        '<div class="tf-actrow"><button class="btn primary" data-act="tfbring" data-k="tf-bring">' + L.icon('upload', 's') + 'Bring in</button><button class="btn" data-act="tfcancel" data-k="tf-cancel">Cancel</button></div>';
    } else {
      body = '<p class="tf-done" role="status">' + L.icon('check', 's') + '<span class="grow">' + esc(im.summary) + '</span></p>' +
        '<div class="tf-actrow"><a class="btn s" href="#/relink" data-k="tf-torelink">' + L.icon('folder', 's') + 'Find missing files…</a><button class="btn s ghost" data-act="tfcancel" data-k="tf-again">Open another file</button></div>';
    }
    return L.pane({ id: 'tf-import', title: 'Open a file', icon: 'upload', kind: 'plain', noMax: true, size: 'auto',
      status: !im ? { text: 'Ready', tone: 'idle' } : im.state === 'refused' ? { text: 'Refused', tone: 'warn' } : im.state === 'preview' ? { text: 'Not brought in yet', tone: 'on' } : { text: 'Brought in', tone: 'idle' }, body: body });
  }
  L.acts.tfchoose = function () { im = readFile(SAMPLE.file); L.render(); L.say('Opened ' + im.file + ': ' + SAMPLE.items.length + ' kinds of thing in it. Choose what to do with the ones you have already.'); focusSoon('tf-bring'); };
  L.acts.tfchoice = function (el) { im.choices[el.dataset.id] = el.dataset.v; L.render(); focusSoon(el.dataset.k); };
  L.acts.tfall = function (el) { Object.keys(im.choices).forEach(function (k) { im.choices[k] = el.dataset.v; }); L.render(); L.say(el.getAttribute('aria-label')); };
  L.acts.tfcancel = function () { im = null; L.render(); focusSoon('tf-choose'); };
  L.acts.tfbring = function () {
    var c = im.choices, skipped = Object.keys(c).filter(function (k) { return c[k] === 'skip'; }).length, both = Object.keys(c).filter(function (k) { return c[k] === 'both'; }).length;
    im.state = 'done';
    im.summary = 'Brought in Curse of Strahd, 4 playlists, a pad board, 3 tag values and ' + (c.t === 'skip' ? '30 new tracks (8 you had already were skipped)' : c.t === 'both' ? '38 tracks (8 as copies)' : '38 tracks (8 merged with yours)') + '.' +
      (skipped ? ' ' + plural(skipped, 'duplicate') + ' skipped.' : '') + (both ? ' ' + plural(both, 'copy', 'copies') + ' named "(from Sam)".' : '') + ' The audio files were not in the file.';
    L.render(); L.say(im.summary); focusSoon('tf-torelink');
  };
  // Dropping a file on the Open a file box (the prototype reads only the file's name).
  function isTf() { return L.current().name === 'backup'; }
  document.addEventListener('dragover', function (e) { if (!isTf()) return; var z = e.target.closest && e.target.closest('[data-tfdrop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('[data-tfdrop]'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    if (!isTf()) return; var z = e.target.closest && e.target.closest('[data-tfdrop]'); if (!z) return; e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    im = readFile(f.name); L.render(); L.say(im.state === 'refused' ? im.reason : 'Opened ' + f.name); focusSoon(im.state === 'refused' ? 'tf-choose' : 'tf-bring');
  });

  L.view('backup', {
    nav: 'library',
    title: function () { return 'Back up, move or share'; },
    notesTitle: 'Back up, move or share (new, DAT-7)',
    notes: [
      '<b>Save to a file</b>: the whole library, or one campaign, session, scene, playlist, pad board, or only your tags. Tick <b>Include the audio files</b> to take the music too; without it the file is small and the other PC finds the same files by name.',
      '<b>Open a file</b>: choose or drop a .lyre file. You see what is in it before anything changes; for each thing you have already choose <b>Skip</b>, <b>Merge</b> or <b>Keep both</b> (or the same for all), then <b>Bring in</b>.',
      'A file that is not a Lyre file, or is damaged, is refused in plain words and nothing changes. Try dropping notes.txt or broken.lyre on the box.'
    ],
    render: function () {
      return '<div class="viewhead">' + crumbs() + '<h1>Back up, move or share</h1></div>' +
        '<div class="viewbody tf-body"><div class="tf-cols"><div class="col">' + exportPane() + '</div><div class="col">' + importPane() + '</div></div></div>';
    }
  });

  /* ======================================================================
     What came across from Kenku FM
     ====================================================================== */
  L.view('moved', {
    nav: 'library',
    title: function () { return 'What came across from Kenku FM'; },
    notesTitle: 'The move report (new)',
    notes: [
      'What Lyre copied from Kenku FM on its first start, in Lyre\'s words: playlists, tracks, soundboards (now pad boards), sounds (now pads) and bookmarks (website tabs). Kenku FM\'s own copy is untouched.',
      '<b>Files Lyre cannot find</b> lists the tracks whose files are not where Kenku FM kept them, with <b>Find them…</b>.',
      '<b>Not brought across</b> says plainly what Lyre does not take over, and why that is fine.'
    ],
    render: function () {
      var m = D.moved, miss = missing();
      var rows = [['Playlists', m.playlists, 'Playlists (Manual)', '#/playlists'], ['Tracks', m.tracks, 'Library', '#/library'], ['Soundboards', m.boards, 'Pad boards', '#/boards'], ['Sounds', m.pads, 'Pads on those boards', '#/boards'], ['Bookmarks', m.bookmarks, 'Website tabs', '']];
      var what = '<p class="tf-lead">On ' + esc(m.when) + ' Lyre copied your ' + esc(m.from) + ' library. Kenku FM\'s own copy is untouched, so you can still open it.</p>' +
        '<table class="grid tf-table"><caption class="sr-only">What came across</caption><thead><tr><th scope="col">In Kenku FM</th><th scope="col" class="num">How many</th><th scope="col">Now in Lyre</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td>' + (r[3] ? '<a href="' + r[3] + '" data-k="tf-mv-' + r[0] + '">' + r[2] + '</a>' : r[2]) + '</td></tr>'; }).join('') + '</tbody></table>';
      var missBody = miss.length ? '<ul class="list tf-miss" aria-label="Files Lyre cannot find">' + miss.map(function (t) {
        return '<li class="lrow"><span class="grow tf-iname"><b class="ellipsis">' + esc(L.title(t)) + '</b><span class="hint ellipsis" title="' + esc(t.folder + '\\' + t.file) + '">' + esc(t.file) + ' · was in ' + esc(t.folder) + '</span></span></li>';
      }).join('') + '</ul><div class="tf-actrow"><a class="btn primary" href="#/relink" data-k="tf-findthem">' + L.icon('folder', 's') + 'Find them…</a></div>' : '<p class="tf-done">' + L.icon('check', 's') + 'Every file is where Lyre expects it.</p>';
      var notBody = '<ul class="list tf-not">' + m.notMoved.map(function (x) { return '<li class="lrow"><span class="grow tf-iname"><b>' + esc(x[0]) + '</b><span class="hint">' + esc(x[1]) + '</span></span></li>'; }).join('') + '</ul>';
      return '<div class="viewhead">' + crumbs() + '<h1>What came across from Kenku FM</h1></div>' +
        '<div class="viewbody tf-body"><div class="tf-cols"><div class="col">' +
        L.pane({ id: 'tf-what', title: 'What came across', icon: 'check', kind: 'plain', noMax: true, size: 'auto', status: { text: 'Copied', tone: 'idle' }, body: what }) + '</div><div class="col">' +
        L.pane({ id: 'tf-miss', title: 'Files Lyre cannot find', icon: 'warn', kind: 'plain', noMax: true, size: 'auto', status: miss.length ? { text: plural(miss.length, 'file'), tone: 'warn' } : { text: 'None', tone: 'idle' }, body: missBody }) +
        L.pane({ id: 'tf-not', title: 'Not brought across', icon: 'close', kind: 'plain', noMax: true, size: 'auto', status: { text: String(m.notMoved.length), tone: 'idle' }, body: notBody }) + '</div></div></div>';
    }
  });

  /* ======================================================================
     DAT-8 Find missing files
     ====================================================================== */
  // Where each missing sample file turns up in the folder the GM points at: same name and size, same name only, or not there.
  var rl = { folder: 'E:\\Music\\Scores', plan: null, ticked: {}, done: null };
  function plan(folder) {
    var SAMPLE_HOW = { t19: 'size', t26: 'name' };
    return missing().map(function (t) {
      var how = SAMPLE_HOW[t.id] || 'none';
      return { t: t, how: how, at: how === 'none' ? '' : folder + '\\' + t.artist + '\\' + t.album };
    });
  }
  var HOW = { size: ['Same name and size', 'idle'], name: ['Same name, different size: check it', 'warn'], none: ['Not in that folder', 'idle'] };
  L.view('relink', {
    nav: 'library',
    title: function () { return 'Find missing files'; },
    notesTitle: 'Find missing files (new, DAT-8)',
    notes: [
      'Missing files show a <b>Missing</b> badge in the Library and have their own filter. Here they are all together.',
      'Point Lyre at the folder they moved to (type it, choose it, or drop the folder). Lyre looks through it and its folders for the same file name and size, and shows a table to confirm before anything changes.',
      'A file found by name only (a different size) is not ticked: listen to it first. <b>Relink</b> has an Undo.'
    ],
    render: function () {
      var miss = missing(), p = rl.plan;
      var list = miss.length ? '<table class="grid tf-table"><caption class="sr-only">Missing files</caption><thead><tr><th scope="col">Track</th><th scope="col">File name</th><th scope="col">Was in</th></tr></thead><tbody>' +
        miss.map(function (t) { return '<tr><td class="tf-cell" title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</td><td class="tf-cell">' + esc(t.file) + '</td><td class="tf-cell" title="' + esc(t.folder) + '">' + esc(t.folder) + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<p class="tf-done" role="status">' + L.icon('check', 's') + 'Every file is where Lyre expects it.</p>';
      var look = '<div class="tf-lookrow"><div class="field grow"><label for="tf-folder">Look in this folder (and the folders inside it)</label><input class="input" id="tf-folder" data-input="tffolder" data-k="tf-folder" value="' + esc(rl.folder) + '" autocomplete="off"></div>' +
        '<button class="btn" data-act="tfpickfolder" data-k="tf-pickfolder">' + L.icon('folder', 's') + 'Choose…</button><button class="btn' + (p ? '' : ' primary') + '" data-act="tflook" data-k="tf-look"' + (miss.length ? '' : ' disabled') + '>' + L.icon('search', 's') + 'Look there</button></div>' +
        '<p class="hint">Lyre matches on the file name and its size, so a file with the same name from another album is not mixed up.</p>';
      var found = '';
      if (p) {
        var n = p.filter(function (x) { return rl.ticked[x.t.id]; }).length;
        found = '<table class="grid tf-table tf-confirm"><caption class="sr-only">What Lyre found in ' + esc(rl.folder) + '</caption><thead><tr><th scope="col"><span class="sr-only">Relink</span></th><th scope="col">Track</th><th scope="col">Found at</th><th scope="col">How sure</th></tr></thead><tbody>' +
          p.map(function (x) {
            var h = HOW[x.how];
            return '<tr><td>' + (x.how === 'none' ? '' : '<input type="checkbox" data-input="tftick" data-id="' + x.t.id + '" data-k="tf-tick-' + x.t.id + '" aria-label="Relink ' + esc(L.title(x.t)) + '"' + (rl.ticked[x.t.id] ? ' checked' : '') + '>') + '</td>' +
              '<td class="tf-cell" title="' + esc(x.t.file) + '">' + esc(L.title(x.t)) + '</td><td class="tf-cell" title="' + esc(x.at) + '">' + (x.at ? esc(x.at) : '<span class="faint">–</span>') + '</td>' +
              '<td><span class="tf-how ' + h[1] + '">' + (h[1] === 'warn' ? L.icon('warn', 's') : '') + esc(h[0]) + '</span>' + (x.how === 'name' ? ' ' + L.previewButton('track', x.t.id) : '') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="tf-actrow"><button class="btn primary" data-act="tfrelink" data-k="tf-relink"' + (n ? '' : ' disabled') + '>' + L.icon('link', 's') + 'Relink ' + plural(n, 'file') + '</button><span class="hint">' + plural(p.filter(function (x) { return x.how === 'none'; }).length, 'file') + ' not found there: try another folder after.</span></div>';
      }
      return '<div class="viewhead">' + crumbs() + '<h1>Find missing files</h1></div>' +
        '<div class="viewbody tf-body"><div class="tf-cols tf-one"><div class="col">' +
        (rl.done ? '<p class="tf-done" role="status">' + L.icon('check', 's') + '<span class="grow">' + esc(rl.done) + '</span></p>' : '') +
        L.pane({ id: 'tf-missing', title: 'Missing files', icon: 'warn', kind: 'plain', noMax: true, size: 'auto', status: miss.length ? { text: plural(miss.length, 'file'), tone: 'warn' } : { text: 'None', tone: 'idle' }, body: list }) +
        (miss.length || p ? L.pane({ id: 'tf-look', title: 'Look in a folder', icon: 'folder', kind: 'search', noMax: true, size: 'auto', status: p ? { text: p.filter(function (x) { return x.how !== 'none'; }).length + ' found', tone: 'on' } : { text: 'Ready', tone: 'idle' }, body: look + found }) : '') +
        '</div></div></div>';
    }
  });
  L.inputs.tffolder = function (el) { rl.folder = el.value; };
  L.acts.tfpickfolder = function () { rl.folder = 'E:\\Music\\Scores'; rl.plan = null; L.render(); L.say('Folder chosen: ' + rl.folder); focusSoon('tf-look'); };
  L.acts.tflook = function () {
    rl.plan = plan(rl.folder.trim() || 'E:\\Music\\Scores'); rl.ticked = {}; rl.done = null;
    rl.plan.forEach(function (x) { if (x.how === 'size') rl.ticked[x.t.id] = true; });
    var f = rl.plan.filter(function (x) { return x.how !== 'none'; }).length;
    L.render(); L.say('Found ' + f + ' of ' + rl.plan.length + ' in ' + rl.folder + '. Check the table, then Relink.'); focusSoon('tf-relink');
  };
  L.inputs.tftick = function (el) { if (el.checked) rl.ticked[el.dataset.id] = true; else delete rl.ticked[el.dataset.id]; L.render(); };
  L.acts.tfrelink = function () {
    var restore = L.snapshot(['tracks']), ids = Object.keys(rl.ticked), byId = {};
    rl.plan.forEach(function (x) { byId[x.t.id] = x; });
    ids.forEach(function (id) { var t = L.track(id); t.folder = byId[id].at; t.missing = false; });
    rl.done = 'Relinked ' + plural(ids.length, 'file') + ' to ' + rl.folder + '.';
    L.undoNote(rl.done, function () { restore(); rl.done = null; rl.plan = null; });
    rl.plan = null; rl.ticked = {}; L.render(); L.say(rl.done);
  };
  // Dropping a folder on the page looks there (the prototype only knows its name).
  document.addEventListener('dragover', function (e) { if (L.current().name === 'relink' && e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') > -1) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (L.current().name !== 'relink') return; e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    rl.folder = 'E:\\' + f.name; L.acts.tflook();
  });
})();
