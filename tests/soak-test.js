// Muted soak test: every mode on several arenas, fast-forwarded, with the player driving and shooting.
// Records crashes, console errors and CSP violations. Run with electron against a local server on 8781.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.URL || 'http://localhost:8781/';
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  const errors = [];
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2) errors.push(`[${level}] ${msg} @${(src || '').split('/').pop()}:${line}`); });
  win.webContents.on('render-process-gone', (e, d) => errors.push('RENDERER GONE ' + d.reason));
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL(URL);
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, coins: 50, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
  await wait(4000);
  await js(`window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); window.__crashes = []; (() => { const g = window.game || CW.game; const orig = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 400)); orig(e); document.getElementById('crash').classList.add('hidden'); g.crashShown = false; }; })(); true`);
  const modes = process.env.MODES ? process.env.MODES.split(',') : await js(`Object.keys(CW.MODES)`);
  const arenas = await js(`Object.keys(CW.ARENAS)`);
  console.log('modes', modes.join(','), '| arenas', arenas.join(','));
  const results = [];
  let ai = 0;
  for (const mode of modes) {
    for (let k = 0; k < 2; k++) {
      const arena = arenas[ai++ % arenas.length];
      const before = errors.length;
      const r = await js(`(async () => {
        const g = window.game || CW.game;
        try { g.showMenu(); } catch (e) { window.__crashes.push('showMenu ' + e.message); }
        try { g.playOffline(${JSON.stringify(mode)}, ${JSON.stringify(arena)}, ${k === 1 && process.env.WEEKLY ? "'weekly'" : 'null'}); } catch (e) { window.__crashes.push('start ${mode} ' + (e.stack || e).slice(0, 300)); return { err: String(e) }; }
        // rush build phase: just go
        if (g.state !== 'match' && g.rush && g.rush.finish) try { g.rush.finish(); } catch (e) {}
        for (let i = 0; i < 2400 && g.state === 'workshop'; i++) { g.tick(0.05); if (i % 100 === 0) await new Promise((r) => setTimeout(r, 0)); }
        const startState = g.state;
        let t = 0, superUsed = false;
        const keys = ['KeyW', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'];
        for (let i = 0; i < 2400 && (g.state === 'match' || g.state === 'build' || g.state === 'rush'); i++) {
          // drive around and shoot
          if (i % 60 === 0) { for (const k of keys) g.keys[k] = false; g.keys[keys[(i / 60) % keys.length | 0]] = true; g.keys.KeyW = true; }
          g.mouse.left = i % 90 < 60; g.mouse.dx = (i % 120 < 60 ? 6 : -6);
          if (!superUsed && g.player && g.player.superCharge >= 1) { g.pressed.KeyX = true; superUsed = true; }
          if (i % 200 === 100) g.pressed.KeyG = true;
          if (i === 600) { try { g.pause(); g.resume && g.resume(); } catch (e) { window.__crashes.push('pause ' + e.message); } }
          try { g.tick(0.05); } catch (e) { window.__crashes.push('tick ' + (e.stack || e).slice(0, 300)); break; }
          t += 0.05;
          if (i % 100 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        for (const k of keys) g.keys[k] = false; g.mouse.left = false;
        return { startState, endState: g.state, simSecs: Math.round(t), mechs: g.combatants.length, arena: g.world.arena.id, superUsed, gadgetsLeft: g.player && g.gadgets.left(g.player), mines: g.gadgets.mines.length, mods: JSON.stringify(g.mods) };
      })()`);
      // results screen buttons
      const after = await js(`(() => { const g = window.game || CW.game; if (g.state === 'results') { try { g.showMenu(); } catch (e) { window.__crashes.push('results->menu ' + e.message); } } return g.state; })()`);
      const crashes = await js(`window.__crashes.splice(0)`);
      results.push({ mode, arena, ...r, after, crashes, consoleErrors: errors.slice(before) });
      console.log(mode.padEnd(9), arena.padEnd(9), JSON.stringify(r), '->', after, crashes.length ? 'CRASH ' + crashes.join(' | ') : '', errors.length > before ? 'ERR ' + errors.slice(before).join(' | ') : '');
    }
  }
  // menus: every panel opens and closes
  const panels = await js(`(async () => {
    const g = window.game || CW.game; const out = [];
    for (const b of [...document.querySelectorAll('#menu button')]) {
      if (/PLAY|btnPlay/.test(b.id + b.textContent) || b.id === 'btnPlay') continue;
      try { b.click(); await new Promise((r) => setTimeout(r, 120)); out.push(b.id || b.textContent.trim().slice(0, 12)); g.meta && g.meta.closePanel && g.meta.closePanel(); g.closeModal && g.closeModal(); if (g.state !== 'menu') g.showMenu(); } catch (e) { window.__crashes.push('panel ' + b.id + ' ' + e.message); }
    }
    return out;
  })()`);
  console.log('PANELS', panels.join(','));
  // workshop round trip
  await js(`(() => { const g = window.game || CW.game; try { g.openWorkshop ? g.openWorkshop() : document.getElementById('btnWorkshop').click(); for (let i = 0; i < 60; i++) g.tick(0.05); g.showMenu(); } catch (e) { window.__crashes.push('workshop ' + e.message); } })()`);
  console.log('LATE CRASHES', JSON.stringify(await js(`window.__crashes`)));
  console.log('CSP', JSON.stringify(await js(`window.__csp`)));
  console.log('ALL CONSOLE ERRORS', errors.length);
  for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ', e);
  app.exit(0);
});
