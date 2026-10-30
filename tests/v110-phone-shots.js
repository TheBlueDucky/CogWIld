// Muted phone-size screenshots of v1.10 (hidden window, touch controls on): the PLAY loadout, and a match next to a chest
// (the 🎁 hold button and 📍 ping). Saves tests/shots/v110-phone-*.png. SIZE=915x412 (default)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '915x412').split('x').map(Number);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: 'p110' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(shots, `v110-phone-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'on', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`${G}.meta.openPanel('arenas'); true`);
  await wait(600);
  await js(`(() => { const h = [...document.querySelectorAll('#panel h3')].find((x) => /Loadout/.test(x.textContent)); h.scrollIntoView(); return true; })()`);
  await shot('loadout');
  await js(`${G}.meta.closePanel(); ${G}.playOffline('clash', 'canyon'); true`);
  await wait(5000);
  await js(`(() => { const g = ${G}, m = g.player.mech; const fwd = new THREE.Vector3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)); g.chests.spawn(m.pos.clone().addScaledVector(fwd, m.radius + 2), 'rare'); g.cam.yaw = m.yaw; return true; })()`);
  await wait(1200);
  await shot('chest');
  app.exit(0);
});
