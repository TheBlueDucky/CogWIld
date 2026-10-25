// Cogwild — touch screen controls (phones, tablets, the Android app).
// In a match: a move stick on the left, drag anywhere else to look, and buttons on the right.
// They press the same keys the keyboard does, so every mode, mech and the pilot on foot just work.
// In the Workshop: drag to turn the view, pinch to zoom, tap to place, long-press a part to remove it.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const LOOK = 2.4; // touch drag pixels -> mouse pixels
  // keep getting a finger's moves even when it slides off the element (some browsers refuse odd pointers)
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ } };

  // [id, label, key, hold?] — hold buttons stay pressed while touched, the others tap once
  const BUTTONS = [
    ['fire', '💥', null, true], ['dash', '💨', 'ShiftLeft', false], ['up', '⬆', 'Space', true], ['down', '⬇', 'KeyC', true],
    ['exit', '🚪', 'KeyE', false], ['repair', '🔧', 'KeyR', true], ['unstuck', '🆘', 'KeyF', false], ['super', '⭐', 'KeyX', false], ['gadget', '🧰', 'KeyG', false],
  ];
  // where they go: the right thumb's arc (aim + fire), the left thumb (up/down above the stick), and the
  // rarely-needed ones in the bottom-middle row, away from both thumbs (Exit needs a short hold)
  const ARC = ['fire', 'super', 'gadget', 'dash'], LEFT = ['up', 'down'], AUX = ['exit', 'repair', 'unstuck'];
  const HOLD_EXIT = 0.45; // seconds
  // ☰ Menu: resume, restart, settings and quit (also skip the tutorial / back to the Workshop); the phone's Back does it too
  const SMALL = [['pause', '☰ Menu'], ['cam', '🎥'], ['scores', '📋'], ['chat', '💬']];

  class Touch {
    constructor(game) {
      this.game = game;
      this.on = false;
      this.stick = null; // { id, x0, y0, x, y }
      this.looks = new Map(); // pointerId -> last { x, y }
      this.build();
      this.bindWorkshop();
      this.apply();
    }

    detected() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
    apply() {
      const s = this.game.settings;
      this.on = s.touch === 'on' || (s.touch !== 'off' && this.detected());
      document.documentElement.classList.toggle('touch-ui', this.on);
      document.documentElement.style.setProperty('--tsize', String(s.touchSize || 1));
      if (!this.on) this.release();
    }

    build() {
      const btn = (ids, extra) => ids.map((id) => BUTTONS.find((b) => b[0] === id)).map(([id, label]) => `<button class="t-btn t-${id} ${extra || ''}" data-t="${id}" ${id === 'exit' ? 'aria-label="Hold to get out"' : ''}>${label}</button>`).join('');
      const root = document.createElement('div');
      root.id = 'touch';
      root.className = 'hidden';
      root.innerHTML = `<div id="tLook"></div>
        <div id="tStick"><div id="tKnob"></div></div>
        <div id="tBtns">${btn(ARC)}</div>
        <div id="tLeft">${btn(LEFT)}</div>
        <div id="tTop">${btn(AUX, 't-sm')}${SMALL.map(([id, label]) => `<button class="t-sm" data-t="${id}">${label}</button>`).join('')}</div>
        <div id="tChat" class="hidden">${CW.QUICK_CHAT.map((c, i) => `<button class="t-sm" data-chat="${i}">${c}</button>`).join('')}</div>`;
      $('app').appendChild(root);
      this.root = root;
      const g = this.game;
      // drag on the empty screen: look around (several fingers at once are fine)
      const look = $('tLook');
      look.addEventListener('pointerdown', (e) => { capture(look, e); this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); g.audio.ensure(); });
      look.addEventListener('pointermove', (e) => this.lookMove(e));
      const lookEnd = (e) => this.looks.delete(e.pointerId);
      look.addEventListener('pointerup', lookEnd);
      look.addEventListener('pointercancel', lookEnd);
      // the move stick appears where your left thumb lands
      const st = $('tStick');
      st.addEventListener('pointerdown', (e) => {
        capture(st, e);
        const r = st.getBoundingClientRect();
        this.stick = { id: e.pointerId, x0: r.left + r.width / 2, y0: r.top + r.height / 2, x: e.clientX, y: e.clientY };
        this.stickMove(e);
      });
      st.addEventListener('pointermove', (e) => { if (this.stick && e.pointerId === this.stick.id) this.stickMove(e); });
      const stickEnd = (e) => { if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.setMove(0, 0); $('tKnob').style.transform = ''; } };
      st.addEventListener('pointerup', stickEnd);
      st.addEventListener('pointercancel', stickEnd);
      // buttons
      root.querySelectorAll('[data-t]').forEach((b) => {
        const id = b.dataset.t;
        const def = BUTTONS.find((x) => x[0] === id);
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          capture(b, e);
          b.classList.add('down');
          g.audio.ensure();
          // getting out of your mech by accident is the worst: Exit fires only after a short hold
          if (id === 'exit') {
            b.classList.add('holding');
            clearTimeout(this.exitT);
            this.exitT = setTimeout(() => { if (b.classList.contains('holding')) { b.classList.remove('holding'); this.press(id, def, true); g.buzz(25); } }, HOLD_EXIT * 1000);
            return;
          }
          this.press(id, def, true);
          // the fire button also aims: drag it to look while shooting
          if (id === 'fire') this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        });
        b.addEventListener('pointermove', (e) => { if (id === 'fire') this.lookMove(e); });
        const up = (e) => {
          if (id === 'exit' && b.classList.contains('holding')) { b.classList.remove('holding'); clearTimeout(this.exitT); g.toast('Hold 🚪 to get out of your mech'); }
          b.classList.remove('down');
          this.press(id, def, false);
          this.looks.delete(e.pointerId);
        };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      });
      root.querySelectorAll('[data-chat]').forEach((b) => (b.onclick = () => { g.net.chat(+b.dataset.chat); $('tChat').classList.add('hidden'); }));
      root.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    press(id, def, down) {
      const g = this.game;
      if (id === 'fire') { g.mouse.left = down; return; }
      if (def) {
        const code = def[2];
        if (down) { if (!g.keys[code]) g.pressed[code] = true; g.keys[code] = true; if (!def[3]) setTimeout(() => (g.keys[code] = false), 120); }
        else if (def[3]) g.keys[code] = false;
        return;
      }
      if (!down) { if (id === 'scores') g.keys.Tab = false; return; }
      if (id === 'pause') g.pause();
      if (id === 'cam') window.dispatchEvent(new KeyboardEvent('keydown', { code: (g.settings.keys || {}).camera || 'KeyV' }));
      if (id === 'scores') g.keys.Tab = true;
      if (id === 'chat') $('tChat').classList.toggle('hidden');
    }
    lookMove(e) {
      const last = this.looks.get(e.pointerId);
      if (!last) return;
      const g = this.game;
      g.mouse.dx += (e.clientX - last.x) * LOOK;
      g.mouse.dy += (e.clientY - last.y) * LOOK;
      last.x = e.clientX; last.y = e.clientY;
    }
    stickMove(e) {
      const s = this.stick;
      const size = $('tStick').getBoundingClientRect().width / 2;
      let dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      const len = Math.hypot(dx, dy);
      if (len > size) { dx *= size / len; dy *= size / len; }
      $('tKnob').style.transform = `translate(${dx}px, ${dy}px)`;
      this.setMove(dx / size, dy / size);
    }
    // the stick presses W/A/S/D like a keyboard
    setMove(x, y) {
      const k = this.game.keys;
      k.KeyW = y < -0.3;
      k.KeyS = y > 0.45;
      k.KeyA = x < -0.4;
      k.KeyD = x > 0.4;
    }
    release() {
      const g = this.game;
      this.setMove(0, 0);
      for (const [, , code] of BUTTONS) if (code) g.keys[code] = false;
      g.keys.Tab = false;
      g.mouse.left = false;
      this.looks.clear();
      this.stick = null;
    }

    // called every frame: show the controls only while you're playing
    update() {
      const g = this.game;
      if (this.shown && g.player) {
        this.root.querySelector('.t-super').classList.toggle('ready', (g.player.superCharge || 0) >= 1);
        this.root.querySelector('.t-gadget').classList.toggle('ready', g.gadgets.left(g.player) > 0 && !(g.player.gadgetCd > 0));
      }
      const show = this.on && g.state === 'match' && !g.paused && !g.ended;
      if (show === this.shown) return;
      this.shown = show;
      this.root.classList.toggle('hidden', !show);
      $('tChat').classList.add('hidden');
      if (!show) this.release();
      // quick chat only online
      this.root.querySelector('[data-t="chat"]').classList.toggle('hidden', !g.net.active);
    }

    // ---------------- Workshop gestures ----------------
    bindWorkshop() {
      const g = this.game;
      const cv = g.renderer.domElement;
      let start = null, pinch = 0, longT = 0, handled = false;
      const ws = () => g.workshop;
      cv.addEventListener('touchstart', (e) => {
        if (!ws().active) return;
        handled = false;
        clearTimeout(longT);
        if (e.touches.length === 1) {
          const t = e.touches[0];
          start = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, moved: 0 };
          // long-press a part to remove it
          longT = setTimeout(() => {
            if (!start || start.moved > 10) return;
            handled = true;
            ws().mouse.x = start.x; ws().mouse.y = start.y;
            ws().removeAtHover();
            if (navigator.vibrate) navigator.vibrate(30);
          }, 550);
        } else if (e.touches.length === 2) {
          start = null;
          handled = true;
          pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        }
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        if (!ws().active) return;
        e.preventDefault();
        const w = ws();
        if (e.touches.length === 1 && start) {
          const t = e.touches[0];
          const dx = t.clientX - start.lx, dy = t.clientY - start.ly;
          start.moved += Math.abs(dx) + Math.abs(dy);
          start.lx = t.clientX; start.ly = t.clientY;
          if (start.moved > 10) {
            handled = true;
            w.orbit.yaw -= dx * 0.01;
            w.orbit.pitch = Math.max(-0.25, Math.min(1.45, w.orbit.pitch + dy * 0.01));
          }
        } else if (e.touches.length === 2) {
          const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          if (pinch) w.orbit.dist = Math.max(5, Math.min(26, w.orbit.dist * (pinch / d)));
          pinch = d;
        }
      }, { passive: false });
      cv.addEventListener('touchend', (e) => {
        if (!ws().active) return;
        clearTimeout(longT);
        // a drag, pinch or long-press must not also place a part (stops the browser's fake mouse click)
        if (handled) e.preventDefault();
        if (!e.touches.length) { start = null; pinch = 0; }
      }, { passive: false });
    }
  }

  CW.Touch = Touch;
})();
