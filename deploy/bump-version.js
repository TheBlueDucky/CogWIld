// Raises the game's version everywhere it's written (the "New version checklist" in CLAUDE.md), so a release can't
// miss one: CW.VERSION, every ?v= cache buster in index.html, desktop/package.json, Android versionCode + versionName,
// and the file names on the download page and in LAUNCH.md.
//   node deploy/bump-version.js 1.9.0
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next || '')) { console.error('usage: node deploy/bump-version.js 1.9.0'); process.exit(1); }
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);
const pkg = JSON.parse(read('desktop/package.json'));
const prev = pkg.version;
if (prev === next) { console.error(`already ${next}`); process.exit(1); }

// js/parts.js
let s = read('js/parts.js');
s = s.replace(/CW\.VERSION = 'v[\d.]+';/, `CW.VERSION = 'v${next}';`);
write('js/parts.js', s);
// index.html: one cache-buster number for every script and style
s = read('index.html');
const v = Math.max(...[...s.matchAll(/\?v=(\d+)/g)].map((m) => +m[1])) + 1;
s = s.replace(/\?v=\d+/g, `?v=${v}`);
write('index.html', s);
// desktop/package.json (keeps its formatting)
write('desktop/package.json', read('desktop/package.json').replace(`"version": "${prev}"`, `"version": "${next}"`));
// Android: versionCode + 1, versionName
s = read('android/android/app/build.gradle');
s = s.replace(/versionCode (\d+)/, (m, n) => `versionCode ${+n + 1}`).replace(/versionName "[\d.]+"/, `versionName "${next}"`);
write('android/android/app/build.gradle', s);
// download page + launch notes: file names
for (const f of ['download.html', 'LAUNCH.md']) write(f, read(f).split(prev).join(next));
// CLAUDE.md: the current version line
write('CLAUDE.md', read('CLAUDE.md').replace(/\*\*Current version:\*\* v[\d.]+/, `**Current version:** v${next}`));
console.log(`version ${prev} -> ${next} (cache buster ?v=${v}). Add a What's new line in js/meta.js.`);
