// The desktop app's small bridge between the game page and the app (contextIsolation stays on): the game tells the
// app what you're doing for the Discord status (desktop/discord.js), and Settings › Toggle fullscreen flips the window's
// fullscreen. Nothing else is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CogwildDesktop', {
  fullscreen: () => ipcRenderer.send('fullscreen'), // Settings › Toggle fullscreen (same as F11)
  presence: (info) => ipcRenderer.send('presence', {
    details: String((info && info.details) || '').slice(0, 120),
    state: String((info && info.state) || '').slice(0, 120),
    since: +(info && info.since) || 0,
  }),
});
