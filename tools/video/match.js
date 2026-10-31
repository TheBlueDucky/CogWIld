// One match played by the showcase pilot (tools/video), from a seed: the same seed always plays the same match.
//   npx electron match.js <clash|ball> <seed> [arena] [tod]
//       plays it quickly without drawing it and writes what happened (dist/youtube/raw/sim-<kind>-<seed>-<arena>.json)
//   npx electron match.js <clash|ball> <seed> [arena] [tod] --rec NAME --segs 1200-1900,5000-5600
//       plays the same match again and records those frame ranges (fast-forwarding between them):
//       dist/youtube/raw/NAME-1.mp4 + .wav, NAME-2.mp4 + .wav, ...
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeWindow, Capture, openGame, MS, OUT } = require('./cap');
const argv = process.argv.slice(2).filter((a) => !/electron(\.exe)?$|match\.js$/.test(a));
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const kind = pos[0] || 'clash', seed = +(pos[1] || 1), arena = pos[2] || (kind === 'ball' ? 'stadium' : 'canyon'), tod = pos[3] || 'day';
const mode = kind === 'ball' ? 'ball' : 'clash';
const rec = opt('--rec');
const segs = (opt('--segs') || '').split(',').filter(Boolean).map((s) => s.split('-').map(Number));
const LIMIT = 60 * 420;

app.whenReady().then(async () => {
  const win = makeWindow();
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await openGame(win, process.env.NOMUSIC ? { music: false } : undefined); // NOMUSIC: sound effects only (a song goes on top)
  for (const f of ['vt-page.js', 'setup-page.js', 'pilot-page.js']) await js(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  await js(`__vt.enable(); for (let i = 0; i < 6; i++) __vt.step(-1, ${MS}); true`); // the clock settles on virtual time first
  // not drawn while fast-forwarding, but everything drawing does to the scene (object matrices) still happens, so the
  // match plays exactly the same whether a frame is drawn or not
  await js(`(() => { const r = game.renderer; r.__render = r.render; r.__skip = (scene, cam) => { if (scene.autoUpdate !== false) scene.updateMatrixWorld(); if (cam && cam.parent === null) cam.updateMatrixWorld(); }; r.render = r.__skip; return true; })()`);
  await js(`__vt.seed(${seed}); game.time = 0; true`);
  if (process.env.DBG) await js('window.__pdbg = []; true');
  const info = await js(`__setup.start('${kind}', '${mode}', '${arena}', { tod: '${tod}', format: ${JSON.stringify(process.env.FORMAT || '')} || undefined })`);
  // short videos: only the big messages, none of the small pop-ups and lines
  if (process.env.CLEANHUD) await js(`document.getElementById('__vidcss').textContent += '#notes, #toast, #feed, #chestHint, #flyHint { display: none !important; }'; true`);
  let f = 0, state = 'match';
  // quick steps up to frame `to` (testing: or the end of the match)
  const fast = async (to) => {
    while (f < to) {
      const n = Math.min(300, to - f);
      const st = await js(`(() => { for (let i = 0; i < ${n}; i++) { __vt.step(${f} + i, ${MS}); if (game.state !== 'match' && ${!rec}) return [game.state, i + 1]; } return [game.state, ${n}]; })()`);
      f += st[1]; state = st[0];
      if (!rec && state !== 'match') return;
    }
  };
  const caps = [];
  // the hidden window makes no pictures while nothing is recorded (testing, fast-forwarding): much lighter
  win.webContents.stopPainting();
  if (!rec) await fast(LIMIT);
  else {
    let k = +(process.env.FIRST || 1) - 1; // (FIRST=6: the pieces are numbered from 6, to add to an earlier recording)
    for (const [a, b] of segs) {
      await fast(a);
      await js('game.renderer.render = game.renderer.__render; true');
      win.webContents.startPainting(); win.webContents.setFrameRate(120); win.webContents.invalidate();
      const cap = new Capture(win);
      await cap.begin(`${rec}-${++k}`, { audioSecs: (b - a) / 60 + 4 });
      const t0 = Date.now();
      let lt = Date.now(), lf = f;
      while (f < b) {
        await cap.step(); f++;
        if (process.env.PROG && (f - a) % 120 === 0) { const T = cap.tm; console.log(`  ${f - a} frames: ${(120 / ((Date.now() - lt) / 1000)).toFixed(1)} fps  js ${T.js} paint ${T.paint} write ${T.write}`); lt = Date.now(); }
      }
      const r = await cap.end();
      caps.push(Object.assign({ seg: k, from: a, to: b }, r));
      if (process.env.DIAG) console.log('DIAG', JSON.stringify(await js(`(() => { let n = 0, vis = 0; game.scene.traverse((o) => { n++; if (o.visible) vis++; }); const i = game.renderer.info; return { objects: n, visible: vis, calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, progs: (i.programs || []).length, fx: game.fx.particles ? game.fx.particles.length : null, proj: game.fx.projectiles.length, timers: __vt.V.timers.size, mechs: game.mechs.length }; })()`)));
      console.log(`piece ${k}: frames ${a}-${b} in ${Math.round((Date.now() - t0) / 1000)} s (${r.capFps} fps)`);
      await js('game.renderer.render = game.renderer.__skip; true');
      win.webContents.stopPainting();
    }
  }
  const r = await js(`(() => { const p = game.player, P = __pilot; const ev = P.ev; const cnt = (k) => ev.filter((e) => e.k === k).length;
    return { won: !!game.won, place: p.place, secs: Math.round(game.matchTime), wrecks: cnt('wreck'), died: cnt('died'), pilotkills: cnt('pilotkill'), stats: P.stats,
      score: game.obj && game.obj.score, hp: p.mech && p.mech.alive ? +p.mech.integrity().toFixed(2) : 0,
      wreckAt: ev.filter((e) => e.k === 'wreck').map((e) => e.f), deaths: ev.filter((e) => e.k === 'died').map((e) => e.by + '@' + e.t),
      goals: ev.filter((e) => e.k === 'goal').map((e) => (e.mine ? 'us ' : 'them ') + e.by + '@' + e.f),
      touches: ev.filter((e) => e.k === 'touch').length, goodTouches: ev.filter((e) => e.k === 'touch' && e.toGoal > 0.7 && e.sp > 18).length, events: ev }; })()`);
  const out = Object.assign({ kind, seed, arena: info.arena, tod: info.tod, frames: f, endState: state }, r, rec ? { caps } : {});
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'raw', rec ? rec + '.json' : `sim-${kind}-${seed}-${arena}.json`), JSON.stringify(out, null, 1));
  if (process.env.DBG) fs.writeFileSync(process.env.DBG, JSON.parse(await js('JSON.stringify(window.__pdbg)')).map((r) => JSON.stringify(r)).join(String.fromCharCode(10)));
  delete out.events;
  console.log('RESULT ' + JSON.stringify(out));
  app.exit(0);
});
