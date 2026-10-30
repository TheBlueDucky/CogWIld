// Muted check of the tutorial (hidden windows): the small see-through card, keys lighting up on a PC, the arrow at what
// to do next (Target, gem, your mech; on a phone also the button to press, with a ring), and finishing it.
// Needs the local test server on 8781 (tests/README.md).
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
  const mk = (w, h, tag) => new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: tag + Date.now() } });
  const PC = mk(1280, 720, 'tp'), PH = mk(915, 412, 'tph');
  for (const [win, touch] of [[PC, 'off'], [PH, 'on']]) {
    win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
    await win.loadURL('http://localhost:8781/');
    await win.webContents.executeJavaScript(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 0, settings: { music: 0, sfx: 0, volume: 0, touch: '${touch}' } })); location.reload();`);
  }
  await wait(4000);
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const shot = async (w, n) => fs.writeFileSync(path.join(OUT, n + '.png'), (await w.webContents.capturePage()).toPNG());
  // jump to step n (the earlier steps are tested by the game's own checks)
  const goto = (w, n) => js(w, `(() => { const t = ${G}.tutorial; while (t.i < ${n}) t.next(); return t.i; })()`);
  const arrow = (w) => js(w, `(() => { const a = document.getElementById('tutArrow'), r = document.getElementById('tutRing'); const b = a.getBoundingClientRect(); return { shown: !a.classList.contains('hidden'), x: b.left + b.width / 2, y: b.top + b.height / 2, label: document.getElementById('tutArrowLbl').textContent, ring: !r.classList.contains('hidden'), title: document.getElementById('tutTitle').textContent }; })()`);

  // ---- PC ----
  await js(PC, `document.getElementById('firstYes').click(); true`);
  await wait(4000);
  const card = await js(PC, `(() => { const c = document.getElementById('tut'), b = c.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.getElementById('hud')).zoom) || 1; return { shown: !c.classList.contains('hidden'), w: b.width * z, h: b.height * z, bg: getComputedStyle(c).backgroundColor, keys: document.querySelectorAll('#tutKeys kbd').length }; })()`);
  check(card.shown && card.w < 450 && card.h < 190, `the tutorial card is small (${Math.round(card.w)}×${Math.round(card.h)} px)`);
  check(/rgba\(.*0\.5\)/.test(card.bg), `and see-through (${card.bg})`);
  await shot(PC, 'tut-pc-1-look');
  // looking around finishes step 1
  await js(PC, `${G}.cam.yaw += 0.85; ${G}.cam.pitch -= 0.45; true`); // (v1.10.1: mouse steering keeps the view within ~50° of the mech)
  await wait(500);
  check(await js(PC, `${G}.tutorial.i === 1 && /W/.test(document.getElementById('tutKeys').textContent)`), 'looking around moves on to "Drive", which shows the W key');
  PC.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W' });
  await wait(400);
  check(await js(PC, `document.querySelector('#tutKeys kbd[data-k="KeyW"]').classList.contains('down')`), 'the W key lights up while it is held');
  await shot(PC, 'tut-pc-2-drive');
  await wait(2500);
  PC.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W' });
  check(await js(PC, `${G}.tutorial.i >= 2`), 'driving forward finishes "Drive"');
  await goto(PC, 3);
  await wait(600);
  const shoot = await arrow(PC);
  check(shoot.shown && shoot.label === 'Target', `"Shoot": an arrow points at the Target (${JSON.stringify(shoot)})`);
  await shot(PC, 'tut-pc-4-shoot');
  await goto(PC, 5);
  await wait(600);
  const gem = await arrow(PC);
  check(gem.shown && gem.label === 'Gem', '"Power-up": an arrow points at the green gem');
  await shot(PC, 'tut-pc-6-gem');
  await goto(PC, 6);
  PC.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'E' });
  PC.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'E' });
  await wait(1200);
  check(await js(PC, `${G}.tutorial.i === 7`), 'pressing E gets out ("Get out" done)');
  // walk away so your mech is behind you: the arrow sits at the edge, pointing back
  await js(PC, `${G}.cam.yaw += Math.PI; true`);
  await wait(600);
  const back = await arrow(PC);
  check(back.shown && back.label === 'Your mech', `"Get back in": an arrow points to your mech (${JSON.stringify(back)})`);
  await shot(PC, 'tut-pc-8-back');
  // finishing: the card and arrow go away, coins are paid
  await js(PC, `${G}.tutorial.finish(true); true`);
  await wait(800);
  check(await js(PC, `${G}.state === 'menu' && document.getElementById('tutArrow').classList.contains('hidden') && ${G}.settings.tutorialDone`), 'finishing goes back to the menu and hides the arrow');

  // ---- phone ----
  await js(PH, `document.getElementById('firstYes').click(); true`);
  await wait(4000);
  await shot(PH, 'tut-phone-1-look');
  check((await arrow(PH)).label === 'drag here', 'phone "Look around": the arrow says where to drag');
  await goto(PH, 1);
  await wait(500);
  const stick = await arrow(PH);
  const stickBox = await js(PH, `(() => { const r = document.getElementById('tStick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; })()`);
  check(stick.shown && stick.ring && Math.hypot(stick.x - stickBox.x, stick.y - stickBox.y) < stickBox.r + 90, `phone "Drive": an arrow and a ring at the stick (${JSON.stringify(stick)})`);
  await shot(PH, 'tut-phone-2-drive');
  await goto(PH, 3);
  await wait(500);
  check((await arrow(PH)).label === 'Target', 'phone "Shoot": the arrow points at the Target');
  await shot(PH, 'tut-phone-4-shoot');
  await goto(PH, 4);
  await wait(500);
  const dash = await arrow(PH);
  const dashBox = await js(PH, `(() => { const r = document.querySelector('.t-dash').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  check(dash.ring && Math.hypot(dash.x - dashBox.x, dash.y - dashBox.y) < 140, 'phone "Dash": the arrow and ring are at the 💨 button');
  await shot(PH, 'tut-phone-5-dash');
  await goto(PH, 6);
  await wait(500);
  await shot(PH, 'tut-phone-7-exit');
  await js(PH, `${G}.tutorial.finish(false); true`);

  console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
