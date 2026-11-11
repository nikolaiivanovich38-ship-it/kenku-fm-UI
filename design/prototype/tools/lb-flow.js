// Library: keyboard flow checks (combobox, rows, tab order). node tools/lb-flow.js
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {}); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })));
  const file = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'library.html');
  await p.goto(file + '#/library'); await p.waitForTimeout(300);
  const k = () => p.evaluate(() => { const a = document.activeElement; return (a.dataset && a.dataset.k) || a.tagName + (a.id ? '#' + a.id : ''); });
  // Tab order
  const order = []; await p.focus('[data-k="rail-library"]');
  for (let i = 0; i < 16; i++) { await p.keyboard.press('Tab'); order.push(await k()); }
  console.log('tab order:', order.join(' > '));
  // Rows: arrow down twice, space, enter
  await p.focus('[data-k="lb-q"]'); while (!(await k()).startsWith('lbrow-')) await p.keyboard.press('Tab');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); console.log('after 2x down:', await k());
  await p.keyboard.press(' '); console.log('selected:', await p.evaluate(() => document.querySelector('.lb-bn') && document.querySelector('.lb-bn').textContent), 'focus', await k());
  await p.keyboard.press('Enter'); await p.waitForTimeout(100); console.log('hash:', await p.evaluate(() => location.hash), 'focus', await k());
  // Combobox on the opened track (Ashes, t44)
  await p.focus('[data-k="lb-cbx-mood"]'); await p.keyboard.type('me');
  console.log('options:', await p.$$eval('#lb-lbx-mood [role=option]', o => o.map(x => x.textContent)), 'expanded', await p.getAttribute('[data-k="lb-cbx-mood"]', 'aria-expanded'));
  await p.keyboard.press('ArrowDown'); console.log('active:', await p.getAttribute('[data-k="lb-cbx-mood"]', 'aria-activedescendant'));
  await p.keyboard.press('Enter'); console.log('mood chips:', await p.$$eval('.lb-sec .lb-tg:nth-of-type(1) .chip', c => c.map(x => x.textContent)));
  await p.keyboard.type('Frostbitten'); console.log('create option:', await p.$$eval('#lb-lbx-mood [role=option]', o => o.map(x => x.textContent)));
  await p.keyboard.press('Enter'); console.log('mood chips:', await p.$$eval('.lb-sec .lb-tg:nth-of-type(1) .chip', c => c.map(x => x.textContent)), 'focus', await k());
  await p.keyboard.type('Ee'); await p.keyboard.press('Escape'); console.log('after escape value:', await p.inputValue('[data-k="lb-cbx-mood"]'), 'expanded', await p.getAttribute('[data-k="lb-cbx-mood"]', 'aria-expanded'));
  // Title edit
  await p.fill('[data-k="lb-title"]', 'Grief and ash - slow, fade'); await p.waitForTimeout(50);
  console.log('row title now:', await p.evaluate(() => document.querySelector('tr.lb-open .lb-t1').textContent));
  // Bulk tag via keyboard: select, apply
  await p.evaluate(() => { document.querySelector('[data-act=lbbtag]').click(); });
  await p.click('[data-act=lbtspick][data-v=Grief]'); await p.fill('[data-k="lb-tsq-scene"]', 'funeral'); await p.press('[data-k="lb-tsq-scene"]', 'Enter');
  console.log('apply label:', await p.textContent('#lb-ts-apply')); await p.click('#lb-ts-apply');
  console.log('guide:', await p.textContent('.lb-guide'));
  // Drop event (synthetic, no files -> folder pool)
  await p.evaluate(() => { const dt = new DataTransfer(); ['01 Wolf Moon.flac', '02 Ember.mp3', 'notes.txt'].forEach(n => dt.items.add(new File(['x'], n))); document.getElementById('view').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
  await p.waitForTimeout(100); console.log('after drop guide:', await p.textContent('.lb-guide'), await p.evaluate(() => [...document.querySelectorAll('tr[aria-selected=true] .lb-t1')].map(x => x.textContent)));
  console.log(errs.length ? errs : 'no errors'); await b.close();
})();
