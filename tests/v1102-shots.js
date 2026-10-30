// Muted screenshots of v1.10.2 (hidden window, local test server on 8781): the stadium's glass walls, a mech flipped over,
// a flip in the air in Mech Ball, and the chat panel following the opacity slider. Saves tests/shots/v1102-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 's1102' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, ms = 300) => { await wait(ms); fs.writeFileSync(path.join(shots, `v1102-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third', timeOfDay: 'day', mouseSteer: false } })); location.reload(); true`);
  await wait(4500);
  await js(`${G}.playOffline('ball'); true`);
  await wait(3000);
  await js(`(async () => { const g = ${G}; while (g.countdown > 0) await new Promise((r) => setTimeout(r, 100)); for (const c of g.combatants) if (!c.isPlayer && c.mech) { c.ai.style = 'dummy'; c.mech.place({ x: -60, z: -40 }, 0); } const m = g.player.mech; m.place({ x: 20, z: CW.STADIUM.W - 22 }, Math.PI * 0.75); g.cam.yaw = Math.PI * 0.75 - 0.2; g.cam.pitch = 0.05; return true; })()`);
  await shot('glass', 1500);
  // a flip in the air next to the ball
  await js(`(() => { const g = ${G}, m = g.player.mech, o = g.obj; m.place({ x: 0, z: 10 }, Math.PI); g.cam.yaw = Math.PI + 0.5; g.cam.pitch = -0.05; o.freeze = 0; o.pos.set(0, CW.STADIUM.y + 8, -2); o.vel.set(0, 3, 0); m.vel.set(0, 0, 0); g.pressed.Space = true; return true; })()`);
  await wait(250);
  await js(`(() => { const g = ${G}; g.pressed.Space = true; g.keys.KeyW = true; setTimeout(() => (g.keys.KeyW = false), 200); return true; })()`);
  await shot('flip', 250);
  // flipped over on its back
  await js(`(() => { const g = ${G}, m = g.player.mech; m.place({ x: -20, z: 0 }, 0.6); m.pos.y += 2; m.airR = 3; m.spinR = 0.4; g.cam.yaw = 0.2; g.cam.pitch = -0.15; return true; })()`);
  await shot('over', 1200);
  // the chat panel at the default background (see-through like the menu buttons)
  await js(`${G}.showMenu(); ${G}.talk.open('friends'); true`);
  await shot('chat', 1200);
  app.exit(0);
});
