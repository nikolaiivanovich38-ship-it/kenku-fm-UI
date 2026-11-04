// Library: list controls smaller than 24 x 24 px. node tools/lb-size.js <route> [js]
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const [route, act] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  await p.addInitScript(() => localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })));
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'library.html') + route); await p.waitForTimeout(300);
  if (act) { await p.evaluate(act); await p.waitForTimeout(200); }
  console.log(route, await p.evaluate(() => [...document.querySelectorAll('#view button, #view input, #view select, #view a, #lyre-sheet button, #lyre-sheet input, .menu button')]
    .map(e => { const t = e.type === 'checkbox' ? e.closest('.lb-ckl') || e : e; const r = t.getBoundingClientRect(); return [r.width, r.height, (e.dataset.k || e.textContent || e.tagName).trim().slice(0, 24)]; })
    .filter(x => x[0] > 0 && (x[0] < 23.5 || x[1] < 23.5)).map(x => x[2] + ' ' + Math.round(x[0]) + 'x' + Math.round(x[1]))));
  await b.close();
})();
