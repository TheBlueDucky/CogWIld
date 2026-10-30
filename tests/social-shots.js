// Muted screenshots of the social screens with made-up data (hidden window, local test server on 8781): friends list,
// a club, a friend's profile, your own profile, the docked chat in the glass look. Saves tests/shots/social-<tag>-*.png.
// Usage: npx electron social-shots.js [tag]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.argv.find((a) => /^[a-z0-9]+$/.test(a) && a !== 'social-shots.js') || 'now';
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 'soc' + Date.now() } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, ms = 400) => { await wait(ms); fs.writeFileSync(path.join(shots, `social-${TAG}-${n}.png`), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', glass: true } })); location.reload(); true`);
  await wait(4500);
  // made-up account data (nothing is sent: only drawn)
  await js(`(() => { const g = ${G}, a = g.account;
    a.me = { name: 'BlueDucky', tro: 812, best: 900, lv: 23, av: 2, club: 'Gear Heads', rp: 140, created: Date.now() - 86400000 * 200 };
    a.friends = [{ name: 'RoboRita', on: true, tro: 640, av: 1, st: 'menu' }, { name: 'Sparky_7', on: true, tro: 1210, av: 4, room: null }, { name: 'MechMax', on: false, tro: 300, av: 6 }];
    a.reqIn = []; a.reqOut = [];
    a.club = { id: 'c1', name: 'Gear Heads', desc: 'We build big and win bigger', tro: 9400, members: 3, open: true, minTro: 0, badge: 1,
      list: [{ name: 'BlueDucky', role: 'owner', tro: 812, on: true, av: 2 }, { name: 'RoboRita', role: 'member', tro: 640, on: true, av: 1 }, { name: 'MechMax', role: 'member', tro: 300, on: false, seen: Date.now() - 3600000 * 5, av: 6 }] };
    a.viewing = { name: 'RoboRita', online: true, rank: 3, tro: 640, best: 700, lv: 18, wins: 120, played: 260, rp: 90, club: 'Gear Heads', clubFace: { badge: 1 }, created: Date.now() - 86400000 * 400, av: 1 };
    return true; })()`);
  await js(`${G}.meta.openPanel('friends'); true`);
  await shot('friends', 800);
  await js(`${G}.meta.openPanel('clubs'); true`);
  await shot('club', 800);
  await js(`${G}.account.backTo = 'friends'; ${G}.meta.openPanel('player'); true`);
  await shot('player', 800);
  await js(`${G}.meta.openPanel('profile'); true`);
  await shot('profile', 800);
  await js(`${G}.meta.closePanel(); ${G}.showMenu(); ${G}.talk.open('friends'); true`);
  await shot('chat', 1000);
  // v1.10.3: the friend menu on a friend's profile, a picture change waiting for Save, muted/deafened icons, Settings,
  // a theme, the menu opening animation half way
  await js(`${G}.talk.close(); ${G}.meta.openPanel('player'); document.getElementById('ppFriends') && document.getElementById('ppFriends').click(); true`);
  await shot('player-menu', 600);
  await js(`${G}.meta.closePanel(); ${G}.account.pfDraft = { av: 5 }; ${G}.account.pfMenu = true; ${G}.meta.openPanel('profile'); true`);
  await shot('profile-draft', 600);
  await js(`${G}.meta.closePanel(); const s = ${G}.settings; s.voice = true; s.vcMuted = true; s.vcDeafened = true; ${G}.voice.render(); true`);
  await shot('voice', 500);
  await js(`(() => { const g = ${G}, s = g.settings; s.voice = false; g.voice.render(); s.keys = { forward: 'KeyI' }; g.meta.setTab = 'keys'; g.meta.openPanel('settings'); return true; })()`);
  await shot('keys', 600);
  await js(`(() => { const g = ${G}; g.account.hasPass = true; g.meta.setTab = 'account'; g.meta.openPanel('settings'); document.querySelector('[data-acform="profPassForm"]').click(); return true; })()`);
  await shot('password', 600);
  await js(`(() => { const g = ${G}; g.meta.setTab = 'display'; g.meta.openPanel('settings'); return true; })()`);
  await shot('display', 600);
  for (const th of ['midnight', 'graphite', 'ocean', 'dusk']) {
    await js(`(() => { const g = ${G}; g.settings.theme = '${th}'; g.meta.apply(); g.meta.openPanel('friends'); return true; })()`);
    await shot('theme-' + th, 500);
  }
  await js(`(() => { const g = ${G}; g.settings.theme = ''; g.meta.apply(); g.meta.closePanel(); g.meta.openPanel('replays'); return true; })()`);
  await shot('replays', 800);
  await js(`(() => { const g = ${G}; g.meta.closePanel(); const m = document.getElementById('menu'); m.classList.add('hidden'); void m.offsetWidth; m.classList.remove('hidden'); return true; })()`);
  await shot('menu-open', 110);
  app.exit(0);
});
