// Cogwild — mechs, pilots, projectiles and effects
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const CLIFF = 3.2; // ground steeper than this (~73°) is a wall face: no speed gets a mech up it (v1.9.7)
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapA = (a) => (Number.isFinite(a) ? ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI : 0);
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
      this.fin = bp.fin || (opts.combatant && opts.combatant.isPlayer && game.profile ? game.profile.finish : '') || '';
      this.parts = CW.connected(CW.ensureCamera(bp.parts).parts).map((p) => {
        const def = CW.PARTS[p.t];
        const obj = CW.partMesh(p, this.color, this.fin);
        this.group.add(obj);
        return { t: p.t, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, hp: def.hp, maxHp: def.hp, obj, alive: true, cd: Math.random() * 0.4, wp: new V3() };
      });
      // v1.10: perks and part combos (js/loadout.js), e.g. Thick Plating = more HP on every part
      this.mods = CW.mechMods(this.combatant, this.parts);
      if (this.mods.hpK !== 1) for (const p of this.parts) p.hp = p.maxHp = Math.round(p.maxHp * this.mods.hpK);
      if (this.combatant && CW.hasPerk(this.combatant, 'headstart') && game.state === 'match') this.combatant.superCharge = Math.max(this.combatant.superCharge || 0, 0.35);
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
      const reach = (p) => p.y - Math.max(0.5, CW.PARTS[p.t].radius || 0);
      const low = Math.min(...this.parts.map(reach));
      this.suspended = this.parts.filter((p) => (p.t === 'wheel' || p.t === 'bigwheel' || p.t === 'leg') && reach(p) < low + 0.05);
      // front wheels steer like a car's (those ahead of the middle of all wheels)
      const wz = this.parts.filter((p) => p.t === 'wheel' || p.t === 'bigwheel').map((p) => p.z);
      const midZ = wz.length ? (Math.min(...wz) + Math.max(...wz)) / 2 : 0;
      for (const p of this.parts) p.steers = (p.t === 'wheel' || p.t === 'bigwheel') && wz.length > 1 && p.z < midZ - 0.1;
      this.steer = 0; // the steering wheel: -1 left .. 1 right
      this.camFollowYaw = 0; // how much the player's own steering turned the mech (the view turns with it)
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
      // online: a mech driven by another player's game is only a replica here (it follows their updates)
      this.remote = game.net.isRemote(this.combatant);
      const sm = new THREE.Mesh(
        sharedGeo('Sphere(1, 20, 14)', () => new THREE.SphereGeometry(1, 20, 14)),
        new THREE.MeshBasicMaterial({ color: 0x3fb8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
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
        boosters: s.boosters, spikes: s.spikes, bigWheels: s.bigWheels,
      });
      this.cameraOk = !!(this.camPart && this.camPart.alive);
      this.baseOff = -s.bottom;
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

    // movement simulated on this computer; returns what the animation needs (or nothing if the mech is gone)
    physics(dt, inp) {
      const world = this.game.world;
      const mods = this.game.mods || {};
      const g = CW.GRAV * (mods.grav || 1) * (CW.arena.grav || 1); // weekly events can change gravity and speed; the moon has less
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
      F *= pr * (this.turbo > 0 ? 1.4 : 1) * (this.empT > 0 ? 0.45 : 1) * (mods.speed || 1); // an EMP slows engines
      // v1.10: combos/perks, Nitro (ground), Afterburner (air) and Scrap Wars upgrades
      const mm = this.mods;
      F *= mm.speedK * (inWater ? mm.waterK : !grounded ? mm.airK : 1) * (this.nitroT > 0 && grounded ? 1.9 : 1) * (this.burnerT > 0 && !grounded ? 1.8 : 1) * (1 + 0.04 * ((this.combatant && this.combatant.scrapLv) || 0)) * (this.combatant && this.combatant.carrying ? 0.8 : 1);
      const acc = (F * inp.throttle) / this.stats.moveMass; // heavy mechs don't crawl (CW.moveMass)
      this.vel.x += fx * acc * dt;
      this.vel.z += fz * acc * dt;

      let fwd = this.vel.x * fx + this.vel.z * fz;
      const sideX = this.vel.x - fx * fwd, sideZ = this.vel.z - fz * fwd;
      const dashing = this.dashTime > 0;
      // S while rolling forward brakes hard first (then reverses), like a car
      if (inp.throttle < 0 && fwd > 1 && bottom <= ground + 0.5 && !inWater) { // (also over small bumps)
        const b = Math.min(fwd - 0.5, 32 * dt);
        this.vel.x -= fx * b; this.vel.z -= fz * b; fwd -= b;
      }
      // tires grip, but slide a little when you turn hard at speed
      const slide = 1 + Math.abs(this.steer || 0) * Math.max(0, Math.abs(fwd) - 18) * 0.04;
      const sideK = dashing ? 0.6 : grounded && !inWater ? 8 / slide : inWater ? 2.5 : 1.2;
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
      let turnRate = (canSteer ? 2.5 : 0.5) * (0.5 + 0.5 * pr);
      // the player's A/D steer like a car's wheel: it turns in smoothly (small taps = small corrections)
      // and snaps straight the moment you let go, so the mech (and your view) stops turning right there.
      // Bots and auto-steer set the wheel directly.
      const want = clamp(inp.turn || 0, -1, 1);
      if (!inp.manual || !want || want * this.steer < 0) this.steer = inp.manual ? 0 : want;
      if (inp.manual && want) this.steer += (want - this.steer) * Math.min(1, dt * 9);
      let dir = 1;
      if (grounded && !inWater && this.wheels > 0 && this.legs === 0) {
        // wheels: a car turns tighter as it gets going, a bit wider at top speed; it can still creep around when slow
        const sp = Math.abs(fwd);
        turnRate *= clamp(0.45 + sp / 9, 0.45, 1.15) / (1 + Math.max(0, sp - 28) / 45);
        if (inp.manual && fwd < -1) dir = -1; // backing up: the steering works like a real car's
      }
      const dyaw = -this.steer * turnRate * dir * dt;
      this.yaw += dyaw;
      if (inp.manual || this.steerManual) this.camFollowYaw += dyaw;
      this.steerManual = !!inp.manual;

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
      // arena walls: bounce back off the force field (at the top of the slopes around the arena, CW.FIELD)
      const lim = CW.FIELD - 1.5;
      let nx = this.pos.x + this.vel.x * dt;
      let nz = this.pos.z + this.vel.z * dt;
      if (Math.abs(nx) > lim || Math.abs(nz) > lim) {
        // raced up the side into it: the mech flips over backwards (and rolls back down)
        if ((this.climbVy || 0) > 5 && !(this.flipT > 0)) { this.flipT = 1; this.vel.y = Math.max(this.vel.y, 7); }
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
        const maxSlope = (this.legs > 0 ? 2.4 : this.bigWheels > 0 ? 1.25 : this.wheels > 0 ? 0.8 : 0.55) + jetPush;
        // v1.9.7: ground steeper than the wheels can drive is climbed on speed alone, like a skateboard up a ramp: it
        // slows you down, and once you're too slow you roll back. Only real cliffs (steeper than ~73°) stop you dead.
        // Going over the top fast throws you into the air.
        const slope = step > 1e-4 ? rise / step : rise > 0.01 ? 99 : 0;
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (rise > 0.01 && slope > maxSlope) {
          if (slope > CLIFF || hs < 5) {
            nx = this.pos.x; nz = this.pos.z;
            const back = slope > CLIFF ? 0.2 : 0.5;
            this.vel.x *= -back; this.vel.z *= -back;
            this.climbVy = 0;
          } else {
            const sinOf = (t) => t / Math.sqrt(1 + t * t);
            const slow = g * (sinOf(slope) - 0.85 * sinOf(maxSlope)) * 2.4 * dt;
            const k = Math.max(0, 1 - slow / hs);
            this.vel.x *= k; this.vel.z *= k;
            this.climbVy = rise / dt;
          }
        } else {
          if ((this.climbVy || 0) > 7 && rise < step * 0.3) this.vel.y = Math.max(this.vel.y, Math.min(16, this.climbVy * 0.6));
          this.climbVy = rise > 0.01 && step > 1e-4 ? rise / dt : 0;
        }
      }
      // a wall face (ground much higher than your feet) stops you, even in a hop or a bump:
      // without this, the ground check below would lift you straight onto the top of the wall
      if (nx !== this.pos.x || nz !== this.pos.z) {
        const wall = world.groundAt(nx, nz, bottom + 0.5);
        if (wall > bottom + Math.max(0.9, Math.hypot(nx - this.pos.x, nz - this.pos.z) * CLIFF) && wall > ground + 0.6) {
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
        if (this.wheels > 0) {
          tr += (this.steer || 0) * clamp(fwd / 26, -1, 1) * 0.07; // leans out of a turn
          tp += inp.throttle > 0 && fwd < 20 ? 0.025 : inp.throttle < 0 && fwd > 2 ? -0.045 : 0;
        }
      } else if (inWater) {
        tp = Math.sin(this.game.time * 1.7 + this.pos.x) * 0.04;
        tr = Math.sin(this.game.time * 1.3 + this.pos.z) * 0.05;
      } else {
        tp = clamp(this.vel.y * 0.03, -0.4, 0.4);
        tr = -inp.turn * 0.35;
      }
      if (this.flipT > 0) {
        this.flipT = Math.max(0, this.flipT - dt);
        tp = -2.6 * Math.sin(Math.PI * (1 - this.flipT)); // over on its back and down again
      }
      const k = 1 - Math.exp(-(this.flipT > 0 ? 10 : 6) * dt);
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
      return { fwd, grounded, inWater };
    }

    // a mech driven by another player: glide toward where their game says it is
    followNet(dt) {
      const n = this.net;
      if (n) {
        // predict from the last update (position + velocity × age); a new update's small jump fades out smoothly
        const age = Math.min(0.25, (performance.now() - n.t) / 1000);
        tmp.copy(n.pos).addScaledVector(n.vel, age);
        if (n.fresh) { n.err.copy(this.pos).sub(tmp); if (n.err.length() > 12) n.err.set(0, 0, 0); n.fresh = false; }
        n.err.multiplyScalar(Math.exp(-10 * dt));
        this.pos.copy(tmp).add(n.err);
        this.vel.copy(n.vel);
        const k = 1 - Math.exp(-16 * dt);
        this.yaw += wrapA(n.yaw - this.yaw) * k;
        this.pitch += (n.pitch - this.pitch) * k;
        this.roll += (n.roll - this.roll) * k;
      }
      const fwd = -this.vel.x * Math.sin(this.yaw) - this.vel.z * Math.cos(this.yaw);
      this.fwdSpeed = fwd;
      const bottom = this.pos.y - this.baseOff;
      const inWater = CW.WATER_Y - bottom > 0.15;
      const grounded = bottom <= this.game.world.groundAt(this.pos.x, this.pos.z, bottom + 0.5) + 0.3;
      this.medium = inWater ? 'water' : grounded ? 'land' : 'air';
      return { fwd, grounded, inWater };
    }

    update(dt) {
      if (!this.alive) return;
      const world = this.game.world;
      const inp = this.occupied ? this.input : IDLE;
      const mv = this.remote ? this.followNet(dt) : this.physics(dt, inp);
      if (!mv || !this.alive) return;
      const { fwd, grounded, inWater } = mv;
      const pr = this.pr;

      // --- power-up timers ---
      if (this.overcharge > 0) this.overcharge -= dt;
      if (this.turbo > 0) { this.turbo -= dt; this.dashCd = Math.min(this.dashCd, 0.5); }
      if (this.domeT > 0) this.domeT -= dt; // a Shield Dome super keeps its protection while you shoot
      // v1.10 timers: Overdrive super, Nitro / Afterburner gadgets
      if (this.overdriveT > 0) { this.overdriveT -= dt; if (Math.random() < dt * 10) this.game.fx.burst(this.pos, { n: 1, color: 'fire', speed: 2, up: 2, life: 0.4, size: 0.4 }); }
      if (this.nitroT > 0) { this.nitroT -= dt; if (Math.random() < dt * 20) this.game.fx.burst(this.pos, { n: 1, color: this.game.fx.colorKey(0x4cc9f0), speed: 3, life: 0.4, size: 0.35 }); }
      if (this.burnerT > 0) { this.burnerT -= dt; if (Math.random() < dt * 20) this.game.fx.burst(this.pos, { n: 1, color: 'fire', speed: 3, life: 0.35, size: 0.4 }); }
      // Self-Repair perk: slowly fixes the mech after 5 s without being hit
      if (this.mods.regen && !this.remote && this.game.time - (this.lastHitAt || 0) > 5) this.repair(Math.max(8, this.parts.length * 1.5) * dt, 6);
      // hit flash: only the part that was hit lights up for a blink, then gets its paint back
      if (this.anyFlash) {
        let still = false;
        for (const p of this.parts) {
          if (!p.flashT && !p.flashOn) continue;
          p.flashT = Math.max(0, (p.flashT || 0) - dt);
          const on = p.flashT > 0 && p.alive;
          if (on !== !!p.flashOn) this.flashPart(p, on);
          if (p.flashOn) still = true;
        }
        this.anyFlash = still;
      }
      if (this.empT > 0) { this.empT -= dt; if (Math.random() < dt * 14) this.game.fx.burst(this.pos.clone().setY(this.pos.y + 1), { n: 2, color: this.game.fx.colorKey(0x7df9ff), speed: 5, life: 0.25, size: 0.18 }); }

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
      this.shieldMesh.material.opacity = this.shieldFlash * 0.22;
      if (this.protect > 0) {
        this.protect -= dt;
        this.shieldMesh.material.opacity = Math.max(this.shieldMesh.material.opacity, 0.1 + Math.sin(this.game.time * 10) * 0.05);
      }

      // --- animate parts ---
      this.walkPhase += Math.abs(fwd) * dt * 1.4;
      const moveAmt = Math.min(1, Math.abs(fwd) / 3);
      const aim = inp.aim;
      for (const p of this.parts) {
        if (!p.alive) continue;
        const ud = p.obj.userData;
        switch (p.t) {
          case 'wheel':
          case 'bigwheel':
            ud.spin.rotation.x -= (fwd * dt) / ud.radius;
            if (p.steers) ud.steer.rotation.y += (-(this.steer || 0) * 0.42 - ud.steer.rotation.y) * Math.min(1, dt * 12);
            break;
          case 'exhaust':
            // puffs of smoke while you speed up
            if (this.occupied && inp.throttle > 0 && Math.random() < dt * (fwd < 12 ? 14 : 5)) {
              tmp2.copy(ud.exhaust[Math.random() < 0.5 ? 0 : 1]).applyMatrix4(p.obj.matrixWorld);
              this.game.fx.burst(tmp2, { n: 1, color: 'smoke', speed: 1.2, up: 1.5, life: 0.7, size: 0.16, grow: 2.5 });
            }
            break;
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
        // badly damaged parts smoke (so you can see a mech is about to fall apart)
        if (p.hp < p.maxHp * 0.35 && Math.random() < dt * 2.2) this.game.fx.burst(p.wp, { n: 1, color: 'smoke', speed: 0.8, up: 2.2, life: 0.9, size: 0.22, grow: 2 });
      }

      this.syncTransform();
      // suspension: each bottom wheel/leg reaches down to (or is pushed up by) the ground under it
      if (grounded && !inWater) {
        for (const p of this.suspended) {
          if (!p.alive) continue;
          tmp.set(p.x, p.y, p.z).applyMatrix4(this.group.matrixWorld);
          const gy = world.groundAt(tmp.x, tmp.z, tmp.y + 1);
          const want = clamp(gy - (tmp.y - (p.obj.userData.radius || 0.48)), -0.45, 0.35);
          p.susp = (p.susp || 0) + (want - (p.susp || 0)) * Math.min(1, dt * 14);
          p.obj.position.y = p.y + p.susp;
        }
      }
      if (this.bust) this.bust.visible = this.occupied;
      // repair drones slowly patch up damaged parts
      if (this.stats.heal > 0 && !this.remote) this.repair(this.stats.heal * dt);
      // saw blades grind any enemy part they touch
      if (this.stats.saws > 0 && this.occupied) this.grind(dt);
      if (inp.fire && aim) this.fireWeapons(aim);
    }

    flashPart(p, on) {
      p.flashOn = on;
      const hot = CW.matBasic(0xffd8b0);
      p.obj.traverse((o) => { if (o.isMesh && (!on || !o.material.transparent || o.userData.mat0)) { if (on) { if (!o.userData.mat0) o.userData.mat0 = o.material; o.material = hot; } else if (o.userData.mat0) { o.material = o.userData.mat0; o.userData.mat0 = null; } } });
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
            m.hit(p, CW.PARTS.saw.saw * this.dmgMult() * this.mods.ramK * dt, this.combatant, 'ram');
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
      this.dashCd = (this.legs > 0 ? s.dashCd * 0.75 : s.dashCd) * this.mods.dashK;
      this.dashMax = this.dashCd;
      this.dashTime = 0.35;
      this.game.onDash(this);
      return true;
    }

    // damage multiplier: bot difficulty × overcharge power-up
    // (v1.10: × perks/combos × Scrap Wars upgrades)
    dmgMult() { return (this.baseDmg || 1) * (this.overcharge > 0 ? 1.5 : 1) * this.mods.dmgK * (1 + 0.08 * ((this.combatant && this.combatant.scrapLv) || 0)); }

    fireWeapons(aim) {
      if (this.empT > 0) return; // jammed by an EMP
      if ((CW.MODES[this.game.modeId] || {}).noGuns) return; // Demolition Derby: rams, saws and spikes only
      if (this.protect > 0 && this.weapons.length && !(this.domeT > 0)) this.protect = 0; // shooting ends spawn protection (no free hits)
      const rateK = (0.4 + 0.6 * this.pr) * this.mods.rateK * (this.overdriveT > 0 ? 2 : 1);
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
        // v1.10 weapons
        if (w.kind === 'tesla') { this.game.fx.tesla(start, dir.clone(), w.range, w.dmg * mult, this.combatant); p.cd = 1 / (w.rate * rateK); continue; }
        if (w.kind === 'magnet') { this.game.fx.magnet(start, dir.clone(), w.range, w.dmg * mult, this.combatant, this); p.cd = 1 / (w.rate * rateK); continue; }
        if (w.kind === 'mortar') {
          // a high arc that lands on the aim point (up to 120 m away)
          const tgt = aim.clone().sub(start);
          const flat = Math.min(120, Math.hypot(tgt.x, tgt.z));
          const T = Math.max(1.35, Math.min(2.8, flat / 26)); // a high lob, over walls and hills
          const k = flat / Math.max(0.01, Math.hypot(tgt.x, tgt.z));
          const vel = new V3((tgt.x * k) / T, (tgt.y + 0.5 * w.grav * T * T) / T, (tgt.z * k) / T);
          this.game.fx.projectile({ pos: start, vel, dmg: w.dmg * mult, splash: w.splash * this.mods.splashK, grav: w.grav, who: this.combatant, kind: 'mortar' });
          if (!(this.game.camera && this.game.camera.position.distanceTo(start) < 3)) this.game.fx.burst(start, { n: 6, color: 'smoke', speed: 3, up: 2, life: 0.6, size: 0.4, grow: 1.5 });
          p.cd = 1 / (w.rate * rateK);
          this.game.audio.shot('rocket', this.combatant.isPlayer ? 1 : this.game.audio.near(start));
          continue;
        }
        if (w.kind === 'laser') {
          this.game.fx.laser(start, dir.clone(), w.range, w.dmg * mult, this.combatant);
          p.cd = 1 / (w.rate * rateK);
          if (this.combatant.isPlayer && Math.random() < 0.3) this.game.audio.shot('laser');
          continue;
        }
        const vel = dir.clone().multiplyScalar(w.speed).add(this.vel);
        if (w.kind === 'flame') vel.multiplyScalar(0.9 + Math.random() * 0.2).add(new V3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4));
        this.game.fx.projectile({ pos: start, vel, dmg: w.dmg * mult, splash: w.splash * this.mods.splashK, grav: w.grav, who: this.combatant, kind: w.kind, from: w.kind === 'hook' ? this : null });
        // a small muzzle flash (left out right in front of your own camera, where it would cover the screen)
        const nearLens = this.game.camera && this.game.camera.position.distanceTo(start) < 3;
        if (!nearLens) {
          if (w.kind === 'rail') this.game.fx.burst(start, { n: 5, color: this.game.fx.colorKey(0x48cae4), speed: 6, life: 0.2, size: 0.12 });
          else if (w.kind !== 'flame') this.game.fx.burst(start, { n: 2, color: 'flash', speed: 2, life: 0.06, size: 0.1 });
        }
        p.cd = 1 / (w.rate * rateK);
        this.game.audio.shot(w.kind, this.combatant.isPlayer ? 1 : this.game.audio.near(start));
      }
    }

    // kind: 'ram' for rams (Shock Absorbers); arena damage has no `who`
    hit(part, dmg, who, kind) {
      if (!this.alive || !part.alive) return;
      if (CW.sameTeam(who, this.combatant)) return;
      const net = this.game.net;
      // v1.10, decided by the game that decides the hit: the core is a weak spot (+40%), and Shock Absorbers soften
      // rams and the arena
      if (!net.applying && who && who !== this.combatant && part.t === 'core' && dmg > 0) { dmg *= 1.4; if (who.isPlayer) this.game.critT = this.game.time; }
      if (!net.applying && (kind === 'ram' || !who)) dmg *= this.mods.absorb;
      // you see every hit land: the mech flashes white for a moment
      if (dmg > 0 && !(this.protect > 0)) { part.flashT = 0.08; this.anyFlash = true; }
      if (!net.applying && this.game.mods && this.game.mods.dmg) dmg *= this.game.mods.dmg; // weekly event: Glass Cannons
      if (this.combatant && this.combatant.isPlayer && dmg >= 6 && !(this.protect > 0)) this.game.buzz(dmg >= 30 ? 35 : 15, 0.15);
      // the game that decides a hit also fills the shooter's super meter
      if (who && who !== this.combatant && !net.applying && this.game.supers) this.game.supers.charge(who, dmg);
      // online: the shooter's game decides what hits; the target's own game applies the damage
      if (net.active && !net.applying) {
        if (!net.owns(who || this.combatant)) return;
        if (this.remote) { net.hitMech(this, part, dmg, who); return; }
      }
      if (this.protect > 0) { this.shieldFlash = 0.7; return; } // spawn protection
      if (this.dmgTaken) dmg *= this.dmgTaken;
      if (this.overdriveT > 0) dmg *= 0.7; // Overdrive super
      if (this.combatant.scrapLv) dmg *= 1 - 0.04 * this.combatant.scrapLv; // Scrap Wars armor upgrades
      this.lastHitBy = who;
      this.lastHitAt = this.game.time;
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
      if (part.flashOn) this.flashPart(part, false);
      part.alive = false;
      this.game.fx.debris(part.obj, this.vel, this.pos, true);
      this.game.fx.chunks(part.wp, 3, this.color, 0.5);
      this.game.fx.burst(part.wp, { n: 8, color: 'spark', speed: 10, life: 0.35, size: 0.08, grav: 20 });
      this.game.fx.explosion(part.wp, 0.45);
      this.game.onPartBroken(this, who, part);
      if (part.t === 'camera' && this.combatant.isPlayer) this.game.bigMsg('CAMERA DESTROYED', 'Switched to chase view', 2);
      if (part.t === 'core') { this.destroy(who); return; }
      const alive = this.parts.filter((p) => p.alive);
      const keep = new Set(CW.connected(alive));
      for (const p of alive) {
        if (!keep.has(p)) { p.alive = false; this.game.fx.debris(p.obj, this.vel, this.pos); }
      }
      this.recompute();
    }

    repair(amount, many) {
      const dmg = this.parts.filter((p) => p.alive && p.hp < p.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      if (!dmg.length) return false;
      const k = Math.min(many || 3, dmg.length);
      const each = amount / k;
      for (let i = 0; i < k; i++) dmg[i].hp = Math.min(dmg[i].maxHp, dmg[i].hp + each);
      return true;
    }

    // Pilot repair (hold R next to your mech): fix damaged parts first, then rebuild blown-off parts one by one.
    // Returns what happened this frame: 'fix', 'rebuild', 'done' (fully repaired) or 'wait'.
    // Big mechs repair just as quickly as small ones: damage heals at ~1/4 of the whole mech's HP per second, and
    // blown-off parts come back so that even a 40-part rebuild takes about 4 seconds.
    repairWork(dt) {
      const total = this.parts.reduce((a, p) => a + p.maxHp, 0);
      dt *= this.mods.repairK; // Quick Fix perk
      const fixed = this.repair(Math.max(60, total * 0.25) * dt, 12); // damage heals while lost parts come back
      const missing = this.parts.filter((p) => !p.alive);
      if (!missing.length) return fixed ? 'fix' : 'done';
      this.rebuildT = (this.rebuildT || 0) + dt;
      const every = Math.min(0.5, 4 / Math.max(1, this.parts.length));
      if (this.rebuildT < every) return fixed ? 'fix' : 'wait';
      // only parts that touch something still attached can be bolted back on (several per frame when it's quick)
      let done = 0;
      while (this.rebuildT >= every && done < 8) {
        this.rebuildT -= every;
        const alive = this.parts.filter((p) => p.alive);
        const touches = (p) => alive.some((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z) === 1);
        const next = this.parts.find((p) => !p.alive && touches(p));
        if (!next) break;
        this.rebuildPart(next, done > 0);
        done++;
      }
      this.rebuildT = Math.min(this.rebuildT, every);
      return done ? 'rebuild' : fixed ? 'fix' : 'done';
    }

    rebuildPart(p, quiet) {
      const obj = CW.partMesh(p, this.color, this.fin);
      this.group.add(obj);
      p.obj = obj;
      p.alive = true;
      p.hp = p.maxHp * 0.6;
      p.susp = 0;
      if (p === this.camPart && this.bust) obj.add(this.bust);
      this.recompute();
      this.syncTransform();
      this.game.fx.burst(p.wp, { n: 10, color: 'spark', speed: 5, life: 0.4, size: 0.2 });
      if (!quiet) this.game.audio.click(1.4);
    }

    integrity() {
      let hp = 0, max = 0;
      for (const p of this.parts) { max += p.maxHp; if (p.alive) hp += p.hp; }
      return hp / max;
    }

    destroy(who) {
      if (!this.alive) return;
      this.alive = false;
      for (const p of this.parts) if (p.flashOn) this.flashPart(p, false);
      // it falls apart first (every part flies off, some burning), then the big explosion
      const at = this.pos.clone(), fx = this.game.fx;
      let i = 0;
      for (const p of this.parts) if (p.alive) { p.alive = false; fx.debris(p.obj, this.vel, at, i++ % 3 === 0, 1.6); }
      fx.explosion(at, 1.1);
      fx.chunks(at, 8, this.combatant.color);
      const style = who && who.isPlayer && this.combatant !== who && this.game.profile ? this.game.profile.wreckFx : '';
      fx.later(0.28, () => {
        if (style) fx.wreckFx(style, at, who.color || 0x5ce1ff);
        fx.explosion(at, 2.6);
        fx.chunks(at, 10, this.combatant.color);
        fx.shockwave(at);
        fx.burst(at, { n: 8, color: 'smoke', speed: 2, up: 5, life: 2.2, size: 0.9, grow: 2.5 });
      });
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
      this.remote = game.net.isRemote(combatant);
      game.scene.add(g);
    }

    get center() { return tmp.set(this.pos.x, this.pos.y + 0.9, this.pos.z); }

    update(dt, inp) {
      if (!this.alive) return;
      if (this.remote) return this.followNet(dt);
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
      this.vel.y -= CW.GRAV * ((this.game.mods && this.game.mods.grav) || 1) * (CW.arena.grav || 1) * dt;
      if (inWater) {
        this.vel.y += (CW.WATER_Y - 1.0 - this.pos.y) * 14 * dt;
        this.vel.y *= Math.exp(-3 * dt);
      }
      if (inp.jump && (this.grounded || inWater)) this.vel.y = inWater ? 6 : 8.5;
      const lim = CW.FIELD - 1;
      const nx = clamp(this.pos.x + this.vel.x * dt, -lim, lim), nz = clamp(this.pos.z + this.vel.z * dt, -lim, lim);
      // cliffs are walls on foot too: ground that rises much faster than you walk (or above your knees) stops you,
      // instead of lifting you up the mountain in a moment
      // (the ground is checked half a meter ahead, whatever your speed, so you can't creep up a wall in tiny steps)
      const step = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      const here = Math.max(this.pos.y, world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.8));
      let wall = world.groundAt(nx, nz, this.pos.y + 0.8) - here > 0.6;
      if (!wall && step > 1e-4) {
        const ax = this.pos.x + ((nx - this.pos.x) / step) * 0.5, az = this.pos.z + ((nz - this.pos.z) / step) * 0.5;
        wall = world.groundAt(ax, az, this.pos.y + 0.8) - here > 0.5; // steeper than 45°
      }
      if (wall) { this.vel.x = 0; this.vel.z = 0; }
      else { this.pos.x = nx; this.pos.z = nz; }
      this.pos.y += this.vel.y * dt;
      let g = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.8);
      this.onMech = null;
      // mechs are solid to stand on: the highest part top under your feet counts as ground
      for (const m of this.game.mechs) {
        if (!m.alive || Math.abs(m.pos.x - this.pos.x) > m.radius + 1 || Math.abs(m.pos.z - this.pos.z) > m.radius + 1) continue;
        for (const p of m.parts) {
          if (!p.alive || Math.abs(p.wp.x - this.pos.x) > 0.7 || Math.abs(p.wp.z - this.pos.z) > 0.7) continue;
          const top = p.wp.y + 0.5;
          if (top > g && top < this.pos.y + 0.55) { g = top; this.onMech = m; } // a step up, not a climb up the whole mech (jump onto it)
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
      this.animate(dt);
      if (this.protect > 0) this.protect -= dt;
      if (inp.fire && inp.aim && this.cd <= 0) this.shoot(inp.aim);
    }

    // a pilot controlled by another player's game: glide toward their updates, shoot when they shoot
    followNet(dt) {
      const n = this.net;
      if (n) {
        const age = Math.min(0.25, (performance.now() - n.t) / 1000);
        tmp2.copy(n.pos).addScaledVector(n.vel, age);
        if (n.fresh) { n.err.copy(this.pos).sub(tmp2); if (n.err.length() > 8) n.err.set(0, 0, 0); n.fresh = false; }
        n.err.multiplyScalar(Math.exp(-10 * dt));
        this.pos.copy(tmp2).add(n.err);
        this.vel.copy(n.vel);
        this.yaw += wrapA(n.yaw - this.yaw) * (1 - Math.exp(-14 * dt));
      }
      this.animate(dt);
      if (n && n.fire && n.aim && this.cd <= 0) this.shoot(n.aim);
    }

    animate(dt) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.walk += sp * dt * 1.6;
      const sw = Math.sin(this.walk) * Math.min(1, sp / 3) * 0.6;
      this.legL.rotation.x = sw;
      this.legR.rotation.x = -sw;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      if (this.cd > 0) this.cd -= dt;
    }

    shoot(aim) {
      const o = new V3(this.pos.x, this.pos.y + 1.15, this.pos.z);
      const dir = aim.clone().sub(o).normalize();
      this.game.fx.projectile({ pos: o.addScaledVector(dir, 0.7), vel: dir.multiplyScalar(95), dmg: 5, splash: 0, grav: 0, who: this.combatant, kind: 'bolt' });
      this.cd = 0.22;
      if (this.combatant.isPlayer) this.game.audio.shot('bolt');
    }

    hit(dmg, who) {
      if (!this.alive || CW.sameTeam(who, this.combatant)) return;
      const net = this.game.net;
      if (net.active && !net.applying) {
        if (!net.owns(who || this.combatant)) return;
        if (this.remote) { net.hitPilot(this, dmg, who); return; }
      }
      if (this.protect > 0 && who) return; // a moment of safety right after ejecting
      this.hp -= dmg;
      if (this.combatant.isPlayer) this.game.onPlayerDamaged(dmg, who);
      this.game.fx.burst(this.center, { n: 5, color: 'spark', speed: 5, life: 0.3, size: 0.25 });
      if (this.hp <= 0) this.die(who);
    }

    die(who) {
      if (!this.alive) return;
      this.alive = false;
      this.game.fx.explosion(this.center, 0.8);
      this.game.scene.remove(this.mesh);
      this.game.onPilotKilled(this, who);
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
      // particles are soft round glows (sprites with a fuzzy edge) instead of solid balls: fire, sparks and colored
      // bursts glow (added light), smoke and spray are soft puffs
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
      this.softTex = new THREE.CanvasTexture(cv);
      const glow = (color, opacity = 1) => new THREE.SpriteMaterial({ map: this.softTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      const puff = (color, opacity) => new THREE.SpriteMaterial({ map: this.softTex, color, transparent: true, opacity, depthWrite: false });
      this.glow = glow;
      this.pMats = {
        fire: glow(0xff8a2a), flash: glow(0xffb347, 0.9), spark: glow(0xffd36b),
        smoke: puff(0x5f5f63, 0.5), water: puff(0xe6f7ff, 0.75),
      };
      this.projGeo = {
        shell: new THREE.BoxGeometry(0.06, 0.06, 1.5), // a thin tracer, not a ball
        rocket: new THREE.CylinderGeometry(0.13, 0.13, 0.8, 8).rotateX(Math.PI / 2),
        bolt: new THREE.BoxGeometry(0.1, 0.1, 0.8),
        rail: new THREE.BoxGeometry(0.14, 0.14, 3.2),
        flame: new THREE.IcosahedronGeometry(0.3, 0),
        mortar: new THREE.SphereGeometry(0.32, 10, 8),
        hook: new THREE.ConeGeometry(0.16, 0.6, 8).rotateX(Math.PI / 2),
        torpedo: new THREE.CylinderGeometry(0.22, 0.22, 1.4, 10).rotateX(Math.PI / 2),
        grenade: new THREE.SphereGeometry(0.28, 10, 8),
      };
      this.projMat = {
        shell: new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9 }),
        rocket: new THREE.MeshBasicMaterial({ color: 0xff3d3d }),
        bolt: new THREE.MeshBasicMaterial({ color: 0x5cf2ff }),
        rail: new THREE.MeshBasicMaterial({ color: 0xbff6ff }),
        flame: new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.85, depthWrite: false }),
        mortar: new THREE.MeshBasicMaterial({ color: 0x3d3d3d }),
        hook: new THREE.MeshBasicMaterial({ color: 0xdee2e6 }),
        torpedo: new THREE.MeshBasicMaterial({ color: 0xffb703 }),
        grenade: new THREE.MeshBasicMaterial({ color: 0x7df9ff }),
      };
    }

    clear() {
      for (const p of this.projectiles) this.game.scene.remove(p.mesh);
      for (const p of this.particles) this.game.scene.remove(p.mesh);
      for (const d of this.debrisList) this.game.scene.remove(d.obj);
      if (this.beams) for (const b of this.beams) this.game.scene.remove(b.mesh);
      if (this.rings) for (const r of this.rings) this.game.scene.remove(r.mesh);
      if (this.anims) for (const a of this.anims) this.game.scene.remove(a.mesh);
      this.projectiles = []; this.particles = []; this.debrisList = []; this.rings = []; this.timers = []; this.anims = []; if (this.beams) this.beams = [];
    }

    projectile(o) {
      const mesh = new THREE.Mesh(this.projGeo[o.kind], this.projMat[o.kind]);
      mesh.position.copy(o.pos);
      this.game.scene.add(mesh);
      const life = o.kind === 'rocket' ? 4 : o.kind === 'flame' ? 0.38 : o.kind === 'rail' ? 1.2 : o.kind === 'mortar' ? 5 : o.kind === 'torpedo' ? 3 : 2.5;
      this.projectiles.push({ ...o, prev: o.pos.clone(), life, maxLife: life, mesh, trail: 0 });
    }

    colorKey(hexColor) {
      const k = 'c' + hexColor;
      if (!this.pMats[k]) this.pMats[k] = this.glow(hexColor);
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

    // v1.10 Tesla Coil: zaps the closest enemy part in front (within range), then the shock jumps to 2 more mechs
    tesla(start, dir, range, dmg, who) {
      const game = this.game;
      let best = null, bd = range;
      for (const m of game.mechs) {
        if (!m.alive || CW.sameTeam(m.combatant, who)) continue;
        const to = m.pos.clone().sub(start);
        const d = to.length();
        if (d > range + m.radius || to.normalize().dot(dir) < 0.88) continue;
        if (d < bd) { bd = d; best = m; }
      }
      const zap = (a, m, k) => {
        const part = m.parts.filter((q) => q.alive).sort((x, y) => x.wp.distanceTo(a) - y.wp.distanceTo(a))[0];
        if (!part) return null;
        const at = part.wp.clone();
        this.bolt(a, at, 0xc77dff);
        m.hit(part, dmg * k, who);
        if (who && who.isPlayer) game.onPlayerHit(at, dmg * k, true);
        return at;
      };
      if (!best) { this.bolt(start, start.clone().addScaledVector(dir, 6 + Math.random() * 4), 0xc77dff); return; }
      let from = zap(start, best, 1);
      const done = new Set([best]);
      for (let j = 0; j < 2 && from; j++) {
        const next = game.mechs.filter((m) => m.alive && !done.has(m) && !CW.sameTeam(m.combatant, who) && m.pos.distanceTo(from) < 11 + m.radius)
          .sort((a, b) => a.pos.distanceTo(from) - b.pos.distanceTo(from))[0];
        if (!next) break;
        done.add(next);
        from = zap(from, next, 0.7);
      }
      if (who && who.isPlayer && Math.random() < 0.5) game.audio.tone(1800, 0.06, 'sawtooth', 0.06, 0.4);
    }
    // a jagged electric line from a to b (gone in a moment)
    bolt(a, b, color) {
      const pts = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(b, i / n);
        if (i > 0 && i < n) p.add(new V3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
        pts.push(p);
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
      this.game.scene.add(line);
      this.later(0.09, () => { this.game.scene.remove(line); line.geometry.dispose(); line.material.dispose(); });
      this.burst(b, { n: 2, color: this.colorKey(color), speed: 4, life: 0.2, size: 0.2 });
    }
    // v1.10 Magnet: a pulling beam; the mech it touches gets dragged toward the shooter (a few pushes a second)
    magnet(start, dir, range, dmg, who, mech) {
      const game = this.game;
      const end = start.clone().addScaledVector(dir, range);
      const hit = this.segmentHit(start, end, who);
      if (hit && hit.mech) {
        end.copy(hit.point);
        hit.mech.hit(hit.part, dmg, who);
        const m = hit.mech;
        m.magPull = (m.magPull || 0) + 1;
        if (m.magPull >= 2) { // every other zap (~4 per second)
          m.magPull = 0;
          const v = mech.pos.clone().sub(m.pos).setY(0);
          if (v.length() > m.radius + mech.radius) game.kick(m, v.normalize().multiplyScalar(6).setY(0.8), who);
        }
      }
      if (!this.magGeo) {
        this.magGeo = new THREE.CylinderGeometry(0.12, 0.05, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
        this.magMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.45, depthWrite: false });
      }
      this.beams = this.beams || [];
      const beam = new THREE.Mesh(this.magGeo, this.magMat);
      beam.position.copy(start);
      beam.lookAt(end);
      beam.scale.set(1, 1, start.distanceTo(end));
      game.scene.add(beam);
      this.beams.push({ mesh: beam, life: 0.12 });
    }
    // the Harpoon's chain while the hook flies (and for a moment after it bites)
    chain(from, to) {
      if (!this.chainMat) this.chainMat = new THREE.LineBasicMaterial({ color: 0x9d9d9d });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from.pos.clone().setY(from.pos.y + 0.6), to.clone()]), this.chainMat);
      this.game.scene.add(line);
      this.later(0.02, () => { this.game.scene.remove(line); line.geometry.dispose(); });
    }

    burst(pos, o) {
      const n = o.n || 6;
      for (let i = 0; i < n; i++) {
        if (this.particles.length > 500) { const old = this.particles.shift(); this.game.scene.remove(old.mesh); }
        const mesh = new THREE.Sprite(this.pMats[o.color || 'fire']);
        mesh.position.copy(pos);
        const s = (o.size || 0.4) * (0.6 + Math.random() * 0.8) * 2.4; // a sprite's size is its width; the soft edge needs room
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
      this.burst(p, { n: 1, color: 'flash', speed: 0, life: 0.13, size: 0.8 * size, grow: 2.4 });
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

    // small metal chunks that fly off a wreck (painted like the mech)
    chunks(pos, n, color, scale = 1) {
      if (!this.chunkGeo) this.chunkGeo = new THREE.BoxGeometry(0.35, 0.25, 0.3);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(this.chunkGeo, CW.mat(i % 3 ? color : 0x3a3a3a, null, 'panel'));
        m.position.copy(pos).add(new V3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
        m.scale.setScalar((0.6 + Math.random() * 1.2) * scale);
        m.castShadow = true;
        this.game.scene.add(m);
        this.debrisList.push({ obj: m, vel: new V3((Math.random() - 0.5) * 22, 8 + Math.random() * 12, (Math.random() - 0.5) * 22).multiplyScalar(0.6 + scale * 0.4), ang: new V3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), life: 4, s0: m.scale.x });
      }
      while (this.debrisList.length > 160) { const d = this.debrisList.shift(); this.game.scene.remove(d.obj); }
    }
    // a flat ring that races outward along the ground
    shockwave(pos) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.1, 40), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, Math.max(this.game.world.groundAt(pos.x, pos.z), pos.y - 1) + 0.15, pos.z);
      this.game.scene.add(mesh);
      (this.rings = this.rings || []).push({ mesh, life: 0.55 });
    }

    // a part that came off: it flies away from the mech's middle and tumbles; burning ones trail smoke
    debris(obj, baseVel, from, burning, power = 1) {
      this.game.scene.attach(obj);
      const v = new V3((Math.random() - 0.5) * 12, 5 + Math.random() * 8, (Math.random() - 0.5) * 12);
      if (from) { const out = obj.getWorldPosition(new V3()).sub(from); out.y = Math.max(0, out.y); if (out.lengthSq() > 0.01) v.addScaledVector(out.normalize(), 7); }
      v.multiplyScalar(power).add(baseVel);
      const a = new V3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10).multiplyScalar(power);
      this.debrisList.push({ obj, vel: v, ang: a, life: 5, s0: obj.scale.x, smoke: burning ? 2.2 : 0, puff: 0 });
      if (this.debrisList.length > 140) { const d = this.debrisList.shift(); this.game.scene.remove(d.obj); }
    }

    // run something a moment later (the big explosion after a wreck falls apart)
    later(t, fn) { (this.timers = this.timers || []).push({ t, fn }); }
    // something that changes every frame for a while: fn(k) with k going 0 → 1, then the mesh is removed
    anim(mesh, dur, fn) { this.game.scene.add(mesh); (this.anims = this.anims || []).push({ mesh, t: 0, dur, fn }); }

    // the Shop's wreck effects (only the player who wrecked the mech sees theirs)
    wreckFx(kind, at, color) {
      const R = Math.random, V = (x, y, z) => new V3(at.x + x, at.y + y, at.z + z);
      const pal = [0xff4d6d, 0xffd23f, 0x5ce1ff, 0x8ac926, 0xb5179e, 0xff8c42];
      if (kind === 'confetti') {
        for (let i = 0; i < 6; i++) this.burst(V(0, 1, 0), { n: 14, color: this.colorKey(pal[i]), speed: 13, up: 9, life: 1.8, size: 0.13, grav: 9 });
        this.chunks(at, 10, pal[Math.floor(R() * pal.length)], 0.4);
      } else if (kind === 'pixel') {
        for (let i = 0; i < 26; i++) {
          const m = new THREE.Mesh(this.cubeGeo || (this.cubeGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4)), CW.matBasic(i % 3 ? color : 0x5ce1ff));
          m.position.copy(at); m.position.y += 1;
          const v = new V3(R() - 0.5, R() * 0.8 + 0.2, R() - 0.5).normalize().multiplyScalar(6 + R() * 8);
          this.anim(m, 1.1 + R() * 0.5, (k) => { m.position.addScaledVector(v, 0.016); v.y -= 0.25; m.rotation.x += 0.2; m.rotation.y += 0.15; m.scale.setScalar(1 - k); });
        }
        this.burst(at, { n: 20, color: this.colorKey(0x5ce1ff), speed: 10, life: 0.5, size: 0.15 });
      } else if (kind === 'fireworks') {
        for (let i = 0; i < 5; i++) this.later(0.12 + i * 0.16, () => {
          const p = V((R() - 0.5) * 8, 7 + R() * 6, (R() - 0.5) * 8);
          this.burst(p, { n: 34, color: this.colorKey(pal[i % pal.length]), speed: 11, life: 1.1, size: 0.16, grav: 5 });
          this.burst(p, { n: 1, color: 'flash', speed: 0, life: 0.15, size: 1.2 });
          this.game.audio.tone(900 + R() * 600, 0.12, 'triangle', 0.05, 0.4);
        });
      } else if (kind === 'lightning') {
        const mat = new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
        for (let b = 0; b < 2; b++) {
          let a = V((R() - 0.5) * 6, 32, (R() - 0.5) * 6);
          for (let i = 0; i < 9; i++) {
            const bt = i === 8 ? at.clone() : new V3(at.x + (R() - 0.5) * 5 * (1 - i / 9), a.y - 3.5 - R() * 1.5, at.z + (R() - 0.5) * 5 * (1 - i / 9));
            const seg = new THREE.Mesh(this.boltGeo || (this.boltGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5)), mat);
            seg.position.copy(a); seg.lookAt(bt); seg.scale.set(1, 1, a.distanceTo(bt));
            this.anim(seg, 0.35, (k) => { mat.opacity = k < 0.5 ? 1 : 2 - k * 2; });
            a = bt;
          }
        }
        this.burst(at, { n: 30, color: this.colorKey(0x8fd8ff), speed: 14, life: 0.5, size: 0.12, grav: 10 });
        this.burst(at, { n: 1, color: this.colorKey(0xbfefff), speed: 0, life: 0.2, size: 3 });
        this.shockwave(at);
        this.game.audio.noise(0.5, 0.5, 4000);
      } else if (kind.startsWith('ev_')) {
        // seasonal event wrecks: a cloud of little pictures flying out (bats, snowflakes, hearts, petals, water drops)
        const ev = { ev_bats: ['🦇', 0x7b2cbf, 0xff7518], ev_snow: ['❄', 0xffffff, 0xbfe9ff], ev_hearts: ['💖', 0xff4d6d, 0xffb3c6], ev_petals: ['🌸', 0xffb7d5, 0xffffff], ev_splash: ['💧', 0x00b4d8, 0x90e0ef] }[kind];
        if (!ev) return;
        this.emojiMats = this.emojiMats || {};
        if (!this.emojiMats[kind]) {
          const cv = document.createElement('canvas');
          cv.width = cv.height = 64;
          const ctx = cv.getContext('2d');
          ctx.font = '52px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(ev[0], 32, 36);
          this.emojiMats[kind] = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
        }
        const fly = kind === 'ev_bats', fall = kind === 'ev_snow' || kind === 'ev_petals', drop = kind === 'ev_splash';
        for (let i = 0; i < 22; i++) {
          const sp = new THREE.Sprite(this.emojiMats[kind]);
          sp.position.copy(at); sp.position.y += 1.2;
          const v = new V3(R() - 0.5, fly ? 0.5 + R() : drop ? 1.4 + R() : 0.3 + R() * 0.9, R() - 0.5).normalize().multiplyScalar(fly ? 9 + R() * 6 : 5 + R() * 6);
          const sz = (fly ? 1.1 : 0.7) + R() * 0.5, ph = R() * 6;
          this.anim(sp, 1.6 + R() * 0.8, (k) => {
            sp.position.addScaledVector(v, 0.016);
            if (fall) { v.multiplyScalar(0.96); v.y -= 0.05; sp.position.x += Math.sin(k * 9 + ph) * 0.04; }
            else if (drop) v.y -= 0.35;
            else if (fly) v.y += 0.04;
            else v.multiplyScalar(0.97), (v.y += 0.06);
            const flap = fly ? 0.65 + Math.abs(Math.sin(k * 40 + ph)) * 0.35 : 1;
            sp.scale.set(sz * flap * (k > 0.75 ? (1 - k) * 4 : 1), sz * (k > 0.75 ? (1 - k) * 4 : 1), 1);
          });
        }
        this.burst(V(0, 1, 0), { n: 26, color: this.colorKey(ev[1]), speed: 11, up: 6, life: 0.9, size: 0.15, grav: drop ? 14 : 4 });
        this.burst(V(0, 1, 0), { n: 18, color: this.colorKey(ev[2]), speed: 8, life: 0.7, size: 0.12 });
        if (drop) this.shockwave(at);
        this.chunks(at, 6, ev[1], 0.35);
      } else if (kind === 'blackhole') {
        const hole = new THREE.Mesh(this.holeGeo || (this.holeGeo = new THREE.SphereGeometry(1, 20, 14)), new THREE.MeshBasicMaterial({ color: 0x07020f }));
        hole.position.copy(at); hole.position.y += 1.5;
        this.anim(hole, 1.2, (k) => hole.scale.setScalar(k < 0.7 ? 0.2 + k * 3.5 : (1 - k) * 9));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: 0xb06cff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.position.copy(hole.position); ring.rotation.x = Math.PI / 2;
        this.anim(ring, 1.2, (k) => { ring.rotation.z += 0.15; ring.scale.setScalar(1.6 - k * 1.3); ring.material.opacity = 1 - k; });
        for (let i = 0; i < 4; i++) this.later(i * 0.2, () => {
          for (let j = 0; j < 10; j++) {
            const a = R() * 6.3, r = 6 + R() * 3, p = new V3(hole.position.x + Math.cos(a) * r, hole.position.y + (R() - 0.5) * 3, hole.position.z + Math.sin(a) * r);
            this.burst(p, { n: 1, color: this.colorKey(0xb06cff), speed: 0, life: 0.6, size: 0.2 });
            const last = this.particles[this.particles.length - 1];
            if (last) last.vel.copy(hole.position).sub(p).multiplyScalar(1.6); // pulled in
          }
        });
        this.later(1.15, () => this.burst(hole.position, { n: 30, color: this.colorKey(0xb06cff), speed: 16, life: 0.6, size: 0.18 }));
      }
    }

    update(dt) {
      const game = this.game;
      const world = game.world;
      if (this.timers && this.timers.length) {
        for (const tm of this.timers.slice()) if ((tm.t -= dt) <= 0) { this.timers.splice(this.timers.indexOf(tm), 1); tm.fn(); }
      }
      if (this.anims && this.anims.length) {
        for (let i = this.anims.length - 1; i >= 0; i--) {
          const a = this.anims[i];
          a.t += dt;
          a.fn(Math.min(1, a.t / a.dur));
          if (a.t >= a.dur) { game.scene.remove(a.mesh); this.anims.splice(i, 1); }
        }
      }
      if (this.rings) for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        r.mesh.scale.setScalar(1 + (0.55 - r.life) * 26);
        r.mesh.material.opacity = Math.max(0, r.life / 0.55) * 0.9;
        if (r.life <= 0) { game.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
      }
      if (this.chainT) { this.chainT.t -= dt; if (this.chainT.t <= 0 || !this.chainT.b.alive) this.chainT = null; else this.chain(this.chainT.a, this.chainT.b.pos); }
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
        p.mesh.lookAt(tmp.copy(p.pos).add(p.vel));
        p.life -= dt;
        if (p.kind === 'flame') {
          // flames swell and slow down as they burn out
          p.mesh.scale.setScalar(1 + (1 - p.life / p.maxLife) * 2.6);
          p.vel.multiplyScalar(Math.exp(-2.5 * dt));
        }
        if (Math.abs(p.pos.x) > CW.FIELD || Math.abs(p.pos.z) > CW.FIELD || p.pos.y > CW.CEILING + 10) p.life = 0; // stopped by the force field
        if (p.kind === 'mortar' || p.kind === 'torpedo' || p.kind === 'grenade') {
          p.trail -= dt;
          if (p.trail <= 0) { p.trail = 0.04; this.burst(p.pos, { n: 1, color: p.kind === 'torpedo' ? 'water' : p.kind === 'grenade' ? this.colorKey(0x7df9ff) : 'smoke', speed: 0.4, life: 0.5, size: 0.3, grow: 1.4 }); }
          // a torpedo skims along the water (and the ground) instead of diving in
          if (p.kind === 'torpedo') { const gy = Math.max(CW.WATER_Y + 0.15, world.groundAt(p.pos.x, p.pos.z, p.pos.y + 2) + 0.4); if (p.pos.y < gy) { p.pos.y = gy; p.vel.y = 0; } }
        }
        if (p.kind === 'hook' && p.from) this.chain(p.from, p.pos);
        // Mech Ball: shots push the ball
        if (game.obj && game.obj.ballHit && game.obj.ballHit(p)) { game.scene.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
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
        if (!impact && p.kind !== 'torpedo' && p.pos.y < world.groundAt(p.pos.x, p.pos.z, p.pos.y)) impact = p.pos.clone();
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
        if (p.kind === 'grenade' && (impact || p.life <= 0)) {
          // EMP Grenade: jams and hurts enemies where it lands (the thrower's game decides)
          const at = impact || p.pos;
          this.burst(at, { n: 30, color: this.colorKey(0x7df9ff), speed: 14, life: 0.5, size: 0.3 });
          game.audio.boom(0.8, at);
          if (!game.net.active || game.net.owns(p.who)) {
            for (const m of game.mechs) {
              if (!m.alive || CW.sameTeam(m.combatant, p.who) || m.pos.distanceTo(at) > 7 + m.radius) continue;
              m.splash(m.pos, 3, 10, p.who);
              game.jam(m, 2, p.who);
            }
          }
          game.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
        if (impact || p.life <= 0) {
          // Harpoon: a hit yanks that mech toward the shooter
          if (p.kind === 'hook' && hit && hit.mech && p.from && p.from.alive) {
            const v = p.from.pos.clone().sub(hit.mech.pos);
            const d = v.length();
            v.setY(0).normalize().multiplyScalar(Math.min(34, 10 + d * 0.6));
            v.y = 5;
            game.kick(hit.mech, v, p.who);
            this.chainT = { a: p.from, b: hit.mech, t: 0.35 };
          }
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
              else this.explosion(impact, p.kind === 'mortar' ? 1.5 : 1);
            } else if (inWater) this.splashFx(impact, 0.4);
            else this.burst(impact, { n: hit ? 4 : 3, color: hit ? 'spark' : 'smoke', speed: hit ? 6 : 3, life: hit ? 0.25 : 0.4, size: hit ? 0.09 : 0.18, grav: hit ? 18 : 0 });
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
        if (d.smoke > 0) {
          d.smoke -= dt; d.puff -= dt;
          if (d.puff <= 0) { d.puff = 0.06; this.burst(o.position, { n: 1, color: d.smoke > 1.6 ? 'fire' : 'smoke', speed: 0.6, up: 1, life: 0.7, size: 0.22, grow: 2 }); }
        }
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
