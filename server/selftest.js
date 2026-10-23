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
const VER = 'cogwild-net-8';
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
function googleToken(email, aud = 'test-client') {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), body = enc({ iss: 'https://accounts.google.com', aud, email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 });
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

function start() {
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: DATA, SEARCH_SECS: '2', TROPHY_MIN_SECS: '0',
    MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(SMTP_PORT), MAIL_SMTP_SECURE: 'none', MAIL_SMTP_USER: 'game@test.dev', MAIL_SMTP_PASS: 'mailpass123', MAIL_FROM: 'Cogwild <game@test.dev>',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CERTS_URL: `http://127.0.0.1:${CERTS_PORT}/certs` }), stdio: process.env.TEST_LOG ? 'inherit' : 'ignore' });
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
  ec.send({ t: 'earn', src: 'match', n: 500, pp: 40 });
  check((await ec.next('wallet')).earned === 0, 'two match rewards in a row are refused');
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
  gu2.send({ t: 'ready', ready: true, bp: { name: 'Fat', color: 1, parts: [{ t: 'core', x: 0, y: 0, z: 0 }].concat([...Array(9)].map((_, i) => ({ t: 'armor', x: i - 4, y: 1, z: 0 }))).concat([...Array(9)].map((_, i) => ({ t: 'rotor', x: i - 4, y: 2, z: 0 }))) } });
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
  cB.send({ t: 'clubChat', i: 2 });
  check((await cA.next('clubChat')).i === 2, 'club quick chat reaches members');
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

  console.log('weekly event + ranked');
  const E = require('../js/economy.js');
  const wk = await player();
  wk.send({ t: 'quick', kind: 'weekly', mode: 'clash', arena: 'canyon' });
  const wr = (await wk.next('room')).room;
  check(wr.settings.event === E.week().id && wr.settings.mode === E.week().mode, `the weekly event queue plays ${E.week().name}`);
  wk.send({ t: 'quick', kind: 'ranked' });
  check(/Ranked unlocks/.test((await wk.next('err')).msg), 'Ranked needs 600 best trophies');
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
