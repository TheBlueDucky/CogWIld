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
  check(await js(B, `document.getElementById('chatQuick').classList.contains('hidden')`), 'no ready-made lines in party chat (they type)');
  check(await js(B, `(() => { const log = document.getElementById('chatLog'), last = log.lastElementChild; return log.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom < 30; })()`), 'the newest message sits at the bottom, next to the typing box');
  // drag ⠿ to move the chat
  const grip = await js(B, `(() => { const r = document.getElementById('chatGrip').getBoundingClientRect(); const z = parseFloat(getComputedStyle(document.getElementById('chat')).zoom) || 1; return { x: (r.left + r.width / 2) * z, y: (r.top + r.height / 2) * z, left: document.getElementById('chat').getBoundingClientRect().left * z }; })()`);
  B.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(grip.x), y: Math.round(grip.y), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { B.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(grip.x + i * 50), y: Math.round(grip.y + i * 15), button: 'left' }); await wait(20); }
  B.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(grip.x + 400), y: Math.round(grip.y + 120), button: 'left', clickCount: 1 });
  await wait(300);
  check(await js(B, `(() => { const z = parseFloat(getComputedStyle(document.getElementById('chat')).zoom) || 1; return document.getElementById('chat').getBoundingClientRect().left * z > ${grip.left} + 300 && !!${G}.settings.chatPos; })()`), 'dragging ⠿ moves the chat (and it stays there)');
  await shot(B, 'talk-moved');
  await js(B, `${G}.settings.chatPos = null; ${G}.talk.close(); true`);
  // the party card: type to the party right there
  await js(B, `document.getElementById('pcIn').value = 'from the party card'; document.getElementById('pcForm').requestSubmit(); true`);
  await wait(900);
  check(await js(A, `/from the party card/.test(document.getElementById('pcLog').textContent)`), 'typing in the party card reaches the party (and shows on their party card)');
  await shot(A, 'talk-party-card');
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
  // mute (M): the microphone is let go completely; unmute opens it again
  await js(A, `${G}.talk.close(); true`);
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'M' });
  A.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'M' });
  await wait(500);
  check(await js(A, `${G}.voice.stream === null && ${G}.voice.joined`), 'M mutes: the microphone is released (you still hear others)');
  await js(A, `${G}.voice.toggleMute(); true`);
  await wait(1500);
  check(await js(A, `!!${G}.voice.stream`), 'unmuting opens the microphone again');
  // deafen (N): hear nobody, microphone off too
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N' });
  A.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N' });
  await wait(500);
  check(await js(A, `${G}.voice.deaf && ${G}.voice.stream === null && [...${G}.voice.peers.values()].every((p) => p.gain && p.gain.gain.value === 0)`), 'N deafens: nobody is heard and the microphone is off');
  await shot(A, 'talk-deafened');
  await js(A, `${G}.voice.toggleDeaf(); true`);
  await wait(1500);
  check(await js(A, `!${G}.voice.deaf && !!${G}.voice.stream && [...${G}.voice.peers.values()].every((p) => p.gain && p.gain.gain.value > 0)`), 'undeafening brings sound and the microphone back');
  // a key can be turned off
  await js(A, `${G}.settings.vcDeaf = 'none'; true`);
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N' });
  A.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N' });
  await wait(300);
  check(await js(A, `!${G}.voice.deaf`), 'a voice key set to "No key" does nothing');
  await js(A, `delete ${G}.settings.vcDeaf; true`);
  // push to talk: nothing is sent until the key is held
  await js(A, `${G}.talk.close(); ${G}.settings.vcMode = 'ptt'; ${G}.voice.applyMic(); true`); // (keys don't count while typing in the chat)
  check(await js(A, `${G}.voice.stream.getAudioTracks().every((t) => !t.enabled)`), 'push to talk: silent while the key is up');
  A.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B' });
  await wait(200);
  check(await js(A, `${G}.voice.stream.getAudioTracks().every((t) => t.enabled)`), 'push to talk: holding B sends your voice');
  A.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B' });
  await wait(200);
  await js(A, `${G}.settings.vcMode = 'open'; ${G}.voice.applyMic(); true`);
  // T opens the chat (when it's closed and nothing is being typed)
  await js(B, `${G}.talk.close(); document.activeElement && document.activeElement.blur(); true`);
  B.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T' });
  B.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T' });
  await wait(300);
  check(await js(B, `${G}.talk.isOpen`), 'T opens the chat');
  await shot(B, 'talk-see-through');
  await js(B, `${G}.talk.close(); true`);
  // message a friend straight from the Friends list
  await js(B, `${G}.meta.openPanel('friends'); true`);
  await wait(500);
  await js(B, `document.querySelector('#panelBody [data-dm]').click(); true`);
  await wait(500);
  check(await js(B, `${G}.talk.isOpen && ${G}.talk.tab === 'friends' && ${G}.talk.thread === '${nameA}'`), '💬 Message in the Friends list opens a chat with that friend');
  await js(B, `${G}.talk.close(); ${G}.meta.closePanel(); true`);
  // your own picture (made here instead of picked from a file), cropped square and shown as a circle
  await js(A, `(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 600, 400); gr.addColorStop(0, '#ff8c42'); gr.addColorStop(1, '#5ce1ff'); g.fillStyle = gr; g.fillRect(0, 0, 600, 400); g.fillStyle = '#121a33'; g.font = 'bold 160px sans-serif'; g.fillText('A', 240, 260); const img = new Image(); img.onload = () => CW.cropImage(img, (b64) => ${G}.net.send({ t: 'picSet', kind: 'u', data: b64 })); img.src = c.toDataURL(); })(); true`);
  await wait(700);
  await shot(A, 'talk-crop');
  check(await js(A, `!document.getElementById('picCrop').classList.contains('hidden')`), 'the picture cropper opens');
  await js(A, `document.getElementById('cropOk').click(); true`);
  await wait(1500);
  check(await js(A, `${G}.account.me.pv > 0`), 'the picture is saved on the account');
  await js(B, `${G}.meta.openPanel('friends'); true`);
  await wait(1200);
  check(await js(B, `(() => { const i = document.querySelector('#panelBody img.pfp'); return !!i && i.complete && i.naturalWidth === 256 && getComputedStyle(i).borderRadius === '50%'; })()`), 'friends see the picture as a circle (256×256, square)');
  await shot(B, 'talk-friends-picture');
  await js(B, `${G}.meta.closePanel(); true`);
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

  // Cog Pass: hold the left button and drag to scroll; the "how to tier up" boxes take you there
  await js(B, `${G}.meta.openPanel('pass'); true`);
  await wait(800);
  const sc = await js(B, `(() => { const s = document.querySelector('.pt-scroll'); s.scrollLeft = 0; const r = s.getBoundingClientRect(); const z = parseFloat(getComputedStyle(document.getElementById('panel')).zoom) || 1; return { x: (r.left + r.width * 0.7) * z, y: (r.top + r.height * 0.5) * z }; })()`);
  B.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(sc.x), y: Math.round(sc.y), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) { B.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(sc.x - i * 40), y: Math.round(sc.y), button: 'left' }); await wait(20); }
  B.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(sc.x - 400), y: Math.round(sc.y), button: 'left', clickCount: 1 });
  await wait(300);
  check(await js(B, `document.querySelector('.pt-scroll').scrollLeft > 200`), 'dragging the Cog Pass to the left scrolls it to the right');
  await js(B, `document.querySelector('[data-way="challenges"]').click(); true`);
  await wait(300);
  check(await js(B, `${G}.meta.panel === 'challenges'`), '"Daily challenges" opens the challenges');
  await js(B, `${G}.meta.openPanel('pass'); true`);
  await wait(500);
  await js(B, `document.querySelector('[data-way="gift"]').click(); true`);
  await wait(300);
  check(await js(B, `${G}.meta.panel === 'shop'`), '"Daily gift" opens the Shop');
  await js(B, `${G}.meta.openPanel('pass'); true`);
  await wait(500);
  await js(B, `document.querySelector('[data-way="play"]').click(); true`);
  await wait(400);
  check(await js(B, `document.getElementById('panel').classList.contains('hidden') && document.getElementById('btnPlay').classList.contains('hint-pulse')`), '"Play matches" goes to the menu and points at PLAY');
  await shot(B, 'talk-play-hint');

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
  await js(P, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: 'TalkP${tag}', pass: 'talkpass1' }))`);
  await wait(2500);
  await js(P, `${G}.meta.closePanel(); document.getElementById('vcAsk').classList.add('hidden'); ${G}.talk.openDm('${nameA}'); true`);
  await wait(500);
  await shot(P, 'talk-phone-chat');
  check(await js(P, `document.body.classList.contains('talk-full') && document.getElementById('chat').getBoundingClientRect().width > innerWidth - 4 && !document.getElementById('chatDone').classList.contains('hidden')`), 'phone menu: the chat opens full screen with a ☰ Menu button');
  await js(P, `document.getElementById('chatInput').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); document.getElementById('chatInput').focus(); true`);
  await wait(300);
  check(await js(P, `document.body.classList.contains('talk-portrait')`), 'phone: typing in the menu switches the chat to upright');
  P.setContentSize(412, 915);
  await wait(800);
  await shot(P, 'talk-phone-portrait');
  check(await js(P, `getComputedStyle(document.getElementById('rotate')).display === 'none' && document.getElementById('chat').getBoundingClientRect().width > 380`), 'upright: the chat fills the screen (no "turn your phone" screen)');
  await js(P, `document.getElementById('chatDone').click(); true`);
  P.setContentSize(915, 412);
  await wait(500);
  check(await js(P, `!document.body.classList.contains('talk-portrait') && !${G}.talk.isOpen`), '☰ Menu goes back to the menu (sideways again)');
  // phone, in a match: the 💬 button can be tapped (it's above the touch controls) and opens the chat
  await wait(3000);
  await js(P, `if (!document.getElementById('vcAsk').classList.contains('hidden')) document.getElementById('vcNo').click(); ${G}.playOffline('clash', 'canyon'); true`);
  await wait(6000);
  const hc = await js(P, `(() => { const b = document.getElementById('hudChat'), r = b.getBoundingClientRect(); const z = parseFloat(getComputedStyle(document.getElementById('hudTalk')).zoom) || 1; return { x: (r.left + r.width / 2) * z, y: (r.top + r.height / 2) * z, top: document.elementFromPoint((r.left + r.width / 2) * z, (r.top + r.height / 2) * z) === b, what: (() => { const e = document.elementFromPoint((r.left + r.width / 2) * z, (r.top + r.height / 2) * z); return e && (e.id || e.className); })(), state: ${G}.state, hidden: document.getElementById('hudTalk').className, size: [innerWidth, innerHeight], r: [r.left, r.top, r.width] }; })()`);
  check(hc.top, `phone match: nothing covers the 💬 button (${JSON.stringify(hc)})`);
  P.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(hc.x), y: Math.round(hc.y), button: 'left', clickCount: 1 });
  P.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(hc.x), y: Math.round(hc.y), button: 'left', clickCount: 1 });
  await wait(400);
  check(await js(P, `${G}.talk.isOpen && ${G}.state === 'match'`), 'phone match: tapping 💬 opens the chat');
  await shot(P, 'talk-phone-match-chat');
  await js(P, `${G}.talk.close(); ${G}.showMenu(); true`);

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

  // the party looks for a match: while waiting, the 💬 🎤 🎧 buttons are there and voice keeps going
  await js(A, `${G}.talk.close(); ${G}.showMenu(); true`);
  await js(B, `${G}.talk.close(); ${G}.meta.closePanel(); true`);
  await wait(1500);
  await js(A, `document.getElementById('btnPlay').click(); true`);
  await wait(2500);
  check(await js(B, `${G}.state === 'lobby' && !document.getElementById('hudTalk').classList.contains('hidden') && ${G}.voice.joined`), 'waiting for a match: chat and voice buttons are there, voice is on');
  await shot(B, 'talk-waiting');
  await js(B, `document.getElementById('hudChat').click(); true`);
  await wait(300);
  check(await js(B, `${G}.talk.isOpen && ${G}.talk.tabs().includes('game')`), 'waiting for a match: the chat opens, with the match tab');
  await js(B, `${G}.talk.close(); true`);
  let inMatch = false;
  for (let i = 0; i < 30 && !inMatch; i++) { await wait(1000); inMatch = await js(B, `${G}.state === 'match' && ${G}.net.active`); }
  check(inMatch, 'the party is in an online match together');
  await wait(2500);
  const sp = await js(B, `(() => { const g = ${G}, [id, p] = [...g.voice.peers.entries()][0] || []; if (!p || !p.pan) return null; const c = g.combatants.find((x) => x.human && x.owner === id); const b = c && (c.pilot || c.mech); const cam = new THREE.Vector3(); g.camera.getWorldPosition(cam); const L = g.voice.ctx.listener; return { pan: [p.pan.positionX.value, p.pan.positionZ.value], them: b && [b.pos.x, b.pos.z], listener: [L.positionX.value, L.positionZ.value], cam: [cam.x, cam.z] }; })()`);
  const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 3 && Math.abs(a[1] - b[1]) < 3;
  check(!!sp && near(sp.pan, sp.them) && near(sp.listener, sp.cam), `in a match each voice comes from that player's mech, heard from your camera (${JSON.stringify(sp)})`);
  await shot(B, 'talk-voice-in-match');
  await js(A, `${G}.showMenu(); true`);
  await js(B, `${G}.showMenu(); true`);
  await wait(1500);
  // leaving the party: no one to talk to, so the microphone is let go
  await js(B, `${G}.net.send({ t: 'partyLeave' }); true`);
  await wait(2500);
  check(await js(B, `!${G}.voice.joined && ${G}.voice.stream === null`), 'out of the party (and no match): the microphone is released');
  console.log('errors', errors.length, errors.slice(0, 10).join('\n'));
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  app.exit(failed ? 1 : 0);
});
