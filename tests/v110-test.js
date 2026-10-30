// Muted check of v1.10 (hidden windows, local test server on 8781): the four new modes play without errors (Core
// Heist, Mech Ball, Demolition Derby with guns off, Scrap Wars upgrades), the loadout (perks change the mech, a picked
// super / gadget is used, every new super and gadget runs), chests open only after holding O and throw real loot,
// the new weapons (mortar, harpoon, tesla, magnet) hurt, pings, arena events and pads, part combos, the Shop's new
// sections, the PLAY panel's loadout, and online: two players in one Core Heist match, the server strips a super
// that isn't owned.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const mk = (p) => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: p + Date.now(), backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    require('./no-voice-ask')(w);
    w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(`${p}: ${msg} @${(src || '').split('/').pop()}:${line}`); });
    return w;
  };
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const start = async (w) => {
    await w.loadURL('http://localhost:8781/');
    await js(w, `localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
    await wait(4500);
    await js(w, `window.__crashes = []; (() => { const g = ${G}; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 500)); o(e); }; })(); true`);
  };
  const crashes = async (w) => js(w, 'window.__crashes');
  const A = mk('a110');
  await start(A);

  // ---- the four new modes, offline ----
  for (const [mode, secs] of [['heist', 14], ['ball', 14], ['derby', 10], ['scrap', 14]]) {
    await js(A, `${G}.playOffline('${mode}', 'canyon'); true`);
    await wait(secs * 1000);
    const st = await js(A, `(() => { const g = ${G}; return { state: g.state, mode: g.modeId, obj: g.obj ? g.obj.constructor.name : null, hud: (document.getElementById('topInfo') || {}).textContent || '', mechs: g.combatants.length,
      ball: g.obj && g.obj.pos ? g.obj.pos.toArray().map((v) => Math.round(v)) : null, scrap: g.obj && g.obj.nuggets ? g.obj.nuggets.length : null,
      cores: g.obj && g.obj.cores ? g.obj.cores.map((k) => k.home) : null }; })()`);
    check(st.state === 'match' && st.mode === mode && st.mechs > 1, `${mode}: a match runs (${JSON.stringify(st).slice(0, 240)})`);
    check(!(await crashes(A)).length, `${mode}: no crash`);
  }
  // derby: guns are off (firing makes no shells), every crash hurts
  const derby = await js(A, `(async () => {
    const g = ${G}; g.playOffline('derby', 'canyon'); await new Promise((r) => setTimeout(r, 4500));
    const m = g.player.mech, before = g.fx.projectiles.length;
    for (const p of m.parts) p.cd = 0;
    m.fireWeapons(m.pos.clone().add(new THREE.Vector3(0, 0, -30)));
    const shots = g.fx.projectiles.length - before;
    const fc = g.combatants.find((c) => c !== g.player && c.mech && c.mech.alive), foe = fc.mech;
    fc.superCharge = -99; foe.protect = 0; foe.shield = 0; foe.shieldMax = 0; foe.shieldDelay = 99; // (bots' own mechs may carry shields)
    const hp0 = foe.integrity();
    m.ramCd = 0; g.ram(m, foe, 25);
    return { shots, weapons: m.weapons.length, hurt: foe.integrity() < hp0 };
  })()`);
  check(derby.shots === 0 && derby.hurt, `Demolition Derby: no shots (${derby.shots}, ${derby.weapons} weapons), a crash without spikes hurts (${derby.hurt})`);

  // ---- loadout: perks and a bought super / gadget ----
  const lo = await js(A, `(async () => {
    const g = ${G}, p = g.profile;
    p.owned.supers = ['orbital', 'gravity', 'overdrive']; p.owned.gadgets = ['grapple', 'sonar']; p.owned.perks = ['plating', 'overclock', 'belt'];
    g.settings.loSuper = 'orbital'; g.settings.gadget = 'grapple'; g.settings.loPerks = ['plating', 'belt'];
    g.playOffline('clash', 'canyon'); await new Promise((r) => setTimeout(r, 4500));
    while (g.countdown > 0) await new Promise((r) => setTimeout(r, 200)); // (v1.10.1: the arena roulette comes first)
    const c = g.player, m = c.mech;
    const base = CW.PARTS.core.hp;
    const out = { lo: c.lo, hpK: m.mods.hpK, coreHp: m.core.maxHp, base, sup: g.supers.type(c), gad: g.gadgets.type(c), uses: g.gadgets.left(c) };
    c.superCharge = 1; out.used = g.supers.activate(c);
    out.gadget = g.gadgets.use(c);
    await new Promise((r) => setTimeout(r, 1500));
    return out;
  })()`);
  check(lo.lo.sp === 'orbital' && lo.lo.gd === 'grapple' && lo.lo.pk.join() === 'plating,belt', `your loadout comes into the match (${JSON.stringify(lo.lo)})`);
  check(Math.abs(lo.hpK - 1.12) < 0.05 && lo.coreHp === Math.round(lo.base * lo.hpK), `Thick Plating: +12% HP on every part (core ${lo.base} → ${lo.coreHp})`);
  check(lo.sup === 'orbital' && lo.used, `the picked super is the one you use (${lo.sup})`);
  check(lo.gad === 'grapple' && lo.gadget && lo.uses === 4, `the picked gadget, and Gadget Belt gives 4 uses (${lo.gad}, ${lo.uses})`);
  // a super you don't own isn't used
  const notOwned = await js(A, `(() => { const g = ${G}; g.settings.loSuper = 'lance'; return CW.myLoadout(g).sp || 'none'; })()`);
  check(notOwned === 'none', `a super you haven't bought stays out of the loadout (${notOwned})`);
  // every super and gadget runs (their effects, for real)
  const all = await js(A, `(async () => {
    const g = ${G}, c = g.player, m = c.mech;
    const bad = [];
    for (const s of CW.ECON.SHOP.supers) { try { g.supers.effect(c, s.id, true, m.pos.clone().add(new THREE.Vector3(0, 0, -20))); } catch (e) { bad.push(s.id + ': ' + e.message); } }
    await new Promise((r) => setTimeout(r, 2500));
    for (const d of CW.ECON.SHOP.gadgets) { try { g.gadgets.effect(c, d.id, true, 'x:1', null, m.pos.clone().add(new THREE.Vector3(0, 0, -20))); } catch (e) { bad.push(d.id + ': ' + e.message); } }
    await new Promise((r) => setTimeout(r, 5000));
    return { bad, n: CW.ECON.SHOP.supers.length + CW.ECON.SHOP.gadgets.length, fields: g.supers.fields.length };
  })()`);
  check(!all.bad.length, `all ${all.n} supers and gadgets run (${all.bad.join('; ') || 'no errors'})`);
  check(!(await crashes(A)).length, 'no crash after every super and gadget');

  // ---- chests: hold O ----
  const chest = await js(A, `(async () => {
    const g = ${G}, me = g.player.mech;
    g.chests.clear(); g.loot.clear();
    const at = me.pos.clone().add(new THREE.Vector3(2, 0, 0));
    const seq0 = g.loot.seq;
    const spawned = [], add0 = g.loot.add.bind(g.loot); g.loot.add = (e) => { spawned.push(e[1]); add0(e); }; // what the chest throws
    const ch = g.chests.spawn(at, 'epic');
    ch.pos.y = g.world.groundAt(at.x, at.z);
    await new Promise((r) => setTimeout(r, 1600));
    const notYet = !ch.opened, near = g.chests.near === ch, hint = !!document.querySelector('#chestHint:not(.hidden)');
    g.keys.KeyO = true;
    await new Promise((r) => setTimeout(r, 600));
    const half = !ch.opened && g.chests.hold > 0.2;
    await new Promise((r) => setTimeout(r, 900));
    g.keys.KeyO = false;
    const opened = ch.opened, loot = g.loot.seq - seq0, kinds = [...new Set(spawned)];
    const coins0 = g.bonusCoins;
    // drive the loot to the mech (it flies out first)
    await new Promise((r) => setTimeout(r, 1200));
    for (const it of g.loot.items) { it.vel = null; it.base = me.pos.y; it.pos.copy(me.pos); }
    await new Promise((r) => setTimeout(r, 400));
    return { notYet, near, hint, half, opened, loot, kinds, left: g.loot.items.length, coins: g.bonusCoins - coins0, scale: ch.box.scale.x };
  })()`);
  check(chest.near && chest.hint && chest.notYet, `next to a chest: "Hold O" shows and it stays shut without O (${JSON.stringify({ near: chest.near, hint: chest.hint, shut: chest.notYet })})`);
  check(chest.half && chest.opened, `holding O for about a second opens it (halfway: still shut ${chest.half}, then open ${chest.opened})`);
  check(chest.loot >= 10 && chest.kinds.includes('coin') && chest.kinds.includes('charge'), `an epic chest throws real loot (${chest.loot}: ${chest.kinds.join(', ')})`);
  check(chest.left === 0 && chest.coins > 0, `touching the loot picks it up (${chest.coins} coins)`);
  check(chest.scale > 1.3, `chests are bigger (×${chest.scale.toFixed(2)})`);

  // ---- the new weapons hurt a target ----
  const weap = await js(A, `(async () => {
    const g = ${G}, me = g.player;
    const foe = g.combatants.find((c) => c !== me && c.mech && c.mech.alive);
    const fm = foe.mech;
    fm.place(me.mech.pos.clone().add(new THREE.Vector3(0, 0, -18)), 0);
    fm.protect = 0; fm.vel.set(0, 0, 0);
    foe.ai.style = 'dummy'; fm.mods.regen = false; fm.stats.heal = 0; foe.gadgetN = 0; foe.superCharge = -99; // no Shield Dome / Repair Kit of its own mid-test Object.assign(fm.input, { throttle: 0, turn: 0, fire: false, up: false, down: false }); // a dummy keeps its last input otherwise
    for (const o of g.combatants) if (o !== me && o !== foe && o.mech && o.mech.alive) { o.mech.place(me.mech.pos.clone().add(new THREE.Vector3(90, 0, 60)), 0); o.ai.style = 'dummy'; } // nobody else in the way
    const out = {};
    for (const t of ['mortar', 'tesla', 'magnet', 'harpoon']) {
      fm.shield = 0; fm.shieldMax = 0; fm.shieldDelay = 99; // a shield would soak the first hit
      const hp0 = fm.parts.reduce((s, p) => s + (p.alive ? p.hp : 0), 0);
      const w = CW.PARTS[t].weapon;
      const start = me.mech.pos.clone().setY(me.mech.pos.y + 1.5), aim = fm.pos.clone(), dir = aim.clone().sub(start).normalize();
      if (t === 'tesla') g.fx.tesla(start, dir, w.range, w.dmg, me);
      else if (t === 'magnet') for (let i = 0; i < 6; i++) g.fx.magnet(start, dir, w.range, 5, me, me.mech);
      else { const fake = { pos: start, vel: me.mech.vel, mods: me.mech.mods, alive: true }; if (t === 'mortar') { const T = 1.5; g.fx.projectile({ pos: start, vel: new THREE.Vector3((aim.x - start.x) / T, (aim.y - start.y + 0.5 * w.grav * T * T) / T, (aim.z - start.z) / T), dmg: w.dmg, splash: w.splash, grav: w.grav, who: me, kind: 'mortar' }); } else g.fx.projectile({ pos: start, vel: dir.clone().multiplyScalar(w.speed), dmg: w.dmg, splash: 0, grav: w.grav, who: me, kind: 'hook', from: me.mech }); }
      await new Promise((r) => setTimeout(r, 2200));
      out[t] = Math.round(hp0 - fm.parts.reduce((s, p) => s + (p.alive ? p.hp : 0), 0));
      if (!fm.alive) break;
      fm.place(me.mech.pos.clone().add(new THREE.Vector3(0, 0, -18)), 0); fm.vel.set(0, 0, 0);
    }
    out.parts = ['mortar', 'harpoon', 'tesla', 'magnet'].every((t) => CW.ECON.PARTS[t] && CW.PARTS[t].cost === CW.ECON.PARTS[t][0]);
    return out;
  })()`);
  check(weap.tesla > 0 && weap.magnet > 0 && weap.mortar > 0 && weap.harpoon > 0, `Tesla, Magnet, Mortar and Harpoon hurt (${JSON.stringify(weap)})`);
  check(weap.parts, 'the new weapon parts are in the shared economy (the server checks them)');

  // ---- core weak spot, combos, pings, arena events, pads ----
  const misc = await js(A, `(async () => {
    const g = ${G}, me = g.player;
    const foe = g.combatants.find((c) => c !== me && c.mech && c.mech.alive), fm = foe.mech;
    fm.protect = 0; fm.shield = 0; fm.shieldMax = 0;
    const core = fm.core, hp0 = core.hp; fm.hit(core, 10, me); const coreDmg = hp0 - core.hp;
    const combos = CW.combosFor([{ t: 'core' }, ...Array.from({ length: 4 }, () => ({ t: 'saw' })), ...Array.from({ length: 4 }, () => ({ t: 'bigwheel' }))]).map((c) => c.id);
    g.pings.send('attack', me.mech.pos.clone().add(new THREE.Vector3(10, 0, 0)));
    await new Promise((r) => setTimeout(r, 300));
    const ping = { n: g.pings.list.length, tag: !!document.querySelector('.ping-tag') }; await new Promise((r) => setTimeout(r, 800)); // pings have a short spam limit
    g.keys.KeyZ = true; await new Promise((r) => setTimeout(r, 100)); g.keys.KeyZ = false; await new Promise((r) => setTimeout(r, 900));
    ping.tap = g.pings.list.length;
    g.keys.KeyZ = true; await new Promise((r) => setTimeout(r, 450)); ping.wheel = !!document.querySelector('#pingWheel:not(.hidden)'); g.pings.wheelMove(0, -60); g.keys.KeyZ = false; await new Promise((r) => setTimeout(r, 200));
    ping.picked = g.pings.list.some((p) => p.kind === 'attack' && p !== g.pings.list[0]);
    g.hazards.trigger('meteor');
    const strikes = g.hazards.strikes.length;
    await new Promise((r) => setTimeout(r, 12500));
    g.hazards.trigger('sandstorm');
    await new Promise((r) => setTimeout(r, 400));
    const fog = g.scene.fog.far;
    return { coreDmg, combos, ping, strikes, left: g.hazards.strikes.length, fog, pads: g.hazards.pads.length, kinds: [...new Set(g.hazards.pads.map((p) => p.kind))] };
  })()`);
  check(Math.abs(misc.coreDmg - 14) < 0.5, `the core is a weak spot: 10 damage → ${misc.coreDmg.toFixed(1)}`);
  check(misc.combos.includes('grinder') && misc.combos.includes('monster'), `part combos (${misc.combos.join(', ')})`);
  check(misc.ping.n >= 1 && misc.ping.tag && misc.ping.tap > misc.ping.n && misc.ping.wheel && misc.ping.picked, `pings: marker + label, a Z tap pings, holding Z opens the wheel (${JSON.stringify(misc.ping)})`);
  check(misc.strikes > 5 && misc.left === 0, `a meteor shower strikes and ends (${misc.strikes} strikes)`);
  check(misc.fog < 100, `a sandstorm thickens the fog (far ${misc.fog})`);
  check(misc.pads >= 4 && misc.kinds.length === 2, `boost and jump pads in the arena (${misc.pads}: ${misc.kinds.join(', ')})`);
  check(!(await crashes(A)).length, 'no crash after events and pings');

  // ---- the Shop and the PLAY panel ----
  await js(A, `${G}.showMenu(); ${G}.meta.openPanel('shop'); true`);
  await wait(600);
  const shop = await js(A, `({ grids: document.querySelectorAll('.lo-grid').length, cards: document.querySelectorAll('.lo-item').length, heads: [...document.querySelectorAll('#panel h3')].map((h) => h.firstChild.textContent.trim()).slice(0, 5), eq: document.querySelectorAll('.lo-item.is-eq').length })`);
  check(shop.grids === 3 && shop.cards === 35, `the Shop has Supers, Gadgets and Perks (${shop.cards} cards; ${shop.heads.join(' | ')})`);
  check(shop.eq >= 3, `your equipped ones are marked (${shop.eq})`);
  await js(A, `${G}.meta.closePanel(); ${G}.meta.openPanel('arenas'); true`).catch(() => {});
  await wait(600);
  const play = await js(A, `({ rows: document.querySelectorAll('.lo-row').length, chips: document.querySelectorAll('.lo-chip').length, modes: [...document.querySelectorAll('[data-mode]')].map((b) => b.dataset.mode) })`);
  check(play.rows === 3 && play.chips >= 8, `the PLAY panel has the loadout (${play.chips} chips)`);
  check(['heist', 'ball', 'derby', 'scrap'].every((m) => play.modes.includes(m)), `the new modes are in PLAY (${play.modes.join(', ')})`);
  await js(A, `${G}.meta.closePanel(); true`);

  // ---- online: two players in one Core Heist; an unowned super is stripped by the server ----
  const B = mk('b110');
  await start(B);
  const tag = Math.floor(Math.random() * 1e5);
  for (const [w, n] of [[A, 'Ha' + tag], [B, 'Hb' + tag]]) await js(w, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${n}', pass: 'heistpass1' }))`);
  await wait(2500);
  await js(A, `${G}.settings.loSuper = 'orbital'; ${G}.profile.owned.supers = ['orbital']; true`); // owned on this device only: the server knows better
  for (const w of [A, B]) { await js(w, `${G}.settings.mmMode = 'heist'; ${G}.settings.mmArena = 'canyon'; ${G}.settings.mmEvent = null; ${G}.play(); true`); await wait(400); }
  let st;
  for (let i = 0; i < 40; i++) {
    st = await Promise.all([A, B].map((w) => js(w, `({ state: ${G}.state, n: ${G}.combatants.length, mode: ${G}.modeId, host: ${G}.net.isHost })`)));
    if (st.every((s) => s.state === 'match')) break;
    await wait(1000);
  }
  check(st.every((s) => s.state === 'match' && s.mode === 'heist'), `both players are in an online Core Heist (${JSON.stringify(st)})`);
  await wait(9000);
  const on = await Promise.all([A, B].map((w) => js(w, `(() => { const g = ${G}; const a = g.combatants.find((c) => c.name.startsWith('Ha')); return { score: g.obj && g.obj.score, cores: g.obj && g.obj.cores.map((k) => k.home), bases: g.obj && g.obj.bases.map((b) => Math.round(b.x)), aSuper: a && (a.lo.sp || 'none'), state: g.state }; })()`)));
  check(on[0].bases.every((x, i) => Math.abs(x - on[1].bases[i]) <= 1), `both games have the same bases (${on[0].bases} / ${on[1].bases})`);
  check(on[1].aSuper === 'none', `the server strips a super the player doesn't own (others see: ${on[1].aSuper})`);
  // the host's arena event reaches the other player
  const hostW = st[0].host ? A : B, other = st[0].host ? B : A;
  await js(hostW, `${G}.hazards.trigger('storm'); true`);
  let ev;
  for (let i = 0; i < 10 && ev !== 'storm'; i++) { await wait(500); ev = await js(other, `(${G}.hazards.active || {}).id || ${G}.state`); }
  check(ev === 'storm', `an arena event from the host shows on the other game (${ev})`);
  check(!(await crashes(A)).length && !(await crashes(B)).length, 'no crash online');

  const real = errors.filter((e) => !/Autoplay|AudioContext|WebGL|GPU|Electron Security/i.test(e));
  check(!real.length, `no errors in the console${real.length ? ': ' + real.slice(0, 6).join(' | ') : ''}`);
  console.log(failed ? `${failed} v1.10 check(s) FAILED` : 'all v1.10 checks passed');
  app.exit(failed ? 1 : 0);
});
