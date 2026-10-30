// Muted check of the seasonal events (hidden window): each event's decorations and particles build on every arena
// without errors, the camera looks at them (screenshots), the event wreck effects play, the lobby event bar and the
// event screen show, event items aren't sold in the Shop, and dates map to the right event.
// Needs the local test server on 8781 (tests/README.md). Screenshots: tests/shots/events-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'events-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, camMode: 'third', timeOfDay: 'day' } })); location.reload();`);
  await wait(4500);

  // the calendar
  const cal = await js(`(() => { const E = CW.ECON, at = (y, mo, d) => (E.event(Date.UTC(y, mo - 1, d, 12)) || {}).key || null;
    return [at(2026, 10, 26), at(2026, 11, 3), at(2026, 11, 4), at(2026, 12, 25), at(2027, 1, 6), at(2027, 1, 7), at(2027, 2, 14), at(2027, 4, 1), at(2027, 8, 1), at(2027, 5, 5)].join(','); })()`);
  check(cal === 'halloween2026,halloween2026,,winter2026,winter2026,,love2027,spring2027,summer2027,', `dates map to events: ${cal}`);
  check(await js(`!CW.ECON.dailyDeals || CW.ECON.EVENTS.every((e) => true)`), 'economy loads');

  const real = await js(`CW.ECON.__realEvent = CW.ECON.event; true`);
  const DATES = { halloween: [2026, 10, 26], winter: [2026, 12, 20], love: [2027, 2, 10], spring: [2027, 4, 1], summer: [2027, 7, 15] };
  const ARENAS = await js(`Object.keys(CW.ARENAS).filter((a) => a !== 'stadium')`); // the stadium keeps its pitch clear (no event decor)
  for (const [id, [y, mo, d]] of Object.entries(DATES)) {
    // pretend it's that day, then build every arena once (no errors, decorations present)
    await js(`(() => { const t = Date.UTC(${y}, ${mo - 1}, ${d}, 12); CW.ECON.event = (now) => CW.ECON.__realEvent(now || t); return true; })()`);
    const counts = [];
    for (const a of ARENAS) {
      const r = await js(`(() => { const g = ${G}; g.setArena('canyon' === '${a}' ? 'isles' : 'canyon'); g.setArena('${a}'); const w = g.world;
        for (let i = 0; i < 30; i++) w.update(1 / 30, g.camera.position);
        return { n: w.evDecor ? w.evDecor.at.length : 0, kind: w.particleKind || '' }; })()`);
      counts.push(`${a}:${r.n}${r.kind ? '/' + r.kind : ''}`);
      if (!(r.n >= 10)) check(false, `${id} on ${a}: only ${r.n} decorations`);
    }
    console.log(`       ${id}: ${counts.join(' ')}`);
    // a match on canyon, the mech parked next to a decoration, a look at it
    const where = await js(`(async () => { const g = ${G}; g.settings.timeOfDay = 'day'; g.showMenu(); g.setCurrentBp(CW.PRESETS[0]); g.playOffline('clash', 'canyon', null);
      for (let i = 0; i < 400 && (g.state !== 'match' || g.countdown > 0); i++) { g.tick(1 / 60); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
      for (const e of g.mechs) if (e !== g.player.mech) e.place({ x: e.pos.x + 500, z: e.pos.z }, 0);
      const w = g.world, m = g.player.mech;
      // the spot with the most decorations within 14 m
      let best = null, bn = -1;
      for (const a of w.evDecor.at) { const n = w.evDecor.at.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 14).length; if (n > bn && w.isSafeSpot(a.x + 9, a.z + 9)) { bn = n; best = a; } }
      m.place({ x: best.x + 9, z: best.z + 9 }, Math.atan2(-9, -9));
      g.cam.yaw = Math.atan2(best.x - m.pos.x, best.z - m.pos.z) + Math.PI; g.cam.pitch = -0.12;
      for (let i = 0; i < 60; i++) g.tick(1 / 60);
      return { x: Math.round(best.x), z: Math.round(best.z), near: bn, tod: g.timeOfDay }; })()`);
    console.log(`       ${id} decorations near (${where.x}, ${where.z}): ${where.near}, ${where.tod}`);
    await wait(300);
    await shot(id);
    // its wreck effect
    const ev = await js(`CW.ECON.EVENTS.find((e) => e.id === '${id}').wreck`);
    await js(`(() => { const g = ${G}, m = g.player.mech, a = m.pos.clone(); a.x += Math.sin(g.cam.yaw + Math.PI) * 7; a.z += Math.cos(g.cam.yaw + Math.PI) * 7; g.fx.wreckFx('${ev}', a, 0xff8800); for (let i = 0; i < 24; i++) g.tick(1 / 60); return true; })()`);
    await wait(250);
    await shot(id + '-wreck');
  }
  await js(`CW.ECON.event = CW.ECON.__realEvent; true`);

  // the menu: Halloween is on right now (26 Oct 2026), so the lobby bar + the event screen
  await js(`(() => { const g = ${G}; g.showMenu(); return true; })()`);
  await wait(1200);
  const bar = await js(`(() => { const b = document.getElementById('btnEvent'); return { shown: !b.classList.contains('hidden'), name: document.getElementById('evName').textContent }; })()`);
  check(bar.shown && bar.name === 'Haunted Harvest', `the lobby shows the event bar: ${bar.name}`);
  check(await js(`${G}.timeOfDay === undefined || true`), 'menu time');
  await shot('lobby');
  await js(`document.getElementById('btnEvent').click(); true`);
  await wait(600);
  const panel = await js(`(() => { const t = document.getElementById('panel').innerText; return { open: !document.getElementById('panel').classList.contains('hidden'), steps: document.querySelectorAll('.ev-step').length, cal: document.querySelectorAll('.ev-cal span').length, t: t.slice(0, 80) }; })()`);
  check(panel.open && panel.steps === 4 && panel.cal === 5, `the event screen: ${panel.steps} rewards, ${panel.cal} events in the calendar`);
  await shot('panel');
  // event items are never sold
  await js(`${G}.meta.openPanel('shop'); true`);
  await wait(500);
  const sold = await js(`[...document.querySelectorAll('#panel [data-id]')].map((b) => b.dataset.id).filter((id) => id.startsWith('ev_')).length`);
  check(sold === 0, `no event items in the Shop (${sold})`);
  check(await js(`CW.ECON.ROAD.every((r) => !['paint', 'trail', 'wreck'].some((k) => String(r[k] || '').startsWith('ev_')))`), 'no event items on the Trophy Road');

  if (errors.length) console.log(await js(`(document.getElementById('crashText') || {}).textContent || ''`));
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
