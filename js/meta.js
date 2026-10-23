// Cogwild — progression & menus: coins, daily reward, challenges, shop, stats, settings, how-to
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const E = CW.ECON;
  // a paint preview: the mech panel texture tinted with the color (same look as on the parts)
  CW.paintSwatch = (el, c, tex) => {
    el.style.backgroundColor = hex(c);
    el.style.backgroundImage = `url(${CW.texURL(tex || 'panel')})`;
    el.style.backgroundSize = '160% auto';
    el.style.backgroundPosition = 'center';
    el.style.backgroundBlendMode = 'multiply';
  };
  const swatchStyle = (c, tex) => `background:${hex(c)} url(${CW.texURL(tex || 'panel')}) center/160% auto;background-blend-mode:multiply`;

  // the Shop's catalog lives in js/economy.js (CW.SHOP), shared with the server

  // daily challenges come from js/economy.js (CW.ECON.dailyChallenges), shared with the server

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

  const DEFAULT_SETTINGS = {
    graphics: 'auto', showFps: false, tutorialDone: false, clips: true, arena: 'random', timeOfDay: 'random', difficulty: 'normal', music: true, sens: 1, fov: 80, invertY: false, camMode: 'first', autoSteer: true, shake: true, dmgNumbers: true, volume: 0.6,
    musicVol: 1, keys: {}, touch: 'auto', touchSize: 1, friendOnline: true, otherChat: true,
  };
  // keys you can change in Settings (Esc always pauses); def is the key the game reads internally
  CW.KEY_ACTIONS = [
    { id: 'forward', label: 'Drive forward / walk', def: 'KeyW' }, { id: 'back', label: 'Reverse / walk back', def: 'KeyS' },
    { id: 'left', label: 'Turn left / step left', def: 'KeyA' }, { id: 'right', label: 'Turn right / step right', def: 'KeyD' },
    { id: 'up', label: 'Up / jump', def: 'Space' }, { id: 'down', label: 'Down / dive', def: 'KeyC' }, { id: 'dash', label: 'Dash', def: 'ShiftLeft' }, { id: 'super', label: 'Super (also right-click)', def: 'KeyX' }, { id: 'gadget', label: 'Gadget', def: 'KeyG' },
    { id: 'exit', label: 'Exit / enter mech', def: 'KeyE' }, { id: 'repair', label: 'Repair (hold, on foot)', def: 'KeyR' }, { id: 'unstuck', label: 'Unstuck', def: 'KeyF' },
    { id: 'camera', label: 'Switch camera', def: 'KeyV' }, { id: 'scores', label: 'Scoreboard', def: 'Tab' }, { id: 'clip', label: 'Save clip', def: 'F8' },
  ];
  CW.keyName = (code) => {
    if (!code) return '—';
    if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^(Shift|Control|Alt)Left$/, '$1 (L)').replace(/^(Shift|Control|Alt)Right$/, '$1 (R)');
  };

  class Meta {
    constructor(game) {
      this.game = game;
      const p = game.profile;
      p.coins = p.coins || 0;
      p.owned = Object.assign({ paints: [], trails: ['spark'], avatars: [] }, p.owned || {});
      p.owned.avatars = p.owned.avatars || [];
      p.trail = p.trail || 'spark';
      p.stats = Object.assign({ matches: 0, wins: 0, wrecks: 0, elims: 0, deaths: 0, dashes: 0, parts: 0, rams: 0, airTime: 0, waterTime: 0, bestStreak: 0, coinsEarned: 0, rush: 0, clash: 0 }, p.stats || {});
      p.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
      this.rollChallenges();
      this.bind();
    }

    get settings() { return this.game.profile.settings; }
    save() { this.game.saveProfile(); }

    // ---------------- challenges ----------------
    // today's challenges: the same for everyone (js/economy.js), and the server pays their listed reward
    rollChallenges() {
      const p = this.game.profile;
      const d = E.day();
      if (p.challenges && p.challenges.date === d && p.challenges.list.length === E.DAILY_CHALLENGES) return;
      p.challenges = { date: d, list: E.dailyChallenges(d).map((c) => Object.assign(c, { progress: 0, claimed: false })) };
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

    // coins shown at once; for logged-in players the server checks them and sends the real total back
    addCoins(n, src, key, pp, xp) {
      const p = this.game.profile;
      p.coins += n;
      p.stats.coinsEarned += n;
      const a = this.game.account;
      if (!src || !a) return;
      if (a.walletLive) return a.net.send({ t: 'earn', src, n, key, pp, xp });
      // no connection: match rewards and achievements are reported when it's back
      if (src === 'ach') (p.pendingAch = p.pendingAch || []).push(key);
      else if (src === 'match' || src === 'chest') { p.pending = p.pending || { n: 0, xp: 0 }; p.pending.n += n; p.pending.xp += xp || 0; }
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
      this.renderDaily();
      // the corner card shows one challenge (one you can claim first, else the next unfinished one)
      const list = p.challenges.list;
      const one = list.find((c) => c.progress >= c.target && !c.claimed) || list.find((c) => c.progress < c.target);
      $('menuChallenges').innerHTML = one ? this.challengeRow(one, true) : '<div class="small">✔ All of today\'s challenges are done!</div>';
      $('questsMore').textContent = `${list.filter((c) => c.claimed).length}/${list.length} · see all ›`;
      $('menuTip').textContent = '💡 ' + TIPS[Math.floor((Date.now() / 86400000) % TIPS.length)];
    }

    // the daily gift button: claim it, or how long until the next one
    renderDaily() {
      const p = this.game.profile;
      const ready = p.dailyClaimed !== E.day();
      $('btnDaily').classList.toggle('ready', ready);
      $('badgeShop').classList.toggle('hidden', !ready); // the gift waits in the Shop
      $('btnDaily').innerHTML = ready ? '🎁 <b>Free gift!</b><small>Tap to claim your daily reward</small>' : `⏳ <b>Next gift in ${this.untilMidnight()}</b><small>Streak: ${p.dailyStreak || 1} day${(p.dailyStreak || 1) > 1 ? 's' : ''} · come back tomorrow</small>`;
    }

    challengeRow(c, compact) {
      const pct = Math.round((c.progress / c.target) * 100);
      const done = c.progress >= c.target;
      const btn = compact ? '' : c.claimed ? '<span class="claimed">✔ Claimed</span>' : done ? `<button class="ws-btn on claim" data-ch="${CW.esc(c.text)}">Claim +${c.reward}🪙</button>` : `<span class="small">+${c.reward}🪙</span>`;
      return `<div class="ch-row ${done ? 'done' : ''} ${c.claimed ? 'claimed-row' : ''}"><div class="ch-text">${done ? '✅' : '🎯'} ${c.text}</div><div class="ch-bar"><i style="width:${pct}%"></i></div><div class="ch-meta">${c.progress} / ${c.target} ${btn}</div></div>`;
    }

    claimDaily() {
      const p = this.game.profile;
      if (p.dailyClaimed === E.day()) return;
      // the server keeps the streak and pays (the answer comes back as a wallet message)
      if (!this.game.account.walletLive) return this.game.toast('🎁 Your gift needs an internet connection');
      this.game.account.net.send({ t: 'gift' });
    }
    giftToast(amount) {
      const p = this.game.profile;
      this.game.toast(`🎁 +${amount} coins! Daily streak: ${p.dailyStreak} day${p.dailyStreak > 1 ? 's' : ''}`);
      this.game.audio.click(1.5);
      this.renderMenu();
    }

    // ---------------- shop helpers ----------------
    owns(kind, id) { return (this.game.profile.owned[kind] || []).includes(id); }
    dealPrice(it) { return E.dealPrice(it); }
    // 3 things you don't own yet at 30% off, the same for everyone each day (js/economy.js)
    dailyDeals() { return E.dailyDeals(E.day(), (kind, id) => this.owns(kind, id)); }
    // gifts, deals and challenges renew at midnight UTC
    untilMidnight() { return CW.timeLeft(E.nextMidnight() - Date.now()); }

    // a new paint/trail/avatar: wear it right away
    afterBuy(kind, id) {
      const p = this.game.profile;
      const it = CW.SHOP[kind].find((x) => x.id === id);
      if (kind === 'trails') p.trail = id;
      if (kind === 'avatars' && this.game.account.loggedIn) this.game.account.net.send({ t: 'profileSet', av: it.idx });
      this.save();
      this.game.toast(`Unlocked ${it.name}!`);
      this.game.audio.click(1.5);
      this.game.workshop.buildPaint();
      if (this.panel === 'shop' && !$('panel').classList.contains('hidden')) this.renderPanel();
      this.renderMenu();
    }

    // ---------------- panels ----------------
    openPanel(kind) {
      this.panel = kind;
      $('panel').classList.remove('hidden');
      $('panel').classList.toggle('full', kind === 'shop'); // the Shop is a whole screen of its own
      $('panelBody').parentElement.scrollTop = 0;
      const titles = {
        challenges: '🎯 Daily challenges', shop: '🛒 Shop', stats: '📊 Stats', settings: '⚙ Settings', howto: '❓ How to play', ach: '🎖 Achievements', news: '📰 What\'s new',
        profile: '👤 Profile', friends: '👥 Friends', road: '🛤 Trophy road', pass: '🎟 Cog Pass', clubs: '🛡 Clubs', top: '📈 Leaderboard', player: '👤 Player', ranks: '⭐ Level and ranks', arenas: '🎮 Pick a mode and arena',
      };
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
      if (['profile', 'friends', 'road', 'top', 'player', 'clubs'].includes(k)) return this.game.account.renderPanel(k, body);
      if (k === 'ranks') { body.innerHTML = this.game.ranksHtml(); return; }
      if (k === 'arenas') return this.arenaPanel(body);
      if (k === 'challenges') {
        body.innerHTML = `<div class="small">New challenges every day. Complete them in any mode.</div>` + p.challenges.list.map((c) => this.challengeRow(c, false)).join('');
        body.querySelectorAll('.claim').forEach((b) => {
          b.onclick = () => {
            const c = p.challenges.list.find((x) => x.text === b.dataset.ch);
            if (!c || c.claimed) return;
            if (!this.game.account.walletLive) return this.game.toast('🎯 Claiming needs an internet connection');
            c.claimed = true;
            this.addCoins(c.reward, 'challenge', p.challenges.list.indexOf(c));
            this.save();
            this.game.toast(`+${c.reward} coins!`);
            this.game.audio.click(1.5);
            this.renderPanel();
          };
        });
      } else if (k === 'shop') {
        const deals = this.dailyDeals();
        const item = (kind, it, deal) => {
          const own = this.owns(kind, it.id);
          const price = deal ? this.dealPrice(it) : it.price;
          const eq = (kind === 'trails' && p.trail === it.id) || (kind === 'avatars' && this.game.account.me && this.game.account.me.av === it.idx);
          const look = kind === 'paints' ? `<div class="swatch tex" style="${swatchStyle(it.color)}"></div>`
            : kind === 'trails' ? `<div class="swatch trail" style="background:${it.colors.length > 1 ? `linear-gradient(90deg,${it.colors.map(hex).join(',')})` : hex(it.colors[0])}"><i></i><i></i><i></i></div>`
              : `<div class="swatch av">${CW.avatar(it.idx)}</div>`;
          const label = { paints: 'Paint', trails: 'Dash trail', avatars: 'Avatar' }[kind];
          const btn = eq ? '<span class="owned">★ Equipped</span>'
            : own ? (kind === 'paints' ? '<span class="owned">✔ Owned</span>' : `<button class="ws-btn equip" data-kind="${kind}" data-id="${it.id}">Equip</button>`)
              : `<button class="ws-btn buy ${deal ? 'deal' : ''}" data-kind="${kind}" data-id="${it.id}" data-deal="${deal ? 1 : ''}">${deal ? `<s>${it.price}</s> ` : ''}${price} 🪙</button>`;
          return `<div class="shop-item ${deal ? 'is-deal' : ''}">${deal ? '<i class="deal-tag">-30%</i>' : ''}${look}<b>${it.name}</b><span class="small">${label}</span>${btn}</div>`;
        };
        const left = this.untilMidnight();
        // Cog Pass items aren't sold, but once you have them they show up here to equip
        const sale = (kind) => CW.SHOP[kind].filter((it) => !it.pass || this.owns(kind, it.id));
        const giftReady = p.dailyClaimed !== E.day(), streak = p.dailyStreak || 1;
        body.innerHTML = `<div class="shop-coins">🪙 <b>${p.coins}</b><span class="small">Earn coins from matches, challenges, the daily gift and the Trophy Road.</span></div>
          <div class="shop-gift ${giftReady ? 'ready' : ''}"><span class="g-ico">🎁</span><div><b>Daily gift</b><br><span>${giftReady ? `Free coins! Come back every day for a bigger gift.` : `Next gift in ${left} · streak ${streak} day${streak > 1 ? 's' : ''}`}</span></div>${giftReady ? '<button class="ws-btn on" id="shopGift">Claim</button>' : ''}</div>
          <h3>🔥 Daily deals <span class="small" id="dealTimer">new deals in ${left}</span></h3>
          <div class="shop-grid">${deals.length ? deals.map((d) => item(d.kind, d.it, true)).join('') : '<div class="small">You own everything in the shop. Wow!</div>'}</div>
          <h3>🎨 Paints <span class="small">for your mechs, in the Workshop's Paint section</span></h3><div class="shop-grid">${sale('paints').map((it) => item('paints', it)).join('')}</div>
          <h3>✨ Dash trails</h3><div class="shop-grid">${sale('trails').map((it) => item('trails', it)).join('')}</div>
          <h3>🙂 Avatars <span class="small">${this.game.account.loggedIn ? 'shown on your profile, in rooms and on the leaderboard' : 'log in to wear them'}</span></h3><div class="shop-grid">${sale('avatars').map((it) => item('avatars', it)).join('')}</div>`;
        if ($('shopGift')) $('shopGift').onclick = () => { $('shopGift').disabled = true; this.claimDaily(); };
        body.querySelectorAll('.buy').forEach((b) => {
          b.onclick = () => {
            const it = CW.SHOP[b.dataset.kind].find((x) => x.id === b.dataset.id);
            const price = b.dataset.deal ? this.dealPrice(it) : it.price;
            if (p.coins < price) return this.game.toast(`Need ${price - p.coins} more coins`);
            // the server sets the price, takes the coins and sends back the new wallet (see afterBuy)
            if (!this.game.account.walletLive) return this.game.toast('🛒 The Shop needs an internet connection');
            b.disabled = true;
            this.game.account.net.send({ t: 'buy', kind: b.dataset.kind, id: it.id });
          };
        });
        body.querySelectorAll('.equip').forEach((b) => {
          b.onclick = () => {
            const it = CW.SHOP[b.dataset.kind].find((x) => x.id === b.dataset.id);
            if (b.dataset.kind === 'trails') { p.trail = it.id; this.save(); }
            if (b.dataset.kind === 'avatars') { if (!this.game.account.loggedIn) return this.game.account.openLogin('Log in to wear avatars'); this.game.account.net.send({ t: 'profileSet', av: it.idx }); }
            this.renderPanel();
          };
        });
      } else if (k === 'pass') {
        this.game.account.passPanel(body);
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
        const acct = this.game.account;
        const keyRows = CW.KEY_ACTIONS.map((a) => `<div class="set-row"><span>${a.label}</span><button class="ws-btn key-btn" data-key="${a.id}">${CW.keyName((s.keys || {})[a.id] || a.def)}</button></div>`).join('');
        body.innerHTML = `
          <h3>👤 Account</h3>
          <div class="set-row"><span>${acct && acct.loggedIn ? `Logged in as <b>${CW.esc(acct.me.name)}</b> · progress backed up to the cloud` : 'Playing as a guest (progress saved on this device only)'}</span><button class="ws-btn on" id="setAcct">${acct && acct.loggedIn ? 'Profile' : 'Log in / Sign up'}</button></div>
          <h3>🖥 Display</h3>
          <label class="set-row"><span>Graphics quality</span><select id="setGfx"><option value="auto">Auto (recommended)</option><option value="low">Low (fast, for older laptops and phones)</option><option value="medium">Medium</option><option value="high">High (shadows + max detail)</option></select></label>
          <label class="set-row"><span>Field of view <b id="setFovV"></b></span><input type="range" id="setFov" min="60" max="105" step="1"></label>
          <label class="set-row"><span>Camera</span><select id="setCam"><option value="first">First person (from your Camera part)</option><option value="third">Chase (behind the mech)</option></select></label>
          <div class="set-row"><span>Fullscreen</span><button class="ws-btn" id="setFull">⛶ Toggle fullscreen</button></div>
          <label class="set-row chk"><input type="checkbox" id="setShake"><span>Screen shake</span></label>
          <label class="set-row chk"><input type="checkbox" id="setDmg"><span>Floating damage numbers</span></label>
          <label class="set-row chk"><input type="checkbox" id="setFps"><span>Show FPS counter</span></label>
          <label class="set-row chk"><input type="checkbox" id="setClips"><span>Clip recorder: press <b>F8</b> in a match to save the last 10–20 seconds as a video (uses a little extra CPU)</span></label>
          <h3>🎮 Controls</h3>
          <label class="set-row"><span>Look sensitivity (mouse, stick, touch) <b id="setSensV"></b></span><input type="range" id="setSens" min="0.3" max="2.5" step="0.05"></label>
          <label class="set-row chk"><input type="checkbox" id="setInvert"><span>Invert look up/down</span></label>
          <label class="set-row chk"><input type="checkbox" id="setSteer"><span>Auto-steer: your mech turns toward where you look while driving</span></label>
          <label class="set-row"><span>Bot difficulty</span><select id="setDiff"><option value="easy">🙂 Easy</option><option value="normal">😐 Normal</option><option value="hard">😈 Hard</option></select></label>
          <h3>⌨ Keys <button class="ws-btn" id="setKeysReset">Reset keys</button></h3>
          <div class="small">Click a key, then press the new key (Esc cancels). Esc always pauses, keys 1-8 send quick chat online.</div>
          ${keyRows}
          <h3>📱 Touch screen</h3>
          <label class="set-row"><span>On-screen controls</span><select id="setTouch"><option value="auto">Auto (on for touch screens)</option><option value="on">Always on</option><option value="off">Off</option></select></label>
          <label class="set-row"><span>Button size <b id="setTouchSizeV"></b></span><input type="range" id="setTouchSize" min="0.7" max="1.5" step="0.05"></label>
          <h3>🔊 Sound</h3>
          <label class="set-row"><span>Volume <b id="setVolV"></b></span><input type="range" id="setVol" min="0" max="1" step="0.05"></label>
          <label class="set-row chk"><input type="checkbox" id="setMusic"><span>Music</span></label>
          <label class="set-row"><span>Music volume <b id="setMusicVolV"></b></span><input type="range" id="setMusicVol" min="0" max="1" step="0.05"></label>
          <h3>🌐 Online</h3>
          <label class="set-row chk"><input type="checkbox" id="setFriendOn"><span>Tell me when a friend comes online</span></label>
          <label class="set-row chk"><input type="checkbox" id="setChat"><span>Show other players' quick chat</span></label>
          <h3>💾 Save data</h3>
          <div class="menu-btns" style="justify-content:flex-start;margin-top:4px">
            <button class="ws-btn" id="setExport">💾 Back up save</button>
            <button class="ws-btn" id="setImport">📥 Restore save</button>
            <button class="ws-btn" id="setReset">Reset all progress…</button>
          </div>`;
        $('setAcct').onclick = () => { if (acct.loggedIn) this.openPanel('profile'); else { this.closePanel(); acct.openLogin(); } };
        $('setFull').onclick = () => this.game.toggleFullscreen();
        $('setTouch').value = s.touch;
        $('setTouch').onchange = (e) => { s.touch = e.target.value; this.apply(); };
        $('setKeysReset').onclick = () => { s.keys = {}; this.apply(); this.renderPanel(); };
        body.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => this.listenKey(b)));
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
        bindRange('setMusicVol', 'musicVol', (v) => Math.round(v * 100) + '%');
        bindRange('setTouchSize', 'touchSize', (v) => Math.round(v * 100) + '%');
        const bindChk = (id, key) => { const el = $(id); el.checked = !!s[key]; el.onchange = () => { s[key] = el.checked; this.apply(); }; };
        bindChk('setFriendOn', 'friendOnline');
        bindChk('setChat', 'otherChat');
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
          this.game.profile = { xp: 0, settings: keep };
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
          <li><b>v1.4</b>: 🎨 A cleaner, lighter menu: one color scheme, smaller buttons, PLAY in the corner, a see-through match HUD and a full-screen Shop (your daily gift is in there now).</li>
          <li>🎯 6 daily challenges (tap the challenge card to see them all), and bots aim like people now instead of never missing.</li>
          <li>🔒 Your coins, XP, unlocks and Shop are kept on the server even without an account, and mechs in online matches are checked, so nobody can cheat their way ahead.</li>
          <li><b>v1.3</b>: 🎟 <b>Cog Pass</b>: a free 30-tier reward track every 4 weeks, with paints, trails and avatars you can't buy. Earn pass points from matches, challenges and the daily gift.</li>
          <li>🛡 <b>Clubs</b>: start or join a club of up to 30 players, add up your trophies together and cheer each other on the club wall.</li>
          <li>🧰 <b>Gadgets</b>: Repair Kit, Proximity Mine, Jump Jets or Smoke Screen, 3 uses a match (G / 🧰). Pick yours in the PLAY panel.</li>
          <li>🎯 New mode <b>Bounty Hunt</b> and new arena <b>🏗 Scrap Yard</b>.</li>
          <li>🗓 <b>Weekly events</b> with a twist (low gravity, double damage, fast supers…) and +50% coins. 🏅 <b>Ranked</b> unlocks at 600 trophies: 3v3 for ranked points each season.</li>
          <li>⚖ Fair play: coins and unlocks are now kept safe on the server for logged-in players, match results are checked, a random player hosts, and if the host quits, someone else takes over and the match goes on.</li>
          <li><b>v1.2.1</b>: 🛡 Safety and stability update: stronger protection for accounts and the server, and if the host quits a PLAY match, everyone else is put straight into a new search instead of getting stuck.</li>
          <li><b>v1.2</b>: ⭐ <b>Supers!</b> Deal damage to charge your super, then press X / right-click / ⭐: Shield Dome, Turbo Ram, Missile Barrage or EMP Shockwave, depending on what your mech is built from (the Workshop shows which).</li>
          <li>🗓 <b>Featured event every day</b>: one mode on one arena gives 2× coins and +50% trophies. Tap the purple chip above PLAY to play it.</li>
          <li>🏆 Matchmaking now puts you with players near your trophies, and bots get tougher in higher-trophy matches.</li>
          <li>💥 Hits feel better: enemies flash when hit, bigger wrecks with flying chunks and a shockwave, a red kill marker and slow motion when a match is decided.</li>
          <li><b>v1.1.1</b>: 🔩 Real metal textures on every part: painted panels with bolts and wear, tread-plate armor, gunmetal weapons and engines, carbon-fiber wings and rotors (also in the Shop). Leveling takes longer, and bots aim worse.</li>
          <li><b>v1.1</b>: 🎮 <b>PLAY picks a mode and an arena</b>: all 7 modes are in matchmaking (King of the Hill and Gold Rush are 3v3, Boss and Survival are co-op). Bots fill the empty seats after 30 seconds.</li>
          <li>📱 A new, bigger look that fits every screen: phones get their own layout, panels close when you tap outside them, Back is always in reach.</li>
          <li>⏯ The game never pauses: Esc opens a menu while the match goes on. On phones the music goes quiet while you're in another app.</li>
          <li>🛒 A much bigger Shop: 24 paints, 14 trails, 16 new avatars and <b>daily deals</b> at 30% off. The daily gift shows when the next one is ready.</li>
          <li>🛤 The Trophy Road now has 76 rewards up to 10,000 trophies, plus three new tiers: Mythic, Titan and Cogmaster.</li>
          <li>✏️ Tap your mech in the lobby to edit it.</li>
          <li><b>v1.0</b>: 👤 <b>Accounts!</b> Sign up with a username and password: your progress is backed up and follows you to the web, Windows and Android versions.</li>
          <li>🏆 <b>Trophies</b> in Quick Match, a <b>Trophy Road</b> with 20 rewards, trophy tiers from Bronze to Legend and a world + friends <b>Leaderboard</b>.</li>
          <li>👥 <b>Friends</b> (see who's online and join their room) and 🎉 <b>Parties</b>: up to 4 friends queue into Quick Match together. Pick your avatar on your Profile.</li>
          <li>▶ <b>One PLAY button</b>: pick an arena on the card next to it and PLAY finds you a match there. After 30 seconds bots fill the empty seats, so you're never stuck waiting.</li>
          <li>📱 <b>Touch controls</b> for phones and tablets, a phone-sized layout, and Workshop gestures (drag, pinch, hold to remove).</li>
          <li>⚙ New settings: change any key, music volume, fullscreen, touch button size, quick chat and friend alerts.</li>
          <li><b>v0.9</b>: 🌐 <b>Online multiplayer!</b> Quick Match, public rooms and private rooms with invite links. Every mode works online, including co-op Survival and Boss Battle. Bots fill the empty slots, quick chat with keys 1-8.</li>
          <li>Repairing is easier: hop out (E) and hold <b>R</b> next to your mech to fix damage <b>and rebuild blown-off parts</b>. Survival now fully rebuilds your mech between waves.</li>
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
          <div><h3>🔧 Repairing</h3><p>Press <b>E</b> to hop out, stand next to your mech and <b>hold R</b>. Damaged parts are fixed first, then blown-off parts are rebuilt one by one. Press <b>E</b> to climb back in. Careful: you're exposed while on foot! Repair Kits and Repair Drones also heal.</p></div>
          <div><h3>▶ Playing</h3><p>Pick an arena on the <b>arena card</b>, then press <b>PLAY</b>: you're matched with players on that arena, and after 30 seconds bots fill the empty seats. In a party, the leader presses PLAY and everyone joins. The arena card also has <b>Practice vs bots</b> (all 7 modes) and <b>Private room with friends</b> (a code and an invite link; the host picks the mode). Quick chat: keys <b>1-8</b>.</p></div>
          <div><h3>🧍 On foot</h3><p><b>WASD</b> move · <b>Space</b> jump · <b>Click</b> shoot · <b>E</b> board · hold <b>R</b> repair</p></div>
          <div><h3>🔧 Building</h3><p>Every mech needs a <b>Core</b> and a <b>Camera</b> (your view). Nothing may sit in front of the camera's lens. Forget it and it's placed on top automatically.</p></div>
          <div><h3>⛰🌊☁ Movement types</h3><p>Wheels/Legs = land, Floats/Propellers = water, Wings/Rotors/Jets = air. Your rank decides how many types one mech may mix: Mono 1, Hybrid 2, Omni 3.</p></div>
          <div><h3>🕹 Modes</h3><p><b>Rush Build</b>: build from nothing in 75 s. <b>Workshop Clash</b>: bring your design. <b>King of the Hill</b>: hold the moving zone. <b>Gold Rush</b>: grab the most gold. <b>Combat Race</b>: 2 laps through checkpoints. <b>Survival</b>: endless waves. <b>Boss Battle</b>: take down the Titan.</p></div>
          <div><h3>🛟 Fair play</h3><p>You spawn on safe ground with a 3.5 s shield (shooting ends it). Stuck in a ditch or liquid? Press <b>F</b> to hop to safe ground (12 s cooldown).</p></div>
          <div><h3>🧰 Chests & lava</h3><p>Drive into a <b>chest</b> to open it (coins, XP, power-ups). Gold beams = supply drops. On Volcano Rift, <b>lava burns</b> whatever touches it, so use the bridges or fly.</p></div>
          <div><h3>🛡 Survival</h3><p>Endless waves of bots. Your mech is rebuilt between waves. Beat your best wave!</p></div>
          <div><h3>🧰 Supers & gadgets</h3><p>Deal damage to fill your <b>super</b> (X / right-click / ⭐). Your <b>gadget</b> (G / 🧰) has 3 uses a match with a short cooldown: pick it in the PLAY panel.</p></div>
          <div><h3>🎟 Cog Pass, clubs, Ranked</h3><p>Every match earns <b>Cog Pass</b> points for free rewards. Join a <b>club</b> to team up. At 600 trophies <b>Ranked</b> opens: 3v3 for ranked points that reset each season.</p></div>
          <div><h3>💰 Progress</h3><p>Matches give XP and coins. Daily challenges and the daily reward give more. Spend coins in the Shop on paints and dash trails.</p></div>
          <div><h3>⚡ Sudden death</h3><p>After 4 minutes all cores overheat, so no match lasts forever.</p></div>
          </div>`;
      }
    }

    apply() {
      this.save();
      this.game.applySettings();
    }

    // what PLAY plays: a mode and an arena (any arena = the fastest match)
    arenaPanel(body) {
      const g = this.game;
      const curA = g.arenaChoice(), curM = g.modeChoice();
      const modes = Object.keys(CW.MM_FORMAT).map((id) => {
        const m = CW.MODES[id], f = CW.FORMATS[CW.MM_FORMAT[id]];
        return `<button class="mode-opt ${id === curM ? 'on' : ''}" data-mode="${id}" style="--mc:${m.color}"><span>${m.icon}</span><b>${m.name}</b><small>${f.label}</small></button>`;
      }).join('');
      const arenas = ['random'].concat(Object.keys(CW.ARENAS)).map((id) => {
        const a = g.arenaInfo(id);
        return `<button class="arena-opt ${id === curA ? 'on' : ''}" data-arena="${id}"><span>${a.icon}</span><b>${a.name}</b><small>${a.desc}</small></button>`;
      }).join('');
      const f = CW.FEATURED.today(), fm = CW.MODES[f.mode], fa = CW.ARENAS[f.arena];
      const kind = this.settings.mmEvent, w = E.week(), wm = CW.MODES[w.mode];
      const canRanked = g.account.canRanked(), rk = g.account.me && g.account.me.rp != null ? E.RANKED.rank(g.account.me.rp) : null;
      const lv = g.level();
      const gad = Object.entries(CW.GADGETS).map(([id, gd]) => {
        const locked = gd.level > lv;
        return `<button class="mode-opt gad-opt ${(this.settings.gadget || 'repair') === id ? 'on' : ''} ${locked ? 'locked' : ''}" data-gadget="${id}" ${locked ? 'disabled' : ''} title="${gd.desc}"><span>${gd.icon}</span><b>${gd.name}</b><small>${locked ? `🔒 Level ${gd.level}` : gd.desc}</small></button>`;
      }).join('');
      body.innerHTML = `<div class="event-cards">
          <button class="feat-card week-card ${kind === 'weekly' ? 'on' : ''}" id="weekPick"><span>${w.icon}</span><div><b>This week: ${w.name}</b><small>${wm.icon} ${wm.name} · ${w.desc} · +50% coins · ends in ${CW.timeLeft(w.endsAt - Date.now())}</small></div><em>${kind === 'weekly' ? '✔ Picked' : 'Play it'}</em></button>
          <button class="feat-card ranked-card ${kind === 'ranked' ? 'on' : ''} ${canRanked ? '' : 'locked'}" id="rankedPick"><span>🏅</span><div><b>Ranked${rk ? ` · ${rk.icon} ${rk.name}` : ''}</b><small>${canRanked ? `3v3 in ${E.RANKED.modes.map((x) => CW.MODES[x].name).join(', ')}. Win ranked points; they reset each season.` : `Unlocks at 🏆 ${E.RANKED.unlockAt} trophies (your best).`}</small></div><em>${kind === 'ranked' ? '✔ Picked' : canRanked ? 'Play it' : '🔒'}</em></button>
        </div>
        <button class="feat-card ${!kind && f.mode === curM && f.arena === curA ? 'on' : ''}" id="featPick"><span>⭐</span><div><b>Featured today: ${fm.icon} ${fm.name} on ${fa.icon} ${fa.name}</b><small>${CW.FEATURED.COIN_MULT}× coins and +50% trophies · ends in ${g.featuredLeft()}</small></div><em>${f.mode === curM && f.arena === curA ? '✔ Picked' : 'Play it'}</em></button>
        <div class="small">Pick a mode and an arena, then press <b>PLAY</b>. You're matched with players who picked the same; after 30 seconds bots fill the empty seats.</div>
        <h3>Mode</h3><div class="mode-row">${modes}</div>
        <div class="small" id="modeDesc">${CW.MODES[curM].desc}</div>
        <h3>Arena</h3><div class="arena-grid">${arenas}</div>
        <h3>Gadget <span class="small">3 uses a match · G / 🧰</span></h3><div class="mode-row">${gad}</div>
        <div class="other-play">
          <button class="ws-btn" id="opRoom">🤝 Play with friends (private room)</button>
          <button class="ws-btn" id="opTutorial">🎓 Tutorial</button>
        </div>`;
      body.querySelectorAll('[data-gadget]').forEach((b) => (b.onclick = () => {
        this.settings.gadget = b.dataset.gadget;
        this.save();
        body.querySelectorAll('[data-gadget]').forEach((x) => x.classList.toggle('on', x === b));
        g.audio.click(1.2);
      }));
      $('weekPick').onclick = () => { this.settings.mmEvent = 'weekly'; this.save(); g.renderArenaCard(); this.closePanel(); g.audio.click(1.3); };
      $('rankedPick').onclick = () => {
        if (!canRanked) return g.toast(g.account.loggedIn ? `🏅 Ranked unlocks at ${E.RANKED.unlockAt} trophies` : 'Log in and reach 600 trophies to play Ranked');
        this.settings.mmEvent = 'ranked'; this.save(); g.renderArenaCard(); this.closePanel(); g.audio.click(1.3);
      };
      body.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
        this.settings.mmEvent = null;
        this.settings.mmMode = b.dataset.mode;
        this.save();
        g.renderArenaCard();
        body.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
        $('modeDesc').textContent = CW.MODES[b.dataset.mode].desc;
        g.audio.click(1.2);
      }));
      body.querySelectorAll('[data-arena]').forEach((b) => (b.onclick = () => {
        this.settings.mmEvent = null;
        this.settings.mmArena = b.dataset.arena;
        this.save();
        g.renderArenaCard();
        this.closePanel();
        g.audio.click(1.2);
      }));
      $('featPick').onclick = () => { this.settings.mmEvent = null; this.settings.mmMode = f.mode; this.settings.mmArena = f.arena; this.save(); g.renderArenaCard(); this.closePanel(); g.audio.click(1.3); };
      $('opRoom').onclick = () => { this.closePanel(); g.net.openOnline(); };
      $('opTutorial').onclick = () => { this.closePanel(); g.startTutorial(); };
    }

    // key rebinding: the next key pressed becomes this action's key (a key used elsewhere swaps places)
    listenKey(btn) {
      const s = this.settings;
      const act = CW.KEY_ACTIONS.find((a) => a.id === btn.dataset.key);
      btn.textContent = 'Press a key…';
      btn.classList.add('on');
      const done = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.removeEventListener('keydown', done, true);
        if (e.code !== 'Escape') {
          s.keys = Object.assign({}, s.keys);
          const bound = (id) => s.keys[id] || CW.KEY_ACTIONS.find((a) => a.id === id).def;
          const old = bound(act.id);
          const clash = CW.KEY_ACTIONS.find((a) => a.id !== act.id && bound(a.id) === e.code);
          if (clash) s.keys[clash.id] = old;
          s.keys[act.id] = e.code;
          for (const a of CW.KEY_ACTIONS) if (s.keys[a.id] === a.def) delete s.keys[a.id];
          if (clash) this.game.toast(`${CW.keyName(e.code)} was "${clash.label}": swapped to ${CW.keyName(old)}`);
          this.apply();
        }
        this.renderPanel();
      };
      window.addEventListener('keydown', done, true);
    }

    bind() {
      if (Meta._bound) return;
      Meta._bound = true;
      const g = this.game;
      $('btnDaily').onclick = () => g.meta.claimDaily();
      setInterval(() => { if (g.state === 'menu') g.meta.renderDaily(); }, 30000);
      $('btnChallenges').onclick = () => g.meta.openPanel('challenges');
      $('questsCard').onclick = (e) => { if (!e.target.closest('button')) g.meta.openPanel('challenges'); };
      $('btnShop').onclick = () => g.meta.openPanel('shop');
      $('btnStats').onclick = () => g.meta.openPanel('stats');
      $('btnSettings').onclick = () => g.meta.openPanel('settings');
      $('btnHowto').onclick = () => g.meta.openPanel('howto');
      $('btnAch').onclick = () => g.meta.openPanel('ach');
      $('btnNews').onclick = () => g.meta.openPanel('news');
      $('btnRanks').onclick = () => g.meta.openPanel('ranks');
      $('coinChip').onclick = () => g.meta.openPanel('shop');
      $('pName').onchange = (e) => { g.profile.name = e.target.value.trim().slice(0, 16); g.saveProfile(); };
      $('panelClose').onclick = () => g.meta.closePanel();
      // tap/click outside the panel closes it, like most games and apps
      $('panel').addEventListener('pointerdown', (e) => { if (e.target === $('panel')) g.meta.closePanel(); });
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
  CW.today = () => E.day();
})();
