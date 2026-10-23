// Live check of chat + voice chat on https://cogwild.duckdns.org (hidden, muted windows, a fake microphone):
// two throwaway accounts become friends and a party, chat, connect voice through the server's relay, then are deleted.
//   desktop/node_modules/.bin/electron tests/live-voice.js
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const URL = process.env.SITE || 'https://cogwild.duckdns.org/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const mk = (t) => new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true, partition: t + Date.now() } });
  const A = mk('la'), B = mk('lb');
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const tag = String(Date.now() % 100000), PASS = 'livevoice-' + tag;
  const names = { A: 'lvA' + tag, B: 'lvB' + tag };
  for (const w of [A, B]) {
    w.webContents.setAudioMuted(true);
    await w.loadURL(URL);
    await js(w, `localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 100, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, voice: false } })); location.reload();`);
  }
  await wait(5000);
  for (const [w, n] of [[A, names.A], [B, names.B]]) await js(w, `document.getElementById('vcAsk').classList.add('hidden'); ${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: '${PASS}' }))`);
  await wait(3000);
  try {
    check(await js(A, `${G}.account.loggedIn`) && await js(B, `${G}.account.loggedIn`), 'two test accounts on the live server');
    await js(A, `${G}.net.send({ t: 'friendAdd', name: '${names.B}' }); true`); await wait(900);
    await js(B, `${G}.net.send({ t: 'friendAccept', name: '${names.A}' }); true`); await wait(900);
    await js(A, `${G}.net.send({ t: 'partyInvite', name: '${names.B}' }); true`); await wait(900);
    await js(B, `${G}.net.send({ t: 'partyAccept', from: '${names.A}' }); true`); await wait(1500);
    await js(A, `${G}.net.send({ t: 'partySay', x: 'live chat works' }); true`); await wait(1200);
    check(await js(B, `(${G}.account.party && ${G}.account.party.log || []).some((l) => l.x === 'live chat works')`), 'party chat on the live server');
    for (const w of [A, B]) await js(w, `${G}.settings.voice = true; ${G}.voice.apply(); true`);
    let st = null;
    for (let i = 0; i < 40; i++) {
      await wait(500);
      st = await js(B, `(async () => { const p = [...${G}.voice.peers.values()][0]; if (!p || p.pc.connectionState !== 'connected') return null; const s = await p.pc.getStats(); let pair = null; s.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; }); const loc = pair && s.get(pair.localCandidateId), rem = pair && s.get(pair.remoteCandidateId); return { relay: ${G}.voice.relay, local: loc && loc.candidateType, remote: rem && rem.candidateType, talking: p.talking }; })()`);
      if (st) break;
    }
    check(!!st, 'voice chat connects on the live server');
    check(!!st && st.relay && st.local === 'relay', `the call goes through the relay (${JSON.stringify(st)})`);
    let heard = false;
    for (let i = 0; i < 20 && !heard; i++) { await wait(300); heard = await js(B, `[...${G}.voice.peers.values()].some((p) => p.talking)`); }
    check(heard, 'the other player is heard');
  } finally {
    for (const w of [A, B]) await js(w, `${G}.voice.stop(); ${G}.net.send({ t: 'acctDelete', pass: '${PASS}' }); true`).catch(() => {});
    await wait(1500);
    check(!(await js(A, `${G}.account.loggedIn`)) && !(await js(B, `${G}.account.loggedIn`)), 'test accounts deleted again');
  }
  console.log(failed ? `${failed} check(s) FAILED` : 'live voice test passed');
  app.exit(failed ? 1 : 0);
});
