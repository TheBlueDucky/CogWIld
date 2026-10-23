// Cogwild — picking your own profile picture (or your club's): choose an image on your device, move and zoom it
// in a square (shown as a circle, like most chat apps), and it's sent as a small square JPEG (server/pics.js).
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const VIEW = 280; // the crop square on screen (CSS pixels)
  const OUT = 256; // the picture that's sent

  let st = null; // { img, base, zoom, x, y, done }

  function draw() {
    const cv = $('cropCv'), g = cv.getContext('2d');
    g.fillStyle = '#121a33';
    g.fillRect(0, 0, VIEW, VIEW);
    const k = st.base * st.zoom;
    g.drawImage(st.img, VIEW / 2 + st.x - (st.img.width * k) / 2, VIEW / 2 + st.y - (st.img.height * k) / 2, st.img.width * k, st.img.height * k);
  }
  // the picture always fills the square
  function clamp() {
    const k = st.base * st.zoom;
    const mx = Math.max(0, (st.img.width * k - VIEW) / 2), my = Math.max(0, (st.img.height * k - VIEW) / 2);
    st.x = Math.max(-mx, Math.min(mx, st.x));
    st.y = Math.max(-my, Math.min(my, st.y));
  }
  function close() { $('picCrop').classList.add('hidden'); st = null; }
  // the square as a JPEG, base64 (made smaller if it's still big)
  function result() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = OUT;
    const g = cv.getContext('2d');
    const f = OUT / VIEW, k = st.base * st.zoom * f;
    g.fillStyle = '#121a33';
    g.fillRect(0, 0, OUT, OUT);
    g.imageSmoothingQuality = 'high';
    g.drawImage(st.img, OUT / 2 + st.x * f - (st.img.width * k) / 2, OUT / 2 + st.y * f - (st.img.height * k) / 2, st.img.width * k, st.img.height * k);
    for (const q of [0.88, 0.78, 0.65, 0.5]) {
      const b64 = cv.toDataURL('image/jpeg', q).split(',')[1];
      if (b64.length < 80000) return b64;
    }
    return null;
  }

  function build() {
    const box = document.createElement('div');
    box.id = 'picCrop';
    box.className = 'hidden';
    box.innerHTML = `<div class="confirm-box crop-box" role="dialog" aria-modal="true" aria-labelledby="cropTitle">
      <h2 id="cropTitle">Your picture</h2>
      <div class="crop-area"><canvas id="cropCv" width="${VIEW}" height="${VIEW}"></canvas><div class="crop-ring"></div></div>
      <label class="crop-zoom">➖<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1">➕</label>
      <div class="small">Drag to move it, zoom to fit. It's shown as a circle.</div>
      <div class="confirm-btns"><button id="cropNo" class="ws-btn">Cancel</button><button id="cropOk" class="ws-btn on">Use this picture</button></div>
    </div>`;
    $('app').appendChild(box);
    const cv = $('cropCv');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (!st) return; drag = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !st) return;
      // the box may be scaled (the UI zoom): move by what's seen
      const s = VIEW / cv.getBoundingClientRect().width;
      st.x = drag.ox + (e.clientX - drag.x) * s;
      st.y = drag.oy + (e.clientY - drag.y) * s;
      clamp();
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { if (!st) return; e.preventDefault(); st.zoom = Math.max(1, Math.min(4, st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); $('cropZoom').value = st.zoom; clamp(); draw(); }, { passive: false });
    $('cropZoom').oninput = (e) => { if (!st) return; st.zoom = +e.target.value; clamp(); draw(); };
    $('cropNo').onclick = close;
    $('cropOk').onclick = () => {
      if (!st) return;
      const b64 = result(), done = st.done;
      close();
      if (!b64) return window.game && window.game.toast("That picture couldn't be used. Try another one.");
      done(b64);
    };
    CW.tapOutside(box, close);
  }

  // choose a picture, crop it, then done(base64 JPEG)
  CW.pickPicture = (done) => {
    if (!$('picCrop')) build();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) return window.game && window.game.toast('That picture is too big (20 MB max)');
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); CW.cropImage(img, done); };
      img.onerror = () => { URL.revokeObjectURL(url); if (window.game) window.game.toast("That file isn't a picture the game can read"); };
      img.src = url;
    };
    input.click();
  };
  // the cropper for a loaded image
  CW.cropImage = (img, done) => {
    if (!$('picCrop')) build();
    st = { img, base: VIEW / Math.min(img.width, img.height), zoom: 1, x: 0, y: 0, done };
    $('cropZoom').value = 1;
    draw();
    $('picCrop').classList.remove('hidden');
  };
  CW.closePicCrop = () => { if ($('picCrop') && !$('picCrop').classList.contains('hidden')) { close(); return true; } return false; };
})();
