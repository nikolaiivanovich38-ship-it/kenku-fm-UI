// Round 6, part 5: checks the Saved pop-up (ROUND6.md "Part 5: the Saved pop-up") and takes its screenshots.
// For Live (a scene playing) and three Prep screens, at 1920×1080, 1280×800 and 960×1000:
//   place     (part 6) the pop-up's bottom-right corner is the same distance from the work area's bottom-right corner
//             (above the Now playing bar when it shows) on every screen, and it covers neither On air, the Now playing
//             bar nor the top bar; what it lies over in Live is printed
//   text      "Saved: <what>"
//   merge     the same save again within 2 s refreshes the one pop-up (one element, text unchanged, not read out again)
//   focus     focus stays where it was
//   failure   a failed save shows a warning that is still there after 6 s, with Try again; Try again saves
// and in each of the five themes, the contrast of the pop-up's text (4.5:1) and of the failure's warning edge (3:1).
// Screenshots: shots/r6/saved-live-<width>.png, saved-campaign-<width>.png and saved-failed-960.png.
//   node design/prototype/tools/r6-saved.js      (set LYRE_SPEC_CHROMIUM to use another Chromium)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const FILE = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html');
const SHOTS = path.resolve(__dirname, '..', 'shots', 'r6'); fs.mkdirSync(SHOTS, { recursive: true });
// [name, route, set up, save (a real save, as a person would make it)]
const SCREENS = [
  ['live', '#live', "L.acts.lvstart({ dataset: { i: '2' } });", "document.querySelector('[data-act=rep1]').click();"],
  ['campaign', '#campaign--crown', '', "var f = document.getElementById('cp-c-notes'); f.focus(); f.value += ' Bring dice.'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); f.blur();"],
  ['playlist', '#playlist--p-abbess', '', "document.querySelector('[data-act=plmove][data-d=\"1\"]') ? document.querySelector('[data-act=plmove][data-d=\"1\"]').click() : L.acts.plnorm({ dataset: { v: 'on' } });"],
  ['planner', '#session--crown--s14', "document.querySelector('[data-act=cpscene][data-id=sc3]').click();", "var f = document.querySelector('[data-k=scnotes-sc3]'); f.focus(); f.value += ' Bells.'; f.dispatchEvent(new Event('input', { bubbles: true })); f.blur();"],
];
const SIZES = [[1920, 1080], [1280, 800], [960, 1000]];
const THEMES = ['candle', 'fern', 'hearth', 'parchment', 'elysium'];

function rgb(s) { const m = s.match(/[\d.]+/g).map(Number); return m.slice(0, 3); }
function lum(c) { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
function ratio(a, b) { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  let problems = 0; const bad = (m) => { problems++; console.log('  PROBLEM', m); };
  for (const [w, h] of SIZES) {
    const places = [];
    for (const [name, route, setup, save] of SCREENS) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) { /* no storage */ } });
      await p.goto(FILE + route); await p.waitForTimeout(300);
      if (setup) { await p.evaluate(setup); await p.waitForTimeout(300); }
      const focusBefore = await p.evaluate(() => (document.activeElement && (document.activeElement.dataset.k || document.activeElement.id)) || 'body');
      await p.evaluate(save); await p.waitForTimeout(400);
      const r = await p.evaluate(() => {
        const t = document.getElementById('lyre-toast'), q = t.getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect();
        const bar = document.querySelector('#view .onairbar'), floor = bar ? bar.getBoundingClientRect().top : v.bottom;
        const hit = (sel) => [...document.querySelectorAll(sel)].some((e) => { const z = e.getBoundingClientRect(); return z.width && q.left < z.right && q.right > z.left && q.top < z.bottom && q.bottom > z.top; });
        // What lies under the pop-up (Live): the boxes it overlaps, or empty space.
        const under = [...document.querySelectorAll('#view .pane, #view .lv-grp')].filter((e) => { const z = e.getBoundingClientRect(); return z.width && q.left < z.right && q.right > z.left && q.top < z.bottom && q.bottom > z.top; }).map((e) => e.getAttribute('aria-label') || e.querySelector('.lv-grp-h').textContent);
        return { text: t.textContent, n: document.querySelectorAll('#lyre-toasts [role=status]').length, fromRight: Math.round(v.right - q.right), aboveFloor: Math.round(floor - q.bottom), under: under.join(' + ') || 'empty space',
          covers: ['[data-pane=lv-onair], .lv-onair', '.onairbar', '.lv-top', '.viewhead'].filter(hit), focus: (document.activeElement && (document.activeElement.dataset.k || document.activeElement.id)) || 'body' };
      });
      console.log(`${name}@${w}: "${r.text}" ${r.fromRight}px from the right, ${r.aboveFloor}px above the bottom (or the Now playing bar), over ${r.under}${r.covers.length ? ', covers ' + r.covers.join(' ') : ''}`);
      if (!/^Saved: \S/.test(r.text)) bad('no "Saved: <what>"');
      if (r.covers.length) bad('covers ' + r.covers.join(', '));
      if (focusBefore !== 'body' && r.focus !== focusBefore && name === 'live') bad('focus moved from ' + focusBefore + ' to ' + r.focus);
      places.push(r.fromRight + ',' + r.aboveFloor);
      if ((name === 'live' || name === 'campaign') && w !== 1280) await p.screenshot({ path: path.join(SHOTS, `saved-${name}-${w}.png`) });
      // Merge: the same save again within 2 s refreshes the one pop-up; its text is put in (read out) once.
      if (name === 'campaign') {
        await p.evaluate(() => { window.__puts = []; new MutationObserver(() => { const t = document.getElementById('lyre-toast'); if (t.textContent) window.__puts.push(t.getAttribute('aria-live')); }).observe(document.getElementById('lyre-toast'), { childList: true, subtree: true, characterData: true }); });
        await p.waitForTimeout(2500); await p.evaluate(save); await p.waitForTimeout(600); await p.evaluate(save); await p.waitForTimeout(300);
        const m = await p.evaluate(() => ({ puts: window.__puts, n: document.querySelectorAll('#lyre-toasts [role=status]').length, text: document.getElementById('lyre-toast').textContent }));
        const loud = m.puts.filter((x) => x !== 'off').length;
        console.log(`  same save twice in 0.6 s: ${m.n} pop-up, read out ${loud} time(s)`);
        if (m.n !== 1 || loud !== 1 || !m.text.startsWith('Saved:')) bad('a repeat within 2 s should refresh the one pop-up silently: ' + JSON.stringify(m));
      }
      if (errs.length) bad('console: ' + errs.join(' | '));
      await p.close();
    }
    if (new Set(places).size !== 1) bad(`not in one place at ${w}: ${places.join(' / ')}`);
  }
  // A failed save stays, with Try again.
  {
    const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
    await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) { /* no storage */ } });
    await p.goto(FILE + '#campaign--crown'); await p.waitForTimeout(300);
    await p.evaluate(() => L.failNextSave()); await p.evaluate(SCREENS[1][3]); await p.waitForTimeout(6500);
    const f = await p.evaluate(() => document.querySelector('#lyre-toasts [role=alert]').textContent);
    console.log('failed save after 6.5 s:', JSON.stringify(f.slice(0, 60)));
    if (!/^Not saved: /.test(f) || !/Try again/.test(f)) bad('the failed save did not stay');
    await p.screenshot({ path: path.join(SHOTS, 'saved-failed-960.png') });
    await p.click('[data-act=savetry]'); await p.waitForTimeout(200);
    const after = await p.evaluate(() => ({ fail: document.querySelector('#lyre-toasts [role=alert]').textContent, ok: document.getElementById('lyre-toast').textContent }));
    if (after.fail || !after.ok.startsWith('Saved:')) bad('Try again did not save: ' + JSON.stringify(after));
    await p.close();
  }
  // Contrast in the five themes.
  for (const theme of THEMES) {
    const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
    await p.addInitScript((t) => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: t, frame: 'full', notes: false, tour: 'done' })); } catch (e) { /* no storage */ } }, theme);
    await p.goto(FILE + '#library'); await p.waitForTimeout(300);
    await p.evaluate(() => { L.saved('test'); L.saveFailed('test', function () {}); });
    const c = await p.evaluate(() => {
      const s = getComputedStyle(document.getElementById('lyre-toast')), f = getComputedStyle(document.getElementById('lyre-fail')), sp = getComputedStyle(document.querySelector('#lyre-fail .grow span'));
      return { okFg: s.color, okBg: s.backgroundColor, failFg: f.color, failSub: sp.color, failBg: f.backgroundColor, edge: f.borderLeftColor, page: getComputedStyle(document.body).backgroundColor };
    });
    const r = [ratio(c.okFg, c.okBg), ratio(c.failFg, c.failBg), ratio(c.failSub, c.failBg), ratio(c.edge, c.failBg)];
    console.log(`${theme.padEnd(10)} Saved ${r[0].toFixed(1)}  failed ${r[1].toFixed(1)} / ${r[2].toFixed(1)}  edge ${r[3].toFixed(1)}`);
    if (r[0] < 4.5 || r[1] < 4.5 || r[2] < 4.5) bad(theme + ': text under 4.5:1');
    if (r[3] < 3) bad(theme + ': warning edge under 3:1');
    await p.close();
  }
  await b.close();
  console.log(problems ? problems + ' problems' : 'Saved pop-up: every check passed');
  process.exit(problems ? 1 : 0);
})();
