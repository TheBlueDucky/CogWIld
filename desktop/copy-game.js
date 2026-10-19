// Copies the web game into desktop/app before running or packaging the desktop build
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'privacy.html']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'js'), path.join(out, 'js'), { recursive: true });
if (!fs.existsSync(path.join(out, 'js', 'vendor', 'three.min.js'))) {
  console.warn('Warning: js/vendor/three.min.js is missing. The desktop build needs it to run offline (see LAUNCH.md).');
}
console.log('Game copied to desktop/app');
