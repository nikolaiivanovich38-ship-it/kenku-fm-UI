/* Lyre design round 2: shared core for the clickable prototype.
   No real audio: a 250 ms clock advances simulated lanes so progress, fades and pads are visible.

   API for views (views/<name>.js):
     L.view(name, { nav, title(p), render(p) -> html, after(root, p)?, notes: [..] })  register a view
     L.route(hash)                     go to '#/library', '#/session/crown/s14' ... (routes listed in ROUTES)
     L.acts.<name> = function (el, ev) click handler for any element with data-act="<name>"
     L.inputs.<name> = function (el, ev) input/change handler for data-input="<name>"
     L.onKey(fn(ev) -> true if handled)  global keys; each handler checks L.typing(ev.target) itself
     L.render()                        re-render the current view (focus and scroll are kept by data-k / data-scroll)
     L.pane({ id, title, icon, summary, actions, body, flush, size, collapsed, kind, status })  collapsible, expandable pane;
       kind 'onair'|'music'|'scenes'|'current'|'search'|'fx'|'plain' gives the box its identity edge (with its icon); scope + label show a small tag (Session, Campaign) before a short title; keys: its aria-keyshortcuts; status { text, tone: 'live'|'on'|'idle'|'warn' } is the one status pill in its header
     L.menu(anchor, html) / L.closeMenu()       anchored menu (items use data-act)
     L.sheet({ title, body, footer, wide }) / L.closeSheet()   modal sheet with focus trap (prep views only)
     L.say(text) screen-reader announcement; L.toast(text) short visible note
     L.icon(name, cls), L.esc, L.fmt(seconds), L.energy(n), L.tagChips(track, max), L.title(track)
     Lookups: L.track(id), L.playlist(id), L.board(id), L.campaign(id), L.session(cid, sid),
              L.playlistTracks(pl), L.usesOfPlaylist(id), L.usesOfBoard(id), L.playlistsOfTrack(id), L.boardPads(board)
     Playback (see 'Rooms' below: without a target, calls that start sound go to the rooms ticked in Send to): L.play(trackId, {lane, playlistId, fade, seq, target}), L.next(lane), L.prev(lane), L.pauseLane(lane), L.stopLane(lane, fade),
               L.fadeAll(s), L.firePad(boardId, padId, phase), L.stopFx(uid), L.preview(trackId), L.stopPreview(),
               L.startScene(cid, sid, index), L.pb (state: music, amb, fx[], preview, held)
     L.state: { theme, frame, rail, panes, live: { cid, sid, scene, standby } }
*/
var L = (function () {
  var D = LYRE_DATA;
  var L = { data: D, views: {}, acts: {}, inputs: {}, keys: [] };
  // Could 18 of the round 6 review: the version shown is the one running (in Lyre, the app's own; here, the design's).
  L.version = '0.5.0';

  /* ---------- icons (24 px stroke paths) ---------- */
  var I = {
    swords: 'M4 4l12 12M20 4 8 16M6 14l4 4M18 14l-4 4M4 20l2-2M20 20l-2-2',
    arrow: 'M4 20 18 6M18 6h-5M18 6v5M4 20l1.5-4.5M4 20l4.5-1.5',
    shield: 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z',
    flame: 'M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3-.5-3 0-5.5 0-8z',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4.2 3 5.2V19h8v-3.8c1.8-1 3-2.7 3-5.2a7 7 0 0 0-7-7zM9.5 11h.01M14.5 11h.01M10.5 19v2M13.5 19v2',
    heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8',
    rain: 'M7 14a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.3 3.3 0 0 1 17 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
    tree: 'M12 3 6 11h3l-4 6h14l-4-6h3zM12 17v4',
    door: 'M6 21V4h12v17M3 21h18M14.5 12.5h.01',
    note: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
    horn: 'M3 10v4h3l8 5V5L6 10zM17.5 9a4 4 0 0 1 0 6',
    ghost: 'M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2zM10 10h.01M14 10h.01',
    chain: 'M10 14a3 3 0 0 1 0-4l3-3a3 3 0 0 1 4 4l-1 1M14 10a3 3 0 0 1 0 4l-3 3a3 3 0 0 1-4-4l1-1',
    wave: 'M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
    mug: 'M5 7h11v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM16 10h2a2 2 0 0 1 0 4h-2',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    drum: 'M4 8c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8',
    moon: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z',
    claw: 'M6 20 10 4M11 21l3-16M16 21l3-14',
    organ: 'M4 21V9M8 21V5M12 21V3M16 21V5M20 21V9M2 21h20',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
    loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
    repeat1: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11 10.5l1.5-1.2V15',
    inorder: 'M4 7h10M4 12h10M4 17h6M17 9v10M14 16l3 3 3-3',
    volume: 'M3 10v4h3l5 4V6l-5 4zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4', download: 'M12 4v12M7 11l5 5 5-5M4 16v4h16v-4', warn: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01',
    hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 15',
    restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    // Should 9 of the round 6 review: one icon, one meaning. Undo is a hooked arrow (restart stays the circle), a muted
    // room a speaker struck through, Kick a door with an arrow out, Play on air a play triangle sounding out.
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', mute: 'M3 10v4h3l8 5V5L6 10zM17 9.5l5 5M22 9.5l-5 5',
    leave: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', playair: 'M4 5v14l10-7zM17 8.5a4 4 0 0 1 0 7M19.8 5.7a8 8 0 0 1 0 12.6', history: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2',
    one: 'M5 5v14l10-7zM19 5v14',
    headphones: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z',
    play: 'M7 4v16l13-8z', stop: 'M6 6h12v12H6z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
    next: 'M5 5v14l10-7zM19 5v14', prev: 'M19 5v14L9 12zM5 5v14',
    back: 'M15 18l-6-6 6-6', left: 'M19 12H5M11 18l-6-6 6-6', right: 'M5 12h14M13 6l6 6-6 6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    close: 'M6 6l12 12M18 6 6 18',
    chevup: 'M6 15l6-6 6 6', chevdown: 'M6 9l6 6 6-6', chevleft: 'M15 6l-6 6 6 6', chevright: 'M9 6l6 6-6 6',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    fade: 'M3 6c6 0 9 12 18 12M3 6v12h18',
    broadcast: 'M12 12h.01M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    queue: 'M4 6h12M4 12h12M4 18h8M18 15v6M15 18h6',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    file: 'M14 3H6v18h12V7zM14 3v4h4',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
    map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    scroll: 'M8 3h11v14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2h11v2a3 3 0 0 0 3 3M8 3a3 3 0 0 0-3 3v9',
    crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 19h14',
    library: 'M4 4v16M8 4v16M12 4l4 16M17 4l3 16',
    playlist: 'M3 6h12M3 12h12M3 18h7M17 18V8l4-1',
    palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.2-4-7.5-9-7.5zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    check: 'M5 12l5 5L20 7', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    rule: 'M4 6h16M7 12h10M10 18h4',
    stopall: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9h6v6H9z',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
    ambience: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8',
    sfx: 'M13 2 4 14h7l-1 8 9-12h-7z'
  };
  L.icon = function (n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (I[n] || I.note) + '"/></svg>'; };
  L.iconNames = Object.keys(I);
  L.logo = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#142B24"/><path d="M26 24V48M38 24V48" fill="none" stroke="#F1E4C8" stroke-width="4"/><g fill="#D9A441"><path id="lyreplume" d="M25 53C14 48.5 8 37 10.8 25.5C12.2 19.5 11 15.5 5.6 13.6C4.4 13.2 4.6 10 6.4 9.8C15 9 20.2 15.5 18.6 24.8C17.2 34 21 42.5 30 48Z"/><use href="#lyreplume" transform="matrix(-1 0 0 1 64 0)"/><rect x="12" y="20" width="40" height="4"/></g><rect x="20" y="48" width="24" height="8" rx="2" fill="#C0582F"/></svg>';

  /* ---------- helpers ---------- */
  var esc = L.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  L.fmt = function (s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  L.energy = function (e) { var h = '<span class="energy" role="img" aria-label="Energy ' + (e || 0) + ' of 5">'; for (var i = 1; i <= 5; i++) h += '<span class="' + (i <= e ? 'on' : '') + '"></span>'; return h + '</span>'; };
  L.title = function (t) { return t ? (t.title || t.metaTitle || t.file) : ''; };
  L.tagChips = function (t, max) {
    var out = [], n = 0; max = max || 99;
    D.tagGroups.forEach(function (g) { (t.tags[g.id] || []).forEach(function (v) { if (n++ < max) out.push('<span class="chip ' + g.cls + '" data-tag="' + esc(g.id + ':' + v) + '" title="' + esc(g.name) + '"><span class="dot"></span>' + esc(v) + '</span>'); }); });
    if (n > max) out.push('<span class="chip">+' + (n - max) + '</span>');
    return out.join('');
  };
  L.colors = { steel: '#8fb3d9', ember: '#f08a52', gold: '#e8bd62', moss: '#7fcf8f', violet: '#b69cff', plum: '#d394e0', sea: '#5fd4c0', bone: '#d9cfb8' };
  L.modeName = { oneshot: 'One-shot', toggle: 'Toggle loop', hold: 'Hold to play', retrigger: 'Restart on press' };
  L.modeIcon = { oneshot: 'one', toggle: 'loop', hold: 'hand', retrigger: 'restart' };

  /* ---------- lookups ---------- */
  function by(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  L.track = function (id) { return by(D.tracks)[id]; };
  L.playlist = function (id) { return by(D.playlists)[id]; };
  L.board = function (id) { return by(D.boards)[id]; };
  L.campaign = function (id) { return by(D.campaigns)[id]; };
  L.session = function (cid, sid) { var c = L.campaign(cid); return c && by(c.sessions)[sid]; };
  L.matchesRule = function (t, rule) {
    if (!rule) return false;
    if (rule.energy && (t.energy < rule.energy[0] || t.energy > rule.energy[1])) return false;
    if (rule.notRole && t.role === rule.notRole) return false;
    if (rule.shapes && rule.shapes.length && rule.shapes.indexOf(L.shapeOf(t)) < 0) return false;
    return (rule.conds || []).every(function (c) {
      if (!c.values.length) return true; // a condition still being written does not empty the list
      var have = t.tags[c.group] || [];
      // Round 7 (DAT-10): a tag holds the tags inside it (L.trackHasTag, r7tags.js).
      var hits = c.values.filter(function (v) { return L.trackHasTag ? L.trackHasTag(t, c.group, v) : have.indexOf(v) > -1; }).length;
      return c.match === 'all' ? hits === c.values.length : c.match === 'none' ? hits === 0 : hits > 0;
    });
  };
  L.playlistTracks = function (pl) {
    if (!pl) return [];
    if (pl.kind === 'dynamic') return D.tracks.filter(function (t) { return (pl.lane === 'fx' ? L.isFx(t) : t.kind === pl.lane) && L.matchesRule(t, pl.rule); });
    return pl.items.map(L.track).filter(Boolean);
  };
  L.ruleText = function (rule) {
    var parts = (rule.conds || []).filter(function (c) { return c.values.length; }).map(function (c) {
      var g = D.tagGroups.filter(function (x) { return x.id === c.group; })[0];
      return (g ? g.name : c.group) + ' ' + (c.match === 'all' ? 'all of' : c.match === 'none' ? 'none of' : 'any of') + ' ' + c.values.join(', ');
    });
    if (rule.energy) parts.push('energy ' + rule.energy[0] + ' to ' + rule.energy[1]);
    if (rule.notRole) parts.push('not ' + rule.notRole.toLowerCase() + 's');
    if (rule.shapes && rule.shapes.length) parts.push('shape ' + rule.shapes.map(function (x) { return (L.shapeName[x] || x).toLowerCase(); }).join(' or '));
    return parts.join('; ');
  };
  // Where a playlist is used: [{level:'campaign'|'session'|'scene', campaign, session, scene, label}]
  L.usesOfPlaylist = function (pid) {
    var out = [];
    D.campaigns.forEach(function (c) {
      if (c.playlists.indexOf(pid) > -1) out.push({ level: 'campaign', campaign: c, label: c.name + ' (whole campaign)' });
      c.sessions.forEach(function (s) {
        if (s.playlists.indexOf(pid) > -1) out.push({ level: 'session', campaign: c, session: s, label: c.name + ' › Session ' + s.n });
        s.scenes.forEach(function (sc) {
          if (sc.music.indexOf(pid) > -1 || sc.amb === pid) out.push({ level: 'scene', campaign: c, session: s, scene: sc, label: c.name + ' › Session ' + s.n + ' › ' + sc.name });
        });
      });
    });
    return out;
  };
  L.usesOfBoard = function (bid) {
    var out = [];
    D.campaigns.forEach(function (c) {
      if (c.boards.indexOf(bid) > -1) out.push({ level: 'campaign', campaign: c, label: c.name + ' (whole campaign)' });
      c.sessions.forEach(function (s) {
        if (s.boards.indexOf(bid) > -1) out.push({ level: 'session', campaign: c, session: s, label: c.name + ' › Session ' + s.n });
        s.scenes.forEach(function (sc) { if (L.sceneBoards(sc).indexOf(bid) > -1) out.push({ level: 'scene', campaign: c, session: s, scene: sc, label: c.name + ' › Session ' + s.n + ' › ' + sc.name }); });
      });
    });
    return out;
  };
  L.playlistsOfTrack = function (tid) { var t = L.track(tid); return D.playlists.filter(function (p) { return p.kind === 'manual' ? p.items.indexOf(tid) > -1 : (t && t.kind === p.lane && L.matchesRule(t, p.rule)); }); };
  L.boardPads = function (b) { return b.slots.slice(0, b.cols * b.rows); };
  L.kindName = { music: 'Music', amb: 'Ambience', fx: 'FX' };
  // FX filter: sound effects plus stings (short one-shot music cues).
  L.isFx = function (t) { return t.kind === 'fx' || t.role === 'Sting'; };
  L.sceneBoards = function (sc) { return sc.boards || (sc.board ? [sc.board] : []); };
  // A scene's music list mixes tracks and playlists: [{ kind: 'track'|'playlist', id, obj }]
  L.sceneItems = function (sc) { return (sc.music || []).map(function (id) { var p = L.playlist(id); return p ? { kind: 'playlist', id: id, obj: p } : { kind: 'track', id: id, obj: L.track(id) }; }).filter(function (x) { return x.obj; }); };
  // The order the scene's music plays in: each track, then each playlist's tracks, then back to the start.
  // A playlist item plays in its play order for this scene (PLY-13), so a shuffled playlist's tracks come in shuffled order.
  L.sceneSequence = function (sc) { var out = [], key = L.sceneKeyOf ? L.sceneKeyOf(sc) : ''; L.sceneItems(sc).forEach(function (it, i) { if (it.kind === 'track') out.push({ trackId: it.id, item: i, playlistId: '' }); else (L.orderedTracks ? L.orderedTracks(it.id, key) : L.playlistTracks(it.obj)).forEach(function (t) { out.push({ trackId: t.id, item: i, playlistId: it.id }); }); }); return out; };
  // Ambience can be one track or an ambience playlist.
  L.ambTracks = function (id) { var p = L.playlist(id); return p ? L.playlistTracks(p) : (L.track(id) ? [L.track(id)] : []); };
  L.usesOfTrack = function (tid) {
    var out = [];
    D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc) { if (sc.music.indexOf(tid) > -1 || sc.amb === tid) out.push({ level: 'scene', campaign: c, session: s, scene: sc, label: c.name + ' › Session ' + s.n + ' › ' + sc.name }); }); }); });
    return out;
  };
  /* ---------- round 5: shape, tags, names in scenes, play order (rules: src/common/domain/round5.ts) ---------- */
  /* DAT-13 track shape. L.levels(t) gives the track's loudness peaks (48 values, 0-1), simulated from its sections; the
     Audio profile's waveform is drawn from the same curve. L.suggestedShape(t) reads them with L.shapeFromPeaks (the same
     rule as the domain's shapeFromPeaks); L.shapeOf(t) is the GM's choice (t.shape) or else the suggestion. */
  L.SHAPES = [['steady', 'Steady'], ['builds', 'Builds'], ['fallsAway', 'Falls away'], ['peaksThenFalls', 'Peaks then falls'], ['risesAndFalls', 'Rises and falls']];
  L.shapeName = {}; L.SHAPES.forEach(function (x) { L.shapeName[x[0]] = x[1]; });
  var SHAPE_D = { steady: 'M1 6.5C5 5.5 9 7.2 12 6s7-1 11 .5', builds: 'M1 10.5C9 10.5 15 8 23 1.5', fallsAway: 'M1 1.5C9 2 15 9 23 10.5',
    peaksThenFalls: 'M1 10.5C7 10 9 1.5 13 1.5s7 8.5 10 9', risesAndFalls: 'M1 9.5C3 2.5 6 2.5 8 7.5s4 5 6 0 4-5.5 5-4 2 5 4 4.5' };
  L.shapeGlyph = function (s) { return '<svg class="shape-g" viewBox="0 0 24 12" aria-hidden="true"><path d="' + (SHAPE_D[s] || SHAPE_D.steady) + '"/></svg>'; };
  var levelCache = {};
  function seeded(str) { var a = 2166136261; for (var i = 0; i < str.length; i++) { a ^= str.charCodeAt(i); a = Math.imul(a, 16777619); } return function () { a = Math.imul(a ^ a >>> 15, 2246822507); a = Math.imul(a ^ a >>> 13, 3266489909); a ^= a >>> 16; return (a >>> 0) / 4294967296; }; }
  // A curve per track: from words in its title where they say how it moves ("builds", "fade", "loops well"), else from its id.
  function curveKind(t) {
    var w = (t.title + ' ' + t.notes).toLowerCase();
    if (t.profile && t.profile.markers && t.profile.markers.some(function (m) { return /peak/i.test(m.label); })) return 'peaksThenFalls';
    if (/build|rising|rises|ends huge|slow-burn|swells/.test(w)) return 'builds';
    if (/\bfade\b|resolves|release after|dies away/.test(w)) return 'fallsAway';
    if (/loops well|great loop|\(loops\)|steady|crowd|ostinato|never lets up/.test(w) || t.kind === 'amb') return 'steady';
    return ['steady', 'builds', 'peaksThenFalls', 'risesAndFalls', 'fallsAway', 'steady'][Math.floor(seeded(t.id)() * 6)];
  }
  L.levels = function (t) {
    if (!t) return [];
    if (levelCache[t.id]) return levelCache[t.id];
    var k = curveKind(t), r = seeded(t.id + ':lv'), out = [];
    for (var i = 0; i < 48; i++) {
      var x = i / 47, v = k === 'builds' ? .28 + .62 * Math.pow(x, 1.4) : k === 'fallsAway' ? .88 - .58 * Math.pow(x, .8) : k === 'peaksThenFalls' ? .3 + .6 * Math.sin(Math.PI * Math.pow(x, .85))
        : k === 'risesAndFalls' ? .52 + .3 * Math.sin(Math.PI * 4 * x) : .6 + .04 * Math.sin(x * 9);
      out.push(Math.max(.05, Math.min(1, v + (r() - .5) * .08)));
    }
    return (levelCache[t.id] = out);
  };
  L.levelAt = function (t, x) { var lv = L.levels(t), f = Math.max(0, Math.min(1, x)) * (lv.length - 1), i = Math.floor(f), j = Math.min(lv.length - 1, i + 1); return lv[i] + (lv[j] - lv[i]) * (f - i); };
  // The same rule as src/common/domain/round5.ts shapeFromPeaks (tested there).
  L.shapeFromPeaks = function (levels) {
    if (levels.length < 4) return null;
    var lv = levels.map(function (v) { return Math.min(1, Math.max(0, v || 0)); }), b = [];
    if (lv.length <= 8) b = lv; else for (var k = 0; k < 8; k++) { var a = Math.floor(k * lv.length / 8), z = Math.floor((k + 1) * lv.length / 8), sum = 0; for (var i = a; i < z; i++) sum += lv[i]; b.push(sum / (z - a)); }
    var max = Math.max.apply(null, b), min = Math.min.apply(null, b); if (max - min < .15) return 'steady';
    var dir = 0, lo = b[0], hi = b[0], ext = b[0], n = 0;
    b.slice(1).forEach(function (v) {
      if (dir === 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); if (v - lo >= .12) { dir = 1; ext = v; } else if (hi - v >= .12) { dir = -1; ext = v; } }
      else if (dir === 1 ? v > ext : v < ext) ext = v; else if (Math.abs(v - ext) >= .12) { n++; dir = -dir; ext = v; }
    });
    if (n >= 2) return 'risesAndFalls';
    var st = b[0], en = b[b.length - 1];
    if (max - st >= .15 && max - en >= .15) return 'peaksThenFalls';
    if (en - st >= .15) return 'builds';
    if (st - en >= .15) return 'fallsAway';
    return n >= 1 ? 'risesAndFalls' : 'steady';
  };
  L.suggestedShape = function (t) { return t ? L.shapeFromPeaks(L.levels(t)) : null; };
  L.shapeOf = function (t) { return t ? t.shape || L.suggestedShape(t) : null; };
  // A small glyph and the word; title says whether the GM chose it or Lyre suggested it.
  L.shapeTag = function (t, iconOnly) {
    var s = L.shapeOf(t); if (!s) return '';
    var tip = 'Shape: ' + L.shapeName[s] + (t.shape ? '' : ' (suggested from its loudness)');
    return '<span class="shape-tag" title="' + esc(tip) + '">' + L.shapeGlyph(s) + (iconOnly ? '<span class="sr-only">' + esc(tip) + '</span>' : '<span>' + esc(L.shapeName[s]) + '</span>') + '</span>';
  };
  /* PLY-15, DAT-15 volume normalisation (Nik, 5 Nov 23:47: "we'll also need volume baseline normalisation across the
     tracks, and an option we can turn on either at the whole library level or per track or playlist").
     D.normalise = { on, target } is the library's setting, off until the GM turns it on. A playlist's and a track's
     .norm is 'on', 'off' or absent (Library setting). Most specific wins: the track, then the playlist it plays from,
     then the library. t.loud = { lufs, peak } is what Lyre measured (none: not measured yet, plays as it is).
     Gain = target - loudness, at most +12 dB, and lowered so the true peak stays at or below -1 dBTP (rule
     normaliseGain in src/common/domain). The engine applies it before the track's own volume, fades and the room's
     volume; previews and Try pads hear the same gain. */
  D.normalise = D.normalise || { on: false, target: 'standard' };
  L.NORM_TARGETS = [['quiet', 'Quiet', -23, 'The broadcast level. The most room for loud moments.'], ['standard', 'Standard', -18, 'Lyre\'s default. Music sits well under voices.'], ['loud', 'Loud', -14, 'The level of music streaming services.']];
  L.NORM_CHOICES = [['library', 'Library setting'], ['on', 'On'], ['off', 'Off']];
  L.NORM_MAX_BOOST = 12; L.NORM_PEAK_CEILING = -1;
  L.normTarget = function () { var t = L.NORM_TARGETS.filter(function (x) { return x[0] === D.normalise.target; })[0] || L.NORM_TARGETS[1]; return { id: t[0], name: t[1], lufs: t[2] }; };
  // Which choice applies, and where it comes from: 'track' | 'playlist' | 'library'.
  L.normDecision = function (t, playlistId) {
    var p = playlistId && L.playlist(playlistId);
    if (t && t.norm) return { on: t.norm === 'on', from: 'track' };
    if (p && p.norm) return { on: p.norm === 'on', from: 'playlist', playlist: p };
    return { on: !!D.normalise.on, from: 'library' };
  };
  // The gain for a measured track at a target: { db, why } with why 'peak' (held under -1 dBTP), 'cap' (+12 dB) or ''.
  L.normaliseGain = function (loud, targetLufs) {
    var want = targetLufs - loud.lufs, room = L.NORM_PEAK_CEILING - loud.peak, db = Math.min(want, L.NORM_MAX_BOOST, room);
    return { db: Math.round(db * 10) / 10, why: db === want ? '' : db === room ? 'peak' : 'cap' };
  };
  L.normOf = function (t, playlistId) {
    var d = L.normDecision(t, playlistId), loud = t && t.loud, g = loud && d.on ? L.normaliseGain(loud, L.normTarget().lufs) : null;
    return { on: d.on, from: d.from, playlist: d.playlist, measured: !!loud, lufs: loud ? loud.lufs : null, peak: loud ? loud.peak : null, db: g ? g.db : 0, why: g ? g.why : '' };
  };
  L.dB = function (db) { return (db > 0 ? '+' : db < 0 ? '-' : '') + Math.abs(db).toFixed(1) + ' dB'; };
  // The measured line: "-22.6 LUFS · +4.6 dB", "-22.6 LUFS · plays as it is", "Not measured yet: plays as it is".
  L.normLine = function (t, playlistId) {
    var n = L.normOf(t, playlistId);
    if (!n.measured) return 'Not measured yet: plays as it is';
    return n.lufs.toFixed(1) + ' LUFS · ' + (!n.on ? 'plays as it is' : L.dB(n.db) + (n.why === 'peak' ? ' (kept under -1 dBTP)' : n.why === 'cap' ? ' (the most Lyre adds)' : ''));
  };
  // What a hover says where it plays (the Now playing bar, Live): "Volume evened out: +4.6 dB".
  L.normHover = function (t, playlistId) {
    var n = L.normOf(t, playlistId);
    return !n.on ? 'Volume not evened out' : !n.measured ? 'Volume not evened out: not measured yet' : 'Volume evened out: ' + L.dB(n.db) + ' (' + n.lufs.toFixed(1) + ' LUFS measured)';
  };
  L.libraryNormWords = function () { var tg = L.normTarget(); return D.normalise.on ? 'On, ' + tg.name + ' (' + tg.lufs + ' LUFS)' : 'Off'; };
  /* The NormaliseChoice control: "Normalise volume" with Library setting / On / Off, the measured line under it, and a
     hint saying where the choice comes from. o: { id, value, act, data (extra attributes), line, hint }. */
  L.normChoice = function (o) {
    var v = o.value || 'library';
    return '<div class="norm"><span class="norm-l" id="' + o.id + '-l">Normalise volume</span><div class="norm-box"><div class="seg s" role="group" aria-labelledby="' + o.id + '-l" aria-describedby="' + o.id + '-line">' +
      L.NORM_CHOICES.map(function (c) {
        return '<button type="button" data-act="' + o.act + '" data-v="' + c[0] + '"' + (o.data || '') + ' data-k="' + o.id + '-' + c[0] + '" aria-pressed="' + (v === c[0]) + '"' +
          (c[0] === 'library' ? ' title="The library\'s setting: ' + esc(L.libraryNormWords()) + '"' : '') + '>' + c[1] + '</button>';
      }).join('') + '</div><p class="norm-line num" id="' + o.id + '-line"' + (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(o.line) + '</p></div></div>';
  };
  // The library's setting: a small dialog from Library › ⋯ › Normalise volume….
  /* Nik, 6 Nov 00:41: as few words as the design allows; details on hover, no explanatory lines. */
  L.NORM_WHAT = 'Lyre measures how loud each track is and turns it up or down to one level. It adds at most 12 dB and keeps peaks under -1 dBTP. A track\'s own choice comes first, then its playlist\'s, then this one.';
  L.acts.normopen = function () {
    var n = D.tracks.filter(function (t) { return t.loud; }).length, todo = D.tracks.length - n;
    L.sheet({ title: 'Normalise volume',
      body: '<div class="stack norm-sheet">' +
        '<label class="norm-on" title="' + esc(L.NORM_WHAT) + '"><input type="checkbox" id="norm-on" data-k="norm-on"' + (D.normalise.on ? ' checked' : '') + '>Normalise volume for the whole library</label>' +
        '<fieldset class="norm-targets"><legend>Target level</legend>' + L.NORM_TARGETS.map(function (x) {
          return '<label class="pb-qs-opt" title="' + esc(x[3]) + '"><input type="radio" name="norm-target" value="' + x[0] + '" data-k="norm-t-' + x[0] + '"' + (D.normalise.target === x[0] ? ' checked' : '') + '><span>' + x[1] + ' (' + x[2] + ' LUFS)</span></label>';
        }).join('') + '</fieldset>' +
        '<p class="hint" role="status"' + (todo ? ' title="The rest are measured in the background; until then they play as they are."' : '') + '>' + n + ' of ' + D.tracks.length + ' tracks measured</p></div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="normsave" data-k="norm-save">Save</button>' });
  };
  L.acts.normsave = function () {
    var on = document.getElementById('norm-on').checked, r = document.querySelector('#lyre-sheet input[name="norm-target"]:checked');
    D.normalise.on = on; if (r) D.normalise.target = r.value;
    L.closeSheet(); L.changed(); L.say('Normalise volume: ' + L.libraryNormWords()); L.saved('library volume setting');
  };
  /* ORG-11 tags where music is chosen: a compact strip of the track's tags, each with its tag group's coloured dot, the
     first few only and "+n" for the rest (named in its tooltip), plus the shape glyph. */
  L.tagStrip = function (t, max) {
    if (!t) return '';
    var all = []; max = max || 3;
    D.tagGroups.forEach(function (g) { (t.tags[g.id] || []).forEach(function (v) { all.push({ g: g, v: v }); }); });
    var shown = all.slice(0, max), rest = all.slice(max);
    if (!all.length && !L.shapeOf(t)) return '';
    return '<span class="tagstrip"><span class="sr-only">Tags: ' + esc(all.map(function (x) { return x.v; }).join(', ') || 'none') + '. </span>' + L.shapeTag(t, true) +
      shown.map(function (x) { return '<span class="chip ' + x.g.cls + '" data-tag="' + esc(x.g.id + ':' + x.v) + '" title="' + esc(x.g.name) + '" aria-hidden="true"><span class="dot"></span><span class="ellipsis" title="' + esc(x.g.name + ': ' + x.v) + '">' + esc(x.v) + '</span></span>'; }).join('') +
      (rest.length ? '<span class="chip ts-more" title="' + esc(rest.map(function (x) { return x.g.name + ': ' + x.v; }).join(', ')) + '" aria-hidden="true">+' + rest.length + '</span>' : '') + '</span>';
  };
  /* DAT-14 a track's name in a scene: L.data.sceneNames[sceneKey][trackId]. L.nameIn(t, key) is the scene's name for it
     there, else its own (L.title). L.sceneKeyOf(scene) finds a scene's key. */
  D.sceneNames = D.sceneNames || {};
  L.sceneKeyOf = function (sc) {
    var key = '';
    D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { if (s.scenes.indexOf(sc) > -1) key = 'sc:' + c.id + ':' + s.id + ':' + sc.id; }); });
    return key;
  };
  L.sceneNameOf = function (t, key) { var n = t && key && D.sceneNames[key] && D.sceneNames[key][t.id]; return n && n.trim() ? n.trim() : ''; };
  L.nameIn = function (t, key) { return L.sceneNameOf(t, key) || L.title(t); };
  L.setNameIn = function (t, key, name) { if (!D.sceneNames[key]) D.sceneNames[key] = {}; if (name && name.trim()) D.sceneNames[key][t.id] = name; else delete D.sceneNames[key][t.id]; };
  L.namesOfTrack = function (t) { return Object.keys(D.sceneNames).filter(function (k) { return L.sceneNameOf(t, k); }).map(function (k) { return { key: k, name: L.sceneNameOf(t, k), label: L.placeLabel(k) }; }); };
  // A place key in words: 'The abbey ruins (Session 14)', 'Session 14: The Drowned Abbey', 'The Sunken Crown', 'Abbey ambience'.
  L.placeLabel = function (key) {
    var a = (key || '').split(':'), c = L.campaign(a[1]), s = c && L.session(a[1], a[2]);
    if (a[0] === 'sc') { var sc = s && s.scenes.filter(function (x) { return x.id === a[3]; })[0]; return sc ? sc.name + ' (Session ' + s.n + ')' : 'a scene'; }
    if (a[0] === 'ss') return s ? 'Session ' + s.n + (s.name ? ': ' + s.name : '') : 'a session';
    if (a[0] === 'cp') return c ? c.name : 'a campaign';
    if (a[0] === 'pl') { var p = L.playlist(a[1]); return p ? p.name : 'a playlist'; }
    return '';
  };
  L.placeKind = function (key) { return { sc: 'scene', ss: 'session', cp: 'campaign', pl: 'playlist' }[(key || '').split(':')[0]] || ''; };
  /* PLY-13 play order: shuffle and repeat (off, all, one), the playlist's own (pl.order) or one place's own
     (L.data.orders[placeKey][playlistId]); the place's wins, only there. L.orderOf(pid, key) -> { shuffle, repeat, source }.
     L.setOrder(pid, key, patch) ('' = the playlist's own), L.clearOrder(pid, key). L.orderedTracks(pid, key) is the
     playlist's tracks in the order they will play there (a shuffle is fixed per place and playlist for this visit). */
  D.orders = D.orders || {};
  L.orderOf = function (pid, key) {
    var here = key && D.orders[key] && D.orders[key][pid], p = L.playlist(pid);
    if (here) return { shuffle: here.shuffle, repeat: here.repeat, source: 'place' };
    if (p && p.order) return { shuffle: p.order.shuffle, repeat: p.order.repeat, source: 'playlist' };
    return { shuffle: false, repeat: L.placeKind(key) === 'scene' ? 'off' : 'all', source: 'default' };
  };
  L.setOrder = function (pid, key, patch) {
    var cur = L.orderOf(pid, key), next = { shuffle: patch.shuffle != null ? patch.shuffle : cur.shuffle, repeat: patch.repeat || cur.repeat };
    if (!key) { L.playlist(pid).order = next; return; }
    if (!D.orders[key]) D.orders[key] = {}; D.orders[key][pid] = next;
  };
  L.clearOrder = function (pid, key) { if (key && D.orders[key]) delete D.orders[key][pid]; else if (!key && L.playlist(pid)) delete L.playlist(pid).order; };
  L.orderWords = function (o) { return (o.shuffle ? 'Shuffle' : 'In order') + ', ' + (o.repeat === 'all' ? 'repeat all' : o.repeat === 'one' ? 'repeat one' : 'no repeat'); };
  /* ORG-13 order per place (Nik, 6 Nov 10:34: reorder a playlist's tracks "in the scene view, and have that reordering
     apply only in that scene", and the same in a session's and a campaign's playlists). D.trackOrders[placeKey][pid] is
     the track ids in the order chosen there; tracks it does not name (added to the playlist later) follow, in the
     playlist's own order. L.placeTracks(pid, key) is that order (shuffle not applied), L.hasPlaceOrder(pid, key),
     L.setPlaceOrder(pid, key, ids), L.clearPlaceOrder(pid, key) ("Back to the playlist's order"). Shuffle still applies on
     top, in L.orderedTracks. */
  D.trackOrders = D.trackOrders || {};
  L.hasPlaceOrder = function (pid, key) { return !!(key && D.trackOrders[key] && D.trackOrders[key][pid]); };
  L.placeTracks = function (pid, key) {
    var ts = L.playlistTracks(L.playlist(pid)); if (!L.hasPlaceOrder(pid, key)) return ts;
    var ord = D.trackOrders[key][pid], rank = {}; ord.forEach(function (id, i) { rank[id] = i; });
    return ts.map(function (t, i) { return { t: t, r: rank[t.id] != null ? rank[t.id] : ord.length + i }; }).sort(function (a, b) { return a.r - b.r; }).map(function (x) { return x.t; });
  };
  L.setPlaceOrder = function (pid, key, ids) {
    if (!key) return; var own = L.playlistTracks(L.playlist(pid)).map(function (t) { return t.id; });
    if (ids.join() === own.join()) { L.clearPlaceOrder(pid, key); return; }
    if (!D.trackOrders[key]) D.trackOrders[key] = {}; D.trackOrders[key][pid] = ids.slice();
  };
  L.clearPlaceOrder = function (pid, key) { if (D.trackOrders[key]) delete D.trackOrders[key][pid]; };
  L.orderedTracks = function (pid, key) {
    var ts = L.placeTracks(pid, key); if (!L.orderOf(pid, key).shuffle || ts.length < 3) return ts;
    var r = seeded(pid + '|' + (key || '') + '|' + L.state.shuffleRound), out = ts.slice();
    for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = out[i]; out[i] = out[j]; out[j] = x; }
    if (out.every(function (t, k) { return t === ts[k]; })) out.push(out.shift());   // a shuffle always changes the order
    return out;
  };
  // Where a lane plays from: its scene, or the session or campaign list it was started from ('' for none).
  L.lanePlace = function (c) {
    if (!c) return '';
    if (c.seq) { var s0 = L.session(c.seq.cid, c.seq.sid), sc0 = s0 && s0.scenes[c.seq.scene]; if (sc0) return 'sc:' + c.seq.cid + ':' + c.seq.sid + ':' + sc0.id; }
    return c.place || '';
  };
  // ORG-12: every place a track is used directly: kept on hand in a campaign or session, or in scenes.
  L.usesOfTrackAll = function (tid) {
    var out = [];
    D.campaigns.forEach(function (c) {
      if ((c.tracks || []).indexOf(tid) > -1) out.push({ level: 'campaign', campaign: c, label: c.name + ' (whole campaign)' });
      c.sessions.forEach(function (s) { if ((s.tracks || []).indexOf(tid) > -1) out.push({ level: 'session', campaign: c, session: s, label: c.name + ' › Session ' + s.n }); });
    });
    return out.concat(L.usesOfTrack(tid));
  };
  /* ---------- Discord outputs (simulated) ----------
     L.bots(), L.bot(id), L.server(id), L.channel(serverId, channelId)
     L.botJoin(botId, serverId, channelId)  moves the bot (status 'connecting' for about a second, then 'connected')
     L.botLeave(botId), L.botMute(botId, on), L.botVolume(botId, n)
     L.botWhere(bot) -> 'The Gull and Lantern › Table' or ''; L.botListeners(bot) -> people in its channel (not bots)
     L.botStatusText(bot) -> plain words for the status */
  L.bots = function () { return D.discord.bots; };
  L.bot = function (id) { return by(D.discord.bots)[id]; };
  L.server = function (id) { return by(D.discord.servers)[id]; };
  L.channel = function (sid, cid) { var g = L.server(sid); return g && by(g.channels)[cid]; };
  L.botWhere = function (b) { var g = L.server(b.server), c = L.channel(b.server, b.channel); return g && c ? g.name + ' › ' + c.name : ''; };
  L.botListeners = function (b) { var c = L.channel(b.server, b.channel); return c ? c.members.slice() : []; };
  L.botStatusText = function (b) { return { connected: b.muted ? 'In ' + L.botWhere(b) + ', muted' : 'Broadcasting to ' + L.botWhere(b), connecting: 'Joining ' + L.botWhere(b) + '…', idle: 'Not in a voice channel', error: 'Could not join: ' + (b.error || 'try again') }[b.status] || b.status; };
  L.botJoin = function (botId, serverId, channelId) {
    var b = L.bot(botId), c = L.channel(serverId, channelId); if (!b || !c) return;
    // OUT-8: a bot that is not connected to Discord (Settings) cannot join a voice channel.
    if (b.login && b.login !== 'online') { L.toast(b.name + ' is not connected: connect it in Settings'); return; }
    var other = D.discord.bots.filter(function (x) { return x !== b && x.server === serverId && x.channel === channelId && x.status !== 'idle'; })[0];
    b.server = serverId; b.channel = channelId; b.status = 'connecting'; b.error = '';
    L.say(b.name + ' is joining ' + L.botWhere(b)); L.changed();
    setTimeout(function () { if (b.channel === channelId) { b.status = 'connected'; L.say(b.name + ' is broadcasting to ' + L.botWhere(b) + (other ? '. ' + other.name + ' is in the same room, so the players hear both.' : '')); L.changed(); } }, 1100);
  };
  L.botLeave = function (botId) { var b = L.bot(botId); if (!b) return; var w = L.botWhere(b); b.status = 'idle'; b.server = ''; b.channel = ''; if (pb.own[botId]) delete pb.own[botId];
    if (botId === D.discord.bots[0].id) { ['music', 'amb'].forEach(function (ln) { if (pb[ln]) { pb[ln].fadeOut = 2; pb[ln + 'Out'].push(pb[ln]); pb[ln] = null; } }); pb.fx.forEach(function (f) { if (f.target === 'table') f.fadeOut = .8; }); }
    pb.fx.forEach(function (f) { if (f.target === botId) f.fadeOut = .8; }); L.say(b.name + ' left ' + w); L.changed(); };
  /* OUT-7: Kick takes a bot out of its voice channel at once. If the players there were hearing something, the caller
     shows an Undo instead of asking first: L.botKick(botId) -> { lost: true|false, restore() } where restore puts the
     bot back in that channel and plays what it played, from where it was. L.freeBots() are the connected bots in no
     voice channel (Add bot offers them). */
  L.freeBots = function () { return D.discord.bots.filter(function (b) { return b.status === 'idle' && (!b.login || b.login === 'online'); }); };
  L.botKick = function (botId) {
    var b = L.bot(botId); if (!b || b.status === 'idle') return null;
    var m = mixOf(botId), lanes = ['music', 'amb'].map(function (ln) { var c = m[ln]; return c ? { ln: ln, id: c.id, playlistId: c.playlistId, place: c.place, seq: c.seq, pos: c.pos, paused: c.paused } : null; }).filter(Boolean);
    var where = { server: b.server, channel: b.channel }, lost = lanes.some(function (x) { return !x.paused; }) && L.botListeners(b).length > 0;
    L.botLeave(botId);
    return { lost: lost, restore: function () {
      L.botJoin(botId, where.server, where.channel);
      var say = L.say; L.say = function () {};
      try { lanes.forEach(function (x) { L.play(x.id, { lane: x.ln, playlistId: x.playlistId, place: x.place, seq: x.seq, fade: 1, target: botId }); var c = mixOf(botId)[x.ln]; if (c) { c.pos = x.pos; c.paused = x.paused; } }); } finally { L.say = say; }
      L.changed();
    } };
  };
  L.botMute = function (botId, on) { var b = L.bot(botId); if (b) { b.muted = on == null ? !b.muted : !!on; L.say(b.name + (b.muted ? ' muted' : ' unmuted')); L.changed(); } };
  L.botVolume = function (botId, n) { var b = L.bot(botId); if (b) { b.volume = Math.max(0, Math.min(100, +n)); L.changed(); } };

  /* ---------- importing files from the computer (simulated paths) ----------
     L.filesFromDrop(event, done(files))  reads dropped files and folders (folders are walked), keeping audio files only;
       files = [{ name, folder }] where folder is the dropped folder's name (browsers do not reveal full paths; Lyre will).
     L.importFiles(files) -> new track ids, added to the Library (kind guessed from the folder: Ambience, Effects/SFX, else Music).
     L.isAudioName(name) */
  L.isAudioName = function (n) { return /\.(flac|mp3|wav|ogg|m4a|aac|wma|aif|aiff|opus)$/i.test(n); };
  L.filesFromDrop = function (ev, done) {
    var dt = ev.dataTransfer, out = [], pending = 0, finished = false;
    function end() { if (!pending && !finished) { finished = true; done(out.filter(function (f) { return L.isAudioName(f.name); })); } }
    function walk(entry, folder) {
      if (entry.isFile) { out.push({ name: entry.name, folder: folder }); return; }
      if (entry.isDirectory) {
        pending++; var r = entry.createReader(), sub = folder ? folder + '\\' + entry.name : entry.name;
        (function read() { r.readEntries(function (es) { if (!es.length) { pending--; end(); return; } es.forEach(function (e) { walk(e, sub); }); read(); }, function () { pending--; end(); }); })();
      }
    }
    var items = dt && dt.items ? [].slice.call(dt.items) : [];
    var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
    if (entries.length) entries.forEach(function (e) { walk(e, ''); }); else [].slice.call((dt && dt.files) || []).forEach(function (f) { out.push({ name: f.name, folder: '' }); });
    end();
  };
  L.importFiles = function (files) {
    var ids = [];
    files.forEach(function (f) {
      var folder = f.folder ? 'H:\\Audio\\Incoming\\' + f.folder : 'H:\\Audio\\Incoming';
      var same = D.tracks.filter(function (t) { return t.file === f.name && t.folder === folder; })[0];
      if (same) { ids.push(same.id); return; }
      var kind = /ambien|atmos|bed/i.test(f.folder) ? 'amb' : /effect|sfx|foley/i.test(f.folder) ? 'fx' : 'music';
      var t = { id: L.uid('t'), kind: kind, title: '', metaTitle: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/^[\d-]+\s*[-.]?\s*/, ''), artist: 'Unknown artist', album: f.folder ? f.folder.split('\\').pop() : '',
        file: f.name, folder: folder, dur: kind === 'fx' ? 3 : 120 + Math.round(Math.random() * 240), tags: { mood: [], motif: [], scene: [] }, energy: 0, role: kind === 'fx' ? 'Effect' : '', loop: '', notes: '', added: 'Today', isNew: true };
      D.tracks.push(t); ids.push(t.id);
    });
    return ids;
  };
  L.uid = function (p) { return (p || 'id') + Math.random().toString(36).slice(2, 8); };

  /* ---------- state ---------- */
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('lyre-r2') || '{}'); } catch (e) { saved = {}; }
  L.state = { theme: saved.theme || 'campaign', frame: saved.frame || 'half', rail: saved.rail || 'auto', panes: saved.panes || {}, notes: saved.notes !== false, tour: saved.tour === 'done' ? 'done' : '',
    live: { cid: 'crown', sid: 's14', scene: 1, standby: 2 }, ctx: { cid: 'crown' }, shuffleRound: 0 };
  L.save = function () { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: L.state.theme, frame: L.state.frame, rail: L.state.rail, panes: L.state.panes, notes: L.state.notes, tour: L.state.tour })); } catch (e) { /* storage unavailable: settings last for this visit */ } };

  /* ---------- simulated playback ---------- */
  var pb = L.pb = { music: null, amb: null, musicOut: [], ambOut: [], fx: [], preview: null, held: false, own: {} };
  /* Rooms (round 4). Every output (bot) in a voice channel is a room, named after its Discord channel, and every room has
     its own music, ambience and effects. The first bot's room plays from L.pb itself; any other room from L.pb.own[botId].
     A target is a bot id; 'table' (or omitted, for the control calls below) means the first bot's room:
       L.next(lane, target), L.prev(lane, target), L.upNext(lane, target), L.pauseLane(lane, target),
       L.stopLane(lane, fade, target), L.laneContext(lane, target), L.mix(target), L.fxFor(target).
     Where new sound goes: views pass an explicit target (the live view's boxes each have a "To:" room). Without a target,
     L.play(trackId, o) and L.firePad(board, pad, phase) go to L.sendTargets(): the rooms in L.state.sendTo that exist, or
     else the first room ('table' while no bot is in a voice channel). L.startScene always plays in the first room
     (L.firstRoom()). A toggle pad is on or off per room when fired with a target. L.toggleSendTo / L.sendWarn are kept for
     older callers. A room that leaves goes silent and its sound stops.
     L.mixes() / L.rooms(): one entry per room [{ id: botId, name: channel name, mix, bots: [bot], main }].
     L.setBotMix(botId, mix) is kept for older callers and does nothing now (bot.mix reads 'table' for the first bot and
     'own' for the others, so views that check it still find the right sound).
     data-progress / data-time take 'music', 'amb', 'preview', or 'music@<botId>' / 'amb@<botId>' for rooms other than the first. */
  function newMix() { return { music: null, amb: null, musicOut: [], ambOut: [] }; }
  function mainId() { return D.discord.bots[0] ? D.discord.bots[0].id : ''; }
  D.discord.bots.forEach(function (b, i) { b.mix = i ? 'own' : 'table'; });
  function mixOf(target) { if (!target || target === 'table' || target === 'all' || target === mainId()) return pb; if (!L.bot(target)) return pb; return pb.own[target] || (pb.own[target] = newMix()); }
  L.mix = mixOf;
  // An output is named after the room it is in (the bot's name when it is in none).
  L.outputName = function (b) { var c = L.channel(b.server, b.channel); return c ? c.name : b.name; };
  function roomBots() { return D.discord.bots.filter(function (b) { return b.status !== 'idle'; }); }
  L.mixes = L.rooms = function () { return roomBots().map(function (b) { return { id: b.id, name: L.outputName(b), mix: mixOf(b.id), bots: [b], main: b.id === mainId() }; }); };
  L.setBotMix = function () { D.discord.bots.forEach(function (b, i) { b.mix = i ? 'own' : 'table'; }); };
  L.state.sendTo = L.state.sendTo || (mainId() ? [mainId()] : []);
  // The first room: where scenes always go, and where untargeted sound goes when nothing else is chosen.
  L.firstRoom = function () { var r = roomBots(); return r.length ? r[0].id : 'table'; };
  L.sendTargets = function () {
    var r = roomBots(); if (!r.length) return ['table'];
    var t = r.filter(function (b) { return L.state.sendTo.indexOf(b.id) > -1; }).map(function (b) { return b.id; });
    return t.length ? t : [r[0].id];
  };
  L.toggleSendTo = function (botId) { var i = L.state.sendTo.indexOf(botId); if (i > -1) L.state.sendTo.splice(i, 1); else L.state.sendTo.push(botId); L.state.sendWarnAt = 0; L.changed(); };
  L.sendWarn = function () { L.state.sendWarnAt = Date.now(); L.toast('Nothing is ticked in Send to, so nobody would hear it'); L.changed(); };
  /* Audio profile (per track, optional): { start, end, after: 'loop'|'next'|'stop', loopStart, loopXfade, fadeIn: { dur, shape }, fadeOut: { dur, shape }, markers: [{ at, label }] }
     (shape 0-100: gentle to sharp; a plain number for a fade is read as { dur: n, shape: 50 }).
     Playback starts at start, ends at end, then loops back to loopStart, moves to the next track, or stops.
     L.profileOf(t) gives the profile with defaults filled in. */
  /* A track can sound different in different places: an override for one playlist or one scene (cue) replaces the
     track's own profile there. Overrides live in L.data.profiles under a context key:
       'pl:<playlistId>'              the track inside that playlist
       'sc:<cid>:<sid>:<sceneId>'     the track in that scene (directly or through one of its playlists)
     L.profileOf(t, ctx) resolves scene, then playlist, then the track's own; ctx = a key or { playlistId, cid, sid, sceneId }.
     L.profileWhere(t, ctx) says which one applies: 'scene' | 'playlist' | 'track'. L.profileKeys(t) lists the places that
     have their own settings. L.profileStore(t, key) returns (creating on request) the object to edit for that place. */
  D.profiles = D.profiles || {};
  function ctxKeys(ctx) {
    if (!ctx) return [];
    if (typeof ctx === 'string') return [ctx];
    // Scene first, else the session list it was played from (PLY-14), then the playlist; the track's own comes last.
    var out = []; if (ctx.sceneId) out.push('sc:' + ctx.cid + ':' + ctx.sid + ':' + ctx.sceneId); else if (ctx.place && ctx.place.indexOf('ss:') === 0) out.push(ctx.place); if (ctx.playlistId) out.push('pl:' + ctx.playlistId); return out;
  }
  function override(t, ctx) { var ks = ctxKeys(ctx); for (var i = 0; i < ks.length; i++) { var o = D.profiles[ks[i]] && D.profiles[ks[i]][t.id]; if (o) return { p: o, key: ks[i] }; } return null; }
  L.profileWhere = function (t, ctx) { var o = t && override(t, ctx); return o ? (o.key.indexOf('sc:') === 0 ? 'scene' : o.key.indexOf('ss:') === 0 ? 'session' : 'playlist') : 'track'; };
  L.profileKeys = function (t) { return Object.keys(D.profiles).filter(function (k) { return D.profiles[k][t.id]; }); };
  L.profileStore = function (t, key, create) {
    if (!key) { if (!t.profile && create) t.profile = {}; return t.profile; }
    if (!D.profiles[key]) D.profiles[key] = {};
    if (!D.profiles[key][t.id] && create) D.profiles[key][t.id] = JSON.parse(JSON.stringify(t.profile || {}));
    return D.profiles[key][t.id];
  };
  L.clearProfile = function (t, key) { if (D.profiles[key]) delete D.profiles[key][t.id]; };
  L.profileOf = function (t, ctx) {
    var ov = t && override(t, ctx), p = ov ? ov.p : (t && t.profile) || {}, dur = t ? t.dur : 60;
    var after = p.after || (t && (t.loop === 'yes' || t.loop === 'crossfade') ? 'loop' : 'next');
    function fade(f) { return f == null ? { dur: 0, shape: 50 } : typeof f === 'number' ? { dur: f, shape: 50 } : { dur: f.dur || 0, shape: f.shape != null ? f.shape : 50 }; }
    return { start: p.start || 0, end: p.end || dur, after: after, loopStart: p.loopStart != null ? p.loopStart : (p.start || 0), loopXfade: p.loopXfade || 0,
      fadeIn: fade(p.fadeIn), fadeOut: fade(p.fadeOut), markers: p.markers || [] };
  };
  function lane(trackId, playlistId, seq, place) { var t = L.track(trackId), pf = L.profileOf(t, laneCtx(playlistId, seq, place)); return { id: trackId, label: L.title(t), playlistId: playlistId || '', place: place || '', pos: pf.start, dur: pf.end, vol: 0, target: 1, fadeIn: 0 }; }
  function laneCtx(playlistId, seq, place) { var s = seq && L.session(seq.cid, seq.sid), sc = s && s.scenes[seq.scene]; return { playlistId: playlistId, cid: seq && seq.cid, sid: seq && seq.sid, sceneId: sc && sc.id, place: place || '' }; }
  L.laneContext = function (ln, target) { var c = mixOf(target)[ln]; return c ? laneCtx(c.playlistId, c.seq, c.place) : null; };
  L.play = function (trackId, o) {
    o = o || {}; var t = L.track(trackId); if (!t) return;
    if (o.target == null) { var ts = L.sendTargets(); if (!ts.length) { L.sendWarn(); return; } ts.forEach(function (tg) { var c = {}; for (var k in o) c[k] = o[k]; c.target = tg; L.play(trackId, c); }); return; }
    // A sound effect plays over the music, like a pad; it does not replace what is on air.
    if (t.kind === 'fx' && !o.lane) { pb.fx.push({ uid: L.uid('fx'), ref: 'track/' + t.id, label: L.title(t), target: fxTarget(o.target), pos: 0, dur: Math.max(1.5, t.dur), loop: false }); L.say('Effect: ' + L.title(t)); L.changed(); return; }
    var ln = o.lane === 'fx' ? 'music' : o.lane || (t.kind === 'amb' ? 'amb' : 'music'), fade = o.fade == null ? 3 : o.fade, m = mixOf(o.target);
    if (m[ln]) { m[ln].fadeOut = fade || .3; m[ln + 'Out'].push(m[ln]); }
    // o.place: the session or campaign list it was played from ('ss:…' / 'cp:…'), for its play order and audio settings.
    m[ln] = lane(trackId, o.playlistId, o.seq, o.place); m[ln].fadeIn = fade; m[ln].vol = fade ? 0 : 1; if (o.seq) m[ln].seq = o.seq;
    L.say((ln === 'music' ? 'Music' : 'Ambience') + (m === pb ? '' : ' in ' + L.outputName(L.bot(o.target))) + ': ' + L.title(t)); L.changed();
  };
  function neighbour(ln, step, target) {
    var cur = mixOf(target)[ln]; if (!cur) return null;
    if (cur.seq) { var s0 = L.session(cur.seq.cid, cur.seq.sid), sc0 = s0 && s0.scenes[cur.seq.scene], q = sc0 ? L.sceneSequence(sc0) : []; if (q.length) { var n = q[(cur.seq.at + step + q.length) % q.length]; return L.track(n.trackId); } }
    if (!cur.playlistId) return null;
    var list = L.orderedTracks(cur.playlistId, cur.place); var i = list.map(function (t) { return t.id; }).indexOf(cur.id);
    return list.length ? list[(i + step + list.length) % list.length] : null;
  }
  L.upNext = function (ln, target) { return neighbour(ln || 'music', 1, target); };
  function step(ln, d, target) {
    var cur = mixOf(target)[ln], n = neighbour(ln, d, target); if (!n) return;
    if (cur.seq) { var s0 = L.session(cur.seq.cid, cur.seq.sid), q = L.sceneSequence(s0.scenes[cur.seq.scene]), at = (cur.seq.at + d + q.length) % q.length, seq = { cid: cur.seq.cid, sid: cur.seq.sid, scene: cur.seq.scene, at: at };
      L.play(q[at].trackId, { lane: ln, playlistId: q[at].playlistId, fade: 3, seq: seq, target: target || 'table' }); return; }
    L.play(n.id, { lane: ln, playlistId: cur.playlistId, place: cur.place, fade: 3, target: target || 'table' });
  }
  L.next = function (ln, target) { step(ln, 1, target); };
  L.prev = function (ln, target) { step(ln, -1, target); };
  L.pauseLane = function (ln, target) { var m = mixOf(target); if (m[ln]) { m[ln].paused = !m[ln].paused; L.changed(); } };
  L.stopLane = function (ln, fade, target) { var m = mixOf(target); if (m[ln]) { m[ln].fadeOut = fade == null ? 2 : fade; m[ln + 'Out'].push(m[ln]); m[ln] = null; L.changed(); } };
  L.fadeAll = function (s) { L.stopLane('music', s); L.stopLane('amb', s); Object.keys(pb.own).forEach(function (id) { L.stopLane('music', s, id); L.stopLane('amb', s, id); }); pb.fx.forEach(function (f) { f.fadeOut = s || 2; }); L.say('Fading everything out'); L.changed(); };
  L.stopAll = function () { pb.music = pb.amb = null; pb.musicOut = []; pb.ambOut = []; pb.fx = []; Object.keys(pb.own).forEach(function (id) { pb.own[id] = newMix(); }); L.say('Everything stopped'); L.changed(); };
  // target: a bot id with its own sound, 'table' (default) or 'all' (every output at once).
  L.firePad = function (boardId, padId, phase, target) {
    var b = L.board(boardId); if (!b) return; var p = b.slots.concat(b.spare).filter(function (x) { return x && x.id === padId; })[0]; if (!p) return;
    // A pad is on or off per room: pressing it with a target stops it only in that room (or starts it there).
    var ref = boardId + '/' + padId, on = pb.fx.filter(function (f) { return f.ref === ref && !f.fadeOut && (target == null || f.target === fxTarget(target)); });
    if (p.mode === 'hold' && phase === 'up') { on.forEach(function (f) { f.fadeOut = .4; }); L.changed(); return; }
    if (phase === 'up') return;
    // BUG-20: pressing a pad that plays stops it, whatever its play mode: a toggle loop with its own fade, others quickly.
    if (on.length) { on.forEach(function (f) { f.fadeOut = p.mode === 'toggle' ? p.fade : .3; }); L.changed(); return; }
    var ts = target == null ? L.sendTargets() : [target]; if (!ts.length) { L.sendWarn(); return; }
    ts.forEach(function (tg) { pb.fx.push({ uid: L.uid('fx'), ref: ref, label: p.label, target: fxTarget(tg), pos: 0, dur: p.mode === 'toggle' || p.mode === 'hold' ? 1e9 : 2.5, loop: p.mode === 'toggle' || p.mode === 'hold' }); });
    L.changed();
  };
  function fxTarget(t) { if (t === 'all') return 'all'; return mixOf(t) === pb ? 'table' : t; }
  // Effects sounding for a target: L.fxFor('table'|botId) (effects sent to every output count for each).
  L.fxFor = function (t) { var k = fxTarget(t); return pb.fx.filter(function (f) { return f.target === k || f.target === 'all' || (!f.target && k === 'table'); }); };
  // BUG-20: Live's Stop pads: every pad sound fades out quickly; music, ambience and Off script effects go on.
  L.padSounds = function () { return pb.fx.filter(function (f) { return !f.fadeOut && f.ref && f.ref.indexOf('track/') !== 0; }); };
  L.stopPads = function () { L.padSounds().forEach(function (f) { f.fadeOut = .3; }); L.changed(); };
  L.padActive = function (boardId, padId) { return pb.fx.some(function (f) { return f.ref === boardId + '/' + padId && !f.fadeOut; }); };
  L.stopFx = function (uid) { pb.fx.forEach(function (f) { if (!uid || f.uid === uid) f.fadeOut = .8; }); L.changed(); };
  /* Preview: only you hear it. L.preview(trackId) toggles a track; L.previewPlaylist(pid) its first track (or an ambience
     playlist's first bed); L.previewPad(boardId, padId) a pad's sound. L.previewing(key) says whether that is the one
     playing (key = track id, 'pl:<pid>' or 'pad:<board>/<pad>'); L.previewLabel() names it. */
  function startPreview(key, p) { if (pb.preview && pb.preview.key === key) { pb.preview = null; L.say('Preview stopped'); } else { p.key = key; p.vol = 1; p.from = SCREEN_NAMES[String(curRoute || '').split('/')[1]] || ''; pb.preview = p; L.say('Previewing in your headphones: ' + p.label); } L.changed(); }
  L.preview = function (id) { startPreview(id, lane(id)); };
  L.previewPlaylist = function (pid) { var p = L.playlist(pid), t = L.playlistTracks(p)[0]; if (!t) { L.toast('This playlist has no tracks yet'); return; } var ln = lane(t.id, pid); ln.label = p.name + ': ' + L.title(t); startPreview('pl:' + pid, ln); };
  L.previewPad = function (boardId, padId) {
    var b = L.board(boardId), pad = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === padId; })[0]; if (!pad) return;
    startPreview('pad:' + boardId + '/' + padId, { id: '', label: pad.label + ' (pad)', playlistId: '', pos: 0, dur: 2.5, fadeIn: 0 });
  };
  L.previewing = function (key) { return !!(pb.preview && pb.preview.key === key); };
  L.previewLabel = function () { return pb.preview ? pb.preview.label : ''; };
  L.stopPreview = function () { pb.preview = null; L.changed(); };
  L.startScene = function (cid, sid, idx) {
    var s = L.session(cid, sid); if (!s || !s.scenes[idx]) return; var sc = s.scenes[idx];
    L.state.live.cid = cid; L.state.live.sid = sid; L.state.live.scene = idx; L.state.live.standby = Math.min(idx + 1, s.scenes.length);
    // Scenes always go to the first room.
    var ts = [L.firstRoom()];
    var seq = L.sceneSequence(sc);
    ts.forEach(function (tg) {
      if (seq[0]) L.play(seq[0].trackId, { lane: 'music', playlistId: seq[0].playlistId, fade: 4, seq: { cid: cid, sid: sid, scene: idx, at: 0 }, target: tg });
      if (sc.amb) { var a = L.ambTracks(sc.amb)[0]; if (a) L.play(a.id, { lane: 'amb', playlistId: L.playlist(sc.amb) ? sc.amb : '', fade: 3, target: tg }); } else L.stopLane('amb', 3, tg);
    });
    L.say('Scene: ' + sc.name); L.changed();
  };
  setInterval(function () {
    if (pb.held) return; var dt = .25, moved = false;
    [['table', pb]].concat(Object.keys(pb.own).map(function (id) { return [id, pb.own[id]]; })).forEach(function (mx) {
      var target = mx[0], m = mx[1];
      ['music', 'amb'].forEach(function (ln) {
        var c = m[ln];
        if (c && !c.paused) { c.pos += dt; if (c.fadeIn) c.vol = Math.min(1, c.vol + dt / c.fadeIn); else c.vol = 1; if (c.pos >= c.dur) { var t = L.track(c.id), pf = L.profileOf(t, laneCtx(c.playlistId, c.seq, c.place)); if (pf.after === 'loop' || ln === 'amb') c.pos = pf.loopStart; else if (L.repeatsOne(c, m)) c.pos = pf.start; else if (pf.after === 'next' && (c.seq || c.playlistId)) trackEnded(m, ln, c, pf, target); else m[ln] = null; } moved = true; }
        m[ln + 'Out'] = m[ln + 'Out'].filter(function (o) { o.pos += dt; o.vol -= dt / (o.fadeOut || .3); return o.vol > 0; });
      });
      // A room's Repeat lasts while its music plays (round 6, part 3).
      if (!m.music && m.rep) m.rep = null;
    });
    pb.fx = pb.fx.filter(function (f) { f.pos += dt; if (f.fadeOut) { f.fadeOut -= dt; return f.fadeOut > 0; } return f.loop || f.pos < f.dur; });
    if (pb.preview && !pb.preview.paused) { pb.preview.pos += dt; if (pb.preview.pos >= pb.preview.dur) pb.preview = null; moved = true; }
    if (moved || pb.fx.length) L.tick();
  }, 250);
  /* PLY-17 Repeat (Nik, 6 Nov 10:34; round 6 part 3, Nik, 6 Nov 12:24: "Repeat on the now playing bar should not
     persist. It should end once the music has stopped.").
     L.repeatButton(lane, target)   a room's Repeat, on the Now playing bar and in Live's On air: off, all, one in turn,
                                    for what plays in that room now. Never saved; it ends when that room's music stops
                                    (mix.rep goes back to null). Until it is chosen it shows what the music does by
                                    itself: a playlist's play order where it plays from (PLY-13, not changed by this),
                                    a scene track's saved Repeat one, or off.
     L.oneRepeats(placeKey, trackId) / L.setOneRepeats(placeKey, trackId, on)   Repeat one on a scene's track, saved with
                                    the scene (D.repeatOne, the data's repeat_ones): starting the scene again repeats it.
     L.repeatOneButton(placeKey, trackId, k, name, shown)   that button, the same in Live and in the planner.
     L.repeatsOne(lane, mix)        whether the lane's track starts again when it ends. */
  D.repeatOne = D.repeatOne || {};
  L.oneRepeats = function (key, tid) { return !!(D.repeatOne[key || ''] && D.repeatOne[key || ''][tid]); };
  L.setOneRepeats = function (key, tid, on) { key = key || ''; if (!D.repeatOne[key]) D.repeatOne[key] = {}; if (on) D.repeatOne[key][tid] = true; else delete D.repeatOne[key][tid]; };
  function laneRepeat(c, m) {
    if (!c) return 'off'; if (m && m.rep) return m.rep;
    if (L.oneRepeats(L.lanePlace(c), c.id) || c.repeatOne) return 'one';
    return c.playlistId ? L.orderOf(c.playlistId, L.lanePlace(c)).repeat : 'off';
  }
  L.repeatsOne = function (c, m) { return laneRepeat(c, m) === 'one'; };
  L.laneRepeat = laneRepeat;
  L.roomRepeat = function (target) { var m = mixOf(target); return laneRepeat(m.music, m); };
  var REPEAT_WORDS = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' }, REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
  L.repeatButton = function (ln, target, k) {
    var m = mixOf(target), c = m[ln]; if (!c) return '';
    var r = laneRepeat(c, m), next = REPEAT_NEXT[r], room = m === pb ? (L.rooms().length > 1 ? ' in ' + L.outputName(L.bots()[0]) : '') : ' in ' + L.outputName(L.bot(target));
    return '<button class="btn s icon rep' + (r === 'off' ? '' : ' on') + '" data-act="lanerepeat" data-lane="' + ln + '" data-room="' + esc(target || 'table') + '" data-k="' + esc(k || 'rep-' + ln) + '" aria-pressed="' + (r !== 'off') + '" aria-label="' + REPEAT_WORDS[r] + '"' +
      ' title="' + REPEAT_WORDS[r] + ', for what plays now' + esc(room) + ' (not saved). Press for ' + REPEAT_WORDS[next].toLowerCase().replace('repeat: ', 'repeat ').replace('repeat off', 'no repeat') + '">' + L.icon(r === 'one' ? 'repeat1' : 'loop', 's') + '</button>';
  };
  L.acts.lanerepeat = function (el) {
    var m = mixOf(el.dataset.room), c = m[el.dataset.lane]; if (!c) return;
    m.rep = REPEAT_NEXT[laneRepeat(c, m)];
    L.say(REPEAT_WORDS[m.rep] + ', for what plays now'); L.changed();
  };
  L.repeatOneButton = function (key, tid, k, nm, shown) {
    var on = L.oneRepeats(key, tid);
    return '<button class="closer rep1' + (on || shown ? ' shown' : '') + '" data-act="rep1" data-key="' + esc(key) + '" data-id="' + esc(tid) + '" data-k="' + esc(k) + '" aria-pressed="' + on + '"' +
      // Should 13 of the round 6 review: this Repeat is saved with the scene, unlike On air's (this play only): the
      // hover text says so, and a pressed one carries a small dot, as a play order chosen for one place does.
      ' title="' + (on ? 'Repeat in this scene (saved): press to stop' : 'Repeat in this scene (saved): plays again when it ends, every time this scene plays') + '" aria-label="Repeat one: ' + esc(nm) + '">' + L.icon('repeat1') + (on ? '<span class="ord-dot" aria-hidden="true"></span>' : '') + '</button>';
  };
  L.acts.rep1 = function (el) {
    var key = el.dataset.key, id = el.dataset.id, on = !L.oneRepeats(key, id); L.setOneRepeats(key, id, on);
    // The saved setting shows at once in a room playing that track: a Repeat chosen there for this play gives way.
    [pb].concat(Object.keys(pb.own).map(function (x) { return pb.own[x]; })).forEach(function (m) { if (m.music && m.music.id === id && L.lanePlace(m.music) === key) m.rep = null; });
    L.say((on ? 'Repeat one on, saved with the scene: ' : 'Repeat one off: ') + L.title(L.track(id))); L.render();
    var a = key.split(':'), s = L.session(a[1], a[2]), sc = s && s.scenes.filter(function (x) { return x.id === a[3]; })[0];
    L.saved('Repeat one in ' + (sc ? sc.name : 'this scene'), { key: 'rep1-' + key + id });
  };
  // The Now playing row's Shuffle, beside Repeat: the PLY-13 shuffle of that playlist where it plays from.
  L.shuffleButton = function (ln, target, k) {
    var c = mixOf(target)[ln]; if (!c || !c.playlistId) return '';
    var on = L.orderOf(c.playlistId, L.lanePlace(c)).shuffle;
    return '<button class="btn s icon rep' + (on ? ' on' : '') + '" data-act="laneshuffle" data-lane="' + ln + '" data-room="' + esc(target || 'table') + '" data-k="' + esc(k || 'shuf-' + ln) + '" aria-pressed="' + on + '" aria-label="Shuffle" title="Shuffle ' + (on ? 'on' : 'off') + '">' + L.icon(on ? 'shuffle' : 'inorder', 's') + '</button>';
  };
  L.acts.laneshuffle = function (el) {
    var c = mixOf(el.dataset.room)[el.dataset.lane]; if (!c || !c.playlistId) return; var key = L.lanePlace(c), o = L.orderOf(c.playlistId, key);
    L.setOrder(c.playlistId, key, { shuffle: !o.shuffle }); L.state.shuffleRound++; L.say(o.shuffle ? 'Shuffle off' : 'Shuffle on'); L.changed();
    // Shuffle is the playlist's play order where it plays from (PLY-13), which is saved; Repeat here is not.
    L.saved('play order of ' + L.playlist(c.playlistId).name + ' ' + L.placeWords(key), { key: 'ord-' + c.playlistId + key });
  };
  /* PLY-13: what happens when a track from a playlist ends by itself, by its play order where it plays (the same rule
     as the domain's whenTrackEnds): repeat one plays it again, repeat all starts the playlist again after its last
     track, no repeat moves the scene on (or stops a playlist playing on its own). Next and Previous always move on. */
  function trackEnded(m, ln, c, pf, target) {
    if (!c.playlistId) { L.next(ln, target); return; }
    var key = L.lanePlace(c), o = L.orderOf(c.playlistId, key), list = L.orderedTracks(c.playlistId, key), last = list.length && list[list.length - 1].id === c.id;
    // The room's Repeat, chosen for this play, comes before the playlist's own play order (which it does not change).
    var rep = m.rep || o.repeat;
    if (rep === 'one') { c.pos = pf.start; return; }
    if (!last) { L.next(ln, target); return; }
    // Live keeps a running list per room (Play next, Add to queue): it decides what comes after the last track.
    if ((!c.seq && L.carriesOn && L.carriesOn(target)) || (c.seq && m.rep)) { L.next(ln, target); return; }
    if (rep === 'all') {
      var first = list[0]; if (!first) return;
      if (c.seq) { var s0 = L.session(c.seq.cid, c.seq.sid), q = L.sceneSequence(s0.scenes[c.seq.scene]), at = -1; q.forEach(function (x, i) { if (at < 0 && x.playlistId === c.playlistId && x.trackId === first.id) at = i; });
        L.play(first.id, { lane: ln, playlistId: c.playlistId, fade: 3, seq: { cid: c.seq.cid, sid: c.seq.sid, scene: c.seq.scene, at: Math.max(0, at) }, target: target }); return; }
      L.play(first.id, { lane: ln, playlistId: c.playlistId, place: c.place, fade: 3, target: target }); return;
    }
    if (c.seq) L.next(ln, target); else { m[ln + 'Out'].push(c); c.fadeOut = .5; m[ln] = null; L.say('End of ' + (L.playlist(c.playlistId) || {}).name); }
  }
  // Elements with data-progress="music|amb|preview" and data-time="music|amb|preview" update every tick without a re-render.
  L.tick = function () {
    function lanePb(key) { var a = key.split('@'); return a[1] ? (pb.own[a[1]] || {})[a[0]] : pb[a[0]]; }
    document.querySelectorAll('[data-progress]').forEach(function (el) { var c = lanePb(el.dataset.progress); el.style.width = c ? Math.min(100, c.pos / c.dur * 100) + '%' : '0'; });
    document.querySelectorAll('[data-time]').forEach(function (el) { var c = lanePb(el.dataset.time); el.textContent = c ? L.fmt(c.pos) + ' / ' + L.fmt(c.dur) : ''; });
    var fxCount = pb.fx.length; if (fxCount !== L._fx) { L._fx = fxCount; L.render(); }
  };
  L.changed = function () { L.render(); L.tick(); };

  /* ---------- announcements ---------- */
  // Could 14 of the round 6 review: one event is announced once. A toast that follows an announcement of the same
  // event (within half a second) is shown but not read out again.
  /* UX-R7 (0.5.0 review): a count that changes on every key press is read out once typing pauses (500 ms). */
  var settleTimer = null, settledText = '';
  L.sayWhenSettled = function (text) {
    clearTimeout(settleTimer); if (!text) { settledText = ''; return; }
    if (text === settledText) return;
    settleTimer = setTimeout(function () { settledText = text; L.say(text); }, 500);
  };
  var saidAt = 0, readTimer = null;
  function speak(msg) { var r = document.getElementById('lyre-live'); if (r) { r.textContent = ''; setTimeout(function () { r.textContent = msg; }, 30); } }
  // UX-R6 (0.5.0 review): a note is read out from the live region 120 ms after it shows; an announcement in that
  // moment is the same change told more fully, so it takes the note's place: one event, one message.
  L.say = function (msg) { clearTimeout(readTimer); saidAt = Date.now(); var r = document.getElementById('lyre-live'); if (r) { r.textContent = ''; setTimeout(function () { r.textContent = msg; }, 30); } };
  /* Round 6, part 5: one pop-up for the whole app (ROUND6.md "Part 5: the Saved pop-up"). Nik, 6 Nov 16:14: "little
     pop ups somewhere unobtrusive but noticeable as a consistent design standard indicating something has been saved".
       L.saved(what, { key, detail })  "Saved: <what>" (" · <detail>" after it when given). key: what was saved (default
                                       what); the same key again within 2 s refreshes the pop-up instead of a new one.
       L.toast(text, { key })          any other short note (Undone, a warning, what a drop did): same place, same look.
       L.saveFailed(what, retry)       a failed save: warning style, read out as an alert, stays until Try again works
                                       or it is dismissed. (L.failNextSave() makes the next L.saved fail: the demo.)
       data-save="<what>" on a field   it saves on Enter, on leaving it, or after a second without typing, never per
                                       keystroke ({v} in <what> is its value); a list, tick box or slider so marked saves
                                       when it changes. Wired once below.
     Where (round 6 part 6, Nik, 6 Nov 17:14: "Let's move the saved pop up to the bottom right hand corner"): the
     bottom-right corner of the work area, 12 px in from its right edge and 12 px above its bottom, or above the Now
     playing bar when the bar shows. Live's On air is at the top, so it never covers it. The failure card and the
     Undo note (UndoNote: Reset to whole track, Delete board, ...) stack in the same corner: the Undo note lowest, then
     the failure, then the pop-up. It never takes focus. */
  var NOTE_MS = 3000, MERGE_MS = 2000, note = { key: null, at: 0, timer: 0 }, fail = null, failNext = false, beforeToast = null;
  function toasts() { return document.getElementById('lyre-toasts'); }
  L.placeToasts = function () {
    var box = toasts(), v = document.getElementById('view'); if (!box || !v) return;
    var r = v.getBoundingClientRect(), bar = v.querySelector('.onairbar'), floor = bar && bar.offsetParent ? bar.getBoundingClientRect().top : r.bottom;
    var right = Math.round(window.innerWidth - r.right + 12) + 'px', width = Math.max(160, Math.min(400, r.width - 24)) + 'px', bottom = Math.round(window.innerHeight - floor + 12);
    var un = v.querySelector('.undo-note');
    if (un) { un.style.right = right; un.style.maxWidth = width; un.style.bottom = bottom + 'px'; bottom += un.getBoundingClientRect().height + 6; }
    box.style.top = 'auto'; box.style.bottom = bottom + 'px'; box.style.right = right; box.style.maxWidth = width;
    // Never over the field or control in use (a Notes field at the bottom right, say): then it sits just above it.
    var a = document.activeElement, b = box.getBoundingClientRect();
    if (a && a !== document.body && !box.contains(a) && v.contains(a) && b.height) {
      var q = a.getBoundingClientRect();
      if (q.left < b.right && q.right > b.left && q.top < b.bottom && q.bottom > b.top) box.style.bottom = Math.round(window.innerHeight - q.top + 8) + 'px';
    }
  };
  function showNote(text, o) {
    var t = document.getElementById('lyre-toast'); if (!t) return; o = o || {};
    var key = o.key || text, now = Date.now(), same = note.key === key && now - note.at < MERGE_MS && !!t.textContent;
    // Could 14 of the round 6 review: a note that follows an announcement of the same event (within half a second) is
    // shown but not read out again; a refresh of the same save within 2 s is not read out again either.
    var quiet = same || now - saidAt < 500;
    t.setAttribute('aria-live', 'off'); clearTimeout(readTimer); if (!quiet) readTimer = setTimeout(function () { speak(text); }, 120);
    if (!same || t.textContent !== text) {
      t.className = 'toast' + (o.saved ? ' t-saved' : '');
      t.innerHTML = (o.saved ? L.icon('check', 's') : '') + '<span>' + (o.saved ? '<b>Saved:</b> ' + esc(text.replace(/^Saved: /, '')) : esc(text)) + '</span>';
    }
    // A refresh shows a short pulse instead of a second pop-up (no pulse with reduced motion: ui.css).
    if (same) { t.classList.remove('t-again'); void t.offsetWidth; t.classList.add('t-again'); }
    note.key = key; note.at = now; L.placeToasts();
    clearTimeout(note.timer); note.timer = setTimeout(hideNote, Math.min(6000, Math.max(NOTE_MS, text.length * 55)));
  }
  function hideNote() { var t = document.getElementById('lyre-toast'); if (t) { t.innerHTML = ''; t.className = 'toast'; } note.key = null; }
  L.toast = function (msg, o) { showNote(msg, o); };
  L.saved = function (what, o) {
    o = o || {};
    if (failNext) { failNext = false; L.saveFailed(what, function () { L.saved(what, o); }); return; }
    if (fail && fail.what === what) clearFail();   // the same thing saved after all: the failure goes
    showNote('Saved: ' + what + (o.detail ? ' · ' + o.detail : ''), { key: 'saved:' + (o.key || what), saved: true });
  };
  L.failNextSave = function () { failNext = true; };
  L.saveFailed = function (what, retry) {
    var f = document.getElementById('lyre-fail'); if (!f) return;
    fail = { what: what, retry: retry };
    f.innerHTML = L.icon('warn', 's') + '<div class="grow"><b>Not saved: ' + esc(what) + '</b> <span>Lyre could not write it to your computer. Try again; if it fails again, check that the drive has space.</span></div>' +
      '<button class="btn s" type="button" data-act="savetry">Try again</button><button class="closer" type="button" data-act="savefailx" aria-label="Dismiss: not saved: ' + esc(what) + '" title="Dismiss">' + L.icon('close') + '</button>';
    f.className = 'toast t-fail'; L.placeToasts();
  };
  function clearFail() { var f = document.getElementById('lyre-fail'); if (f) { f.innerHTML = ''; f.className = 'toast'; } fail = null; }
  // A person may Tab to Try again or Dismiss (the pop-up never takes focus); afterwards focus goes back to their work.
  document.addEventListener('focusin', function (e) { var b = toasts(); if (b && !b.contains(e.target)) beforeToast = e.target; });
  function backToWork() { var b = beforeToast, a = document.activeElement; if ((!a || a === document.body) && b && document.contains(b)) b.focus(); }
  L.acts.savetry = function () { var f = fail; if (!f) return; clearFail(); backToWork(); f.retry(); };
  L.acts.savefailx = function () { clearFail(); backToWork(); };
  window.addEventListener('resize', L.placeToasts);

  /* Fields that save themselves (data-save). The views redraw while typing and find the field again by its data-k, so
     a pending save is kept per data-k (or id), and the text is read from the field as it is when the save happens. */
  var pendingSave = {};
  function fieldKey(el) { return el.dataset.k || el.id || el.dataset.save; }
  function fieldNow(k) { return document.querySelector('[data-k="' + k + '"]') || document.getElementById(k); }
  function saveText(el) { return el.dataset.save.replace('{v}', '“' + (el.value || '').trim() + '”'); }
  function flushField(k) {
    var p = pendingSave[k]; if (!p) return; clearTimeout(p.timer); delete pendingSave[k];
    var el = fieldNow(k); if (el && el.dataset && el.dataset.save) p.text = saveText(el);
    L.saved(p.text, { key: k });
  }
  function isTextField(el) { return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|color)$/.test(el.type)); }
  function saving(el) { return el && el.dataset && el.dataset.save; }
  document.addEventListener('input', function (e) {
    var el = e.target; if (!saving(el) || !isTextField(el)) return;
    var k = fieldKey(el), p = pendingSave[k] || (pendingSave[k] = {});
    p.text = saveText(fieldNow(k) || el); clearTimeout(p.timer); p.timer = setTimeout(function () { flushField(k); }, 1000);
  });
  // After the view's own handler (which may announce the change: then the pop-up is shown, not read out again).
  document.addEventListener('change', function (e) { var el = e.target; if (saving(el) && !isTextField(el)) { var k = fieldKey(el); pendingSave[k] = { text: saveText(el) }; setTimeout(function () { flushField(k); }, 0); } });
  document.addEventListener('keydown', function (e) { var el = e.target; if (e.key === 'Enter' && saving(el) && el.tagName === 'INPUT' && isTextField(el)) flushField(fieldKey(el)); }, true);
  // Leaving the field saves it; a redraw that puts focus back in the same field (same data-k) does not count.
  document.addEventListener('focusout', function (e) {
    var el = e.target; if (!saving(el) || !isTextField(el)) return; var k = fieldKey(el);
    setTimeout(function () { var a = document.activeElement; if (pendingSave[k] && !(saving(a) && fieldKey(a) === k)) flushField(k); }, 0);
  });

  /* ---------- panes ---------- */
  /* Round 6 (ROUND6.md): a resting status (Empty, Copied, or a count the open box already lists) tells nothing new
     while the box is open, so it shows only on a folded box, where it is the one line left. Statuses that say something
     is happening (Playing, On air, a warning, n selected) always show. Part 5 (Nik, 6 Nov 16:14): no box says Ready or
     Saved at all, open or folded (a box with nothing to say has no status; saving shows in the Saved pop-up, L.saved),
     and no box counts scenes. */
  L.quietStatus = function (st) { return !!st && (st.tone || 'idle') === 'idle' && /^(Empty|Copied|\d+( [a-z]+)?)$/.test(st.text); };
  L.pane = function (o) {
    var st = L.state.panes[o.id], collapsed = st == null ? !!o.collapsed : st === 'c';
    if (!collapsed && L.quietStatus(o.status)) o = Object.assign({}, o, { status: null });
    // o.foldedSummary: the summary repeats what the open box shows, so it is for the folded box only.
    if (!collapsed && o.foldedSummary) o = Object.assign({}, o, { summary: '' });
    // o.describe (round 6): what the box is for, read out with its name and shown on hover, not on screen.
    return '<section class="pane' + (collapsed ? ' collapsed' : '') + (L.state.maxed === o.id ? ' maxed' : '') + (o.kind ? ' k-' + o.kind : '') + (o.cls ? ' ' + o.cls : '') + '" data-pane="' + o.id + '"' + (o.size ? ' data-size="' + o.size + '"' : '') + ' aria-label="' + esc(o.title) + '"' + (o.describe ? ' aria-describedby="pd-' + o.id + '"' : '') + '>' + (o.describe ? '<p class="sr-only" id="pd-' + o.id + '">' + esc(o.describe) + '</p>' : '') +
      '<header><h2 class="pane-h"><button class="pane-toggle" data-act="pane" data-id="' + o.id + '" data-k="pane-' + o.id + '" aria-expanded="' + !collapsed + '"' + (o.keys ? ' aria-keyshortcuts="' + esc(o.keys) + '"' : '') + ' title="' + (collapsed ? 'Expand' : 'Collapse') + ' ' + esc(o.title) + (o.keys ? ' (' + esc(o.keys) + ')' : '') + '">' +
      L.icon('chevdown', 's chev') + (o.icon ? L.icon(o.icon, 's') : '') +
      // o.scope + o.label (round 6, part 3): the same box for a session and a campaign, told apart by a small tag.
      (o.scope ? (o.scopeHidden ? '<span class="sr-only">' + esc(o.scope) + ' </span>' : '<span class="pane-scope">' + esc(o.scope) + '</span><span class="sr-only"> </span>') : '') + '<span class="pane-title">' + esc(o.label || o.title) + '</span></button></h2>' +
      '<div class="pane-summary">' + (o.summary || '') + '</div>' + (o.status ? '<span class="pane-status s-' + (o.status.tone || 'idle') + '">' + esc(o.status.text) + '</span>' : '') + '<div class="pane-actions">' + (collapsed ? '' : (o.actions || '')) +
      (o.noMax ? '' : '<button class="closer" data-act="panemax" data-id="' + o.id + '" data-k="max-' + o.id + '" title="' + (L.state.maxed === o.id ? 'Back to all panes' : 'Fill the column with ' + esc(o.title)) + '" aria-pressed="' + (L.state.maxed === o.id) + '">' + L.icon(L.state.maxed === o.id ? 'shrink' : 'expand') + '</button>') +
      '</div></header><div class="pane-body' + (o.flush ? ' flush' : '') + '"' + (o.scroll ? ' data-scroll="' + o.scroll + '"' : '') + '>' + (o.body || '') + '</div></section>';
  };
  L.acts.pane = function (el) { var id = el.dataset.id, st = L.state.panes[id], pane = el.closest('.pane'); var collapsed = pane.classList.contains('collapsed'); L.state.panes[id] = collapsed ? 'o' : 'c'; if (L.state.maxed === id && !collapsed) L.state.maxed = null; L.save(); L.render(); };
  L.acts.panemax = function (el) { var id = el.dataset.id; L.state.maxed = L.state.maxed === id ? null : id; if (L.state.maxed) L.state.panes[id] = 'o'; L.render(); };

  /* ---------- menus ---------- */
  var menuEl = null, menuAnchor = null;
  L.menu = function (anchor, html, label) {
    L.closeMenu(); menuAnchor = anchor;
    menuEl = document.createElement('div'); menuEl.className = 'menu'; menuEl.setAttribute('role', 'menu'); menuEl.setAttribute('aria-label', label || 'Menu');
    menuEl.innerHTML = html; document.body.appendChild(menuEl);
    var r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var left = Math.min(Math.max(4, r.left), window.innerWidth - mw - 4), top = r.bottom + 4;
    if (top + mh > window.innerHeight - 4) top = Math.max(4, r.top - mh - 4);
    menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    var first = menuEl.querySelector('button,input,[tabindex]'); if (first) first.focus();
  };
  L.closeMenu = function (refocus) { if (menuEl) { menuEl.remove(); menuEl = null; if (menuAnchor) { menuAnchor.setAttribute('aria-expanded', 'false'); if (refocus && document.contains(menuAnchor)) menuAnchor.focus(); } menuAnchor = null; } };
  document.addEventListener('pointerdown', function (e) { if (menuEl && !menuEl.contains(e.target) && e.target !== menuAnchor && !(menuAnchor && menuAnchor.contains(e.target))) L.closeMenu(); });
  document.addEventListener('keydown', function (e) {
    if (!menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); L.closeMenu(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var items = [].slice.call(menuEl.querySelectorAll('button:not([disabled])')); var i = items.indexOf(document.activeElement);
      if (items.length) { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
    }
  }, true);

  /* ---------- sheets (prep only; the live view never covers its controls) ---------- */
  var sheetReturn = null;
  L.sheet = function (o) {
    L.closeSheet(); sheetReturn = document.activeElement;
    var s = document.createElement('div'); s.className = 'sheet'; s.id = 'lyre-sheet';
    // o.describe (round 6): what the sheet is for, read out with its title, not shown.
    s.innerHTML = '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title"' + (o.describe ? ' aria-describedby="sheet-desc"' : '') + (o.wide ? ' style="width:min(900px,100%)"' : '') + '><header><h2 id="sheet-title">' + esc(o.title) + '</h2><button class="closer" data-act="closesheet" title="Close">' + L.icon('close') + '</button></header>' + (o.describe ? '<p class="sr-only" id="sheet-desc">' + o.describe + '</p>' : '') + '<div class="body">' + o.body + '</div>' + (o.footer ? '<footer>' + o.footer + '</footer>' : '') + '</div>';
    document.body.appendChild(s);
    // UX-R1 (0.5.0 review): a greyed control (the first step's Move up) cannot take focus, so it is skipped.
    var f = s.querySelector('.body input:not([disabled]), .body select:not([disabled]), .body textarea:not([disabled]), .body button:not([disabled])') || s.querySelector('button:not([disabled])'); if (f) f.focus();
    s.addEventListener('pointerdown', function (e) { if (e.target === s) L.closeSheet(); });
  };
  L.closeSheet = function () { var s = document.getElementById('lyre-sheet'); if (s) { s.remove(); if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus(); sheetReturn = null; } };
  L.acts.closesheet = function () { L.closeSheet(); };
  document.addEventListener('keydown', function (e) {
    var s = document.getElementById('lyre-sheet'); if (!s || menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); L.closeSheet(); return; }
    if (e.key === 'Tab') { var f = [].slice.call(s.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.offsetParent; }); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  });

  /* ---------- routing ---------- */
  var ROUTES = [
    [/^#\/campaigns$/, 'campaigns', []], [/^#\/campaign\/([\w-]+)$/, 'campaign', ['cid']], [/^#\/session\/([\w-]+)\/([\w-]+)$/, 'session', ['cid', 'sid']],
    [/^#\/library(?:\/([\w-]+))?$/, 'library', ['tid']], [/^#\/playlists$/, 'playlists', []], [/^#\/playlist\/([\w-]+)$/, 'playlist', ['pid']],
    [/^#\/profile\/([\w-]+)(?:\/([\w:-]+))?$/, 'profile', ['tid', 'ctx']], [/^#\/boards$/, 'boards', []], [/^#\/board\/([\w-]+)$/, 'board', ['bid']], [/^#\/live$/, 'live', []], [/^#\/outputs$/, 'outputs', []], [/^#\/look$/, 'look', []],
    [/^#\/tags$/, 'tags', []], [/^#\/backup$/, 'backup', []], [/^#\/moved$/, 'moved', []], [/^#\/relink$/, 'relink', []], [/^#\/settings$/, 'settings', []]
  ];
  L.view = function (name, def) { L.views[name] = def; };
  /* Routes are kept in memory ('#/session/crown/s14'). The page address shows a plain form ('#session--crown--s14'),
     because the artifact host passes only plain #names between its link and the page. */
  var curRoute = null;
  function encodeRoute(h) { return '#' + h.replace(/^#\//, '').split('/').join('--'); }
  function decodeRoute(hash) { var m = (hash || '').replace(/^#\/?/, ''); return m ? '#/' + m.split('--').join('/') : null; }
  function afterRoute(back) {
    L.state.maxed = null; L.closeMenu(); L.render(); var v = document.getElementById('view');
    // Back: the same scroll positions and the control that was used to leave; otherwise focus goes to the heading.
    if (back) {
      v.scrollTop = back.top || 0; v.querySelectorAll('[data-scroll]').forEach(function (s) { if (back.scrolls[s.dataset.scroll] != null) s.scrollTop = back.scrolls[s.dataset.scroll]; });
      var n = back.k && v.querySelector('[data-k="' + back.k + '"]'); if (n) { n.focus({ preventScroll: true }); window.dispatchEvent(new Event('lyre:route')); return; }
    }
    var h = v.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } window.dispatchEvent(new Event('lyre:route'));
  }
  /* UX-18 Back (Nik, 6 Nov 10:34: "I need a contextual back button everywhere."; 17:14: "It should be constantly
     present in the top left of the top bar."; 22:04: "Back should just be a < symbol in a box [...] It should function
     across tabs in the side menu: it should record where I am and where I was before regardless of what happened
     between [...] and should let me go back at least five steps.").
     Back is a ‹ in a box, the first thing in every screen's top bar (Live's strip too), always in the same place. Its
     name and hover say where it goes ("Back to Session 14"). It walks back through one history of places across the
     whole app: every change of screen counts, from the menu, a link or a button, and so does every change within one
     (the Library opening another track, the Audio profile choosing another place). Each press goes one step back to
     where Nik was: the route (so the selected track, playlist or board), every box's scroll position, the open scene
     and the control that was used to leave (the views keep their own open and folded boxes, Live its unfolded scenes).
     HISTORY_MAX places are kept (50; Nik asked for at least 5); a place that no longer exists (a deleted board) is
     skipped. Only at the very start of the history (the first screen since Lyre opened) is Back greyed: aria-disabled,
     still reachable with Tab, its hover says why. Alt+Left and the mouse's back button do the same as Back.
     L.route(h, { from })          goes there and adds the place left to the history
     L.back(fallback)              goes back one place (returns false when there is none)
     L.backButton(fallback)        the button; fallback { route, label } is used when the history is empty (the Audio
                                   profile opened by its address goes back to the scene or session it shows).
     The trail (breadcrumbs, round 6 part 6): a view's crumbs(p) gives its parents, each { href, label }, then its own
     title { label } (the screen's h1, or Live's session). Core draws the parents right after Back, each a link, and
     the screen's h1 that follows is the last part, so the title is not said twice. Back has no words, so it never
     repeats the trail. Both go where the view puts '<!--lead-->', else first in its header (.viewhead or .lv-top). */
  var steps = [], HISTORY_MAX = 50;
  L.HISTORY_MAX = HISTORY_MAX;
  function viewOf(h) { for (var i = 0; i < ROUTES.length; i++) if ((h || '').match(ROUTES[i][0])) return ROUTES[i][1]; return ''; }
  var ROUTE_WORDS = { campaigns: 'Campaigns', library: 'Library', playlists: 'Playlists', boards: 'Pad boards', profile: 'Audio profile', live: 'Live', outputs: 'Rooms',
    look: 'Look and feel', tags: 'Tags', backup: 'Back up, move or share', moved: 'What came across', relink: 'Find missing files', settings: 'Settings' };
  L.routeLabel = function (h) {
    var v = viewOf(h), a = (h || '').replace(/^#\//, '').split('/');
    if (v === 'campaign') return (L.campaign(a[1]) || {}).name || 'Campaign';
    if (v === 'session') { var s = L.session(a[1], a[2]); return s ? 'Session ' + s.n : 'Session'; }
    if (v === 'playlist') return (L.playlist(a[1]) || {}).name || 'Playlist';
    if (v === 'board') return (L.board(a[1]) || {}).name || 'Pad board';
    // A track in the Library, or its Audio profile, is named by the track.
    if (v === 'library' && a[1] && L.track(a[1])) return 'Library: ' + L.title(L.track(a[1]));
    if (v === 'profile' && L.track(a[1])) return 'Audio profile: ' + L.title(L.track(a[1]));
    return ROUTE_WORDS[v] || 'the last screen';
  };
  // Whether a place still exists (a board, playlist, campaign, session or track may have been deleted since).
  function alive(h) {
    var v = viewOf(h), a = (h || '').replace(/^#\//, '').split('/');
    if (v === 'campaign') return !!L.campaign(a[1]);
    if (v === 'session') return !!L.session(a[1], a[2]);
    if (v === 'playlist') return !!L.playlist(a[1]);
    if (v === 'board') return !!L.board(a[1]);
    if (v === 'profile' || (v === 'library' && a[1])) return !!L.track(a[1]);
    return !!v;
  }
  // The control last used in the work area, so Back can put focus there again after Nik left by the menu.
  var lastViewK = '';
  document.addEventListener('focusin', function (e) { var v = document.getElementById('view'); if (v && v.contains(e.target) && e.target.dataset && e.target.dataset.k) lastViewK = e.target.dataset.k; });
  function stepHere(from) {
    var v = document.getElementById('view'), scrolls = {}, a = document.activeElement;
    if (from && !(v && v.contains(from)) && !(from.closest && from.closest('.menu'))) from = null;
    if (a && v && !v.contains(a)) a = null;
    if (v) v.querySelectorAll('[data-scroll]').forEach(function (s) { scrolls[s.dataset.scroll] = s.scrollTop; });
    // A link inside a scene card (or anything marked data-back-label) names that place: "Back to The abbey ruins".
    var named = from && from.closest && from.closest('[data-back-label]');
    // Could 15 of the round 6 review: a link in a menu came from the menu's button; Back puts focus there.
    var viaMenu = from && from.closest && from.closest('.menu') && menuAnchor && menuAnchor.dataset ? menuAnchor.dataset.k : '';
    return { route: curRoute, label: named ? named.dataset.backLabel : L.routeLabel(curRoute), open: named && named.dataset.backOpen ? named.dataset.backOpen : '',
      scrolls: scrolls, top: v ? v.scrollTop : 0, k: viaMenu || (from && from.dataset && from.dataset.k) || (a && a.dataset && a.dataset.k) || lastViewK || '' };
  }
  L.route = function (h, o) {
    o = o || {};
    if (h === curRoute) { L.render(); return; }
    if (!o.back && curRoute) { steps.push(stepHere(o.from)); if (steps.length > HISTORY_MAX) steps.shift(); }
    lastViewK = '';
    curRoute = h;
    try { history.replaceState(null, '', encodeRoute(h)); } catch (e) { /* address bar not available: the route still changes */ }
    afterRoute(o.back);
  };
  function prune() { while (steps.length && (!alive(steps[steps.length - 1].route) || steps[steps.length - 1].route === curRoute)) steps.pop(); }
  L.canGoBack = function () { prune(); return steps.length > 0; };
  L.back = function (fallback) {
    prune();
    var st = steps.pop() || (fallback && fallback.route ? { route: fallback.route, label: fallback.label, scrolls: {}, top: 0, k: fallback.k || '', open: fallback.open || '' } : null);
    if (!st) return false;
    if (st.open) L.state.openScene = { sc: st.open, k: st.k };
    L.route(st.route, { back: st });
    L.say('Back to ' + st.label);
    return true;
  };
  var backFallback = null;
  L.backButton = function (fallback) {
    prune();
    var st = steps[steps.length - 1] || (fallback && fallback.route ? fallback : null); backFallback = steps.length ? null : fallback || null;
    if (!st) return '<button class="btn icon nav-back" data-act="navback" data-k="nav-back" aria-disabled="true" aria-label="Back" title="Nothing to go back to yet: this is the first screen since Lyre opened">' + L.icon('chevleft') + '</button>';
    return '<button class="btn icon nav-back" data-act="navback" data-k="nav-back" aria-keyshortcuts="Alt+ArrowLeft" aria-label="Back to ' + esc(st.label) + '" title="Back to ' + esc(st.label) + ' (Alt+Left)">' + L.icon('chevleft') + '</button>';
  };
  L.acts.navback = function (el) { if (el && el.getAttribute('aria-disabled') === 'true') { L.say('Nothing to go back to yet'); return; } L.back(backFallback); };
  /* The trail: the parents as links, cut in the middle when it is long. With three parents or more only the first and
     the last show, with "…" between; below 640 px of app only the last parent shows after "…" (ui.css). The whole
     path is the hover text, and what "…" stands for is read out in its place. */
  L.trailHTML = function (list) {
    if (!list || list.length < 2) return '';
    var parents = list.slice(0, -1), n = parents.length, full = list.map(function (x) { return x.label; }).join(' › ');
    var names = function (a) { return a.map(function (x) { return x.label; }).join(' › '); };
    var gap = '<li class="c-gap' + (n > 2 ? ' on' : '') + '" title="' + esc(full) + '"><span aria-hidden="true">…</span><span class="sr-only g-cut">' + esc(names(parents.slice(1, -1))) + '</span><span class="sr-only g-mid">' + esc(names(parents.slice(0, -1))) + '</span><span class="sep" aria-hidden="true">›</span></li>';
    return '<nav class="crumbs" aria-label="Breadcrumb" title="' + esc(full) + '"><ol>' + parents.map(function (c, i) {
      var last = i === n - 1;
      return (last && n > 1 ? gap : '') + '<li class="crumb' + (last ? '' : n > 2 && i > 0 ? ' c-cut' : ' c-mid') + '"><a href="' + esc(c.href) + '" data-k="crumb-' + i + '"><span class="ellipsis" title="' + esc(c.label) + '">' + esc(c.label) + '</span></a><span class="sep" aria-hidden="true">›</span></li>';
    }).join('') + '</ol></nav>';
  };
  // Back and the trail go first in the header (or where the view put '<!--lead-->').
  function withBack(html, v, p) {
    var list = v && v.crumbs ? v.crumbs(p) : null;
    var lead = L.backButton(L._backFallback) + L.trailHTML(list); L._backFallback = null;
    html = html.replace('<!--back-->', '');
    if (html.indexOf('<!--lead-->') > -1) return html.replace('<!--lead-->', lead);
    return html.replace(/<div class="(viewhead|lv-top)[^"]*">/, function (m) { return m + lead; });
  }
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.key !== 'ArrowLeft' || e.ctrlKey || e.shiftKey || e.metaKey || menuEl || document.getElementById('lyre-sheet')) return;
    if (L.back(backFallback)) e.preventDefault();
  });
  // The mouse's back button (button 3). Electron on Windows also sends it as the window's 'browser-backward' command.
  document.addEventListener('mouseup', function (e) { if (e.button === 3 && L.back(backFallback)) e.preventDefault(); });
  function resolve() {
    var h = curRoute || '#/campaigns';
    for (var i = 0; i < ROUTES.length; i++) { var m = h.match(ROUTES[i][0]); if (m) { var p = {}; ROUTES[i][2].forEach(function (k, j) { p[k] = m[j + 1]; }); return { name: ROUTES[i][1], p: p }; } }
    return { name: 'live', p: {} };
  }
  L.current = function () { return resolve(); };
  L.paint = paint;
  L.themeFor = function (r) {
    if (L.state.theme !== 'campaign') return L.state.theme;
    var cid = r.p.cid || (r.name === 'live' ? L.state.live.cid : L.state.ctx.cid);
    var c = L.campaign(cid), d = D.defaultTheme || 'candle'; return (r.name === 'campaigns' || r.name === 'look') ? d : (c ? c.theme || d : d);
  };

  /* ---------- rename in place (EDT-1, BUG-21) ----------
     L.startRename(id, onSave, backK): the name `id` turns into a text box where it is (the screen draws
     L.renameBox(id, value, label) while L.renaming(id)). Enter saves, Esc cancels, leaving the box saves; an empty or
     unchanged name saves nothing. Focus goes back to the control with data-k `backK`. */
  var renameAt = null;
  L.renaming = function (id) { return !!renameAt && renameAt.id === id; };
  L.renameBox = function (id, value, label, cls) {
    return '<input class="input ' + (cls || '') + '" type="text" autocomplete="off" data-rename="' + id + '" data-k="rn-' + id + '" aria-label="' + esc(label) + '" placeholder="No name yet" value="' + esc(value) + '" data-was="' + esc(value) + '">';
  };
  L.startRename = function (id, onSave, backK) {
    renameAt = { id: id, onSave: onSave, back: backK };
    L.render();
    var box = document.querySelector('[data-rename="' + id + '"]'); if (box) { box.focus(); box.select(); }
  };
  function finishRename(save) {
    var r = renameAt; if (!r) return; renameAt = null;
    var box = document.querySelector('[data-rename="' + r.id + '"]'), name = box ? box.value.trim() : '';
    // Round 6, part 5: a rename shows the Saved pop-up (after onSave's own announcement, so it is not read out twice).
    if (save && name && box && name !== box.dataset.was) { r.onSave(name); L.saved('name “' + name + '”', { key: 'rn-' + r.id }); }
    L.render();
    var back = r.back && document.querySelector('[data-k="' + r.back + '"]'); if (back) back.focus();
  }
  document.addEventListener('keydown', function (e) {
    if (!e.target || !e.target.dataset || !e.target.dataset.rename) return;
    if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); }
  }, true);
  document.addEventListener('focusout', function (e) { if (renameAt && e.target && e.target.dataset && e.target.dataset.rename) finishRename(true); });

  /* ---------- rendering with focus and scroll kept ---------- */
  function paint(el, html) {
    var a = document.activeElement, k = a && el.contains(a) && a.dataset ? a.dataset.k : null, selStart = a && a.selectionStart, selEnd = a && a.selectionEnd;
    // The screen's heading has no data-k; a redraw gives focus back to the new heading (round 7 part 2).
    var onH1 = !k && a && a.tagName === 'H1' && el.contains(a);
    var scrolls = {}; el.querySelectorAll('[data-scroll]').forEach(function (s) { scrolls[s.dataset.scroll] = s.scrollTop; });
    el.innerHTML = html;
    el.querySelectorAll('[data-scroll]').forEach(function (s) { if (scrolls[s.dataset.scroll] != null) s.scrollTop = scrolls[s.dataset.scroll]; });
    if (k) { var n = el.querySelector('[data-k="' + k + '"]'); if (n) { n.focus({ preventScroll: true }); try { if (selStart != null && n.setSelectionRange) n.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text field */ } } }
    else if (onH1) { var h = el.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }
  var rendering = false;
  L.render = function () {
    if (rendering) return; rendering = true;
    try {
      var r = resolve(), v = L.views[r.name] || { render: function () { return '<div class="viewhead"><h1>' + r.name + '</h1></div><div class="empty">Not built yet.</div>'; } };
      if (r.p.cid) L.state.ctx.cid = r.p.cid;
      var theme = L.themeFor(r); document.documentElement.dataset.theme = theme;
      var app = document.getElementById('app'), w = app.getBoundingClientRect().width;
      var railMin = L.state.rail === 'min' || (L.state.rail === 'auto' && w < 1100);
      paint(document.getElementById('rail'), railHTML(v.nav || r.name, railMin));
      document.getElementById('rail').className = 'rail' + (railMin ? ' min' : '');
      paint(document.getElementById('view'), withBack(v.render(r.p), v, r.p) + (r.name === 'live' ? onAirBar(true) : undoNoteHTML() + onAirBar(false)));
      document.getElementById('view').dataset.view = r.name;
      document.querySelectorAll('#view .col').forEach(function (c) { c.classList.toggle('has-max', !!c.querySelector(':scope > .pane.maxed')); });
      if (v.after) v.after(document.getElementById('view'), r.p);
      paintProto(r, v, theme);
      if (L.paintHelp) L.paintHelp();
      L.placeToasts();
    } finally { rendering = false; }
  };
  /* UX-16 the Now playing bar, and the destination tags used everywhere sound is shown (round 5, Nik's notes of
     5 Nov 21:17 and 21:18). Every sound goes somewhere, and the tag says where in words, an icon and a colour:
       On air  (filled, the on-air colour, broadcast icon)  the players hear it; with the room's name when there are
                two or more rooms ("On air · Side room"), or "On air · no room" while no bot is in a voice channel.
       Only you (outlined, the preview colour, headphones)  a preview: only the game master hears it.
     L.destTag('air'|'you', roomName, paused) draws one; Live's room boxes and track badges use the same tags.
     The bar sits at the bottom of every screen while anything plays or is paused, and goes when everything stops. It
     has one row per room that is playing (music or ambience) and one row for the preview, so both can show at once.
     A room row: the track (the scene's name for it, DAT-14, its own name on hover), where it comes from, the ambience
     under it and how many effects sound there, the time, Pause/Play, Stop (that room), Next, the play order of the
     playlist it comes from (PLY-13), that room's volume, and Go to Live (first row, outside Live). The preview row:
     the track, where it was previewed from, the time, Pause/Play, Stop and the headphone volume.
     In Live the room boxes show what each room hears, so the bar there has the preview row only. Effects alone do not
     bring a row up (they are short): Play on air on an effect says "Effect on air: …". */
  // nobody (round 6 review, Should 10): the hover text when the players do not hear it after all (no room, or nobody
  // in the room's channel); the tag is then outlined in the warning colour, not filled.
  L.destTag = function (kind, room, paused, nobody) {
    var you = kind === 'you', words = you ? 'Only you' : 'On air' + (room ? ' · ' + room : '');
    return '<span class="dest ' + (you ? 'you' : 'air') + (paused ? ' paused' : '') + (nobody ? ' warn' : '') + '" title="' + (you ? 'Only you hear this, in your headphones' : nobody ? esc(nobody) : 'The players hear this' + (room ? ' in ' + esc(room) : '')) + '">' +
      L.icon(you ? 'headphones' : 'broadcast', 's') + '<span class="ellipsis">' + esc(words) + '</span></span>';
  };
  function originOf(c) {
    var key = L.lanePlace(c), kind = L.placeKind(key), p = c.playlistId && L.playlist(c.playlistId);
    if (kind === 'scene') return 'Scene: ' + L.placeLabel(key) + (p ? ' · ' + p.name : '');
    if (p) return 'Playlist: ' + p.name + (kind ? ' · ' + L.placeLabel(key) : '');
    return 'Single track';
  }
  L.onAirOrigin = originOf;
  var SCREEN_NAMES = { campaigns: 'Campaigns', campaign: 'the campaign page', session: 'the session planner', library: 'the Library', playlists: 'Playlists', playlist: 'the playlist', boards: 'Pad boards', board: 'the pad board', profile: 'the Audio profile', live: 'Live', outputs: 'Rooms', backup: 'Back up, move or share', moved: 'What came across', relink: 'Find missing files', settings: 'Settings' };
  L.previewVol = 80;
  function roomRow(r, named, first, inLive) {
    var m = r.mix, c = m.music || m.amb, ln = m.music ? 'music' : 'amb', target = r.main ? 'table' : r.id, pk = ln + (r.main ? '' : '@' + r.id);
    var t = L.track(c.id), key = L.lanePlace(c), nm = L.nameIn(t, key), own = L.title(t), paused = !!c.paused, word = ln === 'music' ? 'music' : 'ambience';
    var bot = r.bots && r.bots[0], nobody = !!bot && bot.status === 'connected' && !L.botListeners(bot).length;
    // UX-R9 (round 6 part 4 #10): a room nobody is in is tagged On air · nobody there, in the warning colour.
    var room = r.none ? 'no room' : nobody ? 'nobody there' : named ? r.name : '', where = r.none ? '' : ' in ' + r.name, fx = L.fxFor(target).length, k = 'oab-' + (r.main ? 't' : r.id);
    var canNext = !!(c.seq || c.playlistId);
    return '<div class="oab-row air' + (paused ? ' paused' : '') + '" role="group" aria-label="' + (paused ? 'Paused' : 'On air') + (room ? ': ' + esc(room) : '') + (nobody ? ' in ' + esc(r.name) : '') + '">' +
      '<span class="oab-dest">' + L.destTag('air', room, paused, r.none ? 'Nobody hears it: no bot is in a voice channel' : nobody ? 'Nobody hears it: nobody is in ' + esc(r.name) : '') + (paused ? '<span class="badge oab-paused">Paused</span>' : '') + '</span>' +
      '<div class="oab-now"><div class="oab-title ellipsis" title="' + esc((nm !== own ? 'Its own name: ' + own : own) + ' · ' + L.normHover(t, c.playlistId)) + '"><span class="lane-dot ' + ln + '" aria-hidden="true"></span><span class="ellipsis">' + esc(nm) + '</span>' +
        (nm !== own ? '<span class="sr-only"> (its own name: ' + esc(own) + ')</span>' : '') + '</div>' +
        '<div class="oab-from ellipsis" title="' + esc(originOf(c)) + '">' + esc(originOf(c)) + (m.music && m.amb ? ' · <span class="lane-dot amb" aria-hidden="true"></span>Ambience: ' + esc(L.title(L.track(m.amb.id))) : '') +
        (fx ? ' · ' + fx + ' effect' + (fx > 1 ? 's' : '') + ' sounding' : '') + (r.none ? ' · No bot is in a voice channel: nobody hears it' : '') +
        '</div></div>' +
      '<div class="oab-time"><div class="progress ' + ln + '"><span data-progress="' + pk + '"></span></div><span class="num" data-time="' + pk + '"></span></div>' +
      '<div class="oab-ctl" role="group" aria-label="Control what the players hear' + esc(where) + '">' +
        '<button class="btn s icon" data-act="oabpause" data-lane="' + ln + '" data-room="' + target + '" data-k="' + k + '-pause" aria-label="' + (paused ? 'Play' : 'Pause') + '" title="' + (paused ? 'Play the ' + word + ' again' : 'Pause the ' + word) + esc(where) + '">' + L.icon(paused ? 'play' : 'pause', 's') + '</button>' +
        '<button class="btn s" data-act="oabstop" data-room="' + target + '" data-k="' + k + '-stop" title="Stop what the players hear' + esc(where) + ' (fades out in a second)">' + L.icon('stop', 's') + 'Stop</button>' +
        '<button class="btn s icon" data-act="oabnext" data-lane="' + ln + '" data-room="' + target + '" data-k="' + k + '-next" aria-label="Next" title="' + (canNext ? 'Next track (crossfade)' : 'A single track has no next one') + '"' + (canNext ? '' : ' disabled') + '>' + L.icon('next', 's') + '</button>' +
        L.shuffleButton(ln, target, k + '-shuf') + L.repeatButton(ln, target, k + '-rep') +
        // Round 7 (PLY-1): what played in this room tonight, with Play again (r7play.js).
        (L.historyButton ? L.historyButton(target, r.name, k) : '') + '</div>' +
      (bot ? '<label class="oab-vol" title="Volume of what the players hear' + esc(where) + '">' + L.icon('volume', 's') + '<span class="sr-only">Volume' + esc(where) + '</span><input type="range" min="0" max="100" step="5" value="' + bot.volume + '" data-input="oabvol" data-bot="' + bot.id + '" data-k="' + k + '-vol" aria-valuetext="' + bot.volume + ' percent"></label>' : '') +
      (first && !inLive ? '<a class="btn s" href="#/live" data-k="oab-live">' + L.icon('broadcast', 's') + 'Go to Live</a>' : '') + '</div>';
  }
  function previewRow() {
    var p = pb.preview, paused = !!p.paused, from = p.from ? 'Previewed from ' + p.from : 'Preview';
    return '<div class="oab-row you' + (paused ? ' paused' : '') + '" role="group" aria-label="Only you' + (paused ? ': paused' : '') + '">' +
      '<span class="oab-dest">' + L.destTag('you', '', paused) + (paused ? '<span class="badge oab-paused">Paused</span>' : '') + '</span>' +
      '<div class="oab-now"><div class="oab-title ellipsis" title="' + esc(p.label + (L.track(p.id) ? ' · ' + L.normHover(L.track(p.id), p.playlistId) : '')) + '"><span class="lane-dot preview" aria-hidden="true"></span><span class="ellipsis">' + esc(p.label) + '</span></div>' +
        '<div class="oab-from ellipsis" title="' + esc(from) + '">' + esc(from) + '</div></div>' +
      '<div class="oab-time"><div class="progress preview"><span data-progress="preview"></span></div><span class="num" data-time="preview"></span></div>' +
      '<div class="oab-ctl" role="group" aria-label="Control your preview">' +
        '<button class="btn s icon" data-act="pvpause" data-k="oab-pv-pause" aria-label="' + (paused ? 'Play the preview' : 'Pause the preview') + '" title="' + (paused ? 'Play the preview again' : 'Pause the preview') + '">' + L.icon(paused ? 'play' : 'pause', 's') + '</button>' +
        '<button class="btn s" data-act="pvstop" data-k="oab-pv-stop" aria-label="Stop the preview" title="Stop the preview">' + L.icon('stop', 's') + 'Stop</button></div>' +
      '<label class="oab-vol" title="Volume in your headphones">' + L.icon('headphones', 's') + '<span class="sr-only">Headphone volume</span><input type="range" min="0" max="100" step="5" value="' + L.previewVol + '" data-input="pvvol" data-k="oab-pv-vol" aria-valuetext="' + L.previewVol + ' percent"></label></div>';
  }
  function onAirBar(inLive) {
    var rows = [];
    if (!inLive) {
      var rs = L.rooms(), named = rs.length > 1;
      if (!rs.length) rs = [{ id: 'table', name: '', mix: pb, main: true, none: true }];
      rs.filter(function (r) { return r.mix.music || r.mix.amb; }).forEach(function (r, i) { rows.push(roomRow(r, named, i === 0, inLive)); });
    }
    if (pb.preview) rows.push(previewRow());
    if (!rows.length) return '';
    return '<div class="onairbar" role="region" aria-label="Now playing"><div class="oab-rows">' + rows.join('') + '</div></div>';
  }
  L.acts.oabpause = function (el) { var ln = el.dataset.lane, rm = el.dataset.room; L.pauseLane(ln, rm); var c = L.mix(rm)[ln]; L.say(c && c.paused ? 'Paused' : 'Playing again'); };
  L.acts.oabnext = function (el) { L.next(el.dataset.lane, el.dataset.room); };
  L.inputs.oabvol = function (el, ev) { var b = L.bot(el.dataset.bot) || D.discord.bots[0]; b.volume = +el.value; el.setAttribute('aria-valuetext', b.volume + ' percent'); if (ev.type === 'change') L.changed(); };
  L.acts.oabstop = function (el) { var rm = el.dataset.room; L.stopLane('music', 1, rm); L.stopLane('amb', 1, rm); L.say('Stopped'); };
  L.acts.pvpause = function () { if (pb.preview) { pb.preview.paused = !pb.preview.paused; L.say(pb.preview.paused ? 'Preview paused' : 'Preview playing again'); L.changed(); } };
  L.acts.pvstop = function () { L.stopPreview(); L.say('Preview stopped'); };
  L.inputs.pvvol = function (el, ev) { L.previewVol = +el.value; el.setAttribute('aria-valuetext', L.previewVol + ' percent'); if (ev.type === 'change') L.changed(); };

  /* Undo for changes that remove or reset much at once (w3-ux 10): Reset to whole track, Delete board, Delete scene,
     Tag… on many tracks. Like the board's resize message: what happened, Undo, and a close button; Ctrl+Z also
     undoes it (Live has its own Ctrl+Z). L.snapshot(['boards', 'campaigns']) copies those data lists before the
     change; L.undoNote(text, restore) shows the message until another one replaces it or it is closed. */
  var undoNote = null;
  L.snapshot = function (keys) {
    var copy = JSON.parse(JSON.stringify(keys.map(function (k) { return D[k]; })));
    return function () {
      keys.forEach(function (k, i) {
        var cur = D[k], was = copy[i];
        if (Array.isArray(cur)) cur.splice.apply(cur, [0, cur.length].concat(was));
        else { Object.keys(cur).forEach(function (x) { delete cur[x]; }); Object.assign(cur, was); }
      });
    };
  };
  L.undoNote = function (text, restore) { undoNote = { text: text, restore: restore }; };
  function undoNoteHTML() {
    return undoNote ? '<div class="undo-note" role="group" aria-label="Undo">' + L.icon('check', 's') + '<span class="grow">' + esc(undoNote.text) + '</span>' +
      '<button class="btn s" data-act="undonote" data-k="undo-note">Undo</button><button class="closer" data-act="undonotex" data-k="undo-notex" title="Dismiss" aria-label="Dismiss message">' + L.icon('close') + '</button></div>' : '';
  }
  L.acts.undonote = function () {
    var n = undoNote; if (!n) return; undoNote = null; n.restore();
    L.say('Undone: ' + n.text); L.toast('Undone'); L.render();
    var h = document.querySelector('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  };
  L.acts.undonotex = function () { undoNote = null; L.render(); var h = document.querySelector('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } };
  document.addEventListener('keydown', function (e) {
    if (!undoNote || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
    if (typing(e.target) || resolve().name === 'live' || document.getElementById('lyre-sheet')) return;
    e.preventDefault(); L.acts.undonote();
  });
  function outputsBadge() { var n = D.discord.bots.filter(function (b) { return b.status === 'connected'; }).length; return ' (' + n + '/' + D.discord.bots.length + ')'; }
  function railHTML(cur, min) {
    // UX-R15 (0.5.0 review): hint, the link's hover text (what Rooms (1/2) counts).
    function a(href, nav, icon, label, hint) { return '<a href="' + href + '" data-k="rail-' + nav + '"' + (cur === nav ? ' aria-current="page"' : '') + (hint || min ? ' title="' + (hint || label) + '"' : '') + '>' + L.icon(icon) + '<span class="lbl">' + label + '</span></a>'; }
    var s = L.session(L.state.live.cid, L.state.live.sid);
    return '<div class="logo">' + L.logo + '<b>Lyre</b></div><nav aria-label="Lyre"><div class="stack" style="gap:2px">' +
      a('#/campaigns', 'campaigns', 'crown', 'Campaigns') + a('#/library', 'library', 'library', 'Library') + a('#/playlists', 'playlists', 'playlist', 'Playlists') + a('#/boards', 'boards', 'grid', 'Pad boards') +
      a('#/live', 'live', 'broadcast', 'Live' + (s ? ': S' + s.n : '')) + a('#/outputs', 'outputs', 'users', 'Rooms' + outputsBadge(), (function () { var n = D.discord.bots.filter(function (b) { return b.status === 'connected'; }).length, m = D.discord.bots.length; return n + ' of ' + m + (m === 1 ? ' bot is' : ' bots are') + ' in a room'; })()) + '</div></nav>' +
      '<div class="bottom stack" style="gap:2px">' + a('#/settings', 'settings', 'gear', 'Settings') + a('#/look', 'look', 'palette', 'Look and feel') +
      // FND-8: Help, beside Look and feel (views/help.js). It opens a side panel, not a screen, so it is a button.
      '<button class="nav" data-act="help" data-k="rail-help" aria-controls="lyre-help" aria-expanded="' + !!(L.helpOpen && L.helpOpen()) + '" aria-keyshortcuts="F1"' + (min ? ' title="Help"' : '') + '>' + L.icon('help') + '<span class="lbl">Help</span></button>' +
      '<button class="nav" data-act="rail" data-k="railtoggle" title="' + (min ? 'Show labels' : 'Icons only') + '" aria-label="' + (min ? 'Show menu labels' : 'Show icons only') + '">' + L.icon(min ? 'chevright' : 'chevleft') + '<span class="lbl">Icons only</span></button></div>';
  }
  /* Prep and Live for the campaign in hand: L.modeSwitch(cid) gives a two-button switch for a view header.
     Prep opens the session loaded in Live (or the campaign's next session); Live loads that campaign's session. */
  L.nextSession = function (c) { return c.sessions.filter(function (s) { return s.status === 'next'; })[0] || c.sessions[c.sessions.length - 1]; };
  L.modeSwitch = function (cid) {
    var r = resolve(), live = r.name === 'live';
    return '<div class="seg mode-switch" role="group" aria-label="Prep or live"><button data-act="mode" data-mode="prep" data-cid="' + esc(cid) + '" data-k="mode-prep" aria-pressed="' + !live + '">' + L.icon('edit', 's') + 'Prep</button>' +
      '<button data-act="mode" data-mode="live" data-cid="' + esc(cid) + '" data-k="mode-live" aria-pressed="' + live + '">' + L.icon('broadcast', 's') + 'Live</button></div>';
  };
  L.acts.mode = function (el) {
    var c = L.campaign(el.dataset.cid); if (!c) return; var lv = L.state.live, r = resolve();
    if (el.dataset.mode === 'live') {
      if (r.name === 'live') return;
      var sid = r.p.sid && r.p.cid === c.id ? r.p.sid : (lv.cid === c.id ? lv.sid : L.nextSession(c).id);
      if (lv.cid !== c.id || lv.sid !== sid) { if (L.liveStandby) L.liveStandby(c.id, sid); else { lv.cid = c.id; lv.sid = sid; lv.scene = 0; lv.standby = 1; } }
      L.route('#/live');
    } else {
      if (r.name !== 'live') return;
      L.route('#/session/' + lv.cid + '/' + lv.sid);
    }
  };
  L.acts.rail = function () { var min = document.getElementById('rail').classList.contains('min'); L.state.rail = min ? 'full' : 'min'; L.save(); L.render(); };

  /* ---------- prototype strip and notes (not part of Lyre) ---------- */
  var THEMES = [['campaign', "Each campaign's own"], ['candle', 'Candlelit Library (default)'], ['fern', 'Fern and Brass (logo)'], ['hearth', 'Hearth and Iron (D&D)'], ['parchment', 'Parchment (light)'], ['elysium', 'Elysium (Vampire)']];
  var FRAMES = [['half', 'Half of a 1920 screen (960 px)'], ['half1280', 'Half of a 2560 screen (1280 px)'], ['third', 'Narrow (720 px)'], ['full', 'Whole window']];
  L.THEMES = THEMES;
  function paintProto(r, v, theme) {
    var p = document.getElementById('proto');
    if (!p.dataset.built) {
      p.dataset.built = 1;
      p.innerHTML = '<b>Lyre · design round 6</b><span>Clickable prototype, no real sound.</span>' +
        '<label>Theme <select id="pTheme">' + THEMES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
        '<label>Screen <select id="pFrame">' + FRAMES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
        '<button id="pNotes" type="button">Design notes</button>' +
        // Round 6, part 5: a failed save cannot happen in the prototype, so this makes the next save fail, to show it.
        '<button id="pFail" type="button" title="The next thing you save fails, to show the failed-save pop-up">Make the next save fail</button>';
      p.querySelector('#pTheme').addEventListener('change', function (e) { L.state.theme = e.target.value; L.save(); L.render(); });
      p.querySelector('#pFrame').addEventListener('change', function (e) { L.state.frame = e.target.value; L.save(); applyFrame(); L.render(); });
      p.querySelector('#pNotes').addEventListener('click', function () { L.state.notes = !L.state.notes; L.save(); L.render(); });
      p.querySelector('#pFail').addEventListener('click', function () { L.failNextSave(); L.say('The next save fails'); });
    }
    p.querySelector('#pTheme').value = L.state.theme; p.querySelector('#pFrame').value = L.state.frame;
    p.querySelector('#pNotes').setAttribute('aria-pressed', String(L.state.notes));
    var n = document.getElementById('notes'), notes = v.notes || [];
    n.hidden = !L.state.notes || !notes.length;
    n.innerHTML = '<h2>' + esc(v.notesTitle || 'What changed here') + '</h2><ul>' + notes.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
  }
  function applyFrame() {
    var w = { half: 960, half1280: 1280, third: 720 }[L.state.frame];
    var sw = document.getElementById('stagewrap'); sw.classList.toggle('half', !!w); sw.style.setProperty('--frame-w', (w || 0) + 'px');
  }

  /* ---------- events ---------- */
  function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  L.typing = typing;
  L.onKey = function (fn) { L.keys.push(fn); };
  // F6 / Shift+F6 jump between boxes (pane headers), so the keyboard can reach any box quickly.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'F6' || menuEl || document.getElementById('lyre-sheet') || (L.f6Taken && L.f6Taken())) return;
    // A view may give its own order (Live: the order of its boxes on screen, the same as Alt+1 to Alt+7).
    var heads = ((L.f6Order && L.f6Order()) || [].slice.call(document.querySelectorAll('#view .pane-toggle'))).filter(function (b) { return b.offsetParent; }); if (!heads.length) return;
    e.preventDefault(); var cur = document.activeElement && document.activeElement.closest('.pane'), i = -1;
    heads.forEach(function (h, j) { if (cur && cur.contains(h)) i = j; });
    var n = heads[(i + (e.shiftKey ? -1 : 1) + heads.length) % heads.length]; n.focus(); n.scrollIntoView({ block: 'nearest' }); L.say(n.textContent.trim());
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var f = L.acts[el.dataset.act]; if (!f) return; e.preventDefault();
    if (menuEl && menuEl.contains(el) && !el.dataset.keepMenu) {
      // After a menu choice, focus goes back to the button that opened the menu (found again by data-k after a re-render).
      var k = menuAnchor && menuAnchor.dataset ? menuAnchor.dataset.k : null; L.closeMenu(); f(el, e);
      if (k && (!document.activeElement || document.activeElement === document.body)) { var n = document.querySelector('[data-k="' + k + '"]'); if (n) n.focus(); }
      return;
    }
    f(el, e);
  });
  ['input', 'change'].forEach(function (type) {
    document.addEventListener(type, function (e) { var el = e.target.closest('[data-input]'); if (!el) return; var f = L.inputs[el.dataset.input]; if (f && (type === 'input' || el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'range')) f(el, e); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || menuEl || document.getElementById('lyre-sheet')) return;
    for (var i = 0; i < L.keys.length; i++) if (L.keys[i](e)) { e.preventDefault(); return; }
  });
  // An address typed or pasted is a place like any other: the one left goes into Back's history.
  window.addEventListener('hashchange', function () { var r = decodeRoute(location.hash); if (r && r !== curRoute) L.route(r); });
  // In-app links (href="#/...") change the route without touching the page address directly.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest('a[href^="#/"]'); if (!a) return;
    // From the menu too (round 6 part 7): every place goes into Back's history.
    e.preventDefault(); L.route(a.getAttribute('href'), a.closest('#rail') ? {} : { from: a });
  });
  window.addEventListener('resize', function () { clearTimeout(L._rz); L._rz = setTimeout(L.render, 120); });
  L.boot = function () { applyFrame(); curRoute = decodeRoute(location.hash) || '#/campaigns'; L.render(); };
  return L;
})();
