// Muted check of the bots (hidden window, no drawing, sped up): 7 bots fight each other on every arena for 90 s
// of game time while the player is left out of it. Counts how far they drive, how long they are stuck, how often
// they get teleported out of a trap, and how much they dash, use supers, gadgets and tricks.
//   desktop/node_modules/.bin/electron tests/bots-test.js      (SECS=90, ARENAS=canyon,city to limit)
// Needs the local test server on 8781 (tests/README.md).
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SECS = +process.env.SECS || 90;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, difficulty: 'normal' } })); location.reload();`);
  await wait(4500);
  const arenas = process.env.ARENAS ? process.env.ARENAS.split(',') : await js(`Object.keys(CW.ARENAS)`);
  const total = { km: 0, stuck: 0, teleports: 0, dashes: 0, supers: 0, gadgets: 0, wrecks: 0, donuts: 0, bots: 0 };
  for (const arena of arenas) {
    const r = await js(`(async () => {
      const g = ${G};
      g.headless = true;
      g.showMenu(); g.playOffline('clash', '${arena}', null);
      for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
      // the player sits this one out: far away, untouchable, nobody's target
      const me = g.player;
      const enemiesOf = g.enemiesOf; g.enemiesOf = function (c) { return enemiesOf.call(this, c).filter((e) => e.c !== me); };
      const st = { dashes: 0, supers: 0, gadgets: 0, teleports: 0, donuts: 0 };
      const onDash = g.onDash; g.onDash = function (m) { if (m.combatant !== me) st.dashes++; return onDash.apply(this, arguments); };
      const act = g.supers.activate; g.supers.activate = function (c) { const ok = act.apply(this, arguments); if (ok && c !== me) st.supers++; return ok; };
      const use = g.gadgets.use; g.gadgets.use = function (c) { const ok = use.apply(this, arguments); if (ok && c !== me) st.gadgets++; return ok; };
      const bots = g.combatants.filter((c) => c !== me);
      const safe = g.safeSpotNear; g.safeSpotNear = function () { st.teleports++; return safe.apply(this, arguments); }; // the trapped-bot rescue
      const dist = new Map(), stuckT = new Map(), last = new Map();
      for (const b of bots) { dist.set(b, 0); stuckT.set(b, 0); last.set(b, b.mech.pos.clone()); }
      const steps = Math.round(${SECS} * 30);
      for (let i = 0; i < steps && g.state === 'match'; i++) {
        me.mech.protect = 99; me.mech.place({ x: CW.ARENA_HALF - 8, z: CW.ARENA_HALF - 8 }, 0);
        g.tick(1 / 30);
        for (const b of bots) {
          const m = b.mech; if (!m || !m.alive) continue;
          if (last.get(b).distanceTo(m.pos) < 20) dist.set(b, dist.get(b) + last.get(b).distanceTo(m.pos));
          last.set(b, m.pos.clone());
          if (b.ai.stuck > 1) stuckT.set(b, stuckT.get(b) + 1 / 30);
          if (b.ai.celebrate > 0 && !b.__cel) { st.donuts++; } b.__cel = b.ai.celebrate > 0;
        }
        if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      g.safeSpotNear = safe; g.enemiesOf = enemiesOf; g.onDash = onDash; g.supers.activate = act; g.gadgets.use = use;
      const out = { bots: bots.length, km: 0, stuck: 0, wrecks: bots.reduce((s, b) => s + b.wrecks, 0), ...st };
      for (const b of bots) { out.km += dist.get(b) / 1000; out.stuck += stuckT.get(b); }
      g.headless = false; g.showMenu();
      return out;
    })()`);
    console.log(`       ${arena.padEnd(8)} driven ${(r.km).toFixed(1)} km · stuck ${r.stuck.toFixed(0)} s · teleported ${r.teleports} · dashes ${r.dashes} · supers ${r.supers} · gadgets ${r.gadgets} · wrecks ${r.wrecks} · donuts ${r.donuts}`);
    for (const k of Object.keys(total)) total[k] += r[k] || 0;
  }
  const per = (k) => (total[k] / total.bots).toFixed(2);
  console.log(`       per bot per ${SECS} s: ${per('km')} km, stuck ${per('stuck')} s, teleported ${per('teleports')}, ${per('dashes')} dashes, ${per('supers')} supers, ${per('gadgets')} gadgets, ${per('wrecks')} wrecks`);
  check(total.km / total.bots > 0.4, 'bots keep driving');
  check(total.stuck / total.bots < SECS * 0.15, 'bots are rarely stuck');
  check(total.supers > 0 && total.dashes > 0 && total.gadgets > 0, 'bots dash, use supers and gadgets');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
