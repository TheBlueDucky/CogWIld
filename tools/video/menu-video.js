// The menu video (tools/video): a mouse pointer tours the lobby, builds a mech in the Workshop, looks at the modes, the
// Shop, the Cog Pass and the themes, then presses PLAY. Frame-exact like the matches, with the menu music and clicks.
//   npx electron menu-video.js [--preview]   (preview: a picture every second instead of a video)
// Uses a test account on the LOCAL test server only (port 8781), like the tests in tests/.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeWindow, Capture, openGame, wait, MS, OUT } = require('./cap');
const PREVIEW = process.argv.includes('--preview');

app.whenReady().then(async () => {
  const win = makeWindow();
  const wc = win.webContents;
  const js = (c) => wc.executeJavaScript(c, true);
  await openGame(win, { music: true, musicVol: 0.8, glass: false });
  // a test account on the local test server (made the first time, logged into after that)
  await js(`game.net.connect().then(() => game.net.send({ t: 'acctRegister', name: 'BlueDucky', pass: 'videopass1' })); true`);
  await wait(2000);
  if (!(await js('!!game.account.me'))) { await js(`game.net.send({ t: 'acctLogin', name: 'BlueDucky', pass: 'videopass1' }); true`); await wait(2000); }
  await js(`game.net.send({ t: 'earn', src: 'match', n: 300, pp: 50 }); game.net.send({ t: 'gift' }); true`);
  await wait(2500);
  for (let i = 0; i < 3; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(400); }
  // the lobby all year round: no seasonal decorations, a sunset; your mech = a simple starter car (built up in the Workshop)
  await js(`(() => { const g = game, CW = window.CW;
    CW.ECON.event = () => null;
    g.world.dispose(); g.world = new CW.World(g.scene, 'canyon'); g.world.setDetail(g.gfx || 'high'); g.world.applyTime('sunset', g); g.timeOfDay = 'sunset';
    g.showcaseSpot = null; if (g.showcase) { g.scene.remove(g.showcase); g.showcase = null; }
    const P = (l) => l.map(([t, x, y, z]) => ({ t, x, y, z }));
    g.setCurrentBp({ name: 'My Mech', color: 0x3a86ff, parts: P([['core', 0, 0, 0], ['body', 0, 0, -1], ['body', 0, 0, 1], ['wheel', -1, 0, -1], ['wheel', 1, 0, -1], ['wheel', -1, 0, 1], ['wheel', 1, 0, 1], ['camera', 0, 1, -1], ['cabin', 0, 1, 0]]) });
    g.showMenu();
    for (const n of [...document.querySelectorAll('#notes > *')]) n.remove();
    const st = document.createElement('style'); st.textContent = '#btnEvent { display: none !important; }'; document.head.appendChild(st);
    return true; })()`);
  await wait(1500);
  for (const f of ['vt-page.js', 'cursor-page.js']) await js(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  await js(`__vt.enable(); for (let i = 0; i < 6; i++) __vt.step(-1, ${MS}); true`);

  const cap = new Capture(win);
  let cx = 1650, cy = 1000, press = 0, hidden = false, shots = 0;
  const dir = path.join(OUT, 'menu-preview');
  if (PREVIEW) fs.mkdirSync(dir, { recursive: true });
  // one frame (in preview mode only the clock moves; a picture every second)
  const tick = async () => {
    const pre = `__cur.set(${cx.toFixed(1)}, ${cy.toFixed(1)}, ${press.toFixed(2)}, ${hidden});`;
    if (!PREVIEW) return cap.step(pre);
    await js(`${pre}__vt.step(${cap.frame}, ${MS})`);
    if (cap.frame % 60 === 0) { await wait(60); fs.writeFileSync(path.join(dir, `m${String(shots++).padStart(3, '0')}.jpg`), (await wc.capturePage()).resize({ width: 960 }).toJPEG(80)); }
    cap.frame++;
  };
  const hold = async (sec) => { for (let i = Math.round(sec * 60); i > 0; i--) await tick(); };
  const mm = (x, y, held) => wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), modifiers: held ? ['leftButtonDown'] : [] });
  // a hand-like move: eases in and out along a gentle curve
  const move = async (x, y, dur, held) => {
    const x0 = cx, y0 = cy, n = Math.max(1, Math.round((dur || 0.55) * 60));
    const bend = (Math.hypot(x - x0, y - y0) * 0.12) * (x > x0 ? 1 : -1);
    for (let i = 1; i <= n; i++) {
      const t = i / n, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const nx = -(y - y0), ny = x - x0, l = Math.hypot(nx, ny) || 1;
      const arc = Math.sin(Math.PI * e) * bend;
      cx = x0 + (x - x0) * e + (nx / l) * arc; cy = y0 + (y - y0) * e + (ny / l) * arc;
      mm(cx, cy, held);
      await tick();
    }
  };
  const at = async (sel, dx, dy) => { const p = await js(`__cur.at(${JSON.stringify(sel)}, ${dx || 0}, ${dy || 0})`); if (!p) console.log('missing', sel); return p; };
  const to = async (sel, dur, dx, dy) => { const p = await at(sel, dx, dy); if (p) await move(p.x, p.y, dur); return p; };
  const click = async () => {
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
    press = 1; await js(`__cur.click(${cx}, ${cy}); true`); await tick(); await tick();
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
    press = 0.5; await tick(); press = 0; await tick();
  };
  const key = async (code) => { wc.sendInputEvent({ type: 'keyDown', keyCode: code }); wc.sendInputEvent({ type: 'keyUp', keyCode: code }); await tick(); };
  // scroll an element smoothly (its scrollTop), like a mouse wheel spin
  const scroll = async (sel, by, dur) => {
    const n = Math.round(dur * 60);
    const s0 = await js(`document.querySelector(${JSON.stringify(sel)}).scrollTop`);
    for (let i = 1; i <= n; i++) { const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await js(`document.querySelector(${JSON.stringify(sel)}).scrollTop = ${s0 + by * e}; true`); await tick(); }
  };

  if (!PREVIEW) await cap.begin('menu', { audioSecs: 150 }); else await js('__vt.audioStart(150); true');

  // ---- 1. the lobby ----
  mm(cx, cy);
  await hold(0.6);
  await to('#btnGallery', 0.9); await hold(0.25);
  await to('#btnFriends', 0.5); await hold(0.2);
  await to('#btnShop', 1.0); await hold(0.25);
  await to('#btnWorkshop', 0.4); await hold(0.3);
  await click();
  await hold(1.2);

  // ---- 2. the Workshop: build up the car ----
  const ws = 'game.workshop';
  await js(`${ws}.orbit.yaw = -2.6; ${ws}.orbit.pitch = 0.38; ${ws}.orbit.dist = 12; true`);
  const spin = (k) => js(`${ws}.orbit.yaw += ${k}; true`);
  // a screen point on a visible face of a part next to cell T, so the ghost shows there and a click places it there
  const aim = async (T) => js(`(() => {
    const w = ${ws}, T = ${JSON.stringify(T)}, V = THREE.Vector3;
    const r = game.renderer.domElement.getBoundingClientRect();
    for (const p of w.bp.parts) {
      const d = [T.x - p.x, T.y - p.y, T.z - p.z];
      if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) !== 1) continue;
      for (const [u, v] of [[0, 0], [0.25, 0.2], [-0.25, -0.2], [0.3, -0.3], [-0.3, 0.3]]) {
        const ax = d[0] ? [1, 2] : d[1] ? [0, 2] : [0, 1];
        const q = [p.x + d[0] * 0.49, p.y + d[1] * 0.49, p.z + d[2] * 0.49]; q[ax[0]] += u; q[ax[1]] += v;
        const s = new V(q[0], q[1], q[2]).project(w.camera);
        const x = r.left + (s.x + 1) / 2 * r.width, y = r.top + (1 - s.y) / 2 * r.height;
        w.mouse.x = x; w.mouse.y = y;
        const h = w.pick();
        if (h && h.target.x === T.x && h.target.y === T.y && h.target.z === T.z) return { x, y };
      }
    }
    return null; })()`);
  const pal = async (id) => {
    const sel = `.pal-item[data-part="${id}"]`;
    // bring the part into view in the list (a smooth scroll), then point at it and pick it
    const off = await js(`(() => { const e = document.querySelector('${sel}'), box = document.getElementById('wsPalette'); const r = e.getBoundingClientRect(), b = box.getBoundingClientRect(); return r.top < b.top + 40 || r.bottom > b.bottom - 40 ? (r.top + r.height / 2) - (b.top + b.height / 2) : 0; })()`);
    if (Math.abs(off) > 1) { const z = await js(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1`); await scroll('#wsPalette', off / z, 0.35); }
    await to(sel, 0.5); await hold(0.12); await click(); await hold(0.15);
  };
  // turn the Workshop view smoothly (like dragging it), to see the face we build on
  const orbitTo = async (yaw, pitch, dur) => {
    const o = await js(`[${ws}.orbit.yaw, ${ws}.orbit.pitch]`), n = Math.max(1, Math.round(dur * 60));
    for (let i = 1; i <= n; i++) { const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await js(`${ws}.orbit.yaw = ${o[0] + (yaw - o[0]) * e}; ${ws}.orbit.pitch = ${o[1] + (pitch - o[1]) * e}; true`); await tick(); }
  };
  const place = async (T, view) => {
    if (view) await orbitTo(view[0], view[1], 0.6);
    const p = await aim(T);
    if (!p) { console.log('no face for', JSON.stringify(T)); return; }
    await move(p.x, p.y, 0.55); await hold(0.18); await click(); await hold(0.3);
  };
  // (left-side spots: the mirror builds the right side too) [part, spot, view yaw/pitch]
  const FL = [-2.55, 0.42], FLH = [-2.3, 0.75], BL = [-0.75, 0.5], BLH = [-0.9, 0.8];
  const build = [
    ['fender', { x: -1, y: 1, z: -1 }, FL], ['fender', { x: -1, y: 1, z: 1 }, FL], ['nose', { x: 0, y: 0, z: -2 }, [-2.9, 0.35]], ['cannon', { x: -1, y: 1, z: 0 }, FLH],
    ['rocket', { x: -1, y: 2, z: 0 }, FLH], ['engine', { x: 0, y: 1, z: 1 }, BLH], ['spoiler', { x: 0, y: 2, z: 1 }, BLH], ['booster', { x: 0, y: 0, z: 2 }, BL], ['exhaust', { x: -1, y: 0, z: 2 }, BL],
  ];
  for (const [id, T, view] of build) {
    await pal(id);
    await place(T, view);
  }
  await orbitTo(-2.4, 0.4, 0.8);
  // look around it: drag the view
  const mid = await at('#gl');
  await move(mid.x + 180, mid.y + 260, 0.5); await hold(0.1);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 }); press = 1;
  await move(cx - 520, cy - 40, 1.6, true);
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 }); press = 0;
  await hold(0.3);
  // paint it red, then give it a name
  await to(`#wsPaint .paint[data-color="${0xe63946}"]`, 0.7); await hold(0.15); await click(); await hold(0.5);
  await to('#wsName', 0.8); await click(); await hold(0.1);
  await js(`(() => { const e = document.getElementById('wsName'); e.focus(); e.select(); return true; })()`);
  for (const ch of 'Thunderclap') { wc.sendInputEvent({ type: 'char', keyCode: ch }); await hold(0.07); }
  await hold(0.4);
  await to('#wsSave', 0.7); await hold(0.15); await click(); await hold(0.8);
  await to('#wsBack', 0.8); await hold(0.15); await click(); await hold(1.3);

  // ---- 3. the modes ----
  await to('#arenaCard', 1.0); await hold(0.25); await click(); await hold(0.9);
  for (const sel of ['[data-mode="ball"]', '[data-mode="koth"]', '[data-mode="heist"]', '[data-mode="clash"]']) {
    const p = await at(`#panel ${sel}`);
    if (p) { await move(p.x, p.y, 0.45); await hold(0.35); }
  }
  await click(); await hold(0.6);
  if (await js("!document.getElementById('panel').classList.contains('hidden')")) { await to('#panelClose', 0.6); await click(); }
  await hold(0.6);

  // ---- 4. the Shop ----
  await to('#btnShop', 0.9); await hold(0.2); await click(); await hold(0.8);
  for (const n of [1, 2, 3]) { const p = await at(`#panel .shop-item:nth-of-type(${n})`); if (p) { await move(p.x, p.y, 0.4); await hold(0.3); } }
  await scroll('#panel .panel-box', 520, 1.4); await hold(0.2);
  const sp = await js(`(() => { const e = [...document.querySelectorAll('#panel .shop-item')].find((x) => /Orbital/.test(x.textContent)); return e ? __cur.at(e) : null; })()`);
  if (sp) { await move(sp.x, sp.y, 0.6); await hold(0.6); }
  await scroll('#panel .panel-box', 380, 1.0); await hold(0.4);
  await to('#panelClose', 0.8); await click(); await hold(0.6);

  // ---- 5. the Cog Pass: drag along the tiers ----
  await to('#btnPass', 0.9); await hold(0.2); await click(); await hold(0.9);
  const tr = await at('#panel .pt-scroll');
  if (tr) {
    await move(tr.x + 500, tr.y, 0.7); await hold(0.1);
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 }); press = 1;
    await move(cx - 900, cy + 10, 1.8, true);
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 }); press = 0;
    await hold(0.5);
  }
  await to('#panelClose', 0.8); await click(); await hold(0.6);

  // ---- 6. themes ----
  await to('#btnSettings', 1.0); await hold(0.2); await click(); await hold(0.7);
  const disp = await at('#panel [data-settab="display"]');
  if (disp) { await move(disp.x, disp.y, 0.6); await hold(0.15); await click(); await hold(0.6); }
  for (const th of ['midnight', 'ocean', 'dusk', 'graphite', '']) {
    const p = await at(`#panel [data-theme="${th}"]`);
    if (p) { await move(p.x, p.y, 0.45); await hold(0.12); await click(); await hold(0.55); }
  }
  await to('#panelClose', 0.8); await click(); await hold(0.6);

  // ---- 7. PLAY ----
  await to('#btnPlay', 1.1); await hold(0.6); await click();
  for (let i = 0; i < 60 * 14; i++) { await tick(); if (i > 120 && (await js("game.state === 'match' && game.countdown < 1.2"))) break; }
  hidden = true;
  await hold(1.0);

  if (!PREVIEW) console.log(JSON.stringify(await cap.end())); else console.log('preview pictures:', shots);
  app.exit(0);
});
