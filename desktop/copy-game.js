// Copies the web game into desktop/app before running or packaging the desktop build
require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'deploy', 'copy-app.js'), require('path').join(__dirname, 'app'), 'desktop'], { stdio: 'inherit' });
