// Muted check of v1.9.9 (hidden windows, local test server on 8781): Glass Look under Background opacity, the Settings
// categories keep the window's background in the glass look, Background opacity for the menu buttons and the small
// buttons in matches in both looks (0% = nothing, the default = as before), white-gray Controls / Touch screen icons, the
// shorter Low graphics line, the Discord setting (a desktop-app window tells the app to hide it), and club chat read on
// one device stays read when you log in on another.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const mk = (p, preload) => {
    const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: p + Date.now(), ...(preload ? { preload, contextIsolation: true } : {}) } });
    w.webContents.setAudioMuted(true);
    require('./no-voice-ask')(w);
    w.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(p + ': ' + msg); });
    return w;
  };
  const js = (w, c) => w.webContents.executeJavaScript(c);
  const start = async (w) => {
    await w.loadURL('http://localhost:8781/');
    await js(w, `localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
    await wait(4500);
  };
  const said = [];
  ipcMain.on('presence', (e, info) => said.push(info));
  const A = mk('a199', path.join(__dirname, '..', 'desktop', 'preload.js')), B = mk('b199');
  await start(A);
  await start(B);
  const tag = Math.floor(Math.random() * 1e4), na = 'Ga' + tag, nb = 'Gb' + tag;
  await js(A, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${na}', pass: 'glasspass1' }))`);
  await js(B, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${nb}', pass: 'glasspass1' }))`);
  await wait(2500);

  // ---- Settings › Display ----
  await js(A, `${G}.meta.setTab = 'display'; ${G}.meta.openPanel('settings'); true`);
  await wait(500);
  const disp = await js(A, `(() => {
    const rows = [...document.querySelectorAll('[data-sec=display] .set-row')];
    const at = (id) => rows.findIndex((r) => r.querySelector('#' + id));
    const low = [...document.getElementById('setGfx').options].find((o) => o.value === 'low').textContent;
    return { glassAfter: at('setGlass') === at('setHudBox') + 1, glassText: document.getElementById('setGlass').closest('label').textContent.trim(), name: document.getElementById('setHudBox').closest('.set-row').querySelector('span').firstChild.textContent.trim(), low };
  })()`);
  check(disp.glassAfter && disp.glassText === 'Glass Look', `"Glass Look" (no explanation) sits right under the opacity slider (${JSON.stringify(disp)})`);
  check(disp.name === 'Background opacity', `the slider is called "Background opacity" (${disp.name})`);
  check(disp.low === 'Low (fast, for older laptops, phones)', `shorter Low graphics line: ${disp.low}`);
  const ico = await js(A, `['controls', 'touch'].map((t) => { const s = document.querySelector('[data-settab=' + t + '] svg'); return s && s.classList.contains('lt') && /url\\(#cwLt\\)/.test(s.querySelector('path').getAttribute('fill')); })`);
  check(ico.every(Boolean), 'Controls and Touch screen icons are white-gray (not blue)');
  // the categories keep the window's background in the glass look
  const tabsBg = await js(A, `(() => { const g = ${G}; g.settings.glass = true; g.applySettings(); const a = getComputedStyle(document.querySelector('.set-tabs')).backgroundColor; g.settings.glass = false; g.applySettings(); return a; })()`);
  check(tabsBg === 'rgba(0, 0, 0, 0)', `glass look: the Settings categories have no background of their own (${tabsBg})`);
  await js(A, `${G}.meta.closePanel(); true`);

  // ---- Background opacity: menu buttons and the small buttons in matches ----
  const look = async (glass, v) => { await js(A, `(() => { const g = ${G}, s = g.settings; s.glass = ${glass}; s.hudBox = ${v}; g.applySettings(); return true; })()`); await wait(400); return js(A, `(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const b = cs('#btnShop'), c = cs('#coinChip'), q = cs('#questsCard');
    return { shop: b.backgroundColor, shopImg: b.backgroundImage.slice(0, 60), blur: b.backdropFilter, coin: c.backgroundColor, quest: q.backgroundColor, k: getComputedStyle(document.documentElement).getPropertyValue('--bgK').trim() };
  })()`); };
  const n0 = await look(false, 0), nd = await look(false, null), n1 = await look(false, 1);
  check(n0.shop === 'rgba(14, 20, 42, 0)' && n0.coin === 'rgba(14, 20, 42, 0)' && n0.quest === 'rgba(14, 20, 42, 0)', `0%: the menu buttons have no background (${JSON.stringify(n0)})`);
  check(nd.shop === 'rgba(14, 20, 42, 0.55)' && nd.quest === 'rgba(14, 20, 42, 0.42)', `the default (50%) looks as before (${JSON.stringify(nd)})`);
  check(n1.shop === 'rgb(14, 20, 42)', `100%: solid (${n1.shop})`);
  const g0 = await look(true, 0), gd = await look(true, null);
  check(/rgba\(255, 255, 255, 0\)/.test(g0.shopImg) && /blur\(0px\)/.test(g0.blur), `Glass Look at 0%: no glass at all (${JSON.stringify(g0)})`);
  check(gd.k === '1.000' && /rgba\(255, 255, 255, 0\.24\)/.test(gd.shopImg) && /blur\(18px\)/.test(gd.blur), `Glass Look at its default (85%): the full glass (${JSON.stringify(gd)})`);
  await js(A, `${G}.playOffline('clash', 'canyon'); true`);
  await wait(4500);
  const hud = await js(A, `(() => { const g = ${G}, s = g.settings, out = {}; for (const v of [0, null]) { s.glass = false; s.hudBox = v; g.applySettings(); out[v === null ? 'def' : 'zero'] = { btn: getComputedStyle(document.getElementById('hudChat')).backgroundColor, status: getComputedStyle(document.getElementById('status')).backgroundColor }; } return out; })()`);
  check(hud.zero.btn === 'rgba(11, 15, 30, 0)' && hud.zero.status === 'rgba(10, 15, 34, 0)' && hud.def.btn === 'rgba(11, 15, 30, 0.42)', `in matches too: 0% = no background on the buttons and boxes (${JSON.stringify(hud)})`);
  await js(A, `${G}.showMenu(); true`);
  await wait(800);

  // ---- Discord: Settings › Online (A has the desktop app's bridge) ----
  await js(A, `${G}.meta.setTab = 'online'; ${G}.meta.openPanel('settings'); true`);
  await wait(400);
  const dc = await js(A, `(() => { const c = document.getElementById('setDiscord'); const was = c.checked; c.click(); return { was, now: ${G}.settings.discord }; })()`);
  await wait(3800);
  check(dc.was === true && dc.now === false && said.length && said[said.length - 1].hidden === true, `Discord activity: on by default, off hides it (${JSON.stringify(said[said.length - 1])})`);
  await js(A, `document.getElementById('setDiscord').click(); true`);
  await wait(3800);
  check(said[said.length - 1].hidden === false && !!said[said.length - 1].details, `…on again shows it (${JSON.stringify(said[said.length - 1])})`);
  await js(A, `${G}.meta.closePanel(); true`);

  // ---- club chat read on one device stays read on another ----
  await js(B, `${G}.net.send({ t: 'clubCreate', name: 'Read Club ${tag}', badge: 2, open: true }); true`);
  await wait(1200);
  const id = await js(B, `${G}.account.club.id`);
  await js(A, `${G}.net.send({ t: 'clubJoin', id: '${id}' }); true`);
  await wait(1200);
  await js(A, `${G}.net.send({ t: 'clubSay', x: 'did you see this?' }); true`);
  await wait(1200);
  check(await js(B, `${G}.talk.unreadIn('club') >= 1`), 'a new club message is unread');
  await js(B, `${G}.talk.open('club'); true`);
  await wait(600);
  await js(B, `${G}.talk.close(); true`);
  await wait(600);
  const B2 = mk('b2_199'); // the same player on another device (or the website vs the app)
  await start(B2);
  await js(B2, `${G}.net.connect().then(() => ${G}.net.send({ t: 'acctLogin', name: '${nb}', pass: 'glasspass1' }))`);
  await wait(5000);
  const other = await js(B2, `({ in: ${G}.account.loggedIn, club: !!${G}.account.club, unread: ${G}.talk.unreadIn('club'), badge: document.getElementById('badgeChat').classList.contains('hidden') })`);
  check(other.in && other.club && other.unread === 0 && other.badge, `logging in on another device: the message you read isn't new there (${JSON.stringify(other)})`);

  check(errors.length === 0, `no errors on the page${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all v1.9.9 checks passed');
  app.exit(failed ? 1 : 0);
});
