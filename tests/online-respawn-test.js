// Muted online check of the v1.10.4 respawn fix: two real game clients (local test server) play Bounty Hunt together; Ann hops
// out of her mech and her pilot is shot down by an enemy bot (run by the host's game). Both games must keep her in the match, and both must see her new mech.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.URL || 'http://localhost:8781/';
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
app.whenReady().then(async () => {
  const errors = [];
  const mk = async (name) => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 650, webPreferences: { offscreen: true, partition: 'r-' + name + Date.now(), backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win);
    win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::|voice|getUserMedia/.test(msg)) errors.push(`${name} ${msg} @${(src || '').split('/').pop()}:${line}`); });
    const js = (code) => win.webContents.executeJavaScript(code);
    await win.loadURL(URL);
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0 } })); location.reload();`);
    await wait(3500);
    return { win, js, name };
  };
  const A = await mk('ann'), B = await mk('ben');
  const G = `(window.game || CW.game)`;
  const tag = Math.floor(Math.random() * 1e5);
  for (const P of [A, B]) { P.user = P.name + tag; await P.js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${P.user}', pass: 'testpass1' }))`); }
  await wait(2500);
  for (const P of [A, B]) { await P.js(`${G}.settings.mmMode = 'bounty'; ${G}.settings.mmArena = 'canyon'; ${G}.settings.mmEvent = null; ${G}.play(); true`); await wait(400); }
  let st;
  for (let i = 0; i < 40; i++) {
    st = await Promise.all([A, B].map((P) => P.js(`({ state: ${G}.state, mode: ${G}.modeId, cd: ${G}.countdown })`)));
    if (st.every((s) => s.state === 'match' && s.cd <= 0)) break;
    await wait(1000);
  }
  check(st.every((s) => s.state === 'match' && s.mode === 'bounty'), `both are in the same Bounty Hunt match (${JSON.stringify(st)})`);
  // Ann hops out of her mech; an enemy bot shoots her pilot down from the host's game (hits come from the shooter's game)
  const life0 = await A.js(`(() => { const g = ${G}, p = g.player; g.exitMech(p); return p.life; })()`);
  await wait(3000);
  const host = (await A.js(`${G}.net.isHost`)) ? A : B;
  const shot = await host.js(`(() => { const g = ${G}, ann = g.combatants.find((c) => c.name === '${A.user}'), bot = g.combatants.find((c) => !c.human && !c.isPlayer && !CW.sameTeam(c, ann));
    if (!ann.pilot || !ann.pilot.alive) return 'no pilot seen'; if (!bot) return 'no enemy bot'; ann.pilot.hit(99999, bot); return 'shot'; })()`);
  await wait(800);
  const k = await A.js(`(() => { const p = ${G}.player; return { life: p.life, alive: p.alive, waiting: p.respawnT !== undefined, mech: !!(p.mech && p.mech.alive) }; })()`);
  check(shot === 'shot' && k.alive && (k.waiting || k.life > life0), `Ann's game: killed on foot -> waiting to respawn (${shot}, ${JSON.stringify(k)})`);
  await wait(1500);
  const seen = await B.js(`(() => { const g = ${G}, ann = g.combatants.find((c) => c.name === '${A.user}'); return { alive: ann.alive, mech: !!(ann.mech && ann.mech.alive) }; })()`);
  check(seen.alive, "Ben's game: Ann is still in the match (not out)");
  await wait(6000);
  const a2 = await A.js(`(() => { const p = ${G}.player; return { alive: p.alive, mech: !!(p.mech && p.mech.alive && p.mech.occupied), life: p.life }; })()`);
  check(a2.alive && a2.mech && a2.life > life0, "Ann's game: she is back in a new mech");
  const b2 = await B.js(`(() => { const g = ${G}, ann = g.combatants.find((c) => c.name === '${A.user}'); return { alive: ann.alive, mech: !!(ann.mech && ann.mech.alive), life: ann.life }; })()`);
  check(b2.alive && b2.mech && b2.life === a2.life, "Ben's game: he sees Ann's new mech");
  const crashes = await Promise.all([A, B].map((P) => P.js(`(window.__crashes || []).length`)));
  check(crashes.every((n) => !n) && !errors.length, 'no crashes or errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
