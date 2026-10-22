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
const VER = 'cogwild-net-4';
let server;
let failed = 0;

function start() {
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: DATA, SEARCH_SECS: '2', TROPHY_MIN_SECS: '0' }), stdio: process.env.TEST_LOG ? 'inherit' : 'ignore' });
  return wait(700);
}
function stop() { return new Promise((res) => { server.once('exit', res); server.kill('SIGTERM'); }); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
    ws.onmessage = (e) => { const m = JSON.parse(e.data); p.got.push(m); if (m.t === 'welcome') { p.id = m.id; p.send({ t: 'hello', name: 'Guest', ver: VER }); resolve(p); } };
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
  check(relog.save && relog.save.data.profile.coins === 99 && relog.me.lv === 4, 'save comes back on the next login');
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

  await stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('test crashed:', e.message); try { await stop(); } catch (e2) { /* ignore */ } process.exit(1); });
