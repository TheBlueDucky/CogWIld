// Muted check of chat and voice chat with two players (hidden windows, a fake microphone that is never heard):
// friends + party chat, a private message, voice chat connecting, Quick chat only, blocking; plus the
// achievements progress, Settings > Keys, no text selection, tapping outside a menu, and the Google login box.
// Needs the local test server on 8781 (SIGNUPS_PER_HOUR=100) and, for the login box, one on 8782 with
// GOOGLE_CLIENT_ID=test-client (see tests/README.md).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.commandLine.appendSwitch('use-fake-device-for-media-stream'); // a test tone instead of a real microphone
app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); // no "allow microphone?" prompt
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const make = (w, h, tag) => new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: tag + Date.now() } });
  // all windows first (a fresh window after a destroyed one can fail to load)
  const A = make(1280, 720, 'ta'), B = make(1280, 720, 'tb'), P = make(915, 412, 'tp'), L = make(1280, 720, 'tl');
  const opened = [];
  for (const [win, name] of [[A, 'A'], [B, 'B'], [P, 'P'], [L, 'L']]) {
    win.webContents.setAudioMuted(true);
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|ERR_|net::/.test(msg)) errors.push(`${name}: ${msg}`); });
    win.webContents.setWindowOpenHandler(({ url }) => { opened.push(url); return { action: 'deny' }; });
  }
  const js = (win, code) => win.webContents.executeJavaScript(code);
  const shot = async (win, name) => fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const start = async (win, port, profile) => {
    await win.loadURL(`http://localhost:${port}/`);
    await js(win, `localStorage.setItem('cogwild.profile', JSON.stringify(${JSON.stringify(profile)})); location.reload();`);
    await wait(3500);
  };
  const base = { xp: 5000, coins: 500, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0 } };
  const tag = String(Date.now() % 100000);
  const nameA = 'TalkA' + tag, nameB = 'TalkB' + tag;
  await start(A, 8781, base);
  await start(B, 8781, Object.assign({}, base, { stats: { matches: 12, wins: 9, wrecks: 37, airTime: 150 } }));
  for (const [win, n] of [[A, nameA], [B, nameB]]) await js(win, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: 'talkpass1' }))`);
  await wait(2500);
  check(await js(A, `${G}.account.loggedIn && ${G}.account.loggedIn`) && await js(B, `${G}.account.loggedIn`), 'both players have accounts');

  // the first-time voice chat question
  check(await js(A, `!document.getElementById('vcAsk').classList.contains('hidden')`), 'a new account is asked about voice chat');
  await shot(A, 'talk-voice-ask');
  await js(A, `document.getElementById('vcYes').click(); true`);
  await js(B, `document.getElementById('vcNo').click(); true`);
  await wait(500);
  check(await js(B, `${G}.settings.voice === false && document.getElementById('vcAsk').classList.contains('hidden')`), '"Keep it off" closes it and keeps voice off');

  // friends and a party
  await js(A, `${G}.net.send({ t: 'friendAdd', name: '${nameB}' }); true`);
  await wait(700);
  await js(B, `${G}.net.send({ t: 'friendAccept', name: '${nameA}' }); true`);
  await wait(700);
  await js(A, `${G}.net.send({ t: 'partyInvite', name: '${nameB}' }); true`);
  await wait(700);
  await js(B, `${G}.net.send({ t: 'partyAccept', from: '${nameA}' }); true`);
  await wait(1200);
  check(await js(A, `!!${G}.account.party && ${G}.account.party.members.length === 2`), 'the two are friends and in a party');

  // party chat: typed freely
  await js(A, `${G}.talk.open('party'); document.getElementById('chatInput').value = 'Anyone up for Gold Rush? 🪙'; document.getElementById('chatForm').requestSubmit(); true`);
  await wait(800);
  check(await js(B, `(${G}.account.party.log || []).some((l) => l.x === 'Anyone up for Gold Rush? 🪙')`), 'party chat: a typed message reaches the party');
  check(await js(B, `!document.getElementById('badgeChat').classList.contains('hidden')`), 'the 💬 button shows an unread badge');
  await shot(B, 'talk-badge');
  await js(B, `${G}.talk.open('party'); true`);
  await wait(300);
  await shot(B, 'talk-party');
  check(await js(B, `document.getElementById('badgeChat').classList.contains('hidden')`), 'opening the chat clears the badge');
  // a private message
  await js(A, `${G}.talk.tab = 'friends'; ${G}.talk.thread = '${nameB}'; ${G}.net.send({ t: 'dmOpen', name: '${nameB}' }); ${G}.talk.render(); true`);
  await wait(400);
  await js(A, `document.getElementById('chatInput').value = 'gg last match!'; document.getElementById('chatForm').requestSubmit(); true`);
  await wait(900);
  check(await js(B, `(${G}.talk.dms['${nameA}'] || []).some((l) => l.x === 'gg last match!') || (${G}.talk.unread['${nameA}'] | 0) > 0`), 'a private message reaches the friend');
  await js(B, `${G}.talk.tab = 'friends'; ${G}.talk.thread = null; ${G}.talk.render(); true`);
  await wait(300);
  await shot(B, 'talk-friends');
  await js(B, `${G}.talk.thread = '${nameA}'; ${G}.net.send({ t: 'dmOpen', name: '${nameA}' }); ${G}.talk.render(); true`);
  await wait(500);
  await shot(B, 'talk-dm');
  // tapping a name: profile, block, report
  await js(B, `${G}.talk.who = '${nameA}'; ${G}.talk.render(); true`);
  await wait(300);
  check(await js(B, `/Block/.test(document.getElementById('chatSub').textContent) && /Report/.test(document.getElementById('chatSub').textContent)`), 'tapping a name offers profile, block and report');
  await shot(B, 'talk-name-menu');
  await js(B, `${G}.talk.who = null; ${G}.talk.close(); true`);

  // voice chat: B turns it on too; their games connect and B hears A's (fake) microphone
  await js(B, `${G}.settings.voice = true; ${G}.voice.apply(); true`);
  let connected = false;
  for (let i = 0; i < 30 && !connected; i++) {
    await wait(500);
    connected = await js(B, `[...${G}.voice.peers.values()].some((p) => p.pc.connectionState === 'connected')`);
  }
  check(connected, 'voice chat connects the two players');
  let heard = false;
  for (let i = 0; i < 20 && !heard; i++) { await wait(300); heard = await js(B, `[...${G}.voice.peers.values()].some((p) => p.talking)`); }
  check(heard, 'B hears A talking (the 🔊 name shows)');
  await shot(B, 'talk-voice-talking');
  // mute: A's mic stops sending
  await js(A, `${G}.voice.toggleMute(); true`);
  await wait(300);
  check(await js(A, `${G}.voice.stream.getAudioTracks().every((t) => !t.enabled)`), 'M mutes the microphone');
  await js(A, `${G}.voice.toggleMute(); true`);
  // push to talk: nothing is sent until the key is held
  await js(A, `${G}.talk.close(); ${G}.settings.vcMode = 'ptt'; ${G}.voice.applyMic(); true`); // (keys don't count while typing in the chat)
  check(await js(A, `${G}.voice.stream.getAudioTracks().every((t) => !t.enabled)`), 'push to talk: silent while the key is up');
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B' });
  await wait(200);
  check(await js(A, `${G}.voice.stream.getAudioTracks().every((t) => t.enabled)`), 'push to talk: holding B sends your voice');
  A.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B' });
  await wait(200);
  await js(A, `${G}.settings.vcMode = 'open'; ${G}.voice.applyMic(); true`);
  // Settings > Voice chat
  await js(B, `${G}.meta.setTab = 'voice'; ${G}.meta.openPanel('settings'); true`);
  await wait(900);
  await shot(B, 'talk-settings-voice');
  await js(B, `document.querySelector('[data-settab="chat"]').click(); true`);
  await wait(300);
  await shot(B, 'talk-settings-chat');
  // Quick chat only (kids): no free text either way, no voice
  await js(B, `const el = document.getElementById('setChatMode'); el.value = 'quick'; el.dispatchEvent(new Event('change')); true`);
  await wait(1500);
  check(await js(B, `${G}.talk.mode === 'quick' && !${G}.voice.live`), 'Quick chat only turns voice chat off');
  await js(B, `${G}.meta.closePanel(); true`);
  await js(A, `${G}.talk.open('party'); document.getElementById('chatInput').value = 'secret free text'; document.getElementById('chatForm').requestSubmit(); true`);
  await wait(900);
  check(await js(B, `!(${G}.account.party.log || []).some((l) => l.x === 'secret free text')`), 'a quick-chat-only player gets no free text');
  await js(B, `${G}.talk.open('party'); true`);
  await wait(300);
  check(await js(B, `document.getElementById('chatForm').classList.contains('hidden') && !document.getElementById('chatQuick').classList.contains('hidden')`), 'they only get the ready-made lines');
  await shot(B, 'talk-quick-only');
  await js(B, `${G}.talk.close(); ${G}.talk.setMode('free'); true`);
  await wait(800);

  // achievements: how close you are
  await js(B, `${G}.meta.openPanel('ach'); true`);
  await wait(500);
  check(await js(B, `[...document.querySelectorAll('.ach')].some((el) => /Champion/.test(el.textContent) && /9 \\/ 10/.test(el.textContent))`), 'achievements show progress ("9 / 10" wins)');
  await shot(B, 'talk-achievements');
  await js(B, `${G}.meta.closePanel(); true`);

  // Settings > Keys: the name turns gray-blue on hover; quiet buttons
  await js(B, `${G}.meta.setTab = 'keys'; ${G}.meta.openPanel('settings'); true`);
  await wait(600);
  const row = await js(B, `(() => { const r = document.querySelector('.key-row span').getBoundingClientRect(); const z = parseFloat(getComputedStyle(document.getElementById('panel')).zoom) || 1; return { x: (r.left + 30) * z, y: (r.top + r.height / 2) * z }; })()`);
  B.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(row.x), y: Math.round(row.y) });
  await wait(300);
  check(await js(B, `getComputedStyle(document.querySelector('.key-row span')).color === 'rgb(159, 179, 217)'`), 'the name of a key row turns gray-blue on hover');
  check(await js(B, `getComputedStyle(document.getElementById('setKeysReset')).backgroundColor === 'rgba(0, 0, 0, 0)'`), '"Reset keys" has no background of its own (just a line)');
  await shot(B, 'talk-keys-hover');
  await js(B, `${G}.meta.closePanel(); true`);

  // no selecting text, except What's new and the boxes you type in
  const sel = await js(B, `(() => { const us = (el) => el && getComputedStyle(el).userSelect; ${G}.meta.openPanel('news'); const r = { button: us(document.getElementById('btnShop')), title: us(document.getElementById('panelTitle')), news: us(document.querySelector('.news li')), input: us(document.getElementById('chatInput')) }; ${G}.meta.closePanel(); return r; })()`);
  check(sel.button === 'none' && sel.title === 'none', `buttons and menu text can't be selected (${sel.button}, ${sel.title})`);
  check(sel.news !== 'none' && sel.input !== 'none', `What's new and text boxes still can be (${sel.news}, ${sel.input})`);

  // phone: a menu is open, tapping outside it on another button only closes the menu
  await start(P, 8781, Object.assign({}, base, { settings: Object.assign({}, base.settings, { touch: 'on' }) }));
  check(await js(P, `!document.getElementById('vcAsk').classList.contains('hidden')`), 'a guest is asked about voice chat on the first start too');
  await js(P, `document.getElementById('vcNo').click(); true`);
  await js(P, `${G}.meta.openPanel('top'); true`);
  await wait(500);
  const btn = await js(P, `(() => { const r = document.getElementById('btnShop').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).id }; })()`);
  const zP = await js(P, `parseFloat(getComputedStyle(document.getElementById('menu')).zoom) || 1`);
  P.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(btn.x * zP), y: Math.round(btn.y * zP), button: 'left', clickCount: 1 });
  P.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(btn.x * zP), y: Math.round(btn.y * zP), button: 'left', clickCount: 1 });
  await wait(500);
  const after = await js(P, `({ open: !document.getElementById('panel').classList.contains('hidden'), panel: ${G}.meta.panel })`);
  check(!after.open && after.panel === 'top', `tapping the Shop button behind an open menu only closes the menu (menu open: ${after.open}, last: ${after.panel}, tapped: ${btn.hit})`);
  P.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(btn.x * zP), y: Math.round(btn.y * zP), button: 'left', clickCount: 1 });
  P.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(btn.x * zP), y: Math.round(btn.y * zP), button: 'left', clickCount: 1 });
  await wait(500);
  check(await js(P, `!document.getElementById('panel').classList.contains('hidden') && ${G}.meta.panel === 'shop'`), 'with no menu open, the same tap opens the Shop');
  await js(P, `${G}.meta.closePanel(); ${G}.talk.open('friends'); true`);
  await wait(300);
  await shot(P, 'talk-phone-chat');
  await js(P, `${G}.talk.close(); true`);

  // chat during a match (A's party tab), with the 💬 and 🎙 buttons on the HUD
  await js(A, `${G}.talk.close(); ${G}.playOffline('clash', 'canyon'); true`);
  await wait(6000);
  await js(A, `${G}.talk.open('party'); true`);
  await wait(400);
  await shot(A, 'talk-in-match');
  check(await js(A, `${G}.state === 'match' && ${G}.talk.isOpen`), 'the chat opens during a match');
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(300);
  check(await js(A, `!${G}.talk.isOpen && !${G}.paused`), 'Esc closes the chat (without pausing)');

  // the login box when Google sign-in is on (server on 8782)
  await start(L, 8782, { xp: 0, settings: { tutorialDone: true, music: 0, sfx: 0 } });
  await wait(1000);
  check(await js(L, `!document.getElementById('acct').classList.contains('hidden') && !document.getElementById('gBtnWrap').classList.contains('hidden')`), 'the login box offers Google');
  await shot(L, 'talk-login-google');
  await js(L, `document.getElementById('tabSign').click(); true`);
  await wait(300);
  check(await js(L, `document.getElementById('fSign').classList.contains('hidden') && document.getElementById('gBtnT').textContent === 'Sign up with Google'`), 'signing up is with Google (no email form)');
  await shot(L, 'talk-signup-google');
  await js(L, `document.getElementById('gBtn').click(); true`);
  await wait(800);
  check(opened.some((u) => /localhost:8782\/auth\/google\?s=[a-f0-9]{48}$/.test(u)), 'the Google button opens the sign-in page in the browser');
  check(await js(L, `!document.getElementById('fGWait').classList.contains('hidden')`), 'the game waits for the browser');
  await shot(L, 'talk-google-wait');
  await js(L, `document.getElementById('gCancel').click(); document.getElementById('tabLogin').click(); document.getElementById('liOld').click(); true`);
  await wait(300);
  check(await js(L, `!document.getElementById('fLogin').classList.contains('hidden')`), 'older accounts can still log in with email and password');

  console.log('errors', errors.length, errors.slice(0, 10).join('\n'));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
