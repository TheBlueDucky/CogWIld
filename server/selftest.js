// Cogwild server self-test: starts a throwaway server and checks accounts, cloud saves, friends,
// parties, Quick Match bots and trophies end to end over real WebSockets.
//   node --experimental-websocket server/selftest.js      (Node 20; Node 22+ needs no flag)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8800 + Math.floor(Math.random() * 100);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwild-test-'));
const VER = 'cogwild-net-10';
let server;
let failed = 0;

// a fake mail server (plain SMTP) that keeps every email it gets, and a fake Google key set
const net = require('net'), http = require('http'), crypto = require('crypto');
const SMTP_PORT = PORT + 200, CERTS_PORT = PORT + 300;
const mails = [];
net.createServer((sock) => {
  let buf = '', data = null, auth = 0;
  sock.on('error', () => {});
  sock.write('220 fake\r\n');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (data !== null) {
        if (line === '.') { mails.push(data); data = null; sock.write('250 ok\r\n'); } else data += line + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
      else if (cmd === 'AUTH') { auth = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (auth === 1) { auth = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (auth === 2) { auth = 0; sock.write('235 ok\r\n'); }
      else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 ok\r\n');
      else if (cmd === 'DATA') { data = ''; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('500 what\r\n');
    }
  });
}).listen(SMTP_PORT, '127.0.0.1');
const gkey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
http.createServer((req, res) => { res.end(JSON.stringify({ keys: [Object.assign(gkey.publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' })] })); }).listen(CERTS_PORT, '127.0.0.1');
function googleToken(email, aud = 'test-client', nonce) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), body = enc({ iss: 'https://accounts.google.com', aud, email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, nonce });
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), gkey.privateKey).toString('base64url')}`;
}
// the 6-digit code from the newest email to this address
function codeFor(email) {
  for (let i = mails.length - 1; i >= 0; i--) {
    if (!mails[i].includes('To: ' + email)) continue;
    const body = Buffer.from(mails[i].split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString('utf8');
    const m = /code is (\d{6})/.exec(body);
    if (m) return m[1];
  }
  return null;
}

function start(extra) {
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: DATA, SEARCH_SECS: '2', TROPHY_MIN_SECS: '0', SIGNUPS_PER_HOUR: '30', EVENT_DATE: '2026-10-26T12:00:00Z', MATCH_GAP_SECS: '1', ADMIN_TOKEN: 'a'.repeat(64), CUP_DATE: '2026-10-31T12:00:00Z',
    MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(SMTP_PORT), MAIL_SMTP_SECURE: 'none', MAIL_SMTP_USER: 'game@test.dev', MAIL_SMTP_PASS: 'mailpass123', MAIL_FROM: 'Cogwild <game@test.dev>',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CERTS_URL: `http://127.0.0.1:${CERTS_PORT}/certs` }, extra || {}), stdio: process.env.TEST_LOG ? 'inherit' : 'ignore' });
  return wait(700);
}
function stop() { return new Promise((res) => { server.once('exit', res); server.kill('SIGTERM'); }); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function get(url, method = 'GET') {
  return new Promise((res) => {
    const req = require('http').request({ host: '127.0.0.1', port: PORT, path: url, method }, (r) => { r.resume(); r.on('end', () => res({ status: r.statusCode, headers: r.headers })); });
    req.on('error', () => res({ status: 0, headers: {} }));
    req.end();
  });
}
// POST JSON to the server: { status, body }
function post(url, obj) {
  return new Promise((res) => {
    const data = JSON.stringify(obj);
    const req = require('http').request({ host: '127.0.0.1', port: PORT, path: url, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* not json */ } res({ status: r.statusCode, body: j }); });
    });
    req.on('error', () => res({ status: 0, body: null }));
    req.end(data);
  });
}
const nonceOf = (s) => crypto.createHash('sha256').update('cogwild-google:' + s).digest('hex');
// a tiny JPEG-shaped file (the server reads only its markers): w×h
function fakeJpeg(w, h) {
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0xca]), Buffer.alloc(200, 7)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), com, sof, Buffer.from([0xff, 0xd9])]).toString('base64');
}
function fetchPic(url) {
  return new Promise((res) => {
    require('http').get({ host: '127.0.0.1', port: PORT, path: url }, (r) => { const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'], bytes: Buffer.concat(parts).length })); }).on('error', () => res({ status: 0 }));
  });
}
function check(ok, what) { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; }

// a player: a socket plus a log of everything it received
function player() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const p = { ws, got: [], id: 0, cursor: 0 };
    p.send = (m) => ws.send(JSON.stringify(m));
    // resolves with the next unread message of type t (or one matching fn); reading moves the cursor past it
    p.next = (t, fn, ms = 4000) => new Promise((res, rej) => {
      const timer = setInterval(() => {
        const i = p.got.findIndex((x, j) => j >= p.cursor && x.t === t && (!fn || fn(x)));
        if (i >= 0) { clearInterval(timer); p.cursor = i + 1; res(p.got[i]); }
      }, 20);
      setTimeout(() => { clearInterval(timer); rej(new Error(`no "${t}" message`)); }, ms);
    });
    p.last = (t) => [...p.got].reverse().find((x) => x.t === t);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); p.got.push(m); if (m.t === 'welcome') { p.login = m.login; p.id = m.id; p.send({ t: 'hello', name: 'Guest', ver: VER }); resolve(p); } };
    ws.onerror = reject;
  });
}

async function main() {
  await start();
  console.log('accounts');
  const a = await player(), b = await player();
  a.send({ t: 'acctRegister', name: 'Alice_1', pass: 'secret123' });
  const aOk = await a.next('acctOk');
  check(aOk.me.name === 'Alice_1' && aOk.token.length === 64, 'register Alice');
  b.send({ t: 'acctRegister', name: 'alice_1', pass: 'secret123' });
  check(/taken/.test((await b.next('acctErr')).msg), 'username is case-insensitive unique');
  b.send({ t: 'acctRegister', name: 'x', pass: 'secret123' });
  check(/3-16/.test((await b.next('acctErr')).msg), 'too-short username refused');
  b.send({ t: 'acctRegister', name: 'BobCogwild', pass: 'secret123' });
  check(/different/.test((await b.next('acctErr')).msg), 'blocked word in username refused');
  b.send({ t: 'acctRegister', name: 'Bob', pass: '123' });
  check(/6 to 72/.test((await b.next('acctErr')).msg), 'short password refused');
  b.send({ t: 'acctRegister', name: 'Bob', pass: 'hunter22' });
  check((await b.next('acctOk')).me.name === 'Bob', 'register Bob');

  const a2 = await player();
  a2.send({ t: 'acctLogin', name: 'ALICE_1', pass: 'wrongpass' });
  check(/Wrong/.test((await a2.next('acctErr')).msg), 'wrong password refused');
  a2.send({ t: 'acctAuth', token: aOk.token });
  await a2.next('acctOk');
  check(!!(await a.next('acctOut', null, 2000).catch(() => null)) || !!a.last('acctOut'), 'logging in elsewhere signs out the old session');

  console.log('cloud save');
  a2.send({ t: 'save', data: { profile: { xp: 450, coins: 99 } }, lv: 4 });
  await a2.next('saved');
  const a3 = await player();
  a3.send({ t: 'acctLogin', name: 'alice_1', pass: 'secret123' });
  const relog = await a3.next('acctOk');
  check(relog.save && relog.save.data.profile.coins === 99 && relog.me.lv === 3, 'save comes back on the next login (level from the server XP)');
  const A = a3; // Alice's live session from here on

  console.log('friends');
  A.send({ t: 'friendAdd', name: 'bob' });
  check((await b.next('note', (m) => m.kind === 'friendReq')).from === 'Alice_1', 'Bob gets the friend request');
  b.send({ t: 'friendAccept', name: 'Alice_1' });
  const fl = await A.next('friends', (m) => m.list.length === 1);
  check(fl.list[0].name === 'Bob' && fl.list[0].on === true && fl.list[0].st === 'menu', 'Alice sees Bob online in the menu');
  b.send({ t: 'status', busy: true });
  check((await A.next('friends', (m) => m.list[0].st === 'solo')).list[0].st === 'solo', 'status updates reach friends');
  b.send({ t: 'status', busy: false });

  console.log('party');
  A.send({ t: 'partyInvite', name: 'Bob' });
  await b.next('note', (m) => m.kind === 'partyInvite');
  b.send({ t: 'partyAccept', from: 'Alice_1' });
  const party = await A.next('party', (m) => m.party && m.party.members.length === 2);
  check(party.party.leader === 'Alice_1', 'Bob joins Alice\'s party');
  console.log('chat (friends, party) and voice chat');
  A.send({ t: 'dmSend', to: 'Bob', x: 'hello\u202e <b>bob</b>\n  ' });
  const dm = await b.next('dm');
  check(dm.with === 'Alice_1' && dm.msg.x === 'hello <b>bob</b>', 'a friend gets a message (control characters and extra spaces removed)');
  check((await A.next('dm')).with === 'Bob', 'the sender sees their own message');
  b.send({ t: 'dmOpen', name: 'Alice_1' });
  check((await b.next('dmLog')).list.length === 1, 'messages are kept for later');
  A.send({ t: 'dmSend', to: 'nobody_here', x: 'hi' });
  check(/only message friends/.test((await A.next('acctErr')).msg), 'only friends can be messaged');
  await wait(600);
  A.send({ t: 'dmSend', to: 'Bob', x: 'x'.repeat(500) });
  check((await b.next('dm')).msg.x.length === 200, 'messages are cut at 200 characters');
  // the chat filter: bad words starred out (also disguised), contact details hidden, normal words untouched
  for (const [said, shown, what] of [
    ['you are a fuck', 'you are a ****', 'a bad word is starred out'],
    ['f u c k this', '**** this', 'a spaced-out bad word is starred out'],
    ['sh1t happens', '**** happens', 'a disguised bad word is starred out'],
    ['add me on discord: bob#1234 or call 054-123-4567', 'add me on [hidden] or call [hidden]', 'contact details are hidden'],
    ['go to www.example.com', 'go to [hidden]', 'links are hidden'],
    ['nice class, pass the grass', 'nice class, pass the grass', 'normal words stay as they are'],
  ]) {
    await wait(600);
    A.send({ t: 'dmSend', to: 'Bob', x: said });
    check((await b.next('dm')).msg.x === shown, `chat filter: ${what}`);
  }
  await wait(10500); // the anti-spam limit is 8 messages per 10 seconds
  await wait(600);
  A.send({ t: 'partySay', x: 'party time' });
  check((await b.next('partyMsg')).msg.x === 'party time', 'party chat reaches the party');
  // quick chat only (kids): no free text either way
  b.send({ t: 'chatMode', mode: 'quick' });
  check((await b.next('talk', (m) => !!m.mode)).mode === 'quick', 'Bob turns on Quick chat only');
  await wait(600);
  A.send({ t: 'dmSend', to: 'Bob', x: 'free text' });
  check(/quick chat only/.test((await A.next('acctErr')).msg), 'free text to a quick-chat-only player is refused');
  await wait(600);
  A.send({ t: 'dmSend', to: 'Bob', q: 1 });
  check((await b.next('dm')).msg.q === 1, 'quick lines still reach them');
  await wait(600);
  A.send({ t: 'partySay', x: 'secret words' });
  check(!(await b.next('partyMsg', null, 800).catch(() => null)), 'free party chat skips a quick-chat-only player');
  b.send({ t: 'partySay', x: 'can I type?' });
  check(/Quick chat only/.test((await b.next('acctErr')).msg), 'a quick-chat-only player cannot type freely');
  b.send({ t: 'vcState', on: true });
  check(/Voice chat is off/.test((await b.next('acctErr')).msg), 'and gets no voice chat');
  b.send({ t: 'chatMode', mode: 'free' });
  await b.next('talk', (m) => m.mode === 'free');
  // voice: party members get connected, call set-up passes between them
  A.send({ t: 'vcState', on: true, hear: 'game' });
  b.send({ t: 'vcState', on: true, hear: 'party' });
  const pa = await A.next('vcPeers', (m) => m.list.length === 1, 3000);
  const pb = await b.next('vcPeers', (m) => m.list.length === 1, 3000);
  check(pa.list[0].name === 'Bob' && pa.list[0].party && pb.list[0].name === 'Alice_1' && pa.ice.length >= 1, 'voice chat connects party members');
  A.send({ t: 'vcSig', to: pa.list[0].id, d: { sdp: { type: 'offer', sdp: 'v=0' } } });
  check((await b.next('vcSig')).d.sdp.type === 'offer', 'call set-up passes from one player to the other');
  A.send({ t: 'vcSig', to: 999999, d: { x: 1 } });
  // block: nothing reaches you, no voice
  b.send({ t: 'block', name: 'Alice_1' });
  check((await b.next('talk', (m) => !!m.blocked)).blocked[0] === 'Alice_1', 'Bob blocks Alice');
  check(!!(await A.next('vcPeers', (m) => m.list.length === 0, 3000)), 'a blocked player is cut from voice chat');
  await wait(600);
  A.send({ t: 'dmSend', to: 'Bob', x: 'hey' });
  check(/can't message/.test((await A.next('acctErr')).msg), 'a blocked player cannot message you');
  b.send({ t: 'unblock', name: 'Alice_1' });
  await b.next('talk', (m) => m.blocked && !m.blocked.length);
  b.send({ t: 'report', name: 'Alice_1', why: 'Spam' });
  check(/Thanks/.test((await b.next('note', (m) => /report/.test(m.msg))).msg), 'reporting a player is confirmed');
  A.send({ t: 'vcState', on: false }); b.send({ t: 'vcState', on: false });
  await wait(600);
  const waitA = A.next('room'), waitB = b.next('room');
  A.send({ t: 'quick' });
  const [ar, br] = await Promise.all([waitA, waitB]);
  check(ar.room.code === br.room.code, 'party member follows the leader into Quick Match');


  console.log('trophies');
  A.send({ t: 'begin', payload: {} });
  await wait(150);
  const waitAt = A.next('trophies'), waitBt = b.next('trophies');
  A.send({ t: 'end', res: { [A.id]: 1, [b.id]: 2 }, n: 8 });
  const [at, bt] = await Promise.all([waitAt, waitBt]);
  check(at.d === 8 && at.tro === 8, `winner +8 (got ${at.d})`);
  check(bt.d > 0 && bt.d < 8, `2nd place gains less (got ${bt.d})`);
  A.send({ t: 'top' });
  const top = await A.next('top');
  check(top.list[0].name === 'Alice_1' && top.me.rank === 1, 'leaderboard ranks Alice first');
  const guest = await player();
  guest.send({ t: 'quick' });
  await guest.next('room');
  guest.send({ t: 'begin', payload: {} });
  await wait(150);
  guest.send({ t: 'end', res: { [guest.id]: 1 }, n: 8 });
  check(!(await guest.next('trophies', null, 800).catch(() => null)), 'guests play but earn no trophies');

  console.log('matchmaking');
  const m1 = await player(), m2 = await player(), m3 = await player();
  m1.send({ t: 'quick', arena: 'canyon' });
  const r1 = await m1.next('room');
  m2.send({ t: 'quick', arena: 'isles' });
  const r2 = await m2.next('room');
  check(r1.room.settings.arena === 'canyon' && r2.room.code !== r1.room.code, 'each arena has its own queue');
  m3.send({ t: 'quick', arena: 'random' });
  const r3 = await m3.next('room');
  check(r3.room.players.length >= 2, '"any arena" joins a search that is already running');
  const lone = r3.room.code === r1.room.code ? m2 : m1;
  const filled = await lone.next('room', (m) => m.room.bots.length > 0, 6000);
  check(filled.room.bots.length === 8 - filled.room.players.length, `after the search, bots fill every empty seat (${filled.room.bots.length} bots)`);
  check(!!(await lone.next('autostart', null, 3000)), 'the host is told to start right away');

  console.log('new arenas and older games');
  const ALLA = require('../js/featured.js').ARENAS;
  const n1 = await player(), o1 = await player(), o2 = await player(), n2 = await player();
  for (const p of [n1, n2]) p.send({ t: 'hello', name: 'Newer', ver: VER, arenas: ALLA });
  n1.send({ t: 'quick', mode: 'koth', arena: 'moon' });
  const rn = await n1.next('room');
  check(rn.room.settings.arena === 'moon' && rn.room.arenas.includes('moon'), 'a new game can search on a new arena');
  o1.send({ t: 'quick', mode: 'koth', arena: 'random' });
  const ro = await o1.next('room');
  check(ro.room.code !== rn.room.code && !ro.room.arenas.includes('moon'), 'an older game never joins a search on an arena it does not have');
  o2.send({ t: 'quick', mode: 'gold', arena: 'random' });
  await o2.next('room');
  n2.send({ t: 'quick', mode: 'gold', arena: 'random' });
  const rmix = await n2.next('room');
  check(rmix.room.players.length === 2 && rmix.room.arenas.length === 8 && !rmix.room.arenas.includes('bay'), `with an older game in the room, only the classic arenas can be picked (${rmix.room.arenas.length})`);
  for (const p of [n1, o1, o2, n2]) p.ws.close();

  console.log('persistence');
  await wait(2000); // the database is written ~1.5 s after a change (Windows kills without SIGTERM)
  await stop();
  await start();
  const a4 = await player();
  a4.send({ t: 'acctLogin', name: 'Alice_1', pass: 'secret123' });
  const back = await a4.next('acctOk');
  check(back.me.tro === 8 && back.me.wins === 1, 'trophies survive a server restart');
  const fr = await a4.next('friends');
  check(fr.list.length === 1 && fr.list[0].on === false, 'friends survive a restart (Bob offline)');

  console.log('password + delete');
  a4.send({ t: 'acctPass', old: 'secret123', pass: 'newpass456' });
  await a4.next('acctPassOk');
  const a5 = await player();
  a5.send({ t: 'acctLogin', name: 'Alice_1', pass: 'secret123' });
  check(/Wrong/.test((await a5.next('acctErr')).msg), 'old password stops working');
  const b2 = await player();
  b2.send({ t: 'acctLogin', name: 'Bob', pass: 'hunter22' });
  await b2.next('acctOk');
  const waitFr = a4.next('friends', (m) => m.list.length === 0);
  b2.send({ t: 'acctDelete', pass: 'hunter22' });
  await b2.next('acctOut');
  check(!!(await waitFr), 'deleting Bob removes him from Alice\'s friends');

  console.log('trophy matchmaking');
  await wait(2000);
  await stop();
  // make Alice a 600-trophy player, then a 0-trophy newcomer must not land in her room
  const dbFile = path.join(DATA, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  db.users.alice_1.tro = 600;
  db.users.alice_1.best = 600;
  fs.writeFileSync(dbFile, JSON.stringify(db));
  await start();
  const hi = await player(), lo = await player(), gst = await player();
  hi.send({ t: 'acctLogin', name: 'Alice_1', pass: 'newpass456' });
  await hi.next('acctOk');
  lo.send({ t: 'acctRegister', name: 'Newbie', pass: 'newbie123' });
  await lo.next('acctOk');
  hi.send({ t: 'quick', mode: 'gold', arena: 'canyon' });
  const hr = await hi.next('room');
  lo.send({ t: 'quick', mode: 'gold', arena: 'canyon' });
  const lr = await lo.next('room');
  check(hr.room.code !== lr.room.code, '600 and 0 trophies are not matched together');
  gst.send({ t: 'quick', mode: 'gold', arena: 'canyon' });
  const gr = await gst.next('room');
  check(gr.room.players.length === 2, 'a guest joins a running search');
  const started = await hi.next('room', (m) => m.room.bots.length > 0, 6000);
  check(started.room.settings.difficulty === 'normal' && started.room.settings.format === 'squads', `bots match the room's trophies (${started.room.settings.difficulty}) in a 3v3`);

  console.log('economy (server keeps coins and unlocks)');
  const ec = await player();
  ec.send({ t: 'acctRegister', name: 'Spender', pass: 'spend1234' });
  check((await ec.next('acctOk')).wallet.fresh === true, 'a new account starts with a fresh wallet');
  ec.send({ t: 'save', data: { profile: { xp: 5, coins: 99999, owned: { paints: ['gold', 'p_aurora', 'bogus'], trails: ['fire'], avatars: [] } } } });
  const w0 = (await ec.next('wallet')).w;
  check(w0.coins === 3000 - 550 && w0.owned.paints.join() === 'gold' && w0.owned.trails.includes('fire'), `device progress comes along once, worth 3000 coins at most (${w0.coins} coins, ${w0.owned.paints})`);
  ec.send({ t: 'earn', src: 'match', n: 500, pp: 40, xp: 300 });
  const w1 = await ec.next('wallet');
  check(w1.w.coins === 2950 && w1.w.pass.pts === 40 && w1.w.xp === 305, 'a match pays coins, XP and pass points');
  check(w1.evPts === 40 && w1.w.ev && w1.w.ev.k === 'halloween2026' && w1.w.ev.pts === 40, `a match during Halloween gives 40 event points (${JSON.stringify(w1.w.ev)})`);
  ec.send({ t: 'earn', src: 'match', n: 500, pp: 40 });
  const w1b = await ec.next('wallet');
  check(w1b.earned === 0 && w1b.w.ev.pts === 40, 'two match rewards in a row are refused (no event points either)');
  ec.send({ t: 'earn', src: 'match', n: 999999 });
  const E0 = require('../js/economy.js');
  for (let i = 0; i < 3; i++) ec.send({ t: 'earn', src: 'challenge', n: 9999, key: 0 });
  ec.send({ t: 'earn', src: 'challenge', key: 1 });
  ec.send({ t: 'earn', src: 'ach', key: 'first', n: 9999 });
  ec.send({ t: 'earn', src: 'ach', key: 'first' });
  ec.send({ t: 'earn', src: 'ach', key: 'madeup' });
  let wc;
  for (let i = 0; i < 8; i++) wc = await ec.next('wallet');
  const dc = E0.dailyChallenges(E0.day());
  check(wc.w.coins === 2950 + dc[0].reward + dc[1].reward + E0.ACH.first, `challenges and achievements pay their listed reward once (${wc.w.coins})`);
  ec.send({ t: 'earn', src: 'chest', n: 150 });
  ec.send({ t: 'earn', src: 'chest', n: 150 });
  const cr1 = await ec.next('wallet'), cr2 = await ec.next('wallet');
  check(cr1.earned === 150 && cr2.earned === 0, 'one results crate per match');
  wc = cr2;
  ec.send({ t: 'buy', kind: 'paints', id: 'p_aurora' });
  check(/for sale/.test((await ec.next('acctErr')).msg), 'Cog Pass items cannot be bought');
  ec.send({ t: 'buy', kind: 'paints', id: 'neon' });
  const wb = await ec.next('wallet');
  check(wb.bought && wb.w.owned.paints.includes('neon') && wb.w.coins === wc.w.coins - (wb.bought.price), `buying a paint takes the server's price (${wb.bought.price})`);
  ec.send({ t: 'gift' });
  const wg = await ec.next('wallet');
  ec.send({ t: 'gift' });
  const wg2 = await ec.next('wallet');
  check(wg.gift === 50 && !wg2.gift && wg2.w.coins === wg.w.coins, 'the daily gift pays once a day');
  ec.send({ t: 'profileSet', av: 41 });
  check((await ec.next('acctMe')).me.av < 24, 'premium avatars must be owned');
  ec.send({ t: 'roadClaim', at: 10 });
  check(!(await ec.next('wallet')).road, 'Trophy Road needs the trophies');
  ec.send({ t: 'passClaim', tier: 1 });
  const wp = await ec.next('wallet');
  check(wp.pass === 1 && wp.w.pass.claimed.includes(1), 'Cog Pass tier 1 can be claimed with enough points');
  // the event track: points so far = 1 match + 2 challenges
  const evp = wp.w.ev.pts;
  check(evp === 40 + 2 * 20, `daily challenges give event points too (${evp})`);
  ec.send({ t: 'eventClaim', step: 2 });
  const we2 = await ec.next('wallet');
  check(!we2.evStep && !we2.w.owned.paints.includes('ev_pumpkin'), 'an event reward needs its points');
  ec.send({ t: 'buy', kind: 'paints', id: 'ev_pumpkin' });
  check(/for sale/.test((await ec.next('acctErr')).msg), 'event items cannot be bought');
  ec.send({ t: 'eventClaim', step: 1 });
  check(!(await ec.next('wallet')).evStep, `step 1 needs 150 points (has ${evp})`);
  // two more matches (this test server spaces match rewards 1 s apart instead of 20 s)
  for (let i = 0; i < 2; i++) { await new Promise((r) => setTimeout(r, 1100)); ec.send({ t: 'earn', src: 'match', n: 50, pp: 10 }); await ec.next('wallet'); }
  const coinsBefore = (await (ec.send({ t: 'eventClaim', step: 1 }), ec.next('wallet')));
  check(coinsBefore.evStep === 1 && coinsBefore.reward && coinsBefore.reward.coins === 250 && coinsBefore.w.ev.claimed.join() === '1', `with 160 points step 1 pays 250 coins (${JSON.stringify(coinsBefore.reward)})`);
  ec.send({ t: 'eventClaim', step: 1 });
  check(!(await ec.next('wallet')).evStep, 'an event step pays only once');
  ec.send({ t: 'eventClaim', step: 9 });
  check(!(await ec.next('wallet')).evStep, 'a made-up event step pays nothing');
  ec.send({ t: 'save', data: { profile: { xp: 5, coins: 1000000, owned: { paints: ['chrome'] } } } });
  await ec.next('saved');
  ec.ws.close();
  const ec2 = await player();
  ec2.send({ t: 'acctLogin', name: 'Spender', pass: 'spend1234' });
  const back2 = await ec2.next('acctOk');
  check(back2.save.data.profile.coins === back2.wallet.coins && !back2.wallet.owned.paints.includes('chrome'), 'a backup cannot change coins or unlocks');
  ec2.ws.close();

  console.log('guests (wallet on the server too)');
  const gu = await player();
  gu.send({ t: 'guest', profile: { coins: 500, xp: 1000, owned: { paints: ['chrome'] } } });
  const gok = await gu.next('guestOk');
  check(gok.token && gok.wallet.coins === 500 && gok.wallet.owned.paints.includes('chrome') && gok.wallet.xp === 1000, 'a new device gets a guest wallet with its progress');
  gu.send({ t: 'earn', src: 'match', n: 200, xp: 100, pp: 30 });
  check((await gu.next('wallet')).w.coins === 700, 'guests earn on the server');
  gu.send({ t: 'buy', kind: 'trails', id: 'fire' });
  const gb = await gu.next('wallet');
  check(gb.bought && gb.w.coins === 700 - gb.bought.price, 'guests buy at the server price');
  // the v1.8.2 shop kinds: a mech finish and a wreck effect (both too expensive here) are refused without coins
  gu.send({ t: 'buy', kind: 'finishes', id: 'gold' });
  check(/more coins/.test((await gu.next('acctErr')).msg), 'a mech finish costs coins (refused when short)');
  gu.send({ t: 'buy', kind: 'wrecks', id: 'nope' });
  check(/isn't for sale/.test((await gu.next('acctErr')).msg), 'an unknown wreck effect is not for sale');
  gu.ws.close();
  const gu2 = await player();
  gu2.send({ t: 'guest', token: gok.token, profile: { coins: 999999 } });
  const gback = await gu2.next('guestOk');
  check(!gback.token && gback.wallet.coins === gb.w.coins && gback.wallet.owned.trails.includes('fire'), 'the same device gets the same guest wallet back (and cannot add coins)');
  gu2.send({ t: 'acctRegister', name: 'FromGuest', pass: 'guest1234' });
  const fg = await gu2.next('acctOk');
  check(fg.wallet.coins === gb.w.coins && fg.wallet.owned.trails.includes('fire') && !fg.wallet.fresh, 'signing up keeps the guest wallet');
  // mechs online must fit the player's level (FromGuest has 1100 XP = level 4: no lasers yet)
  gu2.send({ t: 'create', pub: false, settings: {} });
  await gu2.next('room');
  gu2.send({ t: 'ready', ready: true, bp: { name: 'Cheat', color: 1, parts: [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'laser', x: 0, y: 1, z: 0 }] } });
  check(/allowed/.test((await gu2.next('err')).msg) && (await gu2.next('room')).room.players[0].bp === null, 'a mech with parts above your level is refused');
  gu2.send({ t: 'ready', ready: true, bp: { name: 'Fat', color: 1, parts: [{ t: 'core', x: 0, y: 0, z: 0 }].concat([...Array(27)].map((_, i) => ({ t: 'rotor', x: (i % 9) - 4, y: 1 + Math.floor(i / 9), z: 0 }))) } }); // 27 × 30 = 810 Bolts
  check(/over budget/.test((await gu2.next('err')).msg), 'an over-budget mech is refused');
  gu2.send({ t: 'begin', payload: { kind: 'match', arena: 'canyon', roster: [{ i: 1, o: gu2.id, h: 1, bp: { parts: [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'railgun', x: 0, y: 1, z: 0 }] } }] } });
  check(!!(await gu2.next('kicked', null, 2000).catch(() => null)), 'a host who starts a match with a mech that is not allowed is removed');
  gu2.ws.close();

  console.log('email and Google login');
  const em = await player();
  check(em.login && em.login.email === true && em.login.google === 'test-client', 'the server says email and Google login are on');
  em.send({ t: 'emailStart', email: 'not-an-email' });
  check(/email address/.test((await em.next('acctErr')).msg), 'a bad address is refused');
  em.send({ t: 'emailStart', email: 'Pilot.One@Example.com', purpose: 'signup' });
  await em.next('acctCodeSent');
  const code1 = codeFor('pilot.one@example.com');
  check(/^\d{6}$/.test(code1 || ''), 'the sign-up code arrives by email (real SMTP conversation)');
  em.send({ t: 'emailCode', email: 'pilot.one@example.com', code: code1 === '000000' ? '111111' : '000000', purpose: 'signup' });
  check(/isn't right/.test((await em.next('acctErr')).msg), 'a wrong code is refused');
  em.send({ t: 'emailCode', email: 'pilot.one@example.com', code: code1, purpose: 'signup' });
  const pick = await em.next('acctPickName');
  check(pick.email === 'pilot.one@example.com' && !pick.google, 'after the code, a new player picks a username and password');
  em.send({ t: 'emailName', name: 'PilotOne', pass: '123' });
  check(/6 to 72/.test((await em.next('acctErr')).msg), 'sign-up needs a real password');
  em.send({ t: 'emailName', name: 'PilotOne', pass: 'pilot-pass-1' });
  const eok = await em.next('acctOk');
  check(eok.me.name === 'PilotOne' && eok.email === 'pilot.one@example.com' && eok.hasPass === true, 'the account is made with that email, username and password');
  em.ws.close();
  const em2 = await player();
  em2.send({ t: 'emailStart', email: 'pilot.one@example.com', purpose: 'signup' });
  check(/already has an account/.test((await em2.next('acctErr')).msg), 'one account per email');
  em2.send({ t: 'acctLogin', name: 'Pilot.One@example.com', pass: 'wrong-pass' });
  check(/Wrong email or password/.test((await em2.next('acctErr')).msg), 'a wrong password is refused');
  em2.send({ t: 'acctLogin', name: 'pilot.one@example.com', pass: 'pilot-pass-1' });
  check((await em2.next('acctOk')).me.name === 'PilotOne', 'log in with email and password');
  em2.ws.close();
  // sign up in one go: email, password, username (here the server can send mail, so a code confirms the email)
  const su = await player();
  su.send({ t: 'acctSignup', email: 'pilot.one@example.com', pass: 'whatever1', name: 'Another1' });
  check(/already has an account/.test((await su.next('acctErr')).msg), 'sign up: one account per email');
  su.send({ t: 'acctSignup', email: 'Maker@Example.com', pass: 'maker-pass', name: 'PilotOne' });
  check(/taken/.test((await su.next('acctErr')).msg), 'sign up: usernames are unique');
  su.send({ t: 'acctSignup', email: 'Maker@Example.com', pass: 'maker-pass', name: 'Maker' });
  check(/isn't your email/.test((await su.next('acctErr')).msg), "sign up: the username can't be the email");
  su.send({ t: 'acctSignup', email: 'Maker@Example.com', pass: 'maker-pass', name: 'BuildMaster' });
  await su.next('acctCodeSent');
  su.send({ t: 'emailCode', email: 'maker@example.com', code: codeFor('maker@example.com'), purpose: 'signup' });
  const sok = await su.next('acctOk');
  check(sok.me.name === 'BuildMaster' && sok.email === 'maker@example.com' && sok.hasPass, 'sign up with email, password and username (code confirms the email)');
  su.ws.close();
  const su2 = await player();
  su2.send({ t: 'acctLogin', name: 'maker@example.com', pass: 'maker-pass' });
  check((await su2.next('acctOk')).me.name === 'BuildMaster', 'the new account logs in with email and password');
  su2.ws.close();
  // forgot the password: a code to the email, then a new one
  const rs = await player();
  rs.send({ t: 'emailStart', email: 'nobody@example.com', purpose: 'reset' });
  check(!!(await rs.next('acctCodeSent')), "asking for a new password doesn't tell who has an account");
  rs.send({ t: 'emailStart', email: 'pilot.one@example.com', purpose: 'reset' });
  await rs.next('acctCodeSent');
  rs.send({ t: 'emailCode', email: 'pilot.one@example.com', code: codeFor('pilot.one@example.com'), purpose: 'reset' });
  await rs.next('acctNewPass');
  rs.send({ t: 'acctResetPass', pass: 'brand-new-pass' });
  check((await rs.next('acctOk')).me.name === 'PilotOne', 'a forgotten password can be replaced with an emailed code');
  rs.ws.close();
  const rs2 = await player();
  rs2.send({ t: 'acctLogin', name: 'pilot.one@example.com', pass: 'brand-new-pass' });
  check((await rs2.next('acctOk')).me.name === 'PilotOne', 'and the new password works');
  rs2.ws.close();
  const gg = await player();
  gg.send({ t: 'googleLogin', credential: googleToken('someone@gmail.com', 'other-app') });
  check(/not for this game/.test((await gg.next('acctErr')).msg), 'a Google token for another app is refused');
  { const tk = googleToken('someone@gmail.com'), at = tk.length - 20; gg.send({ t: 'googleLogin', credential: tk.slice(0, at) + (tk[at] === 'B' ? 'C' : 'B') + tk.slice(at + 1) }); }
  check(!!(await gg.next('acctErr')), 'a tampered Google token is refused');
  gg.send({ t: 'googleLogin', credential: googleToken('someone@gmail.com') });
  check((await gg.next('acctPickName')).google === true, 'a new Google player picks a username (no password needed)');
  gg.send({ t: 'emailName', name: 'GoogleFan' });
  check((await gg.next('acctOk')).email === 'someone@gmail.com', 'Google sign-in makes an account with the Google email');
  gg.ws.close();
  // Google in the player's own browser: the game waits with a secret, the browser page posts the token
  const secret = crypto.randomBytes(24).toString('hex');
  const go = await get('/auth/google?s=' + secret);
  check(go.status === 302 && /accounts\.google\.com/.test(go.headers.location) && go.headers.location.includes('state=' + secret) && go.headers.location.includes(encodeURIComponent('/auth/google/done')), 'the sign-in link sends the browser to Google, coming back to the game');
  check((await get('/auth/google/done')).status === 200, 'the page Google sends players back to is there');
  const gw = await player();
  gw.send({ t: 'googleStart', s: secret });
  await wait(200);
  check((await post('/auth/google/finish', { s: secret, token: googleToken('browser.fan@gmail.com', 'test-client', 'wrong-nonce') })).status === 400, 'a token from another sign-in is refused');
  const fin = await post('/auth/google/finish', { s: secret, token: googleToken('browser.fan@gmail.com', 'test-client', nonceOf(secret)) });
  check(fin.status === 200 && fin.body.ok, 'the browser page finishes the sign-in');
  check((await gw.next('acctPickName')).google === true, 'the waiting game is asked for a username');
  gw.send({ t: 'emailName', name: 'BrowserFan' });
  const bfOk = await gw.next('acctOk');
  check(bfOk.email === 'browser.fan@gmail.com' && !bfOk.hasPass, 'a Google account is made without a password');
  gw.ws.close();
  // logging in again later: same Google account, straight in
  const secret2 = crypto.randomBytes(24).toString('hex');
  await post('/auth/google/finish', { s: secret2, token: googleToken('browser.fan@gmail.com', 'test-client', nonceOf(secret2)) }); // the game was reconnecting
  const gw2 = await player();
  gw2.send({ t: 'googleStart', s: secret2 });
  check((await gw2.next('acctOk')).me.name === 'BrowserFan', 'logging in with Google again goes straight in (even after a reconnect)');
  gw2.ws.close();
  // an old username + password account adds an email, then logs in with it
  const ol = await player();
  ol.send({ t: 'acctLogin', name: 'Spender', pass: 'spend1234' });
  await ol.next('acctOk');
  ol.send({ t: 'emailStart', email: 'spender@outlook.com' });
  await ol.next('acctCodeSent');
  ol.send({ t: 'emailCode', email: 'spender@outlook.com', code: codeFor('spender@outlook.com') });
  check((await ol.next('acctEmailSet')).email === 'spender@outlook.com', 'an old account can add an email');
  ol.ws.close();
  const ol2 = await player();
  ol2.send({ t: 'acctLogin', name: 'spender@outlook.com', pass: 'spend1234' });
  check((await ol2.next('acctOk')).me.name === 'Spender', 'and then logs in with that email and the same password');
  ol2.ws.close();

  console.log('clubs');
  const cA = await player(), cB = await player();
  cA.send({ t: 'acctLogin', name: 'Spender', pass: 'spend1234' });
  await cA.next('acctOk');
  cB.send({ t: 'acctLogin', name: 'Newbie', pass: 'newbie123' }); // locked by the wrong-password test? log in another way below
  await wait(1500);
  const nb = cB.got.some((m) => m.t === 'acctOk');
  cB.cursor = cB.got.length;
  if (!nb) { cB.send({ t: 'acctLogin', name: 'Alice_1', pass: 'newpass456' }); await cB.next('acctOk'); }
  cA.send({ t: 'clubCreate', name: 'Fuck Squad', badge: 3 });
  check(/different club name/.test((await cA.next('acctErr')).msg), 'a club name with a bad word is refused');
  cA.send({ t: 'clubCreate', name: '<b>', badge: 3 });
  check(/Club names/.test((await cA.next('acctErr')).msg), 'bad club names are refused');
  cA.send({ t: 'clubCreate', name: 'Gear Heads', badge: 3, desc: 'We build', open: true });
  const made = (await cA.next('club', (m) => !!m.club)).club;
  check(made.name === 'Gear Heads' && made.list.length === 1 && made.list[0].role === 'owner', 'create a club');
  cB.send({ t: 'clubCreate', name: 'gear heads' });
  check(/taken/.test((await cB.next('acctErr')).msg), 'club names are unique');
  cB.send({ t: 'clubList', q: 'gear' });
  const found = (await cB.next('clubs')).list;
  check(found.length === 1 && found[0].id === made.id, 'search finds the club');
  cB.send({ t: 'clubJoin', id: made.id });
  const joined = (await cB.next('club', (m) => m.club && m.club.list.length === 2)).club;
  check(joined.members === 2, 'a second player joins');
  check(!!(await cA.next('club', (m) => m.club && m.club.list.length === 2)), 'the owner sees them join');
  cB.send({ t: 'clubSay', x: 'hi club' });
  check((await cA.next('clubMsg')).msg.x === 'hi club', 'club chat reaches members');
  // players in the same club can message each other without being friends
  const cBname = cB.last('acctOk').me.name;
  await wait(600);
  cA.send({ t: 'dmSend', to: cBname, x: 'hello club-mate' });
  check((await cB.next('dm')).msg.x === 'hello club-mate', 'club-mates can message each other');
  // pictures: square JPEGs only, shown to others, club picture by the owner only
  cA.send({ t: 'picSet', kind: 'u', data: fakeJpeg(512, 512) });
  check(/256/.test((await cA.next('acctErr')).msg), 'a picture bigger than 256×256 is refused');
  await wait(5100);
  cA.send({ t: 'picSet', kind: 'u', data: fakeJpeg(256, 200) });
  check(/square/.test((await cA.next('acctErr')).msg), 'a picture that isn\'t square is refused');
  await wait(5100);
  cA.send({ t: 'picSet', kind: 'u', data: Buffer.from('<svg onload=alert(1)>').toString('base64') });
  check(/couldn't be used/.test((await cA.next('acctErr')).msg), 'something that isn\'t a JPEG is refused');
  await wait(5100);
  cA.send({ t: 'picSet', kind: 'u', data: fakeJpeg(256, 256) });
  const pv = (await cA.next('acctMe', (m) => m.me.pv > 0)).me.pv;
  const pic = await fetchPic('/pic/u/spender.jpg?v=' + pv);
  check(pic.status === 200 && pic.type === 'image/jpeg' && pic.bytes > 200, 'your own square picture is saved and shown');
  check(!!(await cB.next('club', (m) => m.club && m.club.list.some((p) => p.name === 'Spender' && p.pv > 0))), 'club members see the new picture');
  cB.send({ t: 'picSet', kind: 'c', data: fakeJpeg(128, 128) });
  check(/Only the club owner/.test((await cB.next('acctErr')).msg), 'only the club owner can change the club picture');
  await wait(5100);
  cA.send({ t: 'picSet', kind: 'c', data: fakeJpeg(128, 128) });
  const cpv = await cA.next('club', (m) => m.club && m.club.pv > 0);
  check((await fetchPic(`/pic/c/${cpv.club.id}.jpg?v=1`)).status === 200, 'the club owner sets a club picture');
  check((await fetchPic('/pic/u/..%2Fdb.jpg')).status === 404 && (await fetchPic('/pic/u/nobody.jpg')).status === 404, 'other files and missing pictures are not served');
  cA.send({ t: 'profile', name: cB.last('acctOk').me.name });
  check((await cA.next('profile')).p.club === 'Gear Heads', 'profiles show the club');
  cA.send({ t: 'clubLeave' });
  await cA.next('club', (m) => m.club === null);
  check((await cB.next('club', (m) => m.club && m.club.list.length === 1)).club.list[0].role === 'owner', 'when the owner leaves, a member takes over');
  cB.send({ t: 'clubLeave' });
  await cB.next('club', (m) => m.club === null);
  cB.send({ t: 'clubList' });
  check(!(await cB.next('clubs')).list.length, 'an empty club is closed');
  cA.ws.close(); cB.ws.close();

  // friends' and club messages are deleted after a week
  {
    const { Talk } = require('./talk');
    const old = Date.now() - 8 * 86400000, now = Date.now();
    const fake = { db: { users: {}, dms: { 'a|b': [{ f: 'a', x: 'old', at: old }, { f: 'a', x: 'new', at: now }] }, clubChat: { c1: [{ f: 'a', x: 'old', at: old }] } }, dirty() {} };
    new Talk(fake, { clients: new Map(), rooms: new Map() });
    check(fake.db.dms['a|b'].length === 1 && fake.db.dms['a|b'][0].x === 'new' && !fake.db.clubChat.c1, 'messages older than a week are deleted');
  }

  console.log('username change');
  {
    const ra = await player(), rb = await player();
    ra.send({ t: 'acctRegister', name: 'Ren_A', pass: 'renpass1' }); await ra.next('acctOk');
    rb.send({ t: 'acctRegister', name: 'Ren_B', pass: 'renpass2' }); await rb.next('acctOk');
    ra.send({ t: 'friendAdd', name: 'Ren_B' }); await rb.next('note', (m) => m.kind === 'friendReq');
    rb.send({ t: 'friendAccept', name: 'Ren_A' }); await ra.next('friends', (m) => m.list.length === 1);
    ra.send({ t: 'dmSend', to: 'Ren_B', x: 'hello before' }); await rb.next('dm');
    ra.send({ t: 'acctRename', name: 'Ren_New' });
    check((await ra.next('acctMe')).me.name === 'Ren_New', 'a logged-in player can change their username');
    check((await rb.next('friends', (m) => m.list.some((f) => f.name === 'Ren_New'))).list.length === 1, 'friends see the new name (still friends)');
    rb.send({ t: 'dmOpen', name: 'Ren_New' });
    const log = await rb.next('dmLog');
    check(log.list.length === 1 && log.list[0].f === 'Ren_New', 'private messages move to the new name');
    ra.send({ t: 'acctRename', name: 'Ren_Again' });
    check(/again in 7 days/.test((await ra.next('acctErr')).msg), 'a second new name has to wait a week');
    ra.send({ t: 'acctRename', name: 'REN_new' });
    check((await ra.next('acctMe')).me.name === 'REN_new', 'changing only capital letters is always fine');
    rb.send({ t: 'acctRename', name: 'ren_new' });
    check(/taken/.test((await rb.next('acctErr')).msg), "someone else's name is refused");
    const rl = await player();
    rl.send({ t: 'acctLogin', name: 'ren_new', pass: 'renpass1' });
    check((await rl.next('acctOk')).me.name === 'REN_new', 'logging in works with the new name and the same password');
    const rf = await player();
    rf.send({ t: 'acctRegister', name: 'Ren_A', pass: 'renpass3' });
    check((await rf.next('acctOk')).me.name === 'Ren_A', 'the old name is free again');
    for (const x of [ra, rb, rl, rf]) x.ws.close();
  }

  console.log('mech gallery');
  {
    const ga = await player(), gb = await player(), gc = await player(), gd = await player(), gg = await player();
    const reg = async (p, name) => { p.send({ t: 'acctRegister', name, pass: 'galpass1' }); return (await p.next('acctOk')).me; };
    await reg(ga, 'GalA'); await reg(gb, 'GalB'); await reg(gc, 'GalC'); await reg(gd, 'GalD');
    const buggy = [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'camera', x: 0, y: 1, z: 0 }, { t: 'wheel', x: -1, y: 0, z: -1 }, { t: 'wheel', x: 1, y: 0, z: -1 }, { t: 'wheel', x: -1, y: 0, z: 1 }, { t: 'wheel', x: 1, y: 0, z: 1 }, { t: 'cannon', x: 0, y: 0, z: -1 }];
    const boat = [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'float', x: -1, y: 0, z: 0 }, { t: 'float', x: 1, y: 0, z: 0 }, { t: 'prop', x: 0, y: 0, z: 1 }, { t: 'rotor', x: 0, y: 1, z: 0 }];
    gg.send({ t: 'galPublish', bp: { name: 'Guesty', parts: buggy } });
    check(/Log in/.test((await gg.next('acctErr')).msg), 'guests can look but not share');
    ga.send({ t: 'galPublish', bp: { name: 'x', parts: buggy } });
    check(/name/.test((await ga.next('acctErr')).msg), 'a shared mech needs a name');
    ga.send({ t: 'galPublish', bp: { name: 'Big Laser', parts: buggy.concat([{ t: 'nuke', x: 2, y: 0, z: 0 }]) } });
    check(/can't be shared/.test((await ga.next('acctErr')).msg), 'mechs with unknown parts are refused');
    const heavy = buggy.concat(Array.from({ length: 30 }, (_, i) => ({ t: 'railgun', x: (i % 5) - 2, y: 2 + Math.floor(i / 10), z: Math.floor(i / 5) % 2 ? 2 : -2 })));
    ga.send({ t: 'galPublish', bp: { name: 'Too Much', parts: heavy } });
    check(/budget/.test((await ga.next('acctErr')).msg), 'over-budget mechs are refused');
    ga.send({ t: 'galPublish', bp: { name: 'Buggy Boo', color: 0xff0000, parts: buggy } });
    const pub = await ga.next('galPublished');
    check(pub.item.n === 'Buggy Boo' && pub.item.by === 'GalA' && pub.item.tags.join() === 'land' && pub.item.cost > 0, `a mech is shared (${pub.item.cost} Bolts, ${pub.item.tags})`);
    ga.send({ t: 'galPublish', bp: { name: 'Buggy Again', parts: buggy } });
    check(/already|Wait/.test((await ga.next('acctErr')).msg), 'sharing again right away (or the same mech twice) is refused');
    gb.send({ t: 'galPublish', bp: { name: 'Fly Boat', color: 0x00ff00, parts: boat } });
    const pub2 = await gb.next('galPublished');
    check(pub2.item.tags.sort().join() === 'air,water', 'movement tags come from the parts (water + air)');
    // browse
    gg.send({ t: 'galList', sort: 'new' });
    const l1 = await gg.next('galItems');
    check(l1.items.length === 2 && l1.items[0].n === 'Fly Boat' && !('likes' in l1.items[0] && Array.isArray(l1.items[0].likes)), 'anyone can browse (newest first, no lists of who liked)');
    gg.send({ t: 'galList', sort: 'top', tag: 'land' });
    check((await gg.next('galItems')).items.map((x) => x.n).join() === 'Buggy Boo', 'the land filter');
    gg.send({ t: 'galList', sort: 'trending', tag: 'hybrid' });
    check((await gg.next('galItems')).items.map((x) => x.n).join() === 'Fly Boat', 'the mixed filter');
    gg.send({ t: 'galList', sort: 'new', q: 'gala' });
    check((await gg.next('galItems')).items.map((x) => x.n).join() === 'Buggy Boo', 'search by maker');
    // likes
    ga.send({ t: 'galLike', id: pub.item.id, on: true });
    check(/own/.test((await ga.next('acctErr')).msg), "you can't like your own mech");
    gb.send({ t: 'galLike', id: pub.item.id, on: true });
    gc.send({ t: 'galLike', id: pub.item.id, on: true });
    gc.send({ t: 'galLike', id: pub.item.id, on: true });
    await gb.next('galLiked');
    await gc.next('galLiked');
    const lk = await gc.next('galLiked');
    check(lk.likes === 2 && lk.liked, 'likes count once per player');
    gc.send({ t: 'galLike', id: pub.item.id, on: false });
    check((await gc.next('galLiked')).likes === 1, 'unlike');
    gb.send({ t: 'galList', sort: 'liked' });
    check((await gb.next('galItems')).items.map((x) => x.n).join() === 'Buggy Boo', 'the ❤ Liked list');
    gb.send({ t: 'galList', sort: 'top' });
    const top = await gb.next('galItems');
    check(top.items[0].n === 'Buggy Boo' && top.items[0].likes === 1 && top.items[0].liked, 'top = most liked first');
    // copies
    gb.send({ t: 'galCopy', id: pub.item.id }); gb.send({ t: 'galCopy', id: pub.item.id }); gg.send({ t: 'galCopy', id: pub.item.id });
    await gb.next('galCopied');
    const cp = await gb.next('galCopied');
    check(cp.copies === 1 && (await gg.next('galCopied')).copies === 1, 'copies count once per account (guests can copy too)');
    // reports: three players hide it
    for (const p of [gb, gc, gd]) { p.send({ t: 'galReport', id: pub.item.id, why: 'name' }); await p.next('note'); }
    gg.send({ t: 'galList', sort: 'new' });
    check((await gg.next('galItems')).items.every((x) => x.id !== pub.item.id), 'a mech reported by 3 players is hidden');
    ga.send({ t: 'galList', sort: 'mine' });
    const mine = await ga.next('galItems');
    check(mine.items.length === 1 && mine.items[0].hidden, 'its maker still sees it (marked hidden)');
    gg.send({ t: 'galGet', id: pub.item.id });
    check(!!(await gg.next('galGone')), 'hidden mechs cannot be opened by others');
    // delete: only the maker
    gc.send({ t: 'galDelete', id: pub2.item.id });
    gb.send({ t: 'galDelete', id: pub2.item.id });
    check((await gb.next('galDeleted')).id === pub2.item.id, 'the maker removes their mech (others cannot)');
    // ---- moderation (server/admin.js) and the safety rules ----
    const adm = (p, tok = 'a'.repeat(64)) => new Promise((res) => {
      const req = require('http').request({ host: '127.0.0.1', port: PORT, path: p, headers: tok ? { 'X-Admin-Token': tok } : {} }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* html */ } res({ status: r.statusCode, j, b }); }); });
      req.on('error', () => res({ status: 0 }));
      req.end();
    });
    const page = await adm('/admin', null);
    check(page.status === 200 && /Cogwild moderation/.test(page.b) && /script src="\/js\/admin.js"/.test(page.b), 'the moderation page is served (no secrets in it)');
    check((await adm('/admin/api/overview', null)).status === 401 && (await adm('/admin/api/overview', 'b'.repeat(64))).status === 401, 'its data needs the moderator key');
    const ov = await adm('/admin/api/overview');
    check(ov.status === 200 && ov.j.hidden.some((x) => x.n === 'Buggy Boo' && x.hidden) && ov.j.reports.some((r) => r.where === 'gallery' && r.gid === pub.item.id), 'the overview lists the reported mech and its reports');
    // GalA and GalB become friends, so they can message each other
    ga.send({ t: 'friendAdd', name: 'GalB' }); await gb.next('note', (m) => m.kind === 'friendReq');
    gb.send({ t: 'friendAccept', name: 'GalA' }); await ga.next('friends', (m) => m.list.length === 1);
    const mu = await adm('/admin/api/act?do=mute&name=GalA&hours=24');
    check(mu.j.ok && mu.j.player.muteUntil > Date.now(), 'mute GalA for a day');
    ga.send({ t: 'dmSend', to: 'GalB', x: 'hello there' });
    check(/moderator/.test((await ga.next('acctErr')).msg), 'a muted player cannot type messages');
    ga.send({ t: 'dmSend', to: 'GalB', q: 1 });
    check(!!(await gb.next('dm')), '...but quick messages still work');
    await adm('/admin/api/act?do=unmute&name=GalA');
    await wait(600); // the chat's speed limit
    ga.send({ t: 'dmSend', to: 'GalB', x: 'hi again' });
    check((await gb.next('dm')).msg.x === 'hi again', 'unmuted: typing works again');
    await adm('/admin/api/act?do=quick&name=GalA');
    ga.send({ t: 'chatMode', mode: 'free' });
    check(/moderator/.test((await ga.next('acctErr')).msg), "a moderator's Quick chat only can't be switched off by the player");
    await adm('/admin/api/act?do=free&name=GalA');
    // ban: signed out now, can't log in, unban lets them back
    const bn = await adm('/admin/api/act?do=ban&name=GalD&hours=168');
    check(bn.j.ok && /suspended/.test((await gd.next('acctOut')).reason), 'a ban signs the player out right away');
    const gd2 = await player();
    gd2.send({ t: 'acctLogin', name: 'GalD', pass: 'galpass1' });
    check(/suspended until/.test((await gd2.next('acctOut')).reason), 'a banned player cannot log in');
    await adm('/admin/api/act?do=unban&name=GalD');
    gd2.send({ t: 'acctLogin', name: 'GalD', pass: 'galpass1' });
    check((await gd2.next('acctOk')).me.name === 'GalD', 'unbanned: logging in works again');
    // the safety net: 3 different players report someone's chat within a day
    for (const p of [gb, gc, gd2]) { p.send({ t: 'report', name: 'GalA', why: 'rude', where: 'chat' }); await p.next('note'); }
    await wait(600);
    ga.send({ t: 'dmSend', to: 'GalB', x: 'bad words here' });
    check(/moderator/.test((await ga.next('acctErr')).msg), '3 chat reports in a day turn their typed chat off for 24 hours by itself');
    const pl = await adm('/admin/api/player?name=gala');
    check(pl.j.autoMuted && pl.j.against.length >= 3 && pl.j.mechs.length === 1, 'the player page shows the auto-mute, the reports and their mechs');
    const rid = (await adm('/admin/api/overview')).j.reports.find((r) => r.who === 'GalA').i;
    await adm('/admin/api/act?do=dismiss&i=' + rid);
    check(!(await adm('/admin/api/overview')).j.reports.some((r) => r.i === rid), 'dismiss takes a report off the list');
    check((await adm('/admin/api/act?do=show&id=' + pub.item.id)).j.ok, 'show a hidden mech again');
    gg.send({ t: 'galList', sort: 'new' });
    check((await gg.next('galItems')).items.some((x) => x.id === pub.item.id), '...and everyone sees it');
    check((await adm('/admin/api/act?do=delmech&id=' + pub.item.id)).j.ok && !(await adm('/admin/api/overview')).j.hidden.some((x) => x.id === pub.item.id), 'delete a mech');
    // wrong keys lock the page for a while
    for (let i = 0; i < 4; i++) await adm('/admin/api/overview', 'c'.repeat(64));
    check((await adm('/admin/api/overview')).status === 429, '5 wrong keys lock it for 15 minutes (even the right key)');
    for (const p of [ga, gb, gc, gd, gd2, gg]) p.ws.close();
  }

  console.log('weekly event + ranked');
  const E = require('../js/economy.js');
  const wk = await player();
  wk.send({ t: 'quick', kind: 'weekly', mode: 'clash', arena: 'canyon' });
  const wr = (await wk.next('room')).room;
  check(wr.settings.event === E.week().id && wr.settings.mode === E.week().mode, `the weekly event queue plays ${E.week().name}`);
  wk.send({ t: 'quick', kind: 'ranked' });
  check(/Ranked unlocks/.test((await wk.next('err')).msg), 'Ranked needs 100 best trophies');
  wk.ws.close();
  const rk = await player();
  rk.send({ t: 'acctLogin', name: 'Alice_1', pass: 'newpass456' });
  await rk.next('acctOk');
  rk.send({ t: 'quick', kind: 'ranked' });
  const rr = (await rk.next('room')).room;
  check(rr.settings.ranked === true && E.RANKED.modes.includes(rr.settings.mode), `Ranked plays a 3v3 mode (${rr.settings.mode})`);
  await rk.next('autostart', null, 6000);
  rk.send({ t: 'begin', payload: { kind: 'match', arena: 'canyon', roster: [] } });
  await wait(100);
  rk.send({ t: 'end', res: { [rk.id]: 1 }, n: 2 });
  const rres = await rk.next('ranked');
  check(rres.d === E.RANKED.win && rres.rp === E.RANKED.win, 'a Ranked win gives ranked points');
  check(!(await rk.next('trophies', null, 600).catch(() => null)), 'Ranked does not move trophies');
  rk.send({ t: 'top', kind: 'ranked' });
  const rtop = await rk.next('top', (m) => m.kind === 'ranked');
  check(rtop.list[0].name === 'Alice_1' && rtop.list[0].rp === E.RANKED.win, 'the Ranked leaderboard shows the season');
  rk.ws.close();

  console.log('weekend cup');
  {
    const cuNow = E.cup(Date.parse('2026-10-31T12:00:00Z'));
    const cg = await player();
    cg.send({ t: 'quick', kind: 'cup' });
    check(/Log in/.test((await cg.next('err')).msg), 'the Weekend Cup needs an account');
    cg.ws.close();
    const cp = await player();
    cp.send({ t: 'acctLogin', name: 'Alice_1', pass: 'newpass456' });
    await cp.next('acctOk');
    const tro0 = (await (cp.send({ t: 'top' }), cp.next('top'))).me.card.tro;
    cp.send({ t: 'quick', kind: 'cup', mode: 'race', arena: 'moon' });
    const cr = (await cp.next('room')).room;
    check(cr.settings.cup === 'cup2026-10-30' && cr.settings.mode === cuNow.mode && cr.settings.arena === 'random', `a cup match plays this weekend's mode on any arena (${cr.settings.mode})`);
    const playCup = async (place) => {
      await cp.next('autostart', null, 8000);
      cp.send({ t: 'begin', payload: { kind: 'match', arena: 'canyon', roster: [] } });
      await wait(100);
      cp.send({ t: 'end', res: { [cp.id]: place }, n: 8 });
      return cp.next('cupResult');
    };
    const c1 = await playCup(1);
    check(c1.pts === 12 && c1.score === 12 && c1.rank === 1 && c1.games === 1, '1st of 8: 12 cup points, #1');
    const c2 = await playCup(8);
    check(c2.pts === 2 && c2.score === 14 && c2.games === 2, 'last of 8: 2 points (score 14 from the best matches)');
    const tro1 = (await (cp.send({ t: 'top' }), cp.next('top'))).me.card.tro;
    check(tro1 === tro0, 'cup matches do not move trophies');
    cp.send({ t: 'cupInfo' });
    const ci = await cp.next('cupInfo');
    check(ci.cup.live && ci.me && ci.me.rank === 1 && ci.me.score === 14 && ci.top[0].name === 'Alice_1' && !ci.claims.length, 'the cup board shows you (#1, 14 points); nothing to claim while it runs');
    cp.send({ t: 'cupClaim', id: 'cup2026-10-30' });
    check(!(await cp.next('cupInfo')).claims.length && !(await cp.next('wallet', (m) => m.cupClaim, 500).catch(() => null)), 'no reward before the weekend is over');
    cp.send({ t: 'leave' });
    cp.ws.close();
    // Monday: the cup is over
    await wait(2000);
    await stop();
    await start({ CUP_DATE: '2026-11-02T08:00:00Z' });
    const cm = await player();
    cm.send({ t: 'acctLogin', name: 'Alice_1', pass: 'newpass456' });
    const coins0 = (await cm.next('acctOk')).wallet.coins;
    cm.send({ t: 'quick', kind: 'cup' });
    check(/Friday/.test((await cm.next('err')).msg), 'no cup matches on Monday');
    cm.send({ t: 'cupInfo' });
    const cl = await cm.next('cupInfo');
    check(!cl.cup.live && cl.claims.length === 1 && cl.claims[0].rank === 1 && cl.claims[0].reward.coins === E.CUP.tryReward, `after the weekend the reward waits (2 matches: ${cl.claims[0] && cl.claims[0].reward.coins} coins; ${E.CUP.minGames}+ for the full reward)`);
    cm.send({ t: 'cupClaim', id: 'cup2026-10-30' });
    const cw = await cm.next('wallet', (m) => m.cupClaim);
    check(cw.w.coins === coins0 + E.CUP.tryReward && cw.rank === 1, 'claiming pays it');
    cm.send({ t: 'cupClaim', id: 'cup2026-10-30' });
    check(!(await cm.next('cupInfo')).claims.length && !(await cm.next('wallet', (m) => m.cupClaim, 500).catch(() => null)), 'only once');
    cm.ws.close();
    await stop();
    await start();
  }

  console.log('security');
  const bad = await get('/%E0%A4%A');
  check(bad.status === 400, `a broken URL gets 400, not a crash (${bad.status})`);
  check((await get('/health')).status === 200, 'server still up after the broken URL');
  const home = await get('/');
  check(/script-src 'self'/.test(home.headers['content-security-policy'] || '') && home.headers['x-frame-options'] === 'SAMEORIGIN', 'pages carry security headers');
  check((await get('/', 'POST')).status === 405, 'POST is refused');
  check((await get('/js/../server/accounts.js')).status === 404 && (await get('/data/db.json')).status === 404 && (await get('/%2e%2e/server/server.js')).status === 404, 'server code and the database are not served');
  const proto = await player();
  proto.send({ t: 'acctRegister', name: '__proto__', pass: 'proto1234' });
  check((await proto.next('acctOk')).me.name === '__proto__', 'a player called __proto__ is just a name');
  proto.send({ t: 'friendAdd', name: 'constructor' });
  check(!!(await proto.next('acctErr')), 'adding a friend called constructor finds nobody');
  check((await get('/health')).status === 200, 'server still up');
  // wrong passwords: the account locks for a while, even across new connections
  for (let i = 0; i < 3; i++) {
    const t = await player();
    for (let j = 0; j < 4; j++) { t.send({ t: 'acctLogin', name: 'Newbie', pass: 'nope' + j }); await t.next('acctErr'); }
    t.ws.close();
  }
  const lk = await player();
  lk.send({ t: 'acctLogin', name: 'Newbie', pass: 'newbie123' });
  check(/Too many wrong/.test((await lk.next('acctErr')).msg), 'many wrong passwords lock the account for a while');
  // mech parts from a player are cleaned before anyone else sees them
  const mk = await player();
  mk.send({ t: 'create', pub: false, settings: {} });
  await mk.next('room');
  mk.send({ t: 'ready', ready: true, bp: { name: '<b>x</b>', color: 123, parts: [{ t: 'core', x: 1e9, y: 0, z: 0 }, { t: '__proto__' }, { t: 'constructor', x: 'a' }, null, { t: 'wheel<script>' }] } });
  check(/allowed/.test((await mk.next('err')).msg) && (await mk.next('room')).room.players[0].bp === null, 'a junk mech (bad parts, positions off the grid) is refused');
  console.log('fair play');
  // two players matched together; the server picks one of them at random to host
  const pair = async (mode, arena) => {
    const a = await player(), b = await player();
    a.send({ t: 'quick', mode, arena });
    await a.next('room');
    b.send({ t: 'quick', mode, arena });
    await b.next('room', (m) => m.room.players.length === 2);
    // whoever the server tells to start is the host (look without moving either player's cursor)
    for (let i = 0; i < 80 && !a.last('autostart') && !b.last('autostart'); i++) await wait(100);
    const go = a.last('autostart') ? a : b;
    go.cursor = go.got.length;
    return { host: go, other: go === a ? b : a };
  };
  // Rush build phase: the host quits, everyone gets a fresh search
  let pr = await pair('rush', 'swamp');
  pr.host.send({ t: 'begin', payload: { kind: 'build', arena: 'swamp' } });
  await pr.other.next('begin');
  pr.host.ws.close();
  await pr.other.next('hostLeft');
  check(!!(await pr.other.next('autostart', null, 6000).catch(() => null)), 'host quits while building: the rest get a new match');
  pr.other.ws.close();
  // mid-match: the other player becomes the host and the match goes on
  pr = await pair('koth', 'swamp');
  pr.host.send({ t: 'begin', payload: { kind: 'match', arena: 'swamp', roster: [] } });
  await pr.other.next('begin');
  pr.host.ws.close();
  const nh = await pr.other.next('host');
  check(nh.id === pr.other.id && nh.old === pr.host.id, 'host quits mid-match: another player takes over');
  pr.other.send({ t: 'end', res: { [pr.other.id]: 1 }, n: 2 });
  check(!!(await pr.other.next('room', (m) => m.room.state === 'lobby').catch(() => null)), 'the new host can finish the match');
  pr.other.ws.close();
  // a host that goes silent (lost internet) is dropped after a few seconds
  pr = await pair('koth', 'canyon');
  pr.host.send({ t: 'begin', payload: { kind: 'match', arena: 'canyon', roster: [] } });
  await pr.other.next('begin');
  pr.host.ws.onmessage = null; // keeps the socket open but says nothing
  check(!!(await pr.other.next('host', null, 12000).catch(() => null)), 'a silent host is replaced');
  pr.other.ws.close();
  // results that don't fit what the other game reported are refused
  const rigged = async (res) => {
    const q = await pair('clash', 'city');
    const bp = { parts: [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'wheel', x: 1, y: 0, z: 0 }] };
    const roster = [{ i: 1, o: q.host.id, h: 1, bp }, { i: 2, o: q.other.id, h: 1, bp }];
    q.host.send({ t: 'begin', payload: { kind: 'match', arena: 'city', roster } });
    await q.other.next('begin');
    q.other.send({ t: 'st', s: [], e: [{ k: 'elim', c: 2, by: 1 }] }); // the other player's game: "I'm out"
    await wait(150);
    q.host.send({ t: 'end', res: res(q.host.id, q.other.id), n: 8 });
    const r = await q.other.next('note', (m) => /didn't add up/.test(m.msg), 1500).catch(() => null);
    q.host.ws.close(); q.other.ws.close();
    return !r;
  };
  // watching a friend's match
  {
    const pl = await player(), wt = await player();
    pl.send({ t: 'acctLogin', name: 'FromGuest', pass: 'guest1234' });
    await pl.next('acctOk');
    wt.send({ t: 'acctLogin', name: 'Spender', pass: 'spend1234' });
    await wt.next('acctOk');
    wt.send({ t: 'spectate', name: 'FromGuest' });
    check(/watch friends/.test((await wt.next('err')).msg), 'you can only watch friends');
    pl.send({ t: 'friendAdd', name: 'Spender' });
    await wt.next('note', (m) => m.kind === 'friendReq');
    wt.send({ t: 'friendAccept', name: 'FromGuest' });
    await pl.next('friends', (m) => m.list.some((f) => f.name === 'Spender'));
    wt.send({ t: 'spectate', name: 'FromGuest' });
    check(/isn't in a match/.test((await wt.next('err')).msg), "you can't watch a friend who isn't playing");
    pl.send({ t: 'quick', mode: 'koth', arena: 'swamp' });
    await pl.next('autostart', null, 8000);
    const bp = { parts: [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'wheel', x: 1, y: 0, z: 0 }] };
    pl.send({ t: 'begin', payload: { kind: 'match', arena: 'swamp', roster: [{ i: 1, o: pl.id, h: 1, bp }, { i: 2, o: pl.id, h: 0, bp }] } });
    await wait(200);
    pl.send({ t: 'st', s: [{ i: 1, l: 0, m: [0, 2, 0] }], e: [{ k: 'wreck', c: 2, by: 1, l: 0 }] });
    await wait(200);
    wt.send({ t: 'spectate', name: 'FromGuest' });
    const sb = await wt.next('specBegin');
    check(sb.payload.roster.length === 2 && sb.log.some((x) => x.e.k === 'wreck') && sb.target === pl.id, 'a watcher gets the match start and what happened so far');
    check(/is watching you/.test((await pl.next('note', (m) => /watching/.test(m.msg))).msg), 'the player is told who is watching');
    pl.send({ t: 'st', s: [{ i: 1, l: 0, m: [5, 2, 0] }] });
    check(!!(await wt.next('st', null, 2000).catch(() => null)), 'the watcher sees the match live');
    pl.send({ t: 'end', res: { [pl.id]: 1 }, n: 2 });
    check(/over/.test((await wt.next('specEnd')).why), 'when the match ends, the watcher is sent home');
    pl.ws.close(); wt.ws.close();
  }
  // the referee: spoofed hits, impossible damage, impossible speed
  {
    const q = await pair('koth', 'jungle');
    const bp = { parts: [{ t: 'core', x: 0, y: 0, z: 0 }, { t: 'cannon', x: 0, y: 1, z: 0 }, { t: 'wheel', x: 1, y: 0, z: 0 }] };
    q.host.send({ t: 'begin', payload: { kind: 'match', arena: 'jungle', roster: [{ i: 1, o: q.host.id, h: 1, bp }, { i: 2, o: q.other.id, h: 1, bp }, { i: 3, o: q.host.id, h: 0, bp }] } });
    await q.other.next('begin');
    q.host.cursor = q.host.got.length;
    q.other.send({ t: 'st', s: [], e: [{ k: 'hit', c: 3, pt: 0, d: 50, by: 1, l: 0 }] }); // "your" mech hitting? it isn't yours
    const spoof = await q.host.next('st', null, 700).catch(() => null);
    check(!spoof || !(spoof.e || []).length, 'hits sent for a mech you don\'t control are dropped');
    q.other.send({ t: 'st', s: [], e: [...Array(10)].map(() => ({ k: 'hit', c: 1, pt: 0, d: 500, by: 2, l: 0 })) });
    const flood = await q.host.next('st', (m) => (m.e || []).length > 0, 2000);
    check(flood.e.length <= 3, `more damage than a mech can deal is dropped (${flood.e.length} of 10 hits got through)`);
    for (let i = 0; i < 14; i++) { q.other.send({ t: 'st', s: [{ i: 2, l: 0, m: [i * 400, 5, 0] }] }); await wait(60); }
    q.host.send({ t: 'end', res: { [q.host.id]: 1, [q.other.id]: 2 }, n: 2 });
    check(!!(await q.other.next('note', (m) => /odd/.test(m.msg), 2000).catch(() => null)), 'a speed hacker\'s match doesn\'t count for them');
    q.host.ws.close(); q.other.ws.close();
  }
  check(await rigged((h, o) => ({ [h]: 1, [o]: 2 })), 'a result that fits is accepted');
  check(!(await rigged((h, o) => ({ [h]: 2, [o]: 1 }))), 'a player who was knocked out first cannot be put ahead');
  check(!(await rigged((h, o) => ({ [h]: 1, [o]: 1 }))), 'two players in 1st place in free-for-all is refused');
  // connections from one address are capped
  const many = [];
  for (let i = 0; i < 30; i++) many.push(player().then((p) => p, () => null));
  const opened = (await Promise.race([Promise.all(many), wait(4000).then(() => [])])).filter(Boolean);
  check(opened.length > 0 && opened.length < 30, `too many connections from one address are refused (${opened.length} of 30 got in)`);
  for (const p of opened) p.ws.close();

  await stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('test crashed:', e.message); try { await stop(); } catch (e2) { /* ignore */ } process.exit(1); });
