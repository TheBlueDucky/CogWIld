// Muted screenshots of the v1.3 screens at a few sizes (logged in on the local test server).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = (process.env.SIZES || '1280x720,800x450').split(',').map((s) => s.split('x').map(Number));
app.whenReady().then(async () => {
  const errors = [];
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: 'ui' + w + Date.now() } });
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errors.push(`${w}x${h} ${msg}`); });
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}-${w}.png`), (await win.webContents.capturePage()).toPNG());
    const G = '(window.game || CW.game)';
    await win.loadURL('http://localhost:8781/');
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, coins: 900, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
    await wait(3500);
    const name = 'shot' + w + Math.floor(Math.random() * 1000);
    await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${name}', pass: 'shotpass1' }))`);
    await wait(2500);
    await js(`${G}.net.send({ t: 'earn', src: 'match', n: 300, pp: 50 }); ${G}.net.send({ t: 'gift' }); ${G}.net.send({ t: 'clubCreate', name: 'Bolt Squad ${w}', badge: 4, desc: 'Fast mechs only' }); true`);
    await wait(1200);
    await js(`${G}.net.send({ t: 'clubChat', i: 2 }); true`);
    await wait(800);
    await shot('lobby');
    for (const p of ['arenas', 'pass', 'clubs', 'shop', 'challenges', 'settings', 'friends']) {
      await js(`${G}.meta.openPanel('${p}'); true`);
      await wait(700);
      await shot('panel-' + p);
      await js(`${G}.meta.closePanel(); true`);
    }
    await js(`${G}.openWorkshop ? ${G}.openWorkshop() : document.getElementById('btnWorkshop').click(); true`);
    await wait(1500);
    await shot('workshop');
    await js(`${G}.showMenu(); true`);
    await wait(500);
    // a match on Scrap Yard in Bounty Hunt, with the HUD
    await js(`${G}.playOffline('bounty', 'scrap'); true`);
    await wait(6000);
    await js(`${G}.pressed.KeyG = true; true`);
    await wait(1500);
    await shot('match-scrap');
    await js(`(() => { const g = ${G}; g.obj.score[g.player.team] = 99; })()`);
    await wait(6500);
    await shot('results');
    win.destroy();
  }
  console.log('errors', errors.length, errors.slice(0, 10).join('\n'));
  app.exit(0);
});
