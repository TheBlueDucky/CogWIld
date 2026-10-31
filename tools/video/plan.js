// Picks what to record and how to cut it (tools/video).
//   node plan.js segs <sim.json>                     -> the --segs list for match.js (the best moments of that match)
//   node plan.js edit <out> <intro> <rec> [rec...]   -> dist/youtube/<out>.plan.json for edit.js
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', '..', 'dist', 'youtube', 'raw');
const [cmd, ...a] = process.argv.slice(2);
const S = 60; // frames a second

function segs(sim) {
  const ev = sim.events;
  const end = (ev.find((e) => e.k === 'results') || {}).f || sim.frames;
  const go = Math.min(end, 600); // the arena roulette, 3-2-1 and the first rush
  const out = [[0, go]];
  if (sim.kind === 'ball') {
    // every goal (ours with the run-up, theirs short), plus the hero's flips into the ball
    for (const e of ev) if (e.k === 'goal') out.push(e.mine ? [e.f - 8 * S, e.f + 4 * S] : [e.f - 4 * S, e.f + 3 * S]);
    // the hero's flips into the ball and power shots (at most 8, spread out)
    let last = -1e9, n = 0;
    for (const e of ev) {
      if (n >= 8 || !((e.k === 'flip' && e.ball) || e.k === 'shot') || e.f - last < 12 * S) continue;
      out.push([e.f - 3 * S, e.f + 3 * S]); last = e.f; n++;
    }
  } else {
    for (const e of ev) {
      if (e.k !== 'wreck') continue;
      // the wreck with its lead-up, and the pilot finished off after it
      const fin = ev.find((x) => x.k === 'pilotkill' && x.f > e.f && x.f - e.f < 12 * S);
      out.push([e.f - 7 * S, (fin ? fin.f : e.f) + 2 * S]);
    }
    for (const e of ev) if (e.k === 'super' && e.near > 0) out.push([e.f - 2 * S, e.f + 3 * S]); // a strike on a group
    for (const e of ev) if (e.k === 'pilotkill') out.push([e.f - 5 * S, e.f + 2 * S]); // finishing a pilot off
    ev.filter((e) => e.k === 'jumpjets').slice(0, 3).forEach((e) => out.push([e.f - 1 * S, e.f + 4 * S])); // a big leap and a flip
  }
  out.push([end - 6 * S, end + 4 * S]); // the end: the last moment and the results
  // in order, merged when they touch or are close
  const list = out.map(([x, y]) => [Math.max(0, Math.round(x)), Math.round(y)]).sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const s of list) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 2 * S) last[1] = Math.max(last[1], s[1]);
    else merged.push(s.slice());
  }
  return merged;
}

if (cmd === 'segs') {
  const sim = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  const sg = segs(sim);
  console.log(sg.map((s) => s.join('-')).join(','));
  console.error(`${sg.length} pieces, ${(sg.reduce((n, s) => n + s[1] - s[0], 0) / S).toFixed(0)} s`);
} else if (cmd === 'edit') {
  const [out, intro, ...recs] = a;
  const clips = [];
  recs.forEach((r, ri) => {
    const info = JSON.parse(fs.readFileSync(path.join(RAW, r + '.json'), 'utf8'));
    info.caps.forEach((c, i) => {
      // a new match starts with a white flash, pieces of one match join with a quick fade
      clips.push({ src: `${r}-${c.seg}`, from: 0, to: null, fade: i === 0 ? 'fadewhite' : 'fade', fd: i === 0 ? 0.45 : 0.3 });
    });
  });
  const plan = { out, intro, clips };
  fs.writeFileSync(path.join(RAW, '..', out + '.plan.json'), JSON.stringify(plan, null, 1));
  console.log(path.join(RAW, '..', out + '.plan.json'));
}
