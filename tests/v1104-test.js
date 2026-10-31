// Muted check of the respawn fix and the calmer warning box (hidden window, local test server on 8781): in respawn modes a
// pilot killed on foot comes back like a wreck (Mech Ball, Bounty Hunt, King of the Hill, Boss Battle with its lives, and a
// pilot killed while already waiting); the Stuck / Damaged / Arena edge box sits still on the left in the theme's colors and
// the repair tip only shows for a few seconds.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 't1104' + Date.now(), backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  require('./no-voice-ask')(w);
  w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::|ERR_/.test(msg)) errors.push(`${msg} @${(src || '').split('/').pop()}:${line}`); });
  const js = (c) => w.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'v1104-' + n + '.png'), (await w.webContents.capturePage()).toPNG());
  await w.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`window.__crashes = []; (() => { const g = ${G}; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 500)); o(e); }; })(); true`);
  // a match with the bots parked far away (so only the test hurts anyone)
  const match = (mode, arena) => js(`(async () => {
    const g = ${G}; g.showMenu(); g.settings.mouseSteer = false;
    g.setCurrentBp(CW.PRESETS.find((p) => p.id === 'buggy'));
    g.playOffline('${mode}', '${arena || 'canyon'}');
    for (let i = 0; i < 600 && g.countdown > 0; i++) g.tick(1 / 30);
    for (const c of g.combatants) if (!c.isPlayer && c.mech && c.ai.style !== 'boss' && !c.minion) { c.ai.style = 'dummy'; c.mech.place({ x: 150 + Math.random() * 20, z: 150 }, 0); }
    for (let i = 0; i < 30; i++) g.tick(1 / 30);
    return true;
  })()`);
  const tick = (secs) => js(`(() => { const g = ${G}; for (let i = 0; i < ${Math.round(secs * 30)}; i++) g.tick(1 / 30); return true; })()`);
  // hop out (E) and have an enemy shoot the pilot down
  const killPilot = () => js(`(() => {
    const g = ${G}, p = g.player, foe = g.combatants.find((c) => !CW.sameTeam(c, p) && c.mech);
    g.exitMech(p);
    const before = { kills: foe.kills, wrecks: foe.wrecks, lives: p.lives, life: p.life };
    p.pilot.hit(99999, foe);
    return { before, foe: foe.netId !== undefined ? foe.netId : g.combatants.indexOf(foe), alive: p.alive, waiting: p.respawnT !== undefined, hint: document.getElementById('hint').textContent };
  })()`);
  const state = () => js(`(() => { const g = ${G}, p = g.player; return { alive: p.alive, mech: !!(p.mech && p.mech.alive && p.mech.occupied), waiting: p.respawnT !== undefined, lives: p.lives, life: p.life, ended: !!g.ended }; })()`);

  for (const [mode, name] of [['ball', 'Mech Ball'], ['bounty', 'Bounty Hunt'], ['koth', 'King of the Hill']]) {
    await match(mode);
    const k = await killPilot();
    check(k.alive && k.waiting, `${name}: your pilot is killed on foot -> you wait to respawn (not out for the match)`);
    await tick(7);
    const s = await state();
    check(s.alive && s.mech && !s.waiting && s.life > k.before.life, `${name}: you come back in a new mech`);
    const credit = await js(`(() => { const g = ${G}, foe = g.combatants.find((c) => !CW.sameTeam(c, g.player) && c.mech); return { kills: foe.kills, wrecks: foe.wrecks }; })()`);
    check(credit.kills === k.before.kills + 1 && credit.wrecks === k.before.wrecks + 1, `${name}: the enemy gets the wreck (score, streak, bounty)`);
    // a second time, so it isn't only the first life that works
    await killPilot(); await tick(7);
    const s2 = await state();
    check(s2.alive && s2.mech, `${name}: it works again on the next life`);
    await js(`${G}.endMatch(); ${G}.showMenu(); true`);
  }

  // Mech Ball: the mech is wrecked while you are out of it, then your pilot dies while you wait
  await match('ball');
  const w2 = await js(`(() => { const g = ${G}, p = g.player, foe = g.combatants.find((c) => !CW.sameTeam(c, p) && c.mech);
    g.exitMech(p); p.mech.destroy(foe); const waiting = p.respawnT !== undefined; if (p.pilot && p.pilot.alive) p.pilot.hit(99999, foe);
    return { waiting, alive: p.alive }; })()`);
  await tick(6);
  const s3 = await state();
  check(w2.waiting && w2.alive && s3.alive && s3.mech, 'Mech Ball: mech wrecked, then the pilot killed while waiting -> still respawns');
  await js(`${G}.endMatch(); ${G}.showMenu(); true`);

  // Boss Battle: dying on foot costs a life, and the last life is still the last
  await match('boss');
  const b = await killPilot();
  await tick(8);
  const sb = await state();
  check(sb.alive && sb.mech && sb.lives === b.before.lives - 1, `Boss Battle: killed on foot -> respawn with one life less (${b.before.lives} -> ${sb.lives})`);
  await js(`${G}.player.lives = 1; true`);
  await killPilot(); await tick(8);
  const sb2 = await state();
  check(!sb2.alive, 'Boss Battle: on the last life you are out');
  await js(`${G}.endMatch(); ${G}.showMenu(); true`);

  // Workshop Clash (no respawns) still knocks you out when your pilot dies
  await match('clash');
  await killPilot(); await tick(5);
  check(!(await state()).alive, 'Workshop Clash (no respawns): a killed pilot is still out, like before');
  await js(`${G}.endMatch(); ${G}.showMenu(); true`);

  // ---- the warning box ----
  await match('ball');
  // stuck: the box stays in one place (it used to pulse and jump sideways)
  await js(`(() => { const g = ${G}; g.stuckT = 5; g.unstuckCd = 0; g.updateHud(); return true; })()`);
  const rects = [];
  for (let i = 0; i < 8; i++) {
    rects.push(await js(`(() => { const g = ${G}; g.stuckT = 5; g.updateHud(); const r = document.getElementById('edgeWarn').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })()`));
    await wait(160);
  }
  const box = await js(`(() => { const e = document.getElementById('edgeWarn'), cs = getComputedStyle(e); return { text: e.textContent, hidden: e.classList.contains('hidden'), anim: cs.animationName, bg: cs.backgroundImage, line: cs.borderLeftColor, h: innerHeight, w: innerWidth }; })()`);
  check(!box.hidden && /Stuck\? Press F/.test(box.text), `stuck shows "${box.text}"`);
  check(rects.every((r) => r.join() === rects[0].join()), `it doesn't move or grow (${rects[0].join(' ')} every time)`);
  check(rects[0][0] < 40 && rects[0][1] > box.h * 0.25 && rects[0][1] < box.h * 0.45, 'it sits on the left, a bit above the middle');
  check(box.anim !== 'pulse' && /26, 35, 66/.test(box.bg), 'no pulsing; the default theme colors');
  await shot('warn-default');
  const themed = await js(`(() => { const g = ${G}; g.settings.theme = 'ocean'; g.applySettings(); g.stuckT = 5; g.updateHud(); return getComputedStyle(document.getElementById('edgeWarn')).backgroundImage; })()`);
  check(/14, 44, 82/.test(themed), 'with the Deep ocean theme it uses that theme');
  await shot('warn-ocean');
  await js(`(() => { const g = ${G}; g.settings.theme = ''; g.applySettings(); g.stuckT = 0; return true; })()`);

  // the repair tip: about 5 s, then it rests
  await js(`(() => { const g = ${G}, m = g.player.mech; const q = m.parts.filter((x) => x.alive && x !== m.core); for (const x of q.slice(0, 3)) m.breakPart(x, null); return true; })()`);
  await tick(1);
  const tip1 = await js(`document.getElementById('edgeWarn').textContent`);
  check(/Damaged!/.test(tip1), 'damaged with nobody near: the repair tip shows');
  await shot('warn-damaged');
  await tick(5);
  const tip2 = await js(`document.getElementById('edgeWarn').classList.contains('hidden')`);
  await tick(40);
  const tip3 = await js(`document.getElementById('edgeWarn').classList.contains('hidden')`);
  check(tip2 && tip3, 'after ~5 s it goes away and stays away (not back 40 s later)');
  // about a minute later it may remind you once more (when nobody is near at that moment)
  let again = false;
  for (let i = 0; i < 40 && !again; i++) { await js(`(() => { const g = ${G}; for (const c of g.combatants) if (!c.isPlayer && c.mech) c.mech.place({ x: 150, z: 150 }, 0); return true; })()`); await tick(1); again = /Damaged!/.test(await js(`document.getElementById('edgeWarn').textContent`)); }
  check(again, 'a minute later it can remind you once more');

  // phone size (915 x 412 sideways): still on the left, not over the status box
  w.setContentSize(915, 412);
  await js(`(() => { const g = ${G}; g.touch.on = true; document.body.classList.add('touch-ui'); g.stuckT = 5; g.updateHud(); return true; })()`);
  await wait(400);
  const ph = await js(`(() => { const g = ${G}; g.stuckT = 5; g.updateHud(); const a = document.getElementById('edgeWarn').getBoundingClientRect(), s = document.getElementById('status').getBoundingClientRect(); return { a: [a.left, a.top, a.right, a.bottom], s: [s.left, s.top, s.right, s.bottom] }; })()`);
  check(ph.a[0] < 40 && (ph.a[1] >= ph.s[3] || ph.a[0] >= ph.s[2]), `phones: on the left, below the status box (box ${ph.a.map(Math.round).join(' ')}, status ${ph.s.map(Math.round).join(' ')})`);
  await wait(800);
  await shot('warn-phone').catch((e) => console.log('  (phone screenshot skipped: ' + e.message + ')'));
  await js(`${G}.endMatch(); ${G}.showMenu(); true`);

  const crashes = await js('window.__crashes');
  check(!crashes.length, 'no crashes' + (crashes.length ? ': ' + crashes[0] : ''));
  const errs = errors.filter((e) => !/WebSocket|voice|getUserMedia|ResizeObserver/.test(e));
  check(!errs.length, 'no errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
