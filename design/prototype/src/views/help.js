/* FND-8 Help and the first-run tour, FND-9 Save diagnostics (design/prototype/HELP.md).

   Nik, 6 Nov 2026: less text and clutter on screen; help costs the screens nothing until asked for.
   - One Help entry at the foot of the rail (core.js railHTML), and F1, open a side panel: a search box, the articles
     grouped by task, an article with Back, and at its foot Take the tour and Save diagnostics…. The panel sits beside
     the screen (over it in a narrow window), so the steps of an article can be followed while it is open.
   - The tour: five short steps pointing at the rail, the Library, Campaigns (where scenes are), Live and the Now
     playing bar. Shown once, on the first start; Skip on every step; Esc skips; replayed from Help.
   - No help text is added to any screen.
   The articles are the app's own Markdown files (src/lyre/help/articles), inlined by build.js as LYRE_HELP_FILES.
   Their format and the search rule are the same as src/lyre/help/articles.ts. */
(function () {
  var esc = L.esc;

  /* ---------- articles ---------- */
  var GROUPS = ['Get started', 'Prepare', 'Run a session', 'Your library'];
  function parse(file, text) {
    var m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n')), meta = {};
    if (!m) return null;
    m[1].split('\n').forEach(function (l) { var i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    return { id: file.replace(/^\d+-/, '').replace(/\.md$/, ''), title: meta.title || file, group: meta.group || 'Prepare', words: meta.words || '', body: m[2].trim() };
  }
  var ARTICLES = (typeof LYRE_HELP_FILES !== 'undefined' ? LYRE_HELP_FILES : []).map(function (f) { return parse(f.file, f.text); }).filter(Boolean);
  function byId(id) { return ARTICLES.filter(function (a) { return a.id === id; })[0]; }
  function plain(s) { return s.replace(/\*\*|`/g, ''); }
  // Inline marks: **Label** names something on screen, `Key` is a key.
  function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<kbd class="kbd">$1</kbd>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
  function blocks(body) {
    return body.split(/\n\s*\n/).map(function (b) {
      var lines = b.split('\n');
      function list(tag, re) { return '<' + tag + '>' + lines.map(function (l) { return '<li>' + inline(l.replace(re, '')) + '</li>'; }).join('') + '</' + tag + '>'; }
      if (lines.every(function (l) { return /^- /.test(l); })) return list('ul', /^- /);
      if (lines.every(function (l) { return /^\d+\. /.test(l); })) return list('ol', /^\d+\. /);
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }
  /* Every word typed must be found in the title, the article's own search words or its text. Title hits first. */
  L.helpSearch = function (q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return ARTICLES.slice();
    return ARTICLES.map(function (a, i) {
      var title = a.title.toLowerCase(), extra = a.words.toLowerCase(), all = title + ' ' + extra + ' ' + plain(a.body).toLowerCase(), score = 0;
      for (var k = 0; k < words.length; k++) { var w = words[k]; if (all.indexOf(w) < 0) return null; score += title.indexOf(w) > -1 ? 3 : extra.indexOf(w) > -1 ? 2 : 1; }
      return { a: a, score: score, i: i };
    }).filter(Boolean).sort(function (x, y) { return y.score - x.score || x.i - y.i; }).map(function (x) { return x.a; });
  };
  L.helpArticles = ARTICLES;

  /* ---------- the panel ---------- */
  var H = { open: false, id: '', q: '', back: null, from: '', saving: false, result: null };
  L.helpOpen = function () { return H.open; };
  var aside = null;
  function panel() {
    if (aside) return aside;
    aside = document.createElement('aside');
    aside.id = 'lyre-help'; aside.className = 'helpsheet'; aside.hidden = true; aside.setAttribute('aria-labelledby', 'help-title');
    document.getElementById('app').appendChild(aside);
    aside.addEventListener('keydown', function (e) {
      keepKeys(e);
      if (e.key !== 'Escape' || e.shiftKey || e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation();
      if (e.target.dataset && e.target.dataset.k === 'help-q' && H.q) { H.q = ''; paintPanel(); return; }
      closeHelp();
    });
    return aside;
  }
  /* Keys typed in Help or the tour stay there: Live's single keys (Space, /, pad keys) must not fire from them. Keys
     with Ctrl or Alt, the F keys and Shift+Esc (fade all) still reach the screen. */
  function keepKeys(e) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d/.test(e.key) && !(e.key === 'Escape' && e.shiftKey)) e.stopPropagation();
  }
  function item(a) { return '<li><button class="help-item" data-act="helpopen" data-id="' + a.id + '" data-k="help-a-' + a.id + '">' + esc(a.title) + '</button></li>'; }
  function bodyHTML() {
    if (H.id) {
      var a = byId(H.id);
      return '<button class="btn ghost s help-back" data-act="helpback" data-k="help-back">' + L.icon('back', 's') + 'Back</button>' +
        '<article class="help-article" aria-labelledby="help-art-title"><h3 id="help-art-title" tabindex="-1" data-k="help-art-title">' + esc(a.title) + '</h3>' + blocks(a.body) + '</article>';
    }
    if (H.q.trim()) {
      var hits = L.helpSearch(H.q);
      return hits.length ? '<ul class="help-list" aria-label="Found">' + hits.map(item).join('') + '</ul>' : '<p class="muted help-none">Nothing found. Try other words.</p>';
    }
    return GROUPS.map(function (g, gi) {
      var list = ARTICLES.filter(function (a) { return a.group === g; });
      return list.length ? '<h3 class="help-group" id="help-g' + gi + '">' + esc(g) + '</h3><ul class="help-list" aria-labelledby="help-g' + gi + '">' + list.map(item).join('') + '</ul>' : '';
    }).join('');
  }
  function footHTML() {
    var r = H.result;
    return '<footer class="help-foot"><div class="help-foot-btns">' +
      '<button class="btn s" data-act="helptour" data-k="help-tour">' + L.icon('play', 's') + 'Take the tour</button>' +
      '<button class="btn s" data-act="helpdiag" data-k="help-diag"' + (H.saving ? ' disabled aria-busy="true"' : '') + '>' + L.icon('download', 's') + (H.saving ? 'Saving…' : 'Save diagnostics…') + '</button></div>' +
      (r ? '<div class="help-result">' + L.icon(r.ok ? 'check' : 'warn', 's') + '<span class="grow">' + esc(r.text) + '</span>' +
        (r.ok ? '<button class="btn ghost s" data-act="helpshow" data-k="help-show">Show in folder</button>' : '') + '</div>' : '') + '</footer>';
  }
  function paintPanel() {
    var el = panel();
    el.hidden = !H.open;
    if (!H.open) { el.innerHTML = ''; return; }
    L.paint(el, '<header class="help-head"><h2 id="help-title">Help</h2><button class="closer" data-act="helpclose" data-k="help-close" aria-label="Close help" title="Close help (Esc)">' + L.icon('close') + '</button></header>' +
      '<div class="help-search search">' + L.icon('search') + '<input class="input" type="search" placeholder="Search help" aria-label="Search help" data-input="helpq" data-k="help-q" value="' + esc(H.q) + '"></div>' +
      '<div class="help-body" data-scroll="help">' + bodyHTML() + '</div>' + footHTML());
  }
  function focusK(k) { var n = document.querySelector('[data-k="' + k + '"]'); if (n) n.focus({ preventScroll: false }); }
  function openHelp() {
    if (!H.open) { H.back = document.activeElement; H.open = true; }
    L.render(); focusK('help-q');
  }
  function closeHelp() {
    var back = H.back; H.open = false; H.id = ''; H.back = null; L.render();
    if (back && document.contains(back) && back !== document.body) back.focus(); else focusK('rail-help');
  }
  L.openHelp = openHelp;
  L.acts.help = function () { if (H.open) closeHelp(); else openHelp(); };
  L.acts.helpclose = function () { closeHelp(); };
  L.acts.helpopen = function (el) { H.from = el.dataset.id; H.id = el.dataset.id; paintPanel(); var b = aside.querySelector('.help-body'); if (b) b.scrollTop = 0; focusK('help-art-title'); };
  L.acts.helpback = function () { var from = H.from; H.id = ''; paintPanel(); focusK('help-a-' + from); };
  var countTimer;
  L.inputs.helpq = function (el) {
    H.q = el.value; H.id = ''; paintPanel();
    clearTimeout(countTimer);
    countTimer = setTimeout(function () { if (!H.q.trim()) return; var n = L.helpSearch(H.q).length; L.say(n ? n + (n === 1 ? ' article' : ' articles') : 'Nothing found'); }, 400);
  };
  // FND-9. In Lyre a folder chooser opens first (Documents); the prototype has none, so it "saves" to Documents.
  L.acts.helpdiag = function () {
    if (H.saving) return; H.saving = true; H.result = null; paintPanel(); L.say('Saving diagnostics');
    setTimeout(function () {
      var d = new Date(), two = function (n) { return String(n).padStart(2, '0'); };
      var name = 'Lyre diagnostics ' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + '-' + two(d.getMinutes()) + '.zip';
      H.saving = false; H.result = { ok: true, text: 'Saved in Documents: ' + name };
      paintPanel(); L.say(H.result.text); focusK('help-show');
    }, 600);
  };
  L.acts.helpshow = function () { L.toast('Lyre shows the file in its folder'); };
  L.acts.helptour = function () { H.open = false; H.id = ''; H.back = null; L.render(); startTour(true); };

  // F1 opens Help (and puts focus in its search box). Listened for on the window, after every screen's own keys,
  // so a Live pad on F1 plays instead (its key handler takes the key first).
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'F1' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); openHelp();
  });

  /* ---------- the tour ---------- */
  function railTarget(k) { return function () { return document.querySelector('#rail [data-k="' + k + '"]'); }; }
  var STEPS = [
    { title: "Lyre's places", text: 'Everything is a click away here. Help is at the foot, or press F1.', target: function () { return document.querySelector('#rail nav'); } },
    { title: 'Library', text: 'Add your music here and tag it.', target: railTarget('rail-library') },
    { title: 'Scenes', text: 'Scenes are in Campaigns: a campaign holds its sessions, a session its scenes.', target: railTarget('rail-campaigns') },
    { title: 'Live', text: 'Run the session here. Space starts the next scene.', target: railTarget('rail-live') },
    { title: 'Now playing', text: 'What plays shows down here. On air: the players hear it. Only you: your headphones.', bottom: true,
      target: function () { return document.querySelector('#view .onairbar') || document.getElementById('view'); } }
  ];
  var T = { step: -1, replay: false }, tourEl = null;
  function tourBox() {
    if (tourEl) return tourEl;
    tourEl = document.createElement('div'); tourEl.id = 'lyre-tour';
    document.body.appendChild(tourEl);
    tourEl.addEventListener('keydown', function (e) { keepKeys(e); if (e.key === 'Escape' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); endTour(); } });
    return tourEl;
  }
  function paintTour() {
    var box = tourBox();
    if (T.step < 0) { box.innerHTML = ''; return; }
    var s = STEPS[T.step], last = T.step === STEPS.length - 1, t = s.target(); if (!t) return;
    L.paint(box, '<div class="tour-ring" aria-hidden="true"></div><div class="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title tour-count" aria-describedby="tour-text" data-side="' + (s.bottom ? 'top' : 'right') + '">' +
      '<p class="tour-count" id="tour-count">' + (T.step + 1) + ' of ' + STEPS.length + '</p><h2 class="tour-title" id="tour-title">' + esc(s.title) + '</h2><p id="tour-text">' + esc(s.text) + '</p>' +
      '<div class="tour-btns"><button class="btn ghost s" data-act="tourskip" data-k="tour-skip">Skip</button><span class="grow"></span>' +
      (T.step ? '<button class="btn s" data-act="tourback" data-k="tour-back">Back</button>' : '') +
      '<button class="btn primary s" data-act="tournext" data-k="tour-next">' + (last ? 'Done' : 'Next') + '</button></div></div>');
    place(box, t, s);
  }
  // The popover sits to the right of a rail item, or above the bottom of the screen for the Now playing bar.
  function place(box, t, s) {
    var r = t.getBoundingClientRect(), ring = box.querySelector('.tour-ring'), pop = box.querySelector('.tour'), vw = window.innerWidth, vh = window.innerHeight;
    var rr = s.bottom && !t.classList.contains('onairbar') ? { left: r.left + 8, top: r.bottom - 52, width: r.width - 16, height: 44 } : { left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6 };
    ring.style.cssText = 'left:' + rr.left + 'px;top:' + rr.top + 'px;width:' + rr.width + 'px;height:' + rr.height + 'px';
    var w = pop.offsetWidth, h = pop.offsetHeight, left, top;
    if (s.bottom) {
      left = Math.max(8, Math.min(rr.left + 16, vw - w - 8)); top = Math.max(8, rr.top - h - 12);
      pop.style.setProperty('--arrow', Math.max(16, Math.min(w - 16, rr.left + 40 - left)) + 'px');
    } else {
      left = Math.min(rr.left + rr.width + 12, vw - w - 8); top = Math.max(8, Math.min(rr.top + rr.height / 2 - h / 2, vh - h - 8));
      pop.style.setProperty('--arrow', Math.max(14, Math.min(h - 14, rr.top + rr.height / 2 - top)) + 'px');
    }
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function startTour(replay) { T.step = 0; T.replay = !!replay; paintTour(); focusK('tour-next'); }
  function endTour() {
    var replay = T.replay; T.step = -1; L.state.tour = 'done'; L.save(); paintTour();
    if (replay) focusK('rail-help'); else { var h = document.querySelector('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }
  L.acts.tournext = function () { if (T.step >= STEPS.length - 1) { endTour(); return; } T.step++; paintTour(); focusK('tour-next'); };
  L.acts.tourback = function () { if (T.step > 0) { T.step--; paintTour(); focusK(T.step ? 'tour-back' : 'tour-next'); } };
  L.acts.tourskip = function () { endTour(); };

  // core.js calls this after every render: the panel and the tour follow the rail and the screen.
  var checked = false;
  L.paintHelp = function () {
    paintPanel();
    if (!checked) { checked = true; if (L.state.tour !== 'done') { setTimeout(function () { startTour(false); }, 0); return; } }
    if (T.step > -1) paintTour();
  };
})();
