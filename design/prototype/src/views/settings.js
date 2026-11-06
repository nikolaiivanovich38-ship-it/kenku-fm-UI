/* Settings (#/settings, in the menu): OUT-8, round 6 part 2 (Nik, 6 Nov 10:34: "Enhance the instructions for adding
   new bots with proper directions about the Oauth2 URL step and inviting the bot to the server, and doing that before
   having the token is added to Lyre", and when Settings, tokens and new bots come to the new interface).

   Everything the old main window's Settings panel had that Lyre still needs (src/renderer/features/settings):
     Discord bots      each bot: status, the servers it is in, Connect or Disconnect, its token (only the last four
                       characters show; Replace… takes a new one) and, behind ⋯, Rename and Remove. Add a bot opens the
                       stepper below. Tokens are kept encrypted on this computer (SEC-5).
     Sound to Discord  the streaming mode (Best sound quality or Lighter on the computer).
     Remote control    the Stream Deck remote: on or off, address and port (folded: rare).
     Website tabs      the address bar, microphones and other inputs, several inputs at once, Clear website data (folded).
     Local files       folders whose files open without asking, each with Ask again (folded).
   Look and feel stays its own screen in the menu.

   Add a bot, in the order Discord needs (checked against Discord's documentation, see ROUND6.md):
     1 Create an application in the Discord Developer Portal (New Application, a name, Create).
     2 Invite the bot to your server, before Lyre has its token: paste the Application ID (General Information) and Lyre
       opens the invite with the right permissions, https://discord.com/oauth2/authorize?client_id=<id>&scope=bot&
       permissions=3146752 (View Channels 1024 + Connect 1048576 + Speak 2097152); or by hand: OAuth2 › URL Generator,
       scope bot, permissions View Channels, Connect, Speak, open the Generated URL, choose the server, Authorize. You
       need Manage Server on that server.
     3 Bot › Reset Token, copy it, paste it here, Connect. Then: the servers the bot is in, or "In no server yet" with
       the invite again. */
(function () {
  var esc = L.esc, D = L.data;
  L.INVITE_PERMISSIONS = 1024 + 1048576 + 2097152;   // View Channels, Connect, Speak
  L.inviteURL = function (appId) { return 'https://discord.com/oauth2/authorize?client_id=' + encodeURIComponent(appId) + '&scope=bot&permissions=' + L.INVITE_PERMISSIONS; };
  var S = { mode: 'quality', remote: false, address: '127.0.0.1', port: '3333', urlBar: true, inputs: false, several: false, folders: ['H:\\Audio\\Incoming'],
    add: null, replacing: '', opened: [] };

  /* ---------- the bots ---------- */
  function loginWords(b) { return { online: 'Connected', connecting: 'Connecting…', offline: 'Not connected', error: 'Could not connect' }[b.login || 'online']; }
  function loginTone(b) { return { online: 'on', connecting: 'warn', offline: 'idle', error: 'warn' }[b.login || 'online']; }
  function serverNames(b) { return (b.servers || []).map(function (id) { return (L.server(id) || {}).name; }).filter(Boolean); }
  L.botOnline = function (b) { return !b.login || b.login === 'online'; };
  function connect(b) {
    b.login = 'connecting'; L.say(b.name + ' is connecting'); L.changed();
    setTimeout(function () {
      if (b.login !== 'connecting') return;
      if (!b.token) { b.login = 'error'; b.error = 'No token yet'; } else b.login = 'online';
      L.say(b.name + (b.login === 'online' ? ' is connected. ' + (serverNames(b).length ? 'In ' + serverNames(b).join(' and ') : 'It is in no server yet: invite it first') : ' could not connect: paste its token'));
      L.changed();
    }, 900);
  }
  function botRow(b) {
    var srv = serverNames(b), k = 'st-b-' + b.id, rep = S.replacing === b.id;
    var token = rep
      ? '<div class="st-tok-new"><label class="sr-only" for="st-tok-' + b.id + '">New token for ' + esc(b.name) + '</label><input class="input" type="password" id="st-tok-' + b.id + '" data-input="sttok" data-id="' + b.id + '" data-k="' + k + '-tokin" autocomplete="off" placeholder="Paste the new token">' +
        '<button class="btn s primary" data-act="sttoksave" data-id="' + b.id + '" data-k="' + k + '-toksave">Save</button><button class="btn s ghost" data-act="sttokcancel" data-k="' + k + '-tokx">Cancel</button></div>'
      : '<span class="st-tok num" title="Kept encrypted on this computer; only the last four characters show">' + (b.token ? '••••••••' + esc(b.token) : '<span class="faint">No token</span>') + '</span>' +
        '<button class="btn s ghost" data-act="sttokrep" data-id="' + b.id + '" data-k="' + k + '-tokrep" aria-label="Replace the token of ' + esc(b.name) + '">Replace…</button>';
    var on = b.login === 'online' || b.login === 'connecting';
    return '<div class="st-bot" role="group" aria-label="' + esc(b.name) + '">' +
      '<div class="st-bot-1"><b class="ellipsis">' + esc(b.name) + '</b><span class="pane-status s-' + loginTone(b) + '">' + loginWords(b) + '</span><span class="grow"></span>' +
        '<button class="btn s' + (on ? '' : ' primary') + '" data-act="stconn" data-id="' + b.id + '" data-k="' + k + '-conn"' + (b.login === 'connecting' ? ' aria-disabled="true"' : '') + '>' + (on ? 'Disconnect' : 'Connect') + '</button>' +
        '<button class="closer" data-act="stbotmenu" data-id="' + b.id + '" data-k="' + k + '-more" aria-haspopup="menu" aria-expanded="false" title="More for ' + esc(b.name) + '" aria-label="More for ' + esc(b.name) + '">' + L.icon('more') + '</button></div>' +
      '<div class="st-bot-2"><span class="st-l">Token</span>' + token + '</div>' +
      (b.login === 'online' ? '<div class="st-bot-2"><span class="st-l">Servers</span>' + (srv.length ? '<span class="ellipsis" title="' + esc(srv.join(', ')) + '">' + esc(srv.join(', ')) + '</span>'
        : '<span class="st-none">' + L.icon('warn', 's') + 'In no server yet</span>' + (b.appId ? '<a class="btn s" href="' + esc(L.inviteURL(b.appId)) + '" target="_blank" rel="noopener" data-act="stinvite" data-id="' + b.id + '" data-k="' + k + '-inv">Invite it…</a>' : '')) + '</div>' : '') +
      (b.login === 'error' ? '<p class="st-err" role="alert">' + L.icon('warn', 's') + esc(b.error || 'Discord refused the token') + '</p>' : '') + '</div>';
  }
  L.acts.stconn = function (el) {
    var b = L.bot(el.dataset.id); if (!b || b.login === 'connecting') return;
    if (b.login === 'online') { if (b.status !== 'idle') L.botLeave(b.id); b.login = 'offline'; L.say(b.name + ' disconnected'); L.changed(); return; }
    connect(b);
  };
  L.acts.sttokrep = function (el) { S.replacing = el.dataset.id; L.render(); var f = document.querySelector('[data-k="st-b-' + el.dataset.id + '-tokin"]'); if (f) f.focus(); };
  L.acts.sttokcancel = function () { var id = S.replacing; S.replacing = ''; L.render(); var f = document.querySelector('[data-k="st-b-' + id + '-tokrep"]'); if (f) f.focus(); };
  L.inputs.sttok = function () {};
  L.acts.sttoksave = function (el) {
    var b = L.bot(el.dataset.id), f = document.getElementById('st-tok-' + el.dataset.id), v = f ? f.value.trim() : '';
    if (!v) { L.toast('Paste the token first'); if (f) f.focus(); return; }
    b.token = v.slice(-4); S.replacing = ''; L.say('New token saved for ' + b.name); connect(b);
    var c = document.querySelector('[data-k="st-b-' + b.id + '-conn"]'); if (c) c.focus();
  };
  L.acts.stbotmenu = function (el) {
    var b = L.bot(el.dataset.id), only = L.bots().length < 2;
    L.menu(el, '<button role="menuitem" data-act="stbotren" data-id="' + b.id + '">' + L.icon('edit', 's') + 'Rename…</button>' +
      '<button role="menuitem" data-act="stbotrm" data-id="' + b.id + '"' + (only ? ' disabled title="Lyre needs at least one bot"' : '') + '>' + L.icon('trash', 's') + 'Remove ' + esc(b.name) + '</button>', 'More for ' + b.name);
  };
  L.acts.stbotren = function (el) {
    var b = L.bot(el.dataset.id);
    L.sheet({ title: 'Rename ' + b.name, body: '<div class="field"><label for="st-ren">Name in Lyre</label><input class="input" id="st-ren" value="' + esc(b.name) + '" autocomplete="off"></div>',
      footer: '<button class="btn" data-act="closesheet">Cancel</button><button class="btn primary" data-act="stbotrensave" data-id="' + b.id + '">Rename</button>' });
  };
  L.acts.stbotrensave = function (el) { var b = L.bot(el.dataset.id), v = document.getElementById('st-ren').value.trim(); if (v) b.name = v; L.closeSheet(); L.render(); L.say('Renamed ' + b.name); };
  // Removing a bot takes it out of its voice channel and forgets its token; Undo puts it back as it was.
  L.acts.stbotrm = function (el) {
    var list = D.discord.bots, i = list.map(function (b) { return b.id; }).indexOf(el.dataset.id); if (i < 0 || list.length < 2) return;
    var b = list[i], was = JSON.parse(JSON.stringify(b));
    if (b.status !== 'idle') L.botLeave(b.id);
    list.splice(i, 1); L.state.sendTo = L.state.sendTo.filter(function (x) { return x !== b.id; });
    L.undoNote('Removed ' + b.name + ' and its token.', function () { list.splice(i, 0, was); });
    L.render(); L.say('Removed ' + b.name + '. Undo is above the Now playing bar, or press Ctrl+Z.');
    var n = document.querySelector('[data-k="st-add"]'); if (n) n.focus();
  };

  /* ---------- Add a bot: three steps, in the order Discord needs ---------- */
  var STEPS = ['Create it', 'Invite it', 'Connect it'];
  function stepper() {
    var a = S.add, n = a.step;
    var nav = '<ol class="st-steps" aria-label="Steps">' + STEPS.map(function (x, i) {
      return '<li' + (i === n ? ' aria-current="step" class="now"' : i < n ? ' class="done"' : '') + '><span class="num">' + (i + 1) + '</span>' + x + '</li>';
    }).join('') + '</ol>';
    var body;
    if (n === 0) body = '<ol class="st-do">' +
      '<li><a class="btn s" href="https://discord.com/developers/applications" target="_blank" rel="noopener" data-act="stportal" data-k="st-portal">' + L.icon('link', 's') + 'Open the Discord Developer Portal</a></li>' +
      '<li><b>New Application</b>, give it a name (for example ' + esc(a.name) + '), <b>Create</b>.</li></ol>';
    else if (n === 1) body = '<p class="st-why">Invite the bot before you give Lyre its token.</p>' +
      '<div class="field"><label for="st-appid">Application ID</label><div class="row-flex"><input class="input num" id="st-appid" data-input="stappid" data-k="st-appid" value="' + esc(a.appId) + '" inputmode="numeric" autocomplete="off" placeholder="From General Information" aria-describedby="st-appid-d">' +
        '<a class="btn s primary" href="' + esc(L.inviteURL(a.appId || '')) + '" target="_blank" rel="noopener" data-act="stopeninv" data-k="st-openinv"' + (/^\d{15,22}$/.test(a.appId) ? '' : ' aria-disabled="true"') + '>' + L.icon('link', 's') + 'Open the invite</a></div>' +
        '<span class="hint" id="st-appid-d">General Information › Application ID › Copy</span></div>' +
      '<ol class="st-do"><li>Choose your server, <b>Authorize</b>. You need <b>Manage Server</b> on it.</li></ol>' +
      '<button class="st-handbtn" data-act="stbyhand" data-k="st-byhand" aria-expanded="' + !!a.byHand + '" aria-controls="st-hand">' + L.icon(a.byHand ? 'chevup' : 'chevdown', 's') + 'Or make the invite by hand</button>' +
      (a.byHand ? '<ol class="st-do" id="st-hand"><li><b>OAuth2</b> › <b>URL Generator</b></li><li>Scopes: <b>bot</b></li><li>Bot Permissions: <b>View Channels</b>, <b>Connect</b>, <b>Speak</b></li>' +
        '<li>Open the <b>Generated URL</b>, choose your server, <b>Authorize</b></li></ol>' : '');
    else body = '<ol class="st-do"><li><b>Bot</b> › <b>Reset Token</b> › <b>Copy</b></li></ol>' +
      '<div class="field"><label for="st-newtok">Token</label><input class="input" type="password" id="st-newtok" data-input="stnewtok" data-k="st-newtok" autocomplete="off" placeholder="Paste it here" aria-describedby="st-newtok-d">' +
        '<span class="hint" id="st-newtok-d" title="Discord shows a token once; Reset Token makes a new one">Kept encrypted on this computer.</span></div>' +
      (a.result ? '<div class="st-result" role="status">' + a.result + '</div>' : '');
    return '<div class="st-add">' + nav + '<div class="st-stepbody" id="st-stepbody">' + body + '</div></div>';
  }
  function footer() {
    var n = S.add.step;
    return '<button class="btn" data-act="' + (n ? 'stprev' : 'closesheet') + '" data-k="st-prev">' + (n ? 'Previous' : 'Cancel') + '</button>' +
      (n < 2 ? '<button class="btn primary" data-act="stnext" data-k="st-next">Next</button>' : S.add.done ? '<button class="btn primary" data-act="stdone" data-k="st-done">Done</button>' : '<button class="btn primary" data-act="stconnew" data-k="st-connew">Connect</button>');
  }
  // The sheet stays open between steps; only its title, body and buttons change.
  function openStepper(focusK) {
    var title = 'Add a bot: step ' + (S.add.step + 1) + ' of 3', sh = document.getElementById('lyre-sheet');
    if (sh) { sh.querySelector('#sheet-title').textContent = title; sh.querySelector('.body').innerHTML = stepper(); sh.querySelector('footer').innerHTML = footer(); }
    else L.sheet({ title: title, describe: 'Create the application, invite the bot to your server, then give Lyre its token.', body: stepper(), footer: footer() });
    var f = focusK && document.querySelector('#lyre-sheet [data-k="' + focusK + '"]'); if (f) f.focus();
  }
  L.acts.stadd = function () { S.add = { step: 0, name: 'Lyre ' + ['Side', 'Third', 'Fourth', 'Fifth'][Math.max(0, L.bots().length - 1)] , appId: '', opened: false, byHand: false, result: '', done: false }; openStepper(); };
  L.acts.stnext = function () { S.add.step++; openStepper(S.add.step === 1 ? 'st-appid' : 'st-newtok'); L.say('Step ' + (S.add.step + 1) + ' of 3: ' + STEPS[S.add.step]); };
  L.acts.stprev = function () { S.add.step--; openStepper('st-prev'); L.say('Step ' + (S.add.step + 1) + ' of 3: ' + STEPS[S.add.step]); };
  L.acts.stbyhand = function () { S.add.byHand = !S.add.byHand; openStepper('st-byhand'); };
  // The prototype cannot open Discord or a browser: these links say where they would go.
  L.acts.stportal = function () { L.toast('Opens the Discord Developer Portal in your browser'); };
  L.acts.stinvite = function () { L.toast('Opens the invite in your browser: choose your server, Authorize'); };
  L.acts.stdeck = function () { L.toast('Opens the Stream Deck plugin\'s page in your browser'); };
  L.inputs.stappid = function (el) {
    S.add.appId = el.value.replace(/\D/g, ''); var a = document.querySelector('[data-k="st-openinv"]');
    if (a) { a.href = L.inviteURL(S.add.appId); if (/^\d{15,22}$/.test(S.add.appId)) a.removeAttribute('aria-disabled'); else a.setAttribute('aria-disabled', 'true'); }
  };
  // The prototype cannot open Discord: it notes that the invite was opened (and so the bot will be in a server).
  L.acts.stopeninv = function (el, e) {
    if (el.getAttribute('aria-disabled') === 'true') { L.toast('Paste the Application ID first (General Information)'); var f = document.getElementById('st-appid'); if (f) f.focus(); return; }
    S.add.opened = true; L.toast('Opens Discord in your browser: choose your server, Authorize'); L.say('Invite opened in your browser');
  };
  L.inputs.stnewtok = function () {};
  L.acts.stconnew = function () {
    var f = document.getElementById('st-newtok'), v = f ? f.value.trim() : '';
    if (!v) { L.toast('Paste the token first'); if (f) f.focus(); return; }
    var a = S.add, b = { id: L.uid('b'), name: a.name, status: 'idle', server: '', channel: '', muted: false, volume: 85, mix: 'own', login: 'online', token: v.slice(-4), appId: a.appId, servers: a.opened ? ['g1'] : [] };
    D.discord.bots.push(b); a.done = true; a.botId = b.id;
    var srv = serverNames(b);
    a.result = L.icon('check', 's') + '<b>' + esc(b.name) + ' is connected.</b> ' + (srv.length ? 'In ' + esc(srv.join(', ')) + '.'
      : 'It is in no server yet. <a href="' + esc(L.inviteURL(a.appId || '')) + '" target="_blank" rel="noopener" data-act="stopeninv" data-k="st-inv2">Invite it</a>, then it shows here.');
    openStepper('st-done'); L.say(b.name + ' is connected' + (srv.length ? ', in ' + srv.join(' and ') : ', in no server yet')); L.render();
  };
  L.acts.stdone = function () { var id = S.add && S.add.botId; L.closeSheet(); S.add = null; L.render(); var n = document.querySelector('[data-k="st-b-' + id + '-conn"]') || document.querySelector('[data-k="st-add"]'); if (n) n.focus(); };

  /* ---------- the other settings ---------- */
  function sw(id, label, on, act, o) {
    o = o || {};
    return '<label class="lv-switch st-sw' + (o.disabled ? ' dis' : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '><input type="checkbox" role="switch" data-input="' + act + '" data-k="st-' + id + '"' + (on ? ' checked' : '') + (o.disabled ? ' disabled aria-describedby="st-' + id + '-why"' : '') + '><span class="lv-switch-t"><b>' + label + '</b></span></label>' +
      (o.disabled && o.why ? '<span class="sr-only" id="st-' + id + '-why">' + esc(o.why) + '</span>' : '');
  }
  var MODES = [['quality', 'Best sound quality', 'Clearer sound; works the computer a little harder.'], ['light', 'Lighter on the computer', 'Leaves more power for other programs; slightly less clear.']];
  function soundBody() {
    return '<div class="seg" role="radiogroup" aria-label="Sound to Discord">' + MODES.map(function (m) {
      return '<button role="radio" aria-checked="' + (S.mode === m[0]) + '" data-act="stmode" data-v="' + m[0] + '" data-k="st-mode-' + m[0] + '" title="' + esc(m[2]) + '">' + m[1] + '</button>';
    }).join('') + '</div>';
  }
  L.acts.stmode = function (el) { S.mode = el.dataset.v; L.say(el.textContent + '. Applies the next time a bot joins a voice channel.'); L.render(); };
  function remoteBody() {
    return sw('remote', 'Stream Deck and other programs', S.remote, 'stremote', { title: 'Lets the Kenku FM Stream Deck plugin or another program control Lyre' }) +
      '<div class="row-flex st-addr"><div class="field"><label for="st-ra">Address</label><input class="input num" id="st-ra" data-input="stra" value="' + esc(S.address) + '"' + (S.remote ? ' disabled' : '') + ' title="127.0.0.1: only programs on this computer"></div>' +
      '<div class="field"><label for="st-rp">Port</label><input class="input num" id="st-rp" data-input="strp" value="' + esc(S.port) + '"' + (S.remote ? ' disabled' : '') + '></div></div>' +
      '<a class="st-link" href="https://github.com/owlbear-rodeo/kenku-fm" target="_blank" rel="noopener" data-act="stdeck" data-k="st-deck">About the Kenku FM Stream Deck plugin</a>';
  }
  L.inputs.stremote = function (el) { S.remote = el.checked; L.say('Remote control ' + (S.remote ? 'on' : 'off')); L.render(); };
  L.inputs.stra = function (el) { S.address = el.value; };
  L.inputs.strp = function (el) { S.port = el.value; };
  function tabsBody() {
    return sw('urlbar', 'Show the address bar on tabs', S.urlBar, 'sturl') + sw('inputs', 'Microphones and other inputs', S.inputs, 'stinputs') +
      sw('several', 'Use several inputs at once', S.several, 'stseveral', { disabled: !S.inputs, why: 'Turn on Microphones and other inputs first.', title: S.inputs ? '' : 'Turn on Microphones and other inputs first' }) +
      '<button class="btn s" data-act="stclear" data-k="st-clear" title="Logs you out of websites in tabs and deletes their saved files. Your library, playlists and settings are kept.">Clear website data</button>';
  }
  L.inputs.sturl = function (el) { S.urlBar = el.checked; L.render(); };
  L.inputs.stinputs = function (el) { S.inputs = el.checked; if (!S.inputs) S.several = false; L.render(); };
  L.inputs.stseveral = function (el) { S.several = el.checked; L.render(); };
  L.acts.stclear = function () { L.toast('Website data cleared: tabs are logged out'); L.say('Website data cleared'); };
  function filesBody() {
    if (!S.folders.length) return '<p class="faint">None</p>';
    return '<ul class="list st-folders" aria-label="Folders opened without asking">' + S.folders.map(function (f, i) {
      return '<li class="lrow"><span class="grow ellipsis num" title="' + esc(f) + '">' + esc(f) + '</span><button class="btn s ghost" data-act="stforget" data-i="' + i + '" data-k="st-forget-' + i + '" aria-label="Ask again before opening files in ' + esc(f) + '">Ask again</button></li>';
    }).join('') + '</ul>';
  }
  L.acts.stforget = function (el) { var f = S.folders.splice(+el.dataset.i, 1)[0]; L.say('Lyre asks again before opening files in ' + f); L.render(); var h = document.querySelector('[data-k="pane-st-files"]'); if (h) h.focus(); };

  L.view('settings', {
    nav: 'settings',
    title: function () { return 'Settings'; },
    notesTitle: 'Settings (round 6, OUT-8)',
    notes: [
      'Everything Lyre still needs from the old main window\'s Settings. <b>Discord bots</b> first: status, servers, Connect or Disconnect, the token (last four characters; <b>Replace…</b>), and Rename or Remove behind ⋯.',
      '<b>Add a bot</b> walks through Discord in its order: create the application, <b>invite it first</b> (paste the Application ID and Lyre opens the invite, or make it by hand with OAuth2 › URL Generator), then paste the token and Connect.',
      'The rare settings are folded: remote control, website tabs, local files.'
    ],
    render: function () {
      var bots = L.bots();
      var head = '<div class="viewhead"><h1>Settings</h1><span class="grow"></span><span class="faint num" title="Lyre version">0.4.0</span></div>';
      var botPane = L.pane({ id: 'st-bots', title: 'Discord bots', icon: 'users', kind: 'onair', size: 'auto', noMax: true, cls: 'is-silent',
        actions: '<button class="btn s" data-act="stadd" data-k="st-add">' + L.icon('plus', 's') + 'Add a bot</button>',
        describe: 'Each bot is one voice in Discord: one room at a time.',
        body: '<div class="st-bots">' + bots.map(botRow).join('') + '</div>' });
      var sound = L.pane({ id: 'st-sound', title: 'Sound to Discord', icon: 'broadcast', kind: 'plain', size: 'auto', noMax: true, body: soundBody(),
        describe: 'Both send sound to Discord with the same short delay. A change applies the next time a bot joins a voice channel.' });
      var remote = L.pane({ id: 'st-remote', title: 'Remote control', icon: 'link', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: remoteBody(), status: { text: S.remote ? 'On' : 'Off', tone: S.remote ? 'on' : 'idle' } });
      var tabs = L.pane({ id: 'st-tabs', title: 'Website tabs', icon: 'grid', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: tabsBody() });
      var files = L.pane({ id: 'st-files', title: 'Local files', icon: 'folder', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: filesBody(),
        describe: 'Lyre asks before opening a file from your computer. Folders you choose not to be asked about again are listed here.' });
      return head + '<div class="viewbody st-body"><div class="st-split"><div class="col">' + botPane + '</div><div class="col">' + sound + remote + tabs + files + '</div></div></div>';
    }
  });
})();
