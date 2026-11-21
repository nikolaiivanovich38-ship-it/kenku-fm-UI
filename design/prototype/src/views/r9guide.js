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
  // Round 10 (R10-FIX §3): docked, the panel is a side panel beside the screen (r10fix.css), which narrows; its width
  // is kept (null: the usual width, 36 % of the window between 360 and 560 px).
  function docked(side, width) { var g = geo(); return { dock: side, width: width || (g && g.dock !== 'float' && g.width) || null }; }
  function workEl() { return document.getElementById('work'); }
  function dockIn(p, g) {
    var s = p.closest('.sheet'), w = workEl(); if (!s || !w) return;
    s.classList.add('r10-docked'); s.classList.toggle('r10-dock-left', g.dock === 'left'); s.classList.toggle('r10-dock-right', g.dock !== 'left');
    var max = Math.max(320, w.getBoundingClientRect().width - 600);
    if (g.width) { g.width = Math.max(320, Math.min(g.width, max)); s.style.setProperty('--r10-dock-w', g.width + 'px'); } else s.style.removeProperty('--r10-dock-w');
    p.removeAttribute('style'); p.dataset.dock = g.dock;
    if (s.parentElement !== w) { var a = document.activeElement, had = s.contains(a); w.appendChild(s); L.render(); if (had && document.contains(a)) a.focus(); }
  }
  function apply(p, g) {
    p.querySelectorAll('[data-act="r9dock"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === (g.dock || 'float'))); });
    if (g.dock === 'left' || g.dock === 'right') { dockIn(p, g); return; }
    var s = p.closest('.sheet');
    if (s && s.classList.contains('r10-docked')) { var a0 = document.activeElement, had0 = s.contains(a0); s.classList.remove('r10-docked', 'r10-dock-left', 'r10-dock-right'); s.style.removeProperty('--r10-dock-w'); document.body.appendChild(s); L.render(); if (had0 && document.contains(a0)) a0.focus(); }
    var vw = window.innerWidth, vh = window.innerHeight;
    g.width = Math.max(320, Math.min(g.width, vw - 16)); g.height = Math.max(240, Math.min(g.height, vh - 16));
    g.left = Math.max(8, Math.min(g.left, vw - g.width - 8)); g.top = Math.max(8, Math.min(g.top, vh - g.height - 8));
    p.style.left = g.left + 'px'; p.style.top = g.top + 'px'; p.style.width = g.width + 'px'; p.style.height = g.height + 'px';
    p.dataset.dock = g.dock || 'float';
    p.querySelectorAll('[data-act="r9dock"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === (g.dock || 'float'))); });
  }
  // Round 10 (look D7, prep D12): one Dock menu with words in place of three unlabelled glyphs.
  L.floatTools = function () {
    return '<span class="r9-fl-tools" role="group" aria-label="Panel position">' +
      '<button class="btn s" data-act="r10dockmenu" data-k="r10-dock" aria-haspopup="menu" aria-expanded="false" title="Dock this panel left or right, or let it float. Drag its title bar to move it, or its corner to resize it.">Dock' + L.icon('chevdown', 's') + '</button>' +
      '<button class="btn s icon r9-fl-move" data-r9-move="1" title="Move the panel with the arrow keys. Hold Shift and use the arrows to resize it." aria-label="Move or resize with the arrow keys">' + L.icon('drag', 's') + '</button></span>';
  };
  L.floatPlace = function (p) {
    var g = geo();
    apply(p, g && g.dock === 'float' ? g : docked(g && g.dock === 'left' ? 'left' : 'right'));
    var grip = document.createElement('span'); grip.className = 'r9-fl-grip'; grip.setAttribute('aria-hidden', 'true'); p.appendChild(grip);
  };
  L.acts.r10dockmenu = function (el) {
    var p = el.closest('.panel'), cur = p.dataset.dock || 'float';
    L.menu(el, [['left', 'Dock left'], ['right', 'Dock right'], ['float', 'Float']].map(function (x) {
      return '<button role="menuitemradio" aria-checked="' + (cur === x[0]) + '" data-act="r9dock" data-v="' + x[0] + '">' + (cur === x[0] ? L.icon('check', 's') : '<span style="width:14px"></span>') + x[1] + '</button>'; }).join(''), 'Dock');
  };
  L.acts.r9dock = function (el) {
    var p = el.closest('.panel') || document.querySelector('#lyre-sheet .panel'), v = el.dataset.v, cur = cur0(p);
    var g = v === 'float' ? { dock: 'float', left: cur.left - 40, top: cur.top + 40, width: Math.min(cur.width, 720), height: Math.min(cur.height, 560) } : docked(v, p.closest('.r10-docked') ? cur.width : null);
    apply(p, g); saveGeo(g); L.say(v === 'float' ? 'The panel floats. Drag its title bar to move it.' : 'Docked on the ' + v); var d = p.querySelector('[data-k="r10-dock"]'); if (d) d.focus();
  };
  function cur(p) { var r = p.getBoundingClientRect(); return { dock: 'float', left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; }
  function cur0(p) { return cur(p); }
  // Move by dragging the title bar; resize by the corner grip.
  document.addEventListener('pointerdown', function (e) {
    var head = e.target.closest && e.target.closest('.r9-float .r9-fl-head'), grip = e.target.closest && e.target.closest('.r9-fl-grip');
    if (!head && !grip) return; if (head && e.target.closest('button, input, a')) return;
    var p = (head || grip).closest('.panel'), g0 = cur(p), x0 = e.clientX, y0 = e.clientY; e.preventDefault();
    // Round 10: docked, the edge changes its width only and the panel stays docked; dragging its title lets it float.
    var side = p.closest('.r10-docked') ? p.dataset.dock : '';
    p.classList.add('r9-moving');
    function move(ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0, g = Object.assign({}, g0);
      if (side && grip) { apply(p, { dock: side, width: g0.width + (side === 'left' ? dx : -dx) }); return; }
      if (head) { g.left += dx; g.top += dy; } else { g.width += dx; g.height += dy; } apply(p, g);
    }
    // 0.6.0 review M7 (as the app's PanelDialog): a cancelled pointer ends the drag too, and so does the panel closing.
    function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); p.classList.remove('r9-moving'); if (!document.contains(p)) return; var c = cur(p); if (side && grip) { c.dock = side; } saveGeo(c); }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  });
  // 0.6.0 review M8 (as the app's PanelDialog): a floating panel moves back inside the window when the window gets smaller.
  window.addEventListener('resize', function () {
    var p = document.querySelector('.r9-float > .panel[data-dock="float"]'); if (p && p.style.left) apply(p, cur(p));
  });
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('[data-r9-move]'); if (!b || !/^Arrow/.test(e.key)) { if (b && e.key === 'Home') { e.preventDefault(); var pp = b.closest('.panel'), dg = docked('right'); apply(pp, dg); saveGeo(dg); } return; }
    e.preventDefault(); var p = b.closest('.panel'), g = cur(p), d = 20, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    // Round 10: docked, Shift and the arrows change its width and it stays docked; the arrows alone let it float.
    var side = p.closest('.r10-docked') ? p.dataset.dock : '';
    if (side && e.shiftKey) { var dg = { dock: side, width: g.width + (side === 'left' ? dx : -dx) }; apply(p, dg); saveGeo(dg); b.focus(); return; }
    if (e.shiftKey) { g.width += dx; g.height += dy; } else { g.left += dx; g.top += dy; }
    apply(p, g); saveGeo(cur(p)); b.focus();
  });

  /* ---------- §4 the guide ---------- */
  var ranLive = false, start0 = L.startScene;
  L.startScene = function () { ranLive = true; return start0.apply(this, arguments); };
  function tagged(t) { return D.tagGroups.some(function (g) { return (t.tags[g.id] || []).length; }); }
  var TASKS = [
    { id: 'bot', title: 'Connect a Discord bot', done: function () { return D.discord.bots.some(function (b) { return !b.login || b.login === 'online'; }); }, tour: 'settings' },
    { id: 'room', title: 'Put the bot in a room', done: function () { return D.discord.bots.some(function (b) { return b.status === 'connected'; }); }, tour: 'rooms' },
    { id: 'music', title: 'Add your music', done: function () { return D.tracks.length > 0; }, tour: 'library' },
    { id: 'tags', title: 'Tag a few tracks', done: function () { return D.tracks.filter(tagged).length >= 3; }, tour: 'details' },
    { id: 'playlist', title: 'Make a playlist', done: function () { return D.playlists.length > 0; }, tour: 'playlists' },
    { id: 'plan', title: 'Plan a session and its scenes', done: function () { return D.campaigns.some(function (c) { return c.sessions.some(function (s) { return s.scenes.length > 1; }); }); }, tour: 'session' },
    { id: 'pads', title: 'Build a pad board', done: function () { return D.boards.some(function (b) { return L.boardPads(b).filter(Boolean).length; }); }, tour: 'board' },
    { id: 'live', title: 'Run a scene in Live', done: function () { return ranLive; }, tour: 'live' },
    { id: 'look', title: 'Choose a theme (optional)', done: function () { return !!L.state.theme; }, tour: 'look' }
  ];
  var hidden = false;
  try { hidden = localStorage.getItem('lyre-r9-setup') === 'hidden'; } catch (e) { /* storage unavailable */ }
  L.setupProgress = function () { var n = TASKS.filter(function (t) { return t.done(); }).length; return { n: n, of: TASKS.length, hidden: hidden }; };
  function firstCampaignSession() { var c = L.campaign(L.state.live.cid) || D.campaigns[0], s = L.nextSession(c); return { c: c, s: s }; }
  var TOURS = {
    settings: { route: '#/settings', name: 'Settings › Discord bots', steps: [
      ['[data-pane="st-bots"] .pane-actions .btn, [data-act="stadd"]', 'Add a bot', 'Lyre needs one bot for each voice channel it plays into. Press Add a bot to see the steps for making one in Discord and pasting its token.'],
      ['.st-bot', 'Your bot', 'Connected means Lyre can use it. Press Replace… to paste a new token. Rename and Remove are in the ⋯ menu.'],
      ['.r9-botstart input', 'Starting volume', 'The volume a bot starts at when it joins a room. Bots join a room only when you add them to it, in Live.'],
      ['[data-k="st-rooms"]', 'Rooms', 'The Rooms screen shows which bot is in which voice channel.']] },
    rooms: { route: '#/live', name: 'Rooms in Live', steps: [
      ['[data-k="lv-addroom"]', 'Add a room', 'A room is a Discord voice channel that Lyre plays into. Pick a channel here, and Lyre uses a bot that is not in a room yet.'],
      ['.r9-roombtn', 'Move a room', 'Press the room’s name to move it to another channel or make it leave. From the same menu you can copy what another room plays.'],
      ['.lv-mute, .lv-vol', 'Mute and volume', 'Each room has its own volume and mute.']] },
    library: { route: '#/library', name: 'Track library', steps: [
      ['[data-k="lb-add"]', 'Add tracks', 'Add files or a folder. With Watch a folder…, new files in that folder are added by themselves. You can also drop files on the page.'],
      ['[data-k="lb-q"]', 'Search', 'Type any word from a title, file name, artist or tag.'],
      ['.lb-filters .pane-body', 'Filters', 'Click a filter once to show only those tracks. Click it again to hide them. To sort the filters, use Order the filters.'],
      ['[data-k="lb-cols"]', 'Columns', 'Choose which columns the list shows. Click a column’s name to sort by it, and click it again to reverse the order.']] },
    details: { route: '#/library', open: function () { var t = D.tracks.filter(function (x) { return !tagged(x); })[0] || D.tracks[0]; return '#/library/' + t.id; }, name: 'A track’s details', steps: [
      ['#lb-title', 'Your title', 'Type a name you will recognise at the table. The title in the file does not change.'],
      ['#lb-h-tags', 'Tags', 'Tag the track by mood, leitmotif and scene type. Dynamic playlists are built from tags, and you can search by them.'],
      ['.r9-use', 'Use it for', 'Choose what the track is for: background, scene music, a short cue or a lead-in.'],
      ['.r9-end', 'At its end', 'Choose what happens when the track ends: it can loop, move to the next track, fade out, stop, or play something else.']] },
    playlists: { route: '#/playlists', name: 'Playlists', steps: [
      ['[data-k="plnew"]', 'New playlist', 'Pick the tracks yourself for a manual playlist. A dynamic playlist is filled with the tracks whose tags match its rules.'],
      ['[data-k="pl-sort"]', 'Sort', 'Sort the playlists in your order, by name, by size or by use.'],
      ['.r9-plgrip', 'Your order', 'Drag a playlist by its grip, or use Move up and Move down in its ⋯ menu.']] },
    session: { route: '', open: function () { var x = firstCampaignSession(); return '#/session/' + x.c.id + '/' + x.s.id; }, name: 'Planning a session', steps: [
      ['[data-act="cpaddscene"], .pane-actions [data-act^="cpadd"]', 'Add a scene', 'Each scene has its music, ambience, pad boards and notes.'],
      ['.cp-scene-toggle', 'Open a scene', 'Click a scene’s name to open it. Drag its grip to change the order of the scenes.'],
      ['[data-pane$="ssp"], [aria-label="Session playlists"]', 'This session’s playlists', 'You can play them from any scene in this session. Drag a track from an open playlist onto a scene’s music.']] },
    board: { route: '#/boards', open: function () { return '#/board/' + D.boards[0].id; }, name: 'A pad board', steps: [
      ['.pb-grid, [aria-label^="Pads"]', 'Pads', 'Each pad plays a sound. Click a pad to select it, then choose its sound and play mode on the right.'],
      ['.pb-modes', 'Play mode', 'Choose One-shot, Toggle loop, Hold to play or Restart on press.'],
      ['.r9-paddip', 'While it plays', 'Choose whether the music gets quieter while this pad plays.']] },
    // Round 10 (table review D-S7): the Live tour covers what matters at the table: what the players hear against
    // what only you hear, pads and their keys, Undo, Fade all and Stop all. Arrange and Keys are in the article.
    live: { route: '#/live', name: 'Live', steps: [
      ['[data-act="lvnext"], .lv-start, [data-k="lv-nextsc"]', 'Next scene', 'Press Space to start the next scene. If you press it twice within a second, the second press is ignored.'],
      ['[data-pane="lv-onair"] header, [data-k="pane-lv-onair"]', 'On air: what the players hear', 'This box shows each room, what it plays now and what comes next. The red light is on while the players hear something.'],
      ['.lv-trk-acts [data-act="lvpv"], [data-act="lvpv"]', 'Preview: only you', 'To hear a track in your headphones only, use the headphones button. Play on air, the last button on a row, is for the players.'],
      ['.lv-cur-pads .lv-pad, .lv-pad', 'Pads and their keys', 'Click a pad or press its key to play it. Press Stop pads, beside them, to stop all pads.'],
      ['.r10-undo-slot', 'Undo', 'Undo shows here for 8 seconds after you change what the players hear. You can also press Ctrl+Z.'],
      ['[data-k="lv-fade"]', 'Fade all and Stop all', 'Everything fades out with Fade all (Shift+Esc), or stops at once with Stop all, your preview too. You can undo both.']] },
    look: { route: '#/look', name: 'Look and feel', steps: [['#view h1', 'Look and feel', 'Choose a theme here. You can also change the text size and how much moves on screen. A campaign can have a theme of its own.']] }
  };
  var G = null, guideEl = null;
  function box() { if (!guideEl) { guideEl = document.createElement('div'); guideEl.id = 'r9-guide'; document.body.appendChild(guideEl); guideEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endGuide(); } }); } return guideEl; }
  // Round 10: the first match on screen (a selector's first match may be in a folded box).
  function find(sel) { var out = null; sel.split(',').some(function (x) { out = [].slice.call(document.querySelectorAll(x.trim())).filter(function (n) { return n.offsetParent && n.getBoundingClientRect().height > 0; })[0] || null; return !!out; }); return out; }
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
  var shownDone = false;
  L.acts.r9setuphide = function () { var p0 = L.setupProgress(); if (p0.n === p0.of && !hidden) { shownDone = !shownDone; L.render(); var b0 = document.querySelector('[data-k="r9-setup-hide"]'); if (b0) b0.focus(); return; } hidden = !hidden; try { localStorage.setItem('lyre-r9-setup', hidden ? 'hidden' : ''); } catch (e) { /* storage unavailable */ } L.render(); var b = document.querySelector('[data-k="r9-setup-hide"]'); if (b) b.focus(); };
  window.addEventListener('resize', function () { if (G) paint(); });

  // The screen each route belongs to, for Tour of this screen and its article.
  var SCREEN = { library: ['library', 'add-music'], playlists: ['playlists', 'dynamic-playlist'], playlist: ['playlists', 'dynamic-playlist'], session: ['session', 'plan-campaign'], campaign: ['session', 'plan-campaign'], campaigns: ['session', 'plan-campaign'],
    boards: ['board', 'pad-boards'], board: ['board', 'pad-boards'], live: ['live', 'live'], settings: ['settings', 'rooms-and-bots'], profile: ['details', 'audio-profile'], look: ['look', ''] };
  L.helpTopHTML = function () {
    var p = L.setupProgress(), sc = SCREEN[L.current().name], h = '';
    if (sc && TOURS[sc[0]]) h += '<div class="r9-help-screen"><h3 class="help-group">On this screen</h3><div class="r9-help-row"><button class="btn s" data-act="r9showme" data-tour="' + sc[0] + '" data-k="r9-screen-tour">' + L.icon('play', 's') + 'Tour of this screen</button>' +
      (sc[1] ? '<button class="help-item r9-help-art" data-act="helpopen" data-id="' + sc[1] + '" data-k="help-a-' + sc[1] + '-top">How this screen works</button>' : '') + '</div></div>';
    // Round 10 (table review D-S6): once all nine are done, Set up Lyre is one line until Nik asks to see it.
    var folded = hidden || (p.n === p.of && !shownDone);
    h += '<section class="r9-setup" aria-labelledby="r9-setup-h"><div class="r9-setup-head"><h3 class="help-group" id="r9-setup-h">Set up Lyre</h3><span class="num faint">' + (p.n === p.of ? 'all done' : p.n + ' of ' + p.of) + '</span><span class="grow"></span>' +
      '<button class="btn s ghost" data-act="r9setuphide" data-k="r9-setup-hide" aria-expanded="' + !folded + '">' + (folded ? 'Show' : 'Hide') + '</button></div>' +
      (folded ? '' : '<div class="r9-setup-bar" role="progressbar" aria-label="Set up Lyre" aria-valuemin="0" aria-valuemax="' + p.of + '" aria-valuenow="' + p.n + '"><span style="width:' + Math.round(p.n / p.of * 100) + '%"></span></div><ol class="r9-setup-list">' + TASKS.map(function (t, i) {
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
    var running = L.current().name === 'live' && !!(L.pb.music || L.pb.amb);
    // Round 10: the progress is drawn by CSS (data-count; round 10 fixes: data-progress was the playing bars' attribute), so the button's name and text stay "Help"; a quiet
    // outline chip, not the accent fill (look D12).
    if (!p.hidden && p.n < p.of && !running) b.insertAdjacentHTML('beforeend', '<span class="r9-help-ring" aria-hidden="true" title="Set up Lyre: ' + p.n + ' of ' + p.of + ' done" data-count="' + p.n + '/' + p.of + '"></span>');
  };
})();
