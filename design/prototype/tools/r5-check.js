// Round 5 check: every screen round 5 changed, at 960×1000 (half of a 1920 screen), 720×900 (a third) and 1920×1080,
// in the campaign theme and Parchment. For each: console errors, sideways scroll, overlapping controls, cut-off
// button text, and the contrast of the text round 5 added (tags, shapes, the On air bar, play order, the new screens)
// against what is behind it (4.5:1 for text). Screenshots go to <out dir>.
//   node design/prototype/tools/r5-check.js <out dir>      (set LYRE_SPEC_CHROMIUM to use another Chromium)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.resolve(__dirname, '..', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const FILE = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html');
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click();`;
const SCREENS = [
  ['planner', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=cpscene][data-id=sc6]')],
  ['planner-order-menu', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=ordmenu][data-pid=p-abbey-eerie]')],
  ['picker-inside', '#session--crown--s14', click('[data-act=cpscene][data-id=sc3]') + click('[data-act=cpaddmusic][data-sc=sc3]') + click('[data-key="pk:playlist:p-ashen"]')],
  ['campaign-onair', '#campaign--crown', click('[data-act=onair][data-kind=playlist]')],
  ['playlists', '#playlists', ''],
  ['dynamic', '#playlist--p-gothic', ''],
  ['library-track', '#library--t19', ''],
  ['library-filters', '#library', "var f = document.querySelector('[data-act=pane][data-id=lb-filters]'); if (f && f.getAttribute('aria-expanded') === 'false') f.click();"],
  ['board-try', '#board--combat', click('[data-act=pbtrymode]') + click('[data-act=pbtry][data-pid=drums]')],
  ['board-resized', '#board--combat', click('[data-act=pbsize][data-axis=c][data-d="-1"]')],
  ['profile-scene', '#profile--t07--sc:crown:s14:sc6', ''],
  ['live-aftermath', '#live', "L.acts.lvstart({ dataset: { i: '5' } });"],
  ['backup-open', '#backup', click('[data-act=tfchoose]')],
  ['moved', '#moved', ''],
  ['relink', '#relink', click('[data-act=tflook]')],
];
const SIZES = [[960, 1000], [720, 900], [1920, 1080]];
const THEMES = ['campaign', 'parchment'];
const CONTRAST_SEL = '.tagstrip .chip, .shape-tag, .onairbar .oab-title, .onairbar .oab-from, .onairbar .num, .onairbar .badge, .tf-body .hint, .tf-body td, .tf-body b, .tf-how, .pb-trying, .pb-tryhint span, .cp-it-sub, .cp-scname-mark, .lb-scnames, .lb-missing span, .badge.warn, .menu .ord-note, .menu [role=menuitemradio] .hint';

(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  let problems = 0;
  for (const [name, route, act] of SCREENS) for (const [w, h] of SIZES) for (const theme of THEMES) {
    if (w === 1920 && theme === 'parchment') continue;
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.addInitScript((t) => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: t, frame: 'full', notes: false })); } catch (e) { /* no storage */ } }, theme);
    await p.goto(FILE + route); await p.waitForTimeout(250);
    if (act) { try { await p.evaluate(act); } catch (e) { errs.push('could not prepare the screen: ' + e.message.split('\n')[0]); } await p.waitForTimeout(400); }
    const r = await p.evaluate((sel) => {
      const vis = (e) => { const q0 = e.getBoundingClientRect(); let a = { l: q0.left, t: q0.top, r: q0.right, b: q0.bottom }; for (let q = e.parentElement; q; q = q.parentElement) { const cs = getComputedStyle(q); if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const z = q.getBoundingClientRect(); a = { l: Math.max(a.l, z.left), t: Math.max(a.t, z.top), r: Math.min(a.r, z.right), b: Math.min(a.b, z.bottom) }; } } return a; };
      // An open menu or sheet is meant to cover the page: check the controls inside it only.
      const root = document.querySelector('.menu') ? '.menu' : document.querySelector('.sheet') ? '.sheet' : '#app';
      const els = [...document.querySelectorAll(root + ' button, ' + root + ' a, ' + root + ' input, ' + root + ' select')].filter((e) => { const v = vis(e); return v.r - v.l > 0 && v.b - v.t > 0 && getComputedStyle(e).visibility !== 'hidden'; });
      const rs = els.map(vis), overlaps = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { if (els[i].contains(els[j]) || els[j].contains(els[i])) continue; const a = rs[i], c = rs[j]; if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 2 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 2) overlaps.push((els[i].getAttribute('aria-label') || els[i].textContent || els[i].tagName).trim().slice(0, 30) + ' × ' + (els[j].getAttribute('aria-label') || els[j].textContent || els[j].tagName).trim().slice(0, 30)); }
      const clipped = [...document.querySelectorAll('#app button')].filter((e) => e.scrollWidth > e.clientWidth + 2 && e.getBoundingClientRect().width > 0 && !e.querySelector('.ellipsis')).map((e) => e.textContent.trim().slice(0, 24));
      // Contrast: the text colour against the first painted background behind it (colour mixes resolved by the browser).
      const ctx = document.createElement('canvas').getContext('2d');
      const rgb = (c) => { ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; ctx.clearRect(0, 0, 1, 1); return [d[0], d[1], d[2], d[3] / 255]; };
      const lum = (c) => { const v = c.slice(0, 3).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
      function bgOf(e) { const stack = []; for (let q = e; q; q = q.parentElement) { const c = rgb(getComputedStyle(q).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let base = stack.length && stack[stack.length - 1][3] >= 1 ? stack.pop() : rgb(getComputedStyle(document.body).backgroundColor); while (stack.length) base = over(stack.pop(), base); return base; }
      const low = [];
      document.querySelectorAll(sel).forEach((e) => {
        const r0 = e.getBoundingClientRect(); if (!r0.width || !r0.height || !e.textContent.trim() || getComputedStyle(e).visibility === 'hidden') return;
        if (e.closest('.sr-only,[hidden]') || e.classList.contains('sr-only')) return;
        const cs = getComputedStyle(e), fg = over(rgb(cs.color), bgOf(e)), bg = bgOf(e), op = +cs.opacity;
        const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 4.5 && op > 0.5) low.push(e.className.split(' ')[0] + ' "' + e.textContent.trim().slice(0, 20) + '" ' + ratio.toFixed(2));
      });
      // Known before round 5: the Library's sticky "Select all" box overlaps the row scrolled under it.
      const known = (o) => /^Select all \d+ shown × Select /.test(o);
      return { hscroll: document.documentElement.scrollWidth > innerWidth + 1, overlaps: overlaps.filter((o) => !known(o)).slice(0, 6), clipped: clipped.slice(0, 6), low: [...new Set(low)].slice(0, 8) };
    }, CONTRAST_SEL);
    const file = path.join(OUT, `r5-${name}-${w}-${theme}.png`); await p.screenshot({ path: file });
    const bad = errs.length || r.hscroll || r.overlaps.length || r.clipped.length || r.low.length;
    if (bad) problems++;
    console.log((bad ? 'PROBLEM ' : 'ok      ') + `${name} ${w}×${h} ${theme}` + (bad ? ' ' + JSON.stringify({ errs, ...r }) : ''));
    await p.close();
  }
  await b.close();
  console.log(problems ? problems + ' screens with problems' : 'every screen passed'); process.exit(problems ? 1 : 0);
})();
