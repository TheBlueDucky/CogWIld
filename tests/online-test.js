// Muted online test: two real game clients (separate storage) log in, PLAY the same mode+arena,
// get matched together, play with bots, chat, use supers, finish, and get trophies.
const { app, BrowserWindow, session } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.URL || 'http://localhost:8781/';
app.whenReady().then(async () => {
  const errors = [];
  const mk = async (name) => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 650, webPreferences: { offscreen: true, partition: 'p-' + name + Date.now(), backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) errors.push(`${name} [${level}] ${msg} @${(src || '').split('/').pop()}:${line}`); });
    const js = (code) => win.webContents.executeJavaScript(code);
    await win.loadURL(URL);
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
    await wait(3500);
    await js(`window.__crashes = []; (() => { const g = window.game || CW.game; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 400)); o(e); }; })(); true`);
    return { win, js, name };
  };
  const A = await mk('ann'), B = await mk('ben');
  const G = `(window.game || CW.game)`;
  // sign up both (random names so reruns work)
  const tag = Math.floor(Math.random() * 1e5);
  for (const P of [A, B]) {
    P.user = P.name + tag;
    await P.js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${P.user}', pass: 'testpass1' }))`);
  }
  await wait(2500);
  console.log('LOGGED IN', await A.js(`${G}.account.loggedIn && ${G}.account.me.name`), await B.js(`${G}.account.loggedIn && ${G}.account.me.name`));
  // both press PLAY for Workshop Clash on Canyon
  for (const P of [A, B]) { await P.js(`${G}.settings.mmMode = 'clash'; ${G}.settings.mmArena = 'canyon'; ${G}.settings.mmEvent = ${process.env.EVENT ? "'" + process.env.EVENT + "'" : 'null'}; ${G}.play(); true`); await wait(400); }
  await wait(1500);
  const rooms = await Promise.all([A, B].map((P) => P.js(`(() => { const r = ${G}.net.room; return r && { code: r.code, players: r.players.length, arena: r.settings.arena }; })()`)));
  console.log('ROOMS', JSON.stringify(rooms), rooms[0] && rooms[1] && rooms[0].code === rooms[1].code ? 'SAME ROOM' : 'DIFFERENT ROOMS');
  // chat from Ben
  await B.js(`${G}.net.quickChat ? ${G}.net.quickChat(0) : ${G}.net.chat(0); true`).catch(() => {});
  // wait for search to end (SEARCH_SECS on the test server) and the match to start
  let st;
  for (let i = 0; i < 40; i++) {
    st = await Promise.all([A, B].map((P) => P.js(`({ state: ${G}.state, mechs: ${G}.combatants.length, host: ${G}.net.isHost })`)));
    if (st.every((s) => s.state === 'match')) break;
    await wait(1000);
  }
  console.log('MATCH START', JSON.stringify(st));
  const chatSeen = await A.js(`(${G}.net.chatLog || []).join(' | ')`);
  console.log('CHAT seen by Ann:', chatSeen);
  // play: both drive and shoot for ~45 s (real time: online sync runs on real clocks)
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 45000) {
    for (const P of [A, B]) {
      await P.js(`(() => { const g = ${G}; if (g.state !== 'match') return; g.keys.KeyW = true; g.keys.KeyA = ${i} % 6 < 3; g.keys.KeyD = ${i} % 6 >= 3; g.mouse.left = true; g.mouse.dx = ${i % 2 ? 8 : -8}; if (g.player && g.player.superCharge >= 1) g.pressed.KeyX = true; if (${i} % 8 === 0) g.pressed.KeyG = true; })()`);
    }
    i++;
    await wait(500);
  }
  const mid = await Promise.all([A, B].map((P) => P.js(`(() => { const g = ${G}; window.__mods = JSON.stringify(g.mods) + ' gadgets left ' + g.gadgets.left(g.player) + ' mines ' + g.gadgets.mines.length; const me = g.player; const other = g.combatants.find((c) => c.human && c !== me); return { state: g.state, me: me && me.name, myMechAlive: me && me.mech && me.mech.alive, other: other && other.name, otherPos: other && other.mech && [Math.round(other.mech.pos.x), Math.round(other.mech.pos.z)], wrecks: g.combatants.reduce((s, c) => s + c.wrecks, 0) }; })()`)));
  console.log('MID MATCH', JSON.stringify(mid));
  console.log('MODS', await A.js('window.__mods'), '|', await B.js('window.__mods'));
  // finish the match from the host: let the clock run out quickly
  const host = (await A.js(`${G}.net.isHost`)) ? A : B;
  // sudden death on both games, with cores almost gone: the match ends in a few seconds
  for (const P of [A, B]) await P.js(`(() => { const g = ${G}; g.matchTime = 1000; for (const m of g.mechs) if (m.alive && !m.remote && m.core) m.core.hp = Math.min(m.core.hp, 4 + Math.random() * 8); for (const pl of g.pilots) if (!pl.remote) pl.hp = Math.min(pl.hp, 3 + Math.random() * 6); })()`);
  for (let k = 0; k < 60; k++) {
    const s = await Promise.all([A, B].map((P) => P.js(`${G}.state`)));
    if (s.every((x) => x === 'results')) break;
    await wait(1000);
  }
  await wait(1500);
  const end = await Promise.all([A, B].map((P) => P.js(`({ state: ${G}.state, trophies: document.getElementById('resTrophy').innerText, place: document.getElementById('resPlace').textContent, tro: ${G}.account.me && ${G}.account.me.tro })`)));
  console.log('END', JSON.stringify(end));
  const crashes = await Promise.all([A, B].map((P) => P.js(`window.__crashes`)));
  console.log('CRASHES', JSON.stringify(crashes));
  console.log('CONSOLE ERRORS', errors.length);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ', e);
  app.exit(0);
});
