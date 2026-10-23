// Muted online test: two real game clients (separate storage) log in, PLAY the same mode+arena,
// get matched together, play with bots, chat, use supers, finish, and get trophies.
const { app, BrowserWindow, session } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.URL || 'http://localhost:8781/';
const MODE = process.env.MODE || 'koth';
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
  for (const P of [A, B]) { await P.js(`${G}.settings.mmMode = '${MODE}'; ${G}.settings.mmArena = 'canyon'; ${G}.play(); true`); await wait(400); }
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
  // play a bit, then the HOST quits (window closed: its socket drops)
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    for (const P of [A, B]) await P.js(`(() => { const g = ${G}; if (g.state !== 'match') return; g.keys.KeyW = true; g.mouse.left = true; })()`);
    await wait(500);
  }
  const host = (await A.js(`${G}.net.isHost`)) ? A : B, other = host === A ? B : A;
  console.log('HOST was', host.name);
  const before = await other.js(`(() => { const g = ${G}; return { obj: g.obj && g.obj.netState ? JSON.stringify(g.obj.netState()).slice(0, 80) : null, mechs: g.combatants.length }; })()`);
  host.win.destroy();
  const tq = Date.now();
  for (let k = 0; k < 160 && !(await other.js(`${G}.net.isHost`)); k++) await wait(250);
  console.log('took over after', Date.now() - tq, 'ms');
  await wait(1500);
  const after = await other.js(`(() => { const g = ${G}; const bots = g.combatants.filter((c) => !c.human && c.alive && c.mech && c.mech.alive); const p0 = bots.map((c) => [c.mech.pos.x, c.mech.pos.z]); return { state: g.state, isHost: g.net.isHost, remoteLeft: g.combatants.filter((c) => c.mech && c.mech.remote).length, owners: [...new Set(g.combatants.map((c) => c.owner))], feed: [...document.querySelectorAll('.feed-item')].map((e) => e.textContent).slice(0, 3), p0 }; })()`);
  await wait(3000);
  const moved = await other.js(`(() => { const g = ${G}; const bots = g.combatants.filter((c) => !c.human && c.alive && c.mech && c.mech.alive); return bots.map((c) => [c.mech.pos.x, c.mech.pos.z]); })()`);
  const dist = after.p0.slice(0, moved.length).map((p, i) => Math.hypot(p[0] - moved[i][0], p[1] - moved[i][1]));
  console.log('AFTER HOST QUIT', JSON.stringify({ state: after.state, isHost: after.isHost, remoteLeft: after.remoteLeft, owners: after.owners, feed: after.feed }), 'bots moved:', dist.filter((d) => d > 1).length, 'of', dist.length, 'obj before', before.obj);
  // finish: sudden death on the survivor's game
  await other.js(`(() => { const g = ${G}; g.matchTime = 1000; if (g.obj && g.obj.mode && g.obj.mode.timeLimit) g.matchTime = g.obj.mode.timeLimit + 1; for (const m of g.mechs) if (m.alive && !m.remote && m.core) m.core.hp = Math.min(m.core.hp, 6); })()`);
  for (let k = 0; k < 60; k++) { if ((await other.js(`${G}.state`)) === 'results') break; await wait(1000); }
  await wait(1500);
  const end = await other.js(`({ state: ${G}.state, trophies: document.getElementById('resTrophy').innerText, place: document.getElementById('resPlace').textContent, pass: document.getElementById('resPass').textContent, coins: ${G}.profile.coins })`);
  console.log('END', JSON.stringify(end));
  console.log('CRASHES', JSON.stringify(await other.js(`window.__crashes`)));
  console.log('CONSOLE ERRORS', errors.length);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ', e);
  app.exit(0);
});
