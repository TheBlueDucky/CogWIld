// Look at the moderation page (hidden window): a report comes in, the page opens with the moderator key, shows it,
// and a mute from the page works. Needs a local test server on 8781 started with ADMIN_TOKEN (64 characters):
//   PORT=8781 SIGNUPS_PER_HOUR=100 DATA_DIR=/tmp/cw-adm ADMIN_TOKEN=aaaa…(64) node server/server.js
// Screenshots: tests/shots/admin-*.png.
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
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::|401/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'admin-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/admin');
  await wait(800);
  // two players: one reports the other (from this page, over the game's WebSocket)
  const N = 'Mod' + Math.floor(Math.random() * 9000 + 1000);
  const rep = await js(`new Promise((res) => {
    const mk = (name) => new Promise((ok) => { const ws = new WebSocket('ws://' + location.host + '/ws'); ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.t === 'welcome') { ws.send(JSON.stringify({ t: 'hello', name: 'x', ver: 'cogwild-net-10' })); ws.send(JSON.stringify({ t: 'acctRegister', name, pass: 'modpass1' })); }
      if (m.t === 'acctOk') ok(ws); if (m.t === 'note' && ws.onnote) ws.onnote(m); }; });
    Promise.all([mk('${N}a'), mk('${N}b')]).then(([a, b]) => { a.onnote = (m) => res(m.msg); a.send(JSON.stringify({ t: 'report', name: '${N}b', why: 'rude words', where: 'party' })); });
  })`);
  check(/Thanks/.test(rep), 'a report is sent');
  await js(`document.getElementById('key').value = '${TOKEN}'; document.getElementById('open').click(); true`);
  await wait(1200);
  const shown = await js(`(() => ({ app: !document.getElementById('app').classList.contains('hidden'), cards: document.querySelectorAll('#view .card').length, text: document.getElementById('view').textContent.slice(0, 200) }))()`);
  check(shown.app && shown.cards >= 1 && shown.text.includes(N + 'b'), 'the page opens with the key and lists the report');
  await shot('reports');
  // mute from the page (two clicks)
  await js(`(() => { const b = document.querySelector('[data-act="mute"][data-hours="24"]'); b.click(); b.click(); return true; })()`);
  await wait(1000);
  await js(`document.querySelector('[data-tab="people"]').click(); true`);
  await wait(300);
  check(await js(`/muted/.test(document.getElementById('view').textContent) && document.getElementById('view').textContent.includes('${N}b')`), 'mute from the page: the player shows as muted');
  await shot('people');
  await js(`document.querySelector('[data-tab="find"]').click(); document.getElementById('findName').value = '${N}b'; document.getElementById('findGo').click(); true`);
  await wait(800);
  await shot('player');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
