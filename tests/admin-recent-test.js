// Moderation page › 🕹 Last players (hidden window, local test server on 8781 with ADMIN_TOKEN and MATCH_GAP_SECS=1):
// an account and a guest finish matches, and the tab lists them newest first with what we know about each.
// Screenshot: tests/shots/admin-recent.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.env.ADMIN_TOKEN || 'a'.repeat(64);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, partition: 'adr' + Date.now() } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::|401/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/admin');
  await wait(800);
  const N = 'Rec' + Math.floor(Math.random() * 9000 + 1000);
  // a guest finishes a Mech Ball match on the website, then an account finishes two online Bounty Hunt matches on Android
  const done = await js(`new Promise((res) => {
    const conn = (plat, first) => new Promise((ok) => { const ws = new WebSocket('ws://' + location.host + '/ws'); ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'hello', name: 'x', ver: 'cogwild-net-11', plat })); first(ws); }
      if ((m.t === 'acctOk' || m.t === 'guestOk') && !ws.ready) { ws.ready = true; ok(ws); } }; });
    const tok = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    const earn = (ws, mode, on) => ws.send(JSON.stringify({ t: 'earn', src: 'match', n: 30, xp: 80, pp: 0, mode, on }));
    conn('web', (ws) => ws.send(JSON.stringify({ t: 'guest', token: tok }))).then((g) => {
      earn(g, 'ball', false);
      setTimeout(() => conn('android', (ws) => ws.send(JSON.stringify({ t: 'acctRegister', name: '${N}', pass: 'recpass1' }))).then((a) => {
        earn(a, 'bounty', true); setTimeout(() => { earn(a, 'bounty', true); setTimeout(() => res(true), 600); }, 1300);
      }), 400);
    });
  })`);
  check(done, 'a guest and an account finish matches');
  await js(`document.getElementById('key').value = '${TOKEN}'; document.getElementById('open').click(); true`);
  await wait(1200);
  await js(`document.querySelector('[data-tab="recent"]').click(); true`);
  await wait(1000);
  const v = await js(`(() => { const cards = [...document.querySelectorAll('#view .card')]; return cards.map((c) => c.innerText); })()`);
  console.log(v.slice(0, 2).join('\n---\n'));
  check(v.length >= 2 && v.length <= 10, `the tab lists the last players (${v.length})`);
  check(v[0].includes(N) && /Bounty Hunt · online/.test(v[0]) && /Android app/.test(v[0]) && /2 matches lately/.test(v[0]) && /Level \d+/.test(v[0]), 'newest first: the account, its last match, level, trophies, matches');
  check(/^Guest/.test(v[1]) && /Mech Ball · vs bots/.test(v[1]) && /Website \(PC\)/.test(v[1]), 'then the guest, with its match and what it plays on');
  // clicking the name opens the full player view
  await js(`document.querySelector('#view .name[data-player]').click(); true`);
  await wait(1000);
  check(await js(`document.querySelector('[data-tab="find"]').classList.contains('on') && document.getElementById('playerBox').textContent.includes('${N}')`), 'clicking the name opens 🔍 Find a player');
  await js(`document.querySelector('[data-tab="recent"]').click(); true`);
  await wait(800);
  fs.writeFileSync(path.join(OUT, 'admin-recent.png'), (await win.webContents.capturePage()).toPNG());
  check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
