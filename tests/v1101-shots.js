// Muted screenshots of v1.10.1 (hidden window, local test server on 8781): the arena roulette spinning and landing, the
// Mech Ball Stadium with a goal, the Power Cell charging and its reward, a daily gift reveal, a bot's own mech.
// Saves tests/shots/v1101-*.png. SIZE=1280x720 (default)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: 's1101' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, ms = 300) => { await wait(ms); fs.writeFileSync(path.join(shots, `v1101-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third', timeOfDay: 'day' } })); location.reload(); true`);
  await wait(4500);
  await js(`${G}.playOffline('koth'); true`);
  await shot('roulette-spin', 1000);
  await shot('roulette-land', 1700);
  // the stadium, from above the middle, then a goal
  await js(`${G}.playOffline('ball'); true`);
  await wait(4000);
  await js(`(async () => { const g = ${G}; while (g.countdown > 0) await new Promise((r) => setTimeout(r, 100)); const m = g.player.mech; m.place(new THREE.Vector3(-40, 0, 0), -Math.PI / 2); g.cam.yaw = -Math.PI / 2; g.cam.pitch = -0.12; return true; })()`);
  await wait(4500);
  await shot('stadium');
  await js(`(() => { const g = ${G}, o = g.obj, m = g.player.mech; for (const c of g.combatants) if (!c.isPlayer && c.mech) c.mech.place(new THREE.Vector3(-60, 0, 40), 0); m.place(new THREE.Vector3(CW.STADIUM.L - 40, 0, 6), -Math.PI / 2); g.cam.yaw = -Math.PI / 2; o.pos.set(CW.STADIUM.L - 25, 7, 0); o.vel.set(30, 3, 0); return true; })()`);
  await shot('goal', 900);
  // the Power Cell charging, then its reward; a daily gift
  await js(`${G}.showMenu(); ${G}.reveal.powerCell({ lv: 4, reward: { coins: 0, got: [{ kind: 'trails', id: 'galaxy' }] } }); true`);
  await shot('cell-charging', 1150);
  await shot('cell-reward', 1900);
  await js(`${G}.reveal.close(); ${G}.meta.giftToast(150); true`);
  await shot('reveal-gift', 1300);
  await js(`${G}.reveal.close(); true`);
  // a bot's own mech up close
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(7500);
  await js(`(() => { const g = ${G}, m = g.player.mech; const bot = g.combatants.find((c) => !c.isPlayer && c.bp.parts.length > 22) || g.combatants[1]; bot.ai.style = 'dummy'; Object.assign(bot.mech.input, { throttle: 0, turn: 0, fire: false }); const fwd = new THREE.Vector3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)); bot.mech.place(m.pos.clone().addScaledVector(fwd, 14), m.yaw + Math.PI * 0.8); window.__bot = bot.name + ': ' + bot.bp.name; return true; })()`);
  await shot('bot-mech', 1500);
  console.log(await js('window.__bot'));
  app.exit(0);
});
