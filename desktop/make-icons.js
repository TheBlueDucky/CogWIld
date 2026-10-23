// Makes the store/app images from build/icon.png (run with Electron, nothing is shown or heard):
//   ..\desktop\node_modules\.bin\electron make-icons.js
// build/appx/*.png  Microsoft Store tiles   ·   build/icon.icns  macOS app icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'build', 'icon.png');
const APPX = path.join(__dirname, 'build', 'appx');
// [file, width, height, icon size inside]
const TILES = [
  ['StoreLogo.png', 50, 50, 50], ['Square44x44Logo.png', 44, 44, 44], ['Square150x150Logo.png', 150, 150, 120],
  ['Wide310x150Logo.png', 310, 150, 120], ['LargeTile.png', 310, 310, 250], ['SmallTile.png', 71, 71, 60],
  ['SplashScreen.png', 620, 300, 220],
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  await win.loadURL('about:blank');
  const src = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  // one picture: w×h on the game's dark blue (or clear), the icon centred at size s
  const draw = (w, h, s, bg) => win.webContents.executeJavaScript(`new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      ${bg ? `g.fillStyle = '${bg}'; g.fillRect(0, 0, ${w}, ${h});` : ''}
      g.drawImage(img, (${w} - ${s}) / 2, (${h} - ${s}) / 2, ${s}, ${s});
      res(c.toDataURL('image/png').split(',')[1]);
    };
    img.src = ${JSON.stringify(src)};
  })`).then((b64) => Buffer.from(b64, 'base64'));
  fs.mkdirSync(APPX, { recursive: true });
  for (const [file, w, h, s] of TILES) fs.writeFileSync(path.join(APPX, file), await draw(w, h, s, w === h && w < 100 ? null : '#121a33'));
  // macOS .icns: PNG pictures of 128, 256, 512 and 1024 pixels (types ic07, ic08, ic09, ic10)
  const parts = [];
  for (const [type, size] of [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = await draw(size, size, size, null);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    parts.push(head, png);
  }
  const body = Buffer.concat(parts), top = Buffer.alloc(8);
  top.write('icns', 0, 'ascii');
  top.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.icns'), Buffer.concat([top, body]));
  console.log('icons made:', TILES.length, 'store tiles + icon.icns');
  app.exit(0);
});
