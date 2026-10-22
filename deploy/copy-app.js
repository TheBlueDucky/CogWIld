// Copies the web game into an app folder (desktop/app for Windows, android/www for Android) and points
// that copy at the online server, since apps load the game from files instead of from the website.
//   node deploy/copy-app.js <outDir> <desktop|android> [wss://server/ws]
// The server defaults to the live Cogwild server; set COGWILD_SERVER to use another one.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || 'app');
const platform = process.argv[3] || 'desktop';
const server = process.argv[4] || process.env.COGWILD_SERVER || 'wss://cogwild.duckdns.org/ws';
const site = server.replace(/^ws/, 'http').replace(/\/ws$/, '/');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'privacy.html', 'terms.html', 'credits.html', 'favicon.svg']) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of ['js', 'fonts', 'img']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });

const cfg = path.join(out, 'js', 'config.js');
let text = fs.readFileSync(cfg, 'utf8');
text = text.replace("CW.SERVER_URL = '';", `CW.SERVER_URL = '${server}';`).replace("CW.PUBLIC_URL = '';", `CW.PUBLIC_URL = '${site}';`);
text = text.replace('})();', `  CW.APP = '${platform}';\n})();`);
fs.writeFileSync(cfg, text);

if (!fs.existsSync(path.join(out, 'js', 'vendor', 'three.min.js'))) {
  console.error('js/vendor/three.min.js is missing: the app could not run offline (see LAUNCH.md)');
  process.exit(1);
}
console.log(`Game copied to ${out} (${platform}, server ${server})`);
