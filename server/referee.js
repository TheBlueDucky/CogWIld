// Cogwild — the server's referee for online matches.
// Every hit, position and result in a match passes through the server, so it checks them on the way:
//   * hits:   only the game that controls the shooter may send its hits, and a shooter can't deal more damage
//             than its mech's weapons allow (with a big allowance for supers, gadgets and splash): extra is dropped
//   * speed:  mechs that move impossibly fast (outside respawns) are noted
//   * damage: a player whose mech takes far more damage than it has HP, without breaking, is noted
// Players with notes get no trophies or ranked points for that match (and the server logs why).
'use strict';
const E = require('../js/economy.js');

const MAX_SPEED = 160; // m/s: faster than anything a mech can do, even dashing with a Turbo Ram super
const SPEED_STRIKES = 12; // this many impossible jumps in a match → noted
const IGNORE_WINDOW = 10000; // ms
const BOSS_HP = 4000; // the Titan: far bigger than anything a player can build

class Referee {
  constructor(room, roster, hostId) {
    this.room = room;
    this.mods = (E.WEEKLY.find((w) => w.id === room.settings.event) || {}).mods || {};
    this.units = new Map(); // netId -> { o, h, hp, dps, bucket, t, pos, at, life, speedStrikes, recv: [], hpSeen }
    this.notes = new Map(); // client id -> reason
    this.hostId = hostId;
    for (const e of roster) this.add(e);
  }
  add(e) {
    if (!e || !Number.isInteger(e.i) || this.units.size > 200) return;
    const pw = E.mechPower(e.bp && e.bp.parts);
    const boss = pw.hp > BOSS_HP;
    // damage a shooter may deal per second: its weapons ×3 plus some, and a burst for supers, gadgets and splash
    const rate = (pw.dps * 3 + 60) * (this.mods.dmg || 1) * (boss ? 4 : 1);
    this.units.set(e.i, { o: e.o | 0, h: !!e.h, hp: pw.hp, rate, burst: 700 + rate * 4, bucket: 700 + rate * 4, t: Date.now(), pos: null, at: 0, life: null, speedStrikes: 0, recv: [], hpSeen: pw.hp });
  }
  owner(i) { const u = this.units.get(i); return u ? u.o : -1; }
  // a player left: their mechs are run by the host from now on (same for everything the old host ran)
  reassign(from, to) { for (const u of this.units.values()) if (u.o === from) { u.o = to; u.h = false; } if (from === this.hostId) this.hostId = to; }
  note(id, why) {
    if (this.notes.has(id)) return;
    this.notes.set(id, why);
    console.warn(`referee ${this.room.code}: client ${id} ${why}`);
  }

  // a match message from client `id`: drops what it may not send, returns false to drop the whole message
  check(id, m) {
    const now = Date.now();
    if (Array.isArray(m.e)) {
      m.e = m.e.filter((e) => {
        if (!e || typeof e !== 'object') return false;
        if (e.k === 'add' && e.r) { if (id === this.hostId) this.add(Object.assign({}, e.r, { o: this.hostId })); return id === this.hostId; }
        if (e.k === 'hit' || e.k === 'phit') return this.hit(id, e, now);
        if ((e.k === 'wreck' || e.k === 'elim' || e.k === 'spawn') && this.owner(e.c) !== id) return false; // only about your own mechs
        if (e.k === 'wreck' || e.k === 'spawn') { const u = this.units.get(e.c); if (u) { u.recv = []; u.pos = null; } }
        return true;
      });
    }
    if (Array.isArray(m.s)) {
      m.s = m.s.filter((s) => s && this.owner(s.i) === id);
      for (const s of m.s) this.snap(id, s, now);
    }
    return true;
  }
  hit(id, e, now) {
    const d = +e.d;
    if (!Number.isFinite(d) || d < 0 || d > 500) return false;
    const target = this.units.get(e.c);
    if (!target) return false;
    let u = null;
    if (e.by >= 0) {
      u = this.units.get(e.by);
      if (!u || u.o !== id) return false; // hits "by" a mech this game doesn't control
    } else {
      // hits with no shooter (the arena itself): only from the host, a little at a time
      if (id !== this.hostId) return false;
      u = this.units.get(-1) || this.units.set(-1, { o: id, rate: 120, burst: 600, bucket: 600, t: now, recv: [] }).get(-1);
    }
    u.bucket = Math.min(u.burst, u.bucket + ((now - u.t) / 1000) * u.rate);
    u.t = now;
    if (d > u.bucket) {
      u.over = (u.over || 0) + d;
      if (u.over > 3000) this.note(id, 'sent far more damage than its mech can deal');
      return false;
    }
    u.bucket -= d;
    if (e.k === 'hit') target.recv.push({ t: now, d });
    return true;
  }
  snap(id, s, now) {
    const u = this.units.get(s.i);
    if (!u) return;
    if (Array.isArray(s.m) && s.m.length >= 3) {
      const [x, y, z] = s.m;
      if ([x, y, z].every(Number.isFinite)) {
        if (u.pos && u.life === s.l) {
          const dt = (now - u.at) / 1000;
          if (dt > 0.02) {
            const v = Math.hypot(x - u.pos[0], y - u.pos[1], z - u.pos[2]) / dt;
            if (v > MAX_SPEED && dt < 1.5) { u.speedStrikes++; if (u.speedStrikes >= SPEED_STRIKES) this.note(id, 'moved impossibly fast'); }
          }
        }
        u.pos = [x, y, z];
        u.at = now;
        u.life = s.l;
      }
    }
    // a human mech that soaks up far more than its HP in 10 s without ever losing much: it ignores damage
    if (u.h && Array.isArray(s.h) && u.hp > 0) {
      u.recv = u.recv.filter((r) => now - r.t < IGNORE_WINDOW);
      const left = s.h.reduce((a, v) => a + (v > 0 ? +v || 0 : 0), 0);
      u.hpSeen = Math.min(u.hpSeen, left);
      const took = u.recv.reduce((a, r) => a + r.d, 0);
      if (took > u.hp * 3 && left > u.hp * 0.9) this.note(id, 'took far more damage than its mech has, without breaking');
      if (left > u.hp * 1.05 + 60) this.note(id, 'reported more HP than its mech has');
    }
  }
}

module.exports = { Referee };
