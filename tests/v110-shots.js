// Muted screenshots of v1.10 (hidden window, local test server on 8781): the Shop's supers / gadgets / perks, the PLAY
// panel's loadout, Mech Ball, Core Heist, a chest being opened and its loot, a ping, a meteor shower, the Workshop combos.
// Saves tests/shots/v110-*.png. SIZE=1280x720 (default)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: 's110' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(shots, `v110-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`(() => { const g = ${G}; const p = g.profile; p.owned.supers = ['orbital', 'gravity']; p.owned.gadgets = ['grapple']; p.owned.perks = ['plating', 'overclock']; g.settings.loSuper = 'orbital'; g.settings.gadget = 'grapple'; g.settings.loPerks = ['plating', 'overclock']; return true; })()`);
  await js(`${G}.meta.openPanel('shop'); true`);
  await wait(600);
  await js(`(() => { const h = [...document.querySelectorAll('#panel h3')].find((x) => /Supers/.test(x.textContent)); h.scrollIntoView(); return true; })()`);
  await shot('shop-supers');
  await js(`(() => { const h = [...document.querySelectorAll('#panel h3')].find((x) => /Perks/.test(x.textContent)); h.scrollIntoView(); return true; })()`);
  await shot('shop-perks');
  await js(`${G}.meta.closePanel(); ${G}.meta.openPanel('arenas'); true`);
  await wait(600);
  await js(`(() => { const h = [...document.querySelectorAll('#panel h3')].find((x) => /Loadout/.test(x.textContent)); h.scrollIntoView(); return true; })()`);
  await shot('play-loadout');
  await js(`(() => { const h = [...document.querySelectorAll('#panel h3')].find((x) => /^Mode/.test(x.textContent)); h.scrollIntoView(); return true; })()`);
  await shot('play-modes');
  await js(`${G}.meta.closePanel(); true`);
  // Mech Ball: look at the ball
  await js(`${G}.playOffline('ball', 'canyon'); true`);
  await wait(9000);
  await js(`(() => { const g = ${G}, m = g.player.mech, b = g.obj.pos; m.place(b.clone().setY(0).add(new THREE.Vector3(0, 0, 22)), 0); g.obj.vel.set(0, 0, 0); g.cam.pitch = -0.05; g.cam.yaw = Math.atan2(-(b.x - m.pos.x), -(b.z - m.pos.z)); return true; })()`);
  await wait(1500);
  await shot('ball');
  // Core Heist at the enemy base
  await js(`${G}.playOffline('heist', 'canyon'); true`);
  await wait(6000);
  await js(`(() => { const g = ${G}, m = g.player.mech, b = g.obj.bases[1]; m.place(b.clone().add(new THREE.Vector3(0, 0, 18)), 0); g.cam.yaw = Math.atan2(-(b.x - m.pos.x), -(b.z - m.pos.z)); return true; })()`);
  await wait(1500);
  await shot('heist');
  // a chest: the hold ring, then the loot
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(5000);
  await js(`(() => { const g = ${G}, m = g.player.mech; for (const c of g.combatants) if (c !== g.player && c.mech) c.mech.place(m.pos.clone().add(new THREE.Vector3(120, 0, 120)), 0); const fwd = new THREE.Vector3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)); g.chests.spawn(m.pos.clone().addScaledVector(fwd, m.radius + 2.5), 'epic'); g.cam.yaw = m.yaw; g.cam.pitch = -0.25; return true; })()`);
  await wait(800);
  await js(`${G}.keys.KeyO = true; true`);
  await wait(550);
  await shot('chest-hold');
  await wait(700);
  await js(`${G}.keys.KeyO = false; true`);
  await wait(500);
  await shot('chest-loot');
  // a ping and a meteor shower
  await js(`(() => { const g = ${G}, m = g.player.mech; g.pings.send('attack', m.pos.clone().add(new THREE.Vector3(-Math.sin(m.yaw) * 30, 0, -Math.cos(m.yaw) * 30))); g.hazards.trigger('meteor'); return true; })()`);
  await wait(2600);
  await shot('ping-meteors');
  // the Workshop with a Grinder + Monster Truck build
  await js(`(() => { const g = ${G}; g.showMenu(); const parts = [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'camera', x: 0, y: 1, z: 0 }]; for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ t: 'bigwheel', x: x * 2, y: 0, z }); for (const x of [-1, 0, 1]) parts.push({ t: 'frame', x, y: 0, z: x === 0 ? 1 : 0 }); for (const x of [-1, 0, 1, 2]) parts.push({ t: x === 2 ? 'saw' : 'spikes', x: x === 2 ? 1 : x, y: 0, z: x === 2 ? 1 : -1 }); parts.push({ t: 'saw', x: -1, y: 0, z: 1 }); g.setCurrentBp({ name: 'Grinder', parts }); g.openWorkshop(); return true; })()`);
  await wait(2500);
  await shot('workshop-combos');
  app.exit(0);
});
