const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';
app.whenReady().then(async () => {
  const mk = (p) => { const w = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true, partition: p + Date.now() } }); w.webContents.setAudioMuted(true); require('./no-voice-ask')(w); return w; };
  const A = mk('a'), B = mk('b');
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const t = Math.floor(Math.random() * 1e4), na = 'Sa' + t, nb = 'Sb' + t;
  for (const [w, n] of [[A, na], [B, nb]]) {
    await w.loadURL('http://localhost:8781/');
    await js(w, `localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  }
  await wait(4500);
  for (const [w, n] of [[A, na], [B, nb]]) await js(w, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: 'seenpass1' }))`);
  await wait(2500);
  await js(A, `${G}.net.send({ t: 'friendAdd', name: '${nb}' }); true`); await wait(800);
  await js(B, `${G}.net.send({ t: 'friendAccept', name: '${na}' }); true`); await wait(800);
  await js(B, `${G}.net.send({ t: 'clubCreate', name: 'Dbg ${t}', badge: 1, open: true }); true`); await wait(1000);
  const id = await js(B, `${G}.account.club.id`);
  await js(A, `${G}.net.send({ t: 'clubJoin', id: '${id}' }); true`); await wait(1000);
  await js(A, `${G}.net.send({ t: 'dmSend', to: '${nb}', x: 'hello there' }); ${G}.net.send({ t: 'clubSay', x: 'club hi' }); true`); await wait(1200);
  const st = () => js(B, `({ un: JSON.stringify(${G}.talk.unread), club: ${G}.talk.unreadIn('club'), party: ${G}.talk.unreadIn('party'), badge: document.getElementById('badgeChat').textContent, hid: document.getElementById('badgeChat').classList.contains('hidden'), seen: localStorage.getItem('cogwild.chatSeen.${nb.toLowerCase()}') })`);
  console.log('before read', JSON.stringify(await st()));
  await js(B, `${G}.talk.open('friends'); true`); await wait(300);
  await js(B, `${G}.talk.thread = '${na}'; ${G}.net.send({ t: 'dmOpen', name: '${na}' }); ${G}.talk.render(); true`); await wait(800);
  await js(B, `${G}.talk.tab = 'club'; ${G}.talk.thread = null; ${G}.talk.render(); true`); await wait(300);
  await js(B, `${G}.talk.close(); true`);
  console.log('after read', JSON.stringify(await st()));
  await js(B, `${G}.account.logout(); true`); await wait(6000);
  await js(B, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctLogin', name: '${nb}', pass: 'seenpass1' }))`); await wait(5000);
  console.log('after login', JSON.stringify(await st()), await js(B, `${G}.account.loggedIn`));
  await wait(5000);
  console.log('later', JSON.stringify(await st()));
  app.exit(0);
});
