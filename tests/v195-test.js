// Muted check of the v1.9.5 changes (hidden window, local test server on 8781): default profile pictures instead of
// emoji avatars (none in the Shop), the profile screen (pictures, your own picture is never removed by a click, stats
// 5 × 3), the account rows in Settings › Account, another player's profile, the club screen without a chat preview,
// and the smaller match status panel.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'v195' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2 && !/favicon|net::/.test(msg)) errors.push(msg); });
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`);
  await wait(4500);
  const name = 'Prof' + Math.floor(Math.random() * 100000);
  await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: '${name}', pass: 'profpass1' }))`);
  await wait(2500);
  await js(`${G}.net.send({ t: 'clubCreate', name: 'Prof Club ' + '${name}'.slice(4), badge: 2, desc: 'Testing' }); true`);
  await wait(1200);

  // default pictures
  const pics = await js(`({ n: CW.AVATARS.length, svg: CW.AVATARS.every((a) => /<svg/.test(a)), wrap: CW.avatar(30) === CW.AVATARS[30 % 8], chip: !!document.querySelector('#acctChip .dpic') })`);
  check(pics.n === 8 && pics.svg && pics.wrap && pics.chip, 'the 8 default pictures replace the emoji avatars (old numbers wrap onto them; the lobby chip shows one)');
  await js(`${G}.meta.openPanel('shop'); true`);
  await wait(600);
  check(await js(`!/Avatars/.test(document.getElementById('panelBody').textContent) && !document.querySelector('#panelBody .swatch.av')`), 'the Shop sells no avatars');

  // the profile
  await js(`${G}.meta.openPanel('profile'); true`);
  await wait(700);
  const pf = await js(`({ picks: document.querySelectorAll('.pf-pick[data-av]').length, own: !!document.getElementById('pfOwn'), stats: document.querySelectorAll('.pf-stats > div').length, cols: getComputedStyle(document.querySelector('.pf-stats')).gridTemplateColumns.split(' ').length, acctBtns: !!document.getElementById('profOut'), hero: !!document.querySelector('.pf-hero .pf-name') })`);
  check(pf.picks === 8 && pf.own && pf.hero, 'the profile: a banner, the 8 pictures and a ＋ for your own');
  check(pf.stats === 15 && pf.cols === 5, `stats: 15 tiles in 5 columns (${pf.stats}, ${pf.cols})`);
  check(!pf.acctBtns, 'no account buttons on the profile (they moved to Settings › Account)');
  // pick another default picture
  await js(`document.querySelector('.pf-pick[data-av="3"]').click(); true`);
  await wait(800);
  check(await js(`${G}.account.me.av === 3 && document.querySelector('.pf-pick[data-av="3"]').classList.contains('on')`), 'clicking a default picture uses it');
  // with your own picture: clicking it never removes it; a default asks first
  const own = await js(`(async () => {
    const a = ${G}.account, sent = [], o = a.net.send.bind(a.net);
    a.net.send = (m) => { sent.push(m.t + (m.t === 'picSet' ? ':' + (m.data === null ? 'remove' : 'set') : '')); };
    a.me.pv = 1; ${G}.meta.renderPanel();
    let picked = 0; const op = CW.pickPicture; CW.pickPicture = () => { picked++; };
    document.getElementById('pfOwn').click();
    const afterOwn = sent.slice();
    document.querySelector('.pf-pick[data-av="5"]').click();
    const asked = !document.getElementById('confirm').classList.contains('hidden') && /Use this picture/.test(document.getElementById('confirmTitle').textContent);
    const beforeYes = sent.slice();
    document.getElementById('confirmOk').click();
    CW.pickPicture = op; a.net.send = o; a.me.pv = 0;
    return { afterOwn, picked, asked, beforeYes, after: sent };
  })()`);
  check(own.afterOwn.length === 0 && own.picked === 0, 'clicking your own picture does nothing (it used to remove it)');
  check(own.asked && own.beforeYes.length === 0 && own.after.includes('picSet:remove') && own.after.includes('profileSet'), 'a default picture over your own one asks first, then switches');

  // Settings › Account
  await js(`document.getElementById('pfAccount') ? null : ${G}.meta.renderPanel(); document.getElementById('pfAccount').click(); true`);
  await wait(700);
  const st = await js(`({ tab: (document.querySelector('.set-tab.on') || {}).dataset ? document.querySelector('.set-tab.on').dataset.settab : '', rows: document.querySelectorAll('#setAcctBox .set-row').length, out: !!document.querySelector('#setAcctBox #profOut.set-btn'), del: !!document.querySelector('#setAcctBox .set-btn.bad') })`);
  check(st.tab === 'account' && st.rows >= 4 && st.out && st.del, `Account settings open on Settings › Account with the account rows (${st.rows})`);
  await js(`document.querySelector('[data-acform="profRenameForm"]').click(); true`);
  check(await js(`!document.getElementById('profRenameForm').classList.contains('hidden')`), 'Change username opens its small form');

  // someone else's profile
  await js(`${G}.account.showPlayer('${name}', 'friends'); true`);
  await wait(1200);
  const pp = await js(`({ cards: document.querySelectorAll('.pp-card').length, club: /Prof Club/.test((document.querySelector('.pp-club') || {}).textContent || ''), online: !!document.querySelector('.pf-online.on'), ring: !!document.querySelector('.pp-hero .pf-pic.on') })`);
  check(pp.cards === 4 && pp.club && pp.online && pp.ring, 'a player\'s profile: banner with online ring, 4 big number cards, their club');

  // the club: no chat preview, the chat button blends in
  await js(`${G}.meta.openPanel('clubs'); true`);
  await wait(900);
  const cl = await js(`({ preview: !!document.getElementById('clubChat'), soft: !!document.querySelector('#clChat.pill.soft') })`);
  check(!cl.preview && cl.soft, 'the club screen has no chat preview; Club chat is a calm gray-blue button');
  await js(`document.getElementById('clChat').click(); true`);
  await wait(400);
  check(await js(`${G}.talk.isOpen && ${G}.talk.tab === 'club'`), 'Club chat opens the club chat');
  await js(`${G}.talk.close(); ${G}.meta.closePanel(); true`);

  // the match status panel
  await js(`${G}.playOffline('clash', 'canyon'); true`);
  await wait(5000);
  const hud = await js(`(() => { const s = document.getElementById('status'), r = s.getBoundingClientRect(), cs = getComputedStyle(s); return { w: Math.round(r.width / ${G}.uiZoom), bg: cs.backgroundColor }; })()`);
  const alpha = +((hud.bg.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1] || 1);
  check(hud.w <= 280 && alpha <= 0.25, `the status panel is smaller and more see-through (${hud.w} px, background ${hud.bg})`);
  await js(`${G}.showMenu(); true`);

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
