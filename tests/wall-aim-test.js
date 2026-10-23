// Muted checks: (1) a mech hopping into a cliff doesn't end up on top of it; (2) touch aim assist turns toward
// an enemy near the crosshair; (3) the third-person camera stays in front of a cliff behind the mech.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1100, height: 620, webPreferences: { offscreen: true, partition: 'w' + Date.now() } });
  win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win); // not a voice chat test
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errors.push(msg); });
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, touch: 'on', camMode: 'third' } })); location.reload();`);
  await wait(4000);
  const r = await js(`(async () => {
    const g = window.game || CW.game;
    g.playOffline('clash', 'desert');
    for (let i = 0; i < 90; i++) g.tick(0.05); // past the countdown
    const w = g.world, m = g.player.mech;
    // find a cliff: ground 6+ m higher 3 m east of a flat spot
    let spot = null;
    for (let x = -150; x < 150 && !spot; x += 2) for (let z = -150; z < 150 && !spot; z += 2) {
      const h = w.groundAt(x, z), h2 = w.groundAt(x + 3, z);
      if (h > 2 && h2 - h > 6 && Math.abs(w.groundAt(x - 3, z) - h) < 0.5) spot = { x, z, h, top: h2 };
    }
    if (!spot) return { err: 'no cliff found' };
    for (const c of g.combatants) if (!c.isPlayer && c.mech) c.mech.place(new THREE.Vector3(140, 0, 140), 0);
    m.place(new THREE.Vector3(spot.x - 2, 0, spot.z), -Math.PI / 2); // facing +x, toward the cliff
    m.vel.set(25, 4, 0); // a fast hop into the wall
    const y0 = m.pos.y;
    let maxY = -1e9;
    for (let i = 0; i < 40; i++) { g.keys.KeyW = true; g.tick(0.05); maxY = Math.max(maxY, m.pos.y); }
    g.keys.KeyW = false;
    const wall = { startY: Math.round(y0), maxY: Math.round(maxY), cliffTop: Math.round(spot.top + m.baseOff), xAfter: Math.round(m.pos.x - spot.x), onTop: m.pos.y > spot.top + m.baseOff - 0.5 };
    // camera: look from the cliff side (camera would be inside the cliff)
    g.cam.yaw = Math.PI / 2; g.cam.pitch = -0.1;
    for (let i = 0; i < 20; i++) g.tick(0.05);
    const cp = g.cam.pos;
    const cam = { camAboveGround: cp.y > w.groundAt(cp.x, cp.z) + 0.3 };
    // aim assist: an enemy 25 m away, 6 degrees off the crosshair
    const foe = g.combatants.find((c) => !c.isPlayer && c.mech && c.alive);
    m.place(new THREE.Vector3(0, 0, 0).setX(spot.x - 30), -Math.PI / 2);
    g.cam.yaw = -Math.PI / 2; g.cam.pitch = 0;
    for (let i = 0; i < 4; i++) g.tick(0.05);
    const fp = m.pos.clone(); const dir = new THREE.Vector3(-Math.sin(g.cam.yaw + 0.1), 0, -Math.cos(g.cam.yaw + 0.1));
    foe.mech.place(fp.clone().addScaledVector(dir, 25), 0);
    foe.ai.style = 'dummy';
    const yaw0 = g.cam.yaw;
    for (let i = 0; i < 20; i++) g.tick(0.05);
    return { wall, cam, aim: { turnedToward: Math.round((g.cam.yaw - yaw0) * 1000) / 1000, wanted: 0.1 } };
  })()`);
  console.log(JSON.stringify(r));
  console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
  app.exit(0);
});
