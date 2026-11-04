// node tools/shot.js <route> <out.png> [width] [height] [theme] [js-to-run]
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const [route, out, w, h, theme, act] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +(w || 960), height: +(h || 1000) } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(([t]) => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: t || 'campaign', frame: 'full', notes: false })); } catch (e) {} }, [theme]);
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html') + route); await p.waitForTimeout(400);
  if (act) { await p.evaluate(act); await p.waitForTimeout(500); }
  // overlap check: visible interactive elements whose boxes intersect (excluding nested)
  const overlaps = await p.evaluate(() => {
    // Visible part of an element: its box clipped by every scrolling or clipping ancestor (content scrolled out of view is not an overlap).
    const vis = e => { let r = e.getBoundingClientRect(); let a = { l: r.left, t: r.top, r: r.right, b: r.bottom }; for (let p = e.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const q = p.getBoundingClientRect(); a = { l: Math.max(a.l, q.left), t: Math.max(a.t, q.top), r: Math.min(a.r, q.right), b: Math.min(a.b, q.bottom) }; } } return a; };
    const els = [...document.querySelectorAll('#app button, #app a, #app input, #app select')].filter(e => { const v = vis(e); return v.r - v.l > 0 && v.b - v.t > 0 && getComputedStyle(e).visibility !== 'hidden'; });
    const out = []; const rs = els.map(vis);
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { if (els[i].contains(els[j]) || els[j].contains(els[i])) continue; const a = rs[i], c = rs[j]; const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t); if (ox > 2 && oy > 2) out.push((els[i].textContent || els[i].title || els[i].tagName).trim().slice(0, 25) + ' × ' + (els[j].textContent || els[j].title || els[j].tagName).trim().slice(0, 25)); }
    const hscroll = document.documentElement.scrollWidth > innerWidth + 1;
    const clipped = [...document.querySelectorAll('#app button')].filter(e => e.scrollWidth > e.clientWidth + 2 && e.getBoundingClientRect().width > 0).map(e => e.textContent.trim().slice(0, 20)).slice(0, 6);
    return { overlaps: out.slice(0, 10), n: out.length, hscroll, clipped };
  });
  await p.screenshot({ path: out }); console.log(out, errs.length ? errs : 'no errors', JSON.stringify(overlaps)); await b.close();
})();
