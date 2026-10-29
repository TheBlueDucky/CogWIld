// The desktop app's small bridge between the game page and the app (contextIsolation stays on): the game tells the
// app what you're doing for the Discord status (desktop/discord.js), Settings › Toggle fullscreen flips the window's
// fullscreen, Settings › Frame rate limit turns VSync on or off (restart), and clips / replay files are saved into
// Documents\Cogwild\Clips or Replays (and 📂 opens those folders). Nothing else is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('CogwildDesktop', {
  fullscreen: () => ipcRenderer.send('fullscreen'), // Settings › Toggle fullscreen (same as F11)
  vsync: (on) => ipcRenderer.send('vsync', !!on), // used from the next start
  restart: () => ipcRenderer.send('restart'),
  // kind: 'clips' | 'replays'; resolves to where the file went
  saveFile: (kind, name, bytes) => ipcRenderer.invoke('saveFile', String(kind), String(name), bytes),
  openFolder: (kind) => ipcRenderer.invoke('openFolder', String(kind)),
  presence: (info) => ipcRenderer.send('presence', {
    hidden: !!(info && info.hidden), // Settings › Online: don't show Cogwild on Discord
    details: String((info && info.details) || '').slice(0, 120),
    state: String((info && info.state) || '').slice(0, 120),
    since: +(info && info.since) || 0,
  }),
});
