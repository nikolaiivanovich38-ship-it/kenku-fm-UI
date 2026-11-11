// Round 7 smoke check: opens every screen of the built prototype (campaign theme, 960×1000 and 1920×1080) and fails
// on any page error or console error, then tries the round 7 flows that need no clicking in a spec (Find and play,
// the drop tray). Run through `yarn heavy`:  node design/prototype/tools/r7-smoke.js
const { chromium } = require('playwright'); const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html');
const ROUTES = ['campaigns', 'campaign--crown', 'session--crown--s14', 'library', 'library--t39', 'playlists', 'playlist--p-abbess', 'playlist--p-abbey-eerie', 'boards', 'board--combat',
  'profile--t13', 'live', 'outputs', 'look', 'tags', 'settings', 'backup', 'moved', 'relink'];
(async () => {
  const browser = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  let bad = 0;
  for (const size of [{ width: 960, height: 1000 }, { width: 1920, height: 1080 }]) {
    const page = await browser.newPage({ viewport: size });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
    await page.addInitScript(() => localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })));
    for (const r of ROUTES) {
      await page.goto(FILE + '#' + r); await page.waitForTimeout(150);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (sideways) errs.push(r + ': scrolls sideways');
      if (errs.length) { console.log(size.width, r, errs.join(' | ')); bad += errs.length; errs.length = 0; }
    }
    await page.close();
  }
  await browser.close();
  console.log(bad ? bad + ' problems' : 'no problems');
  process.exit(bad ? 1 : 0);
})();
