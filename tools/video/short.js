// The vertical short for TikTok / Reels / Shorts (tools/video): a 1-second logo hook, fast gameplay cuts with zoom
// punches, glow and flash transitions, sound hits on every cut, and "DOWNLOAD NOW" over the last clip.
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

// the cuts: [clip, from s, to s, transition into it, hit = an impact in this clip (seconds into the cut)]
const CUTS = [
  ['vA-1', 0.3, 1.6, 'fadewhite', null], // Jump Jets leap + flip
  ['vA-2', 0.75, 1.6, 'zoomin', 0.3], // CRASH! 343
  ['vB-1', 0.3, 1.8, 'fadewhite', null], // a leap and a flip on the Moon
  ['vA-3', 0.9, 2.0, 'slideup', 0.15], // Orbital Strike
  ['vA-3', 2.5, 3.7, 'fadewhite', 0.05], // WRECKED, slow motion
  ['vC-1', 0.6, 1.9, 'hblur', 0.25], // the kickoff blast
  ['vB-3', 0.65, 1.5, 'zoomin', 0.5], // CRASH! 291
  ['vC-3', 1.3, 2.8, 'fadewhite', 1.0], // flip shot, GOAL
  ['vA-4', 0.2, 1.4, 'slideup', 0.75], // Jump Jets into a ram
  ['vB-2', 1.4, 2.8, 'fadewhite', 0.75], // WRECKED on the Moon
  ['vD-1', 0.6, 2.2, 'hblur', 0.65], // sunset GOAL
  ['vA-5', 1.8, 3.1, 'zoomin', 0.6], // WRECKED
  ['vC-4', 1.0, 2.6, 'fadewhite', 0.8], // flip shot, GOAL
  ['vA-6', 0.7, 3.9, 'fadewhite', 0.7], // VICTORY + DOWNLOAD NOW
];
const TD = 0.14; // transition length
const CTA_AT = 0.95; // seconds into the last cut where the text slams in

app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.on('unhandledRejection', (e) => { console.error('FAILED', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const d of ['hook', 'cta']) fs.mkdirSync(path.join(TMP, d), { recursive: true });
  // 1) the hook and the text, frame by frame, as pictures
  const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(path.join(__dirname, 'short.html'));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await js('ready');
  const LEN = await js('LEN');
  for (const kind of ['hook', 'cta']) {
    const n = Math.round(LEN[kind] * 60);
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(TMP, kind, String(i).padStart(4, '0') + '.png'), Buffer.from(await js(`frame('${kind}', ${i / 60})`), 'base64'));
    console.log(kind, n, 'frames');
  }
  // 2) each cut on its own: the zoom punch + shake on the impact, the colour grade, a glow, a vignette
  const pieces = [];
  run(['-framerate', '60', '-i', path.join(TMP, 'hook', '%04d.png'), '-f', 'lavfi', '-t', String(LEN.hook), '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-shortest', path.join(TMP, 'p00.mov')]);
  pieces.push({ file: path.join(TMP, 'p00.mov'), dur: LEN.hook });
  CUTS.forEach(([src, a, b, , hit], i) => {
    const len = b - a, last = i === CUTS.length - 1;
    const h = hit == null ? 0 : hit;
    // zoom: a punch at the impact (1.14x easing back in 0.3 s), a slow push-in otherwise; a small shake with the punch
    const zf = `(1.04+0.02*on/60+0.12*max(0,1-abs(on/60-${h})/0.3)*gte(on/60,${h - 0.05}))`;
    const sx = `8*sin(on*2.1)*max(0,1-abs(on/60-${h})/0.3)`, sy = `8*cos(on*2.7)*max(0,1-abs(on/60-${h})/0.3)`;
    let vf = `[0:v]fps=60,zoompan=z='${zf}':x='iw/2-(iw/zoom/2)+${sx}':y='ih/2-(ih/zoom/2)+${sy}':d=1:s=1080x1920:fps=60,` +
      'eq=contrast=1.14:saturation=1.22:gamma=0.96,split[a][b];[b]gblur=sigma=18,eq=brightness=-0.08[bl];[a][bl]blend=all_mode=screen:all_opacity=0.16,vignette=angle=PI/5';
    const inputs = ['-ss', String(a), '-t', String(len), '-i', path.join(RAW, src + '.mp4'), '-ss', String(a), '-t', String(len), '-i', path.join(RAW, src + '.wav')];
    if (last) {
      // the text: the clip behind it darkens and blurs as it slams in
      inputs.push('-framerate', '60', '-i', path.join(TMP, 'cta', '%04d.png'));
      vf += `[g];[g]split[g1][g2];[g2]boxblur=14,eq=brightness=-0.16:saturation=0.8[gb];[g1][gb]blend=all_expr='A*(1-clip((T-${CTA_AT})/0.25,0,1)*0.8)+B*clip((T-${CTA_AT})/0.25,0,1)*0.8'[gg];` +
        `[2:v]setpts=PTS-STARTPTS+${CTA_AT}/TB,format=rgba[t];[gg][t]overlay=0:0:eof_action=repeat:enable='gte(t,${CTA_AT})',format=yuv420p[v]`;
    } else vf += ',format=yuv420p[v]';
    const file = path.join(TMP, `p${String(i + 1).padStart(2, '0')}.mov`);
    run([...inputs, '-filter_complex', vf + ';[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.9[aa]', '-map', '[v]', '-map', '[aa]', '-t', String(len),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-c:a', 'pcm_s16le', file]);
    pieces.push({ file, dur: dur(file), tr: CUTS[i][3], hit });
    console.log('cut', i + 1, src, a, b);
  });
  // 3) join: quick transitions, and the times of every cut / impact for the sound hits
  const ins = [];
  pieces.forEach((p) => ins.push('-i', p.file));
  let fc = '', vp = '[0:v]', ap = '[0:a]', t = pieces[0].dur;
  const hits = [[0, 'slam'], [0.62, 'whoosh']];
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i], off = t - TD;
    fc += `${vp}[${i}:v]xfade=transition=${p.tr}:duration=${TD}:offset=${off.toFixed(3)}[v${i}];${ap}[${i}:a]acrossfade=d=${TD}[a${i}];`;
    vp = `[v${i}]`; ap = `[a${i}]`;
    hits.push([off + TD / 2, 'whoosh']);
    if (p.hit != null) hits.push([off + p.hit, 'hit']);
    if (i === pieces.length - 1) { hits.push([off + CTA_AT - 0.8, 'riser']); hits.push([off + CTA_AT, 'boom']); }
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
  fc += `${vp}fade=t=out:st=${(total - 0.25).toFixed(3)}:d=0.25[vout];` +
    `[${si}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.8[sx];${ap}volume=0.75[ga];[ga][sx]amix=inputs=2:normalize=0,afade=t=out:st=${(total - 0.3).toFixed(3)}:d=0.3,` +
    'acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=4dB,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[aout]';
  const final = path.join(OUT, 'Cogwild - Short.mp4');
  run([...ins, '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '60',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', final]);
  console.log('done', final, total.toFixed(1) + ' s');
  app.exit(0);
});
