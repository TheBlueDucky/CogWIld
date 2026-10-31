// Frame-exact recording (tools/video): steps the page's virtual clock (vt-page.js) one frame at a time, waits for the
// hidden window to draw exactly that frame (a colour marker in the corner says which one it is), sends it to ffmpeg,
// and at the end saves the game's sound (rendered offline on the same clock) as a WAV next to the video.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const FFMPEG = (() => {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(base)) if (/^Gyan\.FFmpeg/.test(d)) {
      const sub = fs.readdirSync(path.join(base, d)).find((s) => /^ffmpeg-/.test(s));
      if (sub) return path.join(base, d, sub, 'bin', 'ffmpeg.exe');
    }
  } catch (e) { /* fall through */ }
  return 'ffmpeg';
})();
const W = +(process.env.VW || 1920), H = +(process.env.VH || 1080), FPS = 60, MS = 1000 / FPS; // VW=1080 VH=1920: vertical (TikTok / Reels)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'dist', 'youtube');

function makeWindow(partition) {
  const win = new BrowserWindow({
    show: false, width: W, height: H, useContentSize: true, frame: false,
    webPreferences: { offscreen: true, partition: partition || 'vid' + Date.now(), autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true); // nothing is ever heard: the sound is made offline inside the page
  win.webContents.setFrameRate(120);
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`setInterval(() => { const a = document.getElementById('vcAsk'); if (a && !a.classList.contains('hidden')) document.getElementById('vcNo').click(); }, 150); true`).catch(() => {});
  });
  win.webContents.on('console-message', (e) => { const m = e.message || ''; if ((e.level === 'error' || e.level === 3) && !/Permissions policy|AudioContext/.test(m)) console.log('[page]', m.slice(0, 300)); });
  return win;
}

class Capture {
  constructor(win) {
    this.win = win;
    this.js = (c) => win.webContents.executeJavaScript(c, true);
    this.frame = 0;
    this.latest = null;
    this.onPaint = (e, dirty, img) => {
      const sz = img.getSize();
      if (sz.width !== W || sz.height !== H) return;
      const buf = img.toBitmap();
      const m = (buf[2] | (buf[1] << 8)); // BGRA: R is byte 2, G byte 1, B byte 0
      const ok = Math.abs(buf[0] - 77) < 6;
      this.latest = { buf, m: ok ? m : -1 };
      if (this.want && ok && m === (this.want.i & 0xffff)) { const w = this.want; this.want = null; w.res(buf); }
    };
    win.webContents.on('paint', this.onPaint);
  }
  async inject() {
    await this.js(fs.readFileSync(path.join(__dirname, 'vt-page.js'), 'utf8'));
  }
  // start the clock + video file (+ the sound when maxSecs is given)
  async begin(name, opts = {}) {
    await this.inject();
    await this.js('__vt.enable(); true');
    this.dbg = this.win.webContents.debugger;
    try { this.dbg.attach('1.3'); await this.dbg.sendCommand('Animation.enable'); } catch (e) { this.dbg = null; }
    if (opts.audioSecs) await this.js(`__vt.audioStart(${opts.audioSecs}); true`);
    fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
    this.base = path.join(OUT, 'raw', name);
    this.ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
      // the graphics card's encoder (Media Foundation), a high bitrate: these are only the raw pieces for the edit
      '-pix_fmt', 'nv12', '-c:v', 'h264_mf', '-hw_encoding', '1', '-b:v', '60M', '-maxrate', '90M', this.base + '.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.ff.stdin.on('error', () => {});
    this.frame = 0; this.t0 = Date.now(); this.rateAt = { f: 0, t: Date.now() }; this.misses = 0;
  }
  // one frame: step the page clock, wait for that frame's picture, save it
  async step(pre) {
    const i = this.frame;
    const T = this.tm || (this.tm = { js: 0, paint: 0, write: 0 });
    const t0 = Date.now();
    const got = new Promise((res) => { this.want = { i, res }; });
    const ret = await this.js(`${pre || ''}__vt.step(${i}, ${MS}); window.game ? game.state : ''`);
    const t1 = Date.now(); T.js += t1 - t0;
    let buf = await Promise.race([got, wait(700).then(() => null)]);
    if (!buf) { this.win.webContents.invalidate(); buf = await Promise.race([got, wait(1500).then(() => null)]); }
    if (!buf) { this.want = null; this.misses++; buf = this.latest && this.latest.buf; }
    // paint over the marker with the pixels just under it
    buf.copy(buf, 0, W * 4 * 3, W * 4 * 3 + 8 * 4);
    buf.copy(buf, W * 4, W * 4 * 3, W * 4 * 3 + 8 * 4);
    const t2 = Date.now(); T.paint += t2 - t1;
    // the encoder works while the next frame is made; wait only when it falls a few frames behind
    this.ff.stdin.write(buf);
    if (this.ff.stdin.writableLength > W * H * 4 * 6) await new Promise((r) => this.ff.stdin.once('drain', r));
    T.write += Date.now() - t2;
    this.frame++;
    // CSS animations follow real time: slow them to match the virtual clock
    if (this.dbg && this.frame - this.rateAt.f >= 30) {
      const real = Date.now() - this.rateAt.t, virt = (this.frame - this.rateAt.f) * MS;
      const rate = Math.max(0.02, Math.min(1, virt / Math.max(1, real)));
      this.dbg.sendCommand('Animation.setPlaybackRate', { playbackRate: rate }).catch(() => {});
      this.rateAt = { f: this.frame, t: Date.now() };
    }
    return ret;
  }
  async end() {
    this.win.webContents.removeListener('paint', this.onPaint); // (one listener per recorded piece used to pile up)
    await new Promise((r) => { this.ff.on('close', r); this.ff.stdin.end(); });
    const n = await this.js('__vt.V.A ? __vt.audioStop() : (__vt.V.pcm ? __vt.V.pcm.length : 0)');
    if (n > 0) {
      const parts = [];
      for (let at = 0; at < n; at += 2e6) parts.push(Buffer.from(await this.js(`__vt.pcmSlice(${at}, 2e6)`), 'base64'));
      const pcm = Buffer.concat(parts);
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
      hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(48000, 24);
      hdr.writeUInt32LE(96000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(this.base + '.wav', Buffer.concat([hdr, pcm]));
    }
    if (this.dbg) { try { await this.dbg.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 }); this.dbg.detach(); } catch (e) { /* closed */ } }
    const secs = (Date.now() - this.t0) / 1000;
    return { tm: this.tm, frames: this.frame, misses: this.misses, realSecs: Math.round(secs), capFps: +(this.frame / secs).toFixed(1), audioSamples: n };
  }
}

// a fresh game page with the settings the videos use
async function openGame(win, settings, extra) {
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await win.loadURL('http://localhost:8781/');
  const prof = Object.assign({ xp: 999999, coins: 0 }, extra || {}, {
    settings: Object.assign({ tutorialDone: true, music: true, volume: 0.8, musicVol: 0.7, graphics: 'high', camMode: 'third', touch: 'off', voice: false, fov: 80, shake: true, showFps: false, discord: false, clips: false, replays: false, chatNotes: false, friendOnline: false }, settings || {}),
  });
  await js(`localStorage.clear(); localStorage.setItem('cogwild.profile', ${JSON.stringify(JSON.stringify(prof))}); location.reload(); true`);
  await wait(5000);
}

module.exports = { makeWindow, Capture, openGame, FFMPEG, W, H, FPS, MS, wait, OUT, ROOT };
