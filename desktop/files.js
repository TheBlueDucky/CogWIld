// Clips (F8) and replay files from the game (v1.9.8): saved straight into <root>\Clips or <root>\Replays (the app uses
// Documents\Cogwild), no "Save as" window; 📂 in the game opens the folder. Only .webm / .mp4 / .cwreplay files, only
// those two folders, plain file names.
const fs = require('fs');
const path = require('path');

const FOLDERS = { clips: 'Clips', replays: 'Replays' };
const MAX = 400 * 1024 * 1024;

module.exports = (ipcMain, root, open) => {
  const folder = (kind) => {
    if (!Object.prototype.hasOwnProperty.call(FOLDERS, kind)) throw new Error('no such folder');
    const dir = path.join(root(), FOLDERS[kind]);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  ipcMain.handle('saveFile', async (e, kind, name, bytes) => {
    const base = path.basename(String(name)).replace(/[^\w.-]/g, '_').slice(0, 120);
    if (!/^[\w-][\w.-]*\.(webm|mp4|cwreplay)$/i.test(base) || !(bytes instanceof Uint8Array) || bytes.length > MAX) throw new Error('not a clip or replay');
    const file = path.join(folder(kind), base);
    await fs.promises.writeFile(file, bytes);
    return file;
  });
  ipcMain.handle('openFolder', async (e, kind) => open(folder(kind)));
};
