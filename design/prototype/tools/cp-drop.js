// Synthetic file drops on the session planner (scene Music list, folded scene card, Ambience slot). node tools/cp-drop.js
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '..', 'campaigns.html') + '#/session/crown/s14'); await p.waitForTimeout(300);
  await p.click('[data-k="sct-sc3"]');
  // drop(selector, names, where: 'top'|'row2'|'center'); dispatches dragenter/dragover/drop with a real DataTransfer of Files
  const drop = (sel, names, where, keep) => p.evaluate(([sel, names, where, keep]) => {
    const el = document.querySelector(sel), dt = new DataTransfer(); names.forEach(n => dt.items.add(new File(['x'], n, { type: 'audio/flac' })));
    let r = el.getBoundingClientRect(), y = r.top + r.height / 2, x = r.left + 40;
    if (where === 'row2') { const row = el.querySelectorAll('.cp-items > .cp-it')[1].getBoundingClientRect(); y = row.top + 4; }
    const target = document.elementFromPoint(x, y), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
    target.dispatchEvent(new DragEvent('dragenter', o)); target.dispatchEvent(new DragEvent('dragover', o));
    const line = !!document.querySelector('.cp-ins-before, .cp-ins-end'), outlined = !!document.querySelector('.cp-fdrop');
    if (!keep) target.dispatchEvent(new DragEvent('drop', o));
    return { line, outlined };
  }, [sel, names, where, keep]);
  const music = (i) => p.evaluate(i => L.session('crown', 's14').scenes[i].music.map(id => (L.track(id) ? L.track(id).file : id)).join(', '), i);
  console.log('before:', await music(2));
  console.log('hover marks:', await drop('[data-filedrop="music"].cp-box', ['01 New theme.flac'], 'row2', true));
  await p.screenshot({ path: 'shots/campaigns-drop-hover-960.png' });
  console.log(await drop('[data-filedrop="music"].cp-box', ['01 New theme.flac', 'notes.txt', '02 Second.mp3'], 'row2'));
  await p.waitForTimeout(200);
  console.log('after drop at row 2:', await music(2));
  console.log('toast:', await p.evaluate(() => document.getElementById('lyre-toast').textContent));
  console.log('library has:', await p.evaluate(() => L.data.tracks.filter(t => t.isNew && /New theme|Second/.test(t.file)).map(t => t.file + ' [' + t.kind + ']').join(', ')));
  await p.screenshot({ path: 'shots/campaigns-drop-done-960.png' });
  await drop('[data-filedrop="amb"]', ['rain_on_glass.wav'], 'center'); await p.waitForTimeout(200);
  console.log('ambience:', await p.evaluate(() => { const id = L.session('crown', 's14').scenes[2].amb; const t = L.track(id); return t ? t.file + ' [' + t.kind + ']' : id; }), '|', await p.evaluate(() => document.getElementById('lyre-toast').textContent));
  await drop('.cp-scene[data-filedrop="music"]:not(.open)', ['03 Folded.ogg'], 'center'); await p.waitForTimeout(200);
  console.log('folded scene 1 append:', await music(0));
  // a non-file drag (text) must be ignored
  const ignored = await p.evaluate(() => { const el = document.querySelector('[data-filedrop="music"].cp-box'), dt = new DataTransfer(); dt.setData('text/plain', 'hi'); const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); el.dispatchEvent(ev); return !ev.defaultPrevented && !document.querySelector('.cp-fdrop'); });
  console.log('text drag ignored:', ignored);
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})();
