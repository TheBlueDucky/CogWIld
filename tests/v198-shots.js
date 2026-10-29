// Muted screenshots of what changed in v1.9.8 (hidden window, local test server on 8781): Settings (Display with a
// pointer on the fullscreen row / a drop-down, Voice chat's ringtone list, Account's hidden email, Keybinds), the lobby,
// Settings and a match in the normal and the glass look, the call card (dragged). Saves tests/shots/v198-*.png.
// SIZE=1280x720 (default)   SHOTS=settings,lobby,hud,call (default: all)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);
const ONLY = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: 's198' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const errors = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { await wait(450); fs.writeFileSync(path.join(shots, `v198-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  const hover = async (sel, dx = 0.5) => {
    const p = await js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width * ${dx}, y: r.top + r.height / 2 }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) });
    await wait(250);
  };
  const glass = (on) => js(`(() => { const g = ${G}; g.settings.glass = ${on}; g.applySettings(); return true; })()`);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);
  const me = 'Gl' + Math.floor(Math.random() * 1000);
  await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${me}', pass: 'shotpass1' }))`);
  await wait(2500);
  const tab = async (t) => { await js(`${G}.meta.setTab = '${t}'; ${G}.meta.openPanel('settings'); true`); await wait(500); };
  if (want('settings')) {
    await tab('display');
    await hover('#setFull', -0.6);
    await shot('display-hover-row');
    await hover('#setGfx');
    await shot('display-hover-select');
    await js(`document.getElementById('setGfx').focus(); true`);
    await shot('display-focus-select');
    await js(`document.querySelector('.set-main').scrollTop = 9999; true`);
    await shot('display-end');
    await tab('voice');
    await js(`document.querySelector('.set-main').scrollTop = 9999; true`);
    await js(`${G}.calls.preview('marimba'); true`);
    await shot('voice-calls');
    await js(`${G}.calls.stopPreview(); true`);
    await js(`(() => { const a = ${G}.account; a.myEmail = 'tomertest@gmail.com'; a.loginOpts = Object.assign({}, a.loginOpts, { email: true }); return true; })()`);
    await tab('account');
    await shot('account');
    await tab('keys');
    await shot('keys');
    await tab('controls');
    await shot('controls');
    await js(`${G}.meta.closePanel(); true`);
  }
  if (want('lobby')) {
    await glass(false);
    await shot('lobby');
    await glass(true);
    await shot('lobby-glass');
    await tab('display');
    await shot('settings-glass');
    await js(`${G}.meta.closePanel(); true`);
    await glass(false);
  }
  if (want('call')) {
    for (const g of [false, true]) {
      await glass(g);
      await js(`(() => { const c = ${G}.calls; c.pos = null; c.call = { state: 'live', name: 'Ann', av: 2, since: Date.now() - 42000 }; c.show(c.call); return true; })()`);
      await shot('call' + (g ? '-glass' : ''));
    }
    // drag it by its name
    const p = await js(`(() => { const r = document.querySelector('#callCard .cc-txt').getBoundingClientRect(); return { x: Math.round(r.left + 10), y: Math.round(r.top + 8) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x - i * 40, y: p.y + i * 30, button: 'left' }); await wait(30); }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x - 400, y: p.y + 300, button: 'left', clickCount: 1 });
    await shot('call-moved');
    await js(`${G}.calls.show(null); ${G}.calls.call = null; true`);
    await glass(false);
  }
  if (want('hud')) {
    await js(`${G}.playOffline('clash', 'canyon'); true`);
    await wait(6000);
    for (const [g, box] of [[false, null], [false, 1], [true, null], [true, 0.5], [true, 0]]) {
      await js(`(() => { const s = ${G}.settings; s.glass = ${g}; s.hudBox = ${box}; ${G}.applySettings(); return true; })()`);
      await shot(`hud-${g ? 'glass' : 'plain'}-${box == null ? 'default' : Math.round(box * 100)}`);
    }
    await js(`${G}.showMenu(); true`);
  }
  console.log('ERRORS', JSON.stringify(errors));
  app.exit(0);
});
