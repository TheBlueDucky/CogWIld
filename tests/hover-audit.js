// Muted check (v1.9.8): points the mouse at every button, drop-down and clickable card on the main screens and lists
// the ones that don't get the gray-blue line (--muted2, rgb(159, 179, 217)) while pointed at. Hidden window, local
// test server on 8781. Prints "MISS <screen>: <element>" lines and a count.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'hva' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 40000, coins: 5000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);
  await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: 'Hv' + Math.floor(Math.random() * 1e4), pass: 'hoverpass1' }))`);
  await wait(2500);
  await js(`(() => { const st = document.createElement('style'); st.textContent = '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }'; document.head.appendChild(st); return true; })()`);
  const misses = [];
  let checked = 0;
  // everything you can click that's on screen right now
  const audit = async (screen) => {
    const list = await js(`(() => {
      const out = [];
      const els = document.querySelectorAll('button, select, a.btn, [role=button], [data-act], .shop-item, .arena-opt, .mode-opt, .feat-card, .room-row, .gal-card, .quests-card, .club-row[data-id], .cl-pick, summary');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.right > innerWidth || r.bottom > innerHeight || r.left < 0 || r.top < 0) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) continue;
        if (el.disabled) continue;
        const cls = (el.className && el.className.baseVal === undefined ? el.className : '').toString().trim().split(/\\s+/).slice(0, 3).join('.');
        const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30);
        out.push({ x: Math.round(x), y: Math.round(y), name: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') + ' "' + txt + '"', i: out.length });
        el.dataset.hvi = out.length - 1;
      }
      return out;
    })()`);
    for (const e of list) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: e.x, y: e.y });
      await wait(70);
      const ok = await js(`(() => {
        const el = document.querySelector('[data-hvi="${e.i}"]');
        if (!el) return 'gone';
        const M = 'rgb(159, 179, 217)';
        const cs = getComputedStyle(el);
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor === M) return 'ok';
        if (['Top', 'Right', 'Bottom', 'Left'].some((s) => cs['border' + s + 'Color'] === M && parseFloat(cs['border' + s + 'Width']) > 0)) return 'ok';
        return 'outline ' + cs.outlineStyle + ' ' + cs.outlineColor + ' / border ' + cs.borderTopColor + ' ' + cs.borderTopWidth;
      })()`);
      checked++;
      if (ok !== 'ok' && ok !== 'gone') misses.push(`${screen}: ${e.name} -> ${ok}`);
    }
    await js(`document.querySelectorAll('[data-hvi]').forEach((el) => delete el.dataset.hvi); true`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  };
  const panel = async (k, screen) => { await js(`${G}.meta.openPanel('${k}'); true`); await wait(900); await audit(screen || k); await js(`${G}.meta.closePanel(); true`); await wait(200); };
  await audit('lobby');
  for (const t of ['account', 'display', 'keys', 'controls', 'touch', 'voice', 'sound', 'chat', 'online', 'support', 'save']) {
    await js(`${G}.meta.setTab = '${t}'; ${G}.meta.openPanel('settings'); true`);
    await wait(500);
    await audit('settings/' + t);
    await js(`${G}.meta.closePanel(); true`);
  }
  for (const k of ['shop', 'friends', 'clubs', 'replays', 'profile', 'top', 'gallery', 'ach', 'challenges', 'arenas', 'pass', 'road']) {
    try { await panel(k); } catch (e) { console.log('skip', k, e.message); }
  }
  // the room, a match (with the pause menu) and the results
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(5000);
  await audit('match');
  await js(`${G}.pause && ${G}.pause(); true`);
  await wait(500);
  await audit('pause');
  await js(`${G}.showMenu(); true`);
  await wait(800);
  for (const m of misses) console.log('MISS', m);
  console.log(`CHECKED ${checked}, MISSES ${misses.length}`);
  app.exit(0);
});
