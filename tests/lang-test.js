// Muted check of the languages (hidden window): for each language the lobby, PLAY panel, Settings, Workshop and a
// match are translated (PLAY, Shop, Settings… in that language), Arabic and Hebrew panels read right to left, players'
// names stay as typed, the Settings language menu switches, and nothing errors. LANGS=es,hi to limit.
// Needs the local test server on 8781. Screenshots: tests/shots/lang-<id>-*.png.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
// what PLAY / Shop / Settings should read in each language
const WANT = { es: ['JUGAR', 'Tienda'], pt: ['JOGAR', 'Loja'], fr: ['JOUER', 'Boutique'], de: ['SPIELEN', 'Shop'], it: ['GIOCA', 'Negozio'], ru: ['ИГРАТЬ', 'Магазин'], tr: ['OYNA', 'Mağaza'],
  hi: ['खेलें', 'दुकान'], ar: ['العب', 'المتجر'], he: ['שחק', 'חנות'], zh: ['开始', '商店'], ja: ['プレイ', 'ショップ'] };

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg + ' @' + String(src).split('/').pop() + ':' + line); });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, 'lang-' + n + '.png'), (await win.webContents.capturePage()).toPNG());
  const list = (process.env.LANGS || Object.keys(WANT).join(',')).split(',');
  await win.loadURL('http://localhost:8781/');
  for (const id of list) {
    await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ name: 'Shop', xp: 9000, settings: { lang: '${id}', tutorialDone: true, music: 0, sfx: 0, volume: 0, timeOfDay: 'day' } })); location.reload(); true`);
    await wait(5000);
    const lobby = await js(`(() => ({ lang: document.documentElement.lang, rtl: document.documentElement.classList.contains('rtl'), play: document.querySelector('#btnPlay').firstChild.textContent.trim(), shop: document.getElementById('btnShop').textContent.trim(), name: document.getElementById('pName').value }))()`);
    const [play, shop] = WANT[id];
    check(lobby.lang === id && lobby.play === play && lobby.shop.includes(shop) && lobby.name === 'Shop', `${id}: lobby says "${lobby.play}" / "${lobby.shop.replace(/\s+/g, ' ')}"${lobby.rtl ? ' (right to left)' : ''}, the pilot name stays "${lobby.name}"`);
    await shot(id + '-lobby');
    await js(`${G}.meta.openPanel('arenas'); true`);
    await wait(500);
    await shot(id + '-play');
    await js(`${G}.meta.openPanel('settings'); true`);
    await wait(500);
    const sel = await js(`document.getElementById('setLang') ? document.getElementById('setLang').value : ''`);
    check(sel === id, `${id}: Settings › Display shows the language (${sel})`);
    await js(`(() => { const b = [...document.querySelectorAll('#panelBody button')].find((x) => x.dataset && x.dataset.cat === 'display') || null; if (b) b.click(); return true; })()`);
    await wait(300);
    await shot(id + '-settings');
    await js(`${G}.meta.closePanel(); ${G}.openWorkshop(); true`);
    await wait(1200);
    await shot(id + '-workshop');
    await js(`(async () => { const g = ${G}; g.showMenu(); g.playOffline('koth', 'canyon', null); for (let i = 0; i < 260; i++) { g.tick(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
    await wait(600);
    await shot(id + '-match');
    const hud = await js(`document.getElementById('hud').innerText.slice(0, 300)`);
    check(!/\bIntegrity\b/.test(hud), `${id}: the match screen is translated`);
    await js(`${G}.showMenu(); true`);
  }
  // back to English from the menu
  await js(`(() => { const g = ${G}; g.meta.openPanel('settings'); const s = document.getElementById('setLang'); s.value = 'en'; s.dispatchEvent(new Event('change')); return true; })()`);
  await wait(5000);
  check(await js(`document.documentElement.lang === 'en' && document.querySelector('#btnPlay').firstChild.textContent.trim() === 'PLAY'`), 'the language menu switches back to English');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
