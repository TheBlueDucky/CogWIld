// Store screenshots + the link-preview image, rendered from the real game (offscreen, nothing is shown).
//   cd desktop && node copy-game.js && npx electron shots.js
// Writes ../dist/store/screenshots/*.png (1920x1080), ../img/og-image.png (1200x630) and the Microsoft Store art in
// ../dist/store/listing/ (hero 1920x1080, box art 1080x1080, poster 720x1080, logo 300x300).
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'dist', 'store', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  win.setContentSize(1920, 1080);
  win.webContents.setAudioMuted(true); // screenshots only, no sound
  win.webContents.setFrameRate(30);
  require('../tests/no-voice-ask')(win); // answer "Use voice chat?" with "Keep it off", so it isn't in the pictures
  // a fresh player who already did the tutorial (no pop-ups), graphics on high for the pictures
  await win.loadFile(path.join(__dirname, 'app', 'index.html'));
  await win.webContents.executeJavaScript(`localStorage.setItem('cogwild.current', JSON.stringify(CW.cloneBp(CW.PRESETS.find((p) => p.id === 'monster')))); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 1240, coins: 1850, settings: { tutorialDone: true, graphics: 'high', music: false, arena: 'canyon', timeOfDay: 'day' } })); location.reload();`);
  await wait(5000);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('saved', name, img.getSize());
    return img;
  };

  await shot('1-lobby');
  // link preview: just the logo and the mech on display (no buttons), 1200x630
  await js(`document.querySelectorAll('.lobby-top, .lobby-side, .lobby-bottom, #menu .version').forEach((e) => (e.style.visibility = 'hidden'))`);
  await wait(500);
  const clean = await win.webContents.capturePage();
  const s = clean.getSize();
  const h = Math.round((s.width * 630) / 1200);
  const og = clean.crop({ x: 0, y: Math.round(s.height * 0.02), width: s.width, height: h }).resize({ width: 1200, height: 630 });
  fs.writeFileSync(path.join(__dirname, '..', 'img', 'og-image.png'), og.toPNG());
  console.log('saved og-image', og.getSize());
  // Microsoft Store art from the same clean shot: the logo on top, the mech in the middle
  const ART = path.join(__dirname, '..', 'dist', 'store', 'listing');
  fs.mkdirSync(ART, { recursive: true });
  const art = (name, w, h) => {
    const cw = Math.min(s.width, Math.round((s.height * w) / h)), ch = Math.round((cw * h) / w);
    const img = clean.crop({ x: Math.round((s.width - cw) / 2), y: 0, width: cw, height: Math.min(s.height, ch) }).resize({ width: w, height: h, quality: 'best' });
    fs.writeFileSync(path.join(ART, name + '.png'), img.toPNG());
    console.log('saved', name, img.getSize());
  };
  art('hero-1920x1080', 1920, 1080);
  art('box-art-1080x1080', 1080, 1080);
  art('poster-720x1080', 720, 1080);
  const logo = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 300, height: 300, quality: 'best' });
  fs.writeFileSync(path.join(ART, 'store-logo-300x300.png'), logo.toPNG());
  console.log('saved store-logo', logo.getSize());
  await js(`document.querySelectorAll('.lobby-top, .lobby-side, .lobby-bottom, #menu .version').forEach((e) => (e.style.visibility = ''))`);

  await js(`(() => { const g = window.game || CW.game; g.modeId = 'clash'; g.formatId = 'ffa'; g.startMatch(CW.cloneBp(CW.PRESETS.find((p) => p.id === 'monster') || CW.PRESETS[0])); })()`);
  // let the bots close in, then drive and fire into the fight
  await js(`(() => { const g = window.game || CW.game; g.settings.camMode = 'third'; })()`);
  await wait(16000);
  await js(`(() => { const g = window.game || CW.game; g.keys.KeyW = true; g.mouse.left = true; })()`);
  await wait(3000);
  await shot('2-battle');
  await js(`(() => { const g = window.game || CW.game; g.settings.camMode = 'first'; })()`);
  await wait(2500);
  await shot('3-battle-first-person');
  await js(`(() => { const g = window.game || CW.game; g.keys.KeyW = false; g.mouse.left = false; })()`);

  await js(`(() => { const g = window.game || CW.game; g.showMenu(); g.openWorkshop(); })()`);
  await wait(3000);
  await shot('4-workshop');

  await js(`(() => { const g = window.game || CW.game; g.showMenu(); g.modeId = 'clash'; g.formatId = 'ffa'; g.world.applyTime && null; g.showModes(); })()`);
  await wait(2000);
  await shot('5-modes');

  await js(`(() => { const g = window.game || CW.game; g.showMenu(); g.meta.openPanel('road'); })()`);
  await wait(1500);
  await shot('6-trophy-road');

  await js(`(() => { const g = window.game || CW.game; g.meta.closePanel(); g.meta.openPanel('shop'); })()`);
  await wait(1200);
  await js(`(() => { const h = [...document.querySelectorAll('#panelBody h3')].find((x) => /finishes/.test(x.textContent)); if (h) h.scrollIntoView(); })()`);
  await wait(600);
  await shot('7-shop');

  // flying over the canyon in the Hornet
  await js(`(() => { const g = window.game || CW.game; g.meta.closePanel(); g.modeId = 'clash'; g.formatId = 'ffa'; g.settings.camMode = 'third'; g.startMatch(CW.cloneBp(CW.PRESETS.find((p) => p.id === 'hornet'))); })()`);
  await wait(5000);
  await js(`(() => { const g = window.game || CW.game; g.keys.Space = true; g.keys.KeyW = true; })()`);
  await wait(2500);
  await js(`(() => { const g = window.game || CW.game; g.keys.Space = false; g.cam.pitch = -0.25; })()`);
  await wait(1500);
  await shot('8-flying');
  await js(`(() => { const g = window.game || CW.game; g.keys.KeyW = false; g.showMenu(); })()`);
  app.exit(0);
});
