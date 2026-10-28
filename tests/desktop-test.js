// Muted check of the desktop app's window parts (hidden window, local test server on 8781): the preload bridge
// (CogwildDesktop), the game's own title bar (CW.titleBar, as desktop/main.js calls it), the Discord status reaching
// the app, and the permission rules (location and camera always "denied"; checked without touching any device).
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  // the same permission rules as desktop/main.js
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => done(permission === 'media' ? !((details && details.mediaTypes) || []).some((t) => t !== 'audio') : allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => (permission === 'media' ? !details || !details.mediaType || details.mediaType === 'audio' : permission !== 'geolocation' && permission !== 'camera'));
  const said = [];
  ipcMain.on('presence', (e, info) => said.push(info));
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d1430', symbolColor: '#9fb3d9', height: 32 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '..', 'desktop', 'preload.js') } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const errors = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0 } })); location.reload(); true`);
  await wait(4500);
  check(await js(`typeof window.CogwildDesktop === 'object' && typeof window.CogwildDesktop.presence === 'function' && typeof window.require === 'undefined'`), 'the page gets only the small CogwildDesktop bridge (no Node)');
  await js(`CW.titleBar(32, false); true`);
  await wait(300);
  const tb = await js(`({ cls: document.documentElement.classList.contains('tbar'), top: document.getElementById('app').getBoundingClientRect().top, h: ${G}.view.h, canvas: ${G}.renderer.domElement.getBoundingClientRect().height, name: document.getElementById('titleBar').textContent })`);
  check(tb.cls && tb.top === 32 && Math.abs(tb.canvas - tb.h) < 1 && /Cogwild/.test(tb.name), `the dark title bar with the name; the game fits under it (${JSON.stringify(tb)})`);
  await wait(3500);
  check(said.length >= 1 && said[said.length - 1].details === 'In the menu', `Discord hears what you're doing: "${said.length ? said[said.length - 1].details : ''}"`);
  await js(`${G}.openWorkshop(); true`);
  await wait(3500);
  check(said.length && said[said.length - 1].details === 'Building a mech in the Workshop', `…and when it changes: "${said.length ? said[said.length - 1].details : ''}"`);
  await js(`${G}.showMenu(); true`);
  const perms = await js(`Promise.all(['geolocation', 'camera', 'microphone'].map((n) => navigator.permissions.query({ name: n }).then((p) => p.state, () => 'error')))`);
  check(perms[0] === 'denied' && perms[1] === 'denied' && perms[2] !== 'denied', `location and camera are always denied, the microphone isn't (${perms.join(', ')})`);
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
