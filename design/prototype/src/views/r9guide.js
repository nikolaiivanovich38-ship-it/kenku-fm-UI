/* Round 9 (ROUND9.md §4, §9): the setup checklist and screen tours, and floating panels.

   §4 Set up Lyre (item 19: "Need a much better tutorial, covering much more of the functionality, and giving a guided
     setup for all elements of the app")
     Help opens with Set up Lyre: nine tasks in the order a new table needs them, each ticked by itself when the library
     has what it needs, each with Show me (Lyre goes to the screen and a short guided walk points at the real controls,
     one at a time: Back, Next, Skip, Esc). Below it, Tour of this screen for the screen Help was opened from, and that
     screen's own article first. Help's button shows the progress ("4 of 9") until every task is done or Nik hides the
     checklist. Steps whose control is not on screen are left out.
   §9 Floating panels (item 33: "I need to be able to drag the add music to scene dialoge around and resize it so I can
     see what's behind it."): L.sheet({ float: true }) (core.js) opens a panel that does not block the page. It opens
     docked to the right half of the work area; its title bar drags it; its corner and edges resize it; Dock left,
     Dock right and Float in the title bar do the same with one click; with the title bar focused, the arrow keys move it
     and Shift+arrows resize it. Its place and size are kept on this computer. */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- §9 floating panels ---------- */
  var GEO_KEY = 'lyre-r9-float';
  function geo() { try { return JSON.parse(localStorage.getItem(GEO_KEY) || 'null'); } catch (e) { return null; } }
  function saveGeo(g) { try { localStorage.setItem(GEO_KEY, JSON.stringify(g)); } catch (e) { /* storage unavailable */ } }
  // The work area under the screen's top strip (so the window's own buttons are never covered) and above the Now playing bar.
  function area() { var v = document.getElementById('view').getBoundingClientRect(), head = document.querySelector('#view .viewhead, #view .lv-top'), bar = document.querySelector('#view .onairbar'); return { left: v.left, top: head ? head.getBoundingClientRect().bottom : v.top, right: v.right, bottom: bar ? bar.getBoundingClientRect().top : v.bottom }; }
  function docked(side) { var a = area(), w = Math.max(360, Math.round((a.right - a.left) * 0.45)); return { dock: side, left: side === 'left' ? a.left + 8 : a.right - w - 8, top: a.top + 8, width: w, height: a.bottom - a.top - 16 }; }
  function apply(p, g) {
    var vw = window.innerWidth, vh = window.innerHeight;
    g.width = Math.max(320, Math.min(g.width, vw - 16)); g.height = Math.max(240, Math.min(g.height, vh - 16));
    g.left = Math.max(8, Math.min(g.left, vw - g.width - 8)); g.top = Math.max(8, Math.min(g.top, vh - g.height - 8));
    p.style.left = g.left + 'px'; p.style.top = g.top + 'px'; p.style.width = g.width + 'px'; p.style.height = g.height + 'px';
    p.dataset.dock = g.dock || 'float';
    p.querySelectorAll('[data-act="r9dock"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === (g.dock || 'float'))); });
  }
  L.floatTools = function () {
    return '<span class="r9-fl-tools" role="group" aria-label="Place">' +
      '<button class="btn s icon" data-act="r9dock" data-v="left" title="Dock it on the left" aria-label="Dock left">' + L.icon('chevleft', 's') + '</button>' +
      '<button class="btn s icon" data-act="r9dock" data-v="float" title="Let it float (drag its title to move it, its corner to size it)" aria-label="Float">' + L.icon('expand', 's') + '</button>' +
      '<button class="btn s icon" data-act="r9dock" data-v="right" title="Dock it on the right" aria-label="Dock right">' + L.icon('chevright', 's') + '</button>' +
      '<button class="btn s icon r9-fl-move" data-r9-move="1" title="Move with the arrow keys; Shift and the arrows change its size" aria-label="Move or size with the arrow keys">' + L.icon('drag', 's') + '</button></span>';
  };
  L.floatPlace = function (p) {
    var g = geo();
    apply(p, g && g.dock === 'float' ? g : docked(g && g.dock === 'left' ? 'left' : 'right'));
    var grip = document.createElement('span'); grip.className = 'r9-fl-grip'; grip.setAttribute('aria-hidden', 'true'); p.appendChild(grip);
  };
  L.acts.r9dock = function (el) {
    var p = el.closest('.panel'), v = el.dataset.v, cur = { left: p.offsetLeft, top: p.offsetTop, width: p.offsetWidth, height: p.offsetHeight };
    var g = v === 'float' ? { dock: 'float', left: cur.left - 40, top: cur.top + 40, width: Math.min(cur.width, 720), height: Math.min(cur.height, 560) } : docked(v);
    apply(p, g); saveGeo(g); L.say(v === 'float' ? 'Floating: drag its title to move it' : 'Docked on the ' + v);
  };
  function cur(p) { return { dock: 'float', left: p.offsetLeft, top: p.offsetTop, width: p.offsetWidth, height: p.offsetHeight }; }
  // Move by dragging the title bar; resize by the corner grip.
  document.addEventListener('pointerdown', function (e) {
    var head = e.target.closest && e.target.closest('.r9-float .r9-fl-head'), grip = e.target.closest && e.target.closest('.r9-fl-grip');
    if (!head && !grip) return; if (head && e.target.closest('button, input, a')) return;
    var p = (head || grip).closest('.panel'), g0 = cur(p), x0 = e.clientX, y0 = e.clientY; e.preventDefault();
    p.classList.add('r9-moving');
    function move(ev) { var dx = ev.clientX - x0, dy = ev.clientY - y0, g = Object.assign({}, g0); if (head) { g.left += dx; g.top += dy; } else { g.width += dx; g.height += dy; } apply(p, g); }
    function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); p.classList.remove('r9-moving'); saveGeo(cur(p)); }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('[data-r9-move]'); if (!b || !/^Arrow/.test(e.key)) { if (b && e.key === 'Home') { e.preventDefault(); var pp = b.closest('.panel'), dg = docked('right'); apply(pp, dg); saveGeo(dg); } return; }
    e.preventDefault(); var p = b.closest('.panel'), g = cur(p), d = 20, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    if (e.shiftKey) { g.width += dx; g.height += dy; } else { g.left += dx; g.top += dy; }
    apply(p, g); saveGeo(cur(p));
  });

  /* ---------- §4 the guide ---------- */
  var ranLive = false, start0 = L.startScene;
  L.startScene = function () { ranLive = true; return start0.apply(this, arguments); };
  function tagged(t) { return D.tagGroups.some(function (g) { return (t.tags[g.id] || []).length; }); }
  var TASKS = [
    { id: 'bot', title: 'Connect a Discord bot', done: function () { return D.discord.bots.some(function (b) { return !b.login || b.login === 'online'; }); }, tour: 'settings' },
    { id: 'room', title: 'Put it in a room', done: function () { return D.discord.bots.some(function (b) { return b.status === 'connected'; }); }, tour: 'rooms' },
    { id: 'music', title: 'Add your music', done: function () { return D.tracks.length > 0; }, tour: 'library' },
    { id: 'tags', title: 'Tag a few tracks', done: function () { return D.tracks.filter(tagged).length >= 3; }, tour: 'details' },
    { id: 'playlist', title: 'Make a playlist', done: function () { return D.playlists.length > 0; }, tour: 'playlists' },
    { id: 'plan', title: 'Plan a session and its scenes', done: function () { return D.campaigns.some(function (c) { return c.sessions.some(function (s) { return s.scenes.length > 1; }); }); }, tour: 'session' },
    { id: 'pads', title: 'Build a pad board', done: function () { return D.boards.some(function (b) { return L.boardPads(b).filter(Boolean).length; }); }, tour: 'board' },
    { id: 'live', title: 'Run a scene in Live', done: function () { return ranLive; }, tour: 'live' },
    { id: 'look', title: 'Choose a look (optional)', done: function () { return !!L.state.theme; }, tour: 'look' }
  ];
  var hidden = false;
  try { hidden = localStorage.getItem('lyre-r9-setup') === 'hidden'; } catch (e) { /* storage unavailable */ }
  L.setupProgress = function () { var n = TASKS.filter(function (t) { return t.done(); }).length; return { n: n, of: TASKS.length, hidden: hidden }; };
  function firstCampaignSession() { var c = L.campaign(L.state.live.cid) || D.campaigns[0], s = L.nextSession(c); return { c: c, s: s }; }
  var TOURS = {
    settings: { route: '#/settings', name: 'Settings › Discord bots', steps: [
      ['[data-pane="st-bots"] .pane-actions .btn, [data-act="stadd"]', 'Add a bot', 'Each bot is one voice in Discord. Add a bot walks you through making one in Discord and pasting its token.'],
      ['.st-bot', 'Your bot', 'Connected means Lyre can use it. Replace… takes a new token; ⋯ renames or removes it.'],
      ['.r9-botstart select', 'Joins when Lyre starts', 'Choose a voice channel and the bot goes there by itself whenever Lyre starts.']] },
    rooms: { route: '#/live', name: 'Rooms in Live', steps: [
      ['[data-k="lv-addroom"]', 'Add a room', 'A room is a Discord voice channel Lyre plays into. Pick a channel here; Lyre uses a free bot.'],
      ['.r9-roombtn', 'Move a room', 'The room’s name moves it to another channel, copies what another room plays, or makes it leave.'],
      ['.lv-mute, .lv-vol', 'Mute and volume', 'Each room has its own volume and mute.']] },
    library: { route: '#/library', name: 'Library', steps: [
      ['[data-k="lb-add"]', 'Add tracks', 'Add files, a folder, or watch a folder so new files come in by themselves. You can also drop files on the page.'],
      ['[data-k="lb-q"]', 'Search', 'Any word of a title, file name, artist or tag.'],
      ['.lb-filters .pane-body', 'Filters', 'Click a filter once to show only those tracks, twice to hide them. The order button sorts the filters.'],
      ['[data-k="lb-cols"]', 'Columns', 'Choose what the list shows. Click a column’s name to sort by it; again for the other way.']] },
    details: { route: '#/library', open: function () { var t = D.tracks.filter(function (x) { return !tagged(x); })[0] || D.tracks[0]; return '#/library/' + t.id; }, name: 'A track’s details', steps: [
      ['#lb-title', 'Your title', 'A name you will recognise at the table. The file keeps its own.'],
      ['#lb-h-tags', 'Tags', 'Mood, leitmotif and scene type. Tags make dynamic playlists and help Find.'],
      ['.r9-use', 'Use it for', 'Background, scene music, a short cue or a lead-in.'],
      ['.r9-end', 'At its end', 'What happens when it ends: loop, the next track, fade out, stop, or play something else.']] },
    playlists: { route: '#/playlists', name: 'Playlists', steps: [
      ['[data-k="plnew"]', 'New playlist', 'By hand (manual), or from tags (dynamic: it fills itself).'],
      ['[data-k="pl-sort"]', 'Sort', 'Your order, by name, by size or by use.'],
      ['.r9-plgrip', 'Your order', 'Drag a playlist by its grip, or use Move up and Move down in its ⋯ menu.']] },
    session: { route: '', open: function () { var x = firstCampaignSession(); return '#/session/' + x.c.id + '/' + x.s.id; }, name: 'Planning a session', steps: [
      ['[data-act="cpaddscene"], .pane-actions [data-act^="cpadd"]', 'Add a scene', 'Each scene has its music, ambience, pad boards and notes.'],
      ['.cp-scene-toggle', 'Open a scene', 'Click its name to open it; drag the grip to change the order.'],
      ['[data-pane$="ssp"], [aria-label="Session playlists"]', 'This session’s playlists', 'They are on hand in every scene tonight. Drag a track from any open playlist onto a scene’s music.']] },
    board: { route: '#/boards', open: function () { return '#/board/' + D.boards[0].id; }, name: 'A pad board', steps: [
      ['.pb-grid, [aria-label^="Pads"]', 'Pads', 'Each pad plays a sound: click it to choose it, then set it up on the right.'],
      ['.pb-modes', 'Play mode', 'Once, a loop you toggle, while held, or restart on each press.'],
      ['.r9-paddip', 'While it plays', 'Whether the music dips while this pad sounds.']] },
    live: { route: '#/live', name: 'Live', steps: [
      ['[data-act="lvnext"], .lv-start, [data-k="lv-next"]', 'Next scene', 'Space starts the next scene.'],
      ['[data-pane="lv-onair"] header', 'On air', 'What each room hears, with Up next.'],
      ['[data-k="lv-arrange"]', 'Arrange', 'Move and size the boxes; Lyre keeps your layout for this window size.'],
      ['[data-k="lv-keys"]', 'Keys', 'Every key for Live. Turn single keys off here if they get in your way.']] },
    look: { route: '#/look', name: 'Look and feel', steps: [['#view h1', 'Look and feel', 'Choose a theme, text size and how much moves on screen. A campaign can have its own theme.']] }
  };
  var G = null, guideEl = null;
  function box() { if (!guideEl) { guideEl = document.createElement('div'); guideEl.id = 'r9-guide'; document.body.appendChild(guideEl); guideEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endGuide(); } }); } return guideEl; }
  function find(sel) { return sel.split(',').map(function (x) { return document.querySelector(x.trim()); }).filter(function (n) { return n && n.offsetParent; })[0]; }
  function paint() {
    var el = box(); if (!G) { el.innerHTML = ''; return; }
    var steps = G.steps.filter(function (s) { return find(s[0]); }); if (!steps.length) { endGuide(); L.toast('Nothing to point at on this screen yet'); return; }
    if (G.i >= steps.length) G.i = steps.length - 1;
    var s = steps[G.i], t = find(s[0]), r = t.getBoundingClientRect(), last = G.i === steps.length - 1;
    t.scrollIntoView({ block: 'nearest' }); r = t.getBoundingClientRect();
    el.innerHTML = '<div class="tour-ring" aria-hidden="true" style="left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) + 'px"></div>' +
      '<div class="tour r9-tourpop" role="dialog" aria-modal="false" aria-labelledby="r9g-title r9g-count" aria-describedby="r9g-text"><p class="tour-count" id="r9g-count">' + esc(G.name) + ' · ' + (G.i + 1) + ' of ' + steps.length + '</p><h2 class="tour-title" id="r9g-title">' + esc(s[1]) + '</h2><p id="r9g-text">' + esc(s[2]) + '</p>' +
      '<div class="tour-btns"><button class="btn ghost s" data-act="r9gskip" data-k="r9g-skip">Skip</button><span class="grow"></span>' + (G.i ? '<button class="btn s" data-act="r9gback" data-k="r9g-back">Back</button>' : '') +
      '<button class="btn primary s" data-act="r9gnext" data-k="r9g-next">' + (last ? 'Done' : 'Next') + '</button></div></div>';
    // Beside the control: right, left, below or above, whichever has room.
    var pop = el.querySelector('.r9-tourpop'), w = pop.offsetWidth, h = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, left, top;
    if (r.right + 14 + w < vw) { left = r.right + 14; top = r.top + r.height / 2 - h / 2; }
    else if (r.left - 14 - w > 0) { left = r.left - 14 - w; top = r.top + r.height / 2 - h / 2; }
    else if (r.bottom + 14 + h < vh) { left = r.left; top = r.bottom + 14; }
    else { left = r.left; top = r.top - 14 - h; }
    pop.style.left = Math.max(8, Math.min(left, vw - w - 8)) + 'px'; pop.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
    var f = el.querySelector('[data-k="r9g-next"]'); if (f) f.focus();
  }
  function endGuide() { var back = G && G.back; G = null; paint(); L.render(); var b = back && document.querySelector('[data-k="' + back + '"]'); if (b) b.focus(); else { var h = document.querySelector('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } } }
  L.startGuide = function (key, back) {
    var t = TOURS[key]; if (!t) return;
    if (L.helpOpen && L.helpOpen()) L.acts.helpclose();
    var to = t.open ? t.open() : t.route; if (to && L.current().name !== to.replace(/^#\//, '').split('/')[0]) L.route(to); else if (to && t.open) L.route(to);
    G = { steps: t.steps, name: t.name, i: 0, back: back };
    setTimeout(paint, 60);
  };
  L.acts.r9gnext = function () { var steps = G.steps.filter(function (s) { return find(s[0]); }); if (G.i >= steps.length - 1) { endGuide(); return; } G.i++; paint(); };
  L.acts.r9gback = function () { if (G.i) { G.i--; paint(); } };
  L.acts.r9gskip = function () { endGuide(); };
  L.acts.r9showme = function (el) { L.startGuide(el.dataset.tour, 'rail-help'); };
  L.acts.r9setuphide = function () { hidden = !hidden; try { localStorage.setItem('lyre-r9-setup', hidden ? 'hidden' : ''); } catch (e) { /* storage unavailable */ } L.render(); var b = document.querySelector('[data-k="r9-setup-hide"]'); if (b) b.focus(); };
  window.addEventListener('resize', function () { if (G) paint(); });

  // The screen each route belongs to, for Tour of this screen and its article.
  var SCREEN = { library: ['library', 'add-music'], playlists: ['playlists', 'dynamic-playlist'], playlist: ['playlists', 'dynamic-playlist'], session: ['session', 'plan-campaign'], campaign: ['session', 'plan-campaign'], campaigns: ['session', 'plan-campaign'],
    boards: ['board', 'pad-boards'], board: ['board', 'pad-boards'], live: ['live', 'live'], settings: ['settings', 'rooms-and-bots'], profile: ['details', 'audio-profile'], look: ['look', ''] };
  L.helpTopHTML = function () {
    var p = L.setupProgress(), sc = SCREEN[L.current().name], h = '';
    if (sc && TOURS[sc[0]]) h += '<div class="r9-help-screen"><h3 class="help-group">On this screen</h3><div class="r9-help-row"><button class="btn s" data-act="r9showme" data-tour="' + sc[0] + '" data-k="r9-screen-tour">' + L.icon('play', 's') + 'Tour of this screen</button>' +
      (sc[1] ? '<button class="help-item r9-help-art" data-act="helpopen" data-id="' + sc[1] + '" data-k="help-a-' + sc[1] + '-top">' + esc(TOURS[sc[0]].name) + ': how it works</button>' : '') + '</div></div>';
    h += '<section class="r9-setup" aria-labelledby="r9-setup-h"><div class="r9-setup-head"><h3 class="help-group" id="r9-setup-h">Set up Lyre</h3><span class="num faint">' + p.n + ' of ' + p.of + '</span><span class="grow"></span>' +
      '<button class="btn s ghost" data-act="r9setuphide" data-k="r9-setup-hide" aria-expanded="' + !hidden + '">' + (hidden ? 'Show' : 'Hide') + '</button></div>' +
      (hidden ? '' : '<div class="r9-setup-bar" role="progressbar" aria-label="Set up Lyre" aria-valuemin="0" aria-valuemax="' + p.of + '" aria-valuenow="' + p.n + '"><span style="width:' + Math.round(p.n / p.of * 100) + '%"></span></div><ol class="r9-setup-list">' + TASKS.map(function (t, i) {
        var d = t.done();
        return '<li class="' + (d ? 'done' : '') + '"><span class="r9-setup-mark" aria-hidden="true">' + (d ? L.icon('check', 's') : (i + 1)) + '</span><span class="grow">' + esc(t.title) + '<span class="sr-only">' + (d ? ', done' : ', to do') + '</span></span>' +
          '<button class="btn s ' + (d ? 'ghost' : '') + '" data-act="r9showme" data-tour="' + t.tour + '" data-k="r9-show-' + t.id + '" aria-label="' + (d ? 'Show me again' : 'Show me') + ': ' + esc(t.title) + '">' + (d ? 'Show me again' : 'Show me') + '</button></li>';
      }).join('') + '</ol>') + '</section>';
    return h;
  };
  // Help's button in the menu shows the progress until every task is done or the checklist is hidden.
  var render0 = L.render;
  L.render = function () {
    render0.apply(L, arguments);
    var b = document.querySelector('#rail [data-k="rail-help"]'), p = L.setupProgress(); if (!b) return;
    var old = b.querySelector('.r9-help-ring'); if (old) old.remove();
    if (!p.hidden && p.n < p.of) b.insertAdjacentHTML('beforeend', '<span class="r9-help-ring" aria-hidden="true" title="Set up Lyre: ' + p.n + ' of ' + p.of + ' done">' + p.n + '/' + p.of + '</span>');
  };
})();
