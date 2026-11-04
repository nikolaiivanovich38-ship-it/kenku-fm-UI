// Outputs flows by keyboard: open Lyre Side's Room menu, arrow to Side room, Enter; swap; Live menu move; mute; volume.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })); });
  await p.goto('file://' + path.resolve(__dirname, '..', 'outputs.html') + '#/outputs'); await p.waitForTimeout(300);
  const st = () => p.evaluate(() => L.bots().map(b => b.name + '=' + b.status + '@' + (b.channel || '-') + (b.muted ? ' muted' : '') + ' v' + b.volume).join(', '));
  await p.focus('[data-k="op-room-b2"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  console.log('menu open, focused:', await p.evaluate(() => document.activeElement.textContent));
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(1300);
  console.log('after Enter on 2nd item:', await st(), '| focus:', await p.evaluate(() => document.activeElement.dataset.k));
  await p.click('[data-k="op-swap"]'); await p.waitForTimeout(1300); console.log('after swap:', await st());
  await p.evaluate(() => L.menu(document.querySelector('h1'), L.botsMenuHTML(), 'Discord'));
  await p.click('.menu [data-bot="b1"][data-channel="c3"]'); await p.waitForTimeout(1300); console.log('live menu move b1->c3:', await st());
  await p.click('[data-k="op-mute-b1"]'); await p.fill('[data-k="op-vol-b2"]', '40'); await p.dispatchEvent('[data-k="op-vol-b2"]', 'change'); console.log('mute+vol:', await st());
  await p.click('[data-k="op-test-b2"]'); console.log('toast:', await p.textContent('#lyre-toast'));
  console.log(errs.length ? errs : 'no errors'); await b.close();
})();
