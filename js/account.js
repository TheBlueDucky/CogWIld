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
  // club badges
  CW.CLUB_BADGES = ['🛡', '⚙', '🔥', '⚡', '🐉', '🦅', '🌟', '💀', '👑', '🚀', '🌊', '🍀'];
  CW.avatar = (i) => CW.AVATARS[i] || '🧑‍✈️';
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
    if (t && t.classList && t.classList.contains('pfp')) t.replaceWith(document.createTextNode(t.dataset.badge != null ? CW.CLUB_BADGES[+t.dataset.badge] || '🛡' : CW.avatar(+t.dataset.av)));
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
      if (this.gSecret && this.view === 'gwait') this.net.send({ t: 'googleStart', s: this.gSecret }); // reconnected while signing in with Google
      this.helloGuest();
      // when the server can log people in by email or Google, everyone plays with an account
      // (not on game portals like Poki and CrazyGames, which don't allow a forced login)
      if (this.loginRequired()) this.openLogin('Log in to play. Your progress is saved to your account.');
    }
    mailLogin() { return !!this.loginOpts && !!(this.loginOpts.email || this.loginOpts.google); }
    loginRequired() { return !CW.PORTAL && !!this.loginOpts && !!(this.loginOpts.email || this.loginOpts.google) && !this.loggedIn; }
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
      if (g.talk.onMessage(m) || g.voice.onMessage(m)) return; // chat and voice chat
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
        case 'acctEmailSet': this.myEmail = m.email; g.toast(`📧 ${m.email} is now your login`); this.linkStep = null; this.rerender(); break;
        case 'guestOk':
          if (m.token) keep('cogwild.guest', m.token);
          this.guestOn = true;
          this.applyWallet(m.wallet);
          this.afterWallet();
          break;
        case 'acctOut':
          if (this.session) { this.session = null; keep('cogwild.session', null); }
          this.me = null;
          this.renderChips();
          g.voice.apply();
          if (m.reason) g.toast('👤 ' + m.reason);
          break;
        case 'acctErr':
          if ($('acctErr') && !$('acct').classList.contains('hidden')) { $('acctErr').textContent = m.msg; $('acctErr').classList.remove('ok'); }
          else g.toast('⚠ ' + m.msg);
          break;
        case 'acctMe': this.me = m.me; this.renderChips(); this.rerender(); break;
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
          if (g.settings.friendOnline !== false) for (const f of m.list) { const o = before.find((x) => x.name === f.name); if (o && !o.on && f.on) this.note(`${CW.avatar(f.av)} ${esc(f.name)} is online`); }
          this.renderChips();
          this.rerender();
          g.talk.refresh();
          break;
        }
        case 'party': this.party = m.party; this.renderParty(); this.rerender(); g.talk.refresh(); g.voice.apply(); break;
        case 'note': this.onNote(m); break;
        case 'trophies': this.onTrophies(m); break;
        case 'ranked': this.lastRanked = m; this.resultsLine(); break;
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
      bar.innerHTML = `<div class="pt-head"><b>🎉 Party ${p.members.length}/4</b><button class="link-btn" id="partyLeave">Leave</button></div>
        <div class="party-row">${p.members.map((f) => `<span class="party-m ${f.name === p.leader ? 'lead' : ''}" aria-label="${esc(f.name)}${f.name === p.leader ? ' (leader)' : ''}">${CW.face(f)}<small>${f.name === p.leader ? '👑 ' : ''}${esc(f.name)}</small></span>`).join('')}</div>
        <div class="small">${lead ? 'You lead: press PLAY and your party comes along.' : `${esc(p.leader)} picks the match. You'll follow them in.`}</div>`;
      $('partyLeave').onclick = () => this.net.send({ t: 'partyLeave' });
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
        const what = this.rewardText(Object.assign({ coins: m.reward.coins }, ...m.reward.got.map((x) => ({ [x.kind]: x.id }))));
        const batch = m.pass && this.passBatch && this.passBatch.n > 1 ? this.passBatch.n : 0;
        this.passBatch = null;
        g.audio.fanfare();
        g.toast(batch ? `🎁 Cog Pass: ${batch} rewards claimed!` : `🎁 ${m.road ? 'Trophy Road' : 'Cog Pass'}: ${what || 'claimed'}!`);
        g.workshop.buildPaint();
      }
      if (m.src === 'match' && m.pts && g.state === 'results') $('resPass').textContent = `🎟 +${m.pts} Cog Pass points`;
      this.renderChips();
      if (g.state === 'menu') g.meta.renderMenu();
      if (!$('panel').classList.contains('hidden') && ['shop', 'road', 'pass', 'profile'].includes(g.meta.panel)) g.meta.renderPanel();
      $('pCoins').textContent = g.profile.coins;
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
        body.innerHTML = `<div class="small">The Cog Pass is a free reward track that starts over every 4 weeks, with paints, trails and avatars you can't buy in the Shop. It needs an internet connection.</div>`;
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
    card(p, extra) {
      const t = CW.tier(p.tro);
      return `<div class="prof-card"><div class="prof-av">${CW.face(p)}</div><div class="prof-main"><div class="prof-name">${esc(p.name)}</div>
        <div class="prof-tier">${t.icon} ${t.name} · 🏆 <b>${p.tro}</b> <span class="small">(best ${p.best})</span></div>
        <div class="small">⭐ Level ${p.lv || 1} · ${p.wins} Quick Match wins · ${p.played} played${extra || ''}</div>${p.club ? `<div class="small">🛡 Club: <b>${esc(p.club)}</b></div>` : ''}${p.rp != null ? `<div class="small">🏅 Ranked: ${CW.ECON.RANKED.rank(p.rp).icon} ${CW.ECON.RANKED.rank(p.rp).name} · ${p.rp} RP</div>` : ''}</div></div>`;
    }
    // ======================= clubs =======================
    clubsPanel(body) {
      const g = this.game, net = this.net;
      if (!this.me) { body.innerHTML = '<div class="small">Log in to join a club.</div>'; return; }
      const badge = (i) => CW.CLUB_BADGES[i | 0] || '🛡';
      const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
      const row = (cl) => `<div class="club-row"><span style="font-size:26px">${CW.clubFace(cl)}</span><b>${esc(cl.name)}</b><span class="small">👥 ${cl.members}/30 · 🏆 ${cl.tro}${cl.minTro ? ` · needs ${cl.minTro}` : ''}${cl.open ? '' : ' · 🔒 closed'}</span>
        <button class="ws-btn" data-peek="${esc(cl.id)}">View</button>${cl.open && cl.members < 30 && (this.me.tro | 0) >= cl.minTro ? `<button class="ws-btn on" data-join="${esc(cl.id)}">Join</button>` : ''}</div>`;
      const members = (cl, mine) => cl.list.map((p) => `<div class="club-row"><span>${CW.face(p)}</span><b class="fr-name" data-view="${esc(p.name)}">${esc(p.name)}${p.role === 'owner' ? ' 👑' : ''}</b><span class="small">${p.on ? '🟢' : '⚫'} 🏆 ${p.tro}</span>${mine && p.name !== this.me.name ? `<button class="ws-btn dm-btn" data-dm="${esc(p.name)}" aria-label="Message ${esc(p.name)}">💬</button>` : ''}${mine && this.club.list.some((x) => x.name === this.me.name && x.role === 'owner') && p.name !== this.me.name ? `<button class="tod-btn" data-kick="${esc(p.name)}" aria-label="Remove from the club">✖</button>` : ''}</div>`).join('');
      const head = (cl) => `<div class="club-card"><span class="club-badge">${CW.clubFace(cl)}</span><div style="flex:1"><b style="font-size:20px">${esc(cl.name)}</b><div class="small">${esc(cl.desc || '')}</div><div class="small">🏆 <b>${cl.tro}</b> club trophies · 👥 ${cl.members}/30 · ${cl.open ? '🔓 open' : '🔒 closed'}${cl.minTro ? ` · needs 🏆 ${cl.minTro}` : ''}</div></div></div>`;
      if (this.club) {
        const cl = this.club;
        const owner = cl.list.some((x) => x.name === this.me.name && x.role === 'owner');
        // the last few club chat lines; the whole chat is in 💬
        const talk = this.game.talk;
        const log = (cl.log || []).filter((l) => !talk.isBlocked(l.f)).slice(-4).map((l) => (l.f ? `<div><b>${esc(l.f)}:</b> ${esc(talk.text(l))}</div>` : `<div class="small">${esc(talk.text(l))}</div>`)).join('') || '<div class="small">No messages yet.</div>';
        body.innerHTML = head(cl) + `<div class="club-chat" id="clubChat">${log}</div><div class="menu-btns" style="justify-content:flex-start"><button class="ws-btn" id="clChat">💬 Club chat</button></div>
          <h3>Members</h3>${members(cl, true)}
          ${owner ? `<h3>Club settings</h3><div class="club-form"><select id="clOpen"><option value="1" ${cl.open ? 'selected' : ''}>🔓 Open: anyone can join</option><option value="0" ${cl.open ? '' : 'selected'}>🔒 Closed</option></select>
            <select id="clMin">${[0, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000].map((v) => `<option value="${v}" ${v === cl.minTro ? 'selected' : ''}>Needs 🏆 ${v}</option>`).join('')}</select>
            <input id="clDesc" maxlength="80" placeholder="Description" value="${esc(cl.desc || '')}"><button class="ws-btn on" id="clSave">Save</button></div>
            <div class="club-form"><button class="ws-btn" id="clPic">📷 ${cl.pv ? 'Change' : 'Add'} club picture</button>${cl.pv ? '<button class="ws-btn" id="clPicDel">Remove picture</button>' : ''}<span class="small">A square picture shown as a circle instead of the badge</span></div>` : ''}
          <div class="menu-btns" style="justify-content:flex-start"><button class="ws-btn" id="clLeave">🚪 Leave club</button></div>`;
        const box = $('clubChat');
        box.scrollTop = box.scrollHeight;
        $('clChat').onclick = () => this.game.talk.open('club');
        on('[data-dm]', (b) => this.game.talk.openDm(b.dataset.dm));
        if (owner) {
          $('clPic').onclick = () => CW.pickPicture((data) => net.send({ t: 'picSet', kind: 'c', data }));
          if ($('clPicDel')) $('clPicDel').onclick = () => net.send({ t: 'picSet', kind: 'c', data: null });
        }
        on('[data-kick]', (b) => { if (confirm(`Remove ${b.dataset.kick} from the club?`)) net.send({ t: 'clubKick', name: b.dataset.kick }); });
        on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'clubs'));
        $('clLeave').onclick = () => { if (confirm(`Leave ${cl.name}?${owner && cl.members > 1 ? ' The member with the most trophies becomes the owner.' : ''}`)) net.send({ t: 'clubLeave' }); };
        if (owner) $('clSave').onclick = () => net.send({ t: 'clubEdit', open: $('clOpen').value === '1', minTro: +$('clMin').value, desc: $('clDesc').value, badge: cl.badge });
        return;
      }
      if (this.peek) {
        const cl = this.peek;
        body.innerHTML = `<button class="ws-btn" id="clBack">← Back</button>` + head(cl) + (cl.open && cl.members < 30 && (this.me.tro | 0) >= cl.minTro ? `<button class="btn" data-join="${esc(cl.id)}">Join ${esc(cl.name)}</button>` : '') + `<h3>Members</h3>${members(cl, false)}`;
        $('clBack').onclick = () => { this.peek = null; this.rerender(); };
        on('[data-join]', (b) => net.send({ t: 'clubJoin', id: b.dataset.join }));
        on('[data-view]', (b) => this.showPlayer(b.dataset.view, 'clubs'));
        return;
      }
      if (!this.clubs) net.send({ t: 'clubList' });
      this.newBadge = this.newBadge | 0;
      body.innerHTML = `<div class="small">Clubs are teams of up to 30 players. Your trophies count toward your club's total, and you can cheer each other on the club wall.</div>
        <div class="club-form"><input id="clQ" maxlength="20" placeholder="Search clubs"><button class="ws-btn" id="clFind">🔍 Search</button></div>
        <div>${(this.clubs || []).map(row).join('') || '<div class="small">No clubs yet. Start the first one!</div>'}</div>
        <h3>Start a club</h3><div class="club-form"><input id="clName" maxlength="20" placeholder="Club name"><input id="clNewDesc" maxlength="80" placeholder="Description (optional)"></div>
        <div class="club-form">${CW.CLUB_BADGES.map((b, i) => `<button class="tod-btn ${i === this.newBadge ? 'sel' : ''}" data-badge="${i}">${b}</button>`).join('')}</div>
        <button class="btn" id="clCreate">🛡 Create club</button>`;
      $('clFind').onclick = () => net.send({ t: 'clubList', q: $('clQ').value });
      $('clQ').onkeydown = (e) => { if (e.key === 'Enter') $('clFind').click(); };
      on('[data-badge]', (b) => { this.newBadge = +b.dataset.badge; body.querySelectorAll('[data-badge]').forEach((x) => x.classList.toggle('sel', x === b)); });
      on('[data-peek]', (b) => net.send({ t: 'clubInfo', id: b.dataset.peek }));
      on('[data-join]', (b) => net.send({ t: 'clubJoin', id: b.dataset.join }));
      $('clCreate').onclick = () => net.send({ t: 'clubCreate', name: $('clName').value, desc: $('clNewDesc').value, badge: this.newBadge, open: true });
    }
    profilePanel(body) {
      const g = this.game;
      if (!this.me) { body.innerHTML = '<div class="small">You are playing as a guest.</div><button class="btn" id="profLogin">👤 Log in or sign up</button><h3>Stats</h3>' + g.meta.statsHtml(); $('profLogin').onclick = () => { g.meta.closePanel(); this.openLogin(); }; return; }
      const me = this.me;
      const s = g.profile.stats;
      const kids = this.game.talk.mode === 'quick';
      body.innerHTML = this.card(me) +
        `<h3>Your picture</h3><div class="pic-row">${kids ? '<span class="small">Own pictures are off with Quick chat only (Settings › Chat).</span>'
          : `<button class="ws-btn" id="profPic">📷 ${me.pv ? 'Change' : 'Use'} your own picture</button>${me.pv ? '<button class="ws-btn" id="profPicDel">Remove it</button>' : ''}<span class="small">Square, shown as a circle. Only you can use it.</span>`}</div>
        <h3>Pick your avatar</h3><div class="av-grid">${CW.AVATARS.map((a, i) => {
          const prem = CW.SHOP.avatars.find((x) => x.idx === i);
          const locked = prem && !g.profile.owned.avatars.includes(prem.id);
          return `<button class="av-btn ${i === me.av && !me.pv ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? 'data-shop="1" aria-label="Unlock it in the Shop or on the Trophy Road"' : `data-av="${i}"`}>${a}${locked ? '<i>🔒</i>' : ''}</button>`;
        }).join('')}</div>
        <h3>Stats</h3>${g.meta.statsHtml()}
        <h3>Account</h3>
        <div class="small">${this.sync.dirty ? '☁ Backing up your progress…' : '☁ Your progress is backed up to your account.'} Log in on any device (web, Windows or Android) to play with it.</div>
        <div class="small" style="margin-top:6px">📧 ${this.myEmail ? `You log in with <b>${esc(this.myEmail)}</b>` : 'No email yet: add one so you can always log in with a code'}</div>
        ${this.mailLogin() ? `<form id="linkForm" class="mail-link">${this.linkStep === 'code'
          ? `<input id="linkCode" inputmode="numeric" maxlength="6" placeholder="Code from the email"><button class="ws-btn on">Confirm</button>`
          : `<input id="linkMail" type="email" maxlength="254" placeholder="you@gmail.com" value="${esc(this.myEmail || '')}"><button class="ws-btn">${this.myEmail ? 'Change email' : 'Add email'}</button>`}</form>` : ''}
        <div class="menu-btns" style="justify-content:flex-start;margin-top:8px">
          ${this.hasPass ? '<button class="ws-btn" id="profPass">🔑 Change password</button>' : ''}
          <button class="ws-btn" id="profOut">🚪 Log out</button>
          <button class="ws-btn" id="profDel">🗑 Delete account…</button>
        </div>
        <form id="profPassForm" class="acct-mini hidden"><input type="password" id="ppOld" placeholder="Current password" autocomplete="current-password"><input type="password" id="ppNew" placeholder="New password (6+)" autocomplete="new-password"><button class="ws-btn on">Save new password</button><div class="small">Other devices will be logged out.</div></form>
        <form id="profDelForm" class="acct-mini hidden"><div class="small">This removes <b>${esc(me.name)}</b>, its trophies, friends and cloud backup <b>forever</b>.</div><input type="${this.hasPass ? 'password' : 'text'}" id="pdPass" placeholder="${this.hasPass ? 'Your password' : 'Type your username to confirm'}" autocomplete="off"><button class="ws-btn bad">Delete my account</button></form>`;
      // picking an avatar also stops using your own picture
      body.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => { this.net.send({ t: 'profileSet', av: +b.dataset.av }); if (me.pv) this.net.send({ t: 'picSet', kind: 'u', data: null }); }));
      body.querySelectorAll('[data-shop]').forEach((b) => (b.onclick = () => g.meta.openPanel('shop')));
      if ($('profPic')) $('profPic').onclick = () => CW.pickPicture((data) => this.net.send({ t: 'picSet', kind: 'u', data }));
      if ($('profPicDel')) $('profPicDel').onclick = () => this.net.send({ t: 'picSet', kind: 'u', data: null });
      $('profOut').onclick = () => this.logout();
      if ($('profPass')) $('profPass').onclick = () => { $('profPassForm').classList.toggle('hidden'); $('ppOld').focus(); };
      if ($('linkForm')) $('linkForm').onsubmit = (e) => {
        e.preventDefault();
        if (this.linkStep === 'code') return this.net.send({ t: 'emailCode', email: this.linkMail, code: $('linkCode').value.trim() });
        this.linkMail = $('linkMail').value.trim();
        this.linkStep = 'code';
        this.net.send({ t: 'emailStart', email: this.linkMail });
        this.rerender();
      };
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
      on('[data-rem]', (b) => { if (confirm(`Remove ${b.dataset.rem} from your friends?`)) net.send({ t: 'friendRemove', name: b.dataset.rem }); });
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
      else if (this.lbTab === 'clubs') body.innerHTML = tabs + ((this.clubs || []).map((cl, i) => `<div class="fr-row lb-row"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</span><span class="av">${CW.CLUB_BADGES[cl.badge] || '🛡'}</span><b class="fr-name">${esc(cl.name)}</b><span class="small">👥 ${cl.members}</span><b class="lb-tro">🏆 ${cl.tro}</b></div>`).join('') || '<div class="small">No clubs yet.</div>');
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
