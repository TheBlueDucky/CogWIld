// Discord "Playing Cogwild" status (Rich Presence) for the desktop app: the logo, what you're doing in the game, and
// buttons other people see on your profile (get the game in the Microsoft Store, or play/download from the website).
// It talks to the Discord app on the same computer through its local pipe (no library, nothing sent anywhere else);
// without Discord running it quietly tries again now and then.
// APP_ID: the Application ID of the "Cogwild" application at https://discord.com/developers/applications (its name is
// what Discord shows after "Playing", its App Icon is the logo). Empty = off.
'use strict';
const net = require('net');
const path = require('path');

const APP_ID = process.env.COGWILD_DISCORD_ID || '1565017370466975785'; // tests use a fake Discord (tests/discord-test.js)
const LOGO = 'https://cogwild.duckdns.org/img/icon-512.png';
const BUTTONS = [
  { label: 'Get it on Microsoft Store', url: 'https://apps.microsoft.com/detail/9P58PTK2Z93L' },
  { label: 'Play free or download', url: 'https://cogwild.duckdns.org/download' },
];

function pipePath(i) {
  if (process.env.COGWILD_DISCORD_PIPE) return process.env.COGWILD_DISCORD_PIPE + i;
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(dir.replace(/\/$/, ''), `discord-ipc-${i}`);
}

class Presence {
  constructor() {
    this.sock = null;
    this.ready = false;
    this.want = null; // the activity to show (kept while Discord is closed)
    this.start = Date.now();
    this.retry = null;
    this.connecting = false;
    this.buf = Buffer.alloc(0);
  }
  get on() { return !!APP_ID; }
  connect(i = 0) {
    if (!this.on || this.sock || (this.connecting && i === 0)) return;
    this.connecting = true;
    if (i > 9) { this.connecting = false; this.later(); return; }
    const s = net.createConnection(pipePath(i));
    // Discord can use any of discord-ipc-0…9: try the next one (errors after connecting end in 'close' below)
    s.on('error', () => { if (this.sock !== s) { s.destroy(); this.connect(i + 1); } });
    s.once('connect', () => {
      this.sock = s;
      this.connecting = false;
      this.buf = Buffer.alloc(0);
      this.send(0, { v: 1, client_id: APP_ID });
    });
    s.on('data', (d) => this.read(d));
    s.on('close', () => { if (this.sock === s) { this.sock = null; this.ready = false; this.later(); } });
  }
  later() { clearTimeout(this.retry); this.retry = setTimeout(() => this.connect(), 20000); this.retry.unref && this.retry.unref(); }
  send(op, obj) {
    if (!this.sock) return;
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(8);
    head.writeUInt32LE(op, 0);
    head.writeUInt32LE(body.length, 4);
    this.sock.write(Buffer.concat([head, body]));
  }
  read(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0), len = this.buf.readUInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString('utf8')); } catch (e) { /* ignore */ }
      this.buf = this.buf.slice(8 + len);
      if (op === 3) this.send(4, msg); // ping → pong
      if (op === 1 && msg && msg.evt === 'READY') { this.ready = true; this.push(); }
      if (op === 2) { this.sock.destroy(); }
    }
  }
  // from the game (preload.js): { details, state, since } — since = when the current match started (ms), or 0
  set(info) {
    if (!this.on) return;
    const clip = (s, n) => String(s || '').slice(0, n);
    // the player turned it off (Settings › Online): clear the status, nothing about the game shows
    if (info && info.hidden) { this.want = { hidden: true }; if (this.sock) this.push(); return; }
    this.want = {
      details: clip(info && info.details, 120) || 'In the menu',
      state: clip(info && info.state, 120) || undefined,
      timestamps: { start: info && info.since ? Math.floor(info.since) : this.start },
      assets: { large_image: LOGO, large_text: 'Cogwild: build any mech, rule the land, water and sky' },
      buttons: BUTTONS,
      instance: false,
    };
    if (!this.sock) this.connect();
    else this.push();
  }
  push() {
    if (!this.ready || !this.want) return;
    this.send(1, { cmd: 'SET_ACTIVITY', args: this.want.hidden ? { pid: process.pid } : { pid: process.pid, activity: this.want }, nonce: String(Date.now()) + Math.random().toString(36).slice(2) });
  }
  stop() { clearTimeout(this.retry); if (this.sock) { try { this.sock.destroy(); } catch (e) { /* closed */ } } this.sock = null; }
}

module.exports = new Presence();
