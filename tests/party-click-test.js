// Muted check that the lobby's side buttons (Replays, Help, Gallery, News…) can still be clicked while you're in a
// party (the party card made the bottom of the lobby taller and it covered them). Hidden window, local server on 8781.
// SIZES=1280x720,1600x900,915x412
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';
const SIZES = (process.env.SIZES || '1280x720,1600x900,915x412').split(',').map((s) => s.split('x').map(Number));

app.whenReady().then(async () => {
  const wins = SIZES.map(([w, h]) => new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, partition: 'pc' + w + Date.now() } }));
  for (let i = 0; i < SIZES.length; i++) {
    const [w, h] = SIZES[i], win = wins[i];
    win.webContents.setAudioMuted(true);
    require('./no-voice-ask')(win);
    const js = (c) => win.webContents.executeJavaScript(c);
    await win.loadURL('http://localhost:8781/');
    await js(`localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: '${w < 1000 ? 'on' : 'off'}' } })); location.reload(); true`);
    await wait(4500);
    // a party of 4 with chat lines (the tallest party card)
    await js(`(() => { const a = ${G}.account; a.me = a.me || { name: 'Me', av: 1, tro: 0 }; a.party = { leader: 'Me', members: [{ name: 'Me', av: 1, on: true }, { name: 'Ann', av: 2, on: true }, { name: 'Ben', av: 3, on: true }, { name: 'Cat', av: 4, on: true }], log: [{ f: 'Ann', t: 'hi' }, { f: 'Ben', t: 'ready?' }, { f: 'Cat', t: 'go' }] }; a.renderParty(); return true; })()`);
    await wait(600);
    const res = await js(`(() => {
      document.getElementById('firstRun').classList.add('hidden');
      const z = parseFloat(getComputedStyle(document.getElementById('menu')).zoom) || 1; // the menu is CSS-zoomed
      const out = {};
      for (const id of ['btnReplays', 'btnHowto', 'btnGallery', 'btnNews', 'btnShop', 'btnFriends', 'btnPass', 'partyBar']) {
        const el = document.getElementById(id);
        if (!el || el.offsetParent === null) { out[id] = 'hidden'; continue; }
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint((r.left + r.width / 2) * z, (r.top + r.height / 2) * z);
        out[id] = el.contains(hit) ? 'ok' : (hit ? (hit.id || hit.className || hit.tagName) : 'none');
      }
      // the party card must not lie over any side button
      const pr = document.getElementById('partyBar').getBoundingClientRect();
      for (const b of document.querySelectorAll('.lobby-side .side-btn')) {
        if (b.offsetParent === null) continue;
        const r = b.getBoundingClientRect();
        if (r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top) out['overlap ' + b.id] = 'party card';
      }
      return out;
    })()`);
    const bad = Object.entries(res).filter(([, v]) => v !== 'ok' && v !== 'hidden');
    check(!bad.length, `${w}x${h}: in a party every lobby button can be clicked ${bad.length ? JSON.stringify(bad) : ''}`);
    fs.writeFileSync(path.join(__dirname, 'shots', `party-click-${w}.png`), (await win.webContents.capturePage()).toPNG());
  }
  console.log(failed ? `${failed} FAILED` : 'all passed');
  app.exit(failed ? 1 : 0);
});
