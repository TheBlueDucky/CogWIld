// Cogwild moderation: a private page at /admin for the game's owner (kids play this game: reports must be looked at).
// It lists player reports (newest first, with what was said), hidden gallery mechs and who is muted or banned, and
// can mute typed chat, ban an account, turn on Quick chat only, dismiss a report, and hide / show / delete a mech.
// It also shows players per day (server/stats.js), the errors games sent in (Bugs, marked fixed one by one) and the
// players' support messages (server/support.js, answered by email).
// It only works with ADMIN_TOKEN set in /etc/cogwild.env (deploy/set-admin.ps1 makes one; nobody else ever sees it).
// The page sends the token in a header; wrong tokens are counted per network and locked out for 15 minutes after 5.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.ADMIN_TOKEN || '';
const FAIL_MAX = 5, FAIL_WINDOW = 15 * 60000;
const key = (name) => String(name || '').toLowerCase();

class Admin {
  // a: Accounts; h: { clients, rooms }; root: the folder with admin.html
  constructor(a, h, root, security) {
    this.a = a;
    this.h = h;
    this.root = root;
    this.security = security;
    this.fails = new Map(); // ip -> [times]
  }
  get db() { return this.a.db; }
  json(res, code, obj) {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, this.security));
    res.end(JSON.stringify(obj));
  }
  ok(req, ip) {
    const now = Date.now();
    const list = (this.fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW);
    if (list.length >= FAIL_MAX) return 'locked';
    const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
    const want = Buffer.from(TOKEN);
    if (TOKEN.length >= 32 && given.length === want.length && crypto.timingSafeEqual(given, want)) return 'ok';
    this.fails.set(ip, list.concat(now));
    return 'no';
  }
  // returns true when it answered the request
  http(req, res, url, ip) {
    if (url !== '/admin' && !url.startsWith('/admin/')) return false;
    if (url === '/admin' || url === '/admin/') {
      // the page itself (no secrets in it); the API below needs the token
      fs.readFile(path.join(this.root, 'admin.html'), (err, buf) => {
        if (err) { res.writeHead(404, this.security); return res.end('Not found'); }
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, this.security));
        res.end(buf);
      });
      return true;
    }
    if (!url.startsWith('/admin/api/')) { this.json(res, 404, { err: 'Not found' }); return true; }
    if (!TOKEN) { this.json(res, 503, { err: 'The moderation page is off: run deploy\\set-admin.ps1 first' }); return true; }
    const auth = this.ok(req, ip);
    if (auth === 'locked') { this.json(res, 429, { err: 'Too many wrong keys. Wait 15 minutes.' }); return true; }
    if (auth !== 'ok') { this.json(res, 401, { err: 'Wrong key' }); return true; }
    const q = new URLSearchParams((req.url || '').split('?')[1] || '');
    const what = url.slice('/admin/api/'.length);
    try {
      if (what === 'overview') return this.json(res, 200, this.overview()), true;
      if (what === 'player') return this.json(res, 200, this.player(q.get('name'))), true;
      if (what === 'stats') return this.json(res, 200, this.a.stats ? this.a.stats.view() : { err: 'No stats here' }), true;
      if (what === 'bugs') return this.json(res, 200, { bugs: this.a.stats ? this.a.stats.bugList() : [] }), true;
      if (what === 'support') return this.json(res, 200, { list: this.a.support ? this.a.support.view() : [] }), true;
      if (what === 'act') return this.json(res, 200, this.act(q)), true;
    } catch (e) {
      console.error('admin', what, e);
      this.json(res, 500, { err: 'Something went wrong' });
      return true;
    }
    this.json(res, 404, { err: 'Not found' });
    return true;
  }

  // ---- what the page shows ----
  overview() {
    const now = Date.now(), users = this.db.users;
    const reports = (this.db.reports || []).map((r, i) => Object.assign({ i }, r)).filter((r) => !r.done).reverse().slice(0, 300);
    const people = Object.values(users).filter((u) => (u.muteUntil || 0) > now || (u.banUntil || 0) > now || u.cm === 'quick' && u.cmBy === 'mod')
      .map((u) => ({ name: u.name, muteUntil: u.muteUntil || 0, banUntil: u.banUntil || 0, autoMuted: !!u.autoMuted && (u.muteUntil || 0) > now, quick: u.cm === 'quick' }));
    const g = this.a.gallery;
    const hidden = g ? Object.values(g.all).filter((x) => x.hidden || x.reports.length).map((x) => ({ id: x.id, n: x.n, by: x.by, reports: x.reports.length, hidden: x.hidden, at: x.at })) : [];
    return {
      reports, people, hidden,
      stats: { accounts: Object.keys(users).length, online: this.h.clients.size, rooms: this.h.rooms.size, gallery: g ? Object.keys(g.all).length : 0, openReports: reports.length,
        today: this.a.stats ? this.a.stats.today().n : 0, openBugs: this.a.stats ? Object.values(this.db.bugs || {}).filter((b) => !b.done).length : 0,
        openSupport: this.a.support ? this.a.support.open() : 0 },
    };
  }
  player(name) {
    const u = this.a.user(name);
    if (!u) return { err: 'No player with that name' };
    const k = key(u.name), now = Date.now();
    const against = (this.db.reports || []).map((r, i) => Object.assign({ i }, r)).filter((r) => key(r.who) === k).reverse().slice(0, 100);
    const made = (this.db.reports || []).filter((r) => key(r.by) === k).length;
    const g = this.a.gallery;
    return {
      name: u.name, created: u.created || 0, seen: u.seen || 0, online: this.a.online.has(k), tro: u.tro | 0, played: u.played | 0, club: u.club && this.db.clubs[u.club] ? this.db.clubs[u.club].name : null,
      quick: u.cm === 'quick', muteUntil: u.muteUntil || 0, banUntil: u.banUntil || 0, autoMuted: !!u.autoMuted && (u.muteUntil || 0) > now,
      notes: (u.notes || []).slice(-20), disputes: (u.disputes || []).length, against, made, friends: (u.friends || []).length,
      mechs: g ? g.mine(u).map((x) => ({ id: x.id, n: x.n, hidden: x.hidden, reports: x.reports.length })) : [],
    };
  }

  // ---- what it can do ----
  act(q) {
    const what = q.get('do'), now = Date.now();
    const hours = Math.max(0, Math.min(24 * 3650, +q.get('hours') || 0));
    if (['mute', 'unmute', 'ban', 'unban', 'quick', 'free'].includes(what)) {
      const u = this.a.user(q.get('name'));
      if (!u) return { err: 'No player with that name' };
      const k = key(u.name), oc = this.a.online.get(k);
      if (what === 'mute') { u.muteUntil = now + (hours || 24) * 3600e3; u.autoMuted = false; }
      if (what === 'unmute') { u.muteUntil = 0; u.autoMuted = false; }
      if (what === 'ban') {
        u.banUntil = hours ? now + hours * 3600e3 : now + 3650 * 86400e3; // no hours: for good
        for (const t of u.tokens || []) this.a.byToken.delete(t);
        u.tokens = [];
        if (oc) { this.a.detach(oc); this.a.send(oc, { t: 'acctOut', reason: 'This account was suspended by a moderator' }); }
      }
      if (what === 'unban') u.banUntil = 0;
      if (what === 'quick' || what === 'free') {
        u.cm = what === 'quick' ? 'quick' : 'free';
        u.cmBy = what === 'quick' ? 'mod' : null;
        if (oc && this.a.talk) this.a.talk.setMode(oc, { mode: u.cm, byMod: true });
      }
      console.log(`moderation: ${what} ${u.name}${hours ? ' ' + hours + 'h' : ''}`);
      this.a.dirty();
      return { ok: true, player: this.player(u.name) };
    }
    if (what === 'dismiss') {
      const r = (this.db.reports || [])[+q.get('i')];
      if (!r) return { err: 'No such report' };
      r.done = now;
      this.a.dirty();
      return { ok: true };
    }
    if (['hide', 'show', 'delmech'].includes(what)) {
      const g = this.a.gallery, id = String(q.get('id') || '');
      if (!g) return { err: 'No gallery' };
      const ok = what === 'delmech' ? g.drop(id) : g.hide(id, what === 'hide');
      console.log(`moderation: ${what} mech ${id}`);
      return ok ? { ok: true } : { err: 'No such mech' };
    }
    if (what === 'bugdone') return this.a.stats && this.a.stats.bugDone(String(q.get('sig') || '')) ? { ok: true } : { err: 'No such bug' };
    if (what === 'supdone' || what === 'supopen') return this.a.support && this.a.support.done(String(q.get('id') || ''), what === 'supdone') ? { ok: true } : { err: 'No such message' };
    return { err: 'Unknown action' };
  }
}

module.exports = { Admin };
