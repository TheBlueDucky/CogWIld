// Cogwild desktop wrapper: opens the web game in its own window (for a Windows / Steam build)
const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const path = require('path');
const discord = require('./discord'); // the "Playing Cogwild" status on Discord

// it's a game: music may start the moment it opens, without waiting for a click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Linux: many distributions block Chromium's sandbox helper for apps run from a folder; the game only shows its own
// files and talks to its own server, so it runs without it (like most Linux games built this way)
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

// the title bar (v1.9.4): no white Windows bar; the game draws a dark one of its own (js/desktop.js) and Windows/Linux
// draw only the ─ □ ✕ buttons on top of it, in the game's colors. A Mac keeps its three buttons at the top left.
const BAR = 32;
const MAC = process.platform === 'darwin';

// what the game may use: the microphone for voice chat, fullscreen, holding the mouse and copying text. Never the
// camera or the location (Windows would otherwise ask the player about them)
function permissions() {
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'speaker-selection']);
  const ok = (permission, types) => {
    if (permission === 'media') return !(types || []).some((t) => t !== 'audio');
    return allowed.has(permission);
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => done(ok(permission, details && details.mediaTypes)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (permission === 'media') return !details || !details.mediaType || details.mediaType === 'audio';
    return permission !== 'geolocation' && permission !== 'camera';
  });
}

function createWindow() {
  permissions();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b1024',
    title: 'Cogwild',
    autoHideMenuBar: true,
    ...(MAC ? { titleBarStyle: 'hiddenInset' } : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d1430', symbolColor: '#9fb3d9', height: BAR } }),
    // backgroundThrottling off: the game (and its music) keep going while the window is minimized
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, 'app', 'img', 'icon-512.png') } : {}),
  });
  // no menu bar, except on a Mac: there the app menu gives Cmd+Q and the edit menu makes copy/paste work in text boxes
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  // links (privacy, terms, download page, support) open in the player's own browser, never inside the game window;
  // the Store version can open the Microsoft Store for updates
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https:\/\/|mailto:|ms-windows-store:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // the Microsoft Store copy tells the game so (updates come from the Store, not the download page)
  win.loadFile(path.join(__dirname, 'app', 'index.html'), process.windowsStore ? { query: { store: '1' } } : undefined);
  // the game's own title bar: shown in a window, hidden in fullscreen
  const bar = () => win.webContents.executeJavaScript(`window.CW && CW.titleBar && CW.titleBar(${win.isFullScreen() ? 0 : MAC ? 28 : BAR}, ${MAC})`).catch(() => {});
  win.webContents.on('did-finish-load', bar);
  for (const ev of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen']) win.on(ev, () => setTimeout(bar, 50));
  // F11 toggles fullscreen like most PC games
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

// the game says what you're doing (js/desktop.js → preload.js); Discord shows it
ipcMain.on('presence', (e, info) => discord.set(info));

// COGWILD_SMOKE=1: hidden self-check of a built app (loads the game, connects online, prints, quits)
async function smoke() {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.webContents.setAudioMuted(true); // a check must never play sound on the PC it runs on
  await win.loadFile(path.join(__dirname, 'app', 'index.html'));
  await new Promise((r) => setTimeout(r, 4000));
  const res = await win.webContents.executeJavaScript('(async () => { const g = window.game || CW.game; await g.net.connect(); return { version: CW.VERSION, app: CW.APP, online: g.net.status, state: g.state, music: g.music.theme, sound: g.audio.ctx && g.audio.ctx.state, desktop: !!window.CogwildDesktop }; })()').catch((e) => ({ error: e.message }));
  console.log('COGWILD_SMOKE ' + JSON.stringify(res));
  app.exit(res.online === 'online' ? 0 : 1);
}

app.whenReady().then(process.env.COGWILD_SMOKE ? smoke : createWindow);
app.on('window-all-closed', () => { discord.stop(); app.quit(); });
