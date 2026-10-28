// Node check of the desktop app's Discord status (desktop/discord.js) against a fake Discord on a local pipe:
// it says hello with the app's ID, sets the activity with the logo, what you're doing and the two buttons, answers
// pings, and tries again when Discord isn't there. Nothing visible, no sound.  node tests/discord-test.js
const net = require('net');
const path = require('path');
const os = require('os');
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const base = process.platform === 'win32' ? `\\\\?\\pipe\\cogwild-test-discord-${process.pid}-` : path.join(os.tmpdir(), `cogwild-test-discord-${process.pid}-`);
process.env.COGWILD_DISCORD_PIPE = base;
process.env.COGWILD_DISCORD_ID = '123456789012345678';
const frame = (op, obj) => { const b = Buffer.from(JSON.stringify(obj)); const h = Buffer.alloc(8); h.writeUInt32LE(op, 0); h.writeUInt32LE(b.length, 4); return Buffer.concat([h, b]); };
const got = [];
// the fake Discord listens on the 3rd pipe name (the app tries 0, 1, 2…)
const srv = net.createServer((s) => {
  let buf = Buffer.alloc(0);
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8 && buf.length >= 8 + buf.readUInt32LE(4)) {
      const op = buf.readUInt32LE(0), len = buf.readUInt32LE(4), msg = JSON.parse(buf.slice(8, 8 + len).toString());
      buf = buf.slice(8 + len);
      got.push({ op, msg });
      if (op === 0) { s.write(frame(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } })); s.write(frame(3, { ping: 1 })); }
    }
  });
});
srv.listen(base + '2', async () => {
  const discord = require('../desktop/discord');
  discord.set({ details: 'Playing King of the Hill', state: 'Canyon Lake · online', since: 1700000000000 });
  await new Promise((r) => setTimeout(r, 800));
  const hello = got.find((g) => g.op === 0);
  check(hello && hello.msg.client_id === '123456789012345678' && hello.msg.v === 1, 'says hello to Discord with the app ID (found it on the 3rd pipe)');
  const pong = got.find((g) => g.op === 4);
  check(!!pong, 'answers Discord\'s ping');
  const act = got.find((g) => g.op === 1 && g.msg.cmd === 'SET_ACTIVITY');
  const a = act && act.msg.args.activity;
  check(a && a.details === 'Playing King of the Hill' && a.state === 'Canyon Lake · online' && a.timestamps.start === 1700000000000, 'shows what you are doing and since when');
  check(a && /icon-512\.png$/.test(a.assets.large_image) && /Cogwild/.test(a.assets.large_text), 'shows the Cogwild logo');
  check(a && a.buttons.length === 2 && /apps\.microsoft\.com/.test(a.buttons[0].url) && /cogwild\.duckdns\.org\/download/.test(a.buttons[1].url) && a.buttons.every((b) => b.label.length <= 32), 'two buttons: the Microsoft Store and the website (labels short enough for Discord)');
  check(act && act.msg.args.pid === process.pid, 'tied to the app\'s own process');
  discord.set({ details: 'Building a mech in the Workshop', state: '', since: 0 });
  await new Promise((r) => setTimeout(r, 300));
  const last = got.filter((g) => g.op === 1).pop().msg.args.activity;
  check(last.details === 'Building a mech in the Workshop' && !last.state, 'updates when you do something else');
  discord.stop();
  srv.close();
  console.log(failed ? `${failed} FAILED` : 'all passed');
  process.exit(failed ? 1 : 0);
});
