/* Round 8 (0.5.1, ROUND8.md): Lyre is the whole window. Added beside core.js and the screens, as round 7's files are.

   The window (FND-16)
     Lyre's page is the whole window: no Kenku FM tab bar, no Lyre Player tab. On Windows the window's own buttons
     (minimise, maximise, close) are drawn by Windows at the top right, over Lyre's top strip (Electron's
     titleBarOverlay). The prototype draws a stand-in of the same size: 138 × 36 px of the screen, whatever the text
     size (so at 200 % it is 69 × 18 CSS px), marked data-window-buttons, hidden from screen readers and never
     focusable (Windows' own buttons handle their own focus and names). It takes the colour of whatever is under it.
     The space it needs is kept free by --wco-w and --wco-h (r8window.css): the top strip, Live's strip, Help's header
     and every sheet keep clear of it, so nothing of Lyre's is ever under the buttons.
     The empty parts of the top strip, Live's strip, Help's header and the logo drag the window (app-region: drag);
     every control, field and text with hover text in them does not (no-drag), so each stays clickable and keeps its
     hover text. Double-clicking an empty part maximises the window, and again puts it back (Windows does this for a
     drag area; the prototype shows it on its stand-in).

   Updates (SEC-14; the old main window used to show them)
     L.updateEvent({ kind: 'downloaded' | 'up-to-date' | 'error', error })  what Electron's updater reported
     downloaded  a standing note in the Saved pop-up's place: "Lyre has an update. Restart Lyre to use it." with
                 Restart now; it stays until dismissed
     error       the plain message (the same words as src/main/updateStatus.ts) once, as a warning card that says what
                 to do; not again until a check has worked in between (the checks repeat every 15 minutes)

   What a Kenku FM user brings (one-time move on the first start)
     L.arriveFromKenkuFM({ plainToken, bookmarks })  the prototype's stand-in for that move (kept in its storage until
     the page opens again): a token Kenku FM kept in plain text shows Settings › Discord bots' note once; the bookmarks
     replace the sample's on What came across. */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- what came across from Kenku FM ---------- */
  var LEGACY_KEY = 'lyre-legacy';
  function readLegacy() { try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function writeLegacy(o) { try { localStorage.setItem(LEGACY_KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable: lasts for this visit */ } }
  var legacy = readLegacy();
  if (Array.isArray(legacy.bookmarks)) D.moved.bookmarks = legacy.bookmarks;
  L.arriveFromKenkuFM = function (f) {
    legacy = { token: !!f.plainToken, bookmarks: Array.isArray(f.bookmarks) ? f.bookmarks : undefined };
    writeLegacy(legacy);
  };
  /* Settings › Discord bots shows the note while this is true; Got it ends it for good. */
  // Read again each time: on a reload, storage read while the page's scripts first run can come back empty.
  L.legacyTokenNote = function () { var now = readLegacy(); if (now.token) legacy = now; return !!legacy.token; };
  L.legacyTokenSeen = function () { legacy.token = false; writeLegacy(legacy); };

  /* ---------- the window's own buttons (the stand-in) ---------- */
  var maxed = false;
  var GLYPHS = {
    min: '<path d="M1 5.5h9"/>',
    max: '<rect x="1" y="1" width="9" height="9" rx="1"/>',
    restore: '<rect x="1" y="3" width="7" height="7" rx="1"/><path d="M3 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8"/>',
    close: '<path d="M1 1l9 9M10 1l-9 9"/>'
  };
  function glyph(n) { return '<svg viewBox="0 0 11 11" aria-hidden="true" focusable="false">' + GLYPHS[n] + '</svg>'; }
  function zoom() { return parseFloat(document.documentElement.style.zoom || '1') || 1; }
  function buttons() {
    var app = document.getElementById('app'), w = document.getElementById('lyre-winbtns');
    if (!w && app) {
      w = document.createElement('div');
      w.id = 'lyre-winbtns'; w.className = 'winbtns'; w.setAttribute('aria-hidden', 'true'); w.setAttribute('data-window-buttons', '');
      w.title = "The window's own buttons: Windows draws them in Lyre";
      app.appendChild(w);
      w.addEventListener('click', function (e) {
        var b = e.target.closest('[data-wb]'); if (!b) return;
        if (b.dataset.wb === 'max') toggleMax();
        else L.toast(b.dataset.wb === 'min' ? 'Windows puts Lyre on the taskbar' : 'Windows closes Lyre');
      });
    }
    return w;
  }
  function paintButtons() {
    var w = buttons(); if (!w) return;
    w.dataset.maximised = String(maxed);
    w.innerHTML = '<span class="wb" data-wb="min">' + glyph('min') + '</span><span class="wb" data-wb="max">' + glyph(maxed ? 'restore' : 'max') + '</span><span class="wb wb-close" data-wb="close">' + glyph('close') + '</span>';
    // Its colours are those of what is under it (in the app: titleBarOverlay's color and symbolColor, sent again when
    // the theme changes or Help opens beside the screen).
    var r = w.getBoundingClientRect(), under = document.elementsFromPoint(r.left + 2, r.top + 2).filter(function (e) { return !w.contains(e); })[0];
    var bg = '', ink = '';
    for (var n = under; n && !bg; n = n.parentElement) {
      var cs = getComputedStyle(n), c = (cs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) { bg = cs.backgroundColor; ink = getComputedStyle(under).color; }
    }
    w.style.setProperty('--wb-bg', bg || getComputedStyle(document.body).backgroundColor);
    w.style.setProperty('--wb-ink', ink || getComputedStyle(document.body).color);
  }
  function toggleMax() { maxed = !maxed; paintButtons(); L.say(maxed ? 'Lyre fills the screen' : 'Lyre is back to its size'); }
  L.windowMaximised = function () { return maxed; };

  // Where the strips are and what in them is not a drag area (the same list as r8window.css).
  var DRAG = '.viewhead, .lv-top, .help-head, .rail .logo';
  var NO_DRAG = 'a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=switch], [role=radio], [role=combobox], [tabindex]:not([tabindex="-1"]), [title], [contenteditable]';
  document.addEventListener('dblclick', function (e) {
    var t = e.target; if (!t.closest || !t.closest(DRAG) || t.closest(NO_DRAG) || t.closest('[data-window-buttons]')) return;
    e.preventDefault(); toggleMax();
  });

  // The prototype is the window: the stage's top is where a window's top would be, for sheets (r8window.css).
  function placeStage() {
    var h = document.documentElement, sw = document.getElementById('stagewrap');
    h.style.setProperty('--zoom', String(zoom()));
    if (sw) h.style.setProperty('--app-top', sw.offsetTop + 'px');
  }
  var render0 = L.render;
  L.render = function () { render0.apply(L, arguments); placeStage(); paintButtons(); paintProto8(); };
  window.addEventListener('resize', function () { placeStage(); paintButtons(); });

  /* ---------- updates ---------- */
  // The same words as src/main/updateStatus.ts (plainUpdateError and AGAIN).
  var PREFIX = 'Lyre could not check for updates', AGAIN = 'It tries again every 15 minutes; this version keeps working.';
  function plainUpdateError(raw) {
    raw = String(raw || '');
    if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN|ERR_NETWORK_CHANGED/i.test(raw)) return PREFIX + ': this computer seems to be offline.';
    if (/TIMED_OUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|HTTP Status 5\d\d|ERR_CONNECTION/i.test(raw)) return PREFIX + ': the update service did not answer.';
    if (/Update\.exe/i.test(raw) && /not found|ENOENT|cannot find/i.test(raw)) return PREFIX + ': the installer\'s updater is missing. Install Lyre again from the latest installer to get updates.';
    if (/Update\.exe|Squirrel|Command failed/i.test(raw)) return PREFIX + ': Windows could not run Lyre\'s updater. Restart the computer; if it keeps happening, install Lyre again from the latest installer.';
    var detail = (raw.split(/\r?\n/)[0] || '').trim().slice(0, 160);
    return detail ? PREFIX + ' (' + detail + ').' : PREFIX + '.';
  }
  var told = false;
  function slot(id, role) {
    var box = document.getElementById('lyre-toasts'), el = document.getElementById(id);
    if (!el && box) { el = document.createElement('div'); el.id = id; el.className = 'toast'; el.setAttribute('role', role); box.appendChild(el); }
    return el;
  }
  function clearSlot(id) { var el = document.getElementById(id); if (el) { el.innerHTML = ''; el.className = 'toast'; } }
  L.updateEvent = function (e) {
    e = e || {};
    if (e.kind === 'downloaded') {
      told = false; clearSlot('lyre-upd-fail');
      var r = slot('lyre-upd-ready', 'status');
      r.innerHTML = L.icon('restart', 's') + '<span class="grow">Lyre has an update. Restart Lyre to use it.</span>' +
        '<button class="btn s primary" type="button" data-act="updrestart" data-k="upd-restart">Restart now</button>' +
        '<button class="closer" type="button" data-act="updx" data-v="ready" aria-label="Dismiss: Lyre has an update" title="Dismiss">' + L.icon('close') + '</button>';
      r.className = 'toast t-stand';
    } else if (e.kind === 'up-to-date') {
      told = false;
    } else if (e.kind === 'error') {
      if (told) return;
      told = true;
      var plain = plainUpdateError(e.error), f = slot('lyre-upd-fail', 'alert');
      f.innerHTML = L.icon('warn', 's') + '<div class="grow"><b>' + esc(plain) + '</b> <span>' + esc(AGAIN) + '</span></div>' +
        '<button class="closer" type="button" data-act="updx" data-v="fail" aria-label="Dismiss: ' + esc(plain) + '" title="Dismiss">' + L.icon('close') + '</button>';
      f.className = 'toast t-fail';
    }
    L.placeToasts();
  };
  L.acts.updx = function (el) { clearSlot(el.dataset.v === 'fail' ? 'lyre-upd-fail' : 'lyre-upd-ready'); L.placeToasts(); };
  // The app: autoUpdater.quitAndInstall(); Lyre closes and opens again on the new version.
  L.acts.updrestart = function () { clearSlot('lyre-upd-ready'); L.toast('Lyre closes and opens again on the new version (not in the prototype)'); };

  /* ---------- the prototype's strip: show what cannot happen here ---------- */
  function paintProto8() {
    var p = document.getElementById('proto'); if (!p || p.dataset.r8) return;
    p.dataset.r8 = '1';
    var add = function (id, label, title, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = label; b.title = title;
      b.addEventListener('click', fn); p.appendChild(b);
    };
    add('pUpdReady', 'Update downloaded', 'Lyre\'s updater has downloaded a new version', function () { L.updateEvent({ kind: 'downloaded' }); });
    add('pUpdFail', 'Update check fails', 'The next update check fails because the computer is offline', function () { told = false; L.updateEvent({ kind: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' }); });
    add('pLegacy', 'Came from Kenku FM', 'Start as someone coming straight from Kenku FM, whose bot token was kept in plain text', function () {
      L.arriveFromKenkuFM({ plainToken: true, bookmarks: D.moved.bookmarks }); L.route('#/settings');
    });
  }
})();
