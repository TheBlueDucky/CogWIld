// Muted check: pointing at a settings row turns its text blue (no outline box); pointing away turns it back.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'hv' + Date.now() } });
  win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win); // not a voice chat test
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 500, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
  await wait(4000);
  await js(`(window.game || CW.game).meta.openPanel('settings'); document.querySelector('[data-settab="display"]').click(); true`);
  await wait(600);
  const look = () => js(`(() => { const row = document.getElementById('setShake').closest('label'); const sp = row.querySelector('span'); const cs = getComputedStyle(row); return { text: getComputedStyle(sp).color, outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);
  const box = await js(`(() => { const r = document.getElementById('setShake').closest('label').getBoundingClientRect(); return { x: r.left + 120, y: r.top + r.height / 2 }; })()`);
  const before = await look();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x), y: Math.round(box.y) });
  await wait(300);
  const over = await look();
  fs.writeFileSync(path.join(__dirname, 'shots', 'settings-hover.png'), (await win.webContents.capturePage()).toPNG());
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await wait(300);
  const after = await look();
  console.log('BEFORE', JSON.stringify(before), '\nHOVER', JSON.stringify(over), '\nAFTER', JSON.stringify(after));
  app.exit(0);
});
