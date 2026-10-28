// Muted screenshots of the screens changed in v1.9.7 (hidden window, local test server on 8781): the club (as its
// owner, with a second member), Settings › Account / Display / Voice chat / Chat, the party card, a call card.
// Saves tests/shots/v197-*.png. SIZE=1280x720 (default)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);
const rand = (n) => Math.floor(Math.random() * n);

app.whenReady().then(async () => {
  const mk = (p) => new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { offscreen: true, partition: p + Date.now() } });
  const win = mk('s1'), win2 = mk('s2');
  const shots = path.join(__dirname, 'shots');
  for (const w of [win, win2]) { w.webContents.setAudioMuted(true); require('./no-voice-ask')(w); }
  const js = (c, w = win) => w.webContents.executeJavaScript(c);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(shots, `v197-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  const a = 'Cs' + rand(1000), b = 'Cm' + rand(1000);
  for (const [w, n] of [[win, a], [win2, b]]) {
    await w.loadURL('http://localhost:8781/');
    await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`, w);
  }
  await wait(4500);
  for (const [w, n] of [[win, a], [win2, b]]) {
    await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: 'shotpass1' }))`, w);
  }
  await wait(2500);
  await js(`${G}.net.send({ t: 'clubCreate', name: 'Shot Club ${a.slice(2)}', badge: 3, desc: 'We build fast mechs', open: true }); true`);
  await wait(1200);
  const id = await js(`${G}.account.club && ${G}.account.club.id`);
  await js(`${G}.net.send({ t: 'clubJoin', id: '${id}' }); true`, win2);
  await wait(1200);
  await js(`${G}.meta.openPanel('clubs'); true`);
  await wait(800);
  await js(`(() => { const d = document.getElementById('clSet'); if (d) { d.open = true; } return true; })()`);
  await shot('club');
  // the picture menu
  await js(`(() => { const p = document.getElementById('clPicBtn'); if (p) p.click(); return true; })()`);
  await shot('club-pic');
  await js(`${G}.meta.closePanel(); true`);
  for (const t of (process.env.TABS || 'account,display,voice,chat').split(',')) {
    await js(`${G}.meta.setTab = '${t}'; ${G}.meta.openPanel('settings'); true`);
    await wait(500);
    await shot('set-' + t);
    await js(`${G}.meta.closePanel(); true`);
  }
  // a call card (what an incoming call looks like)
  await js(`${G}.calls && ${G}.calls.show && ${G}.calls.show({ state: 'in', name: '${b}', av: 2 }); true`);
  await shot('call-in');
  await js(`${G}.calls && ${G}.calls.show && ${G}.calls.show({ state: 'live', name: '${b}', av: 2, since: Date.now() - 42000 }); true`);
  await shot('call-live');
  await js(`${G}.calls && ${G}.calls.show && ${G}.calls.show(null); true`);
  // the party card
  await js(`(() => { const ac = ${G}.account; ac.party = { leader: ac.me.name, members: [{ name: ac.me.name, av: 1, on: true }, { name: 'Ann', av: 2, on: true }], log: [{ f: 'Ann', t: 'hi' }] }; ac.renderParty(); return true; })()`);
  await shot('party');
  app.exit(0);
});
