// Records the intro (tools/video/intro.html) for one video: npx electron rec-intro.js <name> "<subtitle>"
const { app } = require('electron');
const path = require('path');
const { makeWindow, Capture, wait } = require('./cap');
const name = process.argv[2] || 'intro', sub = process.argv[3] || 'Gameplay';
app.whenReady().then(async () => {
  const win = makeWindow();
  await win.loadFile(path.join(__dirname, 'intro.html'), { hash: encodeURIComponent(sub) });
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await js('introReady');
  const cap = new Capture(win);
  await cap.begin(name);
  await js('introGo()');
  const n = Math.round((await js('INTRO_LEN')) * 60);
  for (let i = 0; i < n; i++) await cap.step();
  await js('introAudio().then((p) => { __vt.V.pcm = p; return p.length; })');
  console.log(JSON.stringify(await cap.end()));
  app.exit(0);
});
