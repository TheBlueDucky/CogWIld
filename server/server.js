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
const { Talk } = require('./talk');
const { Pics } = require('./pics');
const { Gallery } = require('./gallery');
const { Admin } = require('./admin');
const { Stats } = require('./stats');
const { Support } = require('./support');
const google = require('./google');
const E = require('../js/economy.js');
const FEATURED = require('../js/featured.js');
const { Referee } = require('./referee');

const PORT = parseInt(process.env.PORT || '8765', 10);
const ROOT = path.resolve(__dirname, '..');
const NET_VERSION = 'cogwild-net-11';
const MAX_PLAYERS = 8;
// Matchmaking (PLAY): each arena has its own queue. A search lasts up to SEARCH_SECS; then bots fill every
// empty seat (at least one, so there's always someone to fight) and the match starts. A full room starts at once.
const SEARCH = parseInt(process.env.SEARCH_SECS || process.env.BOT_WAIT_SEC || '30', 10) * 1000;
const FULL_START = 3000; // a room that fills up with players starts after this short pause
// what PLAY plays in each mode, and how many seats that has (co-op modes: you + 2 teammates)
const MM_FORMAT = { clash: 'ffa', rush: 'ffa', koth: 'squads', gold: 'squads', bounty: 'squads', race: 'race', boss: 'squad', survival: 'squad', heist: 'squads', ball: 'squads', derby: 'ffa', scrap: 'ffa' };
const SEATS = { duel: 2, squads: 6, quads: 8, ffa: 8, race: 6, solo: 1, squad: 3 };
// trophy matchmaking: rooms within ±150 trophies of you, widening 10 per second the search has run;
// bot difficulty follows the room's trophies
const TRO_RANGE = 150, TRO_WIDEN = 10;
// Ranked rooms match on ranked points instead of trophies
const troOf = (c, ranked) => { const u = c && accounts.me(c); return u ? (ranked ? accounts.rp(u) : u.tro | 0) : null; };
function roomTro(room) {
  const t = [...room.players].map((id) => troOf(clients.get(id), room.settings.ranked)).filter((x) => x !== null);
  return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
}
function troFits(room, tro) {
  const avg = roomTro(room);
  if (tro === null || avg === null) return true; // guests, and rooms of guests, match with anyone
  const waited = room.searchEnds ? (SEARCH - Math.max(0, room.searchEnds - Date.now())) / 1000 : 0;
  return Math.abs(avg - tro) <= TRO_RANGE + waited * TRO_WIDEN;
}
const botLevel = (avg) => (avg === null || avg < 250 ? 'easy' : avg < 900 ? 'normal' : 'hard');
const seatsOf = (room) => (room.auto ? SEATS[room.settings.format] || MAX_PLAYERS : MAX_PLAYERS);
const BOT_NAMES = ['Rustbucket', 'Gearhead', 'Sprocket', 'Clunker', 'Torque', 'Widget', 'Ratchet', 'Piston', 'Cogsworth', 'Bolt'];
const MAX_MSG = 256 * 1024; // bytes per message
const RATE = 90; // messages per second allowed (with a burst allowance)
const BYTE_RATE = 512 * 1024; // bytes per second a player may send (burst: 4 seconds' worth)
const MAX_PER_IP = parseInt(process.env.MAX_PER_IP || '24', 10); // open connections from one address
const perIp = new Map(); // ip -> open connections
const HOST_SILENCE = 6000; // a host's game sends 20 updates a second; this long without one and it's gone
// the game's public https address (for Google's redirect); empty = the address the browser used
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// ======================= static files =======================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/octet-stream', '.zip': 'application/zip', '.gz': 'application/gzip',
};
const PUBLIC = new Set(['auth.html', 'support.html', 'index.html', 'privacy.html', 'terms.html', 'credits.html', 'favicon.svg', 'download.html', 'manifest.webmanifest', 'sw.js']); // top-level files that may be served

// sent with every page and file: no framing by other sites, no inline/foreign scripts, no sniffing
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=15552000',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()', // the microphone: voice chat
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
};
function reply(res, code, text) { res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY)); res.end(text); }

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { return reply(res, 400, 'Bad request'); }
  if (url === '/') url = '/index.html';
  if (url === '/favicon.ico') url = '/favicon.svg';
  if (url === '/download' || url === '/app') url = '/download.html';
  if (url === '/support') url = '/support.html'; // "Email us" in the game (server/support.js)
  // Google sign-in in the player's browser (server/google.js): off to Google, and back to a page that finishes it
  if (url === '/auth/google') {
    const s = new URLSearchParams((req.url || '').split('?')[1] || '').get('s') || '';
    if (!google.clientId || !/^[a-f0-9]{32,64}$/.test(s)) return reply(res, 404, "Google sign-in isn't set up here");
    res.writeHead(302, Object.assign({ Location: google.authUrl(PUBLIC_ORIGIN || 'https://' + req.headers.host, s), 'Cache-Control': 'no-store' }, SECURITY));
    return res.end();
  }
  if (url === '/auth/google/done') url = '/auth.html';
  // the moderation page and its API (server/admin.js; needs ADMIN_TOKEN)
  if (url === '/admin' || url.startsWith('/admin/')) return admin.http(req, res, url, String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim());
  if (url.startsWith('/pic/') && accounts.pics.serve(url, res, SECURITY)) return;
  if (url === '/health') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SECURITY));
    return res.end(JSON.stringify({ ok: true, version: NET_VERSION, rooms: rooms.size, players: clients.size }));
  }
  const rel = url.replace(/^\/+/, '');
  // only the game files: index/privacy/favicon/download at the top, everything under js/, and the app downloads
  const allowed = PUBLIC.has(rel) || rel.startsWith('js/') || rel.startsWith('fonts/') || rel.startsWith('img/') || /^downloads\/[\w.-]+\.(exe|apk|zip|tar\.gz)$/.test(rel);
  const file = path.resolve(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep) || rel.includes('..') || rel.includes('\0')) return reply(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return reply(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    // browsers re-check every file (cheap 304s), so an update reaches players on their next page load
    const lastMod = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === lastMod) { res.writeHead(304, SECURITY); return res.end(); }
    const headers = {
      ...SECURITY,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': lastMod,
      'Cache-Control': 'no-cache',
    };
    if (rel.startsWith('downloads/')) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
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
    mode: pick(s.mode, ['rush', 'clash', 'koth', 'gold', 'bounty', 'race', 'survival', 'boss', 'heist', 'ball', 'derby', 'scrap'], 'clash'),
    format: pick(s.format, ['duel', 'squads', 'quads', 'ffa', 'race', 'solo', 'squad'], 'ffa'),
    arena: clean(s.arena, 16) || 'random',
    tod: pick(s.tod, ['random', 'day', 'sunset', 'night'], 'random'),
    difficulty: pick(s.difficulty, ['easy', 'normal', 'hard'], 'normal'),
    teams: pick(s.teams, ['split', 'together'], 'split'),
    // matchmaking only: this week's event (its id) and Ranked
    event: E.WEEKLY.some((w) => w.id === s.event) ? s.event : null,
    ranked: s.ranked === true,
    cup: typeof s.cup === 'string' && /^cup\d{4}-\d\d-\d\d$/.test(s.cup) ? s.cup : null, // the Weekend Cup (matchmaking only)
  };
}

const secsTo = (t) => (t ? Math.max(0, Math.round((t - Date.now()) / 1000)) : 0);
// arenas every player in the room has (the host's game only picks from these, so nobody builds a different map)
function roomArenas(room) {
  let out = null;
  for (const id of room.players) { const k = clients.get(id), a = (k && k.arenas) || FEATURED.CLASSIC; out = out ? out.filter((x) => a.includes(x)) : a.slice(); }
  return out && out.length ? out : FEATURED.CLASSIC;
}
const knowsArena = (c, a) => a === 'random' || ((c.arenas || FEATURED.CLASSIC).includes(a));
function roomView(room) {
  return {
    arenas: roomArenas(room),
    code: room.code, hostId: room.hostId, pub: room.pub, auto: room.auto, state: room.state, settings: room.settings,
    searchIn: room.auto && room.state === 'lobby' ? secsTo(room.searchEnds) : 0, searchFor: SEARCH / 1000, seats: seatsOf(room),
    players: [...room.players].map((id) => {
      const c = clients.get(id);
      const u = accounts.me(c);
      return { id, name: c.name, ready: c.ready, bp: c.bp || null, bpName: c.bp ? clean(c.bp.name, 24) : '', acct: !!u, av: u ? u.av | 0 : -1, pv: u ? u.pv | 0 : 0, tro: u ? u.tro | 0 : 0 };
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
  room.settings.difficulty = room.settings.ranked ? 'hard' : botLevel(roomTro(room)); // tougher bots for higher-trophy rooms
  room.hostId = pickHost(room); // nobody can count on running the match
  room.autoAt = Date.now(); // the timer loop nudges the host until the match begins
  sendRoom(room);
}
// does the host's result fit the match? null when it does, else why not
const MAX_MATCH_SECS = 20 * 60;
function resultProblem(room, res, n) {
  if (!res || typeof res !== 'object') return 'no result';
  if ((Date.now() - (room.beganAt || 0)) / 1000 > MAX_MATCH_SECS) return 'match too long';
  const places = Object.entries(res).map(([id, p]) => [+id, p | 0]);
  if (places.some(([, p]) => p < 1 || p > n)) return 'place out of range';
  const solo = ['ffa', 'race'].includes(room.settings.format);
  if (solo && new Set(places.map(([, p]) => p)).size !== places.length) return 'two players in the same place';
  // last mech standing: whoever was knocked out first must place behind whoever lasted longer
  if (solo && ['clash', 'rush', 'derby'].includes(room.settings.mode) && room.out) {
    for (const [a, pa] of places) {
      for (const [b, pb] of places) {
        const oa = room.out.get(a), ob = room.out.get(b);
        if (a !== b && oa !== undefined && (ob === undefined || oa < ob) && pa < pb) return 'placings disagree with who was knocked out';
      }
    }
  }
  return null;
}
function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const id of room.players) if (id !== exceptId) { const c = clients.get(id); if (c) c.ws.send(s); }
  if (room.spectators) for (const id of room.spectators) { const c = clients.get(id); if (c) c.ws.send(s); }
}
// friends watching a match: they get its start, what happened so far, then everything live
const MAX_SPECTATORS = 6, LOG_MAX = 600;
const LOGGED = new Set(['add', 'wreck', 'elim', 'spawn', 'wave', 'chest', 'open', 'pk', 'super', 'loot', 'lget']);
function spectate(c, friend) {
  const room = friend.room && rooms.get(friend.room);
  if (!room || room.state !== 'playing' || room.phase !== 'match' || !room.beginPayload) return c.ws.send({ t: 'err', msg: `${friend.name} isn't in a match right now` });
  room.spectators = room.spectators || new Set();
  if (room.spectators.size >= MAX_SPECTATORS && !room.spectators.has(c.id)) return c.ws.send({ t: 'err', msg: 'Too many people are watching that match' });
  if (c.room) leaveRoom(c);
  stopSpectating(c);
  room.spectators.add(c.id);
  c.spectating = room.code;
  c.watching = friend.id;
  c.ws.send({ t: 'specBegin', code: room.code, hostId: room.hostId, target: friend.id, name: friend.name, payload: room.beginPayload, log: room.log || [], mode: room.settings.mode });
  friend.ws.send({ t: 'note', kind: 'info', msg: `👁 ${c.name} is watching you play` });
}
function stopSpectating(c, why) {
  const room = c.spectating && rooms.get(c.spectating);
  if (room && room.spectators) room.spectators.delete(c.id);
  if (c.spectating && why) c.ws.send({ t: 'specEnd', why });
  c.spectating = null;
}
function endSpectators(room, why) {
  for (const id of room.spectators || []) { const s = clients.get(id); if (s) stopSpectating(s, why); }
  room.spectators = null;
}
function sendRoom(room) { broadcast(room, { t: 'room', room: roomView(room) }); }

function leaveRoom(c, reason) {
  const room = c.room && rooms.get(c.room);
  c.room = null;
  c.ready = false;
  if (!room) return;
  room.players.delete(c.id);
  if (!room.players.size) { endSpectators(room, 'The match is over'); rooms.delete(room.code); return; }
  for (const id of room.spectators || []) { const s = clients.get(id); if (s && s.watching === c.id) stopSpectating(s, `${c.name} left the match`); }
  if (room.hostId === c.id) {
    room.hostId = pickHost(room);
    if (room.state === 'playing' && room.phase === 'match') {
      // host migration: another player's game takes over the bots and the rules, and the match goes on
      if (room.ref) room.ref.reassign(c.id, room.hostId);
      broadcast(room, { t: 'host', id: room.hostId, old: c.id });
    } else if (room.state === 'playing') {
      // the old host had everyone's Rush builds: back to the lobby
      resetRoom(room);
      broadcast(room, { t: 'hostLeft' });
    }
  } else if (room.state === 'playing') {
    if (room.ref) room.ref.reassign(c.id, room.hostId);
    broadcast(room, { t: 'left', id: c.id, reason });
  }
  sendRoom(room);
  accounts.roomChanged(c);
}

// matchmaking: whoever is left gets a fresh search (and new bots) instead of a room that never starts
function resetRoom(room) {
  room.state = 'lobby';
  room.phase = null;
  for (const id of room.players) clients.get(id).ready = false;
  if (room.auto) { room.bots = []; room.autoAt = 0; room.searchEnds = Date.now() + SEARCH; }
}
// a random player runs the match (players whose results didn't add up lately only when nobody else is there)
function pickHost(room) {
  const ids = [...room.players];
  const fair = ids.filter((id) => !accounts.flagged(clients.get(id)));
  const pool = fair.length ? fair : ids;
  return pool[crypto.randomInt(pool.length)];
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
// chat (friends, party, club) and voice chat set-up (server/talk.js)
accounts.talk = new Talk(accounts, { clients, rooms });
// players' own profile pictures and club pictures (server/pics.js)
accounts.pics = new Pics(accounts, path.join(process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'), 'pics'));
accounts.gallery = new Gallery(accounts);
// players per day and bug reports from games (server/stats.js), shown on the moderation page
accounts.stats = new Stats(accounts);
const support = (accounts.support = new Support(accounts)); // messages from /support (server/support.js)
const admin = new Admin(accounts, { clients, rooms }, ROOT, SECURITY);

// mech parts from players: only short part names, small whole-number positions and the look (turn, shape) are relayed
const coord = (v) => Math.max(-64, Math.min(64, v | 0));
function cleanParts(parts) {
  return parts.slice(0, E.MAX_PARTS).filter((p) => p && typeof p.t === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(p.t)).map((p) => E.partLook(p, { t: p.t, x: coord(p.x), y: coord(p.y), z: coord(p.z) }));
}

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
      // the arenas this game knows (older games don't say: the classic eight)
      c.arenas = Array.isArray(m.arenas) ? m.arenas.filter((a) => typeof a === 'string' && /^[a-z]{1,16}$/.test(a)).slice(0, 40) : FEATURED.CLASSIC;
      // what the game runs on (website, app, phone…), for the daily stats
      c.plat = typeof m.plat === 'string' && /^[a-z][a-z0-9-]{0,15}$/.test(m.plat) ? m.plat : 'old';
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
      // kind 'weekly': this week's event (its mode, any arena, with its twist); kind 'ranked': 3v3 on ranked points
      const kind = m.kind === 'weekly' || m.kind === 'ranked' || m.kind === 'cup' ? m.kind : null;
      let mode = MM_FORMAT[m.mode] ? m.mode : 'clash';
      let arena = /^[a-z]{1,16}$/.test(m.arena) ? m.arena : 'random';
      let event = null;
      if (kind === 'weekly') { const w = E.week(); mode = w.mode; arena = 'random'; event = w.id; }
      let cupId = null;
      if (kind === 'cup') {
        const cu = accounts.cupNow();
        if (!accounts.me(c)) return c.ws.send({ t: 'err', msg: 'Log in to play the Weekend Cup' });
        if (!cu.live) return c.ws.send({ t: 'err', msg: 'The Weekend Cup is on from Friday 18:00 to Sunday 24:00 (UTC)' });
        mode = cu.mode; arena = 'random'; cupId = cu.id;
      }
      if (kind === 'ranked') {
        if (!accounts.canRanked(c)) return c.ws.send({ t: 'err', msg: `Ranked unlocks at ${E.RANKED.unlockAt} trophies (your best ever)` });
        mode = E.RANKED.modes[crypto.randomInt(E.RANKED.modes.length)];
        arena = 'random';
      }
      const ranked = kind === 'ranked';
      const need = 1 + accounts.followers(c).length;
      const tro = troOf(c, ranked);
      const open = [...rooms.values()].filter((r) => r.pub && r.auto && r.state === 'lobby' && !r.autoAt && r.code !== c.room && troFits(r, tro)
        && r.settings.ranked === ranked && r.settings.event === event && (r.settings.cup || null) === cupId && (ranked || r.settings.mode === mode)
        && (arena === 'random' || r.settings.arena === arena) && knowsArena(c, r.settings.arena) && r.players.size + need <= seatsOf(r)).sort((a, b) => b.players.size - a.players.size)[0];
      if (open) joinRoom(c, open);
      else createRoom(c, true, { mode, format: MM_FORMAT[mode], arena, tod: 'random', difficulty: 'normal', teams: 'split', event, ranked, cup: cupId }, true);
      break;
    }
    case 'leave': leaveRoom(c); break;
    case 'settings': if (isHost && room.state === 'lobby' && !room.auto) { room.settings = Object.assign(cleanSettings(m.settings), { ranked: false, cup: null }); for (const id of room.players) clients.get(id).ready = false; sendRoom(room); } break;
    case 'ready':
      if (!room || room.state !== 'lobby') break;
      c.ready = !!m.ready;
      c.bp = m.bp && Array.isArray(m.bp.parts) && m.bp.parts.length <= E.MAX_PARTS ? { name: clean(m.bp.name, 24), color: m.bp.color & 0xffffff, parts: cleanParts(m.bp.parts), fin: E.item('finishes', String(m.bp.fin || '')) ? String(m.bp.fin) : undefined, lo: accounts.loadout(c, m.bp.lo) || undefined } : null;
      // the mech must fit this player's level (from the server's XP) and the budget
      if (c.bp) {
        const why = E.mechProblem(c.bp.parts, accounts.level(c), E.BUDGET);
        if (why) { c.bp = null; c.ws.send({ t: 'err', msg: `That mech isn't allowed online (${why}), so you'll get an example mech` }); }
      }
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
      // the arena the host's game actually picked ("any arena" resolves when the match begins)
      if (m.payload && /^[a-z]{1,16}$/.test(m.payload.arena)) room.playedArena = m.payload.arena;
      room.phase = m.payload && m.payload.kind === 'build' ? 'build' : 'match';
      // who plays which mech (for checking the results later), and who got knocked out, in order
      room.roster = new Map();
      room.out = new Map();
      room.ref = null;
      if (room.phase === 'match' && m.payload && Array.isArray(m.payload.roster)) {
        for (const e of m.payload.roster.slice(0, 64)) if (e && Number.isInteger(e.i)) room.roster.set(e.i, { o: e.o | 0, h: !!e.h });
        room.ref = new Referee(room, m.payload.roster.slice(0, 64), room.hostId);
        room.beginPayload = m.payload;
        room.log = [];
        // every player's mech in the match must fit that player's level and the mode's budget
        const budget = room.settings.mode === 'rush' ? E.RUSH_BUDGET : E.BUDGET;
        // v1.10: each player's super / gadget / perks: only what they own
        for (const e of m.payload.roster) if (e && e.h && e.bp && typeof e.bp === 'object' && clients.get(e.o | 0)) { const lo = accounts.loadout(clients.get(e.o | 0), e.bp.lo); if (lo) e.bp.lo = lo; else delete e.bp.lo; }
        const bad = m.payload.roster.find((e) => e && e.h && clients.get(e.o | 0) && E.mechProblem(e.bp && e.bp.parts, accounts.level(clients.get(e.o | 0)), budget));
        if (bad) {
          console.warn(`match refused in ${room.code}: ${clean(bad.n, 16)}'s mech is not allowed`);
          resetRoom(room);
          c.ws.send({ t: 'err', msg: 'A mech in this match is not allowed online' });
          broadcast(room, { t: 'hostLeft' }, c.id);
          leaveRoom(c);
          c.ws.send({ t: 'kicked' });
          break;
        }
      }
      broadcast(room, { t: 'begin', payload: m.payload }, c.id);
      for (const id of room.players) accounts.roomChanged(clients.get(id));
      break;
    case 'end':
      if (!isHost || room.state !== 'playing') break;
      {
        const n = Math.min(m.n | 0, seatsOf(room));
        const noted = room.ref ? room.ref.notes : new Map();
        const why = room.auto ? (noted.has(c.id) ? `host ${noted.get(c.id)}` : resultProblem(room, m.res, n)) : null;
        if (!why && m.res && typeof m.res === 'object') for (const id of noted.keys()) { delete m.res[id]; accounts.noted(clients.get(id), noted.get(id)); }
        if (why) {
          // the host's result doesn't fit what the other games reported: no trophies move
          console.warn(`results refused in ${room.code} (host ${c.name}): ${why}`);
          accounts.disputed(c, room, why);
        } else if (room.settings.ranked) accounts.rankedResult(room, m.res, n); // Ranked: ranked points instead of trophies
        else if (room.settings.cup) accounts.cupResult(room, m.res, n); // Weekend Cup: cup points instead of trophies
        else accounts.matchResult(room, m.res, n); // Quick Match placings move trophies
      }
      room.state = 'lobby';
      room.phase = null;
      room.beginPayload = room.log = null;
      endSpectators(room, 'The match is over');
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
      if (room.ref) room.ref.check(c.id, m);
      if (room.log && Array.isArray(m.e)) for (const e of m.e) if (e && LOGGED.has(e.k) && room.log.length < LOG_MAX) room.log.push({ e, from: c.id });
      // a player's own game saying they were knocked out (nobody reports their own elimination falsely)
      if (Array.isArray(m.e) && room.roster) {
        for (const e of m.e) {
          const r = e && e.k === 'elim' && room.roster.get(e.c);
          if (r && r.h && r.o === c.id && !room.out.has(c.id)) room.out.set(c.id, room.out.size + 1);
        }
      }
      if (m.toHost) { const h = clients.get(room.hostId); if (h && h.id !== c.id) h.ws.send(m); }
      else broadcast(room, m, c.id);
      break;
    case 'ping': c.ws.send({ t: 'pong', at: m.at }); break;
    // an error the player's game ran into (js/bugs.js sends these by itself)
    case 'bug': accounts.stats.bug(c, m); break;
    // watch a friend's match (accounts only, friends only)
    case 'spectate': {
      const target = accounts.friendClient(c, m.name);
      if (!target) return c.ws.send({ t: 'err', msg: 'You can watch friends who are online' });
      spectate(c, target);
      break;
    }
    case 'specLeave': stopSpectating(c); break;
  }
}

// ======================= server =======================
// small JSON posts from the website's own pages: fn(message, ip) -> [status, answer]
function postJson(req, res, fn) {
  let body = '';
  const answer = (code, o) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SECURITY)); res.end(JSON.stringify(o)); };
  req.on('data', (d) => { body += d; if (body.length > 16384) req.destroy(); });
  req.on('end', async () => {
    let m;
    try { m = JSON.parse(body); } catch (e) { return answer(400, { msg: 'Bad request' }); }
    try { answer(...(await fn(m || {}, String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()))); } catch (e) { answer(400, { msg: e.message }); }
  });
}
const POSTS = {
  // the sign-in page posts Google's token here: { s, token } -> { ok } or { msg }
  '/auth/google/finish': async (m) => {
    let why;
    try { why = await accounts.googleDone(m.s, m.token); } catch (e) { why = 'Google sign-in failed: ' + e.message; }
    return why ? [400, { msg: why }] : [200, { ok: true }];
  },
  // the support page: who is signed in, and sending a message
  '/support/who': (m) => { const w = support.who(m.s); return w ? [200, w] : [401, { msg: 'Not signed in' }]; },
  '/support/send': (m, ip) => { const why = support.send(m, ip); return why ? [400, { msg: why }] : [200, { ok: true }]; },
};
const server = http.createServer((req, res) => {
  const post = req.method === 'POST' && POSTS[(req.url || '').split('?')[0]];
  if (post) return postJson(req, res, post);
  serveStatic(req, res);
});
server.on('upgrade', (req, sock) => {
  const origin = req.headers.origin || '';
  if (req.url.split('?')[0] !== '/ws' || (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) || !req.headers['sec-websocket-key']) {
    sock.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return sock.destroy();
  }
  // behind nginx/Caddy the player's address comes in X-Forwarded-For (set by the proxy, used for limits)
  const ip = String(req.headers['x-forwarded-for'] || sock.remoteAddress || '').split(',')[0].trim();
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) {
    sock.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    return sock.destroy();
  }
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}`, '', ''].join('\r\n'));
  sock.setNoDelay(true);
  const ws = new Socket(sock);
  const c = { id: nextId++, ws, ip, name: 'Pilot', room: null, ready: false, bp: null, tokens: RATE * 2, bytes: BYTE_RATE * 4, last: Date.now() };
  ws.lastPong = Date.now();
  clients.set(c.id, c);
  ws.send({ t: 'welcome', id: c.id, ver: NET_VERSION, login: accounts.loginOptions() });
  ws.onmessage = (data) => {
    // token-bucket rate limit: spammy clients get messages dropped, then disconnected
    const now = Date.now();
    const dt = (now - c.last) / 1000;
    c.tokens = Math.min(RATE * 2, c.tokens + dt * RATE);
    c.bytes = Math.min(BYTE_RATE * 4, c.bytes + dt * BYTE_RATE);
    c.last = now;
    if (c.tokens < 1 || c.bytes < data.length) { c.strikes = (c.strikes || 0) + 1; if (c.strikes > 500) ws.close(1008); return; }
    c.tokens -= 1;
    c.bytes -= data.length;
    c.heard = now;
    if (c.strikes) c.strikes--;
    try { handle(c, data); } catch (e) { console.error('message error', e); }
  };
  ws.onclose = () => {
    if (!clients.has(c.id)) return;
    const n = (perIp.get(ip) || 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    stopSpectating(c);
    leaveRoom(c, 'disconnected'); accounts.onClose(c); clients.delete(c.id);
  };
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
    // a host whose game went silent mid-match (lost internet): drop them so another player takes over
    if (r.state === 'playing' && r.phase === 'match' && r.players.size > 1) {
      const h = clients.get(r.hostId);
      if (h && now - (h.heard || now) > HOST_SILENCE) h.ws.close(1001);
    }
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
