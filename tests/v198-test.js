// Muted check of v1.9.8 (hidden windows, local test server on 8781): Settings order and names, buttons as tall as the
// drop-downs, the frame rate limit (30 FPS really is ~30), the box behind the health bar (50%, more with the glass look,
// Reset), the glass look, the hidden email, ringtone previews (each one, stop, never left playing), the call card
// (drag, ⟲, a new call starts at the top), replay buttons, and in a desktop-app window (desktop/preload.js +
// desktop/files.js in a temp folder): clips and replays saved as files, the VSync switch for the next start.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
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
  const win = mk('t198');
  const js = (c, w = win) => w.webContents.executeJavaScript(c);
  const start = async (w) => {
    await w.loadURL('http://localhost:8781/');
    await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 4000, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off' } })); location.reload(); true`, w);
    await wait(4500);
  };
  await start(win);
  await js(`${G}.net.connect().then(() => ${G}.net.send({ t: 'acctRegister', name: 'Tv' + Math.floor(Math.random() * 1e4), pass: 'testpass1' }))`);
  await wait(2500);

  // ---- Settings: order, names, sizes ----
  await js(`${G}.meta.setTab = 'display'; ${G}.meta.openPanel('settings'); true`);
  await wait(600);
  const order = await js(`[...document.querySelectorAll('[data-settab]')].map((b) => b.dataset.settab).join(',')`);
  check(order === 'account,display,keys,controls,touch,voice,sound,chat,online,support,help,save,news', `Settings order: ${order}`);
  const keysTitle = await js(`document.querySelector('[data-sec=keys] h3').textContent`);
  check(/Keybinds/.test(keysTitle) && !/Keys\b/.test(keysTitle.replace('Reset keys', '')), `the Keybinds page is called Keybinds (${keysTitle.trim()})`);
  const icons = await js(`['controls', 'touch'].map((t) => !!document.querySelector('[data-settab=' + t + '] svg.cw-ico')).concat(!!document.querySelector('[data-sec=voice] h3 svg.cw-ico'))`);
  check(icons.every(Boolean), 'blue icons: Controls, Touch screen, Calls');
  const hs = await js(`(() => { const h = (id) => document.getElementById(id).getBoundingClientRect().height; return { full: h('setFull'), lang: h('setLang'), gfx: h('setGfx') }; })()`);
  check(Math.abs(hs.full - hs.lang) < 1 && Math.abs(hs.gfx - hs.lang) < 1, `Toggle fullscreen is as tall as the language menu (${JSON.stringify(hs)})`);
  // (a hidden window never has the keyboard, so :focus can't be pointed at: read the rule that wins instead)
  const focus = await js(`(() => { let last = null; for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText && /(^|, )select:focus/.test(r.selectorText) && r.style.borderColor) { if (r.style.getPropertyPriority('border-color') === 'important' || !last || last.p !== 'important') last = { v: r.style.borderColor, p: r.style.getPropertyPriority('border-color') }; } return last; })()`);
  check(focus && focus.v === 'var(--muted2)' && focus.p === 'important', `an open drop-down has the gray-blue line (${JSON.stringify(focus)})`);

  // ---- the box behind the health bar, and the glass look ----
  const box = await js(`(() => {
    const g = ${G}, s = g.settings, v = () => getComputedStyle(document.documentElement).getPropertyValue('--hudBg').trim();
    const out = { start: v(), label: document.getElementById('setHudBoxV').textContent };
    document.getElementById('setGlass').click();
    out.glassCls = document.documentElement.classList.contains('glass');
    out.glass = v(); out.glassLabel = document.getElementById('setHudBoxV').textContent;
    const r = document.getElementById('setHudBox'); r.value = 0.3; r.dispatchEvent(new Event('input'));
    out.moved = v(); out.resetOn = !document.getElementById('setHudBoxReset').disabled;
    document.getElementById('setHudBoxReset').click();
    out.reset = v(); out.saved = s.hudBox;
    document.getElementById('setGlass').click();
    out.off = v(); out.offCls = document.documentElement.classList.contains('glass');
    return out;
  })()`);
  check(box.start === '0.5' && box.label === '50%', `the box behind the health bar starts at 50% (${box.start}, ${box.label})`);
  check(box.glassCls && box.glass === '0.85' && box.glassLabel === '85%', `the glass look: on, and its box default is 85% (${box.glass})`);
  check(box.moved === '0.3' && box.resetOn && box.reset === '0.85' && box.saved === null, `moving the slider, then Reset goes back to the default (${JSON.stringify(box)})`);
  check(!box.offCls && box.off === '0.5', 'glass off again: back to 50%');

  // ---- frame rate limit ----
  const fps = async (cap) => {
    await js(`(() => { const sel = document.getElementById('setFpsCap'); sel.value = '${cap}'; sel.dispatchEvent(new Event('change')); return true; })()`);
    await wait(500);
    return js(`new Promise((res) => { let n = 0; const g = ${G}; const was = g.tick; g.tick = function (dt) { n++; return was.call(this, dt); }; setTimeout(() => { g.tick = was; res(n / 2); }, 2000); })`);
  };
  const f30 = await fps(30), fv = await fps('vsync');
  check(f30 > 24 && f30 < 34, `30 FPS limit: ${f30} frames a second`);
  check(fv > f30 + 10, `VSync: ${fv} frames a second`);
  check(await js(`${G}.settings.fpsCap === null && ${G}.frameMs === 0`), 'VSync = no limit of our own');

  // ---- the email is hidden ----
  check(await js(`CW.hideEmail('tomertest@gmail.com') === 't*******t@gmail.com' && CW.hideEmail('ab@x.com') === 'a***@x.com'`), `emails show as ${await js(`CW.hideEmail('tomertest@gmail.com')`)}`);
  const acct = await js(`(() => { const a = ${G}.account; a.myEmail = 'tomertest@gmail.com'; a.loginOpts = Object.assign({}, a.loginOpts, { email: true }); ${G}.meta.setTab = 'account'; ${G}.meta.renderPanel(); return document.getElementById('setAcctBox').innerHTML; })()`);
  check(!acct.includes('tomertest') && acct.includes('t*******t@gmail.com'), 'Settings › Account never shows the whole email');

  // ---- ringtones: listen to each one, it stops by itself, ▶ again stops it ----
  await js(`${G}.meta.setTab = 'voice'; ${G}.meta.renderPanel(); true`);
  await wait(300);
  const dev = await js(`(() => { const m = document.getElementById('setVcMic'), o = document.getElementById('setVcOut'); m.insertAdjacentHTML('beforeend', '<option value="x">Microphone Array (Realtek(R) Audio) with a very long name indeed</option>'); m.value = 'x'; const a = m.getBoundingClientRect(), b = o.getBoundingClientRect(); return { mic: [Math.round(a.left), Math.round(a.width)], out: [Math.round(b.left), Math.round(b.width)] }; })()`);
  check(dev.mic[0] === dev.out[0] && dev.mic[1] === dev.out[1], `microphone and speakers menus line up, even with a long name (${JSON.stringify(dev)})`);
  const r1 = await js(`(() => { document.querySelector('[data-ringplay=marimba]').click(); const c = ${G}.calls; return { id: c.previewId, btn: document.querySelector('[data-ringplay=marimba]').textContent, nodes: (c.previewNodes || []).length, ring: c.ring && c.ringing }; })()`);
  check(r1.id === 'marimba' && r1.btn === '■' && r1.nodes > 0 && !r1.ring, `▶ Marimba plays it (and turns into ■) without using it (${JSON.stringify(r1)})`);
  const r2 = await js(`(() => { document.querySelector('[data-ringplay=marimba]').click(); const c = ${G}.calls; return { id: c.previewId, btn: document.querySelector('[data-ringplay=marimba]').textContent, ring: ${G}.settings.ring || 'chime' }; })()`);
  check(r2.id === null && r2.btn === '▶' && r2.ring === 'chime', `■ stops it at once; the ringtone you use didn't change (${JSON.stringify(r2)})`);
  await js(`document.querySelector('[data-ringplay=digital]').click(); true`);
  await wait(4600); // Digital rings every 2 s, twice
  check(await js(`${G}.calls.previewId === null && !${G}.calls.previewNodes`), 'a preview stops by itself after two rings');
  const own = await js(`(() => { const c = ${G}.calls; c.preview('custom', true); return { id: c.previewId, toast: document.getElementById('toast').textContent }; })()`);
  check(own.id === null && /Choose a sound file first/.test(own.toast), `"Your own sound" with no file: plays nothing, says so (${JSON.stringify(own)})`);
  const use = await js(`(() => { document.querySelector('[data-ringuse=bells]').click(); const b = document.querySelector('[data-ringuse=bells]'); document.getElementById('setRingTry').click(); return { ring: ${G}.settings.ring, inUse: b.textContent, mine: ${G}.calls.previewId, listen: document.getElementById('setRingTry').textContent }; })()`);
  check(use.ring === 'bells' && /In use/.test(use.inUse) && use.mine === 'bells' && /Stop/.test(use.listen), `Use picks it; "▶ Listen" plays the one you use (${JSON.stringify(use)})`);
  const call = await js(`(() => { const c = ${G}.calls; c.ring('in'); const out = { preview: c.previewId, ringing: c.ringing }; c.stopRing(); return out; })()`);
  check(call.preview === null && call.ringing === 'in', 'a real call stops a preview');
  // your own sound file
  await js(`(() => { const c = new AudioContext(); const b = c.createBuffer(1, 8000, 8000); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 3) * 0.3; const wav = (() => { const n = d.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0))); w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, d[i] * 32767, true); return new Uint8Array(buf); })(); let s = ''; wav.forEach((x) => (s += String.fromCharCode(x))); localStorage.setItem('cogwild.ringtone', 'data:audio/wav;base64,' + btoa(s)); ${G}.settings.ring = 'custom'; ${G}.settings.ringName = 'beep.wav'; ${G}.meta.renderPanel(); return true; })()`);
  await wait(300);
  const o2 = await js(`(() => { document.getElementById('setRingTry').click(); const c = ${G}.calls; return { id: c.previewId, audio: !!c.previewAudio, now: document.querySelector('[data-sec=voice]').textContent.includes('beep.wav') }; })()`);
  check(o2.id === 'custom' && o2.audio && o2.now, `"▶ Listen" plays your own sound when that's your ringtone (${JSON.stringify(o2)})`);
  await wait(1600);
  check(await js(`${G}.calls.previewId === null && !${G}.calls.previewAudio`), 'your own sound stops when it ends (it never loops in a preview)');
  await js(`${G}.meta.closePanel(); true`);

  // ---- the call card: drag it, ⟲ puts it back, a new call starts at the top ----
  await js(`${G}.calls.onMessage({ t: 'call', state: 'live', name: 'Ann', av: 2 }); true`);
  await wait(300);
  const c0 = await js(`(() => { const r = document.getElementById('callCard').getBoundingClientRect(); const t = document.querySelector('#callCard .cc-txt').getBoundingClientRect(); return { x: r.left, y: r.top, gx: Math.round(t.left + 6), gy: Math.round(t.top + 6), border: getComputedStyle(document.getElementById('callCard')).borderTopColor }; })()`);
  check(c0.border === 'rgb(159, 179, 217)', `the call card has the gray-blue line (${c0.border})`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: c0.gx, y: c0.gy, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: c0.gx - i * 30, y: c0.gy + i * 25, button: 'left' }); await wait(30); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: c0.gx - 240, y: c0.gy + 200, button: 'left', clickCount: 1 });
  await wait(300);
  const c1 = await js(`(() => { const r = document.getElementById('callCard').getBoundingClientRect(); return { x: r.left, y: r.top, reset: !!document.getElementById('ccReset') }; })()`);
  check(Math.abs(c1.x - (c0.x - 240)) < 3 && Math.abs(c1.y - (c0.y + 200)) < 3 && c1.reset, `dragging moves it (${JSON.stringify(c0)} → ${JSON.stringify(c1)}) and shows ⟲`);
  const c2 = await js(`(() => { document.getElementById('ccReset').click(); const r = document.getElementById('callCard').getBoundingClientRect(); return { x: r.left, y: r.top, reset: !!document.getElementById('ccReset') }; })()`);
  check(Math.abs(c2.x - c0.x) < 2 && Math.abs(c2.y - c0.y) < 2 && !c2.reset, `⟲ puts it back at the top (${JSON.stringify(c2)})`);
  await js(`${G}.calls.pos = { x: 30, y: 400 }; ${G}.calls.onMessage({ t: 'call', state: 'end' }); ${G}.calls.onMessage({ t: 'call', state: 'in', name: 'Bob', av: 1 }); true`);
  const c3 = await js(`(() => { const r = document.getElementById('callCard').getBoundingClientRect(); const out = { y: r.top, pos: ${G}.calls.pos }; ${G}.calls.stopRing(); ${G}.calls.onMessage({ t: 'call', state: 'end' }); return out; })()`);
  check(c3.pos === null && Math.abs(c3.y - c0.y) < 2, `a new call starts at the top again (${JSON.stringify(c3)})`);

  // ---- replays (a browser): outline buttons, files go to Downloads, no folder button ----
  await js(`${G}.meta.openPanel('replays'); true`);
  await wait(900);
  const rp = await js(`(() => { const b = document.getElementById('rpOpenFile'); return { line: b && b.classList.contains('line'), bg: b && getComputedStyle(b).backgroundColor, folder: !!document.getElementById('rpFolder'), dev: CW.deviceFolders }; })()`);
  check(rp.line && rp.bg === 'rgba(0, 0, 0, 0)' && !rp.folder && !rp.dev, `Replays in a browser: "Open a replay file" has only a line, no folder button (${JSON.stringify(rp)})`);
  await js(`${G}.meta.closePanel(); true`);

  // ---- the desktop app: files and VSync ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw198-'));
  const opened = [], vs = [];
  require('../desktop/files')(ipcMain, () => tmp, (dir) => opened.push(dir));
  ipcMain.on('vsync', (e, on) => vs.push(on));
  ipcMain.on('restart', () => vs.push('restart'));
  const dwin = mk('d198', path.join(__dirname, '..', 'desktop', 'preload.js'));
  await start(dwin);
  const dv = await js(`(async () => {
    const out = { dev: CW.deviceFolders };
    out.clip = await CW.saveFile('clips', 'cogwild-clip-test.webm', new Blob([new Uint8Array([1, 2, 3])]));
    out.bad = await CW.saveFile('clips', '../evil.exe', new Blob(['x'])).then(() => 'saved', () => 'refused');
    out.badKind = await CW.saveFile('windows', 'a.webm', new Blob(['x'])).then(() => 'saved', () => 'refused');
    ${G}.meta.openPanel('replays');
    await new Promise((r) => setTimeout(r, 900));
    out.folderBtn = !!document.getElementById('rpFolder');
    if (out.folderBtn) document.getElementById('rpFolder').click();
    ${G}.meta.closePanel();
    ${G}.meta.setTab = 'display'; ${G}.meta.openPanel('settings');
    out.clipsBtn = !!document.getElementById('setClipsDir');
    return out;
  })()`, dwin);
  await wait(400);
  const clipFile = path.join(tmp, 'Clips', 'cogwild-clip-test.webm');
  check(dv.dev && fs.existsSync(clipFile) && fs.readFileSync(clipFile).length === 3 && dv.clip.where === clipFile, `the app saves a clip into its Clips folder (${dv.clip.where})`);
  check(dv.bad === 'refused' && dv.badKind === 'refused', `…and refuses other files or folders (${dv.bad}, ${dv.badKind})`);
  check(dv.folderBtn && dv.clipsBtn && opened.length === 1 && opened[0] === path.join(tmp, 'Replays'), `📂 buttons: Replays folder (opened ${opened.join(', ')}), Clips folder in Settings`);
  // a finished match's replay goes into the Replays folder by itself
  await js(`(async () => { const g = ${G}; g.playOffline('clash', 'canyon'); await new Promise((r) => setTimeout(r, 3000)); const rec = g.replays.recorder; if (rec.rec) { const f = rec.rec.frames; while (f.length < 200) f.push(f[f.length - 1] || [0]); } await rec.finish('Test'); g.showMenu(); return true; })()`, dwin);
  await wait(1500);
  const rfiles = fs.existsSync(path.join(tmp, 'Replays')) ? fs.readdirSync(path.join(tmp, 'Replays')) : [];
  check(rfiles.some((f) => /^cogwild-clash-canyon-.*\.cwreplay$/.test(f)), `every match's replay is saved as a file too (${rfiles.join(', ')})`);
  // VSync: the app hears the choice at the start; switching asks, then restarts
  const v0 = vs.slice();
  await js(`${G}.meta.setTab = 'display'; ${G}.meta.openPanel('settings'); true`, dwin);
  await wait(400);
  await js(`(() => { const sel = document.getElementById('setFpsCap'); sel.value = '144'; sel.dispatchEvent(new Event('change')); return true; })()`, dwin);
  await wait(300);
  const asked = await js(`({ open: !document.getElementById('confirm').classList.contains('hidden'), title: document.getElementById('confirmTitle').textContent, sel: document.getElementById('setFpsCap').value, cap: ${G}.settings.fpsCap || null })`, dwin);
  await js(`document.getElementById('confirmOk').click(); true`, dwin);
  await wait(300);
  const after = await js(`({ cap: ${G}.settings.fpsCap, ms: ${G}.frameMs })`, dwin);
  check(v0.length && v0.every((x) => x === true), `the app hears "VSync on" when the game starts (${v0.join(',')})`);
  check(asked.open && /VSync off/.test(asked.title) && asked.sel === 'vsync' && asked.cap === null, `144 FPS in the app asks first: "${asked.title}" (nothing changed yet)`);
  check(after.cap === 144 && Math.abs(after.ms - 1000 / 144) < 0.01 && vs.includes(false) && vs[vs.length - 1] === 'restart', `…Restart: 144 FPS saved, VSync off for the next start, restart (${vs.join(',')})`);
  fs.rmSync(tmp, { recursive: true, force: true });

  check(errors.length === 0, `no errors on the page${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  console.log(failed ? `${failed} FAILED` : 'all v1.9.8 checks passed');
  app.exit(failed ? 1 : 0);
});
