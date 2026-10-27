// Cogwild stats and bug reports, for the owner's moderation page (/admin › Stats, Bugs).
// Stats: how many different players played each day (accounts and guests), how many were new, how many came back the
// next day and a week later, which modes they played and on what (website, app, phone…). Players are counted by a
// short one-way code of their account or guest record: no names, emails or addresses are kept here.
// Bugs: games send their errors by themselves (js/bugs.js); the same error from many players is one entry with a count.
// Everything lives in db.stats / db.bugs (saved with the accounts).
'use strict';
const crypto = require('crypto');

const DAYS_KEPT = 400; // daily counts
const IDS_KEPT = 35; // who played on a day (for "came back"), only this long
const BUGS_MAX = 300; // different errors kept
const BUG_PER_CONN = 20, BUG_PER_IP = 100; // reports accepted per connection / per network per hour
const PLATS = /^[a-z][a-z0-9-]{0,15}$/;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => day(Date.parse(d + 'T00:00:00Z') + n * 86400000);
const code = (s) => crypto.createHash('sha256').update('cogwild-stats:' + s).digest('base64url').slice(0, 12);
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
// what a bug report may contain: no addresses, emails or long secrets, file names instead of full links
function scrub(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b(?:https?|file|wss?|capacitor|app):\/\/[^\s)'"?#]*\/([\w.-]+\.(?:js|html))(?:[?#][^\s)'":]*)?/g, '$1')
    .replace(/\b(?:https?|file|wss?):\/\/[^\s)'"]+/g, '[link]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[id]')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .slice(0, max);
}

class Stats {
  constructor(accounts) {
    this.a = accounts;
    const db = accounts.db;
    db.stats = db.stats || {};
    db.stats.days = Object.assign(Object.create(null), db.stats.days || {});
    db.stats.first = Object.assign(Object.create(null), db.stats.first || {}); // player code -> the day they first played
    db.bugs = Object.assign(Object.create(null), db.bugs || {});
    this.seenToday = { day: null, set: new Set() };
    this.bugIp = new Map(); // ip -> [times]
    this.prune();
    setInterval(() => this.prune(), 3600000).unref();
  }
  get s() { return this.a.db.stats; }
  today() {
    const d = day();
    if (!this.s.days[d]) this.s.days[d] = { n: 0, new: 0, acc: 0, guest: 0, ids: [], plat: {}, modes: {}, online: 0, solo: 0 };
    if (this.seenToday.day !== d) this.seenToday = { day: d, set: new Set(this.s.days[d].ids || []) };
    return this.s.days[d];
  }
  // a game connected as an account or a guest: counted once per day
  seen(c) {
    const who = c.user ? 'u:' + c.user : c.guest ? 'g:' + c.guest : null;
    if (!who) return;
    // an account keeps its code (u.sid) when it's renamed; a guest who signs up keeps the guest's code
    const u = c.user && this.a.db.users[c.user];
    if (u && !u.sid) u.sid = c.statId || code(who);
    const id = (c.statId = u ? u.sid : code(who));
    const d = this.today();
    if (this.seenToday.set.has(id)) return;
    this.seenToday.set.add(id);
    d.ids.push(id);
    d.n++;
    bump(d, c.user ? 'acc' : 'guest');
    bump(d.plat, PLATS.test(c.plat || '') ? c.plat : 'old');
    if (!this.s.first[id]) { this.s.first[id] = this.seenToday.day; d.new++; }
    this.a.dirty();
  }
  // a finished match (the game's reward report was accepted)
  match(c, mode, online) {
    const d = this.today();
    bump(d.modes, /^[a-z]{1,12}$/.test(mode || '') ? mode : 'other');
    bump(d, online ? 'online' : 'solo');
    this.a.dirty();
  }

  // ---- bug reports from games ----
  bug(c, m) {
    if (!m || typeof m.msg !== 'string') return;
    const now = Date.now();
    c.bugs = (c.bugs || 0) + 1;
    if (c.bugs > BUG_PER_CONN) return;
    const recent = (this.bugIp.get(c.ip) || []).filter((t) => now - t < 3600000);
    if (recent.length >= BUG_PER_IP) return;
    this.bugIp.set(c.ip, recent.concat(now));
    const msg = scrub(m.msg, 300), where = scrub(m.where, 120), ver = scrub(m.ver, 16), kind = ['crash', 'error', 'promise'].includes(m.kind) ? m.kind : 'error';
    if (!msg) return;
    // the same error from everyone is one entry: the message (numbers ignored) and where it happened
    const sig = crypto.createHash('sha1').update(msg.replace(/\d+/g, '#') + '|' + where).digest('hex').slice(0, 16);
    const bugs = this.a.db.bugs;
    let b = bugs[sig];
    if (!b) {
      const all = Object.values(bugs);
      if (all.length >= BUGS_MAX) { // full: forget the oldest fixed one, else the oldest one
        const old = all.filter((x) => x.done).sort((x, y) => x.last - y.last)[0] || all.sort((x, y) => x.last - y.last)[0];
        delete bugs[old.sig];
      }
      b = bugs[sig] = { sig, msg, where, kind, stack: '', n: 0, who: [], first: now, last: now, vers: {}, plats: {}, states: {}, done: 0, back: false };
    }
    if (b.done) { b.done = 0; b.back = true; } // marked fixed, but it happened again
    b.n++;
    b.last = now;
    if (kind === 'crash') b.kind = 'crash';
    if (!b.stack && m.stack) b.stack = scrub(m.stack, 1500);
    const id = c.statId || code('ip:' + c.ip);
    if (!b.who.includes(id) && b.who.length < 200) b.who.push(id);
    bump(b.vers, ver || '?');
    bump(b.plats, PLATS.test(c.plat || '') ? c.plat : 'old');
    bump(b.states, scrub(m.state, 24) || '?');
    this.a.dirty();
  }
  bugDone(sig) { const b = this.a.db.bugs[sig]; if (!b) return false; b.done = Date.now(); b.back = false; this.a.dirty(); return true; }

  // ---- the moderation page ----
  view() {
    const today = day(), days = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i), x = this.s.days[d];
      if (!x) { days.push({ day: d, n: 0, new: 0, acc: 0, guest: 0, online: 0, solo: 0, plat: {}, modes: {}, d1: null, d7: null }); continue; }
      // of the players new that day, how many played again the day after / a week after
      const back = (later) => {
        const L = this.s.days[addDays(d, later)];
        if (!x.new || !x.ids || !L || !L.ids || addDays(d, later) > today) return null;
        const cohort = x.ids.filter((id) => this.s.first[id] === d), next = new Set(L.ids);
        return cohort.length ? Math.round((cohort.filter((id) => next.has(id)).length / cohort.length) * 100) : null;
      };
      days.push({ day: d, n: x.n, new: x.new, acc: x.acc | 0, guest: x.guest | 0, online: x.online | 0, solo: x.solo | 0, plat: x.plat, modes: x.modes, d1: back(1), d7: back(7) });
    }
    const last7 = days.slice(-7);
    return {
      days,
      today: days[days.length - 1],
      avg7: Math.round((last7.reduce((s, d) => s + d.n, 0) / 7) * 10) / 10,
      everyone: Object.keys(this.s.first).length,
    };
  }
  bugList() {
    return Object.values(this.a.db.bugs).map((b) => Object.assign({}, b, { who: b.who.length }))
      .sort((x, y) => (!!x.done - !!y.done) || (y.who - x.who) || (y.last - x.last));
  }

  prune() {
    const today = day();
    for (const d of Object.keys(this.s.days)) {
      if (d < addDays(today, -DAYS_KEPT)) delete this.s.days[d];
      else if (d < addDays(today, -IDS_KEPT)) delete this.s.days[d].ids;
    }
    const oldest = addDays(today, -DAYS_KEPT);
    for (const [id, d] of Object.entries(this.s.first)) if (d < oldest) delete this.s.first[id];
    const now = Date.now();
    for (const [ip, list] of this.bugIp) { const keep = list.filter((t) => now - t < 3600000); if (keep.length) this.bugIp.set(ip, keep); else this.bugIp.delete(ip); }
  }
}

module.exports = { Stats, scrub };
