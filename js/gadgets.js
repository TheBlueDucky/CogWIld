// Cogwild — Gadgets: a small extra move next to your super, 3 uses per match with a short cooldown.
// Pick one before PLAY (the loadout in the PLAY panel). Press G / the 🧰 button. Bots use theirs too.
// The first four are free (by level); v1.10 added eight more in the Shop (js/economy.js SHOP.gadgets). A gadget that
// needs a way of moving (Nitro: wheels or legs…) falls back to the Repair Kit on a mech without it.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const USES = 3, COOLDOWN = 8;
  const MINE_R = 3.4, MINE_ARM = 1.2, MINE_LIFE = 40;
  const r1 = (v) => Math.round(v * 10) / 10;

  CW.GADGETS = {};
  for (const gd of CW.ECON.SHOP.gadgets) CW.GADGETS[gd.id] = Object.assign({ level: 1 }, gd);
  CW.gadgetsFor = (level) => Object.keys(CW.GADGETS).filter((id) => CW.GADGETS[id].level <= level);

  class Gadgets {
    constructor(game) {
      this.game = game;
      this.mines = []; // { id, owner, pos, mesh, light, arm, life }
      this.decoys = []; // { c, mesh, until }
      this.seq = 0;
    }
    // the gadget a combatant brings: from its loadout (yours: the PLAY panel), if its mech can use it
    type(c) {
      if (c.gadget) return c.gadget;
      const want = c.lo && c.lo.gd;
      const gd = want && CW.GADGETS[want];
      c.gadget = gd && CW.ECON.fits(gd.need, c.bp ? c.bp.parts : []) ? want : 'repair';
      return c.gadget;
    }
    left(c) { return c.gadgetN === undefined ? USES + (CW.hasPerk(c, 'belt') ? 1 : 0) : c.gadgetN; }
    cooldown() { return COOLDOWN / ((this.game.mods && this.game.mods.gadgetRate) || 1); }

    use(c) {
      const g = this.game, m = c.mech;
      if (!m || !m.alive || !m.occupied || g.countdown > 0 || g.ended) return false;
      if (g.net.active && !g.net.owns(c)) return false;
      if (this.left(c) <= 0) { if (c.isPlayer) g.toast('No gadget uses left this match'); return false; }
      if ((c.gadgetCd || 0) > 0) { if (c.isPlayer) g.toast(`Gadget ready in ${c.gadgetCd.toFixed(1)}s`); return false; }
      const type = this.type(c);
      c.gadgetN = this.left(c) - 1;
      c.gadgetCd = this.cooldown();
      const id = type === 'mine' ? `${c.netId}:${++this.seq}` : null;
      const at = ['grapple', 'empnade', 'torpedo'].includes(type) ? g.supers.aimSpot(m, type === 'grapple' ? 60 : 80) : null;
      this.effect(c, type, true, id, null, at);
      if (g.net.active) g.net.events.push({ k: 'gadget', c: c.netId, type, id, x: r1(m.pos.x), z: r1(m.pos.z), at: at ? [r1(at.x), r1(at.y), r1(at.z)] : undefined });
      if (c.isPlayer) { g.meta.track('gadget'); g.buzz(20); }
      if (c.isPlayer) { g.toast(`${CW.GADGETS[type].icon} ${CW.GADGETS[type].name}! (${c.gadgetN} left)`); g.audio.tone(520, 0.1, 'square', 0.15, 1.6); }
      return true;
    }

    effect(c, type, real, id, from, at) {
      const g = this.game, m = c.mech, fx = g.fx;
      if (!m) return;
      if (type === 'repair') {
        if (real) for (let i = 0; i < 5; i++) m.repair(40);
        fx.burst(m.pos, { n: 22, color: fx.colorKey(0x7bc950), speed: 6, up: 4, life: 0.7, size: 0.35 });
      } else if (type === 'mine') {
        const back = new V3(Math.sin(m.yaw), 0, Math.cos(m.yaw)).multiplyScalar(m.radius + 2);
        const p = from ? new V3(from.x, 0, from.z) : m.pos.clone().add(back);
        p.y = Math.max(g.world.groundAt(p.x, p.z, 100), 0) + 0.3;
        this.addMine(c, p, id);
      } else if (type === 'jump') {
        if (real) {
          const fwd = new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
          m.vel.addScaledVector(fwd, 16);
          m.vel.y = Math.max(m.vel.y, 20);
          m.protect = Math.max(m.protect || 0, 0.4);
        }
        fx.burst(m.pos, { n: 18, color: 'fire', speed: 5, life: 0.5, size: 0.5 });
        g.audio.boom(0.6, m.pos);
      } else if (type === 'smoke') {
        if (real) { c.smokeT = g.time + 4; m.turbo = Math.max(m.turbo || 0, 4); }
        for (let i = 0; i < 3; i++) fx.burst(m.pos, { n: 26, color: 'smoke', speed: 5, up: 2, life: 3.2, size: 2.2, grow: 2.5 });
      } else if (type === 'grapple') {
        const spot = at || g.supers.aimSpot(m, 60);
        if (real) {
          const d = spot.clone().sub(m.pos);
          const len = d.length();
          m.vel.copy(d.normalize().multiplyScalar(Math.min(48, 14 + len * 0.9)));
          m.vel.y = Math.max(m.vel.y, 7);
          m.protect = Math.max(m.protect || 0, 0.3);
        }
        fx.chainT = { a: m, b: { pos: spot, alive: true }, t: 0.45 };
        fx.burst(spot, { n: 8, color: 'spark', speed: 5, life: 0.3, size: 0.15 });
        g.audio.tone(300, 0.2, 'sawtooth', 0.08, 2.5);
      } else if (type === 'bubble') {
        if (real) { m.shieldMax = Math.max(m.shieldMax, 150); m.shield = Math.min((m.shield || 0) + 150, 300); m.shieldFlash = 1; }
        g.supers.ring(m, 0x9be7ff, 0.8, true);
      } else if (type === 'decoy') {
        this.addDecoy(c);
        if (real) {
          c.smokeT = g.time + 3;
          m.turbo = Math.max(m.turbo || 0, 3);
          // bots chasing you go after the copy instead
          for (const o of g.combatants) if (o.ai && o.ai.target && o.ai.target.c === c) { o.ai.target = { c, pos: m.pos.clone(), decoy: true }; o.ai.retarget = 6; }
        }
      } else if (type === 'sonar') {
        if (c.isPlayer || (g.player && CW.sameTeam(c, g.player))) {
          g.sonarUntil = g.time + 6;
          if (!c.isPlayer) g.feed(`📡 ${c.name} pinged every enemy!`, 'good');
        }
        g.supers.ring(m, 0x5ce1ff, 1.2, false, 60);
        g.audio.tone(1400, 0.4, 'sine', 0.12, 0.5);
      } else if (type === 'empnade') {
        const spot = at || g.supers.aimSpot(m, 80);
        const start = m.pos.clone().setY(m.pos.y + m.radius * 0.6 + 1);
        const T = Math.max(0.7, Math.min(2, start.distanceTo(spot) / 30));
        const vel = new V3((spot.x - start.x) / T, (spot.y - start.y + 0.5 * 22 * T * T) / T, (spot.z - start.z) / T);
        fx.projectile({ pos: start, vel, dmg: 0, splash: 0, grav: 22, who: c, kind: 'grenade' });
      } else if (type === 'nitro') {
        if (real) { m.nitroT = 3; m.dashCd = 0; }
        fx.burst(m.pos, { n: 20, color: fx.colorKey(0x4cc9f0), speed: 7, life: 0.5, size: 0.4 });
        g.audio.whoosh();
      } else if (type === 'torpedo') {
        const spot = at || g.supers.aimSpot(m, 80);
        const start = m.pos.clone().add(new V3(-Math.sin(m.yaw) * (m.radius + 1), 0, -Math.cos(m.yaw) * (m.radius + 1)));
        start.y = Math.max(CW.WATER_Y + 0.15, start.y - 0.5);
        const dir = spot.clone().sub(start).setY(0).normalize();
        fx.projectile({ pos: start, vel: dir.multiplyScalar(75), dmg: real ? 80 : 0, splash: 4, grav: 0, who: c, kind: 'torpedo' });
        g.audio.tone(200, 0.3, 'sine', 0.12, 2);
      } else if (type === 'afterburner') {
        if (real) {
          m.burnerT = 3;
          m.protect = Math.max(m.protect || 0, 0.6);
          m.vel.addScaledVector(new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), 20);
        }
        fx.burst(m.pos, { n: 26, color: 'fire', speed: 8, life: 0.5, size: 0.5 });
        g.audio.boom(0.7, m.pos);
      }
    }

    addMine(c, pos, id) {
      const g = this.game;
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.35, 12), CW.mat(0x2b2d42, { metalness: 0.6 }));
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
      led.position.y = 0.25;
      mesh.add(body, led);
      mesh.position.copy(pos);
      g.scene.add(mesh);
      this.mines.push({ id, owner: c, pos: pos.clone(), mesh, led, arm: MINE_ARM, life: MINE_LIFE });
    }
    // a see-through copy of the mech that stays where it was for 6 s
    addDecoy(c) {
      const g = this.game, m = c.mech;
      if (!this.ghostMat) this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.45, depthWrite: false });
      const mesh = m.group.clone(true);
      mesh.traverse((o) => { if (o.isMesh) o.material = this.ghostMat; });
      g.scene.add(mesh);
      this.decoys.push({ c, mesh, until: g.time + 6 });
      g.fx.burst(m.pos, { n: 16, color: g.fx.colorKey(0x9be7ff), speed: 5, life: 0.5, size: 0.3 });
    }
    boom(mine, real) {
      const g = this.game;
      g.scene.remove(mine.mesh);
      this.mines = this.mines.filter((x) => x !== mine);
      g.fx.burst(mine.pos, { n: 30, color: 'fire', speed: 12, life: 0.6, size: 0.6 });
      g.audio.boom(1, mine.pos);
      if (!real) return;
      // the mine's owner decides the damage (online that's always their own game)
      for (const m of g.mechs) {
        if (!m.alive || CW.sameTeam(m.combatant, mine.owner) || m.pos.distanceTo(mine.pos) > MINE_R + m.radius + 1) continue;
        m.splash(mine.pos.clone().setY(m.pos.y - 0.5), 3.5, 30, mine.owner);
      }
      if (g.net.active) g.net.events.push({ k: 'gadget', c: mine.owner.netId, type: 'boom', id: mine.id });
    }

    // a gadget another player's game used
    onRemote(e) {
      const g = this.game;
      const c = g.net.byId.get(e.c);
      if (!c) return;
      if (e.type === 'boom') { const mine = this.mines.find((x) => x.id === e.id); if (mine) this.boom(mine, false); return; }
      if (!CW.GADGETS[e.type]) return;
      c.gadget = e.type;
      const at = Array.isArray(e.at) ? new V3(+e.at[0] || 0, +e.at[1] || 0, +e.at[2] || 0) : null;
      this.effect(c, e.type, false, e.id, { x: +e.x || 0, z: +e.z || 0 }, at);
    }

    // when a bot uses its gadget
    botWants(c, type, dt) {
      const g = this.game, m = c.mech, ai = c.ai || {}, t = ai.target, d = t && t.pos ? t.pos.distanceTo(m.pos) : 999, near = d < 25;
      const hp = m.integrity(), hurt = m.core.hp / m.core.maxHp < 0.45 || hp < 0.5;
      const behind = near && (t.pos.x - m.pos.x) * -Math.sin(m.yaw) + (t.pos.z - m.pos.z) * -Math.cos(m.yaw) < 0;
      switch (type) {
        case 'repair': return hurt && (!near || hp < 0.3);
        case 'mine': return near && (behind || Math.random() < 0.3);
        case 'smoke': case 'decoy': return hurt && near;
        case 'jump': return ai.stuck > 1 || ai.blocked || ai.reverseT > 0;
        case 'grapple': return d > 45 && d < 60 && Math.random() < dt * 2;
        case 'bubble': return hurt && d < 40;
        case 'sonar': return !!t && Math.random() < dt * 0.15;
        case 'empnade': return d < 35 && d > 6;
        case 'nitro': return d > 55 && m.medium === 'land';
        case 'torpedo': return d < 55 && m.medium === 'water';
        case 'afterburner': return d > 50 && m.medium === 'air';
      }
      return false;
    }

    update(dt) {
      const g = this.game;
      if (g.state !== 'match') return;
      const live = g.countdown <= 0 && !g.ended;
      for (const c of g.combatants) {
        if (c.gadgetCd > 0) c.gadgetCd = Math.max(0, c.gadgetCd - dt);
        if (!live || c.isPlayer || c.human || !c.alive || !c.mech || !c.mech.alive || (g.net.active && !g.net.owns(c))) continue;
        if (this.left(c) <= 0 || c.gadgetCd > 0 || Math.random() > dt * 2) continue;
        // (v1.10.1: and in a long fight it uses it anyway now and then)
        const ai = c.ai || {};
        ai.gadWait = (ai.gadWait || 0) + 0.5;
        const fighting = ai.target && ai.target.pos && ai.target.pos.distanceTo(c.mech.pos) < 40;
        if (this.botWants(c, this.type(c), dt) || (fighting && ai.gadWait > 25 && !['jump', 'nitro', 'afterburner', 'torpedo'].includes(this.type(c)))) { if (this.use(c)) ai.gadWait = 0; }
      }
      for (let i = this.decoys.length - 1; i >= 0; i--) {
        const d = this.decoys[i];
        d.mesh.visible = d.until - g.time > 1 || Math.floor(g.time * 8) % 2 === 0;
        if (g.time > d.until) { g.scene.remove(d.mesh); this.decoys.splice(i, 1); }
      }
      for (const mine of this.mines.slice()) {
        mine.life -= dt;
        mine.led.visible = mine.arm > 0 ? true : Math.floor(g.time * 3) % 2 === 0;
        if (mine.arm > 0) { mine.arm -= dt; continue; }
        if (mine.life <= 0) { g.scene.remove(mine.mesh); this.mines = this.mines.filter((x) => x !== mine); continue; }
        if (!live || (g.net.active && !g.net.owns(mine.owner))) continue;
        for (const m of g.mechs) {
          if (m.alive && !CW.sameTeam(m.combatant, mine.owner) && m.pos.distanceTo(mine.pos) < MINE_R + m.radius) { this.boom(mine, true); break; }
        }
      }
    }
    // bots can't see you in your smoke
    hidden(c) { return c.smokeT && this.game.time < c.smokeT; }
    clear() {
      for (const m of this.mines) this.game.scene.remove(m.mesh);
      for (const d of this.decoys) this.game.scene.remove(d.mesh);
      this.mines = []; this.decoys = []; this.seq = 0;
    }
  }

  CW.Gadgets = Gadgets;
})();
