// Muted check of the v1.9.7 changes (two hidden windows, local test server on 8781): calls between club-mates (ring,
// pick up, voice peers, hang up, decline), typing to a room before its match, the club (rename, Last online, the picture
// menu, removing someone asks in the game, not the browser), the chat closing on a click outside it (or staying open),
// two-key chat keys, the fullscreen button in the desktop app, the HUD box slider, and climbing the arena's sides.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const rand = (n) => Math.floor(Math.random() * n);

app.whenReady().then(async () => {
  const errors = [];
  const mk = (p) => new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: p + Date.now() } });
  const A = mk('a'), B = mk('b');
  for (const w of [A, B]) {
    w.webContents.setAudioMuted(true);
    require('./no-voice-ask')(w);
    w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::|getUserMedia|microphone|Permission/i.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  }
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const a = 'Va' + rand(1000), b = 'Vb' + rand(1000);
  for (const w of [A, B]) {
    await w.loadURL('http://localhost:8781/');
    await js(w, `localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  }
  await wait(4500);
  for (const [w, n] of [[A, a], [B, b]]) await js(w, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: 'callpass1' }))`);
  await wait(2500);
  // no browser pop-ups anywhere
  for (const w of [A, B]) await js(w, `window.__pops = 0; window.confirm = () => { window.__pops++; return false; }; window.alert = () => { window.__pops++; }; true`);

  // ---------------- the club ----------------
  await js(A, `${G}.net.send({ t: 'clubCreate', name: 'Call Club ${a.slice(2)}', badge: 2, desc: 'Testing', open: true }); true`);
  await wait(1200);
  const id = await js(A, `${G}.account.club && ${G}.account.club.id`);
  await js(B, `${G}.net.send({ t: 'clubJoin', id: '${id}' }); true`);
  await wait(1200);
  await js(A, `${G}.meta.openPanel('clubs'); true`);
  await wait(600);
  const cl = await js(A, `({ dm: [...document.querySelectorAll('[data-dm]')].map((x) => x.textContent.trim()), call: !!document.querySelector('[data-call="${b}"]'), last: [...document.querySelectorAll('.cl-last')].map((x) => x.textContent), chatFirst: (() => { const c = document.querySelector('.cl-chatrow'), m = document.querySelector('.cl-list'); return !!c && !!m && (c.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 && !document.querySelector('.cl-head #clChat'); })(), picBtn: !document.getElementById('clPic') })`);
  check(cl.dm.includes('Direct Message') && cl.call, `club members: "Direct Message" and 📞 Call (${JSON.stringify(cl.dm)})`);
  check(cl.last.length === 2 && cl.last.every((t) => /Online/.test(t)), `each member shows Online / Last online (${cl.last.join(', ')})`);
  check(cl.chatFirst && cl.picBtn, 'Club chat sits under the club, above the members; no "Change club picture" button');
  await js(A, `document.getElementById('clPicBtn').click(); true`);
  check(await js(A, `!document.getElementById('clPicMenu').classList.contains('hidden') && !!document.getElementById('clPicNew')`), 'clicking the club picture opens Change / Reset picture');
  await js(A, `document.querySelector('.cl-member b').click(); true`);
  await wait(300);
  await js(A, `${G}.meta.openPanel('clubs'); true`);
  await wait(400);
  await js(A, `document.querySelector('[data-kick]').click(); true`);
  const kick = await js(A, `({ ask: !document.getElementById('confirm').classList.contains('hidden') && /Remove/.test(document.getElementById('confirmTitle').textContent), pops: window.__pops })`);
  check(kick.ask && kick.pops === 0, 'removing a member asks inside the game (no browser pop-up)');
  await js(A, `${G}.meta.closeConfirm(); true`);
  // rename
  await js(A, `${G}.net.send({ t: 'clubEdit', name: 'Renamed ${a.slice(2)}', open: true, minTro: 0, desc: 'Testing', badge: 2 }); true`);
  await wait(900);
  check(await js(B, `${G}.account.club.name`) === `Renamed ${a.slice(2)}`, 'the owner renamed the club; members see the new name');
  await js(A, `${G}.meta.closePanel(); true`);

  // ---------------- calls ----------------
  await js(A, `${G}.calls.start('${b}'); true`);
  await wait(900);
  const ring = await js(B, `({ st: ${G}.calls.call && ${G}.calls.call.state, card: !document.getElementById('callCard').classList.contains('hidden'), yes: !!document.getElementById('ccYes'), ringing: ${G}.calls.ringing, bg: getComputedStyle(document.getElementById('callCard')).backgroundColor })`);
  const out = await js(A, `${G}.calls.call && ${G}.calls.call.state`);
  check(ring.st === 'in' && ring.card && ring.yes && ring.ringing === 'in' && out === 'out', `B's game rings with Accept / Decline, A sees "Calling…" (${ring.st}/${out}, ${ring.ringing})`);
  await js(B, `document.getElementById('ccYes').click(); true`);
  await wait(2500);
  const live = await js(A, `({ st: ${G}.calls.call && ${G}.calls.call.state, joined: ${G}.voice.joined, peers: [...${G}.voice.peers.values()].map((p) => p.name), time: (document.getElementById('ccTime') || {}).textContent })`);
  const liveB = await js(B, `({ st: ${G}.calls.call && ${G}.calls.call.state, ringing: ${G}.calls.ringing, voice: ${G}.settings.voice })`);
  check(live.st === 'live' && liveB.st === 'live' && !liveB.ringing && liveB.voice, `picked up: both in the call, the ringing stopped (${live.st}/${liveB.st})`);
  check(live.joined && live.peers.includes(b), `in a call (no party, no match) you're in voice with each other (${JSON.stringify(live.peers)})`);
  await js(A, `document.getElementById('ccEnd').click(); true`);
  await wait(900);
  check(await js(B, `${G}.calls.call === null && document.getElementById('callCard').classList.contains('hidden')`), 'hanging up ends the call for both');
  // decline
  await wait(3100);
  await js(A, `${G}.calls.start('${b}'); true`);
  await wait(800);
  await js(B, `document.getElementById('ccNo').click(); true`);
  await wait(800);
  check(await js(A, `${G}.calls.call === null`), 'declining ends the ringing on the caller\'s side');

  // ---------------- typing to a room before the match ----------------
  await js(A, `${G}.net.send({ t: 'create', pub: false, settings: ${G}.net.defaultSettings() }); true`);
  await wait(1200);
  const code = await js(A, `${G}.net.room && ${G}.net.room.code`);
  await js(B, `${G}.net.send({ t: 'join', code: '${code}' }); true`);
  await wait(1200);
  check(await js(A, `!document.getElementById('lbForm').classList.contains('hidden')`), 'the room screen has a box to type in while waiting');
  await js(A, `${G}.talk.sayTo('game', { x: 'hello room' }); true`);
  await wait(900);
  check(await js(B, `(${G}.net.chatLog || []).some((l) => /hello room/.test(l))`), 'typed messages reach everyone in the room before the match');
  await js(A, `${G}.talk.open('game'); true`);
  check(await js(A, `!document.getElementById('chatForm').classList.contains('hidden')`), "the chat's Match tab lets you type while waiting");
  await js(A, `${G}.talk.close(); ${G}.net.leaveRoom(); true`);
  await js(B, `${G}.net.leaveRoom(); true`);
  for (const w of [A, B]) await js(w, `${G}.showMenu(); true`);
  await wait(800);

  // ---------------- the chat: click outside closes it; two-key chat key ----------------
  await js(A, `${G}.talk.open('club'); true`);
  await js(A, `document.getElementById('menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  check(await js(A, `!${G}.talk.isOpen`), 'a click outside the chat closes it');
  await js(A, `${G}.settings.chatStay = true; ${G}.talk.open('club'); document.getElementById('menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  check(await js(A, `${G}.talk.isOpen`), '"Keep the chat open" keeps it open');
  await js(A, `${G}.talk.close(); ${G}.settings.chatStay = false; ${G}.settings.chatKey = 'ShiftLeft+Tab'; true`);
  const key = (code, type = 'keydown') => `window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true }));`;
  await js(A, `${key('Tab')} ${key('Tab', 'keyup')} true`);
  const tabOnly = await js(A, `${G}.talk.isOpen`);
  await js(A, `${key('ShiftLeft')} ${key('Tab')} ${key('Tab', 'keyup')} ${key('ShiftLeft', 'keyup')} true`);
  const both = await js(A, `${G}.talk.isOpen`);
  check(!tabOnly && both, 'a two-key chat key (Shift + Tab) opens the chat; Tab alone does not');
  check(await js(A, `CW.bindName('ShiftLeft+Tab')`) === 'Shift + Tab', 'two-key names read "Shift + Tab"');
  await js(A, `${G}.talk.close(); ${G}.settings.chatKey = 'KeyT'; true`);
  // setting a two-key voice key in Settings
  await js(A, `${G}.meta.setTab = 'voice'; ${G}.meta.openPanel('settings'); document.querySelector('[data-vkey="vcMute"]').click(); ${key('ControlLeft')} ${key('KeyM')} true`);
  await wait(200);
  check(await js(A, `${G}.settings.vcMute`) === 'ControlLeft+KeyM', 'Settings: hold one key and press another sets a two-key voice key');
  await js(A, `${G}.settings.vcMute = 'KeyM'; ${G}.meta.closePanel(); true`);

  // ---------------- fullscreen in the desktop app ----------------
  check(await js(A, `(() => { let n = 0; window.CogwildDesktop = { fullscreen: () => n++, presence() {} }; ${G}.toggleFullscreen(); ${G}.toggleFullscreen(); delete window.CogwildDesktop; return n; })()`) === 2, 'the fullscreen button always goes to the app window (works after F11 too)');

  // ---------------- a match: HUD boxes, climbing the sides ----------------
  await js(A, `${G}.playOffline('clash', 'desert', null); true`);
  await js(A, `(async () => { const g = ${G}; for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  await js(A, `${G}.settings.hudBg = 0; ${G}.applySettings(); true`);
  const bg0 = await js(A, `getComputedStyle(document.getElementById('status')).backgroundColor`);
  await js(A, `${G}.settings.hudBg = 1; ${G}.applySettings(); true`);
  const bg1 = await js(A, `getComputedStyle(document.getElementById('status')).backgroundColor`);
  const alpha = (c) => +((c.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1] ?? 1);
  check(alpha(bg0) === 0 && alpha(bg1) > 0.1, `the health box slider: 0% = no box, 100% = as before (${bg0} / ${bg1})`);
  // drive into the side of the arena: fast = up the slope (higher than the old force field), slow = rolls back
  const climb = (speed) => js(A, `(async () => {
    const g = ${G}, m = g.player.mech, w = g.world;
    for (const e of g.mechs) if (e !== m) e.place(e.pos.clone().setX(-120), 0);
    m.place({ x: 158, z: 0 }, -Math.PI / 2);
    m.vel.set(${speed}, 0, 0);
    g.keys.KeyW = ${speed > 10};
    const y0 = m.pos.y; let maxX = 0, maxY = 0, flip = false;
    for (let i = 0; i < 360; i++) { g.tick(1 / 60); maxX = Math.max(maxX, m.pos.x); maxY = Math.max(maxY, m.pos.y - y0); if (m.flipT > 0) flip = true; if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.keys.KeyW = false;
    return { maxX: Math.round(maxX), up: Math.round(maxY), end: Math.round(m.pos.x), flip, rise: Math.round(w.groundAt(185, 0) - w.groundAt(158, 0)) };
  })()`);
  const fast = await climb(45);
  check(fast.maxX > 178 && fast.up > 8, `a fast mech drives up the side past the old border (x ${fast.maxX}, ${fast.up} m up, slope rises ${fast.rise} m)`);
  check(fast.end < fast.maxX, `…and comes back down instead of staying on the edge (ended at x ${fast.end}${fast.flip ? ', flipped over at the force field' : ''})`);
  const slow = await climb(4);
  check(slow.maxX < 176, `a slow mech can't crawl up the steep side (x ${slow.maxX})`);
  await js(A, `${G}.showMenu(); true`);

  check(await js(A, `window.__pops`) === 0 && await js(B, `window.__pops`) === 0, 'no browser pop-ups were used');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
