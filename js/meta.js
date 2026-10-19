// Cogwild — progression & menus: coins, daily reward, challenges, shop, stats, settings, how-to
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');

  CW.SHOP = {
    paints: [
      { id: 'gold', name: 'Gold Rush', color: 0xffd23f, price: 300 },
      { id: 'neon', name: 'Neon Pink', color: 0xff4fd8, price: 200 },
      { id: 'lime', name: 'Toxic Lime', color: 0xa7ff3c, price: 200 },
      { id: 'night', name: 'Midnight', color: 0x2b2f5c, price: 250 },
      { id: 'lava', name: 'Lava', color: 0xff4500, price: 250 },
      { id: 'ice', name: 'Ice', color: 0x9be7ff, price: 200 },
      { id: 'mint', name: 'Mint', color: 0x7dffc4, price: 150 },
      { id: 'coal', name: 'Coal', color: 0x222222, price: 150 },
      { id: 'chrome', name: 'Chrome', color: 0xc0c6cc, price: 350 },
      { id: 'royal', name: 'Royal Purple', color: 0x5a189a, price: 250 },
      { id: 'camo', name: 'Camo Green', color: 0x556b2f, price: 200 },
      { id: 'sakura', name: 'Sakura', color: 0xffb7c5, price: 250 },
    ],
    trails: [
      { id: 'spark', name: 'Sparks', colors: [0xffe066], price: 0 },
      { id: 'fire', name: 'Fire', colors: [0xff6b1a, 0xffb700, 0xff3d00], price: 250 },
      { id: 'ice', name: 'Frost', colors: [0x9be7ff, 0xffffff, 0x5cc8ff], price: 250 },
      { id: 'toxic', name: 'Toxic', colors: [0x7cff4f, 0xb6ff00, 0x2ee86a], price: 250 },
      { id: 'void', name: 'Void', colors: [0x7b2cff, 0x2b0a5c, 0xc77dff], price: 350 },
      { id: 'rainbow', name: 'Rainbow', colors: [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93], price: 500 },
      { id: 'gold', name: 'Gold Dust', colors: [0xffd23f, 0xfff3b0, 0xc9a227], price: 400 },
      { id: 'neon', name: 'Neon', colors: [0xff4fd8, 0x4cc9f0], price: 350 },
    ],
  };

  const CHALLENGES = [
    { type: 'wreck', text: (n) => `Wreck ${n} mechs`, n: [3, 5, 8], reward: 60 },
    { type: 'win', text: (n) => `Win ${n} match${n > 1 ? 'es' : ''}`, n: [1, 2], reward: 90 },
    { type: 'rush', text: (n) => `Play ${n} Rush Build matches`, n: [2, 3], reward: 60 },
    { type: 'clash', text: (n) => `Play ${n} Workshop Clash matches`, n: [2, 3], reward: 60 },
    { type: 'dash', text: (n) => `Dash ${n} times`, n: [15, 30], reward: 40 },
    { type: 'air', text: (n) => `Fly for ${n} seconds`, n: [30, 60], reward: 60 },
    { type: 'water', text: (n) => `Spend ${n} seconds in water`, n: [30, 60], reward: 50 },
    { type: 'elim', text: (n) => `Eliminate ${n} pilots`, n: [2, 4], reward: 70 },
    { type: 'parts', text: (n) => `Blow off ${n} enemy parts`, n: [25, 50], reward: 50 },
    { type: 'ram', text: (n) => `Land ${n} spike rams`, n: [3, 6], reward: 70 },
    { type: 'team', text: () => 'Win a team match (3v3 or 2v2v2v2)', n: [1], reward: 100 },
    { type: 'chest', text: (n) => `Open ${n} loot chests`, n: [3, 6], reward: 60 },
    { type: 'kothwin', text: () => 'Win a King of the Hill match', n: [1], reward: 90 },
    { type: 'podium', text: () => 'Finish a Combat Race in the top 3', n: [1], reward: 80 },
    { type: 'goldcollect', text: (n) => `Collect ${n} gold in Gold Rush`, n: [10, 20], reward: 70 },
    { type: 'bosswin', text: () => 'Defeat the Titan in Boss Battle', n: [1], reward: 150 },
    { type: 'maps', text: (n) => `Play on ${n} different maps`, n: [3, 4], reward: 70 },
    { type: 'wave', text: (n) => `Reach wave ${n} in Survival`, n: [4, 6], reward: 80 },
  ];

  const TIPS = [
    'Hold Shift + A/D with Legs to sidestep-dash out of rocket fire.',
    'Spikes + Boosters = a ram that rips parts off. Dash into enemies!',
    'Shells slow down underwater: submarines are hard to hit.',
    'Too little power slows EVERYTHING. Add an Engine when ⚡ drops below 100%.',
    'Canyon ramps let wheeled mechs drive in and out of the river.',
    'On foot? Hold R next to your mech to repair it.',
    'Lasers hit instantly but only reach 75 m.',
    'Wings + a Jet + wheels = a plane that takes off from the ground.',
    'Put your Camera high up: you see more and it is harder to hit.',
    'Press V to switch between first-person and chase camera.',
  ];

  const DEFAULT_SETTINGS = { graphics: 'auto', showFps: false, tutorialDone: false, clips: true, arena: 'random', timeOfDay: 'random', difficulty: 'normal', music: true, sens: 1, fov: 80, invertY: false, camMode: 'first', autoSteer: true, shake: true, dmgNumbers: true, volume: 0.6 };

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function seeded(seedStr) {
    let h = 2166136261;
    for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }

  class Meta {
    constructor(game) {
      this.game = game;
      const p = game.profile;
      p.coins = p.coins || 0;
      p.owned = Object.assign({ paints: [], trails: ['spark'] }, p.owned || {});
      p.trail = p.trail || 'spark';
      p.stats = Object.assign({ matches: 0, wins: 0, wrecks: 0, elims: 0, deaths: 0, dashes: 0, parts: 0, rams: 0, airTime: 0, waterTime: 0, bestStreak: 0, coinsEarned: 0, rush: 0, clash: 0 }, p.stats || {});
      p.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
      this.rollChallenges();
      this.bind();
    }

    get settings() { return this.game.profile.settings; }
    save() { this.game.saveProfile(); }

    // ---------------- challenges ----------------
    rollChallenges() {
      const p = this.game.profile;
      const d = today();
      if (p.challenges && p.challenges.date === d) return;
      const rnd = seeded('cw' + d);
      const pool = CHALLENGES.slice();
      const list = [];
      while (list.length < 3) {
        const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        const n = c.n[Math.floor(rnd() * c.n.length)];
        list.push({ type: c.type, text: c.text(n), target: n, progress: 0, reward: c.reward + (n > c.n[0] ? 30 : 0), claimed: false });
      }
      p.challenges = { date: d, list };
      this.save();
    }

    track(type, amount) {
      const p = this.game.profile;
      amount = amount === undefined ? 1 : amount;
      if (type === 'pickup') p.stats.pickups = (p.stats.pickups || 0) + amount;
      if (type === 'chest') p.stats.chests = (p.stats.chests || 0) + amount;
      const statKey = { wreck: 'wrecks', elim: 'elims', dash: 'dashes', parts: 'parts', ram: 'rams', air: 'airTime', water: 'waterTime', rush: 'rush', clash: 'clash' }[type];
      if (statKey) p.stats[statKey] += amount;
      for (const c of p.challenges.list) {
        if (c.type !== type || c.progress >= c.target) continue;
        // "reach wave N" is a best-of, everything else adds up
        c.progress = type === 'wave' || type === 'maps' ? Math.min(c.target, Math.max(c.progress, amount)) : Math.min(c.target, c.progress + amount);
        if (c.progress >= c.target && this.game.state === 'match') this.game.feed(`✅ Challenge done: ${c.text} (claim in menu)`, 'good');
      }
    }

    claimable() { return this.game.profile.challenges.list.filter((c) => c.progress >= c.target && !c.claimed).length; }

    addCoins(n) {
      const p = this.game.profile;
      p.coins += n;
      p.stats.coinsEarned += n;
    }

    // ---------------- menu ----------------
    renderMenu() {
      const p = this.game.profile;
      this.rollChallenges();
      $('pCoins').textContent = p.coins;
      if (document.activeElement !== $('pName')) $('pName').value = p.name || '';
      const claim = this.claimable();
      $('badgeChallenges').textContent = claim;
      $('badgeChallenges').classList.toggle('hidden', claim === 0);
      const daily = p.dailyClaimed !== today();
      $('btnDaily').classList.toggle('ready', daily);
      $('btnDaily').innerHTML = daily ? '🎁 Claim daily reward' : '✔ Daily reward claimed';
      $('menuChallenges').innerHTML = p.challenges.list.map((c) => this.challengeRow(c, true)).join('');
      $('menuTip').textContent = '💡 ' + TIPS[Math.floor((Date.now() / 86400000) % TIPS.length)];
      const s = p.stats;
      $('menuStats').innerHTML = `<span>🏆 ${s.wins} wins</span><span>💥 ${s.wrecks} wrecks</span><span>🔥 Best streak ${s.bestStreak}</span>`;
    }

    challengeRow(c, compact) {
      const pct = Math.round((c.progress / c.target) * 100);
      const done = c.progress >= c.target;
      const btn = compact ? '' : c.claimed ? '<span class="claimed">✔ Claimed</span>' : done ? `<button class="ws-btn on claim" data-ch="${c.text}">Claim +${c.reward}🪙</button>` : `<span class="small">+${c.reward}🪙</span>`;
      return `<div class="ch-row ${done ? 'done' : ''} ${c.claimed ? 'claimed-row' : ''}"><div class="ch-text">${done ? '✅' : '🎯'} ${c.text}</div><div class="ch-bar"><i style="width:${pct}%"></i></div><div class="ch-meta">${c.progress} / ${c.target} ${btn}</div></div>`;
    }

    claimDaily() {
      const p = this.game.profile;
      if (p.dailyClaimed === today()) return;
      const yesterday = new Date(Date.now() - 86400000);
      const yd = `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;
      p.dailyStreak = p.dailyClaimed === yd ? (p.dailyStreak || 0) + 1 : 1;
      p.dailyClaimed = today();
      const amount = 50 + Math.min(6, p.dailyStreak - 1) * 25;
      this.addCoins(amount);
      this.save();
      this.game.toast(`🎁 +${amount} coins! Daily streak: ${p.dailyStreak} day${p.dailyStreak > 1 ? 's' : ''}`);
      this.game.audio.click(1.5);
      this.renderMenu();
    }

    // ---------------- panels ----------------
    openPanel(kind) {
      this.panel = kind;
      $('panel').classList.remove('hidden');
      const titles = { challenges: '🎯 Daily Challenges', shop: '🛒 Shop', stats: '📊 Stats', settings: '⚙ Settings', howto: '❓ How to Play', ach: '🏆 Achievements', news: '📰 What\'s new' };
      $('panelTitle').textContent = titles[kind];
      this.renderPanel();
    }
    closePanel() {
      $('panel').classList.add('hidden');
      this.renderMenu();
    }

    renderPanel() {
      const p = this.game.profile;
      const body = $('panelBody');
      const k = this.panel;
      if (k === 'challenges') {
        body.innerHTML = `<div class="small">New challenges every day. Complete them in any mode.</div>` + p.challenges.list.map((c) => this.challengeRow(c, false)).join('');
        body.querySelectorAll('.claim').forEach((b) => {
          b.onclick = () => {
            const c = p.challenges.list.find((x) => x.text === b.dataset.ch);
            if (!c || c.claimed) return;
            c.claimed = true;
            this.addCoins(c.reward);
            this.save();
            this.game.toast(`+${c.reward} coins!`);
            this.game.audio.click(1.5);
            this.renderPanel();
          };
        });
      } else if (k === 'shop') {
        const paints = CW.SHOP.paints.map((it) => {
          const own = p.owned.paints.includes(it.id);
          return `<div class="shop-item"><div class="swatch" style="background:${hex(it.color)}"></div><b>${it.name}</b><span class="small">Paint</span>${own ? '<span class="owned">✔ Owned</span>' : `<button class="ws-btn buy" data-kind="paints" data-id="${it.id}">${it.price} 🪙</button>`}</div>`;
        }).join('');
        const trails = CW.SHOP.trails.map((it) => {
          const own = p.owned.trails.includes(it.id);
          const eq = p.trail === it.id;
          const grad = it.colors.length > 1 ? `linear-gradient(90deg,${it.colors.map(hex).join(',')})` : hex(it.colors[0]);
          return `<div class="shop-item"><div class="swatch" style="background:${grad}"></div><b>${it.name}</b><span class="small">Dash trail</span>${eq ? '<span class="owned">★ Equipped</span>' : own ? `<button class="ws-btn equip" data-id="${it.id}">Equip</button>` : `<button class="ws-btn buy" data-kind="trails" data-id="${it.id}">${it.price} 🪙</button>`}</div>`;
        }).join('');
        body.innerHTML = `<div class="small">You have <b>${p.coins} 🪙</b>. Earn coins from matches, challenges and the daily reward. Bought paints appear in the Workshop's Paint section.</div>
          <h3>Paints</h3><div class="shop-grid">${paints}</div><h3>Dash trails</h3><div class="shop-grid">${trails}</div>`;
        body.querySelectorAll('.buy').forEach((b) => {
          b.onclick = () => {
            const it = CW.SHOP[b.dataset.kind].find((x) => x.id === b.dataset.id);
            if (p.coins < it.price) return this.game.toast(`Need ${it.price - p.coins} more coins`);
            p.coins -= it.price;
            p.owned[b.dataset.kind].push(it.id);
            if (b.dataset.kind === 'trails') p.trail = it.id;
            this.save();
            this.game.toast(`Unlocked ${it.name}!`);
            this.game.audio.click(1.5);
            this.game.workshop.buildPaint();
            this.renderPanel();
          };
        });
        body.querySelectorAll('.equip').forEach((b) => {
          b.onclick = () => { p.trail = b.dataset.id; this.save(); this.renderPanel(); };
        });
      } else if (k === 'stats') {
        const s = p.stats;
        const rows = [
          ['Matches played', s.matches], ['Wins', s.wins], ['Win rate', s.matches ? Math.round((s.wins / s.matches) * 100) + '%' : '—'],
          ['Mechs wrecked', s.wrecks], ['Pilots eliminated', s.elims], ['Times eliminated', s.deaths], ['Best wreck streak', s.bestStreak],
          ['Enemy parts blown off', s.parts], ['Spike rams', s.rams], ['Dashes', s.dashes],
          ['Time flying', Math.round(s.airTime) + ' s'], ['Time in water', Math.round(s.waterTime) + ' s'],
          ['Rush Build matches', s.rush], ['Workshop Clash matches', s.clash], ['Coins earned', s.coinsEarned], ['Level', this.game.level()],
        ];
        body.innerHTML = `<div class="stat-grid">${rows.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('')}</div>`;
      } else if (k === 'settings') {
        const s = this.settings;
        body.innerHTML = `
          <label class="set-row"><span>Graphics quality</span><select id="setGfx"><option value="auto">Auto (recommended)</option><option value="low">Low (fast, for older laptops)</option><option value="medium">Medium</option><option value="high">High (shadows + max detail)</option></select></label>
          <label class="set-row chk"><input type="checkbox" id="setFps"><span>Show FPS counter</span></label>
          <label class="set-row chk"><input type="checkbox" id="setClips"><span>Clip recorder: press <b>F8</b> in a match to save the last 10–20 seconds as a video (uses a little extra CPU)</span></label>
          <label class="set-row"><span>Camera</span><select id="setCam"><option value="first">First person (from your Camera part)</option><option value="third">Chase (behind the mech)</option></select></label>
          <label class="set-row"><span>Mouse sensitivity <b id="setSensV"></b></span><input type="range" id="setSens" min="0.3" max="2.5" step="0.05"></label>
          <label class="set-row"><span>Field of view <b id="setFovV"></b></span><input type="range" id="setFov" min="60" max="105" step="1"></label>
          <label class="set-row"><span>Volume <b id="setVolV"></b></span><input type="range" id="setVol" min="0" max="1" step="0.05"></label>
          <label class="set-row"><span>Bot difficulty</span><select id="setDiff"><option value="easy">🙂 Easy</option><option value="normal">😐 Normal</option><option value="hard">😈 Hard</option></select></label>
          <label class="set-row chk"><input type="checkbox" id="setMusic"><span>Music</span></label>
          <label class="set-row chk"><input type="checkbox" id="setSteer"><span>Auto-steer: your mech turns toward where you look while driving</span></label>
          <label class="set-row chk"><input type="checkbox" id="setInvert"><span>Invert mouse Y</span></label>
          <label class="set-row chk"><input type="checkbox" id="setShake"><span>Screen shake</span></label>
          <label class="set-row chk"><input type="checkbox" id="setDmg"><span>Floating damage numbers</span></label>
          <div class="menu-btns" style="justify-content:flex-start;margin-top:12px">
            <button class="ws-btn" id="setExport">💾 Back up save</button>
            <button class="ws-btn" id="setImport">📥 Restore save</button>
            <button class="ws-btn" id="setReset">Reset all progress…</button>
          </div>`;
        $('setGfx').value = s.graphics;
        $('setGfx').onchange = (e) => { s.graphics = e.target.value; this.apply(); };
        $('setExport').onclick = () => {
          const g = this.game;
          const data = { v: CW.SAVE_VERSION, profile: g.profile, blueprints: g.blueprints, current: g.currentBp };
          const code = 'CWSAVE1:' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
          g.openModal('Back up your save', 'Copy this code somewhere safe. Paste it into "Restore save" to get your progress back (or move it to another browser).', code, null);
        };
        $('setImport').onclick = () => {
          const g = this.game;
          g.openModal('Restore a save', 'Paste a save code (starts with CWSAVE1:). This replaces your current progress.', '', (txt) => {
            try {
              txt = txt.trim();
              if (!txt.startsWith('CWSAVE1:')) throw new Error('not a Cogwild save code');
              const d = JSON.parse(decodeURIComponent(escape(atob(txt.slice(8)))));
              if (!d.profile || typeof d.profile.xp !== 'number') throw new Error('save is damaged');
              localStorage.setItem('cogwild.profile', JSON.stringify(d.profile));
              localStorage.setItem('cogwild.blueprints', JSON.stringify(d.blueprints || []));
              if (d.current) localStorage.setItem('cogwild.current', JSON.stringify(d.current));
              g.toast('Save restored, reloading…');
              setTimeout(() => location.reload(), 700);
            } catch (err) {
              g.toast('Could not restore: ' + err.message);
            }
          });
        };
        const bindRange = (id, key, fmt) => {
          const el = $(id);
          el.value = s[key];
          $(id + 'V').textContent = fmt(s[key]);
          el.oninput = () => { s[key] = parseFloat(el.value); $(id + 'V').textContent = fmt(s[key]); this.apply(); };
        };
        bindRange('setSens', 'sens', (v) => v.toFixed(2) + '×');
        bindRange('setFov', 'fov', (v) => v + '°');
        bindRange('setVol', 'volume', (v) => Math.round(v * 100) + '%');
        const bindChk = (id, key) => { const el = $(id); el.checked = !!s[key]; el.onchange = () => { s[key] = el.checked; this.apply(); }; };
        bindChk('setMusic', 'music');
        bindChk('setFps', 'showFps');
        bindChk('setClips', 'clips');
        $('setDiff').value = s.difficulty;
        $('setDiff').onchange = (e) => { s.difficulty = e.target.value; this.apply(); };
        bindChk('setSteer', 'autoSteer'); bindChk('setInvert', 'invertY'); bindChk('setShake', 'shake'); bindChk('setDmg', 'dmgNumbers');
        $('setCam').value = s.camMode;
        $('setCam').onchange = (e) => { s.camMode = e.target.value; this.apply(); };
        $('setReset').onclick = () => {
          if (!confirm('Reset level, coins, stats and unlocks? Your saved blueprints are kept.')) return;
          const keep = this.game.profile.settings;
          this.game.profile = { xp: 0, unlockAll: false, settings: keep };
          this.game.meta = new Meta(this.game);
          this.game.saveProfile();
          this.game.toast('Progress reset');
          this.game.renderProfile();
          this.game.meta.openPanel('settings');
        };
      } else if (k === 'ach') {
        const got = p.achievements || {};
        const n = CW.ACHIEVEMENTS.filter((a) => got[a.id]).length;
        body.innerHTML = `<div class="small">${n} / ${CW.ACHIEVEMENTS.length} unlocked. Each one pays coins.</div><div class="ach-grid">${CW.ACHIEVEMENTS.map((a) => `<div class="ach ${got[a.id] ? 'got' : ''}"><b>${got[a.id] ? '🏆' : '🔒'} ${a.name}</b><span class="small">${a.desc}</span><div class="small">+${a.reward} 🪙</div></div>`).join('')}</div>`;
      } else if (k === 'news') {
        body.innerHTML = `<ul class="news">
          <li><b>v0.8</b>: 4 new game modes: <b>King of the Hill</b>, <b>Gold Rush</b>, <b>Combat Race</b> and <b>Boss Battle</b> (giant Titan + minions). Respawns in objective modes.</li>
          <li>4 new maps: <b>Desert Mesa</b>, <b>Toxic Swamp</b>, <b>Neon City</b>, <b>Jungle Temple</b> (7 maps total).</li>
          <li>Fairer play: safe spawn points (never near lava, water or sludge), 3.5 s spawn shield, pilots ejected over lava are thrown to land, <b>F</b> to hop free when stuck, bots get unstuck too.</li>
          <li>New paints (Chrome, Royal Purple, Camo, Sakura), trails (Gold Dust, Neon), 6 achievements, 5 challenge types.</li>
          <li><b>v0.7</b>: Faster everything (driving, flying, swimming, shots, dash), speed-sensation camera, new textured metal parts with reflections, smooth textured terrain.</li>
          <li>Loot chests (Common / Rare / Epic) on the map, supply drops from the sky, and a free reward chest after every match.</li>
          <li>New parts: Railgun, Flamethrower, Saw Blade, Repair Drone. New bot mechs: Reaper and Lancer.</li>
          <li>New arena: <b>Volcano Rift</b> with a lava moat (lava burns!). New mode: <b>Survival</b> with endless waves and best-wave records.</li>
          <li>Vehicles look alive: a pilot sits in every driven mech, wheels and legs follow the ground, rotors blur, and you can stand on top of mechs.</li>
          <li><b>v0.6</b>: Tutorial, F8 clips, controller support, graphics settings, Frost Isles arena, engine sounds.</li>
          <li><b>v0.5</b>: Power-ups on the map (Repair, Overcharge, Shield, Turbo, Coins), Tab scoreboard, bot difficulty, music, times of day (Day, Sunset, Night with headlights), new sky, shimmering water, grass & flowers.</li>
          <li>Glowing force-field arena walls and an altitude ceiling.</li>
          <li>Flying fixed: release Space to hover, hold C / Q / Ctrl to dive fast.</li>
          <li>Achievements, part unlocks by level, Quick Play, pilot names, your mech on display in the menu.</li>
          <li>Bots now drive varied "Mk" versions of their mechs.</li>
          <li><b>v0.4</b>: First-person Camera part, Dash, Laser, Spikes, Booster, decor, coins, shop, daily challenges.</li>
          <li><b>v0.3</b>: Rush Build & Workshop Clash modes, 1v1 / 3v3 / 2v2v2v2 / 8 FFA, Test Drive, undo/redo, paint.</li>
          <li><b>Coming later</b>: real online multiplayer with friends.</li></ul>`;
      } else if (k === 'howto') {
        body.innerHTML = `
          <div class="howto">
          <div><h3>🎯 Goal</h3><p>Build a mech, fight, and be the last pilot (or team) standing. A wrecked mech ejects its pilot: you can still fight on foot!</p></div>
          <div><h3>🎮 Mech controls</h3><p><b>W/S</b> drive · <b>A/D</b> turn · <b>Mouse</b> look & aim · <b>Click</b> fire<br><b>Shift</b> DASH (with A/D on Legs = sidestep) · <b>Space</b> up / jump (Legs) · <b>C</b> or <b>Ctrl</b> down<br><b>E</b> exit mech · <b>V</b> switch camera · <b>F</b> unstuck · <b>Tab</b> scores · <b>Esc</b> pause</p></div>
          <div><h3>🎮 Controller</h3><p><b>Left stick</b> drive · <b>Right stick</b> look · <b>RT</b> fire · <b>A</b> up/jump · <b>B / LT</b> down · <b>X</b> dash · <b>Y</b> exit/enter · <b>LB</b> repair · <b>RB</b> camera · <b>View</b> scoreboard · <b>Start</b> pause · <b>D-pad ↑</b> save clip. In menus: D-pad + A, B = back.</p></div>
          <div><h3>🎬 Clips</h3><p>Press <b>F8</b> during a match to save the last 10–20 seconds as a video in your Downloads. Perfect for TikTok / Shorts!</p></div>
          <div><h3>🧍 On foot</h3><p><b>WASD</b> move · <b>Space</b> jump · <b>Click</b> shoot · <b>E</b> board · hold <b>R</b> repair</p></div>
          <div><h3>🔧 Building</h3><p>Every mech needs a <b>Core</b> and a <b>Camera</b> (your view). Nothing may sit in front of the camera's lens. Forget it and it's placed on top automatically.</p></div>
          <div><h3>⛰🌊☁ Movement types</h3><p>Wheels/Legs = land, Floats/Propellers = water, Wings/Rotors/Jets = air. Your rank decides how many types one mech may mix: Mono 1, Hybrid 2, Omni 3.</p></div>
          <div><h3>🕹 Modes</h3><p><b>Rush Build</b>: build from nothing in 75 s. <b>Workshop Clash</b>: bring your design. <b>King of the Hill</b>: hold the moving zone. <b>Gold Rush</b>: grab the most gold. <b>Combat Race</b>: 2 laps through checkpoints. <b>Survival</b>: endless waves. <b>Boss Battle</b>: take down the Titan.</p></div>
          <div><h3>🛟 Fair play</h3><p>You spawn on safe ground with a 3.5 s shield (shooting ends it). Stuck in a ditch or liquid? Press <b>F</b> to hop to safe ground (12 s cooldown).</p></div>
          <div><h3>🧰 Chests & lava</h3><p>Drive into a <b>chest</b> to open it (coins, XP, power-ups). Gold beams = supply drops. On Volcano Rift, <b>lava burns</b> whatever touches it, so use the bridges or fly.</p></div>
          <div><h3>🛡 Survival</h3><p>Endless waves of bots. Your mech is rebuilt between waves. Beat your best wave!</p></div>
          <div><h3>💰 Progress</h3><p>Matches give XP and coins. Daily challenges and the daily reward give more. Spend coins in the Shop on paints and dash trails.</p></div>
          <div><h3>⚡ Sudden death</h3><p>After 4 minutes all cores overheat, so no match lasts forever.</p></div>
          </div>`;
      }
    }

    apply() {
      this.save();
      this.game.applySettings();
    }

    bind() {
      if (Meta._bound) return;
      Meta._bound = true;
      const g = this.game;
      $('btnDaily').onclick = () => g.meta.claimDaily();
      $('btnChallenges').onclick = () => g.meta.openPanel('challenges');
      $('btnShop').onclick = () => g.meta.openPanel('shop');
      $('btnStats').onclick = () => g.meta.openPanel('stats');
      $('btnSettings').onclick = () => g.meta.openPanel('settings');
      $('btnHowto').onclick = () => g.meta.openPanel('howto');
      $('btnAch').onclick = () => g.meta.openPanel('ach');
      $('btnNews').onclick = () => g.meta.openPanel('news');
      $('pName').onchange = (e) => { g.profile.name = e.target.value.trim().slice(0, 16); g.saveProfile(); };
      $('panelClose').onclick = () => g.meta.closePanel();
    }

    // colors available in the Workshop paint section (free + bought)
    paints() {
      const owned = this.game.profile.owned.paints;
      return CW.PAINTS.concat(CW.SHOP.paints.filter((p) => owned.includes(p.id)).map((p) => p.color));
    }
    trailColors(c) {
      const id = c && c.isPlayer ? this.game.profile.trail : 'spark';
      return (CW.SHOP.trails.find((t) => t.id === id) || CW.SHOP.trails[0]).colors;
    }
  }

  CW.Meta = Meta;
  CW.today = today;
})();
