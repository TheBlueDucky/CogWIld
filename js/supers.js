// Cogwild — Supers: a meter that charges as you deal damage (and slowly over time). When it's full,
// press X / right-click / ⭐ for a big move. Without a super picked in your loadout (v1.10, bought in the Shop),
// your mech's build decides it:
//   Shield part → Shield Dome · Spikes/Saw/Booster → Turbo Ram · air parts → Missile Barrage · else EMP Shockwave
// A picked super that needs certain parts (js/economy.js SHOP.supers `need`) only works while your mech has them.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const FILL_DMG = 380; // damage dealt for a full meter
  const PASSIVE = 1 / 90; // ...or about 90 s of waiting
  const EMP_RADIUS = 16;
  const r1 = (v) => Math.round(v * 10) / 10;

  CW.SUPERS = {};
  for (const s of CW.ECON.SHOP.supers) CW.SUPERS[s.id] = s;
  CW.superFor = (parts) => {
    const has = (t) => parts.some((p) => p.t === t);
    if (has('shield')) return 'dome';
    if (has('spikes') || has('saw') || has('booster')) return 'ram';
    if (has('rotor') || has('wing') || has('jet')) return 'barrage';
    return 'emp';
  };

  class Supers {
    constructor(game) {
      this.game = game;
      this.fx = []; // domes and shockwave rings: { mesh, life, max, grow, follow }
      this.fields = []; // supers that last a while: { c, type, at, t, max, tick, real, mesh }
    }
    type(c) {
      const parts = (c.mech ? c.mech.parts.filter((p) => p.alive) : null) || (c.bp ? c.bp.parts : []);
      const sp = c.lo && c.lo.sp;
      if (sp && CW.SUPERS[sp] && CW.ECON.fits(CW.SUPERS[sp].need, parts)) return sp;
      return CW.superFor(parts);
    }
    ready(c) { return (c.superCharge || 0) >= 1; }
    // weekly events: faster supers; v1.10: a team far behind charges 35% faster (comeback)
    rate(c) { return ((this.game.mods && this.game.mods.superRate) || 1) * (c && this.game.behind && this.game.behind(c.team) ? 1.35 : 1); }

    // the shooter's game counts damage it decides (online that is always the shooter's own game)
    charge(who, dmg) {
      if (!who || !who.mech || !who.mech.alive || dmg <= 0) return;
      if (who.superLock && this.game.time < who.superLock) return; // damage from your own super doesn't count
      const before = who.superCharge || 0;
      who.superCharge = Math.min(1, before + (dmg / FILL_DMG) * this.rate(who));
      if (who.isPlayer && before < 1 && who.superCharge >= 1) this.readyPing();
    }
    readyPing() {
      const g = this.game;
      g.buzz([25, 40, 25], 0.3);
      g.toast(`${CW.SUPERS[this.type(g.player)].icon} SUPER ready! Press X / right-click`);
      g.audio.tone(660, 0.12, 'triangle', 0.25, 1.5);
      setTimeout(() => g.audio.tone(990, 0.16, 'triangle', 0.25, 1.3), 110);
    }

    // where a super that needs a spot goes: the aim point (or straight ahead), at most `max` meters away
    aimSpot(m, max) {
      const g = this.game;
      const aim = m.input && m.input.aim;
      const fwd = new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
      let p = aim ? aim.clone() : m.pos.clone().addScaledVector(fwd, 30);
      const d = p.clone().sub(m.pos);
      if (d.length() > max) p = m.pos.clone().addScaledVector(d.normalize(), max);
      p.y = Math.max(g.world.groundAt(p.x, p.z, p.y + 3), CW.WATER_Y) + 0.2;
      return p;
    }

    activate(c) {
      const g = this.game;
      const m = c.mech;
      if (!m || !m.alive || !m.occupied || !this.ready(c) || g.countdown > 0 || g.ended) return false;
      if (g.net.active && !g.net.owns(c)) return false;
      c.superCharge = 0;
      c.superLock = g.time + 2.5;
      if (c.ai) c.ai.superWait = 0;
      const type = this.type(c);
      const at = ['orbital', 'gravity'].includes(type) ? this.aimSpot(m, type === 'orbital' ? 90 : 50) : type === 'lance' ? this.aimSpot(m, 250) : null;
      const emp = this.effect(c, type, true, at);
      if (g.net.active) g.net.events.push({ k: 'super', c: c.netId, type, emp, at: at ? [r1(at.x), r1(at.y), r1(at.z)] : undefined });
      if (c.isPlayer) {
        g.bigMsg(`${CW.SUPERS[type].icon} ${CW.SUPERS[type].name.toUpperCase()}!`, '', 1.1);
        g.cam.shake = Math.min(1.5, g.cam.shake + 0.6);
        g.cam.fovKick = 18;
        if (!g.isPractice()) g.meta.track('super');
      }
      return true;
    }
    foes(c, at, r) {
      return this.game.combatants.filter((o) => o !== c && o.alive && o.mech && o.mech.alive && !CW.sameTeam(o, c) && o.mech.pos.distanceTo(at) < r + o.mech.radius);
    }

    // the visible part of a super (the owner's game also does the gameplay part: `real`)
    effect(c, type, real, at) {
      const g = this.game, m = c.mech;
      if (!m) return [];
      const fx = g.fx;
      g.audio.boom(1.2, m.pos);
      if (type === 'dome') {
        if (real) { m.protect = Math.max(m.protect || 0, 3.5); m.domeT = 3.5; for (let i = 0; i < 6; i++) m.repair(40); }
        this.ring(m, 0x4cc9f0, 3.5, true);
        fx.burst(m.pos, { n: 24, color: fx.colorKey(0x9be7ff), speed: 9, life: 0.6, size: 0.35 });
      } else if (type === 'ram') {
        if (real) {
          m.turbo = Math.max(m.turbo || 0, 4);
          m.overcharge = Math.max(m.overcharge || 0, 4);
          m.protect = Math.max(m.protect || 0, 0.6);
          const fwd = new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
          m.vel.addScaledVector(fwd, 42);
          if (m.medium === 'land') m.vel.y = Math.max(m.vel.y, 4);
          m.dashTime = 0.6;
        }
        fx.burst(m.pos, { n: 30, color: 'fire', speed: 10, life: 0.6, size: 0.6 });
        fx.burst(m.pos, { n: 16, color: g.trailMat(c), speed: 6, life: 0.8, size: 0.6 });
      } else if (type === 'barrage') {
        if (real) {
          const foes = g.combatants.filter((o) => o !== c && o.alive && o.mech && o.mech.alive && !CW.sameTeam(o, c))
            .sort((a, b) => a.mech.pos.distanceTo(m.pos) - b.mech.pos.distanceTo(m.pos)).slice(0, 4);
          for (let i = 0; i < 8; i++) {
            const t = foes[i % Math.max(1, foes.length)];
            const start = m.pos.clone().add(new V3((Math.random() - 0.5) * 2, 2 + Math.random(), (Math.random() - 0.5) * 2));
            const aim = t ? t.mech.pos.clone().add(new V3((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3)) : start.clone().add(new V3(-Math.sin(m.yaw) * 40, 0, -Math.cos(m.yaw) * 40));
            const vel = aim.sub(start).normalize().multiplyScalar(46).add(new V3(0, 3, 0));
            setTimeout(() => { if (g.state === 'match') fx.projectile({ pos: start, vel, dmg: 34, splash: 3.5, grav: 4, who: c, kind: 'rocket' }); }, i * 70);
          }
        }
        fx.burst(m.pos, { n: 18, color: 'smoke', speed: 4, up: 4, life: 1.2, size: 0.8, grow: 1.5 });
      } else if (type === 'emp') {
        const hits = [];
        if (real) {
          for (const o of this.foes(c, m.pos, EMP_RADIUS - 2)) {
            o.mech.splash(o.mech.pos, 3, 22, c); // ~110 damage spread over the parts near its center
            hits.push(o.netId);
            if (!g.net.active || g.net.owns(o)) o.mech.empT = 2.5;
          }
        }
        this.ring(m, 0x7df9ff, 0.6, false, EMP_RADIUS);
        fx.burst(m.pos, { n: 30, color: fx.colorKey(0x7df9ff), speed: 16, life: 0.5, size: 0.3 });
        return hits;
      } else if (type === 'orbital') {
        // a red target circle, then a beam from the sky a second later
        const spot = at || this.aimSpot(m, 90);
        this.ring({ pos: spot, radius: 1 }, 0xff3b3b, 1.05, false, 6);
        fx.later(1.0, () => {
          if (g.state !== 'match') return;
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 120, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd0d0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
          beam.position.copy(spot).setY(spot.y + 60);
          g.scene.add(beam);
          this.fx.push({ mesh: beam, life: 0.5, max: 0.5, beam: true });
          fx.explosion(spot, 3);
          fx.shockwave(spot);
          g.audio.boom(2, spot);
          g.onExplosion(spot, 3);
          if (real) {
            for (const mm of g.mechs) mm.splash(spot, 8, 34, c);
            for (const pl of g.pilots) if (pl.alive && !CW.sameTeam(pl.combatant, c) && pl.center.distanceTo(spot) < 8) pl.hit(90, c);
          }
        });
      } else if (type === 'overdrive') {
        if (real) { m.overdriveT = 6; m.turbo = Math.max(m.turbo || 0, 6); }
        this.ring(m, 0xff7b00, 0.6, false, 8);
        fx.burst(m.pos, { n: 30, color: 'fire', speed: 9, up: 3, life: 0.7, size: 0.5 });
      } else if (type === 'gravity') {
        const spot = (at || this.aimSpot(m, 50)).clone().setY((at || m.pos).y + 2.5);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(1.6, 18, 12), new THREE.MeshBasicMaterial({ color: 0x14001f }));
        const halo = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.8 }));
        orb.add(halo);
        orb.position.copy(spot);
        g.scene.add(orb);
        this.fields.push({ c, type, at: spot, t: 0, max: 3, real, mesh: orb, halo, tick: 0 });
      } else if (type === 'slam') {
        if (real) { m.vel.y = Math.max(m.vel.y, 24); m.vel.x *= 0.4; m.vel.z *= 0.4; c.slamAt = g.time; m.protect = Math.max(m.protect || 0, 0.5); }
        fx.burst(m.pos, { n: 20, color: 'smoke', speed: 6, life: 0.7, size: 0.7 });
      } else if (type === 'slamhit') {
        this.ring(m, 0xffd166, 0.6, false, 16);
        fx.shockwave(m.pos);
        fx.burst(m.pos, { n: 30, color: 'smoke', speed: 12, life: 0.8, size: 0.8, grow: 2 });
        g.onExplosion(m.pos, 2.5);
      } else if (type === 'inferno') {
        this.fields.push({ c, type, at: m.pos, t: 0, max: 4, real, tick: 0 });
        this.ring(m, 0xff5400, 0.5, false, 12);
      } else if (type === 'swarm') {
        const drones = [];
        for (let i = 0; i < 4; i++) {
          const d = new THREE.Group();
          const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), CW.mat(0xffd23f, { emissive: 0x7a5a00, metalness: 0.7 }));
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
          eye.position.z = -0.38;
          d.add(body, eye);
          g.scene.add(d);
          drones.push(d);
        }
        this.fields.push({ c, type, at: m.pos, t: 0, max: 8, real, drones, tick: 0 });
      } else if (type === 'lance') {
        const from = m.pos.clone().setY(m.pos.y + 1);
        const to = at || this.aimSpot(m, 250);
        const dir = to.clone().sub(from).normalize();
        const end = from.clone().addScaledVector(dir, 250);
        const len = 250;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0x9ef0ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.copy(from);
        beam.lookAt(end);
        beam.scale.set(1, 1, len);
        g.scene.add(beam);
        this.fx.push({ mesh: beam, life: 0.6, max: 0.6, beam: true });
        if (real) {
          for (const o of g.combatants) {
            if (o === c || !o.alive || !o.mech || !o.mech.alive || CW.sameTeam(o, c)) continue;
            let n = 0;
            for (const p of o.mech.parts) {
              if (!p.alive || n >= 8) continue;
              const rel = p.wp.clone().sub(from);
              const t = rel.dot(dir);
              if (t < 0 || t > len || rel.addScaledVector(dir, -t).length() > 2.4) continue;
              o.mech.hit(p, 26, c); n++;
            }
          }
          for (const pl of g.pilots) {
            if (!pl.alive || CW.sameTeam(pl.combatant, c)) continue;
            const rel = pl.center.clone().sub(from), t = rel.dot(dir);
            if (t > 0 && t < len && rel.addScaledVector(dir, -t).length() < 2.4) pl.hit(120, c);
          }
          if (c.isPlayer) g.cam.shake = 1.4;
        }
        fx.burst(from, { n: 20, color: fx.colorKey(0x9ef0ff), speed: 10, life: 0.5, size: 0.4 });
      } else if (type === 'tidal') {
        if (real) {
          for (const o of this.foes(c, m.pos, 22)) {
            const away = o.mech.pos.clone().sub(m.pos).setY(0).normalize().multiplyScalar(30);
            away.y = 10;
            g.kick(o.mech, away, c);
            o.mech.splash(o.mech.pos, 3, 14, c);
          }
        }
        this.ring(m, 0x48cae4, 0.9, false, 22);
        for (let i = 0; i < 3; i++) fx.burst(m.pos, { n: 30, color: 'water', speed: 14 + i * 4, up: 4, life: 1, size: 0.6 });
      }
      return [];
    }

    // when a bot fires its super: the dome when hurt in a fight, the ram when lined up with a target close by,
    // missiles when a target is in range, the EMP when it catches two enemies (or one, after waiting a while)
    botWants(c, dt) {
      const g = this.game, m = c.mech, ai = c.ai, tp = ai.target && ai.target.pos;
      if (!tp) return false;
      ai.superWait = (ai.superWait || 0) + dt;
      const d = tp.distanceTo(m.pos), hp = m.integrity(), type = this.type(c);
      const facing = () => {
        const want = Math.atan2(-(tp.x - m.pos.x), -(tp.z - m.pos.z));
        let off = (want - m.yaw) % (Math.PI * 2);
        if (off > Math.PI) off -= Math.PI * 2;
        if (off < -Math.PI) off += Math.PI * 2;
        return Math.abs(off);
      };
      const near = (r) => this.foes(c, m.pos, r).length;
      if (type === 'dome') return (hp < 0.5 && d < 40) || hp < 0.3;
      if (type === 'ram') return d < 30 && facing() < 0.35;
      if (type === 'emp') { const n = near(EMP_RADIUS * 0.85); return n >= 2 || (n >= 1 && (hp < 0.5 || ai.superWait > 6)); }
      if (type === 'orbital' || type === 'gravity') return d < (type === 'orbital' ? 70 : 45) && d > 8;
      if (type === 'lance') return d < 120 && facing() < 0.12;
      if (type === 'overdrive') return d < 40;
      if (type === 'slam') return d < 13 && m.medium === 'land';
      if (type === 'inferno') return near(11) >= 1;
      if (type === 'tidal') return near(18) >= (ai.superWait > 6 ? 1 : 2) || (hp < 0.4 && near(18) >= 1);
      if (type === 'swarm') return d < 45;
      return d < 55;
    }

    // a dome that follows the mech, or a flat shockwave ring that grows to `reach`
    ring(m, color, life, dome, reach) {
      const g = this.game;
      const geo = dome ? new THREE.SphereGeometry(m.radius + 1.2, 24, 16) : new THREE.TorusGeometry(1, 0.25, 8, 48);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dome ? 0.28 : 0.85, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(m.pos);
      if (!dome) mesh.rotation.x = Math.PI / 2;
      g.scene.add(mesh);
      this.fx.push({ mesh, life, max: life, follow: dome ? m : null, reach: reach || 0 });
    }

    // a super another player's game used: show it (and jam our own mechs if its EMP caught them)
    onRemote(e) {
      const g = this.game;
      const c = g.net.byId.get(e.c);
      if (!c || !c.mech || (!CW.SUPERS[e.type] && e.type !== 'slamhit')) return;
      const at = Array.isArray(e.at) ? new V3(+e.at[0] || 0, +e.at[1] || 0, +e.at[2] || 0) : null;
      this.effect(c, e.type, false, at);
      for (const id of e.emp || []) {
        const o = g.net.byId.get(id);
        if (o && o.mech && g.net.owns(o)) o.mech.empT = 2.5;
      }
    }

    // supers that last a while (Gravity Well, Inferno Nova, Drone Swarm) and the Ground Pound landing
    updateFields(dt) {
      const g = this.game;
      for (const c of g.combatants) {
        if (c.slamAt === undefined || !c.mech || !c.mech.alive) continue;
        const m = c.mech;
        if (g.time - c.slamAt > 0.35 && m.medium !== 'air') {
          delete c.slamAt;
          for (const o of this.foes(c, m.pos, 14)) {
            const away = o.mech.pos.clone().sub(m.pos).setY(0).normalize().multiplyScalar(24);
            away.y = 9;
            g.kick(o.mech, away, c);
            o.mech.splash(o.mech.pos, 3.5, 20, c);
          }
          this.effect(c, 'slamhit', false);
          if (g.net.active) g.net.events.push({ k: 'super', c: c.netId, type: 'slamhit' });
          if (c.isPlayer) g.cam.shake = 1.5;
        } else if (g.time - c.slamAt > 4) delete c.slamAt;
      }
      for (let i = this.fields.length - 1; i >= 0; i--) {
        const f = this.fields[i];
        f.t += dt;
        f.tick -= dt;
        const m = f.c.mech;
        const tick = f.tick <= 0;
        if (tick) f.tick = 0.25;
        if (f.type === 'gravity') {
          f.mesh.rotation.y += dt * 3;
          f.halo.rotation.x += dt * 5;
          f.mesh.scale.setScalar(1 + Math.sin(f.t * 10) * 0.08);
          if (Math.random() < dt * 30) g.fx.burst(f.at.clone().add(new V3((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 24)), { n: 1, color: g.fx.colorKey(0xc77dff), speed: 1, life: 0.4, size: 0.3 });
          if (f.real && tick) for (const o of this.foes(f.c, f.at, 18)) {
            const pull = f.at.clone().sub(o.mech.pos);
            if (pull.length() > 2) g.kick(o.mech, pull.normalize().multiplyScalar(7).setY(1), f.c);
          }
          if (f.t >= f.max) {
            g.fx.explosion(f.at, 2.2);
            g.fx.shockwave(f.at);
            g.audio.boom(1.6, f.at);
            if (f.real) for (const mm of g.mechs) mm.splash(f.at, 7, 26, f.c);
          }
        } else if (f.type === 'inferno') {
          if (!m || !m.alive) f.t = f.max;
          else {
            for (let k = 0; k < 3; k++) {
              const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
              if (Math.random() < dt * 30) g.fx.burst(m.pos.clone().add(new V3(Math.cos(a) * r, -0.5, Math.sin(a) * r)), { n: 1, color: 'fire', speed: 1.5, up: 3, life: 0.6, size: 0.7 });
            }
            if (f.real && tick) for (const o of this.foes(f.c, m.pos, 12)) {
              const near = o.mech.parts.filter((p) => p.alive).sort((a, b) => a.wp.distanceTo(m.pos) - b.wp.distanceTo(m.pos)).slice(0, 3);
              for (const p of near) o.mech.hit(p, 8, f.c);
            }
          }
        } else if (f.type === 'swarm') {
          if (!m || !m.alive) f.t = f.max;
          else {
            f.drones.forEach((d, k) => {
              const a = f.t * 2.2 + (k * Math.PI) / 2;
              d.position.set(m.pos.x + Math.cos(a) * (m.radius + 2.5), m.pos.y + 2.2 + Math.sin(f.t * 3 + k) * 0.4, m.pos.z + Math.sin(a) * (m.radius + 2.5));
              d.rotation.y = -a;
            });
            if (tick && Math.random() < 0.6) {
              const d = f.drones[Math.floor(Math.random() * 4)];
              const t = g.combatants.filter((o) => o !== f.c && o.alive && o.mech && o.mech.alive && !CW.sameTeam(o, f.c) && o.mech.pos.distanceTo(d.position) < 55)
                .sort((a, b) => a.mech.pos.distanceTo(d.position) - b.mech.pos.distanceTo(d.position))[0];
              if (t) {
                const vel = t.mech.pos.clone().setY(t.mech.pos.y + 0.5).sub(d.position).normalize().multiplyScalar(130);
                g.fx.projectile({ pos: d.position.clone(), vel, dmg: f.real ? 10 : 0, splash: 0, grav: 0, who: f.c, kind: 'bolt' });
              }
            }
          }
        }
        if (f.t >= f.max) {
          if (f.mesh) g.scene.remove(f.mesh);
          if (f.drones) for (const d of f.drones) { g.scene.remove(d); g.fx.burst(d.position, { n: 6, color: 'spark', speed: 4, life: 0.3, size: 0.15 }); }
          this.fields.splice(i, 1);
        }
      }
    }

    update(dt) {
      const g = this.game;
      if (g.state === 'match' && g.countdown <= 0 && !g.ended) {
        for (const c of g.combatants) {
          if (!c.alive || !c.mech || !c.mech.alive || (g.net.active && !g.net.owns(c))) continue;
          const before = c.superCharge || 0;
          c.superCharge = Math.min(1, before + dt * PASSIVE * this.rate(c));
          if (c.isPlayer && before < 1 && c.superCharge >= 1) this.readyPing();
          // bots use theirs at a good moment
          if (!c.isPlayer && !c.human && c.superCharge >= 1 && c.ai && c.ai.target && this.botWants(c, dt)) this.activate(c);
        }
      }
      if (g.state === 'match') this.updateFields(dt);
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt;
        const k = 1 - f.life / f.max;
        if (f.beam) f.mesh.material.opacity = 0.85 * (1 - k);
        else if (f.follow) { f.mesh.position.copy(f.follow.pos); f.mesh.material.opacity = 0.28 * Math.min(1, f.life * 2) * (0.8 + Math.sin(g.time * 12) * 0.2); }
        else { const s = 1 + k * f.reach; f.mesh.scale.setScalar(s); f.mesh.material.opacity = 0.85 * (1 - k); }
        if (f.life <= 0 || (f.follow && !f.follow.alive)) { g.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); this.fx.splice(i, 1); }
      }
    }
    clear() {
      for (const f of this.fx) this.game.scene.remove(f.mesh);
      for (const f of this.fields) { if (f.mesh) this.game.scene.remove(f.mesh); if (f.drones) for (const d of f.drones) this.game.scene.remove(d); }
      this.fx = []; this.fields = [];
      for (const c of this.game.combatants || []) delete c.slamAt;
    }
  }

  CW.Supers = Supers;
})();
