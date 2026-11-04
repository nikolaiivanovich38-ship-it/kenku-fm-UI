// Campaigns views: tab order walk plus a functional check of the main flows. node tools/cp-tab.js
const { chromium } = require('playwright'); const path = require('path');
const file = 'file://' + path.resolve(__dirname, '..', 'campaigns.html');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })); } catch (e) {} });
  const desc = () => p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return '(body)'; const inApp = document.getElementById('view').contains(a) ? '' : '[outside view] '; return inApp + a.tagName.toLowerCase() + ' ' + ((a.getAttribute('aria-label') || a.textContent || a.value || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 50)); });
  async function walk(route, n) {
    await p.goto(file + route); await p.waitForTimeout(300);
    await p.evaluate(() => { const h = document.querySelector('#view h1'); h.setAttribute('tabindex', '-1'); h.focus(); });
    const seen = [];
    for (let i = 0; i < n; i++) { await p.keyboard.press('Tab'); const d = await desc(); seen.push(d); if (d.startsWith('[outside view]') && i > 3) break; }
    console.log('\nTAB', route, '\n  ' + seen.join('\n  '));
  }
  await walk('#/campaigns', 14);
  await walk('#/campaign/crown', 40);
  await walk('#/session/crown/s14', 34);

  // Flows on the session page
  await p.goto(file + '#/session/crown/s14'); await p.waitForTimeout(300);
  const q = (js) => p.evaluate(js);
  await p.click('[data-k="sct-sc3"]');
  await p.keyboard.press('Tab'); // focus kept on the toggle? then tab to next
  const music = () => q(() => L.session('crown', 's14').scenes[2].music.join(','));
  await p.click('[data-k="im-sc3-music-p-abbess"]'); await p.click('.menu [data-op="up"]');
  console.log('\nmusic item up ->', await music(), '| focus', await desc());
  await p.click('[data-k="xp-cp-sc3:music:p-abbey-eerie"]');
  console.log('expander open ->', await q(() => !!document.querySelector('.cp-it .xp-body')), '| focus', await desc());
  await p.click('[data-k="pv-track-t13"]');
  console.log('preview ->', await q(() => L.previewLabel && L.previewLabel()));
  await p.click('[data-k="am-sc3"]'); await p.waitForTimeout(100);
  await p.click('#pk-list input[value="t01"]'); await p.click('#pk-list input[value="p-coast"]'); await p.click('[data-act="pkdone"]');
  console.log('add music (track then playlist) ->', await music(), '| focus', await desc());
  await p.click('[data-k="im-sc3-music-t13"]'); await p.click('.menu [data-op="remove"]');
  console.log('remove first ->', await music(), '| focus', await desc());
  await p.click('[data-k="ab-sc3"]'); await p.waitForTimeout(100); await p.click('#pk-list input[value="combat"]'); await p.click('[data-act="pkdone"]');
  console.log('boards ->', await q(() => L.session('crown', 's14').scenes[2].boards.join(',')));
  await p.click('[data-k="im-sc3-boards-abbey"]'); await p.click('.menu [data-op="down"]');
  console.log('board down ->', await q(() => L.session('crown', 's14').scenes[2].boards.join(',')), '| first tag', await q(() => document.querySelectorAll('.cp-firsttag')[1].textContent));
  await p.click('[data-k="pa-sc3"]'); await p.waitForTimeout(100); await p.click('#pk-list input[value="b06"]'); await p.click('[data-act="pkdone"]');
  console.log('ambience track ->', await q(() => L.session('crown', 's14').scenes[2].amb));
  await p.click('[data-k="scm-sc3"]'); await p.click('.menu [data-act="cpmove"][data-dir="1"]');
  console.log('move scene down ->', await q(() => L.session('crown', 's14').scenes.map(s => s.id).join(',')), '| focus', await desc());
  await p.waitForTimeout(100); console.log('  say:', await q(() => document.getElementById('lyre-live').textContent));
  // drag scene 1 below scene 3 with real mouse events
  const t = p.locator('[data-drag="scenes"][data-idx="2"]'), tb = await t.boundingBox();
  await p.locator('[data-drag="scenes"][data-idx="0"] .cp-handle').dragTo(t, { targetPosition: { x: 40, y: tb.height - 6 } });
  await p.waitForTimeout(200);
  console.log('drag scene 1 after scene 3 ->', await q(() => L.session('crown', 's14').scenes.map(s => s.id).join(',')));
  // add scene after current, then delete it with confirmation
  await p.click('[data-k="addscene"]'); await p.waitForTimeout(100);
  console.log('add scene ->', await q(() => L.session('crown', 's14').scenes.map(s => s.name).join(' | ')), '| focus', await desc());
  await p.keyboard.type('Bells at midnight');
  const newId = await q(() => L.session('crown', 's14').scenes.filter(s => s.name === 'Bells at midnight')[0].id);
  await p.click('[data-k="scm-' + newId + '"]'); await p.click('.menu [data-act="cpdup"]');
  console.log('duplicate ->', await q(() => L.session('crown', 's14').scenes.map(s => s.name).join(' | ')));
  await p.click('[data-k="scm-' + newId + '"]'); await p.click('.menu [data-act="cpdelask"]');
  console.log('delete sheet:', await q(() => document.querySelector('#lyre-sheet h2').textContent));
  await p.click('#lyre-sheet [data-act="cpdel"]');
  console.log('after delete ->', await q(() => L.session('crown', 's14').scenes.length), 'scenes | focus', await desc());
  // status change keeps one Next
  await p.selectOption('#cp-s-status', 'draft'); await p.goto(file + '#/session/crown/s15'); await p.waitForTimeout(200); await p.selectOption('#cp-s-status', 'next');
  console.log('statuses ->', await q(() => L.campaign('crown').sessions.map(s => s.n + ':' + s.status).join(' ')));
  // theme change on campaign page
  await p.goto(file + '#/campaign/crown'); await p.waitForTimeout(200); await p.selectOption('#cp-c-theme', 'candle');
  console.log('theme after change ->', await q(() => document.documentElement.dataset.theme));
  // remove + add campaign playlist
  await p.click('[data-k="more-cplp-ashen"]'); await p.click('.menu [data-act="cprm"]'); await p.waitForTimeout(50); console.log('remove ->', await q(() => L.campaign('crown').playlists.join(',')), '| focus', await desc());
  // run next session
  await p.click('[data-k="srun-s12"]');
  console.log('run played session ->', await q(() => location.hash + ' ' + JSON.stringify(L.state.live)));
  await p.goto(file + '#/campaign/crown'); await p.waitForTimeout(200); await p.click('[data-k="mode-live"]'); await p.waitForTimeout(200);
  console.log('mode Live ->', await q(() => location.hash));
  await p.goto(file + '#/campaign/crown'); await p.waitForTimeout(200); await p.click('[data-k="hrun"]'); await p.waitForTimeout(200);
  console.log('run ->', await q(() => location.hash + ' ' + JSON.stringify(L.state.live)));
  console.log('\nerrors:', errs.length ? errs : 'none');
  await b.close();
})();
