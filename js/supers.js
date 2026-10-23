// Cogwild — Supers: a meter that charges as you deal damage (and slowly over time). When it's full,
// press X / right-click / ⭐ for a big move. Which super you get depends on what your mech is built from:
//   Shield part → Shield Dome · Spikes/Saw/Booster → Turbo Ram · air parts → Missile Barrage · else EMP Shockwave
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const FILL_DMG = 380; // damage dealt for a full meter
  const PASSIVE = 1 / 90; // ...or about 90 s of waiting
  const EMP_RADIUS = 16;

  CW.SUPERS = {
    dome: { name: 'Shield Dome', icon: '🛡', desc: '3.5 s invulnerable and repair 25%' },
    ram: { name: 'Turbo Ram', icon: '💥', desc: 'A huge lunge, then 4 s of turbo and 1.5× damage' },
    barrage: { name: 'Missile Barrage', icon: '🚀', desc: '8 rockets at the nearest enemies' },
    emp: { name: 'EMP Shockwave', icon: '⚡', desc: 'Blast around you: enemies take damage and their weapons and engines jam for 2.5 s' },
  };
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
    }
    type(c) { return CW.superFor((c.mech ? c.mech.parts.filter((p) => p.alive) : null) || (c.bp ? c.bp.parts : [])); }
    ready(c) { return (c.superCharge || 0) >= 1; }
    rate() { return (this.game.mods && this.game.mods.superRate) || 1; } // weekly events: faster supers

    // the shooter's game counts damage it decides (online that is always the shooter's own game)
    charge(who, dmg) {
      if (!who || !who.mech || !who.mech.alive || dmg <= 0) return;
      if (who.superLock && this.game.time < who.superLock) return; // damage from your own super doesn't count
      const before = who.superCharge || 0;
      who.superCharge = Math.min(1, before + (dmg / FILL_DMG) * this.rate());
      if (who.isPlayer && before < 1 && who.superCharge >= 1) this.readyPing();
    }
    readyPing() {
      const g = this.game;
      g.toast(`${CW.SUPERS[this.type(g.player)].icon} SUPER ready! Press X / right-click`);
      g.audio.tone(660, 0.12, 'triangle', 0.25, 1.5);
      setTimeout(() => g.audio.tone(990, 0.16, 'triangle', 0.25, 1.3), 110);
    }

    activate(c) {
      const g = this.game;
      const m = c.mech;
      if (!m || !m.alive || !m.occupied || !this.ready(c) || g.countdown > 0 || g.ended) return false;
      if (g.net.active && !g.net.owns(c)) return false;
      c.superCharge = 0;
      c.superLock = g.time + 2.5;
      const type = this.type(c);
      const emp = this.effect(c, type, true);
      if (g.net.active) g.net.events.push({ k: 'super', c: c.netId, type, emp });
      if (c.isPlayer) {
        g.bigMsg(`${CW.SUPERS[type].icon} ${CW.SUPERS[type].name.toUpperCase()}!`, '', 1.1);
        g.cam.shake = Math.min(1.5, g.cam.shake + 0.6);
        g.cam.fovKick = 18;
      }
      return true;
    }

    // the visible part of a super (the owner's game also does the gameplay part: `real`)
    effect(c, type, real) {
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
      } else {
        const hits = [];
        if (real) {
          for (const o of g.combatants) {
            if (o === c || !o.alive || !o.mech || !o.mech.alive || CW.sameTeam(o, c)) continue;
            if (o.mech.pos.distanceTo(m.pos) > EMP_RADIUS) continue;
            o.mech.splash(o.mech.pos, 3, 22, c); // ~110 damage spread over the parts near its center
            hits.push(o.netId);
            if (!g.net.active || g.net.owns(o)) o.mech.empT = 2.5;
          }
        }
        this.ring(m, 0x7df9ff, 0.6, false, EMP_RADIUS);
        fx.burst(m.pos, { n: 30, color: fx.colorKey(0x7df9ff), speed: 16, life: 0.5, size: 0.3 });
        return hits;
      }
      return [];
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
      if (!c || !c.mech) return;
      this.effect(c, e.type, false);
      for (const id of e.emp || []) {
        const o = g.net.byId.get(id);
        if (o && o.mech && g.net.owns(o)) o.mech.empT = 2.5;
      }
    }

    update(dt) {
      const g = this.game;
      if (g.state === 'match' && g.countdown <= 0 && !g.ended) {
        for (const c of g.combatants) {
          if (!c.alive || !c.mech || !c.mech.alive || (g.net.active && !g.net.owns(c))) continue;
          const before = c.superCharge || 0;
          c.superCharge = Math.min(1, before + dt * PASSIVE * this.rate());
          if (c.isPlayer && before < 1 && c.superCharge >= 1) this.readyPing();
          // bots use theirs when someone is close
          if (!c.isPlayer && !c.human && c.superCharge >= 1 && c.ai && c.ai.target) {
            const t = c.ai.target.mech && c.ai.target.mech.alive ? c.ai.target.mech.pos : null;
            if (t && t.distanceTo(c.mech.pos) < (this.type(c) === 'emp' ? EMP_RADIUS * 0.8 : 35)) this.activate(c);
          }
        }
      }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt;
        const k = 1 - f.life / f.max;
        if (f.follow) { f.mesh.position.copy(f.follow.pos); f.mesh.material.opacity = 0.28 * Math.min(1, f.life * 2) * (0.8 + Math.sin(g.time * 12) * 0.2); }
        else { const s = 1 + k * f.reach; f.mesh.scale.setScalar(s); f.mesh.material.opacity = 0.85 * (1 - k); }
        if (f.life <= 0 || (f.follow && !f.follow.alive)) { g.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); this.fx.splice(i, 1); }
      }
    }
    clear() { for (const f of this.fx) this.game.scene.remove(f.mesh); this.fx = []; }
  }

  CW.Supers = Supers;
})();
