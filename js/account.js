// Cogwild — player accounts (username + password), cloud save, profile, friends, party, trophies.
//
// The server keeps accounts, friends, parties and trophies (server/accounts.js). Progress (level, coins,
// unlocks, blueprints) still lives in this browser and is backed up to the account: the newest copy wins.
// Without an account everything still works as a guest; trophies, friends and parties need one.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const keep = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  // the first 24 avatars are free; 24+ come from the Shop and the Trophy Road
  CW.AVATARS = ['🤖', '🦆', '🐸', '🦊', '🐼', '🐯', '🐙', '🦖', '👾', '🐵', '🐧', '🦁', '🐲', '🦉', '🐺', '🐱', '🐶', '🐻', '🦄', '🐝', '🐢', '🦈', '👽', '🎃',
    '🐉', '🦅', '🦂', '🐊', '🦍', '🦓', '🦩', '🦚', '🐳', '🦑', '🐞', '🦔', '🤠', '🥷', '🧙', '👑',
    '🛸', '🦾', '⚡', '🌋', '🪐', '🏴‍☠️', '🧊', '🎯']; // 40+: Cog Pass
  CW.FREE_AVATARS = 24;
  CW.avatar = (i) => CW.AVATARS[i] || '🧑‍✈️';
  // trophy tiers shown on profiles and the leaderboard
  CW.TIERS = [
    { at: 0, name: 'Bronze', icon: '🥉' }, { at: 100, name: 'Silver', icon: '🥈' }, { at: 300, name: 'Gold', icon: '🥇' },
    { at: 600, name: 'Platinum', icon: '💠' }, { at: 1000, name: 'Diamond', icon: '💎' }, { at: 1500, name: 'Master', icon: '👑' }, { at: 2500, name: 'Legend', icon: '🔥' },
    { at: 4000, name: 'Mythic', icon: '🌟' }, { at: 6000, name: 'Titan', icon: '🗿' }, { at: 10000, name: 'Cogmaster', icon: '⚙' },
  ];
  CW.tier = (t) => CW.TIERS.filter((x) => (t | 0) >= x.at).pop();
  // the Trophy Road (CW.ROAD) lives in js/economy.js, shared with the server
  const STATUS = { menu: '🟢 In the menu', lobby: '🟡 In a room', match: '🔴 In a match', solo: '🟠 Playing solo' };
  const SYNC_DELAY = 4000;

  class Account {
    constructor(game) {
      this.game = game;
      this.session = load('cogwild.session', null); // { token, name }
      this.sync = load('cogwild.sync', {}); // { user, at, dirty }
      this.me = null; // public card from the server while logged in
      this.friends = [];
      this.reqIn = [];
      this.reqOut = [];
      this.party = null;
      this.lastTro = null;
      this.lbTab = 'global';
      this.bindUi();
      this.renderChips();
      // already logged in on this device: connect right away so friends see you online
      if (this.session) setTimeout(() => this.connect(), 300);
      setInterval(() => this.watchStatus(), 1000);
    }

    get loggedIn() { return !!this.me; }
    get net() { return this.game.net; }
    connect() { if (this.net.canConnect()) this.net.connect().catch(() => {}); }

    // ======================= from the net layer =======================
    onWelcome() { if (this.session) this.net.send({ t: 'acctAuth', token: this.session.token }); }
    onDisconnect() {
      const was = this.loggedIn;
      this.me = null;
      this.friends = [];
      this.party = null;
      this.renderChips();
      // stay connected while logged in: retry with a growing pause
      if (this.session) {
        this.retry = Math.min(60000, (this.retry || 2500) * 1.6);
        clearTimeout(this.retryT);
        this.retryT = setTimeout(() => this.connect(), this.retry);
        if (was) this.game.toast('📡 Reconnecting to your account…');
      }
    }
    onMessage(m) {
      const g = this.game;
      switch (m.t) {
        case 'acctOk': this.onLogin(m); break;
        case 'acctOut':
          if (this.session) { this.session = null; keep('cogwild.session', null); }
          this.me = null;
          this.renderChips();
          if (m.reason) g.toast('👤 ' + m.reason);
          break;
        case 'acctErr':
          if ($('acctErr') && !$('acct').classList.contains('hidden')) { $('acctErr').textContent = m.msg; this.busy(false); }
          else g.toast('⚠ ' + m.msg);
          break;
        case 'acctMe': this.me = m.me; this.renderChips(); this.rerender(); break;
        case 'wallet': this.onWallet(m); break;
        case 'acctPassOk':
          this.session.token = m.token;
          keep('cogwild.session', this.session);
          g.toast('🔑 Password changed. Other devices were logged out.');
          break;
        case 'saved':
          this.sync = { user: this.me ? this.me.name.toLowerCase() : this.sync.user, at: m.at, dirty: false };
          keep('cogwild.sync', this.sync);
          if (this.onSaved) { this.onSaved(); this.onSaved = null; }
          break;
        case 'friends': {
          const before = this.friends;
          this.friends = m.list;
          this.reqIn = m.reqIn;
          this.reqOut = m.reqOut;
          // a friend just came online
          if (g.settings.friendOnline !== false) for (const f of m.list) { const o = before.find((x) => x.name === f.name); if (o && !o.on && f.on) this.note(`${CW.avatar(f.av)} ${esc(f.name)} is online`); }
          this.renderChips();
          this.rerender();
          break;
        }
        case 'party': this.party = m.party; this.renderParty(); this.rerender(); break;
        case 'note': this.onNote(m); break;
        case 'trophies': this.onTrophies(m); break;
        case 'top': this.top = m; this.rerender(); break;
        case 'profile': this.viewing = m.p; if (this.game.meta.panel === 'player') this.game.meta.renderPanel(); else this.game.meta.openPanel('player'); break;
      }
    }

    // ======================= login, sync =======================
    onLogin(m) {
      const g = this.game;
      this.me = m.me;
      this.retry = 0;
      this.session = { token: m.token, name: m.me.name };
      keep('cogwild.session', this.session);
      g.profile.name = m.me.name;
      this.net.name = m.me.name;
      $('acct').classList.add('hidden');
      const user = m.me.name.toLowerCase();
      if (m.wallet && !m.wallet.fresh) this.applyWallet(m.wallet);
      const server = m.save;
      // which copy of the progress wins: the newest one
      const sameUser = this.sync.user === user;
      if (sameUser && this.sync.dirty) this.push(); // played on this device since the last backup
      else if (server && (!sameUser || server.at > (this.sync.at || 0))) return this.applySave(server, user);
      else if (!server) this.push(); // a new account takes the guest progress from this device
      else g.saveProfile();
      this.renderChips();
      this.renderParty();
      this.rerender();
      if (this.welcomeToast) { g.toast(this.welcomeToast); this.welcomeToast = null; }
      this.net.send({ t: 'profileSet', lv: g.level() });
      this.watchStatus(true);
    }
    // replace this device's progress with the account's and restart the game with it
    applySave(server, user) {
      const d = server.data || {};
      if (d.profile) keep('cogwild.profile', d.profile);
      keep('cogwild.blueprints', d.blueprints || []);
      if (d.current) keep('cogwild.current', d.current);
      this.sync = { user, at: server.at, dirty: false };
      keep('cogwild.sync', this.sync);
      this.game.toast('☁ Loading your account\'s progress…');
      setTimeout(() => location.reload(), 600);
    }
    // the game saved something: back it up to the account a few seconds later
    markDirty() {
      if (this.applying) return;
      this.sync.dirty = true;
      if (this.me) this.sync.user = this.me.name.toLowerCase();
      keep('cogwild.sync', this.sync);
      clearTimeout(this.pushT);
      if (this.loggedIn) this.pushT = setTimeout(() => this.push(), SYNC_DELAY);
    }
    push() {
      if (!this.loggedIn) return;
      const g = this.game;
      clearTimeout(this.pushT);
      this.net.send({ t: 'save', data: { profile: g.profile, blueprints: g.blueprints, current: g.currentBp }, lv: g.level() });
    }
    logout() {
      const g = this.game;
      const finish = () => {
        this.net.send({ t: 'acctLogout' });
        this.session = null;
        keep('cogwild.session', null);
        // this device goes back to a fresh guest (your progress stays in the account), settings stay
        const settings = g.profile.settings;
        keep('cogwild.profile', { xp: 0, settings });
        keep('cogwild.blueprints', []);
        keep('cogwild.current', null);
        keep('cogwild.sync', {});
        g.toast('👋 Logged out');
        setTimeout(() => location.reload(), 500);
      };
      if (this.loggedIn && this.sync.dirty) { this.onSaved = finish; this.push(); setTimeout(() => { if (this.onSaved) { this.onSaved = null; finish(); } }, 2500); }
      else finish();
    }
    // tell friends whether you're busy playing alone (party leaders don't pull you into rooms then)
    watchStatus(force) {
      if (!this.loggedIn) return;
      const g = this.game;
      const busy = !this.net.room && ['match', 'workshop', 'results', 'picker', 'modes'].includes(g.state);
      if (force || busy !== this.lastBusy) { this.lastBusy = busy; this.net.send({ t: 'status', busy }); }
    }

    // ======================= login screen =======================
    bindUi() {
      const g = this.game;
      $('acctChip').onclick = () => (this.loggedIn ? g.meta.openPanel('profile') : this.openLogin());
      $('btnProfile').onclick = () => (this.loggedIn ? g.meta.openPanel('profile') : this.openLogin('Log in to get a profile, trophies and friends'));
      $('btnFriends').onclick = () => (this.loggedIn ? g.meta.openPanel('friends') : this.openLogin('Log in to add friends and make a party'));
      $('btnRoad').onclick = () => g.meta.openPanel('road');
      $('btnPass').onclick = () => g.meta.openPanel('pass');
      $('btnClubs').onclick = () => (this.loggedIn ? (g.meta.openPanel('clubs'), this.net.send({ t: 'clubInfo' })) : this.openLogin('Log in to join a club'));
      $('roadBar').onclick = () => (this.loggedIn ? g.meta.openPanel('road') : this.openLogin('Log in to earn trophies and unlock the Trophy Road'));
      $('btnTop').onclick = () => { g.meta.openPanel('top'); this.net.send({ t: 'top' }); };
      $('acctTabLogin').onclick = () => this.loginTab('login');
      $('acctTabSign').onclick = () => this.loginTab('sign');
      $('acctGuest').onclick = () => $('acct').classList.add('hidden');
      $('acct').addEventListener('pointerdown', (e) => { if (e.target === $('acct')) $('acct').classList.add('hidden'); });
      $('acctForm').onsubmit = (e) => { e.preventDefault(); this.submitLogin(); };
      $('acctShow').onchange = (e) => { const t = e.target.checked ? 'text' : 'password'; $('acctPass').type = t; $('acctPass2').type = t; };
    }
    openLogin(why) {
      if (!this.net.canConnect()) return this.game.toast('Accounts need the game to be opened from its web address');
      $('acct').classList.remove('hidden');
      $('acctWhy').textContent = why || 'Save your progress in the cloud, earn trophies and play with friends.';
      $('acctErr').textContent = '';
      this.loginTab(this.tab || 'sign');
      this.busy(false);
      setTimeout(() => $('acctName').focus(), 50);
    }
    loginTab(tab) {
      this.tab = tab;
      const sign = tab === 'sign';
      $('acctTabLogin').classList.toggle('on', !sign);
      $('acctTabSign').classList.toggle('on', sign);
      $('acctPass2Row').classList.toggle('hidden', !sign);
      $('acctGo').textContent = sign ? '✨ Create account' : '▶ Log in';
      $('acctPass').autocomplete = sign ? 'new-password' : 'current-password';
      $('acctHint').textContent = sign ? 'Usernames: 3-16 letters, numbers or _ (not your real name). Pick a password you don\'t use anywhere else. There is no email, so remember it!' : '';
      $('acctAgree').classList.toggle('hidden', !sign);
      $('acctErr').textContent = '';
    }
    busy(on) { $('acctGo').disabled = on; $('acctGo').classList.toggle('dim', on); }
    async submitLogin() {
      const name = $('acctName').value.trim(), pass = $('acctPass').value;
      const sign = this.tab === 'sign';
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return ($('acctErr').textContent = 'Usernames are 3-16 letters, numbers or _');
      if (pass.length < 6) return ($('acctErr').textContent = 'Passwords need at least 6 characters');
      if (sign && pass !== $('acctPass2').value) return ($('acctErr').textContent = "The two passwords don't match");
      this.busy(true);
      $('acctErr').textContent = 'Connecting…';
      try { await this.net.connect(); } catch (e) { this.busy(false); $('acctErr').textContent = "Can't reach the server. Check your internet."; return; }
      $('acctErr').textContent = '';
      this.welcomeToast = sign ? `🎉 Welcome to Cogwild, ${name}!` : `👋 Welcome back, ${name}!`;
      this.net.send({ t: sign ? 'acctRegister' : 'acctLogin', name, pass });
      $('acctPass').value = '';
      $('acctPass2').value = '';
    }

    // ======================= menu chips + party bar + notes =======================
    renderChips() {
      const g = this.game;
      const me = this.me;
      $('acctChip').innerHTML = me ? `<span class="av">${CW.avatar(me.av)}</span><b>${esc(me.name)}</b>` : '👤 <b>Log in</b>';
      $('acctChip').classList.toggle('guest', !me);
      $('pName').parentElement.classList.toggle('hidden', !!me);
      // top bar: trophies and the way to the next Trophy Road reward
      const best = me ? me.best | 0 : 0;
      const next = CW.ROAD.find((r) => r.at > best);
      const prev = CW.ROAD.filter((r) => r.at <= best).pop();
      $('pTro').textContent = me ? me.tro : '—';
      $('rbFill').style.width = (me && next ? Math.round(((best - (prev ? prev.at : 0)) / (next.at - (prev ? prev.at : 0))) * 100) : me ? 100 : 0) + '%';
      $('rbNext').textContent = !me ? 'Log in for trophies' : this.roadReady() ? '🎁 Reward ready!' : next ? `Next reward: ${next.at}` : 'Road complete!';
      $('roadBar').classList.toggle('ready', !!(me && this.roadReady()));
      const online = this.friends.filter((f) => f.on).length;
      const req = this.reqIn.length;
      $('badgeFriends').textContent = req || online;
      $('badgeFriends').classList.toggle('hidden', !(req || online));
      $('badgeFriends').classList.toggle('calm', !req);
      const pass = this.passReady();
      $('badgePass').textContent = pass;
      $('badgePass').classList.toggle('hidden', !pass);
      const road = this.roadReady();
      $('badgeRoad').textContent = road;
      $('badgeRoad').classList.toggle('hidden', !road);
      if (g.state === 'menu') g.meta.renderMenu();
    }
    renderParty() {
      const bar = $('partyBar');
      const p = this.party;
      bar.classList.toggle('hidden', !p);
      if (!p) return;
      const lead = this.me && p.leader === this.me.name;
      bar.innerHTML = `<h3>🎉 Party (${p.members.length}/4)</h3><div class="party-row">${p.members.map((f) => `<span class="party-m ${f.name === p.leader ? 'lead' : ''}" title="${esc(f.name)}${f.name === p.leader ? ' (leader)' : ''}">${CW.avatar(f.av)}<small>${esc(f.name)}</small></span>`).join('')}</div>
        <div class="small">${lead ? 'You lead: press PLAY and your party comes with you.' : `${esc(p.leader)} picks the match. You'll follow them in.`}</div>
        <div class="menu-btns" style="justify-content:flex-start;margin-top:6px">${lead ? '<button class="ws-btn on" id="partyQuick">▶ Play together</button>' : ''}<button class="ws-btn" id="partyLeave">Leave party</button></div>`;
      $('partyLeave').onclick = () => this.net.send({ t: 'partyLeave' });
      if (lead) $('partyQuick').onclick = () => this.game.play();
    }
    // a little card in the corner, optionally with buttons [{ label, fn }]
    note(html, buttons, ms) {
      const box = $('notes');
      const el = document.createElement('div');
      el.className = 'note';
      el.innerHTML = `<div>${html}</div>`;
      if (buttons) {
        const row = document.createElement('div');
        row.className = 'note-btns';
        for (const b of buttons) {
          const btn = document.createElement('button');
          btn.className = 'ws-btn' + (b.main ? ' on' : '');
          btn.textContent = b.label;
          btn.onclick = () => { el.remove(); if (b.fn) b.fn(); };
          row.appendChild(btn);
        }
        el.appendChild(row);
      }
      box.appendChild(el);
      while (box.children.length > 4) box.firstChild.remove();
      setTimeout(() => el.remove(), ms || (buttons ? 25000 : 5000));
      this.game.audio.click(1.2);
    }
    onNote(m) {
      const g = this.game;
      if (m.kind === 'info') return this.note(esc(m.msg));
      if (m.kind === 'friendReq') return this.note(`👋 <b>${esc(m.from)}</b> wants to be friends`, [{ label: 'Accept', main: true, fn: () => this.net.send({ t: 'friendAccept', name: m.from }) }, { label: 'Later' }]);
      if (m.kind === 'partyInvite') return this.note(`🎉 <b>${esc(m.from)}</b> invited you to their party`, [{ label: 'Join party', main: true, fn: () => this.net.send({ t: 'partyAccept', from: m.from }) }, { label: 'No thanks' }]);
      if (m.kind === 'roomInvite') {
        return this.note(`🌐 <b>${esc(m.from)}</b> invited you to their room`, [{
          label: 'Join', main: true,
          fn: () => { if (g.state === 'match' && !g.net.active) g.endMatch(); g.net.openOnline(m.code); },
        }, { label: 'No thanks' }]);
      }
    }
    onTrophies(m) {
      this.lastTro = m;
      if (this.me) { this.me.tro = m.tro; this.me.best = m.best; }
      const sign = m.d > 0 ? '+' : '';
      this.game.toast(`🏆 ${sign}${m.d} trophies · ${m.tro} total${m.streak > 1 ? ` · 🔥 ${m.streak} win streak` : ''}`);
      this.renderChips();
      this.resultsLine();
    }
    // the trophy line on the results screen (the result can arrive just before or after it opens)
    resultsLine() {
      const el = $('resTrophy');
      if (!el) return;
      const m = this.lastTro;
      const g = this.game;
      if (!m || g.state !== 'results' || !g.net.room || !g.net.room.auto) { el.innerHTML = ''; return; }
      const up = m.d > 0;
      el.innerHTML = `${m.featured && up ? '<span class="tro-feat">⭐ Featured +50%</span> ' : ''}<span class="tro-pop ${up ? 'up' : m.d < 0 ? 'down' : ''}">🏆 ${up ? '+' : ''}${m.d}</span> <span class="small">${m.tro} trophies · ${CW.tier(m.tro).icon} ${CW.tier(m.tro).name}${m.streak > 1 ? ` · 🔥 ${m.streak} win streak` : ''}</span>`;
      const road = this.roadReady();
      if (road) el.innerHTML += ` <button class="ws-btn on" id="resRoad">🎁 Trophy Road reward ready!</button>`;
      if (road) $('resRoad').onclick = () => g.meta.openPanel('road');
    }
    onResults() {
      const g = this.game;
      if (!g.net.active) this.lastTro = null;
      this.resultsLine();
      if (!this.loggedIn && g.net.room && g.net.room.auto) $('resTrophy').innerHTML = '<span class="small">🏆 Log in to earn trophies</span>';
    }

    // ======================= wallet: coins and unlocks kept by the server =======================
    applyWallet(w) {
      const p = this.game.profile;
      this.wallet = w;
      p.coins = w.coins;
      p.owned = { paints: w.owned.paints.slice(), trails: w.owned.trails.slice(), avatars: w.owned.avatars.slice() };
      if (!p.owned.trails.includes(p.trail)) p.trail = 'spark';
      p.road = w.road.slice();
      p.dailyClaimed = w.gift.day;
      p.dailyStreak = w.gift.streak;
      p.pass = w.pass;
      keep('cogwild.profile', p); // not a change to back up: it came from the server
    }
    onWallet(m) {
      const g = this.game;
      this.applyWallet(m.w);
      if (m.bought) g.meta.afterBuy(m.bought.kind, m.bought.id);
      if (m.gift) g.meta.giftToast(m.gift);
      if (m.road || m.pass) {
        const what = this.rewardText(Object.assign({ coins: m.reward.coins }, ...m.reward.got.map((x) => ({ [x.kind]: x.id }))));
        g.audio.fanfare();
        g.toast(`🎁 ${m.road ? 'Trophy Road' : 'Cog Pass'}: ${what || 'claimed'}!`);
        g.workshop.buildPaint();
      }
      if (m.src === 'match' && m.pts && g.state === 'results') $('resPass').textContent = `🎟 +${m.pts} Cog Pass points`;
      this.renderChips();
      if (g.state === 'menu') g.meta.renderMenu();
      if (!$('panel').classList.contains('hidden') && ['shop', 'road', 'pass', 'profile'].includes(g.meta.panel)) g.meta.renderPanel();
      $('pCoins').textContent = g.profile.coins;
    }

    // ======================= Cog Pass: 30 free tiers each 4-week season (js/economy.js) =======================
    passReady() {
      const w = this.wallet;
      if (!this.loggedIn || !w) return 0;
      return CW.ECON.passRewards(w.pass.s).filter((r) => r.at <= w.pass.pts && !w.pass.claimed.includes(r.tier)).length;
    }
    passPanel(body) {
      const E = CW.ECON, g = this.game;
      const ss = E.season();
      if (!this.loggedIn || !this.wallet) {
        body.innerHTML = `<div class="small">The Cog Pass is a free reward track that starts over every 4 weeks, with paints, trails and avatars you can't buy in the Shop. Log in to start earning pass points.</div><button class="ws-btn on" id="passLogin">👤 Log in or sign up</button>`;
        $('passLogin').onclick = () => { g.meta.closePanel(); this.openLogin('Log in to play the Cog Pass'); };
        return;
      }
      const ps = this.wallet.pass;
      const list = E.passRewards(ps.s);
      const tier = Math.min(E.PASS.tiers, Math.floor(ps.pts / E.PASS.perTier));
      const into = ps.pts - tier * E.PASS.perTier;
      const look = (r) => {
        const it = r.paints ? ['paints', r.paints] : r.trails ? ['trails', r.trails] : r.avatars ? ['avatars', r.avatars] : null;
        if (!it) return `🪙 ${r.coins}`;
        const x = E.item(it[0], it[1]);
        const pic = it[0] === 'paints' ? `<div class="swatch tex" style="background:#${x.color.toString(16).padStart(6, '0')} url(${CW.texURL('panel')}) center/160% auto;background-blend-mode:multiply"></div>`
          : it[0] === 'trails' ? `<div class="swatch trail" style="background:linear-gradient(90deg,${x.colors.map((c) => '#' + c.toString(16).padStart(6, '0')).join(',')})"></div>` : `<span style="font-size:30px">${CW.avatar(x.idx)}</span>`;
        return `${pic}<small>${x.name}${r.coins ? ` + 🪙${r.coins}` : ''}</small>`;
      };
      body.innerHTML = `<div class="pass-head"><b>🎟 Season ${ps.s}</b><span class="small">ends in ${CW.timeLeft(ss.end - Date.now())}</span>
          <div class="ch-bar" title="${into} / ${E.PASS.perTier}"><i style="width:${tier >= E.PASS.tiers ? 100 : Math.round((into / E.PASS.perTier) * 100)}%"></i></div><b>Tier ${tier} / ${E.PASS.tiers}</b></div>
        <div class="small">Earn pass points: up to ${E.PASS.match} per match (more for winning, featured and weekly events), ${E.PASS.challenge} per daily challenge and ${E.PASS.gift} for the daily gift. You have <b>${ps.pts}</b>.</div>
        <div class="pass-track">${list.map((r) => {
          const reached = ps.pts >= r.at, claimed = ps.claimed.includes(r.tier);
          return `<div class="pass-tier ${reached ? 'reached' : ''} ${claimed ? 'claimed' : ''} ${r.tier % 5 === 0 ? 'big' : ''}"><span class="tier-n">Tier ${r.tier}</span><div class="tier-r">${look(r)}</div>${claimed ? '<span class="owned">✔</span>' : reached ? `<button class="ws-btn on" data-tier="${r.tier}">Claim!</button>` : '<span class="small">🔒</span>'}</div>`;
        }).join('')}</div>`;
      body.querySelectorAll('[data-tier]').forEach((b) => (b.onclick = () => { b.disabled = true; this.net.send({ t: 'passClaim', tier: +b.dataset.tier }); }));
    }

    // ======================= Trophy Road =======================
    roadClaimed() { return this.game.profile.road || []; }
    roadReady() {
      const best = this.me ? this.me.best | 0 : 0;
      const got = this.roadClaimed();
      return CW.ROAD.filter((r) => r.at <= best && !got.includes(r.at)).length;
    }
    rewardText(r) {
      const parts = [];
      const paint = (r.paint || r.paints) && CW.SHOP.paints.find((x) => x.id === (r.paint || r.paints));
      const trail = (r.trail || r.trails) && CW.SHOP.trails.find((x) => x.id === (r.trail || r.trails));
      const avatar = (r.avatar || r.avatars) && CW.SHOP.avatars.find((x) => x.id === (r.avatar || r.avatars));
      if (paint) parts.push(`🎨 ${paint.name} paint`);
      if (trail) parts.push(`✨ ${trail.name} trail`);
      if (avatar) parts.push(`${CW.avatar(avatar.idx)} ${avatar.name} avatar`);
      if (r.coins) parts.push(`🪙 ${r.coins}`);
      return parts.join(' + ');
    }
    // the server checks your best trophies and pays (things you already own pay their price in coins)
    claimRoad(at) {
      const r = CW.ROAD.find((x) => x.at === at);
      if (!r || !this.me || this.me.best < at || this.roadClaimed().includes(at)) return;
      this.net.send({ t: 'roadClaim', at });
    }

    // ======================= panels (shown in the shared #panel) =======================
    rerender() { const k = this.game.meta.panel; if (!$('panel').classList.contains('hidden') && ['profile', 'friends', 'road', 'top', 'player'].includes(k)) this.game.meta.renderPanel(); }
    renderPanel(k, body) {
      if (k === 'profile') return this.profilePanel(body);
      if (k === 'friends') return this.friendsPanel(body);
      if (k === 'road') return this.roadPanel(body);
      if (k === 'top') return this.topPanel(body);
      if (k === 'player') return this.playerPanel(body);
    }
    card(p, extra) {
      const t = CW.tier(p.tro);
      return `<div class="prof-card"><div class="prof-av">${CW.avatar(p.av)}</div><div class="prof-main"><div class="prof-name">${esc(p.name)}</div>
        <div class="prof-tier">${t.icon} ${t.name} · 🏆 <b>${p.tro}</b> <span class="small">(best ${p.best})</span></div>
        <div class="small">⭐ Level ${p.lv || 1} · ${p.wins} Quick Match wins · ${p.played} played${extra || ''}</div></div></div>`;
    }
    profilePanel(body) {
      const g = this.game;
      if (!this.me) { body.innerHTML = '<div class="small">You are playing as a guest.</div><button class="btn" id="profLogin">👤 Log in or sign up</button>'; $('profLogin').onclick = () => { g.meta.closePanel(); this.openLogin(); }; return; }
      const me = this.me;
      const s = g.profile.stats;
      body.innerHTML = this.card(me) +
        `<h3>Pick your avatar</h3><div class="av-grid">${CW.AVATARS.map((a, i) => {
          const prem = CW.SHOP.avatars.find((x) => x.idx === i);
          const locked = prem && !g.profile.owned.avatars.includes(prem.id);
          return `<button class="av-btn ${i === me.av ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? 'data-shop="1" title="Unlock it in the Shop or on the Trophy Road"' : `data-av="${i}"`}>${a}${locked ? '<i>🔒</i>' : ''}</button>`;
        }).join('')}</div>
        <h3>Your numbers</h3><div class="stat-grid"><div><b>${s.matches}</b><span>Matches (all modes)</span></div><div><b>${s.wins}</b><span>Wins (all modes)</span></div><div><b>${s.wrecks}</b><span>Mechs wrecked</span></div><div><b>${Object.keys(g.profile.achievements || {}).length}/${CW.ACHIEVEMENTS.length}</b><span>Achievements</span></div></div>
        <h3>Account</h3>
        <div class="small">${this.sync.dirty ? '☁ Backing up your progress…' : '☁ Your progress is backed up to your account.'} Log in on any device (web, Windows or Android) to play with it.</div>
        <div class="menu-btns" style="justify-content:flex-start;margin-top:8px">
          <button class="ws-btn" id="profPass">🔑 Change password</button>
          <button class="ws-btn" id="profOut">🚪 Log out</button>
          <button class="ws-btn" id="profDel">🗑 Delete account…</button>
        </div>
        <form id="profPassForm" class="acct-mini hidden"><input type="password" id="ppOld" placeholder="Current password" autocomplete="current-password"><input type="password" id="ppNew" placeholder="New password (6+)" autocomplete="new-password"><button class="ws-btn on">Save new password</button><div class="small">Other devices will be logged out.</div></form>
        <form id="profDelForm" class="acct-mini hidden"><div class="small">This removes <b>${esc(me.name)}</b>, its trophies, friends and cloud backup <b>forever</b>.</div><input type="password" id="pdPass" placeholder="Your password" autocomplete="current-password"><button class="ws-btn bad">Delete my account</button></form>`;
      body.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => this.net.send({ t: 'profileSet', av: +b.dataset.av })));
      body.querySelectorAll('[data-shop]').forEach((b) => (b.onclick = () => g.meta.openPanel('shop')));
      $('profOut').onclick = () => this.logout();
      $('profPass').onclick = () => { $('profPassForm').classList.toggle('hidden'); $('ppOld').focus(); };
      $('profDel').onclick = () => { $('profDelForm').classList.toggle('hidden'); $('pdPass').focus(); };
      $('profPassForm').onsubmit = (e) => {
        e.preventDefault();
        if ($('ppNew').value.length < 6) return g.toast('New passwords need at least 6 characters');
        this.net.send({ t: 'acctPass', old: $('ppOld').value, pass: $('ppNew').value });
        $('profPassForm').reset();
        $('profPassForm').classList.add('hidden');
      };
      $('profDelForm').onsubmit = (e) => {
        e.preventDefault();
        if (!$('pdPass').value || !confirm(`Really delete ${me.name} forever?`)) return;
        this.net.send({ t: 'acctDelete', pass: $('pdPass').value });
        $('pdPass').value = '';
      };
    }
    playerPanel(body) {
      const p = this.viewing;
      if (!p) { body.innerHTML = '<div class="small">Loading…</div>'; return; }
      const isFriend = this.friends.some((f) => f.name === p.name);
      const isMe = this.me && this.me.name === p.name;
      body.innerHTML = this.card(p, ` · ${p.online ? '🟢 online' : '⚫ offline'}${p.rank ? ` · #${p.rank} in the world` : ''}`) +
        (isMe || isFriend || !this.me ? '' : `<button class="ws-btn on" id="plAdd">➕ Add friend</button>`) + ` <button class="ws-btn" id="plBack">← Back</button>`;
      if ($('plAdd')) $('plAdd').onclick = () => this.net.send({ t: 'friendAdd', name: p.name });
      $('plBack').onclick = () => this.game.meta.openPanel(this.backTo || 'friends');
    }
    showPlayer(name, back) { this.backTo = back; this.viewing = null; this.game.meta.openPanel('player'); this.net.send({ t: 'profile', name }); }
    friendsPanel(body) {
      const net = this.net;
      const inRoom = net.room && net.room.state === 'lobby';
      const party = this.party;
      const inParty = (n) => party && party.members.some((m) => m.name === n);
      const order = this.friends.slice().sort((a, b) => (b.on - a.on) || b.tro - a.tro);
      body.innerHTML = `<form id="frForm" class="fr-add"><input id="frName" maxlength="16" placeholder="Friend's username" spellcheck="false" autocomplete="off"><button class="ws-btn on">➕ Add friend</button></form>
        <div class="small">Your username is <b>${esc(this.me.name)}</b>: tell your friends so they can add you.</div>` +
        (this.reqIn.length ? `<h3>Requests</h3>${this.reqIn.map((n) => `<div class="fr-row"><b>${esc(n)}</b><span class="small">wants to be friends</span><button class="ws-btn on" data-acc="${esc(n)}">Accept</button><button class="ws-btn" data-dec="${esc(n)}">Decline</button></div>`).join('')}` : '') +
        `<h3>Friends (${this.friends.filter((f) => f.on).length} online / ${this.friends.length})</h3>` +
        (order.length ? order.map((f) => `<div class="fr-row ${f.on ? 'on' : ''}"><span class="av">${CW.avatar(f.av)}</span><b class="fr-name" data-view="${esc(f.name)}">${esc(f.name)}</b>
          <span class="small">${f.on ? STATUS[f.st] || '🟢 Online' : '⚫ Offline'} · 🏆 ${f.tro}</span>
          ${f.on && !inParty(f.name) ? `<button class="ws-btn" data-party="${esc(f.name)}" title="Invite to your party">🎉 Party</button>` : ''}
          ${f.on && inRoom ? `<button class="ws-btn" data-inv="${esc(f.name)}" title="Invite to the room you're in">📨 Invite</button>` : ''}
          ${f.room && (!net.room || net.room.code !== f.room) ? `<button class="ws-btn on" data-join="${esc(f.room)}" title="Join their room">▶ Join</button>` : ''}
          <button class="ws-btn" data-rem="${esc(f.name)}" title="Remove friend">✖</button></div>`).join('') : '<div class="small">No friends yet. Add someone by their username!</div>') +
        (this.reqOut.length ? `<h3>Sent requests</h3>${this.reqOut.map((n) => `<div class="fr-row"><b>${esc(n)}</b><span class="small">waiting…</span><button class="ws-btn" data-dec="${esc(n)}">Cancel</button></div>`).join('')}` : '');
      $('frForm').onsubmit = (e) => { e.preventDefault(); const n = $('frName').value.trim(); if (n) net.send({ t: 'friendAdd', name: n }); $('frName').value = ''; };
      const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
      on('[data-acc]', (b) => net.send({ t: 'friendAccept', name: b.dataset.acc }));
      on('[data-dec]', (b) => net.send({ t: 'friendDecline', name: b.dataset.dec }));
      on('[data-party]', (b) => net.send({ t: 'partyInvite', name: b.dataset.party }));
      on('[data-inv]', (b) => net.send({ t: 'invite', name: b.dataset.inv }));
      on('[data-join]', (b) => { this.game.meta.closePanel(); net.openOnline(b.dataset.join); });
      on('[data-rem]', (b) => { if (confirm(`Remove ${b.dataset.rem} from your friends?`)) net.send({ t: 'friendRemove', name: b.dataset.rem }); });
      on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'friends'));
    }
    roadPanel(body) {
      const best = this.me ? this.me.best | 0 : 0;
      const got = this.roadClaimed();
      const next = CW.ROAD.find((r) => r.at > best);
      body.innerHTML = (this.me ? `<div class="small">Earn trophies in matches you find with <b>PLAY</b>: top places win trophies, low places can lose a few. Your <b>best</b> trophy count unlocks rewards, so they never go away. You have <b>🏆 ${this.me.tro}</b> (best ${best}).</div>`
        : '<div class="small">Log in and press PLAY to earn trophies and unlock these rewards.</div><button class="ws-btn on" id="roadLogin">👤 Log in or sign up</button>') +
        (next ? `<div class="road-next">Next reward at <b>🏆 ${next.at}</b><div class="ch-bar"><i style="width:${Math.min(100, Math.round((best / next.at) * 100))}%"></i></div></div>` : '') +
        `<div class="road">${CW.ROAD.map((r) => {
          const reached = best >= r.at, claimed = got.includes(r.at);
          return `<div class="road-step ${reached ? 'reached' : ''} ${claimed ? 'claimed' : ''}"><b>🏆 ${r.at}</b><span>${this.rewardText(r)}</span>${claimed ? '<span class="owned">✔ Claimed</span>' : reached ? `<button class="ws-btn on" data-road="${r.at}">Claim!</button>` : '<span class="small">🔒</span>'}</div>`;
        }).join('')}</div><h3>Trophy tiers</h3><div class="tiers">${CW.TIERS.map((t) => `<span>${t.icon} ${t.name}<small>${t.at}+</small></span>`).join('')}</div>`;
      body.querySelectorAll('[data-road]').forEach((b) => (b.onclick = () => this.claimRoad(+b.dataset.road)));
      if ($('roadLogin')) $('roadLogin').onclick = () => { this.game.meta.closePanel(); this.openLogin(); };
    }
    topPanel(body) {
      const t = this.top;
      const friendsBoard = () => {
        const list = this.friends.concat(this.me ? [Object.assign({}, this.me)] : []).sort((a, b) => b.tro - a.tro);
        return list.map((p, i) => this.lbRow(p, i + 1)).join('') || '<div class="small">Add friends to compare trophies!</div>';
      };
      const tabs = `<div class="menu-btns" style="justify-content:flex-start"><button class="ws-btn ${this.lbTab === 'global' ? 'on' : ''}" data-tab="global">🌍 World</button><button class="ws-btn ${this.lbTab === 'friends' ? 'on' : ''}" data-tab="friends">👥 Friends</button></div>`;
      if (this.lbTab === 'friends') body.innerHTML = tabs + (this.me ? friendsBoard() : '<div class="small">Log in to see your friends here.</div>');
      else if (!t) body.innerHTML = tabs + '<div class="small">Loading…</div>';
      else body.innerHTML = tabs + `<div class="small">${t.total} players. ${t.me ? `You are <b>#${t.me.rank}</b>.` : 'Log in to get on the board!'}</div>` + t.list.map((p, i) => this.lbRow(p, i + 1)).join('') + (t.me && t.me.rank > 50 ? '<div class="small">…</div>' + this.lbRow(t.me.card, t.me.rank) : '');
      body.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.lbTab = b.dataset.tab; if (this.lbTab === 'global') this.net.send({ t: 'top' }); this.game.meta.renderPanel(); }));
      body.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => this.showPlayer(b.dataset.view, 'top')));
    }
    lbRow(p, rank) {
      const me = this.me && p.name === this.me.name;
      const medal = ['🥇', '🥈', '🥉'][rank - 1] || '#' + rank;
      return `<div class="fr-row lb-row ${me ? 'me' : ''}"><span class="lb-rank">${medal}</span><span class="av">${CW.avatar(p.av)}</span><b class="fr-name" data-view="${esc(p.name)}">${esc(p.name)}</b><span class="small">${CW.tier(p.tro).icon} ⭐${p.lv || 1}</span><b class="lb-tro">🏆 ${p.tro}</b></div>`;
    }
  }

  CW.Account = Account;
})();
