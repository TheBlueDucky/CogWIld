// Muted check: a quick-chat line shows once for the sender and once for the other player.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const mk = async (name) => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { offscreen: true, partition: 'c-' + name + Date.now(), backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    await win.loadURL('http://localhost:8781/');
    const js = (code) => win.webContents.executeJavaScript(code);
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 3000, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
    await wait(3500);
    return { win, js };
  };
  const G = '(window.game || CW.game)';
  const A = await mk('ann'), B = await mk('ben');
  await A.js(`${G}.net.withServer(() => ${G}.net.send({ t: 'create', pub: false, settings: {} })); true`);
  await wait(1200);
  const code = await A.js(`${G}.net.room.code`);
  await B.js(`${G}.net.openOnline('${code}'); true`);
  await wait(1500);
  await B.js(`${G}.net.chat(1); true`); // "GG!"
  await wait(1200);
  const a = await A.js(`(${G}.net.chatLog || []).length`), b = await B.js(`(${G}.net.chatLog || []).length`);
  console.log(`sender sees the line ${b} time(s), the other player ${a} time(s)`);
  app.exit(0);
});
