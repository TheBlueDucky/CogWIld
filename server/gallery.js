// Cogwild mech gallery: players share their mechs, everyone browses them (trending, top, new, by how they move,
// search), likes them, tries them in a test drive and copies them into their Workshop.
// Only accounts can share, like and report; anyone can look and copy. A shared mech must be a legal mech (the same
// rules as online play, any level), its name passes the word filter, and each account shares at most 12.
// A mech reported by 3 different players is hidden until a moderator looks at it (deploy/admin page, server/admin.js).
'use strict';
const E = require('../js/economy.js');
const filter = require('./filter');

const MAX_PER_USER = 12, PAGE = 24, HIDE_AT = 3, MAX_LIST = 5000, PUBLISH_GAP = 20000;
const key = (name) => String(name || '').toLowerCase();
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
const DOM = { land: 'land', water: 'water', air: 'air' };

class Gallery {
  constructor(a) {
    this.a = a;
    if (!a.db.gallery) a.db.gallery = {};
    this.seq = Object.keys(a.db.gallery).length;
  }
  get db() { return this.a.db; }
  get all() { return this.db.gallery; }
  send(c, m) { this.a.send(c, m); }
  err(c, msg) { this.a.err(c, msg); }

  handle(c, m) {
    const fn = {
      galList: () => this.list(c, m), galGet: () => this.get(c, m), galPublish: () => this.publish(c, m), galLike: () => this.like(c, m),
      galCopy: () => this.copy(c, m), galDelete: () => this.remove(c, m), galReport: () => this.report(c, m),
    }[m.t];
    if (!fn) return false;
    fn();
    return true;
  }

  // what a list shows of a mech (no likes lists, no reports)
  view(g, u) {
    const k = u ? key(u.name) : null;
    return {
      id: g.id, n: g.n, by: g.by, col: g.col, fin: g.fin || '', parts: g.parts, cost: g.cost, tags: g.tags, lvl: g.lvl, at: g.at,
      likes: g.likes.length, copies: g.copies, liked: !!k && g.likes.includes(k), mine: !!k && g.bk === k, hidden: !!g.hidden,
    };
  }
  score(g, now) {
    const days = (now - g.at) / 86400000;
    return (g.likes.length + g.copies * 0.5 + 1) / Math.pow(days + 2, 1.4);
  }
  // sort: trending | top | new | mine | liked; tag: all | land | water | air | hybrid; q: words in the name or maker
  list(c, m) {
    const u = this.a.me(c), k = u ? key(u.name) : null, now = Date.now();
    const sort = ['trending', 'top', 'new', 'mine', 'liked'].includes(m.sort) ? m.sort : 'trending';
    const tag = ['land', 'water', 'air', 'hybrid'].includes(m.tag) ? m.tag : 'all';
    const q = key(cleanName(m.q)).slice(0, 24);
    let items = Object.values(this.all).filter((g) => (!g.hidden || g.bk === k)
      && (sort !== 'mine' || g.bk === k) && (sort !== 'liked' || (k && g.likes.includes(k)))
      && (tag === 'all' || (tag === 'hybrid' ? g.tags.length > 1 : g.tags.includes(tag)))
      && (!q || key(g.n).includes(q) || key(g.by).includes(q)));
    if (sort === 'top') items.sort((x, y) => y.likes.length - x.likes.length || y.copies - x.copies || y.at - x.at);
    else if (sort === 'trending') items.sort((x, y) => this.score(y, now) - this.score(x, now));
    else items.sort((x, y) => y.at - x.at);
    const page = Math.max(0, m.page | 0);
    this.send(c, { t: 'galItems', sort, tag, q, page, more: items.length > (page + 1) * PAGE, total: items.length, items: items.slice(page * PAGE, (page + 1) * PAGE).map((g) => this.view(g, u)), left: u ? MAX_PER_USER - this.mine(u).length : 0 });
  }
  get(c, m) {
    const g = this.all[String(m.id || '')], u = this.a.me(c);
    if (!g || (g.hidden && (!u || g.bk !== key(u.name)))) return this.send(c, { t: 'galGone', id: String(m.id || '') });
    this.send(c, { t: 'galItem', item: this.view(g, u) });
  }
  mine(u) { const k = key(u.name); return Object.values(this.all).filter((g) => g.bk === k); }

  publish(c, m) {
    const u = this.a.me(c);
    if (!u) return this.err(c, 'Log in to share your mechs');
    const now = Date.now();
    if (now - (c.galAt || 0) < PUBLISH_GAP) return this.err(c, 'Wait a few seconds before sharing another mech');
    const bp = m.bp || {};
    const name = cleanName(bp.name);
    if (name.length < 2) return this.err(c, 'Give your mech a name first (in the Workshop)');
    if (filter.isBad(name)) return this.err(c, 'Please pick a different name for your mech');
    if (!Array.isArray(bp.parts)) return this.err(c, "That mech can't be shared");
    const parts = bp.parts.slice(0, E.MAX_PARTS + 1).map((p) => ({ t: String(p && p.t), x: p.x | 0, y: p.y | 0, z: p.z | 0 }));
    const why = E.mechProblem(parts, 99, E.BUDGET);
    if (why) return this.err(c, `That mech can't be shared (${why})`);
    const mine = this.mine(u);
    if (mine.length >= MAX_PER_USER) return this.err(c, `You can share ${MAX_PER_USER} mechs. Delete one of yours first.`);
    const shape = (ps) => ps.map((p) => `${p.t}${p.x},${p.y},${p.z}`).sort().join(';');
    const s = shape(parts);
    if (mine.some((g) => shape(g.parts.map(([t, x, y, z]) => ({ t, x, y, z }))) === s)) return this.err(c, "You've already shared this mech");
    if (Object.keys(this.all).length >= MAX_LIST) return this.err(c, 'The gallery is full right now. Try again later.');
    c.galAt = now;
    let cost = 0, lvl = 1;
    const tags = new Set();
    for (const p of parts) { const r = E.PARTS[p.t]; cost += r[0]; lvl = Math.max(lvl, r[2]); if (r[1]) tags.add(DOM[r[1]]); }
    const id = 'g' + now.toString(36) + (++this.seq).toString(36);
    const fin = E.item('finishes', String(bp.fin || '')) ? String(bp.fin) : '';
    this.all[id] = { id, n: name, by: u.name, bk: key(u.name), col: (bp.color | 0) & 0xffffff, fin, parts: parts.map((p) => [p.t, p.x, p.y, p.z]), cost, lvl, tags: [...tags], at: now, likes: [], copies: 0, copiers: [], reports: [], hidden: false };
    this.a.dirty();
    this.send(c, { t: 'galPublished', item: this.view(this.all[id], u) });
  }
  like(c, m) {
    const u = this.a.me(c), g = this.all[String(m.id || '')];
    if (!u) return this.err(c, 'Log in to like mechs');
    if (!g || g.hidden) return;
    const k = key(u.name);
    if (g.bk === k) return this.err(c, "You can't like your own mech");
    const has = g.likes.includes(k);
    if (m.on && !has) g.likes.push(k);
    if (!m.on && has) g.likes = g.likes.filter((x) => x !== k);
    this.a.dirty();
    this.send(c, { t: 'galLiked', id: g.id, likes: g.likes.length, liked: g.likes.includes(k) });
  }
  // copied into someone's Workshop: counted once per account (guests copy too, uncounted)
  copy(c, m) {
    const u = this.a.me(c), g = this.all[String(m.id || '')];
    if (!g || g.hidden) return;
    if (u && g.bk !== key(u.name) && !g.copiers.includes(key(u.name))) {
      g.copiers.push(key(u.name));
      if (g.copiers.length > 2000) g.copiers.shift();
      g.copies++;
      this.a.dirty();
    }
    this.send(c, { t: 'galCopied', id: g.id, copies: g.copies });
  }
  remove(c, m) {
    const u = this.a.me(c), g = this.all[String(m.id || '')];
    if (!u || !g || g.bk !== key(u.name)) return;
    delete this.all[g.id];
    this.a.dirty();
    this.send(c, { t: 'galDeleted', id: g.id });
  }
  report(c, m) {
    const u = this.a.me(c), g = this.all[String(m.id || '')];
    if (!u) return this.err(c, 'Log in to report a mech');
    if (!g) return;
    const k = key(u.name);
    if (g.bk === k) return;
    if (!g.reports.includes(k)) g.reports.push(k);
    if (g.reports.length >= HIDE_AT) g.hidden = true;
    const why = ['name', 'rude', 'copy', 'other'].includes(m.why) ? m.why : 'other';
    if (this.db.reports) {
      this.db.reports.push({ by: u.name, who: g.by, why: 'mech ' + why, where: 'gallery', gid: g.id, lines: [`Mech: ${g.n}`], at: Date.now() });
      this.db.reports = this.db.reports.slice(-2000);
    }
    this.a.dirty();
    this.send(c, { t: 'note', kind: 'info', msg: 'Thanks. We got your report.' });
  }

  // ---- account changes ----
  renamed(ok, nk, name) {
    for (const g of Object.values(this.all)) {
      if (g.bk === ok) { g.bk = nk; g.by = name; }
      for (const list of [g.likes, g.copiers, g.reports]) { const i = list.indexOf(ok); if (i >= 0) list[i] = nk; }
    }
  }
  dropUser(k) {
    for (const g of Object.values(this.all)) {
      if (g.bk === k) delete this.all[g.id];
      else g.likes = g.likes.filter((x) => x !== k);
    }
  }
  // moderation (server/admin.js)
  hide(id, on) { const g = this.all[id]; if (!g) return false; g.hidden = !!on; if (!on) g.reports = []; this.a.dirty(); return true; }
  drop(id) { if (!this.all[id]) return false; delete this.all[id]; this.a.dirty(); return true; }
}

module.exports = { Gallery };
