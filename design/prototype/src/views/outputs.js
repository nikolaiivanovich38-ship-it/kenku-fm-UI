/* Outputs (#/outputs): where Lyre's sound goes in Discord, and moving bots between rooms during play.

   Round 4 model (core, "Rooms"): every bot in a voice channel is a room named after its channel, and every room plays
   its own sound (L.mix(botId), L.fxFor(botId)). What Nik starts goes to the rooms ticked in Send to
   (L.state.sendTo, L.sendTargets(); chosen in Live, not here).

   One On air box per bot (kind onair, one status pill: Playing / Silent / Muted / Joining / Not in a room): the room
   name as its title and a quiet "via <bot>" line, Room (server › channel, a menu of every voice channel to move it),
   what that room is playing now, who hears it, volume and a level meter; Mute and Test in the header. A box whose room
   is not playing gets class is-silent (core keeps the red edge for rooms the players hear).
   All voice channels (kind plain): every channel with who is in it, which bot is there, and Bring… to move a bot there.

   For the Live view: L.botsMenuHTML() returns a compact menu (each room and its bot, the rooms it can move to, Leave,
   Open Outputs) for L.menu(anchor, L.botsMenuHTML(), 'Discord'). Its items use data-act opmove / opleave /
   opgo, handled here. Candidates for core: L.botsMenuHTML and L.botSwap. */
(function () {
  var esc = L.esc, D = L.data;
  var testUntil = {};   // bot id -> time the test chime ends (the meter moves while it plays)

  /* ---------- small helpers ---------- */
  var PATHS = {
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    off: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8',
    mute: 'M3 10v4h3l8 5V5L6 10zM17 9.5l5 5M22 9.5l-5 5',
    swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7'
  };
  function ic(n, cls) { return PATHS[n] ? '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + PATHS[n] + '"/></svg>' : L.icon(n, cls); }
  function people(n) { return n ? n + (n === 1 ? ' person' : ' people') : 'Nobody here'; }
  function inRoom(b) { return b.status === 'connected' || b.status === 'connecting'; }
  function roomBots(sid, cid) { return L.bots().filter(function (b) { return inRoom(b) && b.server === sid && b.channel === cid; }); }
  function sharing(b) { return inRoom(b) ? roomBots(b.server, b.channel).filter(function (x) { return x !== b; }) : []; }
  function chName(b) { var c = L.channel(b.server, b.channel); return c ? c.name : ''; }
  function names(list) { return list.map(function (b) { return b.name; }).join(' and '); }
  function roomCount() { return L.bots().filter(inRoom).length; }
  function fxOn(b) { return L.fxFor(b.id).filter(function (f) { return !f.fadeOut; }); }
  function playing(b) { var m = L.mix(b.id); return !!((m.music && !m.music.paused) || (m.amb && !m.amb.paused) || fxOn(b).length); }
  // The one status pill per box (words from the round 4 list).
  function pill(b) {
    if (b.status === 'error') return { text: 'Could not join', tone: 'warn' };
    if (b.status === 'connecting') return { text: 'Joining', tone: 'warn' };
    if (!inRoom(b)) return { text: 'Not in a room', tone: 'idle' };
    if (b.muted) return { text: 'Muted', tone: 'idle' };
    if (playing(b)) return { text: 'Playing', tone: 'live' };
    var m = L.mix(b.id); if (m.music && m.music.paused) return { text: 'Paused', tone: 'idle' };
    return { text: 'Silent', tone: 'idle' };
  }
  function suffix(b) { return L.mix(b.id) === L.pb ? '' : '@' + b.id; }

  /* ---------- moving bots ---------- */
  // One menu item per voice channel, for one bot, grouped by server.
  // compact (the Live menu): one line per room with a short note; otherwise a second line for people and a warning line.
  function roomItems(b, compact) {
    return D.discord.servers.map(function (g) {
      var items = g.channels.map(function (c) {
        var here = inRoom(b) && b.server === g.id && b.channel === c.id, others = roomBots(g.id, c.id).filter(function (x) { return x !== b; }), n = c.members.length;
        var attrs = 'role="menuitemradio" aria-checked="' + here + '" data-act="opmove" data-bot="' + b.id + '" data-server="' + g.id + '" data-channel="' + c.id + '"';
        var mark = here ? L.icon('check', 's') : L.icon('horn', 's');
        if (compact) {
          var w = others.length ? esc(names(others)) + ' here: heard twice' : !n ? (here ? 'Nobody listening' : 'Empty') : '';
          var note = w ? '<span class="op-mi-w">' + ic('alert', 's') + w + '</span>' : '<span class="op-mi-s">' + people(n) + '</span>';
          return '<button ' + attrs + ' class="op-mi op-mi1' + (here ? ' here' : '') + '"' + (w ? ' title="' + (others.length ? 'Players would hear it twice' : 'Nobody would hear it') + '"' : '') + '>' + mark + '<span class="op-mi-n ellipsis grow">' + esc(c.name) + '</span>' + note + '</button>';
        }
        var sub = [here ? 'Here now' : '', n ? people(n) : ''].filter(Boolean).join(' · ');
        var warn = others.length ? esc(names(others)) + ' is here: players would hear it twice' : !n ? (here ? 'Nobody is listening' : 'Empty: nobody would hear it') : '';
        return '<button ' + attrs + ' class="op-mi' + (here ? ' here' : '') + '">' + mark + '<span class="grow op-mi-t"><span class="op-mi-n">' + esc(c.name) + '</span>' + (sub ? '<span class="op-mi-s">' + sub + '</span>' : '') +
          (warn ? '<span class="op-mi-w">' + ic('alert', 's') + warn + '</span>' : '') + '</span></button>';
      }).join('');
      return '<div class="group' + (compact ? ' op-mg2' : '') + '">' + esc(g.name) + '</div>' + items;
    }).join('');
  }
  function leaveItem(b) { return inRoom(b) ? '<div class="sep"></div><button role="menuitem" data-act="opleave" data-bot="' + b.id + '">' + ic('off', 's') + 'Leave ' + esc(chName(b)) + '</button>' : ''; }
  L.botsMenuHTML = function () {
    return '<div class="op-menu">' + L.bots().map(function (b) {
      return '<div role="group" aria-label="' + esc(L.outputName(b)) + '"><div class="group op-mg">' + esc(L.outputName(b)) + (inRoom(b) ? ' <span class="op-mg-bot">' + esc(b.name) + '</span>' : '') + ': ' + esc(pill(b).text) + '</div>' +
        roomItems(b, true) + leaveItem(b) + '</div>';
    }).join('<div class="sep"></div>') + '<div class="sep"></div><button role="menuitem" data-act="opgo">' + L.icon('users', 's') + 'Open Outputs</button></div>';
  };
  // After a choice in a menu the menu is gone; on this page, put focus back on that bot's Room button.
  function refocus(botId) { setTimeout(function () { var a = document.activeElement; if (a && a !== document.body && document.contains(a)) return; var r = document.querySelector('[data-k="op-room-' + botId + '"]'); if (r) r.focus(); }, 0); }
  L.acts.opmove = function (el) {
    var b = L.bot(el.dataset.bot), sid = el.dataset.server, cid = el.dataset.channel, c = L.channel(sid, cid); if (!b || !c) return;
    if (inRoom(b) && b.server === sid && b.channel === cid) { L.toast(b.name + ' is already in ' + c.name); return; }
    var others = roomBots(sid, cid).filter(function (x) { return x !== b; });
    L.botJoin(b.id, sid, cid);
    if (others.length) L.toast(b.name + ' is joining ' + c.name + ', where ' + names(others) + ' already plays: players will hear it twice');
    else if (!c.members.length) L.toast(b.name + ' is joining ' + c.name + '. Nobody is there yet.');
    else L.toast(b.name + ' is joining ' + c.name);
    refocus(b.id);
  };
  L.acts.opleave = function (el) { var b = L.bot(el.dataset.bot); if (b) { var w = chName(b); L.botLeave(b.id); L.toast(b.name + ' left ' + w); refocus(b.id); } };
  L.acts.opgo = function () { L.route('#/outputs'); };
  L.acts.opretry = function (el) { var b = L.bot(el.dataset.bot); if (b && b.server && b.channel) L.botJoin(b.id, b.server, b.channel); };
  L.acts.oproom = function (el) { var b = L.bot(el.dataset.bot); L.menu(el, '<div class="op-menu" role="group" aria-label="Rooms for ' + esc(b.name) + '">' + roomItems(b, false) + leaveItem(b) + '</div>', 'Room for ' + b.name); };
  // Bring…: the bots that could move to this channel, each with what the move means.
  L.acts.opbring = function (el) {
    var sid = el.dataset.server, cid = el.dataset.channel, c = L.channel(sid, cid), here = roomBots(sid, cid), n = c.members.length;
    L.menu(el, '<div class="op-menu"><div class="group">Bring a bot to ' + esc(c.name) + '</div>' + L.bots().filter(function (b) { return here.indexOf(b) < 0; }).map(function (b) {
      var w = here.length ? names(here) + ' is here: players would hear it twice' : !n ? 'Empty: nobody would hear it' : '';
      return '<button role="menuitem" class="op-mi" data-act="opmove" data-bot="' + b.id + '" data-server="' + sid + '" data-channel="' + cid + '">' + L.icon('arrow', 's') + '<span class="grow op-mi-t"><span class="op-mi-n">' + esc(b.name) + '</span><span class="op-mi-s">' + (inRoom(b) ? 'Leaves ' + esc(chName(b)) : 'Not in a room now') + '</span>' +
        (w ? '<span class="op-mi-w">' + ic('alert', 's') + esc(w) + '</span>' : '') + '</span></button>';
    }).join('') + '</div>', 'Bring a bot to ' + c.name);
  };
  // Swap the rooms of the two bots that are in rooms (both rejoin; about a second each, as in Lyre 0.2).
  function swapPair() { var bs = L.bots().filter(inRoom); return bs.length === 2 && !(bs[0].server === bs[1].server && bs[0].channel === bs[1].channel) ? bs : null; }
  L.botSwap = function () {
    var p = swapPair(); if (!p) return; var a = p[0], b = p[1], s = a.server, c = a.channel;
    a.server = b.server; a.channel = b.channel; b.server = s; b.channel = c; a.status = b.status = 'connecting';
    L.say('Swapping rooms: ' + a.name + ' to ' + chName(a) + ', ' + b.name + ' to ' + chName(b)); L.changed();
    setTimeout(function () { [a, b].forEach(function (x) { if (x.status === 'connecting') x.status = 'connected'; }); L.say(a.name + ' is in ' + L.botWhere(a) + '; ' + b.name + ' in ' + L.botWhere(b)); L.changed(); }, 1100);
  };
  L.acts.opswap = function () { L.botSwap(); };
  L.acts.opmute = function (el) { L.botMute(el.dataset.bot); };
  L.acts.optest = function (el) {
    var b = L.bot(el.dataset.bot); if (!b) return;
    if (b.status !== 'connected') { L.toast(b.name + (b.status === 'connecting' ? ' is still joining. Try again in a moment.' : ' is not in a voice channel. Choose a room first.')); return; }
    if (b.muted) { L.toast(chName(b) + ' is muted: unmute it to hear the test chime'); return; }
    var n = L.botListeners(b).length; testUntil[b.id] = Date.now() + 1600;
    L.toast('Test chime in ' + chName(b) + ' only' + (n ? ' (' + people(n).toLowerCase() + ' there)' : ': nobody is there to hear it'));
    L.say('Test chime played in ' + L.botWhere(b));
  };
  // Volume: dragging updates the number only; letting go saves it (re-rendering while dragging would drop the thumb).
  L.inputs.opvol = function (el, ev) {
    var b = L.bot(el.dataset.bot); if (!b) return;
    if (ev.type === 'input') { b.volume = +el.value; var o = document.getElementById('op-vo-' + b.id); if (o) o.textContent = el.value + '%'; }
    else L.botVolume(b.id, el.value);
  };

  /* ---------- level meters: move while the room is playing (or a test chime plays) ---------- */
  setInterval(function () {
    var els = document.querySelectorAll('[data-opmeter]'); if (!els.length) return;
    var t = Date.now() / 1000;
    els.forEach(function (el, i) {
      var b = L.bot(el.dataset.opmeter); if (!b) return;
      var on = playing(b), m = L.mix(b.id), mv = m.music ? m.music.vol : 1;
      var live = b.status === 'connected' && !b.muted && (on || testUntil[b.id] > Date.now());
      var lv = live ? (0.42 + 0.3 * Math.abs(Math.sin(t * 2.1 + i * 1.7)) + 0.22 * Math.random()) * (on ? Math.max(.35, mv) : .8) * b.volume / 100 : 0;
      el.style.width = Math.round(Math.min(1, lv) * 100) + '%';
    });
  }, 160);

  /* ---------- one On air box per bot ---------- */
  function playingHTML(b) {
    var m = L.mix(b.id), sx = suffix(b), rows = [], fx = fxOn(b);
    ['music', 'amb'].forEach(function (ln) {
      var c = m[ln]; if (!c) return; var name = L.title(L.track(c.id));
      rows.push('<div class="op-pl"><span class="lane-dot ' + ln + '"></span><span class="sr-only">' + (ln === 'music' ? 'Music' : 'Ambience') + ': </span><span class="ellipsis grow" title="' + esc(name) + '">' + esc(name) + '</span>' +
        (c.paused ? '<span class="hint">Paused</span>' : '') + '<span class="progress ' + ln + ' op-pp" aria-hidden="true"><span data-progress="' + ln + sx + '"></span></span></div>');
    });
    if (fx.length) rows.push('<div class="op-pl"><span class="lane-dot fx"></span><span class="sr-only">Effects: </span><span class="ellipsis grow" title="' + esc(fx.map(function (f) { return f.label; }).join(', ')) + '">' + fx.length + ' sounding</span></div>');
    if (!rows.length) rows.push('<div class="op-pl hint">' + 'Nothing playing' + '</div>');
    return rows.join('');
  }
  function warnings(b) {
    var out = [], dup = sharing(b);
    if (dup.length) out.push('<p class="op-warn">' + ic('alert', 's') + '<span class="grow">' + esc(names(dup)) + ' is in ' + esc(chName(b)) + ' too: the players hear both.</span><button class="btn s" data-act="opleave" data-bot="' + b.id + '" data-k="op-wl-' + b.id + '">Leave</button></p>');
    if (b.status === 'error') out.push('<p class="op-warn op-err">' + ic('alert', 's') + '<span class="grow">' + esc(L.botStatusText(b)) + '</span>' + (b.server ? '<button class="btn s" data-act="opretry" data-bot="' + b.id + '" data-k="op-retry-' + b.id + '">Try again</button>' : '') + '</p>');
    return out.join('');
  }
  function roomBox(b) {
    var g = L.server(b.server), c = L.channel(b.server, b.channel), here = inRoom(b) && c, who = here ? L.botListeners(b) : [];
    var room = here ? '<span class="op-rv ellipsis" id="op-rv-' + b.id + '"><span class="muted">' + esc(g.name) + ' ›</span> <b>' + esc(c.name) + '</b></span>' : '<span class="op-rv ellipsis" id="op-rv-' + b.id + '">Choose a room…</span>';
    var actions = '<button class="btn s icon" data-act="opmute" data-bot="' + b.id + '" data-k="op-mute-' + b.id + '" aria-pressed="' + !!b.muted + '" aria-label="Mute ' + esc(L.outputName(b)) + '" title="' + (b.muted ? 'Muted: press to let the room hear Lyre again' : 'Mute this room') + '">' + ic(b.muted ? 'mute' : 'horn', 's') + '</button>' +
      '<button class="btn s icon" data-act="optest" data-bot="' + b.id + '" data-k="op-test-' + b.id + '" title="Test: a short chime in this room only" aria-label="Test ' + esc(L.outputName(b)) + ': a short chime in this room only">' + L.icon('bell', 's') + '</button>';
    var body = (here ? '<p class="op-via">via ' + esc(b.name) + '</p>' : '') + '<div class="op-f">' +
      '<span class="op-l" id="op-rl-' + b.id + '">Room</span><div class="op-roomrow">' +
        '<button class="btn s op-room' + (here ? '' : ' primary') + '" data-act="oproom" data-bot="' + b.id + '" data-k="op-room-' + b.id + '" aria-haspopup="menu" aria-expanded="false" aria-labelledby="op-rl-' + b.id + ' op-rv-' + b.id + '" title="Move ' + esc(b.name) + ' to another voice channel">' + room + L.icon('chevdown', 's') + '</button>' +
        (inRoom(b) ? '<button class="btn s ghost" data-act="opleave" data-bot="' + b.id + '" data-k="op-leave-' + b.id + '" aria-label="' + esc(b.name) + ': leave ' + esc(chName(b)) + '">Leave</button>' : '') + '</div>' +
      (here ? '<span class="op-l">Playing</span><div class="op-play">' + playingHTML(b) + '</div>' +
        '<span class="op-l">Hears it</span><div class="op-who ellipsis" title="' + esc(who.join(', ')) + '">' + (who.length ? '<b>' + people(who.length) + '</b>' : '<span class="op-nobody">' + ic('alert', 's') + 'Nobody here yet</span>') + (who.length ? '<span class="muted">: ' + esc(who.join(', ')) + '</span>' : '') + '</div>' : '') +
      '<label class="op-l" for="op-vol-' + b.id + '">Volume</label><div class="op-volrow"><input type="range" id="op-vol-' + b.id + '" min="0" max="100" step="5" value="' + b.volume + '" data-input="opvol" data-bot="' + b.id + '" data-k="op-vol-' + b.id + '" aria-valuetext="' + b.volume + '%"><output class="num" id="op-vo-' + b.id + '" for="op-vol-' + b.id + '">' + b.volume + '%</output><span class="op-lvl" title="Level: how loud the room is right now"><span class="op-lvl-l" aria-hidden="true">Level</span><span class="op-meter" aria-hidden="true"><span data-opmeter="' + b.id + '"></span></span></span></div>' +
      '</div>' + warnings(b);
    return L.pane({ id: 'op-r-' + b.id, title: here ? c.name : b.name, icon: 'broadcast', kind: 'onair', size: 'auto', noMax: true, cls: 'op-box-room' + (pill(b).text === 'Playing' ? '' : ' is-silent'), status: pill(b), actions: actions,
      body: body });
  }

  /* ---------- all voice channels ---------- */
  function channelRow(g, c) {
    var here = roomBots(g.id, c.id), n = c.members.length, away = L.bots().filter(function (b) { return here.indexOf(b) < 0; });
    var chip = here.length > 1 ? '<span class="chip op-twice" title="The players hear both">' + ic('alert', 's') + esc(names(here)) + ': heard twice</span>'
      : here.length ? '<span class="chip op-botchip" title="' + esc(here[0].name + ': ' + pill(here[0]).text) + '">' + L.icon('broadcast', 's') + esc(here[0].name) + '</span>' : '<span></span>';
    return '<li class="op-ch' + (here.length ? ' live' : '') + '">' + L.icon('horn', 's') + '<b class="op-ch-n ellipsis">' + esc(c.name) + '</b>' +
      '<span class="op-ch-who ellipsis" title="' + esc(c.members.join(', ')) + '">' + (n ? n + ': ' + esc(c.members.join(', ')) : '<span class="faint">Empty</span>') + '</span>' + chip +
      (away.length ? '<button class="btn s op-bring" data-act="opbring" data-server="' + g.id + '" data-channel="' + c.id + '" data-k="op-bring-' + c.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Bring a bot to ' + esc(c.name) + '" title="Bring a bot to ' + esc(c.name) + '">' + L.icon('arrow', 's') + 'Bring…</button>' : '<span class="op-bring-sp"></span>') + '</li>';
  }
  function channelsHTML() {
    return D.discord.servers.map(function (g) {
      return '<section class="op-srv" aria-labelledby="op-srv-' + g.id + '"><h3 class="op-srv-h" id="op-srv-' + g.id + '">' + L.icon('users', 's') + '<span class="ellipsis">' + esc(g.name) + '</span></h3>' +
        '<ul class="list op-chs">' + g.channels.map(function (c) { return channelRow(g, c); }).join('') + '</ul></section>';
    }).join('');
  }

  /* ---------- view ---------- */
  L.view('outputs', {
    nav: 'outputs',
    title: function () { return 'Outputs'; },
    notesTitle: 'Outputs: your rooms in Discord',
    notes: [
      'One <b>On air</b> box per bot, titled with its room (the voice channel it is in), with one pill saying what it is doing: Playing, Silent, Muted, Joining or Not in a room.',
      'Each box shows what that room is playing now, who hears it, its volume and a level meter. Its red edge shows only while the players there hear something.',
      '<b>Room</b> moves a bot to any voice channel; the list says how many people are there and warns when another bot is there (players would hear it twice) or nobody is. <b>Swap rooms</b> trades two bots\' rooms.',
      '<b>All voice channels</b>: who is in each channel and which bot is there; <b>Bring…</b> moves a bot there. Test (bell) plays a chime in one room only.',
      'Try it: give Lyre Side the Side room, then try bringing it into Table too.'
    ],
    render: function () {
      var bots = L.bots(), on = bots.filter(function (b) { return inRoom(b); }), sw = swapPair();
      var head = '<div class="viewhead"><h1>Outputs</h1><span class="grow"></span>' + (L.state.live.cid && L.campaign(L.state.live.cid) ? L.modeSwitch(L.state.live.cid) : '') + '</div>';
      var nCh = D.discord.servers.reduce(function (n, g) { return n + g.channels.length; }, 0);
      var chPane = L.pane({ id: 'op-rooms', title: 'All voice channels', icon: 'map', kind: 'plain', scroll: 'op-rooms', noMax: true,
        status: { text: on.length + ' of ' + bots.length + ' bots in rooms', tone: 'idle' },
        summary: nCh + ' channels in ' + D.discord.servers.length + ' servers',
        actions: sw ? '<button class="btn s" data-act="opswap" data-k="op-swap" title="' + esc(sw[0].name + ' to ' + chName(sw[1]) + ', ' + sw[1].name + ' to ' + chName(sw[0])) + '">' + ic('swap', 's') + 'Swap rooms</button>' : '',
        body: channelsHTML() + '<p class="hint op-foot">' + L.icon('gear', 's') + '<span>Tokens and new bots: Settings, as in Lyre 0.2.</span></p>' });
      return head + '<div class="viewbody fill op-body"><div class="op-split"><div class="col op-roomcol" data-scroll="op-roomcol">' + bots.map(roomBox).join('') + '</div><div class="col op-chcol">' + chPane + '</div></div></div>';
    }
  });
})();
