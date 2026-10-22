// Cogwild — objective game modes: King of the Hill, Gold Rush, Combat Race, Boss Battle.
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
          const r = b === c.mech ? c.mech.radius + 1 : 1.6;
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

  CW.OBJECTIVES = { koth: KingOfTheHill, gold: GoldRush, race: CombatRace, boss: BossBattle };
})();
