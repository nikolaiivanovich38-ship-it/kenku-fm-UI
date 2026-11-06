/* Round 7, the shell (ROUND7.md): display options (UX-11), keyboard shortcuts and the Find and play palette (UX-12),
   no hidden text (UX-6). Added beside core.js, not into it, so the round 6 part 6 branch (top bar, Saved pop-up) and
   this one merge without touching the same lines.

   Display (Look and feel › Display; kept per computer, in its own storage key so nothing else overwrites it)
     density   'compact' (default, Nik's choice: 28 px controls, 24 px closers, 30 px rows) or 'comfortable'
     size      text size 100 to 200 %, in steps of 25: the whole page is zoomed (the app: webFrame.setZoomFactor), so
               text, controls and the space around them grow together and nothing has to be laid out twice
     contrast  'high': the quiet text colours (hints, faint, muted) become the main text colour, lines get stronger, in
               every theme (WCAG AAA 7:1 for all text); colour is never the only signal, so nothing else changes

   Shortcuts (Settings › Keyboard shortcuts): L.SHORTCUTS lists every key Lyre listens to, with Lyre's key and where it
   works. A person can give an action another key: L.keyFor(id) is the key now in use, L.keyName(event) the name of
   the key pressed ("Ctrl+K", "Shift+Esc", "Space"). A key already in use is refused with the action that has it. The
   palette's key is the one read here; Live's keys read the same map after the merge (ROUND7.md, "What Live needs").

   Find and play (Ctrl+K, anywhere, Live included): type part of a name. Tracks, playlists, pads and scenes are found.
     Enter        the usual action: a track or playlist plays on air, a pad fires, a scene starts
     Alt+Enter    preview it (only you)
     Shift+Enter  add it to the queue (the bottom of Up next in the first room)
     Ctrl+Enter   open it (its screen)
   Esc closes it and focus goes back to where it was.

   No hidden text: after every render, any text that is cut short (an ellipsis, or two lines then an ellipsis) gets
   its full text as hover text unless the row it is in already has it; and keyboard focus on such text, or on the row
   or button that holds it, shows the same text in a small tooltip under it. */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- display options (UX-11, A11Y-6) ---------- */
  var DISPLAY_KEY = 'lyre-display';
  function readDisplay() { try { return JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}') || {}; } catch (e) { return {}; } }
  var disp = Object.assign({ density: 'compact', size: 100, contrast: false }, readDisplay());
  L.display = function () { return disp; };
  function applyDisplay() {
    var h = document.documentElement;
    h.dataset.density = disp.density;
    if (disp.contrast) h.dataset.contrast = 'high'; else delete h.dataset.contrast;
    h.style.zoom = disp.size === 100 ? '' : String(disp.size / 100);
  }
  L.setDisplay = function (k, v) {
    disp[k] = v; try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(disp)); } catch (e) { /* storage unavailable: lasts for this visit */ }
    applyDisplay(); L.render();
  };
  applyDisplay();

  /* ---------- keyboard shortcuts (UX-12) ---------- */
  L.SHORTCUTS = [
    { id: 'palette', name: 'Find and play', key: 'Ctrl+K', where: 'Everywhere' },
    { id: 'nextScene', name: 'Next scene', key: 'Space', where: 'Live' },
    { id: 'fadeAll', name: 'Fade everything out', key: 'Shift+Esc', where: 'Live' },
    { id: 'undo', name: 'Undo', key: 'Ctrl+Z', where: 'Everywhere' },
    { id: 'find', name: 'Find a track', key: '/', where: 'Live' },
    { id: 'boxes', name: 'Next box', key: 'F6', where: 'Everywhere' },
    { id: 'back', name: 'Back', key: 'Alt+Left', where: 'Everywhere' },
    { id: 'help', name: 'Help', key: 'F1', where: 'Everywhere' }
  ];
  var KEYS_KEY = 'lyre-keys';
  var mine = {}; try { mine = JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') || {}; } catch (e) { mine = {}; }
  L.keyGuard = mine.__guard !== false;   // Next scene: a second press within a second is ignored (on by default)
  L.keyGlobal = !!mine.__global;          // Next scene and Fade everything out also work while another program is in front
  function saveKeys() { var o = Object.assign({}, mine, { __guard: L.keyGuard, __global: L.keyGlobal }); try { localStorage.setItem(KEYS_KEY, JSON.stringify(o)); } catch (e) { /* this visit only */ } }
  L.keyFor = function (id) { var s = L.SHORTCUTS.filter(function (x) { return x.id === id; })[0]; return mine[id] || (s && s.key) || ''; };
  L.setKey = function (id, key) { if (key) mine[id] = key; else delete mine[id]; saveKeys(); };
  L.resetKeys = function () { L.SHORTCUTS.forEach(function (s) { delete mine[s.id]; }); saveKeys(); };
  L.saveKeyOptions = saveKeys;
  var NAMES = { ' ': 'Space', Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
  L.keyName = function (e) {
    if (/^(Control|Shift|Alt|Meta)$/.test(e.key)) return '';
    var k = NAMES[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && e.key.length !== 1 ? 'Shift+' : e.shiftKey && /[A-Z]/i.test(e.key) ? 'Shift+' : '') + k;
  };
  L.keyUsedBy = function (key, except) { return L.SHORTCUTS.filter(function (s) { return s.id !== except && L.keyFor(s.id) === key; })[0] || null; };

  /* ---------- Find and play (UX-12) ---------- */
  var pal = null; // { el, q, act, back }
  function everything() {
    var out = [];
    D.tracks.forEach(function (t) { out.push({ kind: t.kind === 'fx' ? 'effect' : t.kind === 'amb' ? 'ambience' : 'track', name: L.title(t), id: t.id, t: t }); });
    D.playlists.forEach(function (p) { out.push({ kind: 'playlist', name: p.name, id: p.id, p: p }); });
    D.boards.forEach(function (b) { b.slots.concat(b.spare).forEach(function (p) { if (p) out.push({ kind: 'pad', name: p.label, sub: b.name, id: b.id + '/' + p.id, bid: b.id, pid: p.id }); }); });
    D.campaigns.forEach(function (c) { c.sessions.forEach(function (s) { s.scenes.forEach(function (sc, i) { out.push({ kind: 'scene', name: sc.name, sub: 'Session ' + s.n, id: c.id + '/' + s.id + '/' + i, cid: c.id, sid: s.id, idx: i }); }); }); });
    return out;
  }
  function results(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    var words = q.split(/\s+/);
    return everything().filter(function (r) { var n = (r.name + ' ' + (r.sub || '')).toLowerCase(); return words.every(function (w) { return n.indexOf(w) > -1; }); })
      .sort(function (a, b) { return (b.name.toLowerCase().indexOf(q) === 0) - (a.name.toLowerCase().indexOf(q) === 0) || (a.kind === 'playlist' ? -1 : 0) - (b.kind === 'playlist' ? -1 : 0); })
      .slice(0, 12);
  }
  function optLabel(r) { return r.name + ', ' + r.kind + (r.sub ? ', ' + r.sub : ''); }
  function paintPalette() {
    var rs = results(pal.q); if (pal.act >= rs.length) pal.act = Math.max(0, rs.length - 1); pal.rs = rs;
    var list = pal.el.querySelector('#pal-list'), inp = pal.el.querySelector('#pal-q');
    list.innerHTML = rs.map(function (r, i) {
      return '<li role="option" id="pal-o-' + i + '" aria-selected="' + (i === pal.act) + '" data-i="' + i + '" aria-label="' + esc(optLabel(r)) + '"><span class="pal-k">' + esc(r.kind) + '</span><span class="ellipsis grow" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' + (r.sub ? '<span class="faint ellipsis">' + esc(r.sub) + '</span>' : '') + '</li>';
    }).join('');
    list.hidden = !rs.length;
    inp.setAttribute('aria-expanded', String(!!rs.length));
    if (rs.length) inp.setAttribute('aria-activedescendant', 'pal-o-' + pal.act); else inp.removeAttribute('aria-activedescendant');
    pal.el.querySelector('#pal-none').textContent = pal.q.trim() && !rs.length ? 'Nothing is called that' : '';
    var r = rs[pal.act], acts = pal.el.querySelector('#pal-acts');
    acts.hidden = !r;
    if (r) acts.querySelectorAll('button').forEach(function (b) { b.disabled = (b.dataset.how === 'queue' && !(r.kind === 'track' || r.kind === 'playlist')) || (b.dataset.how === 'preview' && r.kind === 'scene' && !firstOfScene(r)); });
    var on = list.querySelector('[aria-selected="true"]'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function firstOfScene(r) { var s = L.session(r.cid, r.sid), sc = s && s.scenes[r.idx], q = sc ? L.sceneSequence(sc) : []; return q[0] ? q[0].trackId : ''; }
  L.openPalette = function () {
    if (pal) return; var back = document.activeElement;
    var el = document.createElement('div'); el.className = 'pal-wrap'; el.id = 'lyre-palette';
    el.innerHTML = '<div class="pal" role="dialog" aria-modal="true" aria-label="Find and play" aria-describedby="pal-keys">' +
      '<div class="search pal-search">' + L.icon('search') + '<input class="input" id="pal-q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="pal-list" autocomplete="off" spellcheck="false" aria-label="Type a track, playlist, pad or scene" placeholder="Type a track, playlist, pad or scene"></div>' +
      '<ul id="pal-list" class="pal-list" role="listbox" aria-label="Found" hidden></ul><p id="pal-none" class="faint pal-none" role="status"></p>' +
      '<div class="pal-acts" id="pal-acts" hidden><button class="btn s primary" data-how="air" type="button">' + L.icon('playair', 's') + 'Play on air</button>' +
        '<button class="btn s" data-how="preview" type="button">' + L.icon('headphones', 's') + 'Preview</button><button class="btn s" data-how="queue" type="button">' + L.icon('queue', 's') + 'Add to queue</button>' +
        '<button class="btn s ghost" data-how="open" type="button">' + L.icon('right', 's') + 'Open</button></div>' +
      '<p class="sr-only" id="pal-keys">Enter plays it on air. Alt+Enter previews it. Shift+Enter adds it to the queue. Ctrl+Enter opens it. Escape closes.</p></div>';
    document.body.appendChild(el);
    pal = { el: el, q: '', act: 0, back: back, rs: [] };
    var inp = el.querySelector('#pal-q'); inp.focus();
    inp.addEventListener('input', function () { pal.q = inp.value; pal.act = 0; paintPalette(); });
    el.addEventListener('pointerdown', function (e) { if (e.target === el) closePalette(); });
    el.querySelector('#pal-list').addEventListener('click', function (e) { var o = e.target.closest('[role=option]'); if (o) { pal.act = +o.dataset.i; run('air'); } });
    el.querySelector('#pal-acts').addEventListener('click', function (e) { var b = e.target.closest('button[data-how]'); if (b && !b.disabled) run(b.dataset.how); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!pal.rs.length) return; e.preventDefault(); pal.act = (pal.act + (e.key === 'ArrowDown' ? 1 : -1) + pal.rs.length) % pal.rs.length; paintPalette(); return; }
      if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); run(e.altKey ? 'preview' : e.shiftKey ? 'queue' : e.ctrlKey || e.metaKey ? 'open' : 'air'); return; }
      if (e.key === 'Tab') { var f = [].slice.call(el.querySelectorAll('input,button:not([disabled])')).filter(function (x) { return x.offsetParent; }); var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
      e.stopPropagation();
    });
    paintPalette(); L.say('Find and play');
  };
  function closePalette(keepFocus) {
    if (!pal) return; var back = pal.back; pal.el.remove(); pal = null;
    if (!keepFocus && back && document.contains(back)) back.focus();
  }
  L.closePalette = closePalette;
  function run(how) {
    var r = pal.rs[pal.act]; if (!r) return;
    var back = pal.back; closePalette(how === 'open');
    if (how === 'open') { L.route(r.kind === 'playlist' ? '#/playlist/' + r.id : r.kind === 'pad' ? '#/board/' + r.bid : r.kind === 'scene' ? '#/session/' + r.cid + '/' + r.sid : '#/library/' + r.id); return; }
    if (how === 'preview') {
      if (r.t) L.preview(r.id); else if (r.p) L.previewPlaylist(r.id); else if (r.kind === 'pad') L.previewPad(r.bid, r.pid); else { var f = firstOfScene(r); if (f) L.preview(f); }
      return;
    }
    if (how === 'queue') { L.acts.lvqueue({ dataset: r.p ? { whole: r.id, box: 'music' } : { id: r.id, box: 'music' } }); return; }
    if (r.t || r.p) L.acts.onair({ dataset: { kind: r.t ? 'track' : 'playlist', id: r.id } });
    else if (r.kind === 'pad') { L.firePad(r.bid, r.pid); L.toast('Pad on air: ' + r.name); }
    else { L.startScene(r.cid, r.sid, r.idx); L.toast('Scene on air: ' + r.name); }
    if (back && document.contains(back)) back.focus();
  }
  document.addEventListener('keydown', function (e) {
    if (pal || capture || document.getElementById('lyre-sheet') || e.defaultPrevented) return;
    if (L.keyName(e) === L.keyFor('palette')) { e.preventDefault(); e.stopPropagation(); L.closeMenu && L.closeMenu(); L.openPalette(); }
  }, true);

  /* Changing a key (Settings › Keyboard shortcuts): the next key pressed becomes the action's key. Esc keeps the old
     one; a key another action has is refused, with the name of that action. */
  var capture = null;
  L.captureKey = function (id, done) { capture = { id: id, done: done }; };
  L.capturingKey = function () { return capture && capture.id; };
  document.addEventListener('keydown', function (e) {
    if (!capture) return;
    var name = L.keyName(e); if (!name) return;
    e.preventDefault(); e.stopPropagation();
    var c = capture;
    if (name === 'Esc') { capture = null; c.done(null); return; }
    var other = L.keyUsedBy(name, c.id);
    if (other) { L.toast(name + ' is already ' + other.name + '. Press another key, or Esc to keep ' + L.keyFor(c.id)); return; }
    capture = null; c.done(name);
  }, true);

  /* ---------- no hidden text (UX-6) ---------- */
  function norm(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
  function isCut(e) {
    var cs = getComputedStyle(e), clamp = cs.getPropertyValue('-webkit-line-clamp');
    return (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) || (clamp && clamp !== 'none' && e.scrollHeight > e.clientHeight + 1);
  }
  function titled(e, text) {
    var key = text.toLowerCase().slice(0, 40);
    for (var n = e; n && n.id !== 'view' && n.tagName !== 'BODY'; n = n.parentElement) { var t = norm(n.getAttribute('title')).toLowerCase(); if (t && t.indexOf(key) > -1) return true; }
    return false;
  }
  function fillTitles() {
    var roots = [document.getElementById('view')]; roots.forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('*').forEach(function (e) {
        if (!e.offsetParent || e.closest('.sr-only') || e.children.length > 6) return;
        var text = norm(e.textContent); if (text.length < 3 || !isCut(e)) return;
        if (!titled(e, text)) e.setAttribute('title', text);
      });
    });
  }
  var fillAt = 0;
  function laterFill() { cancelAnimationFrame(fillAt); fillAt = requestAnimationFrame(function () { fillTitles(); }); }
  var render0 = L.render;
  L.render = function () { render0.apply(L, arguments); laterFill(); };
  window.addEventListener('resize', laterFill);

  var tip = null;
  function hideTip() { if (tip) { tip.remove(); tip = null; } }
  document.addEventListener('focusin', function (e) {
    hideTip(); var a = e.target; if (!a || !a.closest || !a.closest('#view, .onairbar')) return;
    var cut = (isCut(a) ? [a] : []).concat([].slice.call(a.querySelectorAll('*')).filter(function (x) { return x.offsetParent && x.children.length < 6 && norm(x.textContent).length > 2 && isCut(x); }));
    if (!cut.length) return;
    var words = cut.slice(0, 2).map(function (x) { return norm(x.textContent); }).join(' · ');
    tip = document.createElement('div'); tip.className = 'r7-tip'; tip.setAttribute('role', 'tooltip'); tip.id = 'lyre-tip'; tip.textContent = words;
    document.body.appendChild(tip);
    var r = a.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, z = parseFloat(document.documentElement.style.zoom || '1') || 1;
    var left = Math.min(Math.max(4, r.left), window.innerWidth / z - w - 4), top = r.bottom + 4;
    if (top + h > window.innerHeight / z - 4) top = Math.max(4, r.top - h - 4);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && tip) hideTip(); }, true);
  document.addEventListener('scroll', hideTip, true);
})();
