// Live view keyboard check: tab order, reachability and the live keys. OUT=live.html node tools/lv-keys.js
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false })); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'live.html') + '#/live'); await p.waitForTimeout(400);
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

  // Tab order
  const seen = [];
  for (let i = 0; i < 140; i++) {
    await p.keyboard.press('Tab');
    const d = await p.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('#view')) return a && a.closest('#rail') ? 'rail' : null; return a.dataset.k || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20); });
    if (d && d !== 'rail') { if (seen.includes(d)) break; seen.push(d); }
  }
  console.log('Tab order in view (' + seen.length + '):', seen.join(' | '));
  const missing = await p.evaluate((seen) => [...document.querySelectorAll('#view button:not([disabled]), #view a, #view input')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0).map(e => e.dataset.k || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)).filter(k => !seen.includes(k)), seen);
  ok(!missing.length, 'every visible control in the view is reachable by Tab' + (missing.length ? ': missing ' + missing.join(', ') : ''));

  // Space presses a button reached by Tab instead of starting a scene
  await p.focus('[data-k="lv-fxstop"]').catch(() => {});
  const sc0 = await p.evaluate(() => L.state.live.scene);
  await p.evaluate(() => document.querySelector('[data-k="lv-plm-campaign"]').focus()); await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
  await p.keyboard.press(' '); await p.waitForTimeout(100);
  const menuOpen = await p.evaluate(() => !!document.querySelector('.menu'));
  ok(menuOpen && (await p.evaluate(() => L.state.live.scene)) === sc0, 'Space on a tabbed-to button presses it (menu opened, scene unchanged)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(50);

  // Space after a mouse click starts the next scene
  await p.mouse.click(600, 990); await p.keyboard.press(' '); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.state.live.scene)) === sc0 + 1, 'Space starts the next scene (now ' + (await p.evaluate(() => L.session('crown', 's14').scenes[L.state.live.scene].name)) + ')');
  ok((await p.evaluate(() => document.activeElement.dataset.k)) === 'lv-nextsc', 'focus stays on the Next scene button after Space');
  ok(await p.evaluate(() => !!document.querySelector('[data-k="lv-undo"]')), 'Undo strip shows in On air');
  await p.screenshot({ path: path.resolve(__dirname, '..', 'shots', 'live-960-undo.png') });
  const amb1 = await p.evaluate(() => L.pb.amb.playlistId);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.state.live.scene + ' ' + L.pb.music.playlistId + ' ' + L.pb.amb.playlistId)) === sc0 + ' p-inn a-inn' && amb1 === 'a-abbey', 'Ctrl+Z puts back the previous scene, its music and ambience');
  await p.evaluate(() => document.querySelector('[data-k="lv-nextsc"]').click()); await p.waitForTimeout(100);
  await p.evaluate(() => document.querySelector('[data-k="lv-undo"]').click()); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.state.live.scene)) === sc0, 'Undo button puts back the previous scene');
  await p.evaluate(() => document.querySelector('[data-k="lv-nextsc"]').click()); await p.waitForTimeout(8600);
  ok(await p.evaluate(() => !document.querySelector('[data-k="lv-undo"]')), 'Undo strip goes after about 8 s');
  // Title click shows details and does not play
  const before = await p.evaluate(() => L.pb.music.id);
  await p.evaluate(() => document.querySelectorAll('.lv-trk-t')[1].click()); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.pb.music.id)) === before && await p.evaluate(() => !!document.querySelector('.lv-trk-d')), 'title click opens details without playing');
  // Keys popover: switch single-key shortcuts off
  await p.evaluate(() => document.querySelector('[data-k="lv-keys"]').click()); await p.waitForTimeout(100);
  ok(await p.evaluate(() => document.activeElement.dataset.k === 'lv-keys1' && !document.querySelector('.menu')), 'Keys opens a popover (not a menu) with focus on the switch');
  await p.screenshot({ path: path.resolve(__dirname, '..', 'shots', 'live-960-keys.png') });
  await p.keyboard.press(' '); await p.waitForTimeout(100);
  await p.keyboard.press('Escape'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => document.activeElement.dataset.k === 'lv-keys' && !document.querySelector('.lv-pop')), 'Esc closes the popover and returns focus');
  const sc2 = await p.evaluate(() => L.state.live.scene);
  await p.mouse.click(600, 990); await p.keyboard.press(' '); await p.keyboard.press('/'); await p.keyboard.press('1'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.state.live.scene)) === sc2 && (await p.evaluate(() => document.activeElement.dataset.k)) !== 'lv-q' && !(await p.evaluate(() => L.pb.fx.length)), 'with single-key shortcuts off, Space, / and pad keys do nothing');
  await p.evaluate(() => { document.querySelector('[data-k="lv-keys"]').click(); }); await p.waitForTimeout(50);
  await p.evaluate(() => { const c = document.querySelector('[data-k="lv-keys1"]'); c.click(); }); await p.waitForTimeout(50);
  await p.mouse.click(600, 990);
  ok(await p.evaluate(() => true) && await p.evaluate(() => { try { return localStorage.getItem('lyre-r2-live-keys1') === 'on'; } catch (e) { return false; } }), 'switch turned back on');
  // Hold pad by key: abbey board, Organ swell = 4 (hold)
  await p.keyboard.down('4'); await p.waitForTimeout(300);
  const held = await p.evaluate(() => L.padActive('abbey', 'organ'));
  await p.keyboard.up('4'); await p.waitForTimeout(600);
  ok(held && !(await p.evaluate(() => L.padActive('abbey', 'organ'))), 'hold pad key 4 plays while held and stops on release, with the Pads pane folded');
  await p.keyboard.press('q'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => L.padActive('abbey', 'choir')), 'toggle pad Q turns on');
  // Slash focuses search; Esc in the box clears, Esc outside fades
  await p.keyboard.press('/'); await p.waitForTimeout(100);
  ok((await p.evaluate(() => document.activeElement.dataset.k)) === 'lv-q', '/ focuses Off script search');
  await p.keyboard.type('bells'); await p.waitForTimeout(100);
  const n = await p.evaluate(() => document.querySelector('.lv-off-count').textContent);
  ok(/found/.test(n), 'typing searches: ' + n);
  await p.keyboard.press('q'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.padActive('abbey', 'choir')), 'pad keys ignored while typing (choir still on, q typed)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(50);
  ok((await p.evaluate(() => document.querySelector('[data-k="lv-q"]').value)) === '', 'Esc in the search box clears it');
  await p.mouse.click(600, 990); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !!L.pb.music), 'plain Esc outside a box does not fade');
  await p.keyboard.press('Shift+Escape'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !L.pb.music && !L.pb.amb), 'Shift+Esc fades all');
  // Queue: play next, then Next plays the queued track
  await p.evaluate(() => document.querySelector('[data-k="lv-nextsc"]').click()); await p.waitForTimeout(100);
  const qid = await p.evaluate(() => { const b = document.querySelectorAll('[data-act="lvqueue"]'); const x = b[b.length - 1]; x.click(); return x.dataset.id; });
  await p.evaluate(() => document.querySelector('[data-k="lv-next-music"]').click()); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.pb.music.id)) === qid, 'Play next queues a track and Next plays it');
  // Round 3: tag clear, FX filter and layering, scene list, board switch, mode switch
  await p.evaluate(() => { document.querySelector('[data-k="lv-tag-mood-Tense"]').click(); }); await p.waitForTimeout(50);
  ok(await p.evaluate(() => { const x = document.querySelector('[data-k="lv-tagx"]'); return x && x.getAttribute('aria-label') === 'Clear selected tags'; }), 'X button appears with a tag selected');
  await p.evaluate(() => document.querySelector('[data-k="lv-tagx"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => !document.querySelector('[data-k="lv-tagx"]') && !document.querySelector('.lv-mood[aria-pressed="true"]')), 'X clears the selected tags');
  await p.evaluate(() => { document.querySelector('[data-k="lv-lane-fx"]').click(); const q = document.querySelector('[data-k="lv-q"]'); q.value = 'door'; q.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(50);
  const mus = await p.evaluate(() => L.pb.music && L.pb.music.id);
  await p.evaluate(() => document.querySelector('[aria-label="Off script results"] [data-act="lvplay"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate((m) => L.pb.fx.length > 0 && (L.pb.music && L.pb.music.id) === m, mus), 'FX filter finds effects and Play now layers over the music');
  await p.evaluate(() => document.querySelector('[data-k="lv-start-2"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => document.querySelectorAll('.lv-items > li').length === 4 && !!document.querySelector('.lv-items > li.on')), 'Scene music lists the scene items in order and marks the one on air');
  await p.evaluate(() => document.querySelector('[data-k="lv-next-music"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.pb.music.seq && L.pb.music.seq.at === 2 && L.pb.music.id !== 't13' && document.querySelector('.lv-items > li.on .xp-btn') !== null), 'Next follows the scene sequence into the playlist item, skipping the repeated track');
  await p.evaluate(() => document.querySelector('[data-k="lv-start-2"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => !/Eerie dread, low cello/.test(document.querySelector('.lv-upnext').textContent)), 'Up next is not the track already playing');
  const endTxt = await p.evaluate(() => (document.querySelector('.lv-m .lv-lane-sub') || { title: '' }).title);
  ok(/Ends 3:10, then next/.test(endTxt), 'On air gives the end behaviour from the scene profile as a tooltip: ' + endTxt);
  ok(await p.evaluate(() => document.querySelector('.lv-items > li.lv-trk .lv-dur').textContent === '3:10'), 'scene row shows the length that will play (3:10, not the file\'s 7:21)');
  await p.evaluate(() => document.querySelector('.lv-items > li .lv-trk-t').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => { const a = document.querySelector('.lv-trk-d a.ap-link'); return a && a.getAttribute('href') === '#/profile/t13/sc:crown:s14:sc3'; }), 'details link to the Audio profile for this scene');
  ok(await p.evaluate(() => [...document.querySelectorAll('.lv-bseg button')].map(b => b.textContent).join('|') === 'Drowned Abbey|Weather and places'), 'Pads offer the scene boards as a switch');
  ok(await p.evaluate(() => !!document.querySelector('.lv-top [data-k="mode-live"][aria-pressed="true"]')), 'Prep | Live switch in the top strip');
  // Session switch
  await p.evaluate(() => document.querySelector('[data-k="lv-sess"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-sid="w4"]').click()); await p.waitForTimeout(100);
  ok((await p.evaluate(() => L.state.live.cid + '/' + L.state.live.sid + ' ' + document.documentElement.dataset.theme)) === 'sixth/w4 candle', 'session menu loads The Sixth Year, session 4, in its theme');
  await p.screenshot({ path: path.resolve(__dirname, '..', 'shots', 'live-960-switched.png') });
  // Rooms and per-box targets
  await p.evaluate(() => { L.botLeave('b1'); L.botLeave('b2'); }); await p.waitForTimeout(50);
  ok(await p.evaluate(() => /players hear nothing/.test(document.querySelector('.lv-top .lv-warn').textContent) && /Join Table/.test(document.querySelector('[data-k="lv-fix"]').textContent)), 'top strip warns with Join Table when no room exists');
  await p.evaluate(() => document.querySelector('[data-k="lv-fix"]').click()); await p.waitForTimeout(1300);
  ok(await p.evaluate(() => L.bot('b1').status === 'connected' && !document.querySelector('.lv-to')), 'one room: no To chips');
  await p.evaluate(() => document.querySelector('[data-k="lv-mute-b1"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.bot('b1').muted && document.querySelector('[data-pane="lv-room-b1"] .pane-status').textContent === 'Muted'), 'mute in the room header; status reads Muted');
  await p.evaluate(() => document.querySelector('[data-k="lv-mute-b1"]').click());
  await p.focus('[data-k="lv-vol-b1"]'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.bot('b1').volume === 80 && document.activeElement.dataset.k === 'lv-vol-b1'), 'room volume slider works by keyboard and keeps focus');
  await p.evaluate(() => document.querySelector('[data-k="lv-addroom"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvaddjoin"][data-id="b2"][data-c="c2"]').click()); await p.waitForTimeout(1300);
  ok(await p.evaluate(() => { const r = document.querySelector('[data-pane="lv-room-b2"]'); return r && /On air: Side room/.test(r.getAttribute('aria-label')) && r.classList.contains('is-silent') && r.querySelector('.pane-status').textContent === 'Silent' && !/Receiving/.test(r.textContent); }), 'Add a room: Side room box appears, Silent, one status, class is-silent');
  ok(await p.evaluate(() => /To:\s*Table/.test(document.querySelector('[data-k="lv-to-music"]').textContent) && !!document.querySelector('[data-k="lv-to-off"]')), 'two rooms: To: Table chips on Scene music and Off script');
  await p.evaluate(() => document.querySelector('[data-k="lv-to-music"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvtoset"][data-v="b2"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.k === 'lv-to-music' && /Side room/.test(document.activeElement.textContent)), 'To menu picks Side room; focus returns to the chip');
  ok(await p.evaluate(() => /Play on air in Side room/.test(document.querySelector('[data-pane="lv-music"] [data-act="lvplay"]').getAttribute('aria-label'))), 'row buttons name the room');
  const tableMusic = await p.evaluate(() => L.pb.music && L.pb.music.id);
  await p.evaluate(() => document.querySelector('.lv-items [data-act="lvplay"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate((tm) => !!L.mix('b2').music && (L.pb.music && L.pb.music.id) === tm, tableMusic), 'Play on air from Scene music goes only to its room (Side room)');
  await p.evaluate(() => { document.querySelector('[data-act=pane][data-id=lv-pads]').click(); }); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('[data-k="lv-boardbtn"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvboard"][data-id="weather"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('[data-k="lv-to-pads"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvtoset"][data-v="b2"]').click()); await p.waitForTimeout(50);
  await p.mouse.click(600, 990); await p.keyboard.press('w'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.fxFor('b2').some(f => f.ref === 'weather/storm') && !L.fxFor('table').some(f => f.ref === 'weather/storm' && !f.fadeOut)), 'pad key goes to the Pads box room (Side room)');
  ok(await p.evaluate(() => /S/.test(document.querySelector('[data-k="lv-pad-weather-storm"] .lv-pad-rm').textContent)), 'sounding pad shows its room initial');
  await p.evaluate(() => document.querySelector('[data-k="lv-to-pads"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvtoset"][data-v="b1"]').click()); await p.waitForTimeout(50);
  await p.mouse.click(600, 990); await p.keyboard.press('w'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.fxFor('b2').some(f => f.ref === 'weather/storm' && !f.fadeOut) && L.fxFor('table').some(f => f.ref === 'weather/storm' && !f.fadeOut)), 'toggle pad with another room starts it there, leaving the first room on');
  await p.keyboard.press('w'); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.fxFor('b2').some(f => f.ref === 'weather/storm' && !f.fadeOut) && !L.fxFor('table').some(f => f.ref === 'weather/storm' && !f.fadeOut)), 'pressing it again stops it only in Table');
  await p.evaluate(() => document.querySelector('[data-k="lv-nextsc"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => L.pb.music && L.pb.music.seq && L.pb.music.seq.scene === L.state.live.scene), 'Next scene plays in the first room (Table)');
  await p.evaluate(() => document.querySelector('[data-k="lv-room-b1"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map(x => x.textContent).join('|').indexOf('Copy what Side room is playing') > -1), 'room ⋯ menu offers Copy what Side room is playing');
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.querySelector('[data-k="lv-room-b2"]').click()); await p.waitForTimeout(50);
  await p.evaluate(() => document.querySelector('.menu [data-act="lvbotleave"]').click()); await p.waitForTimeout(50);
  ok(await p.evaluate(() => !document.querySelector('[data-pane="lv-room-b2"]') && !document.querySelector('.lv-to')), 'Leave removes the Side room box and the To chips');
  // Scene music grows with an expanded playlist; the page scrolls
  const h0 = await p.evaluate(() => document.querySelector('[data-pane="lv-music"]').getBoundingClientRect().height);
  await p.evaluate(() => document.querySelector('[data-pane="lv-music"] .xp-btn').click()); await p.waitForTimeout(50);
  ok(await p.evaluate((h) => document.querySelector('[data-pane="lv-music"]').getBoundingClientRect().height > h + 60 && getComputedStyle(document.querySelector('[data-pane="lv-music"] .pane-body')).overflowY === 'visible', h0), 'expanding a playlist grows the Scene music box (no inner scroll)');
  // Standby: Run / Prep|Live from another session
  await p.evaluate(() => L.liveStandby('masks', 'v7')); await p.evaluate(() => L.render()); await p.waitForTimeout(100);
  ok(await p.evaluate(() => L.state.live.cid === 'masks' && /^Start: Arrival/.test(document.querySelector('[data-k="lv-nextsc"]').textContent) && !document.querySelector('.lv-nowb') && !L.pb.music && !L.pb.amb), 'L.liveStandby loads the session with nothing started and fades the other session out');
  // Live reached from another page (not first load) opens on standby, without the demo
  const p2 = await b.newPage({ viewport: { width: 960, height: 1000 } });
  await p2.goto('file://' + path.resolve(__dirname, '..', process.env.OUT || 'live.html') + '#/campaigns'); await p2.waitForTimeout(300);
  await p2.evaluate(() => { location.hash = '#/live'; }); await p2.waitForTimeout(300);
  ok(await p2.evaluate(() => !L.pb.music && /^Start: /.test(document.querySelector('[data-k="lv-nextsc"]').textContent)), 'Live opened from another page shows standby, no demo playback');
  ok(await p2.evaluate(() => { document.querySelector('[data-k="lv-pl-p-company"]') ; const x = document.querySelector('.lv-pli .xp-btn'); if (x) x.click(); const a = document.querySelector('.lv-trk .lv-trk-acts'); return a && [...a.querySelectorAll('button')].map(b => b.getAttribute('aria-label').split(':')[0]).join('|') === 'Preview|Play next|Play on air'; }), 'row actions read Preview, Play next, Play on air');
  console.log(errs.length ? errs : 'no errors'); await b.close();
})();
