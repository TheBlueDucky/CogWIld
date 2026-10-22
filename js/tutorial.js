// Cogwild — interactive tutorial: a guided practice run that teaches the basics step by step
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const REWARD = 150;

  // Each step: text shown to the player, and a check() that turns true when they've done it
  const STEPS = [
    { title: 'Look around', text: 'Move the <b>mouse</b> to look around. (Click the game first so it captures your mouse.)', init: (t) => { t.yaw0 = t.game.cam.yaw; t.pitch0 = t.game.cam.pitch; }, check: (t) => Math.abs(t.game.cam.yaw - t.yaw0) + Math.abs(t.game.cam.pitch - t.pitch0) > 1.2 },
    { title: 'Drive', text: 'Hold <b>W</b> to drive forward (<b>S</b> brakes and reverses).', init: (t) => { t.p0 = t.mech().pos.clone(); }, check: (t) => t.mech().pos.distanceTo(t.p0) > 15 },
    { title: 'Steer', text: 'Turn with <b>A / D</b>, or just <b>look where you want to go</b> while holding W: auto-steer follows your view.', init: (t) => { t.turned = 0; t.lastYaw = t.mech().yaw; }, tick: (t) => { const m = t.mech(); t.turned += Math.abs(m.yaw - t.lastYaw); t.lastYaw = m.yaw; }, check: (t) => t.turned > 2.2 },
    { title: 'Shoot', text: 'Aim the crosshair at a grey <b>Target</b> mech and <b>click</b> (hold) to fire.', init: (t) => { t.hits = 0; }, check: (t) => t.hits >= 8 },
    { title: 'Dash', text: 'Press <b>Shift</b> to DASH: a burst of speed with a cooldown. Use it to dodge or charge.', init: (t) => { t.dashed = false; }, check: (t) => t.dashed },
    { title: 'Power-up', text: 'Drive into the glowing <b>green gem</b> ahead (also on your minimap) to grab a Repair Kit.', init: (t) => t.placePickup(), check: (t) => t.pickup && !t.pickup.active },
    { title: 'Get out', text: 'Press <b>E</b> to jump out of your mech. If your mech gets wrecked, you keep fighting on foot!', check: (t) => !!t.game.player.pilot },
    { title: 'Get back in', text: 'Walk back with <b>WASD</b> and press <b>E</b> next to your mech to climb in. (Hold <b>R</b> next to it to repair.)', check: (t) => t.game.player.mech.occupied && !t.game.player.pilot },
    { title: 'Wreck it!', text: 'Destroy a Target mech\'s <b>Core</b> (the yellow block) to wreck it. Parts break off one by one!', init: (t) => { t.wrecked = false; }, check: (t) => t.wrecked },
  ];

  class Tutorial {
    constructor(game) {
      this.game = game;
      this.active = false;
    }
    mech() { return this.game.player.mech; }

    start() {
      const g = this.game;
      this.i = -1;
      g.startTestDrive(CW.cloneBp(CW.PRESETS[0]), 'tutorial');
      this.active = true;
      g.pickups.clear();
      $('tut').classList.remove('hidden');
      $('tutSkip').onclick = () => this.finish(false);
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
      $('tutStep').textContent = `Step ${this.i + 1} / ${STEPS.length}`;
      $('tutTitle').textContent = s.title;
      $('tutText').innerHTML = s.text;
      $('tutBar').style.width = (this.i / STEPS.length) * 100 + '%';
      this.game.audio.click(1.2);
    }

    // called every frame by the game while the tutorial runs
    update() {
      if (!this.active || this.game.state !== 'match') return;
      const s = STEPS[this.i];
      if (!s) return;
      if (s.tick && this.mech().alive) s.tick(this);
      if (this.mech().alive && s.check(this)) {
        this.game.fx.burst(this.mech().pos, { n: 14, color: this.game.fx.colorKey(0x7bc950), speed: 6, life: 0.6, size: 0.3 });
        this.game.announce('✔ ' + s.title.toUpperCase(), '');
        this.next();
      }
    }

    // hooks from the game
    onHit() { this.hits = (this.hits || 0) + 1; }
    onDash() { this.dashed = true; }
    onWreck() { this.wrecked = true; }

    finish(done) {
      const g = this.game;
      this.active = false;
      $('tut').classList.add('hidden');
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
