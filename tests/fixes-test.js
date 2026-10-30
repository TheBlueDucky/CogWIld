// Muted check of the v1.8.2 fixes (hidden window): T opens and closes the chat in a match, getting out next to a cliff
// keeps you at the mech's height, pilots can't run up cliffs, big mechs repair in seconds, the flying hint and C to
// fly down, heavy mechs aren't crawling, Ranked at 100 trophies, shop finishes and wreck effects, soft particles.
// Needs the local test server on 8781 (tests/README.md). Screenshots: tests/shots/fixes-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'fixes-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third' } })); location.reload();`);
  await wait(4500);
  const start = (arena, mech) => js(`(async () => { const g = ${G}; g.showMenu(); g.settings.mouseSteer = false; g.setCurrentBp(CW.PRESETS.find((p) => p.id === '${mech}')); g.playOffline('clash', '${arena}', null);
    for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    for (const e of g.mechs) if (e !== g.player.mech) e.place({ x: e.pos.x + 500, z: e.pos.z }, 0); return true; })()`);
  const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); };

  check(await js(`CW.ECON.RANKED.unlockAt === 100`), 'Ranked unlocks at 100 trophies');
  const heavy = await js(`(() => { const parts = [{ t: 'core', x: 0, y: 0, z: 0 }]; for (let x = -1; x <= 1; x++) for (let z = -2; z <= 2; z++) if (x || z) parts.push({ t: 'armor', x, y: 0, z }); for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) parts.push({ t: 'wheel', x, y: 0, z }); parts.push({ t: 'engine', x: 0, y: 1, z: 0 });
    const s = CW.analyze(parts); return { mass: s.mass, now: s.landSpeed, before: ((s.drive + s.thrust) * s.pr) / (s.mass * CW.DRAG.land) }; })()`);
  check(heavy.now > heavy.before * 1.4, `a heavy mech (${heavy.mass.toFixed(0)} mass) is much less slow: ${(heavy.now * 3.6).toFixed(0)} km/h, was ${(heavy.before * 3.6).toFixed(0)}`);

  // ---- T opens the chat in a match, T again closes it ----
  await start('canyon', 'buggy');
  await key('T');
  const opened = await js(`!document.getElementById('chat').classList.contains('hidden')`);
  await js(`document.getElementById('chatInput').blur(); true`);
  await key('T');
  const closed = await js(`document.getElementById('chat').classList.contains('hidden')`);
  check(opened && closed, `T opens the chat in a match (${opened}) and T closes it again (${closed})`);

  // ---- getting out next to a cliff, and walking into it ----
  const cliff = await js(`(async () => {
    const g = ${G}, w = g.world, m = g.player.mech;
    // a spot with a steep rise a few meters away
    let spot = null;
    const T = (x, z) => (w.onBridge(x, z, 6) ? NaN : CW.terrainHeight(x, z)); // a real cliff, not a bridge
    for (let x = -150; x < 150 && !spot; x += 3) for (let z = -150; z < 150 && !spot; z += 3) {
      const h = T(x, z); if (!(h >= 1)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = m.radius + 1.2, h2 = T(x + dx * d, z + dz * d), hb = T(x - dx * 2, z - dz * 2);
        if (h2 - h > 4 && Math.abs(hb - h) < 0.6 && Math.abs(T(x + dx * 0.8, z + dz * 0.8) - h) < 0.8) { spot = { x, z, dx, dz, h, h2 }; break; }
      }
    }
    if (!spot) return { none: true };
    // face so the cliff is on the mech's right (where you step out first)
    const yaw = Math.atan2(-spot.dz, spot.dx) - Math.PI / 2 + Math.PI;
    m.place({ x: spot.x, z: spot.z }, Math.atan2(spot.dz, -spot.dx) + Math.PI / 2 + Math.PI);
    m.vel.set(0, 0, 0);
    for (let i = 0; i < 20; i++) g.tick(1 / 60);
    const feet = m.pos.y - m.baseOff;
    g.exitMech(g.player);
    const p = g.player.pilot;
    const out = { cliff: +(spot.h2 - spot.h).toFixed(1), stepOut: +(p.pos.y - feet).toFixed(2) };
    // walk straight at the cliff for 2 seconds, from its foot (the mech parked out of the way)
    m.place({ x: spot.x + 40, z: spot.z + 40 }, 0);
    p.pos.set(spot.x, w.groundAt(spot.x, spot.z), spot.z); p.vel.set(0, 0, 0);
    const y0 = p.pos.y;
    for (let i = 0; i < 120; i++) { p.update(1 / 60, { mx: spot.dx, mz: spot.dz, jump: false, fire: false, aim: null, yaw: g.cam.yaw }); }
    out.climbed = +(p.pos.y - y0).toFixed(2);
    // under a bridge: walk along the river bank beneath it; you stay on the ground, never on the deck above
    const br = w.bridges[0];
    if (br) {
      const mid = (br.a0 + br.a1) / 2;
      const bx = br.axis === 'x' ? mid : br.c - br.w - 2, bz = br.axis === 'x' ? br.c - br.w - 2 : mid;
      p.pos.set(bx, CW.terrainHeight(bx, bz), bz); p.vel.set(0, 0, 0);
      let worst = -99;
      const dir = br.axis === 'x' ? { mx: 0, mz: 1 } : { mx: 1, mz: 0 };
      for (let i = 0; i < 90; i++) { p.update(1 / 60, Object.assign({ jump: false, fire: false, aim: null, yaw: g.cam.yaw }, dir)); if (w.onBridge(p.pos.x, p.pos.z, 0) && br.y - CW.terrainHeight(p.pos.x, p.pos.z) > 1.5) worst = Math.max(worst, p.pos.y - br.y); }
      out.underBridge = +worst.toFixed(2);
    }
    g.enterMech(g.player);
    return out;
  })()`);
  if (cliff.none) check(false, 'found a cliff to test next to');
  else {
    check(Math.abs(cliff.stepOut) < 1.5, `getting out next to a ${cliff.cliff} m cliff keeps you at the mech's height (${cliff.stepOut} m)`);
    check(cliff.climbed < 1.5, `walking into the cliff doesn't carry you up it (${cliff.climbed} m in 2 s)`);
    if (cliff.underBridge !== undefined) check(cliff.underBridge < -0.5, `walking under a bridge keeps you below it, not popped onto its deck (${cliff.underBridge === -99 ? 'never under a high deck' : -cliff.underBridge + ' m below the deck at most'})`);
  }

  // ---- repairs: a 60-part mech comes back in seconds ----
  const rep = await js(`(() => {
    const g = ${G};
    const parts = [{ t: 'core', x: 0, y: 0, z: 0 }];
    for (let x = -3; x <= 3; x++) for (let z = -4; z <= 4; z++) if (x || z) parts.push({ t: x % 3 ? 'frame' : 'armor', x, y: 0, z });
    const m = new CW.Mech(g, { name: 'Big', parts }, { combatant: { isPlayer: false, color: 0x3a86ff, team: 9 }, color: 0x3a86ff });
    m.place({ x: 0, z: 0 }, 0);
    for (const p of m.parts) if (p.t !== 'core') { p.alive = false; g.scene.remove(p.obj); }
    m.parts[3].alive = true; m.parts[3].hp = 1; // one damaged part left too
    let t = 0, r = '';
    while (t < 30 && (r = m.repairWork(1 / 60)) !== 'done') t += 1 / 60;
    const all = m.parts.every((p) => p.alive);
    m.dispose();
    return { n: parts.length, t: +t.toFixed(1), all };
  })()`);
  check(rep.all && rep.t < 6, `a ${rep.n}-part mech is fully repaired in ${rep.t} s`);

  // ---- flying: the hint, and C flies down ----
  await start('canyon', 'hornet');
  const fly = await js(`(async () => {
    const g = ${G}; g.keys.Space = true;
    for (let i = 0; i < 150; i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.keys.Space = false;
    for (let i = 0; i < 90; i++) g.tick(1 / 60); // settle into a hover first
    const el = document.getElementById('flyHint');
    const hint = el && !el.classList.contains('hidden') ? el.textContent : '';
    const y0 = g.player.mech.pos.y; g.keys.KeyC = true;
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    g.keys.KeyC = false;
    return { hint, drop: +(y0 - g.player.mech.pos.y).toFixed(1) };
  })()`);
  check(/climb/.test(fly.hint) && /fly down/.test(fly.hint), `while flying the screen says how to go up and down ("${fly.hint}")`);
  check(fly.drop > 5, `holding C flies down (${fly.drop} m in 1 s)`);
  await shot('fly');

  // ---- shop: finishes on the mech, wreck effects, soft particles ----
  await js(`(() => { const g = ${G}; g.profile.owned.finishes = ['gold']; g.profile.finish = 'gold'; g.profile.owned.wrecks = ['fireworks', 'lightning', 'blackhole', 'confetti', 'pixel']; return true; })()`);
  await start('desert', 'buggy');
  const gold = await js(`(() => { const m = ${G}.player.mech; let n = 0; m.group.traverse((o) => { if (o.isMesh && o.material.color && o.material.color.getHex() === 0xffc23a && o.material.metalness === 1) n++; }); return n; })()`);
  check(gold > 10, `the Gold Plated finish is on the player's mech (${gold} golden pieces)`);
  for (const fx of ['fireworks', 'lightning', 'blackhole', 'confetti', 'pixel']) {
    const ok = await js(`(() => { const g = ${G}; g.profile.wreckFx = '${fx}'; const m = g.player.mech; const e = g.mechs.find((x) => x !== m && x.alive); if (!e) return false;
      const f = { x: -Math.sin(g.cam.yaw), z: -Math.cos(g.cam.yaw) }; e.place({ x: m.pos.x + f.x * 18, z: m.pos.z + f.z * 18 }, 0); e.destroy(g.player);
      for (let i = 0; i < 70; i++) g.tick(1 / 60); return true; })()`);
    if (fx === 'lightning' || fx === 'blackhole') { await wait(50); await shot('wreck-' + fx); }
    check(ok, `the ${fx} wreck effect plays`);
  }
  const sprites = await js(`(() => { const g = ${G}; g.fx.burst(g.player.mech.pos, { n: 5, color: 'smoke' }); return g.fx.particles.every((p) => p.mesh.isSprite); })()`);
  check(sprites, 'particles are soft glows (sprites), not solid balls');
  await js(`${G}.showMenu(); ${G}.meta.openPanel('shop'); true`);
  await wait(500);
  const shop = await js(`[...document.querySelectorAll('#panelBody h3')].map((h) => h.textContent.split(' ').slice(0, 3).join(' '))`);
  check(shop.some((t) => /finishes/.test(t)) && shop.some((t) => /Wreck/.test(t)), `the Shop has mech finishes and wreck effects (${shop.join(' | ')})`);
  await js(`${G}.meta.closePanel(); ${G}.meta.openPanel('settings'); true`);
  await wait(300);
  await js(`document.querySelector('[data-settab=support]').click(); true`);
  const sup = await js(`(() => { const s = document.querySelector('.set-sec.on'); return s ? s.textContent : ''; })()`);
  check(/theblueduckymc@gmail.com/.test(sup) && /Contact us/.test(sup), 'Settings › Support shows how to contact us');
  await shot('support');
  await js(`${G}.meta.closePanel(); true`);

  console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
