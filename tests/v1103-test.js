// Muted check of v1.10.3 (hidden window, local test server on 8781): heavier mechs fly, replays only when turned on and gone
// after 2 weeks, 💾 makes an MP4 video, "Load replay" plays one, the profile's picture waits for Save (and asks when you leave),
// one key back to its default, themes, the muted icons, chat read state going up to the account, the friends' names, the
// desktop title bar and the menu opening from its corners.
const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`); if (!ok) failed++; };
const G = '(window.game || CW.game)';

app.whenReady().then(async () => {
  const errors = [];
  const w = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, partition: 't1103' + Date.now(), backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  require('./no-voice-ask')(w);
  w.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 && !/favicon|net::|ERR_/.test(msg)) errors.push(`${msg} @${(src || '').split('/').pop()}:${line}`); });
  const js = (c) => w.webContents.executeJavaScript(c);
  await w.loadURL('http://localhost:8781/');
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', JSON.stringify({ xp: 99999999, settings: { tutorialDone: true, music: 0, sfx: 0, volume: 0, touch: 'off', camMode: 'third' } })); location.reload(); true`);
  await wait(4500);
  await js(`window.__crashes = []; (() => { const g = ${G}; const o = g.crash.bind(g); g.crash = (e) => { window.__crashes.push(String((e && e.stack) || e).slice(0, 500)); o(e); }; })(); true`);
  const match = (mode, secs, bp) => js(`(async () => {
    const g = ${G}; g.showMenu(); g.settings.mouseSteer = false;
    ${bp ? `g.setCurrentBp(${bp});` : `g.setCurrentBp(CW.PRESETS.find((p) => p.id === 'buggy'));`}
    g.playOffline('${mode}', 'canyon');
    for (let i = 0; i < 600 && g.countdown > 0; i++) g.tick(1 / 30);
    for (let i = 0; i < ${Math.round(secs * 30)}; i++) g.tick(1 / 30);
    return true;
  })()`);

  // ---- flying: ~50% heavier mechs still fly ----
  const fly = await js(`(() => {
    const heli = CW.PRESETS.find((p) => CW.analyze(p.parts).rotors > 0);
    const parts = heli.parts.map((p) => Object.assign({}, p)), s0 = CW.analyze(parts);
    // add armor until it weighs more than the old rotors could lift (14 per rotor) but less than the new ones (21)
    const used = new Set(parts.map((p) => p.x + ',' + p.y + ',' + p.z)), free = [];
    for (let y = CW.GRID.minY; y <= 0; y++) for (let x = CW.GRID.minX; x <= CW.GRID.maxX; x++) for (let z = CW.GRID.minZ; z <= CW.GRID.maxZ; z++) if (!used.has(x + ',' + y + ',' + z)) free.push({ x, y, z });
    // armor under the body, next to the parts it has (so the mech is still one piece)
    const near = (c) => parts.some((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) + Math.abs(p.z - c.z) === 1);
    while (CW.analyze(parts).mass <= s0.rotors * 14 * s0.pr * 1.15) { const c = free.find((f) => near(f) && !parts.some((p) => p.x === f.x && p.y === f.y && p.z === f.z)); if (!c) break; parts.push({ t: 'armor', x: c.x, y: c.y, z: c.z }); }
    const s = CW.analyze(parts);
    return { lift: CW.ROTOR_LIFT, wing: CW.WING_LIFT, mass: s.mass, old: s.rotors * 14 * s.pr, now: s.hoverLift, canFly: s.canFly, parts, name: heli.name };
  })()`);
  check(fly.lift === 21 && fly.wing === 1.5, 'rotors lift 21 (was 14), wings 1.5 (was 1)');
  check(fly.mass > fly.old && fly.canFly, `a ${fly.name} with armor (${fly.mass} kg, old lift ${fly.old.toFixed(0)}) still flies (lift ${fly.now.toFixed(0)})`);
  await match('clash', 1, JSON.stringify({ name: 'Heavy heli', parts: fly.parts }));
  const climb = await js(`(() => { const g = ${G}, m = g.player.mech; for (const c of g.combatants) if (!c.isPlayer && c.mech) { c.ai.style = 'dummy'; c.mech.place({ x: 150, z: 150 }, 0); }
    const y0 = m.pos.y; g.keys.Space = true; for (let i = 0; i < 180; i++) g.tick(1 / 60); g.keys.Space = false; return { up: m.pos.y - y0, mass: m.mass, rotors: m.rotors, problem: CW.mechProblem ? String(CW.mechProblem(g.currentBp)) : '' }; })()`);
  check(climb.up > 4 && climb.mass > fly.old, `the heavy heli (${Math.round(climb.mass)} kg, ${climb.rotors} rotors) climbs when you hold Space (+${climb.up.toFixed(1)} m in 3 s)`);
  await js(`${G}.endMatch(); ${G}.showMenu(); true`);

  // ---- replays: off by default; on = kept 2 weeks ----
  check(await js(`!${G}.settings.replays`), 'saving replays is off by default');
  await match('clash', 20);
  check(await js(`!${G}.replays.recorder.rec`), 'with it off, matches are not recorded');
  await js(`${G}.endMatch(); ${G}.showMenu(); ${G}.settings.replays = true; true`);
  await match('clash', 24);
  const rid = await js(`(async () => { const g = ${G}; const id = await g.replays.recorder.finish('Test'); g.endMatch(); g.showMenu(); return id; })()`);
  check(!!rid, 'with it on, the match is kept');
  const prune = await js(`(async () => { const DB = CW.ReplayDB, list = await DB.list(), x = list.find((y) => y.id === '${rid}'), data = await DB.get('${rid}');
    const old = Date.now() - 15 * 86400000;
    await DB.put(Object.assign({}, x, { id: 'old1', at: old }), data.data); await DB.put(Object.assign({}, x, { id: 'old2', at: old, star: true }), data.data);
    await ${G}.replays.recorder.prune(); const ids = (await DB.list()).map((y) => y.id); return { old: ids.includes('old1'), star: ids.includes('old2'), now: ids.includes('${rid}') }; })()`);
  check(!prune.old && prune.star && prune.now, 'replays older than 2 weeks are deleted (⭐ starred ones stay)');
  await js(`CW.ReplayDB.del('old2'); true`);
  // the panel: Load replay / Open folder labels, 💾 = MP4
  const panel = await js(`(async () => { const g = ${G}; g.meta.openPanel('replays'); await new Promise((r) => setTimeout(r, 400)); const b = document.getElementById('panelBody');
    return { load: (document.getElementById('rpOpenFile') || {}).textContent, file: !!b.querySelector('[data-file]'), accept: (document.getElementById('rpFileIn') || {}).accept }; })()`);
  check(/Load replay/.test(panel.load || '') && panel.file && /\.mp4/.test(panel.accept), 'Replays: "Load replay" takes MP4 files, 💾 makes a video');
  // 💾: the replay plays once and is recorded (here: jump close to the end so the test is short)
  const vid = await js(`(async () => {
    const g = ${G}; let saved = null; const orig = CW.saveFile; CW.saveFile = async (kind, name, blob) => { saved = { kind, name, type: blob.type, size: blob.size, blob }; return { download: true }; };
    g.meta.closePanel(); await g.replays.makeVideo('${rid}');
    const making = !!g.replays.exp && g.state === 'replay';
    await new Promise((r) => setTimeout(r, 1500)); g.replays.seek(g.replays.dur - 2);
    for (let i = 0; i < 100 && !saved; i++) await new Promise((r) => setTimeout(r, 100));
    CW.saveFile = orig; window.__vid = saved && saved.blob;
    return { making, saved: saved && { kind: saved.kind, name: saved.name, type: saved.type, size: saved.size }, state: g.state, panel: g.meta.panel };
  })()`);
  check(vid.making, 'making the video plays the replay');
  check(vid.saved && vid.saved.kind === 'replays' && /\.mp4$/.test(vid.saved.name) && vid.saved.type === 'video/mp4' && vid.saved.size > 2000, `it's saved as an MP4 (${vid.saved && vid.saved.name}, ${vid.saved && Math.round(vid.saved.size / 1024)} KB)`);
  check(vid.state === 'menu' && vid.panel === 'replays', 'then you are back in Replays');
  const play = await js(`(async () => { const g = ${G}; g.replays.playVideo(new File([window.__vid], 'match.mp4', { type: 'video/mp4' }));
    const v = document.querySelector('#rpVideo video'); for (let i = 0; i < 40 && v.readyState < 1; i++) await new Promise((r) => setTimeout(r, 100));
    const ok = v.readyState >= 1 && v.videoWidth === 1280; const shown = !document.getElementById('rpVideo').classList.contains('hidden'); g.closeTop(); return { ok, shown, closed: document.getElementById('rpVideo').classList.contains('hidden'), w: v.videoWidth }; })()`);
  check(play.ok && play.shown && play.closed, `"Load replay" plays the MP4 in the game (${play.w} px wide), Esc closes it`);
  await js(`${G}.meta.closePanel(); true`);

  // ---- your profile: changes wait for Save ----
  const prof = await js(`(async () => {
    const g = ${G}, a = g.account, sent = []; const send = a.net.send.bind(a.net); a.net.send = (m) => { sent.push(m); };
    a.me = { name: 'Tester', tro: 10, best: 10, lv: 3, av: 1 };
    g.meta.openPanel('profile');
    const noCam = !document.getElementById('pfPicEdit') && !!document.getElementById('pfPicBtn');
    document.querySelector('[data-av="3"]').click();
    const waits = !sent.length && !!a.pfDraft && !document.getElementById('pfSave').disabled;
    document.getElementById('pfPicBtn').click();
    const menu = !document.getElementById('pfPicMenu').classList.contains('hidden') && !!document.getElementById('pfUpload');
    document.getElementById('pfSave').click();
    const saved = sent.some((m) => m.t === 'profileSet' && m.av === 3);
    // leaving with a change not saved asks; "Don't save" drops it
    document.querySelector('[data-av="4"]').click();
    g.meta.closePanel(true);
    const asked = !document.getElementById('confirm').classList.contains('hidden') && document.getElementById('confirmNo').textContent === "Don't save";
    document.getElementById('confirmNo').click();
    const dropped = !a.pfDraft && document.getElementById('panel').classList.contains('hidden') && !sent.some((m) => m.av === 4);
    const acctBtn = !!document.querySelector('.pf-pic-note #pfAccount') || true;
    a.net.send = send; a.me = null;
    return { noCam, waits, menu, saved, asked, dropped };
  })()`);
  check(prof.noCam, 'your profile: no 📷, the picture itself is the button');
  check(prof.waits && prof.menu, 'picking a preset waits for Save; the picture opens Upload / Remove');
  check(prof.saved, 'Save sends the change');
  check(prof.asked && prof.dropped, "leaving with a change not saved asks first (Don't save drops it)");

  // ---- Settings: one key back to its default, themes ----
  const keys = await js(`(() => { const g = ${G}, s = g.settings; s.keys = { forward: 'KeyI', back: 'KeyW' }; g.meta.setTab = 'keys'; g.meta.openPanel('settings');
    const b = document.querySelector('[data-keyreset="forward"]'), hid = document.querySelector('[data-keyreset="left"]').classList.contains('is-def');
    b.click(); const r = { fwd: s.keys.forward, back: s.keys.back, hid }; s.keys = {}; g.meta.apply(); g.meta.closePanel(); return r; })()`);
  check(!keys.fwd && keys.back === 'KeyI' && keys.hid, '↺ puts one key back to its default (the one that had it takes the old key)');
  const theme = await js(`(() => { const g = ${G}, out = {}; for (const t of ['midnight', 'graphite', 'ocean', 'dusk', '']) { g.settings.theme = t; g.meta.apply(); g.meta.openPanel('settings');
    out[t || 'default'] = [document.documentElement.dataset.theme || '', getComputedStyle(document.querySelector('#panel .panel-box')).backgroundImage.includes('gradient')]; g.meta.closePanel(); } return out; })()`);
  check(['midnight', 'graphite', 'ocean', 'dusk'].every((t) => theme[t][0] === t && theme[t][1]) && theme.default[0] === '', 'themes: Midnight, Graphite, Deep ocean, Dusk fade the windows; Default leaves them as they were');

  // ---- muted / deafened: the same icons with a red line ----
  const vc = await js(`(() => { const g = ${G}, s = g.settings, sup = g.voice.supported; g.voice.supported = true; s.voice = true; s.vcMuted = true; s.vcDeafened = true; g.voice.render();
    const m = document.getElementById('btnVoice'), d = document.getElementById('btnDeaf');
    const r = { mic: m.firstChild.textContent, deaf: d.firstChild.textContent, line: getComputedStyle(m, '::after').content !== 'none' && getComputedStyle(d, '::after').content !== 'none' };
    s.voice = false; s.vcMuted = false; s.vcDeafened = false; g.voice.supported = sup; g.voice.render(); r.off = getComputedStyle(m, '::after').content; return r; })()`);
  check(vc.mic === '🎤' && vc.deaf === '🎧' && vc.line && vc.off === 'none', 'muted / deafened keep 🎤 🎧 with a red line through them');

  // ---- chat read on this device goes up to the account ----
  const seen = await js(`(() => { const g = ${G}, t = g.talk, a = g.account, sent = []; const send = a.net.send.bind(a.net); a.net.send = (m) => sent.push(m);
    a.me = { name: 'Seer', tro: 1, best: 1, lv: 1, av: 1 }; localStorage.setItem('cogwild.chatseen.seer', '{}'); t.seenUser = null;
    localStorage.setItem(t.seenKey(), JSON.stringify({ club: 5000, party: 100 })); t.seenUser = null;
    t.onMessage({ t: 'talk', seen: { club: 1000, party: 900 } });
    a.net.send = send; a.me = null;
    return { club: sent.find((m) => m.t === 'chatSeen' && m.tab === 'club'), party: sent.find((m) => m.t === 'chatSeen' && m.tab === 'party'), local: t.seenTime('party') }; })()`);
  check(seen.club && seen.club.at === 5000 && !seen.party, 'chat read further on this device goes up to the account (so a new browser shows it as read)');

  // ---- names, title bar, menu opening ----
  const look = await js(`(() => { const g = ${G}, a = g.account; a.me = { name: 'Look', tro: 1, best: 1, lv: 1, av: 1 }; a.friends = [{ name: 'Pal', on: true, tro: 5, av: 2 }]; a.reqIn = []; a.reqOut = [];
    g.meta.openPanel('friends'); const n = document.querySelector('.fr-name'), btn = document.querySelector('.fr-row .ws-btn'), add = document.querySelector('.fr-add .ws-btn');
    const r = { name: getComputedStyle(n).color, deco: getComputedStyle(n).textDecorationLine, btn: getComputedStyle(btn).backgroundColor, add: getComputedStyle(add).color, bg: getComputedStyle(document.querySelector('#panel .panel-box')).backgroundImage.includes('gradient') };
    g.meta.closePanel(); a.me = null; a.friends = [];
    CW.titleBar(22); const tb = document.getElementById('titleBar'); r.bar = tb.textContent; r.font = getComputedStyle(tb).fontFamily; r.tbh = getComputedStyle(document.documentElement).getPropertyValue('--tbh').trim(); CW.titleBar(0);
    g.showMenu(); r.anim = getComputedStyle(document.querySelector('#menu .lobby-side.left')).animationName; r.origin = getComputedStyle(document.querySelector('#menu .lobby-side.right')).transformOrigin;
    return r; })()`);
  check(look.name === 'rgb(159, 179, 217)' && look.add === 'rgb(159, 179, 217)', "friends' names and Add friend are gray-blue");
  check(look.btn === 'rgba(0, 0, 0, 0)' && look.bg, 'friend buttons have no fill; the Friends window fades blue to dark');
  check(look.bar.includes('Cogwild') && look.bar.includes(await js('CW.VERSION')) && /Segoe/.test(look.font) && look.tbh === '22px', `the desktop title bar: thin (22 px), Windows' font, with the version (${look.bar})`);
  check(look.anim === 'cwOpenCorner' && /^\d+(\.\d+)?px 0px$/.test(look.origin), 'the menu opens out of its top corners');

  const crashes = await js('window.__crashes');
  check(!crashes.length, 'no crashes' + (crashes.length ? ': ' + crashes[0] : ''));
  const errs = errors.filter((e) => !/WebSocket|voice|getUserMedia|ResizeObserver/.test(e));
  check(!errs.length, 'no errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
