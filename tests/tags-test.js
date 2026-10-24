// Muted check (hidden window): enemy name tags + health bars sit right above their mech at any distance, also on big
// screens where the HUD is scaled up (1920x1080 → zoom 1.46), and the Workshop part list shows a small picture of each
// part. Needs the local test server on 8781 (tests/README.md). Screenshots: tests/shots/tags-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const W = +(process.env.W || 1920), H = +(process.env.H || 1080);

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'tags-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third' } })); location.reload();`);
  await wait(4500);

  // the part list: a small picture of every part
  await js(`${G}.openWorkshop(); true`);
  await wait(1500);
  const pics = await js(`(() => { const imgs = [...document.querySelectorAll('#wsPalette .pal-item .pic')]; const r = imgs[0].getBoundingClientRect(); return { n: imgs.length, filled: imgs.filter((i) => /^data:image\\/png/.test(i.src) && i.naturalWidth > 0).length, w: Math.round(r.width) }; })()`);
  check(pics.n > 30 && pics.filled === pics.n, `every part in the list has a picture (${pics.filled} of ${pics.n})`);
  check(pics.w >= 24 && pics.w <= 50, `the pictures are small (${pics.w} px on screen)`);
  await shot('workshop-' + W);
  await js(`${G}.showMenu(); true`);

  // a match: put an enemy in front of the camera at 20, 60 and 120 m, off to the right, and measure its tag
  await js(`${G}.playOffline('clash', 'desert', null); true`);
  await js(`(async () => { const g = ${G}; for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  console.log('  ui zoom', await js(`${G}.uiZoom`));
  for (const dist of [20, 60, 120]) {
    const r = await js(`(async () => {
      const g = ${G}; const me = g.player.mech;
      const others = g.mechs.filter((x) => x !== me && x.alive);
      const e = others[0];
      for (const o of others.slice(1)) o.place({ x: o.pos.x + 300, z: o.pos.z + 300 }, 0); // only one tag on screen
      const f = { x: -Math.sin(g.cam.yaw), z: -Math.cos(g.cam.yaw) }, rt = { x: Math.cos(g.cam.yaw), z: -Math.sin(g.cam.yaw) };
      const side = ${dist} * 0.35;
      e.place({ x: me.pos.x + f.x * ${dist} + rt.x * side, z: me.pos.z + f.z * ${dist} + rt.z * side }, 0);
      e.vel.set(0, 0, 0); e.input.throttle = 0;
      for (let i = 0; i < 3; i++) { g.tick(1 / 120); }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // where the tag should be: just above the mech (the same point the game uses), in window pixels
      const v = e.pos.clone(); v.y += e.radius + 0.6; v.project(g.camera);
      const want = { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
      const t = e.combatant.tagEl.getBoundingClientRect();
      const z = g.uiZoom || 1;
      // Chrome reports boxes inside a zoomed element either in window pixels or in the zoomed element's own pixels
      const asIs = { x: t.left + t.width / 2, y: t.bottom }, scaled = { x: asIs.x * z, y: asIs.y * z };
      const off = (p) => Math.hypot(p.x - want.x, p.y - want.y);
      const got = off(asIs) < off(scaled) ? asIs : scaled;
      return { off: Math.round(off(got)), want: [Math.round(want.x), Math.round(want.y)], got: [Math.round(got.x), Math.round(got.y)], shown: e.combatant.tagEl.style.display !== 'none' };
    })()`);
    check(r.shown && r.off <= 12, `at ${dist} m the name tag sits on its mech (${r.off} px off; want ${r.want}, tag at ${r.got})`);
    await shot('match-' + dist + 'm');
  }

  console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
