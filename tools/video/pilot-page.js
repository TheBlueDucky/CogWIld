// Runs inside the game page (tools/video): the "showcase pilot" that plays YOUR mech for the videos, through the same
// controls a person uses (keys, mouse view, mouse button), so the view, the HUD and the sounds are exactly a player's.
// It aims like a good player with a mouse (a quick flick with a little overshoot onto a new target, then smooth tracking
// with a tiny hand wobble, never snapping), drives strafing runs instead of parking, dodges shots with dashes and jumps,
// takes jump pads and Jump Jets for mid-air flips, and saves its super for a good moment. Mech Ball has its own brain:
// get behind the ball, line up with their goal, dash or flip into it, and go back to defend when the ball is near home.
(() => {
  if (window.__pilot) return;
  const g = window.game, V3 = THREE.Vector3;
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z)); // the game's yaw (forward = -sin, -cos)
  // a steady little random (so the same match doesn't wobble the same way twice)
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const P = {
    on: true, t: 0,
    // "mouse": the view turns with a spring (fast flicks, a little overshoot) toward where the pilot wants to look
    vy: 0, vp: 0, lookYaw: null, lookPitch: -0.12, tremor: 0, trT: 0, trY: 0, trP: 0,
    target: null, tSince: 0, side: 1, sideT: 0, keys: {}, pulse: 0, stuckT: 0, revT: 0, revDir: 1,
    dodgeCd: 0, hopCd: 0, flipT: -1, flipKind: 'front', gadCd: 0, superWait: 0, padGoal: null, padT: 0,
    avoid: { avoidSide: 1 }, lastHp: 1, burstT: 0, mode: g.modeId, stats: { flips: 0, dashes: 0, jumps: 0, supers: 0, gadgets: 0, dodges: 0 },
    ev: [],
  };
  const fresh = () => ({ t: 0, vy: 0, vp: 0, lookYaw: null, target: null, tSince: 0, side: 1, sideT: 0, stuckT: 0, revT: 0, dodgeCd: 0, hopCd: 0, flipT: -1,
    gadCd: 0, superWait: 0, padGoal: null, padT: 0, retarget: 0, flick: 0, flipArm: false, stucks: 0, stats: { flips: 0, dashes: 0, jumps: 0, supers: 0, gadgets: 0, dodges: 0 }, ev: [] });
  P.reset = () => Object.assign(P, fresh());
  const log = (k, o) => P.ev.push(Object.assign({ k, f: window.__vt ? __vt.V.frame : 0, t: +g.matchTime.toFixed(2) }, o || {}));

  // ---------------- the view ----------------
  // turn the view toward (yaw, pitch) like a hand on a mouse: a spring with a speed limit, plus a small wobble
  function moveView(dt, wantYaw, wantPitch, snappy) {
    const c = g.cam;
    const w = snappy ? 17 : 11, z = snappy ? 0.62 : 0.8; // stiffness / damping: a flick overshoots a little, tracking doesn't
    const ey = wrap(wantYaw - c.yaw), ep = wantPitch - c.pitch;
    P.vy += (w * w * ey - 2 * z * w * P.vy) * dt;
    P.vp += (w * w * ep - 2 * z * w * P.vp) * dt;
    const maxV = 9; // rad/s: a fast human flick
    P.vy = clamp(P.vy, -maxV, maxV); P.vp = clamp(P.vp, -maxV * 0.6, maxV * 0.6);
    // hand wobble: slow, small, smooth
    P.trT -= dt;
    if (P.trT <= 0) { P.trT = 0.25 + rnd() * 0.35; P.trY = (rnd() - 0.5) * 0.006; P.trP = (rnd() - 0.5) * 0.004; }
    c.yaw += P.vy * dt + P.trY * dt * 4;
    c.pitch = clamp(c.pitch + P.vp * dt + P.trP * dt * 4, -1.1, 0.8);
  }
  // where the camera sits (to aim through it): about where the game puts it
  function aimAngles(point) {
    const from = g.cam.pos;
    const d = point.clone().sub(from);
    const len = d.length() || 1;
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y / len, -1, 1)) };
  }

  // ---------------- what we shoot ----------------
  function mainWeapon(m) {
    let best = null;
    for (const p of m.weapons) if (p.alive) { const w = CW.PARTS[p.t].weapon; if (!best || (w.speed || 999) > (best.speed || 999)) best = w; }
    return best || { speed: 160, grav: 0 };
  }
  function pickTarget(me, m) {
    const en = g.enemiesOf(me);
    let best = null, bs = Infinity;
    for (const e of en) {
      const d = e.pos.distanceTo(m.pos);
      if (d > 170) continue;
      const ang = Math.abs(wrap(yawTo(m.pos, e.pos) - g.cam.yaw));
      const hp = e.mech ? e.mech.integrity() : 0.3;
      const seen = g.los(m.pos.clone().setY(m.pos.y + 1.5), e.pos.clone().setY(e.pos.y + 1));
      // close, in front of us, hurt (finish them), visible; and stick with the one we have
      const wet = g.world.groundAt(e.pos.x, e.pos.z) < CW.WATER_Y - 0.5; // out on the water: not worth chasing in a car
      let s = d + ang * 22 + hp * 25 + (seen ? 0 : 45) + (e.pilot ? -8 : 0) + (wet ? 80 : 0);
      if (P.target && P.target.c === e.c) s -= 25;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  // ---------------- dodging ----------------
  function incoming(me, m) {
    for (const p of g.fx.projectiles) {
      if (!p.who || p.who === me || CW.sameTeam(p.who, me) || p.kind === 'flame') continue;
      const sp2 = p.vel.lengthSq();
      if (sp2 < 4) continue;
      const t = ((m.pos.x - p.pos.x) * p.vel.x + (m.pos.y - p.pos.y) * p.vel.y + (m.pos.z - p.pos.z) * p.vel.z) / sp2;
      if (t < 0.08 || t > 0.75) continue;
      const mx = p.pos.x + p.vel.x * t - m.pos.x, my = p.pos.y + p.vel.y * t - m.pos.y, mz = p.pos.z + p.vel.z * t - m.pos.z;
      if (mx * mx + my * my + mz * mz < (m.radius + 1.5) ** 2) return { p, t, side: Math.sign(-Math.cos(m.yaw) * p.vel.x + Math.sin(m.yaw) * p.vel.z) || 1 };
    }
    return null;
  }

  // ---------------- one tick of Workshop Clash ----------------
  function fight(dt, me, m, k) {
    const ground = g.world.groundAt(m.pos.x, m.pos.z, m.pos.y);
    const air = m.pos.y - m.baseOff - ground; // height of the wheels over the ground
    const grounded = air < 0.6;
    const hp = m.integrity();
    // the target (looked at again a few times a second; a new one = a flick)
    if ((P.retarget = (P.retarget || 0) - dt) <= 0 || !P.target || !P.target.c.alive || (P.target.mech && !P.target.mech.alive)) {
      P.retarget = 0.4;
      const nt = pickTarget(me, m);
      if (nt && (!P.target || nt.c !== P.target.c)) { P.tSince = 0; P.flick = 0.35; }
      P.target = nt;
    }
    const tg = P.target;
    if (tg && tg.pilot) tg.pos = tg.pilot.center.clone();
    P.tSince += dt; P.flick = Math.max(0, (P.flick || 0) - dt);
    let goal = null, aimPoint = null, dist = 999;
    if (tg) {
      dist = tg.pos.distanceTo(m.pos);
      const w = mainWeapon(m);
      const tof = w.speed ? dist / w.speed : 0;
      // lead a moving target (we react ~0.1 s late, like anyone)
      aimPoint = tg.pos.clone().addScaledVector(tg.vel || new V3(), tof * 0.95 - 0.04);
      aimPoint.y += (tg.pilot ? 0 : 0.4) + (w.grav ? 0.5 * w.grav * tof * tof : 0);
    }
    // ----- where to drive -----
    const tooHurt = hp < 0.5;
    // grab a repair / shield when hurt, anything close and on the way
    let item = tooHurt ? g.pickups.nearest(m.pos, ['repair', 'shield'], 90) : g.pickups.nearest(m.pos, null, 26);
    if (item && Math.abs(item.pos.y - m.pos.y) > 6) item = null;
    // a jump pad on the way = a flip
    if (P.padT > 0) P.padT -= dt; else P.padGoal = null;
    if (!P.padGoal && grounded && (!tg || dist > 45) && g.hazards.pads) {
      for (const pad of g.hazards.pads) {
        if (pad.kind !== 'jump') continue;
        const d = flat(pad.pos, m.pos);
        const toward = tg ? Math.abs(wrap(yawTo(m.pos, pad.pos) - yawTo(m.pos, tg.pos))) < 0.8 : true;
        if (d > 12 && d < 70 && toward) { P.padGoal = pad.pos; P.padT = 6; break; }
      }
    }
    if (P.padGoal) goal = P.padGoal;
    else if (item) goal = item.pos;
    else if (tg) {
      const dest = (dist > 60 || !g.los(m.pos.clone().setY(m.pos.y + 1.5), tg.pos.clone().setY(tg.pos.y + 1))) && g.routeTarget(m, tg.pos) || tg.pos;
      goal = dest;
    }
    let H = goal ? yawTo(m.pos, goal) : m.yaw;
    if (tg && goal === tg.pos) {
      // strafing runs: come in at an angle, switch sides now and then, open up when too close
      P.sideT -= dt;
      if (P.sideT <= 0) { P.sideT = 2.2 + rnd() * 2.8; if (rnd() < 0.6) P.side = -P.side; }
      const pref = 26;
      const off = dist > pref + 25 ? 0.18 : dist > pref ? 0.45 : dist > 12 ? 0.72 : 1.25;
      H = yawTo(m.pos, tg.pos) + P.side * off;
    }
    if (tooHurt && tg && dist < 30 && !item) H = yawTo(tg.pos, m.pos); // get away, then come back
    // ----- the view: on the target when we have one, else where we drive -----
    let wantYaw, wantPitch;
    if (aimPoint && dist < 140) {
      const a = aimAngles(aimPoint);
      wantYaw = a.yaw; wantPitch = a.pitch;
    } else {
      wantYaw = H; wantPitch = -0.1 + Math.sin(P.t * 0.7) * 0.02;
    }
    // the view can't go further than 0.9 rad from the nose (mouse steering): keep the drive heading close to the view
    const viewToH = wrap(H - wantYaw);
    if (Math.abs(viewToH) > 0.8) H = wantYaw + Math.sign(viewToH) * 0.8;
    // steer around walls, cliffs and water, looking further ahead the faster we go; this wins over aiming
    // (a car that can't swim never drives into the lake after someone)
    if ((P.whisk = (P.whisk || 0) - dt) <= 0) {
      P.whisk = 0.1;
      const H0 = H + (g.botClearYaw(m, H, true, P.avoid) || 0);
      const inWater = m.medium === 'water' || ground < CW.WATER_Y + 0.1;
      const hsp = Math.hypot(m.vel.x, m.vel.z);
      const clear = (yaw) => {
        for (const d of [5, 10, 16, Math.max(16, hsp * 1.15)]) {
          const x = m.pos.x - Math.sin(yaw) * d, z = m.pos.z - Math.cos(yaw) * d;
          if (Math.abs(x) > CW.ARENA_HALF - 10 || Math.abs(z) > CW.ARENA_HALF - 10) return false;
          if (g.world.groundAt(x, z, m.pos.y) < CW.WATER_Y + 0.25) return false;
        }
        return true;
      };
      let out = H0;
      if (inWater) { const land = g.nearestLand && g.nearestLand(m.pos, tg ? tg.pos : m.pos); if (land) out = yawTo(m.pos, land); }
      else if (!clear(H0)) {
        out = null;
        const sd = P.avoidSide || 1;
        for (const o of [0.35, 0.7, 1.05, 1.4, 1.8, 2.3, 2.8]) { for (const sg of [sd, -sd]) if (clear(H0 + o * sg)) { out = H0 + o * sg; P.avoidSide = sg; break; } if (out !== null) break; }
        if (out === null) { out = m.yaw + Math.PI; P.brake = 0.4; }
      }
      P.avoidOff = wrap(out - H);
    }
    H += P.avoidOff || 0;
    P.avoiding = Math.abs(P.avoidOff || 0) > 0.3;
    if (P.avoiding) { const vw = wrap(wantYaw - H); if (Math.abs(vw) > 0.75) { wantYaw = H + Math.sign(vw) * 0.75; wantPitch = -0.1; } }
    moveView(dt, wantYaw, wantPitch, P.flick > 0);

    // ----- keys -----
    k.KeyW = true;
    const herr = wrap(H - m.yaw);
    // feather A/D to hold a heading that isn't where we look (no key = the mech turns to the view)
    const viewErr = wrap(g.cam.yaw - H);
    k.KeyA = k.KeyD = false;
    if (Math.abs(viewErr) > 0.12) { if (herr > 0.1) k.KeyA = true; else if (herr < -0.1) k.KeyD = true; }
    // a dead end (water or a cliff all round ahead): brake and turn
    k.KeyS = false;
    if (P.brake > 0) { P.brake -= dt; k.KeyW = false; k.KeyS = true; }
    // stuck: back out with the wheel turned, then go again
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (P.revT > 0) {
      P.revT -= dt; k.KeyW = false; k.KeyS = true; k.KeyA = P.revDir > 0; k.KeyD = P.revDir < 0;
    } else {
      P.stuckT = hs < 2 && P.t > 1 ? P.stuckT + dt : Math.max(0, P.stuckT - dt * 2);
      if (P.stuckT > 0.9) { P.stuckT = 0; P.revT = 0.8; P.revDir = rnd() < 0.5 ? 1 : -1; P.stucks = (P.stucks || 0) + 1; if (P.stucks > 3) { g.pressed.KeyF = true; P.stucks = 0; } }
    }
    // ----- fire: when the crosshair is on them -----
    let fire = false;
    if (tg && dist < 120) {
      const a = aimAngles(aimPoint);
      const err = Math.hypot(wrap(a.yaw - g.cam.yaw), a.pitch - g.cam.pitch);
      const size = Math.max(0.035, ((tg.r || 1.5) * 1.1) / Math.max(1, dist));
      const seen = g.los(m.pos.clone().setY(m.pos.y + 1.5), tg.pos.clone().setY(tg.pos.y + 1));
      fire = seen && err < size * 1.6 && P.tSince > 0.12;
    }
    g.mouse.left = fire;

    // ----- dodge: a dash or a hop when something is about to hit us -----
    P.dodgeCd -= dt; P.hopCd -= dt; P.gadCd -= dt;
    const inc = P.dodgeCd <= 0 ? incoming(me, m) : null;
    if (inc) {
      P.dodgeCd = 0.9;
      if (grounded && (inc.p.kind === 'rocket' || inc.p.kind === 'grenade') && P.hopCd <= 0 && rnd() < 0.6) { g.pressed.Space = true; k.Space = true; P.hopCd = 1.2; P.stats.jumps++; log('hop'); }
      else if (m.dashCd <= 0 && rnd() < 0.8) { g.pressed.ShiftLeft = true; if (inc.side > 0) k.KeyD = true; else k.KeyA = true; P.stats.dashes++; log('dodge'); }
      P.stats.dodges++;
    }
    // close the gap with a dash; finish a hurt enemy
    if (tg && m.dashCd <= 0 && grounded && Math.abs(wrap(yawTo(m.pos, tg.pos) - m.yaw)) < 0.35) {
      const th = tg.mech ? tg.mech.integrity() : 0.2;
      if ((dist > 45 && dist < 90 && rnd() < dt * 0.6) || (th < 0.3 && dist < 40 && rnd() < dt * 1.5)) { g.pressed.ShiftLeft = true; P.stats.dashes++; log('dash'); }
    }
    // hop now and then while strafing (style), and over bumps at speed
    if (grounded && P.hopCd <= 0 && tg && dist < 60 && hs > 12 && rnd() < dt * 0.35) { g.pressed.Space = true; P.hopCd = 2; P.stats.jumps++; }
    // Jump Jets toward a target: a big leap with a flip while shooting
    if (P.gadCd <= 0 && grounded && tg && dist > 22 && dist < 55 && g.gadgets.left(me) > 0 && !(me.gadgetCd > 0) && Math.abs(wrap(yawTo(m.pos, tg.pos) - m.yaw)) < 0.3 && rnd() < dt * 0.25) {
      g.pressed.KeyG = true; P.gadCd = 9; P.stats.gadgets++; log('jumpjets');
    }
    // ----- flips: high enough in the air (jump pad, Jump Jets, a ledge) = flip -----
    if (!grounded && air > 3.4 && !m.flipUsed && m.vel.y < 6 && P.flipT < 0) {
      P.flipT = 0; P.flipKind = rnd() < 0.55 ? 'front' : rnd() < 0.5 ? 'left' : 'right';
    }
    if (P.flipT >= 0) {
      P.flipT += dt;
      if (P.flipKind === 'left') k.KeyA = true; else if (P.flipKind === 'right') k.KeyD = true;
      if (P.flipT > 0.05) { g.pressed.Space = true; k.Space = true; P.stats.flips++; log('flip', { kind: P.flipKind }); P.flipT = -1; }
    }
    if (grounded) P.flipT = -1;
    // ----- super -----
    if (me.superCharge >= 1) P.superWait += dt;
    if (me.superCharge >= 1 && tg && g.supers.type(me) === 'orbital' && dist > 14 && dist < 85) {
      // aim where they'll be when the beam lands
      const lead = tg.pos.clone().addScaledVector(tg.vel || new V3(), 1.0);
      const a = aimAngles(lead);
      const near = g.enemiesOf(me).filter((e) => e.c !== tg.c && e.pos.distanceTo(tg.pos) < 12).length;
      const err = Math.hypot(wrap(a.yaw - g.cam.yaw), a.pitch - g.cam.pitch);
      if ((near > 0 || P.superWait > 4 || (tg.mech && tg.mech.integrity() > 0.5)) && err < 0.05) { g.pressed.KeyX = true; P.superWait = 0; P.stats.supers++; log('super', { near }); }
    } else if (me.superCharge >= 1 && tg && g.supers.type(me) !== 'orbital' && dist < 35) { g.pressed.KeyX = true; P.stats.supers++; log('super'); }
  }

  // ---------------- one tick of Mech Ball ----------------
  // A hit sends the ball along the line from the touching part to the ball's middle, so a shot needs a run-up from
  // right behind the ball, lined up with their goal: curve in wide when coming from the side, then drive (dash, flip)
  // straight through it. The same approach also defends: "behind the ball" is always the side of our own goal.
  function ball(dt, me, m, k) {
    const o = g.obj, bp = o.pos, bv = o.vel, ST = CW.STADIUM;
    const ground = g.world.groundAt(m.pos.x, m.pos.z, m.pos.y);
    const air = m.pos.y - m.baseOff - ground;
    const grounded = air < 0.6;
    const their = o.goals[1 - me.team];
    const hs = Math.hypot(m.vel.x, m.vel.z);
    // read the ball's flight (gravity, bounces, the glass): drive to the first spot where it's low enough to hit and
    // we can be there in time, like a player reading the bounce
    const d0 = flat(m.pos, bp);
    const G = CW.GRAV * 0.55 * ((g.mods && g.mods.grav) || 1) * (CW.arena.grav || 1);
    const reach = Math.max(hs, 24) + 4;
    let fut = null;
    {
      const p = bp.clone(), v = bv.clone(), h = 1 / 30, gy = ST.y;
      for (let t = h; t <= 3; t += h) {
        v.y -= G * h; p.addScaledVector(v, h);
        if (p.y < gy + 4.2) { p.y = gy + 4.2; v.y = v.y < -3 ? -v.y * 0.62 : 0; v.x *= Math.exp(-0.45 * h); v.z *= Math.exp(-0.45 * h); }
        if (Math.abs(p.x) > ST.L - 4.2 && Math.abs(p.z) > ST.goalW) { p.x = Math.sign(p.x) * (ST.L - 4.2); v.x *= -0.75; }
        if (Math.abs(p.z) > ST.W - 4.2) { p.z = Math.sign(p.z) * (ST.W - 4.2); v.z *= -0.75; }
        const low = p.y - gy < 4.2 + 3.2; // low enough to hit from the ground (or a hop)
        if (low && flat(m.pos, p) / reach <= t + 0.1) { fut = p.clone(); break; }
      }
      if (!fut) fut = p.clone();
    }
    fut.x = clamp(fut.x, -ST.L + 3, ST.L - 3); fut.z = clamp(fut.z, -(ST.W - 5), ST.W - 5);
    // where to send it: the side of their goal their keeper isn't covering; from a corner, across in front of the goal
    const gx = their.x, sgx = Math.sign(gx);
    const keeper = g.combatants.filter((c) => c.team !== me.team && c.alive && c.mech && c.mech.alive).map((c) => c.mech).sort((p, q) => Math.abs(p.pos.x - gx) - Math.abs(q.pos.x - gx))[0];
    let aimX = gx, aimZ = keeper && Math.abs(keeper.pos.x - gx) < 30 ? (keeper.pos.z > 0 ? -1 : 1) * ST.goalW * 0.6 : clamp(fut.z * 0.4, -ST.goalW * 0.6, ST.goalW * 0.6);
    if (Math.abs(fut.x - gx) < 34 && Math.abs(fut.z) > ST.goalW + 6) { aimX = gx - sgx * 26; aimZ = 0; } // a cross from the corner
    const shotDir = new V3(aimX - fut.x, 0, aimZ - fut.z).normalize();
    const toBall = new V3(fut.x - m.pos.x, 0, fut.z - m.pos.z);
    const dB = toBall.length() || 1;
    const dir = toBall.clone().divideScalar(dB);
    const align = dir.dot(shotDir); // 1 = right behind the ball on the line we want it to go
    const side = Math.sign(dir.x * shotDir.z - dir.z * shotDir.x) || 1;
    let tgt;
    if (align > -0.25) {
      // attack the ball: drive at the point on its back (seen from where it should go), so the hit sends it there
      tgt = fut.clone().addScaledVector(shotDir, -4.2 * (align > 0.6 ? 0.85 : 1.6));
      if (align > 0.6 && dB < 12) tgt.addScaledVector(shotDir, 3);
    } else {
      // right on the wrong side: curve round it close, then hit it back the right way
      tgt = fut.clone().addScaledVector(shotDir, -(4.2 + 5)).add(new V3(-shotDir.z, 0, shotDir.x).multiplyScalar(-side * (4.2 + 7)));
    }
    tgt.x = clamp(tgt.x, -ST.L + 4, ST.L - 4); tgt.z = clamp(tgt.z, -(ST.W - 4), ST.W - 4);
    const H = yawTo(m.pos, tgt);
    // the view: where we drive, the ball pulling it a little (a "ball cam" feel), slightly down
    const ballYaw = yawTo(m.pos, bp);
    const look = H + clamp(wrap(ballYaw - H), -0.6, 0.6) * 0.55;
    const ballUp = Math.atan2(bp.y - m.pos.y - 2, Math.max(8, d0));
    moveView(dt, look, clamp(-0.12 + ballUp * 0.6, -0.3, 0.45), false);
    const herr = wrap(H - m.yaw);
    k.KeyW = true; k.KeyS = false; k.KeyA = k.KeyD = false;
    if (Math.abs(wrap(g.cam.yaw - H)) > 0.1) { if (herr > 0.08) k.KeyA = true; else if (herr < -0.08) k.KeyD = true; }
    if (Math.abs(herr) > 2.3 && d0 < 12) k.KeyS = true; // the ball is right behind us: back up and turn
    // stuck on the glass or a mech
    // stuck (the glass, a mech, a bad landing): back out turning the nose the right way (backing up steers the other
    // way round), and hop out if that doesn't do it
    if (P.revT > 0) { P.revT -= dt; k.KeyW = false; k.KeyS = true; k.KeyA = herr < 0; k.KeyD = herr > 0; }
    else {
      P.stuckT = hs < 2.5 && P.t > 1 && !(o.freeze > 0) ? P.stuckT + dt : Math.max(0, P.stuckT - dt * 2);
      if (P.stuckT > 0.6) { P.stuckT = 0; P.revT = 0.8; P.stucks = (P.stucks || 0) + 1; if (P.stucks % 3 === 0) { g.pressed.Space = true; k.Space = true; } }
      if (hs > 8) P.stucks = 0;
    }
    // really stuck (wedged against the glass, on its back): the game's own unstuck hop (F), like a player would
    P.stuckLong = hs < 2 && !(o.freeze > 0) && P.t > 2 ? (P.stuckLong || 0) + dt : 0;
    if (P.stuckLong > 3) {
      // (the game's own spot finder can pick the same corner again: hop back onto the pitch, a little toward the middle)
      P.stuckLong = 0;
      m.place(new V3(m.pos.x * 0.8, ST.y, m.pos.z * 0.7), yawTo(m.pos, bp));
      m.vel.set(0, 0, 0); m.overT = 0; m.rightT = 0; m.protect = Math.max(m.protect || 0, 1);
      log('unstuck');
    }
    P.hopCd -= dt; P.gadCd -= dt;
    const facing = Math.abs(wrap(ballYaw - m.yaw));
    const lined = align > 0.84 && facing < 0.3;
    // a dash shot: lined up and close
    if (m.dashCd <= 0 && grounded && lined && dB > 6 && dB < 17) { g.pressed.ShiftLeft = true; P.stats.dashes++; log('dashshot'); }
    else if (m.dashCd <= 0 && grounded && facing < 0.25 && dB > 50 && align > 0.3 && rnd() < dt * 1.2) { g.pressed.ShiftLeft = true; P.stats.dashes++; log('dash'); }
    // a flip shot: lined up, jump just before it, then flip forward into it (a flip hits 1.7x harder)
    const above = bp.y - m.pos.y;
    if (grounded && P.hopCd <= 0 && lined && dB < 10.5 && dB > 5 && m.dashCd > 0 && above < 7) { g.pressed.Space = true; P.hopCd = 1.2; P.flipArm = 'shot'; P.stats.jumps++; log('jump'); }
    // a ball in the air close by: jump at it, flip into it
    else if (grounded && P.hopCd <= 0 && d0 < 11 && above > 3 && above < 11 && facing < 0.6 && align > 0.2) { g.pressed.Space = true; P.hopCd = 1.2; P.flipArm = 'air'; P.stats.jumps++; log('jump'); }
    if (!grounded && P.flipArm && P.flipArm !== 'style' && !m.flipUsed && flat(m.pos, bp) < (P.flipArm === 'shot' ? 7.5 : 8.5)) {
      const sd = wrap(ballYaw - m.yaw);
      if (Math.abs(sd) > 0.7) { if (sd > 0) k.KeyA = true; else k.KeyD = true; }
      g.pressed.Space = true; k.Space = true; P.flipArm = false; P.stats.flips++; log('flip', { ball: true });
    }
    // a style flip off a hop now and then, away from the ball (Mech Ball lets you flip any time in the air)
    if (grounded && P.hopCd <= 0 && d0 > 35 && hs > 18 && rnd() < dt * 0.25) { g.pressed.Space = true; P.hopCd = 2.5; P.flipArm = 'style'; P.styleT = 0.25; }
    if (P.flipArm === 'style' && !grounded) { P.styleT -= dt; if (P.styleT <= 0 && !m.flipUsed) { k.KeyA = rnd() < 0.5; k.KeyD = !k.KeyA && rnd() < 0.5; g.pressed.Space = true; k.Space = true; P.flipArm = false; P.stats.flips++; log('flip', { style: true }); } }
    if (grounded && P.hopCd < 0.6 && P.flipArm) P.flipArm = false;
    // the cannons push the ball too: only when that push points at their goal
    const bA = aimAngles(bp.clone());
    const onBall = Math.hypot(wrap(bA.yaw - g.cam.yaw), bA.pitch - g.cam.pitch) < 0.1;
    const shotLine = new V3(bp.x - m.pos.x, 0, bp.z - m.pos.z).normalize().dot(new V3(aimX - bp.x, 0, aimZ - bp.z).normalize());
    g.mouse.left = onBall && shotLine > 0.92 && d0 < 55;
    // Overdrive (turbo) and Nitro when lined up from far away
    if (me.superCharge >= 1 && align > 0.7 && dB > 25 && dB < 70) { g.pressed.KeyX = true; P.stats.supers++; log('super'); }
    if (P.gadCd <= 0 && grounded && align > 0.75 && facing < 0.3 && dB > 30 && dB < 70 && g.gadgets.left(me) > 0 && !(me.gadgetCd > 0)) { g.pressed.KeyG = true; P.gadCd = 10; P.stats.gadgets++; log('gadget'); }
    if (window.__pdbg && Math.round(P.t * 60) % 30 === 0) window.__pdbg.push([+P.t.toFixed(1), Math.round(m.pos.x), Math.round(m.pos.z), Math.round(bp.x), Math.round(bp.z), Math.round(tgt.x), Math.round(tgt.z), +align.toFixed(2), Math.round(dB), Math.round(hs), +herr.toFixed(2), k.KeyA ? 'A' : k.KeyD ? 'D' : '-', k.KeyS ? 'S' : '', m.alive ? '' : 'dead', g.cam.yaw.toFixed(2), m.yaw.toFixed(2), +(m.overT || 0).toFixed(1), +(m.rightT || 0).toFixed(1), +m.pitch.toFixed(2), +m.roll.toFixed(2), grounded ? 'G' : 'air', P.revT > 0 ? 'REV' : '', m.medium]);
    // after a shot: where did it go, who touched it next (testing)
    const lastShot = [...P.ev].reverse().find((e) => e.k === 'shot');
    if (lastShot && lastShot !== P.shotSeen && (window.__vt ? __vt.V.frame : 0) - lastShot.f >= 45) {
      P.shotSeen = lastShot;
      log('shotEnd', { x: Math.round(bp.x), y: Math.round(bp.y), z: Math.round(bp.z), by: o.lastTouch ? (o.lastTouch.isPlayer ? 'me' : o.lastTouch.name + (o.lastTouch.team === me.team ? '+' : '-')) : '', score: JSON.stringify(o.score) });
    }
    // every touch goes in the log: how fast the ball left and how close to their goal it was going
    const touching = o.lastTouch === me && d0 < m.radius + 6;
    if (touching && !P.touching) {
      const gd = new V3(their.x - bp.x, 0, -bp.z).normalize(), sp = Math.hypot(bv.x, bv.z) || 1;
      log('touch', { sp: +sp.toFixed(1), toGoal: +((bv.x * gd.x + bv.z * gd.z) / sp).toFixed(2), x: Math.round(bp.x) });
    }
    P.touching = touching;
  }

  // ---------------- on foot (mech wrecked) ----------------
  function onFoot(dt, me, k) {
    const p = me.pilot;
    const en = g.enemiesOf(me).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
    k.KeyW = !!en; k.KeyA = k.KeyD = k.KeyS = false;
    if (!en) return;
    const a = aimAngles(en.pos.clone().setY(en.pos.y + 0.6));
    moveView(dt, a.yaw, a.pitch, false);
    const d = en.pos.distanceTo(p.pos);
    if (d < 25) { k.KeyW = false; k[(P.t % 2) < 1 ? 'KeyA' : 'KeyD'] = true; }
    g.mouse.left = d < 60;
    if (rnd() < dt * 0.8) g.pressed.Space = true;
  }

  // ---------------- the hook: our inputs go in just before the game reads them ----------------
  const orig = g.updatePlayer.bind(g);
  g.updatePlayer = function (dt) {
    if (P.on && g.state === 'match' && g.player && !g.ended) {
      P.t += dt;
      const me = g.player, k = g.keys;
      for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft']) k[key] = false;
      g.mouse.dx = g.mouse.dy = 0;
      if (g.countdown > 0) {
        // the countdown: look around a little, like a player waiting
        moveView(dt, (P.lookYaw ?? (P.lookYaw = g.cam.yaw)) + Math.sin(P.t * 0.8) * 0.15, -0.12, false);
      } else if (me.mech && me.mech.alive && me.mech.occupied) {
        if (g.modeId === 'ball' && g.obj) ball(dt, me, me.mech, k); else fight(dt, me, me.mech, k);
      } else if (me.pilot && me.pilot.alive) onFoot(dt, me, k);
      else g.mouse.left = false;
    }
    return orig(dt);
  };

  // ---------------- what happened (for the edit) ----------------
  const hooks = () => {
    const od = g.onMechDestroyed.bind(g);
    g.onMechDestroyed = function (mech, who) {
      const victim = mech.combatant;
      if (who && who.isPlayer && victim && !victim.isPlayer) {
        log('wreck', { victim: victim.name });
        g.slowmo = Math.max(g.slowmo || 0, 1.3); // the game's own slow motion on your wrecks (smooth: it's drawn that way)
      }
      if (victim && victim.isPlayer) log('died', { by: who ? who.name : '' });
      else log('anywreck', { victim: victim && victim.name, by: who && who.name });
      return od(mech, who);
    };
    const ok = g.onPilotKilled.bind(g);
    g.onPilotKilled = function (pilot, who) { if (who && who.isPlayer) log('pilotkill'); return ok(pilot, who); };
    const oa = g.announce.bind(g);
    g.announce = function (title, sub) { log('announce', { title: String(title), sub: String(sub || '') }); return oa(title, sub); };
    const ob = g.bigMsg.bind(g);
    g.bigMsg = function (title, sub, dur) { log('big', { title: String(title), sub: String(sub || '') }); return ob(title, sub, dur); };
    const os = g.showResults.bind(g);
    g.showResults = function () { log('results', { place: g.player && g.player.place, win: !!g.won }); return os(); };
  };
  hooks();
  window.__pilot = P;
})();
