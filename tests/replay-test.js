// Muted check of match replays (hidden window): a match is recorded and kept (also when you leave early), shows in
// 🎬 Replays, plays back (mechs move, shots fly, parts break, the timeline and speed work, follow/orbit/free cameras),
// can be starred and deleted, and Esc goes back to the menu. Also the results screen's 🎬 Replay button.
// Needs the local test server on 8781 (tests/README.md). Screenshots: tests/shots/replay-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'replay-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(150); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); indexedDB.deleteDatabase('cogwild-replays'); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, replays: true, music: 0, sfx: 0, volume: 0, camMode: 'third', timeOfDay: 'day' } })); location.reload();`);
  await wait(4500);

  // ---- a 45 s match, sped up; then leave it (kept: long enough) ----
  const played = await js(`(async () => { const g = ${G}; g.headless = true; g.showMenu(); g.setCurrentBp(CW.PRESETS[0]); g.playOffline('clash', 'canyon', null);
    for (let i = 0; i < 45 * 30 && g.state === 'match'; i++) { g.keys.KeyW = i % 200 < 150; g.mouse.left = i % 60 < 30; g.tick(1 / 30); if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.keys.KeyW = false; g.mouse.left = false;
    const wrecks = g.combatants.reduce((s, c) => s + c.wrecks, 0);
    g.headless = false; g.showMenu(); const id = await g.lastReplay; return { id, wrecks }; })()`);
  check(!!played.id, `leaving after 45 s keeps the replay (${played.id}, ${played.wrecks} wrecks in it)`);

  // ---- the list ----
  await js(`${G}.meta.openPanel('replays'); true`);
  await wait(800);
  const list = await js(`(() => ({ rows: document.querySelectorAll('.rp-row').length, text: (document.querySelector('.rp-row') || {}).innerText || '' }))()`);
  check(list.rows === 1 && /Workshop Clash/.test(list.text) && /Left the match/.test(list.text), `🎬 Replays lists it: ${list.text.replace(/\s+/g, ' ').slice(0, 90)}`);
  await shot('list');
  // star it
  await js(`document.querySelector('[data-star]').click(); true`);
  await wait(600);
  check(await js(`!!document.querySelector('.rp-row.star')`), '☆ keeps it for good');

  // ---- watch ----
  await js(`document.querySelector('[data-watch]').click(); true`);
  await wait(1500);
  const v = await js(`(() => { const g = ${G}, r = g.replays; return { state: g.state, on: r.on, mechs: r.mechs.length, shown: r.mechs.filter((m) => m.shown).length, dur: Math.round(r.dur), ui: !document.getElementById('replayUi').classList.contains('hidden') }; })()`);
  check(v.state === 'replay' && v.on && v.ui && v.mechs >= 8 && v.shown >= 6, `the replay plays: ${v.mechs} mechs (${v.shown} on screen), ${v.dur} s long`);
  // play a few seconds at 2x: mechs move, shots fly
  await js(`(() => { const g = ${G}; g.replays.seek(15); document.getElementById('rpSpeed').click(); return true; })()`);
  const p0 = await js(`${G}.replays.mechs.map((m) => m.pos.toArray())`);
  const t0 = await js(`${G}.replays.t`);
  await wait(2500);
  const mv = await js(`(() => { const r = ${G}.replays; return { t: r.t, speed: r.speed, shots: ${G}.fx.projectiles.length, moved: r.mechs.filter((m, i) => m.shown && m.pos.distanceTo(new THREE.Vector3(...${JSON.stringify(p0)}[i])) > 1).length }; })()`);
  check(mv.speed === 2 && mv.t - t0 > 3 && mv.moved >= 3, `2× speed: ${(mv.t - t0).toFixed(1)} s of match in 2.5 s, ${mv.moved} mechs moved, ${mv.shots} shots in the air`);
  await shot('follow');
  // the timeline: jump to the end and back
  await js(`(() => { const s = document.getElementById('rpSeek'); s.value = 900; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); return true; })()`);
  await wait(300);
  const jumped = await js(`${G}.replays.t / ${G}.replays.dur`);
  check(jumped > 0.85 && jumped < 0.95, `dragging the timeline jumps to ${(jumped * 100).toFixed(0)}%`);
  await key('Left');
  const back = await js(`${G}.replays.t / ${G}.replays.dur`);
  check(back < jumped, '← jumps back');
  // cameras
  await key('C');
  check(await js(`${G}.replays.camMode === 'orbit'`), 'C: orbit camera');
  await wait(400);
  await shot('orbit');
  await key('C');
  check(await js(`${G}.replays.camMode === 'free'`), 'C: free camera');
  const c0 = await js(`${G}.camera.position.toArray()`);
  await js(`${G}.keys.KeyW = true; true`);
  await wait(600);
  await js(`${G}.keys.KeyW = false; true`);
  const c1 = await js(`${G}.camera.position.toArray()`);
  check(Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) > 3, 'W flies the free camera');
  await key('C');
  await key('Tab');
  check(await js(`${G}.replays.camMode === 'follow' && ${G}.replays.follow !== 0`), 'Tab follows the next mech');
  await js(`(() => { const r = ${G}.replays; r.seek(r.dur * 0.3); r.playing = true; return true; })()`);
  await key('Space');
  const paused = await js(`${G}.replays.playing === false`);
  const tp = await js(`${G}.replays.t`);
  await wait(500);
  check(paused && (await js(`${G}.replays.t`)) === tp, 'Space pauses');
  await key('H');
  check(await js(`document.getElementById('replayUi').classList.contains('rp-hidden')`), 'H hides the controls');
  await shot('clean');
  await key('H');
  // phone size
  win.setContentSize(915, 412);
  await wait(500);
  await shot('phone');
  win.setContentSize(1280, 720);
  await key('Escape');
  await wait(400);
  check(await js(`${G}.state === 'menu' && document.getElementById('replayUi').classList.contains('hidden')`), 'Esc goes back to the menu');

  // ---- a finished match: the results screen's 🎬 Replay ----
  const fin = await js(`(async () => { const g = ${G}; g.headless = true; g.showMenu(); g.playOffline('clash', 'speedway', null);
    for (let i = 0; i < 20 * 30 && g.state === 'match'; i++) { g.tick(1 / 30); if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0)); }
    // everyone else is wrecked: the match ends
    for (let k = 0; k < 600 && g.state === 'match'; k++) {
      for (const c of g.combatants) if (c !== g.player && c.alive) { if (c.mech && c.mech.alive) c.mech.destroy(g.player); if (c.pilot && c.pilot.alive) c.pilot.die(g.player); c.lives = 0; }
      g.tick(1 / 30); if (k % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    g.headless = false; return { state: g.state, title: document.getElementById('resTitle').textContent }; })()`);
  await wait(800);
  check(fin.state === 'results', `the match ends on the results screen (${fin.title})`);
  await js(`document.getElementById('resReplay').click(); true`);
  await wait(1500);
  const r2 = await js(`(() => { const g = ${G}; return { state: g.state, arena: g.world.arena.id, sub: document.getElementById('rpSub').textContent }; })()`);
  check(r2.state === 'replay' && r2.arena === 'speedway' && /Victory/.test(r2.sub), `🎬 Replay on the results screen opens it: ${r2.sub}`);
  await shot('results-replay');
  await key('Escape');
  // delete (two taps)
  await js(`${G}.meta.openPanel('replays'); true`);
  await wait(800);
  const before = await js(`document.querySelectorAll('.rp-row').length`);
  await js(`(() => { const b = document.querySelectorAll('[data-del]')[0]; b.click(); b.click(); return true; })()`);
  await wait(800);
  const after = await js(`document.querySelectorAll('.rp-row').length`);
  check(before === 2 && after === 1, `delete (tap twice): ${before} → ${after}`);

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
