// Muted check of v1.10.2 physics and chat (hidden window, local test server on 8781): sliding along walls instead of
// stopping dead, climbing a bit then sliding back down slopes, mechs not going into walls, the stadium's glass walls
// (mechs, flyers and the ball stay on the pitch), part hitboxes, tumbling and getting back up, landing on the wheels,
// jump + flip (Mech Ball: any time; elsewhere only high up), air steering, the bigger ball / goals / quicker dash,
// passing bots, every chat following the opacity slider, and typed text surviving a redraw.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 't1102' + Date.now(), backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  require('./no-voice-ask')(w);
  w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(`${msg} @${(src || '').split('/').pop()}:${line}`); });
  const js = (c) => w.webContents.executeJavaScript(c);
  await w.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`window.__crashes = []; (() => { const g = ${G}; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 500)); o(e); }; })(); true`);
  // a match with the bots out of the way, run fast by hand (g.tick) so physics is the same every time
  const setup = (mode, arena, preset) => js(`(async () => {
    const g = ${G}; g.showMenu(); g.settings.mouseSteer = false;
    g.setCurrentBp(CW.PRESETS.find((p) => p.id === '${preset || 'buggy'}'));
    g.playOffline('${mode}', '${arena}');
    for (let i = 0; i < 600 && g.countdown > 0; i++) g.tick(1 / 30);
    for (const c of g.combatants) if (!c.isPlayer && c.mech) { c.ai.style = 'dummy'; Object.assign(c.mech.input, { throttle: 0, turn: 0, fire: false }); c.mech.place({ x: 150, z: 150 }, 0); }
    return g.world.arena.id;
  })()`);
  const run = (secs) => `for (let i = 0; i < ${Math.round(secs * 60)}; i++) g.tick(1 / 60);`;

  // ---- walls: slide along, never a dead stop; never into the wall ----
  await setup('clash', 'desert', 'monster');
  const wall = await js(`(() => {
    const g = ${G}, w = g.world, m = g.player.mech, T = (x, z) => CW.terrainHeight(x, z);
    // a cliff: ground that rises more than 6 m within 2 m
    let spot = null;
    for (let x = -140; x < 140 && !spot; x += 2) for (let z = -140; z < 140 && !spot; z += 2) {
      const h = T(x, z); if (h < 2 || w.onBridge(x, z, 8)) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T(x + dx * 3, z + dz * 3) - h > 6 && Math.abs(T(x - dx * 6, z - dz * 6) - h) < 1 && Math.abs(T(x - dx * 12, z - dz * 12) - h) < 1.5) { spot = { x: x - dx * 8, z: z - dz * 8, dx, dz }; break; }
    }
    if (!spot) return { none: true };
    // drive at it at 35° off straight: it should scrape along it
    const yaw = Math.atan2(-spot.dx, -spot.dz) + 0.6;
    m.place(spot, yaw); m.vel.set(0, 0, 0);
    let deepest = 0;
    const start = m.pos.clone();
    g.keys.KeyW = true;
    for (let i = 0; i < 240; i++) {
      g.tick(1 / 60);
      for (const p of m.parts) if (p.alive) deepest = Math.min(deepest, p.wp.y - w.groundAt(p.wp.x, p.wp.z, p.wp.y + 1));
    }
    g.keys.KeyW = false;
    const along = Math.abs((m.pos.x - start.x) * spot.dz - (m.pos.z - start.z) * spot.dx); // moved sideways along the wall
    return { along, speed: Math.hypot(m.vel.x, m.vel.z), deepest };
  })()`);
  check(wall.none || wall.along > 8, `driving into a cliff at an angle slides along it (${wall.none ? 'no cliff found' : wall.along.toFixed(1) + ' m along'})`);
  check(wall.none || wall.deepest > -1.2, `no part of the mech goes into the wall (deepest ${wall.none ? '-' : wall.deepest.toFixed(2)} m)`);

  // ---- a slope too steep: up a bit, then back down ----
  await setup('clash', 'canyon', 'buggy');
  const slope = await js(`(() => {
    const g = ${G}, w = g.world, m = g.player.mech, T = (x, z) => CW.terrainHeight(x, z);
    // ground that rises ~1.2-2.5 m per meter (too steep for small wheels, not a wall)
    let spot = null;
    for (let x = -140; x < 140 && !spot; x += 2) for (let z = -140; z < 140 && !spot; z += 2) {
      const h = T(x, z); if (h < 2) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const seg = [2, 4, 6, 8].map((k) => (T(x + dx * k, z + dz * k) - T(x + dx * (k - 2), z + dz * (k - 2))) / 2);
        if (seg.every((v) => v > 1.0 && v < 2.0) && Math.abs(T(x - dx * 10, z - dz * 10) - h) < 1) { spot = { x: x - dx * 10, z: z - dz * 10, dx, dz, h }; break; }
      }
    }
    if (!spot) return { none: true };
    g.combatants.forEach((c) => c.isPlayer && 0);
    m.place(spot, Math.atan2(-spot.dx, -spot.dz)); m.vel.set(0, 0, 0);
    let top = -99, still = 0, maxStill = 0;
    const y0 = m.pos.y;
    for (let i = 0; i < 300; i++) {
      g.keys.KeyW = true; g.tick(1 / 60);
      top = Math.max(top, m.pos.y);
      if (Math.hypot(m.vel.x, m.vel.z) < 0.3) still++; else still = 0;
      maxStill = Math.max(maxStill, still);
    }
    g.keys.KeyW = false;
    for (let i = 0; i < 120; i++) g.tick(1 / 60);
    return { up: top - y0, end: m.pos.y - y0, maxStill: maxStill / 60 };
  })()`);
  check(slope.none || (slope.up > 0.5 && slope.end < slope.up), `a too-steep slope: up a bit (${slope.none ? '-' : slope.up.toFixed(1)} m), then back down (ends ${slope.none ? '-' : slope.end.toFixed(1)} m)`);
  check(slope.none || slope.maxStill < 1.5, `never stuck still pressing W on it (longest still ${slope.none ? '-' : slope.maxStill.toFixed(1)} s)`);

  // ---- hitboxes: parts, not a big ball ----
  const hb = await js(`(() => {
    const g = ${G};
    const long = { name: 'Long', parts: [{ t: 'core', x: 0, y: 0, z: 0 }].concat([-4, -3, -2, -1, 1, 2, 3, 4].map((z) => ({ t: 'frame', x: 0, y: 0, z }))).concat([[-1, -3], [1, -3], [-1, 3], [1, 3]].map(([x, z]) => ({ t: 'wheel', x, y: 0, z }))) };
    const a = g.player.mech, bc = g.combatants.find((c) => !c.isPlayer);
    const A = new CW.Mech(g, long, { combatant: g.player, color: 0xffffff }), B = new CW.Mech(g, long, { combatant: bc, color: 0xff0000 });
    const f0 = g.world.landSpawns[0];
    A.place({ x: f0.x, z: f0.z }, 0); B.place({ x: f0.x + 4.2, z: f0.z }, 0); A.pos.y = B.pos.y = 20; A.syncTransform(); B.syncTransform();
    const nearMiss = g.partContact(A, B), ballBefore = (A.radius + B.radius) * 0.7 > 4.2;
    B.place({ x: f0.x + 1.8, z: f0.z + 2 }, 0); B.pos.y = 20; B.syncTransform();
    const touch = g.partContact(A, B);
    A.dispose(); B.dispose();
    return { nearMiss: !!nearMiss, ballBefore, touch: !!touch, dir: touch && Math.round(touch.nx * 10) / 10 };
  })()`);
  check(!hb.nearMiss && hb.ballBefore, 'two long mechs side by side, not touching: no bump (the old round hitbox would have bumped)');
  check(hb.touch && hb.dir > 0.5, `when their parts overlap they push apart sideways (${hb.dir})`);

  // ---- tumbling, getting up, landing on the wheels, air steering, jump and flip ----
  const tum = await js(`(() => {
    const g = ${G}, m = g.player.mech, out = {};
    const flat = g.world.landSpawns[0];
    m.place(flat, 0); m.vel.set(0, 0, 0); ${run(0.5)}
    // a big spin in the air: lands on its side, lies there, gets back up by itself
    m.pos.y += 3; m.vel.set(0, 2, 0); g.tick(1 / 60); m.airR = 2.9; m.spinR = 0.5; m.spinP = 0; // tipped right over in the air
    let over = 0;
    for (let i = 0; i < 300; i++) { g.tick(1 / 60); if (m.overT > 0) over = Math.max(over, m.overT); }
    out.over = over; out.uprightAfter = Math.abs(m.roll) < 0.5 && Math.abs(m.pitch) < 0.5 && !(m.overT > 0);
    // a little tilt in the air: it rights itself and lands on its wheels
    m.place(flat, 0); m.pos.y += 8; m.vel.set(0, 0, 0); m.spinR = 2.5; ${run(3)}
    out.landedOk = !(m.overT > 0);
    // air steering: throttle in the air pushes you forward a bit
    m.place(flat, 0); m.pos.y += 14; m.vel.set(0, 0, 0);
    g.keys.KeyW = true; for (let i = 0; i < 30; i++) g.tick(1 / 60);
    out.airPush = Math.hypot(m.vel.x, m.vel.z); g.keys.KeyW = false;
    // jump (Space on wheels)
    m.place(flat, 0); m.vel.set(0, 0, 0); ${run(0.5)}
    g.pressed.Space = true; g.tick(1 / 60);
    out.jumpVy = m.vel.y;
    // Space again just above the ground in Workshop Clash: no flip (not high enough)
    ${run(0.12)}
    g.pressed.Space = true; g.tick(1 / 60);
    out.lowFlip = m.flipping > 0;
    // high up (off a cliff): a flip
    ${run(1.5)}
    m.place(flat, 0); m.pos.y += 9; m.vel.set(0, 0, 0); g.tick(1 / 60);
    g.keys.KeyW = true; g.pressed.Space = true; g.tick(1 / 60); g.keys.KeyW = false;
    out.highFlip = m.flipping > 0; out.flipPush = Math.hypot(m.vel.x, m.vel.z);
    ${run(2)}
    out.afterFlipOk = !(m.overT > 0);
    return out;
  })()`);
  check(tum.over > 1, `a big spin in the air lands it on its side, and it lies there (${tum.over.toFixed(1)} s)`);
  check(tum.uprightAfter, 'then it gets back onto its wheels by itself');
  check(tum.landedOk, 'a small tilt in the air: it turns upright and lands on its wheels');
  check(tum.airPush > 1.5, `steering in the air nudges you (${tum.airPush.toFixed(1)} m/s)`);
  check(tum.jumpVy >= 8.9, `Space on wheels jumps (${tum.jumpVy.toFixed(1)} m/s up)`);
  check(!tum.lowFlip, 'outside Mech Ball, no flip just above the ground');
  check(tum.highFlip && tum.flipPush > 10 && tum.afterFlipOk, `high up, Space flips you forward (${tum.flipPush.toFixed(1)} m/s) and you land on your wheels`);

  // ---- Mech Ball: glass walls, bigger ball and goals, a double jump + flip, quicker dash, passing ----
  await setup('ball', 'stadium');
  const ball = await js(`(() => {
    const g = ${G}, o = g.obj, ST = CW.STADIUM, m = g.player.mech, out = {};
    out.r = o.ball.geometry.parameters.radius; out.goalW = ST.goalW; out.goalH = ST.goalH;
    // a mech driving into the side glass
    m.place({ x: 0, z: ST.W - 15 }, Math.PI); m.vel.set(0, 0, 0);
    g.keys.KeyW = true; for (let i = 0; i < 240; i++) g.tick(1 / 60);
    g.keys.KeyW = false;
    out.mechZ = m.pos.z; out.mechIn = Math.abs(m.pos.z) < ST.W;
    // high in the air toward the glass (like a flyer): still stays in
    m.place({ x: 0, z: ST.W - 10 }, Math.PI); m.pos.y += 25; m.vel.set(0, 6, 30); ${run(1.5)}
    out.highIn = Math.abs(m.pos.z) < ST.W;
    // the ball thrown hard and high at the wall: never on top of it, never out
    o.freeze = 0; o.pos.set(0, ST.y + 6, ST.W - 20); o.vel.set(0, 20, 60);
    let worst = 0;
    for (let i = 0; i < 180; i++) { g.tick(1 / 60); worst = Math.max(worst, Math.abs(o.pos.z)); }
    out.ballMaxZ = worst; out.ballIn = worst <= ST.W - 4.2 + 0.01;
    // a double jump + flip right above the pitch (Mech Ball only)
    m.place({ x: 0, z: 0 }, 0); m.vel.set(0, 0, 0); ${run(0.4)}
    g.pressed.Space = true; g.tick(1 / 60); ${run(0.1)}
    g.pressed.Space = true; g.keys.KeyW = true; g.tick(1 / 60); g.keys.KeyW = false;
    out.flip = m.flipping > 0;
    ${run(1.5)}
    // a flip hit on the ball sends it harder than a plain bump
    const hitWith = (flipping) => { o.freeze = 0; o.pos.set(0, ST.y + 4.2, -8); o.vel.set(0, 0, 0); m.place({ x: 0, z: 0 }, 0); m.vel.set(0, 0, -16); m.flipping = flipping ? 0.4 : 0; m.syncTransform(); for (let i = 0; i < 25; i++) { m.vel.z = -16; m.flipping = flipping ? 0.4 : 0; g.tick(1 / 60); } return Math.hypot(o.vel.x, o.vel.z); };
    out.plain = hitWith(false); out.flipHit = hitWith(true);
    // the dash recharges quicker in Mech Ball
    m.dashCd = 0; m.dash(1); out.dashCd = m.dashCd; out.normalCd = m.stats.dashCd;
    return out;
  })()`);
  check(ball.r === 4.2 && ball.goalW === 16 && ball.goalH === 11, `bigger ball and goals (ball ${ball.r} m, goal ${ball.goalW * 2} m wide, ${ball.goalH} m high)`);
  check(ball.mechIn, `a mech can't drive out through the glass (z ${ball.mechZ.toFixed(1)})`);
  check(ball.highIn, 'high in the air it still stays in (the glass goes up high)');
  check(ball.ballIn, `the ball never gets onto or over the wall (furthest ${ball.ballMaxZ.toFixed(1)} m from the middle)`);
  check(ball.flip, 'Mech Ball: jump, then jump again right away = a flip');
  check(ball.flipHit > ball.plain * 1.2, `a flip hits the ball harder (${ball.flipHit.toFixed(0)} vs ${ball.plain.toFixed(0)} m/s)`);
  check(ball.dashCd < ball.normalCd * 0.7, `the dash recharges quicker in Mech Ball (${ball.dashCd.toFixed(1)} s vs ${ball.normalCd.toFixed(1)} s)`);
  // passing: a team-mate up front and an enemy in the way → the bot aims at the team-mate
  const pass = await js(`(() => { try {
    const g = ${G}, o = g.obj, ST = CW.STADIUM;
    const me = g.combatants.filter((c) => !c.isPlayer && c.team === g.player.team).sort((a, b) => a.netId - b.netId)[1], mate = g.player, foe = g.combatants.find((c) => c.team !== g.player.team);
    const their = o.goals[1 - me.team], sx = Math.sign(their.x);
    o.pos.set(-sx * 20, ST.y + 4.2, 0); o.vel.set(0, 0, 0);
    me.mech.place({ x: -sx * 34, z: 0 }, 0); mate.mech.place({ x: sx * 40, z: 30 }, 0); mate.mech.vel.set(0, 0, 0); foe.mech.place({ x: sx * 10, z: 0 }, 0);
    for (const c of g.combatants) if (c !== me && c !== mate && c !== foe && c.mech) c.mech.place({ x: -sx * 90, z: -50 }, 0);
    o.botGoal(me);
    const r = (v) => v && [Math.round(v.x), Math.round(v.z)];
    return { mate: !!o.aimFor && o.aimFor.distanceTo(mate.mech.pos) < 15, aim: r(o.aimFor), matePos: r(mate.mech.pos), ball: r(o.pos), their: r(their), me: r(me.mech.pos), foe: r(foe.mech.pos), team: me.team, foeTeam: foe.team };
    } catch (e) { return { err: String(e.stack || e).slice(0, 300) }; } })()`);
  if (pass.err) console.log('pass error', pass.err);
  check(pass.mate, `a bot with an enemy in the way passes to a free team-mate up front (${JSON.stringify(pass)})`);

  // ---- chat: follows the opacity slider; typing survives redraws ----
  await js(`${G}.showMenu(); ${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: 'Ty' + Math.floor(Math.random() * 1e5), pass: 'typepass1' })); true`);
  await wait(2500);
  const chat = await js(`(async () => {
    const g = ${G}, out = {};
    g.talk.open('friends');
    await new Promise((r) => setTimeout(r, 300));
    const bg = () => getComputedStyle(document.getElementById('chat')).backgroundColor;
    const set = (glass, v) => { g.settings.glass = glass; g.settings.hudBox = v; g.applySettings(); };
    set(false, 0); await new Promise((r) => setTimeout(r, 400)); out.zero = bg();
    set(false, 1); await new Promise((r) => setTimeout(r, 400)); out.full = bg();
    set(false, null); g.applySettings();
    // the menu shows through the docked chat, but a click there goes to the chat (not the Shop button under it)
    const sb = document.getElementById('btnShop').getBoundingClientRect();
    const hitEl = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2);
    out.under = { visible: getComputedStyle(document.getElementById('btnShop')).opacity !== '0', clickGoesToChat: !!(hitEl && hitEl.closest('#chat')), shop: !!(hitEl && hitEl.closest('#btnShop')) };
    g.talk.close();
    // the party card's box: type, then the card redraws
    g.account.party = { members: [{ name: 'Me' }, { name: 'Pal' }], leader: 'Me', log: [] };
    g.talk.freeOk = true;
    g.account.renderParty();
    const pc = document.getElementById('pcIn');
    out.hasBox = !!pc;
    if (pc) { pc.focus(); pc.value = 'hello wor'; pc.setSelectionRange(9, 9); g.account.renderParty(); const p2 = document.getElementById('pcIn'); out.kept = p2.value; out.focused = document.activeElement === p2; out.caret = p2.selectionStart; }
    g.account.party = null; g.account.renderParty();
    // a menu panel's box: friends, then the panel redraws
    g.meta.openPanel('friends');
    await new Promise((r) => setTimeout(r, 300));
    const fr = document.getElementById('frName');
    if (fr) { fr.focus(); fr.value = 'Spark'; g.meta.renderPanel(); const f2 = document.getElementById('frName'); out.frKept = f2 && f2.value; out.frFocus = document.activeElement === f2; }
    g.meta.closePanel();
    return out;
  })()`);
  check(/rgba\(14, 20, 42, 0\)/.test(chat.zero) && /rgb\(14, 20, 42\)|rgba\(14, 20, 42, 0\.9/.test(chat.full), `the chat follows Background opacity (0%: ${chat.zero}, 100%: ${chat.full})`);
  check(chat.under.visible && chat.under.clickGoesToChat && !chat.under.shop, `the menu shows through the open chat, but clicks there go to the chat (${JSON.stringify(chat.under)})`);
  check(chat.hasBox && chat.kept === 'hello wor' && chat.focused && chat.caret === 9, `typing in the party card survives it redrawing (text "${chat.kept}", cursor ${chat.caret}, focused ${chat.focused})`);
  check(chat.frKept === 'Spark' && chat.frFocus, `typing in a menu panel survives it redrawing ("${chat.frKept}")`);

  check(!(await js('window.__crashes')).length, 'no crash');
  const real = errors.filter((e) => !/Autoplay|AudioContext|WebGL|GPU|Electron Security/i.test(e));
  check(!real.length, `no errors in the console${real.length ? ': ' + real.slice(0, 6).join(' | ') : ''}`);
  console.log(failed ? `${failed} v1.10.2 check(s) FAILED` : 'all v1.10.2 checks passed');
  app.exit(failed ? 1 : 0);
});
