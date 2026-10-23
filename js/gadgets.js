// Cogwild — Gadgets: a small extra move next to your super, 3 uses per match with a short cooldown.
// Pick one before PLAY (the mode & arena panel). Press G / the 🧰 button. Bots use theirs too.
//   Repair Kit · Proximity Mine · Jump Jets · Smoke Screen
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const USES = 3, COOLDOWN = 8;
  const MINE_R = 3.4, MINE_ARM = 1.2, MINE_LIFE = 40;

  CW.GADGETS = {
    repair: { name: 'Repair Kit', icon: '🔧', level: 1, desc: 'Fix about 30% of your mech at once' },
    mine: { name: 'Proximity Mine', icon: '💣', level: 3, desc: 'Drop a mine behind you: it blows up under the first enemy that comes close' },
    jump: { name: 'Jump Jets', icon: '🦘', level: 5, desc: 'A big leap up and forward: escape, or get on top of things' },
    smoke: { name: 'Smoke Screen', icon: '💨', level: 8, desc: 'A smoke cloud: bots lose you for 4 s and you get 4 s of turbo' },
  };
  CW.gadgetsFor = (level) => Object.keys(CW.GADGETS).filter((id) => CW.GADGETS[id].level <= level);

  class Gadgets {
    constructor(game) {
      this.game = game;
      this.mines = []; // { id, owner, pos, mesh, light, arm, life }
      this.seq = 0;
    }
    // the gadget a combatant brings: yours from the panel, bots pick one, other players say theirs when used
    type(c) {
      if (c.gadget) return c.gadget;
      const g = this.game;
      if (c.isPlayer) c.gadget = CW.gadgetsFor(g.level()).includes(g.settings.gadget) ? g.settings.gadget : 'repair';
      else { const ids = Object.keys(CW.GADGETS); c.gadget = ids[Math.floor(Math.random() * ids.length)]; }
      return c.gadget;
    }
    left(c) { return c.gadgetN === undefined ? USES : c.gadgetN; }
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
      this.effect(c, type, true, id);
      if (g.net.active) g.net.events.push({ k: 'gadget', c: c.netId, type, id, x: Math.round(m.pos.x * 10) / 10, z: Math.round(m.pos.z * 10) / 10 });
      if (c.isPlayer) g.meta.track('gadget');
      if (c.isPlayer) { g.toast(`${CW.GADGETS[type].icon} ${CW.GADGETS[type].name}! (${c.gadgetN} left)`); g.audio.tone(520, 0.1, 'square', 0.15, 1.6); }
      return true;
    }

    effect(c, type, real, id, at) {
      const g = this.game, m = c.mech, fx = g.fx;
      if (!m) return;
      if (type === 'repair') {
        if (real) for (let i = 0; i < 5; i++) m.repair(40);
        fx.burst(m.pos, { n: 22, color: fx.colorKey(0x7bc950), speed: 6, up: 4, life: 0.7, size: 0.35 });
      } else if (type === 'mine') {
        const back = new V3(Math.sin(m.yaw), 0, Math.cos(m.yaw)).multiplyScalar(m.radius + 2);
        const p = at ? new V3(at.x, 0, at.z) : m.pos.clone().add(back);
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
      this.effect(c, e.type, false, e.id, { x: +e.x || 0, z: +e.z || 0 });
    }

    update(dt) {
      const g = this.game;
      if (g.state !== 'match') return;
      const live = g.countdown <= 0 && !g.ended;
      for (const c of g.combatants) {
        if (c.gadgetCd > 0) c.gadgetCd = Math.max(0, c.gadgetCd - dt);
        if (!live || c.isPlayer || c.human || !c.alive || !c.mech || !c.mech.alive || (g.net.active && !g.net.owns(c))) continue;
        if (this.left(c) <= 0 || c.gadgetCd > 0 || Math.random() > dt * 2) continue;
        // bots: repair when hurt, mine and smoke when an enemy is close, jump when stuck
        const m = c.mech, t = c.ai && c.ai.target, near = t && t.pos && t.pos.distanceTo(m.pos) < 25;
        const type = this.type(c);
        const hurt = m.core.hp / m.core.maxHp < 0.45 || m.integrity() < 0.5;
        if ((type === 'repair' && hurt) || (type === 'mine' && near) || (type === 'smoke' && hurt && near) || (type === 'jump' && c.ai && c.ai.stuck > 1)) this.use(c);
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
    clear() { for (const m of this.mines) this.game.scene.remove(m.mesh); this.mines = []; this.seq = 0; }
  }

  CW.Gadgets = Gadgets;
})();
