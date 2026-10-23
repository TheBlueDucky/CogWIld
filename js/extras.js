// Cogwild — power-ups, music, achievements, part unlocks, bot mech variety
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;

  // ======================= PART UNLOCKS =======================
  CW.PART_LEVEL = {}; // parts that unlock above level 1 (from js/economy.js)
  for (const [id, r] of Object.entries(CW.ECON.PARTS)) if (r[2] > 1) CW.PART_LEVEL[id] = r[2];
  CW.partLocked = (t, game) => (CW.PART_LEVEL[t] || 1) > game.level();
  CW.unlocksAt = (level) => Object.keys(CW.PART_LEVEL).filter((t) => CW.PART_LEVEL[t] === level).map((t) => CW.PARTS[t].name);

  // ======================= POWER-UPS =======================
  CW.POWERUPS = {
    repair: { name: 'Repair Kit', icon: '🔧', color: 0x52e05c, desc: 'Repairs your mech' },
    overcharge: { name: 'Overcharge', icon: '⚡', color: 0xffd23f, desc: '+50% damage for 10 s' },
    shield: { name: 'Shield Cell', icon: '🛡', color: 0x4cc9f0, desc: '+60 shield' },
    turbo: { name: 'Turbo', icon: '💨', color: 0xff8c42, desc: 'Faster + dash recharged for 8 s' },
    coins: { name: 'Coin Cache', icon: '🪙', color: 0xffc43d, desc: '+15 coins' },
  };

  class Pickups {
    constructor(game) {
      this.game = game;
      this.items = [];
      this.geo = new THREE.OctahedronGeometry(0.9, 0);
      this.ringGeo = new THREE.TorusGeometry(1.4, 0.08, 6, 24);
      this.mats = {};
      for (const [k, p] of Object.entries(CW.POWERUPS)) {
        this.mats[k] = new THREE.MeshBasicMaterial({ color: p.color });
      }
      this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    }

    clear() {
      for (const it of this.items) this.game.scene.remove(it.group);
      this.items = [];
    }

    // spread spawn spots over land, bridges and a few hilltops
    // online every game passes the host's seed, so the power-ups sit in the same spots for everyone
    spawnAll(seed) {
      this.clear();
      const world = this.game.world;
      const spots = [];
      for (const b of world.bridges) spots.push(b.mid.clone());
      seed = seed || 1 + Math.floor(Math.random() * 1000);
      const rnd = () => CW.hash(seed++, 31);
      for (let tries = 0; tries < 400 && spots.length < 14; tries++) {
        const x = (rnd() - 0.5) * 300, z = (rnd() - 0.5) * 300;
        const h = world.groundAt(x, z);
        if (h < 1.5 || h > 40) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 35)) continue;
        spots.push(new V3(x, 0, z));
      }
      const kinds = ['repair', 'repair', 'overcharge', 'shield', 'turbo', 'coins'];
      spots.forEach((s, i) => this.add(s, kinds[i % kinds.length]));
    }

    add(pos, kind) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(this.geo, this.mats[kind]);
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.rotation.x = Math.PI / 2;
      g.add(core, ring);
      const y = this.game.world.groundAt(pos.x, pos.z, 100) + 1.8;
      g.position.set(pos.x, y, pos.z);
      this.game.scene.add(g);
      this.items.push({ kind, group: g, core, ring, base: y, active: true, respawn: 0, pos: g.position });
    }

    nearest(pos, kinds, maxD) {
      let best = null, bd = maxD;
      for (const it of this.items) {
        if (!it.active || (kinds && !kinds.includes(it.kind))) continue;
        const d = it.pos.distanceTo(pos);
        if (d < bd) { bd = d; best = it; }
      }
      return best;
    }

    update(dt) {
      const t = this.game.time;
      for (const it of this.items) {
        if (!it.active) {
          it.respawn -= dt;
          if (it.respawn <= 0) { it.active = true; it.group.visible = true; this.game.fx.burst(it.pos, { n: 10, color: this.game.fx.colorKey(CW.POWERUPS[it.kind].color), speed: 4, life: 0.6, size: 0.3 }); }
          continue;
        }
        it.core.rotation.y += dt * 2;
        it.ring.rotation.z += dt;
        it.group.position.y = it.base + Math.sin(t * 2 + it.pos.x) * 0.35;
        // collect: any mech or pilot touching it (online: the host's game decides who got it)
        if (this.game.net.client) continue;
        for (const c of this.game.combatants) {
          if (!c.alive) continue;
          const ent = c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot && c.pilot.alive ? c.pilot : null;
          if (!ent) continue;
          const r = ent === c.mech ? c.mech.radius + 1.2 : 1.8;
          if (ent.pos.distanceTo(it.pos) < r) { this.collect(it, c, ent); break; }
        }
      }
    }

    collect(it, c, ent) {
      it.active = false;
      it.group.visible = false;
      it.respawn = 22;
      const P = CW.POWERUPS[it.kind];
      const game = this.game;
      if (game.net.owns(c)) this.apply(it.kind, c, ent);
      game.net.event({ k: 'pk', i: this.items.indexOf(it), c: c.netId });
      game.fx.burst(it.pos, { n: 18, color: game.fx.colorKey(P.color), speed: 8, life: 0.6, size: 0.35 });
      if (c.isPlayer) {
        game.announce(`${P.icon} ${P.name.toUpperCase()}`, P.desc);
        game.audio.pickup();
        if (!game.isPractice()) game.meta.track('pickup');
      }
    }

    // online: the host's game says someone grabbed power-up i
    netCollect(i, c) {
      const it = this.items[i];
      if (!it || !c) return;
      const ent = c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot && c.pilot.alive ? c.pilot : c.mech;
      if (ent) this.collect(it, c, ent);
    }

    // the effect of a power-up on whoever got it (also used by chests)
    apply(kind, c, ent) {
      const game = this.game;
      const m = ent === c.mech ? c.mech : null;
      switch (kind) {
        case 'repair':
          if (m) m.repair(140);
          else ent.hp = Math.min(ent.maxHp, ent.hp + 40);
          break;
        case 'overcharge': if (m) m.overcharge = 10; break;
        case 'shield': if (m) { m.shieldMax = Math.max(m.shieldMax, 60); m.shield = Math.min(m.shield + 60, 120); m.shieldFlash = 1; } break;
        case 'turbo': if (m) { m.turbo = 8; m.dashCd = 0; } break;
        case 'coins': if (c.isPlayer && !game.isPractice()) game.bonusCoins += 15; break;
      }
    }
  }

  // ======================= LOOT CHESTS =======================
  // Common (wood), Rare (steel), Epic (gold). Touch one with your mech or pilot to open it.
  CW.CHEST_TYPES = {
    common: { name: 'Common Chest', color: 0x9c6b3c, band: 0x6c757d, beam: 0xffffff, coins: 10, xp: 5, buffs: 1 },
    rare: { name: 'Rare Chest', color: 0x3a86ff, band: 0xdee2e6, beam: 0x4cc9f0, coins: 25, xp: 15, buffs: 2 },
    epic: { name: 'EPIC CHEST', color: 0xffc43d, band: 0x7209b7, beam: 0xffd23f, coins: 60, xp: 35, buffs: 3 },
  };

  class Chests {
    constructor(game) {
      this.game = game;
      this.items = [];
      this.timer = 0;
      this.dropTimer = 0;
    }

    clear() {
      for (const ch of this.items) this.game.scene.remove(ch.group);
      this.items = [];
    }

    start() {
      this.clear();
      this.timer = 0;
      this.nextId = 1;
      this.dropTimer = 50 + Math.random() * 20;
      if (!this.game.net.client) for (let i = 0; i < 6; i++) this.spawn(); // online: the host's chests arrive as messages
    }

    roll() { const r = Math.random(); return r < 0.1 ? 'epic' : r < 0.4 ? 'rare' : 'common'; }

    spot() {
      const world = this.game.world;
      for (let tries = 0; tries < 80; tries++) {
        const x = (Math.random() - 0.5) * 300, z = (Math.random() - 0.5) * 300;
        const h = world.groundAt(x, z);
        if (h < 1.5 || h > 30) continue;
        const slope = Math.abs(world.groundAt(x + 1.5, z) - h) + Math.abs(world.groundAt(x, z + 1.5) - h);
        if (slope > 1.2 || this.items.some((c) => c.pos.distanceTo(new V3(x, h, z)) < 30)) continue;
        return new V3(x, h, z);
      }
      return null;
    }

    model(rarity) {
      const T = CW.CHEST_TYPES[rarity];
      const g = new THREE.Group();
      const tex = rarity === 'common' ? 'wood' : 'panel';
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.2), CW.mat(T.color, { metalness: rarity === 'epic' ? 0.8 : 0.3, roughness: 0.4 }, tex));
      body.position.y = 0.5;
      body.castShadow = true;
      g.add(body);
      const lid = new THREE.Group();
      lid.position.set(0, 1, 0.6); // hinge at the back edge
      const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 14, 1, false, 0, Math.PI), CW.mat(T.color, { metalness: rarity === 'epic' ? 0.8 : 0.3, roughness: 0.4 }, tex));
      lidMesh.rotation.z = Math.PI / 2;
      lidMesh.position.z = -0.6;
      lidMesh.castShadow = true;
      lid.add(lidMesh);
      g.add(lid);
      for (const x of [-0.6, 0.6]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 1.25), CW.mat(T.band, { metalness: 0.7, roughness: 0.3 }));
        band.position.set(x, 0.5, 0);
        g.add(band);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.1), CW.mat(0xffd23f, { metalness: 0.9, roughness: 0.2 }));
      lock.position.set(0, 0.85, -0.63);
      g.add(lock);
      // glowing beam so chests can be spotted from far away
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: T.beam, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 20;
      g.add(beam);
      return { g, lid, beam };
    }

    spawn(pos, rarity, fromSky, id, drop) {
      pos = pos || this.spot();
      if (!pos) return null;
      rarity = rarity || this.roll();
      id = id || this.nextId++;
      this.game.net.event({ k: 'chest', id, x: Math.round(pos.x * 10) / 10, z: Math.round(pos.z * 10) / 10, r: rarity, sky: fromSky ? 1 : 0, drop: drop ? 1 : 0 });
      const { g, lid, beam } = this.model(rarity);
      const ground = this.game.world.groundAt(pos.x, pos.z, 100);
      g.position.set(pos.x, fromSky ? ground + 90 : ground, pos.z);
      g.rotation.y = Math.random() * Math.PI * 2;
      let chute = null;
      if (fromSky) {
        chute = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), CW.mat(0xff006e, { side: THREE.DoubleSide }));
        chute.position.y = 6;
        g.add(chute);
      }
      this.game.scene.add(g);
      const ch = { id, group: g, lid, beam, chute, rarity, pos: g.position, ground, opened: false, openT: 0, falling: !!fromSky };
      this.items.push(ch);
      return ch;
    }

    // online: chests from the host's game
    netSpawn(e) {
      this.spawn(new V3(e.x, 0, e.z), e.r, !!e.sky, e.id);
      if (e.drop) this.dropNews();
    }
    netOpen(id, c, kinds) {
      const ch = this.items.find((x) => x.id === id && !x.opened);
      if (!ch || !c) return;
      const ent = c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot && c.pilot.alive ? c.pilot : c.mech;
      if (ent) this.open(ch, c, ent, kinds.filter((k) => CW.POWERUPS[k]));
    }

    // a supply drop: an epic chest parachutes in somewhere in the arena
    airdrop() {
      const p = this.spot();
      if (!p) return;
      this.spawn(p, 'epic', true, 0, true);
      this.dropNews();
    }
    dropNews() {
      const g = this.game;
      g.feed('📦 Supply drop incoming! (gold beam on the map)', 'good');
      if (g.state === 'match') g.announce('📦 SUPPLY DROP', 'An epic chest is falling. Grab it first!');
    }

    update(dt) {
      const game = this.game;
      this.timer += dt;
      const host = !game.net.client; // online, only the host's game stocks and opens chests
      // keep the map stocked
      if (host && !game.isPractice() && this.timer > 40) {
        this.timer = 0;
        if (this.items.filter((c) => !c.opened).length < 6) this.spawn();
      }
      if (host && !game.isPractice() && game.countdown <= 0) {
        this.dropTimer -= dt;
        if (this.dropTimer <= 0) { this.dropTimer = 60 + Math.random() * 25; this.airdrop(); }
      }
      for (let i = this.items.length - 1; i >= 0; i--) {
        const ch = this.items[i];
        if (ch.falling) {
          ch.pos.y -= dt * 9;
          ch.group.rotation.y += dt * 0.4;
          if (ch.pos.y <= ch.ground) { ch.pos.y = ch.ground; ch.falling = false; if (ch.chute) { ch.group.remove(ch.chute); ch.chute = null; } game.fx.burst(ch.pos, { n: 14, color: 'smoke', speed: 5, life: 0.8, size: 0.5 }); }
          continue;
        }
        if (ch.opened) {
          ch.openT += dt;
          ch.lid.rotation.x = Math.min(1.9, ch.openT * 6);
          ch.beam.material.opacity = Math.max(0, 0.5 - ch.openT * 0.2);
          if (ch.openT > 6) { game.scene.remove(ch.group); this.items.splice(i, 1); }
          continue;
        }
        ch.beam.material.opacity = 0.14 + Math.sin(game.time * 3 + i) * 0.06;
        if (!host) continue;
        for (const c of game.combatants) {
          if (!c.alive) continue;
          const ent = c.mech && c.mech.alive && c.mech.occupied ? c.mech : c.pilot && c.pilot.alive ? c.pilot : null;
          if (!ent) continue;
          const r = ent === c.mech ? c.mech.radius + 1.4 : 2;
          if (ent.pos.distanceTo(new V3(ch.pos.x, ch.pos.y + 0.5, ch.pos.z)) < r) { this.open(ch, c, ent); break; }
        }
      }
    }

    open(ch, c, ent, kinds) {
      const game = this.game;
      const T = CW.CHEST_TYPES[ch.rarity];
      ch.opened = true;
      ch.beam.material.color.setHex(T.beam);
      kinds = kinds || ['repair', 'overcharge', 'shield', 'turbo'].sort(() => Math.random() - 0.5).slice(0, T.buffs);
      if (game.net.owns(c)) for (const k of kinds) game.pickups.apply(k, c, ent);
      game.net.event({ k: 'open', id: ch.id, c: c.netId, kinds });
      const top = ch.pos.clone().add(new V3(0, 1.2, 0));
      game.fx.burst(top, { n: 30, color: game.fx.colorKey(T.beam), speed: 10, up: 6, life: 0.9, size: 0.3, grav: 12 });
      game.fx.burst(top, { n: 12, color: game.fx.colorKey(0xffd23f), speed: 6, up: 8, life: 1.2, size: 0.2, grav: 18 });
      if (c.isPlayer) {
        const practice = game.isPractice();
        if (!practice) { game.bonusCoins += T.coins; game.bonusXp = (game.bonusXp || 0) + T.xp; game.meta.track('chest'); }
        const icons = kinds.map((k) => CW.POWERUPS[k].icon).join(' ');
        game.announce(`🧰 ${T.name}`, `${practice ? '' : `+${T.coins} 🪙 · +${T.xp} XP · `}${icons}`);
        game.audio.fanfare();
        game.cam.shake = Math.min(1, game.cam.shake + 0.3);
      }
    }
  }

  // ======================= MUSIC =======================
  // A tiny procedural chiptune: bass + arpeggio + drums, scheduled ahead with WebAudio
  class Music {
    constructor(audio) {
      this.audio = audio;
      this.theme = null;
      this.step = 0;
      this.timer = null;
    }
    play(theme) {
      if (this.theme === theme) return;
      this.stop();
      this.theme = theme;
      if (!theme) return;
      this.audio.ensure();
      const ctx = this.audio.ctx;
      if (!ctx) return;
      this.next = ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = setInterval(() => this.schedule(), 50);
    }
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.theme = null;
    }
    note(freq, t, dur, type, vol) {
      const ctx = this.audio.ctx;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master());
      o.start(t); o.stop(t + dur + 0.02);
    }
    master() {
      const ctx = this.audio.ctx;
      if (!this.gain) { this.gain = ctx.createGain(); this.gain.connect(ctx.destination); }
      this.gain.gain.value = this.volume === undefined ? 0.25 : this.volume;
      return this.gain;
    }
    drum(t, kind) {
      const ctx = this.audio.ctx;
      if (kind === 'kick') {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g).connect(this.master());
        o.start(t); o.stop(t + 0.22);
      } else {
        const len = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 5000;
        s.buffer = buf; g.gain.value = 0.12;
        s.connect(f).connect(g).connect(this.master());
        s.start(t);
      }
    }
    schedule() {
      const ctx = this.audio.ctx;
      if (!ctx) return;
      const battle = this.theme === 'battle';
      const bpm = battle ? 138 : 96;
      const s16 = 60 / bpm / 4;
      // chord roots (semitones from A2) — battle in A minor, menu in C major feel
      const prog = battle ? [0, 0, -4, -2] : [3, -2, 0, -4];
      const arp = battle ? [0, 7, 12, 15, 12, 7, 3, 7] : [0, 4, 7, 12, 7, 4, 0, 7];
      // after the tab was in the background, skip the missed notes instead of playing them all at once
      if (this.next < ctx.currentTime - 0.1) this.next = ctx.currentTime + 0.05;
      while (this.next < ctx.currentTime + 0.25) {
        const s = this.step;
        const bar = Math.floor(s / 16) % 4;
        const root = 110 * Math.pow(2, prog[bar] / 12);
        if (s % 4 === 0 || (battle && s % 4 === 3 && s % 8 === 7)) this.note(root / 2, this.next, s16 * 3, 'triangle', 0.35);
        if (s % 2 === 0) this.note(root * 2 * Math.pow(2, arp[(s / 2) % 8] / 12), this.next, s16 * 1.6, battle ? 'square' : 'triangle', battle ? 0.05 : 0.07);
        if (battle) {
          if (s % 8 === 0 || s % 8 === 3) this.drum(this.next, 'kick');
          if (s % 2 === 1) this.drum(this.next, 'hat');
        } else if (s % 8 === 4) this.drum(this.next, 'hat');
        this.next += s16;
        this.step++;
      }
    }
  }

  // ======================= ACHIEVEMENTS =======================
  // val: how far you are (shown as "9 / 10" until it's unlocked); goal: what unlocks it
  CW.ACHIEVEMENTS = [
    { id: 'first', name: 'First Steps', desc: 'Play your first match', reward: 50, goal: 1, val: (s) => s.matches },
    { id: 'win1', name: 'Winner!', desc: 'Win a match', reward: 100, goal: 1, val: (s) => s.wins },
    { id: 'win10', name: 'Champion', desc: 'Win 10 matches', reward: 300, goal: 10, val: (s) => s.wins },
    { id: 'wreck10', name: 'Scrapper', desc: 'Wreck 10 mechs', reward: 100, goal: 10, val: (s) => s.wrecks },
    { id: 'wreck50', name: 'Demolisher', desc: 'Wreck 50 mechs', reward: 250, goal: 50, val: (s) => s.wrecks },
    { id: 'wreck200', name: 'Scrap Lord', desc: 'Wreck 200 mechs', reward: 600, goal: 200, val: (s) => s.wrecks },
    { id: 'elim25', name: 'Pilot Hunter', desc: 'Eliminate 25 pilots', reward: 200, goal: 25, val: (s) => s.elims },
    { id: 'ram10', name: 'Battering Ram', desc: 'Land 10 spike rams', reward: 150, goal: 10, val: (s) => s.rams },
    { id: 'dash100', name: 'Zoomies', desc: 'Dash 100 times', reward: 100, goal: 100, val: (s) => s.dashes },
    { id: 'fly300', name: 'Sky Captain', desc: 'Fly for 5 minutes total', reward: 150, goal: 300, unit: 's', val: (s) => s.airTime },
    { id: 'swim300', name: 'Deep Diver', desc: 'Spend 5 minutes in water', reward: 150, goal: 300, unit: 's', val: (s) => s.waterTime },
    { id: 'streak3', name: 'Hat Trick', desc: 'Get a 3-wreck streak', reward: 150, goal: 3, val: (s) => s.bestStreak },
    { id: 'pickup20', name: 'Collector', desc: 'Grab 20 power-ups', reward: 120, goal: 20, val: (s) => s.pickups },
    { id: 'chest25', name: 'Treasure Hunter', desc: 'Open 25 loot chests', reward: 200, goal: 25, val: (s) => s.chests },
    { id: 'survive10', name: 'Last Stand', desc: 'Reach wave 10 in Survival', reward: 300, goal: 10, val: (s) => s.bestWave },
    { id: 'hillking', name: 'Hill King', desc: 'Win a King of the Hill match', reward: 150, goal: 1, val: (s) => s.kothWins },
    { id: 'golddigger', name: 'Gold Digger', desc: 'End a Gold Rush carrying 25+ gold', reward: 200, goal: 25, val: (s) => s.maxGold },
    { id: 'speeddemon', name: 'Speed Demon', desc: 'Win a Combat Race', reward: 200, goal: 1, val: (s) => s.raceWins },
    { id: 'titanslayer', name: 'Titan Slayer', desc: 'Defeat the Titan', reward: 400, goal: 1, val: (s) => s.bossKills },
    { id: 'worldtour', name: 'World Tour', desc: 'Play a match on every map', reward: 300, goal: () => Object.keys(CW.ARENAS).length, val: (s) => Object.keys(s.maps || {}).length },
    { id: 'modemaster', name: 'Mode Master', desc: 'Play every game mode', reward: 300, goal: () => Object.keys(CW.MM_FORMAT).length, val: (s) => Object.keys(s.modes || {}).length },
    { id: 'bothModes', name: 'All-Rounder', desc: 'Play both Rush Build and Workshop Clash', reward: 100, goal: 2, val: (s) => (s.rush >= 1 ? 1 : 0) + (s.clash >= 1 ? 1 : 0) },
    { id: 'hybrid', name: 'Hybrid', desc: 'Reach the Hybrid rank', reward: 200, goal: 3, unit: 'lv', val: (s, g) => g.level() },
    { id: 'omni', name: 'Omni', desc: 'Reach the Omni rank', reward: 400, goal: 6, unit: 'lv', val: (s, g) => g.level() },
    { id: 'big', name: 'Mega Build', desc: 'Win with a mech of 30+ parts', reward: 200, goal: 1, val: (s) => s.bigWin },
    { id: 'flawless', name: 'Untouchable', desc: 'Win without losing a single part', reward: 300, goal: 1, val: (s) => s.flawless },
  ];
  // how far you are with an achievement: { cur, goal } (cur never above goal)
  CW.achProgress = (a, game) => {
    const goal = typeof a.goal === 'function' ? a.goal() : a.goal;
    const cur = Math.max(0, Math.min(goal, Math.floor(+a.val(game.profile.stats || {}, game) || 0)));
    return { cur, goal };
  };
  for (const a of CW.ACHIEVEMENTS) a.test = (s, g) => CW.achProgress(a, g).cur >= CW.achProgress(a, g).goal;

  CW.checkAchievements = function (game) {
    const p = game.profile;
    p.achievements = p.achievements || {};
    const got = [];
    for (const a of CW.ACHIEVEMENTS) {
      if (p.achievements[a.id]) continue;
      if (a.test(p.stats, game)) {
        p.achievements[a.id] = Date.now();
        game.meta.addCoins(a.reward, 'ach', a.id);
        got.push(a);
      }
    }
    return got;
  };

  // ======================= BOT VARIETY =======================
  // Random tweaks to a preset so bots don't all look and fight the same
  CW.mutateBp = function (preset, budget, allowedDomains) {
    const bp = CW.cloneBp(preset);
    const rnd = Math.random;
    const weapons = ['cannon', 'rocket', 'laser', 'railgun', 'flamer'];
    for (const p of bp.parts) if (CW.PARTS[p.t].weapon && rnd() < 0.35) p.t = weapons[Math.floor(rnd() * weapons.length)];
    const occupied = (x, y, z) => bp.parts.some((p) => p.x === x && p.y === y && p.z === z);
    const cam = bp.parts.find((p) => p.t === 'camera');
    const freeSpot = () => {
      const base = bp.parts[Math.floor(rnd() * bp.parts.length)];
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
      const d = dirs[Math.floor(rnd() * dirs.length)];
      const s = { x: base.x + d[0], y: base.y + d[1], z: base.z + d[2] };
      if (occupied(s.x, s.y, s.z) || Math.abs(s.x) > 4 || s.y > 4 || Math.abs(s.z) > 4) return null;
      if (cam && s.x === cam.x && s.y === cam.y && s.z < cam.z) return null;
      return s;
    };
    const extras = ['armor', 'armor', 'flag', 'horn', 'spikes', 'booster', 'lamp'];
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = freeSpot();
      if (s) bp.parts.push({ t: extras[Math.floor(rnd() * extras.length)], ...s });
    }
    const v = CW.validate(bp.parts, allowedDomains, budget);
    if (!v.ok) return CW.cloneBp(preset);
    bp.name = preset.name + (n || bp.parts.some((p, i) => p.t !== preset.parts[i]?.t) ? ' Mk' + (2 + Math.floor(rnd() * 4)) : '');
    return bp;
  };

  CW.Pickups = Pickups;
  CW.Chests = Chests;
  CW.Music = Music;
})();
