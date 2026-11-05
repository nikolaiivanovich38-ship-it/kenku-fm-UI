// node tools/tab-outputs.js '<route>' [width]: tabs through #view, prints the order and anything focusable it never reached.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const [route, w] = process.argv.slice(2);
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {}); const p = await b.newPage({ viewport: { width: +(w || 960), height: 1000 } });
  await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html') + route); await p.waitForTimeout(400);
  await p.evaluate(() => { const h = document.querySelector('#view h1'); h.tabIndex = -1; h.focus(); });
  const seen = [], order = [];
  for (let i = 0; i < 400; i++) {
    await p.keyboard.press('Tab');
    const d = await p.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('#view')) return null; a.dataset.tabSeen = 1; return (a.getAttribute('aria-label') || a.title || a.textContent || a.placeholder || a.tagName).trim().slice(0, 34); });
    if (!d) break; order.push(d);
  }
  const missed = await p.evaluate(() => [...document.querySelectorAll('#view a, #view button, #view input, #view select, #view textarea')].filter(e => !e.disabled && e.offsetParent && !e.dataset.tabSeen && e.tabIndex >= 0).map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)));
  console.log(order.length + ' stops:\n  ' + order.join('\n  ') + (order.length > 30 ? '\n  …' : '') + '\nMissed: ' + JSON.stringify(missed));
  await b.close();
})();
