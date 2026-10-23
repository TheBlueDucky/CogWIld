// Live smoke test against the real server with two throwaway accounts that are deleted at the end.
const VER = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'net.js'), 'utf8').match(/cogwild-net-\d+/)[0]; // the game's online version
const URL = process.env.URL || 'wss://cogwild.duckdns.org/ws';
const tag = Math.random().toString(36).slice(2, 7);
const A = 'smokeA_' + tag, B = 'smokeB_' + tag, PASS = 'smoke-' + tag + '-pw';
let fails = 0;
const check = (ok, what) => { console.log(ok ? '  ok  ' : ' FAIL ', what); if (!ok) fails++; };
function player() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { got: [], cursor: 0, send: (m) => ws.send(JSON.stringify(m)), ws };
    p.next = (t, fn, ms = 6000) => new Promise((res, rej) => {
      const iv = setInterval(() => { const i = p.got.findIndex((x, j) => j >= p.cursor && x.t === t && (!fn || fn(x))); if (i >= 0) { clearInterval(iv); p.cursor = i + 1; res(p.got[i]); } }, 20);
      setTimeout(() => { clearInterval(iv); rej(new Error('no ' + t)); }, ms);
    });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); p.got.push(m); if (m.t === 'welcome') { p.id = m.id; p.send({ t: 'hello', name: 'x', ver: VER }); resolve(p); } };
    ws.onerror = () => reject(new Error('cannot connect to ' + URL));
  });
}
(async () => {
  const a = await player(), b = await player();
  a.send({ t: 'acctRegister', name: A, pass: PASS });
  b.send({ t: 'acctRegister', name: B, pass: PASS });
  check(!!(await a.next('acctOk')) && !!(await b.next('acctOk')), 'two accounts sign up on the live server');
  a.send({ t: 'save', data: { profile: { xp: 300 } }, lv: 3 });
  check(!!(await a.next('saved')), 'cloud save stored');
  a.send({ t: 'friendAdd', name: B });
  await b.next('note', (m) => m.kind === 'friendReq');
  b.send({ t: 'friendAccept', name: A });
  check((await a.next('friends', (m) => m.list.length === 1)).list[0].on, 'friend request + online status');
  a.send({ t: 'partyInvite', name: B });
  await b.next('note', (m) => m.kind === 'partyInvite');
  b.send({ t: 'partyAccept', from: A });
  await a.next('party', (m) => m.party && m.party.members.length === 2);
  const ra = a.next('room'), rb = b.next('room');
  a.send({ t: 'quick' });
  const [x, y] = await Promise.all([ra, rb]);
  check(x.room.code === y.room.code, `party joins the same live Quick Match (${x.room.code})`);
  a.send({ t: 'top' });
  const top = await a.next('top');
  check(Array.isArray(top.list) && top.total >= 2, `leaderboard answers (${top.total} players)`);
  // relog proves it's on disk-backed state, then clean up
  const a2 = await player();
  a2.send({ t: 'acctLogin', name: A, pass: PASS });
  const back = await a2.next('acctOk');
  check(back.save && back.save.data.profile.xp === 300, 'save comes back on a fresh login');
  a2.send({ t: 'acctDelete', pass: PASS });
  await a2.next('acctOut');
  b.send({ t: 'acctDelete', pass: PASS });
  await b.next('acctOut');
  const c = await player();
  c.send({ t: 'acctLogin', name: A, pass: PASS });
  check(/Wrong/.test((await c.next('acctErr')).msg), 'test accounts deleted again');
  console.log(fails ? `${fails} FAILED` : 'live smoke test passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
