// Muted check of the Weekend Cup in the game (hidden window): pretend it's Saturday 31 Oct 2026, log in, pick the cup
// in PLAY, see the lobby chip and the cup screen, play a real online cup match (bots fill the seats, sped up), and
// get cup points on the results screen and the board.
// Needs a local test server on 8781 started with CUP_DATE (tests/README.md):
//   PORT=8781 SEARCH_SECS=3 TROPHY_MIN_SECS=0 SIGNUPS_PER_HOUR=100 DATA_DIR=/tmp/cw-cup CUP_DATE=2026-10-31T12:00:00Z node server/server.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const until = async (js, cond, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(150); } return false; };

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'cup-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third', timeOfDay: 'day' } })); location.reload();`);
  await wait(4500);
  // Saturday afternoon, like the server
  await js(`(() => { const real = CW.ECON.cup; CW.ECON.cup = (now) => real(now || Date.parse('2026-10-31T12:00:00Z')); ${G}.renderArenaCard(); return true; })()`);
  const N = 'Cup' + Math.floor(Math.random() * 9000 + 1000);
  check(await js(`!document.getElementById('cupChip').classList.contains('hidden') && /Weekend Cup/.test(document.getElementById('cupChip').textContent)`), 'the lobby shows the Weekend Cup chip while it runs');
  // PLAY panel card: guests are asked to log in
  await js(`${G}.meta.openPanel('arenas'); true`);
  await wait(400);
  await js(`document.getElementById('cupPick').click(); true`);
  await wait(400);
  check(await js(`!document.getElementById('acct').classList.contains('hidden')`), 'a guest picking the cup is asked to log in');
  await js(`document.getElementById('acct').classList.add('hidden'); ${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${N}', pass: 'cuppass1' })); true`);
  check(await until(js, `${G}.account.loggedIn`), 'logged in');
  await js(`${G}.meta.openPanel('arenas'); true`);
  await wait(400);
  await shot('play-panel');
  await js(`document.getElementById('cupPick').click(); true`);
  await wait(300);
  const card = await js(`(() => ({ kind: ${G}.settings.mmEvent, mode: document.getElementById('acMode').textContent, name: document.getElementById('acName').textContent }))()`);
  check(card.kind === 'cup' && card.mode === 'Weekend Cup' && /best 10/.test(card.name), `picked: the PLAY card says "${card.mode} · ${card.name}"`);
  // the cup screen
  await js(`document.getElementById('cupChip').click(); true`);
  check(await until(js, `!!document.querySelector('.cup-head') && /How it works/.test(document.getElementById('panelBody').textContent)`), 'the cup screen opens from the chip');
  await shot('screen-empty');
  await js(`${G}.meta.closePanel(); true`);
  // a real online cup match, sped up
  await js(`${G}.play(); true`);
  check(await until(js, `!!(${G}.net.room && ${G}.net.room.settings.cup === 'cup2026-10-30')`), 'PLAY searches for a cup match');
  check(await until(js, `${G}.state === 'match'`, 20000), 'the match starts (bots fill the seats)');
  const end = await js(`(async () => { const g = ${G}; g.headless = true;
    for (let i = 0; i < 300 && g.countdown > 0; i++) { g.tick(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    for (let i = 0; i < 20 * 30 && g.state === 'match'; i++) { g.tick(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    for (let k = 0; k < 900 && g.state === 'match'; k++) {
      for (const c of g.combatants) if (c !== g.player && c.alive) { if (c.mech && c.mech.alive) c.mech.destroy(g.player); if (c.pilot && c.pilot.alive) c.pilot.die(g.player); c.lives = 0; }
      if (g.player.mech) g.player.mech.protect = 9;
      g.tick(1 / 30); if (k % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    g.headless = false; return { state: g.state, mode: g.modeId }; })()`);
  check(end.state === 'results', `the cup match (${end.mode}) ends on the results screen`);
  check(await until(js, `/cup points/.test(document.getElementById('resTrophy').textContent)`), 'the results show the cup points');
  const line = await js(`document.getElementById('resTrophy').textContent`);
  console.log('       ' + line.trim());
  await shot('results');
  // the board has you now
  await js(`(() => { const g = ${G}; g.net.leaveRoom(); g.showMenu(); g.account.askCup(true); g.meta.openPanel('cup'); return true; })()`);
  check(await until(js, `!!document.querySelector('.cup-me') && document.querySelectorAll('.lb-row').length >= 1`), 'the cup screen shows your place and the leaderboard');
  await shot('screen');
  win.setContentSize(915, 412);
  await wait(500);
  await shot('screen-phone');
  win.setContentSize(1280, 720);

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
