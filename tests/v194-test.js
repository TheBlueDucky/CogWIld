// Muted check of the v1.9.4 changes (hidden window, local test server on 8781):
// Workshop shapes + turning (placing, mirroring, share codes, test drive), Esc cancels a search, the PC chat docked on
// the left, "Contact us" opens the support page, the desktop title bar, the PLAY picker and Clubs screens, phones
// staying logged in, and the higher flying weight.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'v194' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);

  // ---- Workshop: a shape, turned, placed (and its mirror) ----
  await js(`${G}.openWorkshop(); true`);
  await wait(1500);
  const ws = await js(`(() => {
    const g = ${G}, w = g.workshop;
    w.load({ name: 'Shapes', parts: [{ t: 'core', x: 0, y: 0, z: 0 }] });
    w.setMirror(true);
    w.select('body:corner');
    w.turnPart(1); // a quarter turn
    w.pick = () => ({ cell: w.bp.parts[0], target: { x: 1, y: 0, z: 0 } });
    w.placeAtHover();
    const a = w.bp.parts.find((p) => p.x === 1), b = w.bp.parts.find((p) => p.x === -1);
    w.select('wheel');
    const before = w.turn;
    w.turnPart(1); // wheels can't turn
    return { a: a && CW.cleanPart(a), b: b && CW.cleanPart(b), wheelTurn: w.turn === before };
  })()`);
  check(ws.a && ws.a.t === 'body' && ws.a.s === 'corner' && ws.a.r === 1, `a Round Corner placed turned right is saved as a car body shape: ${JSON.stringify(ws.a)}`);
  check(ws.b && ws.b.s === 'corner' && (ws.b.r | 0) === 0, `its mirror copy is turned the mirrored way: ${JSON.stringify(ws.b)}`);
  check(ws.wheelTurn, 'wheels can\'t be turned (they always face forward)');
  const code = await js(`(() => { const bp = CW.decodeBp(CW.encodeBp(${G}.workshop.bp)); return bp.parts.filter((p) => p.s).map((p) => p.s + (p.r | 0)).sort().join(','); })()`);
  check(code === 'corner0,corner1', `share codes keep shapes and turns (${code})`);
  const cost = await js(`CW.analyze(${G}.workshop.bp.parts).cost`);
  check(cost === 12, `a shape costs the same as its part (${cost} Bolts for two)`);
  const pal = await js(`[...document.querySelectorAll('#wsPalette .pal-item.shape')].map((b) => b.dataset.part)`);
  check(pal.length === 10 && pal.includes('body:tube') && pal.includes('spoiler:fin') && pal.includes('cabin:tower'), `the part list has the ${pal.length} new shapes under their parts`);
  const pics = await js(`[...document.querySelectorAll('#wsPalette .pal-item.shape img')].filter((i) => i.src.startsWith('data:image')).length`);
  check(pics === 10, `every shape has a picture (${pics})`);
  // test drive: the mech in the arena has the shape and the turn
  await js(`${G}.workshop.load(CW.PRESETS.find((p) => p.id === 'jet')); ${G}.workshop.testDrive(); true`);
  await wait(3500);
  const td = await js(`(() => { const m = ${G}.player.mech; const tube = m.parts.find((p) => p.s === 'tube'); const cone = m.parts.find((p) => p.s === 'cone'); return { tube: !!tube, cone: !!cone, kids: tube && tube.obj.children.length }; })()`);
  check(td.tube && td.cone && td.kids >= 4, 'the test-driven Jet Fighter has its fuselage and nose cone shapes');
  await js(`${G}.leaveTest ? ${G}.leaveTest() : null; ${G}.showMenu(); true`);
  await wait(800);
  // a mech from another player keeps its look (online)
  const safe = await js(`(() => { const bp = ${G}.net.safeBp(CW.cloneBp(CW.PRESETS.find((p) => p.id === 'coupe'))); return bp.parts.filter((p) => p.s).map((p) => p.s + (p.r | 0)).sort().join(','); })()`);
  check(safe === 'curve0,curve2,edge2', `a mech from another player keeps its shapes and turns (${safe})`);
  check(await js(`CW.ROTOR_LIFT >= 14 && CW.WING_LIFT >= 1`), 'rotors and wings lift more (armored mechs can fly)');

  // ---- Esc cancels a search ----
  await js(`${G}.net.matchmake('clash', 'random'); true`);
  await wait(1200);
  const searching = await js(`!document.getElementById('search').classList.contains('hidden')`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(600);
  const after = await js(`({ state: ${G}.state, hidden: document.getElementById('search').classList.contains('hidden'), mm: ${G}.net.mmArena })`);
  check(searching && after.state === 'menu' && after.hidden && !after.mm, 'Esc cancels the search and goes back to the menu');
  check(await js(`/Cancel/.test(document.getElementById('srCancel').textContent) && /Esc/.test(document.getElementById('srCancel').textContent)`), 'the Cancel button shows the Esc key');

  // ---- the chat on a PC: down the whole left side ----
  await js(`${G}.talk.open(); true`);
  await wait(500);
  const dock = await js(`(() => { const r = document.getElementById('chat').getBoundingClientRect(); return { dock: document.body.classList.contains('talk-dock'), left: Math.round(r.left), top: Math.round(r.top), h: Math.round(r.height), grip: getComputedStyle(document.getElementById('chatGrip')).display }; })()`);
  check(dock.dock && dock.left === 0 && dock.top === 0 && dock.h >= 715 && dock.grip === 'none', `the PC chat fills the left side and can't be moved (${JSON.stringify(dock)})`);
  await js(`${G}.talk.close(); true`);

  // ---- Contact us → the support page ----
  const url = await js(`(() => { let u = ''; const o = CW.openExternal; CW.openExternal = (x) => { u = x; }; ${G}.meta.openPanel('settings'); const b = document.querySelector('[data-support="page"]'); b.click(); CW.openExternal = o; ${G}.meta.closePanel(); return u; })()`);
  check(/\/support\?v=[\d.]+&d=[a-z-]+$/.test(url), `Contact us opens the support page with the version and device (${url})`);
  const page = await js(`fetch('/support').then((r) => r.text())`);
  check(/Sign in with Google/.test(page) && /Email us directly/.test(page), 'the support page offers Google sign-in and an email link');

  // ---- the desktop app's own title bar ----
  const tb = await js(`(() => { CW.titleBar(32); const g = ${G}; window.dispatchEvent(new Event('resize')); const a = { top: Math.round(document.getElementById('app').getBoundingClientRect().top), vh: g.view.h, bar: getComputedStyle(document.getElementById('titleBar')).display, drag: getComputedStyle(document.getElementById('titleBar')).webkitAppRegion }; CW.titleBar(0); a.back = g.view.h; return a; })()`);
  check(tb.top === 32 && tb.vh === 688 && tb.bar === 'flex' && tb.drag === 'drag' && tb.back === 720, `the title bar sits above the game, which fits under it; fullscreen hides it (${JSON.stringify(tb)})`);

  // ---- PLAY picker ----
  await js(`${G}.meta.openPanel('arenas'); true`);
  await wait(600);
  const pk = await js(`({ specials: document.querySelectorAll('.p2-special').length, room: !!document.querySelector('#opRoom .p2-txt b'), tut: !!document.querySelector('#opTutorial .p2-txt small'), modes: document.querySelectorAll('[data-mode]').length, arenas: document.querySelectorAll('[data-arena]').length })`);
  check(pk.specials === 4 && pk.room && pk.tut && pk.modes >= 8 && pk.arenas >= 12, `the PLAY picker: 4 special matches, modes, arenas, private room + tutorial cards (${JSON.stringify(pk)})`);
  await js(`${G}.meta.closePanel(); true`);

  // ---- phones stay logged in when you log in somewhere else ----
  const kept = await js(`(() => { const a = ${G}.account; a.session = { token: 'abc', name: 'Someone' }; a.onMessage({ t: 'acctOut', reason: 'You logged in somewhere else', keep: 1 }); const k1 = !!a.session && JSON.parse(localStorage.getItem('cogwild.session') || 'null') !== null || !!a.session; a.onMessage({ t: 'acctOut', reason: 'Please log in again' }); return { k1, k2: !!a.session }; })()`);
  check(kept.k1 && !kept.k2, 'logged in elsewhere: this device keeps its login; a dead login is forgotten');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
