// Muted screenshots of the Shop (with the buy pop-up), Cog Pass and Settings at a few sizes.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = (process.env.SIZES || '1280x720,915x412').split(',').map((s) => s.split('x').map(Number));
app.whenReady().then(async () => {
  const errors = [];
  const wins = SIZES.map(([w, h]) => new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: 'ms' + w + Date.now() } }));
  for (let i = 0; i < SIZES.length; i++) {
    const [w, h] = SIZES[i], win = wins[i];
    win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win); // not a voice chat test
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errors.push(`${w}x${h} ${msg}`); });
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}-${w}.png`), (await win.webContents.capturePage()).toPNG());
    const G = '(window.game || CW.game)';
    await win.loadURL('http://localhost:8781/');
    await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, coins: 900, settings: { tutorialDone: true, music: 0, sfx: 0 } })); location.reload();`);
    await wait(3500);
    const name = 'Ms' + w + Math.floor(Math.random() * 1000); // short: long numbers look like phone numbers to the name filter
    await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${name}', pass: 'shotpass1' }))`);
    await wait(2500);
    // a few matches' worth of pass points (capped by the server) so some tiers are reached
    await js(`${G}.net.send({ t: 'earn', src: 'match', n: 300, pp: 50 }); ${G}.net.send({ t: 'gift' }); true`);
    await wait(1200);
    await js(`${G}.meta.openPanel('shop'); true`);
    await wait(800);
    await shot('shop');
    // point at a shop item: the whole card gets the outline
    const box = await js(`(() => { const r = document.querySelector('.shop-grid .shop-item.can-buy').getBoundingClientRect(); const z = parseFloat(getComputedStyle(document.getElementById('panel')).zoom) || 1; return { x: (r.left + r.width / 2) * z, y: (r.top + 12) * z }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x), y: Math.round(box.y) });
    await wait(300);
    const out = await js(`(() => { const el = document.querySelector('.shop-grid .shop-item.can-buy'); const cs = getComputedStyle(el); return cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor; })()`);
    console.log(`${w} hover outline:`, out);
    await shot('shop-hover');
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
    await wait(500);
    console.log(`${w} confirm open:`, await js(`!document.getElementById('confirm').classList.contains('hidden') && document.getElementById('confirmTitle').textContent`));
    await shot('shop-confirm');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(300);
    console.log(`${w} after Esc: confirm hidden`, await js(`document.getElementById('confirm').classList.contains('hidden')`), 'shop still open', await js(`!document.getElementById('panel').classList.contains('hidden')`));
    // buy it for real: click the card, then "Buy" in the pop-up; the coins go down and the item is owned
    const before = await js(`${G}.profile.coins`);
    const what = await js(`(() => { const el = document.querySelector('.shop-grid .shop-item.can-buy'); el.click(); document.getElementById('confirmOk').click(); return el.dataset.kind + ':' + el.dataset.id; })()`);
    await wait(1200);
    const [k, id] = what.split(':');
    console.log(`${w} bought ${id}: coins ${before} -> ${await js(`${G}.profile.coins`)}, owned`, await js(`${G}.meta.owns('${k}', '${id}')`));
    // no hover text (title tooltips) anywhere in the lobby or the open menus
    console.log(`${w} elements with hover text:`, await js(`document.querySelectorAll('[title]').length`));
    await js(`${G}.meta.closePanel(); ${G}.meta.openPanel('pass'); true`);
    await wait(900);
    await shot('pass');
    // how claimable and claimed tiers look (only drawn here, nothing is sent to the server)
    await js(`(() => { const a = ${G}.account; a.wallet.pass.pts = 740; a.wallet.pass.claimed = [1, 2]; ${G}.meta.renderPanel(); })()`);
    await wait(400);
    await shot('pass-ready');
    await js(`${G}.meta.closePanel(); ${G}.meta.openPanel('settings'); true`);
    await wait(700);
    await shot('settings');
    const tabs = await js(`[...document.querySelectorAll('[data-settab]')].map((b) => b.dataset.settab)`);
    for (const t of tabs || []) {
      await js(`document.querySelector('[data-settab="${t}"]').click(); true`);
      await wait(250);
      await shot('settings-' + t);
    }
    await js(`${G}.meta.closePanel(); true`);
  }
  wins.forEach((x) => x.destroy());
  console.log('errors', errors.length, errors.slice(0, 10).join('\n'));
  app.exit(0);
});
