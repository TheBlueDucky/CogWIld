// live check: one-step sign up, log in with email, then delete the test account
const VER = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'net.js'), 'utf8').match(/cogwild-net-\d+/)[0]; // the game's online version
const URL = 'wss://cogwild.duckdns.org/ws';
const tag = Math.random().toString(36).slice(2, 7), email = `livecheck.${tag}@example.com`, name = 'chk_' + tag, pass = 'chk-' + tag + '-pw';
function conn() {
  return new Promise((res) => {
    const ws = new WebSocket(URL);
    const p = { got: [], send: (m) => ws.send(JSON.stringify(m)), ws };
    p.next = (t, ms = 6000) => new Promise((ok, no) => { const iv = setInterval(() => { const i = p.got.findIndex((x) => x.t === t || x.t === 'acctErr'); if (i >= 0) { clearInterval(iv); ok(p.got.splice(i, 1)[0]); } }, 20); setTimeout(() => { clearInterval(iv); no(new Error('no ' + t)); }, ms); });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); p.got.push(m); if (m.t === 'welcome') { p.send({ t: 'hello', name: 'x', ver: VER }); res(p); } };
  });
}
(async () => {
  const a = await conn();
  a.send({ t: 'acctSignup', email, pass, name });
  const r = await a.next('acctOk');
  console.log('sign up:', r.t === 'acctOk' ? `ok (${r.me.name}, ${r.email})` : 'FAILED ' + r.msg);
  a.ws.close();
  const b = await conn();
  b.send({ t: 'acctLogin', name: email, pass });
  const l = await b.next('acctOk');
  console.log('log in with email:', l.t === 'acctOk' ? 'ok' : 'FAILED ' + l.msg);
  b.send({ t: 'acctDelete', pass });
  const d = await b.next('acctOut');
  console.log('test account deleted:', d.t === 'acctOut');
  process.exit(0);
})().catch((e) => { console.log('error', e.message); process.exit(1); });
