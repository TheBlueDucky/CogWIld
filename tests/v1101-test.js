// Muted check of v1.10.1 (hidden window, local test server on 8781): random arenas that fit the mode, the arena roulette,
// the Mech Ball Stadium (goals, walls, ball physics, a goal counts), mouse steering (the mech turns to the view, the view
// stays in front of it), bots' own mechs and dodging, mass-based bumps, the new prices, the reward reveal, the Power Cell
// and the wallet keeping your supers / gadgets / perks.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 't1101' + Date.now(), backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  require('./no-voice-ask')(w);
  w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(`${msg} @${(src || '').split('/').pop()}:${line}`); });
  const js = (c) => w.webContents.executeJavaScript(c);
  await w.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`window.__crashes = []; (() => { const g = ${G}; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 500)); o(e); }; })(); true`);

  // ---- random arenas that fit the mode, and the roulette ----
  const ar = await js(`(async () => {
    const g = ${G}, seen = {}, fit = {};
    for (const mode of ['clash', 'heist', 'derby', 'ball']) {
      seen[mode] = [];
      fit[mode] = CW.FEATURED.arenasFor(mode, Object.keys(CW.ARENAS));
      for (let i = 0; i < 4; i++) { g.playOffline(mode); seen[mode].push(g.world.arena.id); }
    }
    g.playOffline('koth');
    await new Promise((r) => setTimeout(r, 400));
    const roll = !!document.querySelector('#arenaRoll'), cd0 = g.countdown, cdShown = getComputedStyle(document.getElementById('countdown')).display;
    await new Promise((r) => setTimeout(r, 1500));
    const spinning = !document.querySelector('#arenaRoll.done');
    await new Promise((r) => setTimeout(r, 900));
    const named = (document.querySelector('#arenaRoll .ar-name b') || {}).textContent || '';
    await new Promise((r) => setTimeout(r, 2300));
    return { seen, fit, roll, cd0, cdShown, spinning, named, gone: !document.querySelector('#arenaRoll'), arena: g.world.arena.name, panel: (g.meta.openPanel('arenas'), !!document.querySelector('.arena-grid')) };
  })()`);
  await js(`${G}.meta.closePanel(); true`);
  check(Object.entries(ar.seen).every(([m, l]) => l.every((a) => ar.fit[m].includes(a))), `every match picks an arena that fits its mode (${JSON.stringify(ar.seen)})`);
  check(ar.seen.ball.every((a) => a === 'stadium') && !ar.fit.clash.includes('stadium'), 'Mech Ball is always in the stadium (and the stadium is only for ball and derby)');
  check(new Set(ar.seen.clash).size > 1, `clash arenas are random (${ar.seen.clash.join(', ')})`);
  check(ar.roll && ar.cd0 > 5 && ar.cdShown === 'none' && ar.spinning, `the arena roulette spins before the countdown (countdown ${ar.cd0.toFixed(1)}, hidden meanwhile)`);
  check(ar.named.includes(ar.arena) && ar.gone, `it lands on the match's arena ("${ar.named}") and goes away`);
  check(!ar.panel, 'the PLAY panel has no arena picker any more');

  // ---- the stadium and the ball ----
  const ball = await js(`(async () => {
    const g = ${G}; g.playOffline('ball'); await new Promise((r) => setTimeout(r, 4800));
    while (g.countdown > 0) await new Promise((r) => setTimeout(r, 200));
    const o = g.obj, ST = CW.STADIUM;
    for (const c of g.combatants) c.ai.style = 'dummy';
    const out = { arena: g.world.arena.id, pitch: Math.round(g.world.groundAt(0, 0)), wall: Math.round(g.world.groundAt(0, ST.W + 4)), pocket: Math.round(g.world.groundAt(ST.L + 6, 0)) };
    // dropped: it lands on the pitch and settles
    o.pos.set(0, 30, 0); o.vel.set(0, 0, 0); o.freeze = 0;
    for (const c of g.combatants) c.mech.place(new THREE.Vector3(60, 0, 50 * (c.team ? 1 : -1)), 0);
    await new Promise((r) => setTimeout(r, 6000));
    out.rest = Math.round((o.pos.y - ST.y) * 10) / 10;
    // thrown at the side wall: it bounces back and stays in
    o.pos.set(0, ST.y + 3.2, ST.W - 15); o.vel.set(0, 0, 40);
    await new Promise((r) => setTimeout(r, 900));
    out.bounced = o.vel.z < 0 && Math.abs(o.pos.z) < ST.W;
    // shot at the goal: it counts
    const before = o.teamScore(0) + o.teamScore(1);
    o.pos.set(ST.L - 20, ST.y + 3.2, 0); o.vel.set(45, 2, 0);
    await new Promise((r) => setTimeout(r, 1800));
    out.goal = o.teamScore(0) + o.teamScore(1) - before;
    out.backInMiddle = Math.abs(o.pos.x) < 2 && Math.abs(o.pos.z) < 2;
    // a mech driving into it sends it away
    o.freeze = 0; o.pos.set(0, ST.y + BALL(), 0); o.vel.set(0, 0, 0);
    function BALL() { return 3.2; }
    const m = g.player.mech; m.place(new THREE.Vector3(-12, 0, 0), Math.PI / 2 * -1); m.vel.set(25, 0, 0);
    for (let i = 0; i < 20; i++) { m.vel.x = 25; await new Promise((r) => setTimeout(r, 30)); }
    out.pushed = Math.round(o.vel.x);
    out.posts = o.goalMeshes[0].grp.children.length;
    return out;
  })()`);
  check(ball.arena === 'stadium' && ball.pitch === 4 && ball.wall > 12 && ball.pocket === 4, `the stadium: flat pitch, walls round it, goal pockets (${JSON.stringify(ball)})`);
  check(ball.rest >= 3 && ball.rest < 3.6, `a dropped ball settles on the pitch (${ball.rest} above it)`);
  check(ball.bounced, 'the ball bounces off the wall and stays on the pitch');
  check(ball.goal === 1 && ball.backInMiddle, `a shot into the goal counts once and the ball goes back to the middle (${ball.goal})`);
  check(ball.pushed > 10, `a mech driving into the ball knocks it away (${ball.pushed} m/s)`);
  check(ball.posts >= 7, 'goals have posts, a crossbar and a net');

  // ---- mouse steering ----
  const steer = await js(`(async () => {
    const g = ${G}; g.playOffline('clash', 'canyon'); await new Promise((r) => setTimeout(r, 4800));
    while (g.countdown > 0) await new Promise((r) => setTimeout(r, 200));
    const m = g.player.mech, y0 = m.yaw;
    g.mouse.dx = 2000; // a big mouse move
    await new Promise((r) => setTimeout(r, 50));
    const wrap = (a) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const gap0 = Math.abs(wrap(g.cam.yaw - m.yaw));
    await new Promise((r) => setTimeout(r, 1500));
    return { gap0, turned: Math.abs(wrap(m.yaw - y0)), gap1: Math.abs(wrap(g.cam.yaw - m.yaw)), setting: g.settings.mouseSteer };
  })()`);
  check(steer.setting === true && steer.gap0 <= 0.91, `the view can't swing round the mech: at most ~50° off its nose (${steer.gap0.toFixed(2)} rad)`);
  check(steer.turned > 0.5 && steer.gap1 < 0.5, `the mech turns to where you look (${steer.turned.toFixed(2)} rad, now ${steer.gap1.toFixed(2)} off)`);

  // ---- bots: their own mechs, dodging, bumps ----
  const bots = await js(`(async () => {
    const g = ${G};
    const presets = new Set(CW.PRESETS.map((p) => p.name));
    const own = g.combatants.filter((c) => !c.isPlayer && !presets.has(c.bp.name.replace(/ Mk\\d$/, ''))).map((c) => c.bp.name + ' ' + c.bp.parts.length);
    // dodging: shots straight at a hard bot
    const bot = g.combatants.find((c) => !c.isPlayer && c.mech && c.mech.alive);
    bot.ai.smarts = 1;
    let dodged = 0;
    for (let i = 0; i < 16; i++) {
      bot.ai.dodgeT = 0;
      const from = bot.mech.pos.clone().add(new THREE.Vector3(30, 1, 0));
      g.fx.projectile({ pos: from, vel: bot.mech.pos.clone().sub(from).normalize().multiplyScalar(60), dmg: 0, splash: 0, grav: 0, who: g.player, kind: 'shell' });
      await new Promise((r) => setTimeout(r, 160));
      if (bot.ai.dodgeT > 0) dodged++;
    }
    // bumps: a heavy and a light mech pushed together
    const ms = g.mechs.filter((m) => m.alive).sort((a, b) => a.mass - b.mass), light = ms[0], heavy = ms[ms.length - 1];
    light.place(new THREE.Vector3(0, 0, 0), 0); heavy.place(new THREE.Vector3(1, 0, 0), 0);
    light.pos.set(0, light.pos.y, 0); heavy.pos.set(1, heavy.pos.y, 0);
    const l0 = light.pos.clone(), h0 = heavy.pos.clone();
    g.collide();
    return { own, n: g.combatants.length - 1, dodged, lightMoved: light.pos.distanceTo(l0), heavyMoved: heavy.pos.distanceTo(h0), lm: light.mass, hm: heavy.mass };
  })()`);
  check(bots.own.length >= 3, `most bots build their own mechs (${bots.own.length} of ${bots.n}: ${bots.own.slice(0, 4).join(', ')})`);
  check(bots.dodged >= 2 && bots.dodged < 16, `a hard bot dodges some shots, not all (${bots.dodged} of 16)`);
  check(bots.lightMoved > bots.heavyMoved, `a bump moves the lighter mech more (light ${bots.lightMoved.toFixed(2)} m / heavy ${bots.heavyMoved.toFixed(2)} m)`);

  // ---- prices and coins ----
  const eco = await js(`({ orbital: CW.ECON.item('supers', 'orbital').price, perk: CW.ECON.item('perks', 'overclock').price, chrome: CW.ECON.item('finishes', 'chrome').price, match: CW.ECON.EARN.match, day: CW.ECON.EARN_PER_DAY })`);
  check(eco.orbital === 2500 && eco.perk === 2800 && eco.chrome > 700 && eco.match === 400 && eco.day === 4000, `things cost more and coins come slower (${JSON.stringify(eco)})`);

  // ---- the wallet keeps the loadout kinds ----
  const wal = await js(`(() => { const g = ${G}; g.account.applyWallet({ coins: 10, xp: 99999999, owned: { paints: [], trails: ['spark'], avatars: [], finishes: [], wrecks: [], supers: ['orbital'], gadgets: ['grapple'], perks: ['plating'] }, gift: { day: '', streak: 0 }, road: [], pass: { s: 1, pts: 0, claimed: [] }, ch: [], ach: [] }); return { s: g.profile.owned.supers, ok: CW.ownsLo(g, 'supers', 'orbital') && CW.ownsLo(g, 'perks', 'plating') }; })()`);
  check(wal.ok, `bought supers / gadgets / perks stay yours when the wallet comes in (${JSON.stringify(wal.s)})`);

  // ---- the reward reveal and the Power Cell ----
  await js(`${G}.showMenu(); true`);
  const rev = await js(`(async () => {
    const g = ${G};
    g.meta.giftToast(150);
    await new Promise((r) => setTimeout(r, 1500));
    const el = document.getElementById('reveal');
    const out = { shown: el.classList.contains('show'), label: el.querySelector('.rv-label').textContent, title: el.querySelector('.rv-title').textContent, rays: !!el.querySelector('.rv-rays'), sparks: el.querySelectorAll('.rv-fx i').length };
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    out.closed = !el.classList.contains('show');
    // the Power Cell: charges to OVERLOAD in a few seconds, then shows the reward
    const t0 = performance.now();
    g.reveal.powerCell({ lv: 5, reward: { coins: 0, got: [{ kind: 'perks', id: 'regen' }] } });
    const stages = [];
    let done = 0;
    for (let i = 0; i < 40 && !done; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t = el.querySelector('.rv-label').textContent;
      if (!stages.includes(t)) stages.push(t);
      if (!g.reveal.cell && /Self-Repair/.test(t)) done = performance.now() - t0;
    }
    out.stages = stages; out.cellMs = Math.round(done);
    // tapping makes it faster
    g.reveal.close();
    const t1 = performance.now();
    g.reveal.powerCell({ lv: 3, reward: { coins: 120, got: [] } });
    let fast = 0;
    for (let i = 0; i < 40 && !fast; i++) { g.reveal.tap(); await new Promise((r) => setTimeout(r, 80)); if (!g.reveal.cell) fast = performance.now() - t1; }
    out.fastMs = Math.round(fast);
    g.reveal.close();
    return out;
  })()`);
  check(rev.shown && rev.title.includes('Daily gift') && rev.rays && rev.sparks > 10, `the daily gift gets a big reveal (rays, ${rev.sparks} sparks, "${rev.label}")`);
  check(rev.label === '+150 coins', 'the coins count up to the amount');
  check(rev.closed, 'a tap closes it');
  check(rev.stages.includes('20%') && rev.stages.includes('OVERLOAD!') && rev.stages.some((s) => /Self-Repair/.test(s)), `the Power Cell charges up in jumps to OVERLOAD, then gives the reward (${rev.stages.join(' → ')})`);
  check(rev.cellMs > 900 && rev.cellMs < 3000, `it takes 1-3 s (${rev.cellMs} ms for the biggest one)`);
  check(rev.fastMs > 0 && rev.fastMs < 1500, `tapping pumps it faster (${rev.fastMs} ms)`);
  // the results screen offers a Power Cell
  const res = await js(`(() => { const g = ${G}; g.setupMatchChest(1, 8); const b = document.getElementById('resChest'); return { cls: b.className, txt: b.textContent }; })()`);
  check(/cellbox/.test(res.cls) && /Power Cell/.test(res.txt), `after a match: a Power Cell instead of the old chest (${res.txt})`);

  check(!(await js('window.__crashes')).length, 'no crash');
  const real = errors.filter((e) => !/Autoplay|AudioContext|WebGL|GPU|Electron Security/i.test(e));
  check(!real.length, `no errors in the console${real.length ? ': ' + real.slice(0, 6).join(' | ') : ''}`);
  console.log(failed ? `${failed} v1.10.1 check(s) FAILED` : 'all v1.10.1 checks passed');
  app.exit(failed ? 1 : 0);
});
