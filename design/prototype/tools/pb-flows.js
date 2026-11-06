// Pad boards: exercise the main flows and the tab order. node tools/pb-flows.js (OUT=boards.html)
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {}); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'boards.html') + '#/board/abbey'); await p.waitForTimeout(300);
  const live = () => p.evaluate(() => document.getElementById('lyre-live').textContent);
  const slots = () => p.evaluate(() => L.board('abbey').slots.map(x => x ? x.label : '-').join(' | '));
  const log = (...a) => console.log(...a);
  // 1. keyboard: focus slot 0, arrow right selects slot 1, Alt+Right moves it to slot 2
  await p.focus('[data-k=slot-0]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80);
  log('arrow focus:', await p.evaluate(() => document.activeElement.dataset.k), 'selected:', await p.evaluate(() => document.querySelector('.pb-pad.sel').dataset.pid));
  await p.keyboard.press('Alt+ArrowRight'); await p.waitForTimeout(80);
  log('alt+right focus:', await p.evaluate(() => document.activeElement.dataset.k), '|', await live()); log(' slots:', await slots());
  await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(80); log('alt+down:', await live());
  // 2. drag pad slot 0 onto slot 1 (swap)
  await p.dragAndDrop('[data-k=slot-0]', '[data-k=slot-1]'); await p.waitForTimeout(80); log('drag swap:', await live()); log(' slots:', await slots());
  // 3. drag to spare: shrink first then drag a grid pad onto spare tray
  await p.click('[data-k=pb-c-dn]'); await p.waitForTimeout(80); log('shrink:', await live());
  await p.dragAndDrop('[data-k=slot-0]', '.pb-spare'); await p.waitForTimeout(80); log('drag to spare:', await live());
  await p.click('[data-k=pb-c-up]'); await p.click('[data-k=pb-c-up]'); await p.waitForTimeout(80); log('grow:', await live());
  await p.click('[data-k=pb-putall]'); await p.waitForTimeout(80); log('put all back:', await live(), '| spare', await p.evaluate(() => L.board('abbey').spare.length));
  // 4. hotkey capture with conflict
  await p.click('[data-k=slot-0]'); await p.click('[data-k=pb-keycap]'); await p.keyboard.press('q'); await p.waitForTimeout(80);
  log('hotkey:', await live(), '| warn:', await p.evaluate(() => (document.querySelector('.pb-warn') || {}).textContent));
  await p.click('[data-k=pb-keyswap]'); await p.waitForTimeout(80); log('swap key:', await live());
  // 5. sound kinds: variants add file, tag
  await p.click('[data-k=pbsk-variants]'); await p.click('[data-k=pb-addfile]'); await p.waitForTimeout(50); log('add file:', await live());
  await p.click('[data-k=pbsk-tag]'); await p.fill('[data-k=pb-tag]', 'door'); await p.waitForTimeout(50);
  log('tag files:', await p.evaluate(() => document.querySelectorAll('.pb-files li').length));
  // 6. test fire + double-click
  await p.click('[data-k=pb-test]'); await p.waitForTimeout(80); log('test:', await live(), '| fx', await p.evaluate(() => L.pb.fx.length));
  await p.dblclick('[data-k=slot-2]'); await p.waitForTimeout(80); log('dblclick (preview):', await live());
  // 7. add pad in empty slot (after growing there are none: shrink rows? use quick 6x4)
  await p.click('[data-k=pb-q64]'); await p.waitForTimeout(50); const e = await p.$('.pb-empty'); await e.click(); await p.waitForTimeout(50);
  log('add pad focus:', await p.evaluate(() => document.activeElement.dataset.k), await live());
  // 8. duplicate + delete pad
  await p.click('[data-k=pb-padmenu]'); await p.click('.menu [data-act=pbduppad]'); await p.waitForTimeout(50); log('dup:', await live());
  await p.click('[data-k=pb-padmenu]'); await p.click('.menu [data-act=pbdelpad]'); await p.waitForTimeout(50); log('delete sheet:', await p.evaluate(() => document.getElementById('sheet-title').textContent));
  await p.click('[data-act=pbdelpadok]'); await p.waitForTimeout(50); log('deleted, focus:', await p.evaluate(() => document.activeElement.dataset.k));
  // 9. move-to menu
  await p.click('[data-k=slot-0]'); await p.click('[data-k=pb-padmenu]'); await p.click('.menu [data-act=pbmovemenu2]'); await p.waitForTimeout(50);
  log('menu items:', await p.evaluate(() => document.querySelectorAll('.menu [role=menuitem]').length));
  await p.click('.menu [data-to=spare]'); await p.waitForTimeout(50); log('move to spare:', await live(), '| focus', await p.evaluate(() => document.activeElement.dataset.k));
  // 10. tab order through the editor
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'boards.html') + '#/board/combat'); await p.reload(); await p.waitForTimeout(300);
  await p.focus('[data-k=pb-crumb]'); const order = [];
  for (let i = 0; i < 80; i++) { const k = await p.evaluate(() => { const a = document.activeElement; return a.dataset.k || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20) || a.tagName; }); order.push(k); await p.keyboard.press('Tab'); }
  log('tab order:', order.join(' > '));
  // 11. list: new board sheet + delete board sheet
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'boards.html') + '#/boards'); await p.waitForTimeout(200);
  await p.click('[data-k=pb-new]'); await p.fill('#pb-nb-name', 'Harbour at night'); await p.check('input[value="6x4"]'); await p.screenshot({ path: 'shots/boards-new-sheet.png' });
  await p.click('[data-act=pbnbcreate]'); await p.waitForTimeout(150); log('new board route:', await p.evaluate(() => location.hash), await p.evaluate(() => document.querySelectorAll('.pb-empty').length), 'empty slots');
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'boards.html') + '#/boards'); await p.waitForTimeout(150);
  await p.click('[data-k=more-combat]'); await p.click('.menu [data-act=pbdelboard]'); await p.screenshot({ path: 'shots/boards-delete-sheet.png' }); log('delete board text:', await p.evaluate(() => document.querySelector('.sheet .body').textContent.slice(0, 160)));
  await p.keyboard.press('Escape');
  // 12. round 3: list search/filter, tile preview, library picker
  await p.fill('[data-k=pbq]', 'bell'); await p.waitForTimeout(80); log('search bell:', await p.evaluate(() => document.querySelectorAll('.pb-card').length), 'cards, focus', await p.evaluate(() => document.activeElement.dataset.k));
  await p.fill('[data-k=pbq]', ''); await p.click('[data-k=pbf-unused]'); await p.waitForTimeout(80); log('not used yet:', await p.evaluate(() => [...document.querySelectorAll('.pb-card-name')].map(e => e.textContent).join(', ')));
  await p.click('[data-k=pbf-all]'); await p.selectOption('[data-k=pbcamp]', 'masks'); await p.waitForTimeout(80); log('campaign masks:', await p.evaluate(() => [...document.querySelectorAll('.pb-card-name')].map(e => e.textContent).join(', ')));
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'boards.html') + '#/board/abbey'); await p.waitForTimeout(200);
  await p.click('[data-k="pv-pad-abbey/organ"]'); await p.waitForTimeout(80); log('tile preview:', await live(), '| selected unchanged:', await p.evaluate(() => document.querySelector('.pb-pad.sel').dataset.pid), '| violet:', await p.evaluate(() => !!document.querySelector('.pb-has.pv')));
  await p.waitForTimeout(3200); log('preview ended, violet cleared:', await p.evaluate(() => !document.querySelector('.pb-has.pv')));
  await p.click('[data-k=pb-picklib]'); await p.waitForTimeout(80); await p.click('#pk-list input[value=f06]').catch(() => {}); await p.click('#pk-list input[value=f08]'); await p.click('[data-act=pkdone]'); await p.waitForTimeout(80);
  log('library pick:', await p.evaluate(() => { const s = L.board('abbey').slots[0].sound; return s.kind + ' ' + s.files.join(', '); }));
  await p.focus('[data-k=slot-3]'); await p.keyboard.press('p'); await p.waitForTimeout(80); log('P key:', await live(), '| focus', await p.evaluate(() => document.activeElement.dataset.k));
  log('errors:', errs.length ? errs : 'none'); await b.close();
})();
