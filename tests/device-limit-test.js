// v1.10.5 security checks (hidden, muted windows; local test server on 8781 with SIGNUPS_PER_HOUR=100):
// - a device makes at most 3 accounts, ever (deleting one doesn't free a place); it's known by the game's own ID, the
//   website's cookie and the app's hardware ID, so changing one of them isn't enough; logging in still works
// - the real game sends its device ID, and the website gets its device cookie
// - the game still starts from a local file (how the apps load it) with the new Content-Security-Policy, with no errors
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:8781';
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const hex = () => require('crypto').randomBytes(32).toString('hex');

app.whenReady().then(async () => {
  // one window per "browser" (its own cookies); the page talks to the server the way the game does
  const browser = async (name) => {
    const partition = 'dev-' + name + Date.now();
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true, partition } });
    win.webContents.setAudioMuted(true);
    await win.loadURL(BASE + '/privacy.html');
    return { win, partition, js: (c) => win.webContents.executeJavaScript(c) };
  };
  // connect, say hello with these device IDs, send one account message, and return the answer
  const ask = (B, dev, msg) => B.js(`new Promise((res) => {
    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'hello', name: 'x', ver: 'cogwild-net-11', plat: 'web', dev: ${JSON.stringify(dev)} })); ws.send(JSON.stringify(${JSON.stringify(msg)})); }
      if (m.t === 'acctOk' || m.t === 'acctErr') { ws.close(); res({ t: m.t, msg: m.msg || '', token: m.token || '' }); } };
    setTimeout(() => res({ t: 'timeout' }), 8000);
  })`);
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const reg = (B, dev, n) => ask(B, dev, { t: 'acctRegister', name: `Dv${tag}${n}`, pass: 'devpass1' });

  // ---- a device makes 3 accounts, then no more ----
  const A = await browser('a');
  const devA = { ls: hex(), hw: hex() };
  const made = [];
  for (let i = 1; i <= 3; i++) made.push(await reg(A, devA, 'a' + i));
  check(made.every((r) => r.t === 'acctOk'), 'a device makes its first 3 accounts');
  const fourth = await reg(A, devA, 'a4');
  check(fourth.t === 'acctErr' && /already made 3/.test(fourth.msg), `the 4th is refused (${fourth.msg})`);
  // deleting one doesn't free a place
  const del = await A.js(`new Promise((res) => {
    const ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'acctAuth', token: '${made[2].token}' }));
      if (m.t === 'acctOk') ws.send(JSON.stringify({ t: 'acctDelete', pass: 'devpass1' }));
      if (m.t === 'acctOut') { ws.close(); res(m.reason || ''); } };
    setTimeout(() => res('timeout'), 8000);
  })`);
  check(/deleted/i.test(del), 'one of them is deleted');
  check((await reg(A, devA, 'a5')).t === 'acctErr', 'still refused after deleting one (it counts accounts ever made)');
  // a new game ID on the same browser: its cookie still knows it
  check((await reg(A, { ls: hex(), hw: null }, 'a6')).t === 'acctErr', 'clearing the game\'s own ID isn\'t enough (the website cookie remembers)');
  // a fresh browser (no cookie, new game ID) on the same phone / PC: its hardware ID knows it
  const A2 = await browser('a2');
  check((await reg(A2, { ls: hex(), hw: devA.hw }, 'a7')).t === 'acctErr', 'reinstalling the app isn\'t enough (the hardware ID remembers)');
  // the same game ID in a fresh browser
  const A3 = await browser('a3');
  check((await reg(A3, { ls: devA.ls, hw: null }, 'a8')).t === 'acctErr', 'the game\'s own ID is remembered too');
  // email sign-up is refused the same way, before any code is emailed
  const su = await ask(A, devA, { t: 'acctSignup', email: `dv${tag}@example.com`, name: `Dv${tag}s`, pass: 'devpass1' });
  check(su.t === 'acctErr' && /already made 3/.test(su.msg), 'email sign-up is refused on a full device too');
  // logging in to an account it made still works
  const li = await ask(A, devA, { t: 'acctLogin', name: `Dv${tag}a1`, pass: 'devpass1' });
  check(li.t === 'acctOk', 'logging in to an existing account still works on a full device');
  // another device is fine
  const B = await browser('b');
  check((await reg(B, { ls: hex(), hw: hex() }, 'b1')).t === 'acctOk', 'another device can still make accounts');

  // ---- the real game sends its device ID; the website gets its device cookie ----
  const G = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { offscreen: true, partition: 'dev-game' + Date.now() } });
  G.webContents.setAudioMuted(true);
  await G.loadURL(BASE + '/');
  await wait(3500);
  const gid = await G.webContents.executeJavaScript(`(async () => { const g = window.game || CW.game; await g.net.connect(); const d = g.net.deviceIds(); return { d, saved: localStorage.getItem('cogwild.device') }; })()`);
  check(/^[0-9a-f]{64}$/.test(gid.d.ls || '') && gid.d.ls === gid.saved && gid.d.hw === null, 'the game keeps a random device ID (no hardware ID on the website)');
  const again = await G.webContents.executeJavaScript(`(window.game || CW.game).net.deviceIds().ls`);
  check(again === gid.d.ls, 'the device ID stays the same');
  const cookies = await G.webContents.session.cookies.get({ name: 'cw_d' });
  check(cookies.length === 1 && cookies[0].httpOnly && /^[0-9a-f]{64}$/.test(cookies[0].value), 'the website set its HttpOnly device cookie');

  // ---- the game starts from a local file (like the apps) with the Content-Security-Policy ----
  const errs = [];
  const F = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { offscreen: true, partition: 'dev-file' + Date.now() } });
  F.webContents.setAudioMuted(true);
  F.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::|WebSocket|ERR_/.test(msg)) errs.push(msg); if (/Content Security Policy|Refused to/.test(msg)) errs.push(msg); });
  await F.loadFile(path.join(__dirname, '..', 'index.html'));
  await wait(4000);
  const boot = await F.webContents.executeJavaScript(`({ game: !!(window.game || (window.CW && CW.game)), menu: !!document.querySelector('#menu, .menu, #mainMenu'), csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`);
  check(boot.game && boot.csp, `the game starts from a local file with the policy on (${JSON.stringify(boot)})`);
  check(!errs.length, 'no blocked scripts or errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
