// Live view check: tab order and reachability, the live keys, Undo, the rows' buttons, rooms. Round 6 (part 3 and the
// review fixes, ROUND6.md part 4): seven boxes, Find in the top strip. Part 6: On air at the top (box 1), Back and the
// trail first in the strip, Find finds playlists, full row buttons in an unfolded scene and on the ambience.
//   node design/prototype/tools/lv-keys.js            (OUT=<built file> to check another build; LYRE_SPEC_CHROMIUM for Chromium)
const { chromium } = require('playwright'); const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', process.env.OUT || 'lyre-prototype.html');
const SET = () => { try { localStorage.setItem('lyre-r2', JSON.stringify({ theme: 'campaign', frame: 'full', notes: false, tour: 'done' })); } catch (e) { /* no storage */ } };
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const b = await chromium.launch(process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 960, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(SET);
  // '#/live' (not '#live'): Live as the first page opened starts mid-session (scene 2 of 6), for the checks below.
  await p.goto(FILE + '#/live'); await p.waitForTimeout(400);
  const ev = (f, a) => p.evaluate(f, a);
  const click = (k) => ev((k) => document.querySelector('[data-k="' + k + '"]').click(), k);
  // As after a click on an empty part of the screen: nothing has focus and the keyboard was not used to get there.
  const blank = () => ev(() => { if (document.activeElement) document.activeElement.blur(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });

  // Tab order: every visible control of the view is reached.
  const seen = [];
  for (let i = 0; i < 160; i++) {
    await p.keyboard.press('Tab');
    const d = await ev(() => { const a = document.activeElement; if (!a || !a.closest('#view')) return a && a.closest('#rail') ? 'rail' : null; return a.dataset.k || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20); });
    if (d && d !== 'rail') { if (seen.includes(d)) break; seen.push(d); }
  }
  const missing = await ev((seen) => [...document.querySelectorAll('#view button:not([disabled]), #view a, #view input')].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0).map((e) => e.dataset.k || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)).filter((k) => !seen.includes(k)), seen);
  ok(!missing.length, 'every visible control in the view is reachable by Tab (' + seen.length + ')' + (missing.length ? ': missing ' + missing.join(', ') : ''));

  // Space on a button reached by Tab presses it; after a click elsewhere it starts the next scene.
  const sc0 = await ev(() => L.state.live.scene);
  await ev(() => document.querySelector('[data-k="lv-keys"]').focus()); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  await p.keyboard.press(' '); await p.waitForTimeout(100);
  ok(await ev(() => !!document.querySelector('.lv-pop')) && (await ev(() => L.state.live.scene)) === sc0, 'Space on a tabbed-to button presses it (Keys opened, scene unchanged)');
  await p.keyboard.press('Escape');
  await blank(); await p.keyboard.press(' '); await p.waitForTimeout(100);
  ok((await ev(() => L.state.live.scene)) === sc0 + 1, 'Space starts the next scene (now ' + (await ev(() => L.session('crown', 's14').scenes[L.state.live.scene].name)) + ')');
  ok(await ev(() => !!document.querySelector('[data-k="lv-undo"]')), 'the Undo strip shows in Scenes');
  const amb1 = await ev(() => L.pb.amb.playlistId);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  ok((await ev(() => L.state.live.scene + ' ' + L.pb.music.playlistId + ' ' + L.pb.amb.playlistId)) === sc0 + ' p-inn a-inn' && amb1 === 'a-abbey', 'Ctrl+Z puts back the previous scene, its music and ambience');
  await click('lv-nextsc'); await p.waitForTimeout(100); await click('lv-undo'); await p.waitForTimeout(100);
  ok((await ev(() => L.state.live.scene)) === sc0, 'the Undo button puts back the previous scene');

  // Must 1 (review): Ctrl+Z takes back only the latest action; a pause, a pad or Repeat ends the scene's Undo.
  for (const [what, act] of [['a pause', "document.querySelector('[data-act=lvpause][data-lane=music]').click()"], ['a pad', "document.querySelector('.lv-cur-pads .lv-pad').click()"], ['Repeat', "document.querySelector('[data-act=lanerepeat]').click()"]]) {
    await click('lv-nextsc'); await p.waitForTimeout(100); const at = await ev(() => L.state.live.scene);
    await ev(act); await p.waitForTimeout(100); await blank(); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    ok((await ev(() => L.state.live.scene)) === at && !(await ev(() => !!document.querySelector('[data-k="lv-undo"]'))), 'after ' + what + ', Ctrl+Z leaves the scene alone and the scene\'s Undo is gone');
    await ev(() => { if (L.pb.music && L.pb.music.paused) L.pauseLane('music'); L.stopPads(); });
  }
  await ev(() => L.liveStandby('crown', 's14')); await ev(() => L.render());
  await click('lv-nextsc'); await p.waitForTimeout(8700);
  ok(await ev(() => !document.querySelector('[data-k="lv-undo"]')), 'the Undo strip goes after about 8 s');

  // A title opens the row's details without playing.
  const before = await ev(() => L.pb.music.id);
  await ev(() => document.querySelector('[data-pane="lv-current"] .lv-trk-t').click()); await p.waitForTimeout(100);
  ok((await ev(() => L.pb.music.id)) === before && await ev(() => !!document.querySelector('.lv-trk-d')), 'a title click opens details without playing');

  // Keys popover: the switch for single-key shortcuts, Esc, and Help at its foot.
  await click('lv-keys'); await p.waitForTimeout(100);
  ok(await ev(() => document.activeElement.dataset.k === 'lv-keys1' && !document.querySelector('.menu')), 'Keys opens a popover (not a menu) with focus on the switch');
  await p.keyboard.press(' '); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(50);
  ok(await ev(() => document.activeElement.dataset.k === 'lv-keys' && !document.querySelector('.lv-pop')), 'Esc closes the popover and returns focus');
  const sc2 = await ev(() => L.state.live.scene);
  await blank(); await p.keyboard.press(' '); await p.keyboard.press('/'); await p.keyboard.press('1'); await p.waitForTimeout(100);
  ok((await ev(() => L.state.live.scene)) === sc2 && (await ev(() => document.activeElement.dataset.k)) !== 'lv-q' && !(await ev(() => L.padSounds().length)), 'with single-key shortcuts off, Space, / and pad keys do nothing');
  await click('lv-keys'); await p.waitForTimeout(50); await click('lv-keys1'); await p.waitForTimeout(50);
  ok(await ev(() => { try { return localStorage.getItem('lyre-r2-live-keys1') === 'on'; } catch (e) { return false; } }), 'the switch turns back on');
  await click('lv-keyshelp'); await p.waitForTimeout(150);
  ok(await ev(() => !document.querySelector('.lv-pop') && !!document.querySelector('#lyre-help:not([hidden])') && document.activeElement.dataset.k === 'help-q'), 'Help at the foot of Keys opens Help, focus in its search');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await ev(() => !!document.querySelector('#lyre-help[hidden]')), 'Esc closes Help');

  // Pad keys belong to Current scene's board (The abbey ruins: Organ swell = 4, hold; Drowned choir = Q, toggle).
  await ev(() => L.acts.lvstart({ dataset: { i: '2' } })); await p.waitForTimeout(100); await blank();
  await p.keyboard.down('4'); await p.waitForTimeout(300); const held = await ev(() => L.padActive('abbey', 'organ'));
  await p.keyboard.up('4'); await p.waitForTimeout(600);
  ok(held && !(await ev(() => L.padActive('abbey', 'organ'))), 'hold pad key 4 plays while held and stops on release');
  await p.keyboard.press('q'); await p.waitForTimeout(100);
  ok(await ev(() => L.padActive('abbey', 'choir')), 'toggle pad Q turns on');

  // Find a track: / focuses it, typing searches, pad keys are typed, Esc clears then closes; Shift+Esc fades all.
  await p.keyboard.press('/'); await p.waitForTimeout(100);
  ok((await ev(() => document.activeElement.dataset.k)) === 'lv-q', '/ focuses Find a track');
  await p.keyboard.type('bells'); await p.waitForTimeout(100);
  ok(/found/.test(await ev(() => document.querySelector('.lv-off-count').textContent)), 'typing searches');
  await p.keyboard.press('q'); await p.waitForTimeout(50);
  ok(await ev(() => L.padActive('abbey', 'choir')), 'pad keys are typed in the field (the choir stays on)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(50);
  ok((await ev(() => document.querySelector('[data-k="lv-q"]').value)) === '', 'Esc in the field clears it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(50);
  ok(await ev(() => !document.querySelector('.lv-found')), 'a second Esc closes the results');
  await blank(); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(await ev(() => !!L.pb.music), 'plain Esc does not fade');
  await p.keyboard.press('Shift+Escape'); await p.waitForTimeout(100);
  ok(await ev(() => !L.pb.music && !L.pb.amb), 'Shift+Esc fades all');

  // Play next and Add to queue (Nik, 6 Nov 12:14); Play next of the next planned track lists it once (review).
  await ev(() => L.acts.lvstart({ dataset: { i: '2' } })); await p.waitForTimeout(100);
  const shanty = 'Haunted sea shanty, grey and slow - the drowned bells';
  await p.getByRole('button', { name: 'Play next: ' + shanty, exact: true }).click(); await p.waitForTimeout(100);
  ok((await ev((t) => [...document.querySelectorAll('.lv-up-i')].filter((x) => x.textContent.indexOf(t) > -1).length, shanty)) === 1, 'Play next of the track the scene plays next lists it once in Up next');
  await p.getByRole('button', { name: 'Add to queue: The Abbess' }).click(); await p.waitForTimeout(100);
  ok(await ev(() => /The Abbess/.test([...document.querySelectorAll('.lv-up-i')].pop().textContent)), 'Add to queue goes to the bottom of Up next');
  await click('lv-next-music'); await p.waitForTimeout(100);
  ok(/Haunted sea shanty/.test(await ev(() => L.title(L.track(L.pb.music.id)))), 'Next plays the Play next track');
  ok(await ev(() => document.querySelectorAll('.lv-up-i').length > 1), 'Up next still lists what comes after it');
  await click('lv-nextsc'); await p.waitForTimeout(100);
  ok(await ev(() => !document.querySelector('.lv-up-i.added')), 'a new scene clears what was added (Nik, 6 Nov 13:55)');
  await blank(); await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
  ok(await ev(() => !!document.querySelector('.lv-up-i.added')), 'the scene\'s Undo brings it back');

  // Rows: Preview, Play next, Add to queue always shown, greyed at rest (Nik, 6 Nov 13:55).
  ok(await ev(() => [...document.querySelectorAll('[data-pane="lv-current"] .lv-trk:not(.on) .lv-hov')].every((x) => +getComputedStyle(x).opacity === 1)), 'row buttons show at rest');
  // Current scene: its music in order, the length that plays, details link to the scene's Audio profile, two boards.
  ok(await ev(() => document.querySelectorAll('[data-pane="lv-current"] .lv-items > li').length === 4), 'Current scene lists the scene\'s four items in order');
  ok(await ev(() => document.querySelector('[data-pane="lv-current"] .lv-items > li.lv-trk .lv-dur').textContent === '3:10'), 'a scene row shows the length that plays (3:10, not the file\'s 7:21)');
  await ev(() => document.querySelector('[data-pane="lv-current"] .lv-items > li .lv-trk-t').click()); await p.waitForTimeout(50);
  ok(await ev(() => { const a = document.querySelector('.lv-trk-d a.ap-link'); return !!a && a.getAttribute('href') === '#/profile/t13/sc:crown:s14:sc3'; }), 'details link to the Audio profile for this scene');
  ok(await ev(() => [...document.querySelectorAll('[data-pane="lv-current"] .lv-bseg button')].map((x) => x.textContent).join('|') === 'Drowned Abbey|Weather and places'), 'the scene\'s two pad boards are a switch');

  // Rooms: no room, the one-click fix, mute, volume by keyboard, a second room, To:, Kick; an empty channel (review).
  await ev(() => { L.botLeave('b1'); L.botLeave('b2'); }); await p.waitForTimeout(50);
  ok(await ev(() => /players hear nothing/.test(document.querySelector('.lv-noroom').textContent) && /Join Table/.test(document.querySelector('[data-k="lv-fix"]').textContent)), 'On air says No room with Join Table');
  await ev(() => document.querySelector('[data-pane="lv-current"] .lv-items [data-act="lvplay"]').click()); await p.waitForTimeout(100);
  ok(await ev(() => /no room/.test(document.querySelector('[data-pane="lv-current"] .dest.warn').textContent)), 'played with no room, the row on air says On air · no room in the warning style');
  await click('lv-fix'); await p.waitForTimeout(1300);
  ok(await ev(() => L.bot('b1').status === 'connected' && !document.querySelector('.lv-to')), 'one room: no To:');
  await click('lv-mute-b1'); await p.waitForTimeout(50);
  ok(await ev(() => L.bot('b1').muted && /Muted/.test(document.querySelector('.lv-rm .pane-status').textContent)), 'Mute: the room reads Muted');
  await click('lv-mute-b1'); await ev(() => document.querySelector('[data-k="lv-vol-b1"]').focus()); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(50);
  ok(await ev(() => L.bot('b1').volume === 80 && document.activeElement.dataset.k === 'lv-vol-b1'), 'the room volume works by keyboard and keeps focus');
  await click('lv-addroom'); await p.waitForTimeout(50);
  await ev(() => document.querySelector('.menu [data-act="lvaddjoin"][data-id="b2"][data-c="c2"]').click()); await p.waitForTimeout(1300);
  ok(await ev(() => { const r = document.querySelector('[data-room="b2"]'); return !!r && /Nobody there/.test(r.querySelector('.pane-status').textContent) && !/Move to/.test(r.textContent); }), 'a second room in an empty channel says Nobody there (no channel with players is free to move to)');
  // Part 6: Session playlists start folded; its To: shows once it is unfolded.
  await ev(() => { if (document.querySelector('[data-pane="lv-ssp"].collapsed')) document.querySelector('[data-k="pane-lv-ssp"]').click(); }); await p.waitForTimeout(50);
  ok(await ev(() => !!document.querySelector('[data-k="lv-to-music"]') && !!document.querySelector('[data-k="lv-to-ss"]')), 'two rooms: To: on Current scene and (unfolded) Session playlists');
  await click('lv-to-music'); await p.waitForTimeout(50);
  await ev(() => document.querySelector('.menu [data-act="lvtoset"][data-v="b2"]').click()); await p.waitForTimeout(50);
  ok(await ev(() => document.activeElement && document.activeElement.dataset.k === 'lv-to-music' && /Side room/.test(document.activeElement.textContent)), 'To: Side room; focus back on the chip');
  const tableMusic = await ev(() => L.pb.music && L.pb.music.id);
  await ev(() => document.querySelector('[data-pane="lv-current"] .lv-items [data-act="lvplay"]').click()); await p.waitForTimeout(50);
  ok(await ev((tm) => !!L.mix('b2').music && (L.pb.music && L.pb.music.id) === tm, tableMusic), 'Play on air from Current scene goes only to its room');
  await click('lv-kick-b2'); await p.waitForTimeout(100);
  ok(await ev(() => !document.querySelector('[data-room="b2"]') && !document.querySelector('.lv-to')), 'Kick takes the room away (and the To: choices)');
  await ev(() => L.acts.lvstart({ dataset: { i: '2' } })); await p.waitForTimeout(100);
  await click('lv-room-b1'); await p.waitForTimeout(50);
  ok(await ev(() => [...document.querySelectorAll('.menu [role=menuitemradio]')].some((x) => /Side room/.test(x.textContent) && /empty/.test(x.textContent)) && [...document.querySelectorAll('.menu [role=menuitemradio]')].some((x) => /Table/.test(x.textContent) && /players/.test(x.textContent))), 'the channel list marks where the players are and says empty');
  await ev(() => document.querySelector('.menu [data-act="lvbotjoin"][data-c="c2"]').click()); await p.waitForTimeout(1300);
  ok(await ev(() => /Nobody there/.test(document.querySelector('.lv-rm .pane-status').textContent) && !!document.querySelector('[data-k="lv-undo2"]') && /Move to Table/.test(document.querySelector('.lv-rm').textContent)), 'moving the bot to an empty channel: Nobody there, Move to Table, and Undo');
  await blank(); await p.keyboard.press('Control+z'); await p.waitForTimeout(1300);
  ok(await ev(() => L.bot('b1').channel === 'c1'), 'Ctrl+Z puts the bot back where the players are');

  // Session menu, standby, Live from another page.
  await click('lv-sess'); await p.waitForTimeout(50);
  await ev(() => document.querySelector('.menu [data-sid="w4"]').click()); await p.waitForTimeout(100);
  ok((await ev(() => L.state.live.cid + '/' + L.state.live.sid + ' ' + document.documentElement.dataset.theme)) === 'sixth/w4 candle', 'the session menu loads The Sixth Year, session 4, in its theme');
  await ev(() => L.liveStandby('masks', 'v7')); await ev(() => L.render()); await p.waitForTimeout(100);
  ok(await ev(() => L.state.live.cid === 'masks' && /^Start: Arrival/.test(document.querySelector('[data-k="lv-nextsc"]').textContent) && !document.querySelector('.lv-nowb') && !L.pb.music && !L.pb.amb), 'standby loads the session with nothing started');
  const p2 = await b.newPage({ viewport: { width: 960, height: 1000 } }); await p2.addInitScript(SET);
  await p2.goto(FILE + '#campaigns'); await p2.waitForTimeout(300);
  await p2.evaluate(() => { document.querySelector('#rail [data-k="rail-live"]').click(); }); await p2.waitForTimeout(300);
  ok(await p2.evaluate(() => !L.pb.music && /^Start: /.test(document.querySelector('[data-k="lv-nextsc"]').textContent)), 'Live opened from another page is on standby, nothing playing');
  ok(await p2.evaluate(() => !!document.querySelector('[data-pane="lv-ssp"].collapsed')), 'Session playlists start folded (part 6)');
  await p2.evaluate(() => document.querySelector('[data-k="pane-lv-ssp"]').click()); await p2.waitForTimeout(100);
  ok(await p2.evaluate(() => { const a = document.querySelector('[data-pane="lv-ssp"] .lv-trk-acts'); return !!a && [...a.querySelectorAll('button')].map((x) => x.getAttribute('aria-label').split(':')[0]).join('|') === 'Preview|Play next|Add to queue|Play on air'; }), 'a playlist row has Preview, Play next, Add to queue, Play on air');

  // Round 6, part 6 (Nik, 6 Nov 17:14).
  const p3 = await b.newPage({ viewport: { width: 1280, height: 800 } }); await p3.addInitScript(SET);
  p3.on('pageerror', (e) => errs.push(e.message)); p3.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p3.goto(FILE + '#/live'); await p3.waitForTimeout(400);
  const e3 = (f, a) => p3.evaluate(f, a);
  ok(await e3(() => document.querySelector('.lv-top button, .lv-top a, .lv-top input').dataset.k === 'nav-back'), 'Back is the first control in the top strip');
  ok(await e3(() => { const a = document.querySelector('[data-pane=lv-onair]').getBoundingClientRect(), s = document.querySelector('[data-pane=lv-scenes]').getBoundingClientRect(), t = document.querySelector('.lv-top').getBoundingClientRect(); return a.top >= t.bottom && a.bottom <= s.top; }), 'On air is under the top strip, above Scenes');
  await e3(() => document.body.focus()); await p3.keyboard.press('Alt+1'); await p3.waitForTimeout(50);
  const f6 = [await e3(() => document.activeElement.dataset.k)];
  for (let i = 0; i < 3; i++) { await p3.keyboard.press('F6'); await p3.waitForTimeout(50); f6.push(await e3(() => document.activeElement.dataset.k)); }
  ok(f6.join(' ') === 'pane-lv-onair pane-lv-scenes pane-lv-current pane-lv-ssp', 'Alt+1 is On air, then F6: Scenes, Current scene, Session playlists (' + f6.join(' ') + ')');
  const acts = (sel) => e3((sel) => [...document.querySelectorAll(sel)].map((r) => [...r.querySelectorAll(':scope > .lv-trk-r .lv-trk-acts button, :scope.lv-amb-r .lv-trk-acts button')].map((x) => x.getAttribute('aria-label').split(':')[0]).filter((n) => n !== 'Repeat one').join('|')), sel);
await e3(() => document.querySelector('[data-k="lv-scn-3"]').click()); await p3.waitForTimeout(100);
  const rowsIn = await acts('#lv-scb-3 .lv-items > li');
  ok(rowsIn.length === 4 && rowsIn.every((x) => x === 'Preview|Play next|Add to queue|Play on air'), 'an unfolded scene that is not running: every row has Preview, Play next, Add to queue, Play on air (' + rowsIn.join(' / ') + ')');
  ok((await acts('#lv-scb-3 .lv-amb-r')).join('') === 'Preview|Play next|Add to queue|Play on air', 'its ambience has the same buttons');
  const sc3 = await e3(() => L.state.live.scene);
  await e3(() => document.querySelector('#lv-scb-3 .lv-items > li.lv-trk [data-act=lvplay]').click()); await p3.waitForTimeout(100);
  ok(await e3((s) => L.state.live.scene === s && L.pb.music.id === 't39' && !!document.querySelector('#lv-scb-3 .lv-items > li.lv-trk.on'), sc3), 'Play on air there plays the track (marked on air) and the scene does not start');
  await e3(() => document.querySelector('#lv-scb-3 .lv-amb-r [data-act=lvplaynext]').click()); await p3.waitForTimeout(100);
  ok(await e3(() => [...document.querySelectorAll('.lv-up-i.amb')].some((x) => /Ambience next:/.test(x.textContent))), 'Play next on an ambience waits in Up next as Ambience next');
  await e3(() => document.querySelector('[data-k="lv-next-amb"]').click()); await p3.waitForTimeout(100);
  ok(await e3(() => L.pb.amb && L.pb.amb.id === 'b02' && !document.querySelector('.lv-up-i.amb')), 'Next on the ambience plays it');
  for (let i = 0; i < 4; i++) await e3((i) => document.querySelectorAll('[data-pane=lv-current] .lv-items [data-act=lvqueue]')[i % 2].click(), i);
  await p3.waitForTimeout(100);
  ok(await e3(() => document.querySelectorAll('.lv-up ol > li').length === 1 && /\d+ more/.test(document.querySelector('.lv-up ol > li').textContent)), 'a long Up next folds to one line with "n more"');
  await p3.keyboard.press('/'); await p3.keyboard.type('abbess'); await p3.waitForTimeout(150);
  ok(await e3(() => { const h = [...document.querySelectorAll('.lv-found .lv-found-h')].map((x) => x.textContent); return h.join('|') === 'Playlists|Tracks' && document.querySelector('[data-k="lv-q"]').placeholder === 'Find a track or playlist'; }), 'Find a track or playlist: Playlists, then Tracks');
  ok((await acts('.lv-found ol[aria-labelledby=lv-found-p] > li'))[0] === 'Preview|Play next|Add to queue|Play on air', 'a playlist found has the row buttons');

  console.log(errs.length ? errs : 'no errors'); await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
