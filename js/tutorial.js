// Cogwild — interactive tutorial: a guided practice run that teaches the basics step by step.
// A small see-through card at the top says what to do (with the keys to press on a PC, lighting up as you press them),
// and a big arrow points at what to do it with: the Target mech, the gem, your mech, or the button on a phone.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const REWARD = 150;
  // keys shown on the card: label -> the key the game reads
  const KEY = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', E: 'KeyE', Shift: 'ShiftLeft' };

  // the nearest Target mech that's still standing (and its Core, for the last step)
  const nearestTarget = (t, core) => {
    const me = t.mech().pos;
    let best = null, bd = Infinity;
    for (const c of t.game.combatants) {
      if (c === t.game.player || !c.mech || !c.mech.alive || !/^Target/.test(c.name || '')) continue;
      const d = c.mech.pos.distanceTo(me);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    return core && best.mech.core && best.mech.core.alive ? best.mech.core.wp : best.mech.pos.clone().add(new V3(0, 1.5, 0));
  };

  // Each step: what to do (PC / phone), the keys on a PC, where the arrow points (a phone button and/or something in
  // the world), how far along you are (0..1), and check() that turns true when it's done
  const STEPS = [
    { icon: '👀', title: 'Look around', pc: 'Click the game, then move your <b>mouse</b> to look around.', phone: '<b>Drag</b> your finger on the right side of the screen to look around.',
      keys: ['🖱 Mouse'], touch: '#tLook', label: 'drag here',
      init: (t) => { t.yaw0 = t.game.cam.yaw; t.pitch0 = t.game.cam.pitch; }, amount: (t) => (Math.abs(t.game.cam.yaw - t.yaw0) + Math.abs(t.game.cam.pitch - t.pitch0)) / 1.2 },
    { icon: '🚗', title: 'Drive', pc: 'Hold <b>W</b> to drive forward. <b>S</b> brakes and backs up.', phone: 'Push the <b>stick</b> up to drive forward.',
      keys: ['W', 'S'], touch: '#tStick', label: 'push up',
      init: (t) => { t.p0 = t.mech().pos.clone(); }, amount: (t) => t.mech().pos.distanceTo(t.p0) / 15 },
    { icon: '↩', title: 'Steer', pc: 'Keep holding <b>W</b> and press <b>A</b> or <b>D</b> to turn (or just look where you want to go).', phone: 'Push the <b>stick</b> left or right to turn.',
      keys: ['A', 'W', 'D'], touch: '#tStick', label: 'left / right',
      init: (t) => { t.turned = 0; t.lastYaw = t.mech().yaw; }, tick: (t) => { const m = t.mech(); t.turned += Math.abs(m.yaw - t.lastYaw); t.lastYaw = m.yaw; }, amount: (t) => t.turned / 2.2 },
    { icon: '🎯', title: 'Shoot', pc: 'Put the <b>+</b> on the grey <b>Target</b> mech and <b>hold the left mouse button</b>.', phone: 'Look at the grey <b>Target</b> and <b>hold 💥</b> to fire.',
      keys: ['🖱 Left click'], touch: '.t-fire', world: (t) => nearestTarget(t), worldLabel: 'Target',
      init: (t) => { t.hits = 0; }, amount: (t) => t.hits / 8 },
    { icon: '💨', title: 'Dash', pc: 'Press <b>Shift</b> to dash: a burst of speed to dodge or charge.', phone: 'Tap <b>💨</b> to dash: a burst of speed.',
      keys: ['Shift'], touch: '.t-dash', label: 'tap',
      init: (t) => { t.dashed = false; }, amount: (t) => (t.dashed ? 1 : 0) },
    { icon: '💚', title: 'Power-up', pc: 'Drive into the glowing <b>green gem</b> to grab a Repair Kit.', phone: 'Drive into the glowing <b>green gem</b> to grab a Repair Kit.',
      keys: ['W', 'A', 'D'], touch: '#tStick', world: (t) => (t.pickup && t.pickup.active ? t.pickup.pos : null), worldLabel: 'Gem',
      init: (t) => t.placePickup(), amount: (t) => (t.pickup && !t.pickup.active ? 1 : 0) },
    { icon: '🚪', title: 'Get out', pc: 'Press <b>E</b> to jump out of your mech. If it gets wrecked, you keep fighting on foot!', phone: '<b>Hold 🚪</b> to jump out of your mech.',
      keys: ['E'], touch: '.t-exit', label: 'hold',
      amount: (t) => (t.game.player.pilot ? 1 : 0) },
    { icon: '🔙', title: 'Get back in', pc: 'Walk to your mech with <b>W A S D</b>, then press <b>E</b> next to it.', phone: 'Walk to your mech with the <b>stick</b>, then <b>hold 🚪</b> next to it.',
      keys: ['W', 'A', 'S', 'D', 'E'], touch: '.t-exit', world: (t) => (t.game.player.pilot ? t.mech().pos.clone().add(new V3(0, 1.5, 0)) : null), worldLabel: 'Your mech',
      amount: (t) => (t.game.player.mech.occupied && !t.game.player.pilot ? 1 : 0) },
    { icon: '💥', title: 'Wreck it!', pc: 'Shoot a Target\'s yellow <b>Core</b> until the mech breaks apart.', phone: 'Shoot a Target\'s yellow <b>Core</b> (hold 💥) until it breaks apart.',
      keys: ['🖱 Left click'], touch: '.t-fire', world: (t) => nearestTarget(t, true), worldLabel: 'Core',
      init: (t) => { t.wrecked = false; }, amount: (t) => (t.wrecked ? 1 : 0) },
  ];

  class Tutorial {
    constructor(game) {
      this.game = game;
      this.active = false;
    }
    mech() { return this.game.player.mech; }
    get phone() { return !!(this.game.touch && this.game.touch.on); }

    start() {
      const g = this.game;
      this.i = -1;
      g.startTestDrive(CW.cloneBp(CW.PRESETS[0]), 'tutorial');
      this.active = true;
      g.pickups.clear();
      $('tut').classList.remove('hidden');
      $('tutSkip').onclick = () => this.finish(false);
      $('tutDots').innerHTML = STEPS.map(() => '<i></i>').join('');
      this.next();
    }

    placePickup() {
      const m = this.mech();
      const fwd = new V3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
      let pos = m.pos.clone().addScaledVector(fwd, 18);
      if (this.game.world.groundAt(pos.x, pos.z) < 1) pos = m.pos.clone().add(new V3(6, 0, 6));
      this.game.pickups.add(pos, 'repair');
      this.pickup = this.game.pickups.items[this.game.pickups.items.length - 1];
      this.pickup.respawn = 9999;
    }

    next() {
      this.i++;
      if (this.i >= STEPS.length) return this.finish(true);
      const s = STEPS[this.i];
      if (s.init) s.init(this);
      $('tutStep').textContent = `${this.i + 1} / ${STEPS.length}`;
      $('tutIco').textContent = s.icon;
      $('tutTitle').textContent = s.title;
      $('tutText').innerHTML = this.phone ? s.phone : s.pc;
      // the keys to press (a PC); they light up while pressed
      $('tutKeys').innerHTML = this.phone ? '' : s.keys.map((k) => `<kbd ${KEY[k] ? `data-k="${KEY[k]}"` : ''} class="${k.length > 2 ? 'wide' : ''}">${k}</kbd>`).join('');
      $('tutKeys').classList.toggle('hidden', this.phone);
      [...$('tutDots').children].forEach((d, n) => { d.className = n < this.i ? 'done' : n === this.i ? 'now' : ''; });
      $('tutBar').style.width = '0%';
      $('tut').classList.remove('bump');
      void $('tut').offsetWidth;
      $('tut').classList.add('bump');
      this.game.audio.click(1.2);
    }

    // called every frame by the game while the tutorial runs
    update() {
      if (!this.active || this.game.state !== 'match') return;
      const s = STEPS[this.i];
      if (!s) return;
      if (s.tick && this.mech().alive) s.tick(this);
      const done = Math.max(0, Math.min(1, s.amount(this) || 0));
      $('tutBar').style.width = Math.round(done * 100) + '%';
      for (const k of $('tutKeys').querySelectorAll('[data-k]')) k.classList.toggle('down', !!this.game.keys[k.dataset.k]);
      this.point(s);
      if (this.mech().alive && done >= 1) {
        this.game.fx.burst(this.mech().pos, { n: 14, color: this.game.fx.colorKey(0x7bc950), speed: 6, life: 0.6, size: 0.3 });
        this.game.announce('✔ ' + s.title.toUpperCase(), '');
        this.next();
      }
    }

    // the arrow: at something in the world (on screen: above it; off screen: at the edge, pointing its way), otherwise
    // at the phone button to use (with a pulsing ring around it)
    point(s) {
      const arrow = $('tutArrow'), ring = $('tutRing');
      const V = this.game.view || { x: 0, y: 0, w: innerWidth, h: innerHeight }, W = V.w, H = V.h;
      let at = null, label = '', edge = false, angle = 90; // angle: the way the arrow points (90 = down)
      const target = s.world && s.world(this);
      if (target) {
        const v = target.clone().project(this.game.camera);
        const behind = v.z > 1;
        let x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
        if (behind) { x = W - x; y = H - y; }
        const pad = 70;
        if (!behind && x > pad && x < W - pad && y > pad + 40 && y < H - pad) { at = { x, y: y - 46 }; angle = 90; }
        else {
          // off screen: at the edge, pointing at it
          const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
          const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
          at = { x: cx + dx * k, y: cy + dy * k };
          angle = Math.atan2(dy, dx) * 180 / Math.PI;
          edge = true;
        }
        label = s.worldLabel;
      }
      const el = this.phone && s.touch && !target ? document.querySelector('#touch:not(.hidden) ' + s.touch) : null;
      if (el && el.offsetParent !== null) {
        const b = el.getBoundingClientRect(), r = { left: b.left - V.x, top: b.top - V.y, width: b.width, height: b.height };
        if (s.touch === '#tLook') {
          // the look area is the whole right side: point at its middle
          at = { x: r.left + r.width * 0.55, y: r.top + r.height * 0.45 };
          angle = 0;
          ring.classList.add('hidden');
        } else {
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = Math.max(r.width, r.height) / 2;
          // the arrow sits on the screen-centre side of the button, pointing at it (above the stick: the ⬆ button is beside it)
          let dx = W / 2 - cx, dy = H / 2 - cy;
          if (s.touch === '#tStick') { dx = 0; dy = -1; }
          const len = Math.hypot(dx, dy) || 1;
          dx /= len; dy /= len;
          at = { x: cx + dx * (rad + 46), y: cy + dy * (rad + 46) };
          angle = Math.atan2(-dy, -dx) * 180 / Math.PI;
          Object.assign(ring.style, { left: cx - rad - 8 + 'px', top: cy - rad - 8 + 'px', width: rad * 2 + 16 + 'px', height: rad * 2 + 16 + 'px' });
          ring.classList.remove('hidden');
        }
        // the card says what to do: no label next to phone buttons (it would cover the buttons around them)
        label = s.touch === '#tLook' ? s.label : '';
      } else ring.classList.add('hidden');
      arrow.classList.toggle('hidden', !at);
      if (!at) return;
      arrow.classList.toggle('edge', edge);
      arrow.style.left = at.x + 'px';
      arrow.style.top = at.y + 'px';
      $('tutArrowIco').style.transform = `rotate(${angle}deg)`;
      $('tutArrowLbl').textContent = label;
    }

    // hooks from the game
    onHit() { this.hits = (this.hits || 0) + 1; }
    onDash() { this.dashed = true; }
    onWreck() { this.wrecked = true; }

    finish(done) {
      const g = this.game;
      this.active = false;
      $('tut').classList.add('hidden');
      $('tutArrow').classList.add('hidden');
      $('tutRing').classList.add('hidden');
      if (done) {
        if (!g.settings.tutorialDone) {
          g.meta.addCoins(REWARD);
          g.toast(`🎓 Tutorial complete! +${REWARD} 🪙`);
        } else g.toast('🎓 Tutorial complete!');
        g.settings.tutorialDone = true;
        g.saveProfile();
        g.confetti();
        setTimeout(() => g.toast('Next: build your own mech in the Workshop, or hit PLAY!'), 2400);
      } else {
        g.settings.tutorialDone = true;
        g.saveProfile();
      }
      g.showMenu();
    }
  }

  CW.Tutorial = Tutorial;
})();
