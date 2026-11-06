// Round 6 measure: how much each screen asks the game master to read, before and after the declutter pass.
// For every screen and state below, at 1920×1080 and 960×1000 (campaign theme), counts what is visible in the window
// without scrolling (clipped by every scrolling box):
//   words      words of visible text (prototype controls, design notes and screen-reader-only text left out)
//   controls   visible buttons, links, fields, sliders
//   hints      visible hint or explanation lines (hint-styled text of 2+ words, or a sentence of 6+ words outside a
//              table or list row, that is not a control, heading or field label)
//   twice      facts shown twice: the same text (3+ letters, not a number or time) in two or more visible places,
//              counted once per extra copy; tag chips, the side rail and one-word control names left out
//   colours    distinct text, fill and border colours
//   badges     distinct kinds of badge, chip, tag and status pill
// Writes <out>/r6-measure.json (with every hint line and repeated fact, for review) and prints a table.
// Screenshots of each screen go to <out>/<name>-<width>.png when SHOTS=1.
//   node design/prototype/tools/r6-measure.js <out dir>      (set LYRE_SPEC_CHROMIUM to use another Chromium)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.resolve(__dirname, '..', 'shots', 'r6'); fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html');
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click();`;
const playScene = "L.acts.lvstart({ dataset: { i: '2' } });";
// The sweep screens (e2e/specs/sweeps.spec.ts) and the round 5 states (tools/r5-check.js).
const SCREENS = [
  ['campaigns', '#campaigns', ''],
  ['campaign', '#campaign--crown', ''],
  ['campaign-onair', '#campaign--crown', click('[data-act=onair][data-kind=playlist]')],
  ['planner', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]')],
  ['planner-two-scenes', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=cpscene][data-id=sc6]')],
  ['planner-order-menu', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=ordmenu][data-pid=p-abbey-eerie]')],
  ['picker-inside', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=cpaddmusic][data-sc=sc3]') + click('[data-key="pk:playlist:p-ashen"]')],
  ['library', '#library', ''],
  ['library-track', '#library--t19', ''],
  ['library-t44', '#library--t44', ''],
  ['library-filters', '#library', "var f = document.querySelector('[data-act=pane][data-id=lb-filters]'); if (f && f.getAttribute('aria-expanded') === 'false') f.click();"],
  ['playlists', '#playlists', ''],
  ['playlist-manual', '#playlist--p-abbess', ''],
  ['playlist-dynamic', '#playlist--p-abbey-eerie', ''],
  ['playlist-gothic', '#playlist--p-gothic', ''],
  ['boards', '#boards', ''],
  ['board', '#board--weather', ''],
  ['board-try', '#board--combat', click('[data-act=pbtrymode]') + click('[data-act=pbtry][data-pid=drums]')],
  ['profile', '#profile--t13', ''],
  ['profile-scene', '#profile--t07--sc:crown:s14:sc6', ''],
  ['live', '#live', ''],
  ['live-playing', '#live', playScene],
  ['live-aftermath', '#live', "L.acts.lvstart({ dataset: { i: '5' } });"],
  ['outputs', '#outputs', ''],
  ['look', '#look', ''],
  ['backup-open', '#backup', click('[data-act=tfchoose]')],
  ['moved', '#moved', ''],
  ['relink', '#relink', click('[data-act=tflook]')],
  // Round 6, part 2 (ROUND6.md "Your notes on 0.4.0"): Settings, a scene unfolded in Live, an open scene playlist.
  ['settings', '#settings', ''],
  ['live-scene-open', '#live', playScene + click('[data-act=lvscopen][data-i="3"]')],
  ['planner-playlist-open', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-key="cp-sc3:music:p-abbey-eerie"]')],
  ['bar-both', '#session--crown--s14', "var D = L.data, b1 = D.discord.bots[0], b2 = D.discord.bots[1]; b2.status = 'connected'; b2.server = b1.server; b2.channel = 'c2'; var m = D.tracks.filter(function (t) { return t.kind === 'music'; }); L.play(m[0].id, { lane: 'music', target: b1.id }); L.play(m[3].id, { lane: 'music', target: b2.id }); L.preview(m[5].id); L.pauseLane('music', b2.id);"],
];
const SIZES = (process.env.SIZES || '1920x1080,960x1000').split(',').map((s) => s.split('x').map(Number));

function measure() {
  const vis = (e) => { const q0 = e.getBoundingClientRect(); let a = { l: Math.max(0, q0.left), t: Math.max(0, q0.top), r: Math.min(innerWidth, q0.right), b: Math.min(innerHeight, q0.bottom) }; for (let q = e.parentElement; q; q = q.parentElement) { const cs = getComputedStyle(q); if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const z = q.getBoundingClientRect(); a = { l: Math.max(a.l, z.left), t: Math.max(a.t, z.top), r: Math.min(a.r, z.right), b: Math.min(a.b, z.bottom) }; } } return a; };
  const shown = (e) => { if (!e || e.closest('.sr-only,[hidden],#proto,#notes')) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false; const v = vis(e); return v.r - v.l > 1 && v.b - v.t > 1; };
  const roots = [document.getElementById('app'), ...document.querySelectorAll('body > .menu, body > .sheet')].filter(Boolean);
  const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/-]*/gu) || []).length;
  // Visible text: each text node whose parent is shown and whose own box is in view.
  let wordCount = 0; const leaves = [];
  for (const root of roots) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) continue;
      const p = n.parentElement; if (!shown(p)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(), c = vis(p);
      if (Math.min(r.right, c.r) - Math.max(r.left, c.l) <= 0 || Math.min(r.bottom, c.b) - Math.max(r.top, c.t) <= 0) continue;
      wordCount += words(t); leaves.push({ p, t });
    }
  }
  const CTL = 'button, a[href], input, select, textarea, [role=slider], [role=checkbox], [role=switch], [role=tab]';
  const controls = new Set(); for (const root of roots) root.querySelectorAll(CTL).forEach((e) => { if (shown(e)) controls.add(e); });
  // Hint lines: hint-styled text, or a sentence-length block that is not a control, heading or label.
  const HINTCLS = /(^|[\s-])(hint|faint|muted|empty|note|notes|how|help|msg|tryhint|modehelp|why|sub|warn|foot|intro)($|[\s-])/;
  const blocks = new Map();
  for (const { p, t } of leaves) {
    let b = p; while (b.parentElement && getComputedStyle(b).display.startsWith('inline') && !b.matches(CTL)) b = b.parentElement;
    if (b.closest(CTL + ', h1, h2, h3, label, .dest, .chip, .badge, .pane-status, .crumbs')) continue;
    const styled = [...new Set([p, b])].some((e) => HINTCLS.test(e.className || ''));
    const text = (b.innerText || t).replace(/\s+/g, ' ').trim();
    const sentence = words(text) >= 6 && /[.!?]$/.test(text) && !b.closest('td, th, tr, [role=row], [role=option], li');
    if (styled ? words(text) >= 2 : sentence) blocks.set(b, text);
  }
  const hints = [...blocks.entries()].filter(([b]) => ![...blocks.keys()].some((o) => o !== b && o.contains(b))).map(([, t]) => t.slice(0, 140));
  // Facts shown twice: the same visible text in two places (not control names, numbers or times).
  const seen = {};
  for (const { p, t } of leaves) {
    if (p.closest('button, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=tab], label, .kbd, .chip, #rail')) continue;
    const k = t.toLowerCase().replace(/[·•…:,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (k.replace(/[^\p{L}]/gu, '').length < 3) continue;
    seen[k] = (seen[k] || 0) + 1;
  }
  // Track names are often control names (rows are buttons): count those too, but only text with 2+ words.
  for (const { p, t } of leaves) {
    if (!p.closest('button') || p.closest('#rail, .chip')) continue; const k = t.toLowerCase().replace(/[·•…:,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (k.split(' ').length < 2 || k.replace(/[^\p{L}]/gu, '').length < 6) continue;
    seen['»' + k] = (seen['»' + k] || 0) + 1;
  }
  const merged = {}; Object.entries(seen).forEach(([k, n]) => { const kk = k.replace(/^»/, ''); merged[kk] = (merged[kk] || 0) + n; });
  const twice = Object.entries(merged).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  // Colours and badge kinds.
  const colours = new Set(), badgeKinds = new Set();
  for (const root of roots) root.querySelectorAll('*').forEach((e) => {
    if (!shown(e)) return; const cs = getComputedStyle(e);
    if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) colours.add(cs.color);
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) colours.add(cs.backgroundColor);
    ['Top', 'Left'].forEach((s) => { if (parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(cs['border' + s + 'Color'])) colours.add(cs['border' + s + 'Color']); });
    if (e.matches('.badge, .chip, .dest, .pane-status, .shape-tag, .pill, .kbd')) badgeKinds.add([...e.classList].filter((c) => !/^(s|m|l|grow|ellipsis)$/.test(c)).slice(0, 2).join('.'));
  });
  return { words: wordCount, controls: controls.size, hints: hints.length, twice: twice.reduce((s, [, n]) => s + n - 1, 0), colours: colours.size, badges: badgeKinds.size, hintLines: hints, repeated: twice.slice(0, 15).map(([k, n]) => n + '× ' + k.slice(0, 60)), badgeKinds: [...badgeKinds] };
}

(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const results = {};
  for (const [name, route, act] of SCREENS) {
    if (only && !only.includes(name)) continue;
    for (const [w, h] of SIZES) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) { /* no storage */ } });
      await p.goto(FILE + route); await p.waitForTimeout(250);
      if (act) { try { await p.evaluate(act); } catch (e) { errs.push('could not prepare the screen: ' + e.message.split('\n')[0]); } await p.waitForTimeout(400); }
      const r = await p.evaluate(measure);
      if (errs.length) r.errors = errs;
      results[name + '@' + w] = r;
      if (process.env.SHOTS) await p.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
      await p.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, process.env.JSON || 'r6-measure.json'), JSON.stringify(results, null, 1));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('screen@width', 28) + ['words', 'ctls', 'hints', 'twice', 'colours', 'badges'].map((s) => pad(s, 8)).join(''));
  for (const [k, r] of Object.entries(results)) console.log(pad(k, 28) + [r.words, r.controls, r.hints, r.twice, r.colours, r.badges].map((s) => pad(s, 8)).join('') + (r.errors ? ' ERRORS ' + r.errors.join('; ') : ''));
})();
