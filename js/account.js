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

  // v1.9.5: default profile pictures (like Discord's): a little robot head on a colored circle, 8 colors, all free.
  // They replaced the emoji avatars; older avatar numbers (up to 47) wrap around onto these 8
  CW.AVATAR_COLORS = ['#3d6fe0', '#1f9e8a', '#d6455a', '#e07f2a', '#7c55e0', '#c99a14', '#1d93c4', '#5d6a85'];
  CW.AVATARS = CW.AVATAR_COLORS.map((c) => `<span class="dpic" style="background:${c}"><svg viewBox="0 0 32 32" aria-hidden="true"><g fill="#fff"><circle cx="16" cy="6.2" r="1.7"/><rect x="15.2" y="7" width="1.6" height="3.6" rx=".8"/><rect x="8" y="10.2" width="16" height="13" rx="4.2"/><rect x="5.6" y="14" width="2.6" height="5.4" rx="1.3"/><rect x="23.8" y="14" width="2.6" height="5.4" rx="1.3"/></g><g fill="${c}"><circle cx="12.6" cy="16.2" r="2.1"/><circle cx="19.4" cy="16.2" r="2.1"/><rect x="13" y="19.8" width="6" height="1.7" rx=".85"/></g></svg></span>`);
  CW.FREE_AVATARS = CW.AVATARS.length;
  // an email is never shown in full in Settings (someone might be watching your screen): t*****y@gmail.com
  CW.hideEmail = (m) => {
    const [u, d] = String(m || '').split('@');
    return u.length > 2 ? `${u[0]}${'*'.repeat(Math.min(8, u.length - 2))}${u[u.length - 1]}@${d}` : `${u[0] || ''}***@${d}`;
  };
  // "5 min ago", "3 h ago", "2 days ago" (club members' Last online)
  CW.ago = (t) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? '1 day ago' : d < 60 ? `${d} days ago` : 'a long time ago';
  };
  // club badges
  CW.CLUB_BADGES = ['🛡', '⚙', '🔥', '⚡', '🐉', '🦅', '🌟', '💀', '👑', '🚀', '🌊', '🍀'];
  CW.avatar = (i) => (i == null || i < 0 ? '🧑‍✈️' : CW.AVATARS[(i | 0) % CW.AVATARS.length]);
  // players' own pictures and club pictures live on the server (server/pics.js); shown as circles
  CW.serverOrigin = () => (CW.SERVER_URL ? CW.SERVER_URL.replace(/^ws(s?):/, 'http$1:').replace(/\/ws$/, '') : location.origin);
  CW.picUrl = (kind, id, pv) => `${CW.serverOrigin()}/pic/${kind}/${encodeURIComponent(String(id).toLowerCase())}.jpg?v=${pv | 0}`;
  // "Quick chat only" players (kids) see the ready-made avatars instead of other players' own pictures
  const kidsView = () => !!(window.game && window.game.talk && window.game.talk.mode === 'quick');
  // a player's face: their own picture if they have one, else their avatar
  CW.face = (p) => (p && p.pv && p.name && !kidsView()
    ? `<img class="pfp" src="${CW.picUrl('u', p.name, p.pv)}" alt="" data-av="${p.av | 0}" draggable="false">`
    : CW.avatar(p ? p.av : -1));
  // a club's picture, else its badge
  CW.clubFace = (cl) => (cl && cl.pv && !kidsView()
    ? `<img class="pfp" src="${CW.picUrl('c', cl.id, cl.pv)}" alt="" data-badge="${cl.badge | 0}" draggable="false">`
    : CW.CLUB_BADGES[(cl && cl.badge) | 0] || '🛡');
  // a picture that can't load (offline, a portal that blocks it) falls back to the avatar or badge
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('pfp')) return;
    if (t.dataset.badge != null) t.replaceWith(document.createTextNode(CW.CLUB_BADGES[+t.dataset.badge] || '🛡'));
    else { t.insertAdjacentHTML('afterend', CW.avatar(+t.dataset.av)); t.remove(); }
  }, true);
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
      // connect right away: logged in, friends see you online; as a guest, your coins come from the server too
      setTimeout(() => this.connect(), 300);
      setInterval(() => this.watchStatus(), 1000);
    }

    get loggedIn() { return !!this.me; }
    // connected with a server wallet (an account's or this device's guest one): coins and the Shop work
    get walletLive() { return !!this.wallet && this.net.status === 'online' && (this.loggedIn || this.guestOn); }
    get net() { return this.game.net; }
    connect() { if (this.net.canConnect()) this.net.connect().catch(() => {}); }

    // ======================= from the net layer =======================
    onWelcome(m) {
      this.loginOpts = (m && m.login) || {};
      if (this.session) return this.net.send({ t: 'acctAuth', token: this.session.token });
      if (this.cookieSite()) this.net.send({ t: 'acctAuth', cookie: 1 }); // v1.10.3 the website's cookie (nothing happens without one)
      if (this.gSecret && this.view === 'gwait') this.net.send({ t: 'googleStart', s: this.gSecret }); // reconnected while signing in with Google
      this.helloGuest();
      // anyone can play as a guest; a friendly reminder says what an account adds
      clearTimeout(this.nudgeT);
      this.nudgeT = setTimeout(() => this.guestNudge(), 6000);
    }
    mailLogin() { return !!this.loginOpts && !!(this.loginOpts.email || this.loginOpts.google); }
    // nobody has to log in to play (guests keep their progress on this device)
    loginRequired() { return false; }
    // guests: a small card (at most once a day, never over the tutorial or a menu) about saving progress with an account
    guestNudge(tries = 0) {
      if (this.loggedIn || this.session || !this.net.canConnect()) return;
      const day = new Date().toISOString().slice(0, 10);
      if (load('cogwild.guestNudge', null) === day) return;
      const g = this.game;
      const busy = g.state !== 'menu' || !$('firstRun').classList.contains('hidden') || !$('panel').classList.contains('hidden')
        || !$('acct').classList.contains('hidden') || !$('vcAsk').classList.contains('hidden') || g.talk.isOpen;
      if (busy) { if (tries < 20) this.nudgeT = setTimeout(() => this.guestNudge(tries + 1), 15000); return; }
      if ([...$('notes').children].some((n) => /Playing as a guest/.test(n.textContent))) return; // already showing
      keep('cogwild.guestNudge', day);
      this.note('👤 <b>Playing as a guest</b>: your progress is saved on this device only. Log in to keep it on every device and to get trophies, friends, clubs and voice chat.',
        [{ label: 'Log in / Sign up', main: true, fn: () => this.openLogin() }, { label: 'Later' }], 20000);
    }
    // no account: this device's guest wallet (the first time, the progress it already has comes along, capped)
    helloGuest() {
      const token = load('cogwild.guest', null);
      const p = this.game.profile;
      this.net.send({ t: 'guest', token, profile: token ? undefined : { coins: p.coins, xp: p.xp, owned: p.owned } });
    }
    onDisconnect() {
      const was = this.loggedIn;
      this.me = null;
      this.guestOn = false;
      this.friends = [];
      this.party = null;
      this.renderChips();
      this.game.voice.onDisconnect();
      this.game.calls.onDisconnect();
      this.game.talk.refresh();
      // stay connected: retry with a growing pause
      if (this.net.canConnect()) {
        this.retry = Math.min(60000, (this.retry || 2500) * 1.6);
        clearTimeout(this.retryT);
        this.retryT = setTimeout(() => this.connect(), this.retry);
        if (was) this.game.toast('📡 Reconnecting to your account…');
      }
    }
    onMessage(m) {
      const g = this.game;
      if (g.talk.onMessage(m) || g.voice.onMessage(m) || g.calls.onMessage(m)) return; // chat, voice chat and calls
      if (g.gallery && g.gallery.onMessage(m)) return; // the mech gallery
      switch (m.t) {
        case 'acctOk': this.onLogin(m); break;
        case 'acctCodeSent':
          if (this.loggedIn) { g.toast(`📧 We sent a code to ${m.email}`); break; } // adding an email to your account
          this.loginView('code');
          $('codeSentTo').textContent = `We sent a 6-digit code to ${m.email}. Check your inbox (and spam).`;
          $('suCode').value = m.devCode || ''; // devCode: local testing only
          break;
        case 'acctPickName':
          this.googleSign = !!m.google;
          this.mailAddr = m.email;
          $('suName').value = '';
          this.loginView('name');
          break;
        case 'acctNewPass': this.loginView('reset'); break;
        case 'acctEmailSet': this.myEmail = m.email; g.toast(`📧 ${CW.hideEmail(m.email)} is now your login`); this.linkStep = null; this.rerender(); this.renderAccountBox(); break;
        case 'guestOk':
          if (m.token) keep('cogwild.guest', m.token);
          this.guestOn = true;
          this.applyWallet(m.wallet);
          this.afterWallet();
          break;
        case 'acctOut':
          // logged in on another device: this one stays logged in for next time (v1.9.4: phones had to log in again)
          if (this.session && !m.keep) { this.session = null; keep('cogwild.session', null); }
          this.me = null;
          this.renderChips();
          g.voice.apply();
          if (m.keep && this.session) this.note('👤 You logged in on another device.', [{ label: 'Play here', main: true, fn: () => this.net.send({ t: 'acctAuth', token: this.session.token }) }, { label: 'OK' }], 30000);
          else if (m.reason) g.toast('👤 ' + m.reason);
          break;
        case 'acctErr':
          if ($('acctErr') && !$('acct').classList.contains('hidden')) { $('acctErr').textContent = m.msg; $('acctErr').classList.remove('ok'); }
          else g.toast('⚠ ' + m.msg);
          break;
        case 'acctMe': this.me = m.me; if (m.me && m.me.name) { g.profile.name = m.me.name; g.saveProfile(); } this.renderChips(); this.rerender(); this.renderAccountBox(); break;
        case 'wallet': this.onWallet(m); break;
        case 'club': this.club = m.club; this.peek = null; this.rerender(); g.talk.refresh(); break;
        case 'clubs': this.clubs = m.list; this.rerender(); break;
        case 'clubPeek': this.peek = m.club; this.rerender(); break;
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
          if (g.settings.friendOnline !== false) for (const f of m.list) { const o = before.find((x) => x.name === f.name); if (o && !o.on && f.on) this.note(`${CW.face(f)} ${esc(f.name)} is online`); }
          this.renderChips();
          this.rerender();
          g.talk.refresh();
          break;
        }
        case 'party': this.party = m.party; this.renderParty(); this.rerender(); g.talk.refresh(); g.voice.apply(); break;
        case 'note': this.onNote(m); break;
        case 'trophies': this.onTrophies(m); break;
        case 'ranked': this.lastRanked = m; this.resultsLine(); break;
        case 'cupResult': this.lastCup = m; this.resultsLine(); break;
        case 'cupInfo': this.cupInfo = m; g.renderArenaCard(); if (!$('panel').classList.contains('hidden') && g.meta.panel === 'cup') g.meta.renderPanel(); break;
        case 'top': if (m.kind === 'ranked') this.topRanked = m; else this.top = m; this.rerender(); break;
        case 'profile': this.viewing = m.p; if (this.game.meta.panel === 'player') this.game.meta.renderPanel(); else this.game.meta.openPanel('player'); break;
      }
    }

    // ======================= login, sync =======================
    onLogin(m) {
      const g = this.game;
      this.me = m.me;
      this.myEmail = m.email || null;
      this.hasPass = !!m.hasPass;
      this.retry = 0;
      this.session = { token: m.token, name: m.me.name };
      keep('cogwild.session', this.session);
      this.rememberCookie(m.token);
      g.profile.name = m.me.name;
      this.net.name = m.me.name;
      $('acct').classList.add('hidden');
      const user = m.me.name.toLowerCase();
      this.guestOn = false;
      if (m.created && Date.now() - m.created < 60000) keep('cogwild.guest', null); // a new account took the guest wallet
      if (m.wallet && !m.wallet.fresh) { this.applyWallet(m.wallet); this.afterWallet(); }
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
      // chat starts fresh; voice chat comes back on (or the game asks about it)
      g.talk.dms = {};
      g.talk.refresh();
      g.voice.apply();
      setTimeout(() => g.voice.maybeAsk(), 1500);
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
    // v1.10.3: on the website (served by the game's own server, not an app or a game portal) the login is also kept as a
    // cookie, so the site remembers you like any website does, even if its saved data is cleared
    cookieSite() { return !CW.SERVER_URL && /^https?:$/.test(location.protocol) && !CW.PORTAL && !window.CogwildDesktop && !window.Capacitor; }
    rememberCookie(token) {
      if (!this.cookieSite() || !window.fetch) return;
      fetch('/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(token ? { token } : { out: 1 }) }).catch(() => {});
    }
    logout() {
      const g = this.game;
      const finish = () => {
        this.net.send({ t: 'acctLogout' });
        this.rememberCookie(null);
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
      if (this.party) {
        const bp = g.currentBp, sig = bp ? bp.color + ':' + bp.parts.map((p) => p.t + p.x + p.y + p.z).join() : '';
        if (sig !== this.partySig) { this.partySig = sig; this.net.send({ t: 'partyMech', bp: { color: bp.color || g.playerColor, parts: bp.parts } }); }
      } else this.partySig = null;
      if (force || busy !== this.lastBusy) { this.lastBusy = busy; this.net.send({ t: 'status', busy }); }
    }

    // ======================= login screen =======================
    bindUi() {
      const g = this.game;
      $('acctChip').onclick = () => (this.loggedIn ? g.meta.openPanel('profile') : this.openLogin());
      $('btnFriends').onclick = () => (this.loggedIn ? g.meta.openPanel('friends') : this.openLogin('Log in to add friends and make a party'));
      $('btnRoad').onclick = () => g.meta.openPanel('road');
      $('btnPass').onclick = () => g.meta.openPanel('pass');
      $('btnEvent').onclick = () => g.meta.openPanel('event');
      $('btnClubs').onclick = () => (this.loggedIn ? (g.meta.openPanel('clubs'), this.net.send({ t: 'clubInfo' })) : this.openLogin('Log in to join a club'));
      $('roadBar').onclick = () => (this.loggedIn ? g.meta.openPanel('road') : this.openLogin('Log in to earn trophies and unlock the Trophy Road'));
      $('btnTop').onclick = () => { g.meta.openPanel('top'); this.net.send({ t: 'top' }); };
      $('tabLogin').onclick = () => this.loginView('login');
      $('tabSign').onclick = () => this.loginView('sign', 'signup');
      $('acctGuest').onclick = () => $('acct').classList.add('hidden');
      $('acctX').onclick = () => { if (!this.loginRequired()) $('acct').classList.add('hidden'); };
      CW.tapOutside($('acct'), () => { if (!this.loginRequired()) $('acct').classList.add('hidden'); });
      const err = (msg, ok) => { $('acctErr').textContent = msg; $('acctErr').classList.toggle('ok', !!ok); };
      const online = async () => { try { await this.net.connect(); return true; } catch (e) { err("Can't reach the server. Check your internet."); return false; } };
      // log in: email (or an old username) + password
      $('fLogin').onsubmit = async (e) => {
        e.preventDefault();
        const id = $('liEmail').value.trim(), pass = $('liPass').value;
        if (!id || !pass) return err('Type your email and password');
        if (!(await online())) return;
        err('');
        this.welcomeToast = '👋 Welcome back!';
        this.net.send({ t: 'acctLogin', name: id, pass });
        $('liPass').value = '';
      };
      // Google: the player's own browser signs them in; this game waits for the server to log it in
      $('gBtn').onclick = () => this.startGoogle();
      $('gAgain').onclick = () => this.openGoogle();
      $('gCancel').onclick = () => { this.gSecret = null; this.loginView(this.purpose === 'signup' && this.view === 'gwait' && this.gFrom === 'sign' ? 'sign' : 'login'); };
      $('liOld').onclick = () => { this.passLogin = true; this.loginView('login'); };
      $('liForgot').onclick = () => { $('suEmail').value = $('liEmail').value.includes('@') ? $('liEmail').value.trim() : ''; this.loginView('mail', 'reset'); };
      // sign up: email, password twice and a username, all at once
      $('fSign').onsubmit = async (e) => {
        e.preventDefault();
        const email = $('sgEmail').value.trim(), pass = $('sgPass').value, name = $('sgName').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("That doesn't look like an email address");
        if (pass.length < 6) return err('Passwords need at least 6 characters');
        if (pass !== $('sgPass2').value) return err("The two passwords don't match");
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err('Usernames are 3-16 letters, numbers or _');
        if (name.toLowerCase() === email.split('@')[0].toLowerCase()) return err("Pick a username that isn't your email");
        if (!(await online())) return;
        err('Creating your account…', true);
        this.mailAddr = email;
        this.purpose = 'signup';
        this.welcomeToast = `🎉 Welcome to Cogwild, ${name}!`;
        this.net.send({ t: 'acctSignup', email, pass, name });
      };
      // a new password: email -> code
      $('fMail').onsubmit = async (e) => {
        e.preventDefault();
        const email = $('suEmail').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("That doesn't look like an email address");
        if (!(await online())) return;
        err('Sending…', true);
        this.mailAddr = email;
        this.net.send({ t: 'emailStart', email, purpose: this.purpose });
      };
      $('fCode').onsubmit = (e) => { e.preventDefault(); err(''); this.net.send({ t: 'emailCode', email: this.mailAddr, code: $('suCode').value.trim(), purpose: this.purpose }); };
      $('codeBack').onclick = () => this.loginView(this.purpose === 'signup' ? 'sign' : 'mail', this.purpose);
      // the last step: username + password
      $('fName').onsubmit = (e) => {
        e.preventDefault();
        const name = $('suName').value.trim(), pass = $('suPass').value;
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err('Usernames are 3-16 letters, numbers or _');
        if (name.includes('@') || (this.mailAddr && name.toLowerCase() === this.mailAddr.split('@')[0].toLowerCase())) return err("Pick a username that isn't your email");
        if (!this.googleSign) {
          if (pass.length < 6) return err('Passwords need at least 6 characters');
          if (pass !== $('suPass2').value) return err("The two passwords don't match");
        }
        err('');
        this.welcomeToast = `🎉 Welcome to Cogwild, ${name}!`;
        this.net.send({ t: 'emailName', name, pass: this.googleSign ? '' : pass });
      };
      $('fReset').onsubmit = (e) => {
        e.preventDefault();
        if ($('rsPass').value.length < 6) return err('Passwords need at least 6 characters');
        if ($('rsPass').value !== $('rsPass2').value) return err("The two passwords don't match");
        err('');
        this.welcomeToast = '🔑 Password changed. Welcome back!';
        this.net.send({ t: 'acctResetPass', pass: $('rsPass').value });
      };
      // no email on the server yet: username + password
      $('fOld').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('olName').value.trim(), pass = $('olPass').value;
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err('Usernames are 3-16 letters, numbers or _');
        if (pass.length < 6) return err('Passwords need at least 6 characters');
        if (pass !== $('olPass2').value) return err("The two passwords don't match");
        if (!(await online())) return;
        err('');
        this.welcomeToast = `🎉 Welcome to Cogwild, ${name}!`;
        this.net.send({ t: 'acctRegister', name, pass });
      };
      $('acctShow').onchange = (e) => { for (const id of ['liPass', 'sgPass', 'sgPass2', 'suPass', 'suPass2', 'rsPass', 'rsPass2', 'olPass', 'olPass2']) $(id).type = e.target.checked ? 'text' : 'password'; };
    }
    // Google sign-in works on this server (then it's the way to sign up)
    get googleOn() { return !!(this.loginOpts && this.loginOpts.google); }
    // the server's https address (the apps talk to it from elsewhere)
    origin() { return CW.serverOrigin(); }
    startGoogle() {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      this.gSecret = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      this.gFrom = this.view;
      this.welcomeToast = '👋 Welcome!';
      this.openGoogle(); // right away, while the click still counts (pop-up blockers)
      this.loginView('gwait');
      this.net.connect().then(() => this.net.send({ t: 'googleStart', s: this.gSecret })).catch(() => { $('acctErr').textContent = "Can't reach the server. Check your internet."; });
    }
    openGoogle() { if (this.gSecret) CW.openExternal(this.origin() + '/auth/google?s=' + this.gSecret); }
    // which form shows: 'login', 'mail', 'code', 'name', 'reset', 'old' or 'gwait'; purpose: 'signup' or 'reset'
    loginView(view, purpose) {
      if (purpose) this.purpose = purpose;
      if (!['gwait', 'name'].includes(view)) this.gSecret = null; // left the Google sign-in
      this.view = view;
      const signing = view !== 'login';
      $('tabLogin').classList.toggle('on', !signing || this.purpose === 'reset');
      $('tabSign').classList.toggle('on', signing && this.purpose !== 'reset');
      for (const [id, v] of [['fLogin', 'login'], ['fSign', 'sign'], ['fMail', 'mail'], ['fCode', 'code'], ['fName', 'name'], ['fReset', 'reset'], ['fOld', 'old'], ['fGWait', 'gwait']]) $(id).classList.toggle('hidden', view !== v);
      // with Google on: signing up is only with Google; logging in with a password is behind a link (older accounts)
      const g = this.googleOn;
      if (g && view === 'sign') $('fSign').classList.add('hidden');
      if (g && view === 'login' && !this.passLogin) $('fLogin').classList.add('hidden');
      $('liOld').classList.toggle('hidden', !(g && view === 'login' && !this.passLogin));
      $('gBtnT').textContent = view === 'sign' ? 'Sign up with Google' : 'Log in with Google';
      $('acctShow').parentElement.classList.toggle('hidden', g && (view === 'sign' || view === 'gwait' || (view === 'login' && !this.passLogin) || (view === 'name' && this.googleSign)));
      $('nameStepT').textContent = this.googleSign ? 'Last step · pick your username' : 'Step 3 of 3 · your player';
      const reset = this.purpose === 'reset' && signing;
      $('acctTitle').textContent = reset ? 'New password' : view === 'login' ? 'Welcome back' : 'Create your account';
      $('mailStepT').textContent = 'Step 1 of 2 · your email';
      $('codeStepT').textContent = reset ? 'Step 2 of 2 · check your email' : 'Last step · confirm your email';
      $('gBtnWrap').classList.toggle('hidden', !g || !['login', 'sign'].includes(view));
      $('acctTabs').classList.toggle('hidden', ['code', 'name', 'reset', 'gwait'].includes(view));
      document.querySelectorAll('#fName .pw-row').forEach((r) => r.classList.toggle('hidden', !!this.googleSign));
      $('acctErr').textContent = '';
      const focus = g && (view === 'login' || view === 'sign') && !this.passLogin ? 'gBtn' : { login: 'liEmail', sign: 'sgEmail', mail: 'suEmail', code: 'suCode', name: 'suName', reset: 'rsPass', old: 'olName' }[view];
      setTimeout(() => $(focus) && $(focus).focus(), 50);
    }
    openLogin(why, view) {
      if (!this.net.canConnect()) return this.game.toast('Accounts need the game to be opened from its web address');
      $('acct').classList.remove('hidden');
      $('acct').classList.toggle('required', this.loginRequired());
      $('acctWhy').textContent = why || 'Save your progress, earn trophies and play with friends.';
      this.googleSign = false;
      this.passLogin = false;
      this.loginView(view || 'login', 'signup');
    }

    renderChips() {
      const g = this.game;
      const me = this.me;
      $('acctChip').innerHTML = me ? `<span class="av">${CW.face(me)}</span><b>${esc(me.name)}</b>` : '👤 <b>Log in</b>';
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
      // the Cog Pass bar: tier and progress to the next one
      const w = this.wallet, E = CW.ECON;
      const pts = w ? w.pass.pts : 0, tier = Math.min(E.PASS.tiers, Math.floor(pts / E.PASS.perTier));
      $('pbTier').textContent = w ? `Tier ${tier} / ${E.PASS.tiers}` : `Season ${E.season().id}`;
      $('pbFill').style.width = (tier >= E.PASS.tiers ? 100 : Math.round(((pts % E.PASS.perTier) / E.PASS.perTier) * 100)) + '%';
      $('badgePass').textContent = pass;
      $('badgePass').classList.toggle('hidden', !pass);
      // the seasonal event bar (only while one runs)
      const ev = E.event();
      $('btnEvent').classList.toggle('hidden', !ev);
      if (ev) {
        const evPts = this.eventPts(), steps = E.eventRewards(ev.id), last = steps[steps.length - 1].at;
        $('btnEvent').style.setProperty('--ev', ev.color);
        $('evIco').textContent = ev.icon;
        $('evName').textContent = ev.name;
        $('evInfo').textContent = `${Math.min(evPts, last)} / ${last} ⭐ · ends in ${CW.timeLeft(ev.end - Date.now())}`;
        $('evFill').style.width = Math.min(100, Math.round((evPts / last) * 100)) + '%';
        const ready = this.eventReady();
        $('badgeEvent').textContent = ready;
        $('badgeEvent').classList.toggle('hidden', !ready);
      }
      const road = this.roadReady();
      for (const id of ['badgeRoad', 'badgeRoad2']) { $(id).textContent = road; $(id).classList.toggle('hidden', !road); }
      if (g.state === 'menu') g.meta.renderMenu();
    }
    renderParty() { CW.keepTyping($('partyBar'), () => this.drawParty()); }
    drawParty() {
      const bar = $('partyBar');
      const p = this.party;
      bar.classList.toggle('hidden', !p);
      if (!p) return;
      const lead = this.me && p.leader === this.me.name;
      bar.innerHTML = `<div class="pt-head"><b>🎉 Party ${p.members.length}/4</b><button class="link-btn" id="partyLeave">Leave</button></div>
        <div class="party-row">${p.members.map((f) => `<span class="party-m ${f.name === p.leader ? 'lead' : ''}" aria-label="${esc(f.name)}${f.name === p.leader ? ' (leader)' : ''}">${CW.face(f)}<small>${f.name === p.leader ? '👑 ' : ''}${esc(f.name)}</small></span>`).join('')}</div>
        <div class="small">${lead ? 'You lead: press PLAY and your party comes along.' : `${esc(p.leader)} picks the match. You'll follow them in.`}</div>
        <div class="pc-chat"><div class="pc-log" id="pcLog"></div>
          ${this.game.talk.freeOk && !this.game.touch.on ? '<form class="pc-form" id="pcForm"><input id="pcIn" maxlength="200" autocomplete="off" placeholder="Message your party…"></form>' : '<button class="ws-btn pc-open" id="pcOpen">💬 Party chat</button>'}</div>`;
      $('partyLeave').onclick = () => this.net.send({ t: 'partyLeave' });
      // PC: type right here; phones (and Quick chat only): the party chat opens (full screen on phones)
      if ($('pcForm')) $('pcForm').onsubmit = (e) => { e.preventDefault(); const x = $('pcIn').value.trim(); if (x && this.game.talk.sayTo('party', { x })) $('pcIn').value = ''; };
      if ($('pcOpen')) $('pcOpen').onclick = () => this.game.talk.open('party');
      $('pcLog').onclick = () => { if (this.game.touch.on) this.game.talk.open('party'); };
      this.renderPartyLog();
    }
    // the last party lines on the party card
    renderPartyLog() {
      const box = $('pcLog');
      if (!box || !this.party) return;
      const talk = this.game.talk, me = this.me && this.me.name;
      const lines = (this.party.log || []).filter((l) => !talk.isBlocked(l.f)).slice(-4);
      box.innerHTML = lines.map((l) => `<div class="${l.f === me ? 'me' : ''}"><b>${esc(l.f === me ? 'You' : l.f)}:</b> ${esc(talk.text(l))}</div>`).join('') || '<div class="small">No party messages yet</div>';
      box.scrollTop = box.scrollHeight;
      // on a PC the party card shows the messages, so they count as read (phones only show a line: open the chat)
      if (!this.game.touch.on && this.game.state === 'menu') talk.markSeen('party');
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
      const g = this.game;
      const cr = this.lastCup;
      if (cr && g.state === 'results' && g.net.room && g.net.room.settings.cup) {
        el.innerHTML = `<span class="tro-pop up">🏆 +${cr.pts} cup points</span> <span class="small">Weekend Cup: ${cr.score} points (best ${CW.ECON.CUP.best} matches) · #${cr.rank} · ${cr.games} match${cr.games === 1 ? '' : 'es'} played</span>`;
        return;
      }
      const rk = this.lastRanked;
      if (rk && g.state === 'results' && g.net.room && g.net.room.settings.ranked) {
        el.innerHTML = `<span class="tro-pop ${rk.d > 0 ? 'up' : rk.d < 0 ? 'down' : ''}">🏅 ${rk.d > 0 ? '+' : ''}${rk.d} RP</span> <span class="small">${rk.rp} ranked points · ${rk.rank.icon} ${rk.rank.name}${rk.streak > 1 ? ` · 🔥 ${rk.streak} wins in a row` : ''}</span>`;
        return;
      }
      const m = this.lastTro;
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
      if (!g.net.active) this.lastRanked = null;
      if (!g.net.active) this.lastCup = null;
      this.resultsLine();
      if (!this.loggedIn && g.net.room && g.net.room.auto) $('resTrophy').innerHTML = '<span class="small">🏆 Log in to earn trophies</span>';
    }

    // ======================= wallet: coins and unlocks kept by the server =======================
    applyWallet(w) {
      const p = this.game.profile;
      this.wallet = w;
      if (w.avBack) this.note(`🪙 Avatars are now simple profile pictures. The avatars you had became <b>${w.avBack | 0} coins</b>.`, [{ label: 'OK' }], 20000);
      p.coins = w.coins;
      p.owned = { paints: w.owned.paints.slice(), trails: w.owned.trails.slice(), avatars: w.owned.avatars.slice(), finishes: (w.owned.finishes || []).slice(), wrecks: (w.owned.wrecks || []).slice(),
        supers: (w.owned.supers || []).slice(), gadgets: (w.owned.gadgets || []).slice(), perks: (w.owned.perks || []).slice() }; // (v1.10.1: the loadout kinds were missing)
      if (!p.owned.trails.includes(p.trail)) p.trail = 'spark';
      if (p.finish && !p.owned.finishes.includes(p.finish)) p.finish = '';
      if (p.wreckFx && !p.owned.wrecks.includes(p.wreckFx)) p.wreckFx = '';
      p.road = w.road.slice();
      p.dailyClaimed = w.gift.day;
      p.dailyStreak = w.gift.streak;
      p.pass = w.pass;
      if (w.xp !== undefined) p.xp = w.xp;
      // today's claimed challenges and every paid achievement, so nothing is offered twice
      const ch = p.challenges;
      if (ch && ch.date === CW.ECON.day()) ch.list.forEach((c, i) => { c.claimed = w.ch.includes(i); });
      p.achievements = p.achievements || {};
      for (const id of w.ach || []) if (!p.achievements[id]) p.achievements[id] = 1;
      keep('cogwild.profile', p); // not a change to back up: it came from the server
    }
    // back online: what was earned without a connection gets reported (the server pays a capped amount)
    afterWallet() {
      const g = this.game, p = g.profile;
      if (p.pending && (p.pending.n || p.pending.xp)) { this.net.send({ t: 'earn', src: 'offline', n: p.pending.n | 0, xp: p.pending.xp | 0 }); p.pending = null; }
      for (const id of p.pendingAch || []) this.net.send({ t: 'earn', src: 'ach', key: id });
      p.pendingAch = [];
      keep('cogwild.profile', p);
      this.renderChips();
      if (g.state === 'menu') g.meta.renderMenu();
      g.workshop.buildPaint();
    }
    onWallet(m) {
      const g = this.game;
      this.applyWallet(m.w);
      if (m.bought) g.meta.afterBuy(m.bought.kind, m.bought.id);
      if (m.gift) g.meta.giftToast(m.gift);
      // "Claim all" on the Cog Pass: one fanfare and one message for the whole batch
      if (m.pass && this.passBatch && this.passBatch.left > 1) this.passBatch.left--;
      else if (m.road || m.pass) {
        const batch = m.pass && this.passBatch && this.passBatch.n > 1 ? this.passBatch.n : 0;
        const all = batch ? (this.passBatch.rewards || []).concat(m.reward) : [m.reward];
        this.passBatch = null;
        // v1.10.1: a big reveal (a batch from "Claim all" shows everything together)
        const sum = { coins: all.reduce((a, r) => a + (r.coins | 0), 0), got: [].concat(...all.map((r) => r.got || [])) };
        g.reveal.show(m.road ? '🛤 Trophy Road' : batch ? `🎟 Cog Pass · ${batch} rewards` : '🎟 Cog Pass', g.reveal.items(sum));
        g.workshop.buildPaint();
      }
      if (m.pass && this.passBatch && m.reward) (this.passBatch.rewards = this.passBatch.rewards || []).push(m.reward);
      if (m.cell !== undefined) g.reveal.powerCell(m.cell, () => this.renderChips()); // v1.10.1 the Power Cell
      if (m.src === 'match' && m.pts && g.state === 'results') $('resPass').textContent = `🎟 +${m.pts} Cog Pass points` + (m.evPts ? ` · ${(CW.ECON.event() || {}).icon || '⭐'} +${m.evPts} event points` : '');
      if (m.cupClaim) {
        g.reveal.show(`🏆 Weekend Cup · #${m.rank}`, g.reveal.items(m.reward));
        g.workshop.buildPaint();
      }
      if (m.evStep) {
        const ev = CW.ECON.event();
        g.reveal.show(ev ? `${ev.icon} ${ev.name}` : '🎁 Event', g.reveal.items(m.reward));
        g.workshop.buildPaint();
      }
      this.renderChips();
      if (g.state === 'menu') g.meta.renderMenu();
      if (!$('panel').classList.contains('hidden') && ['shop', 'road', 'pass', 'profile', 'event'].includes(g.meta.panel)) g.meta.renderPanel();
      $('pCoins').textContent = g.profile.coins;
    }

    // ======================= Weekend Cup (js/economy.js CUP; the server scores it) =======================
    // the cup's board, your place and rewards waiting: asked for when the menu shows (at most once a minute)
    askCup(force) {
      if (!this.loggedIn && !force) return;
      if (!force && Date.now() - (this.cupAskT || 0) < 60000) return;
      this.cupAskT = Date.now();
      this.net.connect().then(() => this.net.send({ t: 'cupInfo' })).catch(() => {});
    }
    cupPanel(body) {
      const g = this.game, E = CW.ECON, esc = CW.esc, cu = E.cup(), cm = CW.MODES[cu.mode], info = this.cupInfo;
      if (!info || info.cup.id !== cu.id) this.askCup(true);
      const me = info && info.me, claims = (info && info.claims) || [];
      const claimHtml = claims.map((c) => `<div class="cup-claim"><div><b>🎁 ${new Date(c.id.slice(3)).toLocaleDateString([], { month: 'short', day: 'numeric' })} cup: you finished #${c.rank} of ${c.of}</b><div class="small">${c.score} points in ${c.games} match${c.games === 1 ? '' : 'es'}${c.games < E.CUP.minGames ? ` (play ${E.CUP.minGames}+ for the full reward)` : ''} · ${esc(this.rewardText(c.reward))}</div></div><button class="ws-btn on" data-cupclaim="${c.id}">Claim!</button></div>`).join('');
      const rows = info ? info.top.map((p, i) => `<div class="fr-row lb-row ${this.me && p.name === this.me.name ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span class="av">${CW.face(p)}</span><b class="fr-name">${esc(p.name)}</b><span class="small">${p.games} match${p.games === 1 ? '' : 'es'}</span><b class="lb-tro">🏆 ${p.score}</b></div>`).join('') : '<div class="small">Loading…</div>';
      body.innerHTML = `<div class="cup-head"><span class="cup-big">🏆</span><div style="flex:1"><b>${cu.live ? `Weekend Cup · ${cm.icon} ${cm.name}` : 'Weekend Cup'}</b>
          <div class="small">${cu.live ? `On now: ends in <b>${CW.timeLeft(cu.end - Date.now())}</b>. Pick it in PLAY (mode and arena) and play cup matches.` : `Every weekend from Friday 18:00 to Sunday 24:00 (UTC). The next one starts in <b>${CW.timeLeft(cu.next - Date.now())}</b>.`}</div></div>
          ${cu.live && this.loggedIn ? `<button class="btn primary" id="cupPlay">${g.settings.mmEvent === 'cup' ? '✔ Picked' : 'Play it'}</button>` : ''}</div>
        ${this.loggedIn ? '' : '<div class="small" style="margin-top:8px">👤 The Weekend Cup is for players with an account. <button class="ws-btn" id="cupLogin">Log in</button></div>'}
        ${claimHtml}
        ${me ? `<div class="cup-me"><div><b>#${me.rank}</b><span>your place of ${info.total}</span></div><div><b>${me.score}</b><span>points (best ${E.CUP.best})</span></div><div><b>${me.games}</b><span>matches played</span></div></div>
          <div class="cup-pts small">Your best: ${me.pts.map((x) => `<i>${x}</i>`).join('')}</div>` : ''}
        <h3>How it works</h3>
        <div class="cup-rules"><span>🎮 One mode all weekend, any arena, bots fill empty seats</span><span>🥇 Points for your place: 1st 12 · last 2 (team win 10, loss 3)</span><span>📈 Only your best ${E.CUP.best} matches add up: more tries only help</span>
          <span>🎁 After the weekend: 1st 2500 🪙 · top 3 1500 🪙 · top 10 800 🪙 · top 50 400 🪙 · everyone 200 🪙 (play ${E.CUP.minGames}+ matches)</span><span>✨ Top 3 also get the <b>Champion</b> trail (never sold)</span></div>
        <h3>${cu.live ? 'Leaderboard' : 'Last cup'}${info ? ` <span class="small">${info.total} player${info.total === 1 ? '' : 's'}</span>` : ''}</h3>
        ${rows || '<div class="small">Nobody has played yet. Be the first!</div>'}`;
      if ($('cupPlay')) $('cupPlay').onclick = () => { g.settings.mmEvent = 'cup'; g.saveProfile(); g.renderArenaCard(); g.meta.closePanel(); };
      if ($('cupLogin')) $('cupLogin').onclick = () => this.openLogin('Log in to play the Weekend Cup');
      body.querySelectorAll('[data-cupclaim]').forEach((b) => (b.onclick = () => { b.disabled = true; this.net.send({ t: 'cupClaim', id: b.dataset.cupclaim }); }));
    }

    // ======================= seasonal events (js/economy.js EVENTS; the server counts the points) =======================
    eventPts() { const ev = CW.ECON.event(), e = this.wallet && this.wallet.ev; return ev && e && e.k === ev.key ? e.pts : 0; }
    eventClaimed() { const ev = CW.ECON.event(), e = this.wallet && this.wallet.ev; return ev && e && e.k === ev.key ? e.claimed : []; }
    eventReady() {
      const ev = CW.ECON.event();
      if (!ev || !this.wallet) return 0;
      const pts = this.eventPts(), got = this.eventClaimed();
      return CW.ECON.eventRewards(ev.id).filter((r) => r.at <= pts && !got.includes(r.step)).length;
    }
    eventPanel(body) {
      const E = CW.ECON, g = this.game, ev = E.event(), esc = CW.esc;
      const cal = E.EVENTS.map((e) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `<span class="${ev && ev.id === e.id ? 'now' : ''}">${e.icon} <b>${e.name}</b><br><small>${months[e.from[0] - 1]} ${e.from[1]} – ${months[e.to[0] - 1]} ${e.to[1]}</small></span>`;
      }).join('');
      if (!ev) {
        const nx = E.nextEvent();
        body.innerHTML = `<div class="ev-head" style="--ev:${nx ? nx.color : '#5ce1ff'}"><span class="ev-big">${nx ? nx.icon : '📅'}</span><div><b>${nx ? 'Coming soon: ' + nx.name : 'Seasonal events'}</b><div class="small">${nx ? `Starts in ${CW.timeLeft(nx.start - Date.now())}. ${esc(nx.desc)}` : ''}</div></div></div>
          <h3>📅 Every year</h3><div class="ev-cal">${cal}</div>`;
        return;
      }
      const pts = this.eventPts(), got = this.eventClaimed(), steps = E.eventRewards(ev.id), last = steps[steps.length - 1].at;
      const look = (r) => r.paint ? g.meta.shopLook('paints', E.item('paints', r.paint)) : r.trail ? g.meta.shopLook('trails', E.item('trails', r.trail)) : r.wreck ? g.meta.shopLook('wrecks', E.item('wrecks', r.wreck)) : '<div class="swatch" style="display:grid;place-items:center;font-size:30px">🪙</div>';
      body.innerHTML = `<div style="--ev:${ev.color}">
        <div class="ev-head"><span class="ev-big">${ev.icon}</span><div style="flex:1"><b>${ev.name}</b><div class="small">${esc(ev.desc)} Ends in <b>${CW.timeLeft(ev.end - Date.now())}</b>.</div>
          <div class="ev-bar"><i style="width:${Math.min(100, Math.round((pts / last) * 100))}%"></i></div><div class="small">${Math.min(pts, last)} / ${last} ⭐ event points · every match +${E.EVENT_PTS.match} ⭐ · every daily challenge +${E.EVENT_PTS.challenge} ⭐</div></div></div>
        ${this.wallet ? '' : '<div class="small" style="margin-top:8px">🌐 Event points need an internet connection.</div>'}
        <div class="ev-steps">${steps.map((r) => {
          const done = got.includes(r.step), ready = !done && pts >= r.at;
          const name = r.coins ? `${r.coins} coins` : this.rewardText(r);
          return `<div class="ev-step ${done ? 'got' : ''} ${ready ? 'ready' : ''}">${look(r)}<b>${esc(name)}</b><span class="small">${r.at} ⭐</span>${done ? '<span class="owned">✔ Claimed</span>' : ready ? `<button class="ws-btn on" data-evstep="${r.step}">Claim!</button>` : `<span class="small">${r.at - pts} ⭐ to go</span>`}</div>`;
        }).join('')}</div>
        <div class="small" style="margin-top:10px">These items are never sold in the Shop: get them before the event ends!</div>
        <h3>📅 Every year</h3><div class="ev-cal">${cal}</div></div>`;
      body.querySelectorAll('[data-evstep]').forEach((b) => (b.onclick = () => { b.disabled = true; this.net.send({ t: 'eventClaim', step: +b.dataset.evstep }); }));
    }

    // ======================= Cog Pass: 30 free tiers each 4-week season (js/economy.js) =======================
    canRanked() { return !!this.me && (this.me.best | 0) >= CW.ECON.RANKED.unlockAt; }
    passReady() {
      const w = this.wallet;
      if (!w) return 0;
      return CW.ECON.passRewards(w.pass.s).filter((r) => r.at <= w.pass.pts && !w.pass.claimed.includes(r.tier)).length;
    }
    // a whole screen: your tier + how to earn points on top, then the 30 tiers as a track you scroll sideways
    passPanel(body) {
      const E = CW.ECON;
      const ss = E.season();
      if (!this.wallet) {
        body.innerHTML = `<div class="small">The Cog Pass is a free reward track that starts over every 4 weeks, with paints and trails you can't buy in the Shop. It needs an internet connection.</div>`;
        return;
      }
      const ps = this.wallet.pass;
      const list = E.passRewards(ps.s);
      const per = E.PASS.perTier, max = E.PASS.tiers;
      const tier = Math.min(max, Math.floor(ps.pts / per));
      const into = tier >= max ? per : ps.pts - tier * per;
      const hex = (c) => '#' + c.toString(16).padStart(6, '0');
      const what = (r) => (r.paints ? ['paints', r.paints] : r.trails ? ['trails', r.trails] : r.avatars ? ['avatars', r.avatars] : null);
      const look = (r) => {
        const it = what(r);
        if (!it) return `<div class="pt-pic coin">🪙</div><small>${r.coins} coins</small>`;
        const x = E.item(it[0], it[1]);
        const pic = it[0] === 'paints' ? `<div class="pt-pic swatch tex" style="background:${hex(x.color)} url(${CW.texURL('panel')}) center/160% auto;background-blend-mode:multiply"></div>`
          : it[0] === 'trails' ? `<div class="pt-pic swatch trail" style="background:linear-gradient(90deg,${x.colors.map(hex).join(',')})"><i></i><i></i><i></i></div>` : `<div class="pt-pic av">${CW.avatar(x.idx)}</div>`;
        return `${pic}<small>${x.name}<br><span>${{ paints: 'Paint', trails: 'Dash trail', avatars: 'Avatar' }[it[0]]}${r.coins ? ` + 🪙${r.coins}` : ''}</span></small>`;
      };
      const ready = list.filter((r) => ps.pts >= r.at && !ps.claimed.includes(r.tier));
      const next = list.find((r) => ps.pts < r.at);
      const nextBig = list.find((r) => ps.pts < r.at && what(r));
      const nextName = (r) => { const it = what(r); return it ? E.item(it[0], it[1]).name : `🪙 ${r.coins}`; };
      // the line under the tier numbers: filled up to your points (each tier column is W wide with a G gap)
      const W = 112, G = 10, PAD = 16;
      const fill = Math.max(0, Math.min(PAD + (max - 1) * (W + G) + W / 2, PAD + (ps.pts / per - 1) * (W + G) + W / 2));
      const old = body.querySelector('.pt-scroll');
      const keep = old ? old.scrollLeft : null;
      body.innerHTML = `
        <div class="pass-top">
          <div class="pass-me">
            <div class="pass-badge"><small>Tier</small><b>${tier}</b></div>
            <div class="pass-prog">
              <div class="pass-season">Season ${ps.s} · ends in ${CW.timeLeft(ss.end - Date.now())}</div>
              <div class="pass-bar2"><i style="width:${Math.round((into / per) * 100)}%"></i><span>${tier >= max ? 'All tiers done!' : `${into} / ${per} points`}</span></div>
              <div class="pass-next">${tier >= max ? 'You finished this season\'s pass. New rewards next season!' : `<b>${per - into}</b> more points to <b>tier ${tier + 1}</b> (${nextName(next)})`}${nextBig && nextBig !== next ? ` · ★ ${nextName(nextBig)} at tier ${nextBig.tier}` : ''}</div>
            </div>
            ${ready.length ? `<button class="ws-btn on pass-claimall" id="passClaimAll">🎁 Claim ${ready.length > 1 ? `all ${ready.length}` : 'reward'}</button>` : ''}
          </div>
          <div class="pass-how">
            <b>How to tier up</b>
            <div class="pass-ways">
              <button data-way="play"><i>🎮</i>Play matches<em>up to +${E.PASS.match}</em></button>
              <button data-way="challenges"><i>🎯</i>Daily challenges<em>+${E.PASS.challenge} each</em></button>
              <button data-way="gift"><i>🎁</i>Daily gift<em>+${E.PASS.gift}</em></button>
            </div>
            <small>Every ${per} points = 1 tier. Wins, featured and weekly events give the most points.</small>
          </div>
        </div>
        <div class="pt-scroll"><div class="pt-track" style="--w:${W}px;--g:${G}px;--pad:${PAD}px;width:${PAD * 2 + max * W + (max - 1) * G}px">
          <div class="pt-line"><i style="width:${fill}px"></i></div>
          ${list.map((r) => {
            const reached = ps.pts >= r.at, claimed = ps.claimed.includes(r.tier);
            const st = claimed ? 'claimed' : reached ? 'ready' : r.tier === tier + 1 ? 'next' : 'locked';
            const act = claimed ? '<span class="pt-done">✔ Claimed</span>'
              : reached ? `<button class="ws-btn on" data-tier="${r.tier}">Claim</button>`
                : `<span class="pt-lock">🔒 ${r.at - ps.pts} pts to go</span>`;
            return `<div class="pt-col ${st} ${r.tier % 5 === 0 ? 'big' : ''}" data-col="${r.tier}"><div class="pt-node">${r.tier}</div><div class="pt-card">${r.tier % 5 === 0 ? '<em>★</em>' : ''}${look(r)}</div>${act}</div>`;
          }).join('')}
        </div></div>`;
      const sc = body.querySelector('.pt-scroll');
      // first look: your next tier in the middle; after a claim: stay where you were
      sc.scrollLeft = keep !== null ? keep : Math.max(0, PAD + tier * (W + G) + W / 2 - sc.clientWidth / 2);
      // a mouse wheel scrolls the track sideways, and so does holding the left button and dragging (like a finger)
      sc.onwheel = (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { sc.scrollLeft += e.deltaY; e.preventDefault(); } };
      sc.onpointerdown = (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen' || e.button !== 0) return; // touch screens scroll by themselves
        const x0 = e.clientX, left0 = sc.scrollLeft;
        let moved = false;
        const move = (ev) => {
          const dx = ev.clientX - x0;
          if (!moved && Math.abs(dx) > 4) { moved = true; sc.classList.add('dragging'); }
          if (moved) sc.scrollLeft = left0 - dx;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          sc.classList.remove('dragging');
          // a drag isn't a click: the Claim button under the mouse stays untouched
          if (moved) window.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      // how to tier up: each way takes you there
      body.querySelectorAll('[data-way]').forEach((b) => (b.onclick = () => {
        const way = b.dataset.way, meta = this.game.meta;
        if (way === 'challenges') return meta.openPanel('challenges');
        if (way === 'gift') return meta.openPanel('shop'); // the daily gift is at the top of the Shop
        meta.closePanel();
        if (this.game.state !== 'menu') this.game.showMenu();
        this.game.hintPlay();
      }));
      const claim = (t) => this.net.send({ t: 'passClaim', tier: t });
      body.querySelectorAll('[data-tier]').forEach((b) => (b.onclick = () => { b.disabled = true; claim(+b.dataset.tier); }));
      if ($('passClaimAll')) $('passClaimAll').onclick = () => {
        $('passClaimAll').disabled = true;
        this.passBatch = { left: ready.length, n: ready.length };
        ready.forEach((r) => claim(r.tier));
      };
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
      const wreck = (r.wreck || r.wrecks) && CW.SHOP.wrecks.find((x) => x.id === (r.wreck || r.wrecks));
      if (wreck) parts.push(`${wreck.icon} ${wreck.name} wreck effect`);
      for (const [one, kind, word] of [['finish', 'finishes', 'finish'], ['super', 'supers', 'super'], ['gadget', 'gadgets', 'gadget'], ['perk', 'perks', 'perk']]) {
        const it = (r[one] || r[kind]) && CW.SHOP[kind].find((x) => x.id === (r[one] || r[kind]));
        if (it) parts.push(`${it.icon} ${it.name} ${word}`);
      }
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
    rerender() { const k = this.game.meta.panel; if (!$('panel').classList.contains('hidden') && ['profile', 'friends', 'road', 'top', 'player', 'clubs'].includes(k)) this.game.meta.renderPanel(); }
    renderPanel(k, body) {
      if (k === 'profile') return this.profilePanel(body);
      if (k === 'friends') return this.friendsPanel(body);
      if (k === 'road') return this.roadPanel(body);
      if (k === 'top') return this.topPanel(body);
      if (k === 'player') return this.playerPanel(body);
      if (k === 'clubs') return this.clubsPanel(body);
    }
    // ======================= clubs =======================
    // v1.9.4: simpler club screens: a header with the actions, plain lists, small icon buttons, settings folded away
    clubsPanel(body) {
      const net = this.net;
      if (!this.me) { body.innerHTML = '<div class="small">Log in to join a club.</div>'; return; }
      const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); fn(b); }));
      const canJoin = (cl) => cl.open && cl.members < 30 && (this.me.tro | 0) >= cl.minTro;
      const facts = (cl) => `<span>🏆 ${cl.tro}</span><span>👥 ${cl.members}/30</span>${cl.open ? '' : '<span>🔒 Closed</span>'}${cl.minTro ? `<span>Needs 🏆 ${cl.minTro}</span>` : ''}`;
      const row = (cl) => `<div class="club-row cl-pick" data-peek="${esc(cl.id)}" role="button" tabindex="0" aria-label="See ${esc(cl.name)}"><span class="cl-face">${CW.clubFace(cl)}</span><span class="cl-txt"><b>${esc(cl.name)}</b><small class="cl-facts">${facts(cl)}</small></span>${canJoin(cl) ? `<button class="pill go" data-join="${esc(cl.id)}">Join</button>` : ''}<span class="cl-arrow">›</span></div>`;
      const iOwn = (cl) => cl.list.some((x) => x.name === this.me.name && x.role === 'owner');
      // v1.9.7: each member shows when they were last online; club-mates get Direct Message (and Call while online)
      const seen = (p) => `<small class="cl-last"><i class="cl-dot ${p.on ? 'on' : ''}"></i>${p.on ? 'Online' : p.seen ? `Last online ${CW.ago(p.seen)}` : 'Offline'}</small>`;
      const members = (cl, mine) => cl.list.map((p) => {
        const other = mine && p.name !== this.me.name;
        return `<div class="club-row cl-member"><span class="cl-face">${CW.face(p)}</span><span class="cl-who"><b class="fr-name" data-view="${esc(p.name)}">${esc(p.name)}${p.role === 'owner' ? ' 👑' : ''}</b>${seen(p)}</span><span class="cl-meta">🏆 ${p.tro}</span>${other && p.on ? `<button class="pill line" data-call="${esc(p.name)}" aria-label="Call ${esc(p.name)}">${CW.ICON.phone} Call</button>` : ''}${other ? `<button class="pill line" data-dm="${esc(p.name)}">Direct Message</button>` : ''}${other && iOwn(this.club) ? `<button class="pill icon quiet" data-kick="${esc(p.name)}" aria-label="Remove from the club">✕</button>` : ''}</div>`;
      }).join('');
      // the owner clicks the club's picture to change or reset it (v1.9.7: no separate buttons)
      const head = (cl, acts, edit) => `<div class="club-card cl-head"><span class="club-badge ${edit ? 'cl-pic-edit' : ''}" ${edit ? 'id="clPicBtn" role="button" tabindex="0" aria-label="Change the club picture"' : ''}>${CW.clubFace(cl)}${edit ? '<i class="cl-pic-ico">📷</i>' : ''}</span>
        ${edit ? `<div class="cl-picmenu ${this.clPicMenu ? '' : 'hidden'}" id="clPicMenu"><button class="pill line" id="clPicNew">📷 ${cl.pv ? 'Change picture' : 'Upload a picture'}</button>${cl.pv ? '<button class="pill line" id="clPicDel">↺ Reset picture</button>' : ''}</div>` : ''}
        <div class="cl-txt"><b class="cl-name">${esc(cl.name)}</b>${cl.desc ? `<div class="cl-desc">${esc(cl.desc)}</div>` : ''}<small class="cl-facts">${facts(cl)}</small></div>${acts || ''}</div>`;
      if (this.club) {
        const cl = this.club;
        const owner = iOwn(cl);
        // the club's chat opens with 💬 Club chat (v1.9.5: no preview here)
        const unread = this.game.talk.unreadIn('club');
        // v1.9.7: the club chat sits on the left under the club, above the members
        body.innerHTML = head(cl, '', owner) + `<div class="cl-chatrow"><button class="pill soft" id="clChat">💬 Club chat${unread ? `<i class="badge inline">${unread}</i>` : ''}</button></div>
          <h3>Members <span class="small">${cl.members}/30</span></h3><div class="cl-list">${members(cl, true)}</div>
          ${owner ? `<details class="cl-settings" id="clSet" ${this.clSetOpen ? 'open' : ''}><summary>⚙ Club settings</summary>
            <div class="cl-grid cl-edit"><input id="clNameEdit" maxlength="20" placeholder="Club name" aria-label="Club name" value="${esc(cl.name)}"><select id="clOpen"><option value="1" ${cl.open ? 'selected' : ''}>🔓 Open: anyone can join</option><option value="0" ${cl.open ? '' : 'selected'}>🔒 Closed</option></select>
            <select id="clMin">${[0, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000].map((v) => `<option value="${v}" ${v === cl.minTro ? 'selected' : ''}>Needs 🏆 ${v}</option>`).join('')}</select>
            <input id="clDesc" class="cl-desc-in" maxlength="80" placeholder="Description" aria-label="Description" value="${esc(cl.desc || '')}"><button class="pill go" id="clSave">Save</button></div>
            <div class="small cl-pic-tip">Click the club's picture to change or reset it.</div>
          </details>` : ''}
          <div class="cl-foot"><button class="pill quiet" id="clLeave">Leave club</button></div>`;
        $('clChat').onclick = () => this.game.talk.open('club');
        on('[data-dm]', (b) => this.game.talk.openDm(b.dataset.dm));
        on('[data-call]', (b) => this.game.calls.start(b.dataset.call));
        if (owner) {
          $('clSet').ontoggle = () => { this.clSetOpen = $('clSet').open; }; // stays open when the list updates
          const menu = (open) => { this.clPicMenu = open; if ($('clPicMenu')) $('clPicMenu').classList.toggle('hidden', !open); };
          $('clPicBtn').onclick = (e) => { e.stopPropagation(); menu(!this.clPicMenu); };
          $('clPicBtn').onkeydown = (e) => { if (e.key === 'Enter') $('clPicBtn').click(); };
          $('clPicNew').onclick = (e) => { e.stopPropagation(); menu(false); CW.pickPicture((data) => net.send({ t: 'picSet', kind: 'c', data })); };
          if ($('clPicDel')) $('clPicDel').onclick = (e) => { e.stopPropagation(); menu(false); net.send({ t: 'picSet', kind: 'c', data: null }); };
          body.onclick = (e) => { if (this.clPicMenu && !e.target.closest('#clPicMenu')) menu(false); }; // (the panel's body is shared: menu() checks it's still there)
        }
        on('[data-kick]', (b) => this.game.meta.ask(`Remove ${b.dataset.kick} from the club?`, 'They can join again later if the club is open.', 'Remove', () => net.send({ t: 'clubKick', name: b.dataset.kick })));
        on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'clubs'));
        $('clLeave').onclick = () => this.game.meta.ask(`Leave ${cl.name}?`, owner && cl.members > 1 ? 'The member with the most trophies becomes the owner.' : '', 'Leave', () => net.send({ t: 'clubLeave' }));
        if (owner) $('clSave').onclick = () => net.send({ t: 'clubEdit', name: $('clNameEdit').value, open: $('clOpen').value === '1', minTro: +$('clMin').value, desc: $('clDesc').value, badge: cl.badge });
        return;
      }
      if (this.peek) {
        const cl = this.peek;
        body.innerHTML = `<button class="pill quiet cl-back" id="clBack">← All clubs</button>` + head(cl, canJoin(cl) ? `<div class="cl-acts"><button class="pill go" data-join="${esc(cl.id)}">Join</button></div>` : '') + `<h3>Members <span class="small">${cl.members}/30</span></h3><div class="cl-list">${members(cl, false)}</div>`;
        $('clBack').onclick = () => { this.peek = null; this.rerender(); };
        on('[data-join]', (b) => net.send({ t: 'clubJoin', id: b.dataset.join }));
        on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'clubs'));
        return;
      }
      if (!this.clubs) net.send({ t: 'clubList' });
      this.newBadge = this.newBadge | 0;
      body.innerHTML = `<div class="small">Clubs are teams of up to 30 players. Your trophies count toward your club's total, and you can cheer each other on the club wall.</div>
        <div class="cl-search"><input id="clQ" maxlength="20" placeholder="Search clubs"><button class="pill" id="clFind">🔍 Search</button></div>
        <div class="cl-list">${(this.clubs || []).map(row).join('') || '<div class="small">No clubs yet. Start the first one!</div>'}</div>
        <h3>Start a club</h3>
        <div class="cl-new">
          <div class="cl-grid two"><input id="clName" maxlength="20" placeholder="Club name"><input id="clNewDesc" maxlength="80" placeholder="Description (optional)"></div>
          <div class="cl-badges">${CW.CLUB_BADGES.map((b, i) => `<button class="cl-badge ${i === this.newBadge ? 'on' : ''}" data-badge="${i}" aria-label="Badge">${b}</button>`).join('')}</div>
          <button class="pill go" id="clCreate">🛡 Create club</button>
        </div>`;
      $('clFind').onclick = () => net.send({ t: 'clubList', q: $('clQ').value });
      $('clQ').onkeydown = (e) => { if (e.key === 'Enter') $('clFind').click(); };
      on('[data-badge]', (b) => { this.newBadge = +b.dataset.badge; body.querySelectorAll('[data-badge]').forEach((x) => x.classList.toggle('on', x === b)); });
      on('[data-peek]', (b) => net.send({ t: 'clubInfo', id: b.dataset.peek }));
      body.querySelectorAll('[data-peek]').forEach((b) => (b.onkeydown = (e) => { if (e.key === 'Enter') b.click(); }));
      on('[data-join]', (b) => net.send({ t: 'clubJoin', id: b.dataset.join }));
      $('clCreate').onclick = () => net.send({ t: 'clubCreate', name: $('clName').value, desc: $('clNewDesc').value, badge: this.newBadge, open: true });
    }
    // v1.9.5: your profile: a banner with your picture, the default pictures to pick from, and your stats (5 × 3).
    // The account things (email, username, password, log out, delete) live in Settings › Account (accountHtml)
    heroHtml(p, opts = {}) {
      const t = CW.tier(p.tro), rk = p.rp != null ? CW.ECON.RANKED.rank(p.rp) : null;
      const tag = (label, value) => `<span class="pf-tag"><small>${label}</small><b>${value}</b></span>`;
      // v1.10.3: on your own profile the picture itself is the button (a small menu: upload a new one / remove it)
      const pic = opts.edit ? `<div class="pf-pic can-edit ${opts.status || ''}" id="pfPicBtn" role="button" tabindex="0" aria-label="Change your picture">${opts.face || CW.face(p)}</div>` : `<div class="pf-pic ${opts.status || ''}">${opts.face || CW.face(p)}</div>`;
      return `<div class="pf-hero ${opts.cls || ''}">${pic}
        <div class="pf-id"><div class="pf-name">${esc(p.name)}</div>${opts.sub ? `<div class="pf-sub">${opts.sub}</div>` : ''}${opts.facts ? `<div class="pf-facts">${opts.facts}</div>` : ''}
        ${opts.tags === false ? '' : `<div class="pf-tags">${tag('Trophies', `${t.icon} ${p.tro}`)}${tag('Best', p.best)}${tag('Level', p.lv || 1)}${rk ? tag('Ranked', `${rk.icon} ${rk.name}`) : ''}</div>`}${opts.under || ''}</div>${opts.acts || ''}</div>`;
    }
    profilePanel(body) {
      const g = this.game;
      if (!this.me) {
        body.innerHTML = `<div class="pf-guest"><span>Playing as a guest: your progress is saved on this device only.</span><button class="set-btn go" id="profLogin">Log in or sign up</button></div><h3>Stats</h3>${g.meta.statsHtml()}`;
        $('profLogin').onclick = () => { g.meta.closePanel(); this.openLogin(); };
        return;
      }
      const me = this.me;
      const kids = this.game.talk.mode === 'quick';
      // v1.10.3: picture changes are a draft (pfDraft { av, pic: base64 | null = remove }) until you press Save
      const d = this.pfDraft || {};
      const av = d.av !== undefined ? d.av : me.av | 0;
      const own = !kids && (d.pic !== undefined ? !!d.pic : !!me.pv);
      const ownFace = d.pic ? `<img class="pfp" src="data:image/jpeg;base64,${d.pic}" alt="" draggable="false">` : CW.face(me);
      const face = own ? ownFace : CW.avatar(av);
      const menu = kids ? '' : `<div class="pf-picmenu ${this.pfMenu ? '' : 'hidden'}" id="pfPicMenu"><button class="set-btn" id="pfUpload">📷 ${own ? 'Upload a new picture' : 'Upload your own picture'}</button>${own ? '<button class="set-btn" id="pfRemove">✕ Remove it (use a preset)</button>' : ''}</div>`;
      const dirty = !!this.pfDraft;
      body.innerHTML = `<div class="pf-wrap">${this.heroHtml(me, { edit: !kids, face, sub: me.club ? `🛡 ${esc(me.club)}` : '' })}${menu}</div>` + `
        <h3>Profile picture</h3>
        <div class="pf-pics">
          ${own ? `<button class="pf-pick own on" id="pfOwn" aria-label="Your own picture">${ownFace}</button>` : ''}
          ${CW.AVATARS.map((a, i) => `<button class="pf-pick ${!own && av % CW.AVATARS.length === i ? 'on' : ''}" data-av="${i}" aria-label="Default picture ${i + 1}">${a}</button>`).join('')}
        </div>
        <div class="pf-pic-note">${kids ? '<span>Own pictures are off with Quick chat only (Settings › Chat).</span>' : ''}<button class="set-btn" id="pfAccount">⚙ Account settings</button></div>
        <h3>Stats</h3>${g.meta.statsHtml()}
        <div class="pf-foot">${dirty ? '<span class="pf-unsaved">Not saved yet</span>' : ''}${dirty ? '<button class="set-btn" id="pfUndo">Undo</button>' : ''}<button class="set-btn go" id="pfSave" ${dirty ? '' : 'disabled'}>Save</button></div>`;
      const set = (ch) => { this.pfDraft = Object.assign({}, this.pfDraft, ch); this.pfMenu = false; this.rerender(); };
      // a preset: also drops your own picture (only once you press Save)
      body.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => set(Object.assign({ av: +b.dataset.av }, own ? { pic: null } : {}))));
      const menuOpen = (open) => { this.pfMenu = open; if ($('pfPicMenu')) $('pfPicMenu').classList.toggle('hidden', !open); };
      if ($('pfPicBtn')) {
        $('pfPicBtn').onclick = (e) => { e.stopPropagation(); menuOpen(!this.pfMenu); };
        $('pfPicBtn').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('pfPicBtn').click(); } };
        $('pfUpload').onclick = (e) => { e.stopPropagation(); menuOpen(false); CW.pickPicture((data) => data && set({ pic: data })); };
        if ($('pfRemove')) $('pfRemove').onclick = (e) => { e.stopPropagation(); set({ pic: null }); };
        body.onclick = (e) => { if (this.pfMenu && !e.target.closest('#pfPicMenu')) menuOpen(false); };
      }
      if ($('pfOwn')) $('pfOwn').onclick = () => menuOpen(true);
      $('pfAccount').onclick = () => { g.meta.setTab = 'account'; g.meta.openPanel('settings'); };
      $('pfSave').onclick = () => this.saveProfileDraft();
      if ($('pfUndo')) $('pfUndo').onclick = () => { this.pfDraft = null; this.rerender(); };
    }
    // the profile's Save: send what changed (a preset, a new picture, or removing it)
    saveProfileDraft() {
      const d = this.pfDraft;
      this.pfDraft = null;
      this.pfMenu = false;
      if (!d || !this.me) return;
      if (d.av !== undefined && d.av !== (this.me.av | 0)) this.net.send({ t: 'profileSet', av: d.av });
      if (d.pic !== undefined) this.net.send({ t: 'picSet', kind: 'u', data: d.pic });
      this.game.toast('✔ Profile saved');
      this.rerender();
    }
    // Settings › Account: who you are, email, username, password, log out, delete (minimal rows like the rest of Settings)
    accountHtml() {
      if (!this.me) return `<div class="set-row"><span>Playing as a guest<small>Progress is saved on this device only. An account keeps it on every device.</small></span><button class="set-btn go" id="acLogin">Log in / Sign up</button></div>`;
      const me = this.me;
      return `<div class="set-row"><span>Logged in as <b>${esc(me.name)}</b><small>${this.sync.dirty ? 'Backing up your progress…' : 'Your progress is backed up: log in on any device to play with it'}</small></span><button class="set-btn" id="acProfile">Profile</button></div>
        ${this.mailLogin() ? `<div class="set-row"><span>Email<small>${this.myEmail ? `You log in with <span translate="no">${esc(CW.hideEmail(this.myEmail))}</span>` : 'None yet: add one so you can always log in'}</small></span><button class="set-btn" data-acform="linkForm">${this.myEmail ? 'Change' : 'Add'}</button></div>
        <form id="linkForm" class="set-form ${this.linkStep ? '' : 'hidden'}">${this.linkStep === 'code'
          ? '<input id="linkCode" inputmode="numeric" maxlength="6" placeholder="Code from the email"><button class="set-btn go">Confirm</button>'
          : `<input id="linkMail" type="email" maxlength="254" placeholder="New email address" value=""><button class="set-btn go">Send a code</button>`}</form>` : ''}
        <div class="set-row"><span>Username<small>You can change it once a week</small></span><button class="set-btn" data-acform="profRenameForm">Change</button></div>
        <form id="profRenameForm" class="set-form hidden"><input id="prName" maxlength="16" autocomplete="off" spellcheck="false" placeholder="New username" value="${esc(me.name)}"><button class="set-btn go">Save</button><div class="small">3-16 letters, numbers or _. Friends, clubs and messages keep working.</div></form>
        ${this.hasPass ? `<div class="set-row"><span>Password<small>Other devices are logged out when you change it</small></span><button class="set-btn" data-acform="profPassForm">Change</button></div>
        <form id="profPassForm" class="set-form hidden"><input type="password" id="ppOld" placeholder="Current password" autocomplete="current-password"><input type="password" id="ppNew" placeholder="New password (6+)" autocomplete="new-password"><button class="set-btn go">Save</button></form>` : ''}
        <div class="set-row"><span>Log out<small>On this device</small></span><button class="set-btn" id="profOut">Log out</button></div>
        <div class="set-row"><span>Delete account<small>Removes your account, trophies, friends and cloud backup forever</small></span><button class="set-btn bad" data-acform="profDelForm">Delete…</button></div>
        <form id="profDelForm" class="set-form hidden"><input type="${this.hasPass ? 'password' : 'text'}" id="pdPass" placeholder="${this.hasPass ? 'Your password' : 'Type your username to confirm'}" autocomplete="off"><button class="set-btn bad">Delete my account</button></form>`;
    }
    // redraw Settings › Account when something there changed (email code sent, renamed…)
    renderAccountBox() {
      const box = $('setAcctBox');
      if (!box) return;
      box.innerHTML = this.accountHtml();
      this.bindAccount(box);
    }
    bindAccount(root) {
      const g = this.game, me = this.me;
      const q = (id) => root.querySelector('#' + id);
      if (q('acLogin')) q('acLogin').onclick = () => { g.meta.closePanel(); this.openLogin(); };
      if (!me) return;
      q('acProfile').onclick = () => g.meta.openPanel('profile');
      root.querySelectorAll('[data-acform]').forEach((b) => (b.onclick = () => {
        const f = q(b.dataset.acform);
        f.classList.toggle('hidden');
        const inp = f.querySelector('input');
        if (inp && !f.classList.contains('hidden')) { inp.focus(); if (inp.select) inp.select(); }
      }));
      q('profOut').onclick = () => { this.logout(); this.renderAccountBox(); };
      q('profRenameForm').onsubmit = (e) => {
        e.preventDefault();
        const name = q('prName').value.trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return g.toast('Usernames are 3-16 letters, numbers or _');
        this.net.send({ t: 'acctRename', name });
      };
      if (q('linkForm')) q('linkForm').onsubmit = (e) => {
        e.preventDefault();
        if (this.linkStep === 'code') return this.net.send({ t: 'emailCode', email: this.linkMail, code: q('linkCode').value.trim() });
        this.linkMail = q('linkMail').value.trim();
        this.linkStep = 'code';
        this.net.send({ t: 'emailStart', email: this.linkMail });
        this.renderAccountBox();
      };
      if (q('profPassForm')) q('profPassForm').onsubmit = (e) => {
        e.preventDefault();
        if (q('ppNew').value.length < 6) return g.toast('New passwords need at least 6 characters');
        this.net.send({ t: 'acctPass', old: q('ppOld').value, pass: q('ppNew').value });
        q('profPassForm').reset();
        q('profPassForm').classList.add('hidden');
      };
      q('profDelForm').onsubmit = (e) => {
        e.preventDefault();
        const pass = q('pdPass').value;
        if (!pass) return;
        g.meta.ask(`Delete ${me.name} forever?`, 'Your account, trophies, friends and cloud backup are removed. This cannot be undone.', 'Delete', () => {
          this.net.send({ t: 'acctDelete', pass });
          q('pdPass').value = '';
        });
      };
    }
    // someone else's profile (v1.9.5): a banner with their picture and whether they're online, big number cards,
    // their club and when they joined; Add friend / Message right on the banner
    playerPanel(body) {
      const p = this.viewing;
      if (!p) { body.innerHTML = '<div class="small">Loading…</div>'; return; }
      const isFriend = this.friends.some((f) => f.name === p.name);
      const isMe = this.me && this.me.name === p.name;
      // v1.10.3: Message / Add friend under the name; "Friends ▾" is the window's title (remove / block)
      const acts = isMe || !this.me ? '' : `<div class="pf-acts">${isFriend ? '<button class="set-btn" id="plMsg">💬 Message</button>' : '<button class="set-btn go" id="plAdd">＋ Add friend</button>'}</div>`;
      const sub = `<span class="pf-online ${p.online ? 'on' : ''}"><i></i>${p.online ? 'Online' : 'Offline'}</span>${p.rank ? `<span>#${p.rank} in the world</span>` : ''}`;
      const wr = p.played ? Math.round((p.wins / p.played) * 100) + '%' : '—';
      const t = CW.tier(p.tro), rk = p.rp != null ? CW.ECON.RANKED.rank(p.rp) : null;
      const card = (label, value, extra) => `<div class="pp-card"><small>${label}</small><b>${value}</b>${extra ? `<span>${extra}</span>` : ''}</div>`;
      const since = p.created ? new Date(p.created).toLocaleDateString([], { year: 'numeric', month: 'long' }) : '';
      // their club and when they started: small, under the name
      const facts = (p.club ? `<span><span class="pp-cf">${p.clubFace ? CW.clubFace(p.clubFace) : '🛡'}</span> ${esc(p.club)}</span>` : '') + (since ? `<span>📅 <span>Playing since</span> ${since}</span>` : '');
      body.innerHTML = `<div class="pp">${this.heroHtml(p, { cls: 'pp-hero', status: p.online ? 'on' : '', sub, facts, under: acts, tags: false })}
        <div class="pp-cards">${card('Trophies', p.tro, `${t.icon} ${t.name} · best ${p.best}`)}${card('Level', p.lv || 1)}${card('Wins', p.wins, `${p.played} played`)}${card('Win rate', wr, rk ? `Ranked: ${rk.icon} ${rk.name}` : '')}</div>
        <div class="pf-foot left"><button class="set-btn" id="plBack">← Back</button></div></div>`;
      if ($('plAdd')) $('plAdd').onclick = () => { this.net.send({ t: 'friendAdd', name: p.name }); $('plAdd').disabled = true; $('plAdd').textContent = 'Request sent'; };
      if ($('plMsg')) $('plMsg').onclick = () => this.game.talk.openDm(p.name);
      $('plBack').onclick = () => this.game.meta.openPanel(this.backTo || 'friends');
      // the title: "Player", or "Friends ▾" for a friend: remove them, or block them
      const title = $('panelTitle'), box = $('panelBody').parentElement;
      const old = box.querySelector('.pp-menu');
      if (old) old.remove();
      if (!isFriend || isMe) { title.textContent = '👤 Player'; return; }
      title.innerHTML = '<button class="pp-friends" id="ppFriends" aria-label="Friends: remove or block">✓ <span>Friends</span> ▾</button>';
      const menu = document.createElement('div');
      menu.className = 'pp-menu hidden';
      menu.innerHTML = `<button class="set-btn" id="ppRemove">Remove from friends</button><button class="set-btn bad" id="ppBlock">${this.game.talk.isBlocked(p.name) ? 'Unblock' : 'Block'}</button>`;
      box.appendChild(menu);
      const show = (on) => menu.classList.toggle('hidden', !on);
      $('ppFriends').onclick = (e) => { e.stopPropagation(); show(menu.classList.contains('hidden')); };
      if (!box.ppClick) box.ppClick = box.addEventListener('click', (e) => { const m = box.querySelector('.pp-menu'); if (m && !e.target.closest('.pp-menu') && !e.target.closest('#ppFriends')) m.classList.add('hidden'); }) || 1;
      $('ppRemove').onclick = () => { show(false); this.game.meta.ask(`Remove ${p.name} from your friends?`, '', 'Remove', () => this.net.send({ t: 'friendRemove', name: p.name })); };
      $('ppBlock').onclick = () => {
        show(false);
        const blocked = this.game.talk.isBlocked(p.name);
        if (blocked) return this.net.send({ t: 'unblock', name: p.name });
        this.game.meta.ask(`Block ${p.name}?`, "You won't see their messages or calls. You can unblock them in Settings › Chat.", 'Block', () => this.net.send({ t: 'block', name: p.name }));
      };
    }
    showPlayer(name, back) { this.backTo = back; this.viewing = null; this.game.meta.openPanel('player'); this.net.send({ t: 'profile', name }); }
    friendsPanel(body) {
      if (!this.me) { body.innerHTML = `<div class="small">Log in to add friends and make a party.</div>`; return; }
      const net = this.net;
      const inRoom = net.room && net.room.state === 'lobby';
      const party = this.party;
      const inParty = (n) => party && party.members.some((m) => m.name === n);
      const order = this.friends.slice().sort((a, b) => (b.on - a.on) || b.tro - a.tro);
      body.innerHTML = `<form id="frForm" class="fr-add"><input id="frName" maxlength="16" placeholder="Friend's username" spellcheck="false" autocomplete="off"><button class="ws-btn on">➕ Add friend</button></form>
        <div class="small">Your username is <b>${esc(this.me.name)}</b>: tell your friends so they can add you.</div>` +
        (this.reqIn.length ? `<h3>Requests</h3>${this.reqIn.map((n) => `<div class="fr-row"><b>${esc(n)}</b><span class="small">wants to be friends</span><button class="ws-btn on" data-acc="${esc(n)}">Accept</button><button class="ws-btn" data-dec="${esc(n)}">Decline</button></div>`).join('')}` : '') +
        `<h3>Friends (${this.friends.filter((f) => f.on).length} online / ${this.friends.length})</h3>` +
        (order.length ? order.map((f) => `<div class="fr-row ${f.on ? 'on' : ''}"><span class="av">${CW.face(f)}</span><b class="fr-name" data-view="${esc(f.name)}">${esc(f.name)}</b>
          <span class="small">${f.on ? STATUS[f.st] || '🟢 Online' : '⚫ Offline'} · 🏆 ${f.tro}</span>
          ${f.on && !inParty(f.name) ? `<button class="ws-btn" data-party="${esc(f.name)}" aria-label="Invite to your party">🎉 Party</button>` : ''}
          ${f.on && inRoom ? `<button class="ws-btn" data-inv="${esc(f.name)}" aria-label="Invite to the room you're in">📨 Invite</button>` : ''}
          ${f.room && (!net.room || net.room.code !== f.room) ? `<button class="ws-btn on" data-join="${esc(f.room)}" aria-label="Join their room">▶ Join</button>` : ''}
          ${f.watch ? `<button class="ws-btn on" data-watch="${esc(f.name)}" aria-label="Watch their match (they'll see you're watching)">👁 Watch</button>` : ''}
          ${f.on ? `<button class="ws-btn" data-call="${esc(f.name)}" aria-label="Call ${esc(f.name)}">${CW.ICON.phone} Call</button>` : ''}
          <button class="ws-btn" data-dm="${esc(f.name)}" aria-label="Message ${esc(f.name)}">💬 Message${this.game.talk.unread[f.name] ? ` <i class="badge inline">${this.game.talk.unread[f.name]}</i>` : ''}</button>
          <button class="ws-btn" data-rem="${esc(f.name)}" aria-label="Remove friend">✖</button></div>`).join('') : '<div class="small">No friends yet. Add someone by their username!</div>') +
        (this.reqOut.length ? `<h3>Sent requests</h3>${this.reqOut.map((n) => `<div class="fr-row"><b>${esc(n)}</b><span class="small">waiting…</span><button class="ws-btn" data-dec="${esc(n)}">Cancel</button></div>`).join('')}` : '');
      $('frForm').onsubmit = (e) => { e.preventDefault(); const n = $('frName').value.trim(); if (n) net.send({ t: 'friendAdd', name: n }); $('frName').value = ''; };
      const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
      on('[data-acc]', (b) => net.send({ t: 'friendAccept', name: b.dataset.acc }));
      on('[data-dec]', (b) => net.send({ t: 'friendDecline', name: b.dataset.dec }));
      on('[data-party]', (b) => net.send({ t: 'partyInvite', name: b.dataset.party }));
      on('[data-inv]', (b) => net.send({ t: 'invite', name: b.dataset.inv }));
      on('[data-join]', (b) => { this.game.meta.closePanel(); net.openOnline(b.dataset.join); });
      on('[data-watch]', (b) => { this.game.meta.closePanel(); net.spectate(b.dataset.watch); });
      on('[data-rem]', (b) => this.game.meta.ask(`Remove ${b.dataset.rem} from your friends?`, '', 'Remove', () => net.send({ t: 'friendRemove', name: b.dataset.rem })));
      on('[data-call]', (b) => this.game.calls.start(b.dataset.call));
      on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'friends'));
      on('[data-dm]', (b) => this.game.talk.openDm(b.dataset.dm));
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
      const tabs = `<div class="menu-btns" style="justify-content:flex-start"><button class="ws-btn ${this.lbTab === 'global' ? 'on' : ''}" data-tab="global">🌍 World</button><button class="ws-btn ${this.lbTab === 'friends' ? 'on' : ''}" data-tab="friends">👥 Friends</button><button class="ws-btn ${this.lbTab === 'clubs' ? 'on' : ''}" data-tab="clubs">🛡 Clubs</button><button class="ws-btn ${this.lbTab === 'ranked' ? 'on' : ''}" data-tab="ranked">🏅 Ranked</button></div>`;
      if (this.lbTab === 'friends') body.innerHTML = tabs + (this.me ? friendsBoard() : '<div class="small">Log in to see your friends here.</div>');
      else if (this.lbTab === 'clubs') body.innerHTML = tabs + ((this.clubs || []).map((cl, i) => `<div class="fr-row lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span class="av">${CW.clubFace(cl)}</span><b class="fr-name">${esc(cl.name)}</b><span class="small">👥 ${cl.members}</span><b class="lb-tro">🏆 ${cl.tro}</b></div>`).join('') || '<div class="small">No clubs yet.</div>');
      else if (this.lbTab === 'ranked') { const r = this.topRanked; body.innerHTML = tabs + (!r ? '<div class="small">Loading…</div>' : `<div class="small">Season ${CW.ECON.season().id}: ${r.total} ranked players. Ranked unlocks at 🏆 ${CW.ECON.RANKED.unlockAt}.</div>` + (r.list.map((p, i) => this.lbRow(p, i + 1, true)).join('') || '<div class="small">Nobody has played Ranked this season yet.</div>')); }
      else if (!t) body.innerHTML = tabs + '<div class="small">Loading…</div>';
      else body.innerHTML = tabs + `<div class="small">${t.total} players. ${t.me ? `You are <b>#${t.me.rank}</b>.` : 'Log in to get on the board!'}</div>` + t.list.map((p, i) => this.lbRow(p, i + 1)).join('') + (t.me && t.me.rank > 50 ? '<div class="small">…</div>' + this.lbRow(t.me.card, t.me.rank) : '');
      body.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.lbTab = b.dataset.tab; if (this.lbTab === 'global') this.net.send({ t: 'top' }); if (this.lbTab === 'clubs') this.net.send({ t: 'clubList' }); if (this.lbTab === 'ranked') this.net.send({ t: 'top', kind: 'ranked' }); this.game.meta.renderPanel(); }));
      body.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => this.showPlayer(b.dataset.view, 'top')));
    }
    lbRow(p, rank, ranked) {
      if (ranked) { const rk = CW.ECON.RANKED.rank(p.rp); return `<div class="fr-row lb-row ${this.me && p.name === this.me.name ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][rank - 1] || '#' + rank}</span><span class="av">${CW.face(p)}</span><b class="fr-name" data-view="${esc(p.name)}">${esc(p.name)}</b><span class="small">${rk.icon} ${rk.name}</span><b class="lb-tro">🏅 ${p.rp}</b></div>`; }
      const me = this.me && p.name === this.me.name;
      const medal = ['🥇', '🥈', '🥉'][rank - 1] || '#' + rank;
      return `<div class="fr-row lb-row ${me ? 'me' : ''}"><span class="lb-rank">${medal}</span><span class="av">${CW.face(p)}</span><b class="fr-name" data-view="${esc(p.name)}">${esc(p.name)}${p.club ? `<span class="club-tag">${esc(p.club)}</span>` : ''}</b><span class="small">${CW.tier(p.tro).icon} ⭐${p.lv || 1}</span><b class="lb-tro">🏆 ${p.tro}</b></div>`;
    }
  }

  CW.Account = Account;
})();
