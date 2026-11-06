/* Audio profile view (#/profile/<trackId> and #/profile/<trackId>/<place key>): where a track starts and ends, how it
   fades in and out, what happens at the end (loop back, move on to the next track, or stop), and markers.

   Nik (round 3): "an audio profile view which lets me set where the track should end, and either start looping or
   move to the next one. I will need to be able to listen to that and track the progression through it."
   "...set the fade duration and intensity and start and end points visually." "And define that differently for
   different cues and playlists."

   Places: the track's own settings (key '') apply everywhere, unless a playlist ('pl:<pid>'), a scene
   ('sc:<cid>:<sid>:<sceneId>') or (round 5, PLY-14) a session list ('ss:<cid>:<sid>') has its own (L.data.profiles, resolved by L.profileOf(t, key)). A place without its own
   settings is shown read-only until Nik chooses "Give this place its own settings" (L.profileStore(t, key, true)).

   Listening here is a Preview (only Nik hears it). The view runs its own smooth clock (requestAnimationFrame) and
   applies the fades to a simulated level meter; core's preview lane is stopped when it starts, so only one preview plays.

   L.profileLink(trackId, key, iconOnly) -> compact "Audio profile" link-button html for other views (Library,
   Playlists, Campaigns); key optional ('pl:<pid>' or 'sc:<cid>:<sid>:<sceneId>'). Candidate to move to _shared.js. */
(function () {
  var esc = L.esc, D = L.data;
  var S = {
    tid: null, key: '', pos: 0, playing: false, mode: 'play', loops: 0, event: null, handover: null, since: 0, last: 0,
    ctx: 0, saved: false, editing: null, editText: '', invalid: {}, keys1: true, focusK: null, lastSec: -1, undoClear: null
  };
  // Single-key shortcuts can be switched off (WCAG 2.1.4); remembered in this browser only.
  try { S.keys1 = localStorage.getItem('lyre-r2-profile-keys1') !== 'off'; } catch (e) { S.keys1 = true; }
  function saveKeys1() { try { localStorage.setItem('lyre-r2-profile-keys1', S.keys1 ? 'on' : 'off'); } catch (e) { /* storage unavailable: lasts for this visit */ } }

  /* ---------- link for other views ---------- */
  L.profileLink = function (tid, key, iconOnly) {
    if (typeof key === 'boolean') { iconOnly = key; key = ''; }
    var t = L.track(tid); if (!t) return '';
    var own = key ? !!(D.profiles[key] && D.profiles[key][tid]) : !!t.profile, tip = 'Audio profile: where ' + L.title(t) + ' starts, ends, fades, loops or moves on' + (key ? ' (' + placeName(key) + ')' : '');
    return '<a class="btn s' + (iconOnly ? ' icon' : '') + ' ap-link" href="#/profile/' + esc(tid) + (key ? '/' + esc(key) : '') + '" data-k="aplink-' + esc(tid) + '-' + esc((key || 'own').replace(/:/g, '_')) + '" title="' + esc(tip) + '"' +
      (iconOnly ? ' aria-label="Audio profile of ' + esc(L.title(t)) + '"' : '') + '>' + L.icon('wave', 's') + (iconOnly ? '' : 'Audio profile') +
      (own && !iconOnly ? '<span class="ap-link-dot" aria-hidden="true"></span><span class="sr-only"> (has settings)</span>' : '') + '</a>';
  };

  /* ---------- time and curve helpers ---------- */
  function fmt1(s) { var tt = Math.floor(Math.max(0, s) * 10 + 1e-6), m = Math.floor(tt / 600), sec = Math.floor((tt % 600) / 10); return m + ':' + (sec < 10 ? '0' : '') + sec + '.' + (tt % 10); }
  function parse(txt, secsOnly) {
    var s = String(txt).trim();
    if (secsOnly) return /^\d{1,3}(\.\d)?$/.test(s) ? +s : null;
    var m = s.match(/^(\d{1,3})(?::(\d{1,2}))?$/); if (!m) return null;
    if (m[2] == null) return +m[1]; // a bare number is seconds
    return +m[2] > 59 ? null : (+m[1]) * 60 + (+m[2]);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }
  function secs(n) { return (Math.round(n * 10) / 10) + ' s'; }
  // Fade curves. u = how far through the fade (0..1). Gentle 0-35 (eases off early, long quiet tail), Even 36-64 (straight line),
  // Sharp 65-100 (holds, then drops). The label and the curve use the same ranges.
  function fadeOutAt(u, shape) {
    u = clamp(u, 0, 1); var s = shape / 100;
    if (s <= .35) return Math.pow(1 - u, 1.5 + (.35 - s) / .35 * 2.5);
    if (s >= .65) return 1 - Math.pow(u, 1.5 + (s - .65) / .35 * 2.5);
    return 1 - u; // Even (36-64): a straight line
  }
  function fadeInAt(u, shape) { return fadeOutAt(1 - u, shape); }
  function shapeName(s) { return s <= 35 ? 'Gentle' : s < 65 ? 'Even' : 'Sharp'; }

  /* ---------- places ---------- */
  function placeName(key) {
    if (!key) return 'the track\'s own settings';
    var a = key.split(':');
    if (a[0] === 'pl') { var p = L.playlist(a[1]); return 'the playlist ' + (p ? p.name : a[1]); }
    if (a[0] === 'ss') { var ss = L.session(a[1], a[2]); return 'the session ' + (ss ? 'Session ' + ss.n + (ss.name ? ': ' + ss.name : '') : a[2]); }
    var s = L.session(a[1], a[2]), sc = s && s.scenes.filter(function (x) { return x.id === a[3]; })[0];
    return 'the scene ' + (sc ? sc.name : a[3]);
  }
  function hasOwn(t, key) { return key ? !!(D.profiles[key] && D.profiles[key][t.id]) : true; }
  function editable(t) { return hasOwn(t, S.key); }
  // Every place this track plays: playlists that contain it, and scenes that use it directly or through a playlist.
  function places(t) {
    var pls = [], scs = [], sss = [], seen = { '': 1 };
    function add(list, key, label) { if (seen[key]) return; seen[key] = 1; list.push({ key: key, label: label }); }
    function addScene(u) { add(scs, 'sc:' + u.campaign.id + ':' + u.session.id + ':' + u.scene.id, u.scene.name + ' (' + u.campaign.name + ', session ' + u.session.n + ')'); }
    function addSession(u) { add(sss, 'ss:' + u.campaign.id + ':' + u.session.id, 'Session ' + u.session.n + (u.session.name ? ': ' + u.session.name : '') + ' (' + u.campaign.name + ')'); }
    var inPls = L.playlistsOfTrack(t.id);
    inPls.forEach(function (p) { add(pls, 'pl:' + p.id, p.name); });
    L.usesOfTrackAll(t.id).forEach(function (u) { if (u.level === 'scene') addScene(u); else if (u.level === 'session') addSession(u); });
    inPls.forEach(function (p) { L.usesOfPlaylist(p.id).forEach(function (u) { if (u.level === 'scene') addScene(u); else if (u.level === 'session') addSession(u); }); });
    L.profileKeys(t).forEach(function (k) { add(k.indexOf('pl:') === 0 ? pls : k.indexOf('ss:') === 0 ? sss : scs, k, placeName(k).replace(/^the (playlist|scene|session) /, '')); });
    return { pls: pls, scs: scs, sss: sss };
  }
  function sceneOf(key) { var a = key.split(':'), s = L.session(a[1], a[2]); if (!s) return null; var i = s.scenes.map(function (x) { return x.id; }).indexOf(a[3]); return i < 0 ? null : { cid: a[1], sid: a[2], index: i, scene: s.scenes[i] }; }

  /* ---------- the profile being shown and edited ---------- */
  function prof(t) { return L.profileOf(t, S.key || null); }
  function copyOf(p) { return { start: p.start, end: p.end, after: p.after, loopStart: p.loopStart, loopXfade: p.loopXfade, fadeIn: { dur: p.fadeIn.dur, shape: p.fadeIn.shape }, fadeOut: { dur: p.fadeOut.dur, shape: p.fadeOut.shape }, markers: p.markers.map(function (m) { return { at: m.at, label: m.label }; }) }; }
  function write(t, patch) {
    if (!editable(t)) return false;
    var np = copyOf(prof(t));
    Object.keys(patch).forEach(function (k) { np[k] = patch[k]; });
    var span = np.end - np.start;
    np.loopStart = clamp(np.loopStart, np.start, np.end - 1);
    np.fadeOut.dur = clamp(np.fadeOut.dur, 0, span); np.fadeIn.dur = clamp(np.fadeIn.dur, 0, span - np.fadeOut.dur);
    np.loopXfade = clamp(np.loopXfade, 0, Math.min(10, np.end - np.loopStart - 1));
    if (S.key) { D.profiles[S.key] = D.profiles[S.key] || {}; D.profiles[S.key][t.id] = np; } else t.profile = np;
    S.saved = true; return true;
  }
  var POINT = { start: 'Start', end: 'End', loop: 'Loop start', fadein: 'Fade in', fadeout: 'Fade out', xfade: 'Loop crossfade' };
  function value(p, which) { return { start: p.start, end: p.end, loop: p.loopStart, fadein: p.fadeIn.dur, fadeout: p.fadeOut.dur, xfade: p.loopXfade }[which]; }
  function range(t, which) {
    var p = prof(t), span = p.end - p.start;
    return { start: [0, p.end - 1], end: [p.start + 1, t.dur], loop: [p.start, p.end - 1], fadein: [0, span - p.fadeOut.dur], fadeout: [0, span - p.fadeIn.dur], xfade: [0, Math.min(10, p.end - p.loopStart - 1)] }[which];
  }
  // Move one point or length, keeping Start < End, the loop start between them and the fades inside.
  function movePoint(t, which, v) {
    var p = prof(t), r = range(t, which); v = clamp(Math.round(v * (which.indexOf('fade') === 0 || which === 'xfade' ? 2 : 1)) / (which.indexOf('fade') === 0 || which === 'xfade' ? 2 : 1), r[0], r[1]);
    var patch = {};
    if (which === 'start') patch.start = v; else if (which === 'end') patch.end = v; else if (which === 'loop') patch.loopStart = v; else if (which === 'xfade') patch.loopXfade = v;
    else if (which === 'fadein') patch.fadeIn = { dur: v, shape: p.fadeIn.shape }; else patch.fadeOut = { dur: v, shape: p.fadeOut.shape };
    write(t, patch); return v;
  }
  function envAt(p, pos, looped) {
    if (pos < p.start || pos > p.end) return 1;
    var v = 1;
    if (!looped && p.fadeIn.dur > 0 && pos < p.start + p.fadeIn.dur) v *= fadeInAt((pos - p.start) / p.fadeIn.dur, p.fadeIn.shape);
    if (p.fadeOut.dur > 0 && pos > p.end - p.fadeOut.dur) v *= fadeOutAt((pos - (p.end - p.fadeOut.dur)) / p.fadeOut.dur, p.fadeOut.shape);
    return v;
  }

  // Where "the next track" comes from. In a place, that place decides; for the track's own settings, each scene or
  // playlist that plays it, or the Library if none does yet.
  function nextIn(list, t) { var i = list.indexOf(t.id); if (i < 0) return null; for (var j = 1; j < list.length; j++) { var n = list[(i + j) % list.length]; if (n !== t.id) return n; } return null; }
  function contexts(t) {
    var out = [];
    if (S.key) {
      if (S.key.indexOf('pl:') === 0) { var pl = L.playlist(S.key.slice(3)), n1 = pl && nextIn(L.playlistTracks(pl).map(function (x) { return x.id; }), t); if (n1) out.push({ label: 'Next in the playlist ' + pl.name, next: n1, place: S.key }); }
      else { var sc = sceneOf(S.key), n2 = sc && nextIn(L.sceneSequence(sc.scene).map(function (x) { return x.trackId; }), t); if (n2) out.push({ label: 'Next in the scene ' + sc.scene.name, next: n2, place: S.key }); }
      if (out.length) return out;
    }
    var pl2 = places(t);
    // Places with their own settings do not use the track's, so they are left out here.
    pl2.scs.forEach(function (x) { if (hasOwn(t, x.key)) return; var sc = sceneOf(x.key), n = sc && nextIn(L.sceneSequence(sc.scene).map(function (y) { return y.trackId; }), t); if (n) out.push({ label: 'In the scene ' + x.label, next: n, place: x.key }); });
    pl2.pls.forEach(function (x) { if (hasOwn(t, x.key)) return; var p = L.playlist(x.key.slice(3)), n = p && nextIn(L.playlistTracks(p).map(function (y) { return y.id; }), t); if (n) out.push({ label: 'In the playlist ' + x.label, next: n, place: x.key }); });
    if (!out.length) {
      var same = D.tracks.filter(function (x) { return x.kind === t.kind; }), k = same.indexOf(t);
      out.push({ label: 'The next track in the Library', next: same[(k + 1) % same.length].id, place: '', lib: true });
    }
    return out;
  }
  function ctxOf(t) { var c = contexts(t); return c[Math.min(S.ctx, c.length - 1)]; }

  /* ---------- deterministic pseudo-waveform (seeded by the track id) ---------- */
  var shapes = {};
  function rng(str) {
    var a = 1779033703 ^ str.length; for (var i = 0; i < str.length; i++) { a = Math.imul(a ^ str.charCodeAt(i), 3432918353); a = a << 13 | a >>> 19; }
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  }
  function shape(t) {
    if (shapes[t.id]) return shapes[t.id];
    var N = 1200, r = rng(t.id), out = new Array(N), cuts = [0], lv = [], i;
    // Sections: random breakpoints plus the track's own markers, so a marker like "Choir enters" lands on a change.
    var k = 5 + Math.floor(r() * 5); for (i = 0; i < k; i++) cuts.push(r());
    L.profileOf(t).markers.forEach(function (m) { cuts.push(m.at / t.dur); });
    cuts.push(1); cuts.sort(function (a, b) { return a - b; });
    // Section levels follow the track's loudness curve (core L.levels), so the waveform and the suggested shape agree.
    for (i = 0; i < cuts.length; i++) lv.push(Math.max(.12, Math.min(1, L.levelAt(t, (cuts[i] + (i < cuts.length - 1 ? cuts[i + 1] : 1)) / 2) * (.9 + r() * .2))));
    var ph1 = r() * 6.3, ph2 = r() * 6.3;
    for (i = 0; i < N; i++) {
      var x = i / N, s = 0; while (s < cuts.length - 2 && x > cuts[s + 1]) s++;
      var a = cuts[s], b = cuts[s + 1], f = b > a ? (x - a) / (b - a) : 0, ease = f < .12 ? f / .12 : 1;
      var level = lv[s] * ease + (s ? lv[s - 1] : lv[s]) * (1 - ease);
      var wob = .82 + .12 * Math.sin(x * 37 + ph1) + .06 * Math.sin(x * 211 + ph2);
      var env = Math.min(1, x / .015) * Math.min(1, (1 - x) / .02);
      out[i] = clamp(level * wob * env * (.72 + r() * .28), .03, 1);
    }
    return (shapes[t.id] = out);
  }
  function ampAt(t, pos) { var sh = shape(t); return sh[clamp(Math.floor(pos / t.dur * sh.length), 0, sh.length - 1)]; }

  /* ---------- playback (simulated; Preview) ---------- */
  function track() { return L.track(S.tid); }
  function gain(t) {
    var p = prof(t);
    if (S.handover) { var n = L.track(S.handover.id); return envAt(L.profileOf(n, S.handover.place || null), S.handover.pos, false); }
    if (p.after === 'loop' && p.loopXfade > 0 && S.pos > p.end - p.loopXfade && S.pos < p.end) return 1; // crossfading: out and in together
    return envAt(p, S.pos, S.loops > 0);
  }
  function play(mode) {
    var t = track(); if (!t) return; var p = prof(t);
    if (L.pb.preview) L.stopPreview(); // only one preview at a time
    S.mode = mode || 'play'; S.event = null; S.handover = null; S.since = 0;
    if (S.mode === 'last10') { S.pos = Math.max(p.start, p.end - 10); S.loops = 0; }
    else if (S.pos >= t.dur - .05) { S.pos = p.start; S.loops = 0; }
    S.playing = true; S.last = performance.now();
    L.say(S.mode === 'last10' ? 'Preview: the last 10 seconds before End, from ' + L.fmt(S.pos) : 'Preview from ' + L.fmt(S.pos));
    L.render(); requestAnimationFrame(frame);
  }
  function pause(msg) { S.playing = false; if (msg) L.say(msg); L.render(); }
  function stop() { S.playing = false; S.handover = null; S.event = null; S.mode = 'play'; S.loops = 0; var t = track(); if (t) S.pos = prof(t).start; L.say('Preview stopped'); L.render(); }
  function seek(v, silent) { var t = track(); if (!t) return; S.pos = clamp(v, 0, t.dur); S.handover = null; S.event = null; if (!silent) L.say('Playhead ' + L.fmt(S.pos)); }
  function frame(now) {
    if (!S.playing) return;
    var dt = Math.min(.25, (now - S.last) / 1000); S.last = now; advance(dt); paintLive();
    if (S.playing) requestAnimationFrame(frame);
  }
  function advance(dt) {
    var t = track(); if (!t) { S.playing = false; return; } var p = prof(t);
    if (S.handover) { S.handover.pos += dt; S.since += dt; if (S.since >= S.handover.limit) pause('Preview stopped ' + Math.round(S.handover.limit) + ' seconds into the next track'); return; }
    if (S.event && S.event.type === 'loop' && S.mode === 'last10') { S.since += dt; if (S.since >= 5) { S.pos += dt; pause('Preview stopped after the loop'); return; } }
    var before = S.pos; S.pos += dt;
    if (before < p.end && S.pos >= p.end) {
      if (p.after === 'loop') {
        S.pos = p.loopStart + (S.pos - p.end); S.loops++; S.since = 0;
        S.event = { type: 'loop', text: (p.loopXfade ? 'Crossfaded over ' + secs(p.loopXfade) + ' back to ' : 'Looped back to ') + L.fmt(p.loopStart) + (S.loops > 1 ? ' (' + times(S.loops) + ')' : '') };
        L.say(S.event.text); L.render();
      } else if (p.after === 'next') {
        var c = ctxOf(t), n = L.track(c.next); S.pos = p.end; S.since = 0;
        S.handover = { id: n.id, place: c.place, pos: L.profileOf(n, c.place || null).start, limit: S.mode === 'last10' ? 6 : 10 };
        S.event = { type: 'next', text: 'Moved on to the next track: ' + L.title(n) };
        L.say(S.event.text); L.render();
      } else {
        S.pos = p.end; S.event = { type: 'stop', text: 'Stopped at End (' + L.fmt(p.end) + '). On air, Lyre stops here.' };
        pause(S.event.text);
      }
      return;
    }
    if (S.pos >= t.dur) { S.pos = t.dur; S.event = { type: 'eof', text: 'End of the file. Players never hear the part after End.' }; pause(S.event.text); }
  }
  // Leaving the view, or opening another track or place, stops the preview.
  window.addEventListener('lyre:route', function () { var r = L.current(); if (S.playing && (r.name !== 'profile' || r.p.tid !== S.tid || (r.p.ctx || '') !== S.key)) { S.playing = false; S.handover = null; } });

  /* ---------- painting without a re-render (every frame while listening) ---------- */
  var colours = null;
  function readColours() {
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue(n).trim(); };
    colours = { music: g('--music'), ink: g('--ink'), out: g('--line-strong'), preview: g('--preview'), env: g('--ink-2'), bg: g('--surface') };
  }
  function draw(root) {
    var t = track(), cv = root.querySelector('.ap-canvas'); if (!t || !cv) return;
    if (!colours) readColours();
    var W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var p = prof(t), sh = shape(t), stepPx = W >= 640 ? 3 : W >= 420 ? 4 : 5, bw = stepPx - 1, n = Math.floor(W / stepPx), N = sh.length, mid = H / 2, top = 10;
    for (var i = 0; i < n; i++) {
      var a = Math.floor(i / n * N), b = Math.max(a + 1, Math.floor((i + 1) / n * N)), amp = 0;
      for (var j = a; j < b; j++) if (sh[j] > amp) amp = sh[j];
      var sec = (i + .5) / n * t.dur, inside = sec >= p.start && sec <= p.end, e = envAt(p, sec, false);
      var col = !inside ? colours.out : sec <= S.pos ? (S.playing ? colours.preview : colours.ink) : colours.music;
      // Under a fade the bars are drawn smaller and fainter: you can see where it gets quieter.
      var h = Math.max(2, amp * e * (H - 2 * top)); ctx.globalAlpha = inside ? .45 + .55 * e : .5; ctx.fillStyle = col;
      ctx.fillRect(i * stepPx, Math.round(mid - h / 2), bw, Math.round(h));
    }
    ctx.globalAlpha = 1;
    // The volume envelope: full volume along the top, falling towards the centre line as it fades.
    var x = function (s) { return s / t.dur * W; }, y = function (v) { return mid - v * (mid - top); };
    ctx.strokeStyle = colours.env; ctx.lineWidth = 2; ctx.beginPath();
    var steps = Math.max(40, Math.round(x(p.end) - x(p.start)) / 2);
    for (var k = 0; k <= steps; k++) { var s = p.start + (p.end - p.start) * k / steps; if (k) ctx.lineTo(x(s), y(envAt(p, s, false))); else ctx.moveTo(x(s), y(envAt(p, s, false))); }
    ctx.stroke();
    // A crossfaded loop: the end slopes down and the loop start slopes up over the crossfade (dashed).
    if (p.after === 'loop' && p.loopXfade > 0) {
      ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x(p.end - p.loopXfade), y(1)); ctx.lineTo(x(p.end), y(0));
      ctx.moveTo(x(p.loopStart), y(0)); ctx.lineTo(x(p.loopStart + p.loopXfade), y(1)); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function pct(t, s) { return (clamp(s, 0, t.dur) / t.dur * 100).toFixed(3) + '%'; }
  function paintLive() {
    var root = document.getElementById('view'), t = track(); if (!t || !root.querySelector('.ap-wave')) return;
    var p = prof(t), q = function (sel) { return root.querySelector(sel); }, ph = q('.ap-ph');
    if (ph) { ph.style.left = pct(t, S.pos); ph.classList.toggle('on', S.playing); }
    if (q('.ap-pos')) q('.ap-pos').textContent = fmt1(S.pos);
    if (q('.ap-toend')) q('.ap-toend').textContent = toEndText(p);
    var g = gain(t), amp = S.handover ? ampAt(L.track(S.handover.id), S.handover.pos) : ampAt(t, S.pos), lvl = S.playing ? g * (.35 + .65 * amp) : 0;
    var m = q('.ap-meter');
    if (m) {
      m.querySelector('.ap-meter-bar').style.width = Math.round(lvl * 100) + '%';
      m.querySelector('.ap-meter-v').textContent = Math.round(g * 100) + '%';
      m.setAttribute('aria-valuenow', Math.round(g * 100));
      var xf = !S.handover && p.after === 'loop' && p.loopXfade > 0 && S.pos > p.end - p.loopXfade && S.pos < p.end;
      m.querySelector('.ap-meter-s').textContent = xf ? 'crossfading' : g < .995 ? (S.handover || S.pos < p.start + p.fadeIn.dur ? 'fading in' : 'fading out') : '';
    }
    if (S.handover && q('.ap-ho-time')) { var n = L.track(S.handover.id); q('.ap-ho-time').textContent = fmt1(S.handover.pos); q('.ap-ho-bar').style.width = Math.min(100, S.handover.pos / L.profileOf(n, S.handover.place || null).end * 100) + '%'; }
    var sc = q('.ap-scrub'), sec = Math.floor(S.pos);
    if (sc && sec !== S.lastSec) { S.lastSec = sec; sc.setAttribute('aria-valuenow', sec); sc.setAttribute('aria-valuetext', L.fmt(S.pos)); var ws = q('.ap-wavepane .pane-status'); if (ws && S.playing) ws.textContent = 'Previewing ' + L.fmt(S.pos); }
    draw(root);
  }
  function toEndText(p) { return S.pos > p.end + .05 ? 'past End' : fmt1(p.end - S.pos); }

  /* ---------- render pieces ---------- */
  function dis(t) { return editable(t) ? '' : ' disabled'; }
  function radio(t, after, v, icon, label, sub) {
    return '<label class="ap-opt' + (after === v ? ' on' : '') + '"><input type="radio" name="ap-after" value="' + v + '" data-input="apafter" data-k="ap-after-' + v + '"' + (after === v ? ' checked' : '') + dis(t) + '>' +
      '<span class="ap-opt-t">' + L.icon(icon, 's') + '<b>' + label + '</b></span><span class="ap-opt-s">' + sub + '</span></label>';
  }
  function timeInput(t, which, val, secsOnly, label) {
    var id = 'ap-f-' + which, bad = S.invalid[which];
    return '<input id="' + id + '" class="input num ap-time' + (secsOnly ? ' ap-secs' : '') + '" data-input="apfield" data-f="' + which + '" data-k="' + id + '" value="' + esc(S.editing === which ? S.editText : val) + '" inputmode="' + (secsOnly ? 'decimal' : 'numeric') + '" autocomplete="off" spellcheck="false"' +
      (label ? ' aria-label="' + esc(label) + '"' : '') + (bad ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + dis(t) + '>';
  }
  function err(which) { return S.invalid[which] ? '<span class="ap-err" id="ap-f-' + which + '-err">' + esc(S.invalid[which]) + '</span>' : ''; }
  function field(t, which, value, btnLabel, key) {
    return '<div class="ap-frow"><label for="ap-f-' + which + '">' + POINT[which] + '</label>' + timeInput(t, which, L.fmt(value), false) +
      '<button class="btn s" data-act="aphere" data-f="' + which + '" data-k="ap-here-' + which + '"' + (key && S.keys1 ? ' aria-keyshortcuts="' + key + '"' : '') + ' title="' + esc(btnLabel) + ' (' + L.fmt(S.pos) + ')' + (key && S.keys1 ? ', key ' + key : '') + '"' + dis(t) + '>' + L.icon('arrow', 's') + btnLabel + '</button>' + err(which) + '</div>';
  }
  function stepper(t, which, val, unitLabel) {
    return '<span class="ap-step">' +
      '<button class="btn s icon" data-act="apstep" data-f="' + which + '" data-d="-1" data-k="ap-st-' + which + '-m" title="Shorter ' + unitLabel + ' (1 s less)" aria-label="Shorter ' + unitLabel + '"' + dis(t) + '>' + L.icon('minus', 's') + '</button>' +
      timeInput(t, which, String(val), true, unitLabel + ' length in seconds') +
      '<button class="btn s icon" data-act="apstep" data-f="' + which + '" data-d="1" data-k="ap-st-' + which + '-p" title="Longer ' + unitLabel + ' (1 s more)" aria-label="Longer ' + unitLabel + '"' + dis(t) + '>' + L.icon('plus', 's') + '</button><span class="faint">s</span></span>';
  }
  function sketchPath(kind, shp) {
    var d = '', w = 60, h = 22;
    for (var i = 0; i <= 30; i++) { var u = i / 30, v = kind === 'in' ? fadeInAt(u, shp) : fadeOutAt(u, shp); d += (i ? 'L' : 'M') + (2 + u * w).toFixed(1) + ' ' + (3 + (1 - v) * h).toFixed(1); }
    return d;
  }
  function fadeBlock(t, p, kind) {
    var f = kind === 'in' ? p.fadeIn : p.fadeOut, which = 'fade' + kind, label = kind === 'in' ? 'Fade in' : 'Fade out';
    return '<div class="ap-fadeblock"><div class="ap-fb-h"><b id="ap-fl-' + kind + '">' + label + '</b></div>' +
      '<div class="ap-fb-row"><span class="ap-fb-l">Length</span>' + stepper(t, which, f.dur, label.toLowerCase()) +
      '<button class="btn s ghost" data-act="aphere" data-f="' + which + '" data-k="ap-here-' + which + '" title="' + (kind === 'in' ? 'Fade in from Start up to the playhead' : 'Fade out from the playhead to End') + ' (' + L.fmt(S.pos) + ')"' + dis(t) + '>' + L.icon('arrow', 's') + (kind === 'in' ? 'Up to playhead' : 'From playhead') + '</button>' + err(which) + '</div>' +
      '<div class="ap-fb-row"><label class="ap-fb-l" for="ap-sh-' + kind + '">Intensity</label><span class="ap-int"><span class="hint" aria-hidden="true">Gentle</span>' +
      '<input type="range" id="ap-sh-' + kind + '" min="0" max="100" step="5" value="' + f.shape + '" data-input="apshape" data-f="' + kind + '" data-k="ap-sh-' + kind + '" aria-label="' + label + ' intensity" aria-valuetext="' + shapeName(f.shape) + ', ' + f.shape + ' of 100"' + dis(t) + '>' +
      '<span class="hint" aria-hidden="true">Sharp</span></span>' +
      '<svg class="ap-sketch" viewBox="0 0 64 28" aria-hidden="true"><path class="ap-sk-base" d="M2 25H62"/><path class="ap-sk" data-sketch="' + kind + '" d="' + sketchPath(kind, f.shape) + '"/></svg>' +
      '<span class="ap-shname" data-shname="' + kind + '">' + shapeName(f.shape) + '</span></div></div>';
  }
  function handle(t, which, v, label, cls) {
    var r = range(t, which), ro = !editable(t), len = which.indexOf('fade') === 0;
    return '<div class="ap-h ' + cls + '" role="slider" tabindex="0" data-aph="' + which + '" data-k="ap-h-' + which + '" style="left:' + pct(t, which === 'fadein' ? value(prof(t), 'start') + v : which === 'fadeout' ? value(prof(t), 'end') - v : v) + '" aria-label="' + label + '" aria-orientation="horizontal"' +
      (ro ? ' aria-readonly="true"' : '') + ' aria-valuemin="' + r[0] + '" aria-valuemax="' + r[1] + '" aria-valuenow="' + v + '" aria-valuetext="' + (len ? secs(v) : L.fmt(v)) + '" title="' + label + ' ' + (len ? secs(v) : L.fmt(v)) + (ro ? ' (the track\'s settings: not editable in this place)' : len ? ': drag along the volume line, or arrow keys to change the length' : ': drag, or use the arrow keys (Shift for 10 s)') + '">' +
      (len ? '<span class="ap-knob"></span>' : '<span class="ap-htab">' + L.icon('drag', 's') + (which === 'loop' ? 'Loop' : label) + '</span>') + '</div>';
  }
  function waveHTML(t, p) {
    return '<div class="ap-wave' + (editable(t) ? '' : ' ro') + '">' +
      '<div class="ap-out" style="left:0;width:' + pct(t, p.start) + '"><span>Not played</span></div>' +
      '<div class="ap-out" style="left:' + pct(t, p.end) + ';right:0"><span>Not played</span></div>' +
      (p.after === 'loop' ? '<div class="ap-loop" style="left:' + pct(t, p.loopStart) + ';width:' + ((p.end - p.loopStart) / t.dur * 100).toFixed(3) + '%"></div>' : '') +
      '<canvas class="ap-canvas" aria-hidden="true"></canvas>' +
      '<div class="ap-scrub" role="slider" tabindex="0" data-k="ap-scrub" aria-label="Playhead" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="' + t.dur + '" aria-valuenow="' + Math.floor(S.pos) + '" aria-valuetext="' + L.fmt(S.pos) + '" title="Click or drag to move the playhead; arrow keys move it 1 s (Shift: 10 s)"></div>' +
      '<div class="ap-ph' + (S.playing ? ' on' : '') + '" style="left:' + pct(t, S.pos) + '" aria-hidden="true"></div>' +
      p.markers.map(function (m) { return '<span class="ap-flag" data-act="apgo" data-at="' + m.at + '" style="left:' + pct(t, m.at) + '" title="' + esc(m.label) + ' (' + L.fmt(m.at) + '): go there" aria-hidden="true"><span class="ap-flag-l">' + esc(m.label) + '</span></span>'; }).join('') +
      handle(t, 'start', p.start, 'Start', 'ap-h-start') + handle(t, 'end', p.end, 'End', 'ap-h-end') + (p.after === 'loop' ? handle(t, 'loop', p.loopStart, 'Loop start', 'ap-h-loop') : '') +
      handle(t, 'fadein', p.fadeIn.dur, 'Fade in length', 'ap-fk ap-fk-in') + handle(t, 'fadeout', p.fadeOut.dur, 'Fade out length', 'ap-fk ap-fk-out') +
      '<div class="ap-ruler" aria-hidden="true"></div></div>';
  }
  function listenHTML(t, p) {
    var c = ctxOf(t), onAir = L.pb.music && L.pb.music.id === t.id;
    var tr = '<div class="ap-transport" role="group" aria-label="Preview: only you hear it">' +
      '<button class="btn ap-pvbtn" data-act="applay" data-k="ap-play" aria-pressed="' + S.playing + '"' + (S.keys1 ? ' aria-keyshortcuts="Space"' : '') + ' title="' + (S.playing ? 'Pause the preview' : 'Preview from the playhead: only you hear it') + (S.keys1 ? ' (Space)' : '') + '">' +
      L.icon(S.playing ? 'pause' : 'headphones', 's') + (S.playing ? 'Pause' : 'Play') + '</button>' +
      '<button class="btn ap-pvbtn" data-act="aplast" data-k="ap-last" title="Preview from 10 seconds before End, to hear the fade, the end and what follows it">' + L.icon('headphones', 's') + 'Play the last 10 s before End</button>' +
      '<button class="btn s icon" data-act="apstop" data-k="ap-stop" title="Stop the preview and go back to Start" aria-label="Stop the preview">' + L.icon('stop', 's') + '</button></div>';
    var ro = '<div class="ap-readouts">' +
      '<div class="ap-ro"><span class="ap-ro-l">Position</span><span class="ap-pos num">' + fmt1(S.pos) + '</span></div>' +
      '<div class="ap-ro"><span class="ap-ro-l">Time to End</span><span class="ap-toend num">' + toEndText(p) + '</span></div>' +
      (p.after === 'loop' ? '<div class="ap-ro"><span class="ap-ro-l">Looped</span><span class="ap-loops num">' + (S.loops ? times(S.loops) : 'not yet') + '</span></div>' : '') +
      '<div class="ap-ro ap-meter" role="meter" aria-label="Volume after fades" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="ap-ro-l">Volume <span class="ap-meter-s"></span></span>' +
      '<span class="ap-meter-row"><span class="ap-meter-track"><span class="ap-meter-bar"></span></span><span class="ap-meter-v num">100%</span></span></div></div>';
    var air = '<div class="ap-air"><button class="btn s" data-act="apair" data-k="ap-air" title="Play on air: the players hear it, from Start, with ' + esc(placeName(S.key)) + '">' + L.icon('broadcast', 's') + 'Play on air</button>' +
      (onAir ? L.destTag('air', '') + '<span class="num muted" data-time="music"></span>' : '') + '</div>';
    var ev = '';
    if (S.handover) {
      var n = L.track(S.handover.id);
      ev = '<div class="ap-event ap-ho">' + L.icon('next', 's') + '<div class="grow"><div class="ellipsis">Moved on to <b>' + esc(L.title(n)) + '</b> <span class="faint">· ' + esc(c.label) + '</span></div>' +
        '<div class="ap-ho-p"><div class="progress preview grow"><span class="ap-ho-bar" style="width:0"></span></div><span class="ap-ho-time num">' + fmt1(S.handover.pos) + '</span></div></div>' + L.profileLink(n.id, S.handover.place) + '</div>';
    } else if (S.event) {
      ev = '<div class="ap-event">' + L.icon(S.event.type === 'loop' ? 'loop' : S.event.type === 'stop' ? 'stop' : 'note', 's') + '<span>' + esc(S.event.text) + '</span></div>';
    }
    var keys = '<div class="ap-keys"><label class="ap-switch"><input type="checkbox" role="switch" data-input="apkeys1" data-k="ap-keys1"' + (S.keys1 ? ' checked' : '') + '>Single-key shortcuts</label>' +
      // Round 6: the key legend shows while the keyboard is in this box; the switch says whether they are on.
      (S.keys1 ? '<span class="hint keys-on-focus" title="Space play or pause · I Start · O End · L loop start · M marker · arrows move the playhead 1 s (Shift: 10 s). Keys do nothing while you type."><span class="kbd">Space</span> <span class="kbd">I</span> <span class="kbd">O</span> <span class="kbd">L</span> <span class="kbd">M</span> <span class="kbd">←</span><span class="kbd">→</span> play, Start, End, loop, marker, playhead</span>' : '') + '</div>';
    return waveHTML(t, p) + '<div class="ap-listen">' + tr + ro + air + '</div>' + ev + keys;
  }
  function endHTML(t, p) {
    var cs = contexts(t), c = ctxOf(t), n = L.track(c.next);
    var opts = '<fieldset class="ap-opts"' + dis(t) + '><legend class="sr-only">At the end</legend>' +
      radio(t, p.after, 'loop', 'loop', 'Loop back to loop start', 'Repeats ' + L.fmt(p.loopStart) + ' to ' + L.fmt(p.end)) +
      radio(t, p.after, 'next', 'next', 'Move to the next track', 'The scene or playlist moves on; played on its own, it stops') +
      radio(t, p.after, 'stop', 'stop', 'Stop', '') + '</fieldset>';
    var nx = '';
    if (p.after === 'next') {
      nx = '<div class="ap-next"><span class="ap-ro-l">Next track</span>' +
        (cs.length > 1 ? '<label class="sr-only" for="ap-ctx">Hear the hand-over as it plays</label><select id="ap-ctx" class="input" data-input="apctx" data-k="ap-ctx">' + cs.map(function (x, i) { return '<option value="' + i + '"' + (x === c ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>' : '<span class="muted">' + esc(c.label) + '</span>') +
        '<div class="row-flex"><span class="grow ellipsis" title="' + esc(L.title(n)) + '"><b>' + esc(L.title(n)) + '</b></span>' + L.profileLink(n.id, c.place, true) + '</div>' +
        (c.lib ? '<p class="hint">Not in a scene or playlist yet: the preview uses the next Library track.</p>' : '') + '</div>';
    }
    var fields = '<div class="ap-fields">' + field(t, 'start', p.start, 'Start at playhead', 'I') + field(t, 'end', p.end, 'End at playhead', 'O') +
      (p.after === 'loop' ? field(t, 'loop', p.loopStart, 'Loop from playhead', 'L') : '') + '</div>';
    return opts + nx + fields;
  }
  function fadesHTML(t, p) {
    var h = fadeBlock(t, p, 'in') + fadeBlock(t, p, 'out');
    if (p.after === 'loop') {
      // Round 6: what the crossfade does is read out with its group and shown on hover.
      h += '<div class="ap-fadeblock" role="group" aria-labelledby="ap-xf-h" aria-describedby="ap-xf-d" title="Smooths the jump back to ' + L.fmt(p.loopStart) + '"><div class="ap-fb-h"><b id="ap-xf-h">Crossfade the loop</b><span class="sr-only" id="ap-xf-d">Smooths the jump back to ' + L.fmt(p.loopStart) + '</span></div>' +
        '<div class="ap-fb-row"><span class="ap-fb-l">Length</span>' + stepper(t, 'xfade', p.loopXfade, 'loop crossfade') + err('xfade') + '</div>' +
        '</div>';
    }
    return h;
  }
  function markersHTML(t, p) {
    if (!p.markers.length) return '<p class="empty">No markers yet.</p>';
    return '<ol class="list ap-mlist">' + p.markers.map(function (m, i) {
      return '<li class="lrow ap-mrow"><span class="num faint ap-mt">' + L.fmt(m.at) + '</span>' +
        '<input class="input ap-ml" data-input="apmlabel" data-i="' + i + '" data-k="ap-ml-' + i + '" value="' + esc(m.label) + '" aria-label="Marker label at ' + L.fmt(m.at) + '"' + dis(t) + '>' +
        '<button class="btn s" data-act="apgo" data-at="' + m.at + '" data-k="ap-mgo-' + i + '" title="Move the playhead to ' + L.fmt(m.at) + '" aria-label="Go to ' + esc(m.label) + '">' + L.icon('right', 's') + 'Go to</button>' +
        '<button class="closer" data-act="apmdel" data-i="' + i + '" data-k="ap-mdel-' + i + '" title="Remove this marker" aria-label="Remove marker ' + esc(m.label) + '"' + dis(t) + '>' + L.icon('trash') + '</button></li>';
    }).join('') + '</ol>';
  }
  function placeHTML(t) {
    var pl = places(t), own = hasOwn(t, S.key), kind = S.key.indexOf('sc:') === 0 ? 'scene' : S.key.indexOf('ss:') === 0 ? 'session' : 'playlist';
    function opt(key, label) { var mark = !key ? '' : hasOwn(t, key) ? ' · own settings' : ' · uses the track\'s'; return '<option value="' + esc(key) + '"' + (key === S.key ? ' selected' : '') + '>' + esc(label + mark) + '</option>'; }
    var sel = '<label class="ap-place-l" for="ap-place">Settings for</label><select id="ap-place" class="input ap-place-sel" data-input="applace" data-k="ap-place">' + opt('', 'This track everywhere (its own)') +
      (pl.pls.length ? '<optgroup label="Playlists">' + pl.pls.map(function (x) { return opt(x.key, 'Playlist: ' + x.label); }).join('') + '</optgroup>' : '') +
      (pl.scs.length ? '<optgroup label="Scenes (cues)">' + pl.scs.map(function (x) { return opt(x.key, 'Scene: ' + x.label); }).join('') + '</optgroup>' : '') +
      (pl.sss.length ? '<optgroup label="Sessions">' + pl.sss.map(function (x) { return opt(x.key, 'Session list: ' + x.label); }).join('') + '</optgroup>' : '') + '</select>';
    var st;
    if (!S.key) {
      var others = L.profileKeys(t);
      // Round 6: "This track everywhere" in the list already says whose settings these are.
      st = (others.length ? '<span class="hint ap-place-h">Not used in ' + others.map(function (k) { return esc(placeName(k)); }).join(', ') + ' (own settings)</span>' : '');
    } else if (own) {
      st = '<span class="ap-badge own">' + L.icon('edit', 's') + 'Editing own settings for ' + esc(placeName(S.key)) + '</span>' +
        '<button class="btn s" data-act="apclear" data-k="ap-clear" title="Remove the settings for this ' + kind + ' and use the track\'s own settings here">' + L.icon('restart', 's') + 'Back to the track\'s settings</button>';
    } else {
      st = '<div class="seg s ap-choice" role="group" aria-label="Settings in ' + esc(placeName(S.key)) + '">' +
        '<button data-act="apuse" data-k="ap-use" aria-pressed="true">' + L.icon('check', 's') + 'Use the track\'s settings here</button>' +
        '<button data-act="apown" data-k="ap-own" aria-pressed="false">' + L.icon('edit', 's') + 'Give this place its own settings</button></div>' +
        (S.undoClear && S.undoClear.key === S.key ? '<button class="btn s ghost" data-act="apundo" data-k="ap-undo">Undo: bring its own settings back</button>' : '');
    }
    return '<div class="ap-place' + (S.key ? (own ? ' is-own' : ' is-ro') : '') + '">' + sel + '<div class="ap-place-st">' + st + '</div></div>';
  }
  /* PLY-14: opened from a scene or a session, the page keeps that place (its own settings, or the track's until it gets
     its own) and Back returns there, with the scene open. DAT-14: in a scene, the track's name there can be set here. */
  function backHTML(t) {
    var a = S.key.split(':'), s = (a[0] === 'sc' || a[0] === 'ss') && L.session(a[1], a[2]);
    if (!s) return '<a class="btn s" href="#/library/' + esc(t.id) + '" data-k="ap-back">' + L.icon('chevleft', 's') + 'Back to track</a>';
    var sc = a[0] === 'sc' && s.scenes.filter(function (x) { return x.id === a[3]; })[0];
    return '<button class="btn s" data-act="apback" data-cid="' + esc(a[1]) + '" data-sid="' + esc(a[2]) + '" data-sc="' + esc(sc ? sc.id : '') + '" data-k="ap-back">' + L.icon('chevleft', 's') + 'Back to ' + esc(sc ? sc.name : 'Session ' + s.n) + '</button>';
  }
  function sceneNameHTML(t) {
    if (S.key.indexOf('sc:') !== 0) return '';
    return '<div class="field ap-scname"><label for="ap-scname">Name in this scene</label><input class="input" id="ap-scname" data-input="apscname" data-k="ap-scname" value="' + esc(L.sceneNameOf(t, S.key)) + '" placeholder="' + esc(L.title(t)) + ' (its own name)" autocomplete="off"></div>';
  }
  /* PLY-15: the track's own normalising choice, and the loudness and gain where these settings apply (a playlist's
     choice counts when the page shows that playlist's settings). */
  function normHTML(t) {
    var pid = S.key.indexOf('pl:') === 0 ? S.key.slice(3) : '', n = L.normOf(t, pid);
    var from = n.from === 'track' ? 'this track\'s own choice' : n.from === 'playlist' ? 'the playlist\'s choice (' + (n.on ? 'On' : 'Off') + ')' : 'the library\'s setting (' + L.libraryNormWords() + ')';
    return '<div class="ap-norm">' + L.normChoice({ id: 'ap-norm', value: t.norm, act: 'apnorm', line: L.normLine(t, pid), hint: (pid ? 'In the playlist ' + L.playlist(pid).name + ': ' : 'On its own: ') + from + '.' }) + '</div>';
  }
  L.acts.apnorm = function (el) {
    var t = track(); if (!t) return;
    if (el.dataset.v === 'library') delete t.norm; else t.norm = el.dataset.v;
    S.focusK = 'ap-norm-' + el.dataset.v; L.render(); L.say('Normalise volume: ' + L.normLine(t, S.key.indexOf('pl:') === 0 ? S.key.slice(3) : ''));
  };
  L.inputs.apscname = function (el) { var t = track(); if (!t) return; L.setNameIn(t, S.key, el.value); };
  L.acts.apback = function (el) { L.state.openScene = el.dataset.sc ? { sc: el.dataset.sc, k: 'prof-' + el.dataset.sc + '-music-' + S.tid } : null; L.route('#/session/' + el.dataset.cid + '/' + el.dataset.sid); };
  function waveStatus() { return S.playing ? { text: 'Previewing ' + L.fmt(S.pos), tone: 'on' } : { text: S.event ? 'Paused' : 'Ready', tone: 'idle' }; }
  function endStatus(p) { return p.after === 'loop' ? 'Loops from ' + L.fmt(p.loopStart) : p.after === 'next' ? 'Moves on at ' + L.fmt(p.end) : 'Stops at ' + L.fmt(p.end); }
  function afterText(t, p) { return p.after === 'loop' ? 'Loops back to ' + L.fmt(p.loopStart) : p.after === 'next' ? 'Moves on to ' + L.title(L.track(ctxOf(t).next)) : 'Stops'; }

  L.view('profile', {
    nav: 'library',
    notesTitle: 'Audio profile: where a track ends, how it fades, and what comes next',
    notes: [
      '<b>Round 5:</b> opened from a scene (the wave button on a track in the session planner) the page stays on <b>that scene\'s settings</b>, shows the track\'s <b>Name in this scene</b>, and <b>Back</b> returns to the scene. A session list has its own settings too. The waveform follows the track\'s loudness, and its <b>shape</b> is shown by its file names.',
      'New page for your request: <b>where a track ends, and whether it then loops or moves on</b>, with fades. Open it from a track (an <b>Audio profile</b> button for Library, Playlists and Campaigns is ready) or try <a href="#/profile/t13">t13 Bridge of Death</a> and <a href="#/profile/t02">t02 Journey to the Line</a>.',
      'The waveform shows the whole file. Drag the <b>Start</b>, <b>End</b> and <b>Loop</b> tabs; the gold <b>volume line</b> shows the fades, and its round handles change the fade lengths. Under a fade the waveform gets smaller. Click anywhere to move the playhead.',
      '<b>Play the last 10 s before End</b> lets you hear the join, with a level meter: on t13 End jumps back to 1:04 with a 2 s crossfade; on t02 you hear the 6 s fade and the hand-over to the next track, by name.',
      '<b>Settings for</b>: a track can behave differently in each playlist and scene. On t13, pick <i>Scene: The abbey ruins</i>: it has its own settings (ends at 3:10 and moves on). Pick a playlist to see "uses the track\'s" until you give it its own.',
      'Fades: length with − and +, and an <b>Intensity</b> slider from Gentle to Sharp, with the curve sketched beside it. When looping, <b>Crossfade the loop</b> smooths the jump back.',
      'Listening is a <b>Preview</b> (violet, only you hear it). Keys: Space, I, O, L, M and the arrows; they can be switched off. Changes are kept as you make them.'
    ],
    title: function (p) { var t = L.track(p.tid); return t ? 'Audio profile: ' + L.title(t) : 'Audio profile'; },
    render: function (prm) {
      var t = L.track(prm.tid);
      if (!t) return '<div class="viewhead"><h1>Audio profile</h1></div><div class="empty">That track is not in the library. <a href="#/library">Back to the Library</a></div>';
      var key = prm.ctx || '';
      if (S.tid !== t.id || S.key !== key) {
        if (S.tid !== t.id) S.undoClear = null;
        S.tid = t.id; S.key = key; S.playing = false; S.handover = null; S.event = null; S.loops = 0; S.ctx = 0; S.saved = false; S.editing = null; S.invalid = {}; S.pos = prof(t).start;
      }
      var p = prof(t), ed = editable(t);
      var head = '<div class="viewhead ap-head"><div class="ap-id">' +
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/library" data-k="ap-cr-lib">Library</a><span class="sep" aria-hidden="true">›</span><a class="ap-cr-t" href="#/library/' + esc(t.id) + '" data-k="ap-cr-t" title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</a><span class="sep" aria-hidden="true">›</span><span>Audio profile</span></nav>' +
        '<h1 title="' + esc(L.title(t)) + '">' + esc(L.title(t)) + '</h1>' +
        // Round 6: the file's names are in the Library's details and on hover here; length and shape stay.
        '<p class="ap-meta" title="' + esc('Title in the file: ' + (t.metaTitle || 'none') + ' · File name: ' + t.file) + '"><span><span class="faint">Length</span> <span class="num">' + L.fmt(t.dur) + '</span></span><span>' + L.shapeTag(t) + '</span></p>' + sceneNameHTML(t) + normHTML(t) + '</div>' +
        '<div class="ap-headacts">' + backHTML(t) +
        '<span class="ap-saved" role="status">' + (!ed ? 'Uses the track\'s settings (read-only until you give it its own)' : S.saved ? L.icon('check', 's') + 'Saved' : '') + '</span>' +
        '<button class="btn s ghost" data-act="apreset" data-k="ap-reset" title="Start at 0:00 and End at ' + L.fmt(t.dur) + ', no fades"' + dis(t) + '>' + L.icon('restart', 's') + 'Reset to whole track</button></div>' +
        placeHTML(t) + '</div>';
      var body = '<div class="viewbody ap-body" data-scroll="ap-body"><div class="ap-grid">' +
        L.pane({ id: 'ap-wave', title: 'Waveform and listening', icon: 'wave', cls: 'ap-wavepane', noMax: true, kind: 'music', status: waveStatus(), body: listenHTML(t, p) }) +
        L.pane({ id: 'ap-end', title: 'At the end', icon: 'loop', cls: 'ap-endpane', noMax: true, kind: 'plain', status: { text: endStatus(p), tone: 'idle' }, body: endHTML(t, p) }) +
        L.pane({ id: 'ap-fades', title: 'Fades', icon: 'fade', cls: 'ap-fadepane', noMax: true, kind: 'plain', status: { text: p.fadeIn.dur || p.fadeOut.dur ? 'In ' + secs(p.fadeIn.dur) + ' · out ' + secs(p.fadeOut.dur) : 'No fades', tone: 'idle' }, body: fadesHTML(t, p) }) +
        L.pane({ id: 'ap-markers', title: 'Markers', icon: 'tag', cls: 'ap-mpane', noMax: true, kind: 'plain', status: { text: p.markers.length ? p.markers.length + ' marker' + (p.markers.length === 1 ? '' : 's') : 'Empty', tone: 'idle' },
          actions: '<button class="btn s" data-act="apmadd" data-k="ap-madd"' + (S.keys1 ? ' aria-keyshortcuts="M"' : '') + ' title="Add a marker at the playhead (' + L.fmt(S.pos) + ')"' + dis(t) + '>' + L.icon('plus', 's') + 'Add marker at playhead</button>', body: markersHTML(t, p) }) +
        '</div></div>';
      return head + body;
    },
    after: function (root) {
      var t = track(); if (!t || !root.querySelector('.ap-wave')) return;
      readColours(); layout(root); paintLive();
      if (S.playing) S.last = performance.now();
      root.querySelectorAll('[data-aph]').forEach(function (h) { h.addEventListener('pointerdown', handleDown); h.addEventListener('keydown', handleKey); });
      var sc = root.querySelector('.ap-scrub'); sc.addEventListener('pointerdown', scrubDown); sc.addEventListener('keydown', scrubKey);
      root.querySelectorAll('.ap-time').forEach(function (inp) {
        inp.addEventListener('blur', commitField);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitField(); } else if (e.key === 'Escape') { S.editing = null; S.invalid = {}; L.render(); } });
      });
      if (S.focusK) { var f = root.querySelector('[data-k="' + S.focusK + '"]'); S.focusK = null; if (f) { f.focus(); if (f.select) f.select(); } }
    }
  });

  // Ruler ticks, marker labels and region labels depend on the drawn width, so they are laid out after render.
  function layout(root) {
    var t = track(), wave = root.querySelector('.ap-wave'), W = wave.clientWidth; if (!W) return;
    var steps = [5, 10, 15, 30, 60, 120, 300], step = steps.filter(function (s) { return W / (t.dur / s) >= 54; })[0] || 600, h = '';
    for (var s = 0; s <= t.dur - step * .4; s += step) h += '<span class="ap-tick' + (s === 0 ? ' first' : '') + '" style="left:' + pct(t, s) + '">' + L.fmt(s) + '</span>';
    h += '<span class="ap-tick last" style="left:100%">' + L.fmt(t.dur) + '</span>';
    wave.querySelector('.ap-ruler').innerHTML = h;
    var p = prof(t), xs = p.markers.map(function (m) { return m.at / t.dur * W; });
    wave.querySelectorAll('.ap-flag').forEach(function (f, i) {
      var room = (i < xs.length - 1 ? xs[i + 1] : W) - xs[i] - 14, l = f.querySelector('.ap-flag-l');
      if (xs[i] > W - 60) { f.classList.add('flip'); room = xs[i] - (i ? xs[i - 1] : 0) - 14; }
      l.style.maxWidth = Math.min(140, Math.max(room, 90)) + 'px'; f.classList.toggle('crowd', room < 70);
    });
    wave.querySelectorAll('.ap-out').forEach(function (o) { o.querySelector('span').hidden = o.clientWidth < 84; });
  }

  /* ---------- pointer and keys on the waveform ---------- */
  function secAt(e) { var w = document.querySelector('#view .ap-wave'), r = w.getBoundingClientRect(), t = track(); return clamp((e.clientX - r.left) / r.width, 0, 1) * t.dur; }
  function dragWith(onMove, onEnd) {
    function mv(e) { onMove(e); }
    function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); onEnd(); }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  function fromSec(p, which, sec) { return which === 'fadein' ? sec - p.start : which === 'fadeout' ? p.end - sec : sec; }
  function sayPoint(which) { var p = prof(track()), v = value(p, which); L.say(POINT[which] + ' ' + (which.indexOf('fade') === 0 || which === 'xfade' ? secs(v) : L.fmt(v))); }
  function readOnlyNote() { L.toast('These are the track\'s settings. Give this place its own settings to change them here.'); }
  function handleDown(e) {
    if (e.button !== 0) return; e.preventDefault(); var which = e.currentTarget.dataset.aph, t = track(); e.currentTarget.focus();
    if (!editable(t)) { readOnlyNote(); return; }
    dragWith(function (ev) { movePoint(t, which, fromSec(prof(t), which, secAt(ev))); L.render(); }, function () { sayPoint(which); L.render(); });
  }
  function handleKey(e) {
    var which = e.currentTarget.dataset.aph, t = track(), cur = value(prof(t), which), r = range(t, which), v = null, big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = cur - big; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = cur + big;
    else if (e.key === 'PageDown') v = cur - 10; else if (e.key === 'PageUp') v = cur + 10; else if (e.key === 'Home') v = r[0]; else if (e.key === 'End') v = r[1];
    if (v == null) return; e.preventDefault(); e.stopPropagation();
    if (!editable(t)) { readOnlyNote(); return; }
    movePoint(t, which, v); L.render(); sayPoint(which);
  }
  function scrubDown(e) {
    if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); seek(secAt(e), true); L.render();
    dragWith(function (ev) { seek(secAt(ev), true); if (S.playing) paintLive(); else L.render(); }, function () { L.say('Playhead ' + L.fmt(S.pos)); L.render(); });
  }
  function nudge(d) { seek(S.pos + d, true); L.render(); L.say('Playhead ' + L.fmt(S.pos)); }
  function scrubKey(e) {
    var t = track(), d = null, big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -big; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = big; else if (e.key === 'PageDown') d = -10; else if (e.key === 'PageUp') d = 10;
    else if (e.key === 'Home') d = -S.pos; else if (e.key === 'End') d = t.dur - S.pos;
    if (d == null) return; e.preventDefault(); e.stopPropagation(); nudge(d);
  }

  /* ---------- actions ---------- */
  L.acts.applay = function () { if (S.playing) pause('Preview paused at ' + L.fmt(S.pos)); else { if (S.handover) { S.handover = null; S.pos = prof(track()).end; } play('play'); } };
  L.acts.aplast = function () { play('last10'); };
  L.acts.apstop = function () { stop(); };
  L.acts.apair = function () {
    var t = track(), o = { fade: 3 };
    if (S.key.indexOf('pl:') === 0) o.playlistId = S.key.slice(3);
    else if (S.key) { var sc = sceneOf(S.key), q = sc ? L.sceneSequence(sc.scene) : [], at = q.map(function (x) { return x.trackId; }).indexOf(t.id); if (at > -1) { o.playlistId = q[at].playlistId; o.seq = { cid: sc.cid, sid: sc.sid, scene: sc.index, at: at }; } }
    L.play(t.id, o); L.toast('On air: ' + L.title(t) + ', from ' + L.fmt(prof(t).start));
  };
  L.acts.apgo = function (el) { seek(+el.dataset.at); L.render(); };
  L.acts.aphere = function (el) { setHere(el.dataset.f); };
  function setHere(which) {
    var t = track(), p = prof(t), v;
    if (!editable(t)) { readOnlyNote(); return; }
    if (which === 'fadein') v = movePoint(t, which, S.pos - p.start);
    else if (which === 'fadeout') v = movePoint(t, which, p.end - S.pos);
    else { if (which === 'loop' && p.after !== 'loop') write(t, { after: 'loop' }); v = movePoint(t, which, S.pos); }
    sayPoint(which); S.editing = null; S.invalid = {}; L.render(); void v;
  }
  L.acts.apstep = function (el) { var t = track(), w = el.dataset.f; movePoint(t, w, value(prof(t), w) + (+el.dataset.d)); delete S.invalid[w]; S.editing = null; sayPoint(w); L.render(); };
  L.acts.apreset = function () {
    var t = track(), restore = L.snapshot(['tracks', 'profiles']);
    if (!write(t, { start: 0, end: t.dur, loopStart: 0, loopXfade: 0, fadeIn: { dur: 0, shape: 50 }, fadeOut: { dur: 0, shape: 50 } })) return; S.invalid = {}; S.editing = null;
    L.undoNote('Back to the whole track: 0:00 to ' + L.fmt(t.dur) + ', no loop and no fades.', restore); L.say('Reset to the whole track'); L.render();
  };
  L.acts.apmadd = function () { addMarker(true); };
  function addMarker(focus) {
    var t = track(); if (!editable(t)) { readOnlyNote(); return; }
    var p = prof(t), at = Math.round(S.pos * 10) / 10, ms = copyOf(p).markers;
    ms.push({ at: at, label: 'Marker ' + (ms.length + 1) }); ms.sort(function (a, b) { return a.at - b.at; });
    write(t, { markers: ms }); var i = ms.map(function (m) { return m.at; }).indexOf(at);
    if (focus) S.focusK = 'ap-ml-' + i; L.say('Marker added at ' + L.fmt(at)); L.render();
  }
  L.acts.apmdel = function (el) {
    var t = track(), p = prof(t), i = +el.dataset.i, gone = p.markers[i]; write(t, { markers: copyOf(p).markers.filter(function (m, j) { return j !== i; }) });
    S.focusK = 'ap-madd'; L.say('Marker removed: ' + (gone ? gone.label : '')); L.render();
  };
  // Places
  function goPlace(key) { L.route('#/profile/' + S.tid + (key ? '/' + key : '')); setTimeout(function () { var s = document.querySelector('[data-k="ap-place"]'); if (s) s.focus(); }, 0); }
  L.inputs.applace = function (el) { goPlace(el.value); L.say('Settings for ' + placeName(el.value)); };
  L.acts.apown = function () { var t = track(); L.profileStore(t, S.key, true); S.saved = true; S.undoClear = null; S.focusK = 'ap-clear'; L.say('This place now has its own settings, copied from the track\'s'); L.toast('Own settings for ' + placeName(S.key) + ', copied from the track\'s'); L.render(); };
  L.acts.apuse = function () { L.say('Using the track\'s settings here'); };
  L.acts.apclear = function () { var t = track(); S.undoClear = { key: S.key, p: D.profiles[S.key][t.id] }; L.clearProfile(t, S.key); S.saved = false; S.focusK = 'ap-own'; L.say('Back to the track\'s settings here'); L.render(); };
  L.acts.apundo = function () { var t = track(), u = S.undoClear; if (!u) return; D.profiles[u.key] = D.profiles[u.key] || {}; D.profiles[u.key][t.id] = u.p; S.undoClear = null; S.focusK = 'ap-clear'; L.say('Own settings brought back'); L.render(); };
  L.inputs.apmlabel = function (el) { var t = track(), ms = copyOf(prof(t)).markers; ms[+el.dataset.i].label = el.value; write(t, { markers: ms }); L.render(); };
  L.inputs.apafter = function (el) {
    var t = track(); write(t, { after: el.value }); S.event = null; S.handover = null;
    L.say({ loop: 'At the end: loop back to ' + L.fmt(prof(t).loopStart), next: 'At the end: move to the next track', stop: 'At the end: stop' }[el.value]); L.render();
  };
  L.inputs.apctx = function (el) { S.ctx = +el.value; S.handover = null; L.render(); };
  L.inputs.apkeys1 = function (el) { S.keys1 = el.checked; saveKeys1(); L.say('Single-key shortcuts ' + (S.keys1 ? 'on' : 'off')); L.render(); };
  // The intensity slider repaints the sketch and waveform while it moves (a re-render would drop the drag); it re-renders on release.
  L.inputs.apshape = function (el, ev) {
    var t = track(), k = el.dataset.f, p = prof(t), f = k === 'in' ? p.fadeIn : p.fadeOut, v = +el.value, patch = {};
    patch[k === 'in' ? 'fadeIn' : 'fadeOut'] = { dur: f.dur, shape: v }; write(t, patch);
    if (ev.type === 'change') { L.render(); return; }
    el.setAttribute('aria-valuetext', shapeName(v) + ', ' + v + ' of 100');
    var root = document.getElementById('view'), sk = root.querySelector('[data-sketch="' + k + '"]'), nm = root.querySelector('[data-shname="' + k + '"]');
    if (sk) sk.setAttribute('d', sketchPath(k, v)); if (nm) nm.textContent = shapeName(v); draw(root);
  };
  L.inputs.apfield = function (el) {
    var which = el.dataset.f, t = track(), lenField = which.indexOf('fade') === 0 || which === 'xfade', v = parse(el.value, lenField), r = range(t, which);
    // A time it cannot use puts the profile back as it was before typing, not at a time typed on the way ("2" of "2:00").
    if (S.editing !== which) S.editBase = copyOf(prof(t));
    S.editing = which; S.editText = el.value;
    if (v == null) S.invalid[which] = lenField ? 'Type a number of seconds, like 6' : 'Type minutes and seconds, like 5:18';
    else if (v < r[0] || v > r[1]) S.invalid[which] = 'Between ' + (lenField ? r[0] + ' and ' + r[1] + ' seconds' : L.fmt(r[0]) + ' and ' + L.fmt(r[1]));
    else { delete S.invalid[which]; movePoint(t, which, v); }
    if (S.invalid[which] && S.editBase) write(t, copyOf(S.editBase));
    L.render();
  };
  // Enter on a time it cannot use keeps the text and its message; the point stays as it was.
  function commitField() { if (!S.editing || S.invalid[S.editing]) return; S.editing = null; S.invalid = {}; setTimeout(L.render, 0); }

  /* ---------- keyboard shortcuts (view focused, not typing) ---------- */
  L.onKey(function (e) {
    var r = L.current(); if (r.name !== 'profile' || !S.keys1 || e.ctrlKey || e.metaKey || e.altKey) return false;
    var a = document.activeElement, view = document.getElementById('view');
    if (L.typing(a)) return false;
    if (a && a !== document.body && !view.contains(a)) return false;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, onCtl = a && a.closest && a.closest('button, a');
    if (k === ' ') { if (onCtl) return false; L.acts.applay(); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { nudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); return true; }
    if (e.shiftKey) return false;
    if (k === 'i') { setHere('start'); return true; }
    if (k === 'o') { setHere('end'); return true; }
    if (k === 'l') { setHere('loop'); return true; }
    if (k === 'm') { addMarker(false); return true; }
    return false;
  });
})();
