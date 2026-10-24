// Muted check of v1.8 driving and looks (hidden window): letting go of A/D keeps your aim still, car steering
// (front wheels turn, S brakes), the new body parts and big wheels, small tracer bullets with no flash in front of
// your own camera, a wreck falling apart before it explodes, and the menu/countdown animations.
// Needs the local test server on 8781 (tests/README.md). Screenshots go to tests/shots/drive-*.png.
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
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'drive-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third' } })); location.reload();`);
  await wait(4500);
  // run the game for n frames of 1/60 s (the page keeps drawing on its own as well)
  const ticks = (n) => js(`(async () => { const g = ${G}; for (let i = 0; i < ${n}; i++) { g.tick(1 / 60); if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  const useMech = (id) => js(`(() => { const g = ${G}; g.setCurrentBp(CW.PRESETS.find((p) => p.id === '${id}')); return g.currentBp.name; })()`);

  // ---- the new mechs in the Workshop ----
  check(await js(`CW.BUDGET === 750 && CW.ECON.BUDGET === 750`), 'the build budget is 750 Bolts');
  check(await js(`${G}.settings.autoSteer === false`), 'auto-steer is off on a PC (A/D steer like a car)');
  for (const id of ['buggy', 'monster', 'racer']) {
    const name = await useMech(id);
    const v = await js(`(() => { const v = CW.validate(CW.PRESETS.find((p) => p.id === '${id}').parts, 3); return { ok: v.ok, cost: v.s.cost, err: v.errors.join(', ') }; })()`);
    check(v.ok, `${name} is a valid mech (${v.cost} Bolts${v.err ? ', ' + v.err : ''})`);
    await js(`${G}.openWorkshop(); true`);
    await wait(1400);
    await shot('ws-' + id);
    await js(`${G}.showMenu(); true`);
    await wait(300);
  }
  const palette = await js(`[...document.querySelectorAll('#wsPalette .pal-cat')].map((e) => e.textContent.trim())`);
  check(palette.some((t) => /^Body/.test(t)), `the Workshop has a Body category (${palette.join(', ')})`);
  const flat = await js(`(() => { const b = document.getElementById('wsUndo'), cs = getComputedStyle(b); return { shadow: cs.boxShadow, border: cs.borderTopWidth }; })()`);
  check(flat.shadow === 'none' && parseFloat(flat.border) <= 1, `Workshop buttons are flat and thin (${flat.border}, shadow ${flat.shadow})`);

  // ---- menus animate when they open ----
  const anim = await js(`(() => { const g = ${G}; g.showMenu(); return document.querySelector('.lobby-side.left').getAnimations().length; })()`);
  check(anim > 0, 'the lobby slides in when it opens');
  await js(`document.getElementById('btnShop') ? document.getElementById('btnShop').click() : null; true`);
  await wait(60);
  const panelAnim = await js(`(() => { const b = document.querySelector('#panel:not(.hidden) .panel-box, #panel:not(.hidden) #panelBody'); return b ? b.getAnimations().length : -1; })()`);
  check(panelAnim > 0, 'a menu panel animates as it opens');
  await shot('menu-opening');
  await js(`${G}.meta && ${G}.meta.closePanel ? ${G}.meta.closePanel() : document.getElementById('panelClose').click(); ${G}.showMenu(); true`);

  // ---- a match in the Scout Buggy ----
  await useMech('buggy');
  await js(`${G}.playOffline('clash', 'desert', null); true`);
  await wait(300);
  check(await js(`document.getElementById('countdown').classList.contains('pop')`), 'the countdown numbers pop in');
  await js(`(async () => { const g = ${G}; for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  const steerers = await js(`${G}.player.mech.parts.filter((p) => p.steers).length`);
  check(steerers === 2, `the buggy's 2 front wheels steer (${steerers})`);
  // drive forward, steer left, let go: the view and the mech stop turning right away
  // a long flat dry stretch to drive on (the spawn spot is random: water or a wall ahead would spoil the checks)
  await js(`(() => {
    const g = ${G}, w = g.world, m = g.player.mech;
    for (const e of g.mechs) if (e !== m) e.place(e.pos.clone().setX(e.pos.x + 400), 0);
    let best = null;
    for (let x = -140; x <= 140 && !best; x += 7) for (let z = 120; z >= -60 && !best; z -= 7) {
      let ok = true; const h0 = w.groundAt(x, z);
      if (h0 < 1.5) continue;
      for (let d = 0; d <= 90 && ok; d += 3) { const h = w.groundAt(x, z - d); if (h < 1.5 || Math.abs(h - h0) > 2.5) ok = false; } // north (yaw 0) for 90 m
      if (ok) best = { x, z };
    }
    if (best) { m.place(best, 0); m.vel.set(0, 0, 0); g.cam.yaw = 0; }
    window.__flat = best;
    g.keys.KeyW = true; return true;
  })()`);
  await ticks(90);
  await js(`${G}.keys.KeyA = true; true`);
  await ticks(40);
  const wheel = await js(`(() => { const m = ${G}.player.mech; const w = m.parts.find((p) => p.steers); return +w.obj.userData.steer.rotation.y.toFixed(2); })()`);
  check(wheel > 0.2, `holding A turns the front wheels (${wheel} rad)`);
  await shot('steer');
  const before = await js(`(() => { const g = ${G}; g.keys.KeyA = false; return { cam: g.cam.yaw, mech: g.player.mech.yaw }; })()`);
  await ticks(45);
  const after = await js(`({ cam: ${G}.cam.yaw, mech: ${G}.player.mech.yaw })`);
  check(Math.abs(after.cam - before.cam) < 0.02 && Math.abs(after.mech - before.mech) < 0.02, `after letting go of A the aim stays put (view moved ${(after.cam - before.cam).toFixed(3)}, mech ${(after.mech - before.mech).toFixed(3)} rad)`);
  // S while rolling forward brakes hard: back to the flat stretch, drive straight, then brake
  const toFlat = () => js(`(() => { const g = ${G}, m = g.player.mech; for (const k of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) g.keys[k] = false; if (window.__flat) { m.place(window.__flat, 0); m.vel.set(0, 0, 0); g.cam.yaw = 0; g.cam.pitch = 0.05; } return true; })()`);
  await toFlat();
  await js(`${G}.keys.KeyW = true; true`);
  await ticks(100);
  const v1 = await js(`${G}.player.mech.fwdSpeed`);
  await js(`(() => { const g = ${G}; g.keys.KeyW = false; g.keys.KeyS = true; return true; })()`);
  const media = [];
  for (let i = 0; i < 4; i++) { await ticks(6); media.push(await js(`${G}.player.mech.medium`)); }
  const v2 = await js(`${G}.player.mech.fwdSpeed`);
  await js(`${G}.keys.KeyS = false; true`);
  check(v1 > 12 && v2 < v1 * 0.45, `S brakes like a car (${v1.toFixed(1)} → ${v2.toFixed(1)} m/s in 0.4 s, on ${media.join('/')})`);

  // shooting in first person: thin tracers, no flash covering the screen
  await toFlat();
  await js(`(() => { const g = ${G}; g.settings.camMode = 'first'; g.cam.pitch = 0.08; return true; })()`);
  await ticks(3); // the camera moves into the cockpit first
  await js(`${G}.mouse.left = true; true`);
  await ticks(10);
  // big glows (sprites are as wide as their scale) within 2.5 m in front of the lens; smoke behind you doesn't count
  const fire = await js(`(() => { const g = ${G}; const cam = g.camera.position, fwd = new THREE.Vector3(); g.camera.getWorldDirection(fwd);
    const near = g.fx.particles.filter((p) => { const d = p.mesh.position.clone().sub(cam); return d.length() < 2.5 && d.dot(fwd) > 0 && p.mesh.scale.x > 0.5; }).length; const shells = g.fx.projectiles.filter((p) => p.kind === 'shell'); return { near, shells: shells.length, box: shells.length ? shells[0].mesh.geometry.type : '' }; })()`);
  check(fire.shells > 0 && fire.box === 'BoxGeometry', `cannon shots are thin tracers (${fire.shells} in the air, ${fire.box})`);
  check(fire.near === 0, `nothing big flashes in front of your own camera (${fire.near})`);
  await wait(50);
  await shot('fp-fire');
  await js(`(() => { const g = ${G}; g.mouse.left = false; g.settings.camMode = 'third'; return true; })()`);

  // wrecking an enemy: parts fly off first, then the big explosion
  await js(`(() => { const g = ${G}; const m = g.player.mech; const e = g.mechs.find((x) => x !== m && x.alive); const f = { x: -Math.sin(g.cam.yaw), z: -Math.cos(g.cam.yaw) }; e.place({ x: m.pos.x + f.x * 16, z: m.pos.z + f.z * 16 }, g.cam.yaw); e.vel.set(0, 0, 0); window.__wreck = e; g.cam.pitch = -0.15; return true; })()`);
  await ticks(10);
  await js(`(() => { const g = ${G}; window.__wreck.destroy(g.player); return true; })()`);
  await ticks(6);
  const early = await js(`({ debris: ${G}.fx.debrisList.length, timers: (${G}.fx.timers || []).length })`);
  check(early.debris >= 10 && early.timers === 1, `a wrecked mech falls apart first (${early.debris} pieces flying, big explosion still to come)`);
  await shot('wreck-1');
  await ticks(14);
  await shot('wreck-2');
  check(await js(`(${G}.fx.timers || []).length === 0`), 'then it explodes');
  await ticks(30);
  await shot('wreck-3');

  // ---- the Monster Truck: sits on its big wheels ----
  await js(`${G}.showMenu(); true`);
  await useMech('monster');
  await js(`${G}.playOffline('clash', 'canyon', null); true`);
  await js(`(async () => { const g = ${G}; for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  await ticks(60);
  const truck = await js(`(() => { const m = ${G}.player.mech; const ground = ${G}.world.groundAt(m.pos.x, m.pos.z); return { baseOff: m.baseOff, gap: +(m.pos.y - m.baseOff - ground).toFixed(2), big: m.bigWheels }; })()`);
  check(truck.big === 4 && Math.abs(truck.baseOff - 0.95) < 0.01 && truck.gap < 0.3, `the Monster Truck stands on its 4 big wheels (gap to the ground ${truck.gap})`);
  await js(`${G}.keys.KeyW = true; true`);
  await ticks(70);
  await js(`${G}.keys.KeyW = false; true`);
  await wait(200);
  await shot('monster');
  await js(`${G}.showMenu(); true`);

  console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
