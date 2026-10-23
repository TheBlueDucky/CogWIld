// Muted test: two players make a party; the lobby shows the friend's mech; they search together.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const errors = [];
  const W = +(process.env.W || 1280), H = +(process.env.H || 720);
  const mk = async (name, xp) => {
    const win = new BrowserWindow({ show: false, width: name === 'ann' ? W : 1280, height: name === 'ann' ? H : 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'p-' + name + Date.now(), backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errors.push(name + ': ' + msg); });
    await win.loadURL('http://localhost:8781/');
    const js = (code) => win.webContents.executeJavaScript(code);
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: ${xp}, settings: { tutorialDone: true, music: 0, sfx: 0, touch: ${JSON.stringify(process.env.TOUCH || 'auto')} } })); location.reload();`);
    await wait(4000);
    return { win, js, name, shot: async (n) => fs.writeFileSync(path.join(__dirname, 'shots', n + '.png'), (await win.webContents.capturePage()).toPNG()) };
  };
  const G = '(window.game || CW.game)';
  const A = await mk('ann', 5000), B = await mk('ben', 9000);
  const tag = Date.now() % 100000;
  for (const P of [A, B]) { P.user = P.name + tag; await P.js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${P.user}', pass: 'testpass1' }))`); }
  await wait(2000);
  // B gets a different-looking mech (an example) so it's easy to spot
  await B.js(`(() => { const g = ${G}; g.currentBp = CW.cloneBp(CW.PRESETS[2]); g.currentBp.color = 0xff006e; return true; })()`);
  await A.js(`${G}.net.send({ t: 'friendAdd', name: '${B.user}' })`);
  await wait(800);
  await B.js(`${G}.net.send({ t: 'friendAccept', name: '${A.user}' })`);
  await wait(800);
  await A.js(`${G}.net.send({ t: 'partyInvite', name: '${B.user}' })`);
  await wait(800);
  await B.js(`${G}.net.send({ t: 'partyAccept', from: '${A.user}' })`);
  await wait(3500);
  const party = await A.js(`(() => { const g = ${G}; const p = g.account.party; return { members: p && p.members.map((m) => [m.name, !!m.bp]), stage: g.stage ? g.stage.size : 0 }; })()`);
  console.log('PARTY (Ann sees)', JSON.stringify(party));
  await A.shot('party-lobby-' + W);
  await A.js(`${G}.play(); true`);
  await wait(3000);
  const s1 = await A.js(`(() => { const g = ${G}; return { state: g.state, players: g.net.room && g.net.room.players.length, stage: g.stage ? g.stage.size : 0, showcase: !!(g.showcase && g.showcase.visible) }; })()`);
  const sb = await B.js(`(() => { const g = ${G}; return { state: g.state, room: g.net.room && g.net.room.code }; })()`);
  console.log('SEARCHING', JSON.stringify(s1), 'Ben:', JSON.stringify(sb));
  await A.shot('party-search-' + W);
  await wait(7600);
  await A.shot('party-search-bots');
  const s2 = await A.js(`(() => { const g = ${G}; return { state: g.state, stage: g.stage ? g.stage.size : 0 }; })()`);
  console.log('AFTER SEARCH', JSON.stringify(s2));
  console.log('errors', errors.length, errors.slice(0, 6).join(' | '));
  app.exit(0);
});
