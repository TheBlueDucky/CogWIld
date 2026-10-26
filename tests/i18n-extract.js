// Collects the game's visible English text for the translations (js/i18n.js): opens every screen in a hidden, muted
// window and writes tests/shots/i18n-strings.json (each text with how often it was seen). Numbers are written as {n}.
// Needs the local test server on 8781.   desktop/node_modules/.bin/electron tests/i18n-extract.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  require('./no-voice-ask')(win);
  const js = (c) => win.webContents.executeJavaScript(c);
  await win.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 2000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0 } })); location.reload();`);
  await wait(4500);
  await js(`window.confirm = () => false; window.__seen = new Map();
    window.__grab = (all) => {
      const add = (t) => { t = (t || '').replace(/\\s+/g, ' ').trim(); if (!t || !/[A-Za-z]{2}/.test(t) || t.length > 400) return; t = t.replace(/\\d+([.,]\\d+)?/g, '{n}'); __seen.set(t, (__seen.get(t) || 0) + 1); };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) { const el = n.parentElement; if (!el || el.closest('script,style,[translate=no]')) continue; if (!all && !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; add(n.data); }
      document.querySelectorAll('[aria-label],[placeholder]').forEach((el) => { add(el.getAttribute('aria-label')); add(el.getAttribute('placeholder')); });
    }; __grab(true); true`);
  const panels = ['shop', 'challenges', 'ach', 'replays', 'howto', 'top', 'road', 'news', 'gallery', 'event', 'pass', 'arenas', 'profile', 'friends', 'clubs', 'ranks', 'stats', 'cup'];
  console.log('start');
  for (const p of panels) { console.log(p); await js(`${G}.meta.openPanel('${p}'); true`); await wait(700); await js(`__grab(); ${G}.meta.closePanel(); true`); }
  // settings: every section is in the page (only one shows at a time)
  await js(`${G}.meta.openPanel('settings'); true`);
  await wait(500);
  await js(`__grab(true); true`);
  await js(`${G}.meta.closePanel(); true`);
  // workshop, a match, the pause menu, results
  await js(`${G}.openWorkshop(); true`); await wait(1200); await js(`__grab(); true`);
  await js(`${G}.showMenu(); ${G}.playOffline('koth', 'canyon', null); true`); await wait(1500);
  await js(`(async () => { const g = ${G}; for (let i = 0; i < 200; i++) { g.tick(1 / 30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return true; })()`);
  await js(`__grab(); ${G}.pause(); true`); await wait(400); await js(`__grab(); ${G}.resume(); true`);
  await js(`(async () => { const g = ${G}; g.headless = true; for (let k = 0; k < 1500 && g.state === 'match'; k++) { g.tick(1 / 30); if (k % 60 === 0) await new Promise((r) => setTimeout(r, 0)); } g.headless = false; return g.state; })()`);
  await wait(800);
  await js(`__grab(); true`);
  await js(`${G}.showMenu(); ${G}.showModes && ${G}.showModes(); true`); await wait(500); await js(`__grab(); true`);
  await js(`${G}.showMenu(); ${G}.account.openLogin('Log in'); true`); await wait(500); await js(`__grab(); true`);
  const list = await js(`[...__seen.entries()].sort((a, b) => b[1] - a[1])`);
  fs.writeFileSync(path.join(__dirname, 'shots', 'i18n-strings.json'), JSON.stringify(list, null, 1));
  console.log('strings:', list.length);
  app.exit(0);
});
