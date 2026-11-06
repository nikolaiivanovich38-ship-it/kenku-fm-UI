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
    add: null, replacing: '', opened: [],
    // Round 7 (SEC-4): the secret code (made on first run; the app keeps it encrypted, SEC-5) and where it listens.
    code: newCode(), listen: 'local',
    // Round 7 (PRV-2): the device for what you hear of On air, the preview's, and one headset split between them.
    airDevice: 'System default', pvDevice: 'System default', split: false, pvEar: 'left',
    // Round 7 (PLY-8): the crossfade between tracks, unless a track or a step says otherwise.
    xfade: '3', curve: 'even', changing: '' };
  function newCode() { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = ''; for (var i = 0; i < 8; i++) c += a[Math.floor(Math.random() * a.length)]; return c.slice(0, 4) + '-' + c.slice(4); }

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
    b.token = v.slice(-4); S.replacing = ''; L.say('New token saved for ' + b.name); L.saved(b.name + ' token'); connect(b);
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
  L.acts.stbotrensave = function (el) { var b = L.bot(el.dataset.id), v = document.getElementById('st-ren').value.trim(); if (v) b.name = v; L.closeSheet(); L.render(); L.say('Renamed ' + b.name); if (v) L.saved('name “' + v + '”'); };
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
    // Could 17 of the round 6 review: where to find the ID comes before the field, in the order it is done.
    else if (n === 1) body = '<p class="st-why">Invite the bot before you give Lyre its token.</p>' +
      '<ol class="st-do"><li><b>General Information</b> › <b>Application ID</b> › <b>Copy</b></li></ol>' +
      '<div class="field"><label for="st-appid">Application ID</label><div class="row-flex"><input class="input num" id="st-appid" data-input="stappid" data-k="st-appid" value="' + esc(a.appId) + '" inputmode="numeric" autocomplete="off" placeholder="Paste it here">' +
        '<a class="btn s primary" href="' + esc(L.inviteURL(a.appId || '')) + '" target="_blank" rel="noopener" data-act="stopeninv" data-k="st-openinv"' + (/^\d{15,22}$/.test(a.appId) ? '' : ' aria-disabled="true"') + '>' + L.icon('link', 's') + 'Open the invite</a></div>' +
        '</div>' +
      '<ol class="st-do"><li>Choose your server, <b>Authorize</b>. You need <b>Manage Server</b> on it.</li></ol>' +
      '<button class="st-handbtn" data-act="stbyhand" data-k="st-byhand" aria-expanded="' + !!a.byHand + '" aria-controls="st-hand">' + L.icon(a.byHand ? 'chevup' : 'chevdown', 's') + 'Or make the invite by hand</button>' +
      (a.byHand ? '<ol class="st-do" id="st-hand"><li><b>OAuth2</b> › <b>URL Generator</b></li><li>Scopes: <b>bot</b></li><li>Bot Permissions: <b>View Channels</b>, <b>Connect</b>, <b>Speak</b></li>' +
        '<li>Open the <b>Generated URL</b>, choose your server, <b>Authorize</b></li></ol>' : '');
    else body = '<ol class="st-do"><li><b>Bot</b> › <b>Reset Token</b> › <b>Copy</b>. Discord shows it once.</li></ol>' +
      '<div class="field"><label for="st-newtok">Token</label><input class="input" type="password" id="st-newtok" data-input="stnewtok" data-k="st-newtok" autocomplete="off" placeholder="Paste it here" aria-describedby="st-newtok-d">' +
        '<span class="hint" id="st-newtok-d" title="Lost it? Reset Token again makes a new one">Kept encrypted on this computer.</span></div>' +
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
    return '<label class="lv-switch st-sw' + (o.disabled ? ' dis' : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '><input type="checkbox" role="switch" data-input="' + act + '" data-k="st-' + id + '" data-save="setting: ' + esc(label) + '"' + (on ? ' checked' : '') + (o.disabled ? ' disabled aria-describedby="st-' + id + '-why"' : '') + '><span class="lv-switch-t"><b>' + label + '</b></span></label>' +
      (o.disabled && o.why ? '<span class="sr-only" id="st-' + id + '-why">' + esc(o.why) + '</span>' : '');
  }
  var MODES = [['quality', 'Best sound quality', 'Clearer sound; works the computer a little harder.'], ['light', 'Lighter on the computer', 'Leaves more power for other programs; slightly less clear.']];
  function soundBody() {
    return '<div class="seg" role="radiogroup" aria-label="Sound to Discord">' + MODES.map(function (m) {
      return '<button role="radio" aria-checked="' + (S.mode === m[0]) + '" data-act="stmode" data-v="' + m[0] + '" data-k="st-mode-' + m[0] + '" title="' + esc(m[2]) + '">' + m[1] + '</button>';
    }).join('') + '</div>' + xfadeHTML();
  }
  // Round 7 (PLY-8): the default crossfade, used by Next, a playlist moving on and a scene's play steps.
  var XFADES = [['0', 'Cut'], ['1', '1 s'], ['2', '2 s'], ['3', '3 s'], ['5', '5 s'], ['8', '8 s']];
  function xfadeHTML() {
    return '<div class="st-xf"><div class="field"><label for="st-xf">Between tracks</label><select class="input" id="st-xf" data-input="stxf" data-k="st-xf" title="How one track hands over to the next when nothing else says">' +
      XFADES.map(function (x) { return '<option value="' + x[0] + '"' + (S.xfade === x[0] ? ' selected' : '') + '>' + (x[0] === '0' ? 'Cut' : 'Crossfade ' + x[1]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="st-curve">Crossfade curve</label><select class="input" id="st-curve" data-input="stcurve" data-k="st-curve" title="Equal power keeps the level steady in the middle of a crossfade">' +
      [['even', 'Even'], ['power', 'Equal power']].map(function (x) { return '<option value="' + x[0] + '"' + (S.curve === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div></div>';
  }
  L.inputs.stxf = function (el) { S.xfade = el.value; L.defaultCrossfade = +el.value; L.saved(el.value === '0' ? 'cut between tracks' : 'crossfade between tracks ' + el.value + ' s', { key: 'st-xf' }); };
  L.inputs.stcurve = function (el) { S.curve = el.value; L.saved('crossfade curve ' + el.options[el.selectedIndex].text, { key: 'st-curve' }); };
  L.defaultCrossfade = 3;

  /* Round 7 (PRV-2): headphones and speakers. What you hear of On air (the monitor, a copy of what goes to Discord)
     and the preview each have a device; one headset can be split, the preview in one ear and On air in the other.
     Remembered; if a device is unplugged, Lyre uses the computer's default until it is back. */
  var DEVICES = ['System default', 'Speakers (Realtek Audio)', 'Headset (Arctis 7)', 'USB audio (Focusrite)'];
  function devSelect(id, label, cur, act) {
    return '<div class="field"><label for="st-' + id + '">' + label + '</label><div class="row-flex"><select class="input" id="st-' + id + '" data-input="' + act + '" data-k="st-' + id + '">' +
      DEVICES.map(function (d) { return '<option' + (d === cur ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
      '<button class="btn s" data-act="sttest" data-v="' + id + '" data-k="st-' + id + '-test" aria-label="Test: ' + esc(label) + '" title="Plays a short chime on this device">' + L.icon('volume', 's') + 'Test</button></div></div>';
  }
  function devicesBody() {
    return (S.split ? '' : devSelect('air', 'On air, on this computer', S.airDevice, 'stairdev')) + devSelect('pv', S.split ? 'Headset' : 'Preview (only you)', S.pvDevice, 'stpvdev') +
      sw('split', 'Split one headset', S.split, 'stsplit', { title: 'The preview in one ear and On air in the other, on one headset' }) +
      (S.split ? '<div class="st-ears" role="radiogroup" aria-label="Which ear has the preview">' + [['left', 'Preview in the left ear'], ['right', 'Preview in the right ear']].map(function (e) {
        return '<label class="lk-radio"><input type="radio" name="st-ear" value="' + e[0] + '" data-input="stear" data-k="st-ear-' + e[0] + '"' + (S.pvEar === e[0] ? ' checked' : '') + '><span>' + e[1] + '</span></label>';
      }).join('') + '</div>' : '');
  }
  L.inputs.stairdev = function (el) { S.airDevice = el.value; L.saved('On air plays on ' + el.value, { key: 'st-air' }); };
  L.inputs.stpvdev = function (el) { S.pvDevice = el.value; L.saved('preview plays on ' + el.value, { key: 'st-pv' }); };
  L.inputs.stsplit = function (el) { S.split = el.checked; if (S.split && S.pvDevice === 'System default') S.pvDevice = 'Headset (Arctis 7)'; L.render(); L.saved(S.split ? 'one headset split: preview in the ' + S.pvEar + ' ear' : 'headset not split', { key: 'st-split' }); };
  L.inputs.stear = function (el) { if (!el.checked) return; S.pvEar = el.value; L.render(); L.saved('preview in the ' + S.pvEar + ' ear', { key: 'st-split' }); };
  L.acts.sttest = function (el) { L.toast('Test chime on ' + (el.dataset.v === 'air' ? S.airDevice : S.pvDevice) + (S.split ? ', ' + (el.dataset.v === 'pv' ? S.pvEar : S.pvEar === 'left' ? 'right' : 'left') + ' ear' : '')); };

  /* Round 7 (UX-12): keyboard shortcuts. Each action with its key; Change… then press the new key (Esc keeps the
     old one; a key in use is refused). Put back Lyre's keys; a printable sheet. */
  function keysBody() {
    var rows = L.SHORTCUTS.map(function (k) {
      var now = S.changing === k.id;
      return '<tr aria-label="' + esc(k.name) + '"><th scope="row">' + esc(k.name) + '</th><td>' + (now ? '<span class="st-press">Press the new key (Esc keeps ' + esc(L.keyFor(k.id)) + ')</span>' : '<span class="kbd">' + esc(L.keyFor(k.id)) + '</span>') + '</td>' +
        '<td class="faint">' + esc(k.where) + '</td><td><button class="btn s ghost" data-act="stkey" data-id="' + k.id + '" data-k="st-key-' + k.id + '" aria-label="Change the key for ' + esc(k.name) + '"' + (now ? ' aria-pressed="true"' : '') + '>Change…</button></td></tr>';
    }).join('');
    return '<table class="grid st-keys" aria-label="Keyboard shortcuts"><tbody>' + rows + '</tbody></table>' +
      sw('guard', 'Ignore a second Next scene within a second', L.keyGuard, 'stguard', { title: 'So a double press never skips a scene' }) +
      sw('global', 'Next scene and Fade everything out work in other programs too', L.keyGlobal, 'stglobal', { title: 'While Discord or your VTT is in front. Off: the keys work only in Lyre.' }) +
      '<p class="hint">Pad keys are set on each pad board.</p><div class="row-flex"><button class="btn s" data-act="stkeyreset" data-k="st-keyreset">' + L.icon('restart', 's') + 'Put back Lyre\'s keys</button>' +
      '<button class="btn s" data-act="stkeysheet" data-k="st-keysheet">' + L.icon('file', 's') + 'Printable sheet</button></div>';
  }
  L.acts.stkey = function (el) {
    var id = el.dataset.id; S.changing = id; L.render(); var f = document.querySelector('[data-k="st-key-' + id + '"]'); if (f) f.focus();
    L.say('Press the new key, or Esc to keep ' + L.keyFor(id));
    L.captureKey(id, function (key) {
      var name = (L.SHORTCUTS.filter(function (x) { return x.id === id; })[0] || {}).name;
      S.changing = ''; if (key) L.setKey(id, key); L.render(); var b = document.querySelector('[data-k="st-key-' + id + '"]'); if (b) b.focus();
      if (key) L.saved('key for ' + name + ': ' + key); else L.say('Kept ' + L.keyFor(id) + ' for ' + name);
    });
  };
  L.inputs.stguard = function (el) { L.keyGuard = el.checked; L.saveKeyOptions(); L.saved('a second Next scene within a second is ' + (el.checked ? 'ignored' : 'not ignored'), { key: 'st-guard' }); };
  L.inputs.stglobal = function (el) { L.keyGlobal = el.checked; L.saveKeyOptions(); L.saved('keys in other programs ' + (el.checked ? 'on' : 'off'), { key: 'st-global' }); };
  L.acts.stkeyreset = function () { L.resetKeys(); L.render(); L.saved('Lyre\'s keys put back'); };
  L.acts.stkeysheet = function () {
    var rows = L.SHORTCUTS.map(function (k) { return '<tr><th scope="row">' + esc(k.name) + '</th><td><span class="kbd">' + esc(L.keyFor(k.id)) + '</span></td><td>' + esc(k.where) + '</td></tr>'; }).join('');
    L.sheet({ title: 'Lyre\'s keys', body: '<table class="grid st-keys st-print"><thead><tr><th>What</th><th>Key</th><th>Where</th></tr></thead><tbody>' + rows + '</tbody></table><p class="hint">Pad keys are on each pad board.</p>',
      footer: '<button class="btn" data-act="closesheet">Close</button><button class="btn primary" data-act="stprint">' + L.icon('file', 's') + 'Print</button>' });
  };
  L.acts.stprint = function () { try { window.print(); } catch (e) { /* no printer in the prototype */ } };
  L.acts.stmode = function (el) { S.mode = el.dataset.v; L.say(el.textContent + '. Applies the next time a bot joins a voice channel.'); L.render(); L.saved('setting: ' + el.textContent, { key: 'st-mode' }); };
  /* Round 7 (SEC-4): remote control needs a secret code. Off by default. On: the code to type on the remote device
     (Stream Deck plugin, phone or tablet), Copy code, Make a new code (the old one stops working at once), and where
     Lyre listens: this computer only (127.0.0.1, the default) or your home network (for a phone on the same Wi-Fi). Every
     remote request needs the code; requests from web pages and other addresses are refused (docs/security.md). */
  function remoteBody() {
    var home = S.listen === 'home', addr = home ? '192.168.1.20' : '127.0.0.1';
    return sw('remote', 'Let other devices control Lyre', S.remote, 'stremote', { title: 'The Stream Deck plugin, a phone or another program on this computer or your network' }) +
      (S.remote ? '<div class="st-code" role="group" aria-label="Secret code"><span class="st-l">Code</span><output class="num st-codev">' + esc(S.code) + '</output>' +
        '<button class="btn s" data-act="stcodecopy" data-k="st-codecopy">' + L.icon('file', 's') + 'Copy code</button>' +
        '<button class="btn s ghost" data-act="stcodenew" data-k="st-codenew" title="The old code stops working at once; type the new one on each device">' + L.icon('restart', 's') + 'Make a new code</button></div>' +
        '<div class="st-listen" role="radiogroup" aria-label="Listens on">' + [['local', 'This computer only'], ['home', 'Your home network']].map(function (x) {
          return '<label class="lk-radio"><input type="radio" name="st-listen" value="' + x[0] + '" data-input="stlisten" data-k="st-listen-' + x[0] + '"' + (S.listen === x[0] ? ' checked' : '') + '><span>' + x[1] + '</span></label>';
        }).join('') + '</div>' +
        '<p class="st-addr2"><span class="st-l">Address</span><span class="num" title="Type this address and the code on the remote device">' + addr + ':' + esc(S.port) + '</span></p>' : '') +
      '<a class="st-link" href="https://github.com/owlbear-rodeo/kenku-fm" target="_blank" rel="noopener" data-act="stdeck" data-k="st-deck">About the Kenku FM Stream Deck plugin</a>';
  }
  L.inputs.stremote = function (el) { S.remote = el.checked; L.say('Remote control ' + (S.remote ? 'on' : 'off')); L.render(); L.saved('remote control ' + (S.remote ? 'on' : 'off'), { key: 'st-remote' }); };
  L.acts.stcodecopy = function () { try { navigator.clipboard.writeText(S.code).catch(function () {}); } catch (e) { /* clipboard unavailable in the prototype */ } L.toast('Code copied'); };
  L.acts.stcodenew = function () { S.code = newCode(); L.render(); L.saved('new remote control code', { detail: 'the old one stops working' }); };
  L.inputs.stlisten = function (el) { if (!el.checked) return; S.listen = el.value; L.render(); L.saved('remote control listens on ' + (S.listen === 'home' ? 'your home network' : 'this computer only'), { key: 'st-listen' }); };
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
  L.acts.stforget = function (el) { var f = S.folders.splice(+el.dataset.i, 1)[0]; L.say('Lyre asks again before opening files in ' + f); L.render(); L.saved('setting: ask before opening files in ' + f); var h = document.querySelector('[data-k="pane-st-files"]'); if (h) h.focus(); };

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
      var head = '<div class="viewhead"><h1>Settings</h1><span class="grow"></span><span class="faint num" title="Lyre version">' + esc(L.version) + '</span></div>';
      var botPane = L.pane({ id: 'st-bots', title: 'Discord bots', icon: 'users', kind: 'onair', size: 'auto', noMax: true, cls: 'is-silent',
        actions: '<button class="btn s" data-act="stadd" data-k="st-add">' + L.icon('plus', 's') + 'Add a bot</button>',
        describe: 'Each bot is one voice in Discord: one room at a time.',
        body: '<div class="st-bots">' + bots.map(botRow).join('') + '</div>' });
      // Round 7: set once, so folded like the other rare settings (and less to read on the screen).
      var sound = L.pane({ id: 'st-sound', title: 'Sound to Discord', icon: 'broadcast', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: soundBody(),
        describe: 'Both send sound to Discord with the same short delay. A change applies the next time a bot joins a voice channel.' });
      var devices = L.pane({ id: 'st-devices', title: 'Headphones and speakers', icon: 'headphones', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: devicesBody(),
        describe: 'If a device is unplugged, Lyre uses the computer\'s default until it is back.' });
      // Round 6 rule 4 and Nik's 16:14 answer: no resting status; "On" says something is open to other devices.
      var remote = L.pane({ id: 'st-remote', title: 'Remote control', icon: 'link', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: remoteBody(), status: S.remote ? { text: 'On', tone: 'on' } : null,
        describe: 'Off until you turn it on. Each device needs the secret code.' });
      var keys = L.pane({ id: 'st-keys', title: 'Keyboard shortcuts', icon: 'grid', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: keysBody(),
        describe: 'Ctrl+K finds and plays anything. Change any key here.' });
      var tabs = L.pane({ id: 'st-tabs', title: 'Website tabs', icon: 'grid', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: tabsBody() });
      var files = L.pane({ id: 'st-files', title: 'Local files', icon: 'folder', kind: 'plain', size: 'auto', noMax: true, collapsed: true, body: filesBody(),
        describe: 'Lyre asks before opening a file from your computer. Folders you choose not to be asked about again are listed here.' });
      return head + '<div class="viewbody st-body"><div class="st-split"><div class="col">' + botPane + '</div><div class="col">' + sound + devices + remote + keys + tabs + files + '</div></div></div>';
    }
  });
})();
