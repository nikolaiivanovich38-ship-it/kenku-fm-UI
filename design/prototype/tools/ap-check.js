// Audio profile checks: flows, screenshots, tab order. OUT=profile.html node tools/ap-check.js
const { chromium } = require('playwright'); const path = require('path');
const shot = n => path.resolve(__dirname, '..', 'shots', 'profile-' + n + '.png');
(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  async function page(route, w, h, theme) {
    const p = await b.newPage({ viewport: { width: w || 960, height: h || 1000 } });
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    await p.addInitScript(([t]) => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: t || 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) {} }, [theme]);
    await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'profile.html') + route); await p.waitForTimeout(300); return p;
  }
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  const prof = (p, k) => p.evaluate(k => JSON.stringify(L.profileOf(L.track('t13'), k || null)), k);

  // 1. Drag End on t13 to about 4:00 with the mouse, then choose Move to the next track.
  let p = await page('#/profile/t13');
  const wave = await p.locator('.ap-wave').boundingBox(), tab = await p.locator('.ap-h-end .ap-htab').boundingBox();
  await p.mouse.move(tab.x + tab.width / 2, tab.y + 10); await p.mouse.down();
  await p.mouse.move(wave.x + wave.width * 240 / 441, tab.y + 10, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(100);
  const e1 = JSON.parse(await prof(p)).end; ok(Math.abs(e1 - 240) <= 2, 'dragging the End tab moves End (now ' + e1 + ' s)');
  await p.click('[data-k="ap-after-next"]'); await p.waitForTimeout(100);
  ok(JSON.parse(await prof(p)).after === 'next', 'Move to the next track chosen');
  await p.screenshot({ path: shot('flow-dragend-next-960') });
  // keyboard on the End handle
  await p.focus('[data-k="ap-h-end"]'); await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(50);
  ok(JSON.parse(await prof(p)).end === e1 + 10, 'Shift+Right on End adds 10 s; aria-valuetext ' + await p.getAttribute('[data-k="ap-h-end"]', 'aria-valuetext'));
  // fade knob by keyboard
  await p.focus('[data-k="ap-h-fadeout"]'); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight');
  ok(JSON.parse(await prof(p)).fadeOut.dur === 4, 'fade out knob: 4 × Right = 4 s');
  // last 10 s crossing End into the next track
  await p.click('[data-k="ap-last"]'); await p.waitForTimeout(8800);
  await p.screenshot({ path: shot('flow-last10-fade-960') });
  await p.waitForTimeout(2600);
  ok(await p.evaluate(() => !!document.querySelector('.ap-ho')), 'hand-over to the next track is shown: ' + await p.evaluate(() => (document.querySelector('.ap-ho .ellipsis') || {}).textContent));
  await p.screenshot({ path: shot('flow-last10-next-960') });
  ok(!p.errs.length, 'no console errors ' + p.errs.join(' ')); await p.close();

  // 2. t13 loop: last 10 s crossing End (loop jump)
  p = await page('#/profile/t13', 960, 1000, 'parchment');
  await p.click('[data-k="ap-last"]'); await p.waitForTimeout(10900);
  const loops = await p.evaluate(() => document.querySelector('.ap-loops').textContent);
  ok(/once/.test(loops), 'loop counted after crossing End: ' + loops + ', event: ' + await p.evaluate(() => (document.querySelector('.ap-event') || {}).textContent));
  await p.screenshot({ path: shot('flow-last10-loop-960-parchment') });
  await p.close();

  // 3. Places: scene with own settings, playlist using the track's, give own, back to track's.
  p = await page('#/profile/t13/sc:crown:s14:sc3');
  ok(JSON.parse(await prof(p, 'sc:crown:s14:sc3')).end === 190, 'scene place shows its own End (3:10)');
  await p.screenshot({ path: shot('flow-place-scene-960') });
  await p.selectOption('[data-k="ap-place"]', 'pl:p-gothic'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => L.current().p.ctx === 'pl:p-gothic' && document.activeElement.dataset.k === 'ap-place'), 'route follows the place and focus stays on the selector');
  ok(await p.evaluate(() => document.querySelector('[data-k="ap-f-end"]').disabled), 'place using the track\'s settings is read-only');
  await p.screenshot({ path: shot('flow-place-playlist-ro-960') });
  await p.click('[data-k="ap-own"]'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !!L.data.profiles['pl:p-gothic'].t13 && !document.querySelector('[data-k="ap-f-end"]').disabled), 'Give this place its own settings copies and unlocks');
  await p.fill('[data-k="ap-f-end"]', '4:30'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok(JSON.parse(await prof(p, 'pl:p-gothic')).end === 270 && JSON.parse(await prof(p)).end === 318, 'typing End 4:30 changes only the playlist\'s settings');
  await p.screenshot({ path: shot('flow-place-playlist-own-960') });
  await p.click('[data-k="ap-clear"]'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !L.data.profiles['pl:p-gothic'].t13 && !!document.querySelector('[data-k="ap-undo"]')), 'Back to the track\'s settings removes them, with Undo');
  // shortcuts
  await p.goto('about:blank'); p = await page('#/profile/t13');
  await p.click('.ap-meta'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('m'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.profileOf(L.track('t13')).markers.some(m => m.at === 2)), 'M adds a marker at the playhead (2 s)');
  await p.keyboard.press(' '); await p.waitForTimeout(600);
  ok(await p.evaluate(() => document.querySelector('[data-k="ap-play"]').getAttribute('aria-pressed') === 'true'), 'Space plays');
  await p.screenshot({ path: shot('flow-playing-960') });
  await p.keyboard.press(' '); await p.waitForTimeout(50);
  await p.click('[data-k="ap-keys1"]'); await p.click('.ap-meta'); await p.keyboard.press('o');
  ok(JSON.parse(await prof(p)).end === 318, 'with single-key shortcuts off, O does nothing');
  await p.click('[data-k="ap-keys1"]');

  // 4. Tab order
  await p.evaluate(() => document.querySelector('[data-k="rail-look"]').focus());
  const seen = [];
  for (let i = 0; i < 90; i++) {
    await p.keyboard.press('Tab');
    const d = await p.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('#view')) return null; return a.dataset.k || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20); });
    if (d) { if (seen.includes(d)) break; seen.push(d); }
  }
  console.log('Tab order (' + seen.length + '):', seen.join(' | '));
  const missing = await p.evaluate(seen => [...document.querySelectorAll('#view button:not([disabled]), #view a, #view input:not([disabled]), #view select, #view [tabindex="0"]')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0 && !(e.type === "radio" && !e.checked)).map(e => e.dataset.k || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)).filter(k => !seen.includes(k)), seen);
  ok(!missing.length, 'every control reachable by Tab' + (missing.length ? ': missing ' + missing.join(', ') : ''));
  ok(!p.errs.length, 'no console errors ' + p.errs.join(' '));
  await b.close();
})();
