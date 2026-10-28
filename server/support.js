// Cogwild support messages (v1.9.4). "Email us" in the game opens /support: the player signs in with Google in the
// browser (so we know where to answer; same sign-in as the game, server/google.js) and writes what happened. The
// message shows on the moderation page (/admin › Support) with a button that answers by email.
// Kept in db.support (the newest 500), at most 5 messages per email a day and 20 per network an hour.
'use strict';

const KEPT = 500, PER_EMAIL_DAY = 5, PER_IP_HOUR = 20, TEXT_MAX = 2000, SESSION_MS = 3 * 3600000;
const KINDS = { bug: '🐞 Bug', account: '👤 Account or progress', player: '🚩 A player', buy: '🪙 Coins or the Shop', idea: '💡 Idea', other: '✉ Other' };
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

class Support {
  constructor(accounts) {
    this.a = accounts;
    if (!Array.isArray(accounts.db.support)) accounts.db.support = [];
    this.sessions = new Map(); // page secret -> { email, at } (after Google sign-in, for a few hours)
    this.ipHits = new Map(); // ip -> [times]
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.sessions) if (now - v.at > SESSION_MS) this.sessions.delete(k);
      for (const [k, v] of this.ipHits) if (!v.some((t) => now - t < 3600000)) this.ipHits.delete(k);
    }, 600000).unref();
  }
  get list() { return this.a.db.support; }
  // the email the page signed in with: Google's answer waits under the page's secret (accounts.googleDone); it moves
  // here, so a game can't use that secret to log in
  who(s) {
    s = String(s || '');
    if (!/^[a-f0-9]{32,64}$/.test(s)) return null;
    const w = this.a.googleWait.get(s);
    if (w && w.email && !w.cid) { this.a.googleWait.delete(s); this.sessions.set(s, { email: w.email, at: Date.now() }); }
    const ses = this.sessions.get(s);
    if (!ses) return null;
    const k = this.a.byEmail.get(ses.email), u = k && this.a.db.users[k];
    return { email: ses.email, name: u ? u.name : null };
  }
  // { s, kind, text, ver, dev, user } from the page -> null (sent) or why not
  send(m, ip) {
    const me = this.who(m && m.s);
    if (!me) return 'Please sign in with Google again (the page was open too long).';
    const text = clean(m.text, TEXT_MAX);
    if (text.length < 10) return 'Please tell us a bit more (at least a sentence).';
    const now = Date.now();
    const hits = (this.ipHits.get(ip) || []).filter((t) => now - t < 3600000);
    if (hits.length >= PER_IP_HOUR) return 'Too many messages from your network. Please try again in an hour.';
    if (this.list.filter((t) => t.email === me.email && now - t.at < 86400000).length >= PER_EMAIL_DAY) return 'You sent 5 messages today. We will answer them first!';
    this.ipHits.set(ip, hits.concat(now));
    const kind = Object.prototype.hasOwnProperty.call(KINDS, m.kind) ? m.kind : 'other';
    this.list.push({
      id: now.toString(36) + Math.random().toString(36).slice(2, 6), at: now, email: me.email, name: me.name,
      user: clean(m.user, 24), kind, text, ver: clean(m.ver, 16), dev: clean(m.dev, 24), done: 0,
    });
    while (this.list.length > KEPT) {
      const old = this.list.findIndex((t) => t.done);
      this.list.splice(old >= 0 ? old : 0, 1);
    }
    this.a.dirty();
    console.log(`support: a message from ${me.email} (${kind})`);
    return null;
  }
  // the moderation page
  view() { return this.list.slice().reverse().map((t) => Object.assign({ kindName: KINDS[t.kind] || t.kind }, t)); }
  open() { return this.list.filter((t) => !t.done).length; }
  done(id, on) {
    const t = this.list.find((x) => x.id === id);
    if (!t) return false;
    t.done = on ? Date.now() : 0;
    this.a.dirty();
    return true;
  }
}

module.exports = { Support, KINDS };
