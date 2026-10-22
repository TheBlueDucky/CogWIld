'use strict';
// show each download's size, and grey out any file that isn't on the server yet
document.querySelectorAll('[data-file]').forEach(async (el) => {
  const file = el.dataset.file;
  try {
    const r = await fetch('downloads/' + file, { method: 'HEAD' });
    if (!r.ok) throw new Error('missing');
    const mb = (+r.headers.get('content-length') / 1048576).toFixed(0);
    const s = el.querySelector('.size') || (el.matches('a') ? el.querySelector('.size') : null);
    if (s) s.textContent = `(${mb} MB)`;
  } catch (e) {
    (el.matches('a') ? el : el.querySelector('.btn')).classList.add('missing');
  }
});
