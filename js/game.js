// Cogwild — game flow, modes, teams, input, camera, bots, HUD, audio
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // wrap an angle to -PI..PI (no loops, so a bad value can never hang the game)
  const wrap = (a) => (Number.isFinite(a) ? ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI : 0);
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const esc = CW.esc;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const BOT_NAMES = ['Rustbucket', 'Gearhead', 'Sprocket', 'Clunker', 'Torque', 'Widget', 'Ratchet'];
  const BOT_COLORS = [0xff006e, 0xfb5607, 0x8338ec, 0x06d6a0, 0xffbe0b, 0xe63946, 0x00b4d8, 0x3a86ff];
  const TEAMS = [
    { name: 'Blue', color: 0x3a86ff },
    { name: 'Red', color: 0xff3b5c },
    { name: 'Green', color: 0x2ec27e },
    { name: 'Gold', color: 0xffbe0b },
  ];
  const FOUR = ['duel', 'squads', 'quads', 'ffa'];
  const MODES = {
    rush: { name: 'Rush Build', icon: '⏱', sub: 'Build from scratch in the match', color: '#ff8c42', fromScratch: true, buildTime: 75, budget: CW.ECON.RUSH_BUDGET, formats: FOUR, desc: 'Everyone starts with just a Core. Build from scratch in 75 seconds, then fight. Your Workshop mechs stay at home.' },
    clash: { name: 'Workshop Clash', icon: '🔧', sub: 'Use the mech you built in the lobby', color: '#3a86ff', fromScratch: false, formats: FOUR, desc: 'Bring a mech you built in the Workshop. No building during the match: your design is everything.' },
    koth: { name: 'King of the Hill', icon: '👑', sub: 'Hold the zone · respawns on', color: '#ffd23f', objective: 'koth', respawn: true, timeLimit: 240, scoreToWin: 100, formats: FOUR, desc: 'Stand in the glowing zone to score. It moves every minute. Wrecked? You respawn in 4 seconds.' },
    gold: { name: 'Gold Rush', icon: '💰', sub: 'Grab the most gold · respawns on', color: '#f4a261', objective: 'gold', respawn: true, timeLimit: 180, scoreToWin: 40, formats: FOUR, desc: 'Collect gold nuggets all over the map. Wreck enemies and they spill half their gold. Richest team wins.' },
    race: { name: 'Combat Race', icon: '🏁', sub: '2 laps · weapons on', color: '#4cc9f0', objective: 'race', respawn: true, respawnDelay: 2.5, timeLimit: 300, laps: 2, formats: ['race'], desc: 'Fly, drive or swim through 8 checkpoints, twice. Shoot your rivals off course. Fast designs win!' },
    bounty: { name: 'Bounty Hunt', icon: '🎯', sub: 'Wrecks win stars · respawns on', color: '#ff4d6d', objective: 'bounty', respawn: true, timeLimit: 150, scoreToWin: 30, formats: FOUR, desc: 'Wreck enemies to win the stars on their head. Every wreck in a row makes YOUR bounty bigger, and being wrecked resets it. Most stars wins!' },
    survival: { name: 'Survival', icon: '🛡', sub: 'Endless waves · bring your mech', color: '#e63946', fromScratch: false, survival: true, formats: ['solo', 'squad'], desc: 'Endless waves of bots that get bigger and meaner. Your mech is rebuilt between waves. How far can you get?' },
    boss: { name: 'Boss Battle', icon: '👹', sub: 'Take down the giant Titan', color: '#9d0208', objective: 'boss', respawn: true, respawnDelay: 5, lives: 3, timeLimit: 360, formats: ['solo', 'squad'], desc: 'A giant armored Titan and its minions. You get 3 lives each. Break its core before time runs out!' },
  };
  const FORMATS = {
    duel: { name: 'Duel', label: '1v1', teams: [1, 1] },
    squads: { name: 'Squads', label: '3v3', teams: [3, 3] },
    quads: { name: 'Quads', label: '2v2v2v2', teams: [2, 2, 2, 2] },
    ffa: { name: 'Free-for-all', label: '8 players', teams: [1, 1, 1, 1, 1, 1, 1, 1] },
    solo: { name: 'Solo', label: 'You alone', teams: [1], survival: true },
    squad: { name: 'Squad', label: 'You + 2 bots', teams: [3], survival: true },
    race: { name: 'Race', label: '6 racers', teams: [1, 1, 1, 1, 1, 1], survival: true },
  };
  const SUDDEN_DEATH = 240;
  const COOP = ['solo', 'squad'];
  CW.MODES = MODES; CW.FORMATS = FORMATS; CW.TEAMS = TEAMS;
  // what PLAY plays in each mode (the server uses the same table)
  CW.MM_FORMAT = { clash: 'ffa', rush: 'ffa', koth: 'squads', gold: 'squads', bounty: 'squads', race: 'race', boss: 'squad', survival: 'squad' };

  // ---------------- tiny synth audio ----------------
  class Audio {
    constructor() { this.ctx = null; this.vol = 0.35; }
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      // browsers keep sound paused until the first click/tap/key; the apps allow it right away
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }
    tone(freq, dur, type, vol, slide) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      g.gain.setValueAtTime(vol * this.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    }
    noise(dur, vol, filt) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // at most ~10 noise sounds per 0.1 s (a mech melting in lava can trigger dozens)
      if (this.noiseWindow !== Math.floor(t * 10)) { this.noiseWindow = Math.floor(t * 10); this.noiseCount = 0; }
      if (++this.noiseCount > 10) return;
      // fading-noise buffers are cached by length instead of rebuilt every time
      const key = Math.max(1, Math.round(dur * 20));
      this.noiseBufs = this.noiseBufs || {};
      let buf = this.noiseBufs[key];
      if (!buf) {
        const len = Math.floor((this.ctx.sampleRate * key) / 20);
        buf = this.noiseBufs[key] = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt;
      const g = this.ctx.createGain(); g.gain.value = vol * this.vol;
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start(t);
    }
    // k = loudness (1 = your own gun; other mechs' shots are quieter the farther away they are)
    shot(kind, k = 1) {
      if (k < 0.04) return;
      if (kind === 'rail') { this.tone(1400, 0.35, 'sawtooth', 0.12 * k, 0.15); this.noise(0.25, 0.3 * k, 3000); return; }
      if (kind === 'flame') { if (Math.random() < 0.25) this.noise(0.15, 0.12 * k, 700); return; }
      if (kind === 'shell') { this.noise(0.05, 0.42 * k, 2600); this.tone(150, 0.07, 'triangle', 0.2 * k, 0.45); } // a gunshot: crack + thump
      else if (kind === 'rocket') this.noise(0.3, 0.25 * k, 900);
      else this.tone(880, 0.07, 'sawtooth', 0.08 * k, 0.5);
    }
    near(pos) {
      const g = window.game;
      return g && g.camera ? clamp(1 - g.camera.position.distanceTo(pos) / 55, 0, 1) * 0.3 : 0;
    }
    boom(size, pos) {
      const g = window.game;
      let k = 1;
      if (g && g.camera && pos) k = clamp(1 - g.camera.position.distanceTo(pos) / 160, 0, 1);
      if (k > 0.02) this.noise(0.25 + size * 0.25, 0.5 * k * Math.min(1.5, size), 300 + size * 200);
    }
    click(v) { this.tone(500 + v * 300, 0.05, 'triangle', 0.15); }
    whoosh() { this.noise(0.35, 0.3, 1800); this.tone(180, 0.3, 'sine', 0.15, 2.5); }
    fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.08), i * 70)); }
    ram() { this.noise(0.2, 0.5, 600); this.tone(90, 0.2, 'sawtooth', 0.2, 0.5); }
    // continuous engine hum for the player's mech: pitch follows speed, loudness follows throttle
    engine(speed, throttle, kind) {
      if (!this.ctx) return;
      if (!this.eng) {
        const ctx = this.ctx;
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'square';
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
        const g = ctx.createGain(); g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g).connect(ctx.destination);
        o1.start(); o2.start();
        this.eng = { o1, o2, f, g };
      }
      const t = this.ctx.currentTime;
      const base = kind === 'air' ? 95 : kind === 'water' ? 48 : 38;
      const freq = base + Math.min(60, speed) * (kind === 'air' ? 2.2 : 1.6);
      this.eng.o1.frequency.setTargetAtTime(freq, t, 0.08);
      this.eng.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.08);
      this.eng.f.frequency.setTargetAtTime(300 + Math.abs(throttle) * 500 + speed * 8, t, 0.1);
      const vol = speed < 0 ? 0 : (0.02 + Math.abs(throttle) * 0.05 + Math.min(1, speed / 30) * 0.03) * this.vol;
      this.eng.g.gain.setTargetAtTime(vol, t, 0.1);
    }
    engineOff() { if (this.eng) this.eng.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
    pickup() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'triangle', 0.12), i * 50)); }
    hit() { this.tone(1300, 0.04, 'square', 0.06); }
  }

  // ======================= GAME =======================
  class Game {
    constructor() {
      window.game = this;
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      $('app').prepend(this.renderer.domElement);
      this.renderer.domElement.id = 'gl';

      this.scene = new THREE.Scene();
      this.skyColor = new THREE.Color(0x9fd8ff);
      this.waterFog = new THREE.Color(0x1f6fa8);
      this.scene.background = this.skyColor.clone();
      this.scene.fog = new THREE.Fog(0x9fd8ff, 140, 430);
      this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1200);
      this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 0.65);
      this.scene.add(this.hemi);
      // headlight that follows your view (used at sunset / night)
      this.headlight = new THREE.SpotLight(0xfff1d6, 0, 90, 0.55, 0.5, 1.2);
      this.scene.add(this.headlight, this.headlight.target);
      const sun = new THREE.DirectionalLight(0xfff4e0, 0.95);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
      sun.shadow.bias = -0.0008;
      this.sun = sun;
      this.scene.add(sun, sun.target);

      this.audio = new Audio();
      this.time = 0;
      this.world = new CW.World(this.scene, 'canyon');
      this.fx = new CW.Fx(this);
      this.mechs = [];
      this.pilots = [];
      this.combatants = [];
      this.playerColor = 0x3a86ff;

      this.profile = Object.assign({ xp: 0 }, store.get('cogwild.profile', {}));
      delete this.profile.unlockAll; // the old "unlock all ranks" test switch is gone: everyone levels up the same way
      this.profile.saveVersion = CW.SAVE_VERSION; // older saves only gain fields, so no migration needed yet
      this.blueprints = store.get('cogwild.blueprints', []);
      this.currentBp = store.get('cogwild.current', null) || CW.cloneBp(CW.PRESETS[0]);

      this.keys = {};
      this.keymap = {};
      this.pressed = {};
      this.mouse = { dx: 0, dy: 0, left: false };
      this.cam = { yaw: 0, pitch: -0.15, pos: new V3(), aim: new V3(), shake: 0, fovKick: 0, speedFov: 0 };
      this.meta = new CW.Meta(this);
      this.pickups = new CW.Pickups(this);
      this.chests = new CW.Chests(this);
      this.tutorial = new CW.Tutorial(this);
      this.clips = new CW.Clips(this);
      this.gamepad = new CW.Gamepad(this);
      this.afterRender = () => { if (this.state === 'match') this.clips.frame(); };
      this.music = new CW.Music(this.audio);
      this.workshop = new CW.Workshop(this);
      this.netSeq = 0;
      this.net = new CW.Net(this);
      this.account = new CW.Account(this);
      this.talk = new CW.Talk(this); // the chat window (js/talk.js)
      this.voice = new CW.Voice(this); // voice chat (js/voice.js)
      this.touch = new CW.Touch(this);
      this.supers = new CW.Supers(this);
      this.gadgets = new CW.Gadgets(this);
      this.bindInput();
      this.bindMenus();
      this.bindShowcase();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.applySettings();
      this.world.applyTime('day', this);
      this.showMenu();
      // lobby music from the start: plays at once where sound is allowed (the apps), otherwise on the first touch
      this.audio.ensure();
      this.updateMusic();
      const unlock = () => {
        this.audio.ensure();
        this.updateMusic();
        if (this.audio.ctx && this.audio.ctx.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, unlock, true);
      };
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, true);
      // The game never pauses. Hidden windows get no screen refreshes, so a worker timer keeps the game
      // running (without drawing) until it's back. Phones mute while you're in another app; the website
      // and the Windows app keep their music playing.
      const phone = CW.APP === 'android' || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      document.addEventListener('visibilitychange', () => {
        this.headless = document.hidden;
        this.backgroundTicks(document.hidden);
        const ctx = this.audio.ctx;
        if (phone && ctx) (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {});
      });
      this.last = performance.now();
      this.loop(performance.now()); // starts the screen-refresh loop
    }

    // ---------------- profile ----------------
    // leveling gets slower as you go: level 2 at 150 XP, then each level needs 100 XP more than the last
    // (level 3 at 400, level 6 at 1,750, level 10 at ~5,000)
    xpFor(level) { const n = level - 1; return 150 * n + 50 * n * (n - 1); }
    level() { let lv = 1; while (this.xpFor(lv + 1) <= this.profile.xp) lv++; return lv; }
    // XP into this level and XP this level needs
    levelProgress() { const lv = this.level(), base = this.xpFor(lv); return { have: this.profile.xp - base, need: this.xpFor(lv + 1) - base }; }
    rankIndex() {
      const lv = this.level();
      let r = 0;
      CW.RANKS.forEach((rk, i) => { if (lv >= rk.level) r = i; });
      return r;
    }
    allowedDomains() { return CW.RANKS[this.rankIndex()].domains; }
    // every save is also backed up to the player's account (a few seconds later)
    saveProfile() { store.set('cogwild.profile', this.profile); if (this.account) this.account.markDirty(); }
    get settings() { return this.profile.settings; }
    applySettings() {
      this.applyGraphics();
      this.buildKeymap();
      if (this.touch) this.touch.apply();
      this.audio.vol = 0.6 * this.settings.volume;
      if (this.music) {
        this.music.volume = 0.3 * this.settings.volume * (this.settings.musicVol ?? 1);
        if (!this.settings.music) this.music.stop();
        else this.updateMusic();
      }
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
    // Settings > Keys: pressed key -> the default key the game reads ('-' = a default key that now does nothing)
    buildKeymap() {
      const keys = this.settings.keys || {};
      const map = {};
      for (const a of CW.KEY_ACTIONS) { const b = keys[a.id]; if (b && b !== a.def) map[b] = a.def; }
      for (const a of CW.KEY_ACTIONS) { const b = keys[a.id]; if (b && b !== a.def && !(a.def in map)) map[a.def] = '-'; }
      this.keymap = map;
    }
    toggleFullscreen() {
      const d = document;
      try {
        if (d.fullscreenElement) d.exitFullscreen();
        else {
          const r = (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen).call(d.documentElement);
          if (r && r.catch) r.catch(() => this.toast('Fullscreen is not available here'));
        }
      } catch (e) { this.toast('Fullscreen is not available here'); }
    }

    // Graphics levels: resolution, shadows, grass and view distance
    applyGraphics() {
      const s = this.settings;
      const guess = (navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android/i.test(navigator.userAgent) ? 'low' : 'medium';
      const lvl = s.graphics === 'auto' ? this.autoGfx || guess : s.graphics;
      if (lvl === this.gfx) return;
      this.gfx = lvl;
      const pr = { low: 0.75, medium: 1, high: Math.min(window.devicePixelRatio || 1, 2) }[lvl];
      this.renderer.setPixelRatio(pr);
      this.resize();
      const shadows = lvl !== 'low';
      const size = lvl === 'high' ? 2048 : 1024;
      this.renderer.shadowMap.enabled = shadows;
      this.sun.castShadow = shadows;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      this.world.setDetail(lvl);
      this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    }

    // Auto graphics: step down if the frame rate stays low during a match
    watchPerformance(dt) {
      this.fpsAcc = (this.fpsAcc || 0) + dt;
      this.fpsFrames = (this.fpsFrames || 0) + 1;
      if (this.fpsAcc < 1) return;
      const fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0; this.fpsFrames = 0;
      this.fps = fps;
      const el = $('fps');
      el.classList.toggle('hidden', !this.settings.showFps);
      if (this.settings.showFps) el.textContent = `${Math.round(fps)} FPS · ${this.gfx}`;
      if (this.settings.graphics !== 'auto' || this.state !== 'match' || this.gfx === 'low') { this.slowSecs = 0; return; }
      this.slowSecs = fps < 32 ? (this.slowSecs || 0) + 1 : 0;
      if (this.slowSecs >= 6) {
        this.slowSecs = 0;
        this.autoGfx = this.gfx === 'high' ? 'medium' : 'low';
        this.applyGraphics();
        this.toast(`Lowered graphics to ${this.gfx} for smoother play (Settings to change)`);
      }
    }

    // menu music in menus/workshop, battle music in matches (only after a user click unlocked audio)
    updateMusic() {
      if (!this.settings.music || !this.audio.ctx) return;
      this.music.play(this.state === 'match' ? 'battle' : 'menu');
    }
    trailMat(c) {
      const cols = this.meta.trailColors(c);
      return this.fx.colorKey(cols[Math.floor(Math.random() * cols.length)]);
    }
    saveBlueprints() { store.set('cogwild.blueprints', this.blueprints); if (this.account) this.account.markDirty(); }
    setCurrentBp(bp) { this.currentBp = CW.cloneBp(bp); store.set('cogwild.current', this.currentBp); if (this.account) this.account.markDirty(); }

    // ---------------- screens ----------------
    hideAll() {
      if (this.tutorial && this.tutorial.active && this.state === 'match') { this.tutorial.active = false; $('tut').classList.add('hidden'); }
      for (const id of ['menu', 'modes', 'picker', 'hud', 'results', 'pause', 'panel', 'online', 'lobby', 'search']) $(id).classList.add('hidden');
      this.workshop.close();
    }
    // points at PLAY for a few seconds ("Play matches" in the Cog Pass)
    hintPlay() {
      const b = $('btnPlay');
      b.classList.remove('hint-pulse');
      void b.offsetWidth;
      b.classList.add('hint-pulse');
      clearTimeout(this.hintT);
      this.hintT = setTimeout(() => b.classList.remove('hint-pulse'), 4500);
      this.toast('🎮 Press PLAY to find a match');
    }
    showMenu() {
      this.hideAll();
      this.endMatch();
      this.net.leaveQuiet();
      this.state = 'menu';
      clearTimeout(this.vcAskT);
      this.vcAskT = setTimeout(() => this.voice && this.voice.maybeAsk(), 2500); // the first time: voice chat?
      this.world.applyTime(this.menuTime || 'sunset', this);
      this.buildShowcase();
      $('menu').classList.remove('hidden');
      this.renderProfile();
    }
    showModes() {
      this.hideAll();
      this.endMatch();
      this.state = 'modes';
      $('modes').classList.remove('hidden');
      this.renderModeOptions();
    }

    renderModeOptions() {
      const s = this.settings;
      const bw = this.profile.stats.bestWave || 0;
      $('bestWave').textContent = bw ? `🏆 Your best: wave ${bw}` : 'No record yet: set one!';
      const opts = [['random', '🎲 Random'], ['day', CW.TIMES.day.label], ['sunset', CW.TIMES.sunset.label], ['night', CW.TIMES.night.label]];
      const diffs = [['easy', '🙂 Easy bots'], ['normal', '😐 Normal'], ['hard', '😈 Hard']];
      const arenas = [['random', '🎲 Random']].concat(Object.values(CW.ARENAS).map((a) => [a.id, `${a.icon} ${a.name}`]));
      $('arenaRow').innerHTML = '<span class="small">Arena:</span>' + arenas.map(([id, l]) => `<button class="tod-btn ${s.arena === id ? 'sel' : ''}" data-arena="${id}">${l}</button>`).join('');
      $('arenaRow').querySelectorAll('[data-arena]').forEach((b) => (b.onclick = () => { s.arena = b.dataset.arena; this.saveProfile(); this.renderModeOptions(); }));
      $('todRow').innerHTML = '<span class="small">Time:</span>' + opts.map(([id, l]) => `<button class="tod-btn ${s.timeOfDay === id ? 'sel' : ''}" data-tod="${id}">${l}</button>`).join('') +
        '<span class="small" style="margin-left:12px">Bots:</span>' + diffs.map(([id, l]) => `<button class="tod-btn ${s.difficulty === id ? 'sel' : ''}" data-diff="${id}">${l}</button>`).join('');
      $('todRow').querySelectorAll('[data-tod]').forEach((b) => (b.onclick = () => { s.timeOfDay = b.dataset.tod; this.saveProfile(); this.renderModeOptions(); }));
      $('todRow').querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => { s.difficulty = b.dataset.diff; this.saveProfile(); this.renderModeOptions(); }));
    }
    openWorkshop() {
      this.hideAll();
      this.endMatch();
      this.net.leaveQuiet();
      this.state = 'workshop';
      this.workshop.open(this.currentBp, null);
    }

    // Play flow: mode + format → (rush: build from scratch) | (clash: pick a Workshop mech)
    choose(modeId, formatId) {
      this.audio.ensure();
      this.modeId = modeId;
      this.formatId = formatId;
      if (MODES[modeId].fromScratch) this.startRushBuild();
      else this.showPicker();
    }

    startRushBuild() {
      this.hideAll();
      this.endMatch();
      this.state = 'workshop';
      const mode = MODES[this.modeId], fmt = FORMATS[this.formatId];
      const scratch = { name: 'Scrap Rush Mech', color: this.currentBp.color || this.playerColor, parts: [{ t: 'core', x: 0, y: 0, z: 0 }] };
      this.workshop.open(scratch, {
        time: mode.buildTime,
        budget: mode.budget,
        fromScratch: true,
        modeName: `${mode.name} · ${fmt.name} ${fmt.label}`,
        onReady: (bp) => this.startMatch(bp),
      });
    }

    showPicker() {
      this.hideAll();
      this.endMatch();
      this.state = 'picker';
      const fmt = FORMATS[this.formatId];
      $('pickerTitle').textContent = `Workshop Clash · ${fmt.name} ${fmt.label}`;
      const allowed = this.allowedDomains();
      const list = $('pickerList');
      list.innerHTML = '';
      const entries = [{ bp: this.currentBp, tag: 'Current Workshop mech' }]
        .concat(this.blueprints.map((bp) => ({ bp, tag: 'Saved blueprint' })))
        .concat(CW.PRESETS.map((bp) => ({ bp, tag: 'Example mech' })));
      this.pickerSel = null;
      entries.forEach((e, i) => {
        const v = CW.validate(e.bp.parts, allowed);
        const s = v.s;
        if (s.domains.size > allowed) v.errors[0] = `🔒 Needs ${CW.RANKS[s.domains.size - 1].name} rank (${s.domains.size} movement types)`;
        const card = document.createElement('button');
        card.className = 'pick-card' + (v.ok ? '' : ' bad');
        const dots = [...s.domains].map((d) => `<span class="chip" style="background:${CW.DOMAINS[d].color}">${CW.DOMAINS[d].icon}</span>`).join('');
        card.innerHTML = `<div class="pc-tag">${e.tag}</div><div class="pc-name">${esc(e.bp.name)}</div><div class="pc-meta">${dots} 🔩${s.cost} · ❤${s.hp} · 💥${Math.round(s.dps)}/s</div>${v.ok ? '' : `<div class="pc-err">${v.errors[0]}</div>`}`;
        card.onclick = () => {
          if (!v.ok) return this.toast(v.errors[0]);
          this.pickerSel = e.bp;
          list.querySelectorAll('.pick-card').forEach((c) => c.classList.remove('sel'));
          card.classList.add('sel');
          $('pickerGo').disabled = false;
        };
        list.appendChild(card);
        if (i === 0 && v.ok) card.click();
      });
      $('pickerGo').disabled = !this.pickerSel;
      $('picker').classList.remove('hidden');
    }

    renderProfile() {
      const lv = this.level();
      const ri = this.rankIndex();
      $('pLevel').textContent = lv;
      $('pRank').textContent = CW.RANKS[ri].name;
      const lp = this.levelProgress();
      $('pXp').style.width = (lp.have / lp.need) * 100 + '%';
      this.meta.renderMenu();
      $('firstRun').classList.toggle('hidden', !!this.settings.tutorialDone);
    }
    // ---------------- PLAY: matchmaking on one arena ----------------
    // today's featured event (same mode + arena for everyone): 2× coins, bigger trophy gains
    inFeatured() { return !!CW.FEATURED && !['tutorial', 'test'].includes(this.modeId) && !this.isPractice() && CW.FEATURED.is(this.modeId, this.world.arena.id); }
    // this week's event (js/economy.js WEEKLY): set when the match was started from its card
    inWeekly() { return !!this.weeklyId && !this.isPractice(); }
    featuredLeft() { const m = Math.max(1, Math.ceil((CW.FEATURED.today().endsAt - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }
    arenaChoice() { const a = this.settings.mmArena; return CW.ARENAS[a] ? a : 'random'; }
    modeChoice() { const m = this.settings.mmMode; return CW.MM_FORMAT[m] ? m : 'clash'; }
    arenaInfo(id) { return CW.ARENAS[id] ? CW.ARENAS[id] : { id: 'random', icon: '🎲', name: 'Any arena', desc: 'The fastest match: join a search on any arena.' }; }
    renderArenaCard() {
      const a = this.arenaInfo(this.arenaChoice());
      const m = MODES[this.modeChoice()];
      const kind = this.settings.mmEvent, w = CW.ECON.week();
      $('acIcon').textContent = kind === 'weekly' ? w.icon : kind === 'ranked' ? '🏅' : m.icon;
      $('acMode').textContent = kind === 'weekly' ? w.name : kind === 'ranked' ? 'Ranked' : m.name;
      $('acName').textContent = kind === 'weekly' ? `${MODES[w.mode].icon} ${MODES[w.mode].name} · ${w.desc}` : kind === 'ranked' ? '3v3 · random mode and arena' : `${a.icon} ${a.name}`;
      $('arenaCard').classList.toggle('weekly', kind === 'weekly');
      $('arenaCard').classList.toggle('ranked', kind === 'ranked');
      // the featured chip above PLAY, and a badge when your pick is today's featured event
      const f = CW.FEATURED.today(), fm = MODES[f.mode], fa = CW.ARENAS[f.arena];
      $('featChip').innerHTML = `<b>⭐ Featured today</b><span>${fm.icon} ${fm.name} · ${fa.icon} ${fa.name}</span><small>${CW.FEATURED.COIN_MULT}× coins · +50% trophies · ends in ${this.featuredLeft()}</small>`;
      const on = !kind && f.mode === this.modeChoice() && f.arena === this.arenaChoice();
      $('arenaCard').classList.toggle('featured', on);
      $('featChip').classList.toggle('on', on);
    }
    play() {
      this.audio.ensure();
      // the PLAY button bounces as you press it
      const pb = $('btnPlay');
      if (pb) { pb.classList.remove('go'); void pb.offsetWidth; pb.classList.add('go'); }
      // your mech must fit your rank; otherwise you pick one first (examples always fit)
      if (!CW.validate(this.currentBp.parts, this.allowedDomains()).ok && !this.net.mechChoices().some((e) => e.ok)) return this.showPicker();
      const kind = this.settings.mmEvent;
      if (kind === 'weekly') return this.net.matchmake(CW.ECON.week().mode, 'random', 'weekly');
      if (kind === 'ranked') {
        if (!this.account.canRanked()) { this.settings.mmEvent = null; this.saveProfile(); this.renderArenaCard(); return this.toast(`🏅 Ranked unlocks at ${CW.ECON.RANKED.unlockAt} trophies`); }
        return this.net.matchmake('koth', 'random', 'ranked');
      }
      this.net.matchmake(this.modeChoice(), this.arenaChoice());
    }
    // the next match's twist (weekly event modifiers), used once by beginMatchState
    setEvent(id) {
      const w = id && CW.ECON.WEEKLY.find((x) => x.id === id);
      this.nextWeekly = w ? w.id : null;
      this.nextMods = w ? w.mods : null;
    }
    // no internet: the same match against bots on this device
    playOffline(mode, arena, kind) {
      this.setEvent(kind === 'weekly' ? CW.ECON.week().id : null);
      this.modeId = mode;
      this.formatId = CW.MM_FORMAT[mode];
      this.forceArena = arena;
      if (MODES[mode].fromScratch) return this.startRushBuild();
      const bp = this.net.myBp();
      this.startMatch(bp);
      this.forceArena = null;
    }

    // the Ranks panel: XP to the next level and what each rank unlocks
    ranksHtml() {
      const lv = this.level(), ri = this.rankIndex();
      const lp = this.levelProgress();
      return `<div class="small">⭐ Level ${lv} · ${lp.have} / ${lp.need} XP to level ${lv + 1}. Matches give XP; higher levels unlock new parts and let one mech mix more movement types.</div>
        <div id="rankCards">${CW.RANKS.map((r, i) => `<div class="rank-card ${i <= ri ? 'open' : ''}"><div class="rk-name">${r.name}</div><div class="rk-desc">${r.desc}</div><div class="rk-lvl">${i <= ri ? '✔ Unlocked' : '🔒 Level ' + r.level}</div></div>`).join('')}</div>`;
    }

    bindMenus() {
      // the one PLAY button: matchmaking on the arena from the arena card (bots fill the seats after 30 s)
      $('btnPlay').onclick = () => this.play();
      $('arenaCard').onclick = () => this.meta.openPanel('arenas');
      // one tap on the featured chip picks today's event
      $('featChip').onclick = () => { const f = CW.FEATURED.today(); this.settings.mmMode = f.mode; this.settings.mmArena = f.arena; this.saveProfile(); this.renderArenaCard(); this.audio.click(1.3); };
      setInterval(() => { if (this.state === 'menu') this.renderArenaCard(); }, 30000);
      this.renderArenaCard();
      $('firstYes').onclick = () => { $('firstRun').classList.add('hidden'); this.startTutorial(); };
      $('firstNo').onclick = () => { $('firstRun').classList.add('hidden'); this.settings.tutorialDone = true; this.saveProfile(); };
      $('btnWorkshop').onclick = () => { this.audio.ensure(); this.openWorkshop(); };
      $('modesBack').onclick = () => this.showMenu();
      // mode cards with format buttons
      const grid = $('modeGrid');
      grid.innerHTML = '';
      for (const [modeId, mode] of Object.entries(MODES)) {
        const card = document.createElement('div');
        card.className = 'mode-card big-mode';
        card.style.borderColor = mode.color;
        card.innerHTML = `<div class="mc-top"><span class="mc-icon">${mode.icon}</span><div><div class="mc-name">${mode.name}</div><div class="mc-fmt">${mode.sub}</div></div></div>
          <div class="mc-desc">${mode.desc}</div>${modeId === 'survival' ? '<div class="small" id="bestWave"></div>' : ''}<div class="fmt-row" id="fmt-${modeId}"></div>`;
        grid.appendChild(card);
        const box = card.querySelector('.fmt-row');
        box.classList.toggle('two', mode.formats.length === 2);
        box.classList.toggle('one', mode.formats.length === 1);
        for (const fid of mode.formats) {
          const f = FORMATS[fid];
          const b = document.createElement('button');
          b.className = 'fmt-btn';
          b.innerHTML = `<b>${f.label}</b><span>${f.name}</span>`;
          b.onclick = () => this.choose(modeId, fid);
          box.appendChild(b);
        }
      }
      $('pickerBack').onclick = () => this.showModes();
      $('pickerEdit').onclick = () => this.openWorkshop();
      $('pickerGo').onclick = () => { if (this.pickerSel) this.startMatch(CW.cloneBp(this.pickerSel)); };
      // on portals, a short ad break between matches (no-op on plain web)
      const afterBreak = (fn) => () => CW.Platform.midgameAd(this).then(fn);
      $('resAgain').onclick = afterBreak(() => (this.net.room ? this.net.showLobby() : this.isPractice() ? this.openWorkshop() : this.choose(this.modeId, this.formatId)));
      $('resWorkshop').onclick = afterBreak(() => this.openWorkshop());
      $('resMenu').onclick = afterBreak(() => this.showMenu());
      $('versionText').textContent = `Cogwild ${CW.VERSION} · play online with friends or vs bots`;
      // the apps don't need a link to themselves (and only the website serves the downloads)
      // in the apps, legal pages open on the website (in the phone's / PC's browser)
      if (CW.APP && CW.PUBLIC_URL) document.querySelectorAll('.site-link').forEach((a) => (a.href = CW.PUBLIC_URL + a.getAttribute('href')));
      // no app links inside the apps, on portals (their rules) or from a file
      if (CW.APP || CW.PORTAL || !/^https?:/.test(location.protocol)) $('getApp').classList.add('hidden');
      // the website can be installed like an app (phones, Chromebooks, iPhone "Add to Home Screen"); not in the apps or on portals
      if (!CW.APP && !CW.SERVER_URL && location.protocol === 'https:' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
        window.addEventListener('beforeinstallprompt', (e) => {
          e.preventDefault();
          $('installApp').classList.remove('hidden');
          $('installApp').onclick = (ev) => { ev.preventDefault(); e.prompt(); $('installApp').classList.add('hidden'); };
        });
      }
      else $('getApp').href = (CW.PUBLIC_URL || (CW.SERVER_URL ? CW.SERVER_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/') : '')) + 'download.html';
      $('pauseResume').onclick = () => this.resume();
      $('pauseSettings').onclick = () => this.meta.openPanel('settings');
      $('pauseRestart').onclick = () => {
        // same mode, size and mech; Rush Build goes back to building
        if (this.modeId === 'tutorial') return this.startTutorial();
        if (this.modeId === 'test') return this.startTestDrive(CW.cloneBp(this.testBp));
        if (MODES[this.modeId].fromScratch) return this.startRushBuild();
        this.startMatch(CW.cloneBp(this.player.bp));
      };
      $('pauseQuit').onclick = () => (this.net.active ? this.net.leaveRoom() : this.modeId === 'tutorial' ? this.tutorial.finish(false) : this.modeId === 'test' ? this.openWorkshop() : this.showMenu());
      $('testBack').onclick = () => this.openWorkshop();
      $('modalOk').onclick = () => {
        const cb = this.modalCb;
        this.closeModal();
        if (cb) cb($('modalText').value);
      };
      $('modalCancel').onclick = () => this.closeModal();
      CW.tapOutside($('modal'), () => this.closeModal());
    }

    openModal(title, desc, text, cb) {
      $('modalTitle').textContent = title;
      $('modalDesc').textContent = desc;
      $('modalText').value = text;
      $('modalOk').textContent = cb ? 'Load' : 'Done';
      $('modalCancel').classList.toggle('hidden', !cb);
      this.modalCb = cb;
      $('modal').classList.remove('hidden');
      setTimeout(() => { $('modalText').focus(); $('modalText').select(); }, 30);
      if (!cb && navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.toast('Copied to clipboard'), () => {});
    }
    closeModal() { $('modal').classList.add('hidden'); }

    toast(msg) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), 2200);
    }

    // a short buzz on phones and tablets (Settings > Vibration); `ms` can be a pattern like [40, 30, 40]
    buzz(ms, gap = 0.1) {
      if (this.settings.vibrate === false || !this.touch.on || !navigator.vibrate) return;
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // browsers allow it only after a tap
      const now = performance.now() / 1000;
      if (now - (this.lastBuzz || 0) < gap) return;
      this.lastBuzz = now;
      try { navigator.vibrate(ms); } catch (e) { /* not allowed here */ }
    }
    // ---------------- input ----------------
    // touch screens: an enemy near your crosshair (and in sight) gently pulls your aim onto it,
    // harder while you're firing; nothing happens if no one is close to where you look
    aimAssist(dt) {
      const c = this.player;
      const from = this.cam.pos;
      if (!c || !c.alive || !from) return;
      const cp = Math.cos(this.cam.pitch);
      const dir = new V3(-Math.sin(this.cam.yaw) * cp, Math.sin(this.cam.pitch), -Math.cos(this.cam.yaw) * cp);
      let best = null, bestA = Infinity;
      for (const e of this.enemiesOf(c)) {
        const to = (e.mech ? e.pos.clone().setY(e.pos.y + 0.6) : e.pos.clone()).sub(from);
        const d = to.length();
        if (d < 3 || d > 140) continue;
        const a = Math.acos(clamp(to.dot(dir) / d, -1, 1));
        const max = Math.max(0.12, Math.atan(((e.r || 1.5) * 2.2) / d)); // a bit more than the target's size
        if (a < max && a / max < bestA && this.los(from, from.clone().add(to))) { bestA = a / max; best = to.normalize(); }
      }
      if (!best) return;
      const k = Math.min(1, dt * (this.mouse.left ? 6 : 2.5)) * (1 - bestA * 0.6);
      const wantYaw = Math.atan2(-best.x, -best.z), wantPitch = Math.asin(clamp(best.y, -1, 1));
      this.cam.yaw += wrap(wantYaw - this.cam.yaw) * k;
      this.cam.pitch += (clamp(wantPitch, -1.2, 0.85) - this.cam.pitch) * k;
    }

    // the top-most thing Esc can close: a pop-up, the login box, a panel, the mech picker, the online screen
    closeTop() {
      const open = (id) => $(id) && !$(id).classList.contains('hidden');
      if (open('vcAsk')) return this.voice.closeAsk();
      if (CW.closePicCrop && CW.closePicCrop()) return true;
      if (open('confirm')) { this.meta.closeConfirm(); return true; }
      if (open('modal')) { this.closeModal(); return true; }
      if (open('acct')) { if (!this.account.loginRequired()) $('acct').classList.add('hidden'); return true; }
      if (this.talk.isOpen) { this.talk.close(); return true; }
      if (open('panel')) { this.meta.closePanel(); return true; }
      if (this.state === 'picker' || this.state === 'online' || this.state === 'modes') { this.showMenu(); return true; }
      // the Workshop closes like any other menu (not while building in a Rush match: that would leave it)
      if (this.state === 'workshop' && !this.workshop.rush) { $('wsBack').click(); return true; }
      return false;
    }
    bindInput() {
      window.addEventListener('keydown', (e) => {
        // Esc closes the top-most menu or pop-up (even while typing in it), before it pauses a match
        if (e.code === 'Escape' && !e.repeat && this.closeTop()) { e.preventDefault(); return; }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // remapped keys (Settings > Keys) are turned into the default key the game reads
        const code = this.keymap[e.code] || e.code;
        if (!this.keys[code]) this.pressed[code] = true;
        this.keys[code] = true;
        if (this.state === 'match' && ['Space', 'Tab', 'ShiftLeft'].includes(code)) e.preventDefault();
        if (e.code === 'Escape' && this.state === 'match' && this.spectator) { this.net.stopSpectating(); return; }
        if (e.code === 'Escape' && this.state === 'match') { if (this.paused) this.resume(); else this.pause(); }
        if (code === 'KeyT' && this.state === 'match' && this.modeId === 'test') this.openWorkshop();
        if (this.state === 'match' && this.net.active && /^Digit[1-8]$/.test(e.code)) this.net.chat(+e.code.slice(5) - 1);
        if (code === 'F8' && (this.state === 'match' || this.state === 'results')) { e.preventDefault(); this.clips.saveClip(); }
        if (code === 'KeyV' && this.state === 'match') {
          this.settings.camMode = this.settings.camMode === 'first' ? 'third' : 'first';
          this.saveProfile();
          this.toast(this.settings.camMode === 'first' ? '📷 First-person camera' : '🎥 Chase camera');
        }
      });
      window.addEventListener('keyup', (e) => { this.keys[this.keymap[e.code] || e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; this.mouse.left = false; });
      const cv = this.renderer.domElement;
      cv.addEventListener('mousedown', (e) => {
        if (this.state !== 'match') return;
        this.audio.ensure();
        if (this.paused) return;
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2 && document.pointerLockElement === cv) this.pressed.KeyX = true; // right-click = super
        if (document.pointerLockElement !== cv && cv.requestPointerLock) {
          try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* no lock */ }
        }
      });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; });
      window.addEventListener('mousemove', (e) => {
        if (this.state !== 'match') return;
        const locked = document.pointerLockElement === cv;
        if (locked || this.mouse.left || e.buttons & 2) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; }
      });
      cv.addEventListener('contextmenu', (e) => { if (this.state === 'match') e.preventDefault(); });
      // losing the mouse (Alt-Tab, clicking outside) never stops the match: click the game to aim again
      document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement === cv;
        if (locked) this.hadLock = true;
        else if (this.state === 'match' && this.hadLock && !this.ended && !this.paused && !this.touch.on && !this.talk.isOpen) this.toast('🖱 Click the game to aim again · Esc = menu');
      });
    }

    // the match menu (Esc / ⏸): the match keeps going behind it, only your own controls rest
    pause() {
      this.paused = true;
      $('pauseQuit').textContent = this.net.active ? 'Leave online match' : this.modeId === 'tutorial' ? 'Skip tutorial' : this.modeId === 'test' ? 'Back to Workshop' : 'Quit match';
      $('pauseRestart').classList.toggle('hidden', this.net.active);
      $('pauseOnline').classList.toggle('hidden', !this.net.active);
      $('pause').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    }
    resume() {
      this.paused = false;
      $('pause').classList.add('hidden');
      const cv = this.renderer.domElement;
      if (cv.requestPointerLock) { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
    }

    // ---------------- match setup ----------------
    endMatch() {
      if (this.state === 'match') CW.Platform.gameplayStop();
      if (this.obj) { this.obj.dispose(); this.obj = null; }
      this.clips.stop();
      this.audio.engineOff();
      for (const m of this.mechs) m.dispose();
      for (const p of this.pilots) p.dispose();
      this.mechs = []; this.pilots = []; this.combatants = [];
      this.net.byId.clear();
      this.netSeq = 0;
      this.fx.clear();
      this.supers.clear();
      this.gadgets.clear();
      this.pickups.clear();
      this.chests.clear();
      $('tags').innerHTML = '';
      $('feed').innerHTML = '';
      this.paused = false;
      this.spectating = null;
      if (document.pointerLockElement) document.exitPointerLock();
    }

    // Rebuild the world for another arena (only when it actually changes)
    setArena(id) {
      if (this.world.arena.id === id) return;
      this.world.dispose();
      this.world = new CW.World(this.scene, id);
      this.world.setDetail(this.gfx || 'medium');
      this.showcaseSpot = null;
      if (this.showcase) { this.scene.remove(this.showcase); this.showcase = null; }
    }

    beginMatchState() {
      this.hideAll();
      this.endMatch();
      this.mods = this.nextMods || {};
      this.weeklyId = this.nextWeekly || null;
      this.nextMods = this.nextWeekly = null;
      // online: the host already picked the arena and time, so every game builds the same one
      const no = this.net.active ? this.netOpts : null;
      const ar = no ? no.arena : this.forceArena || this.settings.arena || 'random';
      this.forceArena = null; // PLAY offline: used once
      const ids = Object.keys(CW.ARENAS);
      this.setArena(this.isPractice() ? 'canyon' : ar === 'random' || !CW.ARENAS[ar] ? ids[Math.floor(Math.random() * ids.length)] : ar);
      this.state = 'match';
      const tod = no ? no.tod : this.settings.timeOfDay || 'random';
      this.timeOfDay = tod === 'random' || !CW.TIMES[tod] ? ['day', 'day', 'sunset', 'night'][Math.floor(Math.random() * 4)] : tod;
      this.world.applyTime(this.timeOfDay, this);
      this.ended = false;
      this.endTimer = 0;
      this.matchTime = 0;
      this.paused = false;
      this.slowmo = 0; this.slowmoDone = false;
      this.hadLock = false;
      this.suddenDeath = false;
      this.respawns = [];
      this.streak = 0; this.matchStreak = 0; this.lastWreckT = -99; this.firstBlood = false; this.bonusCoins = 0;
      this.pickups.spawnAll(no ? no.seed : undefined);
      this.chests.start();
      this.bonusXp = 0;
      if (this.showcase) this.showcase.visible = false;
      for (const st of (this.stage || new Map()).values()) { this.scene.remove(st.g); this.scene.remove(st.ped); }
      if (this.stage) this.stage.clear(); // the lobby's preview mechs don't come along into the match
      this.cam.shake = 0; this.cam.fovKick = 0;
      this.lastMechYaw = undefined;
      $('hud').classList.remove('hidden');
      CW.Platform.gameplayStart();
      this.clips.start();
      $('recDot').classList.toggle('hidden', !this.clips.running);
    }

    // humans (online only): the room's players [{ id, name, bp }], host first; bots fill the empty slots
    startMatch(bp, humans) {
      this.beginMatchState();
      // a quick fade in from dark blue as the arena appears
      let wipe = $('cwWipe');
      if (!wipe) { wipe = document.createElement('div'); wipe.id = 'cwWipe'; $('app').appendChild(wipe); }
      wipe.classList.remove('on'); void wipe.offsetWidth; wipe.classList.add('on');
      this.countdown = 3.5;
      const fmt = FORMATS[this.formatId];
      const coop = COOP.includes(this.formatId);
      // online co-op (Survival / Boss): every player joins team 0
      const sizes = fmt.teams.slice();
      if (humans && coop) sizes[0] = Math.max(sizes[0], humans.length);
      this.teamMode = sizes.some((n) => n > 1);
      this.teamCount = sizes.length;
      const tier = this.allowedDomains();
      const budget = MODES[this.modeId].budget || CW.BUDGET;
      const pool = CW.PRESETS.filter((p) => {
        const s = CW.analyze(p.parts);
        const boatOnly = s.domains.has('water') && s.domains.size === 1;
        return p.bot && s.domains.size <= tier && s.cost <= budget && !(boatOnly && (this.world.arena.liquid || this.world.arena.noBoats || this.world.waterSpawns.length < 3 || MODES[this.modeId].objective));
      });
      const shuffled = pool.slice().sort(() => Math.random() - 0.5);
      let botIdx = 0;
      // seats: which human sits in which team slot (offline: just you)
      const seats = new Map();
      if (humans) {
        const fill = sizes.map(() => 0);
        const together = this.netOpts && this.netOpts.teams === 'together';
        humans.forEach((h, i) => {
          let team = coop ? 0 : together ? sizes.findIndex((n, t) => fill[t] < n) : i % sizes.length;
          if (team < 0 || fill[team] >= sizes[team]) team = sizes.findIndex((n, t) => fill[t] < n);
          if (team >= 0) seats.set(team + ':' + fill[team]++, h);
        });
      } else seats.set('0:0', { id: this.net.id, name: 'You', bp, me: true });
      const usedColors = new Set();
      const freeColor = () => BOT_COLORS.find((c) => !usedColors.has(c)) || 0x9aa0a6;
      const diffId = (this.net.active && this.netOpts && this.netOpts.difficulty) || this.settings.difficulty || 'normal';
      sizes.forEach((size, team) => {
        for (let k = 0; k < size; k++) {
          const h = seats.get(team + ':' + k);
          let color;
          if (this.teamMode) color = TEAMS[team].color;
          else if (h) color = h.bp.color && !usedColors.has(h.bp.color) ? h.bp.color : h.me ? this.playerColor : freeColor();
          else color = freeColor();
          usedColors.add(color);
          if (h) {
            const me = !!h.me || h.id === this.net.id;
            const c = this.addCombatant({ name: humans ? h.name : 'You', isPlayer: me, human: true, owner: h.id, color, bp: h.bp, team });
            if (me) this.player = c;
          } else {
            const preset = shuffled[botIdx % shuffled.length];
            const bp = CW.mutateBp(preset, budget, tier);
            const lobbyNames = (this.net.active && this.netOpts && this.netOpts.botNames) || [];
            const bot = this.addCombatant({ name: lobbyNames[botIdx] || BOT_NAMES[botIdx % BOT_NAMES.length], isPlayer: false, color, bp, ai: preset.ai, team });
            const diff = { easy: { aim: 2.4, dmg: 0.65 }, normal: { aim: 1, dmg: 1 }, hard: { aim: 0.6, dmg: 1.2 } }[diffId] || { aim: 1, dmg: 1 };
            bot.ai.jitter *= diff.aim;
            bot.mech.baseDmg = diff.dmg;
            bot.baseDmg = diff.dmg; // remembered for respawns
            botIdx++;
          }
        }
      });
      this.spawnAll();
      this.afterSpawn();
      const mode = MODES[this.modeId];
      this.survival = mode.survival ? { wave: 0, breakT: 4, cleared: 0 } : null;
      if (mode.lives) for (const c of this.combatants) c.lives = mode.lives + (this.formatId === 'solo' ? 2 : 0);
      if (mode.objective) {
        this.obj = new CW.OBJECTIVES[mode.objective](this, mode);
        this.obj.start();
        if (this.obj.spawn) this.obj.spawn();
        if (mode.objective === 'boss') this.teamCount = 2;
        this.afterSpawn();
        this.feed(`${mode.icon} ${mode.name}: ${mode.desc}`);
        return;
      }
      if (this.survival) {
        this.teamCount = 2;
        this.feed('🛡 Survival: hold out against endless waves! Your mech is rebuilt between waves.');
        return;
      }
      this.feed(`${mode.name} · ${fmt.name} ${fmt.label}: ${this.combatants.length} mechs`);
      if (this.teamMode) this.feed(`You are on team ${TEAMS[this.player.team].name}. No friendly fire.`);
    }

    // ---------------- respawns (objective modes) ----------------
    updateRespawns(dt) {
      for (const c of this.combatants) {
        if (c.respawnT === undefined || !c.alive) continue;
        if (!this.net.owns(c)) continue; // online: their own game respawns them and tells us where
        c.respawnT -= dt;
        if (c.respawnT > 0) continue;
        const at = (this.obj && this.obj.respawnSpot && this.obj.respawnSpot(c)) || this.respawnSpot(c);
        this.respawnMech(c, at, Math.atan2(at.x, at.z));
        if (c.isPlayer) this.stuckT = 0;
        this.net.spawned(c);
      }
    }

    // a fresh mech for a combatant: respawns, survival rebuilds, or the same thing reported by another player's game
    respawnMech(c, at, yaw) {
      delete c.respawnT;
      if (c.mech) { c.mech.dispose(); this.mechs = this.mechs.filter((m) => m !== c.mech); }
      if (c.pilot) {
        c.pilotHp = c.pilot.maxHp;
        c.pilot.dispose();
        this.pilots = this.pilots.filter((p) => p !== c.pilot);
        c.pilot = null;
      }
      c.life = (c.life || 0) + 1;
      c.mech = new CW.Mech(this, CW.cloneBp(c.bp), { combatant: c, color: c.color });
      c.mech.name = c.bp.name;
      if (!c.isPlayer && c.baseDmg) c.mech.baseDmg = c.baseDmg;
      this.mechs.push(c.mech);
      c.mech.place(at, yaw);
      c.mech.protect = 3.5;
      if (c.isPlayer) { this.cam.yaw = c.mech.yaw; this.lastMechYaw = undefined; }
      return c.mech;
    }

    // ---------------- survival ----------------
    updateSurvival(dt) {
      const sv = this.survival;
      if (!sv || this.ended || this.countdown > 0 || this.net.client) return; // online: the host runs the waves
      const enemies = this.combatants.filter((c) => c.team !== 0 && c.alive);
      if (sv.breakT > 0) {
        sv.breakT -= dt;
        if (sv.breakT <= 0) { this.spawnWave(++sv.wave); sv.waveT = 0; }
        return;
      }
      // overtime: stragglers overheat so a wave can't drag on forever
      sv.waveT = (sv.waveT || 0) + dt;
      if (sv.waveT > 50) {
        if (!sv.hot) { sv.hot = true; this.feed('🔥 Overtime: the last enemies are overheating!', 'good'); }
        for (const c of enemies) if (c.mech.alive && c.mech.core.alive) { c.mech.core.hp -= 5 * dt; if (c.mech.core.hp <= 0) c.mech.breakPart(c.mech.core, null); }
      } else sv.hot = false;
      if (!enemies.length) {
        sv.cleared = sv.wave;
        sv.breakT = 9;
        this.waveCleared(sv.wave);
        this.net.event({ k: 'wave', cleared: sv.wave });
        // fresh supplies near the player
        const p = this.player.mech && this.player.mech.alive ? this.player.mech.pos : this.player.pilot ? this.player.pilot.pos : null;
        if (p) {
          const spot = p.clone().add(new V3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
          if (this.world.groundAt(spot.x, spot.z) > 1) this.chests.spawn(spot, sv.wave % 3 === 0 ? 'epic' : 'rare', true);
        }
      }
    }

    waveCleared(n) {
      this.announce(`WAVE ${n} CLEARED!`, 'Mech rebuilt · supply chest dropped · next wave in 9 s');
      this.feed(`✅ Wave ${n} cleared`, 'good');
      this.meta.track('wave', n);
      this.bonusCoins += 10 + n * 5;
      this.rebuildPlayerMech();
      // tidy up the fallen
      for (const c of this.combatants.filter((o) => o.team !== 0 && !o.alive)) {
        c.mech.dispose();
        if (c.pilot) c.pilot.dispose();
        this.net.byId.delete(c.netId);
      }
      this.mechs = this.mechs.filter((m) => m.combatant.team === 0 || m.combatant.alive);
      this.pilots = this.pilots.filter((pl) => pl.combatant.team === 0 || pl.combatant.alive);
      this.combatants = this.combatants.filter((o) => o.team === 0 || o.alive);
      this.buildTags();
    }

    // online (not host): wave news from the host's game
    netWave(e) {
      const sv = this.survival;
      if (!sv) return;
      if (e.start) {
        sv.wave = e.start;
        this.announce(`WAVE ${e.start}`, `${e.count} enemies incoming!`);
        this.feed(`⚠ Wave ${e.start}: ${e.count} enemies`, 'bad');
      }
      if (e.cleared) { sv.cleared = sv.wave = e.cleared; this.waveCleared(e.cleared); }
    }

    spawnWave(n) {
      const count = Math.min(10, 1 + n);
      const tier = Math.min(3, 1 + Math.floor(n / 4));
      const pool = CW.PRESETS.filter((p) => {
        const s = CW.analyze(p.parts);
        return p.bot && s.domains.size <= tier && !(s.domains.has('water') && s.domains.size === 1); // waves spawn on land
      });
      const me = this.player.mech && this.player.mech.alive ? this.player.mech.pos : this.player.pilot ? this.player.pilot.pos : new V3();
      const spots = this.world.landSpawns.filter((s) => s.distanceTo(me) > 55 && s.distanceTo(me) < 130).sort(() => Math.random() - 0.5);
      if (!spots.length) spots.push(...this.world.landSpawns.filter((s) => s.distanceTo(me) > 55));
      for (let i = 0; i < count; i++) {
        const preset = pool[Math.floor(Math.random() * pool.length)];
        const bp = CW.mutateBp(preset, CW.BUDGET, 3);
        const c = this.addCombatant({ name: `${BOT_NAMES[i % BOT_NAMES.length]} W${n}`, isPlayer: false, color: 0xe63946, bp, ai: preset.ai, team: 1 });
        c.ai.jitter = Math.max(0.6, 2.4 - n * 0.1);
        c.mech.baseDmg = Math.min(1.4, 0.6 + n * 0.06);
        const at = spots[i % Math.max(1, spots.length)] || this.world.landSpawns[i % this.world.landSpawns.length];
        c.mech.place(at.clone().add(new V3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)), Math.atan2(at.x - me.x, at.z - me.z));
      }
      this.buildTags();
      this.announce(`WAVE ${n}`, `${count} enemies incoming!`);
      this.feed(`⚠ Wave ${n}: ${count} enemies`, 'bad');
      this.net.event({ k: 'wave', start: n, count });
    }

    // between waves wrecked mechs on your team come back (and damaged ones are fully fixed, lost parts too)
    rebuildPlayerMech() {
      for (const c of this.combatants) {
        if (c.team !== 0 || !c.alive || !this.net.owns(c)) continue;
        const m = c.mech;
        if (m && m.alive) {
          for (const p of m.parts) if (!p.alive) m.rebuildPart(p, true);
          for (const p of m.parts) p.hp = p.maxHp;
          m.shield = m.shieldMax;
          continue;
        }
        const at = (c.pilot ? c.pilot.pos.clone() : this.world.landSpawns[0].clone()).add(new V3(3, 0, 3));
        this.respawnMech(c, at, c.isPlayer ? this.cam.yaw : 0);
        this.net.spawned(c);
      }
    }

    isPractice() { return this.modeId === 'test' || this.modeId === 'tutorial'; }

    startTutorial() {
      this.audio.ensure();
      this.tutorial.start();
    }

    startTestDrive(bp, kind) {
      this.modeId = kind || 'test';
      this.formatId = null;
      this.beginMatchState();
      this.countdown = 0;
      this.teamMode = false;
      this.teamCount = 2;
      this.testBp = CW.cloneBp(bp);
      this.player = this.addCombatant({ name: 'You', isPlayer: true, color: bp.color || this.playerColor, bp, team: 0 });
      const spawn = this.world.landSpawns[0];
      this.player.mech.place(spawn, Math.atan2(spawn.x, spawn.z));
      this.dummyIds = ['buggy', 'spider', 'mudcrab'];
      this.dummyIds.forEach((id, i) => this.spawnDummy(i));
      this.afterSpawn();
      if (this.modeId === 'test') this.feed('Test drive: try your mech. Targets respawn. Press T to go back.');
    }

    spawnDummy(i) {
      const old = this.combatants.find((c) => c.dummyIndex === i);
      if (old) {
        old.mech.dispose();
        this.mechs = this.mechs.filter((m) => m !== old.mech);
        this.combatants = this.combatants.filter((c) => c !== old);
      }
      const preset = CW.PRESETS.find((p) => p.id === this.dummyIds[i]);
      const c = this.addCombatant({ name: 'Target ' + (i + 1), isPlayer: false, color: 0x9aa0a6, bp: preset, ai: 'dummy', team: 1 });
      c.dummyIndex = i;
      c.mech.occupied = false;
      const p = this.player.mech.pos;
      const dir = new V3(-p.x, 0, -p.z).normalize(); // toward arena center
      const side = new V3(-dir.z, 0, dir.x);
      const pos = p.clone().addScaledVector(dir, 30 + i * 5).addScaledVector(side, (i - 1) * 11);
      if (this.world.groundAt(pos.x, pos.z) < 1) pos.copy(p).addScaledVector(dir, 22).addScaledVector(side, (i - 1) * 8);
      c.mech.place(pos, Math.atan2(dir.x, dir.z));
      this.buildTags();
    }

    afterSpawn() {
      const pm = this.player.mech;
      this.cam.yaw = pm.yaw;
      this.cam.pitch = -0.12;
      this.cam.pos.copy(pm.pos).add(new V3(Math.sin(pm.yaw) * 14, 8, Math.cos(pm.yaw) * 14));
      this.buildTags();
    }

    addCombatant(o) {
      const c = {
        name: o.name, isPlayer: o.isPlayer, color: o.color, team: o.team, kills: 0, wrecks: 0, superCharge: 0, alive: true, place: 0, pilotHp: 60, mech: null, pilot: null,
        // online: which player's game runs it (bots: the host), its id in network messages, and how many mechs it has had
        owner: o.owner ?? this.net.id, human: o.human ?? !!o.isPlayer, netId: o.netId ?? this.netSeq, life: 0,
        ai: { style: o.ai || 'ground', retarget: 0, target: null, stuck: 0, wander: 0, wanderYaw: 0, last: new V3(), pref: 18 + Math.random() * 14, alt: 8 + Math.random() * 8, jitter: 1.1 + Math.random() * 1.0, t: Math.random() * 10, waypoint: null },
      };
      this.netSeq = Math.max(this.netSeq, c.netId + 1);
      this.net.byId.set(c.netId, c);
      c.bp = CW.cloneBp(o.bp);
      c.mech = new CW.Mech(this, CW.cloneBp(o.bp), { combatant: c, color: o.color });
      c.mech.name = o.bp.name;
      this.mechs.push(c.mech);
      this.combatants.push(c);
      this.net.added(c);
      return c;
    }

    // Spread team bases far apart, members cluster around their base
    spawnAll() {
      const land = this.world.landSpawns;
      const water = this.world.waterSpawns;
      const bases = [];
      const start = land[Math.floor(Math.random() * land.length)];
      bases.push(start);
      while (bases.length < this.teamCount) {
        let best = null, bd = -1;
        for (const p of land) {
          const d = Math.min(...bases.map((b) => b.distanceTo(p)));
          const score = this.teamCount === 2 ? -Math.abs(d - 125) : d;
          if (d > 40 && score > bd) { bd = score; best = p; }
        }
        bases.push(best || land[Math.floor(Math.random() * land.length)]);
      }
      this.teamBases = bases;
      const used = [];
      const teamIdx = {};
      for (const c of this.combatants) {
        const base = bases[c.team];
        const k = (teamIdx[c.team] = (teamIdx[c.team] || 0) + 1) - 1;
        const s = c.mech.stats;
        const waterOnly = s.domains.has('water') && !s.domains.has('land') && !s.domains.has('air');
        let pos = null;
        if (waterOnly && water.length) {
          pos = water.slice().sort((a, b) => a.distanceTo(base) - b.distanceTo(base)).find((w) => used.every((u) => u.distanceTo(w) > 8)) || water[0];
        } else {
          pos = this.safeNear(base, k, used);
        }
        used.push(pos);
        c.mech.place(pos, Math.atan2(pos.x, pos.z)); // face the arena center
        c.mech.protect = 3.5;
      }
    }

    // a safe spot near a base point, spread out from spots already taken
    safeNear(base, k, used) {
      for (let tries = 0; tries < 40; tries++) {
        const ang = (k * 2.1 + tries * 0.7) % (Math.PI * 2);
        const r = k === 0 && tries === 0 ? 0 : 7 + tries * 1.1;
        const x = base.x + Math.cos(ang) * r, z = base.z + Math.sin(ang) * r;
        if (this.world.isSafeSpot(x, z) && used.every((u) => Math.hypot(u.x - x, u.z - z) > 6)) return new V3(x, this.world.groundAt(x, z), z);
      }
      return base.clone();
    }

    // closest spot that is truly safe: nearby dry land if it's safe, otherwise the nearest spawn point
    safeSpotNear(pos) {
      if (this.world.isSafeSpot(pos.x, pos.z)) return new V3(pos.x, this.world.groundAt(pos.x, pos.z), pos.z);
      const land = this.nearestLand(pos);
      if (land) {
        const s = this.safeNear(land, 0, []);
        if (this.world.isSafeSpot(s.x, s.z)) return s;
      }
      const spawns = this.world.landSpawns;
      return spawns.reduce((a, b) => (b.distanceTo(pos) < a.distanceTo(pos) ? b : a), spawns[0]).clone();
    }

    // respawn point for a combatant: near their team base, far from living enemies
    respawnSpot(c) {
      const enemies = this.combatants.filter((o) => o.team !== c.team && o.alive && o.mech && o.mech.alive).map((o) => o.mech.pos);
      let best = null, bd = -Infinity;
      for (const s of this.world.landSpawns) {
        const dEnemy = enemies.length ? Math.min(...enemies.map((e) => e.distanceTo(s))) : 200;
        const base = this.teamBases && this.teamBases[c.team];
        const score = Math.min(dEnemy, 90) - (base && this.teamMode ? base.distanceTo(s) * 0.4 : 0) + Math.random() * 15;
        if (score > bd) { bd = score; best = s; }
      }
      return this.safeNear(best || this.world.landSpawns[0], Math.floor(Math.random() * 5), []);
    }

    enemiesOf(c) {
      const out = [];
      for (const o of this.combatants) {
        if (o.team === c.team || !o.alive) continue;
        if (!c.isPlayer && !c.human && this.gadgets.hidden(o)) continue; // bots can't see into smoke
        if (o.mech && o.mech.alive) out.push({ c: o, pos: o.mech.pos, vel: o.mech.vel, mech: o.mech, r: o.mech.radius });
        if (o.pilot && o.pilot.alive) out.push({ c: o, pos: o.pilot.center.clone(), vel: o.pilot.vel, pilot: o.pilot, r: 1 });
      }
      return out;
    }

    los(a, b) {
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        if (this.world.groundAt(x, z) > y + 0.3) return false;
      }
      return true;
    }

    // ---------------- player control ----------------
    updatePlayer(dt) {
      const c = this.player;
      const k = this.keys;
      const locked = this.countdown > 0 || this.ended || this.paused;
      const sens = 0.0023 * this.settings.sens;
      this.cam.yaw -= this.mouse.dx * sens;
      this.cam.pitch = clamp(this.cam.pitch - this.mouse.dy * sens * (this.settings.invertY ? -1 : 1), -1.2, 0.85);
      this.mouse.dx = this.mouse.dy = 0;
      if (this.spectator) return;
      if (this.touch.on && this.settings.aimAssist !== false && !locked) this.aimAssist(dt);
      const ePressed = this.pressed.KeyE;
      if (c.mech && c.mech.alive && c.mech.occupied) {
        const m = c.mech;
        const manualTurn = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
        m.input.throttle = locked ? 0 : (k.KeyW ? 1 : 0) - (k.KeyS ? 0.7 : 0);
        let turn = manualTurn;
        // auto-steer: while driving without A/D, the mech turns toward where you look
        if (!manualTurn && this.settings.autoSteer && m.input.throttle !== 0) {
          const err = wrap(this.cam.yaw - m.yaw);
          turn = clamp(-err * 2.5, -1, 1);
        }
        m.input.turn = locked ? 0 : turn;
        m.input.manual = !locked && !!manualTurn; // A/D: car steering (js/entities.js)
        m.input.up = !locked && !!k.Space;
        m.input.upPressed = !locked && !!this.pressed.Space;
        m.input.down = !locked && !!(k.KeyC || k.KeyQ || k.ControlLeft || k.ControlRight);
        m.input.fire = !locked && this.mouse.left;
        m.input.aim = this.cam.aim;
        if (!locked && (this.pressed.ShiftLeft || this.pressed.ShiftRight)) {
          m.input.dash = m.legs > 0 && manualTurn ? 2 * manualTurn : k.KeyS ? -1 : 1;
          if (m.dashCd > 0) this.toast(`Dash recharging: ${m.dashCd.toFixed(1)}s`);
        }
        // steering with A/D turns your view with the mech, like sitting inside it: exactly as much as the
        // steering turned it, so when you let go your aim stays right where it is (nothing swings it back)
        if (m.camFollowYaw) { this.cam.yaw += m.camFollowYaw; m.camFollowYaw = 0; }
        if (ePressed && !locked) this.exitMech(c);
        if (this.pressed.KeyX && !locked) this.supers.activate(c);
        if (this.pressed.KeyG && !locked) this.gadgets.use(c);
        // stuck detection: trying to move but not getting anywhere (or sitting in liquid without water parts)
        const hs = Math.hypot(m.vel.x, m.vel.z);
        const helpless = m.medium === 'water' && m.swim === 0 && m.buoy < m.mass * 0.65;
        if ((m.input.throttle !== 0 && hs < 1.5) || helpless || m.pos.y - m.baseOff < -3) this.stuckT = (this.stuckT || 0) + dt;
        else this.stuckT = Math.max(0, (this.stuckT || 0) - dt * 2);
        this.unstuckCd = Math.max(0, (this.unstuckCd || 0) - dt);
        if (this.pressed.KeyF && !locked) this.unstuck(m);
      } else if (c.pilot && c.pilot.alive) {
        const p = c.pilot;
        const fx = -Math.sin(this.cam.yaw), fz = -Math.cos(this.cam.yaw);
        let mx = 0, mz = 0;
        if (!locked) {
          if (k.KeyW) { mx += fx; mz += fz; }
          if (k.KeyS) { mx -= fx; mz -= fz; }
          if (k.KeyD) { mx += -fz; mz += fx; }
          if (k.KeyA) { mx -= -fz; mz -= fx; }
        }
        const l = Math.hypot(mx, mz) || 1;
        p.inp = { mx: mx / l, mz: mz / l, jump: !locked && !!this.pressed.Space, fire: !locked && this.mouse.left, aim: this.cam.aim.clone(), yaw: this.cam.yaw };
        this.repairing = false;
        const m = c.mech;
        if (m && m.alive) {
          const d = m.pos.distanceTo(p.pos);
          this.nearOwnMech = d < m.radius + 4;
          if (this.nearOwnMech && ePressed) this.enterMech(c);
          else if (this.nearOwnMech && k.KeyR) {
            const r = m.repairWork(dt);
            this.repairing = r !== 'done';
            if (r === 'done' && !this.repairDoneShown) { this.repairDoneShown = true; this.toast('🔧 Fully repaired! Press E to get back in'); }
            if (r === 'rebuild') this.toast('🔧 Part rebuilt');
          } else this.repairDoneShown = false;
        } else this.nearOwnMech = false;
      }
    }

    // F: hop to the nearest safe spot when stuck (cooldown, brief protection)
    unstuck(m) {
      if (this.unstuckCd > 0) return this.toast(`Unstuck recharging: ${Math.ceil(this.unstuckCd)}s`);
      m.place(this.safeSpotNear(m.pos), m.yaw);
      m.vel.set(0, 0, 0);
      m.protect = 2;
      this.unstuckCd = 12;
      this.stuckT = 0;
      this.fx.burst(m.pos, { n: 16, color: this.fx.colorKey(0x9be7ff), speed: 6, life: 0.6, size: 0.35 });
      this.toast('🔧 Unstuck!');
    }

    exitMech(c) {
      const m = c.mech;
      m.occupied = false;
      m.input.fire = false;
      // step out next to the mech, on ground at about the mech's own height: never up onto a cliff beside it
      // (right, left, behind, in front, then a bit farther; if all are cliffs or water, on top of the mech)
      const feet = m.pos.y - m.baseOff;
      const right = new V3(Math.cos(m.yaw), 0, -Math.sin(m.yaw)), back = new V3(Math.sin(m.yaw), 0, Math.cos(m.yaw));
      let pos = null;
      for (const extra of [1, 2.5]) {
        for (const d of [right, right.clone().negate(), back, back.clone().negate()]) {
          const p = m.pos.clone().addScaledVector(d, m.radius + extra);
          const gy = this.world.groundAt(p.x, p.z, feet + 1);
          if (Math.abs(gy - feet) < 1.4 && gy > CW.WATER_Y - 0.6) { p.y = Math.max(gy, feet); pos = p; break; }
        }
        if (pos) break;
      }
      if (!pos) { pos = m.pos.clone(); pos.y = m.pos.y + m.radius; }
      c.pilot = new CW.Pilot(this, c, pos, c.pilotHp);
      c.pilot.yaw = this.cam.yaw;
      this.pilots.push(c.pilot);
    }

    enterMech(c) {
      c.pilotHp = c.pilot.hp;
      c.pilot.dispose();
      this.pilots = this.pilots.filter((p) => p !== c.pilot);
      c.pilot = null;
      c.mech.occupied = true;
      this.cam.yaw = c.mech.yaw;
    }

    ejectPilot(c, pos) {
      const p = new CW.Pilot(this, c, new V3(pos.x, Math.max(pos.y, this.world.groundAt(pos.x, pos.z), 0.5), pos.z), c.pilotHp);
      p.vel.set((Math.random() - 0.5) * 6, 10, (Math.random() - 0.5) * 6);
      // over lava or water? fling the pilot toward the nearest dry land
      if (this.world.groundAt(pos.x, pos.z) < 1) {
        const land = this.nearestLand(pos);
        if (land) {
          const d = land.clone().sub(pos).setY(0);
          const t = Math.max(1, d.length() / 14);
          p.vel.set(d.x / t, 14, d.z / t);
          p.pos.y = Math.max(p.pos.y, 3);
        }
      }
      p.protect = 2;
      p.flung = true;
      p.inp = { mx: 0, mz: 0 };
      c.pilot = p;
      this.pilots.push(p);
    }

    // ---------------- bots ----------------
    // Land-only mechs: if the straight path crosses water, go over the best bridge instead
    routeTarget(m, tp) {
      const world = this.world;
      if (!world.bridges.length) return null;
      let wet = false;
      for (let i = 1; i < 16 && !wet; i++) {
        const t = i / 16;
        const x = m.pos.x + (tp.x - m.pos.x) * t, z = m.pos.z + (tp.z - m.pos.z) * t;
        if (world.groundAt(x, z, 100) < -1.5) wet = true;
      }
      const on = world.onBridge(m.pos.x, m.pos.z, 1);
      if (!wet && !on) return null;
      const me = new V3(m.pos.x, 0, m.pos.z), goal = new V3(tp.x, 0, tp.z);
      let best = null, bd = Infinity;
      for (const b of world.bridges) {
        for (const [near, far] of [[b.endA, b.endB], [b.endB, b.endA]]) {
          const d = me.distanceTo(near) + far.distanceTo(goal);
          if (d < bd) { bd = d; best = { b, near, far }; }
        }
      }
      if (!best) return null;
      if (on === best.b || me.distanceTo(best.near) < 5) return best.far;
      return best.near;
    }

    // Way out of the water for land-only mechs: a canyon ramp, or the nearest shore
    rampExit(pos, tp) {
      const canyon = this.world.arena.id === 'canyon';
      const inCanyon = canyon && Math.abs(pos.x - CW.canyonX(pos.z)) < 30 && Math.abs(pos.z) < 150;
      if (!inCanyon) return this.nearestLand(pos, tp) || tp;
      const tSide = Math.sign(tp.x - CW.canyonX(tp.z)) || 1;
      let best = null, bd = Infinity;
      for (const rz of CW.RAMPS_Z) {
        const exit = new V3(CW.canyonX(rz) + tSide * 42, 0, rz);
        const d = Math.abs(pos.z - rz) + exit.distanceTo(tp);
        if (d < bd) { bd = d; best = exit; }
      }
      // walk along the river to the ramp first, then climb out
      if (Math.abs(pos.z - best.z) > 6) return new V3(CW.canyonX(best.z), 0, best.z);
      return best;
    }

    // closest gentle shore, preferring the direction of the target
    nearestLand(pos, tp) {
      let best = null, bd = Infinity;
      for (const r of [10, 20, 32, 48, 70])
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
          if (this.world.groundAt(x, z) < 1.5) continue;
          const d = r + (tp ? Math.hypot(tp.x - x, tp.z - z) * 0.3 : 0);
          if (d < bd) { bd = d; best = new V3(x, 0, z); }
        }
      return best;
    }
    nearestWater(pos) {
      for (const r of [6, 12, 20, 30, 45])
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
          if (this.world.groundAt(x, z) < -1.5) return new V3(x, 0, z);
        }
      return null;
    }

    updateBot(c, dt) {
      const ai = c.ai;
      if (ai.style === 'dummy') return;
      ai.t += dt;
      const locked = this.countdown > 0 || this.ended;
      ai.retarget -= dt;
      const myPos = c.mech && c.mech.alive && c.mech.occupied ? c.mech.pos : c.pilot ? c.pilot.pos : null;
      if (!myPos) return;
      if (ai.retarget <= 0 || !ai.target || !ai.target.c.alive) {
        ai.retarget = 2 + Math.random();
        const en = this.enemiesOf(c);
        let best = null, bd = Infinity;
        for (const e of en) {
          let d = e.pos.distanceTo(myPos);
          // spread out: targets already chased by other bots look further away
          const chasers = this.combatants.filter((o) => o !== c && o.alive && o.ai.target && o.ai.target.c === e.c).length;
          d += chasers * 14;
          if (e.pilot) d *= 0.8;
          if (d < bd) { bd = d; best = e; }
        }
        ai.target = best;
      }
      const tg = ai.target;
      if (tg) {
        const e = tg.c;
        if (tg.mech && !tg.mech.alive) ai.retarget = 0;
        if (tg.pilot && (!tg.pilot.alive || tg.pilot !== e.pilot)) ai.retarget = 0;
        if (tg.pilot && tg.pilot.alive) tg.pos = tg.pilot.center.clone();
      }

      if (c.mech && c.mech.alive && c.mech.occupied) {
        const m = c.mech;
        const inp = m.input;
        inp.throttle = 0; inp.turn = 0; inp.up = false; inp.down = false; inp.upPressed = false; inp.fire = false;
        if (locked || !tg) return;
        const tp = tg.pos;
        const s = m.stats;
        const waterOnly = s.domains.has('water') && !s.domains.has('land') && !s.domains.has('air');
        const landOnly = s.domains.has('land') && !s.domains.has('water') && !s.domains.has('air');
        const dist = Math.hypot(tp.x - m.pos.x, tp.z - m.pos.z);
        // objective modes: head for the hill / gold / next checkpoint unless an enemy is right here
        const objGoal = this.obj && this.obj.botGoal(c);
        const dest = objGoal && (this.modeId === 'race' || dist > 18) ? objGoal : tp;
        let goal = dest;
        if (landOnly && m.medium === 'land') {
          const wp = this.routeTarget(m, dest);
          if (wp) goal = wp;
        } else if (landOnly && m.medium === 'water') {
          goal = this.rampExit(m.pos, dest);
        } else if (waterOnly && m.medium === 'land') {
          goal = this.nearestWater(m.pos) || tp;
        }
        // grab power-ups: repair when hurt, anything that's close
        if (goal === tp && !waterOnly) {
          const hurt = m.integrity() < 0.55;
          const it = (hurt && this.pickups.nearest(m.pos, ['repair', 'shield'], 70)) || this.pickups.nearest(m.pos, null, 22);
          if (it && (landOnly ? Math.abs(it.pos.y - m.pos.y) < 6 : true)) goal = it.pos;
          // chests too: anything close, or a supply drop within reach
          if (goal === tp) {
            let best = null, bd = 30;
            for (const ch of this.chests.items) {
              if (ch.opened || ch.falling) continue;
              const d = ch.pos.distanceTo(m.pos) * (ch.rarity === 'epic' ? 0.5 : 1);
              if (d < bd) { bd = d; best = ch; }
            }
            if (best) goal = best.pos;
          }
        }
        const routing = goal !== tp;
        const dx = goal.x - m.pos.x, dz = goal.z - m.pos.z;
        let desiredYaw = Math.atan2(-dx, -dz);
        if (ai.wander > 0) { ai.wander -= dt; desiredYaw = ai.wanderYaw; }
        const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
        const ax = m.pos.x + fx * 10, az = m.pos.z + fz * 10;
        const ahead = this.world.groundAt(ax, az, m.pos.y);
        if (ai.wander <= 0) {
          if (waterOnly && m.medium === 'water' && ahead > CW.WATER_Y - 0.6) { ai.wander = 1.5; ai.wanderYaw = m.yaw + Math.PI * (0.6 + Math.random() * 0.5); }
          if (landOnly && !routing && ahead < -1.5 && m.medium === 'land') { ai.wander = 1.2; ai.wanderYaw = m.yaw + (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.7; }
        }
        const err = wrap(desiredYaw - m.yaw);
        inp.turn = clamp(-err * 2.2, -1, 1);
        if (ai.style === 'plane') inp.throttle = 1;
        else if (ai.wander > 0 || routing) inp.throttle = Math.abs(err) < 1.2 ? 1 : 0.3;
        else {
          inp.throttle = dist > ai.pref + 6 ? 1 : dist < ai.pref - 8 ? -0.6 : Math.sin(ai.t * 0.9) * 0.5;
          if (Math.abs(err) > 1.3) inp.throttle *= 0.3;
        }
        if (waterOnly && m.medium === 'water' && ahead > CW.WATER_Y - 0.6 && ai.wander <= 0) inp.throttle = Math.min(inp.throttle, 0);
        if (ai.style === 'heli' || ai.style === 'plane') {
          const gAhead = Math.max(ahead, this.world.groundAt(m.pos.x, m.pos.z), CW.WATER_Y);
          const wantY = Math.max(tp.y + ai.alt, gAhead + 7);
          if (m.pos.y < wantY - 1) inp.up = true;
          else if (m.pos.y > wantY + 6) inp.down = true;
        }
        if (m.legs > 0 && m.medium === 'land' && Math.random() < dt * 0.3) inp.upPressed = true;
        // dashing: rammers charge in, others close gaps or dodge sideways
        if (ai.style === 'rammer') {
          inp.throttle = 1;
          if (dist < 24 && Math.abs(err) < 0.3 && m.dashCd <= 0) inp.dash = 1;
        } else if (m.dashCd <= 0 && Math.random() < dt * 0.25) {
          if (dist > ai.pref + 25 && Math.abs(err) < 0.4) inp.dash = 1;
          else if (m.legs > 0 && dist < ai.pref + 5) inp.dash = Math.random() < 0.5 ? 2 : -2;
        }
        const moved = m.pos.distanceTo(ai.last);
        ai.last.copy(m.pos);
        const beached = waterOnly && m.medium === 'land';
        if (!beached && Math.abs(inp.throttle) > 0.5 && moved < 1.5 * dt) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
        if (ai.stuck > 2.2) { ai.stuck = 0; ai.wander = 2.5; ai.wanderYaw = m.yaw + Math.PI * (0.5 + Math.random()); ai.stuckCount = (ai.stuckCount || 0) + 1; }
        // bots get the same unstuck hop as players when they're really trapped
        const helpless = m.medium === 'water' && m.swim === 0 && m.buoy < m.mass * 0.65;
        ai.helplessT = helpless || m.pos.y - m.baseOff < -3 ? (ai.helplessT || 0) + dt : 0;
        if (ai.helplessT > 6 || ai.stuckCount >= 4) {
          ai.helplessT = 0; ai.stuckCount = 0;
          m.place(this.safeSpotNear(m.pos), m.yaw);
          m.vel.set(0, 0, 0);
          m.protect = 1.5;
        }
        if (dist < 115) {
          inp.aim = this.botAim(ai, tg, tp, dist, dt, dist / 110);
          inp.fire = this.botTrigger(ai, dt) && this.los(m.pos.clone().setY(m.pos.y + 1), tp);
        }
      } else if (c.pilot && c.pilot.alive) {
        const p = c.pilot;
        p.inp = { mx: 0, mz: 0, jump: false, fire: false, aim: null, yaw: p.yaw };
        if (locked || !tg) return;
        const tp = tg.pos;
        const dx = tp.x - p.pos.x, dz = tp.z - p.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        let mx = dx / dist, mz = dz / dist;
        const strafe = Math.sin(ai.t * 1.3) > 0 ? 1 : -1;
        if (dist < 14) { mx = (-dz / dist) * strafe - mx * 0.5; mz = (dx / dist) * strafe - mz * 0.5; }
        const l = Math.hypot(mx, mz) || 1;
        p.inp.mx = mx / l; p.inp.mz = mz / l;
        p.inp.yaw = Math.atan2(-dx, -dz);
        p.inp.jump = Math.random() < dt * 0.6;
        if (dist < 60) {
          p.inp.aim = this.botAim(ai, tg, tp, dist, dt, 0);
          p.inp.fire = this.botTrigger(ai, dt) && this.los(p.center.clone(), tp);
        }
      }
    }
    // Bots aim like people, not like an aimbot: they react a moment late, lead moving targets only
    // partly, their aim drifts around the target (worse far away) and they shoot in bursts.
    botAim(ai, tg, tp, dist, dt, travel) {
      if (ai.seenFor !== tg.c || !ai.seen) { ai.seenFor = tg.c; ai.seen = tp.clone(); ai.aimOff = new V3(); ai.offGoal = new V3(); ai.offT = 0; }
      ai.seen.lerp(tp, Math.min(1, dt * 4)); // about a quarter second behind
      ai.offT -= dt;
      if (ai.offT <= 0) {
        ai.offT = 0.5 + Math.random() * 0.8;
        const s = ai.jitter * (1.4 + dist * 0.06);
        ai.offGoal.set((Math.random() - 0.5) * 2 * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * 2 * s);
      }
      ai.aimOff.lerp(ai.offGoal, Math.min(1, dt * 3));
      if (ai.lead === undefined) ai.lead = 0.3 + Math.random() * 0.5;
      return ai.seen.clone().addScaledVector(tg.vel || new V3(), travel * ai.lead).add(ai.aimOff);
    }
    botTrigger(ai, dt) {
      ai.burst = (ai.burst || 0) - dt;
      if (ai.burst < -(0.7 + Math.random() * 1.1)) ai.burst = 0.9 + Math.random() * 1.3;
      return ai.burst > 0;
    }

    // ---------------- events ----------------
    who(c, you) { return c ? (c.isPlayer ? you : c.name) : 'The arena'; }

    onMechDestroyed(mech, who) {
      if (who && who.isPlayer && mech.combatant !== who) { this.killMarker = 0.6; this.cam.shake = Math.min(1.5, this.cam.shake + 0.5); this.buzz(30); }
      if (mech.combatant.isPlayer) this.buzz([70, 40, 90], 0.5);
      this.net.mechDestroyed(mech, who);
      const c = mech.combatant;
      if (who && !CW.sameTeam(who, c)) who.wrecks++;
      if (this.isPractice()) {
        if (c.dummyIndex !== undefined) {
          c.alive = false;
          this.feed(`Target ${c.dummyIndex + 1} wrecked!`, 'good');
          if (this.tutorial.active && who && who.isPlayer) this.tutorial.onWreck();
          this.respawns.push({ t: 3, fn: () => this.spawnDummy(c.dummyIndex) });
          return;
        }
        if (c.isPlayer) {
          this.bigMsg('WRECKED!', 'Respawning your mech…', 2);
          this.respawns.push({ t: 2.5, fn: () => this.respawnTestPlayer() });
          return;
        }
      }
      // survival: wave enemies are knocked out with their mech (keeps waves snappy)
      // (same for the boss and its minions)
      if ((this.survival && c.team !== 0) || c.minion || c.ai.style === 'boss') {
        c.alive = false;
        if (who && who !== c) who.kills++;
        this.feed(`${this.who(who, 'You')} wrecked ${c.name}`, who && who.isPlayer ? 'good' : '');
        if (who && who.isPlayer) this.onPlayerWreck();
        if (c.ai.style === 'boss') { this.announce('👹 TITAN DESTROYED!', 'You did it!'); this.cam.shake = 1.5; this.fx.explosion(mech.pos, 4); }
        return;
      }
      // respawn modes: no pilot phase, you come back after a short wait
      const mode = MODES[this.modeId];
      if (mode && mode.respawn) {
        if (this.obj && this.obj.onWreck) this.obj.onWreck(c, who);
        if (who && who !== c && !CW.sameTeam(who, c)) who.kills++;
        this.feed(`${this.who(who, 'You')} wrecked ${c.isPlayer ? 'you' : c.name}`, who && who.isPlayer ? 'good' : c.isPlayer ? 'bad' : '');
        if (who && who.isPlayer && !CW.sameTeam(who, c)) this.onPlayerWreck();
        if (c.lives !== undefined) {
          c.lives--;
          if (c.lives <= 0) {
            c.alive = false;
            this.feed(`${c.isPlayer ? 'You are' : c.name + ' is'} out of lives`, c.isPlayer ? 'bad' : '');
            if (c.isPlayer) this.bigMsg('OUT OF LIVES', this.teamMode ? 'Spectating your team…' : '', 2.5);
            return;
          }
        }
        c.respawnT = mode.respawnDelay || 4;
        if (c.isPlayer) this.bigMsg('WRECKED!', `Back in ${Math.ceil(c.respawnT)} seconds${c.lives !== undefined ? ` · ❤ ${c.lives} left` : ''}`, 2);
        return;
      }
      if (mech.occupied) this.ejectPilot(c, mech.pos);
      this.feed(`${this.who(who, 'You')} wrecked ${c.isPlayer ? 'your' : c.name + "'s"} ${mech.name}`, who && who.isPlayer ? 'good' : c.isPlayer ? 'bad' : '');
      if (c.isPlayer) this.bigMsg('MECH WRECKED!', 'You\'re on foot. Survive!', 2.5);
      if (who && who.isPlayer) this.bigMsg('WRECKED!', `${c.name}'s pilot ejected. Finish them!`, 1.8);
      if (who && who.isPlayer && !CW.sameTeam(who, c)) this.onPlayerWreck();
    }

    respawnTestPlayer() {
      const old = this.player;
      if (old.pilot) { old.pilot.dispose(); this.pilots = this.pilots.filter((p) => p !== old.pilot); }
      old.mech.dispose();
      this.mechs = this.mechs.filter((m) => m !== old.mech);
      this.combatants = this.combatants.filter((c) => c !== old);
      this.player = this.addCombatant({ name: 'You', isPlayer: true, color: this.testBp.color || this.playerColor, bp: this.testBp, team: 0 });
      const spawn = this.world.landSpawns[0];
      this.player.mech.place(spawn, Math.atan2(spawn.x, spawn.z));
      this.afterSpawn();
    }

    teamAlive(team) { return this.combatants.some((c) => c.team === team && c.alive); }
    aliveTeams() { return new Set(this.combatants.filter((c) => c.alive).map((c) => c.team)); }

    onPilotKilled(pilot, who) {
      this.net.pilotKilled(pilot, who);
      const c = pilot.combatant;
      this.pilots = this.pilots.filter((p) => p !== pilot);
      if (this.isPractice()) {
        this.respawns.push({ t: 2.5, fn: () => this.respawnTestPlayer() });
        return;
      }
      const teamsBefore = this.aliveTeams().size;
      c.alive = false;
      if (c.mech && c.mech.alive) c.mech.destroy(null);
      if (!this.teamAlive(c.team)) for (const o of this.combatants) if (o.team === c.team) o.place = teamsBefore;
      if (who && !CW.sameTeam(who, c)) who.kills++;
      if (who && who.isPlayer && !CW.sameTeam(who, c)) this.meta.track('elim');
      if (c.isPlayer) this.profile.stats.deaths++;
      this.feed(`${this.who(who, 'You')} eliminated ${c.isPlayer ? 'you' : c.name}`, who && who.isPlayer ? 'good' : c.isPlayer || (this.teamMode && c.team === 0) ? 'bad' : '');
      if (who && who.isPlayer) this.bigMsg('ELIMINATED ' + c.name.toUpperCase(), '', 1.5);
      if (c.isPlayer && this.teamMode && this.teamAlive(0)) this.bigMsg('YOU\'RE OUT', 'Spectating your team…', 2.5);
      if (this.teamMode && !this.teamAlive(c.team)) this.feed(`Team ${TEAMS[c.team].name} is out!`, c.team === 0 ? 'bad' : 'good');
    }

    onPlayerHit(point, dmg, quiet) {
      this.hitMarker = Math.max(this.hitMarker || 0, 0.15);
      if (this.tutorial.active) this.tutorial.onHit();
      if (!quiet || Math.random() < 0.25) this.audio.hit();
      if (point && dmg && this.settings.dmgNumbers) this.damageNumber(point, dmg);
    }
    onPlayerDamaged(d, who) {
      if (d > 0) {
        this.damageFlash = Math.min(1, (this.damageFlash || 0) + d / 40);
        this.cam.shake = Math.min(1.2, this.cam.shake + d / 60);
      }
      // red arc on screen pointing toward whoever hit you
      const src = who && (who.mech && who.mech.alive ? who.mech.pos : who.pilot ? who.pilot.pos : null);
      const me = this.player.mech && this.player.mech.alive ? this.player.mech.pos : this.player.pilot ? this.player.pilot.pos : null;
      if (src && me) {
        const a = Math.atan2(src.x - me.x, src.z - me.z) - Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
        const el = $('dmgDir');
        el.style.transform = `rotate(${-a}rad)`;
        el.style.opacity = 1;
        clearTimeout(this._dirT);
        this._dirT = setTimeout(() => (el.style.opacity = 0), 700);
      }
    }
    flashClip() {
      const el = $('clipFlash');
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }

    onWallHit() {
      this.cam.shake = Math.min(1, this.cam.shake + 0.4);
      this.audio.tone(320, 0.15, 'sine', 0.15, 2);
    }
    onExplosion(pos, size) {
      if (this.state !== 'match') return;
      const d = this.camera.position.distanceTo(pos);
      if (d < 40) this.cam.shake = Math.min(1.5, this.cam.shake + (size * (40 - d)) / 60);
    }
    onDash(mech) {
      const c = mech.combatant;
      if (c.isPlayer) {
        this.cam.fovKick = 14;
        this.cam.shake = Math.min(1, this.cam.shake + 0.25);
        this.audio.whoosh();
        if (this.tutorial.active) this.tutorial.onDash();
        else if (!this.isPractice()) this.meta.track('dash');
      }
      this.fx.burst(mech.pos, { n: 10, color: this.trailMat(c), speed: 6, life: 0.5, size: 0.5 });
    }
    onPartBroken(mech, who) {
      if (who && who.isPlayer && mech.combatant !== who) { this.meta.track('parts'); this.killMarker = 0.3; this.audio.tone(220, 0.08, 'square', 0.12, 0.6); }
    }

    // floating damage numbers (pooled DOM elements)
    damageNumber(point, dmg) {
      const v = point.clone().project(this.camera);
      if (v.z > 1) return;
      const box = $('dmgNums');
      let el = this._dmgPool && this._dmgPool.pop();
      if (!el) { el = document.createElement('div'); el.className = 'dmg'; }
      el.textContent = Math.max(1, Math.round(dmg));
      el.classList.toggle('big', dmg >= 25);
      const z = this.uiZoom || 1;
      el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth / z + (Math.random() - 0.5) * 30) + 'px';
      el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight / z) + 'px';
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      box.appendChild(el);
      setTimeout(() => { el.remove(); (this._dmgPool = this._dmgPool || []).push(el); }, 700);
    }

    // wreck streaks: wrecks within 7 s of each other chain up
    onPlayerWreck() {
      const now = this.matchTime;
      this.streak = now - (this.lastWreckT ?? -99) < 7 ? (this.streak || 0) + 1 : 1;
      this.lastWreckT = now;
      this.matchStreak = Math.max(this.matchStreak || 0, this.streak);
      const names = { 2: 'DOUBLE WRECK!', 3: 'TRIPLE WRECK!', 4: 'RAMPAGE!', 5: 'UNSTOPPABLE!' };
      if (!this.firstBlood) { this.firstBlood = true; this.announce('FIRST BLOOD', '+25 🪙'); this.bonusCoins += 25; }
      else if (this.streak >= 2) { this.announce(names[Math.min(5, this.streak)], `+${this.streak * 15} 🪙`); this.bonusCoins += this.streak * 15; }
      this.meta.track('wreck');
    }
    announce(title, sub) {
      const el = $('announce');
      el.innerHTML = `<div class="an-title">${title}</div><div class="an-sub">${sub || ''}</div>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      this.audio.fanfare();
    }

    checkEnd(dt) {
      if (this.isPractice()) return;
      if (this.ended) {
        if (!this.slowmoDone) { this.slowmoDone = true; this.slowmo = 1.5; }
        this.endTimer -= dt;
        if (this.endTimer <= 0 && this.state === 'match') this.showResults();
        return;
      }
      if (this.net.client) return; // online: the host's game decides when the match is over (see netEnd)
      const teams = this.aliveTeams();
      const p = this.player;
      if (this.obj) {
        const r = this.obj.check();
        if (!r) return;
        this.ended = true;
        this.won = r.winner === p.team;
        // placings by objective score (race: by race position)
        if (this.modeId === 'race') p.place = this.obj.rank(p);
        else {
          const order = [...new Set(this.combatants.map((c) => c.team))].sort((a, b) => this.obj.teamScore(b) - this.obj.teamScore(a));
          if (r.winner >= 0) order.splice(order.indexOf(r.winner), 1), order.unshift(r.winner);
          p.place = order.indexOf(p.team) + 1;
        }
        if (this.modeId === 'boss') this.teamCount = 2;
        if (this.modeId === 'race') this.teamCount = this.combatants.length;
        this.endTimer = 3;
        this.bigMsg(this.won ? 'VICTORY!' : 'DEFEAT', this.obj.summary(p), 3);
        if (document.pointerLockElement) document.exitPointerLock();
        this.net.matchEnded(r.winner, this.netPlaces(r.winner));
        return;
      }
      if (this.survival) {
        // survival ends only when your whole team is out
        if (!this.teamAlive(0)) {
          this.ended = true;
          this.won = false;
          this.endTimer = 2.8;
          this.bigMsg(`WAVE ${this.survival.wave}`, `You cleared ${this.survival.cleared} wave${this.survival.cleared === 1 ? '' : 's'}!`, 2.8);
          if (document.pointerLockElement) document.exitPointerLock();
          this.net.matchEnded(-1, {});
        }
        return;
      }
      // online the match goes on while any player is still in it (the others spectate)
      const playerOut = this.net.active ? !this.combatants.some((c) => c.human && c.alive) : this.teamMode ? !teams.has(p.team) : !p.alive;
      if (playerOut || teams.size <= 1) {
        this.ended = true;
        const winTeam = teams.size === 1 ? [...teams][0] : -1;
        this.won = winTeam === p.team;
        if (winTeam >= 0) for (const c of this.combatants) if (c.team === winTeam) c.place = 1;
        this.net.matchEnded(winTeam, this.netPlaces(winTeam));
        this.endTimer = 2.8;
        const teamWord = this.teamMode ? 'Your team' : 'You';
        this.bigMsg(this.won ? 'VICTORY!' : 'DEFEAT', this.won ? (this.teamMode ? 'Your team wins!' : 'Last mech standing') : `${teamWord} placed #${p.place}`, 2.8);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }

    // online (host): every player's placing for the end-of-match message
    netPlaces(winner) {
      const out = {};
      let order = null;
      if (this.obj && this.modeId !== 'race') {
        order = [...new Set(this.combatants.map((c) => c.team))].sort((a, b) => this.obj.teamScore(b) - this.obj.teamScore(a));
        if (winner >= 0) { order.splice(order.indexOf(winner), 1); order.unshift(winner); }
      }
      for (const c of this.combatants) {
        if (!c.human) continue;
        out[c.netId] = this.modeId === 'race' && this.obj ? this.obj.rank(c) : order ? order.indexOf(c.team) + 1 : c.team === winner ? 1 : c.place || 2;
      }
      return out;
    }

    // online (not host): the host's game says the match is over
    netEnd(e) {
      if (this.ended) return;
      const p = this.player;
      this.ended = true;
      this.endTimer = e.t || 3;
      this.won = !this.survival && e.w >= 0 && e.w === p.team;
      if (e.pl && e.pl[p.netId]) p.place = e.pl[p.netId];
      if (this.modeId === 'race') this.teamCount = this.combatants.length;
      if (this.survival) {
        const sv = this.survival;
        this.bigMsg(`WAVE ${sv.wave}`, `You cleared ${sv.cleared} wave${sv.cleared === 1 ? '' : 's'}!`, 2.8);
      } else {
        const sub = this.obj ? this.obj.summary(p) : this.won ? (this.teamMode ? 'Your team wins!' : 'Last mech standing') : `${this.teamMode ? 'Your team' : 'You'} placed #${p.place}`;
        this.bigMsg(this.won ? 'VICTORY!' : 'DEFEAT', sub, 2.8);
      }
      if (document.pointerLockElement) document.exitPointerLock();
    }

    updateSuddenDeath(dt) {
      if (this.isPractice() || this.ended || this.survival || this.obj) return;
      if (!this.suddenDeath && this.matchTime >= SUDDEN_DEATH) {
        this.suddenDeath = true;
        this.bigMsg('SUDDEN DEATH', 'All cores are overheating!', 2.5);
        this.feed('Sudden death: cores and pilots lose health over time', 'bad');
      }
      if (!this.suddenDeath) return;
      for (const m of this.mechs) if (m.alive && m.core.alive && !m.remote) { m.core.hp -= 3 * dt; if (m.core.hp <= 0) m.breakPart(m.core, null); }
      for (const pl of this.pilots) if (pl.alive && !pl.remote) { pl.hp -= 1.5 * dt; if (pl.hp <= 0) pl.hit(1, null); }
    }

    showResults() {
      this.state = 'results';
      const p = this.player;
      const nTeams = this.teamCount;
      const sv = this.survival;
      if (sv) p.place = sv.cleared >= 10 ? 1 : sv.cleared >= 5 ? 2 : 3; // for the results chest tier
      const xp = sv
        ? 20 + sv.cleared * 35 + p.wrecks * 15 + (this.bonusXp || 0)
        : 20 + p.kills * 30 + p.wrecks * 10 + (this.won ? 100 : 0) + (nTeams - p.place) * (this.teamMode ? 20 : 10) + (this.bonusXp || 0);
      const beforeRank = this.rankIndex();
      const beforeLv = this.level();
      this.profile.xp += xp;
      const lvUp = this.level() > beforeLv;
      const rankUp = this.rankIndex() > beforeRank;
      // coins, stats, challenges
      const levelBonus = lvUp ? (this.level() - beforeLv) * 100 : 0;
      const featured = this.inFeatured();
      const weekly = this.inWeekly();
      const coins = Math.round((Math.round(xp / 2) + this.bonusCoins) * (featured ? CW.FEATURED.COIN_MULT : 1) * (weekly ? 1.5 : 1)) + levelBonus;
      // Cog Pass points: more for doing well, a bonus in featured and weekly events
      const passPts = Math.min(CW.ECON.PASS.match, 15 + (this.won ? 15 : 0) + Math.max(0, 10 - (p.place - 1) * 3) + (featured ? 5 : 0) + (weekly ? 10 : 0));
      this.lastPassPts = passPts;
      this.meta.addCoins(coins, this.isPractice() ? null : 'match', null, passPts, xp);
      const st = this.profile.stats;
      st.matches++;
      if (this.won) st.wins++;
      st.bestStreak = Math.max(st.bestStreak, this.matchStreak || 0);
      this.meta.track(this.modeId);
      if (this.won) this.meta.track('win');
      if (this.won && this.teamMode) this.meta.track('team');
      if (this.won && p.mech.totalParts >= 30) st.bigWin = (st.bigWin || 0) + 1;
      if (this.won && p.mech.alive && p.mech.parts.every((q) => q.alive)) st.flawless = (st.flawless || 0) + 1;
      let newBest = false;
      if (sv) { newBest = sv.cleared > (st.bestWave || 0); st.bestWave = Math.max(st.bestWave || 0, sv.cleared); }
      // per-mode / per-map records for achievements and challenges
      st.modes = st.modes || {}; st.modes[this.modeId] = 1;
      st.maps = st.maps || {}; st.maps[this.world.arena.id] = 1;
      const ch = this.profile.challenges;
      ch.mapsToday = Array.from(new Set((ch.mapsToday || []).concat([this.world.arena.id])));
      this.meta.track('maps', ch.mapsToday.length);
      if (this.modeId === 'koth' && this.won) { st.kothWins = (st.kothWins || 0) + 1; this.meta.track('kothwin'); }
      if (this.modeId === 'race') { if (p.place <= 3) this.meta.track('podium'); if (this.won) st.raceWins = (st.raceWins || 0) + 1; }
      if (this.modeId === 'gold') { const gld = this.obj.carried(p); st.maxGold = Math.max(st.maxGold || 0, gld); this.meta.track('goldcollect', gld); }
      if (this.modeId === 'boss' && this.won) { st.bossKills = (st.bossKills || 0) + 1; this.meta.track('bosswin'); }
      if (this.modeId === 'bounty' && this.won) this.meta.track('bountywin');
      const achieved = CW.checkAchievements(this);
      const unlocked = [];
      for (let lv = beforeLv + 1; lv <= this.level(); lv++) unlocked.push(...CW.unlocksAt(lv));
      this.saveProfile();
      if (this.won) this.confetti();
      CW.Platform.gameplayStop();
      if (this.won) CW.Platform.happyTime();
      // portal builds only: watch an ad to double this match's coins
      const dbl = $('resDouble');
      dbl.classList.toggle('hidden', !CW.Platform.hasRewarded);
      dbl.disabled = false;
      dbl.textContent = `📺 Watch an ad: double coins (+${coins} 🪙)`;
      dbl.onclick = () => {
        dbl.disabled = true;
        CW.Platform.rewardedAd(this).then((ok) => {
          if (!ok) { dbl.disabled = false; return this.toast('Ad not available right now'); }
          this.meta.addCoins(coins, 'ad');
          this.saveProfile();
          dbl.textContent = `✔ +${coins} 🪙 added`;
        });
      };
      $('hud').classList.add('hidden');
      $('results').classList.remove('hidden');
      $('resPass').textContent = this.account.loggedIn ? (this.isPractice() ? '' : `🎟 +${passPts} Cog Pass points`) : '';
      this.account.onResults(); // Quick Match trophies
      $('resTitle').textContent = this.won ? 'VICTORY!' : 'DEFEAT';
      $('resTitle').className = this.won ? 'win' : 'lose';
      const fmt = FORMATS[this.formatId];
      $('resPlace').textContent = `${MODES[this.modeId].name} · ${fmt.name} ${fmt.label} · ${this.teamMode ? 'Team ' : ''}#${p.place} of ${nTeams}`;
      if (this.obj) $('resPlace').textContent += ` · ${this.obj.summary(p)}`;
      if (this.modeId === 'race' && !this.won) $('resTitle').textContent = `#${p.place} PLACE`;
      if (sv) {
        $('resTitle').textContent = `WAVE ${sv.wave}`;
        $('resTitle').className = newBest ? 'win' : 'lose';
        $('resPlace').textContent = `Survival · ${fmt.name} · cleared ${sv.cleared} wave${sv.cleared === 1 ? '' : 's'}${newBest ? ' · 🏆 NEW BEST!' : ` · best ${st.bestWave}`}`;
        if (newBest) this.confetti();
      }
      $('resStats').innerHTML = `
        <div><b>${p.wrecks}</b><span>Mechs wrecked</span></div>
        <div><b>${p.kills}</b><span>Eliminations</span></div>
        <div><b>${Math.floor(this.matchTime / 60)}:${String(Math.floor(this.matchTime % 60)).padStart(2, '0')}</b><span>Time</span></div>
        <div><b>+${xp}</b><span>XP</span></div>
        <div><b>+${coins}</b><span>🪙 Coins</span></div>
        <div><b>${this.matchStreak || 0}</b><span>Best streak</span></div>`;
      $('resChallenges').innerHTML = this.profile.challenges.list.map((c) => this.meta.challengeRow(c, true)).join('');
      let extra = `Level ${this.level()} · ${this.profile.coins} 🪙`;
      if (lvUp) extra = `⬆ Level up! You are now level ${this.level()} (+${levelBonus} 🪙)`;
      if (rankUp) extra += ` · 🎉 New rank: ${CW.RANKS[this.rankIndex()].name}! You can now combine ${CW.RANKS[this.rankIndex()].domains} movement types.`;
      if (unlocked.length) extra += ` · 🔓 New parts: ${unlocked.join(', ')}`;
      if (featured) extra = `⭐ Featured event: ${CW.FEATURED.COIN_MULT}× coins! · ` + extra;
      $('resExtra').textContent = extra;
      this.setupMatchChest(p.place, sv ? 3 : nTeams);
      $('resAch').innerHTML = achieved.map((a) => `<div class="ach-pop">🏆 <b>${a.name}</b> · ${a.desc} · +${a.reward} 🪙</div>`).join('');
      $('resAgain').textContent = this.net.room ? 'Back to room' : 'Play again';
    }

    // Free reward chest after every match (better place = better chest). Earned, never bought.
    setupMatchChest(place, nTeams) {
      const box = $('resChest');
      const tier = place === 1 ? 'epic' : place <= Math.ceil(nTeams / 2) ? 'rare' : 'common';
      const T = CW.CHEST_TYPES[tier];
      box.className = 'res-chest ' + tier;
      box.innerHTML = `<div class="rc-icon">🧰</div><div class="rc-text">${T.name}<br><small>Click to open!</small></div>`;
      box.onclick = () => {
        if (box.classList.contains('opening') || box.classList.contains('open')) return;
        box.classList.add('opening');
        this.audio.click(1.2);
        setTimeout(() => {
          const p = this.profile;
          const coins = T.coins + Math.floor(Math.random() * T.coins);
          this.meta.addCoins(coins, 'chest');
          let extra = '';
          const chance = { common: 0.06, rare: 0.15, epic: 0.35 }[tier];
          if (Math.random() < chance) {
            // a free cosmetic the player doesn't own yet
            const pool = CW.SHOP.paints.filter((x) => !p.owned.paints.includes(x.id)).map((x) => ['paints', x])
              .concat(CW.SHOP.trails.filter((x) => !p.owned.trails.includes(x.id)).map((x) => ['trails', x]));
            if (pool.length) {
              const [kind, item] = pool[Math.floor(Math.random() * pool.length)];
              p.owned[kind].push(item.id);
              extra = `<br>✨ Unlocked ${kind === 'paints' ? 'paint' : 'trail'}: <b>${item.name}</b>!`;
              this.workshop.buildPaint();
            }
          }
          this.meta.track('chest');
          this.saveProfile();
          box.classList.remove('opening');
          box.classList.add('open');
          box.innerHTML = `<div class="rc-icon">✨</div><div class="rc-text">+${coins} 🪙${extra}</div>`;
          this.audio.fanfare();
          this.confetti();
        }, 900);
      };
    }

    renderScoreboard() {
      const rows = this.combatants.slice().sort((a, b) => a.team - b.team || b.wrecks + b.kills - (a.wrecks + a.kills));
      const name = (c) => esc(c.isPlayer ? this.profile.name || 'You' : c.name);
      $('scoreboard').innerHTML = `<div class="sb-title">${MODES[this.modeId].name} · ${FORMATS[this.formatId].name} ${FORMATS[this.formatId].label}</div>
        <table><tr><th></th><th>Pilot</th><th>Mech</th><th>💥 Wrecks</th><th>☠ Elims</th>${this.obj ? '<th>🎯 Objective</th>' : ''}<th>Status</th></tr>
        ${rows.map((c) => `<tr class="${c.isPlayer ? 'me' : ''} ${c.alive ? '' : 'out'}"><td><i class="dot" style="background:${hex(c.color)}"></i></td><td>${name(c)}${this.teamMode && TEAMS[c.team] ? ` <span class="small">${TEAMS[c.team].name}</span>` : ''}</td><td>${esc(c.mech.name)}</td><td>${c.wrecks}</td><td>${c.kills}</td>${this.obj ? `<td>${this.obj.summary(c)}</td>` : ''}<td>${!c.alive ? '❌ Out' : c.respawnT !== undefined ? `⏳ ${Math.ceil(c.respawnT)}s` : c.mech.alive ? '🤖 Mech' : '🧍 On foot'}</td></tr>`).join('')}</table>`;
    }

    confetti() {
      const box = $('confetti');
      box.innerHTML = '';
      const cols = ['#ffc43d', '#3a86ff', '#ff006e', '#06d6a0', '#ffffff', '#fb5607'];
      for (let i = 0; i < 90; i++) {
        const d = document.createElement('i');
        d.style.left = Math.random() * 100 + '%';
        d.style.background = cols[i % cols.length];
        d.style.animationDelay = Math.random() * 1.2 + 's';
        d.style.animationDuration = 2 + Math.random() * 2 + 's';
        d.style.transform = `rotate(${Math.random() * 360}deg)`;
        box.appendChild(d);
      }
      setTimeout(() => (box.innerHTML = ''), 5000);
    }

    // ---------------- HUD ----------------
    feed(msg, cls) {
      const el = document.createElement('div');
      el.className = 'feed-item ' + (cls || '');
      el.textContent = msg;
      $('feed').prepend(el);
      setTimeout(() => el.remove(), 6000);
      while ($('feed').children.length > 6) $('feed').lastChild.remove();
    }
    bigMsg(title, sub, dur) {
      $('bigTitle').textContent = title;
      $('bigSub').textContent = sub || '';
      $('big').classList.add('show');
      clearTimeout(this._bigT);
      this._bigT = setTimeout(() => $('big').classList.remove('show'), dur * 1000);
    }

    buildTags() {
      const box = $('tags');
      box.innerHTML = '';
      for (const c of this.combatants) {
        if (c.isPlayer) continue;
        const ally = c.team === this.player.team;
        const el = document.createElement('div');
        el.className = 'tag' + (ally ? ' ally' : '');
        el.innerHTML = `<div class="tag-name" style="color:${hex(c.color)}"></div><div class="tag-bar"><i></i></div>`;
        el.firstChild.textContent = (ally ? '▲ ' : '') + (c.human && this.net.active ? '🌐 ' : '') + c.name;
        box.appendChild(el);
        c.tagEl = el;
        c.tagBar = el.querySelector('i');
      }
    }

    // who the camera follows: the player, or an ally/anyone while spectating
    viewTarget() {
      const p = this.player;
      if (p.alive && ((p.mech && p.mech.alive && p.mech.occupied) || (p.pilot && p.pilot.alive))) { this.spectating = null; return p; }
      if (!p.alive) {
        if (!this.spectating || !this.spectating.alive) {
          this.spectating = this.combatants.find((c) => c.alive && c.team === p.team) || this.combatants.find((c) => c.alive) || null;
        }
        return this.spectating;
      }
      return p;
    }

    // while a flying mech is in the air: how to go up and down, right in the middle of the screen
    // (the first take-off also says it big, once)
    updateFlyHint() {
      const p = this.player, m = p && p.mech;
      const on = !!(this.state === 'match' && !this.spectator && m && m.alive && m.occupied && (m.rotors > 0 || m.isPlane) && m.medium === 'air' && m.pos.y - m.baseOff > 2);
      let el = $('flyHint');
      if (!el) { el = document.createElement('div'); el.id = 'flyHint'; $('hud').appendChild(el); }
      el.classList.toggle('hidden', !on);
      if (!on) return;
      const keys = this.settings.keys || {};
      const up = CW.keyName(keys.up || 'Space'), down = CW.keyName(keys.down || 'KeyC');
      const goingDown = this.keys.KeyC || this.keys.KeyQ || this.keys.ControlLeft || this.keys.ControlRight;
      const html = this.touch.on ? `✈ <b>⬆</b> climb · <b class="${goingDown ? 'on' : ''}">⬇</b> fly down <small>(buttons by the stick)</small>`
        : `✈ Hold <kbd class="${this.keys.Space ? 'on' : ''}">${up}</kbd> to climb · <kbd class="${goingDown ? 'on' : ''}">${down}</kbd> to fly down`;
      if (el.innerHTML !== html) el.innerHTML = html;
      if (!this.settings.flyTold) {
        this.settings.flyTold = true;
        this.saveProfile();
        this.bigMsg('✈ You are flying!', this.touch.on ? '⬆ climbs, ⬇ flies down (next to the stick)' : `Hold ${up} to climb, ${down} to fly down`, 3);
      }
    }

    updateHud() {
      this.updateFlyHint();
      const p = this.player;
      // online badge (ping), refreshed a few times a second
      this._netHudT = (this._netHudT || 0) - 1;
      if (this._netHudT <= 0) {
        this._netHudT = 20;
        const ni = $('netInfo');
        ni.classList.toggle('hidden', !this.net.active);
        if (this.net.active) ni.textContent = this.net.hud();
      }
      const v = new V3();
      const w = window.innerWidth / (this.uiZoom || 1), h = window.innerHeight / (this.uiZoom || 1);
      for (const c of this.combatants) {
        if (!c.tagEl) continue;
        let pos = null, frac = 0, onFoot = false;
        if (c.mech && c.mech.alive) { pos = c.mech.pos; frac = c.mech.core.hp / c.mech.core.maxHp; v.copy(pos); v.y += c.mech.radius + 0.6; }
        if (c.pilot && c.pilot.alive) { pos = c.pilot.pos; frac = c.pilot.hp / c.pilot.maxHp; onFoot = true; v.copy(pos); v.y += 2.4; }
        if (!pos || !c.alive) { c.tagEl.style.display = 'none'; continue; }
        const dist = this.camera.position.distanceTo(v);
        v.project(this.camera);
        if (v.z > 1 || dist > 170 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { c.tagEl.style.display = 'none'; continue; }
        c.tagEl.style.display = 'block';
        c.tagEl.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%) scale(${clamp(40 / dist, 0.6, 1.1)})`;
        c.tagBar.style.width = Math.max(0, frac * 100) + '%';
        c.tagBar.classList.toggle('foot', onFoot);
      }

      const st = $('status');
      const view = this.viewTarget();
      if (p.respawnT !== undefined && p.alive) {
        st.innerHTML = `<div class="st-head"><b>Wrecked!</b><span class="medium" style="background:#ff8fab">⏳ RESPAWN</span></div><div class="st-foot">Back in <b>${Math.ceil(p.respawnT)}</b> s${p.lives !== undefined ? ` · ❤ ${p.lives} lives left` : ''}</div>`;
        $('hint').textContent = 'Respawning…';
      } else if (view && view !== p) {
        st.innerHTML = `<div class="st-head"><b>Spectating ${esc(view.name)}</b><span class="medium" style="background:${hex(view.color)}">👁 SPECTATE</span></div><div class="st-foot">You're out. ${this.teamMode ? 'Cheer on your team!' : ''}</div>`;
        $('hint').textContent = 'Esc pause';
      } else if (p.mech && p.mech.alive && p.mech.occupied) {
        const m = p.mech;
        const dom = ['land', 'water', 'air'].filter((d) => m.domains.has(d)).map((d) => `<span class="chip" style="background:${CW.DOMAINS[d].color}">${CW.DOMAINS[d].icon}</span>`).join('');
        const med = CW.DOMAINS[m.medium];
        st.innerHTML = `
          <div class="st-head"><b>${esc(m.name)}</b><span class="medium" style="background:${med.color}">${med.icon} ${med.label.toUpperCase()}</span></div>
          <div class="st-row"><span>Core</span><div class="bar"><i style="width:${(m.core.hp / m.core.maxHp) * 100}%;background:#ffc43d"></i></div></div>
          <div class="st-row"><span>Integrity</span><div class="bar"><i style="width:${m.integrity() * 100}%;background:#7bc950"></i></div></div>
          ${m.shieldMax ? `<div class="st-row"><span>Shield</span><div class="bar"><i style="width:${(m.shield / m.shieldMax) * 100}%;background:#4cc9f0"></i></div></div>` : ''}
          ${m.overcharge > 0 || m.turbo > 0 ? `<div class="buffs">${m.overcharge > 0 ? `<span class="buff oc">⚡ Overcharge ${Math.ceil(m.overcharge)}s</span>` : ''}${m.turbo > 0 ? `<span class="buff tb">💨 Turbo ${Math.ceil(m.turbo)}s</span>` : ''}</div>` : ''}
          <div class="st-row"><span>Dash ⇧</span><div class="bar"><i style="width:${m.dashCd > 0 ? (1 - m.dashCd / (m.dashMax || 1)) * 100 : 100}%;background:${m.dashCd > 0 ? '#8d99ae' : '#ff9f1c'}"></i></div><em class="dash-ready">${m.dashCd > 0 ? m.dashCd.toFixed(1) + 's' : 'READY'}</em></div>
          ${(() => { const sp = CW.SUPERS[this.supers.type(p)], k = p.superCharge || 0; return `<div class="st-row super-row ${k >= 1 ? 'ready' : ''}"><span>${sp.icon} Super</span><div class="bar"><i style="width:${k * 100}%"></i></div><em>${k >= 1 ? (this.touch.on ? 'TAP ⭐' : 'X / RMB') : Math.floor(k * 100) + '%'}</em></div>`; })()}
          ${(() => { const gd = CW.GADGETS[this.gadgets.type(p)], n = this.gadgets.left(p), cd = p.gadgetCd || 0; return `<div class="st-row gadget-row ${n > 0 && cd <= 0 ? 'ready' : ''}"><span>${gd.icon} Gadget</span><div class="pips">${'●'.repeat(n)}${'○'.repeat(Math.max(0, 3 - n))}</div><em>${n <= 0 ? 'used up' : cd > 0 ? cd.toFixed(1) + 's' : this.touch.on ? 'TAP 🧰' : 'G'}</em></div>`; })()}
          ${m.empT > 0 ? '<div class="buffs"><span class="buff emp">⚡ JAMMED by EMP</span></div>' : ''}
          <div class="st-foot"><span>${Math.round(Math.hypot(m.vel.x, m.vel.z) * 3.6)} km/h</span><span>Alt ${Math.round(m.pos.y - m.baseOff)}</span><span class="${m.pr < 1 ? 'bad' : ''}">⚡ ${Math.round(m.pr * 100)}%</span><span>Parts ${m.parts.filter((q) => q.alive).length}/${m.totalParts}</span>${dom}</div>`;
        $('hint').textContent = 'W/S drive · A/D steer · Mouse aim · Click fire · Shift DASH · X / right-click SUPER · G GADGET · Space up/jump · C fly down · V camera · E exit · T chat · Esc menu' + (this.modeId === 'test' ? ' · T back to Workshop' : '');
      } else if (p.pilot && p.pilot.alive) {
        const pl = p.pilot;
        const ownAlive = p.mech && p.mech.alive;
        st.innerHTML = `
          <div class="st-head"><b>On foot</b><span class="medium" style="background:#ff8fab">🧍 PILOT</span></div>
          <div class="st-row"><span>Health</span><div class="bar"><i style="width:${(pl.hp / pl.maxHp) * 100}%;background:#ff5d8f"></i></div></div>
          ${ownAlive ? `<div class="st-row"><span>Your mech</span><div class="bar"><i style="width:${p.mech.integrity() * 100}%;background:#7bc950"></i></div></div>` : '<div class="st-foot bad">Your mech is wrecked</div>'}
          <div class="st-foot">${this.repairing ? `🔧 Repairing… ${p.mech.parts.filter((q) => !q.alive).length ? `(${p.mech.parts.filter((q) => !q.alive).length} parts to rebuild)` : ''}` : this.nearOwnMech ? 'Hold <b>R</b> to repair &amp; rebuild · <b>E</b> to board' : ownAlive ? 'Walk back to your mech to repair it' : 'Stay alive!'}</div>`;
        $('hint').textContent = 'WASD move · Space jump · Mouse aim · Click shoot · E board mech · R repair · Esc pause';
      }

      const t = this.matchTime;
      const clock = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      if (this.isPractice()) {
        $('topInfo').innerHTML = this.modeId === 'tutorial' ? '<b>🎓 TUTORIAL</b> · Esc to skip' : '<b>🏁 TEST DRIVE</b> · targets respawn';
      } else {
        const fmt = FORMATS[this.formatId];
        let counts;
        if (this.teamMode) {
          counts = TEAMS.slice(0, this.teamCount).map((tm, i) => {
            const n = this.combatants.filter((c) => c.team === i && c.alive).length;
            return `<span class="team-pill" style="background:${hex(tm.color)}">${n}</span>`;
          }).join('');
        } else counts = `${this.combatants.filter((c) => c.alive).length} left`;
        const sd = this.suddenDeath ? ' · <span class="bad">SUDDEN DEATH</span>' : t > SUDDEN_DEATH - 30 ? ` · sudden death in ${Math.ceil(SUDDEN_DEATH - t)}s` : '';
        $('topInfo').innerHTML = `<b>${MODES[this.modeId].name}</b> · ${fmt.name} ${fmt.label} · ${counts} · ${clock}${sd}`;
        if (this.obj) $('topInfo').innerHTML = this.obj.hud() + (p.lives !== undefined ? ` · ❤ ${p.lives}` : '');
        if (this.survival) {
          const sv = this.survival;
          const left = this.combatants.filter((c) => c.team !== 0 && c.alive).length;
          $('topInfo').innerHTML = `<b>🛡 Survival</b> · Wave <b>${sv.wave}</b> · ${sv.breakT > 0 ? `next wave in ${Math.ceil(sv.breakT)}s` : `${left} enem${left === 1 ? 'y' : 'ies'} left`} · ${clock}`;
        }
      }
      $('testBar').classList.toggle('hidden', this.modeId !== 'test');
      $('camLost').classList.toggle('hidden', !this.cameraLost);
      const showSb = !!this.keys.Tab && !this.isPractice();
      $('scoreboard').classList.toggle('hidden', !showSb);
      if (showSb) this.renderScoreboard();
      const ei = this.edgeInfo;
      const pmech = p.mech && p.mech.alive && p.mech.occupied;
      // damaged and nobody close by? remind the player how repairing works
      const quiet = pmech && !this.enemiesOf(p).some((e) => e.pos.distanceTo(p.mech.pos) < 45);
      const hurt = pmech && (p.mech.integrity() < 0.6 || p.mech.parts.some((q) => !q.alive));
      const warn = pmech && this.stuckT > 2.5 ? (this.unstuckCd > 0 ? `⚠ Stuck? Unstuck ready in ${Math.ceil(this.unstuckCd)}s` : '⚠ Stuck? Press F to hop free')
        : ei && ei.edge < 18 ? '⚠ ARENA EDGE: force field ahead' : ei && ei.ceiling < 12 ? '⚠ ALTITUDE LIMIT'
          : hurt && quiet && !this.isPractice() ? '🔧 Damaged! Press E to hop out, then hold R next to your mech to repair' : '';
      $('edgeWarn').textContent = warn;
      $('edgeWarn').classList.toggle('hidden', !warn);
      $('camBadge').textContent = this.cameraLost ? '📷✖ chase view' : this.settings.camMode === 'first' ? '📷 First person (V)' : '🎥 Chase cam (V)';
      const cdText = String(this.countdown > 0.5 ? Math.ceil(this.countdown - 0.5) : this.countdown > -0.6 ? 'GO!' : '');
      const cd = $('countdown');
      if (cd.textContent !== cdText) { cd.textContent = cdText; cd.classList.remove('pop'); if (cdText) { void cd.offsetWidth; cd.classList.add('pop'); } }
      $('countdown').style.display = this.countdown > -0.6 && !this.isPractice() ? 'block' : 'none';
      this.hitMarker = Math.max(0, (this.hitMarker || 0) - 1 / 60);
      $('crosshair').classList.toggle('hit', this.hitMarker > 0);
      this.killMarker = Math.max(0, (this.killMarker || 0) - 1 / 60);
      $('crosshair').classList.toggle('kill', this.killMarker > 0);
      this.damageFlash = Math.max(0, (this.damageFlash || 0) - 0.03);
      $('vignette').style.opacity = this.damageFlash;
      this.drawMinimap();
    }

    drawMinimap() {
      const cv = $('minimap');
      const ctx = cv.getContext('2d');
      const S = cv.width;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(this.world.minimap, 0, 0, S, S);
      const R = this.world.minimapRange;
      const toMap = (x, z) => [(x / R / 2 + 0.5) * S, (z / R / 2 + 0.5) * S];
      for (const it of this.pickups.items) {
        if (!it.active) continue;
        const [x, y] = toMap(it.pos.x, it.pos.z);
        ctx.fillStyle = hex(CW.POWERUPS[it.kind].color);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2.5, -2.5, 5, 5); ctx.restore();
      }
      if (this.obj && this.obj.minimap) this.obj.minimap(ctx, toMap);
      for (const ch of this.chests.items) {
        if (ch.opened) continue;
        const [x, y] = toMap(ch.pos.x, ch.pos.z);
        ctx.fillStyle = hex(CW.CHEST_TYPES[ch.rarity].color);
        ctx.strokeStyle = '#fff';
        ctx.fillRect(x - 3.5, y - 2.5, 7, 5); ctx.strokeRect(x - 3.5, y - 2.5, 7, 5);
      }
      for (const c of this.combatants) {
        if (!c.alive) continue;
        const ent = c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot || (c.mech && c.mech.alive ? c.mech : null);
        if (!ent) continue;
        const [x, y] = toMap(ent.pos.x, ent.pos.z);
        ctx.fillStyle = hex(c.color);
        ctx.strokeStyle = c.team === this.player.team && this.teamMode ? '#fff' : '#000';
        if (c.isPlayer) {
          const yaw = ent === c.mech ? ent.yaw : this.cam.yaw;
          ctx.save(); ctx.translate(x, y); ctx.rotate(-yaw);
          ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath();
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.fill(); ctx.stroke(); ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(x, y, ent === c.pilot ? 2.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      if (this.player.mech && this.player.mech.alive && !this.player.mech.occupied) {
        const [x, y] = toMap(this.player.mech.pos.x, this.player.mech.pos.z);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.strokeRect(x - 4, y - 4, 8, 8); ctx.lineWidth = 1;
      }
    }

    // ---------------- camera ----------------
    updateCamera(dt) {
      // the view turns with your own steering in the same frame (no lag, so aiming stays steady)
      const own = this.player && this.player.mech;
      if (own && own.camFollowYaw) { this.cam.yaw += own.camFollowYaw; own.camFollowYaw = 0; }
      const view = this.viewTarget();
      if (!view) return;
      let pivot, dist;
      const vm = view.mech && view.mech.alive && view.mech.occupied ? view.mech : null;
      const wantFirst = vm && view === this.player && this.settings.camMode === 'first';
      const firstPerson = wantFirst && vm.cameraOk;
      this.cameraLost = wantFirst && !vm.cameraOk;
      // show/hide our own camera part (we're looking out of it)
      // (plus the parts touching it, so nothing of our own mech fills the screen)
      // (rotor blades sweep wide, so nearby rotors are hidden too)
      const hide = firstPerson ? vm.parts.filter((p) => {
        if (!p.alive) return false;
        const d = Math.hypot(p.x - vm.camPart.x, p.y - vm.camPart.y, p.z - vm.camPart.z);
        return d < 1.05 || (p.t === 'rotor' && d < 2.6 && p.y >= vm.camPart.y - 1);
      }).map((p) => p.obj) : [];
      for (const o of this.fpHidden || []) if (!hide.includes(o)) o.visible = true;
      for (const o of hide) o.visible = false;
      this.fpHidden = hide;
      const near = firstPerson ? 0.05 : 0.1;
      if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
      if (vm) {
        pivot = vm.pos.clone(); pivot.y += 1.2 + vm.radius * 0.55;
        dist = 5 + vm.radius * 1.3;
      } else if (view.pilot) {
        pivot = view.pilot.pos.clone(); pivot.y += 1.7;
        const right = new V3(Math.cos(this.cam.yaw), 0, -Math.sin(this.cam.yaw));
        pivot.addScaledVector(right, 0.8);
        dist = 4.5;
      } else if (view.mech && view.mech.alive) {
        pivot = view.mech.pos.clone(); pivot.y += 1.6; dist = 10;
      } else return;
      if (view !== this.player) dist += 4;
      const cp = Math.cos(this.cam.pitch), spch = Math.sin(this.cam.pitch);
      const dir = new V3(-Math.sin(this.cam.yaw) * cp, spch, -Math.cos(this.cam.yaw) * cp);
      const ground = (v) => this.world.groundAt(v.x, v.z, v.y);
      if (firstPerson) {
        // look out of the Camera part's lens; pressed against a wall, the lens backs off so you still see
        this.cam.pos.copy(vm.camPart.wp).addScaledVector(dir, 0.4);
        this.cam.pos.y += 0.05;
        for (let i = 0; i < 6 && this.cam.pos.clone().addScaledVector(dir, 0.6).y < ground(this.cam.pos.clone().addScaledVector(dir, 0.6)) + 0.2; i++) this.cam.pos.addScaledVector(dir, -0.35);
        const gy = ground(this.cam.pos) + 0.35;
        if (this.cam.pos.y < gy) this.cam.pos.y = gy;
      } else {
        // a cliff or building between your mech and the camera: the camera comes in front of it
        let reach = dist;
        for (let t = 1; t <= dist; t += 0.5) {
          const p = pivot.clone().addScaledVector(dir, -t);
          if (p.y < ground(p) + 0.4) { reach = Math.max(1.6, t - 0.8); break; }
        }
        const want = pivot.clone().addScaledVector(dir, -reach);
        const gy = ground(want) + 1.2;
        if (want.y < gy) want.y = gy;
        this.cam.pos.lerp(want, 1 - Math.exp(-(reach < dist ? 30 : 18) * dt));
      }
      // juice: shake + FOV kick
      this.cam.shake = Math.max(0, this.cam.shake - dt * 2.5);
      this.cam.fovKick = Math.max(0, this.cam.fovKick - dt * 25);
      const sh = this.settings.shake ? this.cam.shake * this.cam.shake * 0.9 : 0;
      this.camera.position.copy(this.cam.pos).add(new V3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
      this.camera.lookAt(this.camera.position.clone().add(dir));
      // speed sensation: the view widens a little as you go fast
      const spd = vm ? Math.hypot(vm.vel.x, vm.vel.y, vm.vel.z) : 0;
      this.cam.speedFov += (clamp((spd - 18) * 0.35, 0, 12) - (this.cam.speedFov || 0)) * Math.min(1, dt * 3);
      const fov = this.settings.fov + this.cam.fovKick + this.cam.speedFov;
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.world.updateOcclusion(this.cam.pos, firstPerson ? null : pivot);
      // aim ray (ignores own team)
      const origin = this.cam.pos.clone();
      let best = 400;
      const self = this.player;
      for (const m of this.mechs) {
        if (!m.alive || CW.sameTeam(m.combatant, self)) continue;
        const oc = m.pos.clone().sub(origin);
        const t = oc.dot(dir);
        if (t < 0) continue;
        const d2 = oc.lengthSq() - t * t;
        const r = m.radius * 0.8;
        if (d2 < r * r && t < best) best = t - Math.sqrt(r * r - d2) * 0.5;
      }
      for (const pl of this.pilots) {
        if (!pl.alive || CW.sameTeam(pl.combatant, self)) continue;
        const oc = pl.center.clone().sub(origin);
        const t = oc.dot(dir);
        if (t < 0) continue;
        if (oc.lengthSq() - t * t < 1.2 && t < best) best = t;
      }
      for (let t = firstPerson ? 0.5 : dist + 1; t < best; t += 1.5) {
        const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
        if (y < this.world.groundAt(x, z, y)) { best = t; break; }
      }
      this.cam.aim.copy(origin).addScaledVector(dir, best);
      this.sun.position.copy(pivot).addScaledVector(this.world.sunDir, 130);
      this.sun.target.position.copy(pivot);
      // headlight shines where you look
      this.headlight.position.copy(this.camera.position);
      this.headlight.target.position.copy(this.camera.position).addScaledVector(dir, 20);
      const under = this.camera.position.y < CW.WATER_Y;
      this.scene.fog.color.copy(under ? this.waterFog : this.skyColor);
      this.scene.fog.near = under ? 1 : 140;
      this.scene.fog.far = under ? 45 : this.world.fogFar || 430;
      this.scene.background.copy(under ? this.waterFog : this.skyColor);
      this.world.sky.visible = !under;
    }

    // Your current mech on a spinning pedestal by the lake, shown behind the main menu
    // the lobby mech again (after a new finish)
    refreshShowcase() { if (this.state === 'menu' && this.showcase) this.buildShowcase(); }

    buildShowcase() {
      if (this.showcase) this.scene.remove(this.showcase);
      if (!this.showcaseSpot) {
        let best = new V3(-20, 5, 20);
        for (let r = 0; r < 90 && !this.showcaseSpot; r += 3)
          for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const x = -15 + Math.cos(a) * r, z = 25 + Math.sin(a) * r;
            const h = this.world.groundAt(x, z);
            const ring = [0, 1.57, 3.14, 4.71].map((q) => this.world.groundAt(x + Math.cos(q) * 5, z + Math.sin(q) * 5));
            const flat = Math.max(...ring, h) - Math.min(...ring, h) < 0.9;
            if (h > 2 && h < 14 && flat) { best = new V3(x, Math.max(...ring, h), z); this.showcaseSpot = best; break; }
          }
        this.showcaseSpot = best;
      }
      const g = new THREE.Group();
      const parts = CW.ensureCamera(this.currentBp.parts).parts;
      const color = this.currentBp.color || this.playerColor;
      let minY = 0;
      for (const p of parts) {
        const o = CW.buildPartMesh(p.t, color, this.profile.finish);
        o.position.set(p.x, p.y, p.z);
        g.add(o);
        minY = Math.min(minY, p.y + 0.5 - Math.max(0.5, CW.PARTS[p.t].radius || 0)); // big wheels reach lower
      }
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 0.8, 32), CW.mat(0x2e3a63));
      ped.position.y = minY - 0.9;
      ped.receiveShadow = true;
      g.add(ped);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.1, 8, 48), CW.matBasic(0xffc43d));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = minY - 0.45;
      g.add(ring);
      g.position.copy(this.showcaseSpot).add(new V3(0, 1.4 - minY, 0));
      this.showcaseBase = undefined;
      this.showcase = g;
      this.scene.add(g);
    }

    // Other mechs on the lobby stage: your party in the menu; while searching, every player who joins
    // drops in from the sky (and the bots at the end). `list` = [{ key, bp, color }], up to 7.
    updateStage(dt) {
      const want = [];
      const net = this.net, acct = this.account;
      if (this.state === 'menu' && acct && acct.party && acct.me) {
        for (const m of acct.party.members) if (m.name !== acct.me.name && m.bp) want.push({ key: 'p:' + m.name, bp: m.bp });
      } else if (this.state === 'lobby' && net.room) {
        for (const p of net.room.players) if (p.id !== net.id && p.bp) want.push({ key: 'r:' + p.id, bp: p.bp });
        net.room.bots.forEach((b, i) => want.push({ key: 'b:' + b.id, bp: CW.PRESETS[i % CW.PRESETS.length] }));
      }
      this.stage = this.stage || new Map();
      const keys = new Set(want.slice(0, 7).map((w) => w.key));
      for (const [k, s] of this.stage) if (!keys.has(k) || !this.showcase || !this.showcase.visible) { this.scene.remove(s.g); this.scene.remove(s.ped); this.stage.delete(k); }
      if (!this.showcase || !this.showcase.visible) return;
      // slots beside and behind your mech, as seen from the lobby camera
      const c = this.showcase.position, a = 0.9;
      const back = new V3(-Math.cos(a), 0, -Math.sin(a)), side = new V3(-back.z, 0, back.x);
      const slots = [[7, 1.5], [-7, 1.5], [10.5, 6], [-10.5, 6], [13.5, 11], [-13.5, 11], [0, 12]];
      want.slice(0, 7).forEach((w, i) => {
        let s = this.stage.get(w.key);
        const at = c.clone().addScaledVector(side, slots[i][0]).addScaledVector(back, slots[i][1]);
        if (!s) {
          const g = new THREE.Group();
          let minY = 0;
          for (const p of CW.ensureCamera(w.bp.parts).parts) {
            const o = CW.buildPartMesh(p.t, w.bp.color || 0x3a86ff, w.bp.fin);
            o.position.set(p.x, p.y, p.z);
            g.add(o);
            minY = Math.min(minY, p.y + 0.5 - Math.max(0.5, CW.PARTS[p.t].radius || 0)); // big wheels reach lower
          }
          g.scale.setScalar(0.85);
          this.scene.add(g);
          // its own little pedestal, level with yours
          const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.6, 24), CW.mat(0x2e3a63));
          ped.receiveShadow = true;
          this.scene.add(ped);
          s = { g, ped, off: -minY * 0.85, y: 18, vy: 0, bounced: false, spin: Math.random() * 6 };
          this.stage.set(w.key, s);
        }
        // fall in, bounce once, then stand and turn a little
        const top = this.showcaseSpot.y + 0.9;
        s.ped.position.set(at.x, top - 0.3, at.z);
        const floor = top + s.off;
        if (s.y > 0 || s.vy !== 0) {
          s.vy -= 38 * dt;
          s.y += s.vy * dt;
          if (s.y <= 0) { s.y = 0; s.vy = s.bounced ? 0 : -s.vy * 0.3; s.bounced = true; if (s.vy) this.audio.tone(140, 0.06, 'triangle', 0.08); }
        }
        s.spin += dt;
        s.g.position.set(at.x, floor + s.y, at.z);
        s.g.rotation.y = Math.atan2(-back.x, -back.z) + Math.sin(s.spin * 0.7) * 0.5;
      });
    }

    // the mech on display in the lobby: a click/tap on it or close around it opens it in the Workshop
    // (only in the lobby itself: any panel or screen on top catches the click first)
    bindShowcase() {
      const menu = $('menu');
      const ray = new THREE.Raycaster();
      const near = (e) => {
        // empty lobby space counts (also the invisible layout boxes), buttons/cards/inputs keep their own clicks
        if (this.state !== 'menu' || !this.showcase || !menu.contains(e.target) || e.target.closest('button, input, select, a, label, .card, .party-bar')) return false;
        const x = (e.clientX / innerWidth) * 2 - 1, y = -(e.clientY / innerHeight) * 2 + 1;
        ray.setFromCamera({ x, y }, this.camera);
        if (ray.intersectObject(this.showcase, true).length) return true;
        // close enough: inside the mech's circle on screen (its pedestal is about 4.8 units wide)
        const c = this.showcase.position.clone().add(new V3(0, 1, 0));
        const mid = c.clone().project(this.camera), edge = c.clone().add(new V3(0, 4.2, 0)).project(this.camera);
        const px = (v) => [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
        const [mx, my] = px(mid), [, ey] = px(edge);
        const r = Math.max(60, Math.abs(my - ey) * 1.25);
        return Math.hypot(e.clientX - mx, (e.clientY - my) * 1.1) < r;
      };
      menu.addEventListener('click', (e) => { if (near(e)) { this.audio.ensure(); this.audio.click(1.3); this.openWorkshop(); } });
      menu.addEventListener('pointermove', (e) => { menu.style.cursor = e.pointerType === 'mouse' && near(e) ? 'pointer' : ''; });
    }

    menuCamera() {
      const t = this.time * 0.05;
      if (this.state === 'lobby' && this.net.room && this.net.room.auto && !this.showcase) this.buildShowcase(); // back from a match: the stage again
      // the lobby and the matchmaking screen share the stage: your mech, your party, the players joining
      if ((this.state === 'menu' || (this.state === 'lobby' && this.net.room && this.net.room.auto)) && this.showcase) {
        this.showcase.visible = true;
        this.showcase.rotation.y = this.time * 0.35;
        // while searching, your mech hops now and then (Fall Guys style waiting)
        const hop = this.state === 'lobby' ? Math.max(0, Math.sin(this.time * 2.2)) ** 6 * 1.6 : 0;
        if (this.showcaseBase === undefined || this.showcaseBaseSpot !== this.showcaseSpot) { this.showcaseBase = this.showcase.position.y; this.showcaseBaseSpot = this.showcaseSpot; }
        this.showcase.position.y = this.showcaseBase + hop;
        const c = this.showcase.position.clone().setY(this.showcaseBase);
        const a = 0.9;
        this.camera.position.set(c.x + Math.cos(a) * 9, c.y + 2.8, c.z + Math.sin(a) * 9);
        // the mech stands in the middle of the lobby, a bit low so the logo fits above it
        this.camera.lookAt(c.x, c.y + 1.6, c.z);
      } else {
        if (this.showcase) this.showcase.visible = false;
        this.camera.position.set(Math.cos(t) * 150, 60, Math.sin(t) * 150);
        this.camera.lookAt(0, 5, 0);
      }
      this.world.updateOcclusion(this.camera.position, null);
      this.sun.position.copy(this.world.sunDir).multiplyScalar(130);
      this.sun.target.position.set(0, 0, 0);
      this.scene.fog.color.copy(this.skyColor);
      this.scene.background.copy(this.skyColor);
      this.world.sky.visible = true;
      this.scene.fog.near = 140; this.scene.fog.far = this.world.fogFar || 430;
    }

    // ---------------- main loop ----------------
    // One scale for the whole UI: it fits the window on every device and grows on big screens.
    // Short screens (phones sideways) get the "compact" layout, which is made for ~440 px of height,
    // so its buttons come out bigger than shrinking the desktop layout would.
    fitUi() {
      const w = window.innerWidth, h = window.innerHeight;
      const compact = h < 560;
      const z = compact ? clamp(Math.min(w / 860, h / 440), 0.6, 1.3) : clamp(Math.min(w / 1180, h / 740), 0.62, 1.5);
      const root = document.documentElement;
      root.classList.toggle('compact', compact);
      root.style.setProperty('--z', z.toFixed(3));
      this.uiZoom = z; // the HUD is drawn at this scale: things placed on it use window pixels / z
      root.style.setProperty('--vw', (w / z).toFixed(1) + 'px'); // window size in scaled pixels
      root.style.setProperty('--vh', (h / z).toFixed(1) + 'px');
      root.style.setProperty('--quests', h / z < 700 ? 'none' : 'block');
    }
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.fitUi();
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.workshop.camera.aspect = w / h;
      this.workshop.camera.updateProjectionMatrix();
    }

    loop(now) {
      // one screen-refresh request at a time (the background timer also calls this while hidden)
      if (!this.rafQueued) { this.rafQueued = true; requestAnimationFrame((t) => { this.rafQueued = false; this.loop(t); }); }
      if (now - this.last < 4) return; // both clocks fired together
      let dt = Math.min(0.05, (now - this.last) / 1000);
      if (this.slowmo > 0) { this.slowmo -= dt; dt *= this.slowmo > 0.25 ? 0.3 : 1; }
      this.last = now;
      try {
        this.watchPerformance(dt);
        if (CW.rainbowMats.length) CW.tickFinishes(now / 1000); // the Rainbow Shift finish
        this.tick(dt);
      } catch (e) {
        this.crash(e);
      }
    }

    // while the window is hidden: 20 game steps a second from a worker (browsers slow down page timers
    // in hidden tabs, but not worker timers), so matches, bots and online play carry on
    backgroundTicks(on) {
      if (!on) { if (this.bgWorker) this.bgWorker.postMessage('stop'); return; }
      try {
        if (!this.bgWorker) {
          const src = 'let t=0;onmessage=(e)=>{clearInterval(t);if(e.data==="go")t=setInterval(()=>postMessage(0),50);};';
          this.bgWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          this.bgWorker.onmessage = () => { if (document.hidden) this.loop(performance.now()); };
        }
        this.bgWorker.postMessage('go');
      } catch (e) { /* no workers here: the game waits until it's visible again */ }
    }

    // A bug should never freeze the whole game: show a panel, let the player recover
    crash(e) {
      console.error(e);
      this.crashCount = (this.crashCount || 0) + 1;
      if (this.crashShown) return;
      this.crashShown = true;
      const report = `Cogwild ${CW.VERSION} | state=${this.state} mode=${this.modeId}/${this.formatId}\n${(e && e.stack) || e}`;
      $('crashText').textContent = report;
      $('crash').classList.remove('hidden');
      $('crashMenu').onclick = () => { $('crash').classList.add('hidden'); this.crashShown = false; try { this.showMenu(); } catch (err) { location.reload(); } };
      $('crashCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(report); this.toast('Error report copied'); };
    }

    tick(dt) {
      this.time += dt;
      this.gamepad.update(dt);
      this.touch.update();
      this.supers.update(dt);
      this.gadgets.update(dt);
      if (this.state !== this._musicState) { this._musicState = this.state; this.updateMusic(); }
      if (this.state === 'workshop') {
        this.workshop.update(dt);
        if (!this.headless) this.renderer.render(this.workshop.scene, this.workshop.camera);
        this.pressed = {};
        return;
      }
      this.world.update(dt, this.camera.position);
      const vt = this.state === 'match' && this.player ? (this.player.mech && this.player.mech.alive && this.player.mech.occupied ? this.player.mech.pos : this.player.pilot ? this.player.pilot.pos : null) : null;
      this.edgeInfo = this.world.updateBoundary(dt, vt);
      if (this.state === 'match') { // the game never pauses (the match menu only rests your controls)
        if (this.countdown > -1) this.countdown -= dt;
        if (this.countdown <= 0 && !this.ended) this.matchTime += dt;
        for (let i = this.respawns.length - 1; i >= 0; i--) {
          const r = this.respawns[i];
          r.t -= dt;
          if (r.t <= 0) { this.respawns.splice(i, 1); r.fn(); }
        }
        this.updatePlayer(dt);
        const pm = this.player && this.player.mech;
        if (pm && pm.alive && pm.occupied) this.audio.engine(Math.hypot(pm.vel.x, pm.vel.y, pm.vel.z), pm.input.throttle, pm.medium);
        else this.audio.engineOff();
        if (!this.isPractice() && pm && pm.alive && pm.occupied && this.countdown <= 0) {
          if (pm.medium === 'air') this.meta.track('air', dt);
          if (pm.medium === 'water') this.meta.track('water', dt);
        }
        for (const c of this.combatants) if (!c.isPlayer && !c.human && c.alive && this.net.owns(c)) this.updateBot(c, dt);
        for (const m of this.mechs) m.update(dt);
        this.collide();
        for (const p of this.pilots) p.update(dt, p.inp || { mx: 0, mz: 0 });
        this.fx.update(dt);
        this.pickups.update(dt);
        this.chests.update(dt);
        this.updateSurvival(dt);
        this.updateRespawns(dt);
        if (this.obj) this.obj.update(dt);
        this.tutorial.update();
        this.updateSuddenDeath(dt);
        this.checkEnd(dt);
        this.net.update(dt);
        this.updateCamera(dt);
        this.updateHud();
      } else if (this.state === 'results') {
        this.audio.engineOff();
        this.fx.update(dt);
        this.menuCamera();
      } else if (this.state !== 'match') {
        this.menuCamera();
        this.updateStage(dt);
      }
      this.pressed = {};
      this.world.updateSky(this.camera.position);
      if (!this.headless) this.renderer.render(this.scene, this.camera);
      this.afterRender && this.afterRender();
    }

    // Spiked mech `a` slams into `b`: damage b's parts nearest to a, knock it back
    ram(a, b, speed) {
      if (a.ramCd > 0 || !b.alive) return;
      a.ramCd = 0.6;
      const dmg = speed * 2.2 * Math.min(3, a.spikes) * a.dmgMult();
      const near = b.parts.filter((p) => p.alive).sort((p, q) => p.wp.distanceTo(a.pos) - q.wp.distanceTo(a.pos)).slice(0, 3);
      const contact = near[0] ? near[0].wp.clone() : b.pos.clone();
      for (const p of near) b.hit(p, dmg / near.length, a.combatant);
      const n = b.pos.clone().sub(a.pos).setY(0).normalize();
      b.vel.addScaledVector(n, speed * 0.8);
      b.vel.y += 4;
      this.fx.burst(contact, { n: 14, color: 'spark', speed: 12, life: 0.5, size: 0.25, grav: 15 });
      this.audio.ram();
      if (a.combatant.isPlayer) {
        this.announce('SPIKE RAM!', `${Math.round(dmg)} damage`);
        this.cam.shake = Math.min(1.5, this.cam.shake + 0.8);
        if (!this.isPractice()) this.meta.track('ram');
        if (this.settings.dmgNumbers) this.damageNumber(contact, dmg);
      }
      if (b.combatant.isPlayer) this.cam.shake = Math.min(1.5, this.cam.shake + 1);
    }

    collide() {
      const ms = this.mechs.filter((m) => m.alive);
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++) {
          const a = ms[i], b = ms[j];
          const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
          const d = Math.hypot(dx, dy, dz);
          const min = (a.radius + b.radius) * 0.7;
          if (d > 0.01 && d < min) {
            const push = (min - d) / 2;
            const nx = dx / d, nz = dz / d;
            // closing speed along the contact normal
            const closing = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
            if (closing > 5 && !CW.sameTeam(a.combatant, b.combatant)) {
              if (a.spikes > 0) this.ram(a, b, closing);
              if (b.spikes > 0) this.ram(b, a, closing);
            }
            a.pos.x -= nx * push; a.pos.z -= nz * push;
            b.pos.x += nx * push; b.pos.z += nz * push;
            a.vel.multiplyScalar(0.8); b.vel.multiplyScalar(0.8);
          }
        }
      for (const p of this.pilots) {
        if (!p.alive) continue;
        for (const m of ms) {
          if (p.onMech === m) continue; // standing on it, not inside it
          const dx = p.pos.x - m.pos.x, dz = p.pos.z - m.pos.z;
          const d = Math.hypot(dx, dz);
          const min = m.radius * 0.75;
          if (d < min && p.pos.y < m.pos.y + m.radius && p.pos.y > m.pos.y - m.baseOff - 1 && d > 0.01) {
            p.pos.x = m.pos.x + (dx / d) * min;
            p.pos.z = m.pos.z + (dz / d) * min;
          }
        }
      }
    }
  }

  window.addEventListener('load', () => {
    // let the loading screen paint before the (heavy) arena build
    setTimeout(async () => {
      try {
        await CW.Platform.init();
        new Game();
        CW.Platform.loadingDone();
        const ld = $('loading');
        ld.classList.add('done');
        setTimeout(() => ld.remove(), 600);
      } catch (e) {
        $('loadingText').innerHTML = 'Cogwild failed to start 😢<br><small>' + String((e && e.message) || e) + '</small><br><small>Try another browser (Chrome, Edge or Firefox) or update your graphics drivers.</small>';
        console.error(e);
      }
    }, 60);
  });
})();
