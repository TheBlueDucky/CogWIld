// Muted check that aiming turns the same on every computer (hidden window): a browser that reports mouse movement
// times the screen's pixel ratio (Chrome on many Chromebooks) is noticed in the menus and divided back; a normal
// browser is left alone; one huge made-up jump is ignored while real fast turns still count. Needs the local test
// server on 8781.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'mspeed' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);

  // pointer moves in the menus: movement = ratio × the pointer's real move, pixel ratio pretended to be `dpr`
  const menuMoves = (ratio, dpr) => js(`(() => { const g = ${G}; Object.defineProperty(window, 'devicePixelRatio', { get: () => ${dpr}, configurable: true });
    g.mouseRatios = []; g.mouseFix = 1; g.mouseLastX = undefined;
    for (let i = 0; i < 30; i++) window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + i * 10, clientY: 300, movementX: Math.round(10 * ${ratio}) }));
    return g.mouseFix; })()`);
  check((await menuMoves(2, 2)) === 2, 'a Chromebook-style browser (movement 2× at pixel ratio 2) is noticed in the menus');
  check((await menuMoves(1.25, 1.25)) === 1.25, 'the same at pixel ratio 1.25');
  check((await menuMoves(1, 2)) === 1, 'a normal browser on a sharp screen is left alone');
  check((await menuMoves(1, 1)) === 1, 'a normal browser on a normal screen is left alone');

  // in a match: turning with a pretend-caught mouse
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(3000);
  const turn = (moves, fix) => js(`(async () => { const g = ${G}; const cv = g.renderer.domElement;
    Object.defineProperty(document, 'pointerLockElement', { get: () => cv, configurable: true });
    g.mouseFix = ${fix}; g.mouseUsual = 0; g.paused = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const y0 = g.cam.yaw;
    for (const m of ${JSON.stringify(moves)}) { window.dispatchEvent(new MouseEvent('mousemove', { movementX: m, movementY: 0 })); await new Promise((r) => requestAnimationFrame(r)); }
    await new Promise((r) => requestAnimationFrame(r));
    const d = y0 - g.cam.yaw; delete document.pointerLockElement; return d; })()`);
  const step = 0.0023; // radians per pixel at sensitivity 1
  const normal = await turn([20, 20, 20, 20, 20], 1);
  check(Math.abs(normal - 100 * step) < 1e-6, `normal aiming: 100 px turns ${(normal * 180 / Math.PI).toFixed(1)}°`);
  const fixed = await turn([40, 40, 40, 40, 40], 2);
  check(Math.abs(fixed - 100 * step) < 1e-6, `Chromebook-style: the same hand move turns the same ${(fixed * 180 / Math.PI).toFixed(1)}°`);
  const spike = await turn([5, 5, 5, 1400, 5, 5], 1);
  check(Math.abs(spike - 25 * step) < 1e-6, `one made-up 1400 px jump is ignored (turned ${(spike * 180 / Math.PI).toFixed(1)}° instead of a whole circle)`);
  const flick = await turn([60, 150, 300, 320, 280, 120], 1);
  check(Math.abs(flick - 1230 * step) < 1e-6, `a real fast flick still counts fully (${(flick * 180 / Math.PI).toFixed(0)}°)`);

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
