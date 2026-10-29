// Muted screenshots of v1.9.9 (hidden window, local test server on 8781): Settings › Display (Background opacity, Glass
// Look), Settings in the glass look, and the lobby / a match at Background opacity 0% and the default, in both looks.
// Saves tests/shots/v199-*.png. SIZE=1280x720 (default)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: 's199' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(shots, `v199-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  const set = (glass, box) => js(`(() => { const g = ${G}; g.settings.glass = ${glass}; g.settings.hudBox = ${box}; g.applySettings(); return true; })()`);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);
  await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: 'Op' + Math.floor(Math.random() * 1e4), pass: 'shotpass1' }))`);
  await wait(2500);
  await js(`${G}.meta.setTab = 'display'; ${G}.meta.openPanel('settings'); true`);
  await shot('display');
  await set(true, null);
  await js(`${G}.meta.renderPanel(); true`);
  await shot('display-glass');
  await js(`${G}.meta.closePanel(); true`);
  for (const [g, box] of [[false, 0], [true, 0], [true, null]]) { await set(g, box); await shot(`lobby-${g ? 'glass' : 'plain'}-${box == null ? 'default' : box * 100}`); }
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(5500);
  for (const [g, box] of [[false, 0], [true, 0]]) { await set(g, box); await shot(`hud-${g ? 'glass' : 'plain'}-${box * 100}`); }
  await js(`${G}.showMenu(); true`);
  app.exit(0);
});
