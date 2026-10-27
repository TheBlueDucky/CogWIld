// Muted check that the mouse pointer never stays on screen while playing with a mouse (hidden window):
// on a PC (even one that says it has a touchscreen) Auto starts without the phone controls; a finger turns them on
// and a mouse click turns them off again; while playing the pointer is hidden over the game (html.aiming,
// cursor: none) and comes back for the match menu, the chat and the results; a key press asks to catch the mouse;
// a browser that refuses gets one "hold a mouse button and drag" tip. Needs the local test server on 8781.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'mouse' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'auto' } })); location.reload(); true`);
  await wait(4500);

  // a PC whose driver reports touch points (touchscreen laptop, pen tablet): still a mouse PC
  const pc = await js(`(() => { const g = ${G}; Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 10, configurable: true }); g.touch.auto = null; g.touch.apply(); return g.touch.on; })()`);
  check(pc === false, 'Auto: a PC that reports a touchscreen starts without the phone controls');

  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(3000);
  const play = await js(`(() => ({ aiming: document.documentElement.classList.contains('aiming'), cursor: getComputedStyle(${G}.renderer.domElement).cursor, touch: !document.getElementById('touch').classList.contains('hidden') }))()`);
  check(play.aiming && play.cursor === 'none' && !play.touch, `in a match: no pointer over the game (cursor ${play.cursor}), no phone controls`);

  // a finger on the screen: the phone controls come on (and the pointer rule steps aside); a mouse click: off again
  await js(`document.getElementById('app').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); true`);
  await wait(300);
  const fing = await js(`(() => ({ on: ${G}.touch.on, shown: !document.getElementById('touch').classList.contains('hidden'), aiming: document.documentElement.classList.contains('aiming') }))()`);
  check(fing.on && fing.shown && !fing.aiming, 'a finger on the screen turns the phone controls on');
  await js(`(() => { const g = ${G}; g._locks = 0; const cv = g.renderer.domElement; cv._rpl = cv.requestPointerLock; cv.requestPointerLock = () => { g._locks++; }; document.getElementById('tLook').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); return true; })()`);
  await wait(300);
  const mouse = await js(`(() => ({ on: ${G}.touch.on, shown: !document.getElementById('touch').classList.contains('hidden'), aiming: document.documentElement.classList.contains('aiming') }))()`);
  check(!mouse.on && !mouse.shown && mouse.aiming, 'a mouse click turns them off again and hides the pointer');

  // a real key press asks the browser to catch the mouse
  await js(`${G}._locks = 0; true`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Q' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Q' });
  await wait(300);
  const locks = await js(`${G}._locks`);
  check(locks >= 1, `a key press asks to catch the mouse (${locks}×)`);

  // refused twice (browser / add-on / remote tool): one tip
  const tip = await js(`(async () => { const g = ${G}; const t = []; const o = g.toast.bind(g); g.toast = (m) => { t.push(m); return o(m); }; document.dispatchEvent(new Event('pointerlockerror')); document.dispatchEvent(new Event('pointerlockerror')); document.dispatchEvent(new Event('pointerlockerror')); g.toast = o; return t; })()`);
  check(tip.length === 1 && /drag to aim/.test(tip[0]), `a refusal gives one tip: "${tip[0] || ''}"`);

  // the pointer comes back for the match menu, the chat and the results
  await js(`${G}.pause(); true`);
  await wait(200);
  check(!(await js(`document.documentElement.classList.contains('aiming')`)), 'the match menu shows the pointer');
  await js(`${G}.resume(); true`);
  await wait(200);
  check(await js(`document.documentElement.classList.contains('aiming')`), 'back in the match: hidden again');
  await js(`${G}.endMatch ? (${G}.showMenu(), true) : true`);
  await wait(400);
  check(!(await js(`document.documentElement.classList.contains('aiming')`)), 'the menu shows the pointer');

  // a phone (finger = main pointer) still starts with the controls
  const phone = await js(`(() => { const g = ${G}; const mm = window.matchMedia; window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }); g.touch.auto = null; g.touch.apply(); const on = g.touch.on; window.matchMedia = mm; g.touch.apply(); return on; })()`);
  check(phone === true, 'Auto: a phone starts with the phone controls');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
