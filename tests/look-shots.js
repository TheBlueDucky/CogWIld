// Muted screenshots of the screens changed in v1.9.4 (hidden window, local test server on 8781):
// matchmaking search, clubs, PLAY panel (mode + arena), chat (PC docked / phone), workshop, update note, gallery button.
// SIZES=1280x720,915x412   SHOTS=search,clubs,…   (screenshots go to tests/shots/look-*.png)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = (process.env.SIZES || '1280x720').split(',').map((s) => s.split('x').map(Number));
const ONLY = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  for (const [w, h] of SIZES) {
    const phone = w < 1000;
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: 'look' + w + Date.now() } });
    win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(`${w}x${h} ${msg}`); });
    const js = (c) => win.webContents.executeJavaScript(c);
    const shot = async (name) => console.log('shot', name) || fs.writeFileSync(path.join(OUT, `look-${name}-${w}.png`), (await win.webContents.capturePage()).toPNG());
    await win.loadURL('http://localhost:8781/');
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, coins: 900, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: '${phone ? 'on' : 'off'}' } })); location.reload(); true`);
    await wait(4000);
    const name = 'Shot' + w + Math.floor(Math.random() * 1000); // short: long numbers or app names are refused by the name filter
    await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${name}', pass: 'lookpass1' }))`);
    await wait(2500);
    if (want('clubs')) {
      await js(`${G}.meta.openPanel('clubs'); true`);
      await wait(1200);
      await shot('clubs-find');
      await js(`${G}.meta.closePanel(); true`);
    }
    await js(`${G}.net.send({ t: 'clubCreate', name: 'Bolt ' + '${name}'.slice(4), badge: 4, desc: 'Fast mechs only' }); true`);
    await wait(1500);
    if (want('lobby')) await shot('lobby');
    // v1.9.5: your profile, another player's profile, Settings › Account, the match status panel
    if (want('profile')) {
      await js(`${G}.meta.openPanel('profile'); true`);
      await wait(900);
      await shot('profile');
      await js(`document.querySelector('#panelBody').scrollTop = 9999; true`);
      await wait(300);
      await shot('profile-end');
      await js(`${G}.account.showPlayer('${name}', 'friends'); true`);
      await wait(1200);
      await shot('player');
      await js(`${G}.meta.openPanel('settings'); true`);
      await wait(700);
      await shot('settings-account');
      await js(`${G}.meta.closePanel(); true`);
    }
    if (want('hud')) {
      await js(`${G}.playOffline('clash', 'canyon'); true`);
      await wait(6000);
      await shot('hud');
      await js(`${G}.showMenu(); true`);
      await wait(800);
    }
    if (want('note')) {
      await js(`${G}.account.note('⬆ A new version of Cogwild is out! Online play needs the update.', [{ label: 'Download update', main: true }, { label: 'Later' }], 60000); true`);
      await wait(600);
      await shot('note');
      await js(`document.getElementById('notes').innerHTML = ''; true`);
    }
    if (want('arenas')) {
      await js(`${G}.meta.openPanel('arenas'); true`);
      await wait(900);
      await shot('arenas');
      await js(`document.getElementById('opTutorial').scrollIntoView({ block: 'end' }); true`);
      await wait(300);
      await shot('arenas-end');
      // hover a mode button
      const r = await js(`(() => { const b = document.getElementById('opRoom'); const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r[0]), y: Math.round(r[1]) });
      await wait(400);
      await shot('arenas-hover');
      await js(`${G}.meta.closePanel(); true`);
    }
    if (want('clubs')) {
      await js(`${G}.meta.openPanel('clubs'); true`);
      await wait(1200);
      await shot('clubs');
      await js(`${G}.meta.closePanel(); true`);
    }
    if (want('search')) {
      await js(`(() => { const g = ${G}; g.hideAll(); document.getElementById('search').classList.remove('hidden'); })()`);
      await wait(700);
      await shot('search');
      await js(`${G}.showMenu(); true`);
      await wait(400);
    }
    if (want('chat')) {
      await js(`${G}.talk.open('club'); true`);
      await wait(900);
      await shot('chat');
      await js(`${G}.talk.close(); true`);
      await wait(300);
    }
    if (want('workshop')) {
      await js(`${G}.openWorkshop(); true`);
      await wait(2500);
      await shot('workshop');
      // the example mechs made of the new shapes, and a shape picked and turned (the ghost follows the mouse)
      for (const id of ['coupe', 'jet', 'sub']) {
        await js(`(() => { const g = ${G}; g.workshop.load(CW.PRESETS.find((p) => p.id === '${id}')); return true; })()`);
        await wait(900);
        await shot('ws-' + id);
      }
      await js(`(() => { const w = ${G}.workshop; w.select('body:dome'); w.turnPart(1); document.querySelector('[data-part="body:dome"]').scrollIntoView(); return true; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(w * 0.47), y: Math.round(h * 0.42) });
      await wait(700);
      await shot('ws-shape');
      await js(`${G}.showMenu(); true`);
      await wait(500);
    }
    win.destroy();
  }
  console.log('errors', errors.length, errors.slice(0, 10).join('\n'));
  app.exit(0);
});
