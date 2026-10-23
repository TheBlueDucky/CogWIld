// Cogwild talk: typed chat (friends, party, club) and voice chat set-up.
//
// Typed chat: free text (up to 200 characters) or one of the ready-made lines in js/economy.js (TALK_QUICK).
// Free chat is for friends, parties and clubs; matches only have quick chat (server.js 'chat').
// Each account picks "free" or "quick chat only" (kids); quick-only players never send or get free text,
// and get no voice chat. Players can block (nothing from them reaches you) and report (kept in db.reports).
//
// Voice chat: the games talk to each other directly (WebRTC); this server only tells each game who to
// connect to and passes their connection notes along. Two players connect when they're in the same party,
// or in the same room and both chose to hear their match. Blocked players never connect.
// TURN_URLS + TURN_SECRET (environment, deploy/setup-turn.sh): the voice relay on our server. With it, voice always goes
// through the relay, so players never see each other's internet address (and it works on networks that block direct calls).
'use strict';
const crypto = require('crypto');
const E = require('../js/economy.js');

const MAX_TEXT = 200;
const DM_KEEP = 60; // messages kept per pair of players
const LOG_KEEP = 40; // party and club lines kept
const KEEP_MS = 7 * 86400000; // friends' and club messages are deleted after a week (party/match chat: when it ends)
const REPORTS_KEEP = 2000;
const TURN_URLS = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TURN_SECRET = process.env.TURN_SECRET || '';
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const key = (name) => String(name || '').toLowerCase();

// free text as it may be shown: no control or direction-flipping characters, one line, 200 characters
function cleanText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

class Talk {
  // a: the Accounts object; h: { clients, rooms }
  constructor(a, h) {
    this.a = a;
    this.h = h;
    this.partyLog = new Map(); // party id -> last lines
    if (!a.db.dms) a.db.dms = {};
    if (!a.db.reports) a.db.reports = [];
    a.db.dms = Object.assign(Object.create(null), a.db.dms);
    setInterval(() => this.voiceTick(), 1000).unref();
    setInterval(() => this.prune(), 600000).unref();
    this.prune();
  }
  // messages older than a week are deleted (private messages and club chat)
  prune() {
    const old = Date.now() - KEEP_MS;
    let changed = false;
    for (const store of [this.db.dms, this.db.clubChat || {}]) {
      for (const [k, list] of Object.entries(store)) {
        const keep = list.filter((x) => (x.at || 0) > old);
        if (keep.length === list.length) continue;
        changed = true;
        if (keep.length) store[k] = keep; else delete store[k];
      }
    }
    if (changed) this.a.dirty();
  }
  get db() { return this.a.db; }
  send(c, m) { this.a.send(c, m); }
  err(c, msg) { this.a.err(c, msg); }
  quick(u) { return !!u && u.cm === 'quick'; }
  // either of the two blocked the other
  blocked(u, o) { return !!(u && o && ((u.blocked || []).includes(key(o.name)) || (o.blocked || []).includes(key(u.name)))); }

  handle(c, m) {
    const fn = {
      chatMode: () => this.setMode(c, m), dmSend: () => this.dmSend(c, m), dmOpen: () => this.dmOpen(c, m), dmRead: () => this.dmRead(c, m),
      partySay: () => this.partySay(c, m), clubSay: () => this.clubSay(c, m), block: () => this.block(c, m, true), unblock: () => this.block(c, m, false),
      report: () => this.report(c, m), vcState: () => this.vcState(c, m), vcSig: () => this.vcSig(c, m),
    }[m.t];
    if (!fn) return false;
    fn();
    return true;
  }

  // just logged in: your chat mode, who you blocked and unread messages
  onLogin(c) {
    const u = this.a.me(c);
    if (!u) return;
    this.send(c, { t: 'talk', mode: u.cm === 'quick' ? 'quick' : 'free', blocked: (u.blocked || []).map((k) => (this.db.users[k] || { name: k }).name), unread: u.unread || {} });
  }

  // one message: { q } a quick line, or { x } free text. null when it can't be sent (the player is told why)
  message(c, u, m) {
    const now = Date.now();
    c.talkAt = (c.talkAt || []).filter((t) => now - t < 10000);
    if (c.talkAt.length >= 8 || now - (c.talkAt[c.talkAt.length - 1] || 0) < 500) { this.err(c, 'Slow down a little'); return null; }
    let msg;
    if (m.q != null) {
      const q = m.q | 0;
      if (q < 0 || q >= E.TALK_QUICK.length) return null;
      msg = { f: u.name, a: u.av | 0, pv: u.pv | 0, q, at: now };
    } else {
      if (this.quick(u)) { this.err(c, 'Quick chat only is on (Settings > Chat)'); return null; }
      const x = cleanText(m.x);
      if (!x) return null;
      msg = { f: u.name, a: u.av | 0, pv: u.pv | 0, x, at: now };
    }
    c.talkAt.push(now);
    return msg;
  }
  // what a quick-only reader may see of a list of lines (nothing older than a week)
  readable(list, u) {
    const old = Date.now() - KEEP_MS;
    return list.filter((x) => (x.at || 0) > old && (!this.quick(u) || x.x == null) && !(u.blocked || []).includes(key(x.f)));
  }
  // private messages: friends, or players in the same club
  canDm(u, o) {
    return (u.friends || []).includes(key(o.name)) || (!!u.club && u.club === o.club);
  }

  setMode(c, m) {
    const u = this.a.me(c);
    if (!u) return;
    if (m.mode === 'quick') u.cm = 'quick'; else delete u.cm;
    this.a.dirty();
    if (u.cm) c.vc = null; // quick chat only: no voice chat
    this.send(c, { t: 'talk', mode: u.cm ? 'quick' : 'free' });
  }

  // ---------------- private messages (friends and club-mates; kept a week, so offline players get them later) ----------------
  pair(a, b) { return [key(a), key(b)].sort().join('|'); }
  dmSend(c, m) {
    const u = this.a.me(c), o = this.a.user(m.to);
    if (!u) return this.err(c, 'Log in to message friends');
    if (!o || o === u || !this.canDm(u, o)) return this.err(c, 'You can only message friends and players in your club');
    if ((u.blocked || []).includes(key(o.name))) return this.err(c, `You blocked ${o.name}. Unblock them first.`);
    if (this.blocked(u, o)) return this.err(c, `You can't message ${o.name}`);
    if (m.x != null && this.quick(o)) return this.err(c, `${o.name} uses quick chat only: send a quick message`);
    const msg = this.message(c, u, m);
    if (!msg) return;
    const p = this.pair(u.name, o.name);
    this.db.dms[p] = (this.db.dms[p] || []).concat(msg).slice(-DM_KEEP);
    const oc = this.a.online.get(key(o.name));
    if (oc) this.send(oc, { t: 'dm', with: u.name, msg });
    o.unread = o.unread || {};
    o.unread[u.name] = Math.min(99, (o.unread[u.name] | 0) + 1);
    this.a.dirty();
    this.send(c, { t: 'dm', with: o.name, msg });
  }
  dmOpen(c, m) {
    const u = this.a.me(c), o = this.a.user(m.name);
    if (!u || !o) return;
    const list = this.db.dms[this.pair(u.name, o.name)] || [];
    if (u.unread && u.unread[o.name]) { delete u.unread[o.name]; this.a.dirty(); }
    this.send(c, { t: 'dmLog', with: o.name, list: this.readable(list, u), card: { name: o.name, av: o.av | 0, pv: o.pv | 0 } });
  }
  dmRead(c, m) {
    const u = this.a.me(c), o = this.a.user(m.name);
    if (u && o && u.unread && u.unread[o.name]) { delete u.unread[o.name]; this.a.dirty(); }
  }

  // ---------------- party and club chat (to everyone in it who may read the line) ----------------
  toGroup(keys, msg, from, kind, extra) {
    for (const k of keys) {
      const r = this.db.users[k], oc = this.a.online.get(k);
      if (!r || !oc || this.blocked(from, r) || (msg.x != null && this.quick(r))) continue;
      this.send(oc, Object.assign({ t: kind, msg }, extra || {}));
    }
  }
  partySay(c, m) {
    const u = this.a.me(c), p = u && this.a.party(c.user);
    if (!p) return this.err(c, "You're not in a party");
    const msg = this.message(c, u, m);
    if (!msg) return;
    const log = (this.partyLog.get(p.id) || []).concat(msg).slice(-LOG_KEEP);
    this.partyLog.set(p.id, log);
    this.toGroup(p.members, msg, u, 'partyMsg');
  }
  partyLines(c) {
    const u = this.a.me(c), p = u && this.a.party(c.user);
    return p ? this.readable(this.partyLog.get(p.id) || [], u) : [];
  }
  clubSay(c, m) {
    const u = this.a.me(c), club = this.a.clubOf(u);
    if (!club) return this.err(c, "You're not in a club");
    const msg = this.message(c, u, m);
    if (!msg) return;
    this.a.clubLog.set(club.id, (this.a.clubLog.get(club.id) || []).concat(msg).slice(-LOG_KEEP));
    this.toGroup(club.members, msg, u, 'clubMsg');
  }

  // ---------------- block and report ----------------
  block(c, m, on) {
    const u = this.a.me(c), o = this.a.user(m.name);
    if (!u || !o || o === u) return;
    const k = key(o.name);
    u.blocked = (u.blocked || []).filter((x) => x !== k);
    if (on) u.blocked = u.blocked.concat(k).slice(-500);
    this.a.dirty();
    this.send(c, { t: 'talk', blocked: u.blocked.map((x) => (this.db.users[x] || { name: x }).name) });
    this.send(c, { t: 'note', kind: 'info', msg: on ? `🚫 ${o.name} is blocked: no messages or voice from them` : `${o.name} is unblocked` });
  }
  report(c, m) {
    const u = this.a.me(c), o = this.a.user(m.name);
    if (!u || !o) return;
    const now = Date.now();
    if (now - (c.reportAt || 0) < 20000) return this.err(c, 'Wait a little before sending another report');
    c.reportAt = now;
    // what they said lately where you could see it, so whoever reads the report has the context
    const said = [...(this.db.dms[this.pair(u.name, o.name)] || []), ...this.partyLines(c)];
    const club = this.a.clubOf(u);
    if (club) said.push(...(this.a.clubLog.get(club.id) || []));
    const lines = said.filter((x) => key(x.f) === key(o.name) && x.x != null).slice(-10).map((x) => x.x);
    this.db.reports.push({ by: u.name, who: o.name, why: cleanText(m.why).slice(0, 60) || 'chat', where: cleanText(m.where).slice(0, 20), lines, at: now });
    this.db.reports = this.db.reports.slice(-REPORTS_KEEP);
    this.a.dirty();
    console.log(`report: ${u.name} reported ${o.name} (${m.why})`);
    this.send(c, { t: 'note', kind: 'info', msg: `Thanks. We got your report about ${o.name}.` });
  }

  // ---------------- voice chat ----------------
  vcState(c, m) {
    const u = this.a.me(c);
    if (!m.on) { c.vc = null; return; }
    if (!u) return this.err(c, 'Voice chat needs an account. Log in first.');
    if (this.quick(u)) return this.err(c, 'Voice chat is off with Quick chat only (Settings > Chat)');
    c.vc = { hear: m.hear === 'party' ? 'party' : 'game' };
  }
  // short-lived TURN login (the usual "TURN REST" scheme: user = expiry:name, password = HMAC of it)
  ice(c) {
    if (!TURN_URLS.length || !TURN_SECRET) return STUN;
    const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${c.user}`;
    const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    return STUN.concat({ urls: TURN_URLS, username, credential });
  }
  // who each voice player should be connected to; sent again whenever it changes
  voiceTick() {
    const on = [...this.h.clients.values()].filter((c) => c.vc && c.user);
    for (const c of on) {
      const u = this.a.me(c), pid = this.a.partyOf.get(c.user);
      const peers = on.filter((o) => {
        if (o === c) return false;
        const ou = this.a.me(o);
        if (!ou || this.blocked(u, ou)) return false;
        if (pid && this.a.partyOf.get(o.user) === pid) return true;
        return !!c.room && c.room === o.room && c.vc.hear === 'game' && o.vc.hear === 'game';
      }).map((o) => ({ id: o.id, name: o.name, party: !!pid && this.a.partyOf.get(o.user) === pid }));
      const sig = peers.map((p) => p.id + (p.party ? 'p' : '')).sort().join();
      c.vcPeers = new Set(peers.map((p) => p.id));
      if (sig === c.vcSigSent) continue;
      c.vcSigSent = sig;
      // relay: with a TURN relay, voice always goes through it, so players never see each other's internet address
      this.send(c, { t: 'vcPeers', list: peers, ice: this.ice(c), relay: !!(TURN_URLS.length && TURN_SECRET) });
    }
    // turned off: tell them once
    for (const c of this.h.clients.values()) if (!c.vc && c.vcSigSent != null) { c.vcSigSent = null; c.vcPeers = null; this.send(c, { t: 'vcPeers', list: [] }); }
  }
  // connection notes between two players who are meant to be connected
  vcSig(c, m) {
    const to = this.h.clients.get(m.to | 0);
    if (!c.vc || !to || !to.vc || !c.vcPeers || !c.vcPeers.has(to.id)) return;
    const d = m.d;
    if (!d || typeof d !== 'object' || JSON.stringify(d).length > 20000) return;
    this.send(to, { t: 'vcSig', from: c.id, d });
  }
}

module.exports = { Talk, cleanText };
