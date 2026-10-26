// Muted check of the mech gallery (hidden window): a player shares a mech with 🌍 Share, another one is shared from a
// second connection, the gallery shows both with pictures, filters and search work, a mech opens up close (turning
// 3D view + stats), ❤ like, 📋 copy into the Workshop, 🏁 try it and come back to it, Esc closes things in order,
// and it fits a phone screen.
// Needs a fresh local test server on 8781 (tests/README.md). Screenshots: tests/shots/gallery-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const until = async (js, cond, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(150); } return false; };

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'gallery-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  const key = async (k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third', timeOfDay: 'day' } })); location.reload();`);
  await wait(4500);
  const N = 'Gal' + Math.floor(Math.random() * 9000 + 1000);

  // someone else shares a Monster Truck (a second connection from this page)
  const other = await js(`new Promise((res) => {
    const ws = new WebSocket(${G}.net.url());
    const mt = CW.PRESETS.find((p) => p.id === 'monster');
    ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'hello', name: 'x', ver: 'cogwild-net-10' })); ws.send(JSON.stringify({ t: 'acctRegister', name: '${N}b', pass: 'galpass1' })); }
      if (m.t === 'acctOk') ws.send(JSON.stringify({ t: 'galPublish', bp: { name: 'Mud Stomper', color: 0xff8800, parts: mt.parts } }));
      if (m.t === 'galPublished' || m.t === 'acctErr') { res(m.t === 'galPublished' ? m.item.n : m.msg); ws.close(); }
    }; })`);
  check(other === 'Mud Stomper', `another player shares a mech (${other})`);

  // log in, then 🌍 Share our own Street Racer from the gallery
  await js(`(() => { const g = ${G}; g.setCurrentBp(Object.assign(CW.cloneBp(CW.PRESETS.find((p) => p.id === 'racer')), { name: 'Neon Dart' })); g.net.connect().then(() => g.net.send({ t: 'acctRegister', name: '${N}', pass: 'galpass1' })); return true; })()`);
  check(await until(js, `${G}.account.loggedIn`), 'logged in');
  await js(`${G}.gallery.open(); true`);
  check(await until(js, `document.querySelectorAll('.gal-card').length === 1`), 'the gallery shows the shared mech');
  await js(`document.getElementById('galShare').click(); true`);
  await wait(500);
  const share = await js(`(() => ({ open: !document.getElementById('galShareBox').classList.contains('hidden'), picks: document.querySelectorAll('.gal-pcard').length, name: document.getElementById('galName').value, pic: (document.querySelector('[data-ppic="0"]') || {}).src || '' }))()`);
  check(share.open && share.picks >= 1 && share.name === 'Neon Dart' && share.pic.startsWith('data:image/png'), `🌍 Share shows your mechs with pictures (${share.picks}, "${share.name}")`);
  await shot('share');
  await js(`document.getElementById('galSend').click(); true`);
  check(await until(js, `${G}.gallery.q.sort === 'mine' && document.querySelectorAll('.gal-card').length === 1`), 'shared: it shows under 👤 Mine');
  // everything
  await js(`document.querySelector('[data-sort="new"]').click(); true`);
  check(await until(js, `document.querySelectorAll('.gal-card').length === 2 && [...document.querySelectorAll('.gal-pic img')].length === 2`, 8000), 'two mechs, each with its picture');
  await wait(300);
  await shot('grid');
  // filters + search
  await js(`document.querySelector('[data-tag="air"]').click(); true`);
  check(await until(js, `document.querySelector('.gal-empty') !== null`), 'the ✈ Air filter (none of these fly)');
  await js(`document.querySelector('[data-tag="all"]').click(); true`);
  await until(js, `document.querySelectorAll('.gal-card').length === 2`);
  await js(`(() => { const s = document.getElementById('galSearch'); s.value = 'stomp'; s.dispatchEvent(new Event('input')); return true; })()`);
  check(await until(js, `document.querySelectorAll('.gal-card').length === 1 && document.querySelector('.gal-card b').textContent === 'Mud Stomper'`), 'search finds "Mud Stomper"');
  // up close
  await js(`document.querySelector('.gal-card').click(); true`);
  await wait(900);
  const d = await js(`(() => ({ open: !document.getElementById('galDetail').classList.contains('hidden'), canvas: !!document.querySelector('#galView canvas'), title: (document.querySelector('.gal-info h2') || {}).textContent, stats: document.querySelectorAll('.gal-stats div').length }))()`);
  check(d.open && d.canvas && d.title === 'Mud Stomper' && d.stats === 6, 'a mech opens up close: turning 3D view, name, 6 stats');
  await shot('detail');
  await js(`document.getElementById('galLike').click(); true`);
  check(await until(js, `(document.getElementById('galLike') || {}).textContent === '❤ Liked'`), '❤ like');
  const bps = await js(`${G}.blueprints.length`);
  await js(`document.getElementById('galCopy').click(); true`);
  check(await until(js, `${G}.blueprints.length === ${bps + 1} && ${G}.blueprints[0].name === 'Mud Stomper' && ${G}.currentBp.name === 'Mud Stomper'`), '📋 copy puts it in your Workshop as your mech');
  check(await until(js, `/📋 1/.test(document.querySelector('.gal-stats').textContent)`), 'the copy is counted');
  // try it, then back
  await js(`document.getElementById('galTry').click(); true`);
  await wait(1200);
  const tr = await js(`(() => ({ state: ${G}.state, mode: ${G}.modeId, back: document.getElementById('testBack').textContent }))()`);
  check(tr.state === 'match' && tr.mode === 'test' && /gallery/.test(tr.back), `🏁 Try it: a test drive ("${tr.back}")`);
  await key('T');
  check(await until(js, `${G}.state === 'menu' && ${G}.meta.panel === 'gallery' && !document.getElementById('galDetail').classList.contains('hidden')`), 'T comes back to that mech in the gallery');
  await key('Escape');
  check(await js(`document.getElementById('galDetail').classList.contains('hidden') && !document.getElementById('panel').classList.contains('hidden')`), 'Esc closes the mech first');
  // phone size
  win.setContentSize(915, 412);
  await wait(600);
  await shot('phone');
  await js(`document.querySelector('.gal-card').click(); true`);
  await wait(800);
  await shot('phone-detail');
  win.setContentSize(1280, 720);
  await key('Escape');
  await key('Escape');
  check(await js(`document.getElementById('panel').classList.contains('hidden')`), 'Esc again closes the gallery');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
