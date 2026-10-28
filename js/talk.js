// Cogwild — the chat window (💬, or Enter): your match, your party, your club and your friends.
//
// Matches only have quick chat (ready-made lines, also keys 1-8). Party, club and friends have free chat:
// type anything (200 characters). "Quick chat only" (Settings > Chat, kept on your account) is for kids:
// only ready-made lines, no free text either way and no voice chat. Tap a name to see their profile,
// block them (nothing from them reaches you, also no voice) or report them. The server: server/talk.js.
(function () {
  const CW = window.CW;
  const $ = (id) => document.getElementById(id);
  const esc = CW.esc;
  const QUICK = () => CW.ECON.TALK_QUICK;
  const TABS = { game: '🎮 Match', party: '🎉 Party', club: '🛡 Club', friends: '👥 Friends' };
  const REASONS = ['Bad words', 'Bullying', 'Spam', 'Cheating', 'Other'];

  class Talk {
    constructor(game) {
      this.game = game;
      this.mode = 'free'; // 'free' or 'quick' (from the server once you log in)
      this.blocked = [];
      this.unread = {}; // friend name -> messages not read yet
      this.dms = {}; // friend name -> lines
      this.seenAt = {}; // party/club: time of the newest line you've seen (kept on this device per account, so read stays read)
      this.tab = null;
      this.thread = null; // the friend whose messages are open
      this.who = null; // the name tapped (profile / block / report row)
      this.cards = {}; // name -> { name, av, pv } of people you message who aren't friends (club-mates)
      this.bindUi();
      setInterval(() => this.placeButtons(), 250);
    }
    get acct() { return this.game.account; }
    get net() { return this.game.net; }
    get isOpen() { return !$('chat').classList.contains('hidden'); }
    // free chat is off for kids, and on CrazyGames and Poki (their rules ask for quick chat only)
    get freeOk() { return this.mode !== 'quick' && CW.PORTAL !== 'crazygames' && CW.PORTAL !== 'poki'; }

    bindUi() {
      $('btnChat').onclick = () => this.toggle();
      $('hudChat').onclick = () => this.toggle();
      $('chatX').onclick = () => this.close();
      $('chatForm').onsubmit = (e) => {
        e.preventDefault();
        const x = $('chatInput').value.trim();
        if (!x) { if (this.game.state === 'match') this.close(); return; } // Enter on an empty line closes it
        if (this.say({ x })) $('chatInput').value = '';
      };
      // Enter, or the chat key (T unless changed or turned off in Settings › Chat), opens the chat; not while typing
      window.addEventListener('keydown', (e) => {
        const key = this.game.meta.optKey('chatKey');
        if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && (key === 'none' || e.code !== key)) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (e.code === 'KeyT' && this.game.state === 'match' && this.game.modeId === 'test') return; // T = back to the Workshop there
        if (e.repeat || !['menu', 'match', 'results'].includes(this.game.state) || !$('acct').classList.contains('hidden')) return;
        e.preventDefault();
        // the chat key opens the chat, and closes it again when you're not typing in it (Enter only opens it)
        if (this.isOpen) { if (e.code === key) this.close(); return; }
        this.open();
      });
      // phones: typing in the menu turns the phone upright (easier to type), Done turns it back
      const upright = () => { if (this.game.touch.on && this.game.state === 'menu') this.portrait(true); };
      $('chatInput').addEventListener('focus', upright);
      $('chatInput').addEventListener('pointerdown', upright);
      $('chatDone').onclick = () => this.close();
      this.bindGrip();
    }

    // ======================= from the server =======================
    onMessage(m) {
      switch (m.t) {
        case 'talk':
          if (m.mode) { const was = this.mode; this.mode = m.mode; if (was !== m.mode) this.game.voice.apply(); }
          if (m.blocked) this.blocked = m.blocked;
          if (m.unread) this.unread = Object.assign({}, m.unread);
          this.refresh();
          if (this.game.meta.panel === 'settings' && !$('panel').classList.contains('hidden')) this.game.meta.renderPanel();
          return true;
        case 'dm': {
          this.dms[m.with] = (this.dms[m.with] || []).concat(m.msg).slice(-60);
          const mine = this.acct.me && m.msg.f === this.acct.me.name;
          if (this.isOpen && this.tab === 'friends' && this.thread === m.with) this.net.send({ t: 'dmRead', name: m.with });
          else if (!mine) { this.unread[m.with] = (this.unread[m.with] | 0) + 1; this.notify(`💬 ${m.with}`, m.msg); }
          this.refresh();
          return true;
        }
        case 'dmLog':
          this.dms[m.with] = m.list;
          if (m.card) this.cards[m.with] = m.card;
          delete this.unread[m.with];
          this.refresh();
          return true;
        case 'partyMsg': {
          const p = this.acct.party;
          if (p) p.log = (p.log || []).concat(m.msg).slice(-40);
          this.acct.renderPartyLog();
          this.heard('party', m.msg, '🎉 Party');
          return true;
        }
        case 'clubMsg': {
          const cl = this.acct.club;
          if (cl) cl.log = (cl.log || []).concat(m.msg).slice(-40);
          this.heard('club', m.msg, '🛡 ' + (cl ? cl.name : 'Club'));
          if (this.game.meta.panel === 'clubs' && !$('panel').classList.contains('hidden')) this.game.meta.renderPanel();
          return true;
        }
      }
      return false;
    }
    heard(tab, msg, where) {
      const mine = this.acct.me && msg.f === this.acct.me.name;
      if (!mine && !(this.isOpen && this.tab === tab)) this.notify(where + ' · ' + msg.f, msg);
      this.refresh();
    }
    // a message arrived while the chat is closed (or on another tab)
    notify(who, msg) {
      if (this.game.settings.chatNotes === false || this.isBlocked(msg.f)) return;
      const text = `${who}: ${this.text(msg)}`;
      if (this.game.state === 'match') this.game.feed(esc(text.length > 70 ? text.slice(0, 68) + '…' : text));
      else this.game.toast(text.length > 80 ? text.slice(0, 78) + '…' : text);
    }

    // ======================= sending =======================
    // { x } free text or { q } a quick line, to a tab (the open one by default). true when it was sent
    sayTo(tab, m) { const was = this.tab; this.tab = tab; const ok = this.say(m); this.tab = was; return ok; }
    say(m) {
      const net = this.net;
      if (m.x != null && !this.freeOk) { this.game.toast('Quick chat only is on (Settings > Chat)'); return false; }
      if (this.tab === 'game') return false;
      if (!this.acct.loggedIn) { this.acct.openLogin('Log in to chat with friends, your party and your club'); return false; }
      const msg = Object.assign({}, m);
      if (this.tab === 'party') net.send(Object.assign({ t: 'partySay' }, msg));
      else if (this.tab === 'club') net.send(Object.assign({ t: 'clubSay' }, msg));
      else if (this.tab === 'friends' && this.thread) net.send(Object.assign({ t: 'dmSend', to: this.thread }, msg));
      else return false;
      return true;
    }
    setMode(mode) {
      if (!this.acct.loggedIn) return this.acct.openLogin('Log in to choose how you chat');
      this.net.send({ t: 'chatMode', mode });
    }
    isBlocked(name) { return !!name && this.blocked.some((b) => b.toLowerCase() === String(name).toLowerCase()); }

    // ======================= the window =======================
    tabs() {
      const t = [];
      if (this.net.room) t.push('game');
      if (this.acct.party) t.push('party');
      t.push('club', 'friends');
      return t;
    }
    // the 💬 🎤 🎧 buttons: in the menu they're in the top bar; in a match next to the minimap; while waiting for a
    // match (search screen, room) at the top right
    placeButtons() {
      const st = this.game.state;
      const show = st === 'match' || st === 'lobby' || st === 'results';
      $('hudTalk').classList.toggle('hidden', !show);
      $('hudTalk').classList.toggle('waiting', st !== 'match');
    }
    open(tab) {
      if (this.game.state === 'match' && document.pointerLockElement) document.exitPointerLock();
      const tabs = this.tabs();
      this.tab = tab && tabs.includes(tab) ? tab : this.tab && tabs.includes(this.tab) ? this.tab : tabs[0];
      // phones in the menu: the whole screen, like a chat app (☰ Menu goes back); other phone screens: a small window;
      // PCs (v1.9.4): a panel down the whole left side, like a game launcher's friends list (it doesn't move)
      document.body.classList.toggle('talk-full', this.game.touch.on && this.game.state === 'menu');
      document.body.classList.toggle('talk-dock', !this.game.touch.on);
      this.placeChat();
      $('chat').classList.remove('hidden');
      this.render();
      if (!this.game.touch.on) setTimeout(() => { if (!$('chatForm').classList.contains('hidden')) $('chatInput').focus(); }, 30);
    }
    close() {
      $('chat').classList.add('hidden');
      $('chatInput').blur();
      this.who = null;
      this.portrait(false);
      document.body.classList.remove('talk-full', 'talk-dock');
      this.fitKeyboard();
    }
    // phones with the keyboard open: the full-screen chat fits in the part of the screen the keyboard leaves, so its
    // tabs and ✕ at the top stay visible (the Android app also makes the whole game shorter, see MainActivity)
    fitKeyboard() {
      const box = $('chat'), vv = window.visualViewport;
      const full = this.isOpen && /talk-(full|portrait)/.test(document.body.className);
      if (!vv || !full || vv.height >= innerHeight - 40) { box.style.height = box.style.top = ''; return; }
      box.style.top = vv.offsetTop + 'px';
      box.style.height = vv.height + 'px';
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    }
    // the chat stays where you dragged it (saved as a share of the screen)
    placeChat() {
      const box = $('chat'), p = this.game.settings.chatPos;
      if (!p || /talk-(full|dock)/.test(document.body.className)) { box.style.left = box.style.top = ''; return; }
      const z = parseFloat(getComputedStyle(box).zoom) || 1;
      const w = box.offsetWidth * z || 340, h = box.offsetHeight * z || 400;
      const x = Math.max(0, Math.min(innerWidth - w, p.x * innerWidth)), y = Math.max(0, Math.min(innerHeight - h, p.y * innerHeight));
      box.style.left = x / z + 'px';
      box.style.top = y / z + 'px';
    }
    // drag ⠿ to move the chat anywhere
    bindGrip() {
      const grip = $('chatGrip'), box = $('chat');
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const z = parseFloat(getComputedStyle(box).zoom) || 1;
        const r = box.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, left: r.left * z, top: r.top * z };
        const move = (ev) => {
          const w = box.offsetWidth * z, h = box.offsetHeight * z;
          const x = Math.max(0, Math.min(innerWidth - w, start.left + ev.clientX - start.x)), y = Math.max(0, Math.min(innerHeight - h, start.top + ev.clientY - start.y));
          box.style.left = x / z + 'px';
          box.style.top = y / z + 'px';
          this.game.settings.chatPos = { x: x / innerWidth, y: y / innerHeight };
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.game.saveProfile(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      window.addEventListener('resize', () => { if (this.isOpen) { this.placeChat(); this.fitKeyboard(); } });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => this.fitKeyboard());
        window.visualViewport.addEventListener('scroll', () => this.fitKeyboard());
      }
    }
    // straight to a private message with someone (Friends list, club members)
    openDm(name) {
      if (!this.acct.loggedIn) return this.acct.openLogin('Log in to message players');
      this.thread = name;
      this.who = null;
      this.net.send({ t: 'dmOpen', name });
      if (!$('panel').classList.contains('hidden') && $('panel').classList.contains('full')) this.game.meta.closePanel();
      this.open('friends');
    }
    // phones in the menu: the chat fills the screen upright while typing (the app turns the phone; on the website
    // the game asks the browser, and otherwise the player turns it)
    portrait(on) {
      if (!!this.upright === on) return;
      this.upright = on;
      document.body.classList.toggle('talk-portrait', on);
      try {
        if (window.CogwildNative && window.CogwildNative.setOrientation) window.CogwildNative.setOrientation(on ? 'portrait' : 'landscape');
        else if (screen.orientation && screen.orientation.lock) screen.orientation.lock(on ? 'portrait' : 'landscape').catch(() => {});
      } catch (e) { /* the player turns the phone */ }
      setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    }
    toggle() { if (this.isOpen) this.close(); else this.open(); }
    // something changed: redraw the window if it's open, and the badges either way
    refresh() {
      if (this.isOpen) this.render();
      this.badges();
    }
    unreadIn(tab) {
      if (tab === 'friends') return Object.entries(this.unread).filter(([n]) => !this.isBlocked(n)).reduce((s, [, v]) => s + (v | 0), 0);
      const list = this.lines(tab);
      const mine = this.acct.me && this.acct.me.name;
      const since = this.seenTime(tab);
      return list.filter((l) => l.f && l.f !== mine && (l.at || 0) > since).length;
    }
    badges() {
      const n = ['party', 'club', 'friends'].reduce((s, t) => s + (this.isOpen && this.tab === t ? 0 : this.unreadIn(t)), 0);
      for (const id of ['badgeChat', 'hudChatBadge']) { const b = $(id); if (b) { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); } }
    }
    // read stays read after a restart: the newest seen line's time, per account and channel, on this device
    seenKey() { return 'cogwild.chatSeen.' + ((this.acct.me && this.acct.me.name.toLowerCase()) || 'guest'); }
    seenTime(tab) {
      if (this.seenUser !== this.seenKey()) {
        this.seenUser = this.seenKey();
        try { this.seenAt = JSON.parse(localStorage.getItem(this.seenUser) || '{}') || {}; } catch (e) { this.seenAt = {}; }
      }
      return this.seenAt[tab] || 0;
    }
    markSeen(tab) {
      const newest = this.lines(tab).reduce((m, l) => Math.max(m, l.at || 0), 0);
      if (newest <= this.seenTime(tab)) return;
      this.seenAt[tab] = newest;
      try { localStorage.setItem(this.seenKey(), JSON.stringify(this.seenAt)); } catch (e) { /* private window */ }
      this.badges();
    }
    lines(tab) {
      if (tab === 'party') return (this.acct.party && this.acct.party.log) || [];
      if (tab === 'club') return (this.acct.club && this.acct.club.log) || [];
      if (tab === 'friends') return (this.thread && this.dms[this.thread]) || [];
      return [];
    }
    text(l) { return l.x != null ? l.x : l.q != null ? QUICK()[l.q] || '' : l.s || l.text || ''; }

    render() {
      const tabs = this.tabs();
      if (!tabs.includes(this.tab)) this.tab = tabs[0];
      const tab = this.tab;
      $('chatTabs').innerHTML = tabs.map((t) => {
        const n = t === tab ? 0 : t === 'game' ? 0 : this.unreadIn(t);
        return `<button class="chat-tab ${t === tab ? 'on' : ''}" data-ctab="${t}">${TABS[t]}${n ? `<i class="badge">${n}</i>` : ''}</button>`;
      }).join('');
      $('chatTabs').querySelectorAll('[data-ctab]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.ctab; this.who = null; this.render(); }));
      const me = this.acct.me && this.acct.me.name;
      let sub = '', body = '', quick = [], canType = false;
      const logIn = (why) => `<div class="chat-empty">${why}<br><button class="ws-btn on" data-login="1">Log in</button></div>`;
      if (tab === 'game') {
        // the match: quick chat only (keys 1-8 too)
        const log = this.net.chatLog || [];
        sub = `<span class="small">Quick chat with everyone in this match${this.game.touch.on ? '' : ' · keys 1-8'}</span>`;
        body = log.length ? log.map((l) => `<div class="chat-line">${l}</div>`).join('') : '<div class="chat-empty">Say hi with the quick chat below</div>';
        quick = CW.QUICK_CHAT.map((t, i) => `<button class="chat-q" data-gq="${i}">${t}</button>`);
      } else if (!this.acct.loggedIn) {
        body = logIn(tab === 'club' ? 'Log in to chat with your club' : 'Log in to chat with your friends and party');
      } else if (tab === 'club' && !this.acct.club) {
        body = `<div class="chat-empty">Join a club to chat with its members<br><button class="ws-btn on" data-clubs="1">🛡 Find a club</button></div>`;
      } else if (tab === 'friends' && !this.thread) {
        // the friends list: who's online, unread messages
        const fr = this.acct.friends.slice();
        const club = (this.acct.club && this.acct.club.list) || [];
        // club-mates you talked with (or who wrote to you) are listed too
        for (const n of new Set([...Object.keys(this.dms), ...Object.keys(this.unread)])) {
          if (fr.some((f) => f.name === n)) continue;
          const c = club.find((p) => p.name === n) || this.cards[n];
          if (c) fr.push(Object.assign({ on: !!c.on, club: true }, c));
        }
        fr.sort((a, b) => ((this.unread[b.name] | 0) - (this.unread[a.name] | 0)) || (b.on - a.on) || a.name.localeCompare(b.name));
        body = fr.length ? fr.map((f) => `<button class="chat-friend ${f.on ? 'on' : ''}" data-dm="${esc(f.name)}"><span class="av">${CW.face(f)}</span><b>${esc(f.name)}</b><small>${this.isBlocked(f.name) ? '🚫 blocked' : (f.club ? '🛡 ' : '') + (f.on ? '🟢 online' : '⚫ offline')}</small>${this.unread[f.name] ? `<i class="badge">${this.unread[f.name]}</i>` : ''}</button>`).join('')
          : '<div class="chat-empty">No friends yet. Add someone in 👥 Friends, or message a club member from 🛡 Clubs.</div>';
      } else {
        if (tab === 'friends') sub = `<button class="ws-btn chat-back" data-back="1">←</button><b class="chat-who" data-who="${esc(this.thread)}">${esc(this.thread)}</b>`;
        else if (tab === 'club') sub = `<b>🛡 ${esc(this.acct.club.name)}</b><span class="small">${this.acct.club.list.filter((p) => p.on).length} online</span>`;
        else sub = `<b>🎉 Party</b><span class="small">${this.acct.party.members.map((p) => esc(p.name)).join(', ')}</span>`;
        const list = this.lines(tab).filter((l) => !this.isBlocked(l.f));
        body = list.length ? list.map((l) => (l.f
          ? `<div class="chat-line ${l.f === me ? 'me' : ''}"><span class="chat-face">${CW.face({ name: l.f, av: l.a, pv: l.pv })}</span><span><b class="chat-who" data-who="${esc(l.f)}">${esc(l.f === me ? 'You' : l.f)}</b> ${esc(this.text(l))}</span></div>`
          : `<div class="chat-line sys">${esc(this.text(l))}</div>`)).join('')
          : `<div class="chat-empty">${tab === 'friends' ? `Say hi to ${esc(this.thread)}!` : 'No messages yet. Say hi!'}</div>`;
        // ready-made lines only for "Quick chat only" players: everyone else types
        if (!this.freeOk) quick = QUICK().map((t, i) => `<button class="chat-q" data-q="${i}">${t}</button>`);
        canType = this.freeOk && !(tab === 'friends' && this.isBlocked(this.thread));
        if (tab === 'party' || tab === 'club') this.markSeen(tab);
        if (tab === 'friends' && this.unread[this.thread]) { delete this.unread[this.thread]; this.net.send({ t: 'dmRead', name: this.thread }); }
      }
      // a tapped name: profile, block, report
      if (this.who) {
        const blocked = this.isBlocked(this.who);
        sub = this.reporting
          ? `<span class="small">Report ${esc(this.who)} for:</span>${REASONS.map((r) => `<button class="ws-btn chat-act" data-why="${r}">${r}</button>`).join('')}<button class="ws-btn chat-act" data-act="cancel">Cancel</button>`
          : `<b>${esc(this.who)}</b><button class="ws-btn chat-act" data-act="profile">👤 Profile</button><button class="ws-btn chat-act" data-act="block">${blocked ? 'Unblock' : '🚫 Block'}</button><button class="ws-btn chat-act" data-act="report">⚑ Report</button><button class="ws-btn chat-act" data-act="cancel">✕</button>`;
      }
      $('chatSub').innerHTML = sub;
      $('chatSub').classList.toggle('hidden', !sub);
      $('chatLog').innerHTML = body;
      $('chatQuick').innerHTML = quick.join('');
      $('chatQuick').classList.toggle('hidden', !quick.length);
      $('chatForm').classList.toggle('hidden', !canType);
      $('chatNote').classList.toggle('hidden', !(tab !== 'game' && this.acct.loggedIn && !this.freeOk && quick.length));
      $('chatLog').scrollTop = $('chatLog').scrollHeight;
      this.wire();
      this.badges();
    }
    wire() {
      const on = (sel, fn) => $('chat').querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
      on('[data-gq]', (b) => { this.net.chat(+b.dataset.gq); this.render(); });
      on('[data-q]', (b) => this.say({ q: +b.dataset.q }));
      on('[data-dm]', (b) => { this.thread = b.dataset.dm; this.who = null; this.net.send({ t: 'dmOpen', name: this.thread }); this.render(); });
      on('[data-back]', () => { this.thread = null; this.who = null; this.render(); });
      on('[data-login]', () => { this.close(); this.acct.openLogin('Log in to chat with friends, your party and your club'); });
      on('[data-clubs]', () => { this.close(); $('btnClubs').click(); });
      on('[data-who]', (b) => { const n = b.dataset.who; if (this.acct.me && n === this.acct.me.name) return; this.who = n; this.reporting = false; this.render(); });
      on('[data-act]', (b) => {
        const n = this.who, act = b.dataset.act;
        if (act === 'profile') { this.close(); this.acct.showPlayer(n); }
        if (act === 'block') this.net.send({ t: this.isBlocked(n) ? 'unblock' : 'block', name: n });
        if (act === 'report') { this.reporting = true; return this.render(); }
        this.who = null;
        this.reporting = false;
        this.render();
      });
      on('[data-why]', (b) => {
        this.net.send({ t: 'report', name: this.who, why: b.dataset.why, where: this.tab });
        this.who = null;
        this.reporting = false;
        this.render();
      });
    }
  }

  CW.Talk = Talk;
})();
