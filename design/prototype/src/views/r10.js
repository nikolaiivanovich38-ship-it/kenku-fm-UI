/* Round 10 (ROUND10.md): the final design for 0.6.0, merging the whole-app review (item 58) with round 9.

   Nik, 18 Nov (item 58): "…and then have them build a final design merging the two sets of insights and improving the
   UX design, flow, layout, look and feel and anything else they can improve."

   Most of round 10 is in the files it changes (each change marked "Round 10"). This file holds what is new:
     - the scene's "When it starts" line under its Story cue (prep review P4)
     - Rooms under Settings: its trail (Nik, 18 Nov 03:14, answer 2)
     - Connection lost and Try again (table review M3; 0.5.2 built it), and the prototype strip's way to show it
     - the warning pop-up, and pads with no sound marked before they are pressed (table review S3)
     - the first-start tour ends in Set up Lyre (Nik, 18 Nov 03:14, answer 5b) */
(function () {
  var esc = L.esc, D = L.data;

  /* ---------- the scene's start, in words, with Change… ---------- */
  L.sceneStartLine = function (ref, sc) {
    var w = L.stepsWords ? L.stepsWords('scene', ref) : '';
    var then = sc.then === 'end' ? 'then the next scene when its music ends' : sc.then === 'after' ? 'then the next scene after ' + (sc.afterMin || 5) + ' minutes' : 'then it waits for Next scene';
    var text = (w ? w.charAt(0).toUpperCase() + w.slice(1) + ', ' : '') + then;
    return '<div class="field cp-span r10-start" role="group" aria-labelledby="r10-st-' + sc.id + '"><span class="label" id="r10-st-' + sc.id + '">When it starts</span>' +
      '<div class="r10-start-row"><span class="grow r10-start-w">' + esc(text) + '</span>' +
      '<button class="btn s" data-act="stepsopen" data-what="scene" data-ref="' + esc(ref) + '" data-k="scstart-' + sc.id + '" aria-label="Change what ' + esc(sc.name || 'the scene') + ' does when it starts">Change…</button></div></div>';
  };

  /* ---------- Rooms, under Settings ---------- */
  if (L.views.outputs) L.views.outputs.crumbs = function () { return [{ href: '#/settings', label: 'Settings' }, { label: 'Rooms' }]; };

  /* ---------- Connection lost ---------- */
  L.acts.r10retry = function (el) {
    var b = L.bot(el.dataset.id); if (!b || b.lost === 'retry') return;
    b.lost = 'retry'; L.render(); L.say('Trying again to reach ' + L.outputName(b));
    setTimeout(function () { b.lost = false; L.render(); L.toast(L.outputName(b) + ' hears the music again'); }, 1200);
  };
  var swap0 = L.acts.lvbotswap;
  if (swap0) L.acts.lvbotswap = function (el) { var a = L.bot(el.dataset.from); if (a) a.lost = false; swap0(el); };
  // The prototype strip (not part of Lyre): drop the first room's connection, to show what Nik would see.
  function stripButton() {
    var p = document.getElementById('proto'); if (!p || !p.dataset.built || p.querySelector('#pDrop')) return;
    var head = p.querySelector('b'); if (head) head.textContent = 'Lyre · design round 10';
    var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'pDrop'; btn.textContent = 'Drop the connection';
    btn.title = 'The first room’s bot loses its connection to Discord, to show Connection lost';
    btn.addEventListener('click', function () { var b = L.bots().filter(function (x) { return x.status === 'connected'; })[0]; if (!b) { L.toast('No bot is in a room'); return; } b.lost = true; L.render(); });
    p.appendChild(btn);
  }

  /* ---------- the warning pop-up ---------- */
  // A failure looks like a failure: amber, a warning sign, and it stays 10 s (the Saved pop-up stays a few seconds).
  L.warn = function (text) {
    L.toast(text, { key: 'warn:' + text });
    var t = document.getElementById('lyre-toast'); if (!t) return;
    t.classList.add('t-warn');
    var first = t.firstElementChild; if (first && !t.querySelector('.r10-warn-i')) t.insertAdjacentHTML('afterbegin', '<span class="r10-warn-i" aria-hidden="true">' + L.icon('warn', 's') + '</span>');
    clearTimeout(L.warn.timer); L.warn.timer = setTimeout(function () { var x = document.getElementById('lyre-toast'); if (x && x.classList.contains('t-warn')) { x.innerHTML = ''; x.className = 'toast'; } }, 10000);
  };
  function noSound(p) { var s = p && p.sound; return !!p && (!s || (!(s.files || []).length && !s.tag)); }
  var fire0 = L.firePad;
  L.firePad = function (bid, pid, phase, target) {
    var b = L.board(bid), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === pid; })[0];
    if (noSound(p) && phase !== 'up') { L.warn(p.label + ' has no sound: give it one on its pad board'); return; }
    return fire0.apply(L, arguments);
  };
  // A missing track is marked "Missing" on its row before Nik presses (live.js); what the room does with it is the
  // engine's (0.5.2 skips it and says so), so the prototype does not imitate it.

  /* ---------- the first start: the tour, then Set up Lyre ---------- */
  var next0 = L.acts.tournext;
  if (next0) L.acts.tournext = function (el) {
    var last = !!document.querySelector('#lyre-tour [data-k="tour-next"]') && /Done/.test(document.querySelector('#lyre-tour [data-k="tour-next"]').textContent), first = L.state.tour !== 'done';
    next0(el);
    if (last && first && L.openHelp) setTimeout(function () { L.openHelp(); }, 0);
  };

  /* ---------- Esc in New campaign keeps what was typed (prep review S9) ---------- */
  // With something typed, the first Esc says what a second one does; an untouched dialog closes at once.
  document.addEventListener('input', function (e) { var s = e.target.closest && e.target.closest('#lyre-sheet'); if (s && /^New campaign$/.test((s.querySelector('#sheet-title') || {}).textContent || '')) s.dataset.typed = '1'; }, true);
  document.addEventListener('keydown', function (e) {
    var s = document.getElementById('lyre-sheet'); if (e.key !== 'Escape' || !s || s.dataset.typed !== '1' || document.querySelector('.menu')) return;
    if (s.dataset.armed === '1') return;                                  // the second Esc closes, as before
    e.preventDefault(); e.stopImmediatePropagation(); s.dataset.armed = '1';
    var f = s.querySelector('footer'); if (f && !f.querySelector('.r10-esc')) f.insertAdjacentHTML('afterbegin', '<span class="r10-esc grow" role="status">Press Esc again to throw away the new campaign</span>');
  }, true);

  /* ---------- after every render ---------- */
  var render0 = L.render;
  L.render = function () {
    render0.apply(L, arguments);
    stripButton();
    // The queue sits at the right, just above the Now playing bar, whatever the bar's height (one row or two).
    var q = document.getElementById('r9-queue'), bar = document.querySelector('#view .onairbar');
    if (q && bar && q.offsetParent) q.style.bottom = Math.max(8, Math.round(q.offsetParent.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 8)) + 'px';
    // Pads with no sound are dashed and say so on their face; pressing one explains in the warning pop-up.
    document.querySelectorAll('.lv-pad[data-bid]').forEach(function (el) {
      var b = L.board(el.dataset.bid), p = b && b.slots.concat(b.spare).filter(function (x) { return x && x.id === el.dataset.pid; })[0];
      var none = noSound(p); el.classList.toggle('r10-nosound', none);
      if (none && !el.querySelector('.r10-nosound-w')) el.insertAdjacentHTML('beforeend', '<span class="r10-nosound-w">No sound</span>');
    });
  };
})();
