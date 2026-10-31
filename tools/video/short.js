// The vertical short for TikTok / Reels / Shorts (tools/video). The logo spins on a dark background, its letters turn
// into windows onto the game and the camera dives through them into the match; then fast gameplay cuts in the style of
// popular edits: speed ramps into every impact, zoom punches, shake, RGB split and flashes on the hits, zoom / spin /
// glitch / light-leak transitions, a little film grain; at the end a quiet "DOWNLOAD NOW" and a fade to black.
// Uses the vertical clips recorded with  VW=1080 VH=1920 CLEANHUD=1 NOMUSIC=1 npx electron match.js ... --rec vA ...
//   npx electron short.js        -> dist/youtube/Cogwild - Short.mp4
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FFMPEG = (() => {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  for (const d of fs.readdirSync(base)) if (/^Gyan\.FFmpeg/.test(d)) {
    const sub = fs.readdirSync(path.join(base, d)).find((s) => /^ffmpeg-/.test(s));
    if (sub) return path.join(base, d, sub, 'bin', 'ffmpeg.exe');
  }
  return 'ffmpeg';
})();
const OUT = path.join(__dirname, '..', '..', 'dist', 'youtube');
const RAW = path.join(OUT, 'raw');
const TMP = path.join(OUT, 'tmp-short');
const run = (args) => { const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1 << 26 }); if (r.status) throw new Error('ffmpeg failed: ' + r.stderr.toString().slice(0, 1200)); };
const dur = (f) => +spawnSync(FFMPEG.replace(/ffmpeg\.exe$/, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString().trim();

// the cuts: [clip, from s, to s, how it comes in, the impact (seconds into the cut) or null]
// how it comes in: hook (the logo), zoom (punch out of the last clip into this one), spin (a twisting zoom), glitch, flash (light leak)
const CUTS = [
  ['vA-1', 0.3, 1.6, 'hook', null], // Jump Jets leap + flip
  ['vA-2', 0.25, 1.6, 'zoom', 0.8], // CRASH! 343
  ['vB-1', 0.3, 1.8, 'flash', null], // a leap and a flip on the Moon
  ['vA-3', 0.6, 2.0, 'glitch', 0.45], // Orbital Strike
  ['vA-3', 2.5, 3.7, 'zoom', 0.05], // WRECKED, slow motion
  ['vC-1', 0.2, 1.9, 'spin', 0.65], // the kickoff blast
  ['vB-3', 0.15, 1.5, 'glitch', 1.0], // CRASH! 291
  ['vC-3', 0.9, 2.8, 'zoom', 1.4], // flip shot, GOAL
  ['vA-4', 0.0, 1.4, 'flash', 0.95], // Jump Jets into a ram
  ['vB-2', 1.0, 2.8, 'spin', 1.15], // WRECKED on the Moon
  ['vD-1', 0.4, 2.2, 'glitch', 0.85], // sunset GOAL
  ['vA-5', 1.4, 3.1, 'zoom', 1.0], // WRECKED
  ['vC-4', 0.6, 2.6, 'spin', 1.2], // flip shot, GOAL
  ['vA-6', 0.7, 4.0, 'flash', 0.7], // VICTORY, then DOWNLOAD NOW
];
const TR = 0.12; // how long a transition's half (out of one clip / into the next) lasts
const CTA_AT = 1.15; // seconds into the last cut where the text comes in
const BLACK = 0.7; // the fade to black at the very end
const RAMP = 1.5; // the lead-up to an impact plays this much faster

app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.on('unhandledRejection', (e) => { console.error('FAILED', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const d of ['hook', 'cta', 'leak']) fs.mkdirSync(path.join(TMP, d), { recursive: true });
  // 1) the hook, the light leak and the text, frame by frame, as see-through pictures
  const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(path.join(__dirname, 'short.html'));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await js('ready');
  const LEN = await js('LEN');
  for (const kind of ['hook', 'cta', 'leak']) {
    const n = Math.round(LEN[kind] * 60);
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(TMP, kind, String(i).padStart(4, '0') + '.png'), Buffer.from(await js(`frame('${kind}', ${i / 60})`), 'base64'));
    console.log(kind, n, 'frames');
  }
  const seq = (kind) => ['-framerate', '60', '-i', path.join(TMP, kind, '%04d.png')];

  // 2) each cut on its own, with its effects and the halves of its transitions baked in
  const pieces = [];
  for (let i = 0; i < CUTS.length; i++) {
    const [src, a0, b, tin, hit0] = CUTS[i];
    const tout = i + 1 < CUTS.length ? CUTS[i + 1][3] : null;
    const first = tin === 'hook', last = i === CUTS.length - 1;
    // the first cut starts earlier: the logo covers its first part, the game shows through the letters
    const a = first ? Math.max(0, a0 - LEN.reveal) : a0;
    const len0 = b - a;
    // speed ramp: the lead-up to the impact plays faster
    const ramp = !first && !last && hit0 != null && hit0 > 0.45;
    const p1 = ramp ? hit0 - 0.2 : 0;
    const L = ramp ? p1 / RAMP + (len0 - p1) : len0;
    const h = hit0 == null ? -9 : ramp ? p1 / RAMP + 0.2 : hit0 + (first ? a0 - a : 0);
    const T = 'on/60';
    const near = (c, w) => `max(0,1-abs(${T}-${c})/${w})`;
    const inK = (tin === 'zoom' || tin === 'spin') ? `max(0,1-${T}/${TR})` : '0';
    const outK = (tout === 'zoom' || tout === 'spin') ? `max(0,(${T}-${(L - TR).toFixed(3)})/${TR})` : '0';
    const gl = `(${tin === 'glitch' ? `lt(${T},${TR})` : '0'}+${tout === 'glitch' ? `gt(${T},${(L - TR).toFixed(3)})` : '0'})`;
    // zoom: a slow push, a punch on the impact, the zoom halves of transitions, the dive after the logo
    const z = `(1.03+0.025*${T}+0.13*${near(h, 0.28)}*gte(${T},${h - 0.04})+0.45*${inK}+0.45*${outK}${first ? `+0.5*max(0,1-max(0,${T}-${LEN.reveal})/${(LEN.hook - LEN.reveal).toFixed(3)})` : ''})`;
    const shake = `(10*${near(h, 0.3)}+16*${gl})`;
    let vf = '';
    if (ramp) vf += `[0:v]trim=0:${p1.toFixed(3)},setpts=(PTS-STARTPTS)/${RAMP}[v1];[0:v]trim=${p1.toFixed(3)},setpts=PTS-STARTPTS[v2];[v1][v2]concat=n=2:v=1:a=0[vs];`;
    else vf += '[0:v]null[vs];';
    vf += `[vs]fps=60,zoompan=z='${z}':x='iw/2-(iw/zoom/2)+${shake}*sin(on*2.3)':y='ih/2-(ih/zoom/2)+${shake}*cos(on*3.1)':d=1:s=1080x1920:fps=60`;
    // spin: a twist with the zoom
    if (tin === 'spin' || tout === 'spin') vf += `,rotate=a='${tin === 'spin' ? `-0.28*max(0,1-t/${TR})` : '0'}+${tout === 'spin' ? `0.28*max(0,(t-${(L - TR).toFixed(3)})/${TR})` : '0'}':fillcolor=black`;
    // the look: punchier colours, flashes on the hits and on flash / zoom entries, a soft glow, RGB split, grain, a vignette
    const flash = `0.22*max(0,1-abs(t-${h})/0.09)*gte(t,${h - 0.02})+${tin === 'flash' || tin === 'zoom' ? '0.35*max(0,1-t/0.1)' : '0'}`;
    const glt = gl.replace(/on\/60/g, 't');
    vf += `,eq=contrast=1.15:saturation=1.25:gamma=0.96:brightness='${flash}':eval=frame,split[a][b];[b]gblur=sigma=18,eq=brightness=-0.08[bl];[a][bl]blend=all_mode=screen:all_opacity=0.16,` +
      `rgbashift=rh=-14:bh=14:enable='between(t,${h - 0.02},${h + 0.1})+${glt}',` +
      'unsharp=5:5:0.6,noise=alls=5:allf=t,vignette=angle=PI/5';
    const inputs = ['-ss', String(a), '-t', String(len0), '-i', path.join(RAW, src + '.mp4'), '-ss', String(a), '-t', String(len0), '-i', path.join(RAW, src + '.wav')];
    let n = 2;
    if (tin === 'flash') { inputs.push(...seq('leak')); vf += `[g0];[${n}:v]format=rgba[lk];[g0][lk]overlay=0:0:eof_action=pass`; n++; }
    if (first) { inputs.push(...seq('hook')); vf += `[g1];[${n}:v]format=rgba[hk];[g1][hk]overlay=0:0:eof_action=pass`; n++; }
    if (last) {
      // the text: the clip behind it dims and softens a little, the words sink into it
      inputs.push(...seq('cta'));
      const K = `clip((T-${CTA_AT})/0.45,0,1)*0.55`;
      vf += `[g];[g]split[g1][g2];[g2]boxblur=6,eq=brightness=-0.14:saturation=0.85[gb];[g1][gb]blend=all_expr='A*(1-${K})+B*${K}'[gg];` +
        `[${n}:v]setpts=PTS-STARTPTS+${CTA_AT}/TB,format=rgba[t];[gg][t]overlay=0:0:eof_action=repeat:enable='gte(t,${CTA_AT})'`;
      n++;
    }
    vf += ',format=yuv420p[v]';
    let af = ramp
      ? `[1:a]atrim=0:${p1.toFixed(3)},asetpts=PTS-STARTPTS,atempo=${RAMP}[x1];[1:a]atrim=${p1.toFixed(3)},asetpts=PTS-STARTPTS[x2];[x1][x2]concat=n=2:v=0:a=1,`
      : '[1:a]';
    af += `aresample=48000,pan=stereo|c0=c0|c1=c0,volume='${first ? `if(lt(t,${LEN.reveal}),0,0.9)` : '0.9'}':eval=frame[aa]`;
    const file = path.join(TMP, `p${String(i).padStart(2, '0')}.mov`);
    run([...inputs, '-filter_complex', vf + ';' + af, '-map', '[v]', '-map', '[aa]', '-t', L.toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-c:a', 'pcm_s16le', file]);
    pieces.push({ file, dur: dur(file), tin, h });
    console.log('cut', i, src, tin, L.toFixed(2) + ' s');
  }

  // 3) join them (the transitions are already in the clips: only a hair of a blend between them), and the sound hits
  const ins = [];
  pieces.forEach((p) => ins.push('-i', p.file));
  const XF = 0.05;
  let fc = '', vp = '[0:v]', ap = '[0:a]', t = pieces[0].dur;
  const hits = [[0, 'spin'], [LEN.reveal, 'slam'], [LEN.reveal + 0.15, 'whoosh']];
  if (pieces[0].h > 0) hits.push([pieces[0].h, 'hit']);
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i], off = t - XF;
    fc += `${vp}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}[v${i}];${ap}[${i}:a]acrossfade=d=${XF}[a${i}];`;
    vp = `[v${i}]`; ap = `[a${i}]`;
    hits.push([off, p.tin === 'spin' ? 'spin' : 'whoosh']);
    if (p.tin === 'glitch') hits.push([off, 'glitch']);
    if (p.h > 0) hits.push([off + p.h, 'hit']);
    if (i === pieces.length - 1) hits.push([off + CTA_AT - 0.5, 'riser']);
    t = off + p.dur;
  }
  const total = t;
  const sfx = Buffer.from(await js(`sfx(${JSON.stringify(hits)}, ${total + 0.5})`), 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + sfx.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(48000, 24); hdr.writeUInt32LE(96000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(sfx.length, 40);
  fs.writeFileSync(path.join(TMP, 'sfx.wav'), Buffer.concat([hdr, sfx]));
  ins.push('-i', path.join(TMP, 'sfx.wav'));
  const si = pieces.length;
  fc += `${vp}fade=t=out:st=${(total - BLACK).toFixed(3)}:d=${BLACK}:color=black[vout];` +
    `[${si}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.8[sx];${ap}volume=0.75[ga];[ga][sx]amix=inputs=2:normalize=0,afade=t=out:st=${(total - BLACK).toFixed(3)}:d=${BLACK},` +
    'acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=4dB,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[aout]';
  const final = path.join(OUT, 'Cogwild - Short.mp4');
  run([...ins, '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '60',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', final]);
  console.log('done', final, total.toFixed(1) + ' s');
  app.exit(0);
});
