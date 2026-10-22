// Cogwild game server: serves the game files and runs online rooms over WebSockets.
// Zero dependencies (Node.js 18+). Start with:  node server/server.js   (PORT env var, default 8765)
//
// Model: rooms of up to 8 players. One player in each room is the HOST: their game runs the bots,
// match rules, pickups and scores. Every player is in charge of their own mech. The server keeps
// rooms, picks hosts, relays messages between players, and protects itself with size and rate limits.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Accounts } = require('./accounts');

const PORT = parseInt(process.env.PORT || '8765', 10);
const ROOT = path.resolve(__dirname, '..');
const NET_VERSION = 'cogwild-net-4';
const MAX_PLAYERS = 8;
// Matchmaking (PLAY): each arena has its own queue. A search lasts up to SEARCH_SECS; then bots fill every
// empty seat (at least one, so there's always someone to fight) and the match starts. A full room starts at once.
const SEARCH = parseInt(process.env.SEARCH_SECS || process.env.BOT_WAIT_SEC || '30', 10) * 1000;
const FULL_START = 3000; // a room that fills up with players starts after this short pause
// what PLAY plays in each mode, and how many seats that has (co-op modes: you + 2 teammates)
const MM_FORMAT = { clash: 'ffa', rush: 'ffa', koth: 'squads', gold: 'squads', race: 'race', boss: 'squad', survival: 'squad' };
const SEATS = { duel: 2, squads: 6, quads: 8, ffa: 8, race: 6, solo: 1, squad: 3 };
const seatsOf = (room) => (room.auto ? SEATS[room.settings.format] || MAX_PLAYERS : MAX_PLAYERS);
const BOT_NAMES = ['Rustbucket', 'Gearhead', 'Sprocket', 'Clunker', 'Torque', 'Widget', 'Ratchet', 'Piston', 'Cogsworth', 'Bolt'];
const MAX_MSG = 256 * 1024; // bytes per message
const RATE = 90; // messages per second allowed (with a burst allowance)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// ======================= static files =======================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/octet-stream', '.zip': 'application/zip',
};
const PUBLIC = new Set(['index.html', 'privacy.html', 'terms.html', 'credits.html', 'favicon.svg', 'download.html', 'manifest.webmanifest', 'sw.js']); // top-level files that may be served

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/favicon.ico') url = '/favicon.svg';
  if (url === '/download' || url === '/app') url = '/download.html';
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, version: NET_VERSION, rooms: rooms.size, players: clients.size }));
  }
  const rel = url.replace(/^\/+/, '');
  // only the game files: index/privacy/favicon/download at the top, everything under js/, and the app downloads
  const allowed = PUBLIC.has(rel) || rel.startsWith('js/') || rel.startsWith('fonts/') || rel.startsWith('img/') || /^downloads\/[\w.-]+\.(exe|apk|zip)$/.test(rel);
  const file = path.resolve(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep) || rel.includes('..')) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    // browsers re-check every file (cheap 304s), so an update reaches players on their next page load
    const lastMod = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === lastMod) { res.writeHead(304); return res.end(); }
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': lastMod,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (rel.startsWith('downloads/')) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

// ======================= minimal WebSocket (RFC 6455) =======================
function acceptKey(key) { return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); }

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x81; // FIN + text
  return Buffer.concat([header, payload]);
}
function controlFrame(op, data = Buffer.alloc(0)) { return Buffer.concat([Buffer.from([0x80 | op, data.length]), data]); }

class Socket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    sock.on('data', (d) => this.feed(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }
  feed(data) {
    this.buf = Buffer.concat([this.buf, data]);
    if (this.buf.length > MAX_MSG * 2) return this.close(1009);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.close(1009); len = Number(big); off = 10; }
      if (!masked) return this.close(1002); // clients must mask
      if (len > MAX_MSG) return this.close(1009);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.slice(off, off + 4);
      const payload = Buffer.from(this.buf.slice(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.slice(off + 4 + len);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) { this.raw(controlFrame(0xA, payload.slice(0, 125))); continue; }
      if (op === 0xA) { this.lastPong = Date.now(); continue; }
      if (op === 0x1 || op === 0x0) {
        // browsers split big messages into several frames: the whole message must stay under the limit
        this.fragLen = (this.fragLen || 0) + payload.length;
        if (this.fragLen > MAX_MSG) return this.close(1009);
        this.frags.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.fragLen = 0;
          if (this.onmessage) this.onmessage(msg);
        }
      }
    }
  }
  raw(b) { if (this.open) { try { this.sock.write(b); } catch (e) { this.closed(); } } }
  send(obj) { this.raw(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  ping() { this.raw(controlFrame(0x9)); }
  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code, 0);
    this.raw(controlFrame(0x8, b));
    this.sock.end();
    this.closed();
  }
  closed() {
    if (!this.open) return;
    this.open = false;
    try { this.sock.destroy(); } catch (e) { /* ignore */ }
    if (this.onclose) this.onclose();
  }
}

// ======================= rooms =======================
const clients = new Map(); // id -> client
const rooms = new Map(); // code -> room
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const clean = (s, n) => String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

const DEFAULT_SETTINGS = { mode: 'clash', format: 'ffa', arena: 'random', tod: 'random', difficulty: 'normal' };
function cleanSettings(s) {
  s = s || {};
  const pick = (v, ok, d) => (ok.includes(v) ? v : d);
  return {
    mode: pick(s.mode, ['rush', 'clash', 'koth', 'gold', 'race', 'survival', 'boss'], 'clash'),
    format: pick(s.format, ['duel', 'squads', 'quads', 'ffa', 'race', 'solo', 'squad'], 'ffa'),
    arena: clean(s.arena, 16) || 'random',
    tod: pick(s.tod, ['random', 'day', 'sunset', 'night'], 'random'),
    difficulty: pick(s.difficulty, ['easy', 'normal', 'hard'], 'normal'),
    teams: pick(s.teams, ['split', 'together'], 'split'),
  };
}

const secsTo = (t) => (t ? Math.max(0, Math.round((t - Date.now()) / 1000)) : 0);
function roomView(room) {
  return {
    code: room.code, hostId: room.hostId, pub: room.pub, auto: room.auto, state: room.state, settings: room.settings,
    searchIn: room.auto && room.state === 'lobby' ? secsTo(room.searchEnds) : 0, searchFor: SEARCH / 1000, seats: seatsOf(room),
    players: [...room.players].map((id) => {
      const c = clients.get(id);
      const u = accounts.me(c);
      return { id, name: c.name, ready: c.ready, bp: c.bp || null, bpName: c.bp ? clean(c.bp.name, 24) : '', acct: !!u, av: u ? u.av | 0 : -1, tro: u ? u.tro | 0 : 0 };
    }),
    // bots waiting in the lobby: the host's game gives their names to the first bots it makes
    bots: room.bots.map((b) => ({ id: b.id, name: b.name })),
  };
}
// matchmaking: the search ran out (or the room is full): bots take every empty seat and the host starts
function fillAndStart(room) {
  const used = new Set();
  room.bots = [];
  for (let i = room.players.size; i < seatsOf(room); i++) {
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + i;
    used.add(name);
    room.bots.push({ id: -(++room.botSeq), name });
  }
  room.searchEnds = 0;
  room.autoAt = Date.now(); // the timer loop nudges the host until the match begins
  sendRoom(room);
}
function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const id of room.players) if (id !== exceptId) { const c = clients.get(id); if (c) c.ws.send(s); }
}
function sendRoom(room) { broadcast(room, { t: 'room', room: roomView(room) }); }

function leaveRoom(c, reason) {
  const room = c.room && rooms.get(c.room);
  c.room = null;
  c.ready = false;
  if (!room) return;
  room.players.delete(c.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.state === 'playing') broadcast(room, { t: 'left', id: c.id, reason });
  if (room.hostId === c.id) {
    room.hostId = [...room.players][0];
    // the match was running on the old host's game: everyone goes back to the lobby
    if (room.state === 'playing') { room.state = 'lobby'; broadcast(room, { t: 'hostLeft' }); for (const id of room.players) clients.get(id).ready = false; }
  }
  sendRoom(room);
  accounts.roomChanged(c);
}

function joinRoom(c, room) {
  if (c.room) leaveRoom(c);
  if (room.players.size >= seatsOf(room)) return c.ws.send({ t: 'err', msg: 'That room is full' });
  if (room.state !== 'lobby') return c.ws.send({ t: 'err', msg: 'That match already started. Try again in a moment.' });
  room.players.add(c.id);
  c.room = room.code;
  c.ready = false;
  if (room.bots.length) room.bots.pop(); // a real player takes a bot's seat
  if (room.auto && !room.searchEnds && !room.autoAt) room.searchEnds = Date.now() + SEARCH; // a new search starts
  if (room.auto && room.players.size >= seatsOf(room) && room.searchEnds) room.searchEnds = Math.min(room.searchEnds, Date.now() + FULL_START);
  sendRoom(room);
  accounts.roomChanged(c);
  accounts.afterJoin(c, room); // a party leader brings their party along
}

function createRoom(c, pub, settings, auto) {
  const room = { code: newCode(), hostId: c.id, pub: !!pub, auto: !!auto, state: 'lobby', settings: cleanSettings(settings), players: new Set(), bots: [], botSeq: 0, searchEnds: 0, autoAt: 0, created: Date.now() };
  rooms.set(room.code, room);
  joinRoom(c, room);
  return room;
}

function publicRooms() {
  return [...rooms.values()].filter((r) => r.pub && !r.auto).slice(0, 40).map((r) => {
    const host = clients.get(r.hostId);
    return { code: r.code, host: host ? host.name : '?', players: r.players.size, max: MAX_PLAYERS, mode: r.settings.mode, format: r.settings.format, state: r.state };
  });
}

// accounts, friends, parties and trophies (server/accounts.js)
const accounts = new Accounts({ clients, rooms, joinRoom, maxPlayers: MAX_PLAYERS });

function handle(c, data) {
  let m;
  try { m = JSON.parse(data); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  if (accounts.handle(c, m)) return;
  const room = c.room && rooms.get(c.room);
  const isHost = room && room.hostId === c.id;
  switch (m.t) {
    case 'hello':
      if (!c.user) c.name = clean(m.name, 16) || 'Pilot' + c.id;
      if (m.ver !== NET_VERSION) c.ws.send({ t: 'err', msg: 'Your game is out of date. Refresh the page to update.', fatal: true });
      break;
    // logged-in players always show their username
    case 'name': if (!c.user) { c.name = clean(m.name, 16) || c.name; if (room) sendRoom(room); } break;
    case 'list': c.ws.send({ t: 'rooms', list: publicRooms() }); break;
    case 'create': createRoom(c, m.pub, m.settings, false); break;
    case 'join': {
      const r = rooms.get(clean(m.code, 5).toUpperCase());
      if (!r) return c.ws.send({ t: 'err', msg: 'No room with that code' });
      joinRoom(c, r);
      break;
    }
    case 'quick': {
      // matchmaking (PLAY) for one mode on one arena ("random" = any arena): join the fullest searching
      // room with space for you (and your party), or start a new search
      const mode = MM_FORMAT[m.mode] ? m.mode : 'clash';
      const arena = /^[a-z]{1,16}$/.test(m.arena) ? m.arena : 'random';
      const need = 1 + accounts.followers(c).length;
      const open = [...rooms.values()].filter((r) => r.pub && r.auto && r.state === 'lobby' && !r.autoAt && r.code !== c.room && r.settings.mode === mode
        && (arena === 'random' || r.settings.arena === arena) && r.players.size + need <= seatsOf(r)).sort((a, b) => b.players.size - a.players.size)[0];
      if (open) joinRoom(c, open);
      else createRoom(c, true, { mode, format: MM_FORMAT[mode], arena, tod: 'random', difficulty: 'normal', teams: 'split' }, true);
      break;
    }
    case 'leave': leaveRoom(c); break;
    case 'settings': if (isHost && room.state === 'lobby') { room.settings = cleanSettings(m.settings); for (const id of room.players) clients.get(id).ready = false; sendRoom(room); } break;
    case 'ready':
      if (!room || room.state !== 'lobby') break;
      c.ready = !!m.ready;
      c.bp = m.bp && Array.isArray(m.bp.parts) && m.bp.parts.length <= 120 ? { name: clean(m.bp.name, 24), color: m.bp.color | 0, parts: m.bp.parts.slice(0, 120) } : null;
      sendRoom(room);
      break;
    case 'kick':
      if (isHost && m.id < 0 && room.state === 'lobby') {
        // removing a bot: no more bots for a while
        const n = room.bots.length;
        room.bots = room.bots.filter((b) => b.id !== m.id);
        if (room.bots.length !== n) sendRoom(room);
      } else if (isHost && m.id !== c.id && room.players.has(m.id)) { const k = clients.get(m.id); leaveRoom(k); k.ws.send({ t: 'kicked' }); }
      break;
    case 'chat': if (room) broadcast(room, { t: 'chat', from: c.id, i: m.i | 0 }); break;
    // the host starts a phase (rush build) or the match; everyone else gets the same payload
    case 'begin':
      if (!isHost) break;
      room.state = 'playing';
      room.autoAt = 0;
      room.searchEnds = 0;
      room.beganAt = Date.now();
      broadcast(room, { t: 'begin', payload: m.payload }, c.id);
      for (const id of room.players) accounts.roomChanged(clients.get(id));
      break;
    case 'end':
      if (!isHost || room.state !== 'playing') break;
      accounts.matchResult(room, m.res, m.n); // Quick Match placings move trophies
      room.state = 'lobby';
      for (const id of room.players) clients.get(id).ready = false;
      // matchmaking rooms: whoever stays gets a fresh search (players' games leave for a new search on "Play again")
      if (room.auto) { room.bots = []; room.searchEnds = Date.now() + SEARCH; }
      sendRoom(room);
      for (const id of room.players) accounts.roomChanged(clients.get(id));
      break;
    // live match traffic, relayed as-is to the other players (or only to the host)
    case 'st':
    case 'ev':
      if (!room || room.state !== 'playing') break;
      m.from = c.id;
      if (m.toHost) { const h = clients.get(room.hostId); if (h && h.id !== c.id) h.ws.send(m); }
      else broadcast(room, m, c.id);
      break;
    case 'ping': c.ws.send({ t: 'pong', at: m.at }); break;
  }
}

// ======================= server =======================
const server = http.createServer(serveStatic);
server.on('upgrade', (req, sock) => {
  const origin = req.headers.origin || '';
  if (req.url.split('?')[0] !== '/ws' || (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) || !req.headers['sec-websocket-key']) {
    sock.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return sock.destroy();
  }
  sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}`, '', ''].join('\r\n'));
  sock.setNoDelay(true);
  const ws = new Socket(sock);
  // behind nginx/Caddy the player's address comes in X-Forwarded-For (used for sign-up limits)
  const ip = String(req.headers['x-forwarded-for'] || sock.remoteAddress || '').split(',')[0].trim();
  const c = { id: nextId++, ws, ip, name: 'Pilot', room: null, ready: false, bp: null, tokens: RATE * 2, last: Date.now() };
  ws.lastPong = Date.now();
  clients.set(c.id, c);
  ws.send({ t: 'welcome', id: c.id, ver: NET_VERSION });
  ws.onmessage = (data) => {
    // token-bucket rate limit: spammy clients get messages dropped, then disconnected
    const now = Date.now();
    c.tokens = Math.min(RATE * 2, c.tokens + ((now - c.last) / 1000) * RATE);
    c.last = now;
    if (c.tokens < 1) { c.strikes = (c.strikes || 0) + 1; if (c.strikes > 500) ws.close(1008); return; }
    c.tokens -= 1;
    if (c.strikes) c.strikes--;
    try { handle(c, data); } catch (e) { console.error('message error', e); }
  };
  ws.onclose = () => { leaveRoom(c, 'disconnected'); accounts.onClose(c); clients.delete(c.id); };
});

// heartbeats, idle cleanup, quick-match bots and auto start
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) {
    if (now - c.ws.lastPong > 60000) c.ws.close(1001);
    else c.ws.ping();
  }
}, 20000);
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.auto && r.state === 'lobby' && r.searchEnds && now >= r.searchEnds && r.players.size) fillAndStart(r);
    if (r.auto && r.state === 'lobby' && r.autoAt && now >= r.autoAt) {
      r.autoAt = now + 5000; // keep nudging the host until the match starts
      const h = clients.get(r.hostId);
      if (h) h.ws.send({ t: 'autostart' });
    }
  }
}, 1000);

// HOST=127.0.0.1 when a proxy (Caddy) sits in front; the default listens on every network card (LAN testing)
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Cogwild running at http://localhost:${PORT}  (online server ${NET_VERSION})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { accounts.flush(); for (const c of clients.values()) c.ws.close(1001); server.close(); process.exit(0); });
process.on('uncaughtException', (e) => console.error('uncaught', e)); // one bad message must never take every room down
