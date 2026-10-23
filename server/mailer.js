// Cogwild — sending login codes by email. A tiny SMTP client with no dependencies.
// Settings come from the environment (on the server: /etc/cogwild.env, see deploy/set-mail.ps1):
//   MAIL_SMTP_HOST, MAIL_SMTP_PORT (465 = TLS from the start, 587 = STARTTLS), MAIL_SMTP_USER, MAIL_SMTP_PASS, MAIL_FROM
//   MAIL_SMTP_SECURE=none   plain connection, only for the self-test's fake mail server
//   MAIL_DEV=1              don't send: print codes to the log (local testing only)
'use strict';
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

const cfg = {
  host: process.env.MAIL_SMTP_HOST || '',
  port: parseInt(process.env.MAIL_SMTP_PORT || '465', 10),
  user: process.env.MAIL_SMTP_USER || '',
  pass: process.env.MAIL_SMTP_PASS || '',
  from: process.env.MAIL_FROM || process.env.MAIL_SMTP_USER || '',
  secure: process.env.MAIL_SMTP_SECURE || '',
  dev: process.env.MAIL_DEV === '1',
};
const ready = cfg.dev || !!(cfg.host && cfg.from);

// reads SMTP replies ("250-..." lines until "250 ...") from a socket
function replies(sock) {
  let buf = '';
  const waiting = [];
  const lines = [];
  const pump = () => {
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const code = +line.slice(0, 3), text = lines.splice(0).join('\n');
        const w = waiting.shift();
        if (w) w({ code, text });
      }
    }
  };
  const onData = (d) => { buf += d.toString('utf8'); pump(); };
  sock.on('data', onData);
  return { next: () => new Promise((res) => { waiting.push(res); pump(); }), stop: () => sock.removeListener('data', onData) };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const addr = (s) => { const m = /<([^>]+)>/.exec(s); return (m ? m[1] : s).trim(); };
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');

function message(to, subject, text) {
  const id = `${crypto.randomBytes(12).toString('hex')}@${addr(cfg.from).split('@')[1] || os.hostname()}`;
  return [
    `From: ${cfg.from}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${id}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
  ].join('\r\n');
}

async function send(to, subject, text) {
  if (cfg.dev) { console.log(`mail (dev, not sent) to ${to}: ${subject}\n${text}`); return; }
  if (!ready) throw new Error('mail is not set up');
  const plain = cfg.secure === 'none' || cfg.port !== 465;
  let sock = plain ? net.connect(cfg.port, cfg.host) : tls.connect({ port: cfg.port, host: cfg.host, servername: cfg.host });
  sock.setTimeout(20000, () => sock.destroy(new Error('mail server timed out')));
  const failed = new Promise((_, rej) => sock.once('error', rej));
  const run = async () => {
    let r = replies(sock);
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + '\r\n');
      const res = await r.next();
      if (!ok.includes(res.code)) throw new Error(`mail server said ${res.text.slice(0, 200)}`);
      return res;
    };
    await cmd(null, [220]);
    const hello = await cmd(`EHLO ${os.hostname()}`, [250]);
    if (plain && cfg.secure !== 'none') {
      if (!/STARTTLS/i.test(hello.text)) throw new Error('mail server has no STARTTLS');
      await cmd('STARTTLS', [220]);
      r.stop();
      sock = tls.connect({ socket: sock, servername: cfg.host });
      sock.on('error', () => {});
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
      r = replies(sock);
      await cmd(`EHLO ${os.hostname()}`, [250]);
    }
    if (cfg.user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(cfg.user), [334]);
      await cmd(b64(cfg.pass), [235]);
    }
    await cmd(`MAIL FROM:<${addr(cfg.from)}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    await cmd(message(to, subject, text) + '\r\n.', [250]);
    sock.write('QUIT\r\n');
    sock.end();
  };
  await Promise.race([run(), failed]);
}

module.exports = { send, ready, dev: cfg.dev };
