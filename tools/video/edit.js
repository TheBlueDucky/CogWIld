// Cuts a finished YouTube video out of the recordings (tools/video): the intro, then clips from the raw match
// recordings, joined with short transitions, the sound evened out to YouTube's loudness, 1080p60 H.264 + AAC.
//   node edit.js <plan.json>
// plan: { out: 'name', intro: 'intro-clash', clips: [{ src: 'clash-a', from: 12.5, to: 30, fade: 'fade' }, ...] }
// (times in seconds of the raw recording; fade = the transition INTO this clip: fade, fadewhite, slideleft, circleopen…)
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
const TMP = path.join(OUT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const run = (args) => {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ').slice(0, 300));
};

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pieces = [];
// 1) every piece as its own clean clip: 1080p60, stereo 48 kHz (the game's sound is mono)
const list = (plan.intro ? [{ src: plan.intro, from: 0, to: null, intro: true }] : []).concat(plan.clips);
list.forEach((c, i) => {
  const file = path.join(TMP, `${plan.out}-${String(i).padStart(2, '0')}.mp4`);
  const v = path.join(RAW, c.src + '.mp4'), a = path.join(RAW, c.src + '.wav');
  const len = c.to == null ? null : c.to - c.from;
  const args = ['-ss', String(c.from), ...(len ? ['-t', String(len)] : []), '-i', v, '-ss', String(c.from), ...(len ? ['-t', String(len)] : []), '-i', a,
    '-map', '0:v', '-map', '1:a', '-vf', 'fps=60,format=yuv420p', '-af', `aresample=48000,pan=stereo|c0=c0|c1=c0${c.gain ? `,volume=${c.gain}` : ''}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-c:a', 'pcm_s16le', '-shortest', file.replace(/\.mp4$/, '.mov')];
  run(args);
  const dur = +spawnSync(FFMPEG.replace(/ffmpeg\.exe$/, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.replace(/\.mp4$/, '.mov')]).stdout.toString().trim();
  pieces.push({ file: file.replace(/\.mp4$/, '.mov'), dur, fade: c.fade || (i === 0 ? null : 'fade'), fd: c.fd || (c.fade === 'cut' ? 0 : 0.3) });
  console.log('piece', i, c.src, c.from, '->', c.to, dur.toFixed(2) + 's');
});
// 2) join them: xfade / acrossfade chains (a 'cut' is a plain join)
const inputs = [];
pieces.forEach((p) => inputs.push('-i', p.file));
let fc = '', vPrev = '[0:v]', aPrev = '[0:a]', t = pieces[0].dur;
for (let i = 1; i < pieces.length; i++) {
  const p = pieces[i], d = p.fade === 'cut' ? 0.04 : p.fd;
  const tr = p.fade === 'cut' ? 'fade' : p.fade;
  const off = Math.max(0, t - d);
  fc += `${vPrev}[${i}:v]xfade=transition=${tr}:duration=${d}:offset=${off.toFixed(3)}[v${i}];`;
  fc += `${aPrev}[${i}:a]acrossfade=d=${d}:c1=tri:c2=tri[a${i}];`;
  vPrev = `[v${i}]`; aPrev = `[a${i}]`;
  t = off + p.dur;
}
// the end fades out; YouTube's loudness (-14 LUFS), no clipping
fc += `${vPrev}fade=t=out:st=${(t - 0.8).toFixed(3)}:d=0.8[vout];${aPrev}afade=t=out:st=${(t - 1).toFixed(3)}:d=1,${plan.preGain ? `volume=${plan.preGain}dB,` : ""}acompressor=threshold=-24dB:ratio=3.5:attack=5:release=150:makeup=8dB,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[aout]`;
const final = path.join(OUT, plan.out + '.mp4');
run([...inputs, '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '60',
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', final]);
// a second pass when it came out quieter than YouTube's -14 LUFS (sharp click peaks hold the first pass back): raise it,
// a limiter keeps the peaks under -1.5 dB; the picture is copied as it is
const lufs = () => {
  const out = spawnSync(FFMPEG, ['-hide_banner', '-i', final, '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 1 << 28 }).stderr.toString();
  const all = [...out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? +all[all.length - 1][1] : -14;
};
const I = lufs();
if (I < -15) {
  const tmp = final.replace(/\.mp4$/, '.tmp.mp4');
  fs.renameSync(final, tmp);
  run(['-i', tmp, '-c:v', 'copy', '-af', `volume=${(-14 - I).toFixed(1)}dB,alimiter=limit=0.84:attack=2:release=60`, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', final]);
  fs.unlinkSync(tmp);
}
console.log('done', final, t.toFixed(1) + 's', `loudness ${I} -> ${lufs()} LUFS`);
