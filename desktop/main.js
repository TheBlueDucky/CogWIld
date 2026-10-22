// Cogwild desktop wrapper: opens the web game in its own window (for a Windows / Steam build)
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// it's a game: music may start the moment it opens, without waiting for a click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b1024',
    title: 'Cogwild',
    autoHideMenuBar: true,
    // backgroundThrottling off: the game (and its music) keep going while the window is minimized
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  // links (privacy, terms, download page) open in the player's own browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // F11 toggles fullscreen like most PC games
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

// COGWILD_SMOKE=1: hidden self-check of a built app (loads the game, connects online, prints, quits)
async function smoke() {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 });
  win.webContents.setAudioMuted(true); // a check must never play sound on the PC it runs on
  await win.loadFile(path.join(__dirname, 'app', 'index.html'));
  await new Promise((r) => setTimeout(r, 4000));
  const res = await win.webContents.executeJavaScript('(async () => { const g = window.game || CW.game; await g.net.connect(); return { version: CW.VERSION, app: CW.APP, online: g.net.status, state: g.state, music: g.music.theme, sound: g.audio.ctx && g.audio.ctx.state }; })()').catch((e) => ({ error: e.message }));
  console.log('COGWILD_SMOKE ' + JSON.stringify(res));
  app.exit(res.online === 'online' ? 0 : 1);
}

app.whenReady().then(process.env.COGWILD_SMOKE ? smoke : createWindow);
app.on('window-all-closed', () => app.quit());
