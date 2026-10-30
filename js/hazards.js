// Cogwild — the arena comes alive (v1.10):
//   * boost pads (glowing arrows: a burst of speed the way they point) and jump pads (rings: launch you up and forward),
//     the same spots for everyone in an arena (seeded by its id). Each game launches its own mechs.
//   * arena events: every minute and a half something happens, depending on the arena: a meteor shower, a lava
//     eruption, a lightning storm (red circles warn where it hits), a sandstorm (thick dust) or a blackout (lights
//     out). The host's game picks the event and where it strikes; every game hurts only its own mechs.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const r1 = (v) => Math.round(v * 10) / 10;

  CW.ARENA_EVENTS = {
    meteor: { name: 'METEOR SHOWER', icon: '☄', sub: 'Red circles = incoming. Keep moving!', dmg: 26, r: 6.5, n: 16, dur: 11 },
    eruption: { name: 'ERUPTION', icon: '🌋', sub: 'Lava bombs from the volcano. Watch the red circles!', dmg: 24, r: 6, n: 18, dur: 11 },
    storm: { name: 'LIGHTNING STORM', icon: '⛈', sub: 'Lightning strikes the red circles', dmg: 22, r: 4.5, n: 20, dur: 12 },
    sandstorm: { name: 'SANDSTORM', icon: '🌪', sub: 'You can barely see. Stay close to your team!', dur: 22 },
    blackout: { name: 'BLACKOUT', icon: '🌑', sub: 'The lights went out for 20 seconds', dur: 20 },
  };
  const BY_ARENA = {
    canyon: ['meteor', 'sandstorm'], isles: ['storm'], volcano: ['eruption'], desert: ['sandstorm', 'meteor'], swamp: ['storm'],
    city: ['blackout', 'meteor'], jungle: ['storm'], scrap: ['meteor', 'blackout'], speedway: ['blackout', 'storm'], bay: ['storm'], moon: ['meteor'],
  };

  class Hazards {
    constructor(game) {
      this.game = game;
      this.pads = [];
      this.strikes = []; // { at, t, hit, ring, kind }
      this.active = null; // { id, end }
      this.next = 0;
    }
    clear() {
      for (const p of this.pads) this.game.scene.remove(p.mesh);
      for (const s of this.strikes) if (s.ring) this.game.scene.remove(s.ring);
      this.pads = []; this.strikes = [];
      this.endWeather();
      this.active = null;
    }
    // on: the match decides (not in the tutorial or a test drive)
    start(on) {
      this.clear();
      const g = this.game;
      this.on = on;
      this.next = 55 + Math.random() * 20;
      if (!on) return;
      const w = g.world, id = w.arena.id;
      let seed = CW.ECON.hash('pads' + id);
      const rnd = () => CW.hash(seed++, 77);
      const spots = [];
      for (let tries = 0; tries < 600 && spots.length < 10; tries++) {
        const x = (rnd() - 0.5) * 300, z = (rnd() - 0.5) * 300;
        if (Math.hypot(x, z) > 150 || !w.isSafeSpot(x, z)) continue;
        const h = w.groundAt(x, z);
        if (h < 1 || Math.abs(w.groundAt(x + 4, z) - h) + Math.abs(w.groundAt(x, z + 4) - h) > 1.6) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 38) || w.landSpawns.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
        spots.push(new V3(x, h, z));
      }
      spots.forEach((p, i) => this.addPad(p, i % 5 < 3 ? 'boost' : 'jump', rnd() * Math.PI * 2));
    }
    addPad(pos, kind, yaw) {
      const g = this.game;
      const grp = new THREE.Group();
      if (kind === 'boost') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 8), CW.mat(0x1b2a4a, { metalness: 0.6, roughness: 0.4 }));
        grp.add(base);
        const mat = new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.9 });
        const arrows = [];
        for (let k = 0; k < 3; k++) {
          const a = new THREE.Group();
          for (const s of [-1, 1]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.45), mat.clone()); bar.position.set(s * 0.8, 0, 0.55); bar.rotation.y = s * 0.7; a.add(bar); }
          a.position.set(0, 0.12, 2.4 - k * 2.4);
          grp.add(a);
          arrows.push(a);
        }
        grp.userData.arrows = arrows;
      } else {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.32, 8, 32), CW.mat(0xff9f1c, { emissive: 0x803d00, metalness: 0.6 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.2;
        const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.2, 28), CW.mat(0x3a2a1a, { metalness: 0.5 }));
        const glow = new THREE.Mesh(new THREE.CircleGeometry(2.1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.6, depthWrite: false }));
        glow.position.y = 0.13;
        grp.add(disk, ring, glow);
        grp.userData.glow = glow;
      }
      grp.position.copy(pos).setY(pos.y + 0.05);
      grp.rotation.y = yaw;
      g.scene.add(grp);
      this.pads.push({ kind, pos: grp.position, yaw, mesh: grp, dir: new V3(-Math.sin(yaw), 0, -Math.cos(yaw)) });
    }

    // ---------------- arena events ----------------
    begin(ev, strikes, quiet) {
      const g = this.game, E = CW.ARENA_EVENTS[ev];
      if (!E) return;
      this.active = { id: ev, end: g.matchTime + E.dur };
      if (!quiet) { g.announce(`${E.icon} ${E.name}`, E.sub); g.feed(`${E.icon} ${E.name}!`, 'bad'); }
      for (const [x, z, d] of strikes || []) {
        const at = new V3(x, 0, z);
        at.y = Math.max(g.world.groundAt(x, z, 100), CW.WATER_Y) + 0.15;
        this.strikes.push({ at, t: -d, kind: ev, ring: null, hit: false });
      }
      if (ev === 'sandstorm') { this.fogNear = 6; this.fogFar = 60; }
      if (ev === 'blackout') { const t = CW.TIMES[g.world.time] || {}; g.sun.intensity = (t.sunI || 1) * 0.12; g.hemi.intensity = (t.hemiI || 0.6) * 0.25; g.headlight.intensity = 1.7; this.dark = true; }
    }
    endWeather() {
      const g = this.game;
      this.fogNear = this.fogFar = 0;
      if (this.dark) { this.dark = false; const t = CW.TIMES[g.world.time] || CW.TIMES.day; g.sun.intensity = t.sunI; g.hemi.intensity = t.hemiI; g.headlight.intensity = g.world.time === 'night' ? 1.4 : g.world.time === 'sunset' ? 0.4 : 0; }
    }
    // host: pick the next event and where it strikes
    trigger(ev) {
      const g = this.game;
      const list = BY_ARENA[g.world.arena.id] || ['meteor'];
      ev = ev || list[Math.floor(Math.random() * list.length)];
      const E = CW.ARENA_EVENTS[ev];
      const strikes = [];
      if (E.n) {
        const alive = g.combatants.filter((c) => c.alive && ((c.mech && c.mech.alive) || (c.pilot && c.pilot.alive)));
        for (let k = 0; k < E.n; k++) {
          let x, z;
          const c = alive.length && Math.random() < 0.65 ? alive[Math.floor(Math.random() * alive.length)] : null;
          const b = c && (c.mech && c.mech.alive ? c.mech : c.pilot);
          if (b) { x = b.pos.x + (Math.random() - 0.5) * 24; z = b.pos.z + (Math.random() - 0.5) * 24; }
          else { x = (Math.random() - 0.5) * 280; z = (Math.random() - 0.5) * 280; }
          strikes.push([r1(x), r1(z), r1((k / E.n) * (E.dur - 2) + Math.random() * 0.6)]);
        }
      }
      g.net.event({ k: 'hz', ev, s: strikes });
      this.begin(ev, strikes);
    }
    // online: the host's event
    netEvent(e) { if (CW.ARENA_EVENTS[e.ev]) this.begin(e.ev, Array.isArray(e.s) ? e.s.slice(0, 40) : []); }

    strike(s) {
      const g = this.game, E = CW.ARENA_EVENTS[s.kind], fx = g.fx;
      s.hit = true;
      if (s.ring) { g.scene.remove(s.ring); s.ring = null; }
      if (s.kind === 'storm') {
        fx.bolt(s.at.clone().setY(s.at.y + 70), s.at, 0xe0f4ff);
        fx.bolt(s.at.clone().setY(s.at.y + 70), s.at, 0x9be7ff);
        fx.burst(s.at, { n: 20, color: fx.colorKey(0x9be7ff), speed: 10, life: 0.4, size: 0.3 });
      } else {
        fx.explosion(s.at, s.kind === 'meteor' ? 1.6 : 1.4);
        fx.burst(s.at, { n: 16, color: s.kind === 'eruption' ? 'fire' : 'smoke', speed: 8, up: 6, life: 1, size: 0.7, grow: 1.5 });
      }
      g.audio.boom(1.1, s.at);
      g.onExplosion(s.at, 1.3);
      // each game hurts only its own mechs and pilots (no attacker: "the arena")
      for (const m of g.mechs) if (m.alive && g.net.owns(m.combatant) && m.pos.distanceTo(s.at) < E.r + m.radius) m.splash(s.at, E.r, E.dmg, null);
      for (const pl of g.pilots) if (pl.alive && g.net.owns(pl.combatant) && pl.center.distanceTo(s.at) < E.r) pl.hit(E.dmg * 1.5, null);
    }

    update(dt) {
      const g = this.game;
      if (!this.on || g.state !== 'match') return;
      const t = g.time;
      // pads: launch your own mechs (bots too, on the host)
      for (const p of this.pads) {
        const ud = p.mesh.userData;
        if (ud.arrows) ud.arrows.forEach((a, k) => a.children.forEach((b) => (b.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - k * 1.2)))));
        if (ud.glow) ud.glow.material.opacity = 0.35 + Math.sin(t * 4) * 0.25;
        for (const m of g.mechs) {
          if (!m.alive || !g.net.owns(m.combatant) || (m.padT || 0) > t) continue;
          const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
          if (Math.abs(m.pos.y - m.baseOff - p.pos.y) > 2.5) continue;
          if (p.kind === 'boost') {
            const along = dx * p.dir.x + dz * p.dir.z, side = dx * p.dir.z - dz * p.dir.x;
            if (Math.abs(along) > 4.2 || Math.abs(side) > 2.8) continue;
            const v = m.vel.x * p.dir.x + m.vel.z * p.dir.z;
            const add = Math.max(0, 46 - v);
            m.vel.x += p.dir.x * add; m.vel.z += p.dir.z * add;
            m.turbo = Math.max(m.turbo || 0, 1.5);
            m.padT = t + 0.8;
            this.padFx(m, p);
          } else {
            if (Math.hypot(dx, dz) > 2.9) continue;
            m.vel.y = Math.max(m.vel.y, 26);
            m.vel.addScaledVector(new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), 10);
            m.padT = t + 1.4;
            this.padFx(m, p);
          }
        }
      }
      // the event schedule (host)
      if (!g.net.client && g.countdown <= 0 && !g.ended) {
        this.next -= dt;
        if (this.next <= 0) { this.next = 80 + Math.random() * 30; this.trigger(); }
      }
      if (this.active && g.matchTime > this.active.end) { this.active = null; this.endWeather(); }
      for (let i = this.strikes.length - 1; i >= 0; i--) {
        const s = this.strikes[i];
        s.t += dt;
        if (s.t >= 0 && !s.ring && !s.hit) {
          // a red warning circle 1.4 s before it hits
          const E = CW.ARENA_EVENTS[s.kind];
          s.ring = new THREE.Mesh(new THREE.RingGeometry(E.r - 0.5, E.r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
          s.ring.position.copy(s.at);
          g.scene.add(s.ring);
          if (s.kind !== 'storm') { // a falling rock / lava bomb
            s.rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), s.kind === 'eruption' ? new THREE.MeshBasicMaterial({ color: 0xff5400 }) : CW.mat(0x5a4a42, { roughness: 0.9 }));
            g.scene.add(s.rock);
          }
        }
        if (s.ring) {
          s.ring.material.opacity = 0.4 + 0.4 * Math.abs(Math.sin(s.t * 9));
          if (s.rock) {
            const k = Math.min(1, s.t / 1.4);
            const from = s.kind === 'eruption' ? new V3(0, 60, 0) : s.at.clone().add(new V3(30, 90, 20));
            s.rock.position.copy(from).lerp(s.at, k);
            s.rock.rotation.x += dt * 4;
            if (Math.random() < 0.5) g.fx.burst(s.rock.position, { n: 1, color: s.kind === 'eruption' ? 'fire' : 'smoke', speed: 0.5, life: 0.5, size: 0.7, grow: 1.5 });
          }
        }
        if (s.t >= 1.4 && !s.hit) { if (s.rock) { g.scene.remove(s.rock); s.rock = null; } this.strike(s); }
        if (s.hit) this.strikes.splice(i, 1);
      }
    }
    padFx(m, p) {
      const g = this.game;
      g.fx.burst(m.pos, { n: 14, color: g.fx.colorKey(p.kind === 'boost' ? 0x5ce1ff : 0xff9f1c), speed: 7, life: 0.5, size: 0.4 });
      if (m.combatant.isPlayer) {
        g.audio.whoosh();
        g.cam.fovKick = 14;
        if (!g.isPractice()) g.meta.track('pad');
      }
    }
    minimap(ctx, toMap) {
      for (const p of this.pads) {
        const [x, y] = toMap(p.pos.x, p.pos.z);
        ctx.fillStyle = p.kind === 'boost' ? '#5ce1ff' : '#ff9f1c';
        if (p.kind === 'boost') { ctx.save(); ctx.translate(x, y); ctx.rotate(-p.yaw); ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
      }
      for (const s of this.strikes) {
        if (!s.ring) continue;
        const [x, y] = toMap(s.at.x, s.at.z);
        ctx.strokeStyle = '#ff3030'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  CW.Hazards = Hazards;
})();
