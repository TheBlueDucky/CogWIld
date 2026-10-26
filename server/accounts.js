// Cogwild accounts: usernames + passwords, cloud saves, profiles, friends, parties, trophies, leaderboard.
// Zero dependencies. Everything lives in one JSON file (DATA_DIR/db.json), written atomically a moment
// after each change. Passwords are scrypt hashes; sessions are random tokens (only their hash is stored).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FEATURED = require('../js/featured.js');
const E = require('../js/economy.js');
// the seasonal event running now (EVENT_DATE=2026-12-20 pretends another day: only for tests)
const eventNow = () => E.event(process.env.EVENT_DATE ? Date.parse(process.env.EVENT_DATE) : Date.now());
const mailer = require('./mailer');
const google = require('./google');
const filter = require('./filter'); // bad words (names are refused, descriptions get ****)

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const RENAME_GAP = 7 * 86400000; // a new username at most once a week
const EMAIL_RE = /^[^\s@<>"'`,;]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
const CODE_LIFE = 10 * 60000; // login codes work for 10 minutes, 5 tries
// names kids shouldn't see (substring match, case-insensitive) and names that pretend to be staff
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'dick', 'cock', 'pussy', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'porn', 'sexy', 'penis', 'vagina', 'retard', 'admin', 'moderator', 'official', 'cogwild'];
const MAX_FRIENDS = 100;
// clubs: up to 30 players under one name, with club trophies (everyone's added up) and a quick-chat wall
const CLUB_MAX = 30, CLUB_BADGES = 12;
const CLUB_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,18}[A-Za-z0-9]$/;
const PARTY_MAX = 4;
const MAX_SAVE = 200 * 1024; // bytes of cloud save per player
const AVATARS = E.AVATAR_COUNT; // the client has the emoji list (24 free, the rest from the Shop, Trophy Road and Cog Pass)
const TOKENS_KEPT = 5; // devices that can stay logged in at once
// shorter Quick Matches don't move trophies (no farming by quitting early)
const QUICK_MIN_SECS = parseFloat(process.env.TROPHY_MIN_SECS || '40');
// new accounts per network per hour (tests on your own PC can raise it)
const SIGNUPS_PER_HOUR = parseInt(process.env.SIGNUPS_PER_HOUR || '5', 10);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pass, salt) => new Promise((res, rej) => crypto.scrypt(pass, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
const key = (name) => String(name || '').toLowerCase();
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// wrong passwords allowed per 15 minutes, per account and per network
const FAIL_WINDOW = 15 * 60000, FAILS_PER_NAME = 10, FAILS_PER_IP = 40;

// trophies for a placing: 1st of 8 gets +8, last loses a few (nothing to lose below 50 trophies)
function trophyDelta(place, n, trophies, streak) {
  const f = n > 1 ? (place - 1) / (n - 1) : 0;
  let d = Math.round(8 - 12 * f);
  if (d > 0) {
    if (trophies >= 1000) d = Math.max(2, d - 2);
    if (place === 1) d += Math.min(3, streak); // win streak bonus
  } else if (d < 0) {
    d = trophies < 50 ? 0 : Math.round(d * (1 + Math.min(trophies, 2000) / 1000));
  }
  return Math.max(-trophies, d);
}

class Accounts {
  // hooks: { clients, rooms, joinRoom(c, room), maxPlayers }
  constructor(hooks) {
    this.h = hooks;
    this.db = { users: {} };
    this.byToken = new Map(); // token hash -> user key
    this.online = new Map(); // user key -> client
    this.parties = new Map(); // party id -> { id, leader, members: [keys] }
    this.partyOf = new Map(); // user key -> party id
    this.regByIp = new Map(); // ip -> [timestamps] (sign-up spam limit)
    this.fails = new Map(); // 'n:'+name / 'i:'+ip -> [timestamps] of wrong passwords
    this.guestByIp = new Map(); // ip -> [timestamps] (new guest records)
    this.codes = new Map(); // email -> { hash, exp, tries } (email login codes waiting to be typed in)
    this.mailByIp = new Map(); // ip -> [timestamps] and 'e:'+email -> [timestamps] (codes sent)
    this.googleWait = new Map(); // secret -> { cid, at, email } (a game waiting for its player to sign in with Google in the browser)
    // forget old sign-up and wrong-password records so the maps stay small
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.codes) if (v.exp < now) this.codes.delete(k);
      for (const [k, v] of this.googleWait) if (now - v.at > 15 * 60000) this.googleWait.delete(k);
      for (const [m, win] of [[this.regByIp, 3600000], [this.fails, FAIL_WINDOW], [this.guestByIp, 3600000], [this.mailByIp, 3600000]]) {
        for (const [k, list] of m) { const keep = list.filter((x) => now - x < win); if (keep.length) m.set(k, keep); else m.delete(k); }
      }
      // guests nobody has seen for half a year are forgotten
      for (const [k, g] of Object.entries(this.db.guests)) if (now - (g.seen || 0) > 180 * 86400000) delete this.db.guests[k];
    }, 600000).unref();
    this.topCache = null;
    this.load();
  }

  // ======================= storage =======================
  load() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DB_FILE)) this.db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('accounts: could not read', DB_FILE, e.message);
      // keep the damaged file for a human to look at, start fresh
      try { fs.renameSync(DB_FILE, DB_FILE + '.broken-' + Date.now()); } catch (e2) { /* ignore */ }
      this.db = { users: {} };
    }
    // no prototype: a player called __proto__ or constructor is just a name
    this.db.users = Object.assign(Object.create(null), this.db.users || {});
    this.db.clubs = Object.assign(Object.create(null), this.db.clubs || {});
    this.db.guests = Object.assign(Object.create(null), this.db.guests || {});
    // club chat: saved with the rest, the last 40 lines per club, each deleted after a week (server/talk.js prune)
    this.db.clubChat = Object.assign(Object.create(null), this.db.clubChat || {});
    this.clubLog = {
      get: (id) => this.db.clubChat[id],
      set: (id, v) => { this.db.clubChat[id] = v; this.dirty(); },
      delete: (id) => { delete this.db.clubChat[id]; this.dirty(); },
    };
    for (const [k, u] of Object.entries(this.db.users)) for (const t of u.tokens || []) this.byToken.set(t, k);
    this.byEmail = new Map(); // email -> user key
    for (const [k, u] of Object.entries(this.db.users)) if (u.email) this.byEmail.set(u.email, k);
    console.log(`accounts: ${Object.keys(this.db.users).length} players in ${DB_FILE}`);
  }
  dirty() {
    this.topCache = null;
    if (this.saveT) return;
    this.saveT = setTimeout(() => this.flush(), 1500);
  }
  flush() {
    clearTimeout(this.saveT);
    this.saveT = null;
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, DB_FILE);
      this.dailyBackup();
    } catch (e) { console.error('accounts: save failed', e.message); }
  }
  // one copy per day in DATA_DIR/backups, the last 14 days are kept
  dailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.backedUp === day) return;
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `db-${day}.json`);
    if (!fs.existsSync(file)) fs.copyFileSync(DB_FILE, file);
    this.backedUp = day;
    const old = fs.readdirSync(dir).filter((f) => /^db-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  }
  user(name) { return this.db.users[key(name)] || null; } // users has no prototype, so only real players come back

  // ======================= helpers =======================
  send(c, m) { if (c && c.ws) c.ws.send(m); }
  err(c, msg, extra) { this.send(c, Object.assign({ t: 'acctErr', msg }, extra || {})); }
  me(c) { return c.user ? this.db.users[c.user] : null; }
  status(c) {
    const room = c.room && this.h.rooms.get(c.room);
    if (room) return room.state === 'playing' ? 'match' : 'lobby';
    return c.busy ? 'solo' : 'menu';
  }
  publicCard(u) {
    const club = u.club && this.db.clubs[u.club];
    return { name: u.name, av: u.av | 0, pv: u.pv | 0, tro: u.tro | 0, best: u.best | 0, lv: u.lv | 0, wins: u.wins | 0, played: u.played | 0, club: club ? club.name : null, rp: (u.best | 0) >= E.RANKED.unlockAt ? this.rp(u) : null };
  }
  // sign in this socket as user k (one live session per player: the older one is signed out)
  attach(c, k, token) {
    const banned = this.db.users[k] && (this.db.users[k].banUntil || 0) > Date.now();
    if (banned) {
      const until = this.db.users[k].banUntil;
      this.send(c, { t: 'acctOut', reason: until - Date.now() > 3000 * 86400000 ? 'This account was suspended by a moderator' : `This account is suspended until ${new Date(until).toUTCString().slice(5, 22)} UTC` });
      return;
    }
    if (c.user && c.user !== k) this.detach(c); // switching accounts on one connection
    c.guest = null; // an account's wallet, not the device's guest one
    const old = this.online.get(k);
    if (old && old !== c) { this.detach(old); this.send(old, { t: 'acctOut', reason: 'You logged in somewhere else' }); }
    c.user = k;
    const u = this.db.users[k];
    c.name = u.name;
    u.seen = Date.now();
    this.online.set(k, c);
    this.dirty();
    this.send(c, { t: 'acctOk', token, email: u.email || null, hasPass: !!u.hash, me: this.publicCard(u), created: u.created, save: this.withWallet(u, u.save) || null, claimed: this.wallet(u).road, wallet: this.walletView(u) });
    this.sendFriends(c);
    this.sendParty(k);
    if (this.talk) this.talk.onLogin(c);
    this.friendsChanged(k);
    // the club sees you come online
    const club = this.clubOf(u);
    if (club) this.clubChanged(club); else this.send(c, { t: 'club', club: null });
  }
  detach(c) {
    const k = c.user;
    if (!k) return;
    this.leaveParty(k);
    if (this.online.get(k) === c) this.online.delete(k);
    c.user = null;
    this.friendsChanged(k);
    const club = this.clubOf(this.db.users[k]);
    if (club) this.clubChanged(club);
  }
  addToken(k) {
    const token = crypto.randomBytes(32).toString('hex');
    const u = this.db.users[k];
    u.tokens = (u.tokens || []).concat(sha(token));
    while (u.tokens.length > TOKENS_KEPT) this.byToken.delete(u.tokens.shift());
    this.byToken.set(sha(token), k);
    return token;
  }
  slowDown(c) {
    // no more than 8 password tries a minute per connection
    const now = Date.now();
    c.authTries = (c.authTries || []).filter((t) => now - t < 60000);
    if (c.authTries.length >= 8) { this.err(c, 'Too many tries. Wait a minute and try again.'); return true; }
    c.authTries.push(now);
    return false;
  }
  recentFails(id) { const now = Date.now(); return (this.fails.get(id) || []).filter((t) => now - t < FAIL_WINDOW); }
  failed(c, name) {
    for (const id of ['n:' + key(name), 'i:' + c.ip]) this.fails.set(id, this.recentFails(id).concat(Date.now()));
  }
  // too many wrong passwords for this account or from this network lately
  locked(c, name) {
    if (this.recentFails('n:' + key(name)).length >= FAILS_PER_NAME || this.recentFails('i:' + c.ip).length >= FAILS_PER_IP) {
      this.err(c, 'Too many wrong passwords. Wait 15 minutes and try again.');
      return true;
    }
    return false;
  }

  // ======================= messages =======================
  // returns true when the message was an account message
  handle(c, m) {
    const t = m.t;
    if (this.talk && this.talk.handle(c, m)) return true; // chat and voice (server/talk.js)
    if (this.pics && this.pics.handle(c, m)) return true; // profile and club pictures (server/pics.js)
    if (this.gallery && this.gallery.handle(c, m)) return true; // the mech gallery (server/gallery.js)
    if (!/^(acct|friend|party|invite|top|profile|save|status|earn|gift|buy|roadClaim|passClaim|eventClaim|cup|club|guest|email|google)/.test(t)) return false;
    const fn = {
      acctRegister: () => this.register(c, m), acctSignup: () => this.signup(c, m), acctLogin: () => this.login(c, m), acctAuth: () => this.auth(c, m),
      acctLogout: () => this.logout(c), acctPass: () => this.changePass(c, m), acctDelete: () => this.remove(c, m), acctRename: () => this.rename(c, m),
      save: () => this.saveData(c, m), profileSet: () => this.setProfile(c, m), profile: () => this.showProfile(c, m),
      friendAdd: () => this.friendAdd(c, m), friendAccept: () => this.friendAccept(c, m), friendDecline: () => this.friendDecline(c, m), friendRemove: () => this.friendRemove(c, m),
      partyInvite: () => this.partyInvite(c, m), partyAccept: () => this.partyAccept(c, m), partyLeave: () => c.user && this.leaveParty(c.user), partyKick: () => this.partyKick(c, m), partyMech: () => this.partyMech(c, m),
      clubCreate: () => this.clubCreate(c, m), clubJoin: () => this.clubJoin(c, m), clubLeave: () => this.clubLeave(c), clubKick: () => this.clubKick(c, m),
      clubList: () => this.clubList(c, m), clubInfo: () => this.clubInfo(c, m), clubChat: () => this.clubChat(c, m), clubEdit: () => this.clubEdit(c, m),
      guest: () => this.guestHello(c, m), earn: () => this.earn(c, m),
      emailStart: () => this.emailStart(c, m), emailCode: () => this.emailCode(c, m), emailName: () => this.emailName(c, m), googleLogin: () => this.googleLogin(c, m), googleStart: () => this.googleStart(c, m), acctResetPass: () => this.resetPass(c, m), gift: () => this.gift(c), buy: () => this.buy(c, m), roadClaim: () => this.roadClaim(c, m), passClaim: () => this.passClaim(c, m), eventClaim: () => this.eventClaim(c, m), cupInfo: () => this.cupInfo(c), cupClaim: () => this.cupClaim(c, m),
      invite: () => this.inviteRoom(c, m), top: () => this.top(c, m), status: () => { c.busy = !!m.busy; if (c.user) this.friendsChanged(c.user); },
    }[t];
    if (!fn) return true;
    const r = fn();
    if (r && r.catch) r.catch((e) => { console.error('accounts', t, e); this.err(c, 'Something went wrong. Try again.'); });
    return true;
  }

  // ======================= email and Google login =======================
  // what this server can do (sent with 'welcome'): the game asks for a login when either works
  loginOptions() { return { email: mailer.ready, google: google.clientId || null }; }
  // 1) send a 6-digit code to an email address
  async emailStart(c, m) {
    const email = String(m.email || '').trim().toLowerCase();
    const purpose = ['signup', 'reset'].includes(m.purpose) ? m.purpose : c.user ? 'link' : 'login';
    if (!mailer.ready) return this.err(c, "Email login isn't set up on this server yet");
    if (email.length > 254 || !EMAIL_RE.test(email)) return this.err(c, "That doesn't look like an email address");
    // one account per email
    if (purpose === 'signup' && this.byEmail.has(email)) return this.err(c, 'That email already has an account. Log in instead.');
    // a new password: only accounts get a code, but the answer is the same either way (nobody learns who plays)
    if (purpose === 'reset' && !this.byEmail.has(email)) return this.send(c, { t: 'acctCodeSent', email, purpose });
    const now = Date.now();
    const byIp = (this.mailByIp.get(c.ip) || []).filter((x) => now - x < 3600000);
    const byMail = (this.mailByIp.get('e:' + email) || []).filter((x) => now - x < 600000);
    if (byIp.length >= 12 || byMail.length >= 3) return this.err(c, 'Too many codes asked for. Wait a few minutes and try again.');
    this.mailByIp.set(c.ip, byIp.concat(now));
    this.mailByIp.set('e:' + email, byMail.concat(now));
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.codes.set(email, { hash: sha(email + ':' + code), exp: now + CODE_LIFE, tries: 0 });
    try {
      await mailer.send(email, `Your Cogwild code: ${code}`, `Your Cogwild login code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.\n\nBlueDucky Games · Cogwild`);
    } catch (e) {
      console.error('mail failed', e.message);
      this.codes.delete(email);
      return this.err(c, "We couldn't send the email right now. Try again in a minute.");
    }
    this.send(c, Object.assign({ t: 'acctCodeSent', email, purpose }, mailer.dev ? { devCode: code } : {}));
  }
  // 2) the code from the email
  emailCode(c, m) {
    const email = String(m.email || '').trim().toLowerCase();
    const p = this.codes.get(email);
    if (!p || p.exp < Date.now()) return this.err(c, 'That code ran out. Ask for a new one.');
    if (++p.tries > 5) { this.codes.delete(email); return this.err(c, 'Too many wrong codes. Ask for a new one.'); }
    if (!same(sha(email + ':' + String(m.code || '').trim()), p.hash)) return this.err(c, "That code isn't right");
    this.codes.delete(email);
    if (m.purpose === 'signup' && !c.user) {
      if (this.byEmail.has(email)) return this.err(c, 'That email already has an account. Log in instead.');
      const p = c.pendingSignup;
      if (p && p.email === email) {
        if (this.user(p.name)) return this.err(c, 'That username was just taken. Pick another one.');
        c.pendingSignup = null;
        return this.createAccount(c, p);
      }
      c.newEmail = email;
      c.newGoogle = false;
      return this.send(c, { t: 'acctPickName', email });
    }
    if (m.purpose === 'reset' && !c.user) {
      if (!this.byEmail.has(email)) return this.err(c, "That code isn't right");
      c.resetEmail = email;
      return this.send(c, { t: 'acctNewPass', email });
    }
    this.emailVerified(c, email);
  }
  // a forgotten password: after the emailed code, a new one (other devices are logged out)
  async resetPass(c, m) {
    const k = c.resetEmail && this.byEmail.get(c.resetEmail);
    const u = k && this.db.users[k];
    if (!u) return this.err(c, 'Ask for a new code first');
    const pass = String(m.pass || '');
    if (pass.length < 6 || pass.length > 72) return this.err(c, 'Passwords need 6 to 72 characters');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = (await scrypt(pass, u.salt)).toString('hex');
    for (const t of u.tokens || []) this.byToken.delete(t);
    u.tokens = [];
    c.resetEmail = null;
    this.fails.delete('n:' + key(u.name));
    this.fails.delete('n:' + u.email);
    this.dirty();
    this.attach(c, k, this.addToken(k));
  }
  async googleLogin(c, m) {
    if (this.slowDown(c)) return;
    let email;
    try { email = await google.verify(m.credential); } catch (e) { return this.err(c, 'Google sign-in failed: ' + e.message); }
    this.emailVerified(c, email);
  }
  // the game is about to open the browser to sign in with Google; the secret ties that sign-in to this game
  googleStart(c, m) {
    const s = String(m.s || '');
    if (!/^[a-f0-9]{32,64}$/.test(s)) return;
    if (!google.clientId) return this.err(c, "Google sign-in isn't set up on this server yet");
    const w = this.googleWait.get(s);
    if (w && w.email) { this.googleWait.delete(s); return this.emailVerified(c, w.email); } // signed in while we were reconnecting
    if (this.googleWait.size > 5000) return this.err(c, 'Too many sign-ins right now. Try again in a minute.');
    this.googleWait.set(s, { cid: c.id, at: Date.now() });
  }
  // the browser came back from Google with a token: log in the game that asked (or keep it for when it reconnects)
  async googleDone(secret, token) {
    const s = String(secret || '');
    if (!/^[a-f0-9]{32,64}$/.test(s)) return 'This sign-in link is broken. Start again from the game.';
    const email = await google.verify(token, google.nonceOf(s));
    const w = this.googleWait.get(s);
    const c = w && this.h.clients.get(w.cid);
    if (c && c.ws) { this.googleWait.delete(s); this.emailVerified(c, email); return null; }
    this.googleWait.set(s, { cid: 0, at: Date.now(), email });
    return null;
  }
  // a proven email: log in to its account, add it to the account you're in, or start a new account
  emailVerified(c, email) {
    const k = this.byEmail.get(email);
    if (c.user) {
      const u = this.me(c);
      if (k && k !== c.user) return this.err(c, 'That email belongs to another account');
      if (u.email && u.email !== email) this.byEmail.delete(u.email);
      u.email = email;
      this.byEmail.set(email, c.user);
      this.dirty();
      return this.send(c, { t: 'acctEmailSet', email });
    }
    if (k && this.db.users[k]) return this.attach(c, k, this.addToken(k));
    c.newEmail = email;
    c.newGoogle = true;
    this.send(c, { t: 'acctPickName', email, google: true });
  }
  // 3) a new player picks their username
  async emailName(c, m) {
    const email = c.newEmail;
    if (!email) return this.err(c, 'Log in with your email first');
    const name = String(m.name || '').trim(), pass = String(m.pass || '');
    if (!NAME_RE.test(name)) return this.err(c, 'Usernames are 3-16 letters, numbers or _');
    if (BLOCKED.some((b) => key(name).includes(b)) || filter.isBad(name)) return this.err(c, 'Please pick a different username');
    if (!c.newGoogle) {
      if (pass.length < 6 || pass.length > 72) return this.err(c, 'Passwords need 6 to 72 characters');
      if (pass.toLowerCase() === key(name) || pass.toLowerCase() === email) return this.err(c, "Your password can't be your username or email");
    }
    if (this.user(name)) return this.err(c, 'That username is taken');
    if (this.byEmail.has(email)) return this.err(c, 'That email already has an account. Log in instead.');
    const salt = pass ? crypto.randomBytes(16).toString('hex') : null;
    const hash = pass ? (await scrypt(pass, salt)).toString('hex') : null;
    if (this.user(name) || this.byEmail.has(email)) return this.err(c, 'That username is taken');
    const now = Date.now();
    const k = key(name);
    const guest = c.guest && this.db.guests[c.guest];
    this.db.users[k] = { name, email, salt, hash, created: now, seen: now, av: Math.floor(Math.random() * E.FREE_AVATARS), tro: 0, best: 0, wins: 0, played: 0, streak: 0, lv: 1, friends: [], reqIn: [], reqOut: [], claimed: [], tokens: [] };
    if (guest && guest.w) { this.db.users[k].w = guest.w; delete this.db.guests[c.guest]; }
    this.byEmail.set(email, k);
    c.newEmail = null;
    this.attach(c, k, this.addToken(k));
  }

  // sign up in one go: an email (one account per email), a password and a username. When the server can
  // send emails, a code goes to the address first and the account is made once it's typed in.
  async signup(c, m) {
    if (this.slowDown(c)) return;
    const email = String(m.email || '').trim().toLowerCase(), name = String(m.name || '').trim(), pass = String(m.pass || '');
    if (email.length > 254 || !EMAIL_RE.test(email)) return this.err(c, "That doesn't look like an email address");
    if (this.byEmail.has(email)) return this.err(c, 'That email already has an account. Log in instead.');
    if (pass.length < 6 || pass.length > 72) return this.err(c, 'Passwords need 6 to 72 characters');
    if (!NAME_RE.test(name)) return this.err(c, 'Usernames are 3-16 letters, numbers or _');
    if (BLOCKED.some((b) => key(name).includes(b)) || filter.isBad(name)) return this.err(c, 'Please pick a different username');
    if (key(name) === email.split('@')[0]) return this.err(c, "Pick a username that isn't your email");
    if (pass.toLowerCase() === key(name) || pass.toLowerCase() === email) return this.err(c, "Your password can't be your username or email");
    if (this.user(name)) return this.err(c, 'That username is taken');
    const now = Date.now();
    if ((this.regByIp.get(c.ip) || []).filter((x) => now - x < 3600000).length >= SIGNUPS_PER_HOUR) return this.err(c, 'Too many new accounts from your network. Try again later.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(pass, salt)).toString('hex');
    if (mailer.ready) { c.pendingSignup = { email, name, salt, hash }; return this.emailStart(c, { email, purpose: 'signup' }); }
    this.createAccount(c, { email, name, salt, hash });
  }
  // a new account (and this device's guest wallet comes along)
  createAccount(c, { email, name, salt, hash }) {
    if (this.user(name)) return this.err(c, 'That username is taken');
    if (email && this.byEmail.has(email)) return this.err(c, 'That email already has an account. Log in instead.');
    const now = Date.now();
    this.regByIp.set(c.ip, (this.regByIp.get(c.ip) || []).filter((x) => now - x < 3600000).concat(now));
    const k = key(name);
    const guest = c.guest && this.db.guests[c.guest];
    this.db.users[k] = { name, email: email || undefined, salt, hash, created: now, seen: now, av: Math.floor(Math.random() * E.FREE_AVATARS), tro: 0, best: 0, wins: 0, played: 0, streak: 0, lv: 1, friends: [], reqIn: [], reqOut: [], claimed: [], tokens: [] };
    if (guest && guest.w) { this.db.users[k].w = guest.w; delete this.db.guests[c.guest]; }
    if (email) this.byEmail.set(email, k);
    this.dirty();
    this.attach(c, k, this.addToken(k));
  }

  async register(c, m) {
    if (this.slowDown(c)) return;
    const name = String(m.name || '').trim(), pass = String(m.pass || '');
    if (!NAME_RE.test(name)) return this.err(c, 'Usernames are 3-16 letters, numbers or _');
    if (BLOCKED.some((b) => key(name).includes(b)) || filter.isBad(name)) return this.err(c, 'Please pick a different username');
    if (pass.length < 6 || pass.length > 72) return this.err(c, 'Passwords need 6 to 72 characters');
    if (pass.toLowerCase() === key(name)) return this.err(c, "Your password can't be your username");
    if (this.user(name)) return this.err(c, 'That username is taken');
    const now = Date.now();
    const recent = (this.regByIp.get(c.ip) || []).filter((x) => now - x < 3600000);
    if (recent.length >= SIGNUPS_PER_HOUR) return this.err(c, 'Too many new accounts from your network. Try again later.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(pass, salt)).toString('hex');
    if (this.user(name)) return this.err(c, 'That username is taken'); // someone was faster during the hash
    recent.push(now);
    this.regByIp.set(c.ip, recent);
    const k = key(name);
    const guest = c.guest && this.db.guests[c.guest];
    this.db.users[k] = { name, salt, hash, created: now, seen: now, av: Math.floor(Math.random() * E.FREE_AVATARS), tro: 0, best: 0, wins: 0, played: 0, streak: 0, lv: 1, friends: [], reqIn: [], reqOut: [], claimed: [], tokens: [] };
    if (guest && guest.w) { this.db.users[k].w = guest.w; delete this.db.guests[c.guest]; }
    this.attach(c, k, this.addToken(k));
  }
  async login(c, m) {
    const id = String(m.name || '').trim().toLowerCase();
    if (this.slowDown(c) || this.locked(c, id)) return;
    const u = id.includes('@') ? this.db.users[this.byEmail.get(id)] || null : this.user(id);
    const pass = String(m.pass || '');
    // same work and same message whether or not the name exists, so names can't be probed
    const hash = (await scrypt(pass.slice(0, 72), u && u.salt ? u.salt : 'nobody')).toString('hex');
    if (!u || !u.hash || !same(hash, u.hash)) { this.failed(c, id); return this.err(c, id.includes('@') ? 'Wrong email or password' : 'Wrong username or password'); }
    this.attach(c, key(u.name), this.addToken(key(u.name)));
  }
  auth(c, m) {
    const k = this.byToken.get(sha(String(m.token || '')));
    if (!k || !this.db.users[k]) return this.send(c, { t: 'acctOut', reason: 'Please log in again' });
    this.attach(c, k, String(m.token));
  }
  // tokens are per device: the client forgets its own (other devices stay logged in)
  logout(c) {
    this.detach(c);
    this.send(c, { t: 'acctOut' });
  }
  async changePass(c, m) {
    const u = this.me(c);
    if (!u || this.slowDown(c) || this.locked(c, u.name)) return;
    if (!u.hash) return this.err(c, 'This account logs in with its email, so it has no password');
    const old = (await scrypt(String(m.old || '').slice(0, 72), u.salt)).toString('hex');
    if (!same(old, u.hash)) { this.failed(c, u.name); return this.err(c, 'Your current password is wrong'); }
    const pass = String(m.pass || '');
    if (pass.length < 6 || pass.length > 72) return this.err(c, 'Passwords need 6 to 72 characters');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = (await scrypt(pass, u.salt)).toString('hex');
    // every other device is signed out; this one gets a fresh token
    for (const t of u.tokens || []) this.byToken.delete(t);
    u.tokens = [];
    const token = this.addToken(c.user);
    this.dirty();
    this.send(c, { t: 'acctPassOk', token });
  }
  async remove(c, m) {
    const u = this.me(c);
    if (!u || this.slowDown(c) || this.locked(c, u.name)) return;
    if (!u.hash) { if (String(m.pass || '') !== u.name) return this.err(c, 'Type your username to confirm'); }
    else {
      const h = (await scrypt(String(m.pass || '').slice(0, 72), u.salt)).toString('hex');
      if (!same(h, u.hash)) { this.failed(c, u.name); return this.err(c, 'Wrong password'); }
    }
    const k = c.user;
    if (!this.db.users[k]) return; // deleted meanwhile (two delete requests at once)
    this.detach(c);
    for (const f of u.friends.concat(u.reqIn, u.reqOut)) {
      const o = this.db.users[f];
      if (!o) continue;
      for (const list of ['friends', 'reqIn', 'reqOut']) o[list] = o[list].filter((x) => x !== k);
      const oc = this.online.get(f);
      if (oc) this.sendFriends(oc);
    }
    for (const t of u.tokens || []) this.byToken.delete(t);
    if (u.club) this.dropMember(u.club, k);
    if (u.email) this.byEmail.delete(u.email);
    delete this.db.users[k];
    if (this.pics) this.pics.drop('u', k);
    if (this.gallery) this.gallery.dropUser(k);
    this.dirty();
    this.send(c, { t: 'acctOut', reason: 'Account deleted' });
  }

  // A logged-in player picks a new username (once a week; only changing capital letters is always fine). Accounts are
  // stored under their lowercase name, so everything that remembers a player by name moves over: the account, other
  // players' friends / requests / blocked lists and unread counts, clubs, private messages and club chat, logins, the
  // online list, the party and the profile picture.
  rename(c, m) {
    const u = this.me(c);
    if (!u) return this.err(c, 'Log in to change your username');
    if (this.slowDown(c)) return;
    const name = String(m.name || '').trim();
    if (!NAME_RE.test(name)) return this.err(c, 'Usernames are 3-16 letters, numbers or _');
    if (name === u.name) return this.err(c, 'That is already your username');
    if (BLOCKED.some((b) => key(name).includes(b)) || filter.isBad(name)) return this.err(c, 'Please pick a different username');
    const ok = c.user, nk = key(name);
    if (nk !== ok) {
      if (this.db.users[nk]) return this.err(c, 'That username is taken');
      const wait = (u.renamedAt || 0) + RENAME_GAP - Date.now();
      if (wait > 0) return this.err(c, `You can change your username again in ${Math.ceil(wait / 86400000)} day${wait > 86400000 ? 's' : ''}`);
      const old = u.name;
      const swap = (list) => (Array.isArray(list) ? list.map((x) => (x === ok ? nk : x)) : list);
      this.db.users[nk] = u;
      delete this.db.users[ok];
      for (const o of Object.values(this.db.users)) {
        for (const f of ['friends', 'reqIn', 'reqOut', 'blocked']) if (o[f]) o[f] = swap(o[f]);
        if (o.unread && o.unread[old] !== undefined) { o.unread[name] = o.unread[old]; delete o.unread[old]; }
      }
      for (const club of Object.values(this.db.clubs || {})) {
        club.members = swap(club.members);
        if (club.owner === ok) club.owner = nk;
      }
      const relabel = (list) => (Array.isArray(list) ? list.map((x) => (x && key(x.f) === ok ? Object.assign({}, x, { f: name }) : x)) : list);
      for (const p of Object.keys(this.db.dms || {})) {
        const ks = p.split('|');
        if (!ks.includes(ok)) continue;
        const np = ks.map((x) => (x === ok ? nk : x)).sort().join('|');
        this.db.dms[np] = relabel(this.db.dms[p]);
        delete this.db.dms[p];
      }
      for (const id of Object.keys(this.db.clubChat || {})) this.db.clubChat[id] = relabel(this.db.clubChat[id]);
      for (const [t, k] of this.byToken) if (k === ok) this.byToken.set(t, nk);
      if (u.email) this.byEmail.set(u.email, nk);
      if (this.online.get(ok)) { this.online.set(nk, this.online.get(ok)); this.online.delete(ok); }
      const pid = this.partyOf.get(ok);
      if (pid) {
        this.partyOf.delete(ok);
        this.partyOf.set(nk, pid);
        const p = this.parties.get(pid);
        if (p) { p.members = swap(p.members); if (p.leader === ok) p.leader = nk; }
      }
      if (this.pics) this.pics.move('u', ok, nk);
      if (this.gallery) this.gallery.renamed(ok, nk, name);
      c.user = nk;
      u.renamedAt = Date.now();
    }
    u.name = name;
    c.name = name;
    if (this.gallery) this.gallery.renamed(c.user, c.user, name); // shared mechs show the new spelling
    this.dirty();
    this.send(c, { t: 'acctMe', me: this.publicCard(u) });
    this.send(c, { t: 'note', kind: 'info', msg: `✏ You're now ${name}` });
    this.friendsChanged(nk);
    if (this.partyOf.has(nk)) this.sendParty(nk);
    const club = this.clubOf(u);
    if (club) this.clubChanged(club);
  }

  // ---------------- cloud save + profile ----------------
  saveData(c, m) {
    const u = this.me(c);
    if (!u) return;
    const s = JSON.stringify(m.data || null);
    if (s.length > MAX_SAVE) return this.err(c, 'Your save is too big to back up');
    const w = this.wallet(u);
    // a brand-new account takes the guest progress from this device once (coins capped)
    const fresh = w.imp === false;
    if (fresh) { this.importGuest(w, m.data && m.data.profile); w.imp = true; }
    u.save = this.withWallet(u, { at: Date.now(), data: m.data });
    u.lv = E.levelOf(w.xp);
    this.dirty();
    this.send(c, { t: 'saved', at: u.save.at });
    if (fresh) this.sendWallet(c, u);
  }
  setProfile(c, m) {
    const u = this.me(c);
    if (!u) return;
    if (m.av !== undefined) {
      const av = Math.max(0, Math.min(AVATARS - 1, m.av | 0));
      if (av < E.FREE_AVATARS || this.wallet(u).owned.avatars.includes('av' + av)) u.av = av; // premium ones must be owned
    }
    u.lv = E.levelOf(this.wallet(u).xp);
    this.dirty();
    this.send(c, { t: 'acctMe', me: this.publicCard(u) });
    this.friendsChanged(c.user);
  }
  showProfile(c, m) {
    const u = this.user(m.name);
    if (!u) return this.err(c, 'No player with that name');
    const card = this.publicCard(u);
    card.created = u.created;
    card.online = this.online.has(key(u.name));
    card.rank = this.rankOf(u);
    this.send(c, { t: 'profile', p: card });
  }

  // ---------------- friends ----------------
  friendView(k) {
    const u = this.db.users[k];
    if (!u) return null;
    const oc = this.online.get(k);
    const v = this.publicCard(u);
    v.on = !!oc;
    if (oc) {
      v.st = this.status(oc);
      const room = oc.room && this.h.rooms.get(oc.room);
      // friends can hop into your room while it's waiting in the lobby
      if (room && room.state === 'lobby' && room.players.size < this.h.maxPlayers) v.room = room.code;
      if (room && room.state === 'playing' && room.phase === 'match') v.watch = true; // friends can watch
    }
    v.party = this.partyOf.get(k) || null;
    if (oc && oc.showBp) v.bp = oc.showBp;
    return v;
  }
  // the mech a party member has out (shown next to yours in the lobby): only real parts on the grid
  partyMech(c, m) {
    if (!c.user || !m.bp || !Array.isArray(m.bp.parts)) return;
    const G = E.GRID;
    const parts = m.bp.parts.slice(0, E.MAX_PARTS).filter((p) => p && Object.prototype.hasOwnProperty.call(E.PARTS, p.t)).map((p) => ({ t: p.t, x: p.x | 0, y: p.y | 0, z: p.z | 0 }))
      .filter((p) => p.x >= G.minX && p.x <= G.maxX && p.y >= G.minY && p.y <= G.maxY && p.z >= G.minZ && p.z <= G.maxZ);
    if (!parts.length) return;
    c.showBp = { color: m.bp.color & 0xffffff, parts };
    if (this.partyOf.has(c.user)) this.sendParty(c.user);
  }
  sendFriends(c) {
    const u = this.me(c);
    if (!u) return;
    const list = u.friends.map((k) => this.friendView(k)).filter(Boolean);
    const name = (k) => (this.db.users[k] ? this.db.users[k].name : k);
    this.send(c, { t: 'friends', list, reqIn: u.reqIn.map(name), reqOut: u.reqOut.map(name) });
  }
  // tell every online friend of k that k's state changed
  friendsChanged(k) {
    const u = this.db.users[k];
    if (!u) return;
    for (const f of u.friends) { const oc = this.online.get(f); if (oc) this.sendFriends(oc); }
  }
  friendAdd(c, m) {
    const u = this.me(c);
    if (!u) return this.err(c, 'Log in to add friends');
    const o = this.user(m.name);
    if (!o) return this.err(c, 'No player with that name');
    const k = c.user, ok = key(o.name);
    if (ok === k) return this.err(c, "That's you!");
    if (u.friends.includes(ok)) return this.err(c, `${o.name} is already your friend`);
    if (u.friends.length >= MAX_FRIENDS) return this.err(c, `You can have up to ${MAX_FRIENDS} friends`);
    if (u.reqIn.includes(ok)) return this.friendAccept(c, { name: o.name }); // they already asked you
    if (u.reqOut.includes(ok)) return this.err(c, 'Request already sent');
    if (o.reqIn.length >= 50) return this.err(c, `${o.name} has too many requests right now`);
    u.reqOut.push(ok);
    o.reqIn.push(k);
    this.dirty();
    this.sendFriends(c);
    const oc = this.online.get(ok);
    if (oc) { this.sendFriends(oc); this.send(oc, { t: 'note', kind: 'friendReq', from: u.name }); }
    this.send(c, { t: 'note', kind: 'info', msg: `Friend request sent to ${o.name}` });
  }
  friendAccept(c, m) {
    const u = this.me(c);
    const o = this.user(m.name);
    if (!u || !o) return;
    const k = c.user, ok = key(o.name);
    if (!u.reqIn.includes(ok)) return;
    u.reqIn = u.reqIn.filter((x) => x !== ok);
    o.reqOut = o.reqOut.filter((x) => x !== k);
    if (!u.friends.includes(ok)) u.friends.push(ok);
    if (!o.friends.includes(k)) o.friends.push(k);
    this.dirty();
    this.sendFriends(c);
    const oc = this.online.get(ok);
    if (oc) { this.sendFriends(oc); this.send(oc, { t: 'note', kind: 'info', msg: `${u.name} accepted your friend request!` }); }
  }
  friendDecline(c, m) {
    const u = this.me(c);
    const o = this.user(m.name);
    if (!u || !o) return;
    const k = c.user, ok = key(o.name);
    u.reqIn = u.reqIn.filter((x) => x !== ok);
    u.reqOut = u.reqOut.filter((x) => x !== ok); // also cancels a request you sent
    o.reqOut = o.reqOut.filter((x) => x !== k);
    o.reqIn = o.reqIn.filter((x) => x !== k);
    this.dirty();
    this.sendFriends(c);
    const oc = this.online.get(ok);
    if (oc) this.sendFriends(oc);
  }
  friendRemove(c, m) {
    const u = this.me(c);
    const o = this.user(m.name);
    if (!u || !o) return;
    const k = c.user, ok = key(o.name);
    u.friends = u.friends.filter((x) => x !== ok);
    o.friends = o.friends.filter((x) => x !== k);
    this.dirty();
    this.sendFriends(c);
    const oc = this.online.get(ok);
    if (oc) this.sendFriends(oc);
  }
  inviteRoom(c, m) {
    const u = this.me(c);
    const o = this.user(m.name);
    const room = c.room && this.h.rooms.get(c.room);
    if (!u || !o || !room) return;
    if (!u.friends.includes(key(o.name))) return this.err(c, 'You can only invite friends');
    const oc = this.online.get(key(o.name));
    if (!oc) return this.err(c, `${o.name} is offline`);
    this.send(oc, { t: 'note', kind: 'roomInvite', from: u.name, code: room.code });
    this.send(c, { t: 'note', kind: 'info', msg: `Invite sent to ${o.name}` });
  }

  // ---------------- parties ----------------
  party(k) { const id = this.partyOf.get(k); return id ? this.parties.get(id) : null; }
  sendParty(k) {
    const p = this.party(k);
    const view = p ? { id: p.id, leader: this.db.users[p.leader].name, members: p.members.map((x) => this.friendView(x)).filter(Boolean) } : null;
    // each member also gets the party chat they may read
    for (const x of p ? p.members : [k]) { const oc = this.online.get(x); if (oc) this.send(oc, { t: 'party', party: view && Object.assign({ log: this.talk ? this.talk.partyLines(oc) : [] }, view) }); }
  }
  partyInvite(c, m) {
    const u = this.me(c);
    if (!u) return this.err(c, 'Log in to make a party');
    const o = this.user(m.name);
    if (!o || !u.friends.includes(key(o.name))) return this.err(c, 'You can only invite friends to your party');
    const oc = this.online.get(key(o.name));
    if (!oc) return this.err(c, `${o.name} is offline`);
    const p = this.party(c.user);
    if (p && p.members.length >= PARTY_MAX) return this.err(c, `Parties have up to ${PARTY_MAX} players`);
    if (p && p.members.includes(key(o.name))) return this.err(c, `${o.name} is already in your party`);
    oc.partyInv = oc.partyInv || new Map();
    oc.partyInv.set(c.user, Date.now());
    this.send(oc, { t: 'note', kind: 'partyInvite', from: u.name });
    this.send(c, { t: 'note', kind: 'info', msg: `Party invite sent to ${o.name}` });
  }
  partyAccept(c, m) {
    const u = this.me(c);
    if (!u) return;
    const from = key(m.from);
    const at = c.partyInv && c.partyInv.get(from);
    if (!at || Date.now() - at > 5 * 60000) return this.err(c, 'That invite expired');
    c.partyInv.delete(from);
    if (!this.online.has(from)) return this.err(c, `${m.from} went offline`);
    let p = this.party(from);
    if (!p) {
      p = { id: crypto.randomBytes(6).toString('hex'), leader: from, members: [from] };
      this.parties.set(p.id, p);
      this.partyOf.set(from, p.id);
    }
    if (p.members.includes(c.user)) return;
    if (p.members.length >= PARTY_MAX) return this.err(c, 'That party is full');
    this.leaveParty(c.user);
    p.members.push(c.user);
    this.partyOf.set(c.user, p.id);
    this.sendParty(c.user);
    for (const x of p.members) this.friendsChanged(x);
    // join the leader if they're waiting in a room
    const lc = this.online.get(p.leader);
    const room = lc && lc.room && this.h.rooms.get(lc.room);
    if (room && room.state === 'lobby' && c.room !== room.code) this.h.joinRoom(c, room);
  }
  leaveParty(k) {
    const p = this.party(k);
    if (!p) return;
    p.members = p.members.filter((x) => x !== k);
    this.partyOf.delete(k);
    const oc = this.online.get(k);
    if (oc) this.send(oc, { t: 'party', party: null });
    if (p.members.length <= 1) {
      // a party of one isn't a party
      for (const x of p.members) { this.partyOf.delete(x); const xc = this.online.get(x); if (xc) this.send(xc, { t: 'party', party: null }); }
      this.parties.delete(p.id);
      if (this.talk) this.talk.partyLog.delete(p.id);
    } else {
      if (p.leader === k) p.leader = p.members[0];
      this.sendParty(p.members[0]);
    }
    this.friendsChanged(k);
  }
  partyKick(c, m) {
    const p = c.user && this.party(c.user);
    if (!p || p.leader !== c.user) return;
    const k = key(m.name);
    if (k === c.user || !p.members.includes(k)) return;
    this.leaveParty(k);
    const kc = this.online.get(k);
    if (kc) this.send(kc, { t: 'note', kind: 'info', msg: 'You were removed from the party' });
  }
  // party members who'd come along when the leader joins a room (online, not busy elsewhere)
  followers(c) {
    const p = c.user && this.party(c.user);
    if (!p || p.leader !== c.user) return [];
    return p.members.filter((k) => k !== c.user).map((k) => this.online.get(k)).filter((oc) => {
      if (!oc || oc.busy) return false;
      const r = oc.room && this.h.rooms.get(oc.room);
      return !(r && r.state === 'playing');
    });
  }
  // the leader went into a room: bring the party along
  afterJoin(c, room) {
    for (const oc of this.followers(c)) {
      if (oc.room === room.code || room.players.size >= this.h.maxPlayers) continue;
      this.h.joinRoom(oc, room);
    }
  }
  roomChanged(c) { if (c.user) this.friendsChanged(c.user); }

  // ======================= clubs =======================
  clubOf(u) { return u && u.club ? this.db.clubs[u.club] || null : null; }
  clubTro(club) { return club.members.reduce((s, k) => s + ((this.db.users[k] && this.db.users[k].tro) | 0), 0); }
  clubCard(club) {
    return { id: club.id, name: club.name, badge: club.badge | 0, pv: club.pv | 0, desc: club.desc, open: club.open, minTro: club.minTro | 0, members: club.members.length, tro: this.clubTro(club) };
  }
  // viewer: the member looking (their club wall leaves out what they may not read); none = a visitor
  clubView(club, viewer) {
    const v = this.clubCard(club);
    v.list = club.members.map((k) => {
      const u = this.db.users[k];
      return u && { name: u.name, av: u.av | 0, pv: u.pv | 0, tro: u.tro | 0, on: this.online.has(k), role: k === club.owner ? 'owner' : 'member' };
    }).filter(Boolean).sort((a, b) => b.tro - a.tro);
    const me = viewer && this.db.users[viewer];
    v.log = me && club.members.includes(viewer) && this.talk ? this.talk.readable(this.clubLog.get(club.id) || [], me) : [];
    return v;
  }
  // tell every online member what their club looks like now
  clubChanged(club) {
    for (const k of club.members) { const oc = this.online.get(k); if (oc) this.send(oc, { t: 'club', club: this.clubView(club, k) }); }
  }
  clubInfo(c, m) {
    const u = this.me(c);
    if (!u) return;
    if (m && m.id) {
      const club = this.db.clubs[String(m.id)];
      return club ? this.send(c, { t: 'clubPeek', club: this.clubView(club) }) : this.err(c, 'That club is gone');
    }
    const club = this.clubOf(u);
    this.send(c, { t: 'club', club: club ? this.clubView(club, c.user) : null });
  }
  clubList(c, m) {
    const q = String((m && m.q) || '').toLowerCase().slice(0, 20);
    const list = Object.values(this.db.clubs).filter((cl) => !q || cl.name.toLowerCase().includes(q)).map((cl) => this.clubCard(cl))
      .sort((a, b) => b.tro - a.tro).slice(0, 40);
    this.send(c, { t: 'clubs', list, q });
  }
  clubFields(m) {
    return {
      badge: Math.max(0, Math.min(CLUB_BADGES - 1, m.badge | 0)),
      desc: filter.clean(String(m.desc || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)),
      open: m.open !== false,
      minTro: Math.max(0, Math.min(10000, Math.round((m.minTro | 0) / 50) * 50)),
    };
  }
  clubCreate(c, m) {
    const u = this.me(c);
    if (!u) return;
    if (this.clubOf(u)) return this.err(c, 'Leave your club first');
    const name = String(m.name || '').replace(/\s+/g, ' ').trim();
    if (!CLUB_RE.test(name)) return this.err(c, 'Club names are 3-20 letters, numbers, spaces, _ or -');
    if (BLOCKED.some((b) => name.toLowerCase().replace(/[ _-]/g, '').includes(b)) || filter.isBad(name)) return this.err(c, 'Please pick a different club name');
    if (Object.values(this.db.clubs).some((cl) => cl.name.toLowerCase() === name.toLowerCase())) return this.err(c, 'That club name is taken');
    const id = crypto.randomBytes(5).toString('hex');
    const club = Object.assign({ id, name, owner: c.user, members: [c.user], created: Date.now() }, this.clubFields(m));
    this.db.clubs[id] = club;
    u.club = id;
    this.dirty();
    this.clubChanged(club);
    this.friendsChanged(c.user);
  }
  clubEdit(c, m) {
    const u = this.me(c), club = this.clubOf(u);
    if (!club || club.owner !== c.user) return;
    if ((u.muteUntil || 0) > Date.now()) return this.err(c, "A moderator turned off your typed chat for a while, so the club's description can't change now");
    Object.assign(club, this.clubFields(m));
    this.dirty();
    this.clubChanged(club);
  }
  clubJoin(c, m) {
    const u = this.me(c);
    if (!u) return;
    if (this.clubOf(u)) return this.err(c, 'Leave your club first');
    const club = this.db.clubs[String(m.id || '')];
    if (!club) return this.err(c, 'That club is gone');
    if (!club.open) return this.err(c, 'That club is closed right now');
    if (club.members.length >= CLUB_MAX) return this.err(c, 'That club is full');
    if ((u.tro | 0) < (club.minTro | 0)) return this.err(c, `You need ${club.minTro} trophies to join`);
    club.members.push(c.user);
    u.club = club.id;
    this.dirty();
    this.clubNote(club, `👋 ${u.name} joined the club`);
    this.clubChanged(club);
    this.friendsChanged(c.user);
  }
  dropMember(id, k) {
    const club = this.db.clubs[id];
    const u = this.db.users[k];
    if (u) u.club = null;
    if (!club) return;
    club.members = club.members.filter((x) => x !== k);
    if (!club.members.length) { delete this.db.clubs[id]; this.clubLog.delete(id); if (this.pics) this.pics.drop('c', id); this.dirty(); return; }
    // the club gets a new owner: whoever has the most trophies
    if (club.owner === k) club.owner = club.members.slice().sort((a, b) => ((this.db.users[b] || {}).tro | 0) - ((this.db.users[a] || {}).tro | 0))[0];
    this.dirty();
    this.clubChanged(club);
  }
  clubLeave(c) {
    const u = this.me(c), club = this.clubOf(u);
    if (!club) return;
    this.clubNote(club, `🚪 ${u.name} left the club`);
    this.dropMember(club.id, c.user);
    this.send(c, { t: 'club', club: null });
    this.friendsChanged(c.user);
  }
  clubKick(c, m) {
    const u = this.me(c), club = this.clubOf(u);
    const k = key(m.name);
    if (!club || club.owner !== c.user || k === c.user || !club.members.includes(k)) return;
    this.clubNote(club, `✖ ${this.db.users[k].name} was removed`);
    this.dropMember(club.id, k);
    const oc = this.online.get(k);
    if (oc) { this.send(oc, { t: 'club', club: null }); this.send(oc, { t: 'note', kind: 'info', msg: `You were removed from ${club.name}` }); }
  }
  // a line from the game on the club wall (joined, left, removed); players' lines: server/talk.js clubSay
  clubNote(club, text) {
    this.clubLog.set(club.id, (this.clubLog.get(club.id) || []).concat({ f: null, s: text, at: Date.now() }).slice(-40));
  }
  clubChat() {} // old games' quick-chat wall (now in the chat)

  // ======================= wallet: coins, XP and unlocks (the server's copy is the real one) =======================
  // Every player has one: accounts in db.users, guests in db.guests (a device token, no password).
  // The game only shows the wallet and asks: it reports what a match paid (capped), the server sets every price.
  wallet(u) {
    if (!u.w) {
      const had = !!(u.save && u.save.data);
      u.w = { coins: 0, xp: 0, owned: { paints: [], trails: ['spark'], avatars: [] }, gift: { day: '', streak: 0 }, earn: { day: '', total: 0, ads: 0, off: 0, offXp: 0, last: 0 }, ch: { day: '', got: [] }, ach: [], road: (u.claimed || []).filter(Number.isInteger), pass: null, imp: had };
      // accounts from before the server kept coins: their last backup counts once
      if (had) this.importGuest(u.w, u.save.data.profile, 50000, 200000);
    }
    const w = u.w;
    for (const k of ['finishes', 'wrecks']) if (!Array.isArray(w.owned[k])) w.owned[k] = []; // added in v1.8.2
    if (w.xp === undefined) w.xp = Math.min(200000, Math.max(0, Math.floor(+(u.save && u.save.data && u.save.data.profile && u.save.data.profile.xp) || 0)));
    if (!w.ch) w.ch = { day: '', got: [] };
    const s = E.season().id;
    if (!w.pass || w.pass.s !== s) w.pass = { s, pts: 0, claimed: [] };
    const d = E.day();
    if (w.earn.day !== d) w.earn = { day: d, total: 0, ads: 0, off: 0, offXp: 0, last: w.earn.last || 0 };
    for (const f of ['total', 'ads', 'off', 'offXp', 'last']) if (!Number.isFinite(w.earn[f])) w.earn[f] = 0; // wallets from older versions
    if (!Number.isFinite(w.coins)) w.coins = 0;
    if (w.ch.day !== d) w.ch = { day: d, got: [] };
    return w;
  }
  // progress from before this device had a server wallet: counts once, worth at most `cap` coins in total
  // (coins plus the price of the items), so editing the device's save can't buy anything
  importGuest(w, p, cap = 3000, xpCap = 50000) {
    if (!p || typeof p !== 'object') return;
    const own = p.owned || {};
    let left = Math.max(0, cap - w.coins);
    const items = [];
    for (const kind of ['paints', 'trails', 'avatars']) {
      for (const id of Array.isArray(own[kind]) ? own[kind] : []) {
        const it = E.item(kind, id);
        if (it && !it.pass && !w.owned[kind].includes(id)) items.push({ kind, it });
      }
    }
    items.sort((a, b) => a.it.price - b.it.price);
    for (const { kind, it } of items) if (it.price <= left) { w.owned[kind].push(it.id); left -= it.price; }
    w.coins += Math.min(left, Math.max(0, Math.floor(+p.coins || 0)));
    w.xp = Math.max(w.xp || 0, Math.min(xpCap, Math.max(0, Math.floor(+p.xp || 0))));
    if (Array.isArray(p.road)) w.road = [...new Set(w.road.concat(p.road.filter((at) => Number.isInteger(at) && E.ROAD.some((r) => r.at === at))))];
  }
  walletView(u) {
    const w = this.wallet(u);
    const ev = eventNow();
    return { coins: w.coins, xp: w.xp, owned: w.owned, gift: w.gift, road: w.road, pass: w.pass, ch: w.ch.got, ach: w.ach, season: E.season(), fresh: w.imp === false,
      ev: ev ? (w.ev && w.ev.k === ev.key ? { k: w.ev.k, pts: w.ev.pts, claimed: w.ev.claimed } : { k: ev.key, pts: 0, claimed: [] }) : null };
  }
  // the backup stored with the account carries the server's coins, XP and unlocks, never the device's
  withWallet(u, save) {
    if (!save || !save.data || !save.data.profile || typeof save.data.profile !== 'object') return save;
    const w = this.wallet(u);
    Object.assign(save.data.profile, { coins: w.coins, xp: w.xp, owned: w.owned, road: w.road, dailyClaimed: w.gift.day, dailyStreak: w.gift.streak });
    return save;
  }
  // whose wallet this connection uses: the account, or the device's guest record
  owner(c) { return c.user ? this.db.users[c.user] || null : c.guest ? this.db.guests[c.guest] || null : null; }
  level(c) { const o = this.owner(c); return o ? E.levelOf(this.wallet(o).xp) : 1; }
  sendWallet(c, u, extra) { this.dirty(); this.send(c, Object.assign({ t: 'wallet', w: this.walletView(u) }, extra || {})); }
  // a device without an account: its token picks its guest record (a new device gets one)
  guestHello(c, m) {
    if (c.user) return;
    const token = typeof m.token === 'string' && /^[0-9a-f]{64}$/.test(m.token) ? m.token : null;
    let k = token && sha(token);
    let g = k && this.db.guests[k];
    let fresh = null;
    if (!g) {
      const now = Date.now();
      const recent = (this.guestByIp.get(c.ip) || []).filter((x) => now - x < 3600000);
      if (recent.length >= 30) return this.err(c, 'Too many new players from your network. Try again later.');
      this.guestByIp.set(c.ip, recent.concat(now));
      fresh = crypto.randomBytes(32).toString('hex');
      k = sha(fresh);
      g = this.db.guests[k] = { created: now, seen: now };
      this.wallet(g);
      this.importGuest(g.w, m.profile); // what this device earned before guests had a server wallet
      g.w.imp = true;
    }
    g.seen = Date.now();
    c.guest = k;
    this.dirty();
    this.send(c, { t: 'guestOk', token: fresh, wallet: this.walletView(g) });
  }
  // give a reward ({ coins, paint/paints, trail/trails, avatar/avatars }); things you already own pay their price
  grant(w, r) {
    let coins = r.coins | 0;
    const got = [];
    for (const [one, kind] of [['paint', 'paints'], ['trail', 'trails'], ['avatar', 'avatars'], ['wreck', 'wrecks'], ['finish', 'finishes']]) {
      const id = r[one] || r[kind];
      if (!id) continue;
      const it = E.item(kind, id);
      if (!it) continue;
      if (w.owned[kind].includes(id)) coins += it.price;
      else { w.owned[kind].push(id); got.push({ kind, id }); }
    }
    w.coins += coins;
    return { coins, got };
  }
  // the game reports what it paid out; the server decides how much of it counts
  earn(c, m) {
    const u = this.owner(c);
    if (!u) return;
    const w = this.wallet(u);
    const src = String(m.src || '');
    const now = Date.now();
    let n = 0, xp = 0, pts = 0;
    const ask = Math.max(0, Math.floor(+m.n || 0));
    if (src === 'match') {
      // one match at a time: a match reward can't be bigger than what that much playing time can earn
      const gap = (now - (w.earn.last || 0)) / 1000;
      if (gap >= (+process.env.MATCH_GAP_SECS || E.MATCH_GAP)) { // MATCH_GAP_SECS: only for tests
        n = Math.min(ask, E.EARN.match, 60 + gap * 8);
        xp = Math.min(Math.max(0, Math.floor(+m.xp || 0)), 1500, 60 + gap * 10);
        pts = Math.max(0, Math.min(E.PASS.match, m.pp | 0));
        w.earn.last = now;
        w.earn.after = n; // a results crate and an ad doubling may follow this match, once
        w.earn.crate = true;
      }
    } else if (src === 'chest') {
      if (w.earn.crate) { n = Math.min(ask, E.EARN.chest); w.earn.crate = false; }
    } else if (src === 'ad') {
      if (w.earn.after && w.earn.ads < 15) { n = Math.min(ask, w.earn.after); w.earn.after = 0; w.earn.ads++; }
    } else if (src === 'challenge') {
      // today's challenges are the same for everyone (js/economy.js); each pays its listed reward once
      const i = m.key | 0, ch = E.dailyChallenges(E.day())[i];
      if (ch && !w.ch.got.includes(i)) { w.ch.got.push(i); n = ch.reward; pts = E.PASS.challenge; }
    } else if (src === 'ach') {
      const id = String(m.key || '');
      if (Object.prototype.hasOwnProperty.call(E.ACH, id) && !w.ach.includes(id)) { w.ach.push(id); n = E.ACH[id]; }
    } else if (src === 'offline') {
      // matches played without a connection: a little, once it's back
      n = Math.min(ask, Math.max(0, 1500 - w.earn.off));
      xp = Math.min(Math.max(0, Math.floor(+m.xp || 0)), Math.max(0, 3000 - w.earn.offXp));
      w.earn.off += n;
      w.earn.offXp += xp;
    } else return;
    // seasonal event points (the same match / challenge rules as above, so they can't be farmed faster)
    const ev = eventNow();
    let evPts = 0;
    if (ev && ((src === 'match' && pts > 0) || (src === 'challenge' && pts > 0))) {
      if (!w.ev || w.ev.k !== ev.key) w.ev = { k: ev.key, pts: 0, claimed: [] };
      evPts = src === 'match' ? E.EVENT_PTS.match : E.EVENT_PTS.challenge;
      w.ev.pts += evPts;
    }
    n = Math.max(0, Math.min(Math.floor(n), E.EARN_PER_DAY - w.earn.total));
    w.coins += n;
    w.xp += Math.floor(xp);
    w.earn.total += n;
    w.pass.pts += pts;
    if (c.user) { const lv = E.levelOf(w.xp); if (u.lv !== lv) { u.lv = lv; this.friendsChanged(c.user); } }
    this.sendWallet(c, u, { earned: n, src, pts, xp: Math.floor(xp), key: m.key, evPts });
  }
  // the seasonal event track: a step's reward once its points are reached (only while that event runs)
  eventClaim(c, m) {
    const u = this.owner(c);
    if (!u) return;
    const w = this.wallet(u);
    const ev = eventNow();
    if (!ev || !w.ev || w.ev.k !== ev.key) return this.sendWallet(c, u);
    const r = E.eventRewards(ev.id)[(m.step | 0) - 1];
    if (!r || w.ev.pts < r.at || w.ev.claimed.includes(r.step)) return this.sendWallet(c, u);
    w.ev.claimed.push(r.step);
    this.sendWallet(c, u, { evStep: r.step, reward: this.grant(w, r) });
  }
  gift(c) {
    const u = this.owner(c);
    if (!u) return;
    const w = this.wallet(u);
    const d = E.day();
    if (w.gift.day === d) return this.sendWallet(c, u);
    const yesterday = E.day(Date.now() - 86400000);
    w.gift = { day: d, streak: w.gift.day === yesterday ? w.gift.streak + 1 : 1 };
    const n = E.giftAmount(w.gift.streak);
    w.coins += n;
    w.pass.pts += E.PASS.gift;
    this.sendWallet(c, u, { gift: n, pts: E.PASS.gift });
  }
  buy(c, m) {
    const u = this.owner(c);
    if (!u) return;
    const w = this.wallet(u);
    const kind = String(m.kind || ''), it = E.item(kind, String(m.id || ''));
    if (!it || it.pass || it.event || it.price <= 0) return this.err(c, "That isn't for sale");
    if (w.owned[kind].includes(it.id)) return this.sendWallet(c, u);
    const deal = E.dailyDeals(E.day(), (k, id) => w.owned[k].includes(id)).some((d) => d.kind === kind && d.it.id === it.id);
    const price = deal ? E.dealPrice(it) : it.price;
    if (w.coins < price) return this.err(c, `Need ${price - w.coins} more coins`);
    w.coins -= price;
    w.owned[kind].push(it.id);
    this.sendWallet(c, u, { bought: { kind, id: it.id, price } });
  }
  roadClaim(c, m) {
    const u = this.me(c);
    if (!u) return;
    const w = this.wallet(u);
    const r = E.ROAD.find((x) => x.at === (m.at | 0));
    if (!r || (u.best | 0) < r.at || w.road.includes(r.at)) return this.sendWallet(c, u);
    w.road.push(r.at);
    this.sendWallet(c, u, { road: r.at, reward: this.grant(w, r) });
  }
  passClaim(c, m) {
    const u = this.owner(c);
    if (!u) return;
    const w = this.wallet(u);
    const r = E.passRewards(w.pass.s)[(m.tier | 0) - 1];
    if (!r || w.pass.pts < r.at || w.pass.claimed.includes(r.tier)) return this.sendWallet(c, u);
    w.pass.claimed.push(r.tier);
    this.sendWallet(c, u, { pass: r.tier, reward: this.grant(w, r) });
  }

  // ---------------- trophies + leaderboard ----------------
  // the host's game reports placings: { clientId: place } out of n places
  matchResult(room, res, n) {
    if (!room.auto || !res || typeof res !== 'object') return;
    const secs = (Date.now() - (room.beganAt || Date.now())) / 1000;
    if (secs < QUICK_MIN_SECS) return;
    n = Math.max(2, Math.min(16, n | 0));
    const featured = FEATURED.is(room.settings.mode, room.playedArena || room.settings.arena);
    for (const [id, place] of Object.entries(res)) {
      const c = this.h.clients.get(+id);
      const pl = place | 0;
      if (!c || c.room !== room.code || !room.players.has(c.id) || pl < 1 || pl > n) continue;
      const u = this.me(c);
      if (!u) continue;
      let d = trophyDelta(pl, n, u.tro | 0, u.streak | 0);
      if (featured && d > 0) d = Math.round(d * FEATURED.TROPHY_MULT); // today's featured event
      u.tro = Math.max(0, (u.tro | 0) + d);
      u.best = Math.max(u.best | 0, u.tro);
      u.played = (u.played | 0) + 1;
      if (pl === 1) { u.wins = (u.wins | 0) + 1; u.streak = (u.streak | 0) + 1; } else u.streak = 0;
      this.send(c, { t: 'trophies', d, tro: u.tro, best: u.best, place: pl, n, streak: u.streak, featured });
      this.friendsChanged(c.user);
    }
    this.dirty();
  }
  // a host whose result was refused: nobody's trophies move, and they're picked as host less often for a week
  disputed(hostC, room, why) {
    const u = this.me(hostC);
    if (u) { const now = Date.now(); u.disputes = (u.disputes || []).filter((t) => now - t < 7 * 86400000).concat(now); this.dirty(); }
    for (const id of room.players) {
      const c = this.h.clients.get(id);
      if (c) this.send(c, { t: 'note', kind: 'info', msg: "⚠ This match's result didn't add up, so no trophies changed." });
    }
  }
  // an online friend's connection (for watching their match)
  friendClient(c, name) {
    const u = this.me(c), k = key(name);
    if (!u || !u.friends.includes(k)) return null;
    return this.online.get(k) || null;
  }
  // the referee noted this player in a match: kept on the account (for a closer look later)
  noted(c, why) {
    const u = c && this.me(c);
    if (u) { u.notes = (u.notes || []).slice(-19).concat({ at: Date.now(), why: String(why).slice(0, 80) }); this.dirty(); }
    if (c) this.send(c, { t: 'note', kind: 'info', msg: "⚠ The server noticed something odd in your game this match, so it didn't count." });
  }
  flagged(c) {
    const u = c && this.me(c);
    const now = Date.now();
    return !!u && (u.disputes || []).filter((t) => now - t < 7 * 86400000).length >= 2;
  }
  // ---------------- Weekend Cup (js/economy.js CUP): db.cups[id] = { mode, players: { key: { n, pts: [], claimed } } } ----------------
  cupNow() { return E.cup(process.env.CUP_DATE ? Date.parse(process.env.CUP_DATE) : Date.now()); } // CUP_DATE: only for tests
  cupData(id, mode) {
    if (!this.db.cups) this.db.cups = {};
    if (!this.db.cups[id] && mode) {
      this.db.cups[id] = { mode, players: {} };
      for (const old of Object.keys(this.db.cups).sort().slice(0, -4)) delete this.db.cups[old]; // the last 4 weekends are kept
    }
    return this.db.cups[id] || null;
  }
  // everyone who played, best first (ties: fewer matches, then who got there first)
  cupBoard(id) {
    const d = this.cupData(id);
    if (!d) return [];
    if (this.cupCache && this.cupCache.id === id && this.cupCache.v === d.v) return this.cupCache.list;
    const list = Object.entries(d.players).map(([k, p]) => ({ k, n: p.n, score: E.cupScore(p.pts), games: p.pts.length, at: p.at || 0 }))
      .sort((a, b) => b.score - a.score || a.games - b.games || a.at - b.at);
    this.cupCache = { id, v: d.v, list };
    return list;
  }
  cupResult(room, res, n) {
    if (!room.auto || !room.settings.cup || !res || typeof res !== 'object') return;
    if ((Date.now() - (room.beganAt || Date.now())) / 1000 < QUICK_MIN_SECS) return;
    const cu = this.cupNow();
    // a match that began during the weekend still counts if it ends a little after
    if (room.settings.cup !== cu.id || Date.now() > cu.end + 30 * 60000 || (room.beganAt || 0) > cu.end) return;
    const d = this.cupData(cu.id, cu.mode);
    for (const [id, place] of Object.entries(res)) {
      const c = this.h.clients.get(+id);
      const pl = place | 0;
      if (!c || c.room !== room.code || !room.players.has(c.id) || pl < 1 || pl > n) continue;
      const u = this.me(c);
      if (!u) continue;
      const k = key(u.name), pts = E.cupPoints(pl, n);
      const p = d.players[k] || (d.players[k] = { n: u.name, pts: [], claimed: false });
      p.n = u.name;
      if (p.pts.length >= 200) continue; // plenty
      const before = E.cupScore(p.pts);
      p.pts.push(pts);
      const score = E.cupScore(p.pts);
      if (score > before) p.at = Date.now();
      d.v = (d.v | 0) + 1;
      const rank = this.cupBoard(cu.id).findIndex((x) => x.k === k) + 1;
      this.send(c, { t: 'cupResult', pts, score, rank, games: p.pts.length, place: pl, n });
    }
    this.dirty();
  }
  // the cup screen: this weekend's board (or the last one's), your place, and rewards waiting from ended cups
  cupInfo(c) {
    const u = this.me(c), cu = this.cupNow(), k = u ? key(u.name) : null;
    const board = this.cupBoard(cu.id), d = this.cupData(cu.id);
    const mine = k ? board.findIndex((x) => x.k === k) : -1;
    const card = (x) => { const o = this.db.users[x.k]; return { name: x.n, score: x.score, games: x.games, av: o ? o.av | 0 : 0, pv: o ? o.pv | 0 : 0 }; };
    const claims = [];
    if (k) for (const [id, cd] of Object.entries(this.db.cups || {})) {
      const p = cd.players[k];
      const ended = id !== cu.id || !cu.live;
      if (!p || p.claimed || !ended) continue;
      const rank = this.cupBoard(id).findIndex((x) => x.k === k) + 1;
      claims.push({ id, mode: cd.mode, rank, games: p.pts.length, score: E.cupScore(p.pts), reward: E.cupReward(rank, p.pts.length), of: Object.keys(cd.players).length });
    }
    this.send(c, {
      t: 'cupInfo', cup: cu, total: board.length, top: board.slice(0, 50).map(card),
      me: mine >= 0 ? Object.assign(card(board[mine]), { rank: mine + 1, pts: d.players[k].pts.slice().sort((a, b) => b - a).slice(0, E.CUP.best) }) : null, claims,
    });
  }
  cupClaim(c, m) {
    const u = this.me(c);
    if (!u) return;
    const k = key(u.name), cu = this.cupNow(), id = String(m.id || ''), d = (this.db.cups || {})[id];
    const p = d && d.players[k];
    if (!p || p.claimed || (id === cu.id && cu.live)) return this.cupInfo(c);
    const rank = this.cupBoard(id).findIndex((x) => x.k === k) + 1;
    p.claimed = true;
    const w = this.wallet(u);
    const r = E.cupReward(rank, p.pts.length);
    this.sendWallet(c, u, { cupClaim: id, rank, reward: this.grant(w, r) });
    this.cupInfo(c);
  }
  // ---------------- Ranked: points per season (half of last season's carry over) ----------------
  canRanked(c) { const u = this.me(c); return !!u && (u.best | 0) >= E.RANKED.unlockAt; }
  rp(u) {
    const s = E.season().id;
    if (u.rpS !== s) { u.rp = Math.floor((u.rp | 0) / 2); u.rpS = s; }
    return u.rp | 0;
  }
  rankedResult(room, res, n) {
    if (!room.auto || !room.settings.ranked || !res || typeof res !== 'object') return;
    if ((Date.now() - (room.beganAt || Date.now())) / 1000 < QUICK_MIN_SECS) return;
    for (const [id, place] of Object.entries(res)) {
      const c = this.h.clients.get(+id);
      const pl = place | 0;
      if (!c || c.room !== room.code || !room.players.has(c.id) || pl < 1 || pl > n) continue;
      const u = this.me(c);
      if (!u) continue;
      const before = this.rp(u);
      u.rpStreak = pl === 1 ? (u.rpStreak | 0) + 1 : 0;
      const d = pl === 1 ? E.RANKED.win + Math.min(10, (u.rpStreak - 1) * 2) : Math.max(-before, E.RANKED.loss);
      u.rp = before + d;
      u.rpBest = Math.max(u.rpBest | 0, u.rp);
      u.rpPlayed = (u.rpPlayed | 0) + 1;
      this.send(c, { t: 'ranked', d, rp: u.rp, place: pl, streak: u.rpStreak, rank: E.RANKED.rank(u.rp) });
      this.friendsChanged(c.user);
    }
    this.rankedCache = null;
    this.dirty();
  }
  sorted() {
    if (!this.topCache) this.topCache = Object.values(this.db.users).sort((a, b) => (b.tro | 0) - (a.tro | 0) || (a.created || 0) - (b.created || 0));
    return this.topCache;
  }
  rankOf(u) { return this.sorted().indexOf(u) + 1; }
  top(c, m) {
    if (m && m.kind === 'ranked') {
      // this season's Ranked board
      if (!this.rankedCache) this.rankedCache = Object.values(this.db.users).filter((u) => (u.best | 0) >= E.RANKED.unlockAt && u.rpS === E.season().id && (u.rpPlayed | 0) > 0).sort((a, b) => this.rp(b) - this.rp(a));
      const r = this.rankedCache;
      const u = this.me(c);
      return this.send(c, { t: 'top', kind: 'ranked', list: r.slice(0, 50).map((x) => this.publicCard(x)), me: u && r.includes(u) ? { rank: r.indexOf(u) + 1, card: this.publicCard(u) } : null, total: r.length });
    }
    const list = this.sorted().slice(0, 50).map((u) => this.publicCard(u));
    const u = this.me(c);
    this.send(c, { t: 'top', list, me: u ? { rank: this.rankOf(u), card: this.publicCard(u) } : null, total: Object.keys(this.db.users).length });
  }

  onClose(c) { this.detach(c); }
}

module.exports = { Accounts, trophyDelta, PARTY_MAX };
