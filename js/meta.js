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
  const SHOP_LABEL = { paints: 'Paint', trails: 'Dash trail', avatars: 'Avatar', finishes: 'Mech finish', wrecks: 'Wreck effect' };
  // keys that can be turned off: voice chat (push-to-talk, mute, deafen) and opening the chat
  const OPT_KEYS = { vcPtt: 'KeyB', vcMute: 'KeyM', vcDeaf: 'KeyN', chatKey: 'KeyT' };
  const SUPPORT_EMAIL = 'theblueduckymc@gmail.com'; // BlueDucky Games' public contact (also in privacy.html)

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
    graphics: 'auto', showFps: false, tutorialDone: false, clips: true, arena: 'random', timeOfDay: 'random', difficulty: 'normal', music: true, sens: 1, fov: 80, invertY: false, camMode: 'first', autoSteer: false, shake: true, dmgNumbers: true, volume: 0.6,
    musicVol: 1, keys: {}, touch: 'auto', touchSize: 1, vibrate: true, aimAssist: true, friendOnline: true, otherChat: true,
    // chat and voice chat (js/talk.js, js/voice.js); voice: undefined until the game has asked
    chatNotes: true, vcHear: 'game', vcMode: 'open', vcVol: 1, vcMic: '', vcOut: '',
  };
  // keys you can change in Settings (Esc always pauses); def is the key the game reads internally
  CW.KEY_ACTIONS = [
    { id: 'forward', label: 'Drive forward / walk', def: 'KeyW' }, { id: 'back', label: 'Reverse / walk back', def: 'KeyS' },
    { id: 'left', label: 'Turn left / step left', def: 'KeyA' }, { id: 'right', label: 'Turn right / step right', def: 'KeyD' },
    { id: 'up', label: 'Fly up / jump', def: 'Space' }, { id: 'down', label: 'Fly down / dive (also Q, Ctrl)', def: 'KeyC' }, { id: 'dash', label: 'Dash', def: 'ShiftLeft' }, { id: 'super', label: 'Super (also right-click)', def: 'KeyX' }, { id: 'gadget', label: 'Gadget', def: 'KeyG' },
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
      p.owned = Object.assign({ paints: [], trails: ['spark'], avatars: [], finishes: [], wrecks: [] }, p.owned || {});
      p.owned.finishes = p.owned.finishes || []; p.owned.wrecks = p.owned.wrecks || [];
      p.owned.avatars = p.owned.avatars || [];
      p.trail = p.trail || 'spark';
      p.stats = Object.assign({ matches: 0, wins: 0, wrecks: 0, elims: 0, deaths: 0, dashes: 0, parts: 0, rams: 0, airTime: 0, waterTime: 0, bestStreak: 0, coinsEarned: 0, rush: 0, clash: 0 }, p.stats || {});
      p.settings = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
      // v1.8 drives like a car: A/D steer, the mouse only aims. Auto-steer (W drives toward where you look) stays on
      // for touch screens, where the left thumb has only the stick
      if (!p.settings.carSteer) { p.settings.carSteer = 1; p.settings.autoSteer = 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
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

    // ---------------- support / contact us (Settings › Support and the top of Help) ----------------
    supportHtml() {
      return `<div class="support-card"><div class="sup-ico">✉</div><div class="sup-txt"><b>Need help? Contact us</b>
        <span>Found a bug, lost progress, a problem with a player or a question? Email BlueDucky Games at <b class="sup-mail">${SUPPORT_EMAIL}</b>. We read every message.</span>
        <span class="small">Tip: tell us your username, your device and what happened. To report a player in a match, tap their name in the chat.</span></div>
        <div class="sup-btns"><button class="ws-btn on" data-support="mail">✉ Email us</button><button class="ws-btn" data-support="copy">📋 Copy email</button></div></div>`;
    }
    bindSupport(root) {
      root.querySelectorAll('[data-support]').forEach((b) => (b.onclick = () => {
        if (b.dataset.support === 'copy') {
          const done = () => this.game.toast('📋 Email copied: ' + SUPPORT_EMAIL);
          try { navigator.clipboard.writeText(SUPPORT_EMAIL).then(done, () => this.game.toast(SUPPORT_EMAIL)); } catch (e) { this.game.toast(SUPPORT_EMAIL); }
          return;
        }
        const acct = this.game.account, who = acct && acct.loggedIn ? acct.me.name : 'guest';
        const device = CW.PORTAL ? 'website (' + CW.PORTAL + ')' : window.CogwildNative ? 'Android app' : /Electron/.test(navigator.userAgent) ? 'desktop app' : 'browser';
        const body = `Username: ${who}\nGame version: ${CW.VERSION} (${device})\n\nWhat happened:\n`;
        CW.openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Cogwild support ' + CW.VERSION)}&body=${encodeURIComponent(body)}`);
      }));
    }

    // ---------------- shop helpers ----------------
    owns(kind, id) { return (this.game.profile.owned[kind] || []).includes(id); }
    dealPrice(it) { return E.dealPrice(it); }
    // 3 things you don't own yet at 30% off, the same for everyone each day (js/economy.js)
    dailyDeals() { return E.dailyDeals(E.day(), (kind, id) => this.owns(kind, id)); }
    // gifts, deals and challenges renew at midnight UTC
    untilMidnight() { return CW.timeLeft(E.nextMidnight() - Date.now()); }

    // what a shop item looks like (its card and the "buy it?" pop-up)
    shopLook(kind, it) {
      return kind === 'paints' ? `<div class="swatch tex" style="${swatchStyle(it.color)}"></div>`
        : kind === 'trails' ? `<div class="swatch trail" style="background:${it.colors.length > 1 ? `linear-gradient(90deg,${it.colors.map(hex).join(',')})` : hex(it.colors[0])}"><i></i><i></i><i></i></div>`
          : kind === 'finishes' ? `<div class="swatch fin fin-${it.id}"><i>${it.icon}</i></div>`
            : kind === 'wrecks' ? `<div class="swatch wfx wfx-${it.id}"><i>${it.icon}</i></div>`
          : `<div class="swatch av">${CW.avatar(it.idx)}</div>`;
    }
    // "Buy it?" pop-up before any coins are spent
    confirmBuy(kind, it, deal) {
      const p = this.game.profile;
      const price = deal ? this.dealPrice(it) : it.price;
      const short = price - p.coins;
      $('confirmLook').innerHTML = this.shopLook(kind, it);
      $('confirmTitle').textContent = `Buy ${it.name}?`;
      $('confirmKind').textContent = SHOP_LABEL[kind] + (deal ? ' · daily deal, 30% off' : '');
      $('confirmPrice').innerHTML = `${deal ? `<s>${it.price}</s> ` : ''}${price} 🪙`;
      $('confirmDesc').innerHTML = short > 0 ? `You have ${p.coins} 🪙. You need <b>${short}</b> more coins.`
        : `You have ${p.coins} 🪙, ${p.coins - price} 🪙 left after buying.`;
      $('confirmOk').textContent = short > 0 ? 'Not enough coins' : `Buy for ${price} 🪙`;
      $('confirmOk').disabled = short > 0;
      $('confirmOk').onclick = () => {
        // the server sets the price, takes the coins and sends back the new wallet (see afterBuy)
        if (!this.game.account.walletLive) { this.closeConfirm(); return this.game.toast('🛒 The Shop needs an internet connection'); }
        $('confirmOk').disabled = true;
        this.game.account.net.send({ t: 'buy', kind, id: it.id });
        this.closeConfirm();
      };
      $('confirm').classList.remove('hidden');
      setTimeout(() => !$('confirmOk').disabled && $('confirmOk').focus(), 30);
    }
    closeConfirm() { $('confirm').classList.add('hidden'); }

    // a new paint/trail/avatar: wear it right away
    afterBuy(kind, id) {
      const p = this.game.profile;
      const it = CW.SHOP[kind].find((x) => x.id === id);
      if (kind === 'trails') p.trail = id;
      if (kind === 'finishes') { p.finish = id; this.game.refreshShowcase && this.game.refreshShowcase(); }
      if (kind === 'wrecks') p.wreckFx = id;
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
      // the Shop, Cog Pass and Settings are whole screens of their own
      $('panel').classList.toggle('full', ['shop', 'pass', 'settings'].includes(kind));
      $('panel').dataset.kind = kind;
      $('panelBody').innerHTML = '';
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

    // every number we keep about your play (the Stats panel and your Profile)
    statsHtml() {
      const p = this.game.profile, s = p.stats;
      const rows = [
        ['Matches played', s.matches], ['Wins', s.wins], ['Win rate', s.matches ? Math.round((s.wins / s.matches) * 100) + '%' : '—'],
        ['Mechs wrecked', s.wrecks], ['Pilots eliminated', s.elims], ['Times eliminated', s.deaths], ['Best wreck streak', s.bestStreak],
        ['Enemy parts blown off', s.parts], ['Spike rams', s.rams], ['Dashes', s.dashes],
        ['Time flying', Math.round(s.airTime) + ' s'], ['Time in water', Math.round(s.waterTime) + ' s'],
        ['Rush Build matches', s.rush], ['Workshop Clash matches', s.clash], ['Coins earned', s.coinsEarned], ['Level', this.game.level()],
        ['Achievements', `${Object.keys(p.achievements || {}).length}/${CW.ACHIEVEMENTS.length}`],
      ];
      return `<div class="stat-grid">${rows.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('')}</div>`;
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
        // the whole card is the button: click to buy (asks first) or to equip
        const item = (kind, it, deal) => {
          const own = this.owns(kind, it.id);
          const price = deal ? this.dealPrice(it) : it.price;
          const eq = (kind === 'trails' && p.trail === it.id) || (kind === 'avatars' && this.game.account.me && this.game.account.me.av === it.idx)
            || (kind === 'finishes' && p.finish === it.id) || (kind === 'wrecks' && p.wreckFx === it.id);
          // finishes and wreck effects can be taken off again (click the equipped one)
          const act = eq && (kind === 'finishes' || kind === 'wrecks') ? 'equip' : eq || (own && kind === 'paints') ? '' : own ? 'equip' : 'buy';
          const tag = eq ? `<span class="owned">★ Equipped${kind === 'finishes' || kind === 'wrecks' ? ' · click to take off' : ''}</span>`
            : own ? (kind === 'paints' ? '<span class="owned">✔ Owned</span>' : '<span class="price equip">Equip</span>')
              : `<span class="price">${deal ? `<s>${it.price}</s> ` : ''}${price} 🪙</span>`;
          const data = act ? ` data-act="${act}" data-kind="${kind}" data-id="${it.id}" data-deal="${deal ? 1 : ''}" role="button" tabindex="0"` : '';
          return `<div class="shop-item ${deal ? 'is-deal' : ''} ${act ? 'can-' + act : ''}"${data}>${deal ? '<i class="deal-tag">-30%</i>' : ''}${this.shopLook(kind, it)}<b>${it.name}</b><span class="small">${SHOP_LABEL[kind]}</span>${tag}</div>`;
        };
        const left = this.untilMidnight();
        // Cog Pass items aren't sold, but once you have them they show up here to equip
        const sale = (kind) => CW.SHOP[kind].filter((it) => !it.pass || this.owns(kind, it.id));
        const giftReady = p.dailyClaimed !== E.day(), streak = p.dailyStreak || 1;
        body.innerHTML = `<div class="shop-coins">🪙 <b>${p.coins}</b><span class="small">Earn coins from matches, challenges, the daily gift and the Trophy Road.</span></div>
          <div class="shop-gift ${giftReady ? 'ready' : ''}"><span class="g-ico">🎁</span><div><b>Daily gift</b><br><span>${giftReady ? `Free coins! Come back every day for a bigger gift.` : `Next gift in ${left} · streak ${streak} day${streak > 1 ? 's' : ''}`}</span></div>${giftReady ? '<button class="ws-btn on" id="shopGift">Claim</button>' : ''}</div>
          <h3>🔥 Daily deals <span class="small" id="dealTimer">new deals in ${left}</span></h3>
          <div class="shop-grid">${deals.length ? deals.map((d) => item(d.kind, d.it, true)).join('') : '<div class="small">You own everything in the shop. Wow!</div>'}</div>
          <h3>🌟 Mech finishes <span class="small">change how your mech's paint looks: chrome, gold, glowing neon…</span></h3><div class="shop-grid">${sale('finishes').map((it) => item('finishes', it)).join('')}</div>
          <h3>💥 Wreck effects <span class="small">what you see when you wreck an enemy</span></h3><div class="shop-grid">${sale('wrecks').map((it) => item('wrecks', it)).join('')}</div>
          <h3>🎨 Paints <span class="small">for your mechs, in the Workshop's Paint section</span></h3><div class="shop-grid">${sale('paints').map((it) => item('paints', it)).join('')}</div>
          <h3>✨ Dash trails</h3><div class="shop-grid">${sale('trails').map((it) => item('trails', it)).join('')}</div>
          <h3>🙂 Avatars <span class="small">${this.game.account.loggedIn ? 'shown on your profile, in rooms and on the leaderboard' : 'log in to wear them'}</span></h3><div class="shop-grid">${sale('avatars').map((it) => item('avatars', it)).join('')}</div>`;
        if ($('shopGift')) $('shopGift').onclick = () => { $('shopGift').disabled = true; this.claimDaily(); };
        body.querySelectorAll('.shop-item[data-act]').forEach((b) => {
          const it = CW.SHOP[b.dataset.kind].find((x) => x.id === b.dataset.id);
          const go = () => {
            if (b.dataset.act === 'buy') return this.confirmBuy(b.dataset.kind, it, !!b.dataset.deal);
            if (b.dataset.kind === 'trails') { p.trail = it.id; this.save(); }
            if (b.dataset.kind === 'finishes') { p.finish = p.finish === it.id ? '' : it.id; this.save(); this.game.refreshShowcase && this.game.refreshShowcase(); this.game.toast(p.finish ? `🌟 ${it.name} on your mech` : 'Finish taken off'); }
            if (b.dataset.kind === 'wrecks') { p.wreckFx = p.wreckFx === it.id ? '' : it.id; this.save(); this.game.toast(p.wreckFx ? `💥 Your wrecks: ${it.name}` : 'Wreck effect taken off'); }
            if (b.dataset.kind === 'avatars') { if (!this.game.account.loggedIn) return this.game.account.openLogin('Log in to wear avatars'); this.game.account.net.send({ t: 'profileSet', av: it.idx }); }
            this.renderPanel();
          };
          b.onclick = go;
          b.onkeydown = (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); go(); } };
        });
      } else if (k === 'pass') {
        this.game.account.passPanel(body);
      } else if (k === 'stats') {
        body.innerHTML = this.statsHtml();
      } else if (k === 'settings') {
        const s = this.settings;
        const acct = this.game.account;
        const keyRows = CW.KEY_ACTIONS.map((a) => `<div class="set-row key-row"><span>${a.label}</span><button class="ws-btn key-btn" data-key="${a.id}">${CW.keyName((s.keys || {})[a.id] || a.def)}</button></div>`).join('');
        const talk = this.game.talk, voice = this.game.voice;
        const voiceNote = CW.PORTAL ? 'Voice chat is not available on this website. Play on cogwild.duckdns.org or in the app to use it.'
          : !voice.supported ? "This browser can't do voice chat."
            : talk.mode === 'quick' ? 'Voice chat is off because Quick chat only is on (💬 Chat).'
              : !(acct && acct.loggedIn) ? 'Voice chat needs an account: log in first.' : '';
        const outOk = !!(window.HTMLMediaElement && HTMLMediaElement.prototype.setSinkId);
        const blockedRows = talk.blocked.length ? talk.blocked.map((n) => `<div class="set-row"><span>${CW.esc(n)}</span><button class="ws-btn" data-unblock="${CW.esc(n)}">Unblock</button></div>`).join('')
          : '<div class="small">Nobody. Tap a name in the chat to block or report a player.</div>';
        // keys you can change or turn off (voice chat and the chat)
        const optKey = (label, id) => {
          const k = this.optKey(id);
          return `<div class="set-row key-row"><span>${label}</span><span class="key-pair"><button class="ws-btn key-btn" data-vkey="${id}">${k === 'none' ? 'No key' : CW.keyName(k)}</button><button class="ws-btn key-off ${k === 'none' ? 'hidden' : ''}" data-vkeyoff="${id}" aria-label="No key">✕</button></span></div>`;
        };
        const tabs = [['account', '👤', 'Account'], ['display', '🖥', 'Display'], ['controls', '🎮', 'Controls'], ['keys', '⌨', 'Keys'], ['touch', '📱', 'Touch screen'], ['sound', '🔊', 'Sound'], ['voice', '🎤', 'Voice chat'], ['chat', '💬', 'Chat'], ['online', '🌐', 'Online'], ['save', '💾', 'Save data'], ['support', '✉', 'Support']];
        body.innerHTML = `<div class="set-wrap"><nav class="set-tabs">${tabs.map(([id, ico, name]) => `<button class="set-tab" data-settab="${id}"><i>${ico}</i><span>${name}</span></button>`).join('')}</nav><div class="set-main">
          <section class="set-sec" data-sec="account"><h3>👤 Account</h3>
          <div class="set-row"><span>${acct && acct.loggedIn ? `Logged in as <b>${CW.esc(acct.me.name)}</b> · progress backed up to the cloud` : 'Playing as a guest (progress saved on this device only)'}</span><button class="ws-btn on" id="setAcct">${acct && acct.loggedIn ? 'Profile' : 'Log in / Sign up'}</button></div>
          </section><section class="set-sec" data-sec="display"><h3>🖥 Display</h3>
          <label class="set-row"><span>Graphics quality</span><select id="setGfx"><option value="auto">Auto (recommended)</option><option value="low">Low (fast, for older laptops and phones)</option><option value="medium">Medium</option><option value="high">High (shadows + max detail)</option></select></label>
          <label class="set-row"><span>Field of view <b id="setFovV"></b></span><input type="range" id="setFov" min="60" max="105" step="1"></label>
          <label class="set-row"><span>Camera</span><select id="setCam"><option value="first">First person (from your Camera part)</option><option value="third">Chase (behind the mech)</option></select></label>
          <div class="set-row"><span>Fullscreen</span><button class="ws-btn" id="setFull">⛶ Toggle fullscreen</button></div>
          <label class="set-row chk"><input type="checkbox" id="setShake"><span>Screen shake</span></label>
          <label class="set-row chk"><input type="checkbox" id="setDmg"><span>Floating damage numbers</span></label>
          <label class="set-row chk"><input type="checkbox" id="setFps"><span>Show FPS counter</span></label>
          <label class="set-row chk"><input type="checkbox" id="setClips"><span>Clip recorder: press <b>F8</b> in a match to save the last 10–20 seconds as a video (uses a little extra CPU)</span></label>
          </section><section class="set-sec" data-sec="controls"><h3>🎮 Controls</h3>
          <label class="set-row"><span>Look sensitivity (mouse, stick, touch) <b id="setSensV"></b></span><input type="range" id="setSens" min="0.3" max="2.5" step="0.05"></label>
          <label class="set-row chk"><input type="checkbox" id="setInvert"><span>Invert look up/down</span></label>
          <label class="set-row chk"><input type="checkbox" id="setSteer"><span>Auto-steer: W drives toward where you look (off = steer with A/D like a car)</span></label>
          <label class="set-row"><span>Bot difficulty</span><select id="setDiff"><option value="easy">🙂 Easy</option><option value="normal">😐 Normal</option><option value="hard">😈 Hard</option></select></label>
          </section><section class="set-sec" data-sec="keys"><h3>⌨ Keys <button class="ws-btn" id="setKeysReset">Reset keys</button></h3>
          <div class="small">Click a key, then press the new key (Esc cancels). Esc always pauses, keys 1-8 send quick chat online.</div>
          ${keyRows}
          </section><section class="set-sec" data-sec="touch"><h3>📱 Touch screen</h3>
          <label class="set-row"><span>On-screen controls</span><select id="setTouch"><option value="auto">Auto (on for touch screens)</option><option value="on">Always on</option><option value="off">Off</option></select></label>
          <label class="set-row"><span>Button size <b id="setTouchSizeV"></b></span><input type="range" id="setTouchSize" min="0.7" max="1.5" step="0.05"></label>
          <label class="set-row chk"><input type="checkbox" id="setVibrate"><span>Vibration (phones and tablets)</span></label>
          <label class="set-row chk"><input type="checkbox" id="setAimAssist"><span>Aim assist (touch: your aim is gently pulled onto enemies near the crosshair)</span></label>
          </section><section class="set-sec" data-sec="sound"><h3>🔊 Sound</h3>
          <label class="set-row"><span>Volume <b id="setVolV"></b></span><input type="range" id="setVol" min="0" max="1" step="0.05"></label>
          <label class="set-row chk"><input type="checkbox" id="setMusic"><span>Music</span></label>
          <label class="set-row"><span>Music volume <b id="setMusicVolV"></b></span><input type="range" id="setMusicVol" min="0" max="1" step="0.05"></label>
          </section><section class="set-sec" data-sec="online"><h3>🌐 Online</h3>
          <label class="set-row chk"><input type="checkbox" id="setFriendOn"><span>Tell me when a friend comes online</span></label>
          </section><section class="set-sec" data-sec="voice"><h3>🎤 Voice chat</h3>
          ${voiceNote ? `<div class="small set-note">${voiceNote}</div>` : ''}
          <label class="set-row chk"><input type="checkbox" id="setVoice"><span>Voice chat: talk with your party and the players in your match</span></label>
          <label class="set-row"><span>Who you hear</span><select id="setVcHear"><option value="game">My party and my match</option><option value="party">My party only</option></select></label>
          <label class="set-row"><span>How your mic works</span><select id="setVcMode"><option value="open">Open mic: always on (mute with the key below)</option><option value="ptt">Push to talk: only while you hold the key</option></select></label>
          ${optKey('Push to talk (hold)', 'vcPtt')}
          ${optKey('Mute / unmute your mic', 'vcMute')}
          ${optKey('Deafen: stop hearing others (also mutes you)', 'vcDeaf')}
          <label class="set-row"><span>Microphone</span><select id="setVcMic"><option value="">Default microphone</option></select></label>
          <label class="set-row ${outOk ? '' : 'hidden'}"><span>Speakers / headphones</span><select id="setVcOut"><option value="">Default speakers</option></select></label>
          <label class="set-row"><span>Voice volume <b id="setVcVolV"></b></span><input type="range" id="setVcVol" min="0" max="2" step="0.05"></label>
          <div class="set-row"><span>Your mic <small class="small" id="vcCount"></small></span><div class="vc-meter"><i id="vcMeter"></i></div></div>
          <div class="small">On phones, tap 🎤 to mute (or hold it to talk with push to talk). Blocked players can't hear you or talk to you.</div>
          </section><section class="set-sec" data-sec="chat"><h3>💬 Chat</h3>
          <label class="set-row"><span>Chat with friends, party and club</span><select id="setChatMode"><option value="free">Free chat: type anything</option><option value="quick">Quick chat only (for kids): ready-made messages, no voice chat</option></select></label>
          <div class="small">${acct && acct.loggedIn ? 'Saved on your account, on every device.' : 'Log in to chat with friends, your party and your club.'} Matches always use quick chat (keys 1-8). Open the chat with 💬 or Enter.</div>
          ${optKey('Open the chat (Enter works too)', 'chatKey')}
          <label class="set-row chk"><input type="checkbox" id="setChat"><span>Show other players' quick chat in matches</span></label>
          <label class="set-row chk"><input type="checkbox" id="setChatNotes"><span>Show new messages while the chat is closed</span></label>
          <h3>🚫 Blocked players</h3>
          ${blockedRows}
          </section><section class="set-sec" data-sec="save"><h3>💾 Save data</h3>
          <div class="menu-btns" style="justify-content:flex-start;margin-top:4px">
            <button class="ws-btn" id="setExport">💾 Back up save</button>
            <button class="ws-btn" id="setImport">📥 Restore save</button>
            <button class="ws-btn" id="setReset">Reset all progress…</button>
          </div></section><section class="set-sec" data-sec="support"><h3>✉ Support</h3>${this.supportHtml()}
          <div class="small" style="margin-top:8px">Cogwild ${CW.VERSION} · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms</a></div></section></div></div>`;
        this.bindSupport(body);
        // one category at a time (the last one you looked at)
        const showTab = (id) => {
          this.setTab = id;
          body.querySelectorAll('[data-settab]').forEach((b) => b.classList.toggle('on', b.dataset.settab === id));
          body.querySelectorAll('.set-sec').forEach((x) => x.classList.toggle('on', x.dataset.sec === id));
          body.querySelector('.set-main').scrollTop = 0;
        };
        body.querySelectorAll('[data-settab]').forEach((b) => (b.onclick = () => showTab(b.dataset.settab)));
        showTab(this.setTab || 'account');
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
        bindChk('setChatNotes', 'chatNotes');
        // chat mode lives on the account
        $('setChatMode').value = talk.mode;
        $('setChatMode').disabled = !(acct && acct.loggedIn) || !talk.freeOk && talk.mode !== 'quick';
        $('setChatMode').onchange = (e) => talk.setMode(e.target.value);
        body.querySelectorAll('[data-unblock]').forEach((b) => (b.onclick = () => this.game.net.send({ t: 'unblock', name: b.dataset.unblock })));
        // voice chat
        $('setVoice').checked = !!s.voice;
        $('setVoice').disabled = !!voiceNote && !s.voice;
        $('setVoice').onchange = (e) => { s.voice = e.target.checked; this.apply(); voice.apply(); };
        $('setVcHear').value = s.vcHear === 'party' ? 'party' : 'game';
        $('setVcHear').onchange = (e) => { s.vcHear = e.target.value; this.apply(); voice.apply(); };
        $('setVcMode').value = voice.talkMode;
        $('setVcMode').onchange = (e) => { s.vcMode = e.target.value; this.apply(); voice.applyMic(); };
        bindRange('setVcVol', 'vcVol', (v) => Math.round(v * 100) + '%');
        $('setVcVol').addEventListener('input', () => voice.changeVolume());
        body.querySelectorAll('[data-vkey]').forEach((b) => (b.onclick = () => this.listenVoiceKey(b)));
        body.querySelectorAll('[data-vkeyoff]').forEach((b) => (b.onclick = () => { s[b.dataset.vkeyoff] = 'none'; this.apply(); this.renderPanel(); }));
        voice.devices().then((list) => {
          const fill = (id, kind, key, def) => {
            const el = $(id);
            if (!el) return;
            const devs = list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default');
            el.innerHTML = `<option value="">${def}</option>` + devs.map((d, i) => `<option value="${CW.esc(d.deviceId)}">${CW.esc(d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}`)}</option>`).join('');
            el.value = devs.some((d) => d.deviceId === s[key]) ? s[key] : '';
          };
          fill('setVcMic', 'audioinput', 'vcMic', 'Default microphone');
          fill('setVcOut', 'audiooutput', 'vcOut', 'Default speakers');
        });
        $('setVcMic').onchange = (e) => { s.vcMic = e.target.value; this.apply(); voice.changeMic(); };
        $('setVcOut').onchange = (e) => { s.vcOut = e.target.value; this.apply(); voice.changeOutput(); };
        voice.render();
        bindChk('setChat', 'otherChat');
        bindChk('setVibrate', 'vibrate');
        bindChk('setAimAssist', 'aimAssist');
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
        // anything already done unlocks now (and pays its coins)
        for (const a of CW.checkAchievements(this.game)) this.game.toast(`🏆 ${a.name}! +${a.reward} coins`);
        const got = p.achievements || {};
        const n = CW.ACHIEVEMENTS.filter((a) => got[a.id]).length;
        // not unlocked yet: how close you are ("9 / 10") with a bar
        const prog = (a) => {
          const { cur, goal } = CW.achProgress(a, this.game);
          const fmt = (v) => (a.unit === 's' ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : a.unit === 'lv' ? `level ${v}` : v);
          return `<div class="ach-prog"><div class="ach-bar"><i style="width:${Math.round((cur / goal) * 100)}%"></i></div><span>${fmt(cur)} / ${fmt(goal)}</span></div>`;
        };
        body.innerHTML = `<div class="small">${n} / ${CW.ACHIEVEMENTS.length} unlocked. Each one pays coins.</div><div class="ach-grid">${CW.ACHIEVEMENTS.map((a) => `<div class="ach ${got[a.id] ? 'got' : ''}"><b>${got[a.id] ? '🏆' : '🔒'} ${a.name}</b><span class="small">${a.desc}</span>${got[a.id] ? '' : prog(a)}<div class="small">+${a.reward} 🪙</div></div>`).join('')}</div>`;
      } else if (k === 'news') {
        body.innerHTML = `<ul class="news">
          <li><b>v1.8.4</b>: ✏ Change your username in your profile (once a week; friends, clubs and messages keep working). 📱 Phones: a clear ☰ Menu button in matches, the phone's Back button opens the menu (and goes back a screen in menus), and "Back to Workshop" in a test drive can be tapped again.</li>
          <li><b>v1.8.3</b>: 🪟 Ready for the Microsoft Store. In the Windows app, ✉ Email us (Settings › Support) now opens your email app.</li>
          <li><b>v1.8.2</b>: 🛒 New in the Shop: <b>mech finishes</b> (Carbon Fiber, Stealth Matte, Mirror Chrome, Neon Glow, Gold Plated, Rainbow Shift) and <b>wreck effects</b> (Confetti, Pixel Burst, Fireworks, Thunderstrike, Black Hole). 🏅 Ranked opens at 100 trophies. 🔧 Repairing is much faster: even a huge mech is rebuilt in about 4 seconds. ✈ While flying the screen shows how to climb (Space) and fly down (C). 🏋 Heavy mechs are much less slow. 🌲 New trees (pines, leafy trees, palms, cacti, burnt trees) and craggy rocks; soft glowing sparks and smoke instead of solid balls; only the part you hit flashes. 💬 T opens and closes the chat. ✉ Settings › Support and Help: contact us. Fixed: getting out next to a cliff or walking under a bridge could put you on top of it, and pilots could run up steep mountains and their own mech.</li>
          <li><b>v1.8.1</b>: 🖼 The Workshop part list shows a small 3D picture of every part. Name tags and health bars now sit exactly on their mech at any distance (they drifted on big screens).</li>
          <li><b>v1.8.0</b>: 🏎 Mechs drive like cars: A/D steer (front wheels turn, small taps = small corrections), S brakes, and letting go of A/D keeps your aim exactly where it is. 🔩 750 Bolts to build with. New <b>Body</b> parts (Car Body, Flat Panel, Nose, Cabin, Fender, Spoiler, Headlights, Exhaust), real-looking wheels and monster-truck <b>Big Wheels</b>. New example mechs: Monster Truck and Street Racer. Small tracer bullets with a real gunshot sound, parts that break off and fly, wrecks that fall apart and then explode. A calmer Workshop and smoother menus.</li>
          <li><b>v1.7.5</b>: 🎓 A clearer tutorial: a small see-through card with the keys to press (they light up), and a big arrow pointing at what to do next: the Target, the gem, your mech, or the button to tap on a phone.</li>
          <li><b>v1.7.4</b>: 🧹 A chat filter: bad words (also when hidden with spaces or numbers) become ****, and links, emails and phone numbers are hidden. Club pictures show on the clubs leaderboard, profile pictures are always 256×256, and chat you've read stays read after restarting.</li>
          <li><b>v1.7.3</b>: 👤 Play right away without an account: logging in is optional again. Guests keep their progress on their device; log in to keep it everywhere and get trophies, friends, clubs and voice chat.</li>
          <li><b>v1.7.2</b>: 🔊 Voice chat in matches comes from where that player is: quieter far away, left or right, all around (louder voice volume too). 💬 Chat and 🎤 voice while you wait for a match, and the 💬 button works during matches on phones. Drag ⠿ to put the chat anywhere; type to your party right on the party card; on phones the chat opens full screen (☰ Menu goes back). Newest messages sit at the bottom.</li>
          <li><b>v1.7.1</b>: 📷 Use <b>your own picture</b> as your profile picture (Profile), and club owners can give their club one. 💬 Message friends and club members straight from their lists, open the chat with <b>T</b>, and the chat is now small and see-through (on phones it turns upright while you type in the menu). 🎤 The microphone is only used in a party or a match, 🎧 deafen with N, and every voice key can be turned off. 🎟 Drag the Cog Pass with the mouse, and tap "how to tier up" to go there. Friends' and club messages are deleted after a week.</li>
          <li><b>v1.7</b>: 💬 <b>Chat</b> (💬 or Enter): type to your friends, party and club, in the lobby and during matches. Matches use quick chat. Tap a name to block or report a player.</li>
          <li>🎤 <b>Voice chat</b> with your party and your match: open mic or push-to-talk (B), mute with M or 🎤, pick your microphone and speakers, and choose who you hear (Settings › Voice chat).</li>
          <li>🧒 <b>Quick chat only</b> (Settings › Chat): ready-made messages only and no voice chat, saved on your account.</li>
          <li>🔐 <b>Sign up with Google</b>: your browser opens, you pick your Google account and choose a username. No password or email code.</li>
          <li>🏆 Achievements show how close you are (like 9 / 10 wins). Text in menus can't be selected by accident anymore. Phones: tapping outside a menu just closes it.</li>
          <li><b>v1.6.5</b>: 🎟 A new full-screen Cog Pass: your tier, how to earn points and a track of rewards you scroll sideways, with Claim all. ⚙ Settings is a full screen with a button for each category. 🛒 Click anywhere on a Shop item to buy it, after a quick "Buy it?" check. Buttons no longer show hover text.</li>
          <li><b>v1.6.4</b>: Quick chat no longer shows your own messages twice; settings rows turn gray-blue when you point at them; on phones News lines up on the right.</li>
          <li><b>v1.6.3</b>: Settings rows turn blue when you point at them instead of showing a big outline.</li>
          <li><b>v1.6.2</b>: 📱 Phones: new button layout (fire, super, gadget and dash for your right thumb, up and down next to the stick, the rest in the bottom row), hold 🚪 to get out of your mech, aim assist (Settings), and the lobby and party card fit small screens. Mechs no longer pop onto walls, the camera stays out of walls, and Esc closes the Workshop.</li>
          <li><b>v1.6.1</b>: Sign up asks for your email (one account per email), a password twice and a username, all in one step.</li>
          <li><b>v1.6</b>: 👁 Watch your friends' matches from the Friends list (they see who's watching).</li>
          <li>🎉 Your party's mechs stand next to yours in the lobby, and while you wait for a match the players who join drop in on the stage.</li>
          <li>📧 Sign up with your email, a code and a password; log in with email and password; forgot it? Get a code.</li>
          <li>🧭 A tidier lobby: 5 buttons on each side, the Cog Pass bar above your challenge, stats in your Profile, and a cyan outline on anything you can click.</li>
          <li><b>v1.5</b>: 📧 Log in with your email (a 6-digit code) or with Google. Old username and password accounts still work and can add an email in Profile.</li>
          <li>🎨 Calmer menus: one dark-blue look, plain buttons, quieter titles, a dark-cyan PLAY button and dark text boxes. Press Esc to close any menu.</li>
          <li>⚖ The server now referees online matches: impossible damage is thrown away, and players caught cheating get nothing from that match.</li>
          <li>📱 Phones: lighter touch controls, vibration (Settings), and nothing covering the buttons.</li>
          <li><b>v1.4</b>: 🎨 A cleaner, lighter menu: one color scheme, smaller buttons, PLAY in the corner, a see-through match HUD and a full-screen Shop (your daily gift is in there now).</li>
          <li>🎯 6 daily challenges (tap the challenge card to see them all), and bots aim like people now instead of never missing.</li>
          <li>🔒 Your coins, XP, unlocks and Shop are kept on the server even without an account, and mechs in online matches are checked, so nobody can cheat their way ahead.</li>
          <li><b>v1.3</b>: 🎟 <b>Cog Pass</b>: a free 30-tier reward track every 4 weeks, with paints, trails and avatars you can't buy. Earn pass points from matches, challenges and the daily gift.</li>
          <li>🛡 <b>Clubs</b>: start or join a club of up to 30 players, add up your trophies together and cheer each other on the club wall.</li>
          <li>🧰 <b>Gadgets</b>: Repair Kit, Proximity Mine, Jump Jets or Smoke Screen, 3 uses a match (G / 🧰). Pick yours in the PLAY panel.</li>
          <li>🎯 New mode <b>Bounty Hunt</b> and new arena <b>🏗 Scrap Yard</b>.</li>
          <li>🗓 <b>Weekly events</b> with a twist (low gravity, double damage, fast supers…) and +50% coins. 🏅 <b>Ranked</b> unlocks at 600 trophies (100 since v1.8.2): 3v3 for ranked points each season.</li>
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
        body.innerHTML = `${this.supportHtml()}
          <div class="howto">
          <div><h3>🎯 Goal</h3><p>Build a mech, fight, and be the last pilot (or team) standing. A wrecked mech ejects its pilot: you can still fight on foot!</p></div>
          <div><h3>🎮 Mech controls</h3><p><b>W</b> drive · <b>S</b> brake / reverse · <b>A/D</b> steer · <b>Mouse</b> aim · <b>Click</b> fire<br><b>Shift</b> DASH (with A/D on Legs = sidestep) · Flying: hold <b>Space</b> to climb, <b>C</b> (or Q / Ctrl) to fly down · <b>Space</b> = jump on Legs<br><b>E</b> exit mech · <b>V</b> switch camera · <b>F</b> unstuck · <b>Tab</b> scores · <b>Esc</b> pause</p></div>
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
          <div><h3>🎟 Cog Pass, clubs, Ranked</h3><p>Every match earns <b>Cog Pass</b> points for free rewards. Join a <b>club</b> to team up. At ${E.RANKED.unlockAt} trophies <b>Ranked</b> opens: 3v3 for ranked points that reset each season.</p></div>
          <div><h3>💰 Progress</h3><p>Matches give XP and coins. Daily challenges and the daily reward give more. Spend coins in the Shop on paints and dash trails.</p></div>
          <div><h3>⚡ Sudden death</h3><p>After 4 minutes all cores overheat, so no match lasts forever.</p></div>
          </div>`;
        this.bindSupport(body);
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
        return `<button class="mode-opt gad-opt ${(this.settings.gadget || 'repair') === id ? 'on' : ''} ${locked ? 'locked' : ''}" data-gadget="${id}" ${locked ? 'disabled' : ''} aria-label="${gd.desc}"><span>${gd.icon}</span><b>${gd.name}</b><small>${locked ? `🔒 Level ${gd.level}` : gd.desc}</small></button>`;
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
        if (!canRanked) return g.toast(g.account.loggedIn ? `🏅 Ranked unlocks at ${E.RANKED.unlockAt} trophies` : `Log in and reach ${E.RANKED.unlockAt} trophies to play Ranked`);
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
    // the voice chat and chat keys: the key, or 'none' when turned off
    optKey(id) {
      const k = this.settings[id];
      return k === undefined || k === '' ? OPT_KEYS[id] : k;
    }
    // Settings > Voice chat / Chat: change one of those keys (Esc cancels; Backspace or Delete = no key)
    listenVoiceKey(btn) {
      const s = this.settings, id = btn.dataset.vkey;
      btn.textContent = 'Press a key…';
      btn.classList.add('on');
      const done = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.removeEventListener('keydown', done, true);
        if (e.code === 'Backspace' || e.code === 'Delete') s[id] = 'none';
        else if (e.code !== 'Escape') {
          // another of these keys had it: they swap
          for (const other of Object.keys(OPT_KEYS)) if (other !== id && this.optKey(other) === e.code) s[other] = this.optKey(id);
          s[id] = e.code;
          const clash = CW.KEY_ACTIONS.find((a) => ((s.keys || {})[a.id] || a.def) === e.code);
          if (clash) this.game.toast(`${CW.keyName(e.code)} is also "${clash.label}"`);
        }
        this.apply();
        this.renderPanel();
      };
      window.addEventListener('keydown', done, true);
    }
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
      $('confirmNo').onclick = () => g.meta.closeConfirm();
      CW.tapOutside($('confirm'), () => g.meta.closeConfirm());
      $('btnSettings').onclick = () => g.meta.openPanel('settings');
      $('btnHowto').onclick = () => g.meta.openPanel('howto');
      $('btnAch').onclick = () => g.meta.openPanel('ach');
      $('btnNews').onclick = () => g.meta.openPanel('news');
      $('btnRanks').onclick = () => g.meta.openPanel('ranks');
      $('coinChip').onclick = () => g.meta.openPanel('shop');
      $('pName').onchange = (e) => { g.profile.name = e.target.value.trim().slice(0, 16); g.saveProfile(); };
      $('panelClose').onclick = () => g.meta.closePanel();
      // tap/click outside the panel closes it, like most games and apps
      CW.tapOutside($('panel'), () => g.meta.closePanel());
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
