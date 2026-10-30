// Cogwild — objective game modes: King of the Hill, Gold Rush, Combat Race, Boss Battle, Bounty Hunt.
// Each objective plugs into the match loop with the same small interface:
//   start()            set up the map objects
//   update(dt)         run the rules
//   hud()              HTML for the top bar
//   botGoal(c)         where a bot should drive (or null to just fight)
//   onWreck(victim, who)
//   check()            null while running, or { winner: teamIndex | -1 } when the match is over
//   teamScore(team)    used for placings and the scoreboard
//   respawnSpot(c)     optional custom respawn point
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const r1 = (v) => Math.round(v * 10) / 10;
  // Online: the host's game runs every objective and sends netState() 5x a second; the others show it with netApply().

  class Objective {
    constructor(game, mode) { this.game = game; this.mode = mode; this.objects = []; }
    add(o) { this.game.scene.add(o); this.objects.push(o); return o; }
    dispose() { for (const o of this.objects) this.game.scene.remove(o); this.objects = []; }
    teams() { return [...new Set(this.game.combatants.map((c) => c.team))]; }
    teamColor(t) { const c = this.game.combatants.find((x) => x.team === t); return c ? c.color : 0xffffff; }
    teamName(t) {
      const g = this.game;
      if (!g.teamMode) { const c = g.combatants.find((x) => x.team === t); return c ? (c.isPlayer ? 'You' : c.name) : '?'; }
      return ['Blue', 'Red', 'Green', 'Gold'][t] || 'Team ' + t;
    }
    // presence = a living, driven mech (or pilot on foot) of that combatant
    body(c) { return c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot && c.pilot.alive ? c.pilot : null; }
    timeLeft() { return Math.max(0, this.mode.timeLimit - this.game.matchTime); }
    // leader by score when the clock runs out (ties = no winner)
    byScore() {
      const ts = this.teams().map((t) => [t, this.teamScore(t)]).sort((a, b) => b[1] - a[1]);
      if (ts.length > 1 && ts[0][1] === ts[1][1]) return { winner: -1 };
      return { winner: ts[0][0] };
    }
    scoreBars(fmt) {
      return this.teams().sort((a, b) => this.teamScore(b) - this.teamScore(a)).slice(0, 4)
        .map((t) => `<span class="team-pill" style="background:${hex(this.teamColor(t))}">${this.teamName(t)} ${fmt(this.teamScore(t))}</span>`).join('');
    }
    clock() { const t = Math.ceil(this.timeLeft()); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  }

  // ======================= KING OF THE HILL =======================
  class KingOfTheHill extends Objective {
    start() {
      this.score = {};
      const g = new THREE.Group();
      this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 10, 40, 1, true), this.ringMat);
      wall.position.y = 5;
      g.add(wall);
      const floor = new THREE.Mesh(new THREE.RingGeometry(13.4, 14.2, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
      floor.position.y = 0.25;
      g.add(floor);
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), CW.mat(0xffd23f, { emissive: 0x7a5a00, metalness: 0.8 }));
      crown.position.y = 13;
      g.add(crown);
      this.crown = crown;
      this.zone = this.add(g);
      this.moveT = 0;
      this.moveZone(true);
    }
    // possible hill spots: safe ground toward the middle of the map (searched once per match)
    hillSpots() {
      if (this.spots) return this.spots;
      const w = this.game.world;
      const spots = [];
      for (let x = -120; x <= 120; x += 12) for (let z = -120; z <= 120; z += 12) {
        if (Math.hypot(x, z) < 125 && w.isSafeSpot(x, z)) spots.push(new V3(x, w.groundAt(x, z), z));
      }
      this.spots = spots.length >= 3 ? spots : w.landSpawns.slice();
      return this.spots;
    }
    // the hill jumps to a new spot at least 40 m away (or the farthest one if none is that far)
    moveZone(first) {
      const w = this.game.world;
      const pool = this.hillSpots();
      let p;
      if (this.zonePos) {
        const far = pool.filter((s) => s.distanceTo(this.zonePos) >= 40);
        p = far.length ? far[Math.floor(Math.random() * far.length)] : pool.reduce((a, b) => (b.distanceTo(this.zonePos) > a.distanceTo(this.zonePos) ? b : a));
      } else {
        // first hill: as central as possible
        p = pool.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[Math.floor(Math.random() * Math.min(4, pool.length))];
      }
      this.zonePos = new V3(p.x, w.groundAt(p.x, p.z), p.z);
      this.zone.position.copy(this.zonePos);
      this.moveT = 0;
      if (!first) { this.game.announce('👑 THE HILL MOVED', 'Check your minimap'); this.game.feed('👑 The hill moved!'); }
    }
    teamScore(t) { return Math.floor(this.score[t] || 0); }
    update(dt) {
      const g = this.game;
      this.crown.rotation.y += dt * 2;
      this.ringMat.color.setHex(this.contested ? 0xff4d6d : this.holder != null ? this.teamColor(this.holder) : 0xffffff);
      this.ringMat.opacity = 0.25 + Math.sin(g.time * 4) * 0.08;
      if (g.countdown > 0 || g.ended || g.net.client) return;
      this.moveT += dt;
      if (this.moveT > 60) this.moveZone();
      const inside = new Set();
      for (const c of g.combatants) {
        const b = c.alive && this.body(c);
        if (b && Math.hypot(b.pos.x - this.zonePos.x, b.pos.z - this.zonePos.z) < 14 && Math.abs(b.pos.y - this.zonePos.y) < 25) inside.add(c.team);
      }
      this.contested = inside.size > 1;
      this.holder = inside.size === 1 ? [...inside][0] : null;
      if (this.holder !== null) this.score[this.holder] = (this.score[this.holder] || 0) + dt * 2;
    }
    netState() {
      const sc = {};
      for (const t in this.score) sc[t] = r1(this.score[t]);
      return { z: [r1(this.zonePos.x), r1(this.zonePos.z)], s: sc, h: this.holder ?? null, c: this.contested ? 1 : 0 };
    }
    netApply(s, first) {
      if (Math.hypot(this.zonePos.x - s.z[0], this.zonePos.z - s.z[1]) > 1) {
        this.zonePos = new V3(s.z[0], this.game.world.groundAt(s.z[0], s.z[1]), s.z[1]);
        this.zone.position.copy(this.zonePos);
        if (!first && this.synced) { this.game.announce('👑 THE HILL MOVED', 'Check your minimap'); this.game.feed('👑 The hill moved!'); }
      }
      this.synced = true;
      this.score = s.s || {};
      this.holder = s.h ?? null;
      this.contested = !!s.c;
    }
    hud() {
      const st = this.contested ? '<span class="bad">CONTESTED</span>' : this.holder != null ? `${this.teamName(this.holder)} holding` : 'Nobody holds the hill';
      return `<b>👑 King of the Hill</b> · ${this.scoreBars((v) => v)} · ${st} · ${this.clock()}`;
    }
    botGoal(c) {
      const b = this.body(c);
      if (!b) return null;
      return Math.hypot(b.pos.x - this.zonePos.x, b.pos.z - this.zonePos.z) > 8 ? this.zonePos : null;
    }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.mode.scoreToWin) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      const [x, y] = toMap(this.zonePos.x, this.zonePos.z);
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
    }
    summary(c) { return `${this.teamScore(c.team)} hill points`; }
  }

  // ======================= GOLD RUSH =======================
  class GoldRush extends Objective {
    start() {
      this.gold = new Map(); // combatant -> gold carried
      this.nuggets = [];
      this.geo = new THREE.OctahedronGeometry(0.6, 0);
      this.mat = CW.mat(0xffd23f, { emissive: 0x8a6400, metalness: 0.9, roughness: 0.2 });
      this.nid = 1;
      if (!this.game.net.client) for (let i = 0; i < 28; i++) this.spawnNugget();
      this.timer = 0;
    }
    spawnNugget(at, netPos) {
      const w = this.game.world;
      let p = at;
      for (let tries = 0; !p && tries < 40; tries++) {
        const x = (Math.random() - 0.5) * 300, z = (Math.random() - 0.5) * 300;
        if (w.groundAt(x, z) > 1.5 && w.groundAt(x, z) < 35) p = new V3(x, 0, z);
      }
      if (!p && netPos) p = netPos;
      if (!p) return null;
      const m = new THREE.Mesh(this.geo, this.mat);
      const gy = Math.max(w.groundAt(p.x, p.z, 100), 0.5);
      m.position.set(p.x, gy + 1.2, p.z);
      m.castShadow = true;
      this.add(m);
      const n = { id: this.nid++, mesh: m, base: gy + 1.2, vel: at ? new V3((Math.random() - 0.5) * 10, 8, (Math.random() - 0.5) * 10) : null, delay: at ? 0.8 : 0 };
      this.nuggets.push(n);
      return n;
    }
    carried(c) { return this.gold.get(c) || 0; }
    teamScore(t) { let s = 0; for (const c of this.game.combatants) if (c.team === t) s += this.carried(c); return s; }
    update(dt) {
      const g = this.game;
      if (g.countdown > 0 || g.ended) return;
      const client = g.net.client;
      this.timer += dt;
      if (!client && this.timer > 12 && this.nuggets.length < 34) { this.timer = 0; for (let i = 0; i < 4; i++) this.spawnNugget(); }
      for (let i = this.nuggets.length - 1; i >= 0; i--) {
        const n = this.nuggets[i];
        n.mesh.rotation.y += dt * 3;
        if (n.vel) { // dropped nuggets fly out, then settle
          n.vel.y -= 22 * dt;
          n.mesh.position.addScaledVector(n.vel, dt);
          const gy = Math.max(g.world.groundAt(n.mesh.position.x, n.mesh.position.z, 100), 0.5) + 1.2;
          if (n.mesh.position.y < gy) { n.mesh.position.y = gy; n.base = gy; n.vel = null; }
        } else n.mesh.position.y = n.base + Math.sin(g.time * 3 + i) * 0.25;
        if (n.delay > 0) { n.delay -= dt; continue; }
        if (client) { if (n.target) { n.mesh.position.x += (n.target.x - n.mesh.position.x) * Math.min(1, dt * 8); n.mesh.position.z += (n.target.z - n.mesh.position.z) * Math.min(1, dt * 8); } continue; }
        for (const c of g.combatants) {
          const b = c.alive && this.body(c);
          if (!b) continue;
          const r = (b === c.mech ? c.mech.radius + 1 : 1.6) * CW.grabK(c); // Loot Magnet perk: twice as far
          if (b.pos.distanceTo(n.mesh.position) < r) {
            this.gold.set(c, this.carried(c) + 1);
            g.scene.remove(n.mesh);
            this.nuggets.splice(i, 1);
            if (c.isPlayer) { g.audio.tone(1200 + this.carried(c) * 10, 0.08, 'triangle', 0.12); g.bonusCoins += 1; }
            break;
          }
        }
      }
    }
    // wrecked mechs spill half their gold
    onWreck(victim) {
      if (this.game.net.client) return;
      const n = Math.ceil(this.carried(victim) / 2);
      if (!n) return;
      this.gold.set(victim, this.carried(victim) - n);
      const at = victim.mech.pos.clone();
      for (let i = 0; i < Math.min(n, 15); i++) this.spawnNugget(at.clone());
      if (victim.isPlayer) this.game.feed(`💰 You dropped ${n} gold!`, 'bad');
    }
    netState() {
      const gold = {};
      for (const [c, v] of this.gold) if (v) gold[c.netId] = v;
      return { n: this.nuggets.map((n) => [n.id, r1(n.mesh.position.x), r1(n.base), r1(n.mesh.position.z)]), g: gold };
    }
    netApply(s) {
      const g = this.game;
      const ids = new Set(s.n.map((a) => a[0]));
      for (let i = this.nuggets.length - 1; i >= 0; i--) {
        if (!ids.has(this.nuggets[i].id)) { g.scene.remove(this.nuggets[i].mesh); this.nuggets.splice(i, 1); }
      }
      const have = new Map(this.nuggets.map((n) => [n.id, n]));
      for (const [id, x, y, z] of s.n) {
        let n = have.get(id);
        if (!n) { n = this.spawnNugget(null, new V3(x, 0, z)); if (!n) continue; n.id = id; }
        n.base = y;
        n.target = { x, z };
      }
      const before = this.carried(g.player);
      this.gold = new Map();
      for (const id in s.g) { const c = g.net.byId.get(+id); if (c) this.gold.set(c, s.g[id]); }
      const now = this.carried(g.player);
      if (now > before) { g.audio.tone(1200 + now * 10, 0.08, 'triangle', 0.12); g.bonusCoins += now - before; }
      else if (now < before) g.feed(`💰 You dropped ${before - now} gold!`, 'bad');
    }
    hud() {
      const me = this.carried(this.game.player);
      return `<b>💰 Gold Rush</b> · You carry <b>${me}</b> · ${this.scoreBars((v) => v + '🟡')} · ${this.clock()}`;
    }
    botGoal(c) {
      const b = this.body(c);
      if (!b) return null;
      let best = null, bd = 90;
      for (const n of this.nuggets) { const d = n.mesh.position.distanceTo(b.pos); if (d < bd) { bd = d; best = n.mesh.position; } }
      return best;
    }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.mode.scoreToWin) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      ctx.fillStyle = '#ffd23f';
      for (const n of this.nuggets) { const [x, y] = toMap(n.mesh.position.x, n.mesh.position.z); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    }
    summary(c) { return `${this.carried(c)} gold`; }
  }

  // ======================= COMBAT RACE =======================
  class CombatRace extends Objective {
    start() {
      const w = this.game.world;
      // a loop of checkpoints around the arena on safe ground
      this.cps = [];
      const N = 8;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        let pos = null;
        for (const r of [105, 90, 120, 75, 135, 60]) {
          for (const da of [0, 0.12, -0.12, 0.25, -0.25]) {
            const x = Math.cos(a + da) * r, z = Math.sin(a + da) * r;
            if (w.isSafeSpot(x, z)) { pos = new V3(x, w.groundAt(x, z), z); break; }
          }
          if (pos) break;
        }
        if (!pos) { const x = Math.cos(a) * 100, z = Math.sin(a) * 100; pos = new V3(x, Math.max(w.groundAt(x, z), 2), z); }
        this.cps.push(pos);
      }
      this.rings = this.cps.map((p, i) => {
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffffff : 0x4cc9f0, transparent: true, opacity: 0.55 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 40), mat);
        ring.position.y = 9;
        g.add(ring);
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 18, 8), CW.mat(i === 0 ? 0xffffff : 0x3a86ff, null, 'hazard'));
          post.position.set(s * 10, 9, 0);
          g.add(post);
        }
        g.position.copy(p);
        const next = this.cps[(i + 1) % this.cps.length];
        g.rotation.y = Math.atan2(next.x - p.x, next.z - p.z) + Math.PI / 2;
        this.add(g);
        return { g, mat };
      });
      this.prog = new Map(); // combatant -> { cp, lap, done, t }
      this.finishOrder = [];
    }
    // racers start lined up on the first checkpoint, facing the second
    spawn() {
      const g = this.game;
      const a = this.cps[0], b = this.cps[1];
      const dir = b.clone().sub(a).setY(0).normalize();
      const side = new V3(-dir.z, 0, dir.x);
      g.combatants.forEach((c, i) => {
        const row = Math.floor(i / 3), col = (i % 3) - 1;
        let p = a.clone().addScaledVector(dir, -6 - row * 9).addScaledVector(side, col * 8);
        if (!g.world.isSafeSpot(p.x, p.z)) p = g.safeNear(a, i, []);
        c.mech.place(p, Math.atan2(-dir.x, -dir.z));
        c.mech.protect = 3.5;
        this.prog.set(c, { cp: 1, lap: 1, done: false });
      });
    }
    p(c) { return this.prog.get(c) || { cp: 1, lap: 1 }; }
    progress(c) { const p = this.p(c); return p.done ? 1e6 - p.place : (p.lap - 1) * this.cps.length + p.cp; }
    teamScore(t) { let s = 0; for (const c of this.game.combatants) if (c.team === t) s = Math.max(s, this.progress(c)); return s; }
    rank(c) { return this.game.combatants.filter((o) => this.progress(o) > this.progress(c)).length + 1; }
    update(dt) {
      const g = this.game;
      if (g.countdown > 0 || g.ended) return;
      const laps = this.mode.laps;
      for (const c of g.net.client ? [] : g.combatants) {
        const st = this.p(c);
        const b = c.alive && !st.done && this.body(c);
        if (!b) continue;
        const cp = this.cps[st.cp % this.cps.length];
        // bots that make no progress for 30 s get put back on track at their next checkpoint
        if (st.t === undefined) st.t = g.matchTime;
        if (!c.human && g.net.owns(c) && b === c.mech && g.matchTime - st.t > 30) {
          st.t = g.matchTime;
          c.mech.place(g.safeNear(cp, Math.floor(Math.random() * 4), []), c.mech.yaw);
          c.mech.vel.set(0, 0, 0);
        }
        if (Math.hypot(b.pos.x - cp.x, b.pos.z - cp.z) < 12 && b.pos.y - cp.y < 30) {
          if (st.cp % this.cps.length === 0) { // crossed the start line
            if (st.lap >= laps) {
              st.done = true;
              st.place = this.finishOrder.length + 1;
              this.finishOrder.push(c);
              g.feed(`🏁 ${c.isPlayer ? 'You' : c.name} finished #${st.place}!`, c.isPlayer ? 'good' : '');
              if (c.isPlayer) g.announce(`🏁 FINISHED #${st.place}`, '');
              continue;
            }
            st.lap++;
            if (c.isPlayer) g.announce(`LAP ${st.lap} / ${laps}`, 'Keep going!');
          }
          st.cp++;
          st.t = g.matchTime;
          if (c.isPlayer) { g.audio.click(1.6); g.fx.burst(b.pos, { n: 14, color: g.fx.colorKey(0x4cc9f0), speed: 6, life: 0.5, size: 0.3 }); }
        }
      }
      // highlight the player's next checkpoint
      const next = this.p(g.player).cp % this.cps.length;
      this.rings.forEach((r, i) => { r.mat.color.setHex(i === next ? 0xffd23f : i === 0 ? 0xffffff : 0x4cc9f0); r.mat.opacity = i === next ? 0.85 : 0.35; });
    }
    netState() {
      const p = {};
      for (const [c, st] of this.prog) p[c.netId] = [st.cp, st.lap, st.done ? 1 : 0, st.place || 0];
      return { p, f: this.finishOrder.map((c) => c.netId) };
    }
    netApply(s, first) {
      const g = this.game;
      for (const id in s.p) {
        const c = g.net.byId.get(+id);
        if (!c) continue;
        const a = s.p[id];
        const old = this.prog.get(c);
        const st = { cp: a[0], lap: a[1], done: !!a[2], place: a[3] || undefined };
        this.prog.set(c, st);
        if (first || !old) continue;
        if (st.done && !old.done) {
          g.feed(`🏁 ${c.isPlayer ? 'You' : c.name} finished #${st.place}!`, c.isPlayer ? 'good' : '');
          if (c.isPlayer) g.announce(`🏁 FINISHED #${st.place}`, '');
        } else if (c.isPlayer && st.lap > old.lap) g.announce(`LAP ${st.lap} / ${this.mode.laps}`, 'Keep going!');
        if (c.isPlayer && st.cp > old.cp) {
          const b = this.body(c);
          g.audio.click(1.6);
          if (b) g.fx.burst(b.pos, { n: 14, color: g.fx.colorKey(0x4cc9f0), speed: 6, life: 0.5, size: 0.3 });
        }
      }
      this.finishOrder = (s.f || []).map((id) => g.net.byId.get(id)).filter(Boolean);
    }
    hud() {
      const st = this.p(this.game.player);
      const n = this.cps.length;
      const pos = this.rank(this.game.player);
      return `<b>🏁 Combat Race</b> · Lap <b>${Math.min(st.lap, this.mode.laps)}/${this.mode.laps}</b> · Checkpoint ${((st.cp - 1) % n) + 1}/${n} · Position <b>${pos}${['st', 'nd', 'rd'][pos - 1] || 'th'}</b> · ${this.clock()}`;
    }
    botGoal(c) { const st = this.p(c); return st.done ? null : this.cps[st.cp % this.cps.length]; }
    respawnSpot(c) { const st = this.p(c); const last = this.cps[(st.cp - 1 + this.cps.length) % this.cps.length]; return this.game.safeNear(last, Math.floor(Math.random() * 4), []); }
    check() {
      if (this.finishOrder.length) {
        // everyone gets 20 s after the winner, then the race ends
        this.endT = this.endT === undefined ? 20 : this.endT - 1 / 60;
        if (this.endT <= 0 || this.finishOrder.length >= Math.min(3, this.game.combatants.length)) return { winner: this.finishOrder[0].team };
      }
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      const next = this.p(this.game.player).cp % this.cps.length;
      this.cps.forEach((p, i) => {
        const [x, y] = toMap(p.x, p.z);
        ctx.strokeStyle = i === next ? '#ffd23f' : '#4cc9f0'; ctx.lineWidth = i === next ? 3 : 1.5;
        ctx.beginPath(); ctx.arc(x, y, i === next ? 5 : 3, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.lineWidth = 1;
    }
    summary(c) { const st = this.p(c); return st.done ? `finished #${st.place}` : `lap ${st.lap}, checkpoint ${st.cp}`; }
  }

  // ======================= BOSS BATTLE =======================
  // A giant procedurally built Titan with boosted armor, plus waves of minions.
  CW.makeTitan = function () {
    const parts = [];
    const add = (t, x, y, z) => parts.push({ t, x, y, z });
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) add(Math.abs(x) === 3 || Math.abs(z) === 3 ? 'armor' : 'frame', x, 0, z);
    parts.splice(parts.findIndex((p) => p.x === 0 && p.y === 0 && p.z === 0), 1, { t: 'core', x: 0, y: 0, z: 0 });
    for (const [x, z] of [[-4, -3], [4, -3], [-4, 0], [4, 0], [-4, 3], [4, 3]]) add('leg', x, 0, z);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) add(Math.abs(x) === 2 || Math.abs(z) === 2 ? 'armor' : 'engine', x, 1, z);
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) add('cannon', x, 2, z);
    for (const [x, z] of [[-1, -2], [1, -2]]) add('rocket', x, 2, z);
    add('laser', 0, 2, -1); add('railgun', 0, 2, 1);
    for (const [x, z] of [[-1, 0], [1, 0]]) add('shield', x, 2, z);
    add('flamer', 0, 1, -3); add('saw', -2, 0, -4); add('saw', 2, 0, -4);
    add('horn', -1, 2, -1); add('horn', 1, 2, -1); add('flag', 0, 2, 2);
    return { name: 'TITAN', parts };
  };

  class BossBattle extends Objective {
    start() {
      const g = this.game;
      if (g.net.client) { // online: the Titan came in the host's roster
        this.boss = g.combatants.find((c) => c.ai.style === 'boss');
        this.maxHp = this.boss.mech.parts.reduce((s, p) => s + p.maxHp, 0);
        this.phase = 0;
        g.announce('👹 THE TITAN AWAKENS', 'Destroy its core to win!');
        return;
      }
      const me = g.player.mech.pos;
      const spots = g.world.landSpawns.slice().sort((a, b) => b.distanceTo(me) - a.distanceTo(me));
      const at = spots[Math.min(2, spots.length - 1)];
      this.boss = g.addCombatant({ name: 'TITAN', isPlayer: false, color: 0x8b0000, bp: CW.makeTitan(), ai: 'boss', team: 1 });
      const m = this.boss.mech;
      m.dmgTaken = 1.5; // big target: every hit counts extra
      m.baseDmg = 0.22;
      m.place(at, Math.atan2(at.x - me.x, at.z - me.z));
      this.boss.ai.pref = 30;
      this.boss.ai.jitter = 1.6;
      this.maxHp = m.parts.reduce((s, p) => s + p.maxHp, 0);
      this.minionT = 20;
      this.phase = 0;
      g.buildTags();
      g.announce('👹 THE TITAN AWAKENS', 'Destroy its core to win!');
    }
    // shown health: the Titan collapses when its structure drops to 40%, so 40% raw = 0% on the bar
    bossHp() {
      const m = this.boss.mech;
      if (!m.alive) return 0;
      const raw = m.parts.reduce((s, p) => s + (p.alive ? p.hp : 0), 0) / this.maxHp;
      return Math.max(0, (raw - 0.4) / 0.6);
    }
    teamScore(t) { return t === 0 ? Math.round((1 - this.bossHp()) * 100) : Math.round(this.bossHp() * 100); }
    netState() { return { ph: this.phase }; }
    netApply(s) {
      if (s.ph > this.phase) this.game.announce(s.ph === 2 ? '👹 TITAN IS ENRAGED!' : '👹 THE TITAN GROWS ANGRY', 'Minions incoming!');
      this.phase = s.ph;
    }
    update(dt) {
      const g = this.game;
      if (g.countdown > 0 || g.ended || !this.boss.alive || g.net.client) return;
      const hp = this.bossHp();
      if (hp <= 0 && this.boss.mech.alive) { this.boss.mech.destroy(this.lastHitter()); return; } // structural collapse
      const phase = hp < 0.33 ? 2 : hp < 0.66 ? 1 : 0;
      if (phase > this.phase) {
        this.phase = phase;
        this.boss.mech.baseDmg = 0.22 + phase * 0.1;
        g.announce(phase === 2 ? '👹 TITAN IS ENRAGED!' : '👹 THE TITAN GROWS ANGRY', 'Minions incoming!');
        this.minionT = 0;
      }
      this.minionT -= dt;
      if (this.minionT <= 0) {
        this.minionT = 30 - this.phase * 6;
        const n = 1 + this.phase;
        const pool = CW.PRESETS.filter((p) => p.bot && !(CW.analyze(p.parts).domains.has('water') && CW.analyze(p.parts).domains.size === 1));
        for (let i = 0; i < n; i++) {
          const preset = pool[Math.floor(Math.random() * pool.length)];
          const c = g.addCombatant({ name: 'Minion', isPlayer: false, color: 0xc1121f, bp: CW.mutateBp(preset, CW.BUDGET, 3), ai: preset.ai, team: 1 });
          c.minion = true;
          const at = g.safeNear(this.boss.mech.pos, i + 1, []);
          c.mech.place(at, this.boss.mech.yaw);
        }
        g.buildTags();
        g.feed(`👹 ${n} minion${n > 1 ? 's' : ''} joined the Titan`, 'bad');
      }
    }
    lastHitter() { return this.boss.mech.lastHitBy || this.game.player; }
    hud() {
      const hp = this.bossHp();
      return `<b>👹 Boss Battle</b> · TITAN <span class="boss-bar"><i style="width:${hp * 100}%"></i></span> ${Math.round(hp * 100)}% · ${this.clock()}`;
    }
    botGoal() { return null; }
    check() {
      if (!this.boss.alive || !this.boss.mech.alive) return { winner: 0 };
      if (!this.game.combatants.some((c) => c.team === 0 && c.alive)) return { winner: 1 };
      if (this.timeLeft() <= 0) return { winner: 1 };
      return null;
    }
    minimap() {}
    summary() { return `Titan at ${Math.round(this.bossHp() * 100)}%`; }
  }

  // ======================= BOUNTY HUNT =======================
  // Wreck an enemy to win the stars on their head for your team. Each wreck in a row raises YOUR bounty
  // (up to 7), and being wrecked resets it to 1, so streaks are worth a lot and risky to carry.
  class BountyHunt extends Objective {
    start() { this.score = {}; this.bounty = new Map(); }
    stars(c) { return this.bounty.get(c) || 1; }
    teamScore(t) { return this.score[t] | 0; }
    onWreck(victim, who) {
      const g = this.game;
      if (g.net.client || g.ended || !who || who === victim || CW.sameTeam(who, victim)) return;
      const n = this.stars(victim);
      this.score[who.team] = this.teamScore(who.team) + n;
      this.bounty.set(who, Math.min(7, this.stars(who) + 1));
      this.bounty.set(victim, 1);
      if (who.isPlayer) g.feed(`🎯 +${n} star${n > 1 ? 's' : ''}! Your bounty is now ⭐${this.stars(who)}`, 'good');
      else if (n >= 3) g.feed(`🎯 ${who.name} cashed a ⭐${n} bounty`);
    }
    update() {}
    netState() {
      const b = {};
      for (const [c, v] of this.bounty) if (v > 1) b[c.netId] = v;
      return { s: this.score, b };
    }
    netApply(s) {
      const g = this.game;
      const mine = this.stars(g.player);
      this.score = s.s || {};
      this.bounty = new Map();
      for (const id in s.b || {}) { const c = g.net.byId.get(+id); if (c) this.bounty.set(c, s.b[id]); }
      if (this.stars(g.player) > mine && this.stars(g.player) >= 3) g.feed(`🎯 Your bounty is ⭐${this.stars(g.player)}. Stay alive!`, 'good');
    }
    hud() { return `<b>🎯 Bounty Hunt</b> · ${this.scoreBars((v) => '⭐' + v)} · Your bounty <b>⭐${this.stars(this.game.player)}</b> · ${this.clock()}`; }
    botGoal() { return null; }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.mode.scoreToWin) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap() {}
    summary(c) { return `${this.teamScore(c.team)} stars`; }
  }

  // ======================= v1.10: two-team helpers =======================
  // the two team bases the host's game picked (game.teamBases), as flat safe spots; online they come in netState
  const baseSpots = (g) => {
    const w = g.world;
    return [0, 1].map((t) => {
      const b = (g.teamBases && g.teamBases[t]) || w.landSpawns[t % w.landSpawns.length];
      const p = w.isSafeSpot(b.x, b.z) ? b : g.safeSpotNear ? g.safeSpotNear(b) : b;
      return new V3(p.x, w.groundAt(p.x, p.z), p.z);
    });
  };
  const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // ======================= CORE HEIST =======================
  // Each team has a power core at its base. Touch the enemy core to grab it and bring it to your own base while
  // your own core is at home: a capture. A carrier is slower and glows; wreck them and the core drops. Touch your
  // dropped core to send it home (it also goes home by itself after 25 s). 3 captures win.
  class CoreHeist extends Objective {
    start() {
      this.score = {};
      this.bases = this.game.net.client ? baseSpots(this.game) : this.farBases();
      this.cores = [0, 1].map((t) => this.makeCore(t));
      this.synced = false;
    }
    // v1.10.1: the two bases about 190 m apart on every arena (they used to be 75-250 m apart, so some matches were over in
    // seconds), chosen from the arena's safe spots
    farBases() {
      const g = this.game, sp = g.world.landSpawns;
      const pairs = [];
      for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) pairs.push([sp[i], sp[j], Math.abs(sp[i].distanceTo(sp[j]) - 190)]);
      if (!pairs.length) return baseSpots(g);
      pairs.sort((a, b) => a[2] - b[2]);
      const ok = pairs.filter((p) => p[2] <= pairs[0][2] + 15);
      const [a, b] = ok[Math.floor(Math.random() * ok.length)];
      return [a, b].map((p) => new V3(p.x, g.world.groundAt(p.x, p.z), p.z));
    }
    // each team starts at its own base
    spawn() {
      const g = this.game, used = [], n = {};
      for (const c of g.combatants) {
        if (!c.mech || !this.bases[c.team]) continue;
        const k = (n[c.team] = (n[c.team] || 0) + 1) - 1;
        const p = g.safeNear(this.bases[c.team], k + 1, used);
        used.push(p);
        const o = this.bases[1 - c.team];
        c.mech.place(p, Math.atan2(p.x - o.x, p.z - o.z));
        c.mech.protect = 3.5;
      }
    }
    makeCore(t) {
      const col = CW.TEAMS[t].color;
      const base = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.4, 32), CW.mat(0x2b2d42, { metalness: 0.6 }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(8.2, 9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.position.y = 0.25;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 2, 10), CW.mat(0x495057, { metalness: 0.7 }));
      ped.position.y = 1.2;
      base.add(pad, ring, ped);
      base.position.copy(this.bases[t]);
      this.add(base);
      const gem = new THREE.Group();
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), CW.mat(col, { emissive: CW.shade(col, -0.25), metalness: 0.4, roughness: 0.2 }));
      crystal.scale.y = 1.5;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
      gem.add(crystal, glow);
      this.add(gem);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 50, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 25;
      gem.add(beam);
      return { t, base, gem, crystal, pos: this.bases[t].clone().setY(this.bases[t].y + 3.4), carrier: null, home: true, dropT: 0 };
    }
    teamScore(t) { return this.score[t] | 0; }
    home(core) { core.home = true; core.carrier = null; core.pos.copy(this.bases[core.t]).setY(this.bases[core.t].y + 3.4); }
    carrying(c) { return this.cores.find((k) => k.carrier === c) || null; }
    update(dt) {
      const g = this.game;
      for (const k of this.cores) {
        const b = k.carrier && this.body(k.carrier);
        if (b) k.pos.copy(b.pos).setY(b.pos.y + (b === k.carrier.mech ? k.carrier.mech.radius + 2.2 : 3));
        k.gem.position.copy(k.pos);
        k.crystal.rotation.y += dt * 2;
        k.gem.position.y += Math.sin(g.time * 3 + k.t) * 0.2;
      }
      for (const c of g.combatants) c.carrying = !!this.carrying(c); // slows the carrier (js/entities.js)
      if (g.countdown > 0 || g.ended || g.net.client) return;
      for (const k of this.cores) {
        // the carrier was wrecked: the core drops where it was
        if (k.carrier && (!k.carrier.alive || !this.body(k.carrier) || (k.carrier.mech && !k.carrier.mech.alive && !(k.carrier.pilot && k.carrier.pilot.alive)))) {
          const who = k.carrier;
          k.carrier = null;
          k.dropT = 25;
          k.pos.y = Math.max(g.world.groundAt(k.pos.x, k.pos.z, k.pos.y), CW.WATER_Y) + 2;
          g.feed(`🔋 ${who.isPlayer ? 'You' : CW.esc(who.name)} dropped ${this.teamName(k.t)}'s core!`);
        }
        if (!k.home && !k.carrier) { k.dropT -= dt; if (k.dropT <= 0) { this.home(k); g.feed(`🔋 ${this.teamName(k.t)}'s core went home`); } }
        if (k.carrier) continue;
        for (const c of g.combatants) {
          const b = c.alive && this.body(c);
          if (!b || flatDist(b.pos, k.pos) > (b === c.mech ? c.mech.radius + 2.5 : 2.5) || Math.abs(b.pos.y - k.pos.y) > 8) continue;
          if (c.team !== k.t && !this.carrying(c)) {
            k.carrier = c; k.home = false;
            g.feed(`🔋 ${c.isPlayer ? 'You' : CW.esc(c.name)} grabbed ${this.teamName(k.t)}'s core!`, c.team === g.player.team ? 'good' : 'bad');
            if (c.isPlayer) g.announce('🔋 YOU HAVE THE CORE', 'Bring it to your base!');
            else if (k.t === g.player.team) g.announce('🔋 YOUR CORE WAS STOLEN', 'Wreck the carrier!');
            break;
          }
          if (c.team === k.t && !k.home) { this.home(k); g.feed(`🔋 ${c.isPlayer ? 'You' : CW.esc(c.name)} saved ${this.teamName(k.t)}'s core`, 'good'); break; }
        }
      }
      // a carrier at its own base, with its own core at home: capture
      for (const k of this.cores) {
        const c = k.carrier;
        if (!c) continue;
        const mine = this.cores[c.team];
        const b = this.body(c);
        if (b && mine && mine.home && flatDist(b.pos, this.bases[c.team]) < 9.5) {
          this.score[c.team] = this.teamScore(c.team) + 1;
          this.home(k);
          g.announce(`🔋 ${this.teamName(c.team).toUpperCase()} CAPTURES!`, `${c.isPlayer ? 'You' : c.name} brought the core home · ${this.teamScore(0)} - ${this.teamScore(1)}`);
          g.feed(`🔋 ${c.isPlayer ? 'You' : CW.esc(c.name)} captured the core!`, c.team === g.player.team ? 'good' : 'bad');
          if (c.isPlayer) { g.bonusCoins += 20; if (!g.isPractice()) g.meta.track('heist'); }
        }
      }
    }
    netState() {
      return { b: this.bases.map((p) => [r1(p.x), r1(p.z)]), k: this.cores.map((k) => [r1(k.pos.x), r1(k.pos.y), r1(k.pos.z), k.carrier ? k.carrier.netId : -1, k.home ? 1 : 0]), s: this.score };
    }
    netApply(s) {
      const g = this.game;
      if (s.b && !this.synced) {
        this.synced = true;
        s.b.forEach(([x, z], t) => { const p = new V3(x, g.world.groundAt(x, z), z); this.bases[t] = p; this.cores[t].base.position.copy(p); });
      }
      const before = { ...this.score };
      this.score = s.s || {};
      (s.k || []).forEach(([x, y, z, cid, home], t) => {
        const k = this.cores[t];
        if (!k) return;
        const was = k.carrier;
        k.carrier = cid >= 0 ? g.net.byId.get(cid) || null : null;
        k.home = !!home;
        if (!k.carrier) k.pos.set(x, y, z);
        if (k.carrier && k.carrier !== was) {
          if (k.carrier.isPlayer) g.announce('🔋 YOU HAVE THE CORE', 'Bring it to your base!');
          else if (k.t === g.player.team) g.announce('🔋 YOUR CORE WAS STOLEN', 'Wreck the carrier!');
        }
      });
      for (const t of [0, 1]) if ((this.score[t] | 0) > (before[t] | 0)) g.announce(`🔋 ${this.teamName(t).toUpperCase()} CAPTURES!`, `${this.teamScore(0)} - ${this.teamScore(1)}`);
    }
    hud() {
      const my = this.cores[this.game.player.team];
      const st = !my ? '' : my.home ? 'Your core is safe' : my.carrier ? '<span class="bad">Your core was stolen!</span>' : '<span class="bad">Your core is on the ground</span>';
      const have = this.carrying(this.game.player) ? ' · <b>You carry the core: go home!</b>' : '';
      return `<b>🔋 Core Heist</b> · ${this.scoreBars((v) => v)} · ${st}${have} · ${this.clock()}`;
    }
    urgent(c) { return !!this.carrying(c); }
    botGoal(c) {
      const b = this.body(c);
      if (!b) return null;
      if (this.carrying(c)) return this.bases[c.team];
      const mine = this.cores[c.team], theirs = this.cores[1 - c.team];
      if (mine && !mine.home) return mine.pos; // get our core back
      if (theirs && !theirs.carrier && (c.netId % 3 !== 0)) return theirs.pos; // most go for theirs, a third stays to fight
      if (theirs && theirs.carrier && theirs.carrier.team === c.team) { const cb = this.body(theirs.carrier); return cb ? cb.pos : null; } // escort
      return null;
    }
    respawnSpot(c) { return this.game.safeNear(this.bases[c.team] || this.game.world.landSpawns[0], Math.floor(Math.random() * 5), []); }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.mode.scoreToWin) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      for (const k of this.cores) {
        const [bx, by] = toMap(this.bases[k.t].x, this.bases[k.t].z);
        ctx.strokeStyle = hex(CW.TEAMS[k.t].color); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.stroke();
        const [x, y] = toMap(k.pos.x, k.pos.z);
        ctx.fillStyle = hex(CW.TEAMS[k.t].color); ctx.strokeStyle = '#fff';
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore();
        ctx.lineWidth = 1;
      }
    }
    summary(c) { return `${this.teamScore(c.team)} capture${this.teamScore(c.team) === 1 ? '' : 's'}`; }
  }

  // ======================= MECH BALL =======================
  // A giant ball on the Mech Ball Stadium's pitch (v1.10.1) and a real goal at each end (posts, crossbar, net).
  // Push it, ram it, dash into it or shoot it into the other team's goal. The host's game runs the ball (the others
  // run the same physics too, so it moves smoothly, and follow the host's ball). First to 5 goals.
  const BALL_R = 3.2;
  class MechBall extends Objective {
    start() {
      const g = this.game, ST = CW.STADIUM;
      this.score = {};
      this.stadium = !!g.world.arena.stadium;
      if (this.stadium) {
        this.goals = [new V3(-(ST.L + ST.goalD / 2), ST.y, 0), new V3(ST.L + ST.goalD / 2, ST.y, 0)];
        this.center = new V3(0, ST.y, 0);
      } else {
        this.goals = baseSpots(g);
        this.center = this.midSpot();
      }
      const mat = CW.mat(0xf1f3f5, { metalness: 0.3, roughness: 0.35 }, 'panel');
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18), mat);
      this.ball.castShadow = true;
      for (let k = 0; k < 3; k++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.005, 0.16, 6, 40), CW.mat(0x5ce1ff, { emissive: 0x0b5c73 }));
        band.rotation.set(k === 0 ? Math.PI / 2 : 0, k === 1 ? Math.PI / 2 : 0, 0);
        this.ball.add(band);
      }
      this.add(this.ball);
      // a shadow-like ring on the ground under the ball, so you can see where it will land
      this.mark = this.add(new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.7, BALL_R, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })));
      this.pos = this.center.clone().setY(this.center.y + BALL_R + 8);
      this.vel = new V3();
      this.freeze = 0;
      this.goalMeshes = [0, 1].map((t) => this.makeGoal(t));
      this.netRate = 0.1; // the ball's position goes out 10 times a second
    }
    midSpot() {
      const g = this.game, w = g.world;
      const m = this.goals[0].clone().add(this.goals[1]).multiplyScalar(0.5);
      const p = w.isSafeSpot(m.x, m.z) ? m : g.safeSpotNear ? g.safeSpotNear(m) : m;
      return new V3(p.x, w.groundAt(p.x, p.z), p.z);
    }
    makeGoal(t) {
      const col = CW.TEAMS[t].color;
      const grp = new THREE.Group();
      const ST = CW.STADIUM;
      if (this.stadium) {
        const sx = t === 0 ? -1 : 1, H = 9;
        const white = CW.mat(0xf1faee, { metalness: 0.3 });
        for (const sz of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, H, 12), white); post.position.set(sx * ST.L, ST.y + H / 2, sz * ST.goalW); grp.add(post); }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, ST.goalW * 2, 12), white);
        bar.rotation.x = Math.PI / 2; bar.position.set(sx * ST.L, ST.y + H, 0); grp.add(bar);
        // the net: see-through panels in the team's color at the back, sides and top of the goal
        const net = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(ST.goalW * 2, H), net); back.rotation.y = Math.PI / 2; back.position.set(sx * (ST.L + ST.goalD), ST.y + H / 2, 0);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(ST.goalD, ST.goalW * 2), net); top.rotation.x = Math.PI / 2; top.position.set(sx * (ST.L + ST.goalD / 2), ST.y + H, 0);
        grp.add(back, top);
        for (const sz of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(ST.goalD, H), net); side.position.set(sx * (ST.L + ST.goalD / 2), ST.y + H / 2, sz * ST.goalW); grp.add(side); }
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(ST.goalD, ST.goalW * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false }));
        fill.position.set(sx * (ST.L + ST.goalD / 2), ST.y + 0.08, 0);
        grp.add(fill);
        this.add(grp);
        return { grp, fill };
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(8, 9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      ring.position.y = 0.25;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
      fill.position.y = 0.2;
      grp.add(ring, fill);
      grp.position.copy(this.goals[t]);
      this.add(grp);
      return { grp, fill };
    }
    teamScore(t) { return this.score[t] | 0; }
    // the ball is in team t's goal
    goalIn(t) {
      const ST = CW.STADIUM, p = this.pos;
      if (this.stadium) return (t === 0 ? p.x < -(ST.L + 1) : p.x > ST.L + 1) && Math.abs(p.z) < ST.goalW && p.y < ST.y + 9;
      return flatDist(p, this.goals[t]) < 8 && p.y - this.goals[t].y < 12;
    }
    // a shot that touches the ball pushes it (and stops there)
    ballHit(p) {
      if (!this.ball || p.kind === 'flame') return false;
      const a = p.prev, b = p.pos, ab = b.clone().sub(a), L2 = ab.lengthSq() || 1e-6;
      const t = Math.max(0, Math.min(1, this.pos.clone().sub(a).dot(ab) / L2));
      if (a.clone().addScaledVector(ab, t).distanceTo(this.pos) > BALL_R + 0.3) return false;
      if (this.freeze <= 0) {
        this.vel.addScaledVector(p.vel.clone().normalize(), Math.max(2, Math.min(16, (p.dmg || 4) * 0.5)));
        this.vel.y += 1.5;
      }
      this.game.fx.burst(a.clone().addScaledVector(ab, t), { n: 5, color: 'spark', speed: 6, life: 0.25, size: 0.15 });
      return true;
    }
    // bounce off something with this outward normal (n points away from it)
    bounce(n, e) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -(1 + e) * vn);
    }
    physics(dt) {
      const g = this.game, w = g.world, ST = CW.STADIUM;
      const grav = CW.GRAV * 0.8 * ((g.mods && g.mods.grav) || 1) * (CW.arena.grav || 1);
      const hAt = (x, z, y) => w.groundAt(x, z, y);
      const steps = Math.min(6, Math.max(1, Math.ceil((this.vel.length() * dt) / 0.8)));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        this.vel.y -= grav * h;
        const nx = this.pos.x + this.vel.x * h, nz = this.pos.z + this.vel.z * h;
        const here = hAt(this.pos.x, this.pos.z, this.pos.y), there = hAt(nx, nz, this.pos.y);
        if (there > here + 1.2 && there > this.pos.y - BALL_R * 0.5) {
          // a wall: bounce back off it (its normal from the slope of the ground there)
          const gx = hAt(nx - 1, nz, this.pos.y) - hAt(nx + 1, nz, this.pos.y), gz = hAt(nx, nz - 1, this.pos.y) - hAt(nx, nz + 1, this.pos.y);
          const n = new V3(gx, 0, gz);
          if (n.lengthSq() < 1e-6) n.set(-this.vel.x, 0, -this.vel.z);
          this.bounce(n.normalize(), 0.7);
        } else { this.pos.x = nx; this.pos.z = nz; }
        this.pos.y += this.vel.y * h;
        const gy = hAt(this.pos.x, this.pos.z, this.pos.y);
        if (this.pos.y - BALL_R < gy) {
          this.pos.y = gy + BALL_R;
          this.vel.y = this.vel.y < -3 ? -this.vel.y * 0.5 : Math.max(0, this.vel.y);
          // rolling: a little friction, and it rolls down slopes
          const f = Math.exp(-0.45 * h);
          this.vel.x *= f; this.vel.z *= f;
          this.vel.x += (hAt(this.pos.x - 1, this.pos.z) - hAt(this.pos.x + 1, this.pos.z)) * grav * 0.25 * h;
          this.vel.z += (hAt(this.pos.x, this.pos.z - 1) - hAt(this.pos.x, this.pos.z + 1)) * grav * 0.25 * h;
        }
        // the goal frames: posts and crossbar
        if (this.stadium) {
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const d = new V3(this.pos.x - sx * ST.L, 0, this.pos.z - sz * ST.goalW), l = d.length();
              if (l < BALL_R + 0.5 && this.pos.y < ST.y + 9.5 && l > 1e-3) { d.divideScalar(l); this.pos.addScaledVector(d, BALL_R + 0.5 - l); this.bounce(d, 0.6); }
            }
            const bar = new V3(this.pos.x - sx * ST.L, this.pos.y - (ST.y + 9), 0), bl = bar.length();
            if (Math.abs(this.pos.z) < ST.goalW && bl < BALL_R + 0.5 && bl > 1e-3) { bar.divideScalar(bl); this.pos.addScaledVector(bar, BALL_R + 0.5 - bl); this.bounce(bar, 0.6); }
          }
        }
      }
      if (this.pos.y < CW.WATER_Y + BALL_R * 0.4) { this.vel.y += 40 * dt; this.vel.multiplyScalar(Math.exp(-1.5 * dt)); } // it floats
      this.vel.multiplyScalar(Math.exp(-0.06 * dt)); // air
      const H = CW.ARENA_HALF - BALL_R;
      for (const ax of ['x', 'z']) if (Math.abs(this.pos[ax]) > H) { this.pos[ax] = Math.sign(this.pos[ax]) * H; this.vel[ax] *= -0.6; }
      if (this.vel.length() > 65) this.vel.setLength(65);
    }
    // mechs push it: a bounce off the mech (its speed counts), so a dash or a ram sends it flying
    touch() {
      const g = this.game;
      for (const m of g.mechs) {
        if (!m.alive) continue;
        const r = m.radius * 0.72, d = this.pos.clone().sub(m.pos), dist = d.length();
        if (dist > BALL_R + r || dist < 1e-3) continue;
        const n = d.divideScalar(dist);
        if (n.y < -0.2) n.y = -0.2; // under a mech: it squeezes out sideways, not into the ground
        n.normalize();
        this.pos.copy(m.pos).addScaledVector(n, BALL_R + r);
        const vrel = this.vel.clone().sub(m.vel), vn = vrel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -1.55 * vn);
        this.vel.addScaledVector(n, 2.5);
        const sp = Math.hypot(m.vel.x, m.vel.z);
        this.vel.y = Math.max(this.vel.y, Math.min(9, sp * 0.18));
        if (g.net.owns(m.combatant)) m.vel.addScaledVector(n, Math.min(0, vn) * 0.06); // a hard hit slows the mech a little
        this.lastTouch = m.combatant;
      }
    }
    update(dt) {
      const g = this.game;
      if (this.freeze > 0) this.freeze -= dt;
      const live = g.countdown <= 0 && !g.ended && this.freeze <= 0;
      if (live) { this.physics(dt); this.touch(); }
      if (g.net.client && this.target) {
        // follow the host's ball: it keeps moving between updates, and small differences fade out
        this.target.p.addScaledVector(this.target.v, dt);
        if (this.target.p.distanceTo(this.pos) > 12) this.pos.copy(this.target.p);
        else this.pos.lerp(this.target.p, Math.min(1, dt * 5));
        this.vel.lerp(this.target.v, Math.min(1, dt * 3));
      }
      if (!g.net.client && live) {
        for (const t of [0, 1]) {
          if (!this.goalIn(t)) continue;
          const by = 1 - t;
          this.score[by] = this.teamScore(by) + 1;
          this.goalFx(by, this.lastTouch);
          this.kickoff();
          break;
        }
      }
      this.ball.position.copy(this.pos);
      if (this.vel.lengthSq() > 0.1) { const ax = new V3(this.vel.z, 0, -this.vel.x).normalize(); this.ball.rotateOnWorldAxis(ax, (Math.hypot(this.vel.x, this.vel.z) / BALL_R) * dt); }
      const gy = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
      this.mark.position.set(this.pos.x, gy + 0.12, this.pos.z);
      this.mark.material.opacity = Math.max(0.05, 0.35 - (this.pos.y - gy - BALL_R) * 0.02);
      for (const [t, gm] of this.goalMeshes.entries()) gm.fill.material.opacity = 0.14 + Math.sin(g.time * 3 + t) * 0.06;
    }
    // after a goal the ball drops back in the middle
    kickoff() {
      this.freeze = 2.5;
      this.pos.copy(this.center).setY(this.center.y + BALL_R + 10);
      this.vel.set(0, 0, 0);
      this.lastTouch = null;
    }
    goalFx(team, who) {
      const g = this.game;
      g.announce(`⚽ GOAL! ${this.teamName(team).toUpperCase()}`, `${who ? (who.isPlayer ? 'You' : who.name) + ' · ' : ''}${this.teamScore(0)} - ${this.teamScore(1)}`);
      g.fx.burst(this.ball.position, { n: 60, color: g.fx.colorKey(CW.TEAMS[team].color), speed: 18, up: 9, life: 1.3, size: 0.45 });
      g.fx.shockwave(this.ball.position);
      g.cam.shake = Math.min(1.5, g.cam.shake + 0.6);
      if (who && who.isPlayer && who.team === team) { g.bonusCoins += 15; if (!g.isPractice()) g.meta.track('goal'); }
    }
    netState() {
      return { b: [r1(this.pos.x), r1(this.pos.y), r1(this.pos.z), r1(this.vel.x), r1(this.vel.y), r1(this.vel.z)], s: this.score, f: r1(this.freeze), g: this.goals.map((p) => [r1(p.x), r1(p.z)]), l: this.lastTouch ? this.lastTouch.netId : -1 };
    }
    netApply(s, first) {
      const g = this.game;
      if (s.g && !this.stadium && !this.synced) {
        this.synced = true;
        s.g.forEach(([x, z], t) => { this.goals[t] = new V3(x, g.world.groundAt(x, z), z); this.goalMeshes[t].grp.position.copy(this.goals[t]); });
        this.center = this.midSpot();
      }
      const before = [this.teamScore(0), this.teamScore(1)];
      this.score = s.s || {};
      if (Array.isArray(s.b)) {
        const p = new V3(s.b[0], s.b[1], s.b[2]), v = new V3(s.b[3], s.b[4], s.b[5]);
        if (first || !this.target) { this.pos.copy(p); this.vel.copy(v); }
        this.target = { p, v };
      }
      this.freeze = s.f || 0;
      for (const t of [0, 1]) if (!first && this.teamScore(t) > before[t]) { this.goalFx(t, g.net.byId.get(s.l)); this.pos.copy(this.target.p); }
    }
    hud() { return `<b>⚽ Mech Ball</b> · ${this.scoreBars((v) => v)} · first to ${this.mode.scoreToWin} · ${this.clock()}`; }
    urgent() { return true; }
    // teams line up in their own half, facing the ball
    spawn() {
      const g = this.game, used = [];
      const n = {};
      for (const c of g.combatants) {
        if (!c.mech) continue;
        const k = (n[c.team] = (n[c.team] || 0) + 1) - 1;
        const sx = this.goals[c.team].x < this.center.x ? -1 : 1;
        const want = this.stadium ? new V3(sx * (35 + Math.floor(k / 3) * 14), 0, ((k % 3) - 1) * 18) : this.goals[c.team].clone().lerp(this.center, 0.35);
        const p = this.stadium ? want.setY(CW.STADIUM.y) : g.safeNear(want, k, used);
        used.push(p);
        c.mech.place(p, Math.atan2(p.x - this.center.x, p.z - this.center.z));
        c.mech.protect = 3;
      }
    }
    // bots: get behind the ball (seen from the goal they attack), then drive through it; one per team guards the goal
    botGoal(c) {
      const b = this.body(c);
      if (!b) return null;
      const their = this.goals[1 - c.team], mine = this.goals[c.team];
      const mates = this.game.combatants.filter((o) => o.team === c.team && o.alive && !o.human).sort((x, y) => x.netId - y.netId);
      if (mates.length > 1 && mates[0] === c && flatDist(this.pos, mine) > 55) return mine.clone().lerp(this.pos, 0.3);
      const dir = this.pos.clone().sub(their).setY(0).normalize();
      const behind = this.pos.clone().addScaledVector(dir, BALL_R + 7);
      const lined = b.pos.clone().sub(this.pos).setY(0).normalize().dot(dir) > 0.55;
      return lined || flatDist(b.pos, this.pos) < 8 ? this.pos.clone().addScaledVector(dir, -4) : behind;
    }
    respawnSpot(c) {
      const sx = this.goals[c.team].x < this.center.x ? -1 : 1;
      if (this.stadium) return new V3(sx * (CW.STADIUM.L - 22), CW.STADIUM.y, (Math.random() - 0.5) * 50);
      return this.game.safeNear(this.goals[c.team] || this.game.world.landSpawns[0], Math.floor(Math.random() * 5), []);
    }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.mode.scoreToWin) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      for (const t of [0, 1]) {
        const [x, y] = toMap(this.goals[t].x, this.goals[t].z);
        ctx.strokeStyle = hex(CW.TEAMS[t].color); ctx.lineWidth = 3;
        ctx.strokeRect(x - 4, y - 7, 8, 14);
      }
      const [x, y] = toMap(this.pos.x, this.pos.z);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
    }
    summary(c) { return `${this.teamScore(c.team)} goal${this.teamScore(c.team) === 1 ? '' : 's'}`; }
  }

  // ======================= SCRAP WARS =======================
  // Every part blown off an enemy drops a scrap bolt (a wreck drops a pile). Every 6 scrap you carry is an upgrade
  // (up to 6): +8% damage, 4% less damage taken, +4% speed each. A wreck spills half your scrap. Most scrap wins.
  const SCRAP_PER_LV = 6, SCRAP_MAX_LV = 6;
  class ScrapWars extends GoldRush {
    start() {
      this.gold = new Map();
      this.nuggets = [];
      this.geo = new THREE.TorusGeometry(0.45, 0.2, 6, 8);
      this.mat = CW.mat(0xb08968, { metalness: 0.9, roughness: 0.35 });
      this.nid = 1;
      if (!this.game.net.client) for (let i = 0; i < 14; i++) this.spawnNugget();
      this.timer = 0;
      this.lv = new Map();
    }
    goal() { return this.mode.scoreToWin * (this.game.teamMode ? 2 : 1); }
    update(dt) {
      super.update(dt);
      this.timer = Math.min(this.timer, 0); // no random refills: scrap comes from fights (and the start)
      this.levels();
    }
    levels() {
      const g = this.game;
      for (const c of g.combatants) {
        const lv = Math.min(SCRAP_MAX_LV, Math.floor(this.carried(c) / SCRAP_PER_LV));
        const was = c.scrapLv || 0;
        c.scrapLv = lv;
        if (c.isPlayer && lv > was) {
          g.announce(`🔩 UPGRADE ${lv}`, `+${lv * 8}% damage · ${lv * 4}% armor · +${lv * 4}% speed`);
          g.audio.tone(700 + lv * 90, 0.15, 'triangle', 0.18, 1.4);
        }
      }
    }
    // every part blown off an enemy drops a bolt where it was
    onPart(mech, part) {
      if (this.game.net.client || this.game.countdown > 0) return;
      if (Math.random() < 0.7) this.spawnNugget(part.wp.clone());
    }
    onWreck(victim) {
      if (this.game.net.client) return;
      const n = Math.ceil(this.carried(victim) / 2);
      this.gold.set(victim, this.carried(victim) - n);
      const at = victim.mech.pos.clone();
      for (let i = 0; i < Math.min(n + 3, 18); i++) this.spawnNugget(at.clone());
      if (victim.isPlayer && n) this.game.feed(`🔩 You dropped ${n} scrap!`, 'bad');
    }
    netApply(s) { super.netApply(s); this.levels(); }
    hud() {
      const me = this.game.player, n = this.carried(me);
      return `<b>🔩 Scrap Wars</b> · You: <b>${n}</b> 🔩 · Upgrade <b>${me.scrapLv || 0}</b>/${SCRAP_MAX_LV} · ${this.scoreBars((v) => v + '🔩')} · goal ${this.goal()} · ${this.clock()}`;
    }
    check() {
      for (const t of this.teams()) if (this.teamScore(t) >= this.goal()) return { winner: t };
      if (this.timeLeft() <= 0) return this.byScore();
      return null;
    }
    minimap(ctx, toMap) {
      ctx.fillStyle = '#b08968';
      for (const n of this.nuggets) { const [x, y] = toMap(n.mesh.position.x, n.mesh.position.z); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    }
    summary(c) { return `${this.carried(c)} scrap`; }
  }

  CW.OBJECTIVES = { koth: KingOfTheHill, gold: GoldRush, race: CombatRace, boss: BossBattle, bounty: BountyHunt, heist: CoreHeist, ball: MechBall, scrap: ScrapWars };
})();
