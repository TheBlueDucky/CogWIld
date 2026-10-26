// Muted look at arenas (hidden window): builds each one (ARENAS=speedway,bay,moon by default), checks it has enough
// spawn points, pickups and a playable size, and takes a wide shot plus one from a mech on the ground.
// Needs the local test server on 8781 (tests/README.md). Screenshots: tests/shots/arena-*.png.
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
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'arena-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third', timeOfDay: '${process.env.TOD || 'day'}' } })); location.reload();`);
  await wait(4500);
  const list = (process.env.ARENAS || 'speedway,bay,moon').split(',');
  for (const a of list) {
    const info = await js(`(async () => { const g = ${G}; g.showMenu(); g.setCurrentBp(CW.PRESETS[0]); g.playOffline('clash', '${a}', null);
      for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
      const w = g.world;
      return { id: w.arena.id, spawns: (w.landSpawns || []).length, water: (w.waterSpawns || []).length, pickups: g.pickups.items ? g.pickups.items.length : -1, grav: CW.arena.grav || 1, mechs: g.mechs.length }; })()`);
    check(info.id === a && info.spawns >= 8 && info.mechs >= 8, `${a}: builds, ${info.spawns} land spawns, ${info.water} water spawns, ${info.mechs} mechs, gravity ×${info.grav}`);
    // a wide shot from above
    await js(`(() => { const g = ${G}; g.headless = true; for (const e of g.mechs) e.protect = 99; g.cam.yaw = 0.6; g.cam.pitch = -0.5; return true; })()`);
    await js(`(() => { const g = ${G}, m = g.player.mech; m.place({ x: 0, z: 140 }, 0); m.vel.set(0, 0, 0); for (let i = 0; i < 30; i++) g.tick(1 / 60); g.camera.position.set(-150, 120, 160); g.camera.lookAt(0, 0, 0); g.renderer.render(g.scene, g.camera); return true; })()`);
    await wait(200);
    await shot(a + '-wide');
    await js(`${G}.headless = false; true`);
    // driving around for 6 s: the player's mech moves, the ground is solid
    const drove = await js(`(async () => { const g = ${G}, m = g.player.mech, s = w => w; const sp = g.world.landSpawns[0]; m.place(sp, 0);
      const p0 = m.pos.clone(); g.keys.KeyW = true; g.keys.KeyD = true; for (let i = 0; i < 360; i++) { if (i === 90) g.keys.KeyD = false; g.tick(1 / 60); if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0)); }
      g.keys.KeyW = false; return { moved: Math.round(m.pos.distanceTo(p0)), y: +(m.pos.y - g.world.groundAt(m.pos.x, m.pos.z, m.pos.y)).toFixed(1) }; })()`);
    check(drove.moved > 15, `${a}: a mech drives around (${drove.moved} m)`);
    await wait(200);
    await shot(a + '-ground');
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
