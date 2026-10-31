// Runs inside the game page (tools/video): a mouse pointer drawn on top of everything for the menu video (the real
// pointer isn't in a hidden window's pictures). The recorder moves it and sends the same moves to the page, so hover
// effects and clicks are the real ones.
(() => {
  if (window.__cur) return;
  const el = document.createElement('div');
  el.id = '__cursor';
  el.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483646;pointer-events:none;transform-origin:4px 3px;will-change:transform;filter:drop-shadow(0 3px 5px rgba(0,0,0,.55))';
  el.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M4 3 L4 27 L10.5 21 L15 31.5 L19.5 29.6 L15.2 19.5 L24 19.5 Z" fill="#fff" stroke="#121a33" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(el);
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(92,225,255,.9);z-index:2147483645;pointer-events:none;opacity:0';
  document.documentElement.appendChild(ring);
  let ringT = -1, rx = 0, ry = 0;
  window.__cur = {
    // x, y = window pixels; press 0..1 squeezes the pointer a little
    set(x, y, press, hidden) {
      el.style.display = hidden ? 'none' : 'block';
      el.style.transform = `translate(${x - 4}px, ${y - 3}px) scale(${1 - 0.14 * (press || 0)})`;
      if (ringT >= 0) {
        ringT += 1 / 60;
        const k = Math.min(1, ringT / 0.35);
        ring.style.opacity = String(1 - k);
        ring.style.transform = `translate(${rx}px, ${ry}px) scale(${0.4 + k * 0.9})`;
        if (k >= 1) ringT = -1;
      }
    },
    click(x, y) { ringT = 0; rx = x; ry = y; },
    // the middle of an element, in window pixels (CSS zoom included)
    at(sel, dx, dy) {
      const e = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width * (0.5 + (dx || 0)), y: r.top + r.height * (0.5 + (dy || 0)), w: r.width, h: r.height };
    },
  };
})();
