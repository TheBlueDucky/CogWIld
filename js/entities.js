// Cogwild — mechs, pilots, projectiles and effects
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  CW.sameTeam = (a, b) => !!a && !!b && (a === b || a.team === b.team);
  const IDLE = { throttle: 0, turn: 0, up: false, down: false, upPressed: false, fire: false, aim: null };
  const tmp = new V3(), tmp2 = new V3();
  // shapes reused by every mech and pilot (so respawns don't keep allocating new ones)
  const sharedGeoCache = {};
  const sharedGeo = (key, fn) => sharedGeoCache[key] || (sharedGeoCache[key] = fn());

  // ======================= MECH =======================
  class Mech {
    constructor(game, bp, opts) {
      this.game = game;
      this.combatant = opts.combatant;
      this.color = opts.color;
      this.name = bp.name;
      this.group = new THREE.Group();
      this.group.rotation.order = 'YXZ';
      this.parts = CW.connected(CW.ensureCamera(bp.parts).parts).map((p) => {
        const def = CW.PARTS[p.t];
        const obj = CW.buildPartMesh(p.t, this.color);
        obj.position.set(p.x, p.y, p.z);
        this.group.add(obj);
        return { t: p.t, x: p.x, y: p.y, z: p.z, hp: def.hp, maxHp: def.hp, obj, alive: true, cd: Math.random() * 0.4, wp: new V3() };
      });
      this.core = this.parts.find((p) => p.t === 'core');
      this.camPart = this.parts.find((p) => p.t === 'camera');
      // a seated pilot behind the camera lens, so a driven mech never looks empty
      if (this.camPart) {
        const bust = new THREE.Group();
        const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; bust.add(m); return m; };
        add(sharedGeo('Cylinder(0.2, 0.24, 0.32, 10)', () => new THREE.CylinderGeometry(0.2, 0.24, 0.32, 10)), CW.mat(this.color), 0, 0.5, 0.12);
        add(sharedGeo('Sphere(0.17, 12, 10)', () => new THREE.SphereGeometry(0.17, 12, 10)), CW.mat(0xffd6a5), 0, 0.78, 0.12);
        add(sharedGeo('Sphere(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)', () => new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), CW.mat(CW.shade(this.color, -0.15)), 0, 0.8, 0.12);
        add(sharedGeo('Box(0.26, 0.07, 0.06)', () => new THREE.BoxGeometry(0.26, 0.07, 0.06)), CW.mat(0x7df9ff, { emissive: 0x1f8a99 }), 0, 0.78, -0.04);
        this.camPart.obj.add(bust);
        this.bust = bust;
      }
      // wheels and legs on the bottom row get visual suspension
      this.suspended = this.parts.filter((p) => (p.t === 'wheel' || p.t === 'leg') && p.y === Math.min(...this.parts.map((q) => q.y)));
      this.dashCd = 0;
      this.dashTime = 0;
      this.ramCd = 0;
      this.pos = new V3();
      this.vel = new V3();
      this.yaw = 0; this.pitch = 0; this.roll = 0;
      this.alive = true;
      this.occupied = true;
      this.input = Object.assign({}, IDLE);
      this.walkPhase = 0;
      this.shieldFlash = 0;
      this.shieldDelay = 0;
      this.medium = 'land';
      this.fwdSpeed = 0;
      const sm = new THREE.Mesh(
        sharedGeo('Sphere(1, 20, 14)', () => new THREE.SphereGeometry(1, 20, 14)),
        new THREE.MeshBasicMaterial({ color: 0x7ee8ff, transparent: true, opacity: 0, depthWrite: false })
      );
      this.shieldMesh = sm;
      this.group.add(sm);
      this.recompute();
      this.shield = this.shieldMax;
      this.totalParts = this.parts.length;
      game.scene.add(this.group);
    }

    recompute() {
      const alive = this.parts.filter((p) => p.alive);
      const s = CW.analyze(alive);
      Object.assign(this, {
        mass: s.mass, pr: s.pr, drive: s.drive, swim: s.swim, thrust: s.thrust, rotors: s.rotors,
        wings: s.wings, buoy: s.buoy, legs: s.legs, wheels: s.wheels, shieldMax: s.shield, domains: s.domains, stats: s,
        boosters: s.boosters, spikes: s.spikes,
      });
      this.cameraOk = !!(this.camPart && this.camPart.alive);
      this.baseOff = 0.5 - s.minY;
      let r = 0;
      for (const p of alive) r = Math.max(r, Math.hypot(p.x, p.y, p.z));
      this.radius = r + 0.8;
      this.shield = Math.min(this.shield || 0, this.shieldMax);
      this.shieldMesh.scale.setScalar(this.radius + 0.2);
      this.weapons = alive.filter((p) => CW.PARTS[p.t].weapon);
      this.isPlane = this.wings > 0 && this.rotors === 0 && this.thrust > 0;
    }

    place(pos, yaw) {
      this.yaw = yaw;
      const g = this.game.world.groundAt(pos.x, pos.z);
      this.pos.set(pos.x, Math.max(g, CW.WATER_Y - 0.5) + this.baseOff + 0.5, pos.z);
      this.syncTransform();
    }

    syncTransform() {
      this.group.position.copy(this.pos);
      this.group.rotation.set(this.pitch, this.yaw, this.roll);
      this.group.updateMatrixWorld(true);
      for (const p of this.parts) if (p.alive) p.wp.setFromMatrixPosition(p.obj.matrixWorld);
    }

    get center() { return this.pos; }

    update(dt) {
      if (!this.alive) return;
      const world = this.game.world;
      const inp = this.occupied ? this.input : IDLE;
      const g = CW.GRAV;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const fx = -sy, fz = -cy;
      const bottom = this.pos.y - this.baseOff;
      const ground = world.groundAt(this.pos.x, this.pos.z, bottom + 0.5);
      const grounded = bottom <= ground + 0.08;
      const depth = CW.WATER_Y - bottom;
      const inWater = depth > 0.15;
      const pr = this.pr;
      this.medium = inWater ? 'water' : grounded ? 'land' : 'air';

      // --- horizontal drive ---
      let F = 0;
      if (grounded && !inWater) F += this.drive + this.swim * 0.25; // beached props flop slowly
      if (inWater) F += this.swim + this.drive * (grounded ? 0.35 : 0.08);
      if (!grounded && !inWater) F += this.rotors * 45;
      F += this.thrust * (inWater ? 0.35 : 1);
      F *= pr * (this.turbo > 0 ? 1.4 : 1);
      const acc = (F * inp.throttle) / this.mass;
      this.vel.x += fx * acc * dt;
      this.vel.z += fz * acc * dt;

      let fwd = this.vel.x * fx + this.vel.z * fz;
      const sideX = this.vel.x - fx * fwd, sideZ = this.vel.z - fz * fwd;
      const dashing = this.dashTime > 0;
      const sideK = dashing ? 0.6 : grounded && !inWater ? 8 : inWater ? 2.5 : 1.2;
      const sk = Math.exp(-sideK * dt);
      const drag = dashing ? 0.35 : inWater ? CW.DRAG.water : grounded ? CW.DRAG.land : CW.DRAG.air;
      const dk = Math.exp(-drag * dt);
      this.vel.x = (fx * fwd + sideX * sk) * dk;
      this.vel.z = (fz * fwd + sideZ * sk) * dk;
      fwd *= dk;
      this.fwdSpeed = fwd;

      // --- turning ---
      const canSteer =
        (grounded && (this.drive > 0 || this.swim > 0)) || (inWater && (this.swim > 0 || this.drive > 0)) ||
        (!grounded && !inWater && (this.rotors > 0 || this.wings > 0)) || this.thrust > 0;
      const turnRate = (canSteer ? 2.5 : 0.5) * (0.5 + 0.5 * pr);
      this.yaw -= inp.turn * turnRate * dt;

      // --- vertical ---
      this.vel.y -= g * dt;
      if (inWater) {
        const sub = Math.min(1, depth / 0.9);
        this.vel.y += ((this.buoy * sub) / this.mass) * g * dt + 0.35 * sub * g * dt;
        if (this.swim > 0) {
          if (inp.up) this.vel.y += 18 * pr * dt;
          if (inp.down) this.vel.y -= 18 * pr * dt;
        }
        this.vel.y *= Math.exp(-2.8 * dt);
      }
      const wingLift = this.wings * Math.max(0, fwd - 8) * CW.WING_LIFT;
      const liftCap = (this.rotors * CW.ROTOR_LIFT * pr + wingLift) * g;
      if (liftCap > 0 && !(inWater && depth > 1)) {
        // steer toward a target climb/sink speed: Space climbs, C/Ctrl/Q dives fast, nothing = hold altitude
        const targetVy = inp.up ? 13 : inp.down ? -18 : 0;
        const desired = clamp((targetVy - this.vel.y) * 3.5, -g, 16);
        const need = this.mass * (g + desired);
        const Fz = clamp(need, 0, liftCap);
        this.vel.y += (Fz / this.mass) * dt;
      }
      if (this.legs > 0 && grounded && !inWater && inp.upPressed && this.rotors === 0) this.vel.y = 11;

      // --- integrate with slope limits ---
      // arena walls: bounce back off the force field
      const lim = CW.ARENA_HALF - 1.5;
      let nx = this.pos.x + this.vel.x * dt;
      let nz = this.pos.z + this.vel.z * dt;
      if (Math.abs(nx) > lim || Math.abs(nz) > lim) {
        if (Math.abs(nx) > lim) this.vel.x = -Math.sign(nx) * Math.max(6, Math.abs(this.vel.x) * 0.6);
        if (Math.abs(nz) > lim) this.vel.z = -Math.sign(nz) * Math.max(6, Math.abs(this.vel.z) * 0.6);
        nx = clamp(nx, -lim, lim);
        nz = clamp(nz, -lim, lim);
        if (!this.wallFx || this.game.time - this.wallFx > 0.3) {
          this.wallFx = this.game.time;
          this.game.fx.burst(new V3(nx, this.pos.y, nz), { n: 10, color: this.game.fx.colorKey(0x9be7ff), speed: 8, life: 0.4, size: 0.3 });
          if (this.combatant.isPlayer) this.game.onWallHit();
        }
      }
      if (grounded) {
        const ng = world.groundAt(nx, nz, bottom + 0.5);
        const step = Math.hypot(nx - this.pos.x, nz - this.pos.z);
        const rise = ng - ground;
        // jets can shove a mech up steeper ground than wheels alone
        const jetPush = Math.min(0.6, ((this.thrust * pr) / this.mass) * 0.004);
        const maxSlope = (this.legs > 0 ? 2.4 : this.wheels > 0 ? 0.8 : 0.55) + jetPush;
        if (rise > 0.7 || (rise > 0.01 && rise > step * maxSlope)) {
          nx = this.pos.x; nz = this.pos.z;
          this.vel.x *= -0.2; this.vel.z *= -0.2;
        }
      }
      // bridge railings are solid: a mech on a deck can leave only through the ends
      const br = world.onBridge(this.pos.x, this.pos.z);
      if (br && Math.abs(bottom - br.y) < 0.6) {
        const lim2 = br.w - 0.9;
        if (br.axis === 'x') {
          if (Math.abs(nz - br.c) > lim2 && nx > br.a0 + 1 && nx < br.a1 - 1) { nz = br.c + Math.sign(nz - br.c) * lim2; this.vel.z *= -0.3; }
        } else if (Math.abs(nx - br.c) > lim2 && nz > br.a0 + 1 && nz < br.a1 - 1) { nx = br.c + Math.sign(nx - br.c) * lim2; this.vel.x *= -0.3; }
      }
      this.pos.x = nx; this.pos.z = nz;
      this.pos.y += this.vel.y * dt;
      // safety net: a broken value must never spread through the game
      if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z + this.yaw)) {
        const s = world.landSpawns[0];
        this.pos.set(s.x, s.y + this.baseOff + 1, s.z);
        this.vel.set(0, 0, 0);
        this.yaw = 0;
        return;
      }
      const g2 = world.groundAt(nx, nz, this.pos.y - this.baseOff + 0.5);
      if (this.pos.y - this.baseOff < g2) {
        this.pos.y = g2 + this.baseOff;
        if (this.vel.y < 0) this.vel.y = 0;
      }
      if (this.pos.y > CW.CEILING) { this.pos.y = CW.CEILING; this.vel.y = Math.min(-2, this.vel.y); }

      // --- body tilt ---
      let tp = 0, tr = 0;
      if (grounded && !inWater) {
        const hf = world.groundAt(this.pos.x + fx * 1.5, this.pos.z + fz * 1.5, bottom + 1);
        const hb = world.groundAt(this.pos.x - fx * 1.5, this.pos.z - fz * 1.5, bottom + 1);
        const hr = world.groundAt(this.pos.x + cy * 1.5, this.pos.z - sy * 1.5, bottom + 1);
        const hl = world.groundAt(this.pos.x - cy * 1.5, this.pos.z + sy * 1.5, bottom + 1);
        tp = clamp(Math.atan2(hf - hb, 3), -0.6, 0.6);
        tr = clamp(Math.atan2(hr - hl, 3), -0.6, 0.6);
      } else if (inWater) {
        tp = Math.sin(this.game.time * 1.7 + this.pos.x) * 0.04;
        tr = Math.sin(this.game.time * 1.3 + this.pos.z) * 0.05;
      } else {
        tp = clamp(this.vel.y * 0.03, -0.4, 0.4);
        tr = -inp.turn * 0.35;
      }
      const k = 1 - Math.exp(-6 * dt);
      this.pitch += (tp - this.pitch) * k;
      this.roll += (tr - this.roll) * k;

      // --- lava burns whatever is dipped in it ---
      const harm = CW.LIQUID_HARM[world.arena.liquid];
      if (harm && inWater) {
        for (const p of this.parts) if (p.alive && p.wp.y < 0.6) this.hit(p, harm.mech * dt, null);
        if (world.arena.lava) this.vel.y += 9 * dt; // lava is thick: it pushes you back up
        if (Math.random() < dt * 12) this.game.fx.burst(new V3(this.pos.x, 0.3, this.pos.z), { n: 2, color: harm.fx === 'toxic' ? this.game.fx.colorKey(0x9dff3a) : 'fire', speed: 3, up: 4, life: 0.5, size: 0.5 });
        if (this.combatant.isPlayer && (!this.lavaWarn || this.game.time - this.lavaWarn > 3)) { this.lavaWarn = this.game.time; this.game.bigMsg(harm.msg, 'Get out, it is eating your mech! (F = unstuck)', 1.5); }
        if (!this.alive) return;
      }

      // --- power-up timers ---
      if (this.overcharge > 0) this.overcharge -= dt;
      if (this.turbo > 0) { this.turbo -= dt; this.dashCd = Math.min(this.dashCd, 0.5); }

      // --- dash ---
      if (this.dashCd > 0) this.dashCd -= dt;
      if (this.ramCd > 0) this.ramCd -= dt;
      if (this.dashTime > 0) {
        this.dashTime -= dt;
        this.game.fx.burst(this.pos, { n: 2, color: this.game.trailMat(this.combatant), speed: 2, life: 0.5, size: 0.45 });
      }
      if (inp.dash) { this.dash(inp.dash); inp.dash = 0; }

      // --- shield ---
      if (this.shieldDelay > 0) this.shieldDelay -= dt;
      else this.shield = Math.min(this.shieldMax, this.shield + 9 * dt);
      this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2);
      this.shieldMesh.material.opacity = this.shieldFlash * 0.45;
      if (this.protect > 0) {
        this.protect -= dt;
        this.shieldMesh.material.opacity = Math.max(this.shieldMesh.material.opacity, 0.16 + Math.sin(this.game.time * 10) * 0.08);
      }

      // --- animate parts ---
      this.walkPhase += Math.abs(fwd) * dt * 1.4;
      const moveAmt = Math.min(1, Math.abs(fwd) / 3);
      const aim = inp.aim;
      for (const p of this.parts) {
        if (!p.alive) continue;
        const ud = p.obj.userData;
        switch (p.t) {
          case 'wheel': ud.spin.rotation.x -= (fwd * dt) / 0.48; break;
          case 'leg': ud.swing.rotation.x = Math.sin(this.walkPhase + ((p.x + p.z) & 1) * Math.PI) * 0.55 * moveAmt; break;
          case 'rotor': {
            const rs = (this.occupied ? 28 : 3) * pr;
            ud.spin.rotation.y += dt * rs;
            if (ud.blur) ud.blur.material.opacity = Math.min(0.35, rs / 80);
            break;
          }
          case 'prop': ud.spin.rotation.z += dt * (inWater ? 6 + Math.abs(inp.throttle) * 20 : 2); break;
          case 'jet': {
            const target = 0.25 + Math.max(0, inp.throttle) * (0.8 + Math.random() * 0.3);
            ud.flame.scale.z += (target - ud.flame.scale.z) * 0.3;
            break;
          }
          case 'booster': {
            const s = this.dashTime > 0 ? 1 + Math.random() * 0.3 : 0.01;
            ud.boost.scale.setScalar(s);
            break;
          }
          case 'saw': ud.saw.rotation.x -= dt * (this.occupied ? 30 : 4); break;
          case 'drone': ud.drone.position.y = 0.3 + Math.sin(this.game.time * 3 + p.x) * 0.15; ud.drone.rotation.y += dt * 2; break;
          case 'flag': ud.flag.rotation.y = Math.sin(this.game.time * 6 + p.x) * 0.35 - Math.min(0.9, Math.abs(fwd) * 0.04); break;
        }
        if (ud.aim && aim && this.occupied) ud.aim.lookAt(aim);
        if (p.cd > 0) p.cd -= dt;
      }

      this.syncTransform();
      // suspension: each bottom wheel/leg reaches down to (or is pushed up by) the ground under it
      if (grounded && !inWater) {
        for (const p of this.suspended) {
          if (!p.alive) continue;
          tmp.set(p.x, p.y, p.z).applyMatrix4(this.group.matrixWorld);
          const gy = world.groundAt(tmp.x, tmp.z, tmp.y + 1);
          const want = clamp(gy - (tmp.y - 0.48), -0.45, 0.35);
          p.susp = (p.susp || 0) + (want - (p.susp || 0)) * Math.min(1, dt * 14);
          p.obj.position.y = p.y + p.susp;
        }
      }
      if (this.bust) this.bust.visible = this.occupied;
      // repair drones slowly patch up damaged parts
      if (this.stats.heal > 0) this.repair(this.stats.heal * dt);
      // saw blades grind any enemy part they touch
      if (this.stats.saws > 0 && this.occupied) this.grind(dt);
      if (inp.fire && aim) this.fireWeapons(aim);
    }

    grind(dt) {
      const game = this.game;
      for (const s of this.parts) {
        if (!s.alive || s.t !== 'saw') continue;
        const tip = s.obj.userData.saw.getWorldPosition(tmp2);
        for (const m of game.mechs) {
          if (!m.alive || m === this || CW.sameTeam(m.combatant, this.combatant)) continue;
          if (m.pos.distanceTo(tip) > m.radius + 1) continue;
          for (const p of m.parts) {
            if (!p.alive || p.wp.distanceTo(tip) > 1.25) continue;
            m.hit(p, CW.PARTS.saw.saw * this.dmgMult() * dt, this.combatant);
            if (Math.random() < dt * 20) game.fx.burst(p.wp, { n: 2, color: 'spark', speed: 9, life: 0.25, size: 0.12, grav: 20 });
            if (this.combatant.isPlayer && Math.random() < dt * 4) game.onPlayerHit(p.wp.clone(), CW.PARTS.saw.saw * 0.25, true);
            break;
          }
        }
        for (const pl of game.pilots) {
          if (pl.alive && !CW.sameTeam(pl.combatant, this.combatant) && pl.center.distanceTo(tip) < 1.4) pl.hit(60 * dt, this.combatant);
        }
      }
    }

    // dir: 1 = forward, -1 = back, 2/-2 = sidestep right/left (legs only)
    dash(dir) {
      if (!this.alive || this.dashCd > 0) return false;
      const s = this.stats;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let dx = -sy, dz = -cy;
      if (dir === -1) { dx = sy; dz = cy; }
      if (Math.abs(dir) === 2 && this.legs > 0) { const k = Math.sign(dir); dx = cy * k; dz = -sy * k; }
      const P = s.dashPower;
      this.vel.x += dx * P;
      this.vel.z += dz * P;
      if (this.medium === 'land') this.vel.y = Math.max(this.vel.y, 3);
      this.dashCd = this.legs > 0 ? s.dashCd * 0.75 : s.dashCd;
      this.dashMax = this.dashCd;
      this.dashTime = 0.35;
      this.game.onDash(this);
      return true;
    }

    // damage multiplier: bot difficulty × overcharge power-up
    dmgMult() { return (this.baseDmg || 1) * (this.overcharge > 0 ? 1.5 : 1); }

    fireWeapons(aim) {
      if (this.protect > 0 && this.weapons.length) this.protect = 0; // shooting ends spawn protection (no free hits)
      const rateK = 0.4 + 0.6 * this.pr;
      const mult = this.dmgMult();
      for (const p of this.weapons) {
        if (!p.alive || p.cd > 0) continue;
        const w = CW.PARTS[p.t].weapon;
        const ud = p.obj.userData;
        const origin = tmp.copy(p.wp);
        origin.y += 0.12;
        const dir = tmp2.copy(aim).sub(origin).normalize();
        if (w.kind === 'shell') {
          dir.x += (Math.random() - 0.5) * 0.02;
          dir.y += (Math.random() - 0.5) * 0.02;
          dir.z += (Math.random() - 0.5) * 0.02;
          dir.normalize();
        }
        const start = origin.clone().addScaledVector(dir, ud.muzzle || 0.8);
        if (w.kind === 'laser') {
          this.game.fx.laser(start, dir.clone(), w.range, w.dmg * mult, this.combatant);
          p.cd = 1 / (w.rate * rateK);
          if (this.combatant.isPlayer && Math.random() < 0.3) this.game.audio.shot('laser');
          continue;
        }
        const vel = dir.clone().multiplyScalar(w.speed).add(this.vel);
        if (w.kind === 'flame') vel.multiplyScalar(0.9 + Math.random() * 0.2).add(new V3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4));
        this.game.fx.projectile({ pos: start, vel, dmg: w.dmg * mult, splash: w.splash, grav: w.grav, who: this.combatant, kind: w.kind });
        if (w.kind === 'rail') this.game.fx.burst(start, { n: 8, color: this.game.fx.colorKey(0x48cae4), speed: 7, life: 0.3, size: 0.25 });
        else if (w.kind !== 'flame') this.game.fx.burst(start, { n: 3, color: 'spark', speed: 4, life: 0.15, size: 0.25 });
        p.cd = 1 / (w.rate * rateK);
        if (this.combatant.isPlayer) this.game.audio.shot(w.kind);
      }
    }

    hit(part, dmg, who) {
      if (!this.alive || !part.alive) return;
      if (CW.sameTeam(who, this.combatant)) return;
      if (this.protect > 0) { this.shieldFlash = 0.7; return; } // spawn protection
      if (this.dmgTaken) dmg *= this.dmgTaken;
      this.lastHitBy = who;
      this.shieldDelay = 3;
      if (this.shield > 0) {
        const a = Math.min(this.shield, dmg);
        this.shield -= a;
        dmg -= a;
        this.shieldFlash = 1;
      }
      if (this.combatant.isPlayer) this.game.onPlayerDamaged(dmg, who);
      if (dmg <= 0) return;
      part.hp -= dmg;
      if (part.hp <= 0) this.breakPart(part, who);
    }

    splash(point, radius, dmg, who) {
      if (!this.alive || CW.sameTeam(who, this.combatant)) return false;
      if (this.pos.distanceTo(point) > radius + this.radius) return false;
      let any = false;
      for (const p of this.parts) {
        if (!p.alive) continue;
        const d = p.wp.distanceTo(point);
        if (d < radius) { this.hit(p, dmg * (1 - (d / radius) * 0.6), who); any = true; }
      }
      return any;
    }

    breakPart(part, who) {
      part.alive = false;
      this.game.fx.debris(part.obj, this.vel);
      this.game.fx.explosion(part.wp, 0.6);
      this.game.onPartBroken(this, who);
      if (part.t === 'camera' && this.combatant.isPlayer) this.game.bigMsg('CAMERA DESTROYED', 'Switched to chase view', 2);
      if (part.t === 'core') { this.destroy(who); return; }
      const alive = this.parts.filter((p) => p.alive);
      const keep = new Set(CW.connected(alive));
      for (const p of alive) {
        if (!keep.has(p)) { p.alive = false; this.game.fx.debris(p.obj, this.vel); }
      }
      this.recompute();
    }

    repair(amount) {
      const dmg = this.parts.filter((p) => p.alive && p.hp < p.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      if (!dmg.length) return false;
      const each = amount / Math.min(3, dmg.length);
      for (let i = 0; i < Math.min(3, dmg.length); i++) dmg[i].hp = Math.min(dmg[i].maxHp, dmg[i].hp + each);
      return true;
    }

    integrity() {
      let hp = 0, max = 0;
      for (const p of this.parts) { max += p.maxHp; if (p.alive) hp += p.hp; }
      return hp / max;
    }

    destroy(who) {
      if (!this.alive) return;
      this.alive = false;
      this.game.fx.explosion(this.pos, 2.2);
      for (const p of this.parts) if (p.alive) { p.alive = false; this.game.fx.debris(p.obj, this.vel); }
      this.game.scene.remove(this.group);
      this.game.onMechDestroyed(this, who);
    }

    dispose() {
      this.game.scene.remove(this.group);
      this.shieldMesh.material.dispose(); // the only per-mech material
    }
  }

  // ======================= PILOT =======================
  class Pilot {
    constructor(game, combatant, pos, hp) {
      this.game = game;
      this.combatant = combatant;
      this.pos = pos.clone();
      this.vel = new V3();
      this.yaw = 0;
      this.hp = hp;
      this.maxHp = 60;
      this.alive = true;
      this.grounded = false;
      this.cd = 0;
      this.walk = 0;
      const g = new THREE.Group();
      const col = combatant.color;
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
      this.legL = add(sharedGeo('Box(0.22, 0.6, 0.24)', () => new THREE.BoxGeometry(0.22, 0.6, 0.24)), CW.mat(0x3d405b), -0.15, 0.3, 0);
      this.legR = add(sharedGeo('Box(0.22, 0.6, 0.24)', () => new THREE.BoxGeometry(0.22, 0.6, 0.24)), CW.mat(0x3d405b), 0.15, 0.3, 0);
      add(sharedGeo('Cylinder(0.3, 0.34, 0.75, 10)', () => new THREE.CylinderGeometry(0.3, 0.34, 0.75, 10)), CW.mat(col), 0, 0.95, 0);
      add(sharedGeo('Box(0.42, 0.5, 0.25)', () => new THREE.BoxGeometry(0.42, 0.5, 0.25)), CW.mat(0x6c757d), 0, 1.0, 0.28);
      add(sharedGeo('Sphere(0.28, 12, 10)', () => new THREE.SphereGeometry(0.28, 12, 10)), CW.mat(0xffd6a5), 0, 1.55, 0);
      add(sharedGeo('Sphere(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)', () => new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), CW.mat(CW.shade(col, -0.15)), 0, 1.58, 0);
      add(sharedGeo('Box(0.4, 0.12, 0.1)', () => new THREE.BoxGeometry(0.4, 0.12, 0.1)), CW.mat(0x7df9ff, { emissive: 0x1f8a99 }), 0, 1.55, -0.26);
      add(sharedGeo('Box(0.12, 0.12, 0.6)', () => new THREE.BoxGeometry(0.12, 0.12, 0.6)), CW.mat(0x343a40), 0.36, 1.0, -0.2);
      this.mesh = g;
      game.scene.add(g);
    }

    get center() { return tmp.set(this.pos.x, this.pos.y + 0.9, this.pos.z); }

    update(dt, inp) {
      if (!this.alive) return;
      const world = this.game.world;
      const inWater = this.pos.y < CW.WATER_Y - 0.9;
      const speed = inWater ? 5.5 : 12;
      const k = this.grounded || inWater ? 12 : 3;
      const tx = inp.mx * speed, tz = inp.mz * speed;
      if (this.grounded || inWater) this.flung = false;
      if (!this.flung) { // while being flung clear of lava, keep the throw
        this.vel.x += (tx - this.vel.x) * Math.min(1, k * dt);
        this.vel.z += (tz - this.vel.z) * Math.min(1, k * dt);
      }
      this.vel.y -= CW.GRAV * dt;
      if (inWater) {
        this.vel.y += (CW.WATER_Y - 1.0 - this.pos.y) * 14 * dt;
        this.vel.y *= Math.exp(-3 * dt);
      }
      if (inp.jump && (this.grounded || inWater)) this.vel.y = inWater ? 6 : 8.5;
      const lim = CW.ARENA_HALF - 1;
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -lim, lim);
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -lim, lim);
      this.pos.y += this.vel.y * dt;
      let g = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.8);
      this.onMech = null;
      // mechs are solid to stand on: the highest part top under your feet counts as ground
      for (const m of this.game.mechs) {
        if (!m.alive || Math.abs(m.pos.x - this.pos.x) > m.radius + 1 || Math.abs(m.pos.z - this.pos.z) > m.radius + 1) continue;
        for (const p of m.parts) {
          if (!p.alive || Math.abs(p.wp.x - this.pos.x) > 0.7 || Math.abs(p.wp.z - this.pos.z) > 0.7) continue;
          const top = p.wp.y + 0.5;
          if (top > g && top < this.pos.y + 0.9) { g = top; this.onMech = m; }
        }
      }
      this.grounded = false;
      if (this.pos.y <= g) { this.pos.y = g; this.vel.y = Math.max(0, this.vel.y); this.grounded = true; }
      const harm = CW.LIQUID_HARM[world.arena.liquid];
      if (harm && this.pos.y < 0.3) {
        this.hp -= harm.pilot * dt;
        if (Math.random() < dt * 8) this.game.fx.burst(this.pos, { n: 2, color: 'fire', speed: 2, up: 3, life: 0.4, size: 0.3 });
        if (this.hp <= 0) { this.hp = 0.01; this.hit(1, null); if (!this.alive) return; }
      }
      if (inp.yaw !== undefined) this.yaw = inp.yaw;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.walk += sp * dt * 1.6;
      const sw = Math.sin(this.walk) * Math.min(1, sp / 3) * 0.6;
      this.legL.rotation.x = sw;
      this.legR.rotation.x = -sw;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      if (this.cd > 0) this.cd -= dt;
      if (this.protect > 0) this.protect -= dt;
      if (inp.fire && inp.aim && this.cd <= 0) {
        const o = new V3(this.pos.x, this.pos.y + 1.15, this.pos.z);
        const dir = inp.aim.clone().sub(o).normalize();
        this.game.fx.projectile({ pos: o.addScaledVector(dir, 0.7), vel: dir.multiplyScalar(95), dmg: 5, splash: 0, grav: 0, who: this.combatant, kind: 'bolt' });
        this.cd = 0.22;
        if (this.combatant.isPlayer) this.game.audio.shot('bolt');
      }
    }

    hit(dmg, who) {
      if (!this.alive || CW.sameTeam(who, this.combatant)) return;
      if (this.protect > 0 && who) return; // a moment of safety right after ejecting
      this.hp -= dmg;
      if (this.combatant.isPlayer) this.game.onPlayerDamaged(dmg, who);
      this.game.fx.burst(this.center, { n: 5, color: 'spark', speed: 5, life: 0.3, size: 0.25 });
      if (this.hp <= 0) {
        this.alive = false;
        this.game.fx.explosion(this.center, 0.8);
        this.game.scene.remove(this.mesh);
        this.game.onPilotKilled(this, who);
      }
    }

    dispose() { this.game.scene.remove(this.mesh); }
  }

  // ======================= FX =======================
  class Fx {
    constructor(game) {
      this.game = game;
      this.projectiles = [];
      this.particles = [];
      this.debrisList = [];
      this.pGeo = new THREE.IcosahedronGeometry(1, 0);
      this.pMats = {
        fire: new THREE.MeshBasicMaterial({ color: 0xffa53a }),
        flash: new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
        smoke: new THREE.MeshLambertMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.7, depthWrite: false }),
        spark: new THREE.MeshBasicMaterial({ color: 0xffe066 }),
        water: new THREE.MeshLambertMaterial({ color: 0xe6f7ff, transparent: true, opacity: 0.85 }),
      };
      this.projGeo = {
        shell: new THREE.SphereGeometry(0.17, 8, 6),
        rocket: new THREE.CylinderGeometry(0.13, 0.13, 0.8, 8).rotateX(Math.PI / 2),
        bolt: new THREE.BoxGeometry(0.1, 0.1, 0.8),
        rail: new THREE.BoxGeometry(0.14, 0.14, 3.2),
        flame: new THREE.IcosahedronGeometry(0.3, 0),
      };
      this.projMat = {
        shell: new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
        rocket: new THREE.MeshBasicMaterial({ color: 0xff3d3d }),
        bolt: new THREE.MeshBasicMaterial({ color: 0x5cf2ff }),
        rail: new THREE.MeshBasicMaterial({ color: 0xbff6ff }),
        flame: new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.85, depthWrite: false }),
      };
    }

    clear() {
      for (const p of this.projectiles) this.game.scene.remove(p.mesh);
      for (const p of this.particles) this.game.scene.remove(p.mesh);
      for (const d of this.debrisList) this.game.scene.remove(d.obj);
      if (this.beams) for (const b of this.beams) this.game.scene.remove(b.mesh);
      this.projectiles = []; this.particles = []; this.debrisList = []; if (this.beams) this.beams = [];
    }

    projectile(o) {
      const mesh = new THREE.Mesh(this.projGeo[o.kind], this.projMat[o.kind]);
      mesh.position.copy(o.pos);
      this.game.scene.add(mesh);
      const life = o.kind === 'rocket' ? 4 : o.kind === 'flame' ? 0.38 : o.kind === 'rail' ? 1.2 : 2.5;
      this.projectiles.push({ ...o, prev: o.pos.clone(), life, maxLife: life, mesh, trail: 0 });
    }

    colorKey(hexColor) {
      const k = 'c' + hexColor;
      if (!this.pMats[k]) this.pMats[k] = new THREE.MeshBasicMaterial({ color: hexColor });
      return k;
    }

    // First mech part or pilot touched by segment a→b (enemies of `who` only)
    segmentHit(a, b, who) {
      const ab = new V3().subVectors(b, a);
      const abLen2 = ab.lengthSq() || 1e-6;
      const segT = (c) => clamp(((c.x - a.x) * ab.x + (c.y - a.y) * ab.y + (c.z - a.z) * ab.z) / abLen2, 0, 1);
      const segD2 = (c, t) => {
        const x = a.x + ab.x * t - c.x, y = a.y + ab.y * t - c.y, z = a.z + ab.z * t - c.z;
        return x * x + y * y + z * z;
      };
      let bestT = 2, hit = null;
      for (const m of this.game.mechs) {
        if (!m.alive || CW.sameTeam(m.combatant, who)) continue;
        if (segD2(m.pos, segT(m.pos)) > (m.radius + 1) * (m.radius + 1)) continue;
        for (const part of m.parts) {
          if (!part.alive) continue;
          const t = segT(part.wp);
          if (t < bestT && segD2(part.wp, t) < 0.42) { bestT = t; hit = { mech: m, part }; }
        }
      }
      for (const pl of this.game.pilots) {
        if (!pl.alive || CW.sameTeam(pl.combatant, who)) continue;
        const c = pl.center.clone();
        const t = segT(c);
        if (t < bestT && segD2(c, t) < 0.7) { bestT = t; hit = { pilot: pl }; }
      }
      if (!hit) return null;
      hit.point = a.clone().addScaledVector(ab, bestT);
      return hit;
    }

    laser(start, dir, range, dmg, who) {
      const world = this.game.world;
      let len = range;
      for (let t = 1; t < range; t += 1) {
        const x = start.x + dir.x * t, y = start.y + dir.y * t, z = start.z + dir.z * t;
        if (y < world.groundAt(x, z, y) || (y < CW.WATER_Y && start.y >= CW.WATER_Y)) { len = t; break; }
      }
      const end = start.clone().addScaledVector(dir, len);
      const hit = this.segmentHit(start, end, who);
      if (hit) {
        end.copy(hit.point);
        if (hit.part) hit.mech.hit(hit.part, dmg, who);
        if (hit.pilot) hit.pilot.hit(dmg * 1.5, who);
        if (who && who.isPlayer) this.game.onPlayerHit(hit.point, dmg, true);
        if (Math.random() < 0.5) this.burst(end, { n: 2, color: 'spark', speed: 5, life: 0.2, size: 0.15 });
      }
      if (!this.beamGeo) {
        this.beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
        this.beamMat = new THREE.MeshBasicMaterial({ color: 0x7dfff0, transparent: true, opacity: 0.85, depthWrite: false });
        this.beams = [];
      }
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      beam.position.copy(start);
      beam.lookAt(end);
      beam.scale.set(1, 1, start.distanceTo(end));
      this.game.scene.add(beam);
      this.beams.push({ mesh: beam, life: 0.07 });
    }

    burst(pos, o) {
      const n = o.n || 6;
      for (let i = 0; i < n; i++) {
        if (this.particles.length > 500) { const old = this.particles.shift(); this.game.scene.remove(old.mesh); }
        const mesh = new THREE.Mesh(this.pGeo, this.pMats[o.color || 'fire']);
        mesh.position.copy(pos);
        const s = (o.size || 0.4) * (0.6 + Math.random() * 0.8);
        mesh.scale.setScalar(s);
        const v = new V3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar((o.speed || 6) * (0.4 + Math.random() * 0.8));
        if (o.up) v.y += o.up;
        const life = (o.life || 0.6) * (0.6 + Math.random() * 0.8);
        this.particles.push({ mesh, vel: v, life, max: life, s0: s, grow: o.grow || 0, grav: o.grav || 0 });
        this.game.scene.add(mesh);
      }
    }

    explosion(pos, size) {
      const p = pos.clone ? pos.clone() : new V3(pos.x, pos.y, pos.z);
      this.burst(p, { n: 1, color: 'flash', speed: 0, life: 0.18, size: 1.6 * size, grow: 10 * size });
      this.burst(p, { n: Math.round(8 * size + 4), color: 'fire', speed: 7 * size + 2, life: 0.5, size: 0.5 * size + 0.2 });
      this.burst(p, { n: Math.round(5 * size + 2), color: 'smoke', speed: 3, life: 1.4, size: 0.7 * size + 0.3, grow: 1.5, up: 2 });
      this.burst(p, { n: Math.round(6 * size), color: 'spark', speed: 14 * size + 4, life: 0.45, size: 0.15, grav: 20 });
      this.game.audio.boom(size, p);
      this.game.onExplosion(p, size);
    }

    splashFx(pos, size) {
      const p = new V3(pos.x, CW.WATER_Y + 0.1, pos.z);
      this.burst(p, { n: Math.round(8 * size + 3), color: 'water', speed: 3, up: 7 * size + 3, life: 0.8, size: 0.3 * size + 0.15, grav: 22 });
    }

    debris(obj, baseVel) {
      this.game.scene.attach(obj);
      const v = new V3((Math.random() - 0.5) * 12, 5 + Math.random() * 8, (Math.random() - 0.5) * 12).add(baseVel);
      const a = new V3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      this.debrisList.push({ obj, vel: v, ang: a, life: 5, s0: obj.scale.x });
      if (this.debrisList.length > 140) { const d = this.debrisList.shift(); this.game.scene.remove(d.obj); }
    }

    update(dt) {
      const game = this.game;
      const world = game.world;
      if (this.beams) {
        for (let i = this.beams.length - 1; i >= 0; i--) {
          const b = this.beams[i];
          b.life -= dt;
          if (b.life <= 0) { game.scene.remove(b.mesh); this.beams.splice(i, 1); }
        }
      }
      // projectiles
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.prev.copy(p.mesh.position);
        p.vel.y -= p.grav * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.position.copy(p.pos);
        if (p.kind !== 'shell') p.mesh.lookAt(tmp.copy(p.pos).add(p.vel));
        p.life -= dt;
        if (p.kind === 'flame') {
          // flames swell and slow down as they burn out
          p.mesh.scale.setScalar(1 + (1 - p.life / p.maxLife) * 2.6);
          p.vel.multiplyScalar(Math.exp(-2.5 * dt));
        }
        if (Math.abs(p.pos.x) > CW.ARENA_HALF || Math.abs(p.pos.z) > CW.ARENA_HALF || p.pos.y > CW.CEILING + 10) p.life = 0; // stopped by the force field
        if (p.kind === 'rocket') {
          p.trail -= dt;
          if (p.trail <= 0) { p.trail = 0.025; this.burst(p.pos, { n: 1, color: 'smoke', speed: 0.5, life: 0.6, size: 0.3, grow: 1.2 }); }
        }
        let hit = null;
        // segment test vs mechs & pilots
        const a = p.prev, b = p.pos;
        const ab = tmp2.copy(b).sub(a);
        const abLen2 = ab.lengthSq() || 1e-6;
        const segT = (c) => clamp(((c.x - a.x) * ab.x + (c.y - a.y) * ab.y + (c.z - a.z) * ab.z) / abLen2, 0, 1);
        const segD2 = (c, t) => {
          const x = a.x + ab.x * t - c.x, y = a.y + ab.y * t - c.y, z = a.z + ab.z * t - c.z;
          return x * x + y * y + z * z;
        };
        let bestT = 2;
        for (const m of game.mechs) {
          if (!m.alive || CW.sameTeam(m.combatant, p.who)) continue;
          const tc = segT(m.pos);
          if (segD2(m.pos, tc) > (m.radius + 1) * (m.radius + 1)) continue;
          for (const part of m.parts) {
            if (!part.alive) continue;
            const t = segT(part.wp);
            if (t < bestT && segD2(part.wp, t) < 0.42) { bestT = t; hit = { mech: m, part }; }
          }
        }
        for (const pl of game.pilots) {
          if (!pl.alive || CW.sameTeam(pl.combatant, p.who)) continue;
          const c = pl.center.clone();
          const t = segT(c);
          if (t < bestT && segD2(c, t) < 0.7) { bestT = t; hit = { pilot: pl }; }
        }
        let impact = null;
        if (hit) impact = new V3(a.x + ab.x * bestT, a.y + ab.y * bestT, a.z + ab.z * bestT);
        if (!impact && p.pos.y < world.groundAt(p.pos.x, p.pos.z, p.pos.y)) impact = p.pos.clone();
        let inWater = false;
        if (!impact && p.prev.y >= CW.WATER_Y && p.pos.y < CW.WATER_Y) {
          if (p.splash > 0) { impact = p.pos.clone(); inWater = true; }
          else {
            // shells & bolts punch a short way into the water, slowing fast
            this.splashFx(p.pos, 0.4);
            p.vel.multiplyScalar(0.3);
            p.life = Math.min(p.life, 0.6);
          }
        }
        if (p.kind === 'flame' && (impact || p.life <= 0)) {
          // fire: damage what it touches (direct + a small area), no explosion
          if (impact && !inWater) {
            if (hit && hit.part) hit.mech.hit(hit.part, p.dmg, p.who);
            if (hit && hit.pilot) hit.pilot.hit(p.dmg * 1.5, p.who);
            for (const m of game.mechs) if (m !== (hit && hit.mech)) m.splash(impact, p.splash, p.dmg * 0.5, p.who);
            if (hit && p.who && p.who.isPlayer) game.onPlayerHit(impact, p.dmg, true);
            if (Math.random() < 0.3) this.burst(impact, { n: 1, color: 'fire', speed: 2, up: 2, life: 0.4, size: 0.4 });
          }
          game.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
        if (impact || p.life <= 0) {
          if (impact) {
            if (p.kind === 'rail') this.burst(impact, { n: 10, color: this.colorKey(0x48cae4), speed: 9, life: 0.4, size: 0.2 });
            if (hit && hit.part) { hit.mech.hit(hit.part, p.dmg, p.who); if (p.who && p.who.isPlayer) game.onPlayerHit(impact, p.dmg); }
            if (hit && hit.pilot) { hit.pilot.hit(p.dmg * (p.kind === 'shell' ? 1.6 : 1), p.who); if (p.who && p.who.isPlayer) game.onPlayerHit(impact, p.dmg * 1.6); }
            if (p.splash > 0) {
              let any = false;
              for (const m of game.mechs) if (m !== (hit && hit.mech)) any = m.splash(impact, p.splash, p.dmg * 0.6, p.who) || any;
              for (const pl of game.pilots) {
                if (pl.alive && !CW.sameTeam(pl.combatant, p.who) && pl.center.distanceTo(impact) < p.splash) { pl.hit(p.dmg * 0.8, p.who); any = true; }
              }
              if (any && p.who && p.who.isPlayer && !hit) game.onPlayerHit(impact, p.dmg * 0.6);
              if (inWater) this.splashFx(impact, 1.4);
              else this.explosion(impact, 1);
            } else if (inWater) this.splashFx(impact, 0.4);
            else this.burst(impact, { n: 5, color: hit ? 'spark' : 'smoke', speed: 5, life: 0.35, size: 0.22 });
          }
          game.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
        }
      }
      // particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { game.scene.remove(p.mesh); this.particles.splice(i, 1); continue; }
        p.vel.y -= p.grav * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-2 * dt));
        const t = p.life / p.max;
        p.mesh.scale.setScalar(p.s0 * (t + p.grow * (1 - t)) * (p.grow ? 1 : t));
      }
      // debris
      for (let i = this.debrisList.length - 1; i >= 0; i--) {
        const d = this.debrisList[i];
        d.life -= dt;
        if (d.life <= 0) { game.scene.remove(d.obj); this.debrisList.splice(i, 1); continue; }
        const o = d.obj;
        const inW = o.position.y < CW.WATER_Y;
        d.vel.y -= (inW ? 3 : CW.GRAV) * dt;
        if (inW) d.vel.multiplyScalar(Math.exp(-3 * dt));
        o.position.addScaledVector(d.vel, dt);
        o.rotation.x += d.ang.x * dt; o.rotation.y += d.ang.y * dt; o.rotation.z += d.ang.z * dt;
        const g = world.groundAt(o.position.x, o.position.z, o.position.y);
        if (o.position.y < g + 0.3) {
          o.position.y = g + 0.3;
          d.vel.y = Math.abs(d.vel.y) * 0.3;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
          d.ang.multiplyScalar(0.6);
        }
        if (d.life < 1) o.scale.setScalar(d.s0 * d.life);
      }
    }
  }

  CW.Mech = Mech;
  CW.Pilot = Pilot;
  CW.Fx = Fx;
})();
