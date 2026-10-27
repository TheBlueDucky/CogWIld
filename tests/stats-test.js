// Muted check of the daily stats and the automatic bug reports (hidden windows): the game says what it runs on, a
// finished match counts for its mode, an error in the game and the crash screen reach the moderation page by
// themselves (with the version and platform), errors while offline wait on the device and go out on reconnect,
// errors from browser add-ons are left out, and the 📈 Stats and 🐞 Bugs tabs show it all.
// Needs the local test server on 8781 started with ADMIN_TOKEN = 'a' × 64 (see tests/README.md).
// Screenshots: tests/shots/stats-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.env.ADMIN_TOKEN || 'a'.repeat(64);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const RUN = Math.random().toString(36).slice(2, 8); // each run's test crash is a new bug
const api = (p) => new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 8781, path: '/admin/api/' + p, headers: { 'X-Admin-Token': TOKEN } }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } }); }).on('error', () => res(null));
});

app.whenReady().then(async () => {
  const errors = [];
  // both windows first (a fresh window after a destroyed one can fail to load)
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'stats' + Date.now() } });
  const adm = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, partition: 'statsadm' + Date.now() } });
  for (const w of [win, adm]) w.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::|test bug|stats test crash|reading 'nope'/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (w, n) => fs.writeFileSync(path.join(OUT, 'stats-' + n + '.png'), (await w.webContents.capturePage()).toPNG());

  const before = await api('stats');
  check(!!before, 'the moderation API answers (server started with ADMIN_TOKEN)');
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0 } })); location.reload(); true`);
  await wait(5000);
  const plat = await js(`CW.platName()`);
  let st = await api('stats');
  check(plat === 'windows' && st.today.n === before.today.n + 1 && (st.today.plat.windows | 0) === (before.today.plat.windows | 0) + 1, `the game counts as one more player today, on "${plat}"`);

  // a finished match reports its mode (the same call the results screen makes)
  await js(`${G}.meta.addCoins(40, 'match', null, 10, 40, { mode: 'gold', on: false }); true`);
  await wait(500);
  st = await api('stats');
  check((st.today.modes.gold | 0) === (before.today.modes.gold | 0) + 1, 'a finished Gold Rush match is counted');

  // an error in the game, and the crash screen
  await js(`setTimeout(() => { const o = null; o.nope(); }, 0); true`);
  // a real crash inside the game's loop (one step of it throws once; the crash screen catches it)
  await js(`(() => { const g = ${G}, s = g.supers, u = s.update; s.update = function () { s.update = u; throw new Error('stats test crash ' + '${RUN}'); }; return true; })()`);
  await wait(1500);
  check(await js(`!document.getElementById('crash').classList.contains('hidden')`), 'the crash screen shows');
  let bugs = (await api('bugs')).bugs;
  const thrown = bugs.find((b) => /reading 'nope'|null/.test(b.msg) && b.plats.windows);
  const crash = bugs.find((b) => b.msg.includes('stats test crash ' + RUN));
  const ver = await js('CW.VERSION');
  check(!!thrown && thrown.vers[ver] >= 1, `an error in the game reaches the Bugs list by itself (${thrown ? thrown.msg : 'missing'})`);
  check(!!crash && crash.kind === 'crash' && /menu|match/.test(Object.keys(crash.states)[0]) && /game\.js/.test(crash.stack) && /^game\.js:\d+:\d+$/.test(crash.where), 'the crash screen\'s error arrives as a crash, with the screen and where in the code');
  await js(`document.getElementById('crashMenu').click(); true`);

  // offline: kept on the device, sent on the next connection
  await js(`${G}.net.ws.close(); true`);
  await wait(800);
  await js(`CW.Bugs.report(new Error('test bug while offline'), 'error'); true`);
  const kept = await js(`JSON.parse(localStorage.getItem('cogwild.bugs') || '[]').length`);
  check(kept === 1, 'an error while offline waits on the device');
  await js(`${G}.account.connect(); true`);
  await wait(2500);
  bugs = (await api('bugs')).bugs;
  check(bugs.some((b) => /test bug while offline/.test(b.msg)) && (await js(`localStorage.getItem('cogwild.bugs')`)) === null, '...and goes out when the game is back online');

  // a browser add-on's error is not the game's
  await js(`window.dispatchEvent(new ErrorEvent('error', { message: 'test bug from an add-on', filename: 'chrome-extension://abcdef/content.js', lineno: 1, colno: 1 })); true`);
  await wait(600);
  check(!(await api('bugs')).bugs.some((b) => /add-on/.test(b.msg)), 'errors from browser add-ons are left out');

  // the moderation page
  await adm.loadURL('http://localhost:8781/admin');
  await wait(600);
  await adm.webContents.executeJavaScript(`document.getElementById('key').value = '${TOKEN}'; document.getElementById('open').click(); true`);
  await wait(900);
  await adm.webContents.executeJavaScript(`document.querySelector('[data-tab="stats"]').click(); true`);
  await wait(900);
  const tiles = await adm.webContents.executeJavaScript(`document.getElementById('view').innerText`);
  check(/Players today/.test(tiles) && /Windows app/.test(tiles) && /Gold Rush/.test(tiles) && /Day by day/.test(tiles), 'the 📈 Stats tab shows players, platforms, modes and the day-by-day table');
  await shot(adm, 'admin-stats');
  await adm.webContents.executeJavaScript(`document.querySelector('[data-tab="bugs"]').click(); true`);
  await wait(900);
  const btxt = await adm.webContents.executeJavaScript(`document.getElementById('view').innerText + ' | ' + document.querySelector('[data-tab="bugs"]').textContent`);
  check(btxt.includes('stats test crash ' + RUN) && /crash screen/.test(btxt) && /Mark fixed/.test(btxt) && /Bugs \(\d+\)/.test(btxt), 'the 🐞 Bugs tab lists them with a count');
  await shot(adm, 'admin-bugs');
  await adm.webContents.executeJavaScript(`[...document.querySelectorAll('[data-bugdone]')].find((b) => b.closest('.card').innerText.includes('stats test crash ' + '${RUN}')).click(); true`);
  await wait(1200);
  bugs = (await api('bugs')).bugs;
  check(bugs.find((b) => b.msg.includes('stats test crash ' + RUN)).done > 0, '"Mark fixed" from the page works');

  check(errors.length === 0, `no other console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
